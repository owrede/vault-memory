/**
 * VaultMemorySettingsTab tests — Phase 7 / 07-08 / PLG-01.
 *
 * Covers the five behaviors specified in 07-08-PLAN.md Task 2:
 *   (a) every settings key from DEFAULT_SETTINGS has a corresponding row
 *       with the expected `data-testid`
 *   (b) `ollamaUrl`'s description contains the restart-required marker
 *   (c) `rerankerEnabled`'s description does NOT contain "Restart required"
 *   (d) the "Advanced" `<details>` element exists and is closed by default
 *   (e) the missing-CLI banner renders when `plugin.cliMissing === true`
 *
 * Strategy: construct a fake plugin instance carrying a real SettingsStore +
 * cliMissing flag, instantiate the tab against a fresh FakeEl, call
 * `display()`, then introspect the resulting tree via `findByTestId`.
 *
 * The MCP client is stubbed so onChange's push path does not require a real
 * server. Notice / Setting / PluginSettingTab come from the mock obsidian
 * module via the vitest alias.
 */

import { describe, it, expect } from "vitest";
import { Plugin, App, FakeEl } from "obsidian";
import { DEFAULT_SETTINGS, SettingsStore } from "../services/settings-store.js";
import { VaultMemorySettingsTab } from "./settings-tab.js";

/**
 * Maps each settings key to the tab that renders its row. Keep in sync
 * with the renderXxxTab() methods in settings-tab.ts. Keys NOT in this
 * map are panel-managed (e.g. sourceEnabledTools → Sources panel).
 */
const KEY_TO_TAB: Record<string, "search" | "indexing" | "server"> = {
  ollamaUrl: "search",
  embeddingModel: "search",
  rerankerEnabled: "search",
  defaultVault: "search",
  indexerBatchSize: "indexing",
  ftsTokenizer: "indexing",
  serverCommand: "server",
  serverArgs: "server",
};

function clickTab(
  tab: VaultMemorySettingsTab,
  tabId: "search" | "indexing" | "sources" | "secrets" | "server" | "about",
): FakeEl {
  const root = tab.containerEl as unknown as FakeEl;
  const btn = root.findByTestId(`settings-tab-${tabId}`);
  expect(btn, `tab button settings-tab-${tabId} missing`).not.toBeNull();
  btn?.click();
  // The click handler re-runs display() which re-empties containerEl,
  // so reuse `tab.containerEl` for fresh queries.
  return tab.containerEl as unknown as FakeEl;
}

/** Build a minimal VaultMemoryPlugin-shaped object the tab can read. */
async function makePlugin(opts?: {
  cliMissing?: boolean;
}): Promise<Plugin & {
  settingsStore: SettingsStore;
  mcpClient: { callTool: (n: string, a: unknown) => Promise<unknown> };
  cliMissing: boolean;
  cliMissingMessage: string | null;
}> {
  const plugin = new Plugin() as Plugin & {
    settingsStore: SettingsStore;
    mcpClient: { callTool: (n: string, a: unknown) => Promise<unknown> };
    cliMissing: boolean;
    cliMissingMessage: string | null;
  };
  plugin.settingsStore = new SettingsStore(plugin);
  await plugin.settingsStore.load();
  plugin.mcpClient = {
    callTool: async () => ({}),
  };
  plugin.cliMissing = opts?.cliMissing ?? false;
  plugin.cliMissingMessage = opts?.cliMissing ? "test-missing" : null;
  return plugin;
}

describe("VaultMemorySettingsTab", () => {
  it("(a) every settings key from DEFAULT_SETTINGS has a row on its expected tab", async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();

    // Keys managed by panel mounts rather than single `new Setting()` rows.
    // They have their own panel hosts asserted in test (a.1).
    const PANEL_MANAGED_KEYS = new Set(["sourceEnabledTools"]);

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (PANEL_MANAGED_KEYS.has(key)) continue;
      const tabId = KEY_TO_TAB[key];
      expect(tabId, `key ${key} not mapped to a tab in KEY_TO_TAB`).toBeDefined();
      const root = clickTab(tab, tabId!);
      const row = root.findByTestId(`setting-${key}`);
      expect(row, `missing data-testid row for ${key} on tab ${tabId}`).not.toBeNull();
    }
  });

  it("(a.1) Sources panel host is mounted when the Sources tab is active", async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const root = clickTab(tab, "sources");
    const host = root.findByTestId("sources-panel-host");
    expect(host, "sources-panel-host missing on Sources tab").not.toBeNull();
  });

  it("(a.2) All six topic tabs are rendered in nav", async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const root = tab.containerEl as unknown as FakeEl;
    const nav = root.findByTestId("settings-tabs");
    expect(nav).not.toBeNull();
    for (const id of ["search", "indexing", "sources", "secrets", "server", "about"] as const) {
      expect(
        root.findByTestId(`settings-tab-${id}`),
        `missing tab button for ${id}`,
      ).not.toBeNull();
    }
  });

  it('(b) ollamaUrl description includes "Restart required to apply."', async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const root = clickTab(tab, "search");
    const row = root.findByTestId("setting-ollamaUrl");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-setting-desc") ?? "").toContain(
      "Restart required to apply.",
    );
  });

  it("(b.b) restart-required keys all carry the literal marker; hot-swap keys do not", async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const restart = ["ollamaUrl", "embeddingModel", "ftsTokenizer", "serverCommand", "serverArgs"] as const;
    for (const k of restart) {
      const root = clickTab(tab, KEY_TO_TAB[k]!);
      const row = root.findByTestId(`setting-${k}`);
      expect(row?.getAttribute("data-setting-desc") ?? "").toContain(
        "Restart required to apply.",
      );
    }
    const hotswap = ["rerankerEnabled", "defaultVault", "indexerBatchSize"] as const;
    for (const k of hotswap) {
      const root = clickTab(tab, KEY_TO_TAB[k]!);
      const row = root.findByTestId(`setting-${k}`);
      expect(row?.getAttribute("data-setting-desc") ?? "").not.toContain(
        "Restart required",
      );
    }
  });

  it('(c) rerankerEnabled description does NOT contain "Restart required"', async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const root = clickTab(tab, "search");
    const row = root.findByTestId("setting-rerankerEnabled");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-setting-desc") ?? "").not.toContain(
      "Restart required",
    );
  });

  it("(e) the missing-CLI banner renders when plugin.cliMissing === true", async () => {
    const plugin = await makePlugin({ cliMissing: true });
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const root = tab.containerEl as unknown as FakeEl;
    const banner = root.findAll((el) =>
      el.classes.has("vm-cli-missing-banner"),
    );
    expect(banner.length).toBe(1);
    // Banner copy is friendlier than the older "CLI not found" phrasing.
    expect(banner[0]?.textContent).toContain("vault-memory server isn't running");
  });

  it("(e.b) the missing-CLI banner is absent when cliMissing is false", async () => {
    const plugin = await makePlugin({ cliMissing: false });
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const root = tab.containerEl as unknown as FakeEl;
    const banner = root.findAll((el) =>
      el.classes.has("vm-cli-missing-banner"),
    );
    expect(banner.length).toBe(0);
  });
});
