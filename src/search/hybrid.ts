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
import type { SearchHit } from "../types.js";
import type { Reranker } from "../rerank/index.js";

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

  const perVault = await Promise.all(
    opts.vaults.map((vault) =>
      searchOneVault(vault, query, opts.embeddingModel, rrfK, perVaultTopN, getQueryVector),
    ),
  );

  // Global merge: each vault already returned its top-N RRF hits. We
  // re-sort by RRF score across vaults and take the candidate pool.
  const flat: PerVaultHit[] = perVault.flat();
  flat.sort((a, b) => b.rrf - a.rrf);

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
    hits.push(hit);
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
        return { chunkIds, distances };
      })()
    : Promise.resolve(null);

  const bm25Promise: Promise<{
    chunkIds: number[];
    scores: Map<number, number>;
  }> = Promise.resolve().then(() => {
    const hits = vault.db.fts.search(query, fanK);
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
