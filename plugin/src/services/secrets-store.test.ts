/**
 * SecretsStore unit tests — Phase 7 / 07-08 / PLG-02.
 *
 * Covers the five behaviors specified in 07-08-PLAN.md Task 1:
 *   (a) `add` then `list` reveals name + createdAt only (never ciphertext)
 *   (b) `add` with a duplicate name rejects
 *   (c) `getCiphertext` returns ciphertext for an added secret, undefined
 *       for a missing name
 *   (d) `delete` removes the entry
 *   (e) round-trip via `load` on a fresh SecretsStore instance against the
 *       same Plugin mock (simulates an Obsidian restart)
 *
 * Tests use the existing `Plugin` mock (instance-level `__pluginData`) plus
 * an in-memory `SafeStorageLike` mock — no Electron / real filesystem.
 */

import { describe, it, expect } from "vitest";
import { Plugin } from "obsidian";
import {
  SafeStorageAdapter,
  type SafeStorageLike,
} from "./safe-storage.js";
import { SecretsStore } from "./secrets-store.js";

function makeMockStorage(backend: string = "keychain"): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`enc:${plaintext}`, "utf8"),
    decryptString: (ciphertext: Buffer) => {
      const raw = ciphertext.toString("utf8");
      if (!raw.startsWith("enc:")) throw new Error("bad ciphertext");
      return raw.slice(4);
    },
    getSelectedStorageBackend: () => backend,
  };
}

describe("SecretsStore", () => {
  it("(a) add then list reveals name + createdAt only", async () => {
    const plugin = new Plugin();
    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store = new SecretsStore(plugin, adapter);
    await store.load();

    await store.add("openai", "sk-test-12345");
    const list = store.list();
    expect(list).toHaveLength(1);
    const entry = list[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.name).toBe("openai");
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The summary projection MUST NOT include ciphertext.
    expect(entry).not.toHaveProperty("ciphertext");
  });

  it("(a.b) add NEVER persists plaintext in data.json", async () => {
    const plugin = new Plugin();
    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store = new SecretsStore(plugin, adapter);
    await store.load();
    await store.add("openai", "PLAINTEXT-CANARY-VALUE");

    const persisted = JSON.stringify(await plugin.loadData());
    expect(persisted).not.toContain("PLAINTEXT-CANARY-VALUE");
    // But ciphertext IS present.
    expect(persisted).toContain("ZW5jOlBMQUlOVEVYVC1DQU5BUlktVkFMVUU=");
  });

  it("(b) add with a duplicate name rejects", async () => {
    const plugin = new Plugin();
    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store = new SecretsStore(plugin, adapter);
    await store.load();
    await store.add("openai", "v1");
    await expect(store.add("openai", "v2")).rejects.toThrow(/already exists/);
    expect(store.list()).toHaveLength(1);
  });

  it("(b.b) add rejects invalid names", async () => {
    const plugin = new Plugin();
    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store = new SecretsStore(plugin, adapter);
    await store.load();
    await expect(store.add("Has Spaces", "v")).rejects.toThrow(/Invalid/);
    await expect(store.add("UPPER", "v")).rejects.toThrow(/Invalid/);
    await expect(store.add("a", "v")).rejects.toThrow(/Invalid/); // too short
    await expect(store.add("-leading", "v")).rejects.toThrow(/Invalid/);
  });

  it("(c) getCiphertext returns ciphertext for added secret, undefined for missing", async () => {
    const plugin = new Plugin();
    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store = new SecretsStore(plugin, adapter);
    await store.load();
    await store.add("openai", "sk-12345");

    const ct = store.getCiphertext("openai");
    expect(typeof ct).toBe("string");
    expect(ct).toMatch(/^[A-Za-z0-9+/=]+$/); // base64
    // Round-trip through the adapter to prove it decrypts.
    expect(ct).toBeDefined();
    if (ct) expect(adapter.decrypt(ct)).toBe("sk-12345");

    expect(store.getCiphertext("nope")).toBeUndefined();
  });

  it("(d) delete removes the entry", async () => {
    const plugin = new Plugin();
    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store = new SecretsStore(plugin, adapter);
    await store.load();
    await store.add("alpha", "1");
    await store.add("beta", "2");
    expect(store.list()).toHaveLength(2);

    await store.delete("alpha");
    expect(store.list().map((s) => s.name)).toEqual(["beta"]);
    expect(store.getCiphertext("alpha")).toBeUndefined();
  });

  it("(e) round-trip via load on a fresh SecretsStore (simulates Obsidian restart)", async () => {
    const plugin = new Plugin();
    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store1 = new SecretsStore(plugin, adapter);
    await store1.load();
    await store1.add("openai", "sk-12345");
    await store1.add("github", "ghp_token");

    // Fresh SecretsStore against the same plugin instance — its
    // __pluginData survives, mirroring an Obsidian restart.
    const store2 = new SecretsStore(plugin, adapter);
    await store2.load();
    const list = store2.list();
    expect(list.map((s) => s.name).sort()).toEqual(["github", "openai"]);
    const openaiCt = store2.getCiphertext("openai");
    expect(openaiCt).toBeDefined();
    if (openaiCt) expect(adapter.decrypt(openaiCt)).toBe("sk-12345");
  });

  it("(f) save preserves the sibling `settings` sub-key", async () => {
    const plugin = new Plugin();
    // Simulate SettingsStore having already written to data.json.
    await plugin.saveData({ settings: { ollamaUrl: "http://example/" } });

    const adapter = new SafeStorageAdapter(makeMockStorage());
    const store = new SecretsStore(plugin, adapter);
    await store.load();
    await store.add("openai", "sk-12345");

    const persisted = (await plugin.loadData()) as {
      settings?: { ollamaUrl?: string };
      secrets?: unknown[];
    };
    expect(persisted.settings?.ollamaUrl).toBe("http://example/");
    expect(persisted.secrets).toHaveLength(1);
  });
});
