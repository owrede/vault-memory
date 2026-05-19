/**
 * Tests for the ChromeView side-panel host.
 *
 * Phase 7 / 07-09 / PLG-03 + PLG-04. ChromeView is an `ItemView` that
 * bundles the Reindex + Stats panels under a single workspace leaf. The
 * tests verify the static surface (view type, display text, icon, panel
 * composition wiring) without mounting Svelte — DOM-light unit tests.
 */

import { describe, expect, it, vi } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import {
  ChromeView,
  VIEW_TYPE_CHROME,
  composeChromePanels,
  type ChromeViewPlugin,
} from "./chrome-view.js";

function makeFakePlugin(activeVault: string | null = "MyVault"): ChromeViewPlugin {
  return {
    mcpClient: {
      callTool: vi.fn(async () => ({ ok: true, vaults: [] })) as unknown as ChromeViewPlugin["mcpClient"]["callTool"],
      onProgress: vi.fn(() => () => {}) as unknown as ChromeViewPlugin["mcpClient"]["onProgress"],
    },
    settingsStore: {
      get: vi.fn((key: string) => {
        if (key === "defaultVault") return activeVault;
        return null;
      }) as unknown as ChromeViewPlugin["settingsStore"]["get"],
    },
  };
}

describe("ChromeView — metadata + mounting surface", () => {
  it("exports the VIEW_TYPE_CHROME constant 'vault-memory-chrome'", () => {
    expect(VIEW_TYPE_CHROME).toBe("vault-memory-chrome");
  });

  it("getViewType() returns the VIEW_TYPE_CHROME constant", () => {
    const leaf = new WorkspaceLeaf();
    const view = new ChromeView(leaf, makeFakePlugin());
    expect(view.getViewType()).toBe(VIEW_TYPE_CHROME);
  });

  it("getDisplayText() returns the human-readable label 'vault-memory'", () => {
    const leaf = new WorkspaceLeaf();
    const view = new ChromeView(leaf, makeFakePlugin());
    expect(view.getDisplayText()).toBe("vault-memory");
  });

  it("getIcon() returns 'activity' (Lucide icon name)", () => {
    const leaf = new WorkspaceLeaf();
    const view = new ChromeView(leaf, makeFakePlugin());
    expect(view.getIcon()).toBe("activity");
  });

  it("composeChromePanels() returns a spec listing reindex-panel and stats-panel slots in order", () => {
    const plugin = makeFakePlugin("MyVault");
    const spec = composeChromePanels(plugin);
    expect(spec.panels).toHaveLength(2);
    expect(spec.panels[0]?.kind).toBe("reindex");
    expect(spec.panels[1]?.kind).toBe("stats");
    // Both panels receive the plugin's mcpClient + the resolved active vault.
    expect(spec.panels[0]?.props.mcpClient).toBe(plugin.mcpClient);
    expect(spec.panels[0]?.props.activeVault).toBe("MyVault");
    expect(spec.panels[1]?.props.mcpClient).toBe(plugin.mcpClient);
    expect(spec.panels[1]?.props.activeVault).toBe("MyVault");
  });

  it("composeChromePanels() passes activeVault=null when settingsStore.defaultVault is null", () => {
    const plugin = makeFakePlugin(null);
    const spec = composeChromePanels(plugin);
    expect(spec.panels[0]?.props.activeVault).toBeNull();
    expect(spec.panels[1]?.props.activeVault).toBeNull();
  });
});
