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
import { provisionSink } from "./obsidian-fs/sentinel.js";
import { StubDelivery } from "../stub/delivery.js";
import { Database } from "../../db/index.js";
import type { Vault } from "../../vault/index.js";
import type { DeliveryAdapter } from "./types.js";
import type { Document, DocId, MemorySink } from "../../types.js";
import { formatDocId } from "../registry.js";
import { MemorySinkRegistry, parseMemorySinkHandle } from "../../memory/index.js";

interface Fixture {
  adapter: DeliveryAdapter;
  /** Mint a DocId for this adapter's scheme + authority. */
  mintId(resource: string): DocId;
  cleanup(): Promise<void>;
  /**
   * Filesystem root of the fixture vault, if the adapter is FS-backed.
   * Undefined for non-FS adapters (e.g. StubDelivery). Used by the
   * obsidian-fs-only "filesystem invariants" block to assert on-disk
   * state directly via `fs.readFile`, not via adapter round-trips.
   */
  vaultDir?: string;
}

/**
 * Phase 2 fixture variant: like `Fixture` but the adapter has a
 * `MemorySinkRegistry` wired with a single sink named "test" backed by
 * the `default-memory-v1` contract. The fixture exposes mint helpers
 * for sink-resolved and non-sink DocIds.
 *
 * Used by the Guard A/B conformance cases (11–18).
 */
interface SinkFixture extends Fixture {
  /** Mint a DocId that lands INSIDE the registered sink. */
  mintSinkId(filename: string): DocId;
  /** Mint a DocId that lands OUTSIDE every sink. */
  mintOutsideId(filename: string): DocId;
  /** The handle of the registered "test" sink. */
  sinkHandle: ReturnType<typeof parseMemorySinkHandle>;
  /** The vault name used by the registry's path-based enclosure check. */
  vaultName: string;
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
    vaultDir,
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

// ── Phase 2 sink-fixture factories ─────────────────────────────────────────
//
// Both adapters get the SAME registry shape: one sink named "test"
// rooted at `_memory/`, backed by the `default-memory-v1` contract.
// The obsidian-fs variant actually writes the sentinel; the stub
// variant uses a no-op provisioner (no filesystem).

const SINK_REL_PATH = "_memory/";

function fullyValidProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "agent",
    confidence: "direct",
    evidence: ["call-2026-01-01"],
    status: "active",
    observed_at: "2026-01-01T10:00:00Z",
    superseded_by: null,
    type: "fact",
    ...overrides,
  };
}

async function makeObsidianFsSinkFixture(): Promise<SinkFixture> {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-conf-delivery-sink-"));
  const db = new Database(":memory:", "conf");
  const vault: Vault = {
    config: { name: "conf-vault", path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };
  const registry = new MemorySinkRegistry();
  const sinkHandle = parseMemorySinkHandle(`obsidian-fs://conf-vault/${SINK_REL_PATH}`);
  await registry.registerMemorySinks(
    [{ name: "test", handle: sinkHandle, contract: "default-memory-v1" }],
    {
      resolveVaultAbsolutePath: () => vaultDir,
      provisioner: async (sink: MemorySink, vaultAbs: string) => {
        await provisionSink(sink, vaultAbs, { version: "test" });
      },
    },
  );
  const adapter = new ObsidianFsDelivery(vault, "conf-client", registry);
  return {
    adapter,
    sinkHandle,
    vaultName: "conf-vault",
    mintId: (r) => formatDocId("obsidian-fs", "conf-vault", r),
    mintSinkId: (filename) =>
      formatDocId("obsidian-fs", "conf-vault", `${SINK_REL_PATH}${filename}`),
    mintOutsideId: (filename) => formatDocId("obsidian-fs", "conf-vault", `notes/${filename}`),
    cleanup: async () => {
      db.close();
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

async function makeStubSinkFixture(): Promise<SinkFixture> {
  const docs = new Map<DocId, Document>();
  const registry = new MemorySinkRegistry();
  // Use obsidian-fs sink handles + DocIds so the registry's
  // `findSinkContaining` (which is hard-coded to scheme === "obsidian-fs")
  // can perform path-based enclosure checks for the stub adapter too.
  // The stub doesn't validate DocId schemes — it just stores in a Map.
  const sinkHandle = parseMemorySinkHandle(`obsidian-fs://stub-vault/${SINK_REL_PATH}`);
  await registry.registerMemorySinks(
    [{ name: "test", handle: sinkHandle, contract: "default-memory-v1" }],
    {
      resolveVaultAbsolutePath: () => "/dev/null", // never read — no provisioner FS work
      provisioner: async () => {
        // No-op: stub has no filesystem.
      },
    },
  );
  const adapter = new StubDelivery(docs, registry);
  return {
    adapter,
    sinkHandle,
    vaultName: "stub-vault",
    mintId: (r) => formatDocId("obsidian-fs", "stub-vault", r),
    mintSinkId: (filename) =>
      formatDocId("obsidian-fs", "stub-vault", `${SINK_REL_PATH}${filename}`),
    mintOutsideId: (filename) => formatDocId("obsidian-fs", "stub-vault", `notes/${filename}`),
    cleanup: async () => {
      // Map garbage-collected with fixture.
    },
  };
}

const sinkAdapters: Array<[name: string, factory: () => Promise<SinkFixture>]> = [
  ["obsidian-fs", makeObsidianFsSinkFixture],
  ["stub", makeStubSinkFixture],
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
      // WR-05 (Plan 02-14): hashProtected="strong" adapters refuse update
      // without opts.expectedHash. Supply a placeholder so the not_found
      // path is reachable. hashProtected="none" adapters ignore the field.
      const opts =
        f.adapter.capabilities.hashProtected === "strong"
          ? { expectedHash: "0".repeat(64) }
          : undefined;
      const res = await f.adapter.update(id, { properties: { x: 1 } }, opts);
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

// ── Phase 2 Guard A/B conformance cases (11–18) ─────────────────────────
//
// Parameterized across both delivery adapters per Plan 02-03 truth
// "Both `ObsidianFsDelivery` and `StubDelivery` enforce the same Guard
// A/B contract (proven by parameterized conformance tests 11–18)".
//
// Each case wires a single sink ("test") rooted at `_memory/` with
// the `default-memory-v1` contract, then drives the adapter and asserts
// the exact `WriteConflict` shape.

describe.each(sinkAdapters)("DeliveryAdapter Phase 2 guards (%s)", (_name, factory) => {
  it("11. Guard B: source:'agent' write outside any sink → agent_write_outside_sink", async () => {
    const f = await factory();
    try {
      const id = f.mintOutsideId("c11.md");
      const res = await f.adapter.write(id, {
        properties: fullyValidProps(),
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("agent_write_outside_sink");
      expect(res.suggestion).toContain("record_observation");
    } finally {
      await f.cleanup();
    }
  });

  it("12. Guard B: source:'user' write INSIDE a sink → non_agent_write_inside_sink", async () => {
    const f = await factory();
    try {
      const id = f.mintSinkId("c12.md");
      const res = await f.adapter.write(
        id,
        { properties: fullyValidProps({ source: "user" }) },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("non_agent_write_inside_sink");
      expect(res.sinkName).toBe("test");
    } finally {
      await f.cleanup();
    }
  });

  it("13. Guard A: missing observed_at into a sink → missing_provenance", async () => {
    const f = await factory();
    try {
      const id = f.mintSinkId("c13.md");
      const props = fullyValidProps();
      delete props.observed_at;
      const res = await f.adapter.write(id, { properties: props }, { sink: f.sinkHandle });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("missing_provenance");
      expect(res.key).toBe("observed_at");
      expect(res.sinkName).toBe("test");
    } finally {
      await f.cleanup();
    }
  });

  it("14. Guard A: confidence:'unknown' into a sink → invalid_provenance", async () => {
    const f = await factory();
    try {
      const id = f.mintSinkId("c14.md");
      const res = await f.adapter.write(
        id,
        { properties: fullyValidProps({ confidence: "unknown" }) },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("invalid_provenance");
      expect(res.key).toBe("confidence");
      expect(res.observedValue).toBe("unknown");
      expect(res.sinkName).toBe("test");
    } finally {
      await f.cleanup();
    }
  });

  it("15. Guard A: status:'superseded' + empty superseded_reason → supersede_mismatch", async () => {
    const f = await factory();
    try {
      const id = f.mintSinkId("c15.md");
      const res = await f.adapter.write(
        id,
        {
          properties: fullyValidProps({
            status: "superseded",
            superseded_by: `obsidian-fs://${f.vaultName}/${SINK_REL_PATH}prior.md`,
            superseded_reason: "",
          }),
        },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("supersede_mismatch");
      expect(res.key).toBe("superseded_reason");
    } finally {
      await f.cleanup();
    }
  });

  it("16. Guard A: fully-valid sink write succeeds (positive control)", async () => {
    const f = await factory();
    try {
      const id = f.mintSinkId("c16.md");
      const res = await f.adapter.write(
        id,
        { properties: fullyValidProps(), blocks: [{ kind: "paragraph", text: "ok" }] },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.doc_id).toBe(id);
      expect(res.created).toBe(true);
      expect(typeof res.newHash).toBe("string");
    } finally {
      await f.cleanup();
    }
  });

  it("17. update() routes through the SAME validator (missing observed_at refused)", async () => {
    const f = await factory();
    try {
      // First, a clean write to seed the document.
      const id = f.mintSinkId("c17.md");
      const seed = await f.adapter.write(
        id,
        { properties: fullyValidProps(), blocks: [{ kind: "paragraph", text: "seed" }] },
        { sink: f.sinkHandle },
      );
      expect(seed.ok).toBe(true);

      // Now patch with properties that omit observed_at.
      const patchProps = fullyValidProps();
      delete patchProps.observed_at;
      const opts =
        f.adapter.capabilities.hashProtected === "strong" && seed.ok
          ? { sink: f.sinkHandle, expectedHash: seed.newHash }
          : { sink: f.sinkHandle };
      const res = await f.adapter.update(id, { properties: patchProps }, opts);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("missing_provenance");
      expect(res.key).toBe("observed_at");
    } finally {
      await f.cleanup();
    }
  });

  it("18. delete(sink-resolved id) → sink_write_blocked (regardless of opts.sink)", async () => {
    const f = await factory();
    try {
      const id = f.mintSinkId("c18.md");
      // Seed so the document exists; delete should refuse anyway.
      const seed = await f.adapter.write(
        id,
        { properties: fullyValidProps(), blocks: [{ kind: "paragraph", text: "seed" }] },
        { sink: f.sinkHandle },
      );
      expect(seed.ok).toBe(true);

      // No opts.sink — the registry's path-based enclosure check fires.
      const opts =
        f.adapter.capabilities.hashProtected === "strong" && seed.ok
          ? { expectedHash: seed.newHash }
          : undefined;
      const res = await f.adapter.delete(id, opts);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("sink_write_blocked");
      expect(res.sinkName).toBe("test");
      expect(res.suggestion).toContain("supersede");
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
  it("write produces a file on disk at the resolved path (disk-verified via fs.readFile)", async () => {
    const f = await makeObsidianFsFixture();
    try {
      const id = f.mintId("invariant/written.md");
      const wrote = await f.adapter.write(id, {
        blocks: [{ kind: "paragraph", text: "hello-on-disk" }],
      });
      expect(wrote.ok).toBe(true);
      if (!wrote.ok) return;
      expect(f.vaultDir).toBeDefined();
      // Resolve the absolute on-disk path from the fixture root, NOT via the
      // adapter facade. This is the test that catches a regression where
      // write() returns ok=true without touching the filesystem (audit H1).
      const onDiskPath = join(f.vaultDir as string, "invariant/written.md");
      const bytes = await fs.readFile(onDiskPath, "utf-8");
      expect(bytes.length).toBeGreaterThan(0);
      // The body block is rendered into the markdown body — verify the
      // literal text we wrote shows up in the file.
      expect(bytes).toContain("hello-on-disk");
    } finally {
      await f.cleanup();
    }
  });

  it("write returns ok and the document is subsequently updatable via the adapter facade", async () => {
    const f = await makeObsidianFsFixture();
    try {
      const id = f.mintId("invariant/updatable.md");
      const wrote = await f.adapter.write(id, {
        blocks: [{ kind: "paragraph", text: "z" }],
      });
      expect(wrote.ok).toBe(true);
      if (!wrote.ok) return;
      // WR-05 (Plan 02-14) requires expectedHash for update() on
      // hashProtected="strong" adapters — supply the just-written newHash
      // to exercise the success path.
      const upd = await f.adapter.update(
        id,
        { properties: { x: 1 } },
        { expectedHash: wrote.newHash },
      );
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

// Top-level os import kept for the obsidian-fs fixture; `fs` is now used
// directly by the disk-verified test above.
void tmpdir;
