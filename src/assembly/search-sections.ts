/**
 * `searchSections` — the ASM-03 controller.
 *
 * Section-level retrieval that COMPOSES (does not reimplement) the v1
 * chunk-level hybrid pipeline (`hybridSearch`) with a chunk → section
 * promotion step.
 *
 * Composition algorithm (per 03-RESEARCH.md §3 option 3):
 *
 *   1. Run `hybridSearch` with an inflated `topK = limit * 5`. The
 *      multiplier is a cushion: a section may span 1..N chunks, so we
 *      need enough chunk candidates that the top `limit` sections all
 *      land in the post-promotion set.
 *   2. Promote each chunk hit to its enclosing section via
 *      `findContainingChunk`. A chunk that does NOT map to any section
 *      (legacy pre-migration-010 row, or a chunk whose section has
 *      NULL `chunk_id_first`/`chunk_id_last`) is silently dropped.
 *   3. De-duplicate by `(note_id, anchor)`. When multiple chunk hits
 *      land in the same section, the section's score is the MAX of
 *      the constituent chunk scores — the natural reading of
 *      "how relevant is this section". RRF rank-position scores would
 *      systematically punish short sections under summation; max is
 *      both fairer and easier to reason about.
 *   4. Sort by score DESC; tie-break by `chunk_id_first` ASC so
 *      earlier sections in document order win deterministic ties.
 *   5. Slice to `limit`. Hydrate the surviving sections into
 *      `SectionHit` packets via the `Document` returned by the
 *      injected `SourceConnector` so callers always get the canonical
 *      8-field citation floor PLUS the section-specific extras
 *      (anchor, score, chunk_ids, snippet).
 *
 * Adapter-seam discipline (ADR-002 §Invariants, enforced by
 * `scripts/lint-adapters.sh`): this module imports NOTHING from
 * `node:fs`, `node:path`, `gray-matter`, or `chokidar`. All FS / vault-
 * content access goes through injected dependencies (`searchHybrid`,
 * `sectionForHit`, `readDocument`, `displayUrlFor`).
 *
 * Inflight-dependency note: slice 03-05 extends `hybridSearch` with
 * optional `recency_weight`, `authority_weight`, `include_superseded`
 * params (additive). This controller accepts those args from callers
 * but, until 03-05 merges, the production wiring forwards only the
 * subset that `hybridSearch` currently understands. The Zod schema in
 * `tool-registry.ts` accepts the full set so the wire surface is
 * forward-compatible; see `.planning/phases/03-bundles-authority-staleness/03-03-DEVIATIONS.md`.
 */

import type { DocId, Document, SearchHit, SourceHandle } from "../types.js";
import type { CitationPacket } from "../memory/citation-packet.js";
import { toCitationPacket } from "../memory/citation-packet.js";

/**
 * Input shape for the `search_sections` MCP tool. Validated upstream
 * by Zod in `tool-registry.ts`; this is the post-validation shape.
 */
export interface SearchSectionsArgs {
  query: string;
  limit: number;
  vaults?: string[];
  /** Forwarded to `hybridSearch` once slice 03-05 lands. Placeholder
   *  until then — see file-header inflight note. */
  recency_weight?: number;
  authority_weight?: number;
  include_superseded?: boolean;
}

/**
 * Minimal projection of a `SectionRow` carrying only what the promotion
 * step needs. Keeps the dependency surface narrow so test stubs do not
 * have to fabricate the full DB row.
 */
export interface SectionResolution {
  /** Numeric DB note id; carried only for the dedup key. */
  noteId: number;
  /** Section's content-hash anchor (ADR-003 H-7). */
  anchor: string;
  /** Section heading path (root → leaf). Empty for preamble (level 0). */
  headingPath: string[];
  /** For deterministic tiebreak: section's earliest chunk_id_first. */
  chunkIdFirst: number;
}

/**
 * Input passed to the injected `searchHybrid` dep. Mirrors the subset
 * of `HybridSearchOptions` this controller drives. Server bootstrap
 * supplies the production closure; tests inject a stub.
 *
 * Slice 03-05 will additively widen this with the rescore params; the
 * fields are already accepted (and IGNORED) here so a one-line wiring
 * change suffices once 03-05 lands.
 */
export interface SearchSectionsHybridInput {
  query: string;
  topK: number;
  vaults?: string[];
}

export interface SearchSectionsDeps {
  /** Inner chunk-level hybrid search. */
  searchHybrid: (input: SearchSectionsHybridInput) => Promise<SearchHit[]>;
  /**
   * Resolve the section enclosing a chunk hit. Returns `null` when no
   * containing section exists (orphan chunk — silently dropped).
   *
   * The hit identifies a chunk via `(vault, notePath, chunkIdx)`. The
   * adapter wiring is responsible for the chunkIdx → chunk_id lookup
   * and the `SectionsQueries.findContainingChunk` call.
   */
  sectionForHit: (
    vaultName: string,
    notePath: string,
    chunkIdx: number,
  ) => SectionResolution | null;
  /**
   * Read the canonical `Document` for a (vault, notePath) so the
   * SectionHit can carry the full 8-field citation packet floor.
   * Throws when the doc is missing — callers may silently drop on
   * throw (stale index row), but this controller surfaces the error.
   */
  readDocument: (vaultName: string, notePath: string) => Promise<Document>;
  /**
   * Adapter-mediated display URL for a `DocId`. Same seam used by
   * recall (`citation-packet.displayUrlFor`); the wiring passes a
   * closure that resolves via `SourceConnector.formatDisplayUrl`.
   */
  displayUrlFor: (docId: DocId, vaultName: string) => string;
}

/**
 * Section-level retrieval response item. Extends the 8-field citation
 * packet floor (D-01) with the section-specific extras called out in
 * the plan's "Section hit shape" table.
 */
export interface SectionHit extends CitationPacket {
  /** Section's canonical content-hash anchor (ADR-003 H-7). */
  anchor: string;
  /** MAX of the constituent chunk scores. */
  score: number;
  /** Snippet from the highest-scoring contributing chunk. */
  snippet?: string;
  /** Every chunk_idx that contributed to this section in this query. */
  chunk_ids: number[];
}

/**
 * Multiplier applied to `limit` when sizing the inner `hybridSearch`
 * candidate pool. Rationale: a section may span 1..N chunks, so we
 * need enough chunk candidates that the top `limit` sections (post-
 * promotion + dedup) are all represented. 5× is the same cushion the
 * v1 reranker uses for its fan-out (`hybrid.ts:rerankFanOut`).
 */
const TOP_K_INFLATION_FACTOR = 5;

/**
 * Internal accumulator shape — tracks the constituent chunks of a
 * section as we walk the chunk hits.
 */
interface SectionAccumulator {
  resolution: SectionResolution;
  /** The hit whose score is currently the section's max. */
  bestHit: SearchHit;
  bestScore: number;
  /** Every contributing `chunkIdx` (used for `SectionHit.chunk_ids`). */
  chunkIdxs: number[];
  /** Owning vault name — needed for the per-hit `Document` read. */
  vaultName: string;
  /** Owning note path — needed for the per-hit `Document` read. */
  notePath: string;
}

/**
 * Run section-level retrieval. See the file header for the full
 * composition algorithm.
 */
export async function searchSections(
  deps: SearchSectionsDeps,
  args: SearchSectionsArgs,
): Promise<SectionHit[]> {
  // 1) Inflate topK and call the inner hybrid pipeline. A single call
  //    keeps the v1 RRF (+ optional rerank) byte-identical.
  const chunkHits = await deps.searchHybrid({
    query: args.query,
    topK: args.limit * TOP_K_INFLATION_FACTOR,
    vaults: args.vaults,
  });

  if (chunkHits.length === 0) return [];

  // 2) Promote each chunk hit to its enclosing section, accumulating
  //    by `(note_id, anchor)`. Drop orphan chunks silently.
  const sectionMap = new Map<string, SectionAccumulator>();
  for (const hit of chunkHits) {
    const resolution = deps.sectionForHit(hit.vault, hit.notePath, hit.chunkIdx);
    if (!resolution) continue;
    // Plan acceptance: heading_path always non-empty. Preamble
    // (level 0, empty heading_path) is dropped — preamble has no
    // human-readable anchor and would surface as a citation with no
    // heading, which is precisely what the acceptance excludes.
    if (resolution.headingPath.length === 0) continue;

    const key = `${resolution.noteId}#${resolution.anchor}`;
    const existing = sectionMap.get(key);
    if (!existing) {
      sectionMap.set(key, {
        resolution,
        bestHit: hit,
        bestScore: hit.score,
        chunkIdxs: [hit.chunkIdx],
        vaultName: hit.vault,
        notePath: hit.notePath,
      });
      continue;
    }
    // Section already seen — add chunkIdx, raise max score if needed.
    existing.chunkIdxs.push(hit.chunkIdx);
    if (hit.score > existing.bestScore) {
      existing.bestScore = hit.score;
      existing.bestHit = hit;
    }
  }

  if (sectionMap.size === 0) return [];

  // 3) Sort by score DESC, tie-break by `chunk_id_first` ASC. Earlier
  //    sections in document order win deterministic ties.
  const sorted = [...sectionMap.values()].sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return a.resolution.chunkIdFirst - b.resolution.chunkIdFirst;
  });

  // 4) Slice to limit BEFORE hydration — avoids paying for `Document`
  //    reads on losing sections.
  const winners = sorted.slice(0, args.limit);

  // 5) Hydrate each surviving section into a `SectionHit`. The
  //    citation packet is built from the full `Document` (via the
  //    injected `readDocument` dep) so we get the canonical hash +
  //    full property bag. The section-specific fields override
  //    `heading_path` (with the section's path) and add anchor /
  //    score / chunk_ids / snippet.
  const hits: SectionHit[] = [];
  for (const acc of winners) {
    let doc: Document;
    try {
      doc = await deps.readDocument(acc.vaultName, acc.notePath);
    } catch {
      // Stale index pointer to a deleted doc — silently drop, as
      // recall does. The post-slice + drop means the result count
      // may dip below `limit` in this edge case; we accept that
      // rather than re-running with a larger inflation factor.
      continue;
    }
    const packet = toCitationPacket(
      {
        id: doc.id,
        source: doc.source,
        title: doc.title,
        mtime: doc.mtime,
        hash: doc.hash,
        properties: doc.properties,
        heading_path: acc.resolution.headingPath,
      },
      deps.displayUrlFor(doc.id, acc.vaultName),
    );
    const hit: SectionHit = {
      ...packet,
      anchor: acc.resolution.anchor,
      score: acc.bestScore,
      chunk_ids: [...acc.chunkIdxs],
    };
    if (acc.bestHit.chunkText.length > 0) {
      hit.snippet = acc.bestHit.chunkText;
    }
    hits.push(hit);
  }

  return hits;
}

// Re-exports for ergonomic imports.
export type { CitationPacket, DocId, Document, SearchHit, SourceHandle };
