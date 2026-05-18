/**
 * Phase 5 — brief `source_hashes` builder and recompute helper.
 *
 * `source_hashes: Record<ChunkId, BriefSourceHash>` is the staleness
 * contract per ADR-005 §"Chunk-level source_hashes (ChunkId)". The
 * brief carries one entry per cited chunk; the daemon walks
 * `brief_sources` (D-06 reverse-index) on a ChangeEvent and compares
 * `recorded_hash` to the current `computeChunkHash(text)` — divergence
 * flips the brief to `status: stale` with `changed_sources` populated.
 *
 * Pure module. The chunker helper (`src/chunker/chunk-id.ts`) is the
 * single source of truth for the hash; we re-export it here so the
 * `src/brief/` barrel is the one-stop import surface for brief
 * consumers. No fs / gray-matter / chokidar / path imports.
 */

import { computeChunkHash, computeChunkIdFragment } from "../chunker/chunk-id.js";
import { formatChunkId } from "./chunk-id.js";
import type { ChunkId } from "../types.js";
import type { BriefSourceHash, DocId } from "../types.js";

// Re-export the canonical chunk-hash + chunk-id-fragment functions so
// brief consumers can import everything they need from `src/brief/`.
// The originals live in `src/chunker/chunk-id.ts` — there is exactly
// one implementation site for the canonicalization algorithm.
export { computeChunkHash, computeChunkIdFragment };

/**
 * Per-chunk input shape for `buildSourceHashes`. The brief layer
 * resolves source DocIds to chunks via the existing notes→chunks join
 * (the in-process resolver lives in slice 2, alongside `compile_brief`);
 * the helper here is intentionally decoupled from the DB so it can be
 * unit-tested against pure inputs.
 */
export interface ChunkSource {
  /** DocId of the document containing this chunk. */
  docId: DocId;
  /** 7-hex fragment from the `chunks.chunk_id_fragment` column. */
  fragment: string;
  /** Canonical chunk text (already pulled from `chunks.text`). */
  text: string;
}

/**
 * Build the `source_hashes` map for a brief. For each chunk in
 * `sources`, format the public ChunkId and compute the full
 * `"sha256:<hex>"` hash recorded at brief-compile time.
 *
 * Consumers (slice 2 `compile_brief`) resolve `sources` from
 * `source_doc_ids` via the notes+chunks join then pass the result here.
 * Keeping the DB join out of this module preserves the pure-function
 * discipline and lets the eval harness exercise the contract with
 * deterministic fixtures.
 */
export function buildSourceHashes(
  sources: readonly ChunkSource[],
): Record<ChunkId, BriefSourceHash> {
  const out: Record<ChunkId, BriefSourceHash> = {};
  for (const chunk of sources) {
    const chunkId = formatChunkId(chunk.docId, chunk.fragment);
    out[chunkId] = computeChunkHash(chunk.text) as BriefSourceHash;
  }
  return out;
}

/**
 * Recompute the current hash for one chunk's canonical text. The
 * daemon uses this on each `ChangeEvent` to compare against
 * `brief_sources.recorded_hash` for an O(log N) staleness check.
 */
export function recomputeCurrentHash(text: string): BriefSourceHash {
  return computeChunkHash(text) as BriefSourceHash;
}
