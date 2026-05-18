/**
 * resolveTemplate — Phase 6 / D-A2c / ADR-006 §Decision 5 / Invariant C-7.
 *
 * Mustache-style template resolver over a `{inputs, steps}` bindings table.
 * Pure function, zero deps.
 *
 * # Resolution rules
 *
 *   1. Whole-string `^\{\{<path>\}\}$` → returns the RAW typed value at
 *      `<path>` (number, array, object, etc.) — NEVER stringified.
 *   2. Embedded `{{...}}` substitutions inside a larger string → each
 *      lookup result is converted to a string (JSON.stringify for
 *      non-string values) and concatenated with the surrounding text.
 *   3. Recursion: arrays and objects are walked; each leaf string is
 *      resolved independently. Non-string leaves (number, null, boolean)
 *      pass through unchanged. The first unresolved leaf short-circuits
 *      the whole result.
 *   4. `<path>` syntax — `alias.field.nested[0]`. Split on `.` AND `[i]`
 *      via the regex `/[.[\]]/`; filter empty segments.
 *
 * # Security invariant (C-7, ADR-006 §Decision 5)
 *
 *   `resolveTemplate` operates ONLY on contract YAML (read at boot time,
 *   never user-supplied at call time). User inputs are looked UP from
 *   the bindings table but the looked-up value is NEVER re-evaluated as
 *   a template. Test 13 verifies this: if `inputs.x = "{{inputs.y}}"`,
 *   then `resolveTemplate("{{inputs.x}}", ...)` returns the raw string
 *   `"{{inputs.y}}"`, not a recursive substitution.
 *
 *   Mitigates threat T-06-03-01 (user-controlled template injection).
 *
 * # Adapter-seam discipline
 *
 *   Zero `fs` / `path` / `gray-matter` / `chokidar` / `yaml` imports.
 *   Pure function only.
 */

/**
 * Binding table consumed by `resolveTemplate`. `inputs` carries the
 * caller-supplied + resolved-source/sink values; `steps` accumulates
 * named-binding outputs as the orchestrator iterates the assembly array.
 */
export interface TemplateBindings {
  inputs: Record<string, unknown>;
  steps: Record<string, unknown>;
}

/**
 * Result envelope. Discriminated union — branch on `.ok` before
 * destructuring. On `false`, `expression` carries the offending
 * `{{...}}` token verbatim (so the orchestrator can surface it in the
 * `InstantiateError.unresolved_template.expression` field).
 */
export type TemplateResolveResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; reason: "unresolved_template"; expression: string };

/** Matches a single `{{<path>}}` token. */
const TOKEN_RE = /\{\{([^}]+)\}\}/g;
/** Matches a string that is JUST a single template — no surrounding chars. */
const WHOLE_STRING_RE = /^\{\{([^}]+)\}\}$/;

/**
 * Look up `path` against the bindings table. Returns the raw value or
 * `undefined` when any segment is missing.
 *
 * Path syntax — alias.field.nested[0]. The leading segment is treated
 * as a key on `{inputs, steps}` (we merge them into a single root
 * lookup space so contracts can reference `{{inputs.foo}}` or
 * `{{step1.bar}}` without prefixing).
 */
function lookup(path: string, bindings: TemplateBindings): unknown {
  const segments = path.split(/[.[\]]/).filter(Boolean);
  if (segments.length === 0) return undefined;
  // Unified namespace per RESEARCH Example 2:
  //   `{{inputs.<name>}}` resolves through the `inputs` object;
  //   `{{<step_alias>.<field>}}` resolves through `steps[<alias>]`.
  // Build the root by exposing the `inputs` object directly AND
  // spreading the steps map so each step alias is a top-level key.
  const root: Record<string, unknown> = {
    inputs: bindings.inputs,
    ...bindings.steps,
  };
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    // Numeric index handling (foo[0] → segments include "0").
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
      continue;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Resolve one string value against the bindings. Implements rules (1)
 * and (2) above.
 */
function resolveString(s: string, bindings: TemplateBindings): TemplateResolveResult {
  // Rule 1: whole-string single template → raw typed value.
  const whole = WHOLE_STRING_RE.exec(s);
  if (whole !== null) {
    const path = whole[1]!.trim();
    const v = lookup(path, bindings);
    if (v === undefined) {
      return { ok: false, reason: "unresolved_template", expression: `{{${path}}}` };
    }
    return { ok: true, value: v };
  }
  // Rule 2: embedded substitutions — string-concat.
  if (!s.includes("{{")) return { ok: true, value: s };
  let unresolved: string | null = null;
  // Reset regex state for repeated use.
  TOKEN_RE.lastIndex = 0;
  const replaced = s.replace(TOKEN_RE, (_match, rawPath: string) => {
    if (unresolved !== null) return "";
    const path = rawPath.trim();
    const v = lookup(path, bindings);
    if (v === undefined) {
      unresolved = `{{${path}}}`;
      return "";
    }
    return typeof v === "string" ? v : JSON.stringify(v);
  });
  if (unresolved !== null) {
    return { ok: false, reason: "unresolved_template", expression: unresolved };
  }
  return { ok: true, value: replaced };
}

/**
 * Recursive resolver. Walks objects + arrays; leaf strings go through
 * `resolveString`; non-string leaves pass through unchanged. First
 * unresolved leaf short-circuits the whole result (Test 12).
 */
export function resolveTemplate<T = unknown>(
  value: unknown,
  bindings: TemplateBindings,
): TemplateResolveResult<T> {
  if (typeof value === "string") {
    return resolveString(value, bindings) as TemplateResolveResult<T>;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const r = resolveTemplate(item, bindings);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out as T };
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = resolveTemplate(v, bindings);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return { ok: true, value: out as T };
  }
  // Pass-through for numbers, booleans, null, undefined.
  return { ok: true, value: value as T };
}
