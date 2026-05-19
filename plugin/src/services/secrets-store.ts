/**
 * SecretsStore — typed wrapper over Obsidian `Plugin.loadData()` /
 * `saveData()` that persists encrypted secrets alongside settings.
 *
 * Phase 7 / 07-08 / PLG-02 / D-CHROME-SECRETS (07-CONTEXT.md L102–106).
 *
 * # Storage shape
 *
 * `data.json` is shared with `SettingsStore`. The two stores own disjoint
 * top-level keys: `settings` (08-03) and `secrets` (this file). On `save()`
 * we read-modify-write the file to preserve the other sub-key.
 *
 *   ```json
 *   {
 *     "settings": { …VaultMemorySettings },
 *     "secrets": [
 *       { "name": "openai", "ciphertext": "<base64>", "createdAt": "2026-…" }
 *     ]
 *   }
 *   ```
 *
 * # Security invariant
 *
 * **Plaintext NEVER lands in `data.json`.** `add()` encrypts via
 * `SafeStorageAdapter` before persisting; `list()` deliberately omits
 * `ciphertext` so callers cannot pass it through to UI surfaces by
 * accident. The only way to obtain ciphertext is `getCiphertext(name)`,
 * which is consumed by the server-side `resolve_secret` MCP tool (07-04).
 *
 * # Cross-device sync (RESEARCH §"Sync substrate caveat")
 *
 * `data.json` carries ciphertext across devices via Syncthing/iCloud/git,
 * but each device has its own `safeStorage` key. Decryption on a second
 * device fails → the UI prompts the user to re-enter the secret. This is
 * the correct security posture (CONTEXT D-CHROME-SECRETS).
 */

import type { Plugin } from "obsidian";
import type { SafeStorageAdapter } from "./safe-storage.js";

/** Wire format persisted to `data.json`. Plaintext is NEVER stored. */
export interface Secret {
  /** Stable identifier referenced as `${secret:name}` in connector configs. */
  name: string;
  /** Base64-encoded ciphertext from Electron `safeStorage.encryptString`. */
  ciphertext: string;
  /** ISO-8601 UTC timestamp; surfaced in the secrets-panel list. */
  createdAt: string;
}

/** Public projection — name + createdAt only; ciphertext stays internal. */
export interface SecretSummary {
  name: string;
  createdAt: string;
}

/** Full data.json shape — disjoint with `VaultMemorySettings` top-level. */
interface PluginData {
  settings?: unknown;
  secrets?: Secret[];
}

/**
 * Valid secret name: kebab-case, 3–64 chars, [a-z0-9-]. The same regex is
 * the contract for `${secret:name}` resolution server-side (07-04
 * `resolve_secret` tool); keep both in sync.
 */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export class SecretsStore {
  private readonly plugin: Pick<Plugin, "loadData" | "saveData">;
  private readonly safeStorage: SafeStorageAdapter;
  private secrets: Secret[] = [];

  constructor(
    plugin: Pick<Plugin, "loadData" | "saveData">,
    safeStorage: SafeStorageAdapter,
  ) {
    this.plugin = plugin;
    this.safeStorage = safeStorage;
  }

  /** Hydrate from `data.json`. Missing `secrets` key → empty list. */
  async load(): Promise<void> {
    const raw = (await this.plugin.loadData()) as PluginData | null;
    if (raw && Array.isArray(raw.secrets)) {
      this.secrets = raw.secrets.map((s) => ({
        name: s.name,
        ciphertext: s.ciphertext,
        createdAt: s.createdAt,
      }));
    } else {
      this.secrets = [];
    }
  }

  /**
   * Persist the current `secrets` array, preserving the sibling `settings`
   * sub-key written by `SettingsStore`. Read-modify-write at the data.json
   * level.
   */
  async save(): Promise<void> {
    const raw = ((await this.plugin.loadData()) as PluginData | null) ?? {};
    const next: PluginData = { ...raw, secrets: this.secrets };
    await this.plugin.saveData(next);
  }

  /**
   * Public listing — name + createdAt only. Deliberately does NOT include
   * ciphertext so callers cannot leak it to the UI by accident.
   */
  list(): readonly SecretSummary[] {
    return this.secrets.map((s) => ({ name: s.name, createdAt: s.createdAt }));
  }

  /**
   * Add a new secret. Validates `name` (kebab-case 3–64); rejects
   * duplicates; encrypts `value` via the adapter; persists. The encrypted
   * blob is stored — `value` is never written to disk.
   *
   * `opts.allowBasicText`: pass `true` after the user has accepted the
   * Linux `basic_text` consent modal in the secrets panel.
   */
  async add(
    name: string,
    value: string,
    opts?: { allowBasicText?: boolean },
  ): Promise<void> {
    if (!NAME_RE.test(name)) {
      throw new Error(
        `Invalid secret name "${name}": use kebab-case, 3–64 chars, [a-z0-9-].`,
      );
    }
    if (this.secrets.some((s) => s.name === name)) {
      throw new Error(`A secret named "${name}" already exists.`);
    }
    const ciphertext = this.safeStorage.encrypt(value, opts);
    this.secrets.push({
      name,
      ciphertext,
      createdAt: new Date().toISOString(),
    });
    await this.save();
  }

  /** Remove a secret by name. Idempotent — missing name is a no-op. */
  async delete(name: string): Promise<void> {
    const before = this.secrets.length;
    this.secrets = this.secrets.filter((s) => s.name !== name);
    if (this.secrets.length !== before) {
      await this.save();
    }
  }

  /**
   * Return the ciphertext blob for the named secret, or `undefined` if no
   * such secret exists. Consumed by the connector resolution path and the
   * server's `resolve_secret` MCP tool — never returns cleartext.
   */
  getCiphertext(name: string): string | undefined {
    return this.secrets.find((s) => s.name === name)?.ciphertext;
  }
}
