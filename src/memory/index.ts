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

// Plan 02-05 — citation packet shape (D-01); shared with Phase 3 ASM-05.
export { displayUrlFor, toCitationPacket } from "./citation-packet.js";
export type { CitationPacket } from "./citation-packet.js";

// Plan 02-06 (MEM-09) — MCP Resources for sink listing + per-sink stats.
// Plan 06-04 (CON-04 + D-A2b) — contract Resource URI constants live alongside.
export {
  readListSinks,
  readMemoryStats,
  RESOURCE_URI_LIST_SINKS,
  RESOURCE_URI_LIST_BRIEFS,
  RESOURCE_URI_MEMORY_STATS,
  RESOURCE_URI_LIST_CONTRACTS,
  RESOURCE_URI_LIST_CONTRACT_VERBS,
  RESOURCE_URI_SOURCES,
  RESOURCE_URI_VAULTS,
  RESOURCE_URI_MODELS,
  RESOURCE_URI_RECENT,
  RESOURCE_URI_STATS,
  RESOURCE_URI_BACKLINKS,
} from "./resources/index.js";
export type {
  ListSinksResource,
  ListSinkEntry,
  MemoryStatsResource,
  MemoryStatsEntry, // vault-memory:no-telemetry-ok
} from "./resources/index.js";
