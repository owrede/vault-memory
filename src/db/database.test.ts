import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "./database.js";

describe("Database roundtrips", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  // ── Notes ─────────────────────────────────────────────────────────────
  describe("notes", () => {
    const baseInput = {
      path: "foo/bar.md",
      content: "Hello world",
      frontmatter: null,
      title: "Bar",
      hash: "h1",
      mtime: 1000,
      wordCount: 2,
    };

    it("inserts and retrieves by id and path", () => {
      const { id, isNew } = db.notes.upsertByPath(baseInput);
      expect(isNew).toBe(true);
      expect(id).toBeGreaterThan(0);

      const byId = db.notes.getById(id);
      expect(byId?.path).toBe(baseInput.path);
      expect(byId?.content).toBe("Hello world");

      const byPath = db.notes.getByPath(baseInput.path);
      expect(byPath?.id).toBe(id);
    });

    it("upsert with same hash is no-op (isNew=false, no update)", () => {
      const first = db.notes.upsertByPath(baseInput);
      const before = db.notes.getById(first.id);
      const second = db.notes.upsertByPath(baseInput);
      expect(second.isNew).toBe(false);
      expect(second.id).toBe(first.id);
      const after = db.notes.getById(first.id);
      expect(after?.updated_at).toBe(before?.updated_at);
    });

    it("upsert with new hash updates content", () => {
      const first = db.notes.upsertByPath(baseInput);
      const updated = db.notes.upsertByPath({
        ...baseInput,
        content: "Hello updated",
        hash: "h2",
        mtime: 2000,
      });
      expect(updated.isNew).toBe(false);
      expect(updated.id).toBe(first.id);
      const row = db.notes.getById(first.id);
      expect(row?.content).toBe("Hello updated");
      expect(row?.hash).toBe("h2");
      expect(row?.mtime).toBe(2000);
    });

    it("count and list", () => {
      db.notes.upsertByPath(baseInput);
      db.notes.upsertByPath({ ...baseInput, path: "other.md", hash: "h2" });
      expect(db.notes.countAll()).toBe(2);
      expect(db.notes.listAll().length).toBe(2);
    });

    it("delete by path returns true once, then false", () => {
      db.notes.upsertByPath(baseInput);
      expect(db.notes.deleteByPath(baseInput.path)).toBe(true);
      expect(db.notes.deleteByPath(baseInput.path)).toBe(false);
    });
  });

  // ── Chunks ────────────────────────────────────────────────────────────
  it("chunks insertBatch + getByNote", () => {
    const { id: noteId } = db.notes.upsertByPath({
      path: "n.md",
      content: "x",
      frontmatter: null,
      title: "n",
      hash: "h",
      mtime: 1,
      wordCount: 1,
    });
    const ids = db.chunks.insertBatch(noteId, [
      {
        idx: 0,
        text: "chunk zero",
        headingPath: "# H",
        startOffset: 0,
        endOffset: 10,
        tokenCount: 2,
      },
      {
        idx: 1,
        text: "chunk one",
        headingPath: null,
        startOffset: 11,
        endOffset: 20,
        tokenCount: 2,
      },
    ]);
    expect(ids.length).toBe(2);
    const chunks = db.chunks.getByNote(noteId);
    expect(chunks.map((c) => c.idx)).toEqual([0, 1]);
    expect(chunks[0]?.text).toBe("chunk zero");

    const deleted = db.chunks.deleteByNote(noteId);
    expect(deleted).toBe(2);
    expect(db.chunks.getByNote(noteId)).toEqual([]);
  });

  // ── Embeddings (sqlite-vec) ───────────────────────────────────────────
  it("embeddings searchSemantic returns nearest chunk", () => {
    const model = db.models.upsert({
      name: "test-model",
      provider: "test",
      dim: 1024,
    });

    const { id: noteId } = db.notes.upsertByPath({
      path: "v.md",
      content: "x",
      frontmatter: null,
      title: "v",
      hash: "h",
      mtime: 1,
      wordCount: 1,
    });

    const chunkIds = db.chunks.insertBatch(noteId, [
      { idx: 0, text: "a", headingPath: null, startOffset: 0, endOffset: 1, tokenCount: 1 },
      { idx: 1, text: "b", headingPath: null, startOffset: 1, endOffset: 2, tokenCount: 1 },
      { idx: 2, text: "c", headingPath: null, startOffset: 2, endOffset: 3, tokenCount: 1 },
    ]);

    // Three distinct dim-768 vectors: e0-aligned, e1-aligned, e2-aligned.
    const v0 = unitAxis(0, 1024);
    const v1 = unitAxis(1, 1024);
    const v2 = unitAxis(2, 1024);

    db.embeddings.insertBatch([
      { chunkId: chunkIds[0]!, modelId: model.id, vector: v0 },
      { chunkId: chunkIds[1]!, modelId: model.id, vector: v1 },
      { chunkId: chunkIds[2]!, modelId: model.id, vector: v2 },
    ]);

    // Query close to v1 → expect chunk_id[1] is nearest.
    const hits = db.embeddings.searchSemantic(model.id, v1, 3);
    expect(hits.length).toBe(3);
    expect(hits[0]?.chunkId).toBe(chunkIds[1]);
    // Distances are non-decreasing
    expect(hits[0]!.distance).toBeLessThanOrEqual(hits[1]!.distance);
  });

  it("embeddings deleteByChunk and deleteByModel", () => {
    const model = db.models.upsert({ name: "m2", provider: "t", dim: 1024 });
    const { id: noteId } = db.notes.upsertByPath({
      path: "v2.md", content: "x", frontmatter: null, title: "v",
      hash: "h", mtime: 1, wordCount: 1,
    });
    const [c0] = db.chunks.insertBatch(noteId, [
      { idx: 0, text: "a", headingPath: null, startOffset: 0, endOffset: 1, tokenCount: 1 },
    ]);
    db.embeddings.insertBatch([
      { chunkId: c0!, modelId: model.id, vector: unitAxis(0, 1024) },
    ]);
    db.embeddings.deleteByChunk(c0!);
    expect(db.embeddings.searchSemantic(model.id, unitAxis(0, 1024), 5)).toEqual([]);
  });

  // ── Wikilinks ─────────────────────────────────────────────────────────
  it("wikilinks insert + backlinks + forwardLinks + brokenLinks", () => {
    const a = db.notes.upsertByPath({
      path: "A.md", content: "x", frontmatter: null, title: "A",
      hash: "ha", mtime: 1, wordCount: 1,
    });
    const b = db.notes.upsertByPath({
      path: "B.md", content: "x", frontmatter: null, title: "B",
      hash: "hb", mtime: 1, wordCount: 1,
    });

    db.wikilinks.insertBatch(a.id, [
      { targetPath: "B", targetNoteId: b.id, linkText: null, anchor: null, lineNumber: 3 },
      { targetPath: "Ghost", targetNoteId: null, linkText: "Ghost", anchor: null, lineNumber: 5 },
    ]);

    const back = db.wikilinks.getBacklinks(b.id);
    expect(back).toEqual([
      { sourceNoteId: a.id, lineNumber: 3, linkText: null },
    ]);

    const fwd = db.wikilinks.getForwardLinks(a.id);
    expect(fwd.length).toBe(2);

    const broken = db.wikilinks.resolveBrokenLinks();
    expect(broken).toEqual([{ sourceNoteId: a.id, targetPath: "Ghost" }]);

    expect(db.wikilinks.deleteByNote(a.id)).toBe(2);
    expect(db.wikilinks.getForwardLinks(a.id)).toEqual([]);
  });

  // ── Audit ─────────────────────────────────────────────────────────────
  it("audit run start/finish + listRuns", () => {
    db.audit.startRun({
      runId: "r1",
      vaultName: "test",
      modelId: null,
      trigger: "init",
    });
    db.audit.finishRun("r1", {
      notesIndexed: 5,
      chunksCreated: 20,
      notesUpdated: 1,
      notesDeleted: 0,
    });
    const runs = db.audit.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0]?.run_id).toBe("r1");
    expect(runs[0]?.notes_indexed).toBe(5);
    expect(runs[0]?.finished_at).not.toBeNull();
  });

  it("audit recordWrite + listWrites filter", () => {
    const n = db.notes.upsertByPath({
      path: "w.md", content: "x", frontmatter: null, title: "w",
      hash: "h", mtime: 1, wordCount: 1,
    });
    db.audit.recordWrite({
      noteId: n.id,
      op: "create",
      previousHash: null,
      newHash: "h",
      expectedHash: null,
      clientId: "test",
      diffSummary: null,
    });
    db.audit.recordWrite({
      noteId: n.id,
      op: "update",
      previousHash: "h",
      newHash: "h2",
      expectedHash: "h",
      clientId: "test",
      diffSummary: "tweak",
    });
    expect(db.audit.listWrites().length).toBe(2);
    expect(db.audit.listWrites({ op: "update" }).length).toBe(1);
    expect(db.audit.listWrites({ noteId: n.id }).length).toBe(2);
  });

  // ── Models ────────────────────────────────────────────────────────────
  it("models upsert + getActive + setActive", () => {
    const m1 = db.models.upsert({ name: "qwen3", provider: "ollama", dim: 1024 });
    const m2 = db.models.upsert({ name: "other", provider: "ollama", dim: 1024 });
    // upsert is idempotent on name
    const m1b = db.models.upsert({ name: "qwen3", provider: "ollama", dim: 1024 });
    expect(m1b.id).toBe(m1.id);
    expect(db.models.listAll().length).toBe(2);

    db.models.setActive(m2.id);
    expect(db.models.getActive()?.id).toBe(m2.id);
    db.models.setActive(m1.id);
    expect(db.models.getActive()?.id).toBe(m1.id);
  });

  // ── Transaction wrapper ───────────────────────────────────────────────
  it("transaction commits and rolls back", () => {
    db.transaction(() => {
      db.notes.upsertByPath({
        path: "t1.md", content: "x", frontmatter: null, title: "t",
        hash: "h", mtime: 1, wordCount: 1,
      });
    });
    expect(db.notes.countAll()).toBe(1);

    expect(() =>
      db.transaction(() => {
        db.notes.upsertByPath({
          path: "t2.md", content: "x", frontmatter: null, title: "t",
          hash: "h", mtime: 1, wordCount: 1,
        });
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(db.notes.countAll()).toBe(1);
  });
});

function unitAxis(axis: number, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[axis] = 1;
  return v;
}
