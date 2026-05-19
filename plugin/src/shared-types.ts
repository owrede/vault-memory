/**
 * Cross-package re-exports — Phase 7 / ADR-007.
 *
 * The plugin's codec + view layer consume the Phase 6 + Phase 7 Zod
 * schemas without reaching into `../../../src/contracts/*` from every
 * caller. This module is the single shim point; if the server-side
 * paths ever move, only this file changes.
 *
 * # Adapter-seam discipline
 *
 * No runtime logic; re-exports only. Zero `fs` / `obsidian` / `yaml`.
 */

export {
  ContractFileSchema,
  type ContractFileShape,
} from "../../src/contracts/schema.js";

export {
  ContractDocumentSchema,
  type ContractDocumentShape,
  type EditorStateShape,
} from "../../src/contracts/contract-file-schema.js";

/**
 * BASELINE_VERBS — re-exported from `src/contracts/resources.ts` (single
 * source of truth, Phase 6 / D-A2b). The plugin's palette consumes this
 * as the compile-time enumeration of the 11 baseline verbs that the
 * `vault-memory` server dispatches directly. `literal` is NOT in this
 * list — it is the escape-hatch verb, surfaced separately by the palette.
 */
export { BASELINE_VERBS } from "../../src/contracts/resources.js";
