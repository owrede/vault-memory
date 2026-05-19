/**
 * SettingsStore unit tests — Phase 7 / PLG-01 / D-CHROME-SETTINGS.
 *
 * Covers the five behaviors specified in 07-03-PLAN.md Task 1:
 *   (a) load returns defaults when storage is empty
 *   (b) partial saved data merges with defaults on load
 *   (c) set + save round-trips through a fresh load on a new Plugin instance
 *       (simulates an Obsidian restart)
 *   (d) isRestartRequired("ollamaUrl") === true
 *   (e) isRestartRequired("rerankerEnabled") === false
 *
 * The obsidian mock (plugin/tests/mocks/obsidian.ts) holds plugin data on
 * the instance; constructing a new `Plugin()` simulates a clean reload.
 */

import { describe, it, expect } from "vitest";
import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, SettingsStore } from "./settings-store.js";

describe("SettingsStore", () => {
  it("(a) load returns defaults when storage is empty", async () => {
    const plugin = new Plugin();
    const store = new SettingsStore(plugin);
    await store.load();
    expect(store.get("ollamaUrl")).toBe(DEFAULT_SETTINGS.ollamaUrl);
    expect(store.get("embeddingModel")).toBe(DEFAULT_SETTINGS.embeddingModel);
    expect(store.get("rerankerEnabled")).toBe(DEFAULT_SETTINGS.rerankerEnabled);
    expect(store.get("defaultVault")).toBe(DEFAULT_SETTINGS.defaultVault);
    expect(store.get("indexerBatchSize")).toBe(DEFAULT_SETTINGS.indexerBatchSize);
    expect(store.get("ftsTokenizer")).toBe(DEFAULT_SETTINGS.ftsTokenizer);
    expect(store.get("serverCommand")).toBe(DEFAULT_SETTINGS.serverCommand);
    expect(store.get("serverArgs")).toEqual(DEFAULT_SETTINGS.serverArgs);
  });

  it("(b) partial saved data merges with defaults on load", async () => {
    const plugin = new Plugin();
    // Simulate a previous-version data.json that only set a subset of keys.
    await plugin.saveData({ ollamaUrl: "http://127.0.0.1:9999" });
    const store = new SettingsStore(plugin);
    await store.load();
    expect(store.get("ollamaUrl")).toBe("http://127.0.0.1:9999");
    // Untouched keys fall back to defaults.
    expect(store.get("embeddingModel")).toBe(DEFAULT_SETTINGS.embeddingModel);
    expect(store.get("rerankerEnabled")).toBe(DEFAULT_SETTINGS.rerankerEnabled);
    expect(store.get("indexerBatchSize")).toBe(DEFAULT_SETTINGS.indexerBatchSize);
  });

  it("(c) set + save round-trips through a fresh load on a new instance", async () => {
    const plugin = new Plugin();
    const store = new SettingsStore(plugin);
    await store.load();
    await store.set("rerankerEnabled", true);
    await store.set("indexerBatchSize", 64);
    await store.set("defaultVault", "notes");

    // Simulate an Obsidian restart: keep the plugin (its instance-level
    // __pluginData survives), but construct a fresh SettingsStore.
    const store2 = new SettingsStore(plugin);
    await store2.load();
    expect(store2.get("rerankerEnabled")).toBe(true);
    expect(store2.get("indexerBatchSize")).toBe(64);
    expect(store2.get("defaultVault")).toBe("notes");
    // Untouched keys still default.
    expect(store2.get("ollamaUrl")).toBe(DEFAULT_SETTINGS.ollamaUrl);
  });

  it('(d) isRestartRequired("ollamaUrl") === true', () => {
    const plugin = new Plugin();
    const store = new SettingsStore(plugin);
    expect(store.isRestartRequired("ollamaUrl")).toBe(true);
    expect(store.isRestartRequired("embeddingModel")).toBe(true);
    expect(store.isRestartRequired("ftsTokenizer")).toBe(true);
    expect(store.isRestartRequired("serverCommand")).toBe(true);
    expect(store.isRestartRequired("serverArgs")).toBe(true);
  });

  it('(e) isRestartRequired("rerankerEnabled") === false', () => {
    const plugin = new Plugin();
    const store = new SettingsStore(plugin);
    expect(store.isRestartRequired("rerankerEnabled")).toBe(false);
    expect(store.isRestartRequired("defaultVault")).toBe(false);
    expect(store.isRestartRequired("indexerBatchSize")).toBe(false);
  });
});
