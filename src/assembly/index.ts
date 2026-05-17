/**
 * Phase 3 — `src/assembly/` barrel.
 *
 * The assembly layer composes the section-identity substrate (`src/sections/`,
 * landed in 03-01) into higher-level reading tools:
 *
 *   - 03-02: `get_outline` — nested section tree.
 *   - 03-03: `search_sections` — section-level retrieval.
 *   - 03-04: `get_bundle` — section-window assembly.
 *   - 03-05: search_hybrid rescore (authority / staleness).
 *   - 03-06: `assemble_dossier` — multi-bundle synthesis with property rollups.
 *
 * Adapter-seam discipline (per 03-CONTEXT.md, enforced by
 * `scripts/lint-adapters.sh`): nothing under `src/assembly/` imports
 * `fs`, `gray-matter`, `chokidar`, or `path.*`. Document reads go
 * through the injected `SourceConnector` seam.
 */

export { assembleDossier } from "./dossier.js";
export type {
  AssembleDossierArgs,
  AssembleDossierDeps,
  DossierAnchor,
  DossierError,
  DossierResult,
  LinkedDocument,
} from "./dossier.js";
export { getDocumentBundle } from "./bundle.js";
export type {
  BacklinkEntry,
  BundleAnchor,
  BundleRecentEdit,
  BundleResult,
  ForwardLinkEntry,
  GetDocumentBundleArgs,
  GetDocumentBundleDeps,
} from "./bundle.js";
export { getOutline, type GetOutlineDeps } from "./outline.js";
export type { OutlineNode, OutlineResult, GetOutlineArgs } from "./types.js";
