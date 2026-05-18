/**
 * Public surface for the `MemoryContract` subsystem.
 *
 * Phase 2 ships:
 *   - `DEFAULT_MEMORY_V1` — hardcoded baseline matching MEMORY_CONTRACT.md.
 *   - `getContract(name)` — synchronous lookup from the in-process
 *     cache; returns the baseline for `"default-memory-v1"`, or any
 *     previously-`loadContractFromDisk`-ed contract; throws otherwise.
 *   - `loadContractFromDisk(name, vaultPath)` — async YAML loader.
 *   - `MemoryContract` type.
 *   - `MemoryContractNotFoundError` / `MemoryContractInvalidError`
 *     classes for `instanceof` checks.
 *
 * Phase 5+ may add per-vault scoping, mtime-based cache invalidation,
 * or a higher-level "contracts directory" loader; this surface stays
 * stable until then.
 */

import { DEFAULT_MEMORY_V1 } from "./default-v1.js";
import { DEFAULT_BRIEF_V1 } from "./default-brief-v1.js";
import {
  __cacheContract,
  __getCachedContract,
  loadContractFromDisk,
  MemoryContractInvalidError,
  MemoryContractNotFoundError,
} from "./loader.js";
import type { MemoryContract } from "./types.js";

// Pre-seed the cache with the hardcoded baselines so `getContract` can
// look them up uniformly without a `if (name === "default-memory-v1")`
// special case at every call site.
__cacheContract("default-memory-v1", DEFAULT_MEMORY_V1);
// Phase 5 / Pitfall 1 resolution: register a separate contract for
// briefs with widened status enum and brief-specific required keys.
// See ADR-005 §"New default-brief-v1 contract".
__cacheContract("default-brief-v1", DEFAULT_BRIEF_V1);

/**
 * Synchronous lookup. Returns the named contract from the in-process
 * cache:
 *   - `"default-memory-v1"` — always available (pre-seeded).
 *   - Any name previously loaded via `loadContractFromDisk(name, ...)`.
 *
 * Throws a helpful diagnostic when the name is unknown.
 */
export function getContract(name: string): MemoryContract {
  const cached = __getCachedContract(name);
  if (cached) return cached;
  throw new Error(
    `Unknown memory contract: "${name}". ` +
      `Known contracts: default-memory-v1${otherCachedNames(name)}. ` +
      `Call loadContractFromDisk(name, vaultPath) first to register a contract.`,
  );
}

function otherCachedNames(excluding: string): string {
  // For diagnostics only — list any names cached besides
  // default-memory-v1 / default-brief-v1 and the excluded name;
  // helps users notice typos when they have many contracts loaded.
  const names: string[] = [];
  // Pull from the cache through the loader's internal accessor — the
  // cache map itself is intentionally not exported.
  for (const candidate of ["default-memory-v1", "default-brief-v1"]) {
    if (candidate === excluding) continue;
    if (__getCachedContract(candidate)) names.push(candidate);
  }
  return names.length > 0 ? `, ${names.join(", ")}` : "";
}

// IN-02 closure: `__clearContractCache` is intentionally NOT exported from
// this public barrel. The test-only symbol lives at
// `./__testing__.ts` and is imported via the deep path from test files only.
// Production callers that import from this barrel cannot accidentally clear
// the cache at runtime — the import path itself is the access marker.

export {
  DEFAULT_MEMORY_V1,
  DEFAULT_BRIEF_V1,
  loadContractFromDisk,
  MemoryContractInvalidError,
  MemoryContractNotFoundError,
};
export type { MemoryContract };
