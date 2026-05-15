/**
 * Barrel for the memory MCP-tool controllers.
 *
 * Plan 02-04 ships:
 *   - `handleRecordObservation` — MEM-02 controller (record_observation tool).
 *   - `handleSupersede`         — MEM-04 controller (supersede tool).
 *
 * Plan 02-05 adds:
 *   - `handleRecall`            — MEM-03 controller (recall tool).
 */

export { handleRecordObservation } from "./record-observation.js";
export type {
  RecordObservationArgs,
  RecordObservationDeps,
} from "./record-observation.js";

export { handleSupersede } from "./supersede.js";
export type { SupersedeArgs, SupersedeDeps } from "./supersede.js";

export { handleRecall } from "./recall.js";
export type { RecallArgs, RecallDeps, RecallSearchHybridInput } from "./recall.js";
