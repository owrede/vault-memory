import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import {
  folderOf,
  inferFromFolder,
  resolveInferenceFolder,
} from "./folder-conventions.js";

function makeVault(): Vault {
  const db = new Database(":memory:");
  db.migrate();
  return {
    config: { name: "test", path: "/tmp/test" },
    db,
    dbPath: ":memory:",
  };
}

function seedNote(
  vault: Vault,
  path: string,
  frontmatter: Record<string, unknown> | null,
  mtime = 1,
): void {
  vault.db.notes.upsertByPath({
    path,
    content: "body",
    frontmatter: frontmatter ? JSON.stringify(frontmatter) : null,
    title: path,
    hash: `h-${path}`,
    bodyHash: `bh-${path}`,
    mtime,
    wordCount: 1,
  });
}

describe("folderOf", () => {
  it("extracts folder prefix with trailing slash", () => {
    expect(folderOf("Personen/Joerg.md")).toBe("Personen/");
    expect(folderOf("a/b/c/d.md")).toBe("a/b/c/");
  });

  it("returns empty string for root-level notes", () => {
    expect(folderOf("note.md")).toBe("");
  });
});

describe("resolveInferenceFolder", () => {
  let vault: Vault;
  beforeEach(() => {
    vault = makeVault();
  });
  afterEach(() => {
    vault.db.close();
  });

  it("returns the immediate folder when it has enough siblings", () => {
    for (let i = 0; i < 5; i++) {
      seedNote(vault, `Personen/p${i}.md`, { class: "Person" });
    }
    const r = resolveInferenceFolder(vault, "Personen/new.md");
    expect(r.folder).toBe("Personen/");
    expect(r.fellBackFrom).toBeNull();
    expect(r.siblingCount).toBe(5);
  });

  it("falls back to parent folder when sibling count is below MIN_SIBLINGS", () => {
    // Immediate folder has only 1 note. Parent folder has many.
    seedNote(vault, "Foo/Bar/single.md", { class: "X" });
    for (let i = 0; i < 4; i++) {
      seedNote(vault, `Foo/p${i}.md`, { class: "Project" });
    }
    const r = resolveInferenceFolder(vault, "Foo/Bar/new.md");
    expect(r.folder).toBe("Foo/");
    expect(r.fellBackFrom).toBe("Foo/Bar/");
  });

  it("walks all the way up to vault root when nothing is found", () => {
    // Only one note exists in the entire vault.
    seedNote(vault, "Deep/Nested/lonely.md", { class: "X" });
    const r = resolveInferenceFolder(vault, "Deep/Nested/other.md");
    expect(r.folder).toBe("");
    expect(r.fellBackFrom).toBe("Deep/Nested/");
  });
});

describe("inferFromFolder", () => {
  let vault: Vault;
  beforeEach(() => {
    vault = makeVault();
  });
  afterEach(() => {
    vault.db.close();
  });

  it("returns key prevalence with dominant value", () => {
    for (let i = 0; i < 5; i++) {
      seedNote(vault, `Personen/p${i}.md`, {
        class: "Person",
        type: "person",
      });
    }
    seedNote(vault, "Personen/loose.md", { class: "Person" });

    const r = inferFromFolder(vault, "Personen/new.md");
    expect(r.resolvedFolder).toBe("Personen/");

    const classEntry = r.entries.find((e) => e.key === "class")!;
    expect(classEntry.prevalence).toBe(1.0);
    expect(classEntry.dominantValue).toBe("Person");

    const typeEntry = r.entries.find((e) => e.key === "type")!;
    expect(typeEntry.prevalence).toBeCloseTo(5 / 6, 3);
    expect(typeEntry.dominantValue).toBe("person");
  });

  it("emits null dominantValue when values split", () => {
    seedNote(vault, "Foo/a.md", { status: "active" });
    seedNote(vault, "Foo/b.md", { status: "active" });
    seedNote(vault, "Foo/c.md", { status: "done" });
    seedNote(vault, "Foo/d.md", { status: "blocked" });
    const r = inferFromFolder(vault, "Foo/new.md");
    const status = r.entries.find((e) => e.key === "status")!;
    // 2/4 = 50% — not above the >50% threshold, so dominantValue is null.
    expect(status.dominantValue).toBeNull();
  });

  it("tolerates dirty frontmatter (string-typed primitives)", () => {
    seedNote(vault, "Foo/clean.md", { tags: ["a", "b"] });
    // Directly insert a note with non-object frontmatter (rare but happens).
    vault.db.handle
      .prepare(
        "UPDATE notes SET frontmatter = ? WHERE path = ?",
      )
      .run('"just a string"', "Foo/clean.md");
    // Add a second note to keep siblings ≥ MIN.
    seedNote(vault, "Foo/2.md", { tags: ["a", "b"] });
    seedNote(vault, "Foo/3.md", { tags: ["a", "b"] });
    // Should not throw.
    const r = inferFromFolder(vault, "Foo/new.md");
    expect(r.entries).toBeDefined();
  });

  it("excludes the input note from sibling aggregation by default", () => {
    seedNote(vault, "X/exclude-me.md", { class: "Weird" });
    seedNote(vault, "X/a.md", { class: "Normal" });
    seedNote(vault, "X/b.md", { class: "Normal" });
    seedNote(vault, "X/c.md", { class: "Normal" });

    const r = inferFromFolder(vault, "X/exclude-me.md");
    const classEntry = r.entries.find((e) => e.key === "class")!;
    // Should pick "Normal", not "Weird".
    expect(classEntry.dominantValue).toBe("Normal");
  });
});
