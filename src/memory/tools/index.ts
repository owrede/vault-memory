/**
 * Barrel for the memory MCP-tool controllers.
 *
 * Plan 02-04 ships:
 *   - `handleRecordObservation` — MEM-02 controller (record_observation tool).
 *   - `handleSupersede`         — MEM-04 controller (supersede tool).
 *
 * Plan 02-05 adds `handleRecall`.
 */

export { handleRecordObservation } from "./record-observation.js";
export type {
  RecordObservationArgs,
  RecordObservationDeps,
} from "./record-observation.js";

// Plan 02-04 Task 2 adds the supersede exports below.
