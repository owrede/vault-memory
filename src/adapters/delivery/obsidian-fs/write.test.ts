import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { Database } from "../../../db/index.js";
import type { Vault } from "../../../vault/index.js";
import { writeNote, deleteNote } from "./write.js";
import { OutsideVaultError } from "./fs.js";
import { ObsidianFsDelivery } from "./index.js";
import { provisionSink, SENTINEL_FILENAME } from "./sentinel.js";
import { MemorySinkRegistry, parseMemorySinkHandle } from "../../../memory/index.js";
import { formatDocId } from "../../registry.js";
import type { MemorySink } from "../../../types.js";

function makeVault(path: string, writeEnabled = true): Vault {
  const db = new Database(":memory:", "test-vault");
  return {
    config: {
      name: "test",
      path,
      write_enabled: writeEnabled,
    },
    db,
    dbPath: ":memory:",
  };
}

describe("writeNote", () => {
  let vaultDir: string;
  let vault: Vault;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-write-"));
    vault = makeVault(vaultDir);
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("creates a new note (file + DB row + audit op=create)", async () => {
    const res = await writeNote({
      vault,
      relativePath: "hello.md",
      content: "# Hello\n\nWorld.",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(true);

    const onDisk = await fs.readFile(join(vaultDir, "hello.md"), "utf-8");
    expect(onDisk).toBe("# Hello\n\nWorld.");

    const row = vault.db.notes.getByPath("hello.md");
    expect(row).not.toBeNull();
    expect(row?.title).toBe("Hello");
    expect(row?.hash).toBe(res.newHash);

    const audits = vault.db.audit.listWrites({ noteId: res.noteId });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.op).toBe("create");
    expect(audits[0]?.previous_hash).toBeNull();
    expect(audits[0]?.new_hash).toBe(res.newHash);
  });

  it("conflict when writing to an existing file WITHOUT expectedHash", async () => {
    await writeNote({ vault, relativePath: "x.md", content: "v1" });
    const res = await writeNote({ vault, relativePath: "x.md", content: "v2" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
    expect(res.currentHash).toBeDefined();
    expect(res.currentContent).toBe("v1");
  });

  it("conflict when expectedHash is wrong", async () => {
    await writeNote({ vault, relativePath: "y.md", content: "v1" });
    const res = await writeNote({
      vault,
      relativePath: "y.md",
      content: "v2",
      expectedHash: "deadbeef",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
    expect(res.currentHash).toBeDefined();
    expect(res.currentContent).toBe("v1");
    // file unchanged on disk
    expect(await fs.readFile(join(vaultDir, "y.md"), "utf-8")).toBe("v1");
  });

  it("succeeds when expectedHash matches; audit records op=update", async () => {
    const first = await writeNote({
      vault,
      relativePath: "z.md",
      content: "v1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await writeNote({
      vault,
      relativePath: "z.md",
      content: "v2",
      expectedHash: first.newHash,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.newHash).not.toBe(first.newHash);

    expect(await fs.readFile(join(vaultDir, "z.md"), "utf-8")).toBe("v2");

    const audits = vault.db.audit.listWrites({ noteId: second.noteId });
    expect(audits).toHaveLength(2);
    // listWrites is DESC by id — newest first
    expect(audits[0]?.op).toBe("update");
    expect(audits[0]?.previous_hash).toBe(first.newHash);
    expect(audits[1]?.op).toBe("create");
  });

  it("permission denied when write_enabled=false (even for new files)", async () => {
    const ro = makeVault(vaultDir, false);
    try {
      const res = await writeNote({
        vault: ro,
        relativePath: "blocked.md",
        content: "x",
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("permission_denied");
      // No file created
      await expect(fs.access(join(vaultDir, "blocked.md"))).rejects.toThrow();
    } finally {
      ro.db.close();
    }
  });

  it("throws on path traversal", async () => {
    await expect(
      writeNote({
        vault,
        relativePath: "../etc/passwd",
        content: "boom",
      }),
    ).rejects.toBeInstanceOf(OutsideVaultError);
  });

  it("persists aliases from frontmatter", async () => {
    const res = await writeNote({
      vault,
      relativePath: "people/jh.md",
      content: "Notes about JH.",
      frontmatter: { aliases: ["JH", "Jörg"] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const stored = vault.db.aliases.listForNote(res.noteId).sort();
    expect(stored).toEqual(["JH", "Jörg"].sort());
    // Resolve works case-insensitively
    expect(vault.db.aliases.resolve("jh")?.note_id).toBe(res.noteId);

    // File on disk has the YAML block
    const raw = await fs.readFile(join(vaultDir, "people/jh.md"), "utf-8");
    expect(raw.startsWith("---")).toBe(true);
    expect(raw).toContain("JH");
  });
});

describe("deleteNote", () => {
  let vaultDir: string;
  let vault: Vault;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-delete-"));
    vault = makeVault(vaultDir);
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("deletes file + DB row + records audit op=delete", async () => {
    const w = await writeNote({
      vault,
      relativePath: "doomed.md",
      content: "bye",
    });
    expect(w.ok).toBe(true);
    if (!w.ok) return;

    const d = await deleteNote({
      vault,
      relativePath: "doomed.md",
      expectedHash: w.newHash,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.created).toBe(false);

    await expect(fs.access(join(vaultDir, "doomed.md"))).rejects.toThrow();
    expect(vault.db.notes.getByPath("doomed.md")).toBeNull();

    // After delete, the audit row's note_id was set to NULL by the FK
    // (migration 003: ON DELETE SET NULL on write_audit.note_id).
    // The audit history survives — we just have to look it up unfiltered.
    const audits = vault.db.audit.listWrites({});
    const deleteEntry = audits.find((a) => a.op === "delete");
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry?.note_id).toBeNull();
    expect(deleteEntry?.new_hash).toBeNull();
    expect(deleteEntry?.previous_hash).toBe(w.newHash);
  });

  it("conflict when expectedHash does not match", async () => {
    const w = await writeNote({
      vault,
      relativePath: "k.md",
      content: "v1",
    });
    expect(w.ok).toBe(true);

    const d = await deleteNote({
      vault,
      relativePath: "k.md",
      expectedHash: "wrong",
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("hash_mismatch");
    // file still present
    await fs.access(join(vaultDir, "k.md"));
    expect(vault.db.notes.getByPath("k.md")).not.toBeNull();
  });

  it("conflict when file does not exist", async () => {
    const d = await deleteNote({
      vault,
      relativePath: "ghost.md",
      expectedHash: "anything",
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("hash_mismatch");
  });
});

// ── Phase 2 sentinel cases (19–21) ────────────────────────────────────────
//
// Adapter-specific (NOT part of the conformance suite — sentinel is
// filesystem-specific). Cover:
//   - 19: sink folder with a valid .memory-sink lets a write through.
//   - 20: sink folder LACKING .memory-sink returns sentinel_missing.
//   - 21: sink folder absent entirely returns sentinel_missing.
describe("ObsidianFsDelivery — sentinel guard (cases 19–21)", () => {
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

  /** Build an adapter + registry with a single "test" sink. */
  async function makeFixture(opts: { provisionSentinel: boolean; createFolder: boolean }) {
    const vaultDir = await mkdtemp(join(tmpdir(), "vm-sentinel-"));
    const db = new Database(":memory:", "sentinel-vault");
    const vault: Vault = {
      config: { name: "sentinel-vault", path: vaultDir, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    const registry = new MemorySinkRegistry();
    const sinkHandle = parseMemorySinkHandle(`obsidian-fs://sentinel-vault/${SINK_REL_PATH}`);
    await registry.registerMemorySinks(
      [{ name: "test", handle: sinkHandle, contract: "default-memory-v1" }],
      {
        resolveVaultAbsolutePath: () => vaultDir,
        provisioner: async (sink: MemorySink, vaultAbs: string) => {
          if (opts.provisionSentinel) {
            // Normal sentinel write.
            await provisionSink(sink, vaultAbs, { version: "test" });
          } else if (opts.createFolder) {
            // Create folder but skip sentinel.
            await fs.mkdir(join(vaultAbs, sink.resolveToRelativePath), {
              recursive: true,
            });
          }
          // else: leave folder absent.
        },
      },
    );
    const adapter = new ObsidianFsDelivery(vault, "test-client", registry);
    return {
      adapter,
      sinkHandle,
      vaultDir,
      cleanup: async () => {
        db.close();
        await rm(vaultDir, { recursive: true, force: true });
      },
    };
  }

  it("19. sink with valid sentinel allows write to proceed (positive)", async () => {
    const f = await makeFixture({ provisionSentinel: true, createFolder: true });
    try {
      const id = formatDocId("obsidian-fs", "sentinel-vault", `${SINK_REL_PATH}c19.md`);
      const res = await f.adapter.write(
        id,
        {
          properties: fullyValidProps(),
          blocks: [{ kind: "paragraph", text: "ok" }],
        },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.created).toBe(true);

      // File actually exists on disk.
      const onDisk = await fs.readFile(join(f.vaultDir, SINK_REL_PATH, "c19.md"), "utf-8");
      expect(onDisk).toContain("ok");
      // Sentinel still there.
      await fs.access(join(f.vaultDir, SINK_REL_PATH, SENTINEL_FILENAME));
    } finally {
      await f.cleanup();
    }
  });

  it("20. sink folder lacking .memory-sink returns sentinel_missing", async () => {
    const f = await makeFixture({ provisionSentinel: false, createFolder: true });
    try {
      const id = formatDocId("obsidian-fs", "sentinel-vault", `${SINK_REL_PATH}c20.md`);
      const res = await f.adapter.write(
        id,
        {
          properties: fullyValidProps(),
          blocks: [{ kind: "paragraph", text: "x" }],
        },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("sentinel_missing");
      expect(res.sinkName).toBe("test");
      expect(res.message).toContain(".memory-sink");
    } finally {
      await f.cleanup();
    }
  });

  it("21. sink folder absent entirely returns sentinel_missing", async () => {
    const f = await makeFixture({ provisionSentinel: false, createFolder: false });
    try {
      const id = formatDocId("obsidian-fs", "sentinel-vault", `${SINK_REL_PATH}c21.md`);
      const res = await f.adapter.write(
        id,
        {
          properties: fullyValidProps(),
          blocks: [{ kind: "paragraph", text: "x" }],
        },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("sentinel_missing");
      expect(res.sinkName).toBe("test");
    } finally {
      await f.cleanup();
    }
  });
});

// ── Plan 02-03b: entry-point Guards on writeNote / deleteNote ──────────────
//
// Defense-in-depth (the authoritative chokepoint still lives at the
// DeliveryAdapter per ADR-002 I-6; these tests pin the v1-entry-point
// refusal so that callers bypassing the facade still hit a structured
// `sink_write_blocked` rather than silently dumping into a memory folder).
describe("writeNote — MEM-07 entry-point Guard (Plan 02-03b)", () => {
  let vaultDir: string;
  let vault: Vault;
  let registry: MemorySinkRegistry;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-write-guard-"));
    vault = makeVault(vaultDir);
    vault.config.name = "guard-vault";
    registry = new MemorySinkRegistry();
    const sinkHandle = parseMemorySinkHandle("obsidian-fs://guard-vault/_memory/");
    await registry.registerMemorySinks(
      [{ name: "default", handle: sinkHandle, contract: "default-memory-v1" }],
      {
        resolveVaultAbsolutePath: () => vaultDir,
        provisioner: async (sink: MemorySink, vaultAbs: string) => {
          await provisionSink(sink, vaultAbs, { version: "test" });
        },
      },
    );
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("refuses sink-resolved target with sink_write_blocked", async () => {
    const res = await writeNote({
      vault,
      relativePath: "_memory/observations/foo.md",
      content: "x",
      registry,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("sink_write_blocked");
    expect(res.sinkName).toBe("default");
    expect(res.suggestion).toMatch(/record_observation/);
    expect(res.message).toMatch(/MemorySink "default"/);
    // No file should have been created.
    await expect(fs.access(join(vaultDir, "_memory", "observations", "foo.md"))).rejects.toThrow();
  });

  it("guard does NOT fire on non-sink paths", async () => {
    const res = await writeNote({
      vault,
      relativePath: "regular-note.md",
      content: "hello",
      registry,
    });
    expect(res.ok).toBe(true);
  });

  it("registry omitted → guard silently skipped (back-compat)", async () => {
    // Same path that would be refused with a registry; without one,
    // writeNote behaves like Phase 1.
    const res = await writeNote({
      vault,
      relativePath: "_memory/observations/no-guard.md",
      content: "x",
    });
    expect(res.ok).toBe(true);
  });
});

// ── Plan 02-06 (MEM-08): audit discriminator wiring on write paths ──────
//
// `writeNote` records the flag verbatim; the facade derives it from
// `opts.sink !== undefined`. These tests verify both layers stamp the
// resulting audit row correctly.
describe("writeNote — MEM-08 audit discriminator (Plan 02-06)", () => {
  let vaultDir: string;
  let vault: Vault;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-mem08-"));
    vault = makeVault(vaultDir);
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("writeNote WITHOUT isMemorySinkWrite → audit row has is_memory_sink_write=0", async () => {
    const res = await writeNote({
      vault,
      relativePath: "user.md",
      content: "x",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rows = vault.db.audit.listWrites({ noteId: res.noteId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_memory_sink_write).toBe(0);
  });

  it("writeNote WITH isMemorySinkWrite: true → audit row has is_memory_sink_write=1", async () => {
    const res = await writeNote({
      vault,
      relativePath: "agent.md",
      content: "x",
      isMemorySinkWrite: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rows = vault.db.audit.listWrites({ noteId: res.noteId });
    expect(rows[0]!.is_memory_sink_write).toBe(1);
    // Filter end-to-end.
    expect(vault.db.audit.listWrites({ isMemorySinkWrite: true })).toHaveLength(1);
    expect(vault.db.audit.listWrites({ isMemorySinkWrite: false })).toHaveLength(0);
  });

  it("deleteNote WITHOUT isMemorySinkWrite → delete audit row has is_memory_sink_write=0", async () => {
    const w = await writeNote({ vault, relativePath: "doomed.md", content: "x" });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const d = await deleteNote({
      vault,
      relativePath: "doomed.md",
      expectedHash: w.newHash,
    });
    expect(d.ok).toBe(true);
    const rows = vault.db.audit.listWrites({});
    const del = rows.find((r) => r.op === "delete");
    expect(del).toBeDefined();
    expect(del!.is_memory_sink_write).toBe(0);
  });
});

describe("ObsidianFsDelivery facade — MEM-08 audit discriminator (Plan 02-06)", () => {
  // The facade derives `isMemorySinkWrite` from `opts.sink !== undefined`.
  // We use the existing sentinel-fixture pattern (sink + valid sentinel)
  // so the Guard chain passes and the write actually records an audit row.
  const SINK_REL_PATH = "_memory/";

  async function makeSinkFixture() {
    const vaultDir = await mkdtemp(join(tmpdir(), "vm-mem08-facade-"));
    const db = new Database(":memory:", "mem08-vault");
    const vault: Vault = {
      config: { name: "mem08-vault", path: vaultDir, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    const registry = new MemorySinkRegistry();
    const sinkHandle = parseMemorySinkHandle(`obsidian-fs://mem08-vault/${SINK_REL_PATH}`);
    await registry.registerMemorySinks(
      [{ name: "default", handle: sinkHandle, contract: "default-memory-v1" }],
      {
        resolveVaultAbsolutePath: () => vaultDir,
        provisioner: async (sink: MemorySink, vaultAbs: string) => {
          await provisionSink(sink, vaultAbs, { version: "test" });
        },
      },
    );
    const adapter = new ObsidianFsDelivery(vault, "test-client", registry);
    return {
      adapter,
      sinkHandle,
      vault,
      vaultDir,
      cleanup: async () => {
        db.close();
        await rm(vaultDir, { recursive: true, force: true });
      },
    };
  }

  function fullyValidAgentProps(): Record<string, unknown> {
    return {
      source: "agent",
      confidence: "direct",
      evidence: ["call-2026-01-01"],
      status: "active",
      observed_at: "2026-01-01T10:00:00Z",
      superseded_by: null,
      type: "fact",
    };
  }

  it("write() WITHOUT opts.sink → audit row is_memory_sink_write=0", async () => {
    const f = await makeSinkFixture();
    try {
      const id = formatDocId("obsidian-fs", "mem08-vault", "regular.md");
      const res = await f.adapter.write(id, {
        properties: { source: "user" },
        blocks: [{ kind: "paragraph", text: "user note" }],
      });
      expect(res.ok).toBe(true);
      const rows = f.vault.db.audit.listWrites({});
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_memory_sink_write).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("write() WITH opts.sink → audit row is_memory_sink_write=1", async () => {
    const f = await makeSinkFixture();
    try {
      const id = formatDocId("obsidian-fs", "mem08-vault", `${SINK_REL_PATH}obs.md`);
      const res = await f.adapter.write(
        id,
        {
          properties: fullyValidAgentProps(),
          blocks: [{ kind: "paragraph", text: "obs" }],
        },
        { sink: f.sinkHandle },
      );
      expect(res.ok).toBe(true);
      const rows = f.vault.db.audit.listWrites({});
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_memory_sink_write).toBe(1);
      // Filter pin: memory-only listWrites returns this row; non-memory excludes it.
      expect(f.vault.db.audit.listWrites({ isMemorySinkWrite: true })).toHaveLength(1);
      expect(f.vault.db.audit.listWrites({ isMemorySinkWrite: false })).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it("update() WITH opts.sink → audit row is_memory_sink_write=1", async () => {
    const f = await makeSinkFixture();
    try {
      const id = formatDocId("obsidian-fs", "mem08-vault", `${SINK_REL_PATH}obs.md`);
      // Seed initial memory write via the facade.
      const writeRes = await f.adapter.write(
        id,
        {
          properties: fullyValidAgentProps(),
          blocks: [{ kind: "paragraph", text: "v1" }],
        },
        { sink: f.sinkHandle },
      );
      expect(writeRes.ok).toBe(true);
      if (!writeRes.ok) return;

      const updRes = await f.adapter.update(
        id,
        {
          properties: { ...fullyValidAgentProps(), status: "active" },
          blocks: [{ kind: "paragraph", text: "v2" }],
        },
        { sink: f.sinkHandle, expectedHash: writeRes.newHash },
      );
      expect(updRes.ok).toBe(true);
      const rows = f.vault.db.audit.listWrites({});
      // Both rows are memory-sink writes.
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.is_memory_sink_write).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
});

describe("deleteNote — MEM-07 entry-point Guard (Plan 02-03b)", () => {
  let vaultDir: string;
  let vault: Vault;
  let registry: MemorySinkRegistry;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-delete-guard-"));
    vault = makeVault(vaultDir);
    vault.config.name = "guard-vault";
    registry = new MemorySinkRegistry();
    const sinkHandle = parseMemorySinkHandle("obsidian-fs://guard-vault/_memory/");
    await registry.registerMemorySinks(
      [{ name: "default", handle: sinkHandle, contract: "default-memory-v1" }],
      {
        resolveVaultAbsolutePath: () => vaultDir,
        provisioner: async (sink: MemorySink, vaultAbs: string) => {
          await provisionSink(sink, vaultAbs, { version: "test" });
        },
      },
    );
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("refuses sink-resolved target with sink_write_blocked + supersede suggestion", async () => {
    // Pre-create a file inside the sink (bypassing the guard by not passing
    // the registry); then attempt to delete with the guard active.
    await writeNote({
      vault,
      relativePath: "_memory/observations/del-me.md",
      content: "x",
    });
    const w = vault.db.notes.getByPath("_memory/observations/del-me.md");
    const res = await deleteNote({
      vault,
      relativePath: "_memory/observations/del-me.md",
      expectedHash: w?.hash ?? "x",
      registry,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("sink_write_blocked");
    expect(res.sinkName).toBe("default");
    expect(res.suggestion).toMatch(/supersede/i);
    // File still present on disk.
    await fs.access(join(vaultDir, "_memory", "observations", "del-me.md"));
  });
});

describe("writeNote frontmatter serialization (Issue #14)", () => {
  let vaultDir: string;
  let vault: Vault;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-write-fm-"));
    vault = makeVault(vaultDir);
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("serializes long string values single-line, not as a >- block scalar", async () => {
    const longValue =
      "This is a very long frontmatter string value that would normally be " +
      "folded by js-yaml at column eighty into a block scalar which Obsidian's " +
      "Properties editor mishandles.";
    const res = await writeNote({
      vault,
      relativePath: "note.md",
      content: "# Note\n\nbody.",
      frontmatter: { title: "Note", summary: longValue },
    });
    expect(res.ok).toBe(true);

    const onDisk = await fs.readFile(join(vaultDir, "note.md"), "utf-8");
    // No block-scalar folding markers in the frontmatter.
    expect(onDisk).not.toContain(">-");
    // The value survives intact on a single line.
    expect(onDisk).toContain(`summary: ${longValue}`);
  });
});
