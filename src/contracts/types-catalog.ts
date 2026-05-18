/**
 * TYPES_CATALOG — Phase 6 / D-A3b, ADR-006 §Decision 6.
 *
 * Resolves `$ref: "#/types/<name>"` in contract YAML input schemas.
 *
 * Additive evolution only:
 *   - Phase 10 may extend `DocId.pattern` to also match `notion://...`
 *     (additive). We MUST NEVER narrow.
 *   - Adding a NEW type entry (e.g. `Workspace`) is allowed at minor
 *     version bumps.
 *
 * `Object.freeze` enforces the additive-only contract structurally —
 * direct mutation throws in strict ESM.
 *
 * Adapter-seam discipline: zero `fs`/`path.join`/`gray-matter`/`chokidar`
 * imports. Pure data module.
 */

export const TYPES_CATALOG: Readonly<Record<string, object>> = Object.freeze({
  DocId: Object.freeze({
    type: "string",
    pattern: "^[a-z][a-z0-9-]*://",
    description: "Opaque document identifier per ADR-001 (URI-style)",
  }),
  Handle: Object.freeze({
    type: "string",
    pattern: "^[a-z][a-z0-9-]*://",
    description:
      "Source or sink handle (currently identical to DocId; future-proofed for divergence)",
  }),
  ChunkId: Object.freeze({
    type: "string",
    pattern: "^[a-z][a-z0-9-]*://.+#chunk-[0-9a-f]{7}$",
    description: "Content-stable chunk identifier per Phase 5 ADR-005 H-5",
  }),
  MemorySink: Object.freeze({
    type: "string",
    description: "Registered MemorySink handle (see list_sinks)",
    "x-validator": "memory-sink",
  }),
});
