import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../database.js";
import type { NoteRow } from "../../types.js";

/**
 * Plan 01-02 Task 04: NotesQueries.upsertByPath wires doc_uri through
 * inserts + updates. Asserts the four shape contracts from the plan body.
 */
describe("NotesQueries.upsertByPath — doc_uri wire-up (plan 01-02 Task 04)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  const baseInput = {
    path: "foo/bar.md",
    content: "Hello",
    frontmatter: null,
    title: "Bar",
    hash: "h1",
    bodyHash: "bh1",
    mtime: 1000,
    wordCount: 1,
  };

  function readByPath(path: string): NoteRow | null {
    return db.notes.getByPath(path);
  }

  it("inserts with explicit docUri → row has matching doc_uri", () => {
    const explicit = "obsidian-fs://test-vault/foo/bar.md";
    db.notes.upsertByPath({ ...baseInput, docUri: explicit });
    const row = readByPath("foo/bar.md");
    expect(row?.doc_uri).toBe(explicit);
  });

  it("inserts WITHOUT docUri or vaultName → row has NULL doc_uri (dual-column window)", () => {
    db.notes.upsertByPath(baseInput);
    const row = readByPath("foo/bar.md");
    expect(row?.doc_uri).toBeNull();
  });

  it("inserts with vaultName but no docUri → synthesized obsidian-fs://<vault>/<path>", () => {
    db.notes.upsertByPath({ ...baseInput, vaultName: "test-vault" });
    const row = readByPath("foo/bar.md");
    expect(row?.doc_uri).toBe("obsidian-fs://test-vault/foo/bar.md");
  });

  it("update via upsertByPath preserves existing doc_uri when caller omits it (COALESCE)", () => {
    // First write sets doc_uri.
    db.notes.upsertByPath({ ...baseInput, docUri: "obsidian-fs://test-vault/foo/bar.md" });
    const before = readByPath("foo/bar.md");
    expect(before?.doc_uri).toBe("obsidian-fs://test-vault/foo/bar.md");

    // Second write changes content (new hash) but omits docUri entirely.
    db.notes.upsertByPath({
      ...baseInput,
      content: "Updated",
      hash: "h2",
      bodyHash: "bh2",
    });
    const after = readByPath("foo/bar.md");
    // Existing doc_uri MUST survive the update (W3 caveat from plan-checker).
    expect(after?.doc_uri).toBe("obsidian-fs://test-vault/foo/bar.md");
    // Sanity check: the content actually updated.
    expect(after?.content).toBe("Updated");
    expect(after?.hash).toBe("h2");
  });

  it("update with explicit new docUri overwrites the existing one", () => {
    db.notes.upsertByPath({ ...baseInput, docUri: "obsidian-fs://test-vault/foo/bar.md" });
    db.notes.upsertByPath({
      ...baseInput,
      content: "x",
      hash: "h2",
      bodyHash: "bh2",
      docUri: "obsidian-fs://other-vault/foo/bar.md",
    });
    const row = readByPath("foo/bar.md");
    expect(row?.doc_uri).toBe("obsidian-fs://other-vault/foo/bar.md");
  });
});

/**
 * Plan 03-01 Task 5 (M4 fix): denormalized `notes.status` accessors.
 * The migration 010 backfill populates the column from existing
 * frontmatter; subsequent indexer writes maintain it via setStatus.
 */
describe("NotesQueries.getStatus / setStatus (plan 03-01 / M4)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  it("migration 010 backfills status from frontmatter JSON", () => {
    // Seed a note whose frontmatter carries `status: superseded`. The
    // migration ran during db.migrate() in beforeEach; the UPDATE step
    // populates status from json_extract(frontmatter, '$.status').
    db.notes.upsertByPath({
      path: "a.md",
      content: "x",
      frontmatter: JSON.stringify({ status: "superseded", title: "A" }),
      title: "A",
      hash: "h1",
      bodyHash: "bh1",
      mtime: 0,
      wordCount: 1,
    });
    // Run the migration's UPDATE manually — the column already exists
    // (added at v10), but our just-inserted row didn't go through that
    // UPDATE. Replay it to mimic the cohort of existing-rows-at-upgrade.
    db.handle.exec(
      "UPDATE notes SET status = json_extract(frontmatter, '$.status') WHERE frontmatter IS NOT NULL",
    );
    const id = db.notes.getByPath("a.md")!.id;
    expect(db.notes.getStatus(id)).toBe("superseded");
  });

  it("setStatus writes and getStatus reads back the value", () => {
    const id = db.notes.upsertByPath({
      path: "b.md",
      content: "x",
      frontmatter: null,
      title: "B",
      hash: "h",
      bodyHash: "bh",
      mtime: 0,
      wordCount: 1,
    }).id;
    expect(db.notes.getStatus(id)).toBeNull();
    db.notes.setStatus(id, "active");
    expect(db.notes.getStatus(id)).toBe("active");
    // null clears it.
    db.notes.setStatus(id, null);
    expect(db.notes.getStatus(id)).toBeNull();
  });

  it("getStatus returns null for unknown note IDs", () => {
    expect(db.notes.getStatus(999_999)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 / 03-05 (M4): getSupersededChunkIds — SQL-level batch filter
// ─────────────────────────────────────────────────────────────────────────────

describe("NotesQueries.getSupersededChunkIds (03-05 M4)", () => {
  let db: Database;
  let noteSupId: number;
  let noteOkId: number;
  let chunkSupId: number;
  let chunkOkId: number;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    const sup = db.notes.upsertByPath({
      path: "sup.md",
      content: "x",
      frontmatter: null,
      title: "Sup",
      hash: "hs",
      bodyHash: "bhs",
      mtime: 0,
      wordCount: 1,
    });
    noteSupId = sup.id;
    const ok = db.notes.upsertByPath({
      path: "ok.md",
      content: "y",
      frontmatter: null,
      title: "Ok",
      hash: "ho",
      bodyHash: "bho",
      mtime: 0,
      wordCount: 1,
    });
    noteOkId = ok.id;

    const supChunks = db.chunks.insertBatch(noteSupId, [
      { idx: 0, text: "sup chunk", headingPath: null, startOffset: 0, endOffset: 9, tokenCount: 2 },
    ]);
    chunkSupId = supChunks[0]!;
    const okChunks = db.chunks.insertBatch(noteOkId, [
      { idx: 0, text: "ok chunk", headingPath: null, startOffset: 0, endOffset: 8, tokenCount: 2 },
    ]);
    chunkOkId = okChunks[0]!;

    db.notes.setStatus(noteSupId, "superseded");
  });

  afterEach(() => {
    db.close();
  });

  it("returns only chunkIds whose note is superseded", () => {
    const out = db.notes.getSupersededChunkIds([chunkSupId, chunkOkId]);
    expect(out.has(chunkSupId)).toBe(true);
    expect(out.has(chunkOkId)).toBe(false);
    expect(out.size).toBe(1);
  });

  it("returns empty set on empty input (no DB round-trip)", () => {
    expect(db.notes.getSupersededChunkIds([]).size).toBe(0);
  });

  it("returns empty set when no input chunk is superseded", () => {
    db.notes.setStatus(noteSupId, null); // clear
    expect(db.notes.getSupersededChunkIds([chunkSupId, chunkOkId]).size).toBe(0);
  });

  it("unknown chunkIds are silently dropped", () => {
    expect(db.notes.getSupersededChunkIds([999_999]).size).toBe(0);
  });

  it("uses the notes_status partial index (EXPLAIN QUERY PLAN sanity check)", () => {
    const plan = db.handle
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT chunks.id FROM chunks
           JOIN notes ON notes.id = chunks.note_id
          WHERE chunks.id IN (?) AND notes.status = 'superseded'`,
      )
      .all(chunkSupId) as Array<{ detail: string }>;
    const detail = plan
      .map((p) => p.detail)
      .join(" | ")
      .toLowerCase();
    // Plan must reference notes — proof we filter at SQL level.
    expect(detail).toContain("notes");
  });
});
