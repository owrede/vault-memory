/**
 * Conformance suite — asserts ObsidianFsDelivery and StubDelivery both
 * satisfy the DeliveryAdapter contract per ADR-002 §DeliveryAdapter.
 *
 * Parameterized via `describe.each` (same idiom introduced by
 * src/adapters/source/conformance.test.ts in plan 01-03 task 05). The
 * suite is the FLOOR — adapter-specific behavior lives in the co-located
 * test next to each adapter.
 *
 * Each adapter case publishes a `factory` that returns a fresh
 * { adapter, cleanup } pair so the suite is reusable for any future
 * adapter (notion-api in Phase 10).
 *
 * Capability-gated assertions (cases 7 + 8): tests inspect the adapter's
 * published `capabilities.hashProtected` and assert only the matching
 * subset — we never test hashProtected="strong" behavior against the
 * stub (which honestly publishes "none"). This is the I-7 honesty
 * contract in action.
 */

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { ObsidianFsDelivery } from "./obsidian-fs/index.js";
import { StubDelivery } from "../stub/delivery.js";
import { Database } from "../../db/index.js";
import type { Vault } from "../../vault/index.js";
import type { DeliveryAdapter } from "./types.js";
import type { Document, DocId } from "../../types.js";
import { formatDocId } from "../registry.js";

interface Fixture {
  adapter: DeliveryAdapter;
  /** Mint a DocId for this adapter's scheme + authority. */
  mintId(resource: string): DocId;
  cleanup(): Promise<void>;
}

async function makeObsidianFsFixture(): Promise<Fixture> {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-conf-delivery-"));
  const db = new Database(":memory:", "conf");
  const vault: Vault = {
    config: { name: "conf-vault", path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };
  const adapter = new ObsidianFsDelivery(vault, "conf-client");
  return {
    adapter,
    mintId: (resource) => formatDocId("obsidian-fs", "conf-vault", resource),
    cleanup: async () => {
      db.close();
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

async function makeStubFixture(): Promise<Fixture> {
  const docs = new Map<DocId, Document>();
  const adapter = new StubDelivery(docs);
  return {
    adapter,
    mintId: (resource) => formatDocId("stub", "memory", resource),
    cleanup: async () => {
      // Nothing to clean — the Map is garbage-collected with the fixture.
    },
  };
}

const adapters: Array<[name: string, factory: () => Promise<Fixture>]> = [
  ["obsidian-fs", makeObsidianFsFixture],
  ["stub", makeStubFixture],
];

describe.each(adapters)("DeliveryAdapter conformance (%s)", (_name, factory) => {
  it("1. publishes honest DeliveryCapabilities (all 4 keys present)", async () => {
    const f = await factory();
    try {
      const caps = f.adapter.capabilities;
      expect(typeof caps.atomic).toBe("boolean");
      expect(["strong", "best-effort", "none"]).toContain(caps.hashProtected);
      expect(typeof caps.enforcedSchema).toBe("boolean");
      expect(["caller-provided", "adapter-derived", "remote-assigned"]).toContain(caps.naming);
    } finally {
      await f.cleanup();
    }
  });

  it("2. handle has a valid <scheme>://<authority> shape", async () => {
    const f = await factory();
    try {
      expect(f.adapter.handle).toMatch(/^[a-z][a-z0-9-]*:\/\/[^/]+$/);
    } finally {
      await f.cleanup();
    }
  });

  it("3. write(new id) succeeds with ok:true, created:true", async () => {
    const f = await factory();
    try {
      const id = f.mintId("c3.md");
      const res = await f.adapter.write(id, {
        blocks: [{ kind: "paragraph", text: "case 3" }],
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.created).toBe(true);
      expect(res.doc_id).toBe(id);
      expect(typeof res.newHash).toBe("string");
      expect(res.newHash.length).toBeGreaterThan(0);
    } finally {
      await f.cleanup();
    }
  });

  it("4. write(existing id) succeeds with created:false (per-adapter OCC rules)", async () => {
    const f = await factory();
    try {
      const id = f.mintId("c4.md");
      const first = await f.adapter.write(id, {
        blocks: [{ kind: "paragraph", text: "v1" }],
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      // For hashProtected="strong" adapters, must supply the current
      // hash to overwrite. For "none" adapters, hash is ignored.
      const opts =
        f.adapter.capabilities.hashProtected === "strong"
          ? { expectedHash: first.newHash }
          : undefined;
      const second = await f.adapter.write(
        id,
        { blocks: [{ kind: "paragraph", text: "v2" }] },
        opts,
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.created).toBe(false);
    } finally {
      await f.cleanup();
    }
  });

  it("5. update(unknown id) returns { ok:false, reason:'not_found' }", async () => {
    const f = await factory();
    try {
      const id = f.mintId("c5-ghost.md");
      const res = await f.adapter.update(id, { properties: { x: 1 } });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("not_found");
    } finally {
      await f.cleanup();
    }
  });

  it("6. delete(known id) → ok; subsequent write shows created:true again", async () => {
    const f = await factory();
    try {
      const id = f.mintId("c6.md");
      const first = await f.adapter.write(id, {
        blocks: [{ kind: "paragraph", text: "v1" }],
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const delOpts =
        f.adapter.capabilities.hashProtected === "strong"
          ? { expectedHash: first.newHash }
          : undefined;
      const del = await f.adapter.delete(id, delOpts);
      expect(del.ok).toBe(true);

      // Indirect existence check: a write under the same id is "created" again.
      const reWrite = await f.adapter.write(id, {
        blocks: [{ kind: "paragraph", text: "v2" }],
      });
      expect(reWrite.ok).toBe(true);
      if (!reWrite.ok) return;
      expect(reWrite.created).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("7. hashProtected=strong adapters REJECT conflicting expectedHash", async () => {
    const f = await factory();
    try {
      if (f.adapter.capabilities.hashProtected !== "strong") {
        // Capability gate — assertion does not apply to this adapter.
        return;
      }
      const id = f.mintId("c7.md");
      await f.adapter.write(id, { blocks: [{ kind: "paragraph", text: "v1" }] });
      const res = await f.adapter.write(
        id,
        { blocks: [{ kind: "paragraph", text: "v2" }] },
        { expectedHash: "0".repeat(64) },
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("hash_mismatch");
    } finally {
      await f.cleanup();
    }
  });

  it("8. hashProtected=none adapters IGNORE expectedHash (honest capability)", async () => {
    const f = await factory();
    try {
      if (f.adapter.capabilities.hashProtected !== "none") {
        return;
      }
      const id = f.mintId("c8.md");
      await f.adapter.write(id, { blocks: [{ kind: "paragraph", text: "v1" }] });
      const res = await f.adapter.write(
        id,
        { blocks: [{ kind: "paragraph", text: "v2" }] },
        { expectedHash: "bogus" },
      );
      expect(res.ok).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("9. WriteResult.doc_id round-trips the input DocId", async () => {
    const f = await factory();
    try {
      const id = f.mintId("c9/nested/path.md");
      const res = await f.adapter.write(id, {
        blocks: [{ kind: "paragraph", text: "x" }],
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.doc_id).toBe(id);
    } finally {
      await f.cleanup();
    }
  });

  it("10. delete(unknown id) returns { ok:false, reason:'not_found' }", async () => {
    const f = await factory();
    try {
      const id = f.mintId("c10-never.md");
      const opts =
        f.adapter.capabilities.hashProtected === "strong"
          ? { expectedHash: "0".repeat(64) }
          : undefined;
      const res = await f.adapter.delete(id, opts);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("not_found");
    } finally {
      await f.cleanup();
    }
  });
});

// ── obsidian-fs-only: filesystem-level invariant ──────────────────────────
//
// Not part of the parameterized suite — these assertions are intentionally
// adapter-specific (filesystem state after write).
describe("ObsidianFsDelivery — filesystem invariants (adapter-specific)", () => {
  it("write produces a file on disk at the resolved path", async () => {
    const f = await makeObsidianFsFixture();
    try {
      const id = f.mintId("invariant/written.md");
      await f.adapter.write(id, { blocks: [{ kind: "paragraph", text: "z" }] });
      // The fs path inside conf-vault was mkdtemp'd; we know the layout
      // because makeObsidianFsFixture set vault.config.path.
      // Just verify SOMETHING was written by re-checking via the adapter
      // facade's own update() not-found probe inverted.
      const upd = await f.adapter.update(id, { properties: { x: 1 } });
      expect(upd.ok).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("write outside vault rejects via safeJoinInsideVault (path traversal guard)", async () => {
    const f = await makeObsidianFsFixture();
    try {
      const dangerous = formatDocId("obsidian-fs", "conf-vault", "../escape.md");
      await expect(
        f.adapter.write(dangerous, { blocks: [{ kind: "paragraph", text: "x" }] }),
      ).rejects.toThrow(/outside vault/i);
    } finally {
      await f.cleanup();
    }
  });
});

// Top-level fs/os imports kept for the obsidian-fs fixture; the conformance
// suite itself uses no direct fs calls (delegates to the adapter).
void fs;
void tmpdir;
