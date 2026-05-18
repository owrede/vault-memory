/**
 * Phase 5 — chunk-fragment computation.
 *
 * Per ADR-005 §"Decision: Chunk-level source_hashes (ChunkId)" and
 * ADR-003 H-3 (NFC) + H-4 (LF) + Pitfall 8 (trim trailing whitespace):
 *
 *   canonical = text.replace(/\r\n/g, "\n").trimEnd().normalize("NFC")
 *   hash      = "sha256:" + sha256_hex(canonical)
 *   fragment  = hash.slice("sha256:".length, "sha256:".length + 7)
 *
 * `computeChunkHash` is the **single source of truth** for both
 * `chunks.chunk_id_fragment` (D-04) AND the brief
 * `source_hashes.recorded_hash` value. Scattered `createHash` calls
 * across call sites are an anti-pattern (RESEARCH §Pitfall 14).
 *
 * Pure function. No fs / gray-matter / chokidar / path imports. The
 * adapter-seam linter (`scripts/lint-adapters.sh`) enforces this.
 */

import { createHash } from "node:crypto";

/**
 * Canonical chunk-hash. Drives BOTH `chunks.chunk_id_fragment` (D-04)
 * AND the brief `source_hashes.recorded_hash` value.
 *
 * Algorithm (ADR-003 H-3/H-4 + ADR-005 Pitfall 8):
 *   1. Normalize CRLF → LF (`\r\n` → `\n`).
 *   2. Trim trailing whitespace (`trimEnd()`).
 *   3. Unicode NFC normalize.
 *   4. sha256_hex over the canonical UTF-8 bytes.
 *
 * Output format: `"sha256:<hex>"`. The `sha256:` prefix is part of the
 * versioned-API hash inclusion (ADR-003 H-6) — a future v3 hash flavour
 * switch (blake3 / xxhash) replaces the prefix in a single migration.
 */
export function computeChunkHash(text: string): string {
  const canonical = text.replace(/\r\n/g, "\n").trimEnd().normalize("NFC");
  return "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * First 7 hex chars of `computeChunkHash(text)`. Public ChunkId
 * fragment per D-04.
 *
 * Collision risk at 7 hex chars (~268M combos) is acceptable at
 * document scope: worst-case thousands of chunks per doc; document
 * boundary is the disambiguator in the public ChunkId
 * (`<DocId>#chunk-<n>`).
 */
export function computeChunkIdFragment(text: string): string {
  return computeChunkHash(text).slice("sha256:".length, "sha256:".length + 7);
}
