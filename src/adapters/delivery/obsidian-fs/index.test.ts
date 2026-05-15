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
import { provisionSink } from "./sentinel.js";
import {
  MemorySinkRegistry,
  parseMemorySinkHandle,
} from "../../../memory/index.js";
import type { Document, MemorySink } from "../../../types.js";

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

// ── WR-08 (Plan 02-14): is_memory_sink_write derived from resolved target ───
//
// The audit-row `is_memory_sink_write` flag MUST be derived from
// `registry.findSinkContaining(id) !== null` — the resolved-target truth —
// NOT from `opts.sink !== undefined` (caller intent). The two signals
// diverge when a write lands inside a sink WITHOUT routing through
// opts.sink (legacy bypass, future code paths). The audit must reflect
// what the disk says, not what the caller said.

describe("ObsidianFsDelivery — WR-08 audit is_memory_sink_write derivation", () => {
  const SINK_REL_PATH = "_memory/";

  function fullyValidAgentProps(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      source: "agent",
      confidence: "direct",
      evidence: ["call-2026-05-15"],
      status: "active",
      observed_at: "2026-05-15T10:00:00Z",
      superseded_by: null,
      type: "fact",
      ...overrides,
    };
  }

  async function makeFixtureWithRegistry(): Promise<{
    vault: Vault;
    vaultDir: string;
    delivery: ObsidianFsDelivery;
    cleanup: () => Promise<void>;
  }> {
    const vaultDir = await mkdtemp(join(tmpdir(), "vm-wr08-"));
    const db = new Database(":memory:", "wr08-vault");
    const vault: Vault = {
      config: { name: "wr08-vault", path: vaultDir, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    const registry = new MemorySinkRegistry();
    const sinkHandle = parseMemorySinkHandle(
      `obsidian-fs://wr08-vault/${SINK_REL_PATH}`,
    );
    await registry.registerMemorySinks(
      [{ name: "default", handle: sinkHandle, contract: "default-memory-v1" }],
      {
        resolveVaultAbsolutePath: () => vaultDir,
        provisioner: async (sink: MemorySink, vaultAbs: string) => {
          await provisionSink(sink, vaultAbs, { version: "test" });
        },
      },
    );
    const delivery = new ObsidianFsDelivery(vault, "wr08-client", registry);
    return {
      vault,
      vaultDir,
      delivery,
      cleanup: async () => {
        db.close();
        await rm(vaultDir, { recursive: true, force: true });
      },
    };
  }

  it("write(): is_memory_sink_write=true when DocId resolves into a sink, even without opts.sink", async () => {
    const f = await makeFixtureWithRegistry();
    try {
      const sinkId = formatDocId(
        "obsidian-fs",
        "wr08-vault",
        `${SINK_REL_PATH}wr08-write.md`,
      );
      const res = await f.delivery.write(
        sinkId,
        {
          blocks: [{ kind: "paragraph", text: "observed" }],
          properties: fullyValidAgentProps(),
        },
        // Deliberately omit opts.sink — WR-08 derivation must still flag this.
        {},
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const rows = f.vault.db.audit.listWrites({ limit: 10 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.is_memory_sink_write).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("update(): is_memory_sink_write=true when DocId resolves into a sink, even without opts.sink", async () => {
    const f = await makeFixtureWithRegistry();
    try {
      const sinkId = formatDocId(
        "obsidian-fs",
        "wr08-vault",
        `${SINK_REL_PATH}wr08-update.md`,
      );
      const first = await f.delivery.write(
        sinkId,
        {
          blocks: [{ kind: "paragraph", text: "v1" }],
          properties: fullyValidAgentProps(),
        },
        {},
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const upd = await f.delivery.update(
        sinkId,
        { properties: fullyValidAgentProps({ confidence: "inferred" }) },
        { expectedHash: first.newHash },
      );
      expect(upd.ok).toBe(true);

      const rows = f.vault.db.audit.listWrites({ limit: 10 });
      // The most recent row is the update.
      expect(rows[0]?.op).toBe("update");
      expect(rows[0]?.is_memory_sink_write).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("delete(): is_memory_sink_write flag is derived from findSinkContaining(id) (refused upstream as sink_write_blocked; flag derivation still parallel-symmetric)", async () => {
    const f = await makeFixtureWithRegistry();
    try {
      // A delete that resolves into a sink is refused with sink_write_blocked
      // BEFORE the audit row is written (that is the v2.0.0 contract). The
      // derivation symmetry is the contract; the resulting audit row count
      // is zero on this path. The test asserts the refusal shape so a
      // future bypass (which DOES reach audit) is forced to re-derive the
      // flag from findSinkContaining(id).
      const sinkId = formatDocId(
        "obsidian-fs",
        "wr08-vault",
        `${SINK_REL_PATH}wr08-delete.md`,
      );
      const first = await f.delivery.write(
        sinkId,
        {
          blocks: [{ kind: "paragraph", text: "doomed" }],
          properties: fullyValidAgentProps(),
        },
        {},
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const res = await f.delivery.delete(sinkId, {
        expectedHash: first.newHash,
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("sink_write_blocked");
    } finally {
      await f.cleanup();
    }
  });

  it("write() outside any sink: is_memory_sink_write=false even with registry configured", async () => {
    const f = await makeFixtureWithRegistry();
    try {
      const outsideId = formatDocId(
        "obsidian-fs",
        "wr08-vault",
        "notes/outside.md",
      );
      const res = await f.delivery.write(
        outsideId,
        {
          // source:"user" outside any sink passes Guard B.
          blocks: [{ kind: "paragraph", text: "user note" }],
          properties: { source: "user" },
        },
        {},
      );
      expect(res.ok).toBe(true);

      const rows = f.vault.db.audit.listWrites({ limit: 10 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.is_memory_sink_write).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("write() with no registry configured: is_memory_sink_write falls back to false (Phase 1 fixture back-compat)", async () => {
    // Use the top-level `delivery` style fixture: NO registry passed.
    const vaultDir2 = await mkdtemp(join(tmpdir(), "vm-wr08-noreg-"));
    const db = new Database(":memory:", "wr08-noreg-vault");
    const vault: Vault = {
      config: { name: "wr08-noreg-vault", path: vaultDir2, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    const noRegistryDelivery = new ObsidianFsDelivery(vault, "wr08-client");
    try {
      const id = formatDocId(
        "obsidian-fs",
        "wr08-noreg-vault",
        "anywhere.md",
      );
      const res = await noRegistryDelivery.write(
        id,
        { blocks: [{ kind: "paragraph", text: "x" }] },
        {},
      );
      expect(res.ok).toBe(true);

      const rows = vault.db.audit.listWrites({ limit: 10 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.is_memory_sink_write).toBe(0);
    } finally {
      db.close();
      await rm(vaultDir2, { recursive: true, force: true });
    }
  });
});
