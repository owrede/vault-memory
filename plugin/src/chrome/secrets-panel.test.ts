/**
 * Secrets panel tests — Phase 7 / 07-08 / PLG-02 / Task 3.
 *
 * Vitest doesn't compile `.svelte` files in this project (no svelte plugin
 * in vitest.config.ts), so we target the `SecretsPanelController` — the
 * headless logic layer the `.svelte` component delegates to. The mapping is
 * 1:1 with the plan's behavior list:
 *
 *   (a) renders the backend warning when backend is basic_text →
 *       `view.showBasicTextWarning === true`
 *   (b) renders the entries from `store.list()` → `view.entries`
 *   (c) "Add" with valid input calls `store.add(name, value)` once →
 *       `addSecret(name, value)` calls through and adds the entry exactly once
 *   (+) basic_text consent flow: `BasicTextBackendError` → `pendingConsent`,
 *       then `confirmBasicText()` retries with `allowBasicText: true`.
 */

import { describe, it, expect, vi } from "vitest";
import { Plugin } from "obsidian";
import {
  SafeStorageAdapter,
  type SafeStorageLike,
} from "../services/safe-storage.js";
import { SecretsStore } from "../services/secrets-store.js";
import { SecretsPanelController } from "./secrets-panel-controller.js";

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

async function makeWiring(backend: string = "keychain") {
  const plugin = new Plugin();
  const adapter = new SafeStorageAdapter(makeMockStorage(backend));
  const store = new SecretsStore(plugin, adapter);
  await store.load();
  return {
    plugin,
    adapter,
    store,
    controller: new SecretsPanelController({ store, safeStorage: adapter }),
  };
}

describe("SecretsPanelController", () => {
  it("(a) surfaces the backend warning when backend is basic_text", async () => {
    const { controller } = await makeWiring("basic_text");
    const view = controller.snapshot();
    expect(view.backend).toBe("basic_text");
    expect(view.showBasicTextWarning).toBe(true);
  });

  it("(a.b) does NOT surface the warning on encrypted backends", async () => {
    const { controller } = await makeWiring("keychain");
    const view = controller.snapshot();
    expect(view.backend).toBe("encrypted");
    expect(view.showBasicTextWarning).toBe(false);
  });

  it("(b) renders entries from store.list() (name + createdAt only)", async () => {
    const { store, controller } = await makeWiring();
    await store.add("openai", "sk-1");
    await store.add("github", "ghp-2");

    const view = controller.snapshot();
    expect(view.entries.map((e) => e.name).sort()).toEqual(["github", "openai"]);
    // Ciphertext MUST NOT be exposed.
    for (const entry of view.entries) {
      expect(entry).not.toHaveProperty("ciphertext");
    }
  });

  it("(c) addSecret with valid input calls store.add once and refreshes the view", async () => {
    const { store, controller } = await makeWiring();
    const spy = vi.spyOn(store, "add");

    const captured: number[] = [];
    controller.subscribe((v) => captured.push(v.entries.length));

    await controller.addSecret("openai", "sk-1");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("openai", "sk-1");
    expect(controller.snapshot().entries.map((e) => e.name)).toEqual(["openai"]);
    // The listener saw the post-add view (entries.length === 1).
    expect(captured.at(-1)).toBe(1);
  });

  it("(d) basic_text consent flow: surfaces pendingConsent, retries on confirm", async () => {
    const { store, controller } = await makeWiring("basic_text");
    const addSpy = vi.spyOn(store, "add");

    // First attempt — store.add throws BasicTextBackendError because the
    // SafeStorageAdapter refuses to encrypt without explicit consent.
    await controller.addSecret("openai", "sk-1");
    const afterFirst = controller.snapshot();
    expect(afterFirst.pendingConsent).toEqual({ name: "openai" });
    expect(afterFirst.entries).toHaveLength(0);
    expect(addSpy).toHaveBeenCalledTimes(1);

    // User accepts consent → controller retries with allowBasicText: true.
    await controller.confirmBasicText();
    const afterConfirm = controller.snapshot();
    expect(afterConfirm.pendingConsent).toBeNull();
    expect(afterConfirm.entries.map((e) => e.name)).toEqual(["openai"]);
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenLastCalledWith("openai", "sk-1", {
      allowBasicText: true,
    });
  });

  it("(e) cancelBasicText clears the pending plaintext without adding", async () => {
    const { store, controller } = await makeWiring("basic_text");
    const addSpy = vi.spyOn(store, "add");
    await controller.addSecret("openai", "sk-1");
    expect(controller.snapshot().pendingConsent).not.toBeNull();

    controller.cancelBasicText();
    expect(controller.snapshot().pendingConsent).toBeNull();
    expect(controller.snapshot().entries).toHaveLength(0);
    expect(addSpy).toHaveBeenCalledTimes(1); // initial attempt only
  });

  it("(f) deleteSecret removes the entry and notifies subscribers", async () => {
    const { store, controller } = await makeWiring();
    await store.add("openai", "sk-1");
    await store.add("github", "ghp-2");
    let observed: readonly { name: string }[] = [];
    controller.subscribe((v) => {
      observed = v.entries;
    });
    await controller.deleteSecret("openai");
    expect(observed.map((e) => e.name)).toEqual(["github"]);
  });

  it("(g) invalid name surfaces lastError without throwing", async () => {
    const { controller } = await makeWiring();
    await controller.addSecret("Has Spaces", "v");
    const view = controller.snapshot();
    expect(view.lastError).toMatch(/Invalid/);
    expect(view.entries).toHaveLength(0);
  });
});
