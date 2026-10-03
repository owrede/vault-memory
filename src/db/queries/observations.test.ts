import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../database.js";
import type { ObservationDraft } from "../../observations/parse.js";
describe("derived observation SQL snapshots", () => {
  let db: Database;
  let id: number;
  const rows: ObservationDraft[] = [
    { category: "fact", text: "Exact fact", line_start: 2, line_end: 3 },
    { category: "decision", text: "Decision", line_start: 5, line_end: 5 },
  ];
  beforeEach(() => {
    db = new Database(":memory:", "test");
    id = db.notes.upsertByPath({
      path: "a.md",
      title: "A",
      content: "body",
      frontmatter: null,
      hash: "h1",
      bodyHash: "b",
      mtime: 0,
      wordCount: 1,
    }).id;
  });
  afterEach(() => {
    db.close();
  });
  it("creates observation storage and source-hash marker in migration 17", () => {
    expect(db.handle.pragma("table_info(observations)")).toHaveLength(11);
    expect(
      (db.handle.pragma("table_info(notes)") as { name: string }[]).map((c) => c.name),
    ).toContain("observations_hash");
    db.migrate();
    db.migrate();
    expect(db.getSchemaVersion()).toBe(19);
  });
  it("upgrades a version-16 vault without inferring or changing its stored text", () => {
    const original = db.notes.getById(id)!;
    db.handle.exec(
      "DROP TABLE observations; ALTER TABLE notes DROP COLUMN observations_hash; PRAGMA user_version=16;",
    );
    db.migrate();
    db.migrate();
    expect(db.getSchemaVersion()).toBe(19);
    expect(db.notes.getById(id)).toMatchObject({
      content: original.content,
      hash: original.hash,
      frontmatter: original.frontmatter,
    });
    expect(db.observations.listForNote(id)).toEqual([]);
    expect(db.observations.indexedHash(id)).toBeNull();
  });
  it("replaces snapshots idempotently, retaining ids of identical statements", () => {
    db.observations.replaceForNote(id, "h1", rows);
    const initial = db.observations.listForNote(id);
    expect(initial).toMatchObject(rows.map((row) => ({ ...row, note_id: id, doc_hash: "h1" })));
    expect(db.observations.indexedHash(id)).toBe("h1");
    db.observations.replaceForNote(id, "h1", rows);
    expect(db.observations.listForNote(id)).toEqual(initial);
    db.observations.replaceForNote(id, "h2", [rows[0]!]);
    expect(db.observations.listForNote(id)).toEqual([{ ...initial[0]!, doc_hash: "h2" }]);
    expect(db.observations.listForNote(id, "decision")).toEqual([]);
    db.observations.replaceForNote(id, "h3", []);
    expect(db.observations.listForNote(id)).toEqual([]);
    expect(db.observations.indexedHash(id)).toBe("h3");
  });
  it("rolls back the complete snapshot on invalid source coordinates", () => {
    db.observations.replaceForNote(id, "h1", rows);
    const initial = db.observations.listForNote(id);
    expect(() =>
      db.observations.replaceForNote(id, "h2", [{ ...rows[0]!, line_end: 1 }]),
    ).toThrow();
    expect(db.observations.listForNote(id)).toEqual(initial);
    expect(db.observations.indexedHash(id)).toBe("h1");
  });
  it("cascades deletion and safely binds category filters", () => {
    db.observations.replaceForNote(id, "h1", rows);
    expect(db.observations.listForNote(id, "fact")).toHaveLength(1);
    expect(db.observations.listForNote(id, "fact' OR 1=1 --")).toEqual([]);
    db.notes.deleteByPath("a.md");
    expect(db.observations.listForNote(id)).toEqual([]);
    expect(db.observations.indexedHash(id)).toBeNull();
  });
});
