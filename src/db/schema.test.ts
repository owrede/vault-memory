import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "./database.js";

describe("schema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  it("sets user_version to the latest migration version", () => {
    expect(db.getSchemaVersion()).toBe(5);
  });

  it("migrate is idempotent", () => {
    db.migrate();
    db.migrate();
    expect(db.getSchemaVersion()).toBe(5);
  });

  it.each([
    "notes",
    "chunks",
    "models",
    "wikilinks",
    "index_runs",
    "write_audit",
    "note_aliases",
  ])("creates table %s with columns", (table) => {
    const rows = db.handle.pragma(`table_info(${table})`) as Array<{
      name: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
  });

  // Phase 7e (v5): no embeddings_* tables are pre-created — they are
  // materialised on demand per model (`embeddings_m<id>_d<dim>`). Only
  // chunks_fts is created up-front by the schema.
  it.each(["chunks_fts"])(
    "creates virtual table %s",
    (table) => {
      const row = db.handle
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table);
      expect(row?.name).toBe(table);
    },
  );

  it("creates expected indexes", () => {
    const indexes = db.handle
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
      )
      .all()
      .map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_notes_hash",
        "idx_notes_mtime",
        "idx_chunks_note",
        "idx_wikilinks_source",
        "idx_wikilinks_target",
        "idx_write_audit_note",
      ]),
    );
  });
});
