import { describe, expect, it, beforeEach } from "vitest";
import { Database } from "../db/index.js";
import { queryFrontmatter } from "./query.js";
import type { Vault } from "../vault/index.js";

function makeVault(): Vault {
  const db = new Database(":memory:");
  db.migrate();
  return {
    config: { name: "test", path: "/tmp/test" },
    db,
    dbPath: ":memory:",
  };
}

function seed(vault: Vault): void {
  vault.db.notes.upsertByPath({
    path: "Person/Anna.md",
    content: "...",
    frontmatter: JSON.stringify({ class: "Person", tags: ["client", "active"], age: 30 }),
    title: "Anna",
    hash: "h1",
    mtime: 1,
    wordCount: 10,
  });
  vault.db.notes.upsertByPath({
    path: "Person/Bob.md",
    content: "...",
    frontmatter: JSON.stringify({ class: "Person", tags: ["lead"], age: 45 }),
    title: "Bob",
    hash: "h2",
    mtime: 2,
    wordCount: 12,
  });
  vault.db.notes.upsertByPath({
    path: "Project/X.md",
    content: "...",
    frontmatter: JSON.stringify({ class: "Project", status: "active" }),
    title: "X",
    hash: "h3",
    mtime: 3,
    wordCount: 20,
  });
  vault.db.notes.upsertByPath({
    path: "Loose.md",
    content: "...",
    frontmatter: null,
    title: "Loose",
    hash: "h4",
    mtime: 4,
    wordCount: 5,
  });
}

describe("queryFrontmatter", () => {
  let vault: Vault;

  beforeEach(() => {
    vault = makeVault();
    seed(vault);
  });

  it("scalar equality", () => {
    const hits = queryFrontmatter(vault, { where: { class: "Person" } });
    expect(hits.map((h) => h.title).sort()).toEqual(["Anna", "Bob"]);
  });

  it("$in on scalar", () => {
    const hits = queryFrontmatter(vault, {
      where: { class: { $in: ["Project", "Org"] } },
    });
    expect(hits.map((h) => h.title)).toEqual(["X"]);
  });

  it("$exists true", () => {
    const hits = queryFrontmatter(vault, { where: { status: { $exists: true } } });
    expect(hits.map((h) => h.title)).toEqual(["X"]);
  });

  it("$exists false", () => {
    const hits = queryFrontmatter(vault, { where: { status: { $exists: false } } });
    expect(hits.map((h) => h.title).sort()).toEqual(["Anna", "Bob"]);
    // Note: "Loose" has frontmatter=null so it's excluded by the SELECT.
  });

  it("$contains in array", () => {
    const hits = queryFrontmatter(vault, { where: { tags: { $contains: "client" } } });
    expect(hits.map((h) => h.title)).toEqual(["Anna"]);
  });

  it("multiple clauses (AND)", () => {
    const hits = queryFrontmatter(vault, {
      where: { class: "Person", tags: { $contains: "lead" } },
    });
    expect(hits.map((h) => h.title)).toEqual(["Bob"]);
  });

  it("limit", () => {
    const hits = queryFrontmatter(vault, {
      where: { class: { $exists: true } },
      limit: 2,
    });
    expect(hits).toHaveLength(2);
  });

  it("empty $in matches nothing", () => {
    const hits = queryFrontmatter(vault, { where: { class: { $in: [] } } });
    expect(hits).toEqual([]);
  });

  it("rejects suspicious field names", () => {
    expect(() =>
      queryFrontmatter(vault, { where: { "class'; DROP TABLE notes; --": "x" } }),
    ).toThrow(/Invalid frontmatter field/);
  });

  it("no clauses returns all (capped)", () => {
    const hits = queryFrontmatter(vault, { where: {} });
    // listAll returns everything including the one without frontmatter
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});
