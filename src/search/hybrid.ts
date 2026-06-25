/**
 * Hybrid search via Reciprocal Rank Fusion (RRF).
 *
 * Runs semantic (sqlite-vec L2 over embeddings) and BM25 (FTS5 over chunk text)
 * searches in parallel per vault, then merges their rankings using RRF — a
 * rank-only fusion technique that requires no score normalization between
 * methods.
 *
 * RRF formula (Cormack et al., 2009):
 *   rrf_score(item) = Σ_R  1 / (k + rank_R(item))
 * where R ranges over input rankings and rank is 1-based; items missing from
 * a ranking contribute 0 from that ranking.
 *
 * Two-stage fan-out across vaults:
 *  - Embed query once per distinct model name (vaults sharing a model share
 *    the vector).
 *  - Per vault, fire semantic + BM25 in parallel, RRF-merge their chunk-id
 *    lists, hydrate hits, then global-sort across vaults and take topK.
 */

import type { OllamaClient } from "../ollama/index.js";
import type { Vault } from "../vault/index.js";
import type { DocId, SearchHit, SourceHandle } from "../types.js";
import type { Reranker } from "../rerank/index.js";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import {
  expand,
  type CitationPacketWithVia,
  type ExpandDeps,
  type ExpandDirection,
} from "../graph/index.js";
import type { EdgeType } from "../db/queries/edges.js";

export interface HybridSearchOptions {
  query: string;
  /** Pre-computed embedding model name. Used for two purposes:
   *  1) look up the active model_id in each vault's DB
   *  2) ensure the query is embedded with the same model the index used */
  embeddingModel: string;
  ollama: OllamaClient;
  vaults: readonly Vault[];
  topK?: number;
  /** RRF constant. Standard: 60. Higher = less emphasis on top ranks. */
  rrfK?: number;
  /** Whether to include the per-method scores in the breakdown. Default true. */
  includeBreakdown?: boolean;
  /**
   * Optional cross-encoder reranker. When provided, hybridSearch fans out
   * `topK × rerankFanOut` candidates from the RRF stage, runs the reranker
   * on those, then resorts by rerank score and returns the new topK.
   *
   * On reranker failure (throw), the un-reranked RRF order is returned.
   */
  reranker?: Reranker;
  /** Candidate pool size as a multiple of topK. Default 5.
   *
   *  Sizing rationale: BGE-M3 cosine distances on prose vaults form tight
   *  plateaus (all top-N within ~0.02 score). The reranker needs a wide
   *  enough pool to include semantically-on-target chunks that the
   *  embedding ranks just below the plateau crest. At topK=10, a fanOut
   *  of 5 produces a 50-chunk pool — empirically enough to catch chunks
   *  the bi-encoder placed in rank 30-50 due to plateau noise.
   *
   *  Limitations: a wider pool cannot rescue chunks the bi-encoder ranks
   *  beyond the pool. Cross-lingual queries against a model with weak
   *  recall on the target language (e.g. BGE-M3 on EN→DE for some terms)
   *  can place the relevant chunk past rank 150. The fix there is a model
   *  switch, not a larger pool — pool growth costs reranker inference
   *  linearly while the marginal recall gain plateaus.
   *
   *  Diagnostic: when the highest rerank score across the pool stays
   *  below ~0.1, that is a signal that the desired chunk was never in
   *  the pool. See `vault-memory-eval-v3-results.md` for the BGE-M3
   *  cross-lingual case study. */
  rerankFanOut?: number;
  // ── Phase 3 / 03-05 (D-07, D-08, ASM-07, ASM-08): post-RRF rescore + filter ──
  //
  // All four params are strictly optional with defaults that vanish
  // when unused. The v1-default path (none of these set) is
  // byte-identical to v1 by construction:
  //   - recencyWeight=0 + authorityWeight=0 → rescore block short-circuits
  //   - includeSuperseded=false + no superseded fixture → SQL filter is a no-op
  //
  /** Additive recency term: `recencyWeight × exp(-age_days / halfLifeDays)`.
   *  Default 0 (term contributes nothing — v1 invariance). */
  recencyWeight?: number;
  /** Additive authority term: `authorityWeight × 1` for docs with
   *  `frontmatter.authoritative === true`, `× 0` otherwise. Default 0. */
  authorityWeight?: number;
  /** Recency half-life (days). Default 30 (D-07). Exposed so tests can
   *  set short half-lives for deterministic age math. */
  halfLifeDays?: number;
  /** When false (default), exclude chunks whose note is `status: superseded`
   *  at SQL level via the FTS JOIN + vec0 post-filter (03-05 M4). */
  includeSuperseded?: boolean;
  /** Clock injection seam — defaults to `Date.now`. Mirrors the recall
   *  controller's idiom (`src/memory/tools/recall.ts:~205`). */
  clock?: () => number;
  /**
   * Phase 3 / 03-05 (ASM-06): display-URL resolver seam.
   *
   * `hybridSearch` is L0 substrate and is not allowed to mint adapter
   * URL strings (ADR-002 §I-5b — `obsidian://` literals live only in // vault-memory:claude-ok
   * the source adapter or registry). Bootstrap supplies a closure that
   * delegates to the registered `SourceConnector.formatDisplayUrl` for
   * the relevant vault; tests can omit it (no `display_url` populated).
   */
  displayUrlFor?: (vaultName: string, notePath: string) => string;
  // ── Phase 4 / 04-04 / GRA-03 (D-15, D-16): additive auto-expansion ──
  //
  // When `opts.expand` is undefined (the v1/v2 default), this guard
  // short-circuits entirely — zero new DB reads, zero new computation,
  // preserving v1-baseline byte-identical behavior. Expand runs AFTER
  // Phase 3 recency/authority rescore so that expansions attach to the
  // RESCORED top-K (D-16). Expand never participates in score
  // computation; top-K ranking is stable.
  //
  // `expand` and `expandDeps` MUST be supplied together. When only
  // one is set, the guard silently no-ops (defensive: callers wiring
  // this up incrementally see no behavior change until both are
  // provided). The dependency injection mirrors `displayUrlFor` — the
  // graph-traversal seam stays out of hybrid.ts's transitive imports
  // by surfacing it as an optional dep on the call site.
  /** Optional auto-expansion settings (D-15). When set, each hit
   *  gains an additive `expansions: CitationPacketWithVia[]` field. */
  expand?: {
    hops: 1 | 2;
    direction?: ExpandDirection;
    edge_types?: EdgeType[];
  };
  /** Injected dependencies required by `expand()` — `manager` and
   *  `sourceConnectorFor`. Required whenever `expand` is set; ignored
   *  otherwise. */
  expandDeps?: ExpandDeps;
  // ── Alias-aware query expansion (ISSUE-aliases-not-in-fulltext-retrieval) ──
  //
  // A note's frontmatter alias (e.g. `JHE` → "Jörg Herbers") lives in
  // `note_aliases`, NOT in `chunks_fts`. So `search_hybrid("JHE")` ranks
  // notes whose BODY contains the token "JHE" and never surfaces the
  // person note the alias points to. When the trimmed query EXACTLY
  // matches a known alias in a searched vault, inject/promote that
  // target note to the top of the result list. Surgical by design:
  // only fires on an exact alias match, never touches BM25/semantic
  // scoring, so non-alias queries are byte-identical to before (no FTS
  // re-baseline). Default ON; set false to restore pre-fix behavior.
  aliasExpansion?: boolean;
}

const DEFAULT_TOP_K = 10;
const DEFAULT_RRF_K = 60;
/** Minimum non-whitespace chars a chunk must contain to be sent to the
 *  reranker. Defends against degenerate near-empty chunks that survived
 *  the chunker (e.g. cross-version DBs) — they produce a constant rerank
 *  score across the pool and dilute the top-k. */
const MIN_RERANK_TRIM_CHARS = 20;

/**
 * Internal: ranked list of opaque item identifiers + the raw scores that
 * produced the ranking. Items must already be in best→worst order.
 */
export interface RankedList<T> {
  /** Items in best→worst order (rank 1 = items[0]). */
  items: readonly T[];
  /** Raw score per item, parallel to `items`. Optional — only used for
   *  breakdowns; RRF itself ignores it. */
  scores?: ReadonlyMap<T, number>;
}

export interface RrfMergeResult<T> {
  item: T;
  rrf: number;
  /** 1-based rank in each input list, or undefined if the item was absent. */
  ranks: (number | undefined)[];
}

/**
 * Pure RRF merge over N ranked lists. Exported for unit testing.
 *
 * Result is sorted by rrf desc; ties broken by lower minimum rank.
 */
export function rrfMerge<T>(
  rankings: ReadonlyArray<RankedList<T>>,
  k: number = DEFAULT_RRF_K,
): RrfMergeResult<T>[] {
  const scores = new Map<T, { rrf: number; ranks: (number | undefined)[] }>();

  rankings.forEach((list, listIdx) => {
    list.items.forEach((item, i) => {
      const rank = i + 1;
      const contribution = 1 / (k + rank);
      const existing = scores.get(item);
      if (existing) {
        existing.rrf += contribution;
        existing.ranks[listIdx] = rank;
      } else {
        const ranks: (number | undefined)[] = new Array(rankings.length).fill(undefined);
        ranks[listIdx] = rank;
        scores.set(item, { rrf: contribution, ranks });
      }
    });
  });

  const out: RrfMergeResult<T>[] = [];
  for (const [item, v] of scores) {
    out.push({ item, rrf: v.rrf, ranks: v.ranks });
  }
  out.sort((a, b) => {
    if (b.rrf !== a.rrf) return b.rrf - a.rrf;
    return minDefined(a.ranks) - minDefined(b.ranks);
  });
  return out;
}

function minDefined(xs: (number | undefined)[]): number {
  let m = Number.POSITIVE_INFINITY;
  for (const x of xs) {
    if (x !== undefined && x < m) m = x;
  }
  return m;
}

interface PerVaultHit {
  vaultName: string;
  chunkId: number;
  rrf: number;
  semanticScore?: number;
  textScore?: number;
  /** Set when a reranker re-scored this candidate. */
  rerankScore?: number;
}

export async function hybridSearch(opts: HybridSearchOptions): Promise<SearchHit[]> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const rrfK = opts.rrfK ?? DEFAULT_RRF_K;
  const includeBreakdown = opts.includeBreakdown ?? true;
  const query = opts.query.trim();

  if (topK <= 0 || query.length === 0 || opts.vaults.length === 0) {
    return [];
  }

  // Per-run query-embedding cache, keyed by model name. Multiple vaults
  // sharing the same embedding model only pay one Ollama round-trip.
  const embedCache = new Map<string, Promise<number[] | null>>();
  const getQueryVector = (model: string): Promise<number[] | null> => {
    const cached = embedCache.get(model);
    if (cached) return cached;
    const p = (async (): Promise<number[] | null> => {
      try {
        const res = await opts.ollama.embed({ model, texts: [query] });
        const v = res.vectors[0];
        return v ?? null;
      } catch {
        return null;
      }
    })();
    embedCache.set(model, p);
    return p;
  };

  const rerankFanOut = Math.max(1, opts.rerankFanOut ?? 5);
  // When reranking, we need a wider per-vault pool so the global candidate
  // set is large enough for the cross-encoder to re-order meaningfully.
  const perVaultTopN = opts.reranker ? topK * rerankFanOut : topK;

  // 03-05 M4: pass `excludeSuperseded` down to the candidate-list SQL.
  // The flag is read inside `searchOneVault` to pick the JOIN-and-filter
  // FTS statement and to post-filter the vec0 ANN result list via the
  // notes-status partial index. Filter happens at SQL level, not in JS.
  const excludeSuperseded = (opts.includeSuperseded ?? false) === false;
  const perVault = await Promise.all(
    opts.vaults.map((vault) =>
      searchOneVault(
        vault,
        query,
        opts.embeddingModel,
        rrfK,
        perVaultTopN,
        getQueryVector,
        excludeSuperseded,
      ),
    ),
  );

  // Global merge: each vault already returned its top-N RRF hits. We
  // re-sort by RRF score across vaults and take the candidate pool.
  const flat: PerVaultHit[] = perVault.flat();
  flat.sort((a, b) => b.rrf - a.rrf);

  // ── Phase 3 / 03-05 (D-07, ASM-07, ASM-11): post-RRF additive rescore ──
  //
  // Inserted BEFORE the reranker (the cross-encoder, when active, runs
  // on the rescored pool — rescore shapes the candidate-pool that the
  // reranker sees). When both weights are zero (v1 default), the guard
  // short-circuits entirely and the rescore loop does zero work and
  // zero DB reads — preserving v1 perf exactly.
  //
  // Math (per D-07):
  //   final = rrf + recencyWeight × exp(-age_days / halfLifeDays)
  //             + authorityWeight × (authoritative ? 1 : 0)
  //
  // Hydration here only fires when rescore weights are non-zero; the
  // `notes.mtime` + `notes.frontmatter` reads are cheap (`getById` is
  // a PK lookup) and only happen for the top-N candidates already in
  // `flat`, never for the full candidate pool. The v1 invariance test
  // (`hybrid.rescore.test.ts`) pins this — same DB-read count as v1.
  const recencyWeight = opts.recencyWeight ?? 0;
  const authorityWeight = opts.authorityWeight ?? 0;
  if (recencyWeight !== 0 || authorityWeight !== 0) {
    const clock = opts.clock ?? Date.now;
    const now = clock();
    const halfLifeMs = (opts.halfLifeDays ?? 30) * 24 * 60 * 60 * 1000;
    const vaultByNameLocal = new Map<string, Vault>();
    for (const v of opts.vaults) vaultByNameLocal.set(v.config.name, v);
    for (const h of flat) {
      const vault = vaultByNameLocal.get(h.vaultName);
      if (!vault) continue;
      const chunk = vault.db.chunks.getById(h.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;
      const ageMs = Math.max(0, now - note.mtime);
      const recencyTerm = recencyWeight * Math.exp(-ageMs / halfLifeMs);
      let authoritative = false;
      if (authorityWeight !== 0 && note.frontmatter) {
        try {
          const fm = JSON.parse(note.frontmatter) as Record<string, unknown>;
          authoritative = fm["authoritative"] === true;
        } catch {
          // Malformed JSON in notes.frontmatter is treated as
          // non-authoritative — never throw out of the rescore loop.
          authoritative = false;
        }
      }
      const authorityTerm = authorityWeight * (authoritative ? 1.0 : 0);
      h.rrf += recencyTerm + authorityTerm;
    }
    flat.sort((a, b) => b.rrf - a.rrf);
  }

  // Optional cross-encoder rerank: re-score the global top-(topK*fanOut)
  // candidates with the reranker, then resort by rerank score. On any
  // failure, fall back silently to the RRF order.
  let winners: PerVaultHit[];
  if (opts.reranker && flat.length > 0) {
    const poolSize = Math.min(flat.length, topK * rerankFanOut);
    const pool = flat.slice(0, poolSize);
    const vaultByNameLocal = new Map<string, Vault>();
    for (const v of opts.vaults) vaultByNameLocal.set(v.config.name, v);
    const texts: string[] = [];
    const indexed: { hit: PerVaultHit; text: string }[] = [];
    for (const h of pool) {
      const vault = vaultByNameLocal.get(h.vaultName);
      if (!vault) continue;
      const chunk = vault.db.chunks.getById(h.chunkId);
      if (!chunk) continue;
      // Skip near-empty chunks: cross-encoder produces a near-constant
      // score for them, which would dilute the pool. They keep their RRF
      // position (still appear in `flat`) but are not re-ranked.
      if (chunk.text.trim().length < MIN_RERANK_TRIM_CHARS) continue;
      indexed.push({ hit: h, text: chunk.text });
      texts.push(chunk.text);
    }
    if (indexed.length === 0) {
      // All pool candidates were filtered as too-short — fall back to RRF
      // order across `flat` rather than calling the reranker on nothing.
      winners = flat.slice(0, topK);
    } else
      try {
        const scores = await opts.reranker.score(query, texts);
        if (scores.length !== indexed.length) {
          throw new Error(`reranker returned ${scores.length} scores for ${indexed.length} chunks`);
        }
        for (let i = 0; i < indexed.length; i++) {
          const entry = indexed[i]!;
          const s = scores[i]!;
          entry.hit.rerankScore = s;
        }
        const reranked = indexed.map((e) => e.hit);
        reranked.sort((a, b) => {
          const ra = a.rerankScore ?? Number.NEGATIVE_INFINITY;
          const rb = b.rerankScore ?? Number.NEGATIVE_INFINITY;
          if (rb !== ra) return rb - ra;
          return b.rrf - a.rrf;
        });
        winners = reranked.slice(0, topK);
      } catch {
        // Reranker failed — fall back to RRF order. Clear any partial
        // rerankScore so the breakdown does not misrepresent the result.
        for (const h of pool) delete h.rerankScore;
        winners = flat.slice(0, topK);
      }
  } else {
    winners = flat.slice(0, topK);
  }

  // Hydrate to SearchHit. Look up via the originating vault's DB.
  const vaultByName = new Map<string, Vault>();
  for (const v of opts.vaults) vaultByName.set(v.config.name, v);

  const hits: SearchHit[] = [];
  for (const h of winners) {
    const vault = vaultByName.get(h.vaultName);
    if (!vault) continue;
    const chunk = vault.db.chunks.getById(h.chunkId);
    if (!chunk) continue;
    const note = vault.db.notes.getById(chunk.note_id);
    if (!note) continue;
    const hit: SearchHit = {
      vault: vault.config.name,
      notePath: note.path,
      noteTitle: note.title,
      chunkText: chunk.text,
      chunkIdx: chunk.idx,
      headingPath: chunk.heading_path,
      // Surface the rerank score as the primary score when present —
      // it's the final order the caller sees.
      score: h.rerankScore ?? h.rrf,
    };
    if (includeBreakdown) {
      const breakdown: NonNullable<SearchHit["scoreBreakdown"]> = {
        rrf: h.rrf,
      };
      if (h.semanticScore !== undefined) breakdown.semantic = h.semanticScore;
      if (h.textScore !== undefined) breakdown.text = h.textScore;
      if (h.rerankScore !== undefined) breakdown.rerank = h.rerankScore;
      hit.scoreBreakdown = breakdown;
    }
    // ── Phase 3 / 03-05 (ASM-06, D-08): hydrate 9 optional citation fields ──
    //
    // All piggyback on the `note` + `chunk` rows already loaded above —
    // no extra DB read for mtime/hash/status/properties. `heading_path`
    // needs one extra indexed lookup via `SectionsQueries.findContainingChunk`
    // (O(log N) on the `sections_chunk_range` index from migration 010).
    //
    // Per D-08 these fields are additive: v1 callers see a SearchHit
    // whose JSON output is byte-identical to v1 because every new field
    // either populates with a value or is left undefined (and omitted
    // from the JSON serialization).
    let docId: DocId | undefined;
    let sourceHandle: SourceHandle | undefined;
    try {
      docId = formatDocId("obsidian-fs", vault.config.name, note.path);
      sourceHandle = parseSourceHandle(`obsidian-fs://${vault.config.name}`);
    } catch {
      // Malformed vault-name / path → keep doc_id / source_handle
      // undefined rather than failing the whole hit.
    }
    if (docId !== undefined) hit.doc_id = docId;
    if (sourceHandle !== undefined) hit.source_handle = sourceHandle;
    hit.mtime = note.mtime;
    hit.hash = note.hash;
    // Display URL via the injected resolver — keeps the URL minting
    // confined to the source adapter (ADR-002 §I-5b). When the resolver
    // is omitted (test fixtures, smoke tests), display_url stays
    // undefined and is omitted from the JSON response.
    if (opts.displayUrlFor !== undefined) {
      try {
        hit.display_url = opts.displayUrlFor(vault.config.name, note.path);
      } catch {
        // Resolver throws (e.g. unknown vault) → leave display_url
        // unset rather than fail the whole hit.
      }
    }
    // Frontmatter parse — best-effort. Stored as JSON-stringified text
    // by the indexer (src/indexer/indexer.ts:176); malformed JSON
    // produces undefined `properties` rather than throwing.
    let props: Record<string, unknown> | undefined;
    if (note.frontmatter) {
      try {
        props = JSON.parse(note.frontmatter) as Record<string, unknown>;
      } catch {
        props = undefined;
      }
    }
    if (props !== undefined) hit.properties = props;
    // Read denormalized status directly from notes table — single column
    // lookup, no JSON parse. Falls through to props-derived only when the
    // denormalized column is null (legacy / pre-backfill rows).
    const status = vault.db.notes.getStatus(note.id);
    if (typeof status === "string") {
      hit.status = status;
    } else if (typeof props?.status === "string") {
      hit.status = props.status;
    }
    if (typeof props?.["superseded_by"] === "string") {
      hit.superseded_by = props["superseded_by"] as string;
    }
    // Section heading path — promote chunk → enclosing section when one
    // exists. The query is indexed (`sections_chunk_range`) and runs at
    // most once per result hit, so the cost stays bounded by topK.
    const section = vault.db.sections.findContainingChunk(note.id, chunk.id);
    if (section) {
      try {
        hit.heading_path = JSON.parse(section.heading_path) as string[];
      } catch {
        // Malformed JSON heading_path → leave heading_path undefined.
      }
    }
    hits.push(hit);
  }

  // ── Phase 4 / 04-04 / GRA-03 (D-15, D-16): post-rescore expand attachment ──
  //
  // When `opts.expand` is undefined (the v1/v2 default), this guard
  // short-circuits entirely — zero new DB reads, zero new computation,
  // preserving v1-baseline byte-identical behavior. Expand runs AFTER
  // Phase 3 recency/authority rescore and AFTER hit hydration so that
  // expansions attach to the RESCORED top-K (D-16). Expand never
  // participates in score computation; top-K ranking is stable.
  //
  // Deviation from plan §<action> pseudocode (Rule 3 - Blocking):
  // the plan referenced `expand(vault, {...})` but the actual
  // `expand()` signature is `expand(deps, opts)` where `deps =
  // {manager, sourceConnectorFor}` (locked by Plan 04-03). We use the
  // real signature and inject deps via `opts.expandDeps`. A single
  // expand() call handles ALL hit seeds — `expand()` already groups
  // seeds by vault internally (see `src/graph/expand.ts` `byVault`
  // map), so cross-vault traversal is already prevented at the
  // expand() boundary (T-04-04-02 mitigation: per-vault BFS isolation
  // happens inside expand()).
  if (opts.expand && opts.expandDeps && hits.length > 0) {
    const seedDocIds: DocId[] = [];
    for (const hit of hits) {
      if (hit.doc_id !== undefined) seedDocIds.push(hit.doc_id);
    }
    if (seedDocIds.length > 0) {
      try {
        const expansionInput: Parameters<typeof expand>[1] = {
          seed_doc_ids: seedDocIds,
          hops: opts.expand.hops,
          direction: opts.expand.direction ?? "both",
        };
        if (opts.expand.edge_types !== undefined) {
          expansionInput.edge_types = opts.expand.edge_types;
        }
        const result = await expand(opts.expandDeps, expansionInput);
        // Group by `via.seed_doc_id` (D-15). One pass; O(n) where n is
        // the total expansion-doc count.
        const bySeed = new Map<DocId, CitationPacketWithVia[]>();
        for (const doc of result.documents) {
          const seedId = doc.via.seed_doc_id;
          const arr = bySeed.get(seedId);
          if (arr) arr.push(doc);
          else bySeed.set(seedId, [doc]);
        }
        for (const hit of hits) {
          if (hit.doc_id !== undefined) {
            hit.expansions = bySeed.get(hit.doc_id) ?? [];
          }
        }
      } catch {
        // Expand failures are silent. The rest of the hybrid result
        // is intact; only the `expansions` field stays unset. This
        // matches the defensive posture of the reranker fallback
        // (lines 342–347 above).
      }
    }
  }

  // ── Alias-aware query expansion (ISSUE-aliases-not-in-fulltext-retrieval) ──
  //
  // If the exact query string is a known alias in one of the searched
  // vaults, ensure that alias's target note is in the result set, at the
  // top. This runs LAST (after rescore, rerank, hydration, expand) so it
  // never perturbs scoring of the organically-retrieved hits. Guard: only
  // fires when aliasExpansion !== false AND the query exactly matches an
  // alias — so non-alias queries do zero extra DB work and are unchanged.
  if ((opts.aliasExpansion ?? true) === true) {
    for (const vault of opts.vaults) {
      let resolved;
      try {
        resolved = vault.db.aliases.resolve(query);
      } catch {
        continue; // alias table missing / malformed → skip this vault
      }
      if (!resolved) continue;
      const note = vault.db.notes.getById(resolved.note_id);
      if (!note) continue;
      // Already surfaced organically? Promote it to the front instead of
      // duplicating, so the alias target is the top hit either way.
      const existingIdx = hits.findIndex(
        (h) => h.vault === vault.config.name && h.notePath === note.path,
      );
      if (existingIdx >= 0) {
        const [existing] = hits.splice(existingIdx, 1);
        if (existing) hits.unshift(existing);
        continue;
      }
      // Build a hit from the note's first chunk (person/stub notes may have
      // exactly one). If the note has no chunks, synthesize a minimal hit
      // from the note row so the alias still resolves to something useful.
      const firstChunk = vault.db.chunks.getByNote(note.id)[0];
      const aliasHit: SearchHit = {
        vault: vault.config.name,
        notePath: note.path,
        noteTitle: note.title,
        chunkText: firstChunk?.text ?? note.title,
        chunkIdx: firstChunk?.idx ?? 0,
        headingPath: firstChunk?.heading_path ?? null,
        // Alias matches are exact metadata hits — rank above fuzzy results.
        score: 1,
      };
      if (includeBreakdown) {
        aliasHit.scoreBreakdown = { rrf: 1, alias: resolved.alias };
      }
      try {
        aliasHit.doc_id = formatDocId("obsidian-fs", vault.config.name, note.path);
        aliasHit.source_handle = parseSourceHandle(`obsidian-fs://${vault.config.name}`);
      } catch {
        // keep doc_id/source_handle undefined on malformed name/path
      }
      aliasHit.mtime = note.mtime;
      aliasHit.hash = note.hash;
      if (opts.displayUrlFor !== undefined) {
        try {
          aliasHit.display_url = opts.displayUrlFor(vault.config.name, note.path);
        } catch {
          // leave display_url unset on resolver throw
        }
      }
      if (note.frontmatter) {
        try {
          aliasHit.properties = JSON.parse(note.frontmatter) as Record<string, unknown>;
        } catch {
          // malformed frontmatter → no properties
        }
      }
      const status = vault.db.notes.getStatus(note.id);
      if (typeof status === "string") aliasHit.status = status;
      hits.unshift(aliasHit);
      // One exact-alias match is enough; the shortest-path winner already
      // won inside resolve(). Stop after the first vault that resolves it.
      break;
    }
  }

  return hits;
}

/**
 * Search a single vault. Resolves semantic + BM25 in parallel, RRF-merges,
 * returns the vault's top-N candidates (we keep topK so the global merge
 * has enough to draw from).
 */
async function searchOneVault(
  vault: Vault,
  query: string,
  embeddingModelName: string,
  rrfK: number,
  topK: number,
  getQueryVector: (model: string) => Promise<number[] | null>,
  /** 03-05 M4: when true, the FTS path uses the JOIN-and-filter
   *  prepared statement against `notes.status`, and the vec0 ANN
   *  result list is post-filtered via `getSupersededChunkIds`. When
   *  false (the v1 default), both candidate paths are byte-identical
   *  to v1. */
  excludeSuperseded = false,
): Promise<PerVaultHit[]> {
  const fanK = Math.max(topK * 3, topK);

  // Resolve the model to use for semantic search.
  //
  // Phase 7c follow-up (v0.7.2): the *active* model in the DB is the source
  // of truth — `switch_active_model` may have promoted a shadow model that
  // doesn't match the config's `default_embedding_model`. The config-named
  // model is only a fallback used when no active model has been registered
  // yet (fresh vault).
  const activeModel = vault.db.models.getActive();
  const queryModelName = activeModel?.name ?? embeddingModelName;
  const canRunSemantic = activeModel !== null;

  const semanticPromise: Promise<{
    chunkIds: number[];
    distances: Map<number, number>;
  } | null> = canRunSemantic
    ? (async () => {
        const vec = await getQueryVector(queryModelName);
        if (!vec) return null;
        const hits = vault.db.embeddings.searchSemantic(activeModel.id, vec, fanK);
        const distances = new Map<number, number>();
        const chunkIds: number[] = [];
        for (const h of hits) {
          chunkIds.push(h.chunkId);
          distances.set(h.chunkId, h.distance);
        }
        // 03-05 M4: post-filter vec0 KNN results via the notes_status
        // partial index. vec0 virtual tables don't compose with JOINs
        // the way FTS5 does, so the filter runs as a single follow-up
        // SQL with a parametric IN list. Still SQL-level — zero
        // frontmatter parses. v1 path (excludeSuperseded = false)
        // skips this entirely.
        if (excludeSuperseded && chunkIds.length > 0) {
          const supSet = vault.db.notes.getSupersededChunkIds(chunkIds);
          if (supSet.size > 0) {
            const filtered: number[] = [];
            for (const id of chunkIds) {
              if (!supSet.has(id)) filtered.push(id);
              else distances.delete(id);
            }
            return { chunkIds: filtered, distances };
          }
        }
        return { chunkIds, distances };
      })()
    : Promise.resolve(null);

  const bm25Promise: Promise<{
    chunkIds: number[];
    scores: Map<number, number>;
  }> = Promise.resolve().then(() => {
    const hits = vault.db.fts.search(query, fanK, false, excludeSuperseded);
    const scores = new Map<number, number>();
    const chunkIds: number[] = [];
    for (const h of hits) {
      chunkIds.push(h.chunkId);
      scores.set(h.chunkId, h.score);
    }
    return { chunkIds, scores };
  });

  const [semantic, bm25] = await Promise.all([semanticPromise, bm25Promise]);

  const rankings: RankedList<number>[] = [];
  if (semantic && semantic.chunkIds.length > 0) {
    rankings.push({ items: semantic.chunkIds, scores: semantic.distances });
  }
  if (bm25.chunkIds.length > 0) {
    rankings.push({ items: bm25.chunkIds, scores: bm25.scores });
  }

  if (rankings.length === 0) return [];

  // Track which list is which for breakdown extraction below.
  const semanticListIdx = semantic && semantic.chunkIds.length > 0 ? 0 : -1;
  const bm25ListIdx = rankings.length === 2 ? 1 : semanticListIdx === -1 ? 0 : -1;

  const merged = rrfMerge(rankings, rrfK).slice(0, topK);

  return merged.map((m) => {
    const hit: PerVaultHit = {
      vaultName: vault.config.name,
      chunkId: m.item,
      rrf: m.rrf,
    };
    if (semanticListIdx !== -1 && m.ranks[semanticListIdx] !== undefined) {
      const d = semantic!.distances.get(m.item);
      if (d !== undefined) hit.semanticScore = d;
    }
    if (bm25ListIdx !== -1 && m.ranks[bm25ListIdx] !== undefined) {
      const s = bm25.scores.get(m.item);
      if (s !== undefined) hit.textScore = s;
    }
    return hit;
  });
}
