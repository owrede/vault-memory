import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/database.js";
import type { Vault } from "../vault/index.js";
import type { VaultConfig } from "../types.js";
import { getAuditLog, getIndexRuns } from "./audit.js";

function makeVault(db: Database): Vault {
  const config: VaultConfig = { name: "test-vault", path: "/tmp/test" };
  return { config, db, dbPath: ":memory:" };
}

function seedNote(db: Database, path: string, title: string): number {
  return db.notes.upsertByPath({
    path,
    content: `# ${title}`,
    frontmatter: null,
    title,
    hash: `hash-${path}`,
    mtime: 0,
    wordCount: 1,
  }).id;
}

describe("audit module", () => {
  let db: Database;
  let vault: Vault;
  let note1Id: number;
  let note2Id: number;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = makeVault(db);

    note1Id = seedNote(db, "Note1.md", "Note 1");
    note2Id = seedNote(db, "Note2.md", "Note 2");

    // Note 1: create, update, update, delete (4 entries)
    db.audit.recordWrite({
      noteId: note1Id,
      op: "create",
      previousHash: null,
      newHash: "h1",
      expectedHash: null,
      clientId: "client-a",
      diffSummary: "created",
    });
    db.audit.recordWrite({
      noteId: note1Id,
      op: "update",
      previousHash: "h1",
      newHash: "h2",
      expectedHash: "h1",
      clientId: "client-a",
      diffSummary: "edited body",
    });
    db.audit.recordWrite({
      noteId: note1Id,
      op: "update",
      previousHash: "h2",
      newHash: "h3",
      expectedHash: "h2",
      clientId: "client-b",
      diffSummary: "edited fm",
    });
    db.audit.recordWrite({
      noteId: note1Id,
      op: "delete",
      previousHash: "h3",
      newHash: null,
      expectedHash: "h3",
      clientId: "client-a",
      diffSummary: "deleted",
    });

    // Note 2: create (1 entry)
    db.audit.recordWrite({
      noteId: note2Id,
      op: "create",
      previousHash: null,
      newHash: "x1",
      expectedHash: null,
      clientId: "client-a",
      diffSummary: "created note 2",
    });

    // 1 index run
    db.audit.startRun({
      runId: "run-1",
      vaultName: "test-vault",
      modelId: null,
      trigger: "manual",
    });
    db.audit.finishRun("run-1", {
      notesIndexed: 2,
      chunksCreated: 4,
      notesUpdated: 1,
      notesDeleted: 0,
    });
  });

  afterEach(() => {
    db.close();
  });

  it("returns all audit entries in descending order", () => {
    const entries = getAuditLog({ vault });
    expect(entries).toHaveLength(5);
    // Descending by id
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1]!.id).toBeGreaterThan(entries[i]!.id);
    }
  });

  it("filters by notePath", () => {
    const entries = getAuditLog({ vault, notePath: "Note1.md" });
    expect(entries).toHaveLength(4);
    for (const e of entries) {
      expect(e.notePath).toBe("Note1.md");
      expect(e.noteTitle).toBe("Note 1");
    }
  });

  it("filters by op", () => {
    const entries = getAuditLog({ vault, op: "update" });
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.op).toBe("update");
    }
  });

  it("filters by since (epoch ms)", () => {
    const past = Date.now() - 1000;
    const entries = getAuditLog({ vault, since: past });
    expect(entries).toHaveLength(5);

    const future = Date.now() + 60_000;
    const empty = getAuditLog({ vault, since: future });
    expect(empty).toHaveLength(0);
  });

  // Plan 02-06 (MEM-08): all pre-existing audit rows surface with
  // is_memory_sink_write=false (migration 009 ALTER default is 0; rows
  // written through the un-flagged recordWrite path stay at 0).
  it("legacy / non-memory rows surface is_memory_sink_write=false", () => {
    const entries = getAuditLog({ vault });
    for (const e of entries) {
      expect(e.is_memory_sink_write).toBe(false);
    }
  });

  it("filters by is_memory_sink_write=true returns only memory-routed rows", () => {
    // Add one memory-sink write through the AuditQueries.recordWrite path.
    db.audit.recordWrite({
      noteId: note2Id,
      op: "create",
      previousHash: null,
      newHash: "mem-1",
      expectedHash: null,
      clientId: "agent",
      diffSummary: "memory observation",
      isMemorySinkWrite: true,
    });
    const memOnly = getAuditLog({ vault, is_memory_sink_write: true });
    expect(memOnly).toHaveLength(1);
    expect(memOnly[0]!.is_memory_sink_write).toBe(true);
    expect(memOnly[0]!.newHash).toBe("mem-1");

    const nonMem = getAuditLog({ vault, is_memory_sink_write: false });
    // All 5 seeded rows remain non-memory.
    expect(nonMem).toHaveLength(5);
    for (const e of nonMem) expect(e.is_memory_sink_write).toBe(false);

    // Omitting the filter still returns everything.
    const all = getAuditLog({ vault });
    expect(all).toHaveLength(6);
  });

  it("returns [] for unknown notePath", () => {
    const entries = getAuditLog({ vault, notePath: "DoesNotExist.md" });
    expect(entries).toEqual([]);
  });

  it("notePath is null when note row no longer exists", () => {
    // Simulate a note that vanished from the notes table while its audit
    // row remains. The schema has a FK on write_audit.note_id, so we drop
    // FKs for the moment to model a "stale audit" scenario (e.g. after a
    // future migration that allowed cascading or manual cleanup).
    db.handle.pragma("foreign_keys = OFF");
    db.handle.prepare("DELETE FROM notes WHERE path = ?").run("Note2.md");
    db.handle.pragma("foreign_keys = ON");

    const entries = getAuditLog({ vault, op: "create" });
    const note2Entry = entries.find((e) => e.diffSummary === "created note 2");
    expect(note2Entry).toBeDefined();
    expect(note2Entry!.notePath).toBeNull();
    expect(note2Entry!.noteTitle).toBeNull();
  });

  it("delete-op entry keeps notePath when note row still exists (logical delete)", () => {
    // Sanity: our seed records op=delete but doesn't actually drop the row.
    // Document the behaviour: notePath is still resolved because notes table
    // still has the row.
    const entries = getAuditLog({ vault, op: "delete" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.notePath).toBe("Note1.md");
  });

  it("respects limit", () => {
    const entries = getAuditLog({ vault, limit: 2 });
    expect(entries).toHaveLength(2);
  });

  it("getIndexRuns returns runs with computed durationMs", () => {
    const runs = getIndexRuns({ vault });
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.runId).toBe("run-1");
    expect(run.vaultName).toBe("test-vault");
    expect(run.trigger).toBe("manual");
    expect(run.notesIndexed).toBe(2);
    expect(run.chunksCreated).toBe(4);
    expect(run.notesUpdated).toBe(1);
    expect(run.notesDeleted).toBe(0);
    expect(run.error).toBeNull();
    expect(run.modelName).toBeNull();
    expect(run.startedAt).toBeGreaterThan(0);
    expect(run.finishedAt).not.toBeNull();
    expect(run.durationMs).not.toBeNull();
    expect(run.durationMs!).toBeGreaterThanOrEqual(0);
  });

  it("getIndexRuns yields null durationMs for unfinished runs", () => {
    db.audit.startRun({
      runId: "run-2",
      vaultName: "test-vault",
      modelId: null,
      trigger: "watcher",
    });
    const runs = getIndexRuns({ vault, limit: 5 });
    const r2 = runs.find((r) => r.runId === "run-2");
    expect(r2).toBeDefined();
    expect(r2!.finishedAt).toBeNull();
    expect(r2!.durationMs).toBeNull();
  });

  it("getIndexRuns resolves modelName when model_id is set", () => {
    const model = db.models.upsert({
      name: "qwen3-embedding",
      provider: "ollama",
      dim: 1024,
    });
    db.audit.startRun({
      runId: "run-3",
      vaultName: "test-vault",
      modelId: model.id,
      trigger: "manual",
    });
    db.audit.finishRun("run-3", {
      notesIndexed: 1,
      chunksCreated: 1,
      notesUpdated: 0,
      notesDeleted: 0,
    });
    const runs = getIndexRuns({ vault, limit: 5 });
    const r3 = runs.find((r) => r.runId === "run-3");
    expect(r3?.modelName).toBe("qwen3-embedding");
  });
});
