/**
 * Audit log + index-run reporting — user-facing layer.
 *
 * Thin wrapper over `AuditQueries` that enriches raw audit rows with
 * note-path / note-title context (best effort — null if the note has
 * been hard-deleted from the `notes` table).
 *
 * See `./README.md` for the audit + permission semantics.
 */

import type { Vault } from "../vault/index.js";
import type { ListWritesFilter } from "../db/queries/audit.js";

const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 1000;
const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 200;

export interface AuditLogEntry {
  /** Write event id (sortable, monotonically increasing). */
  id: number;
  /** Note path (relative to vault root), or null if note was hard-deleted. */
  notePath: string | null;
  /** Note title at time of write — best-effort, may be null if deleted. */
  noteTitle: string | null;
  op: "create" | "update" | "delete";
  previousHash: string | null;
  newHash: string | null;
  /** Hash the writer expected on disk; mismatch = conflict prevention triggered. */
  expectedHash: string | null;
  clientId: string | null;
  diffSummary: string | null;
  /** Epoch ms. */
  at: number;
  /**
   * Plan 02-06 (MEM-08): true iff this write was routed under a configured
   * MemorySink (agent observation, supersede). False for regular user writes
   * and for any audit row predating migration 009 (those rows surface as
   * `false` per the column default). Filter via the `is_memory_sink_write`
   * filter on `getAuditLog` / the `audit_log` MCP tool.
   */
  is_memory_sink_write: boolean;
}

export interface IndexRunEntry {
  runId: string;
  vaultName: string;
  modelName: string | null;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  notesIndexed: number;
  notesUpdated: number;
  notesDeleted: number;
  chunksCreated: number;
  error: string | null;
}

export interface GetAuditLogInput {
  vault: Vault;
  notePath?: string;
  op?: "create" | "update" | "delete";
  /** Epoch ms — only entries at or after this timestamp. */
  since?: number;
  limit?: number;
  /**
   * Plan 02-06 (MEM-08): when set, restricts the result to memory-sink
   * writes (`true`) or non-memory writes (`false`). When omitted, both
   * kinds are included — preserves the v1 audit_log default behavior.
   */
  is_memory_sink_write?: boolean;
}

export interface GetIndexRunsInput {
  vault: Vault;
  limit?: number;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const n = Math.floor(value);
  return n > max ? max : n;
}

export function getAuditLog(input: GetAuditLogInput): AuditLogEntry[] {
  const { vault } = input;
  const limit = clampLimit(input.limit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);

  const filter: ListWritesFilter = { limit };

  if (input.notePath !== undefined) {
    const note = vault.db.notes.getByPath(input.notePath);
    if (!note) return [];
    filter.noteId = note.id;
  }
  if (input.op !== undefined) filter.op = input.op;
  if (input.since !== undefined) filter.since = input.since;
  if (input.is_memory_sink_write !== undefined) {
    filter.isMemorySinkWrite = input.is_memory_sink_write;
  }

  const rows = vault.db.audit.listWrites(filter);

  return rows.map((row): AuditLogEntry => {
    const note = vault.db.notes.getById(row.note_id);
    return {
      id: row.id,
      notePath: note?.path ?? null,
      noteTitle: note?.title ?? null,
      op: row.op,
      previousHash: row.previous_hash,
      newHash: row.new_hash,
      expectedHash: row.expected_hash,
      clientId: row.client_id,
      diffSummary: row.diff_summary,
      at: row.at,
      // SQLite returns the column as 0 | 1; convert to JS boolean at the
      // audit-layer boundary so callers (MCP audit_log + tests) see the
      // documented `is_memory_sink_write: boolean` shape.
      is_memory_sink_write: row.is_memory_sink_write === 1,
    };
  });
}

export function getIndexRuns(input: GetIndexRunsInput): IndexRunEntry[] {
  const { vault } = input;
  const limit = clampLimit(input.limit, DEFAULT_RUNS_LIMIT, MAX_RUNS_LIMIT);

  const rows = vault.db.audit.listRuns(limit);

  return rows.map((row): IndexRunEntry => {
    let modelName: string | null = null;
    if (row.model_id !== null) {
      const all = vault.db.models.listAll();
      const found = all.find((m) => m.id === row.model_id);
      modelName = found?.name ?? null;
    }
    const durationMs = row.finished_at !== null ? row.finished_at - row.started_at : null;
    return {
      runId: row.run_id,
      vaultName: row.vault_name,
      modelName,
      trigger: row.trigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs,
      notesIndexed: row.notes_indexed,
      notesUpdated: row.notes_updated,
      notesDeleted: row.notes_deleted,
      chunksCreated: row.chunks_created,
      error: row.error,
    };
  });
}
