/**
 * Phase 3 — `src/assembly/` barrel.
 *
 * The assembly layer composes the section-identity substrate (`src/sections/`,
 * landed in 03-01) into higher-level reading tools:
 *
 *   - 03-02 (this slice): `get_outline` — nested section tree.
 *   - 03-03: `get_bundle` — section-window assembly.
 *   - 03-04: `dossier` — multi-bundle synthesis.
 *   - 03-06: authority / staleness scoring on assembled bundles.
 *
 * Adapter-seam discipline (per 03-CONTEXT.md, enforced by
 * `scripts/lint-adapters.sh`): nothing under `src/assembly/` imports
 * `fs`, `gray-matter`, `chokidar`, or `path.*`. Document reads go
 * through the injected `SourceConnector` seam.
 */

export type { OutlineNode, OutlineResult, GetOutlineArgs } from "./types.js";
export { getOutline, type GetOutlineDeps } from "./outline.js";
