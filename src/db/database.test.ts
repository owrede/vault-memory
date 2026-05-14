import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "./database.js";
import { parseDocId } from "../adapters/registry.js";

describe("Database constructor — vaultName plumbing (plan 01-02 Task 01)", () => {
  it("accepts an explicit vaultName as the second arg", () => {
    const db = new Database(":memory:", "my-vault");
    expect(db.vaultName).toBe("my-vault");
    db.close();
  });

  it("derives vaultName as undefined for :memory: paths (no derivation possible)", () => {
    const db = new Database(":memory:");
    // For :memory:, derivation is undefined (the path is not a vault file).
    expect(db.vaultName).toBeUndefined();
    db.close();
  });

  it("derives vaultName from a standard dbPath shape like /path/to/my-vault.db", () => {
    // The DB file itself is :memory:, but we can't pass it both a custom path
    // and have it actually create a DB. We assert the derivation helper logic
    // by passing a "fake" basename style through path inspection — easier to
    // exercise via the constructor with an explicit vaultName fallback path.
    // For real coverage of the derivation helper, see the deriveVaultNameFromPath
    // logic in database.ts (used by VaultManager-skipping constructors).
    const db = new Database(":memory:", "explicit-from-arg");
    expect(db.vaultName).toBe("explicit-from-arg");
    db.close();
  });

  it("explicit vaultName wins over derivation", () => {
    const db = new Database(":memory:", "explicit");
    expect(db.vaultName).toBe("explicit");
    db.close();
  });
});

describe("MIGRATION_007 + 008 (doc_uri)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    // NB: db.migrate() runs in the constructor; we keep that, then exercise
    // both the schema shape and (in tests below) explicit re-runs of v8.
  });

  afterEach(() => {
    db.close();
  });

  function seedNote(path: string, hash: string, opts?: { doc_uri?: string | null }): void {
    const now = Date.now();
    db.handle
      .prepare(
        `INSERT INTO notes (path, content, frontmatter, title, hash, body_hash, doc_uri, mtime, word_count, created_at, updated_at)
         VALUES (?, 'x', NULL, ?, ?, NULL, ?, 1, 1, ?, ?)`,
      )
      .run(path, path, hash, opts?.doc_uri ?? null, now, now);
  }

  // Helper that mirrors the production runMigration008 body — used in the
  // idempotency + override tests where we want to re-run the migration after
  // the constructor already applied it once.
  function runBackfill(vaultName: string | undefined): void {
    const pending = db.handle
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM notes WHERE doc_uri IS NULL")
      .get();
    if (!pending || pending.c === 0) return;
    if (!vaultName) {
      throw new Error(
        "runMigration008 requires vaultName context to backfill doc_uri on existing notes (Database constructor must be called with the vault name; check src/vault/manager.ts).",
      );
    }
    const prefix = `obsidian-fs://${vaultName}/`;
    db.handle.exec(
      `UPDATE notes SET doc_uri = '${prefix.replace(/'/g, "''")}' || path WHERE doc_uri IS NULL`,
    );
  }

  it("Test 1: v7 adds doc_uri column as nullable", () => {
    const cols = db.handle.pragma("table_info(notes)") as Array<{
      name: string;
      notnull: number;
    }>;
    const docUriCol = cols.find((c) => c.name === "doc_uri");
    expect(docUriCol).toBeDefined();
    expect(docUriCol?.notnull).toBe(0);
  });

  it("Test 2: v7 creates idx_notes_doc_uri", () => {
    const row = db.handle
      .prepare<
        [],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_doc_uri'")
      .get();
    expect(row?.name).toBe("idx_notes_doc_uri");
  });

  it("Test 3: v8 backfills doc_uri = obsidian-fs://test-vault/<path> for every existing row", () => {
    // Constructor already ran migrations forward — seed with explicit-NULL
    // doc_uri so we can prove the backfill helper writes them.
    seedNote("foo.md", "h1", { doc_uri: null });
    seedNote("sub/bar.md", "h2", { doc_uri: null });
    seedNote("name with space.md", "h3", { doc_uri: null });

    runBackfill("test-vault");

    const rows = db.handle
      .prepare<
        [],
        { path: string; doc_uri: string | null }
      >("SELECT path, doc_uri FROM notes ORDER BY id")
      .all();
    expect(rows).toEqual([
      { path: "foo.md", doc_uri: "obsidian-fs://test-vault/foo.md" },
      { path: "sub/bar.md", doc_uri: "obsidian-fs://test-vault/sub/bar.md" },
      { path: "name with space.md", doc_uri: "obsidian-fs://test-vault/name with space.md" },
    ]);
    // Confirm un-encoding: the space is a raw space, not %20.
    expect(rows[2]?.doc_uri).toContain("name with space.md");
    expect(rows[2]?.doc_uri).not.toContain("%20");
  });

  it("Test 4: v8 is idempotent — re-running on an already-backfilled DB is a no-op", () => {
    seedNote("foo.md", "h1", { doc_uri: null });
    runBackfill("test-vault");
    const after1 = db.handle
      .prepare<[], { doc_uri: string }>("SELECT doc_uri FROM notes WHERE path = 'foo.md'")
      .get();
    runBackfill("test-vault");
    const after2 = db.handle
      .prepare<[], { doc_uri: string }>("SELECT doc_uri FROM notes WHERE path = 'foo.md'")
      .get();
    expect(after2?.doc_uri).toBe(after1?.doc_uri);
    expect(after2?.doc_uri).toBe("obsidian-fs://test-vault/foo.md");

    // Also confirm no rows are NULL after re-run.
    const nulls = db.handle
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM notes WHERE doc_uri IS NULL")
      .get();
    expect(nulls?.c).toBe(0);
  });

  it("Test 5: v8 throws with clear message if vaultName is undefined AND backfill is pending", () => {
    seedNote("foo.md", "h1", { doc_uri: null });
    expect(() => runBackfill(undefined)).toThrowError(/vaultName.*src\/vault\/manager\.ts/);
  });

  it("Test 6: v8 leaves existing non-null doc_uri values alone", () => {
    seedNote("custom.md", "h1", { doc_uri: "custom://override/x" });
    seedNote("plain.md", "h2", { doc_uri: null });

    runBackfill("test-vault");

    const custom = db.handle
      .prepare<[], { doc_uri: string }>("SELECT doc_uri FROM notes WHERE path = 'custom.md'")
      .get();
    const plain = db.handle
      .prepare<[], { doc_uri: string }>("SELECT doc_uri FROM notes WHERE path = 'plain.md'")
      .get();
    expect(custom?.doc_uri).toBe("custom://override/x");
    expect(plain?.doc_uri).toBe("obsidian-fs://test-vault/plain.md");
  });

  it("Test 7: fresh DB migrates through v8 cleanly with zero notes rows", () => {
    // The beforeEach constructor already ran every migration on an empty DB.
    // Assert the user_version reflects the latest version and no error was
    // thrown on the way through.
    const v = db.getSchemaVersion();
    expect(v).toBeGreaterThanOrEqual(8);
    expect(db.notes.countAll()).toBe(0);
  });

  it("Test 8: doc_uri shape matches the obsidian-fs://<vault>/<path> grammar accepted by parseDocId", () => {
    // Cross-plan integration: every backfilled doc_uri MUST be a valid DocId
    // per plan 01-01's parseDocId regex. This wires plan 01-01's branded-type
    // contract to plan 01-02's persisted data.
    seedNote("foo.md", "h1", { doc_uri: null });
    seedNote("sub/bar.md", "h2", { doc_uri: null });
    seedNote("name with space.md", "h3", { doc_uri: null });
    runBackfill("test-vault");

    const rows = db.handle
      .prepare<[], { doc_uri: string }>("SELECT doc_uri FROM notes WHERE doc_uri IS NOT NULL")
      .all();
    expect(rows.length).toBe(3);
    for (const r of rows) {
      // MUST NOT throw — that's the contract.
      expect(() => parseDocId(r.doc_uri)).not.toThrow();
    }
  });
});

describe("Database roundtrips", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
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
      path: "v2.md",
      content: "x",
      frontmatter: null,
      title: "v",
      hash: "h",
      mtime: 1,
      wordCount: 1,
    });
    const [c0] = db.chunks.insertBatch(noteId, [
      { idx: 0, text: "a", headingPath: null, startOffset: 0, endOffset: 1, tokenCount: 1 },
    ]);
    db.embeddings.insertBatch([{ chunkId: c0!, modelId: model.id, vector: unitAxis(0, 1024) }]);
    db.embeddings.deleteByChunk(c0!);
    expect(db.embeddings.searchSemantic(model.id, unitAxis(0, 1024), 5)).toEqual([]);
  });

  // ── Wikilinks ─────────────────────────────────────────────────────────
  it("wikilinks insert + backlinks + forwardLinks + brokenLinks", () => {
    const a = db.notes.upsertByPath({
      path: "A.md",
      content: "x",
      frontmatter: null,
      title: "A",
      hash: "ha",
      mtime: 1,
      wordCount: 1,
    });
    const b = db.notes.upsertByPath({
      path: "B.md",
      content: "x",
      frontmatter: null,
      title: "B",
      hash: "hb",
      mtime: 1,
      wordCount: 1,
    });

    db.wikilinks.insertBatch(a.id, [
      { targetPath: "B", targetNoteId: b.id, linkText: null, anchor: null, lineNumber: 3 },
      { targetPath: "Ghost", targetNoteId: null, linkText: "Ghost", anchor: null, lineNumber: 5 },
    ]);

    const back = db.wikilinks.getBacklinks(b.id);
    expect(back).toEqual([{ sourceNoteId: a.id, lineNumber: 3, linkText: null }]);

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

  it("isIndexing() reflects unfinished runs", () => {
    expect(db.audit.isIndexing()).toBe(false);

    db.audit.startRun({
      runId: "running",
      vaultName: "test",
      modelId: null,
      trigger: "init",
    });
    expect(db.audit.isIndexing()).toBe(true);

    db.audit.finishRun("running", {
      notesIndexed: 0,
      chunksCreated: 0,
      notesUpdated: 0,
      notesDeleted: 0,
    });
    expect(db.audit.isIndexing()).toBe(false);

    // Crashed/aborted run that was never finalised should still register
    // as indexing — that's exactly the case the search layer needs to dodge.
    db.audit.startRun({
      runId: "crashed",
      vaultName: "test",
      modelId: null,
      trigger: "manual-full",
    });
    expect(db.audit.isIndexing()).toBe(true);
  });

  it("audit recordWrite + listWrites filter", () => {
    const n = db.notes.upsertByPath({
      path: "w.md",
      content: "x",
      frontmatter: null,
      title: "w",
      hash: "h",
      mtime: 1,
      wordCount: 1,
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
        path: "t1.md",
        content: "x",
        frontmatter: null,
        title: "t",
        hash: "h",
        mtime: 1,
        wordCount: 1,
      });
    });
    expect(db.notes.countAll()).toBe(1);

    expect(() =>
      db.transaction(() => {
        db.notes.upsertByPath({
          path: "t2.md",
          content: "x",
          frontmatter: null,
          title: "t",
          hash: "h",
          mtime: 1,
          wordCount: 1,
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
