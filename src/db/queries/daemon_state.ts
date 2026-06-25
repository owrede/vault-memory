/**
 * DaemonStateQueries — Phase 5 / D-09 staleness daemon cursor.
 *
 * Single-row-per-vault state (`vault_name TEXT PRIMARY KEY`). Used by
 * the staleness daemon (Plan 05-03) for the hybrid replay strategy:
 *
 *   1. Startup full scan (correctness floor).
 *   2. Read `last_seen_doc_mtime` cursor (steady-state diagnostic).
 *   3. After processing each ChangeEvent, bump cursor.
 *
 * The cursor is a **diagnostic hint** — never the sole correctness
 * guarantee. The startup scan is the floor regardless of cursor value.
 * Departure from the recommended "mtime-only" option per CONTEXT D-09.
 *
 * UPSERT idiom: `INSERT ... ON CONFLICT(vault_name) DO UPDATE SET`
 * keeps the single-row invariant via the PRIMARY KEY.
 *
 * Adapter-seam discipline: no `fs`/`path`/`gray-matter`/`chokidar`
 * imports. `scripts/lint-adapters.sh` enforces.
 */

import type BetterSqlite3 from "better-sqlite3";

export class DaemonStateQueries {
  private readonly _getCursor: BetterSqlite3.Statement<[string], { last_seen_doc_mtime: number }>;
  private readonly _setCursor: BetterSqlite3.Statement;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._getCursor = db.prepare(
      "SELECT last_seen_doc_mtime FROM daemon_state WHERE vault_name = ?",
    );
    this._setCursor = db.prepare(`
      INSERT INTO daemon_state (vault_name, last_seen_doc_mtime)
      VALUES (@vault_name, @mtime)
      ON CONFLICT(vault_name) DO UPDATE SET last_seen_doc_mtime = @mtime
    `);
  }

  /**
   * Returns the cursor for `vaultName`, or `null` if no row exists yet
   * (fresh vault, daemon has never run). Callers treat `null` as
   * "perform the startup full scan" — the cursor is a steady-state
   * efficiency hint, never a correctness floor.
   */
  getCursor(vaultName: string): number | null {
    const row = this._getCursor.get(vaultName);
    return row?.last_seen_doc_mtime ?? null;
  }

  setCursor(vaultName: string, mtime: number): void {
    this._setCursor.run({ vault_name: vaultName, mtime });
  }
}
