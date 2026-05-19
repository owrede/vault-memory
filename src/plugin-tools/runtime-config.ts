/**
 * RuntimeConfigStore — Phase 7 / Plan 07-04 / PLG-01, ADR-007 §D-CHROME-SETTINGS.
 *
 * In-memory mirror of selected `AppConfig` knobs that can be hot-swapped at
 * runtime without restarting the server. The CONFIG FILE
 * (`~/.vault-memory/config.toml`) remains the authoritative source of record
 * across restarts — this store is intentionally NOT persisted. Restarting the
 * server reverts every hot-swap to the on-disk value.
 *
 * Closed enum of hot-swappable keys (RESEARCH Open Q #1, RESOLVED):
 *   - reranker_enabled   (boolean) — toggles `vault.config` rerank gate in-memory
 *   - default_vault      (string)  — overrides `VAULT_MEMORY_ACTIVE_VAULT`
 *   - indexer_batch_size (number)  — informational; consulted by next indexVault call
 *
 * Restart-required keys are surfaced via `RESTART_REQUIRED_KEYS` and produce
 * a structured `{ok: false, reason: "restart_required", key}` response in
 * the `set_runtime_config` tool — no mutation occurs.
 *
 * # Adapter-seam discipline
 *
 * Pure in-memory key-value store. Zero `fs` / `path` / `yaml` / `chokidar`
 * imports. Zod schemas live in the consuming tool file; this module is just
 * the store.
 */

export const HOT_SWAPPABLE_KEYS = [
  "reranker_enabled",
  "default_vault",
  "indexer_batch_size",
] as const;

export type HotSwappableKey = (typeof HOT_SWAPPABLE_KEYS)[number];

export const RESTART_REQUIRED_KEYS = [
  "ollama_url",
  "embedding_model",
  "fts_tokenizer",
] as const;

export type RestartRequiredKey = (typeof RESTART_REQUIRED_KEYS)[number];

export type RuntimeConfigValue = boolean | string | number;

export interface RuntimeConfigSnapshot {
  reranker_enabled?: boolean;
  default_vault?: string;
  indexer_batch_size?: number;
}

/**
 * In-memory store. The owning module (typically `src/server.ts` bootstrap)
 * constructs ONE instance, seeds it with the initial on-disk values, and
 * threads it into each tool handler's dependency bag.
 */
export class RuntimeConfigStore {
  private values: RuntimeConfigSnapshot;

  constructor(initial?: RuntimeConfigSnapshot) {
    this.values = { ...(initial ?? {}) };
  }

  /** Read a single hot-swappable value, or `undefined` if never set. */
  get<K extends HotSwappableKey>(key: K): RuntimeConfigSnapshot[K] {
    return this.values[key];
  }

  /** Read the full snapshot (immutable copy). */
  snapshot(): RuntimeConfigSnapshot {
    return { ...this.values };
  }

  /** Write a hot-swappable value. Caller is responsible for type validation. */
  set<K extends HotSwappableKey>(key: K, value: RuntimeConfigSnapshot[K]): void {
    this.values[key] = value;
  }
}

/** True iff `key` is in the closed hot-swappable enum. */
export function isHotSwappableKey(key: string): key is HotSwappableKey {
  return (HOT_SWAPPABLE_KEYS as readonly string[]).includes(key);
}

/** True iff `key` is in the closed restart-required enum. */
export function isRestartRequiredKey(key: string): key is RestartRequiredKey {
  return (RESTART_REQUIRED_KEYS as readonly string[]).includes(key);
}
