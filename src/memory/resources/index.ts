/**
 * Memory MCP Resources — barrel.
 *
 * Plan 02-06 (MEM-09):
 *   - `vault-memory://memory/sinks` → readListSinks
 *   - `vault-memory://memory/stats` → readMemoryStats
 *
 * Polled-only (no `notifyResourceUpdated` integration in v2.0.0).
 * Registered through `server.registerResource(...)` at bootstrap.
 */

export { readListSinks } from "./list-sinks.js";
export type { ListSinksResource, ListSinkEntry } from "./list-sinks.js";

export { readMemoryStats } from "./memory-stats.js";
export type { MemoryStatsResource, MemoryStatsEntry } from "./memory-stats.js"; // vault-memory:no-telemetry-ok

/** Canonical resource URIs. */
export const RESOURCE_URI_LIST_SINKS = "vault-memory://memory/sinks";
export const RESOURCE_URI_MEMORY_STATS = "vault-memory://memory/stats";
/**
 * Phase 5 / BRF-09: brief discovery via MCP Resource. Registered by
 * slice 4 (Plan 05-04); the URI constant lands in slice 1 so later
 * slices can import it without scaffolding work.
 */
export const RESOURCE_URI_LIST_BRIEFS = "vault-memory://briefs";
