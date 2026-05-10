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
}

export interface ListWritesFilter {
  noteId?: number;
  op?: string;
  since?: number;
  limit?: number;
}

export class AuditQueries {
  private readonly _startRun: BetterSqlite3.Statement;
  private readonly _finishRun: BetterSqlite3.Statement;
  private readonly _listRuns: BetterSqlite3.Statement<[number], IndexRunRow>;
  private readonly _recordWrite: BetterSqlite3.Statement;

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
    this._recordWrite = db.prepare(`
      INSERT INTO write_audit (note_id, op, previous_hash, new_hash, expected_hash, client_id, diff_summary, at)
      VALUES (@note_id, @op, @previous_hash, @new_hash, @expected_hash, @client_id, @diff_summary, @at)
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
    const limit = filter.limit ?? 100;
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `SELECT * FROM write_audit ${whereSql} ORDER BY id DESC LIMIT ?`;
    params.push(limit);
    return this.db.prepare<typeof params, WriteAuditRow>(sql).all(...params);
  }
}
