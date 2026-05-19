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

import { Notice, Plugin } from "obsidian";
import {
  ContractEditorView,
  VIEW_TYPE_CONTRACT,
} from "./src/views/contract-editor/view.js";
import {
  CliNotFoundError,
  VaultMemoryMcpClient,
} from "./src/services/mcp-client.js";
import { SettingsStore } from "./src/services/settings-store.js";
import { VaultMemorySettingsTab } from "./src/chrome/settings-tab.js";

export default class VaultMemoryPlugin extends Plugin {
  // Public fields so chrome plans (07-08..07-10), the editor view
  // (07-05), and the watcher plan (07-07) can reach services through
  // `this.plugin.<field>` after they receive the plugin instance via
  // the view constructor / settings-tab constructor.
  settingsStore!: SettingsStore;
  mcpClient!: VaultMemoryMcpClient;

  /** True when boot-time `mcpClient.connect()` failed with ENOENT. */
  cliMissing = false;
  /** Human-readable diagnostic for the missing-CLI banner. */
  cliMissingMessage: string | null = null;

  override async onload(): Promise<void> {
    // (1) Settings — must be first so step (2) can read serverCommand.
    this.settingsStore = new SettingsStore(this);
    await this.settingsStore.load();

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

    // (5) Bind .contract extension to the view.
    this.registerExtensions(["contract"], VIEW_TYPE_CONTRACT);

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
  }

  override async onunload(): Promise<void> {
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
}
