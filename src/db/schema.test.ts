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
    expect(db.getSchemaVersion()).toBe(4);
  });

  it("migrate is idempotent", () => {
    db.migrate();
    db.migrate();
    expect(db.getSchemaVersion()).toBe(4);
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

  it.each(["embeddings_1024", "embeddings_768", "chunks_fts"])(
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
