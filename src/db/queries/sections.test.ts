import { describe, expect, it, beforeEach } from "vitest";
import { Database } from "../index.js";
import type { InsertSectionRow } from "../../types.js";

describe("SectionsQueries", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
  });

  function seedNote(path: string): number {
    return db.notes.upsertByPath({
      path,
      content: "x",
      frontmatter: null,
      title: path,
      hash: path,
      bodyHash: path + ".body",
      mtime: 0,
      wordCount: 1,
    }).id;
  }

  function row(
    noteId: number,
    overrides: Partial<InsertSectionRow> & Pick<InsertSectionRow, "anchor" | "heading_text">,
  ): InsertSectionRow {
    return {
      note_id: noteId,
      anchor: overrides.anchor,
      heading_path: overrides.heading_path ?? JSON.stringify([overrides.heading_text]),
      heading_text: overrides.heading_text,
      level: overrides.level ?? 1,
      parent_id: overrides.parent_id ?? null,
      ord: overrides.ord ?? 0,
      chunk_id_first: overrides.chunk_id_first ?? null,
      chunk_id_last: overrides.chunk_id_last ?? null,
    };
  }

  it("insertMany returns new ids in input order", () => {
    const nid = seedNote("a.md");
    const ids = db.sections.insertMany([
      row(nid, { anchor: "h1a", heading_text: "A" }),
      row(nid, { anchor: "h1b", heading_text: "B" }),
    ]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeGreaterThan(0);
    expect(ids[1]).toBeGreaterThan(ids[0]!);
  });

  it("getByAnchor finds the unique row", () => {
    const nid = seedNote("a.md");
    db.sections.insertMany([row(nid, { anchor: "abc123", heading_text: "Intro" })]);
    const found = db.sections.getByAnchor(nid, "abc123");
    expect(found).not.toBeNull();
    expect(found!.heading_text).toBe("Intro");
    expect(db.sections.getByAnchor(nid, "nope")).toBeNull();
  });

  it("deleteByNote removes all rows for that note", () => {
    const nid = seedNote("a.md");
    db.sections.insertMany([
      row(nid, { anchor: "x1", heading_text: "X" }),
      row(nid, { anchor: "x2", heading_text: "Y" }),
    ]);
    expect(db.sections.countByNote(nid)).toBe(2);
    db.sections.deleteByNote(nid);
    expect(db.sections.countByNote(nid)).toBe(0);
  });

  it("getByNote returns rows in tree order (NULL parents first, then by parent ASC, then ord ASC)", () => {
    const nid = seedNote("a.md");
    // Two top-level (parent NULL) + two children of the first.
    const [parentA] = db.sections.insertMany([
      row(nid, { anchor: "pa", heading_text: "A", ord: 0 }),
    ]);
    const [parentB] = db.sections.insertMany([
      row(nid, { anchor: "pb", heading_text: "B", ord: 1 }),
    ]);
    db.sections.insertMany([
      row(nid, {
        anchor: "ca2",
        heading_text: "A2",
        parent_id: parentA!,
        level: 2,
        ord: 1,
      }),
      row(nid, {
        anchor: "ca1",
        heading_text: "A1",
        parent_id: parentA!,
        level: 2,
        ord: 0,
      }),
    ]);

    const all = db.sections.getByNote(nid);
    // Two NULL-parent rows come first.
    expect(all.slice(0, 2).every((r) => r.parent_id === null)).toBe(true);
    // Among NULL parents, ord ASC.
    expect(all[0]!.heading_text).toBe("A");
    expect(all[1]!.heading_text).toBe("B");
    // Among children of A, ord ASC.
    const children = all.filter((r) => r.parent_id === parentA);
    expect(children.map((r) => r.heading_text)).toEqual(["A1", "A2"]);
    // sanity
    expect(parentB).toBeGreaterThan(0);
  });

  it("findContainingChunk returns the innermost section whose range contains chunkId", () => {
    const nid = seedNote("a.md");
    // Seed three chunks so chunk IDs are real FKs.
    const chunkIds = db.chunks.insertBatch(nid, [
      { idx: 0, text: "x", headingPath: null, startOffset: 0, endOffset: 1, tokenCount: 1 },
      { idx: 1, text: "y", headingPath: null, startOffset: 1, endOffset: 2, tokenCount: 1 },
      { idx: 2, text: "z", headingPath: null, startOffset: 2, endOffset: 3, tokenCount: 1 },
    ]);
    expect(chunkIds).toHaveLength(3);
    const cFirst = chunkIds[0]!;
    const cLast = chunkIds[2]!;

    // Outer section covers all three chunks; inner section covers only the middle one.
    const [outerId] = db.sections.insertMany([
      row(nid, {
        anchor: "outer",
        heading_text: "Outer",
        level: 1,
        chunk_id_first: cFirst,
        chunk_id_last: cLast,
      }),
    ]);
    db.sections.insertMany([
      row(nid, {
        anchor: "inner",
        heading_text: "Inner",
        level: 2,
        parent_id: outerId!,
        chunk_id_first: chunkIds[1]!,
        chunk_id_last: chunkIds[1]!,
      }),
    ]);

    // The middle chunk should resolve to the inner section (smallest range).
    const containing = db.sections.findContainingChunk(nid, chunkIds[1]!);
    expect(containing).not.toBeNull();
    expect(containing!.heading_text).toBe("Inner");

    // The first chunk only sits in the outer.
    const outer = db.sections.findContainingChunk(nid, cFirst);
    expect(outer).not.toBeNull();
    expect(outer!.heading_text).toBe("Outer");

    // A chunk ID not covered by any section returns null.
    expect(db.sections.findContainingChunk(nid, 999_999)).toBeNull();
  });

  it("cascade deletes sections when the parent note is deleted", () => {
    const nid = seedNote("a.md");
    db.sections.insertMany([row(nid, { anchor: "x", heading_text: "X" })]);
    expect(db.sections.countByNote(nid)).toBe(1);
    db.notes.deleteByPath("a.md");
    expect(db.sections.countByNote(nid)).toBe(0);
  });

  it("insertMany is collision-safe (INSERT OR IGNORE): a duplicate anchor does not throw", () => {
    // Regression for ISSUE-indexer-duplicate-anchor.md: a note with two
    // sibling sections that GitHub-slugify to the same anchor must not abort
    // the index run. The first sibling wins the UNIQUE(note_id, anchor) slot;
    // the second is silently ignored rather than throwing.
    const nid = seedNote("a.md");
    db.sections.insertMany([row(nid, { anchor: "dup", heading_text: "A" })]);
    expect(() =>
      db.sections.insertMany([row(nid, { anchor: "dup", heading_text: "B" })]),
    ).not.toThrow();
    expect(db.sections.countByNote(nid)).toBe(1);
    expect(db.sections.getByAnchor(nid, "dup")!.heading_text).toBe("A");
  });

  describe("insertOneResolving (collision-safe single insert)", () => {
    it("returns the new row id on a fresh insert", () => {
      const nid = seedNote("a.md");
      const id = db.sections.insertOneResolving(row(nid, { anchor: "fresh", heading_text: "A" }));
      expect(id).not.toBeNull();
      expect(id!).toBeGreaterThan(0);
      expect(db.sections.countByNote(nid)).toBe(1);
    });

    it("returns the SURVIVING row id on a duplicate-anchor collision (parent linkage)", () => {
      const nid = seedNote("a.md");
      const first = db.sections.insertOneResolving(
        row(nid, { anchor: "dup", heading_text: "First" }),
      );
      const second = db.sections.insertOneResolving(
        row(nid, { anchor: "dup", heading_text: "Second" }),
      );
      expect(second).toBe(first);
      expect(db.sections.countByNote(nid)).toBe(1);
      expect(db.sections.getByAnchor(nid, "dup")!.heading_text).toBe("First");
      db.sections.insertOneResolving(
        row(nid, { anchor: "child", heading_text: "Child", parent_id: second!, level: 2 }),
      );
      const child = db.sections.getByAnchor(nid, "child");
      expect(child!.parent_id).toBe(first);
    });
  });
});
