/**
 * SafeStorageAdapter — thin wrapper over Electron's `safeStorage` API.
 *
 * Phase 7 / 07-08 / PLG-02 / D-CHROME-SECRETS (07-CONTEXT.md L102–106).
 *
 * # Access path (RESEARCH §"Pitfall 3")
 *
 * `safeStorage` is NOT part of the Obsidian public API. Plugins reach it via
 * `(window as { electron?: { safeStorage?: SafeStorage } }).electron?.safeStorage`,
 * which Electron's renderer exposes on desktop. Mobile lacks Electron, hence
 * `manifest.json` must set `isDesktopOnly: true`. We feature-detect with
 * `isEncryptionAvailable()` and degrade gracefully when unavailable.
 *
 * # Linux `basic_text` fallback (RESEARCH §"Pitfall 3" warning sign)
 *
 * On Linux sessions without `gnome-libsecret` / `kwallet5`, the Electron
 * `safeStorage` backend silently falls back to `"basic_text"` — i.e. plaintext
 * on disk. We refuse to `encrypt` in this state unless the caller passes
 * `{ allowBasicText: true }`, signalling the user has acknowledged the warning
 * surfaced by the secrets panel UI.
 *
 * # Ciphertext format (RESEARCH §"Open Q" recommendation)
 *
 * `encrypt` returns base64 of the raw `safeStorage.encryptString` buffer. The
 * outer `SecretsStore` wraps it in `{ v: 1, alg: "electron-safe-storage", ct,
 * createdAt }` for forward-migration headroom (a v2 would be additive). The
 * adapter itself stays format-agnostic.
 *
 * # Testability
 *
 * The Electron `safeStorage` instance is an injectable constructor argument
 * (defaulting to the renderer-exposed one). Unit tests pass an in-memory mock
 * that implements `isEncryptionAvailable`, `encryptString`, `decryptString`,
 * and `getSelectedStorageBackend` — no Electron import required.
 */

/** Minimal surface of Electron's safeStorage we actually use. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
  /**
   * Linux-only; on macOS / Windows the value is platform-specific but never
   * `"basic_text"`. Older Electron versions may not expose this method —
   * `SafeStorageAdapter.getBackend()` collapses `undefined` to `"unknown"`.
   */
  getSelectedStorageBackend?(): string;
}

/**
 * Thrown when the caller asks `encrypt` to persist on a Linux `basic_text`
 * backend without explicit `{ allowBasicText: true }`. The secrets panel
 * catches this, surfaces a consent modal, and retries with the flag set.
 */
export class BasicTextBackendError extends Error {
  override readonly name = "BasicTextBackendError";
  constructor(message?: string) {
    super(
      message ??
        "Refusing to encrypt: Electron safeStorage backend is `basic_text` " +
          "(no OS keyring). Pass `{ allowBasicText: true }` to acknowledge.",
    );
  }
}

/**
 * Thrown by `decrypt` when the ciphertext cannot be decrypted on this
 * device — e.g. cross-device sync where the keyring differs (correct posture
 * per CONTEXT D-CHROME-SECRETS). The UI prompts the user to re-enter the
 * secret on the new device.
 */
export class DecryptFailedError extends Error {
  override readonly name = "DecryptFailedError";
  constructor(message?: string) {
    super(message ?? "Failed to decrypt ciphertext on this device.");
  }
}

/** Backend classification returned by `getBackend()`. */
export type SafeStorageBackend = "basic_text" | "encrypted" | "unknown";

/**
 * Discover the renderer-exposed safeStorage instance once. Exported so the
 * plugin's `onload()` can construct the adapter explicitly; tests bypass this
 * by passing their mock directly to the constructor.
 */
export function discoverSafeStorage(): SafeStorageLike | undefined {
  const w = globalThis as unknown as {
    electron?: { safeStorage?: SafeStorageLike };
  };
  return w.electron?.safeStorage;
}

export class SafeStorageAdapter {
  private readonly safeStorage: SafeStorageLike | undefined;

  constructor(safeStorage?: SafeStorageLike) {
    this.safeStorage = safeStorage ?? discoverSafeStorage();
  }

  /** True when Electron reports an encryption backend is available. */
  isAvailable(): boolean {
    if (!this.safeStorage) return false;
    try {
      return this.safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Classify the active backend:
   *   - `"basic_text"` → Linux fallback (effectively plaintext).
   *   - `"encrypted"` → keychain / libsecret / kwallet / DPAPI.
   *   - `"unknown"` → safeStorage missing or `getSelectedStorageBackend`
   *     not exposed on this Electron build.
   */
  getBackend(): SafeStorageBackend {
    if (!this.safeStorage || !this.safeStorage.getSelectedStorageBackend) {
      return "unknown";
    }
    try {
      const raw = this.safeStorage.getSelectedStorageBackend();
      return raw === "basic_text" ? "basic_text" : "encrypted";
    } catch {
      return "unknown";
    }
  }

  /**
   * Encrypt `plaintext` → base64 ciphertext. Throws `BasicTextBackendError`
   * on Linux `basic_text` backends unless `allowBasicText: true`.
   */
  encrypt(plaintext: string, opts?: { allowBasicText?: boolean }): string {
    if (!this.safeStorage) {
      throw new Error(
        "Electron safeStorage is not available — plugin must run on desktop.",
      );
    }
    if (this.getBackend() === "basic_text" && !opts?.allowBasicText) {
      throw new BasicTextBackendError();
    }
    const buf = this.safeStorage.encryptString(plaintext);
    return buf.toString("base64");
  }

  /**
   * Decrypt a base64 ciphertext produced by `encrypt`. Throws
   * `DecryptFailedError` on cross-device / corrupted-blob mismatches.
   */
  decrypt(ciphertextBase64: string): string {
    if (!this.safeStorage) {
      throw new Error(
        "Electron safeStorage is not available — plugin must run on desktop.",
      );
    }
    try {
      const buf = Buffer.from(ciphertextBase64, "base64");
      return this.safeStorage.decryptString(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DecryptFailedError(`Failed to decrypt: ${msg}`);
    }
  }
}
