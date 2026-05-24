/**
 * ContractEditorView — Obsidian `TextFileView` host for the `.contract`
 * visual editor.
 *
 * Phase 7 / Plan 07-05 / ADR-007 / D-FORMAT-SCHEMA + D-AUTH.
 *
 * # Lifecycle
 *
 *   setViewData(jsonText, clear):
 *     1. Parse `jsonText` as JSON.
 *     2. Validate via `ContractDocumentSchema.parse(...)` — on failure,
 *        render an error pane carrying the Zod error path. Do NOT mount
 *        the editor (threat T-07-05-01 mitigation).
 *     3. On success, mount `editor.svelte` with `file: parsed` and
 *        `onChange: this.onUserEdit.bind(this)`.
 *
 *   getViewData(): JSON.stringify(this.currentJson, null, 2).
 *
 *   onUserEdit(next):
 *     - Updates `this.currentJson = next`.
 *     - Calls `this.requestSave()` so Obsidian round-trips through
 *       `getViewData()` on the next tick.
 *     - Schedules a debounced (200ms) YAML companion emission via
 *       `emitYamlCompanion(next)`; rapid edits coalesce into one write.
 *
 *   emitYamlCompanion(file):
 *     - Computes `yamlBody = emitYaml(file)` via the 07-02 codec.
 *     - Resolves the companion path as
 *       `_contracts/<file.contract.name>.yaml`.
 *     - Writes via `app.vault.adapter.write(...)` — the only FS
 *       chokepoint per adapter-seam discipline.
 *     - The Phase 6 ContractRegistry watcher will fire on this write;
 *       the SuppressionSet wiring that kills the echo loop lands in
 *       plan 07-07 (CAN-08). For Plan 07-05 the write-loop noise is
 *       acceptable because the inner ChangeFeed re-parse is idempotent.
 *
 *   clear():
 *     - Unmounts the Svelte root and clears any pending YAML timer.
 *
 * # Adapter-seam discipline
 *
 *   No Node `fs`. All vault writes route through
 *   `this.app.vault.adapter.write(...)` (Obsidian's own fs adapter).
 *   The contract codec (`plugin/src/codec/`) is the only place
 *   YAML-specific code lives.
 */

import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount, type SvelteComponent } from "svelte";
import Editor from "./editor.svelte";
import {
  ContractDocumentSchema,
  type ContractDocumentShape,
} from "../../shared-types.js";
import { emitYaml, parseYaml } from "../../codec/contract-codec.js";
import type VaultMemoryPlugin from "../../../main.js";

export const VIEW_TYPE_CONTRACT = "vault-memory-contract-editor";

/** Public alias for callers that still reference the old surface name. */
export type ContractFile = ContractDocumentShape;

/** Debounce window for `.yaml` companion emission, in ms. */
const YAML_EMIT_DEBOUNCE_MS = 200;

/**
 * SHA-256 the input string and return its lowercase hex digest. Uses
 * `crypto.subtle` (available in Electron renderer / Obsidian context);
 * no Node `crypto` dependency. Used by the CAN-08 echo-suppression
 * handshake before each `.yaml` companion write.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export class ContractEditorView extends TextFileView {
  private currentJson: ContractDocumentShape | null = null;
  private svelteApp: SvelteComponent | null = null;
  private yamlTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The owning plugin instance, exposed publicly so subsequent plans
   * (07-07 watcher, 07-08 chrome) can reach `this.plugin.mcpClient` and
   * `this.plugin.settingsStore` without a workspace walk.
   */
  readonly plugin: VaultMemoryPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: VaultMemoryPlugin) {
    super(leaf);
    this.plugin = plugin;
    // Tag containerEl so styles.css can hide the markdown DOM that
    // TextFileView inflates by default (CodeMirror, inline title,
    // status footer with the "N Wörter · M Zeichen" line).
    this.containerEl.addClass("vm-contract-view");
  }

  override getViewType(): string {
    return VIEW_TYPE_CONTRACT;
  }

  /**
   * Override Obsidian's `onLoadFile` so that any error in our file-load
   * path produces a visible banner instead of bubbling up as Obsidian's
   * native '"" konnte nicht geöffnet werden' notice. The super-call
   * (super.onLoadFile) is the one that reads the file's bytes from
   * disk and invokes setViewData(); wrapping it lets us catch FS-level
   * errors (e.g. file vanished between vault index and click) too.
   *
   * If anything throws, write a diagnostic line to the developer
   * console (Cmd-Opt-I in Obsidian) AND render an in-view error
   * banner. The view itself stays mounted, so Obsidian doesn't think
   * the open failed.
   */
  override async onLoadFile(file: Parameters<TextFileView["onLoadFile"]>[0]): Promise<void> {
    try {
      await super.onLoadFile(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- diagnostic; this path is
      // exactly the one the user reported, so leaving the log in until
      // we have telemetry-grade observability.
      console.error(
        "[vault-memory] onLoadFile threw — this is the path that " +
          "produces Obsidian's empty-name notice. Stack:",
        err,
      );
      try {
        this.renderError(
          `Couldn't open this contract: ${message}. Try closing and reopening the file, or check the developer console (Cmd+Opt+I) for details.`,
          /*offerRepair=*/ false,
        );
      } catch {
        // Last-ditch — don't re-throw or Obsidian's view-mount layer
        // will emit the empty-name notice that started this saga.
      }
    }
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Contract";
  }

  override getIcon(): string {
    return "git-branch";
  }

  /**
   * Called by Obsidian when the file is loaded or reloaded. Parses +
   * validates via `ContractDocumentSchema` and mounts the editor; on
   * any failure, renders a visible error pane and aborts the mount
   * (threat T-07-05-01: tampered `.contract` never reaches the canvas).
   */
  override setViewData(data: string, clear: boolean): void {
    // Wrap the entire body so that any thrown exception is converted
    // to a visible error pane instead of bubbling up to Obsidian's
    // view-mount path, which emits '"" konnte nicht geöffnet werden'
    // when the mount throws before a view title is established. The
    // user's UX is "I clicked a contract and got an empty-name toast";
    // far better is "I clicked a contract and got a banner explaining
    // what's broken".
    try {
      if (clear) {
        this.clear();
      }

      // Empty file (zero bytes) is a common case — e.g., file created by a
      // tool other than this plugin, or an interrupted seed step. Render a
      // friendlier message with a one-click repair instead of the raw
      // "Unexpected end of JSON input" JSON-parser error.
      const trimmed = data.trim();
      if (trimmed.length === 0) {
        this.renderEmptyFile();
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.renderError(
          `This contract file looks corrupted — ${message}. You can replace it with a fresh blank contract below, or close this tab and edit the raw file by hand.`,
          /*offerRepair=*/ true,
        );
        return;
      }

      const result = ContractDocumentSchema.safeParse(raw);
      if (!result.success) {
        const issue = result.error.issues[0];
        const path = issue?.path.join(".") ?? "<root>";
        const msg = issue?.message ?? "the file's structure doesn't match what the editor expects";
        this.renderError(
          `This contract has a problem the editor can't fix automatically (in "${path}": ${msg}). You can replace it with a fresh blank contract below.`,
          /*offerRepair=*/ true,
        );
        return;
      }

      this.currentJson = result.data;
      this.renderEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Use a try/catch inside the catch because renderError itself
      // touches contentEl — if that's the source of the throw we
      // need to fail soft rather than recurse.
      try {
        this.renderError(
          `Something went wrong opening this contract: ${message}. Try reopening the file, or check the developer console (Cmd+Opt+I) for details.`,
          /*offerRepair=*/ false,
        );
      } catch {
        // Surface to the developer console at least. Don't re-throw —
        // Obsidian's view-mount handler interprets any throw as
        // "couldn't open file" and emits the empty-name notice.
        // eslint-disable-next-line no-console -- last-ditch diagnostic
        console.error("[vault-memory] setViewData crashed:", err);
      }
    }
  }

  /**
   * Called by Obsidian when it needs to persist the file. We serialize
   * the current envelope back to JSON; YAML emission is handled
   * separately by `emitYamlCompanion` so the `.contract` save and the
   * `.yaml` companion stay on independent code paths.
   */
  override getViewData(): string {
    // If we have a successfully-parsed envelope, serialize it back out.
    if (this.currentJson) {
      return JSON.stringify(this.currentJson, null, 2);
    }
    // No parsed state — typical when setViewData failed (malformed JSON,
    // schema mismatch, or empty file). Returning "" here would cause
    // Obsidian's TextFileView save path to OVERWRITE the file with an
    // empty string the next time the workspace decides to save (tab
    // switch, autosave timer, etc.) — silently destroying user content
    // and producing follow-on '"" konnte nicht geöffnet werden' notices
    // when other contracts try to open against the now-broken state.
    //
    // Safer: return the raw `data` field that TextFileView populates from
    // the file's actual on-disk bytes. That way a getViewData() on a
    // view that never successfully mounted just round-trips the existing
    // file content unchanged.
    return this.data ?? "";
  }

  override clear(): void {
    this.currentJson = null;
    if (this.svelteApp) {
      void unmount(this.svelteApp);
      this.svelteApp = null;
    }
    if (this.yamlTimer !== null) {
      clearTimeout(this.yamlTimer);
      this.yamlTimer = null;
    }
    this.contentEl.empty();
  }

  /**
   * Handler bound into the Svelte editor's `onChange`. Updates the
   * in-memory document, asks Obsidian to save the `.contract`, and
   * schedules a debounced `.yaml` companion emission.
   */
  private onUserEdit(next: ContractDocumentShape): void {
    this.currentJson = next;
    this.requestSave();
    this.scheduleYamlEmit(next);
  }

  private scheduleYamlEmit(file: ContractDocumentShape): void {
    if (this.yamlTimer !== null) {
      clearTimeout(this.yamlTimer);
    }
    this.yamlTimer = setTimeout(() => {
      this.yamlTimer = null;
      void this.emitYamlCompanion(file);
    }, YAML_EMIT_DEBOUNCE_MS);
  }

  /**
   * Emit the canonical Phase 6 YAML companion to
   * `_contracts/<name>.yaml`.
   *
   * # CAN-08 echo-suppression (Plan 07-07)
   *
   * Before writing, compute SHA-256 of the YAML body and call
   * `suppress_contract_write` so the Phase 6 ContractRegistry
   * ChangeFeed handler can recognize the resulting filesystem event
   * as our own write and drop it silently (hash equality check in
   * `SuppressionSet.consume(path, hash)`).
   *
   * Ordering is strict — suppression MUST be registered BEFORE the
   * write, otherwise the change-feed event may fire on a vault with
   * an empty suppression set and trigger a redundant reload + audit
   * row. We `await` the MCP `tools/call` round-trip so the entry is
   * guaranteed to exist before the write hits chokidar.
   *
   * Suppress-call failures are non-fatal: the plugin proceeds with
   * the write, accepting that the change-feed handler may then
   * re-validate the YAML (idempotent — same body, same registry).
   * The most common cause is `[plugin] enabled = false` on the
   * server side; we surface a one-shot Notice so the user knows the
   * echo loop guard is inactive (see `cliMissing` analog in main.ts).
   *
   * Errors are swallowed with a console warning — the next save cycle
   * retries; the editor remains usable even when the vault adapter
   * temporarily fails (e.g. mid-Syncthing-rename).
   */
  private async emitYamlCompanion(file: ContractDocumentShape): Promise<void> {
    try {
      const yamlBody = emitYaml(file);
      // Sanity self-check: parseYaml must successfully round-trip
      // emitYaml's output. Catching here surfaces codec drift before
      // it lands on disk.
      parseYaml(yamlBody);
      const yamlPath = `_contracts/${file.contract.name}.yaml`;

      // CAN-08 — register the hash-keyed suppression entry BEFORE the
      // write. SubtleCrypto is available in the Obsidian renderer
      // (Electron browser context); no Node `crypto` dependency.
      const hash = await sha256Hex(yamlBody);
      const mcp = this.plugin.mcpClient;
      if (mcp?.available) {
        try {
          await mcp.callTool("suppress_contract_write", {
            path: yamlPath,
            hash,
          });
        } catch (err) {
          // Server may have `[plugin] enabled = false` (suppress tool
          // not registered) or be transiently disconnected. Either way
          // we proceed with the write — the change-feed re-validate is
          // idempotent on the same body.
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            "[vault-memory] suppress_contract_write failed (proceeding with write):",
            message,
          );
        }
      }

      await this.app.vault.adapter.write(yamlPath, yamlBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Use console because Obsidian's Notice would spam on every
      // debounced retry — Plan 07-08 surfaces persistent errors via
      // the unsaved-changes UX.
      console.warn("[vault-memory] YAML companion emit failed:", message);
    }
  }

  private renderEditor(): void {
    if (!this.currentJson) return;

    if (this.svelteApp) {
      void unmount(this.svelteApp);
      this.svelteApp = null;
    }
    this.contentEl.empty();

    const host = this.contentEl.createDiv({ cls: "vm-contract-editor" });
    this.svelteApp = mount(Editor, {
      target: host,
      props: {
        file: this.currentJson,
        onChange: (next: ContractDocumentShape) => this.onUserEdit(next),
        mcpClient: this.plugin.mcpClient?.available ? this.plugin.mcpClient : null,
      },
    }) as unknown as SvelteComponent;
  }

  private renderError(message: string, offerRepair = false): void {
    if (this.svelteApp) {
      void unmount(this.svelteApp);
      this.svelteApp = null;
    }
    this.contentEl.empty();
    const banner = this.contentEl.createDiv({ cls: "vm-error-banner" });
    banner.setText(message);
    if (offerRepair) {
      this.contentEl.createDiv({
        cls: "vm-error-help",
        text:
          "Heads up: replacing the contract overwrites whatever is in this file. " +
          "If there's anything you want to keep, copy it somewhere safe first.",
      });
      const btnRow = this.contentEl.createDiv({ cls: "vm-error-actions" });
      const repair = btnRow.createEl("button", {
        text: "Start over with a blank contract",
        cls: "vm-error-repair-btn",
      });
      repair.addEventListener("click", () => {
        void this.writeScaffold();
      });
    }
  }

  /**
   * Rendered when the file is zero bytes / whitespace-only. Distinct
   * surface from renderError so the language can be inviting ("empty
   * file — start by writing a scaffold") rather than alarming.
   */
  private renderEmptyFile(): void {
    if (this.svelteApp) {
      void unmount(this.svelteApp);
      this.svelteApp = null;
    }
    this.contentEl.empty();
    const wrap = this.contentEl.createDiv({ cls: "vm-empty-contract" });
    wrap.createEl("h3", { text: "This contract is empty" });
    wrap.createEl("p", {
      text:
        "There's nothing in this contract yet. Click the button below to start with a sample step — you can edit or replace it on the canvas right away.",
    });
    const btn = wrap.createEl("button", {
      text: "Start with a sample step",
      cls: "vm-error-repair-btn",
    });
    btn.addEventListener("click", () => {
      void this.writeScaffold();
    });
  }

  /**
   * Write a minimal valid scaffold to the current file. Mirrors the
   * scaffold produced by main.ts createContract() so the look-and-feel
   * is identical regardless of how the file came to exist. After write,
   * Obsidian's TextFileView lifecycle re-invokes setViewData with the
   * new contents — the editor mounts as normal.
   */
  private async writeScaffold(): Promise<void> {
    const file = this.file;
    if (!file) return;
    // Coerce the basename into a kebab-case slug that satisfies
    // ContractFileSchema's `name` regex (/^[a-z][a-z0-9-]*$/). The
    // file's actual filename is preserved; only the in-document `name`
    // field is normalised. If we can't produce anything kebab-case from
    // the filename (e.g. all-symbols), fall back to "untitled".
    const slugifyContractName = (raw: string): string => {
      let s = raw
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!s || !/^[a-z]/.test(s)) s = "untitled";
      return s;
    };
    const contractName = slugifyContractName(file.basename);
    const stepAlias = "intro";
    // Scaffold mirrors createContract() in main.ts — see that comment
    // block for the schema-correctness notes (version: 1, snake_case
    // aliases, flat node positions, yamlComments key).
    const scaffold = {
      vmFormatVersion: 1,
      contract: {
        version: 1,
        name: contractName,
        description:
          "Describe what this contract does in one sentence.",
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
    await this.app.vault.modify(file, text);
    // Manually re-trigger setViewData so the editor mounts immediately
    // without waiting for the next focus event.
    this.setViewData(text, true);
  }
}
