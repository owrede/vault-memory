/**
 * Contract MCP Resources — Plan 06-04 / CON-04 + D-A2b.
 *
 * Two pure read-only Resource handlers; both registered in
 * `src/server.ts` via `server.registerResource(...)`. Resources do NOT
 * count toward the REL-08 tool budget per Phase 5 BRF-09 precedent.
 *
 *   - `readListContracts(deps, opts?)` — projects the per-vault
 *     `ContractRegistry` into `{total, contracts: [{name, description,
 *     vault, source_count, sink_count, write_back: boolean}]}`. Optional
 *     `opts.source` filters to contracts whose ANY declared source's
 *     handle starts with the given prefix.
 *
 *   - `readListContractVerbs(deps)` — returns
 *     `{baseline: [<11 verbs>], custom: [{verb, declared_in,
 *      used_by_contracts, invocation_count, last_seen}]}`. The baseline
 *     set is constant (ADR-006 §Decision 3). The `custom` entries are
 *     computed from `contract_audit.aggregateVerbUsage(vault)` filtered
 *     to `mcp://` verbs. `used_by_contracts` is derived by scanning
 *     `contract_audit.listByKind('contract_step', {vault})` for distinct
 *     contract names per verb (no schema change needed).
 *
 * # Adapter-seam discipline
 *
 * Zero `fs`/`path.join`/`gray-matter`/`chokidar`/`yaml` imports — pure
 * data projection over the registry + DB query interface.
 */

import type { ContractRegistry } from "./registry.js";
import type { ContractAuditQueries } from "../db/queries/contract-audit.js";

// ─────────────────────────────────────────────────────────────────────────
// list_contracts (CON-04)
// ─────────────────────────────────────────────────────────────────────────

export interface ListContractsDeps {
  registry: ContractRegistry;
  vaultName: string;
}

export interface ListContractsOpts {
  /** Filter to contracts whose ANY source handle starts with this prefix. */
  source?: string;
}

export interface ListContractsEntry {
  name: string;
  description: string;
  vault: string;
  source_count: number;
  sink_count: number;
  write_back: boolean;
}

export interface ListContractsResource {
  total: number;
  contracts: ListContractsEntry[];
}

export function readListContracts(
  deps: ListContractsDeps,
  opts: ListContractsOpts = {},
): ListContractsResource {
  const out: ListContractsEntry[] = [];
  for (const [name, parsed] of deps.registry.entries()) {
    if (opts.source !== undefined) {
      const anyMatch = Object.values(parsed.sources).some((s) => s.handle.startsWith(opts.source!));
      if (!anyMatch) continue;
    }
    out.push({
      name,
      description: parsed.description,
      vault: deps.vaultName,
      source_count: Object.keys(parsed.sources).length,
      sink_count: Object.keys(parsed.sinks).length,
      write_back: parsed.write_back !== undefined,
    });
  }
  return { total: out.length, contracts: out };
}

// ─────────────────────────────────────────────────────────────────────────
// list_contract_verbs (D-A2b)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The 11 baseline verbs per ADR-006 §Decision 3. `literal` is
 * intentionally NOT in this list — it's an escape-hatch, not a callable
 * verb usable by promotion signal aggregation.
 */
export const BASELINE_VERBS: readonly string[] = Object.freeze([
  "search_hybrid",
  "expand",
  "cluster",
  "recall",
  "compile_brief",
  "get_brief",
  "query_frontmatter",
  "list_backlinks",
  "get_outline",
  "search_sections",
  "read_note",
]);

export interface ListContractVerbsDeps {
  contractAudit: ContractAuditQueries;
  vaultName: string;
}

export interface ListContractVerbsEntry {
  verb: string;
  declared_in: string;
  used_by_contracts: string[];
  invocation_count: number;
  last_seen: number;
}

export interface ListContractVerbsResource {
  baseline: readonly string[];
  custom: ListContractVerbsEntry[];
}

export function readListContractVerbs(deps: ListContractVerbsDeps): ListContractVerbsResource {
  const usage = deps.contractAudit.aggregateVerbUsage(deps.vaultName);
  // List ALL `contract_step` rows once and reduce in-process so the
  // `used_by_contracts` join is O(N) without adding a SQL helper.
  // Larger budget than aggregateVerbUsage covers — verbs with high
  // invocation_count will appear repeatedly in the rows but we group
  // them via a Map.
  const rows = deps.contractAudit.listByKind("contract_step", {
    vault: deps.vaultName,
    limit: 10_000,
  });
  const verbToContracts = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.verb === undefined || r.contract === undefined) continue;
    if (!verbToContracts.has(r.verb)) verbToContracts.set(r.verb, new Set());
    verbToContracts.get(r.verb)!.add(r.contract);
  }

  const custom = usage
    .filter((u) => u.verb.startsWith("mcp://"))
    .map((u): ListContractVerbsEntry => ({
      verb: u.verb,
      declared_in: extractDeclaredIn(u.verb),
      used_by_contracts: Array.from(verbToContracts.get(u.verb) ?? []).sort(),
      invocation_count: u.invocation_count,
      last_seen: u.last_seen,
    }));

  return { baseline: BASELINE_VERBS, custom };
}

function extractDeclaredIn(verb: string): string {
  const m = verb.match(/^mcp:\/\/([a-z][a-z0-9_-]*)\//);
  return m ? `[contracts.mcp_clients.${m[1]}]` : "[contracts.mcp_clients]";
}
