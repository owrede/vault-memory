/**
 * Public surface of the memory subsystem.
 *
 * Phase 2 Plan 02-02 ships the substrate layer:
 *   - `parseMemorySinkHandle` / `formatMemorySinkHandle` / SENTINEL_FILENAME
 *     from `./sink.js`.
 *   - `MemorySinkRegistry` from `./registry.js` (sole resolver per
 *     ADR-004 §Resolution).
 *   - `getContract` / `loadContractFromDisk` / `DEFAULT_MEMORY_V1` /
 *     `MemoryContract` from `./contract/index.js`.
 *
 * Downstream plans (02-03..02-08) add the validator, MCP tools,
 * MCP resources, and audit-log integration; their public symbols
 * will be re-exported here.
 */

export {
  formatMemorySinkHandle,
  MEMORY_SINK_HANDLE_PATTERN,
  parseMemorySinkHandle,
  SENTINEL_FILENAME,
} from "./sink.js";

export { MemorySinkRegistry } from "./registry.js";
export type {
  MemorySinkConfig,
  RegisterMemorySinksOptions,
} from "./registry.js";

export {
  DEFAULT_MEMORY_V1,
  getContract,
  loadContractFromDisk,
  MemoryContractInvalidError,
  MemoryContractNotFoundError,
} from "./contract/index.js";
export type { MemoryContract } from "./contract/index.js";
