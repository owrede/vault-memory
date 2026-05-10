import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { WikilinkResolver } from "./resolver.js";

function makeVault(): Vault {
  const db = new Database(":memory:");
  return {
    config: { name: "test", path: "/tmp/test-vault" },
    db,
    dbPath: ":memory:",
  };
}

function insertNote(vault: Vault, p: string): number {
  const r = vault.db.notes.upsertByPath({
    path: p,
    content: "",
    frontmatter: null,
    title: p,
    hash: p,
    mtime: 0,
    wordCount: 0,
  });
  return r.id;
}

describe("WikilinkResolver", () => {
  let vault: Vault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    vault.db.close();
  });

  it("resolves exact path matches", () => {
    const id = insertNote(vault, "Folder/Foo.md");
    const r = new WikilinkResolver(vault);
    expect(r.resolve("Folder/Foo")?.id).toBe(id);
  });

  it("resolves filename-only with shortest-path-wins", () => {
    const shallow = insertNote(vault, "Bar.md");
    insertNote(vault, "Deep/Folder/Bar.md");
    const r = new WikilinkResolver(vault);
    expect(r.resolve("Bar")?.id).toBe(shallow);
  });

  it("resolves via alias for slash-less targets", () => {
    const id = insertNote(vault, "People/Joerg.md");
    vault.db.aliases.setForNote(id, ["JHE"]);
    const r = new WikilinkResolver(vault);
    expect(r.resolve("JHE")?.id).toBe(id);
  });

  it("returns null for unknown target", () => {
    const r = new WikilinkResolver(vault);
    expect(r.resolve("Nope")).toBeNull();
  });

  it("caches repeated resolutions (positive + negative)", () => {
    const id = insertNote(vault, "Cached.md");
    const r = new WikilinkResolver(vault);

    expect(r.cacheSize).toBe(0);
    expect(r.resolve("Cached")?.id).toBe(id);
    expect(r.cacheSize).toBe(1);
    expect(r.resolve("Cached")?.id).toBe(id);
    expect(r.cacheSize).toBe(1); // no new entry on hit

    expect(r.resolve("Missing")).toBeNull();
    expect(r.cacheSize).toBe(2);
    expect(r.resolve("Missing")).toBeNull();
    expect(r.cacheSize).toBe(2);
  });

  it("cache shields against later DB changes within instance lifetime", () => {
    // This documents the per-run-only semantics: a fresh resolver sees new
    // notes; the same instance keeps its cached null.
    const r1 = new WikilinkResolver(vault);
    expect(r1.resolve("LateArrival")).toBeNull();

    const id = insertNote(vault, "LateArrival.md");
    expect(r1.resolve("LateArrival")).toBeNull(); // cached miss

    const r2 = new WikilinkResolver(vault);
    expect(r2.resolve("LateArrival")?.id).toBe(id);
  });
});
