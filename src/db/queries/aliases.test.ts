import { describe, expect, it, beforeEach } from "vitest";
import { Database } from "../index.js";

describe("AliasesQueries", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.migrate();
  });

  function seedNote(path: string, title: string): number {
    return db.notes.upsertByPath({
      path,
      content: "x",
      frontmatter: null,
      title,
      hash: path,
      mtime: 0,
      wordCount: 1,
    }).id;
  }

  it("set + resolve a single alias", () => {
    const id = seedNote("p/Foo.md", "Foo");
    db.aliases.setForNote(id, ["FB"]);
    const hit = db.aliases.resolve("FB");
    expect(hit?.note_id).toBe(id);
    expect(hit?.path).toBe("p/Foo.md");
    expect(hit?.alias).toBe("FB");
  });

  it("resolve is case-insensitive", () => {
    const id = seedNote("p/Bar.md", "Bar");
    db.aliases.setForNote(id, ["JHE"]);
    expect(db.aliases.resolve("jhe")?.note_id).toBe(id);
    expect(db.aliases.resolve("Jhe")?.note_id).toBe(id);
  });

  it("setForNote replaces existing aliases atomically", () => {
    const id = seedNote("p/N.md", "N");
    db.aliases.setForNote(id, ["A", "B"]);
    expect(db.aliases.listForNote(id).sort()).toEqual(["A", "B"]);
    db.aliases.setForNote(id, ["C"]);
    expect(db.aliases.listForNote(id)).toEqual(["C"]);
    expect(db.aliases.resolve("A")).toBeNull();
    expect(db.aliases.resolve("C")?.note_id).toBe(id);
  });

  it("ignores empty/whitespace aliases", () => {
    const id = seedNote("p/X.md", "X");
    db.aliases.setForNote(id, ["valid", "  ", ""]);
    expect(db.aliases.listForNote(id)).toEqual(["valid"]);
  });

  it("shortest path wins on collision", () => {
    const id1 = seedNote("very/deep/folder/A.md", "A1");
    const id2 = seedNote("A.md", "A2");
    db.aliases.setForNote(id1, ["short"]);
    db.aliases.setForNote(id2, ["short"]);
    expect(db.aliases.resolve("short")?.note_id).toBe(id2);
  });

  it("returns null for unknown alias", () => {
    expect(db.aliases.resolve("none")).toBeNull();
    expect(db.aliases.resolve("")).toBeNull();
    expect(db.aliases.resolve("   ")).toBeNull();
  });
});
