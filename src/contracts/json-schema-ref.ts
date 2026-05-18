/**
 * resolveRefs — Phase 6 / D-A3a, ADR-006 §Decision 6, T-06-01-01 gate.
 *
 * Resolves `$ref: "#/types/<name>"` nodes against TYPES_CATALOG. Any
 * other `$ref` form (HTTP URL, file://, JSON-Pointer beyond `#/types/`)
 * throws synchronously — Security: no HTTP fetches, no FS reads from
 * contract YAML.
 *
 * Spread order (RESEARCH Example 3): catalog entry first, YAML-author
 * additions on the same node second — author additions WIN. This lets
 * a contract override the catalog description without weakening the
 * pattern/type constraints (those are spread first; redundant author
 * `type`/`pattern` simply re-state them).
 *
 * Adapter-seam discipline: zero `fs`/`path.join`/`gray-matter`/`chokidar`
 * imports. Pure function.
 */

import { TYPES_CATALOG } from "./types-catalog.js";

const TYPES_REF_RE = /^#\/types\/(\w+)$/;

export function resolveRefs(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(resolveRefs);
  if (schema !== null && typeof schema === "object") {
    const obj = schema as Record<string, unknown>;
    if (typeof obj["$ref"] === "string") {
      const ref = obj["$ref"];
      const match = ref.match(TYPES_REF_RE);
      if (!match) {
        throw new Error(
          `Unsupported $ref form (only '#/types/<name>' accepted): ${ref}`,
        );
      }
      const typeName = match[1]!;
      const catalogEntry = (TYPES_CATALOG as Record<string, unknown>)[typeName];
      if (catalogEntry === undefined) {
        throw new Error(`Unknown $ref target: ${ref}`);
      }
      // Strip $ref before merging — author additions win (Example 3).
      // Use destructuring to keep TS strict-mode happy.
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "$ref") continue;
        rest[k] = resolveRefs(v);
      }
      return { ...(catalogEntry as Record<string, unknown>), ...rest };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveRefs(v);
    }
    return out;
  }
  return schema;
}
