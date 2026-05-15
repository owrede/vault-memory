/**
 * `validateAgentWrite` — the SINGLE Phase 2 chokepoint per
 * ADR-002 §DeliveryAdapter and ADR-004 §Resolution.
 *
 * Adapters (`ObsidianFsDelivery`, `StubDelivery`, and any future
 * delivery adapter) call this pure function at the top of `write()`,
 * `update()`, and `delete()` BEFORE touching the backing store. The
 * function returns `null` on pass and a structured `GuardFailure` on
 * refusal — the adapter then returns the failure as a `WriteConflict`.
 *
 * Guard ordering (per the TSDoc on `WriteConflict`):
 *
 *   1. Guard B (cheap): inspect `properties.source` against sink
 *      membership.
 *        - `source === "agent"` AND `sink === null`
 *          ⇒ `agent_write_outside_sink`.
 *        - `source` set AND `source !== "agent"` AND `sink !== null`
 *          ⇒ `non_agent_write_inside_sink`.
 *      Pass-through cases:
 *        - `source === undefined` and `sink === null` ⇒ ordinary
 *          (non-memory) v1 write — pass.
 *        - `source === "user"` and `sink === null` ⇒ user writing
 *          outside any sink — pass.
 *        - `source === "agent"` and `sink !== null` ⇒ proceed to
 *          Guard A.
 *
 *   2. Guard A: when the target lands in a sink AND a contract is
 *      bound, run `contract.propertiesSchema.safeParse(doc.properties)`.
 *      Map the FIRST issue to one of `missing_provenance`,
 *      `invalid_provenance`, or `supersede_mismatch` (cross-field).
 *
 * The sentinel check (`sentinel_missing`) and the delete-into-sink
 * refusal (`sink_write_blocked`) are adapter-level concerns — they
 * live inside the adapter's `write` / `delete` and do NOT round-trip
 * through this validator. The validator covers exactly the five
 * `GuardFailure` codes.
 *
 * Zod 4 issue-shape notes (verified against zod@4.4.3 at probe time):
 *   - `code === "invalid_type"` is emitted for both genuine type
 *     errors AND for missing-required keys (because Zod sees
 *     `undefined` at that path). We disambiguate "missing" from
 *     "wrong type" by inspecting the actual value at the path: if it
 *     is `undefined`, it's `missing_provenance`; otherwise
 *     `invalid_provenance`.
 *   - `code === "invalid_value"` is emitted for enum mismatch.
 *   - `code === "invalid_format"` is emitted for `.datetime()` etc.
 *   - `code === "custom"` is emitted by `.superRefine` cross-field
 *     rules in `DEFAULT_MEMORY_V1` (status=superseded invariants).
 *
 * No filesystem, no path joining, no gray-matter, no node:* — pure
 * data-in, data-out. Re-usable by both delivery adapters and the v1
 * entry-point Guards landing in Plan 02-03b.
 */

import type { DocId, Document, MemorySink } from "../types.js";
import type { WriteConflict } from "../adapters/delivery/types.js";
import type { MemoryContract } from "./contract/index.js";

/**
 * The subset of `WriteConflict` codes this validator can emit.
 * Adapter-only codes (`sentinel_missing`, `sink_write_blocked`) are
 * deliberately excluded — they are filesystem/registry-level concerns.
 *
 * Implemented as `WriteConflict & { reason: <subset> }` rather than
 * `Extract<...>` because `WriteConflict` is a single interface (not a
 * union), so `Extract` would distribute incorrectly and produce
 * `never`. The intersection narrows the `reason` field to the subset
 * we actually emit.
 */
export type GuardFailure = WriteConflict & {
  reason:
    | "missing_provenance"
    | "invalid_provenance"
    | "supersede_mismatch"
    | "agent_write_outside_sink"
    | "non_agent_write_inside_sink";
};

/**
 * Safe key read on `Document.properties`. Returns `undefined` if
 * `props` is missing, the key is missing, or the property bag itself
 * is non-object.
 */
function getAt(
  props: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (!props || typeof props !== "object") return undefined;
  return props[key];
}

/**
 * Run Guards B and A against a write target.
 *
 * @param id Document identity (carried in diagnostics).
 * @param doc Partial document being written / updated. The validator
 *   inspects `doc.properties` only; blocks/title/etc. are ignored.
 * @param sink Resolved sink the target lands in, or `null` if the
 *   target is outside every registered sink.
 * @param contract Contract bound to `sink.contractName`, or `null` if
 *   `sink` is `null` (in which case Guard A is skipped).
 * @returns `null` on pass; a `GuardFailure` describing the first
 *   detected violation otherwise.
 */
export function validateAgentWrite(
  id: DocId,
  doc: Partial<Document>,
  sink: MemorySink | null,
  contract: MemoryContract | null,
): GuardFailure | null {
  const props = doc.properties as Record<string, unknown> | undefined;
  const source = getAt(props, "source");

  // ── Guard B (cheap; runs first) ──────────────────────────────────────────
  if (source === "agent" && sink === null) {
    return {
      ok: false,
      reason: "agent_write_outside_sink",
      message:
        `source:"agent" writes are only permitted under a configured ` +
        `MemorySink. Target ${id} does not resolve into any sink.`,
      suggestion:
        "Use record_observation for memory writes; or change source to 'user' / 'imported'.",
    };
  }
  if (source !== undefined && source !== "agent" && sink !== null) {
    return {
      ok: false,
      reason: "non_agent_write_inside_sink",
      sinkName: sink.name,
      message:
        `source:"${String(source)}" writes are not permitted into ` +
        `MemorySink "${sink.name}".`,
      suggestion:
        "Memory sinks accept source:'agent' writes only. User notes belong in the surrounding vault.",
    };
  }

  // ── Guard A (only when target lands in a sink AND a contract is bound) ──
  if (sink !== null && contract !== null) {
    const result = contract.propertiesSchema.safeParse(props ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      if (!issue) return null;
      const pathHead = issue.path[0];
      const key = typeof pathHead === "string" ? pathHead : undefined;

      // Cross-field rules in DEFAULT_MEMORY_V1 emit `code === "custom"`
      // with the path pointing at `superseded_by` or `superseded_reason`.
      // Map either path to `supersede_mismatch`.
      if (key === "superseded_reason" || key === "superseded_by") {
        return {
          ok: false,
          reason: "supersede_mismatch",
          sinkName: sink.name,
          ...(key !== undefined ? { key } : {}),
          message: `Cross-field rule failed at "${key}": ${issue.message}`,
          suggestion:
            "When status is 'superseded', set both superseded_by (DocId) and superseded_reason (non-empty string).",
        };
      }

      // "Missing required" disambiguation: in Zod 4 a missing required
      // key surfaces with `code === "invalid_type"` for plain-string
      // schemas (received undefined) OR with `code === "invalid_value"`
      // for enum schemas (no enum option matches undefined). Either
      // way, the canonical signal that the key is MISSING (rather than
      // present-but-wrong-shape) is that the actual value at the path
      // is `undefined`.
      const observed = key !== undefined ? getAt(props, key) : undefined;
      if (observed === undefined) {
        return {
          ok: false,
          reason: "missing_provenance",
          sinkName: sink.name,
          ...(key !== undefined ? { key } : {}),
          message:
            `Required property "${key ?? "(unknown)"}" is missing for writes ` +
            `into MemorySink "${sink.name}".`,
          suggestion:
            `Set properties.${key ?? "<key>"} before retrying. ` +
            `See contract "${contract.name}" required keys: ${contract.requiredKeys.join(", ")}.`,
        };
      }

      return {
        ok: false,
        reason: "invalid_provenance",
        sinkName: sink.name,
        ...(key !== undefined ? { key } : {}),
        observedValue: observed,
        message: `Property "${key ?? "(unknown)"}" failed validation: ${issue.message}`,
        suggestion: `See contract "${contract.name}" for valid values.`,
      };
    }
  }

  return null;
}
