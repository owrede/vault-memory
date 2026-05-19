/**
 * canonicalize — Phase 7 / ADR-007 §D-CANON.
 *
 * Pure rule layer for the `.contract → .yaml` emit path. Two
 * normalizations applied on emission:
 *
 *   1. Top-level key order: `version, name, description, inputs,
 *      sources, sinks, assembly, output_shape, write_back, required`
 *      (per ADR-006 §Decision 2 schema field order, mirrored verbatim
 *      in CANONICAL_KEY_ORDER below). YAML serializers respect insertion
 *      order, so producing a fresh object with this key sequence
 *      determines the emitted YAML field order.
 *
 *   2. Default-omission: drop values that equal a documented Phase 6
 *      schema default. The closed list — kept tight on purpose, do not
 *      speculate beyond ADR-006:
 *        - `required: true` on a handle declaration (sources/sinks)
 *          drops because the Zod default is `true`. `required: false`
 *          is preserved.
 *      Top-level `required: []` is NOT omitted — Phase 6 distinguishes
 *      "no required inputs" from "field absent" via array contents, and
 *      omitting changes the round-trip semantics.
 *
 * Assembly step order is NOT mutated here. Topological re-ordering
 * lives in the editor view (Phase 7 plan 07-05) — by the time YAML is
 * emitted, the array is already in the canonical order chosen by the
 * editor; this module only stabilizes field order WITHIN each step
 * object.
 *
 * Idempotence: `canonicalizeContract(canonicalizeContract(x))` is
 * structurally equal to `canonicalizeContract(x)`.
 *
 * # Adapter-seam discipline
 *
 * Pure data transform. Zero `fs` / `obsidian` / `yaml` / `chokidar`.
 * Imports only the shared-types facade (re-exports of Phase 6 + 7
 * Zod-derived types).
 */

import type { ContractFileShape } from "../shared-types.js";

/**
 * Top-level key order on emission. Matches ADR-006 §Decision 2 schema
 * order. Frozen tuple so downstream callers can use it for grep-like
 * acceptance tests without copying the list.
 */
export const CANONICAL_KEY_ORDER = [
  "version",
  "name",
  "description",
  "inputs",
  "sources",
  "sinks",
  "assembly",
  "output_shape",
  "write_back",
  "required",
] as const satisfies readonly (keyof ContractFileShape)[];

/**
 * Canonical key order for assembly step entries. ADR-006 step shape is
 * `{ as, verb, args?, value? }`; emitting in this order keeps YAML
 * diffs stable.
 */
const STEP_KEY_ORDER = ["as", "verb", "args", "value"] as const;

/** Canonical key order for handle declarations in sources/sinks. */
const HANDLE_KEY_ORDER = ["handle", "required"] as const;

/**
 * Reorders `contract` field keys per `CANONICAL_KEY_ORDER` and applies
 * default-omission rules. Returns a fresh plain object — input is not
 * mutated.
 */
export function canonicalizeContract(
  contract: ContractFileShape,
): ContractFileShape {
  const source = contract as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of CANONICAL_KEY_ORDER) {
    if (!(key in source)) continue;
    const value = source[key];

    if (key === "sources" || key === "sinks") {
      out[key] = canonicalizeHandleMap(
        value as Record<string, unknown> | undefined,
      );
      continue;
    }

    if (key === "assembly") {
      out[key] = canonicalizeAssembly(value as unknown[] | undefined);
      continue;
    }

    out[key] = value;
  }

  return out as unknown as ContractFileShape;
}

function canonicalizeHandleMap(
  map: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (map === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(map)) {
    if (raw === null || typeof raw !== "object") {
      out[name] = raw;
      continue;
    }
    const handle = raw as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const k of HANDLE_KEY_ORDER) {
      if (!(k in handle)) continue;
      const v = handle[k];
      // Default-omission: `required: true` is Phase 6's Zod default.
      if (k === "required" && v === true) continue;
      ordered[k] = v;
    }
    // Preserve any forward-compat fields after the canonical ones.
    for (const [k, v] of Object.entries(handle)) {
      if ((HANDLE_KEY_ORDER as readonly string[]).includes(k)) continue;
      ordered[k] = v;
    }
    out[name] = ordered;
  }
  return out;
}

function canonicalizeAssembly(
  steps: unknown[] | undefined,
): unknown[] | undefined {
  if (steps === undefined) return undefined;
  return steps.map((step) => {
    if (step === null || typeof step !== "object") return step;
    const s = step as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const k of STEP_KEY_ORDER) {
      if (!(k in s)) continue;
      ordered[k] = s[k];
    }
    // Preserve forward-compat keys after the canonical ones.
    for (const [k, v] of Object.entries(s)) {
      if ((STEP_KEY_ORDER as readonly string[]).includes(k)) continue;
      ordered[k] = v;
    }
    return ordered;
  });
}
