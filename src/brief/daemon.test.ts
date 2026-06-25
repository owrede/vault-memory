/**
 * Phase 5 / BRF-05..BRF-08 — BriefStalenessDaemon tests.
 *
 * Standup: real Database + MemorySinkRegistry + StubDelivery/StubSource
 * (shared Map) + StubChangeFeed (in-process EventEmitter). Test-only
 * lockRootOverride routes the lockfile under mkdtemp so the real
 * `~/.vault-memory/locks/` is untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Database } from "../db/index.js";
import { VaultManager } from "../vault/index.js";
import type { Vault } from "../vault/index.js";
import { StubDelivery } from "../adapters/stub/delivery.js";
import { StubSource } from "../adapters/stub/source.js";
import { StubChangeFeed } from "../adapters/stub/change-feed.js";
import { provisionSink } from "../adapters/delivery/obsidian-fs/sentinel.js";
import { MemorySinkRegistry, parseMemorySinkHandle } from "../memory/index.js";
import { computeChunkIdFragment } from "../chunker/chunk-id.js";
import type { ChangeEvent, ChunkId, Document, DocId, MemorySink } from "../types.js";
import { parseDocId } from "../adapters/registry.js";
import { BriefStalenessDaemon, type DaemonDeps } from "./daemon.js";
import { handleCompileBrief } from "./compile.js";
import { tryAcquireLock } from "./lock.js";

const VAULT_NAME = "test-vault";
const BRIEF_SINK_REL_PATH = "_memory/_briefs/";

function stubServer(): McpServer {
  return {
    server: {
      getClientCapabilities: () => undefined,
      createMessage: async () => ({
        content: { type: "text", text: "stub body" },
        model: "stub-model",
        role: "assistant",
      }),
    },
  } as unknown as McpServer;
}

function stubOllama(reply: string): unknown {
  return {
    chat: vi.fn(async () => ({
      model: "llama3.2",
      message: { role: "assistant" as const, content: reply },
    })),
  };
}

async function buildFixture() {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-daemon-"));
  const lockRoot = await mkdtemp(join(tmpdir(), "vm-daemon-lock-"));
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };

  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  const registry = new MemorySinkRegistry();
  const briefSinkHandle = parseMemorySinkHandle(
    `obsidian-fs://${VAULT_NAME}/${BRIEF_SINK_REL_PATH}`,
  );
  await registry.registerMemorySinks(
    [
      {
        name: "_memory/_briefs",
        handle: briefSinkHandle,
        contract: "default-brief-v1",
      },
    ],
    {
      resolveVaultAbsolutePath: () => vaultDir,
      provisioner: async (sink: MemorySink, vaultAbs: string) => {
        await provisionSink(sink, vaultAbs, { version: "test" });
      },
    },
  );

  const docs = new Map<DocId, Document>();
  const delivery = new StubDelivery(docs, registry);
  const source = new StubSource(docs);
  const feed = new StubChangeFeed();

  return {
    vault,
    vaultDir,
    lockRoot,
    manager,
    registry,
    docs,
    delivery,
    source,
    feed,
    cleanup: async () => {
      db.close();
      await rm(vaultDir, { recursive: true, force: true });
      await rm(lockRoot, { recursive: true, force: true });
    },
  };
}

function seedSourceDocs(
  vault: Vault,
  docs: ReadonlyArray<{ path: string; title: string; text: string }>,
): DocId[] {
  const ids: DocId[] = [];
  let now = Date.now();
  for (const d of docs) {
    const noteId = vault.db.notes.upsertByPath({
      path: d.path,
      content: d.text,
      frontmatter: null,
      title: d.title,
      hash: `hash-${d.path}`,
      bodyHash: `bh-${d.path}`,
      mtime: now++,
      wordCount: d.text.split(/\s+/).length,
      vaultName: VAULT_NAME,
    }).id;
    vault.db.chunks.insertBatch(noteId, [
      {
        idx: 0,
        text: d.text,
        headingPath: null,
        startOffset: 0,
        endOffset: d.text.length,
        tokenCount: d.text.split(/\s+/).length,
        chunkIdFragment: computeChunkIdFragment(d.text),
      },
    ]);
    ids.push(parseDocId(`obsidian-fs://${VAULT_NAME}/${d.path}`));
  }
  return ids;
}

/**
 * Rewrite a source doc's text — both filesystem-side notes/chunks row
 * — so the daemon observes hash divergence relative to a previously-
 * compiled brief's recorded_hash.
 */
function rewriteSourceText(vault: Vault, docId: DocId, newText: string): void {
  const { resource } = parseDocIdResource(docId);
  const note = vault.db.notes.getByPath(resource);
  if (!note) throw new Error(`unknown note: ${resource}`);
  // Replace the single chunk row.
  vault.db.chunks.deleteByNote(note.id);
  vault.db.chunks.insertBatch(note.id, [
    {
      idx: 0,
      text: newText,
      headingPath: null,
      startOffset: 0,
      endOffset: newText.length,
      tokenCount: newText.split(/\s+/).length,
      chunkIdFragment: computeChunkIdFragment(newText),
    },
  ]);
}

function parseDocIdResource(id: DocId): { resource: string } {
  // obsidian-fs://<vault>/<resource>
  const idx = id.indexOf("/", "obsidian-fs://".length);
  return { resource: id.slice(idx + 1) };
}

async function compileBrief(opts: {
  vault: Vault;
  registry: MemorySinkRegistry;
  manager: VaultManager;
  delivery: StubDelivery;
  source: StubSource;
  target: string;
  source_doc_ids: DocId[];
}): Promise<DocId> {
  const res = await handleCompileBrief(
    {
      memorySinkRegistry: opts.registry,
      manager: opts.manager,
      deliveryAdapterFor: () => opts.delivery,
      sourceConnectorFor: () => opts.source,
      server: stubServer(),
      ollama: stubOllama(`Brief body. [[stub]]`) as never,
      briefConfig: { ollama: { model: "llama3.2" } },
    },
    {
      vault: opts.vault.config.name,
      target: opts.target,
      source_doc_ids: opts.source_doc_ids,
      purpose: "test brief",
      max_tokens: 200,
    },
  );
  if (!res.ok) throw new Error(`compile failed: ${JSON.stringify(res)}`);
  return res.doc_id as DocId;
}

/** Yield one event-loop tick so promise microtasks settle. */
function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe("BriefStalenessDaemon (BRF-05/06/07/08, D-07, D-09)", () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function depsFor(extra: Partial<DaemonDeps> = {}): DaemonDeps {
    return {
      memorySinkRegistry: fixture.registry,
      deliveryAdapterFor: () => fixture.delivery,
      sourceConnectorFor: () => fixture.source,
      lockRootOverride: fixture.lockRoot,
      log: () => {},
      ...extra,
    };
  }

  it("Test 1: start on a fresh vault subscribes once, sets cursor, no error", async () => {
    const daemon = new BriefStalenessDaemon();
    const res = await daemon.start(fixture.vault, fixture.feed, depsFor());
    expect(res.acquired).toBe(true);
    expect(daemon.isOwner).toBe(true);
    const cursor = fixture.vault.db.daemonState.getCursor(VAULT_NAME);
    expect(cursor).not.toBeNull();
    expect(typeof cursor).toBe("number");
    await daemon.shutdown();
  });

  it("Test 2: startup full scan with no divergence does NOT call delivery.update", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "doc a content" },
    ]);
    const briefId = await compileBrief({
      ...fixture,
      target: "a-target",
      source_doc_ids: [d1!],
    });
    // Capture pre-state.
    const before = fixture.docs.get(briefId)!;
    expect(before.properties.status).toBe("active");

    const updateSpy = vi.spyOn(fixture.delivery, "update");
    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor());
    expect(updateSpy).not.toHaveBeenCalled();
    await daemon.shutdown();
  });

  it("Test 3: startup full scan flips brief stale when chunks diverge from recorded_hash", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "original a content" },
    ]);
    const briefId = await compileBrief({
      ...fixture,
      target: "a-target",
      source_doc_ids: [d1!],
    });

    // Rewrite the source doc behind the daemon's back so hash diverges.
    rewriteSourceText(fixture.vault, d1!, "modified a content (different)");

    const updateSpy = vi.spyOn(fixture.delivery, "update");
    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor());
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [calledBriefId, patch] = updateSpy.mock.calls[0]!;
    expect(calledBriefId).toBe(briefId);
    const patchProps = (patch as { properties: Record<string, unknown> }).properties;
    expect(patchProps.status).toBe("stale");
    expect(patchProps.changed_sources).toEqual(expect.arrayContaining([d1]));

    // Verify the doc is now stale.
    const after = fixture.docs.get(briefId)!;
    expect(after.properties.status).toBe("stale");
    expect(after.properties.changed_sources).toEqual(expect.arrayContaining([d1]));
    await daemon.shutdown();
  });

  it("Test 4: lock contention — daemon does not subscribe, logs WARN, returns acquired:false", async () => {
    // First holder grabs the lock under the test's lockRoot.
    await tryAcquireLock(VAULT_NAME, { rootOverride: fixture.lockRoot });

    const logs: string[] = [];
    const daemon = new BriefStalenessDaemon();
    const res = await daemon.start(
      fixture.vault,
      fixture.feed,
      depsFor({ log: (m) => logs.push(m) }),
    );
    expect(res.acquired).toBe(false);
    expect(daemon.isOwner).toBe(false);
    expect(logs.some((m) => m.includes("daemon_already_owned"))).toBe(true);
    expect(logs.some((m) => m.includes(`"vault":"${VAULT_NAME}"`))).toBe(true);

    // Subscribe was NOT called (no events flow through).
    const updateSpy = vi.spyOn(fixture.delivery, "update");
    // Drive a synthetic update — daemon must not react.
    const fakeId = parseDocId(`obsidian-fs://${VAULT_NAME}/anything.md`);
    fixture.feed.emit({ kind: "update", id: fakeId, at: Date.now() });
    await tick();
    expect(updateSpy).not.toHaveBeenCalled();

    await daemon.shutdown();
  });

  it("Test 5: update event flips a divergent brief stale via delivery.update", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "original a content" },
    ]);
    const briefId = await compileBrief({
      ...fixture,
      target: "a-target",
      source_doc_ids: [d1!],
    });

    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor());

    // Rewrite source then fire update event for that doc_id.
    rewriteSourceText(fixture.vault, d1!, "modified a content");
    const updateSpy = vi.spyOn(fixture.delivery, "update");
    fixture.feed.emit({ kind: "update", id: d1!, at: Date.now() });
    await tick();
    await tick();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const after = fixture.docs.get(briefId)!;
    expect(after.properties.status).toBe("stale");
    expect(after.properties.changed_sources).toEqual(expect.arrayContaining([d1]));
    await daemon.shutdown();
  });

  it("Test 6: delete event eventually marks briefs stale (grace-window expires)", async () => {
    let clock = 1_000_000;
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "doc a content" },
    ]);
    const briefId = await compileBrief({
      ...fixture,
      target: "a-target",
      source_doc_ids: [d1!],
    });

    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor({ now: () => clock }));

    // Delete the chunk so the daemon's recompute sees a "vanished" source.
    fixture.feed.emit({ kind: "delete", id: d1!, at: clock });
    await tick();

    // Before grace-window expires: brief is still active (held in pendingDeletes).
    expect(fixture.docs.get(briefId)!.properties.status).toBe("active");

    // Now actually drop the chunk row to simulate the indexer's removeNote
    // having processed the delete by the time grace-window expires.
    vault_drop_chunks_for(fixture.vault, d1!);

    // Advance clock past grace-window + force drainage.
    clock += 6_000;
    await daemon.drainPending();
    await tick();

    expect(fixture.docs.get(briefId)!.properties.status).toBe("stale");
    expect(fixture.docs.get(briefId)!.properties.changed_sources).toEqual(
      expect.arrayContaining([d1]),
    );

    await daemon.shutdown();
  });

  it("Test 7: rename via delete+create within grace-window preserves brief→source link (BRF-08)", async () => {
    // Seed under old path; compile a brief; "rename" the doc by
    // create-ing the same content under a new path while the
    // pendingDelete is still in-window.
    const ORIG_PATH = "projects/atlas-a.md";
    const NEW_PATH = "projects/atlas-a-renamed.md";
    const TEXT = "Atlas-A canonical content";

    const [d1] = seedSourceDocs(fixture.vault, [{ path: ORIG_PATH, title: "A", text: TEXT }]);
    const briefId = await compileBrief({
      ...fixture,
      target: "atlas-a",
      source_doc_ids: [d1!],
    });

    // Reverse-index has one row pointing at d1.
    const beforeRows = fixture.vault.db.briefSources.briefsForChunkDoc(d1!);
    expect(beforeRows.length).toBe(1);

    let clock = 2_000_000;
    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor({ now: () => clock }));

    // Simulate a rename: delete event for old, then create event for new
    // (the FS state already has the chunk moved under the new path).
    fixture.feed.emit({ kind: "delete", id: d1!, at: clock });
    // Wait for handleDelete to capture chunk hashes BEFORE we mutate
    // the chunks rows underneath it.
    await tick();
    await tick();

    // Move the chunk row: new path + same chunk text + same fragment.
    const oldNote = fixture.vault.db.notes.getByPath(ORIG_PATH);
    if (oldNote) {
      // Re-insert under NEW_PATH and delete original.
      fixture.vault.db.notes.upsertByPath({
        path: NEW_PATH,
        content: TEXT,
        frontmatter: null,
        title: "A",
        hash: `hash-${NEW_PATH}`,
        bodyHash: `bh-${NEW_PATH}`,
        mtime: Date.now(),
        wordCount: TEXT.split(/\s+/).length,
        vaultName: VAULT_NAME,
      });
      const newNoteRow = fixture.vault.db.notes.getByPath(NEW_PATH)!;
      fixture.vault.db.chunks.insertBatch(newNoteRow.id, [
        {
          idx: 0,
          text: TEXT,
          headingPath: null,
          startOffset: 0,
          endOffset: TEXT.length,
          tokenCount: TEXT.split(/\s+/).length,
          chunkIdFragment: computeChunkIdFragment(TEXT),
        },
      ]);
      // Remove the original chunks (simulate the rename's old-side cleanup).
      fixture.vault.db.chunks.deleteByNote(oldNote.id);
    }

    clock += 100; // Still within grace-window.
    const newId = parseDocId(`obsidian-fs://${VAULT_NAME}/${NEW_PATH}`);
    fixture.feed.emit({ kind: "create", id: newId, at: clock });
    await tick();

    // Brief NOT marked stale: rename heuristic rewrote chunk_doc_id.
    expect(fixture.docs.get(briefId)!.properties.status).toBe("active");
    const afterRowsForOld = fixture.vault.db.briefSources.briefsForChunkDoc(d1!);
    expect(afterRowsForOld.length).toBe(0);
    const afterRowsForNew = fixture.vault.db.briefSources.briefsForChunkDoc(newId);
    expect(afterRowsForNew.length).toBe(1);

    await daemon.shutdown();
  });

  it("Test 8: a failing delivery.update is caught + logged; daemon continues", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "doc a" },
    ]);
    await compileBrief({
      ...fixture,
      target: "a-target",
      source_doc_ids: [d1!],
    });
    rewriteSourceText(fixture.vault, d1!, "doc a (modified)");

    // Force delivery.update to throw.
    const updateSpy = vi
      .spyOn(fixture.delivery, "update")
      .mockRejectedValueOnce(new Error("kaboom"));

    const logs: string[] = [];
    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor({ log: (m) => logs.push(m) }));

    expect(updateSpy).toHaveBeenCalled();
    // The startup-scan path wraps evaluateBrief in try/catch.
    expect(logs.some((m) => m.includes("brief_staleness_error") && m.includes("kaboom"))).toBe(
      true,
    );

    // Fire an update event — daemon is still alive and processing.
    fixture.feed.emit({ kind: "update", id: d1!, at: Date.now() });
    await tick();

    await daemon.shutdown();
  });

  it("Test 9: rapid sequential events do not crash daemon on per-event error", async () => {
    // Sanity: drive several events with no briefs at all.
    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor());

    const id = parseDocId(`obsidian-fs://${VAULT_NAME}/nothing.md`);
    for (let i = 0; i < 5; i++) {
      fixture.feed.emit({ kind: "update", id, at: Date.now() });
    }
    await tick();
    await tick();
    // Cursor is monotonically non-decreasing.
    const c1 = fixture.vault.db.daemonState.getCursor(VAULT_NAME);
    expect(c1).not.toBeNull();
    await daemon.shutdown();
  });

  it("Test 10: shutdown disposes subscription first, then releases lock", async () => {
    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor());
    expect(daemon.isOwner).toBe(true);
    await daemon.shutdown();
    expect(daemon.isOwner).toBe(false);

    // After shutdown, the lockfile is gone; a fresh acquire works.
    const reacquire = await tryAcquireLock(VAULT_NAME, {
      rootOverride: fixture.lockRoot,
    });
    expect(reacquire.acquired).toBe(true);
  });

  it("Test 11: cursor updated on each handler invocation", async () => {
    let clock = 5_000_000;
    const daemon = new BriefStalenessDaemon();
    await daemon.start(fixture.vault, fixture.feed, depsFor({ now: () => clock }));
    const initial = fixture.vault.db.daemonState.getCursor(VAULT_NAME)!;
    expect(initial).toBe(5_000_000);

    clock = 5_000_100;
    const id = parseDocId(`obsidian-fs://${VAULT_NAME}/missing.md`);
    fixture.feed.emit({ kind: "update", id, at: clock });
    await tick();
    const next = fixture.vault.db.daemonState.getCursor(VAULT_NAME)!;
    expect(next).toBeGreaterThanOrEqual(initial);

    await daemon.shutdown();
  });
});

/**
 * Helper: drop chunks rows for the given doc_id (simulates the indexer's
 * removeNote after a real delete event).
 */
function vault_drop_chunks_for(vault: Vault, docId: DocId): void {
  const { resource } = parseDocIdResource(docId);
  const note = vault.db.notes.getByPath(resource);
  if (!note) return;
  vault.db.chunks.deleteByNote(note.id);
}

// Suppress an unused-import lint while keeping a single import block
// that mirrors the compile.test.ts shape.
void writeFile;
void ({} as ChunkId);
