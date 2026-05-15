/**
 * `handleRecall` — the MEM-03 controller.
 *
 * Retrieves memory documents from one or more labeled `MemorySinks`,
 * filtered by provenance (`min_confidence`, `types`, `max_age_days`)
 * and ranked by recency (`observed_at` DESC, `mtime` DESC tiebreak).
 * Returns the Phase 3 citation-packet floor: an 8-field
 * `CitationPacket` per result (D-01).
 *
 * Pipeline (per RESEARCH §Q7 — the recommended approach):
 *
 *   1. Resolve sinks: single sink (when args.sink set) or all configured.
 *   2. Run `searchHybrid` with a generous `top_k` (200) across the
 *      sinks' owning vaults.
 *   3. Post-filter the candidates to those whose path begins with one
 *      of the resolved sinks' `resolveToRelativePath` prefixes.
 *   4. De-duplicate by (vault, notePath) — a single doc may surface as
 *      multiple chunks; we keep the best-scoring chunk's identity.
 *   5. Load each candidate's full `Document` via the SourceConnector
 *      seam so we get the canonical `Document.hash` + full property
 *      bag including provenance keys.
 *   6. Apply filters in this exact order (CONTEXT.md D-01):
 *        a. Hide `status: "superseded"` (always; opt-in retrieval is
 *           Phase 3 ASM-08 territory).
 *        b. `min_confidence` — ordinal compare (direct=3, inferred=2,
 *           uncertain=1).
 *        c. `types` — exact match against `properties.type`.
 *        d. `max_age_days` — `now - Date.parse(observed_at)` ≤ window.
 *   7. Sort `observed_at` DESC with `mtime` DESC tiebreak.
 *   8. Slice to `args.limit ?? 20` AFTER filter+sort (per D-01).
 *   9. Map each surviving Document → CitationPacket.
 *
 * The controller is pure: no `node:fs`, no `node:path`, no
 * `gray-matter`, no `chokidar`. All access goes through the registry
 * (sink resolution), the SourceConnector (property reads via
 * `readDocument`), and the search service.
 *
 * Contingency (NOT shipped in Phase 2): if benchmarks ever show the
 * post-filter is too slow on a large vault, the user-approved fallback
 * is to add an optional `include_paths?: string[]` parameter to
 * `search_hybrid` and pass the sinks' resolved path prefixes. That
 * change is purely additive (does not break v1.x callers). Phase 2
 * ships the post-filter approach; the fallback is documented here for
 * the day the benchmark requires it.
 */

import type { SourceConnector } from "../../adapters/source/types.js";
import { decomposeDocId, formatDocId } from "../../adapters/registry.js";
import type { Document, SearchHit } from "../../types.js";
import type { Vault, VaultManager } from "../../vault/index.js";
import type { MemorySinkRegistry } from "../registry.js";
import { type CitationPacket, displayUrlFor, toCitationPacket } from "../citation-packet.js";

/** Default limit when the caller does not specify one. */
const DEFAULT_LIMIT = 20;
/** Generous top_k for the inner hybrid search; post-filter narrows. */
const RECALL_HYBRID_TOP_K = 200;

/**
 * Input shape for the inner `searchHybrid` call. Mirrors the subset of
 * Phase 1's `HybridSearchOptions` that recall actually uses; passed as
 * a closure rather than imported directly so unit tests can stub.
 */
export interface RecallSearchHybridInput {
  query: string;
  vaults: readonly Vault[];
  topK: number;
}

export interface RecallDeps {
  memorySinkRegistry: MemorySinkRegistry;
  manager: VaultManager;
  /** Resolve the `SourceConnector` instance for a vault name. */
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  /** Hybrid-search entry point. Bootstrap supplies the production closure. */
  searchHybrid: (input: RecallSearchHybridInput) => Promise<SearchHit[]>;
}

export interface RecallArgs {
  query: string;
  min_confidence?: "direct" | "inferred" | "uncertain";
  types?: string[];
  max_age_days?: number;
  sink?: string;
  limit?: number;
  vaults?: string[];
}

/** Ordinal rank for `confidence`. Unknown / undefined → 0. */
function confidenceRank(c?: string): number {
  switch (c) {
    case "direct":
      return 3;
    case "inferred":
      return 2;
    case "uncertain":
      return 1;
    default:
      return 0;
  }
}

/**
 * Coerce a property value into an `observed_at` ISO timestamp string
 * suitable for both `Date.parse` (for age math) and string-comparison
 * sort (lexicographic ISO ordering).
 *
 * YAML frontmatter can surface ISO-8601 timestamps as either:
 *   - JS `Date` objects (when js-yaml / gray-matter parses canonical
 *     ISO strings via the `tag:yaml.org,2002:timestamp` rule), or
 *   - raw strings (when quoted or schema-coerced).
 *
 * Returns `null` when the value is missing or unparseable. Callers use
 * `null` as the signal to drop the doc (a doc without a parseable
 * `observed_at` cannot be ranked by recency).
 */
function observedAtIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

/**
 * Retrieve memory docs as citation packets. See the file header for
 * the full pipeline; this function is the public entry point.
 */
export async function handleRecall(
  deps: RecallDeps,
  args: RecallArgs,
): Promise<CitationPacket[]> {
  // 1) Resolve sinks. Throws on unknown name — the server wraps the
  //    exception in errorResponse() at the dispatch boundary.
  const sinks = args.sink
    ? [deps.memorySinkRegistry.resolveMemorySink(args.sink)]
    : deps.memorySinkRegistry.listMemorySinks();
  if (sinks.length === 0) return [];

  // 2) Compute the set of vaults to search: the distinct sink.vault
  //    values, optionally intersected with args.vaults.
  const sinkVaultNames = new Set(sinks.map((s) => s.vault));
  const allowedVaultNames = args.vaults
    ? new Set(args.vaults.filter((v) => sinkVaultNames.has(v)))
    : sinkVaultNames;
  if (allowedVaultNames.size === 0) return [];

  const vaults: Vault[] = [];
  for (const name of allowedVaultNames) {
    vaults.push(deps.manager.require(name));
  }

  // 3) Inner hybrid search with a generous top_k.
  const candidates = await deps.searchHybrid({
    query: args.query,
    vaults,
    topK: RECALL_HYBRID_TOP_K,
  });

  // 4) Post-filter to sink-resolved paths. A candidate matches a sink
  //    iff hit.vault === sink.vault AND hit.notePath starts with
  //    sink.resolveToRelativePath (which already carries a trailing
  //    slash by the MemorySinkHandle invariant).
  const sinkMatchers = sinks
    .filter((s) => allowedVaultNames.has(s.vault))
    .map((s) => ({ vault: s.vault, prefix: s.resolveToRelativePath }));
  const inSink = candidates.filter((hit) =>
    sinkMatchers.some(
      (m) => hit.vault === m.vault && hit.notePath.startsWith(m.prefix),
    ),
  );

  // 5) De-duplicate by (vault, notePath) — a doc can produce multiple
  //    chunk hits; we keep the highest-scoring chunk's metadata.
  const uniqueByPath = new Map<string, SearchHit>();
  for (const hit of inSink) {
    const key = `${hit.vault}::${hit.notePath}`;
    const existing = uniqueByPath.get(key);
    if (!existing || hit.score > existing.score) {
      uniqueByPath.set(key, hit);
    }
  }
  if (uniqueByPath.size === 0) return [];

  // 6) Load full Documents via the source seam for canonical hash +
  //    full property bag (including the provenance keys we need to
  //    filter on).
  const docs: Document[] = [];
  for (const hit of uniqueByPath.values()) {
    const docId = formatDocId("obsidian-fs", hit.vault, hit.notePath);
    try {
      const doc = await deps.sourceConnectorFor(hit.vault).readDocument(docId);
      docs.push(doc);
    } catch {
      // A search hit pointing to a now-deleted file is harmless;
      // silently drop it. (Watcher catch-up usually keeps the index
      // in sync, but we don't fail the whole call on one stale row.)
    }
  }

  // 7) Apply provenance filters in the documented order.
  const now = Date.now();
  const minRank = args.min_confidence ? confidenceRank(args.min_confidence) : 0;
  const typeSet = args.types && args.types.length > 0 ? new Set(args.types) : null;
  const maxAgeMs =
    args.max_age_days !== undefined ? args.max_age_days * 86_400_000 : null;

  const filtered = docs.filter((doc) => {
    const props = (doc.properties ?? {}) as Record<string, unknown>;
    // 7a) Hide superseded by default.
    if (props.status === "superseded") return false;
    // 7b) min_confidence ordinal compare.
    if (minRank > 0) {
      const docConf = typeof props.confidence === "string" ? props.confidence : undefined;
      if (confidenceRank(docConf) < minRank) return false;
    }
    // 7c) types exact match.
    if (typeSet) {
      const t = typeof props.type === "string" ? props.type : undefined;
      if (t === undefined || !typeSet.has(t)) return false;
    }
    // 7d) max_age_days against observed_at.
    if (maxAgeMs !== null) {
      const iso = observedAtIso(props.observed_at);
      if (iso === null) return false;
      if (now - Date.parse(iso) > maxAgeMs) return false;
    }
    return true;
  });

  // 8) Sort: observed_at DESC, mtime DESC tiebreak.
  filtered.sort((a, b) => {
    const ao = observedAtIso((a.properties as Record<string, unknown>)?.observed_at) ?? "";
    const bo = observedAtIso((b.properties as Record<string, unknown>)?.observed_at) ?? "";
    if (ao !== bo) {
      // ISO-8601 strings sort lexicographically when both well-formed.
      return ao < bo ? 1 : -1;
    }
    return b.mtime - a.mtime;
  });

  // 9) Truncate AFTER sort (per D-01).
  const limit = args.limit ?? DEFAULT_LIMIT;
  const top = filtered.slice(0, limit);

  // 10) Map each surviving Document → CitationPacket. The display URL
  //     is computed via the source adapter's `formatDisplayUrl` seam
  //     (ADR-002 §SourceConnector) — recall does not encode adapter-
  //     specific URL conventions inline.
  return top.map((doc) => {
    const { authority: vaultName } = decomposeDocId(doc.id);
    const source = deps.sourceConnectorFor(vaultName);
    return toCitationPacket(doc, displayUrlFor(doc.id, source));
  });
}

