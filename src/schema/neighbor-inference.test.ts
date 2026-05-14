import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { inferFromNeighbors } from "./neighbor-inference.js";

function makeVault(): Vault {
  const db = new Database(":memory:");
  db.migrate();
  return {
    config: { name: "test", path: "/tmp/test" },
    db,
    dbPath: ":memory:",
  };
}

function seedNote(vault: Vault, path: string, frontmatter: Record<string, unknown> | null): number {
  const r = vault.db.notes.upsertByPath({
    path,
    content: "body",
    frontmatter: frontmatter ? JSON.stringify(frontmatter) : null,
    title: path,
    hash: `h-${path}`,
    bodyHash: `bh-${path}`,
    mtime: 1,
    wordCount: 1,
  });
  return r.id;
}

function linkAtoB(vault: Vault, sourceId: number, targetId: number, targetPath: string): void {
  vault.db.wikilinks.insertBatch(sourceId, [
    {
      targetPath,
      targetNoteId: targetId,
      linkText: null,
      anchor: null,
      lineNumber: 1,
    },
  ]);
}

describe("inferFromNeighbors", () => {
  let vault: Vault;
  beforeEach(() => {
    vault = makeVault();
  });
  afterEach(() => {
    vault.db.close();
  });

  it("returns empty result when note has no neighbors", () => {
    seedNote(vault, "lonely.md", { class: "X" });
    const r = inferFromNeighbors(vault, "lonely.md");
    expect(r.totalNeighbors).toBe(0);
    expect(r.entries).toEqual([]);
  });

  it("returns empty result for a non-existent note (no backlinks possible)", () => {
    const r = inferFromNeighbors(vault, "nonexistent.md");
    expect(r.totalNeighbors).toBe(0);
  });

  it("aggregates frontmatter from forward-linked neighbors", () => {
    const sourceId = seedNote(vault, "Meeting.md", { class: "Meeting" });
    const p1 = seedNote(vault, "Persons/Alice.md", {
      class: "Person",
      type: "person",
    });
    const p2 = seedNote(vault, "Persons/Bob.md", {
      class: "Person",
      type: "person",
    });
    linkAtoB(vault, sourceId, p1, "Persons/Alice");
    linkAtoB(vault, sourceId, p2, "Persons/Bob");

    const r = inferFromNeighbors(vault, "Meeting.md");
    expect(r.totalNeighbors).toBe(2);
    expect(r.forwardCount).toBe(2);
    expect(r.backwardCount).toBe(0);

    const classEntry = r.entries.find((e) => e.key === "class")!;
    expect(classEntry.prevalence).toBe(1.0);
    expect(classEntry.dominantValue).toBe("Person");
  });

  it("aggregates from backward-linked neighbors", () => {
    const target = seedNote(vault, "Person.md", { class: "Person" });
    const m1 = seedNote(vault, "M1.md", { class: "Meeting" });
    const m2 = seedNote(vault, "M2.md", { class: "Meeting" });
    linkAtoB(vault, m1, target, "Person");
    linkAtoB(vault, m2, target, "Person");

    const r = inferFromNeighbors(vault, "Person.md");
    expect(r.totalNeighbors).toBe(2);
    expect(r.backwardCount).toBe(2);

    const classEntry = r.entries.find((e) => e.key === "class")!;
    expect(classEntry.dominantValue).toBe("Meeting");
  });

  it("deduplicates a note appearing as both forward and backlink", () => {
    const a = seedNote(vault, "A.md", { class: "A" });
    const b = seedNote(vault, "B.md", { class: "B" });
    linkAtoB(vault, a, b, "B"); // A → B
    linkAtoB(vault, b, a, "A"); // B → A (mutual)

    const r = inferFromNeighbors(vault, "A.md");
    // A's neighbors include B once, not twice.
    expect(r.totalNeighbors).toBe(1);
  });

  it("uses additionalForwardTargets for unindexed-note path", () => {
    // No DB row for "draft.md". But "Person/Alice.md" exists.
    seedNote(vault, "Person/Alice.md", { class: "Person", type: "person" });
    seedNote(vault, "Person/Bob.md", { class: "Person", type: "person" });

    const r = inferFromNeighbors(vault, "draft.md", ["Person/Alice", "Person/Bob"]);
    expect(r.totalNeighbors).toBe(2);
    const classEntry = r.entries.find((e) => e.key === "class")!;
    expect(classEntry.dominantValue).toBe("Person");
  });
});
