/**
 * set_runtime_config — Phase 7 / Plan 07-04 / PLG-01, ADR-007 §D-CHROME-SETTINGS.
 *
 * Per-key runtime settings tool. Applies hot-swappable settings to the
 * in-memory `RuntimeConfigStore` ONLY — the on-disk `~/.vault-memory/config.toml`
 * is authoritative across restarts and is never mutated by this tool. Server
 * restart reverts hot-swaps to the file values (this is intentional; see PLG-01
 * §"Hot-swap semantics").
 *
 * Closed enum of allowed keys (RESEARCH Open Q #1, RESOLVED):
 *   - reranker_enabled   (boolean)
 *   - default_vault      (string)
 *   - indexer_batch_size (number, positive integer)
 *
 * Restart-required keys (`ollama_url`, `embedding_model`, `fts_tokenizer`)
 * return `{ok: false, reason: "restart_required", key}` without mutating.
 * Unknown keys return `{ok: false, reason: "unknown_key", key}`.
 *
 * # Adapter-seam discipline
 *
 * Imports only `zod` + sibling `runtime-config.js` / `errors.js`. Zero `fs`,
 * `path`, `yaml`, `chokidar`, MCP SDK. The MCP SDK wiring happens in
 * `src/plugin-tools/index.ts`.
 */

import { z } from "zod";
import {
  RuntimeConfigStore,
  HOT_SWAPPABLE_KEYS,
  isHotSwappableKey,
  isRestartRequiredKey,
} from "./runtime-config.js";

const SetRuntimeConfigArgs = z.object({
  key: z
    .string()
    .min(1)
    .describe(
      "Closed enum of hot-swappable keys: " +
        `${HOT_SWAPPABLE_KEYS.join(", ")}. Restart-required keys ` +
        "(ollama_url, embedding_model, fts_tokenizer) return reason='restart_required'.",
    ),
  value: z
    .union([z.boolean(), z.string(), z.number()])
    .describe(
      "New value. Type must match the key: reranker_enabled = boolean, " +
        "default_vault = string, indexer_batch_size = positive integer.",
    ),
});

export type SetRuntimeConfigInput = z.infer<typeof SetRuntimeConfigArgs>;

export interface SetRuntimeConfigDeps {
  store: RuntimeConfigStore;
}

export type SetRuntimeConfigResult =
  | { ok: true; key: string; value: boolean | string | number }
  | { ok: false; reason: "unknown_key"; key: string }
  | { ok: false; reason: "restart_required"; key: string }
  | { ok: false; reason: "type_mismatch"; key: string; expected: string };

async function handler(
  args: SetRuntimeConfigInput,
  deps: SetRuntimeConfigDeps,
): Promise<SetRuntimeConfigResult> {
  const { key, value } = args;

  if (isRestartRequiredKey(key)) {
    return { ok: false, reason: "restart_required", key };
  }
  if (!isHotSwappableKey(key)) {
    return { ok: false, reason: "unknown_key", key };
  }

  // Per-key type-narrow validation. Zod already constrained `value` to
  // boolean | string | number; this layer enforces the per-key expected
  // type (e.g. reranker_enabled must be boolean, not "true" string).
  switch (key) {
    case "reranker_enabled": {
      if (typeof value !== "boolean") {
        return { ok: false, reason: "type_mismatch", key, expected: "boolean" };
      }
      deps.store.set("reranker_enabled", value);
      return { ok: true, key, value };
    }
    case "default_vault": {
      if (typeof value !== "string") {
        return { ok: false, reason: "type_mismatch", key, expected: "string" };
      }
      deps.store.set("default_vault", value);
      return { ok: true, key, value };
    }
    case "indexer_batch_size": {
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        return {
          ok: false,
          reason: "type_mismatch",
          key,
          expected: "positive integer",
        };
      }
      deps.store.set("indexer_batch_size", value);
      return { ok: true, key, value };
    }
  }
}

export const setRuntimeConfigTool = {
  name: "set_runtime_config" as const,
  description:
    "Apply a hot-swappable runtime config key (in-memory only — config.toml " +
    "remains authoritative across restarts). Closed enum of keys: " +
    `${HOT_SWAPPABLE_KEYS.join(", ")}. ADR-007 §D-CHROME-SETTINGS.`,
  inputSchema: SetRuntimeConfigArgs,
  handler,
};
