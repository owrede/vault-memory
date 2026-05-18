/**
 * Phase 5 — `src/brief/` barrel.
 *
 * Wave 0 (Plan 05-01) — slice-1 exports only:
 *   - canonical chunk-hash / fragment helpers (re-exported from the
 *     chunker so brief consumers have one import surface);
 *   - branded `ChunkId` + `parseChunkId` / `formatChunkId` /
 *     `decomposeChunkId`;
 *   - `buildSourceHashes` / `recomputeCurrentHash`.
 *
 * Later slices (05-02, 05-03, 05-04) extend this barrel with:
 *   - `handleCompileBrief`, `handleGetBrief` (slice 2);
 *   - `BriefBodyValidator`, `BriefStalenessDaemon`, lockfile (slice 3);
 *   - `list_briefs` Resource (slice 4).
 *
 * No fs / gray-matter / chokidar / path imports in any slice-1 file
 * (`scripts/lint-adapters.sh` enforces).
 */

export { computeChunkHash, computeChunkIdFragment } from "./source-hashes.js";
export {
  buildSourceHashes,
  recomputeCurrentHash,
  type ChunkSource,
} from "./source-hashes.js";
export {
  parseChunkId,
  formatChunkId,
  decomposeChunkId,
  type ChunkId,
} from "./chunk-id.js";
