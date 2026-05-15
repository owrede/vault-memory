/**
 * `vault-memory://memory/sinks` — MCP Resource enumerating the
 * configured + auto-discovered MemorySinks (Plan 02-06, MEM-09).
 *
 * Resource, not tool: agents that want to discover where they may
 * write memory documents read this URI instead of invoking a tool.
 * Polled-only — there is NO `notifyResourceUpdated` integration in
 * v2.0.0 (CONTEXT D-Q4, Deferred Ideas).
 *
 * The handler is a pure function over the `MemorySinkRegistry`. It
 * touches neither the filesystem nor the DB — the single resolver
 * rule from ADR-004 §Resolution applies.
 */

import type { MemorySinkRegistry } from "../registry.js";

export interface ListSinksResource {
  /** Total number of registered sinks across all vaults. */
  total: number;
  sinks: ListSinkEntry[];
}

export interface ListSinkEntry {
  /** Short name (resolution key). */
  name: string;
  /** Full `obsidian-fs://<vault>/<path>/` URI. */
  handle: string;
  /** Owning vault name. */
  vault: string;
  /** Name of the bound `MemoryContract`. */
  contract: string;
  /** True iff this is the vault's default sink. */
  default: boolean;
  /** Vault-relative folder the sink resolves to (e.g. "_memory/"). */
  resolves_to: string;
}

/**
 * Pure handler — builds the resource payload from the registry's
 * `listMemorySinks()` snapshot.
 */
export function readListSinks(registry: MemorySinkRegistry): ListSinksResource {
  const sinks = registry.listMemorySinks();
  return {
    total: sinks.length,
    sinks: sinks.map((s): ListSinkEntry => ({
      name: s.name,
      handle: s.handle,
      vault: s.vault,
      contract: s.contractName,
      default: s.isDefault,
      resolves_to: s.resolveToRelativePath,
    })),
  };
}
