/**
 * vault-memory Obsidian plugin — entry point.
 *
 * Phase 7 / ADR-007 / D-SURFACE.
 *
 * Registers a custom view type bound to the `.contract` extension. Opening a
 * `.contract` file in Obsidian launches the visual contract editor
 * automatically (`registerView` + `registerExtensions(["contract"])`).
 *
 * Adapter-seam discipline: no Node `fs` against vault paths. All vault writes
 * go through `app.vault.adapter.write(...)`. The plugin's `app.vault.adapter`
 * IS the Obsidian-fs seam per ADR-002.
 */

import { Plugin } from "obsidian";
import {
  ContractEditorView,
  VIEW_TYPE_CONTRACT,
} from "./src/views/contract-editor/view.js";

export default class VaultMemoryPlugin extends Plugin {
  override async onload(): Promise<void> {
    // Register the custom view type that backs `.contract` files.
    this.registerView(
      VIEW_TYPE_CONTRACT,
      (leaf) => new ContractEditorView(leaf),
    );

    // Bind the `.contract` file extension to that view type. Opening any
    // `.contract` file in Obsidian will now launch the editor automatically.
    this.registerExtensions(["contract"], VIEW_TYPE_CONTRACT);
  }

  override async onunload(): Promise<void> {
    // Obsidian auto-unregisters views registered via `registerView` on
    // plugin unload — no manual cleanup required here.
  }
}
