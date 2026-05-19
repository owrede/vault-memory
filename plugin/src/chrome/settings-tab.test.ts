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
  it("(a) every settings key from DEFAULT_SETTINGS has a corresponding data-testid row", async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();

    const root = tab.containerEl as unknown as FakeEl;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const row = root.findByTestId(`setting-${key}`);
      expect(row, `missing data-testid row for ${key}`).not.toBeNull();
    }
  });

  it('(b) ollamaUrl description includes "Restart required to apply."', async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const row = (tab.containerEl as unknown as FakeEl).findByTestId(
      "setting-ollamaUrl",
    );
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
    const root = tab.containerEl as unknown as FakeEl;
    const restart = ["ollamaUrl", "embeddingModel", "ftsTokenizer", "serverCommand", "serverArgs"] as const;
    for (const k of restart) {
      const row = root.findByTestId(`setting-${k}`);
      expect(row?.getAttribute("data-setting-desc") ?? "").toContain(
        "Restart required to apply.",
      );
    }
    const hotswap = ["rerankerEnabled", "defaultVault", "indexerBatchSize"] as const;
    for (const k of hotswap) {
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
    const row = (tab.containerEl as unknown as FakeEl).findByTestId(
      "setting-rerankerEnabled",
    );
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-setting-desc") ?? "").not.toContain(
      "Restart required",
    );
  });

  it("(d) the Advanced section exists and is closed by default", async () => {
    const plugin = await makePlugin();
    const tab = new VaultMemorySettingsTab(
      new App(),
      plugin as unknown as Parameters<typeof VaultMemorySettingsTab.prototype.constructor>[1],
    );
    tab.display();
    const root = tab.containerEl as unknown as FakeEl;
    const advanced = root.findByTestId("advanced-section");
    expect(advanced).not.toBeNull();
    // No `open` attribute set → closed by default per <details> semantics.
    expect(advanced?.getAttribute("open")).toBeNull();
    // The summary child should be present.
    const summaries = advanced?.findAll(
      (el) => el.tagName === "SUMMARY",
    );
    expect(summaries?.length).toBeGreaterThan(0);
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
    expect(banner[0]?.textContent).toContain("vault-memory CLI not found");
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
