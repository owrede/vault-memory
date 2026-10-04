import { beforeEach, afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { recordCheckpoint, startSession, type SessionDeps } from "./lifecycle.js";
import { indexVault } from "../indexer/indexer.js";
import { buildSourceHashes } from "../brief/source-hashes.js";
import { provisionSink } from "../adapters/delivery/obsidian-fs/sentinel.js";
let f: Awaited<ReturnType<typeof createVaultFixture>>, deps: SessionDeps;
beforeEach(async () => {
  f = await createVaultFixture({ memorySink: true });
  await fs.writeFile(join(f.root, "Source.md"), "# Source\nVerified evidence");
  deps = { ...f, sourceConnectorFor: () => f.source, deliveryAdapterFor: () => f.delivery };
});
afterEach(async () => f.cleanup());
const input = () => ({
  session_id: "s",
  event_id: "e",
  sink: "memory",
  summary: "Made progress",
  source_doc_ids: [f.id("Source.md")],
  observed_at: "2026-10-03T10:00:00Z",
});
it("creates one canonical agent checkpoint for repeated events and preserves explicit provenance", async () => {
  const first = await recordCheckpoint(input(), deps);
  expect(first.ok).toBe(true);
  const repeated = await recordCheckpoint(input(), deps);
  expect(repeated).toMatchObject({ ok: true, reused: true, doc_id: first.doc_id });
  const doc = await f.source.readDocument(first.doc_id);
  expect(doc.properties).toMatchObject({
    source: "agent",
    type: "summary",
    confidence: "inferred",
    observed_at: input().observed_at,
    evidence: [f.id("Source.md"), "session:s", "event:e"],
  });
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(1);
  expect((await recordCheckpoint({ ...input(), event_id: "e2" }, deps)).ok).toBe(true);
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(2);
});
it("reserves parallel events atomically and refuses changed payloads for the same key", async () => {
  const results = await Promise.all([
    recordCheckpoint(input(), deps),
    recordCheckpoint(input(), deps),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)?.reason).toBe("checkpoint_in_progress");
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(1);
  expect(await recordCheckpoint({ ...input(), summary: "Different claim" }, deps)).toMatchObject({
    ok: false,
    reason: "checkpoint_mismatch",
  });
});
it("reconstructs checkpoint idempotence from canonical Markdown after dropping derived reservations", async () => {
  const first = await recordCheckpoint(input(), deps);
  expect(first.ok).toBe(true);
  f.vault.db.handle.exec("DELETE FROM checkpoint_reservations");
  expect(await recordCheckpoint(input(), deps)).toMatchObject({
    ok: true,
    reused: true,
    doc_id: first.doc_id,
  });
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(1);
});
it("rejects missing evidence, unknown sinks, sentinel removal and readonly writes without creating memories", async () => {
  await expect(
    recordCheckpoint({ ...input(), source_doc_ids: [f.id("Missing.md")] }, deps),
  ).rejects.toThrow();
  await expect(recordCheckpoint({ ...input(), sink: "unknown" }, deps)).rejects.toThrow();
  await fs.unlink(join(f.root, "_memory", ".memory-sink"));
  expect(await recordCheckpoint(input(), deps)).toMatchObject({
    ok: false,
    reason: "sentinel_missing",
  });
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(0);
});
it("verifies fresh source hashes on session start and retains citations within the context budget", async () => {
  await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
  const note = f.vault.db.notes.getByPath("Source.md")!,
    chunk = f.vault.db.chunks.getByNote(note.id)[0]!;
  await f.memorySinkRegistry.registerMemorySinks(
    [{ name: "briefs", handle: "obsidian-fs://lab/_briefs/", contract: "default-brief-v1" }],
    {
      resolveVaultAbsolutePath: () => f.root,
      provisioner: (sink, root) => provisionSink(sink, root, { version: "test" }),
    },
  );
  await fs.writeFile(
    join(f.root, "_briefs", "brief.md"),
    "---\ntarget: project\nstatus: active\nsource_hashes: " +
      JSON.stringify(
        buildSourceHashes([
          { docId: f.id("Source.md"), fragment: chunk.chunk_id_fragment!, text: chunk.text },
        ]),
      ) +
      "\n---\nUseful context from sources",
  );
  const result = await startSession(
    { vault: "lab", sink: "briefs", topic: "project", max_chars: 6 },
    deps,
  );
  expect(result).toMatchObject({ text: "Useful", stale: false, truncated: true });
  expect(result.citations.map((c: any) => c.doc_id)).toEqual([
    f.id("_briefs/brief.md"),
    f.id("Source.md"),
  ]);
  await fs.writeFile(join(f.root, "Source.md"), "# Source\nExternally changed");
  expect(
    await startSession({ vault: "lab", sink: "briefs", topic: "project" }, deps),
  ).toMatchObject({ text: "", stale: true });
});
it("preserves readonly sink guards and does not reuse a tampered canonical summary", async () => {
  f.vault.config.write_enabled = false;
  expect(await recordCheckpoint(input(), deps)).toMatchObject({
    ok: false,
    reason: "permission_denied",
  });
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(0);
  f.vault.config.write_enabled = true;
  const first = await recordCheckpoint(input(), deps);
  if (!first.ok) throw new Error("Fixture checkpoint refused");
  const path = join(f.root, first.doc_id.split("obsidian-fs://lab/")[1]!);
  const raw = await fs.readFile(path, "utf8");
  await fs.writeFile(path, raw.replace("Made progress", "Tampered claim"));
  expect(await recordCheckpoint(input(), deps)).toMatchObject({
    ok: false,
    reason: "checkpoint_mismatch",
  });
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(1);
});
