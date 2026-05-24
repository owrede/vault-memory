/**
 * SettingsStore — typed wrapper over Obsidian `Plugin.loadData()` /
 * `saveData()` for the vault-memory plugin.
 *
 * Phase 7 / PLG-01 / D-CHROME-SETTINGS (07-CONTEXT.md L94–100).
 *
 * Persistence target: `.obsidian/plugins/vault-memory/data.json`.
 *
 * # Restart-required mapping (07-CONTEXT.md "Settings restart-vs-hot-swap"):
 *
 *   Restart-required (must restart Obsidian / re-spawn server):
 *     - ollamaUrl
 *     - embeddingModel
 *     - ftsTokenizer
 *     - serverCommand
 *     - serverArgs
 *
 *   Hot-swappable (live MCP tool call into the running server):
 *     - rerankerEnabled
 *     - defaultVault
 *     - indexerBatchSize
 *
 * The chrome plan (07-08) renders a "restart required" badge for each
 * key whose `isRestartRequired(key)` returns true. The store itself does
 * not push to the server — that is the chrome plan's job via `mcpClient
 * .callTool("set_runtime_config", …)` for the hot-swappable subset.
 *
 * # Merge-with-defaults semantics
 *
 * Older `data.json` files may be missing keys introduced in later plugin
 * versions. `load()` merges the persisted object on top of
 * `DEFAULT_SETTINGS` so previously-unset keys fall back to safe values
 * without forcing the user to re-save.
 */

import type { Plugin } from "obsidian";

export interface VaultMemorySettings {
  ollamaUrl: string;
  embeddingModel: string;
  rerankerEnabled: boolean;
  defaultVault: string | null;
  indexerBatchSize: number;
  ftsTokenizer: string | null;
  serverCommand: string;
  serverArgs: string[];
  /**
   * Per-source palette curation. Maps source name (peer-MCP client name)
   * to the list of tools that should appear in the contract editor
   * palette. Default-on semantics — a source missing from the map →
   * all tools enabled; empty array → all disabled; non-empty array →
   * only listed tools enabled. See .planning/specs/SOURCES-REGISTRY.md §7.
   */
  sourceEnabledTools: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: VaultMemorySettings = {
  ollamaUrl: "http://localhost:11434",
  embeddingModel: "bge-m3",
  rerankerEnabled: false,
  defaultVault: null,
  indexerBatchSize: 32,
  ftsTokenizer: null,
  serverCommand: "vault-memory",
  serverArgs: ["serve"],
  sourceEnabledTools: {},
};

const RESTART_REQUIRED_KEYS: ReadonlySet<keyof VaultMemorySettings> = new Set([
  "ollamaUrl",
  "embeddingModel",
  "ftsTokenizer",
  "serverCommand",
  "serverArgs",
]);

export class SettingsStore {
  private readonly plugin: Pick<Plugin, "loadData" | "saveData">;
  private current: VaultMemorySettings = { ...DEFAULT_SETTINGS };

  constructor(plugin: Pick<Plugin, "loadData" | "saveData">) {
    this.plugin = plugin;
  }

  /** Load persisted settings from `data.json`, merging with defaults. */
  async load(): Promise<VaultMemorySettings> {
    const raw = await this.plugin.loadData();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      // Shallow merge is sufficient — VaultMemorySettings is flat.
      this.current = { ...DEFAULT_SETTINGS, ...(raw as Partial<VaultMemorySettings>) };
    } else {
      this.current = { ...DEFAULT_SETTINGS };
    }
    return this.current;
  }

  /** Persist the current snapshot to `data.json` via Obsidian's API. */
  async save(): Promise<void> {
    await this.plugin.saveData(this.current);
  }

  /** Snapshot accessor — returns the in-memory value, not a fresh load. */
  get<K extends keyof VaultMemorySettings>(key: K): VaultMemorySettings[K] {
    return this.current[key];
  }

  /** Mutate one key and immediately persist. */
  async set<K extends keyof VaultMemorySettings>(
    key: K,
    value: VaultMemorySettings[K],
  ): Promise<void> {
    this.current = { ...this.current, [key]: value };
    await this.save();
  }

  /** Settings that require Obsidian restart / server re-spawn to apply. */
  isRestartRequired(key: keyof VaultMemorySettings): boolean {
    return RESTART_REQUIRED_KEYS.has(key);
  }

  /** Full snapshot for chrome-tab display. Returns a clone to prevent
   *  callers mutating internal state without going through `set`. */
  snapshot(): VaultMemorySettings {
    return { ...this.current };
  }
}
