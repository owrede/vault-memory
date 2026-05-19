/**
 * type-catalog — Phase 7 / Plan 07-05 / D-PALETTE §Section 1.
 *
 * Re-exports the Phase 6 type catalog (`src/contracts/types-catalog.ts`)
 * for the plugin palette. The Phase 6 source is the single ground truth
 * (Object.frozen, additive-only); this module shapes its data into a
 * simple array of `{name, description}` rows for the palette renderer.
 *
 * # Why a re-shaped re-export?
 *
 *   The server-side `TYPES_CATALOG` is a `Record<string, object>` shaped
 *   for `$ref` resolution (it carries JSON-Schema-flavored `type`,
 *   `pattern`, etc.). The palette only needs name + description for
 *   each entry, so we project that subset here. Schema authoring lives
 *   server-side; the palette is a label list.
 *
 * # Adapter-seam discipline
 *
 *   Pure data module. No `obsidian` / `fs` / `yaml` imports.
 */

import { TYPES_CATALOG } from "../../../../../src/contracts/types-catalog.js";

/** One palette entry under the Types section. */
export interface TypeCatalogEntry {
  /** Canonical type name (e.g. `DocId`, `Handle`, `ChunkId`, `MemorySink`). */
  name: string;
  /** Human-readable description sourced from `TYPES_CATALOG[*].description`. */
  description: string;
}

/**
 * Project `TYPES_CATALOG` (Phase 6) into a palette-friendly list. The
 * order matches Object.entries — which on a frozen literal is the
 * declaration order in `src/contracts/types-catalog.ts`.
 */
export const TYPE_CATALOG: readonly TypeCatalogEntry[] = Object.freeze(
  Object.entries(TYPES_CATALOG).map(([name, schema]): TypeCatalogEntry => {
    const description =
      typeof (schema as { description?: unknown }).description === "string"
        ? ((schema as { description: string }).description)
        : "";
    return Object.freeze({ name, description });
  }),
);
