/**
 * Branded `ChunkId` for the public Phase 5 / D-04 chunk-identifier.
 *
 * Format: `<DocId>#chunk-<fragment>` where `<fragment>` is the 7-hex
 * output of `computeChunkIdFragment` (`src/chunker/chunk-id.ts`).
 *
 * Mirrors the IIFE-closed branding idiom from
 * `src/adapters/registry.ts:67-94` — the only validating parser is
 * exported; the raw brand-cast (`mint`) is closed inside the IIFE so
 * arbitrary strings cannot reach the brand without passing the regex
 * check.
 *
 * Pure module. No fs / gray-matter / chokidar / path imports.
 */

import type { DocId } from "../types.js";
import type { ChunkId } from "../types.js";

/**
 * `chunk_id_fragment` shape: exactly 7 lowercase hex characters.
 * Matches the slice from `computeChunkHash(text).slice(7, 14)`.
 */
const FRAGMENT_REGEX = /^[0-9a-f]{7}$/;

/**
 * Public ChunkId shape: `<scheme>://<authority>/<resource>#chunk-<frag>`.
 *
 * The DocId prefix is validated structurally here (lowercase scheme,
 * non-empty authority + resource); the full DocId-pattern test lives
 * in `src/adapters/registry.ts`. Both must accept the same DocId space.
 */
const CHUNK_ID_REGEX = /^([a-z][a-z0-9-]*:\/\/[^/]+\/.+)#chunk-([0-9a-f]{7})$/;

const { parseChunkId, formatChunkId, decomposeChunkId } = (() => {
  const mint = (s: string): ChunkId => s as ChunkId;

  function format(docId: DocId, fragment: string): ChunkId {
    if (!FRAGMENT_REGEX.test(fragment)) {
      throw new Error(
        `Invalid chunk fragment: ${JSON.stringify(fragment)}. ` +
          "Expected exactly 7 lowercase hex characters (per ADR-005 / D-04).",
      );
    }
    return mint(`${docId}#chunk-${fragment}`);
  }

  function parse(s: string): ChunkId {
    if (!CHUNK_ID_REGEX.test(s)) {
      throw new Error(
        `Invalid ChunkId: ${JSON.stringify(s)}. ` + "Expected <DocId>#chunk-<7-hex-fragment>.",
      );
    }
    return mint(s);
  }

  function decompose(id: ChunkId): { docId: DocId; fragment: string } {
    const m = CHUNK_ID_REGEX.exec(id);
    if (!m) {
      // Branding guarantees this branch is unreachable in well-typed
      // code, but a defensive check costs nothing.
      throw new Error(`Malformed ChunkId reached decomposeChunkId: ${JSON.stringify(id)}`);
    }
    return { docId: m[1] as DocId, fragment: m[2]! };
  }

  return { parseChunkId: parse, formatChunkId: format, decomposeChunkId: decompose };
})();

export { parseChunkId, formatChunkId, decomposeChunkId };
export type { ChunkId };
