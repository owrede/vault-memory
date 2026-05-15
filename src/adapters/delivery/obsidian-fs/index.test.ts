/**
 * ObsidianFsDelivery (facade) co-located tests.
 *
 * The legacy `writeNote` / `deleteNote` are still tested in `./write.test.ts`.
 * These tests exercise the v2 DeliveryAdapter contract end-to-end:
 * `write` / `update` / `delete` returning v2-shaped results with `doc_id`
 * branded DocIds, plus the clientId override semantics from D-02.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { Database } from "../../../db/index.js";
import type { Vault } from "../../../vault/index.js";
import { ObsidianFsDelivery } from "./index.js";
import { formatDocId } from "../../registry.js";
import type { Document } from "../../../types.js";

function makeVault(path: string, writeEnabled = true): Vault {
  const db = new Database(":memory:", "test-vault");
  return {
    config: { name: "test-vault", path, write_enabled: writeEnabled },
    db,
    dbPath: ":memory:",
  };
}

describe("ObsidianFsDelivery", () => {
  let vaultDir: string;
  let vault: Vault;
  let delivery: ObsidianFsDelivery;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-obsfs-delivery-"));
    vault = makeVault(vaultDir);
    delivery = new ObsidianFsDelivery(vault, "test-client-default");
  });

  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("publishes the expected capabilities", () => {
    expect(delivery.capabilities).toEqual({
      atomic: true,
      hashProtected: "strong",
      enforcedSchema: false,
      naming: "caller-provided",
    });
  });

  it("handle is obsidian-fs://<vault-name>", () => {
    expect(delivery.handle).toBe("obsidian-fs://test-vault");
  });

  it("write(new doc) succeeds with doc_id + created:true", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "hello.md");
    const doc: Partial<Document> = {
      blocks: [{ kind: "paragraph", text: "# Hello\n\nWorld." }],
      properties: { tags: ["greeting"] },
    };
    const res = await delivery.write(id, doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc_id).toBe(id);
    expect(res.created).toBe(true);
    expect(res.newHash).toMatch(/^[0-9a-f]{64}$/);

    const onDisk = await fs.readFile(join(vaultDir, "hello.md"), "utf-8");
    expect(onDisk).toContain("---");
    expect(onDisk).toContain("tags:");
    expect(onDisk).toContain("World.");
  });

  it("write(existing doc) with mismatching expectedHash → hash_mismatch", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "conflict.md");
    const first = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "v1" }],
    });
    expect(first.ok).toBe(true);

    const res = await delivery.write(
      id,
      { blocks: [{ kind: "paragraph", text: "v2" }] },
      { expectedHash: "deadbeef" },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
  });

  it("write(existing doc) with correct expectedHash → overwrite (created:false)", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "overwrite.md");
    const first = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "v1" }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const res = await delivery.write(
      id,
      { blocks: [{ kind: "paragraph", text: "v2" }] },
      { expectedHash: first.newHash },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(false);
  });

  it("update(unknown id) → not_found", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "ghost.md");
    // WR-05 (Plan 02-14): update() refuses without opts.expectedHash, so
    // supply a placeholder hash to exercise the not_found path. The placeholder
    // never reaches OCC because the file is absent.
    const res = await delivery.update(
      id,
      { properties: { key: "v" } },
      { expectedHash: "0".repeat(64) },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_found");
  });

  it("update(existing id) merges properties shallow + preserves body", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "merge.md");
    const first = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "Body text" }],
      properties: { a: 1, b: 2 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const upd = await delivery.update(
      id,
      { properties: { b: 99, c: 3 } },
      { expectedHash: first.newHash },
    );
    expect(upd.ok).toBe(true);

    const onDisk = await fs.readFile(join(vaultDir, "merge.md"), "utf-8");
    expect(onDisk).toContain("a: 1");
    expect(onDisk).toContain("b: 99");
    expect(onDisk).toContain("c: 3");
    expect(onDisk).toContain("Body text");
  });

  it("delete(known id) with expectedHash → ok + file gone", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "rm.md");
    const first = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "doomed" }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const res = await delivery.delete(id, { expectedHash: first.newHash });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc_id).toBe(id);

    await expect(fs.stat(join(vaultDir, "rm.md"))).rejects.toThrow();
  });

  it("delete(unknown id) → not_found", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "never.md");
    const res = await delivery.delete(id, { expectedHash: "0".repeat(64) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_found");
  });

  it("opts.clientId overrides the constructor default in the audit log", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "audited.md");
    await delivery.write(
      id,
      { blocks: [{ kind: "paragraph", text: "x" }] },
      { clientId: "per-call-override" },
    );
    const rows = vault.db.audit.listWrites({ limit: 10 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.client_id).toBe("per-call-override");
  });

  it("constructor clientId default is used when opts.clientId is omitted", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "defaulted.md");
    await delivery.write(id, { blocks: [{ kind: "paragraph", text: "x" }] });
    const rows = vault.db.audit.listWrites({ limit: 10 });
    expect(rows[0]?.client_id).toBe("test-client-default");
  });

  it("forged DocId for another vault is rejected", async () => {
    const wrongId = formatDocId("obsidian-fs", "OTHER-VAULT", "x.md");
    await expect(
      delivery.write(wrongId, { blocks: [{ kind: "paragraph", text: "x" }] }),
    ).rejects.toThrow(/vault mismatch/);
  });

  // ── WR-05 (Plan 02-14): update() refuses without opts.expectedHash ──────────
  //
  // The `hashProtected: "strong"` capability descriptor MUST hold for the
  // update() path. Previously, when expectedHash was omitted, the adapter
  // silently fabricated it by reading the on-disk hash — racing with
  // concurrent edits between readFile and atomicWriteFile. This block pins
  // the refusal so the OCC contract is honest.

  it("WR-05: update without opts returns hash_mismatch", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "wr05-no-opts.md");
    const first = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "v1" }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const res = await delivery.update(id, { properties: { x: 1 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
    expect(res.message).toMatch(/requires opts\.expectedHash/);
  });

  it("WR-05: update with opts but no expectedHash returns hash_mismatch", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "wr05-empty-opts.md");
    const first = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "v1" }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const res = await delivery.update(id, { properties: { x: 1 } }, {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
    expect(res.message).toMatch(/requires opts\.expectedHash/);
  });

  it("WR-05: update with correct expectedHash succeeds", async () => {
    const id = formatDocId("obsidian-fs", "test-vault", "wr05-ok.md");
    const first = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "v1" }],
      properties: { a: 1 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const res = await delivery.update(
      id,
      { properties: { a: 2 } },
      { expectedHash: first.newHash },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc_id).toBe(id);
    expect(res.newHash).toMatch(/^[0-9a-f]{64}$/);

    const onDisk = await fs.readFile(join(vaultDir, "wr05-ok.md"), "utf-8");
    expect(onDisk).toContain("a: 2");
  });
});
