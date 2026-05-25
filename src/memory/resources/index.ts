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

/**
 * Phase 6 / Plan 06-04 (CON-04 + D-A2b): contract discovery + verb-usage
 * Resources. The `{vault}` suffix is appended at registration time per
 * the SDK 1.29 Resource template pattern.
 */
export const RESOURCE_URI_LIST_CONTRACTS = "vault-memory://contracts";
export const RESOURCE_URI_LIST_CONTRACT_VERBS = "vault-memory://contract-verbs";

/**
 * SOURCES-REGISTRY.md §5 (Stage 2): first-class peer-MCP source
 * discovery. Vault-independent (the PeerMcpRegistry is one global
 * instance across vaults), so `sources` has no `{vault}` segment.
 * `sources/{name}/tools` and `sources/{name}/tools/{tool}` append their
 * variables at registration time.
 */
export const RESOURCE_URI_SOURCES = "vault-memory://sources";

/**
 * Phase 8 / Plan 08-05 (REL-08): 5 list-style v1 tools promoted to MCP
 * Resources to land the canonical (non-deprecated) tool surface at 32.
 *
 * The original tools (list_vaults, list_models, recent_notes, vault_stats,
 * list_backlinks) remain callable through v2.x with a DEPRECATED notice in
 * their `description`. Each Resource read handler delegates to the existing
 * internal handler function — no logic duplication (GAT-01 seam preservation).
 *
 * URIs are the BASE form here; templated forms append `/{vault}` (and
 * `/{+docId}` for backlinks) at `registerResource` time. The `+` in
 * `{+docId}` is RFC 6570 reserved-character expansion: it allows the
 * variable to include `/`, so multi-segment docIds (e.g. `notes/sub/file.md`)
 * parse as a single value instead of being truncated at the first `/`.
 */
export const RESOURCE_URI_VAULTS = "vault-memory://vaults";
export const RESOURCE_URI_MODELS = "vault-memory://models";
export const RESOURCE_URI_RECENT = "vault-memory://recent";
export const RESOURCE_URI_STATS = "vault-memory://stats";
export const RESOURCE_URI_BACKLINKS = "vault-memory://backlinks";
