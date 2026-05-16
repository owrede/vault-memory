/**
 * Phase 3 — `src/sections/` barrel.
 *
 * Re-exports the section-identity surface that the indexer, the
 * assembly layer (`src/assembly/` — landing in Phase 3 slices
 * 03-02..03-04), and downstream consumers depend on.
 *
 * Adapter-seam discipline (per 03-CONTEXT.md, enforced by
 * `scripts/lint-adapters.sh`): nothing under `src/sections/` imports
 * `fs`, `gray-matter`, `chokidar`, `path.join`, or `path.resolve`.
 */

export { computeAnchor, blockToPlainText } from "./anchor.js";
export { extractSections, markdownToSectionBlocks } from "./extract.js";
export { backfillSectionsFromChunks } from "./backfill.js";
export type { SectionInfo, SectionRow, InsertSectionRow } from "../types.js";
