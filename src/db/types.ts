/**
 * DB-layer internal row types.
 *
 * Public types live in `src/types.ts`. These types are internal to the
 * DB layer and not part of the cross-module public contract.
 */

export interface IndexRunRow {
  id: number;
  run_id: string;
  vault_name: string;
  model_id: number | null;
  started_at: number;
  finished_at: number | null;
  trigger: string;
  notes_indexed: number;
  chunks_created: number;
  notes_updated: number;
  notes_deleted: number;
  error: string | null;
}

export interface WriteAuditRow {
  id: number;
  note_id: number;
  op: "create" | "update" | "delete";
  previous_hash: string | null;
  new_hash: string | null;
  expected_hash: string | null;
  client_id: string | null;
  diff_summary: string | null;
  at: number;
  /**
   * Migration 009 (MEM-08, Plan 02-06): 1 iff this write was routed under
   * a MemorySink (agent observation / supersede). 0 for regular user writes
   * and for any row predating migration 009 (default applied during ALTER).
   * Boolean conversion happens at the AuditQueries / audit layer; the DB
   * column is INTEGER NOT NULL DEFAULT 0.
   */
  is_memory_sink_write: 0 | 1;
}
