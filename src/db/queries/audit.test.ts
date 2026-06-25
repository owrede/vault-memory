/**
 * Plan 02-06 (MEM-08) — AuditQueries discriminator tests.
 *
 * Pins the DB-level behavior added by migration 009:
 *   - recordWrite({isMemorySinkWrite: true}) stores 1 in the new column.
 *   - recordWrite({isMemorySinkWrite: false}) stores 0.
 *   - recordWrite({}) (Phase 1 callers) stores 0.
 *   - listWrites({isMemorySinkWrite: true}) returns memory rows only.
 *   - listWrites({isMemorySinkWrite: false}) returns non-memory rows only.
 *   - listWrites({}) returns all rows (legacy behavior preserved).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { Database } from "../database.js";

function seedNote(db: Database, path: string): number {
  return db.notes.upsertByPath({
    path,
    content: "x",
    frontmatter: null,
    title: path,
    hash: `hash-${path}`,
    bodyHash: `bh-${path}`,
    mtime: 0,
    wordCount: 1,
  }).id;
}

describe("AuditQueries — MEM-08 is_memory_sink_write column (Plan 02-06)", () => {
  let db: Database;
  let noteAId: number;
  let noteBId: number;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    noteAId = seedNote(db, "user-note.md");
    noteBId = seedNote(db, "_memory/observation.md");
  });

  afterEach(() => db.close());

  it("migration 009 has applied (column exists, partial index present)", () => {
    const cols = db.handle.prepare("PRAGMA table_info(write_audit)").all() as Array<{
      name: string;
      type: string;
      dflt_value: string | null;
      notnull: number;
    }>;
    const col = cols.find((c) => c.name === "is_memory_sink_write");
    expect(col).toBeDefined();
    expect(col!.type.toUpperCase()).toBe("INTEGER");
    expect(col!.notnull).toBe(1);
    // SQLite normalizes the DEFAULT expression; verify it reads as 0.
    expect(String(col!.dflt_value)).toBe("0");

    const indexes = db.handle.prepare("PRAGMA index_list(write_audit)").all() as Array<{
      name: string;
      partial: number;
    }>;
    const memIdx = indexes.find((i) => i.name === "idx_write_audit_memory");
    expect(memIdx).toBeDefined();
    expect(memIdx!.partial).toBe(1);
  });

  it("recordWrite with isMemorySinkWrite: true stores 1", () => {
    db.audit.recordWrite({
      noteId: noteBId,
      op: "create",
      previousHash: null,
      newHash: "h-mem",
      expectedHash: null,
      clientId: "agent",
      diffSummary: null,
      isMemorySinkWrite: true,
    });
    const rows = db.audit.listWrites({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_memory_sink_write).toBe(1);
  });

  it("recordWrite with isMemorySinkWrite: false stores 0", () => {
    db.audit.recordWrite({
      noteId: noteAId,
      op: "create",
      previousHash: null,
      newHash: "h-user",
      expectedHash: null,
      clientId: "user",
      diffSummary: null,
      isMemorySinkWrite: false,
    });
    const rows = db.audit.listWrites({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_memory_sink_write).toBe(0);
  });

  it("recordWrite WITHOUT the flag (Phase 1 callers) defaults to 0", () => {
    db.audit.recordWrite({
      noteId: noteAId,
      op: "create",
      previousHash: null,
      newHash: "h-legacy",
      expectedHash: null,
      clientId: "v1",
      diffSummary: null,
    });
    const rows = db.audit.listWrites({});
    expect(rows[0]!.is_memory_sink_write).toBe(0);
  });

  it("listWrites filter selects only memory / non-memory / all rows", () => {
    // 1 memory write, 2 user writes
    db.audit.recordWrite({
      noteId: noteBId,
      op: "create",
      previousHash: null,
      newHash: "m1",
      expectedHash: null,
      clientId: "agent",
      diffSummary: null,
      isMemorySinkWrite: true,
    });
    db.audit.recordWrite({
      noteId: noteAId,
      op: "create",
      previousHash: null,
      newHash: "u1",
      expectedHash: null,
      clientId: "user",
      diffSummary: null,
      isMemorySinkWrite: false,
    });
    db.audit.recordWrite({
      noteId: noteAId,
      op: "update",
      previousHash: "u1",
      newHash: "u2",
      expectedHash: "u1",
      clientId: "user",
      diffSummary: null,
      isMemorySinkWrite: false,
    });

    const mem = db.audit.listWrites({ isMemorySinkWrite: true });
    expect(mem).toHaveLength(1);
    expect(mem[0]!.new_hash).toBe("m1");

    const user = db.audit.listWrites({ isMemorySinkWrite: false });
    expect(user).toHaveLength(2);
    for (const r of user) expect(r.is_memory_sink_write).toBe(0);

    const all = db.audit.listWrites({});
    expect(all).toHaveLength(3);
  });
});

// Forward-compat: a pre-v9 audit row (no `is_memory_sink_write` column)
// surfaces as 0 after migration 009 applies the ALTER with DEFAULT 0.
// We model the "v8 DB" by hand-building the write_audit table in the pre-v9
// shape, then applying the exact migration 009 SQL.
describe("AuditQueries — v1.x → v9 forward-compat (Plan 02-06)", () => {
  it("ALTER ... DEFAULT 0 surfaces legacy rows as is_memory_sink_write=0", () => {
    const raw = new BetterSqlite3(":memory:");
    try {
      raw.exec(`
        CREATE TABLE write_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id INTEGER,
          op TEXT NOT NULL,
          previous_hash TEXT,
          new_hash TEXT,
          expected_hash TEXT,
          client_id TEXT,
          diff_summary TEXT,
          at INTEGER NOT NULL
        );
        INSERT INTO write_audit
          (note_id, op, previous_hash, new_hash, expected_hash, client_id, diff_summary, at)
        VALUES (1, 'create', NULL, 'h', NULL, 'legacy', NULL, 12345);
      `);
      // Apply migration 009 SQL verbatim.
      raw.exec(`
        ALTER TABLE write_audit ADD COLUMN is_memory_sink_write INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_write_audit_memory
          ON write_audit(is_memory_sink_write, at DESC)
          WHERE is_memory_sink_write = 1;
      `);
      const migrated = raw
        .prepare("SELECT is_memory_sink_write FROM write_audit WHERE op = 'create'")
        .get() as { is_memory_sink_write: number };
      expect(migrated.is_memory_sink_write).toBe(0);

      // Partial index actually exists on the simulated v8→v9 DB.
      const indexes = raw.prepare("PRAGMA index_list(write_audit)").all() as Array<{
        name: string;
        partial: number;
      }>;
      const memIdx = indexes.find((i) => i.name === "idx_write_audit_memory");
      expect(memIdx).toBeDefined();
      expect(memIdx!.partial).toBe(1);
    } finally {
      raw.close();
    }
  });
});
