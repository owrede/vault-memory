import { beforeEach, afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { prepareImport, commitImport, type ImportDeps } from "./commit.js";
import { promoteConversation } from "./promotion.js";
let f: Awaited<ReturnType<typeof createVaultFixture>>, deps: ImportDeps;
beforeEach(async () => {
  f = await createVaultFixture({ memorySink: true });
  deps = { ...f, sourceConnectorFor: () => f.source, deliveryAdapterFor: () => f.delivery };
});
afterEach(async () => f.cleanup());
const c = (text = "Two pilots") => [
  {
    provider: "neutral",
    external_id: "../c1",
    messages: [
      { id: "m1", role: "user" as const, text },
      { id: "tool1", role: "tool" as const, text: "Tool output" },
    ],
  },
];
const preview = () =>
  prepareImport(c(), "obsidian-fs://lab/imports/", "2026-10-03T10:00:00Z", deps);
it("previews without side effects, commits imported provenance and skips identical reimports", async () => {
  const manifest = await preview();
  expect(manifest.items).toHaveLength(1);
  expect(f.vault.db.audit.listWrites()).toHaveLength(0);
  expect(await f.source.exists(manifest.items[0].target)).toBe(false);
  expect((await commitImport(manifest, deps)).ok).toBe(true);
  const doc = await f.source.readDocument(manifest.items[0].target);
  expect(doc.properties).toMatchObject({
    source: "imported",
    import_hash: manifest.items[0].hash,
    import_source_id: manifest.items[0].source_id,
    imported_at: manifest.imported_at,
  });
  expect(await commitImport(manifest, deps)).toMatchObject({
    ok: true,
    results: [{ reused: true, doc_id: doc.id }],
  });
  expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(1);
});
it("requires a preview source hash for updates and preserves locks, canonical IDs and imported_at", async () => {
  const first = await preview();
  expect((await commitImport(first, deps)).ok).toBe(true);
  const original = await f.source.readDocument(first.items[0].target);
  const updated = await prepareImport(
    c("Changed export"),
    "obsidian-fs://lab/imports/",
    "2026-10-03T11:00:00Z",
    deps,
  );
  expect(updated.expected_hashes[original.id]).toBe(original.hash);
  const unsafe = structuredClone(updated);
  unsafe.expected_hashes[original.id] = null;
  expect(await commitImport(unsafe, deps)).toMatchObject({ ok: false, reason: "hash_mismatch" });
  expect((await commitImport(updated, deps)).ok).toBe(true);
  expect((await f.source.readDocument(original.id)).properties.imported_at).toBe(first.imported_at);
  const path = join(f.root, original.id.split("obsidian-fs://lab/")[1]!);
  let raw = await fs.readFile(path, "utf8");
  await fs.writeFile(path, raw.replace("source: imported", "source: imported\nlocked: true"));
  const locked = await prepareImport(
    c("Another export"),
    "obsidian-fs://lab/imports/",
    "2026-10-03T12:00:00Z",
    deps,
  );
  expect(await commitImport(locked, deps)).toMatchObject({ ok: false, reason: "document_locked" });
  expect(f.vault.db.audit.listWrites()).toHaveLength(2);
});
it("rejects imports into memory sinks, modified preview content and stale source snapshots without writes", async () => {
  const sink = await prepareImport(c(), "obsidian-fs://lab/_memory/", "2026-10-03T10:00:00Z", deps);
  expect(await commitImport(sink, deps)).toMatchObject({
    ok: false,
    reason: "non_agent_write_inside_sink",
  });
  const manifest = await preview();
  manifest.items[0].content = "Tampered";
  await expect(commitImport(manifest, deps)).rejects.toThrow("invalid_manifest");
  expect(f.vault.db.audit.listWrites()).toHaveLength(0);
});
it("promotes selected messages separately with concrete evidence and preserves source roles", async () => {
  const manifest = await preview();
  expect((await commitImport(manifest, deps)).ok).toBe(true);
  const doc = await f.source.readDocument(manifest.items[0].target);
  const args = {
    doc_id: doc.id,
    expected_hash: doc.hash,
    message_ids: ["tool1"],
    claim: "The tool produced output",
    mode: "inference" as const,
    sink: "memory",
    observed_at: "2026-10-03T12:00:00Z",
  };
  const result = await promoteConversation(args, deps);
  expect(result.ok).toBe(true);
  const memory = await f.source.readDocument(result.doc_id);
  expect(memory.properties).toMatchObject({
    source: "agent",
    confidence: "inferred",
    evidence: [doc.id + "#tool1"],
    conversation_roles: ["tool"],
  });
  expect(await promoteConversation({ ...args, message_ids: ["missing"] }, deps)).toMatchObject({
    ok: false,
    reason: "message_not_found",
  });
  expect(await promoteConversation({ ...args, expected_hash: "stale" }, deps)).toMatchObject({
    ok: false,
    reason: "hash_mismatch",
  });
  expect(
    await promoteConversation({ ...args, mode: "quote", claim: "Fabricated quote" }, deps),
  ).toMatchObject({ ok: false, reason: "quote_mismatch" });
  expect(f.vault.db.audit.listWrites({ isMemorySinkWrite: true })).toHaveLength(1);
});
it("refuses stale preview hashes and forged promotion metadata after external source edits", async () => {
  const initial = await preview();
  expect((await commitImport(initial, deps)).ok).toBe(true);
  const next = await prepareImport(
    c("Updated export"),
    "obsidian-fs://lab/imports/",
    "2026-10-03T11:00:00Z",
    deps,
  );
  const id = initial.items[0]!.target,
    path = join(f.root, id.split("obsidian-fs://lab/")[1]!);
  await fs.appendFile(path, "\nHuman annotation");
  expect(await commitImport(next, deps)).toMatchObject({ ok: false, reason: "hash_mismatch" });
  const doc = await f.source.readDocument(id);
  await expect(
    promoteConversation(
      {
        doc_id: id,
        expected_hash: doc.hash,
        message_ids: ["m1"],
        claim: "Two pilots",
        mode: "quote",
        sink: "memory",
        observed_at: "2026-10-03T12:00:00Z",
      },
      deps,
    ),
  ).rejects.toThrow("invalid_conversation");
  expect(f.vault.db.audit.listWrites()).toHaveLength(1);
});
