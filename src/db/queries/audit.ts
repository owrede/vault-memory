import type BetterSqlite3 from "better-sqlite3";
import type { IndexRunRow, WriteAuditRow } from "../types.js";

export interface StartRunInput {
  runId: string;
  vaultName: string;
  modelId: number | null;
  trigger: string;
}

export interface FinishRunStats {
  notesIndexed: number;
  chunksCreated: number;
  notesUpdated: number;
  notesDeleted: number;
  error?: string;
}

export interface RecordWriteInput {
  noteId: number;
  op: "create" | "update" | "delete";
  previousHash: string | null;
  newHash: string | null;
  expectedHash: string | null;
  clientId: string | null;
  diffSummary: string | null;
  /**
   * Plan 02-06 (MEM-08): true iff this write was routed under a MemorySink
   * (agent observation / supersede), false for regular user writes. Stored
   * as INTEGER 1/0 via migration 009's `is_memory_sink_write` column.
   * Defaults to false when omitted — preserves Phase 1 call sites that
   * have not yet been threaded with the sink-derived flag.
   */
  isMemorySinkWrite?: boolean;
}

export interface ListWritesFilter {
  noteId?: number;
  op?: string;
  since?: number;
  limit?: number;
  /**
   * Plan 02-06 (MEM-08): filter to memory-sink writes only (`true`) or
   * non-memory writes only (`false`). Omit to include all rows (default,
   * preserves Phase 1 v1 audit_log behavior). Uses the partial index
   * `idx_write_audit_memory` for the `true` branch.
   */
  isMemorySinkWrite?: boolean;
}

export class AuditQueries {
  private readonly _startRun: BetterSqlite3.Statement;
  private readonly _finishRun: BetterSqlite3.Statement;
  private readonly _listRuns: BetterSqlite3.Statement<[number], IndexRunRow>;
  private readonly _recordWrite: BetterSqlite3.Statement;
  private readonly _isIndexing: BetterSqlite3.Statement<[], { c: number }>;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._startRun = db.prepare(`
      INSERT INTO index_runs (run_id, vault_name, model_id, started_at, trigger)
      VALUES (@run_id, @vault_name, @model_id, @started_at, @trigger)
    `);
    this._finishRun = db.prepare(`
      UPDATE index_runs
      SET finished_at = @finished_at,
          notes_indexed = @notes_indexed,
          chunks_created = @chunks_created,
          notes_updated = @notes_updated,
          notes_deleted = @notes_deleted,
          error = @error
      WHERE run_id = @run_id
    `);
    this._listRuns = db.prepare<[number], IndexRunRow>(
      "SELECT * FROM index_runs ORDER BY id DESC LIMIT ?",
    );
    // True iff there is at least one unfinished run in the audit log.
    // Used by the search layer to avoid surfacing chunks from a vault
    // whose embeddings are mid-flight (see search/scope.ts).
    this._isIndexing = db.prepare<[], { c: number }>(
      "SELECT COUNT(*) AS c FROM index_runs WHERE finished_at IS NULL",
    );
    this._recordWrite = db.prepare(`
      INSERT INTO write_audit (note_id, op, previous_hash, new_hash, expected_hash, client_id, diff_summary, at, is_memory_sink_write)
      VALUES (@note_id, @op, @previous_hash, @new_hash, @expected_hash, @client_id, @diff_summary, @at, @is_memory_sink_write)
    `);
  }

  startRun(input: StartRunInput): number {
    const info = this._startRun.run({
      run_id: input.runId,
      vault_name: input.vaultName,
      model_id: input.modelId,
      started_at: Date.now(),
      trigger: input.trigger,
    });
    return Number(info.lastInsertRowid);
  }

  finishRun(runId: string, stats: FinishRunStats): void {
    this._finishRun.run({
      run_id: runId,
      finished_at: Date.now(),
      notes_indexed: stats.notesIndexed,
      chunks_created: stats.chunksCreated,
      notes_updated: stats.notesUpdated,
      notes_deleted: stats.notesDeleted,
      error: stats.error ?? null,
    });
  }

  listRuns(limit = 50): IndexRunRow[] {
    return this._listRuns.all(limit);
  }

  /** True iff at least one index_runs row in this vault has finished_at IS NULL. */
  isIndexing(): boolean {
    return (this._isIndexing.get()?.c ?? 0) > 0;
  }

  recordWrite(input: RecordWriteInput): void {
    this._recordWrite.run({
      note_id: input.noteId,
      op: input.op,
      previous_hash: input.previousHash,
      new_hash: input.newHash,
      expected_hash: input.expectedHash,
      client_id: input.clientId,
      diff_summary: input.diffSummary,
      at: Date.now(),
      // Phase 1 call sites that have not been threaded with the flag default
      // to 0 (non-memory write) — backwards-compatible with migration 009's
      // ALTER default. Memory-routed writes (record_observation, supersede)
      // pass `isMemorySinkWrite: true`.
      is_memory_sink_write: input.isMemorySinkWrite ? 1 : 0,
    });
  }

  listWrites(filter: ListWritesFilter = {}): WriteAuditRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.noteId !== undefined) {
      where.push("note_id = ?");
      params.push(filter.noteId);
    }
    if (filter.op !== undefined) {
      where.push("op = ?");
      params.push(filter.op);
    }
    if (filter.since !== undefined) {
      where.push("at >= ?");
      params.push(filter.since);
    }
    if (filter.isMemorySinkWrite !== undefined) {
      where.push("is_memory_sink_write = ?");
      params.push(filter.isMemorySinkWrite ? 1 : 0);
    }
    const limit = filter.limit ?? 100;
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `SELECT * FROM write_audit ${whereSql} ORDER BY id DESC LIMIT ?`;
    params.push(limit);
    return this.db.prepare<typeof params, WriteAuditRow>(sql).all(...params);
  }

  /**
   * Plan 02-06 (MEM-09): epoch-ms timestamp of the most recent memory-sink
   * write to a note whose path begins with `pathPrefix`, or `null` if no
   * such row exists. Backed by the `idx_write_audit_memory` partial index
   * (migration 009).
   *
   * Looks up via the `notes.path` value joined to `write_audit.note_id`.
   * Returns null when the note row was hard-deleted (FK SET NULL) or
   * when no audit row matches.
   */
  lastMemoryWriteAtForPathPrefix(pathPrefix: string): number | null {
    const row = this.db
      .prepare<[string], { at: number }>(
        `SELECT wa.at AS at
           FROM write_audit AS wa
           JOIN notes AS n ON n.id = wa.note_id
          WHERE wa.is_memory_sink_write = 1
            AND n.path LIKE ? ESCAPE '\\'
          ORDER BY wa.at DESC
          LIMIT 1`,
      )
      .get(escapeAuditLikePrefix(pathPrefix) + "%");
    return row?.at ?? null;
  }
}

/** Mirror of notes.ts `escapeLikePrefix` — local copy to avoid a cross-file dep. */
function escapeAuditLikePrefix(prefix: string): string {
  return prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
