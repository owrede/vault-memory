/**
 * verb-list — Phase 7 / Plan 07-05 / D-PALETTE.
 *
 * Compile-time source of the palette's baseline + escape sections. The
 * 11 baseline verbs come from the Phase 6 closed enum via
 * `shared-types.js` (single source of truth — adding a baseline verb in
 * Phase 6 propagates to the plugin on next build). The escape-hatch
 * `literal` is intentionally separate from BASELINE_VERBS because the
 * server-side resource does not include it (it is the escape verb, not
 * a callable assembly verb for promotion).
 *
 * `VERB_CATEGORIES` partitions BASELINE_VERBS into the palette's three
 * visible sections per 07-CONTEXT.md §"D-PALETTE":
 *
 *   - Section 2: Read verbs   →  `read`
 *   - Section 3: Assembly     →  `assembly`
 *   - Section 4: Escape-hatch →  `escape` (just `literal`)
 *
 * Static partitioning is verified by the co-located unit test — every
 * baseline verb appears in exactly one section, and the union of read +
 * assembly equals BASELINE_VERBS.
 *
 * # Adapter-seam discipline
 *
 *   Pure data module. No `obsidian` / `fs` / `yaml` imports.
 */

export { BASELINE_VERBS } from "../../../shared-types.js";

/**
 * Partitioned palette categories. Read verbs surface document content;
 * assembly verbs compose retrieval results; the escape-hatch carries a
 * raw `value` through the assembly without invoking a verb handler.
 */
export const VERB_CATEGORIES: Record<"read" | "assembly" | "escape", readonly string[]> =
  {
    read: [
      "read_note",
      "search_hybrid",
      "search_sections",
      "query_frontmatter",
      "list_backlinks",
      "get_outline",
      "recall",
    ],
    assembly: ["expand", "cluster", "compile_brief", "get_brief"],
    escape: ["literal"],
  } as const;
