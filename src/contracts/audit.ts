/**
 * Contract-audit writers — Phase 6 / Q-AUD, ADR-006 §Decision 4,
 * Invariant C-5.
 *
 * Security pattern (mitigates T-06-01-03 — Information Disclosure):
 *   Function signatures explicitly EXCLUDE any `output` / `payload`
 *   field. TypeScript strict-mode rejects a call site that attempts to
 *   add one. Peer-MCP step outputs may contain sensitive data (private
 *   PR text, customer records, secret tokens); we never capture them.
 *
 * `recordContractStep` / `recordContractLoadError` use ONLY the
 * `vault.db.contractAudit` namespace — they do NOT touch any other DB
 * table. `aggregateVerbUsage` re-exports the underlying query for
 * Plan 06-04's resource handler.
 *
 * Adapter-seam discipline: only `./types.js` + the typed query interface
 * are imported. Zero `fs`/`path.join`/`gray-matter`/`chokidar`.
 */

import type { ContractAuditQueries } from "../db/queries/contract-audit.js";

export interface ContractAuditDeps {
  contractAudit: ContractAuditQueries;
}

export interface RecordContractStepArgs {
  contract: string;
  verb: string;
  step_alias: string;
  vault: string;
}

export interface RecordContractLoadErrorArgs {
  file: string;
  error_message: string;
  vault: string;
}

export interface VerbUsageRow {
  verb: string;
  invocation_count: number;
  last_seen: number;
}

/**
 * Write one `contract_audit kind: 'contract_step'` row. NEVER accepts an
 * output / payload field (C-5).
 */
export function recordContractStep(
  deps: ContractAuditDeps,
  args: RecordContractStepArgs,
): void {
  deps.contractAudit.insert({
    kind: "contract_step",
    contract: args.contract,
    verb: args.verb,
    stepAlias: args.step_alias,
    vault: args.vault,
    ts: Date.now(),
  });
}

/**
 * Write one `contract_audit kind: 'contract_load_error'` row. The `file`
 * is prefixed onto `error_message` for human-readable surfacing through
 * `list_contract_load_errors` (Plan 06-04 Resource).
 */
export function recordContractLoadError(
  deps: ContractAuditDeps,
  args: RecordContractLoadErrorArgs,
): void {
  deps.contractAudit.insert({
    kind: "contract_load_error",
    vault: args.vault,
    ts: Date.now(),
    errorMessage: `${args.file}: ${args.error_message}`,
  });
}

/**
 * D-A2b promotion signal — verb usage histogram across `contract_step`
 * rows in this vault. Plan 06-04's resource handler pipes this through
 * `vault-memory://contract-verbs/{vault}`.
 */
export function aggregateVerbUsage(
  deps: ContractAuditDeps,
  vault: string,
): VerbUsageRow[] {
  return deps.contractAudit.aggregateVerbUsage(vault);
}
