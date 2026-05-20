/**
 * vault-memory Obsidian plugin — entry point.
 *
 * Phase 7 / 07-03 / ADR-007.
 *
 * # Lifecycle ordering (07-03-PLAN.md Task 3 §action)
 *
 *   onload():
 *     1. Construct + load `SettingsStore` (data.json → DEFAULT_SETTINGS merge).
 *     2. Construct `VaultMemoryMcpClient` from settings (command + args + env).
 *     3. Attempt `await mcpClient.connect()` inside try/catch.
 *        On `CliNotFoundError`: set cliMissing=true, store message,
 *        continue loading — the plugin must still load so the user can
 *        edit local `.contract` files and see the banner.
 *     4. registerView(VIEW_TYPE_CONTRACT, leaf => new ContractEditorView(leaf, this)).
 *     5. registerExtensions(["contract"], VIEW_TYPE_CONTRACT) so opening
 *        any `.contract` file launches the editor automatically.
 *     6. addSettingTab(new VaultMemorySettingsTab(app, this)).
 *     7. If cliMissing: fire a `Notice` with the recovery copy.
 *
 *   onunload():
 *     - `await mcpClient.disconnect()` — kills the child process.
 *     - Obsidian auto-unregisters views/extensions/setting-tabs.
 *
 * # Adapter-seam discipline
 *
 * No Node `fs` against vault paths. All vault writes go through
 * `app.vault.adapter.write(...)`. Settings persistence flows through
 * `loadData()` / `saveData()` only — the SettingsStore is the single
 * choke-point.
 *
 * # Memory namespace invariant (PROJECT.md "Core Value")
 *
 * The plugin never writes silently into user-authored notes. Every
 * agent-authored write goes through the server's DeliveryAdapter (which
 * enforces the labeled MemorySink). The editor surfaces explicit
 * "Save" / "Apply" actions only.
 */

import { Modal, Notice, Plugin } from "obsidian";
import {
  ContractEditorView,
  VIEW_TYPE_CONTRACT,
} from "./src/views/contract-editor/view.js";
import {
  CliNotFoundError,
  VaultMemoryMcpClient,
} from "./src/services/mcp-client.js";
import { SettingsStore } from "./src/services/settings-store.js";
import { SafeStorageAdapter } from "./src/services/safe-storage.js";
import { SecretsStore } from "./src/services/secrets-store.js";
import { ReloadNotifier } from "./src/services/reload-notifier.js";
import { VaultMemorySettingsTab } from "./src/chrome/settings-tab.js";
import { ChromeView, VIEW_TYPE_CHROME } from "./src/chrome/chrome-view.js";

export default class VaultMemoryPlugin extends Plugin {
  // Public fields so chrome plans (07-08..07-10), the editor view
  // (07-05), and the watcher plan (07-07) can reach services through
  // `this.plugin.<field>` after they receive the plugin instance via
  // the view constructor / settings-tab constructor.
  settingsStore!: SettingsStore;
  mcpClient!: VaultMemoryMcpClient;
  /** PLG-02 — Electron safeStorage wrapper; wired in onload() step (1b). */
  safeStorage!: SafeStorageAdapter;
  /** PLG-02 — typed secrets store backed by data.json (ciphertext only). */
  secretsStore!: SecretsStore;
  /**
   * Plan 07-07 / CAN-08 — subscribes to
   * `vault-memory://contracts/reloaded` and surfaces a Modal when an
   * external edit touches an open `.contract`. Null when the MCP
   * client failed to connect (no notifications to subscribe to).
   */
  reloadNotifier: ReloadNotifier | null = null;

  /** True when boot-time `mcpClient.connect()` failed with ENOENT. */
  cliMissing = false;
  /** Human-readable diagnostic for the missing-CLI banner. */
  cliMissingMessage: string | null = null;

  override async onload(): Promise<void> {
    // (1) Settings — must be first so step (2) can read serverCommand.
    this.settingsStore = new SettingsStore(this);
    await this.settingsStore.load();

    // (1b) PLG-02 services — discover Electron safeStorage once and
    // construct the secrets store. Both are needed by the settings tab
    // (step 6) but neither performs network or process-spawning work, so
    // they can run before the MCP connect attempt.
    this.safeStorage = new SafeStorageAdapter();
    this.secretsStore = new SecretsStore(this, this.safeStorage);
    await this.secretsStore.load();

    // (2) MCP client construction (no spawn yet — that's step 3).
    this.mcpClient = new VaultMemoryMcpClient({
      command: this.settingsStore.get("serverCommand"),
      args: this.settingsStore.get("serverArgs"),
    });

    // (3) Attempt connect — missing CLI is non-fatal.
    try {
      await this.mcpClient.connect();
    } catch (err) {
      if (err instanceof CliNotFoundError) {
        this.cliMissing = true;
        this.cliMissingMessage = err.message;
        // Continue loading: registerView + extension still wires up so
        // the user can open .contract files locally; settings tab
        // shows the persistent banner.
      } else {
        // Unknown error — surface but still continue loading. Without
        // this catch the plugin would fail to load entirely and the
        // user could not edit the Server Command setting to recover.
        const msg = err instanceof Error ? err.message : String(err);
        this.cliMissing = true;
        this.cliMissingMessage = `vault-memory server failed to start: ${msg}`;
      }
    }

    // (4) Custom view registration.
    this.registerView(
      VIEW_TYPE_CONTRACT,
      (leaf) => new ContractEditorView(leaf, this),
    );

    // (4b) Chrome view registration (07-09 / PLG-03 + PLG-04). A single
    // workspace leaf bundles the Reindex + Stats panels; opened via the
    // "Open vault-memory panel" command below.
    this.registerView(VIEW_TYPE_CHROME, (leaf) => new ChromeView(leaf, this));

    // (5) Bind .contract extension to the view.
    this.registerExtensions(["contract"], VIEW_TYPE_CONTRACT);

    // (5b) Command — opens the chrome side-panel. Command id is
    // `open-chrome` (the Obsidian-public id is namespaced by Obsidian
    // to "vault-memory:open-chrome").
    this.addCommand({
      id: "open-chrome",
      name: "Open Contracts panel",
      callback: () => {
        void this.activateChromeView();
      },
    });

    // (6) Settings-tab skeleton (07-08 fills it in).
    this.addSettingTab(new VaultMemorySettingsTab(this.app, this));

    // (7) Missing-CLI Notice — 10s, long enough to read.
    if (this.cliMissing) {
      new Notice(
        "vault-memory CLI not found on PATH — run /vm-install to set up. " +
          "The contract editor will load but cannot reach the server.",
        10000,
      );
    }

    // (8) Plan 07-07 / CAN-08 — subscribe to external-edit notifications
    // for `.contract` files. Only meaningful when the MCP client is
    // available; on `cliMissing` we skip wiring (nothing to subscribe to).
    if (!this.cliMissing) {
      this.reloadNotifier = new ReloadNotifier({
        mcpClient: this.mcpClient,
        openContractPaths: () => this.collectOpenContractPaths(),
        promptReload: (contractPath) => this.promptExternalEditReload(contractPath),
      });
      this.reloadNotifier.start();
    }
  }

  override async onunload(): Promise<void> {
    // CAN-08 — unsubscribe from contracts/reloaded notifications first
    // so any in-flight emit during teardown is silently dropped.
    try {
      this.reloadNotifier?.stop();
    } catch {
      // Best-effort.
    }
    this.reloadNotifier = null;

    // Detach any open chrome leaves first so onClose() runs and the
    // panel's Svelte trees unmount cleanly (subscriptions disposed).
    try {
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHROME);
    } catch {
      // Best-effort — workspace teardown is also handled by Obsidian.
    }

    // Always attempt disconnect — disconnect is idempotent and safe
    // even when connect() failed (available is false).
    try {
      await this.mcpClient?.disconnect();
    } catch {
      // Best-effort: child-process death + plugin unload race conditions
      // are not worth surfacing — the OS will reap on Obsidian exit.
    }
    // Obsidian auto-unregisters views, extensions, and setting-tabs.
  }

  /**
   * Walk the workspace and collect the vault-relative paths of every
   * open `.contract` editor view. Cheap (constant work per leaf), and
   * called once per incoming notification.
   *
   * Plan 07-07 / CAN-08 — the ReloadNotifier uses this to decide
   * whether the user has the affected contract open before surfacing
   * the reload prompt.
   */
  private collectOpenContractPaths(): string[] {
    const paths: string[] = [];
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTRACT);
    for (const leaf of leaves) {
      const view = leaf.view as { file?: { path: string } } | null;
      const filePath = view?.file?.path;
      if (typeof filePath === "string") paths.push(filePath);
    }
    return paths;
  }

  /**
   * Surface an Obsidian Modal asking the user whether to reload the
   * editor for `.contract` files affected by an external edit. On
   * "Reload", call `view.load()` on the matching leaf to force
   * Obsidian to re-read the `.contract` from disk and rebuild state.
   *
   * Plan 07-07 / CAN-08 D-WATCH-SERVER-NOTIFY.
   */
  private async promptExternalEditReload(contractPath: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTRACT);
    const match = leaves.find((leaf) => {
      const v = leaf.view as { file?: { path: string } } | null;
      return v?.file?.path === contractPath;
    });
    if (!match) return;

    return new Promise<void>((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText("External edit detected");
      modal.contentEl.createEl("p", {
        text: `\`${contractPath}\` was modified outside the editor. Reload?`,
      });
      const buttons = modal.contentEl.createDiv({ cls: "vm-modal-buttons" });
      const reloadBtn = buttons.createEl("button", { text: "Reload" });
      reloadBtn.addEventListener("click", () => {
        const view = match.view as { load?: () => void | Promise<void> };
        try {
          void view.load?.();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`Reload failed: ${msg}`, 5000);
        }
        modal.close();
        resolve();
      });
      const keepBtn = buttons.createEl("button", { text: "Keep current" });
      keepBtn.addEventListener("click", () => {
        modal.close();
        resolve();
      });
      modal.onClose = () => resolve();
      modal.open();
    });
  }

  /**
   * Reveal the chrome side-panel in a right-leaf workspace pane. If a
   * leaf of `VIEW_TYPE_CHROME` already exists, reveal it; otherwise
   * create a fresh right-leaf and `setViewState` to mount the view.
   *
   * Phase 7 / 07-09. Pattern: `getLeavesOfType` → reuse or create →
   * `revealLeaf` (matches Obsidian's recommended side-panel idiom).
   */
  async activateChromeView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CHROME);
    let leaf = existing[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) {
        // Workspace cannot allocate a right leaf — fall through to a
        // Notice so the user knows the command did something.
        new Notice("Could not open vault-memory panel (no available pane).", 5000);
        return;
      }
      leaf = right;
      await (leaf as unknown as {
        setViewState: (state: { type: string; active: boolean }) => Promise<void>;
      }).setViewState({ type: VIEW_TYPE_CHROME, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /**
   * Open a contract file in the main editor area. Wired into the
   * ContractsPanel side-panel rows so clicking a contract opens its
   * canvas editor (for .contract) or a plain text view (for .yaml).
   *
   * Resolves the path to a TFile via the Obsidian Vault API and asks
   * the workspace to open it in a new leaf. The ContractEditorView
   * registration handles the .contract extension; .yaml falls back to
   * the default markdown/text view.
   */
  async openContract(path: string): Promise<void> {
    if (!path || !path.trim()) {
      new Notice("vault-memory: cannot open contract — empty path.", 5000);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !("extension" in file)) {
      new Notice(`vault-memory: contract not found at "${path}".`, 5000);
      return;
    }
    // Use openLinkText so Obsidian's standard "open in existing or new
    // leaf" logic kicks in — including its built-in error reporting.
    // openLinkText handles the leaf-selection edge cases that
    // getLeaf(false) + leaf.openFile trip over (e.g. when the only
    // workspace pane is the side panel itself; openFile on the side
    // panel's leaf emits Obsidian's native "<filename> konnte nicht
    // geöffnet werden" notice because that leaf already hosts the
    // ChromeView, not a TextFileView).
    try {
      await this.app.workspace.openLinkText(path, "", false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`vault-memory: failed to open ${path} — ${msg}`, 5000);
    }
  }

  /**
   * Create a new `.contract` file with a minimal valid scaffold and
   * open it in the canvas editor.
   *
   * Path picking: `_contracts/untitled.contract` if free, otherwise
   * `_contracts/untitled-N.contract` with N starting at 2. The folder
   * is created if it doesn't exist (Obsidian's mkdir is idempotent).
   *
   * Scaffold: one literal step ("Hello from your new contract.") so the
   * canvas opens with a non-empty assembly — the user can replace it
   * immediately. No source/sink — those are optional in the schema; the
   * user wires them when they're ready. vmFormatVersion is the same
   * constant the codec emits on save, so the file round-trips cleanly.
   */
  async createContract(): Promise<void> {
    const folder = "_contracts";
    try {
      const folderExists = this.app.vault.getAbstractFileByPath(folder);
      if (!folderExists) {
        await this.app.vault.createFolder(folder);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("already exists")) {
        throw err;
      }
    }

    let candidate = `${folder}/untitled.contract`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${folder}/untitled-${n}.contract`;
      n++;
      if (n > 9999) {
        new Notice("Could not allocate a free untitled-N.contract path.", 5000);
        return;
      }
    }

    // Scaffold must satisfy ContractDocumentSchema (plugin/src/shared-types
    // → src/contracts/contract-file-schema). The non-obvious fields:
    //   - contract.version: literal 1 (NOT vmFormatVersion's 1 — those are
    //     two distinct version numbers, one for the envelope and one for
    //     the inner contract block)
    //   - contract.assembly[].as: snake_case alias (each step's output
    //     key); the schema's superRefine enforces uniqueness
    //   - contract.name: kebab-case (regex /^[a-z][a-z0-9-]*$/) — derived
    //     from the file basename, which is "untitled" or "untitled-N"
    //     (both kebab-case)
    //   - editor.nodes[].id: `step:<alias>` (NOT `step-<index>`)
    //   - editor.nodes[].x/y: flat at the node level (NOT nested)
    //   - editor.yamlComments: {} (NOT preservedComments — the field
    //     was renamed in the schema)
    const stepAlias = "intro";
    const scaffold = {
      vmFormatVersion: 1,
      contract: {
        version: 1,
        name: candidate.replace(/^.*\//, "").replace(/\.contract$/, ""),
        description:
          "New contract — describe what this contract does in one sentence.",
        assembly: [
          {
            as: stepAlias,
            verb: "literal",
            value: "Hello from your new contract.",
          },
        ],
      },
      editor: {
        nodes: [{ id: `step:${stepAlias}`, x: 0, y: 0 }],
        selection: null,
        viewport: { x: 0, y: 0, zoom: 1 },
        yamlComments: {},
      },
    };

    const text = JSON.stringify(scaffold, null, 2) + "\n";
    await this.app.vault.create(candidate, text);
    // Same openLinkText idiom as openContract() — see comment there.
    try {
      await this.app.workspace.openLinkText(candidate, "", false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`vault-memory: created ${candidate} but failed to open — ${msg}`, 5000);
      return;
    }
    new Notice(`Created ${candidate}`, 3000);
  }
}
