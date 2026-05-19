/**
 * SecretsPanelController — headless logic for the secrets panel.
 *
 * Phase 7 / 07-08 / PLG-02 / D-CHROME-SECRETS.
 *
 * The `.svelte` component (secrets-panel.svelte) is the thin presentation
 * layer. All state mutation, validation, and consent-flow handling lives
 * here so the panel is testable without spinning up a Svelte compiler in
 * vitest. The Svelte component constructs a controller from its props and
 * delegates every user action to it.
 *
 * # Backend-warning state machine
 *
 *   1. Mount → read `safeStorage.getBackend()`.
 *   2. Backend === "basic_text" → render warning banner; new secrets prompt
 *      for explicit consent before persisting.
 *   3. Backend === "encrypted" / "unknown" → no banner; new secrets persist
 *      directly.
 *
 * # Consent flow (RESEARCH §"Pitfall 3")
 *
 *   addSecret(name, value):
 *     try { store.add(name, value) }
 *     catch BasicTextBackendError → set `pendingConsent = {name, value}`
 *                                   → UI surfaces a confirm modal
 *                                   → user accepts → confirmBasicText() retries
 *                                                    with `allowBasicText: true`
 *
 * # Invariants
 *
 *   - Plaintext lives in `pendingConsent.value` and nowhere else. It is
 *     cleared after `confirmBasicText()` (success or failure).
 *   - `entries` is the projection returned by `SecretsStore.list()` —
 *     name + createdAt only. Ciphertext is never exposed to the UI.
 */

import type { SafeStorageAdapter } from "../services/safe-storage.js";
import { BasicTextBackendError } from "../services/safe-storage.js";
import type { SecretSummary, SecretsStore } from "../services/secrets-store.js";

export interface SecretsPanelProps {
  store: SecretsStore;
  safeStorage: SafeStorageAdapter;
}

/** Subset surfaced to the Svelte presentation layer. */
export interface SecretsPanelView {
  entries: readonly SecretSummary[];
  backend: "basic_text" | "encrypted" | "unknown";
  showBasicTextWarning: boolean;
  pendingConsent: { name: string } | null;
  lastError: string | null;
}

export type ChangeListener = (view: SecretsPanelView) => void;

export class SecretsPanelController {
  private readonly store: SecretsStore;
  private readonly safeStorage: SafeStorageAdapter;
  private listeners: ChangeListener[] = [];

  // Plaintext value is held briefly while awaiting the consent modal; cleared
  // immediately after the retry (success OR failure). Marked `#`-private so
  // tests cannot accidentally introspect it.
  #pendingPlaintext: { name: string; value: string } | null = null;
  #lastError: string | null = null;

  constructor(props: SecretsPanelProps) {
    this.store = props.store;
    this.safeStorage = props.safeStorage;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    listener(this.snapshot());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  snapshot(): SecretsPanelView {
    const backend = this.safeStorage.getBackend();
    return {
      entries: this.store.list(),
      backend,
      showBasicTextWarning: backend === "basic_text",
      pendingConsent: this.#pendingPlaintext
        ? { name: this.#pendingPlaintext.name }
        : null,
      lastError: this.#lastError,
    };
  }

  /**
   * Attempt to add a secret. On `BasicTextBackendError`, set the
   * `pendingConsent` state — the UI surfaces a confirm modal then calls
   * `confirmBasicText()`. All other errors bubble to `lastError`.
   */
  async addSecret(name: string, value: string): Promise<void> {
    this.#lastError = null;
    try {
      await this.store.add(name, value);
      this.notify();
    } catch (err) {
      if (err instanceof BasicTextBackendError) {
        this.#pendingPlaintext = { name, value };
        this.notify();
        return;
      }
      this.#lastError = err instanceof Error ? err.message : String(err);
      this.notify();
    }
  }

  /**
   * Confirm the Linux `basic_text` fallback — retry the pending add with
   * `allowBasicText: true`. Idempotent: no pending consent → no-op.
   * Plaintext is cleared after the call, regardless of outcome.
   */
  async confirmBasicText(): Promise<void> {
    const pending = this.#pendingPlaintext;
    if (!pending) return;
    this.#pendingPlaintext = null;
    try {
      await this.store.add(pending.name, pending.value, { allowBasicText: true });
      this.#lastError = null;
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
    }
    this.notify();
  }

  /** Cancel the pending basic_text consent — clears plaintext, no add. */
  cancelBasicText(): void {
    this.#pendingPlaintext = null;
    this.notify();
  }

  /** Remove a secret. Idempotent for missing names. */
  async deleteSecret(name: string): Promise<void> {
    this.#lastError = null;
    try {
      await this.store.delete(name);
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
    }
    this.notify();
  }

  private notify(): void {
    const view = this.snapshot();
    for (const listener of this.listeners) {
      listener(view);
    }
  }
}
