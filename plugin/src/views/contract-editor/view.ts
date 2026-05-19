/**
 * ContractEditorView — Obsidian `TextFileView` host for the `.contract`
 * visual editor.
 *
 * Phase 7 / ADR-007 / D-FORMAT-SCHEMA + D-AUTH.
 *
 * On file open, Obsidian calls `setViewData(jsonText, clear)` with the raw
 * file contents. We `JSON.parse` into a `ContractFile` envelope and mount the
 * Svelte spike component (`canvas-pane.svelte`) which renders the assembly
 * DAG via `@xyflow/svelte`. On save, Obsidian calls `getViewData()` and we
 * round-trip back to JSON.
 *
 * Plan 07-01 lands the minimum spike — no inspector forms, no save lifecycle
 * beyond `requestSave()`. Plan 07-02 (codec) extends this with `.contract`
 * ↔ `.yaml` round-trip; plan 07-03 (inspector) adds the typed forms.
 *
 * Adapter-seam discipline: no Node `fs`. All vault writes flow through
 * `this.app.vault.adapter.write(...)` (Obsidian's own fs adapter).
 */

import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount, type SvelteComponent } from "svelte";
import CanvasPane from "./spike/canvas-pane.svelte";

export const VIEW_TYPE_CONTRACT = "vault-memory-contract-editor";

/**
 * The `.contract` envelope shape per ADR-007 D-FORMAT-SCHEMA. The richer
 * Zod-validated `ContractDocumentSchema` is finalized in plan 07-02 alongside
 * the codec; this interface is the spike's minimum surface.
 */
export interface ContractFile {
  $schema?: string;
  vmFormatVersion: 1;
  contract: {
    version: 1;
    name: string;
    description?: string;
    inputs?: Record<string, unknown>;
    required?: readonly string[];
    sources?: Record<string, unknown>;
    sinks?: Record<string, unknown>;
    assembly: ReadonlyArray<{
      as: string;
      verb: string;
      args?: Record<string, unknown>;
      value?: unknown;
    }>;
    output_shape?: unknown;
    write_back?: Record<string, unknown>;
  };
  editor: {
    nodes: ReadonlyArray<{ id: string; x: number; y: number }>;
    selection: string | readonly string[] | null;
    viewport: { x: number; y: number; zoom: number };
    yamlComments: Record<string, unknown>;
  };
}

export class ContractEditorView extends TextFileView {
  private currentJson: ContractFile | null = null;
  private svelteApp: SvelteComponent | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_CONTRACT;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Contract";
  }

  override getIcon(): string {
    return "git-branch";
  }

  /**
   * Called by Obsidian when the file is loaded or reloaded. The `data`
   * parameter is the raw `.contract` file text. We parse and mount the
   * Svelte spike component.
   */
  override setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.clear();
    }

    let parsed: ContractFile;
    try {
      parsed = JSON.parse(data) as ContractFile;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.contentEl.empty();
      const banner = this.contentEl.createDiv({ cls: "vm-error-banner" });
      banner.setText(`Error: malformed .contract file — ${message}`);
      return;
    }

    this.currentJson = parsed;
    this.renderCanvas();
  }

  /**
   * Called by Obsidian when it needs to persist the file (Cmd-S or the
   * autosave cycle). We serialize the current envelope back to JSON.
   */
  override getViewData(): string {
    if (!this.currentJson) return "";
    return JSON.stringify(this.currentJson, null, 2);
  }

  override clear(): void {
    this.currentJson = null;
    if (this.svelteApp) {
      void unmount(this.svelteApp);
      this.svelteApp = null;
    }
    this.contentEl.empty();
  }

  private renderCanvas(): void {
    if (!this.currentJson) return;

    // Unmount any previous Svelte root before mounting the new one. Obsidian
    // can call setViewData multiple times for the same view instance.
    if (this.svelteApp) {
      void unmount(this.svelteApp);
      this.svelteApp = null;
    }
    this.contentEl.empty();

    const host = this.contentEl.createDiv({ cls: "vm-contract-editor" });
    this.svelteApp = mount(CanvasPane, {
      target: host,
      props: {
        file: this.currentJson,
        onChange: (next: ContractFile) => {
          this.currentJson = next;
          this.requestSave();
        },
      },
    }) as unknown as SvelteComponent;
  }
}
