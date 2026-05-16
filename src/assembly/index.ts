/**
 * Barrel for the Phase 3 assembly tools.
 *
 * Plan 03-06 ships:
 *   - `assembleDossier` — ASM-04 controller (`assemble_dossier` MCP tool).
 *     Resolves `{type, key}` to an anchor `Document` and walks backlinks
 *     to return a structured dossier with property rollups (D-03..D-05).
 *
 * Future plans (03-02 / 03-03 / 03-04 / 03-05) will append further
 * exports under this barrel. Additions are additive — never re-shape an
 * existing export without bumping the consumer (server.ts) in lockstep.
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
