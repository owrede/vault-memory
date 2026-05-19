/**
 * SafeStorageAdapter unit tests — Phase 7 / 07-08 / PLG-02 / D-CHROME-SECRETS.
 *
 * Covers the five behaviors specified in 07-08-PLAN.md Task 1:
 *   (a) `isAvailable()` true with a mock safeStorage
 *   (b) `encrypt` round-trips through `decrypt`
 *   (c) `BasicTextBackendError` thrown when backend is `basic_text` and
 *       `allowBasicText` is not set
 *   (d) `allowBasicText: true` bypasses the throw
 *   (e) `getBackend()` collapses non-`basic_text` values to `"encrypted"`
 *
 * Tests inject an in-memory mock — no real Electron import required.
 */

import { describe, it, expect } from "vitest";
import {
  BasicTextBackendError,
  DecryptFailedError,
  SafeStorageAdapter,
  type SafeStorageLike,
} from "./safe-storage.js";

/** Minimal in-memory mock — XOR-with-constant masquerades as encryption. */
function makeMockStorage(backend: string): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`enc:${plaintext}`, "utf8"),
    decryptString: (ciphertext: Buffer) => {
      const raw = ciphertext.toString("utf8");
      if (!raw.startsWith("enc:")) {
        throw new Error("bad ciphertext");
      }
      return raw.slice(4);
    },
    getSelectedStorageBackend: () => backend,
  };
}

describe("SafeStorageAdapter", () => {
  it("(a) isAvailable returns true with a mock storage that reports available", () => {
    const adapter = new SafeStorageAdapter(makeMockStorage("keychain"));
    expect(adapter.isAvailable()).toBe(true);
  });

  it("(a.b) isAvailable returns false when safeStorage is missing", () => {
    const adapter = new SafeStorageAdapter(undefined);
    expect(adapter.isAvailable()).toBe(false);
  });

  it("(b) encrypt + decrypt round-trips a plaintext value", () => {
    const adapter = new SafeStorageAdapter(makeMockStorage("keychain"));
    const ct = adapter.encrypt("hunter2");
    expect(ct).not.toBe("hunter2");
    expect(ct).toMatch(/^[A-Za-z0-9+/=]+$/); // base64
    expect(adapter.decrypt(ct)).toBe("hunter2");
  });

  it("(c) encrypt throws BasicTextBackendError when backend is basic_text", () => {
    const adapter = new SafeStorageAdapter(makeMockStorage("basic_text"));
    expect(() => adapter.encrypt("hunter2")).toThrow(BasicTextBackendError);
  });

  it("(d) encrypt succeeds on basic_text when allowBasicText: true", () => {
    const adapter = new SafeStorageAdapter(makeMockStorage("basic_text"));
    const ct = adapter.encrypt("hunter2", { allowBasicText: true });
    expect(adapter.decrypt(ct)).toBe("hunter2");
  });

  it("(e) getBackend collapses non-basic backends to 'encrypted'", () => {
    expect(
      new SafeStorageAdapter(makeMockStorage("keychain")).getBackend(),
    ).toBe("encrypted");
    expect(
      new SafeStorageAdapter(makeMockStorage("gnome_libsecret")).getBackend(),
    ).toBe("encrypted");
    expect(
      new SafeStorageAdapter(makeMockStorage("kwallet5")).getBackend(),
    ).toBe("encrypted");
    expect(
      new SafeStorageAdapter(makeMockStorage("basic_text")).getBackend(),
    ).toBe("basic_text");
  });

  it("(e.b) getBackend returns 'unknown' when getSelectedStorageBackend is missing", () => {
    const partial: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s, "utf8"),
      decryptString: (b) => b.toString("utf8"),
    };
    const adapter = new SafeStorageAdapter(partial);
    expect(adapter.getBackend()).toBe("unknown");
  });

  it("(f) decrypt throws DecryptFailedError on malformed ciphertext", () => {
    const adapter = new SafeStorageAdapter(makeMockStorage("keychain"));
    expect(() => adapter.decrypt("bm90LWVuYy1mb3JtYXQ=")).toThrow(
      DecryptFailedError,
    );
  });
});
