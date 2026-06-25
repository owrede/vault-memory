/**
 * ContractAuditQueries — Phase 6 / Q-AUD orchestration audit substrate.
 *
 * Mirrors `src/db/queries/audit.ts` and `src/db/queries/brief_sources.ts`
 * (Phase 5) in structure. Populated by `src/contracts/audit.ts` writers
 * (`recordContractStep` / `recordContractLoadError`) — one row per step,
 * no batch insert (orchestration writes step-by-step).
 *
 * Column shape (migration 014):
 *   id            INTEGER PRIMARY KEY AUTOINCREMENT
 *   kind          TEXT NOT NULL                       -- 'contract_step' | 'contract_load_error'
 *   contract      TEXT                                 -- nullable (load errors have no contract context)
 *   verb          TEXT                                 -- nullable
 *   step_alias    TEXT                                 -- nullable
 *   vault         TEXT                                 -- nullable
 *   ts            INTEGER NOT NULL                     -- epoch ms
 *   error_message TEXT                                 -- nullable
 *
 * Security pattern (ADR-006 Invariant C-5): rows store ONLY the columns
 * above — NEVER step output payloads. Peer-MCP outputs may contain
 * sensitive data; we explicitly do not capture them. The
 * `ContractAuditRow` input type does not declare an `output` field, so
 * TypeScript strict-mode rejects any attempt to add one at the call
 * site (`src/contracts/audit.ts`).
 *
 * Adapter-seam discipline: no `fs`/`path`/`gray-matter`/`chokidar`
 * imports. `scripts/lint-adapters.sh` enforces.
 */

import type BetterSqlite3 from "better-sqlite3";

export interface ContractAuditRow {
  kind: "contract_step" | "contract_load_error";
  contract?: string;
  verb?: string;
  stepAlias?: string;
  vault?: string;
  ts: number;
  errorMessage?: string;
}

export interface ListByKindOptions {
  limit?: number;
  vault?: string;
}

export interface VerbUsageRow {
  verb: string;
  invocation_count: number;
  last_seen: number;
}

interface ContractAuditDbRow {
  id: number;
  kind: string;
  contract: string | null;
  verb: string | null;
  step_alias: string | null;
  vault: string | null;
  ts: number;
  error_message: string | null;
}

export class ContractAuditQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _listByKindAll: BetterSqlite3.Statement<[string, number], ContractAuditDbRow>;
  private readonly _listByKindAndVault: BetterSqlite3.Statement<
    [string, string, number],
    ContractAuditDbRow
  >;
  // Q-AUD: `kind = 'contract_step'` is a CONSTANT filter (D-A2b semantics) —
  // the aggregator counts ONLY step rows, never load_error rows.
  private readonly _aggregate: BetterSqlite3.Statement<
    [string],
    { verb: string; invocation_count: number; last_seen: number }
  >;

  constructor(db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT INTO contract_audit
        (kind, contract, verb, step_alias, vault, ts, error_message)
      VALUES
        (@kind, @contract, @verb, @step_alias, @vault, @ts, @error_message)
    `);
    this._listByKindAll = db.prepare<[string, number], ContractAuditDbRow>(
      "SELECT * FROM contract_audit WHERE kind = ? ORDER BY ts DESC LIMIT ?",
    );
    this._listByKindAndVault = db.prepare<[string, string, number], ContractAuditDbRow>(
      "SELECT * FROM contract_audit WHERE kind = ? AND vault = ? ORDER BY ts DESC LIMIT ?",
    );
    this._aggregate = db.prepare<
      [string],
      { verb: string; invocation_count: number; last_seen: number }
    >(
      `SELECT verb, COUNT(*) AS invocation_count, MAX(ts) AS last_seen
         FROM contract_audit
        WHERE kind = 'contract_step' AND vault = ? AND verb IS NOT NULL
        GROUP BY verb
        ORDER BY invocation_count DESC`,
    );
  }

  insert(row: ContractAuditRow): void {
    this._insert.run({
      kind: row.kind,
      contract: row.contract ?? null,
      verb: row.verb ?? null,
      step_alias: row.stepAlias ?? null,
      vault: row.vault ?? null,
      ts: row.ts,
      error_message: row.errorMessage ?? null,
    });
  }

  listByKind(kind: string, opts: ListByKindOptions = {}): ContractAuditRow[] {
    const limit = opts.limit ?? 100;
    const rows: ContractAuditDbRow[] =
      opts.vault !== undefined
        ? this._listByKindAndVault.all(kind, opts.vault, limit)
        : this._listByKindAll.all(kind, limit);
    return rows.map(toContractAuditRow);
  }

  aggregateVerbUsage(vault: string): VerbUsageRow[] {
    return this._aggregate.all(vault);
  }
}

function toContractAuditRow(row: ContractAuditDbRow): ContractAuditRow {
  const out: ContractAuditRow = {
    kind: row.kind as ContractAuditRow["kind"],
    ts: row.ts,
  };
  if (row.contract !== null) out.contract = row.contract;
  if (row.verb !== null) out.verb = row.verb;
  if (row.step_alias !== null) out.stepAlias = row.step_alias;
  if (row.vault !== null) out.vault = row.vault;
  if (row.error_message !== null) out.errorMessage = row.error_message;
  return out;
}
