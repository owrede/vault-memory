/**
 * Hardcoded baseline `MemoryContract` for `default-memory-v1`.
 *
 * Mirrors the normative spec in `docs/v2/MEMORY_CONTRACT.md` and the
 * (post-amendment) `default-memory-v1` YAML example in
 * `docs/v2/adr/004-memory-sink-handles.md`. The seven required keys
 * (`source`, `confidence`, `evidence`, `status`, `observed_at`,
 * `superseded_by`, `type`) plus the optional `superseded_reason` and
 * the cross-field invariant (`status === "superseded"` ⇒
 * `superseded_reason` non-empty AND `superseded_by` non-null) are
 * baked in as a single Zod `.superRefine`-wrapped object schema.
 *
 * `passthrough()` keeps contract-extras (`expires_at`, `tags`, etc.)
 * from being silently dropped — D-02 (CONTEXT.md) escape hatch for
 * future contract-allowed fields.
 *
 * Phase 2 ships this hardcoded baseline so the validator works without
 * a disk read; the YAML loader (`./loader.ts`) handles named contracts
 * that ship in `_contracts/memory/<name>.yaml`.
 */

import { z } from "zod";
import type { MemoryContract } from "./types.js";

const requiredKeys = [
  "source",
  "confidence",
  "evidence",
  "status",
  "observed_at",
  "superseded_by",
  "type",
] as const;

const baseShape = z
  .object({
    source: z.enum(["agent", "user", "imported"]),
    confidence: z.enum(["direct", "inferred", "uncertain"]),
    evidence: z.array(z.string()),
    status: z.enum(["active", "superseded", "archived"]).default("active"),
    observed_at: z.string().datetime({ offset: true }),
    superseded_by: z.string().nullable().default(null),
    type: z.string().min(1),
    superseded_reason: z.string().optional(),
  })
  // D-02: unknown contract-extra keys pass through.
  .passthrough()
  // Cross-field invariant: when status is "superseded", BOTH
  // `superseded_by` (non-null DocId) AND `superseded_reason` (non-empty
  // string) are required. Other statuses leave both fields unconstrained
  // beyond their base types.
  .superRefine((data, ctx) => {
    if (data.status === "superseded") {
      if (data.superseded_by === null || data.superseded_by === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["superseded_by"],
          message: "Required (non-null DocId) when status is 'superseded'",
        });
      }
      if (
        typeof data.superseded_reason !== "string" ||
        data.superseded_reason.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["superseded_reason"],
          message: "Required (non-empty string) when status is 'superseded'",
        });
      }
    }
  });

export const DEFAULT_MEMORY_V1: MemoryContract = {
  name: "default-memory-v1",
  version: "1.0",
  propertiesSchema: baseShape,
  requiredKeys,
  naming: {
    strategy: "date-slug",
    pattern: "{observed_at:YYYY-MM-DD}-{slug}.md",
  },
};
