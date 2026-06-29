/**
 * searchVaults — engine-dispatching search front-end (ADR-008).
 *
 * vault-memory supports two retrieval engines selectable per vault:
 *   - "ollama"     (default): Ollama embeddings + sqlite-vec + FTS5 hybrid
 *                  (`hybridSearch`).
 *   - "contextfit": CPU-only token-native engine via its CLI
 *                  (`searchVaultWithContextFit`).
 *
 * Callers used to invoke `hybridSearch` directly. `searchVaults` is a
 * drop-in wrapper with the same options that partitions the requested vaults
 * by their configured `backend`, runs each group through the right engine,
 * and merges the results into one `SearchHit[]` sorted by score (descending),
 * truncated to `topK`. Engine-mixing is fine because every engine returns the
 * canonical `SearchHit`; scores are per-engine and only used for intra-result
 * ordering, never cross-engine semantics.
 *
 * When every vault is "ollama" (the common case), this delegates straight to
 * `hybridSearch` with zero behavior change.
 */

import type { SearchHit } from "../types.js";
import { hybridSearch, type HybridSearchOptions } from "./hybrid.js";

function isContextFit(vault: HybridSearchOptions["vaults"][number]): boolean {
  return vault.config.backend === "contextfit";
}

export async function searchVaults(opts: HybridSearchOptions): Promise<SearchHit[]> {
  const topK = opts.topK ?? 10;
  const cfVaults = opts.vaults.filter(isContextFit);
  const ollamaVaults = opts.vaults.filter((v) => !isContextFit(v));

  // Fast path: no ContextFit vaults → behave exactly like hybridSearch.
  if (cfVaults.length === 0) {
    return hybridSearch(opts);
  }

  const { searchVaultWithContextFit } = await import("../adapters/retrieval/contextfit/index.js");

  // Run ContextFit vaults (each via its CLI) and the Ollama group concurrently.
  // A failing ContextFit vault (CLI missing, bad KB) must not take down the
  // whole search — log to stderr and yield no hits for that vault.
  const cfPromise = Promise.all(
    cfVaults.map((v) =>
      searchVaultWithContextFit(v.config, opts.query, { topK }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[search:${v.config.name}] ContextFit query failed: ${msg}`);
        return [] as SearchHit[];
      }),
    ),
  );
  const ollamaPromise =
    ollamaVaults.length > 0
      ? hybridSearch({ ...opts, vaults: ollamaVaults })
      : Promise.resolve([] as SearchHit[]);

  const [cfResultsNested, ollamaResults] = await Promise.all([cfPromise, ollamaPromise]);
  const cfResults = cfResultsNested.flat();

  // Merge + sort by score desc, then truncate to topK. Scores are per-engine;
  // this ordering is best-effort across a heterogeneous result set (rare —
  // most setups are single-engine). Within a single engine the order is exact.
  const merged = [...ollamaResults, ...cfResults];
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topK);
}
