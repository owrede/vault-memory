/**
 * Hardcoded baseline `MemoryContract` for `default-brief-v1`.
 *
 * Phase 5 (ADR-005 §"New default-brief-v1 contract"): briefs have a
 * distinct lifecycle from observations — they can be `"stale"` (a state
 * `default-memory-v1` does not allow). Rather than widen the Phase 2
 * contract's status enum (scope creep + mis-types non-brief documents),
 * we register a separate contract bound to the `_memory/_briefs/` sink.
 *
 * Mirrors the shape of `default-memory-v1` (`./default-v1.ts`) and
 * extends:
 *   - Status enum: `active | stale | superseded | archived` (adds
 *     `"stale"`).
 *   - Required keys: the base seven plus `target, purpose,
 *     compiled_from, compiled_at, source_hashes`.
 *   - Cross-field invariant: when `status === "stale"`,
 *     `source_hashes` MUST be present (the daemon needs hashes to
 *     drive recompute). Inherits the `status === "superseded"`
 *     invariant from `default-v1`.
 *
 * `passthrough()` keeps contract-extras (changed_sources, max_tokens,
 * etc.) from being silently dropped — D-02 escape hatch.
 *
 * Naming strategy is `caller-provided` because `compile_brief`
 * computes the timestamped slug itself per D-12 (the slug-timestamp
 * algorithm is not a `MemoryContract.naming.strategy` enum member;
 * see ADR-005 §"Decision: Recompile chain auto-supersede").
 *
 * Pure module. No fs / gray-matter / chokidar / path imports.
 */

import { z } from "zod";
import type { MemoryContract } from "./types.js";

const requiredKeys = [
  // Base seven (mirrors default-v1).
  "source",
  "confidence",
  "evidence",
  "status",
  "observed_at",
  "superseded_by",
  "type",
  // Brief-specific keys per ADR-005 / MEMORY_CONTRACT.md brief shape.
  "target",
  "purpose",
  "compiled_from",
  "compiled_at",
  "source_hashes",
] as const;

const baseShape = z
  .object({
    // ── Base shape inherited from default-v1 ────────────────────────
    source: z.enum(["agent", "user", "imported"]),
    confidence: z.enum(["direct", "inferred", "uncertain"]),
    evidence: z.array(z.string()),
    // ── Status enum WIDENED for briefs: + "stale" ──────────────────
    status: z.enum(["active", "stale", "superseded", "archived"]).default("active"),
    observed_at: z.string().datetime({ offset: true }),
    superseded_by: z.string().nullable().default(null),
    type: z.string().min(1),
    superseded_reason: z.string().optional(),

    // ── Brief-specific properties (D-11 brief shape) ───────────────
    target: z.string().min(1),
    /**
     * Brief purpose — free text but bounded at 500 chars so
     * `list_briefs` stays scannable. Lower bound `min(1)` matches
     * BRF-03 "no empty purpose".
     */
    purpose: z.string().min(1).max(500),
    /** DocId list of all sources the brief was compiled from. */
    compiled_from: z.array(z.string()).min(1),
    /** ISO-8601 datetime with offset (mirrors observed_at). */
    compiled_at: z.string().datetime({ offset: true }),
    /**
     * Record<ChunkId, BriefSourceHash> — staleness contract. The map
     * key is the public ChunkId (`<DocId>#chunk-<7-hex>`); the value
     * is `"sha256:<hex>"`. Marked optional at the type level because
     * the cross-field invariant below only REQUIRES it on stale; the
     * validator still rejects `status: "stale"` writes that omit it.
     */
    source_hashes: z.record(z.string(), z.string()).optional(),
    /**
     * Daemon-computed list of source DocIds whose hashes have
     * diverged. Populated when `status` flips to `"stale"`.
     */
    changed_sources: z.array(z.string()).optional(),
  })
  // D-02: unknown contract-extra keys pass through.
  .passthrough()
  // Cross-field invariants — inherits the `superseded` requirements
  // from default-v1 AND adds the brief-specific `stale` requirement.
  .superRefine((data, ctx) => {
    // Inherited from default-v1: when status is "superseded",
    // superseded_by MUST be non-null AND superseded_reason MUST be a
    // non-empty string. The recompile path (D-12) sets
    // `reason: "recompiled"` automatically; manual supersedes carry
    // a caller-supplied reason.
    if (data.status === "superseded") {
      if (data.superseded_by === null || data.superseded_by === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["superseded_by"],
          message: "Required (non-null DocId) when status is 'superseded'",
        });
      }
      if (typeof data.superseded_reason !== "string" || data.superseded_reason.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["superseded_reason"],
          message: "Required (non-empty string) when status is 'superseded'",
        });
      }
    }
    // Brief-specific: when status is "stale", source_hashes MUST be
    // present (the daemon needs the recorded hashes to know which
    // sources diverged — without them recompile cannot be targeted).
    if (data.status === "stale") {
      if (!data.source_hashes) {
        ctx.addIssue({
          code: "custom",
          path: ["source_hashes"],
          message: "Required when status is 'stale' (daemon needs hashes to recompute)",
        });
      }
    }
  });

export const DEFAULT_BRIEF_V1: MemoryContract = {
  name: "default-brief-v1",
  version: "1.0",
  propertiesSchema: baseShape,
  requiredKeys,
  // D-12 timestamped slug (`{target}--{compiled_at:YYYYMMDDTHHmm}.md`)
  // is computed by compile_brief itself — the caller (the brief layer)
  // hands the DeliveryAdapter a fully-formed DocId. The MemoryContract
  // naming strategy enum (`caller-provided | date-slug |
  // adapter-assigned`) does not include `slug-timestamp` as a value;
  // `caller-provided` is the closest match and signals "the
  // implementation mints the DocId before write".
  naming: {
    strategy: "caller-provided",
  },
};
