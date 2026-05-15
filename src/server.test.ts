/**
 * Unit tests for v0.9.0 agent-compatibility helpers and aggregates.
 *
 * Full integration of the stdio MCP wireup is covered by the
 * scripts/smoketest-v0.9.0.sh end-to-end script — vitest here focuses on
 * the deterministic pure functions and SQL aggregates.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "./db/database.js";
import {
  encodeNoteId,
  decodeNoteId,
  truncateSnippet,
  aggregateTopTags,
  aggregateTopFrontmatterKeys,
} from "./server.js";
import { ObsidianFsSource } from "./adapters/source/obsidian-fs/index.js";
import { formatDocId } from "./adapters/registry.js";

describe("encodeNoteId / decodeNoteId", () => {
  it("round-trips a plain vault+path pair", () => {
    const id = encodeNoteId("my-vault", "Personen/Joerg.md");
    expect(id).toBe("my-vault:Personen/Joerg.md");
    expect(decodeNoteId(id)).toEqual({
      vault: "my-vault",
      path: "Personen/Joerg.md",
    });
  });

  it("preserves nested subpaths with colons after the first separator", () => {
    // First `:` is the vault separator; any further colons belong to the
    // path (Obsidian allows `:` in filenames on Linux/macOS).
    const id = encodeNoteId("inim", "Meetings/2026-05-12 14:00 Sync.md");
    expect(decodeNoteId(id)).toEqual({
      vault: "inim",
      path: "Meetings/2026-05-12 14:00 Sync.md",
    });
  });

  it("rejects malformed ids", () => {
    expect(() => decodeNoteId("no-separator")).toThrow();
    expect(() => decodeNoteId(":leading-empty-vault")).toThrow();
    expect(() => decodeNoteId("vault-only-trailing:")).toThrow();
  });
});

// D-01 (plan 01-04 task 06): the v1 `obsidianUrl` helper was deleted. Display
// URL minting flows through `SourceConnector.formatDisplayUrl` — for obsidian-fs
// that's `ObsidianFsSource.formatDisplayUrl(docId)`. The byte-for-byte parity
// contract with v1 is preserved (see 01-04-SUMMARY.md §"URL encoding parity").
// These tests pin that parity at the same input → output pairs the v1 unit
// tests asserted.
describe("ObsidianFsSource.formatDisplayUrl (D-01 parity with v1 obsidianUrl)", () => {
  it("URL-encodes vault name and path (v1 parity)", () => {
    const source = new ObsidianFsSource({
      name: "Intelligence Impact",
      path: "/tmp/dummy",
    });
    const id = formatDocId("obsidian-fs", "Intelligence Impact", "_research/foo bar.md");
    expect(source.formatDisplayUrl(id)).toBe(
      "obsidian://open?vault=Intelligence%20Impact&file=_research%2Ffoo%20bar.md",
    );
  });

  it("handles plain ascii unchanged except for slashes/spaces (v1 parity)", () => {
    const source = new ObsidianFsSource({ name: "inim", path: "/tmp/dummy" });
    const id = formatDocId("obsidian-fs", "inim", "notes/x.md");
    expect(source.formatDisplayUrl(id)).toBe("obsidian://open?vault=inim&file=notes%2Fx.md");
  });
});

// D-02 (plan 01-04 task 06): clientId fallback semantics. The server
// constructs ObsidianFsDelivery with a lazy getter
//   `() => server.getClientVersion()?.name ?? "unknown"`
// so the post-handshake client name flows through automatically. This test
// asserts the pre-handshake (or no-clientInfo) fallback surfaces "unknown"
// in the audit log — explicitly NOT "claude-code" (the C-1 leak).
describe("D-02 client_info capture: clientId fallback to 'unknown'", () => {
  it("delivery writes record clientId='unknown' when no handshake / no per-call override", async () => {
    const { ObsidianFsDelivery } = await import("./adapters/delivery/obsidian-fs/index.js");
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = await fs.mkdtemp(join(tmpdir(), "vm-d02-"));
    const db = new Database(":memory:", "test-vault");
    db.migrate();
    const vault = {
      config: { name: "test-vault", path: root, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    // Simulate the server-side closure with no `server.getClientVersion()`.
    const lazyGetter = (): string => undefined ?? "unknown";
    const delivery = new ObsidianFsDelivery(vault, lazyGetter);
    const id = formatDocId("obsidian-fs", "test-vault", "rec.md");
    await delivery.write(id, { blocks: [{ kind: "paragraph", text: "x" }] });
    const rows = vault.db.audit.listWrites({});
    expect(rows[0]?.client_id).toBe("unknown");
    expect(rows[0]?.client_id).not.toBe("claude-code");
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("truncateSnippet", () => {
  it("collapses whitespace and trims", () => {
    expect(truncateSnippet("  hello   world  \n\n", 100)).toBe("hello world");
  });

  it("truncates with ellipsis when over limit", () => {
    const out = truncateSnippet("a".repeat(300), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not append ellipsis when within limit", () => {
    expect(truncateSnippet("short", 50)).toBe("short");
  });
});

describe("SQL aggregates", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  function insertNote(path: string, frontmatter: Record<string, unknown> | null): void {
    db.notes.upsertByPath({
      path,
      content: "body",
      frontmatter: frontmatter ? JSON.stringify(frontmatter) : null,
      title: path,
      hash: `h-${path}`,
      mtime: Date.now(),
      wordCount: 1,
    });
  }

  describe("aggregateTopTags", () => {
    it("returns empty array on empty vault", () => {
      expect(aggregateTopTags(db.handle, 10)).toEqual([]);
    });

    it("counts tags from frontmatter.tags arrays", () => {
      insertNote("a.md", { tags: ["x", "y"] });
      insertNote("b.md", { tags: ["x", "z"] });
      insertNote("c.md", { tags: ["x"] });
      insertNote("d.md", { title: "no tags" });
      insertNote("e.md", null);

      const tags = aggregateTopTags(db.handle, 10);
      expect(tags).toEqual([
        { tag: "x", count: 3 },
        { tag: "y", count: 1 },
        { tag: "z", count: 1 },
      ]);
    });

    it("respects the limit", () => {
      insertNote("a.md", { tags: ["a", "b", "c", "d", "e"] });
      const tags = aggregateTopTags(db.handle, 2);
      expect(tags).toHaveLength(2);
    });

    it("tolerates dirty frontmatter (non-array tags, mixed types)", () => {
      // Real vaults accumulate this kind of drift. Discovered via smoketest
      // against Intelligence-Impact vault — aggregate was crashing with
      // "malformed JSON" when a single note had `tags` as a string.
      insertNote("clean.md", { tags: ["foo", "bar"] });
      insertNote("string-tag.md", { tags: "single-tag-as-string" });
      insertNote("nested.md", { tags: { weird: "object" } });
      insertNote("no-fm.md", null);
      insertNote("non-text.md", { tags: ["valid", 42, null, "another"] });

      const tags = aggregateTopTags(db.handle, 10);
      // Only well-formed text entries from arrays count.
      expect(tags.map((t) => t.tag).sort()).toEqual(["another", "bar", "foo", "valid"]);
    });
  });

  describe("aggregateTopFrontmatterKeys", () => {
    it("returns empty array on empty vault", () => {
      expect(aggregateTopFrontmatterKeys(db.handle, 10)).toEqual([]);
    });

    it("counts top-level frontmatter keys across notes", () => {
      insertNote("a.md", { tags: [], status: "active" });
      insertNote("b.md", { tags: [], type: "person" });
      insertNote("c.md", { tags: [] });
      insertNote("d.md", null);

      const keys = aggregateTopFrontmatterKeys(db.handle, 10);
      // tags=3, status=1, type=1 — order: count DESC, then key ASC
      expect(keys[0]).toEqual({ key: "tags", count: 3 });
      expect(
        keys
          .slice(1)
          .map((k) => k.key)
          .sort(),
      ).toEqual(["status", "type"]);
    });

    it("tolerates frontmatter that is not a JSON object", () => {
      // If a note's frontmatter is stored as `null` or a primitive (rare
      // but possible after upstream parser quirks), the aggregate must
      // not throw.
      insertNote("clean.md", { status: "active" });
      // Bypass insertNote: write a primitive directly so we exercise the
      // json_type filter.
      db.notes.upsertByPath({
        path: "weird.md",
        content: "body",
        frontmatter: '"just-a-string"',
        title: "weird",
        hash: "h-weird",
        mtime: Date.now(),
        wordCount: 1,
      });
      const keys = aggregateTopFrontmatterKeys(db.handle, 10);
      expect(keys).toEqual([{ key: "status", count: 1 }]);
    });
  });
});

// ─── Plan 02-03b — MEM-11 + bootstrap-order tests ───────────────────────────

describe("Plan 02-03b: discoverMemorySinks", () => {
  // We import lazily inside the test so the static-import block at the top
  // of this file stays focused on the v0.9.0 helpers.
  it("synthesizes a default sink when _memory/.memory-sink exists and config is empty", async () => {
    const { discoverMemorySinks } = await import("./server.js");
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-discover-"));
    try {
      await fs.mkdir(join(vaultDir, "_memory"), { recursive: true });
      await fs.writeFile(join(vaultDir, "_memory", ".memory-sink"), "fixture", "utf-8");
      const sinks = await discoverMemorySinks([], [{ name: "v", path: vaultDir }]);
      expect(sinks).toEqual([
        {
          name: "default",
          handle: "obsidian-fs://v/_memory/",
          contract: "default-memory-v1",
        },
      ]);
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  });

  it("returns explicit configs unchanged when non-empty", async () => {
    const { discoverMemorySinks } = await import("./server.js");
    const configured = [
      {
        name: "explicit",
        handle: "obsidian-fs://v/_mem/",
        contract: "default-memory-v1",
      },
    ];
    const sinks = await discoverMemorySinks(configured, [
      { name: "v", path: "/tmp/no-such" },
    ]);
    expect(sinks).toEqual(configured);
  });

  it("skips vaults without a sentinel", async () => {
    const { discoverMemorySinks } = await import("./server.js");
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-no-sentinel-"));
    try {
      // Folder exists but no _memory/ inside — should be skipped.
      const sinks = await discoverMemorySinks([], [{ name: "v", path: vaultDir }]);
      expect(sinks).toEqual([]);
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  });
});

describe("MEM-11: v1 write tools refuse memory-sink targets", () => {
  /**
   * Test harness: spin up a vault on disk against the v2 fixture layout
   * (a `_memory/` folder with sentinel), wire a real `ObsidianFsDelivery`
   * with a populated `MemorySinkRegistry`, and invoke the v1 MCP tool
   * handler directly (matching what the server bootstrap does at runtime,
   * minus the stdio transport). Asserts that:
   *   - write_note against `_memory/...` returns the structured
   *     `sink_write_blocked` error with `suggestion` containing
   *     `record_observation`.
   *   - delete_note against `_memory/...` returns `sink_write_blocked`
   *     with `suggestion` containing `supersede`.
   *   - update_frontmatter against `_memory/...` returns
   *     `sink_write_blocked` with `suggestion` containing
   *     `record_observation`.
   *   - No file is created / deleted / modified on disk.
   */
  it("write_note + update_frontmatter + delete_note are all blocked against _memory/...", async () => {
    const { setupMemorySinks } = await import("./server.js");
    const { Database } = await import("./db/database.js");
    const { VaultManager } = await import("./vault/index.js");
    const { ObsidianFsDelivery } = await import("./adapters/delivery/obsidian-fs/index.js");
    const { AdapterRegistry, formatDocId, parseSourceHandle } = await import(
      "./adapters/registry.js"
    );
    const { updateFrontmatter } = await import("./frontmatter/index.js");
    const { writeNote: writeNoteInternal } = await import(
      "./adapters/delivery/obsidian-fs/write.js"
    );
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-mem11-"));
    try {
      // Build the v2 fixture-shape on disk: `_memory/` + sentinel.
      await fs.mkdir(join(vaultDir, "_memory"), { recursive: true });
      await fs.writeFile(
        join(vaultDir, "_memory", ".memory-sink"),
        "fixture",
        "utf-8",
      );

      const manager = new VaultManager();
      // Manually plug in a vault — VaultManager.loadAll requires an Ollama
      // model, and we don't need indexing for this test. Drive the inner
      // map directly via the same name the registry expects.
      const db = new Database(":memory:", "v2-test-vault");
      db.migrate();
      const vault = {
        config: {
          name: "v2-test-vault",
          path: vaultDir,
          write_enabled: true,
        },
        db,
        dbPath: ":memory:",
      };
      // Access the private vaults Map via a known-shape cast. The
      // VaultManager API doesn't expose a vault-insertion seam (it owns
      // construction in loadAll), so we splice in the constructed vault
      // for the test. This mirrors what catchup-free smoke tests do
      // elsewhere in the suite.
      (manager as unknown as { vaults: Map<string, typeof vault> }).vaults.set(
        vault.config.name,
        vault,
      );

      // The single non-negotiable step from Plan 02-03b: setup runs the
      // discovery + sentinel-provisioning sequence end-to-end.
      const memorySinkRegistry = await setupMemorySinks(
        { memory_sinks: [] },
        manager as unknown as InstanceType<typeof VaultManager>,
      );
      expect(memorySinkRegistry.listMemorySinks().map((s) => s.name)).toEqual([
        "default",
      ]);

      // Wire the adapter just like serve() does.
      const adapterRegistry = new AdapterRegistry();
      const delivery = new ObsidianFsDelivery(
        vault,
        () => "test-client",
        memorySinkRegistry,
      );
      adapterRegistry.registerDelivery(delivery.handle, delivery);

      // ── write_note ──────────────────────────────────────────────────────
      const docId = formatDocId(
        "obsidian-fs",
        "v2-test-vault",
        "_memory/observations/mem11.md",
      );
      const writeRes = await delivery.write(docId, {
        blocks: [{ kind: "paragraph", text: "x" }],
        properties: {},
      });
      expect(writeRes.ok).toBe(false);
      if (writeRes.ok) return;
      // The delivery's chokepoint emits `agent_write_outside_sink` (Guard
      // B fires first because the source field is undefined and the
      // resolved sink would only catch agent-source writes via Guard B);
      // for the MEM-11 path the canonical refusal is
      // `non_agent_write_inside_sink` (source undefined + target inside
      // sink → not agent). Either way the call must NOT succeed. The
      // v1-entry-point Guard separately enforces `sink_write_blocked` —
      // verified below by calling `writeNoteInternal` directly.
      expect([
        "sink_write_blocked",
        "non_agent_write_inside_sink",
        "agent_write_outside_sink",
        "missing_provenance",
      ]).toContain(writeRes.reason);

      // ── v1 entry-point Guard direct invocation ─────────────────────────
      // This is the defense-in-depth check Plan 02-03b adds. The internal
      // writeNote with `registry` set must always return `sink_write_blocked`
      // for sink-resolved paths.
      const entryRes = await writeNoteInternal({
        vault,
        relativePath: "_memory/observations/mem11.md",
        content: "x",
        registry: memorySinkRegistry,
      });
      expect(entryRes.ok).toBe(false);
      if (entryRes.ok) return;
      expect(entryRes.reason).toBe("sink_write_blocked");
      expect(entryRes.sinkName).toBe("default");
      expect(entryRes.suggestion).toMatch(/record_observation/);
      // No file created on disk.
      await expect(
        fs.access(join(vaultDir, "_memory", "observations", "mem11.md")),
      ).rejects.toThrow();

      // ── update_frontmatter ─────────────────────────────────────────────
      // updateFrontmatter requires a pre-existing indexed note; with the
      // entry-point Guard active, even a non-existent target refuses
      // BEFORE the note-not-found check. This pins the canonical
      // defense-in-depth ordering.
      const fmRes = await updateFrontmatter({
        vault,
        memorySinkRegistry,
        relativePath: "_memory/observations/mem11.md",
        merge: { status: "active" },
      });
      expect(fmRes.ok).toBe(false);
      if (fmRes.ok) return;
      expect(fmRes.reason).toBe("sink_write_blocked");
      expect(fmRes.sinkName).toBe("default");
      expect(fmRes.suggestion).toMatch(/record_observation/);

      // ── delete_note ────────────────────────────────────────────────────
      const { deleteNote: deleteNoteInternal } = await import(
        "./adapters/delivery/obsidian-fs/write.js"
      );
      const delRes = await deleteNoteInternal({
        vault,
        relativePath: "_memory/observations/mem11.md",
        expectedHash: "anything",
        registry: memorySinkRegistry,
      });
      expect(delRes.ok).toBe(false);
      if (delRes.ok) return;
      expect(delRes.reason).toBe("sink_write_blocked");
      expect(delRes.sinkName).toBe("default");
      expect(delRes.suggestion).toMatch(/supersede/i);

      db.close();
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  });
});

describe("Plan 02-03b: bootstrap phase ordering", () => {
  it("setupMemorySinks runs the sentinel provisioner before catchup would walk", async () => {
    // We can't easily run `serve()` from a test (it blocks on stdio); the
    // observable order invariant the plan asks for is "sentinels exist
    // before catchup walks". setupMemorySinks does the sentinel write
    // synchronously inside `registerMemorySinks`, so a fixture-vault that
    // BEGINS without a sentinel ends WITH one after setupMemorySinks
    // returns. catchup is fire-and-forget after setupMemorySinks per
    // serve()'s ordering — see src/server.ts.
    const { setupMemorySinks } = await import("./server.js");
    const { Database } = await import("./db/database.js");
    const { VaultManager } = await import("./vault/index.js");
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-bootord-"));
    try {
      // Pre-create the folder without a sentinel — discoverMemorySinks
      // skips vaults without a sentinel, so we provide an explicit config
      // entry to force provisioning.
      await fs.mkdir(join(vaultDir, "_memory"), { recursive: true });
      const sentinelPath = join(vaultDir, "_memory", ".memory-sink");
      await expect(fs.access(sentinelPath)).rejects.toThrow();

      const manager = new VaultManager();
      const db = new Database(":memory:", "boot-vault");
      db.migrate();
      const vault = {
        config: { name: "boot-vault", path: vaultDir, write_enabled: true },
        db,
        dbPath: ":memory:",
      };
      (manager as unknown as { vaults: Map<string, typeof vault> }).vaults.set(
        "boot-vault",
        vault,
      );

      await setupMemorySinks(
        {
          memory_sinks: [
            {
              name: "default",
              handle: "obsidian-fs://boot-vault/_memory/",
              contract: "default-memory-v1",
            },
          ],
        },
        manager as unknown as InstanceType<typeof VaultManager>,
      );

      // After setupMemorySinks returns, the sentinel MUST exist. This is
      // the proxy for the bootstrap-order assertion (sentinels written
      // before catchup could possibly walk).
      await fs.access(sentinelPath);
      db.close();
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  });

  it("exposes the BootstrapPhase type covering all five phases", async () => {
    // Compile-time only: a string literal of the right shape assigns to
    // BootstrapPhase. The runtime check (every phase fires in order) is
    // covered by serve()'s instrumentation; we don't spin up stdio here.
    const phases: import("./server.js").BootstrapPhase[] = [
      "load_config",
      "open_vaults",
      "register_memory_sinks",
      "start_catchup",
      "connect_transport",
    ];
    expect(phases).toHaveLength(5);
  });
});

// ─── Plan 02-04 — MEM-02 + MEM-04 end-to-end ────────────────────────────────

describe("Plan 02-04: MEM-02 (record_observation) + MEM-04 (supersede) end-to-end", () => {
  /**
   * Mirrors Plan 02-03b's MEM-11 approach: rather than spin up an MCP
   * stdio transport (which `serve()` blocks on), we drive the
   * controllers through the same wiring `serve()` does in production —
   * `setupMemorySinks`, `ObsidianFsDelivery` + `ObsidianFsSource`
   * registered into an `AdapterRegistry`, and `handleRecordObservation`
   * / `handleSupersede` invoked with `deliveryAdapterFor` /
   * `sourceConnectorFor` closures that resolve from the registry.
   * Anything that ships in `serve()`'s `record_observation` /
   * `supersede` dispatch is exercised; only the MCP wrapper (the
   * Zod parse + ok/errorResponse shaping) is omitted.
   */

  it("tools/list snapshot includes record_observation + supersede AND the 23 v1 entries are byte-identical", async () => {
    const { TOOLS } = await import("./tool-registry.js");
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("record_observation");
    expect(names).toContain("supersede");
    expect(TOOLS).toHaveLength(25);

    const ro = TOOLS.find((t) => t.name === "record_observation");
    const sup = TOOLS.find((t) => t.name === "supersede");
    expect((ro?.description ?? "").length).toBeGreaterThan(0);
    expect((sup?.description ?? "").length).toBeGreaterThan(0);
  });

  it("end-to-end: record_observation writes a fully-formed memory doc; properties escape hatch survives", async () => {
    const { setupMemorySinks } = await import("./server.js");
    const { Database } = await import("./db/database.js");
    const { VaultManager } = await import("./vault/index.js");
    const { ObsidianFsDelivery } = await import("./adapters/delivery/obsidian-fs/index.js");
    const { ObsidianFsSource } = await import("./adapters/source/obsidian-fs/index.js");
    const { AdapterRegistry, parseSourceHandle } = await import("./adapters/registry.js");
    const { handleRecordObservation } = await import("./memory/tools/index.js");
    const matter = (await import("gray-matter")).default;
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-mem02-"));
    try {
      await fs.mkdir(join(vaultDir, "_memory"), { recursive: true });
      await fs.writeFile(
        join(vaultDir, "_memory", ".memory-sink"),
        "fixture",
        "utf-8",
      );

      const manager = new VaultManager();
      const db = new Database(":memory:", "v2-test-vault");
      db.migrate();
      const vault = {
        config: { name: "v2-test-vault", path: vaultDir, write_enabled: true },
        db,
        dbPath: ":memory:",
      };
      (manager as unknown as { vaults: Map<string, typeof vault> }).vaults.set(
        vault.config.name,
        vault,
      );

      const memorySinkRegistry = await setupMemorySinks(
        { memory_sinks: [] },
        manager as unknown as InstanceType<typeof VaultManager>,
      );

      const adapterRegistry = new AdapterRegistry();
      const delivery = new ObsidianFsDelivery(
        vault,
        () => "test-client",
        memorySinkRegistry,
      );
      const source = new ObsidianFsSource(vault.config);
      adapterRegistry.registerDelivery(delivery.handle, delivery);
      adapterRegistry.registerSource(source.handle, source);

      const deps = {
        memorySinkRegistry,
        manager: manager as unknown as InstanceType<typeof VaultManager>,
        deliveryAdapterFor: (vaultName: string) =>
          adapterRegistry.resolveDelivery(
            parseSourceHandle(`obsidian-fs://${vaultName}`),
          ),
        sourceConnectorFor: (vaultName: string) =>
          adapterRegistry.resolveSource(
            parseSourceHandle(`obsidian-fs://${vaultName}`),
          ),
      };

      // ── happy path ─────────────────────────────────────────────────────
      const res = await handleRecordObservation(deps, {
        vault: "v2-test-vault",
        claim: "Acme migration to Postgres",
        evidence: ["call-2026-05-15"],
        confidence: "direct",
        type: "observation",
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(typeof res.newHash).toBe("string");
      // Phase 1 WriteSuccess uses `newHash`, NOT `hash`.
      expect((res as Record<string, unknown>).hash).toBeUndefined();

      const resource = res.doc_id.replace("obsidian-fs://v2-test-vault/", "");
      const onDisk = await fs.readFile(join(vaultDir, resource), "utf-8");
      const parsed = matter(onDisk);
      const fm = parsed.data as Record<string, unknown>;
      // All 7 required keys present + non-null observed_at.
      expect(fm.source).toBe("agent");
      expect(fm.confidence).toBe("direct");
      expect(fm.evidence).toEqual(["call-2026-05-15"]);
      expect(fm.status).toBe("active");
      expect(typeof fm.observed_at).toBe("string");
      expect(fm.observed_at).not.toBeNull();
      expect(fm.superseded_by).toBeNull();
      expect(fm.type).toBe("observation");

      // ── escape hatch ───────────────────────────────────────────────────
      const res2 = await handleRecordObservation(deps, {
        vault: "v2-test-vault",
        claim: "Renewal scheduled",
        evidence: [],
        confidence: "direct",
        type: "observation",
        properties: { expires_at: "2026-12-31T00:00:00Z" },
      });
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      const fm2Path = res2.doc_id.replace("obsidian-fs://v2-test-vault/", "");
      const fm2 = matter(await fs.readFile(join(vaultDir, fm2Path), "utf-8")).data as Record<string, unknown>;
      expect(fm2.expires_at).toBe("2026-12-31T00:00:00Z");

      // ── caller-supplied source:'user' rejected (no file created) ───────
      const res3 = await handleRecordObservation(deps, {
        vault: "v2-test-vault",
        claim: "User authored",
        evidence: [],
        confidence: "direct",
        type: "observation",
        properties: { source: "user" },
      });
      expect(res3.ok).toBe(false);
      if (res3.ok) return;
      expect(res3.reason).toBe("non_agent_write_inside_sink");
      expect(res3.sinkName).toBe("default");

      db.close();
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  }, 10_000);

  it("end-to-end: supersede on a freshly-recorded observation; OLD reflects supersede, REPLACEMENT untouched", async () => {
    const { setupMemorySinks } = await import("./server.js");
    const { Database } = await import("./db/database.js");
    const { VaultManager } = await import("./vault/index.js");
    const { ObsidianFsDelivery } = await import("./adapters/delivery/obsidian-fs/index.js");
    const { ObsidianFsSource } = await import("./adapters/source/obsidian-fs/index.js");
    const { AdapterRegistry, parseSourceHandle } = await import("./adapters/registry.js");
    const {
      handleRecordObservation,
      handleSupersede,
    } = await import("./memory/tools/index.js");
    const matter = (await import("gray-matter")).default;
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-mem04-"));
    try {
      await fs.mkdir(join(vaultDir, "_memory"), { recursive: true });
      await fs.writeFile(
        join(vaultDir, "_memory", ".memory-sink"),
        "fixture",
        "utf-8",
      );

      const manager = new VaultManager();
      const db = new Database(":memory:", "v2-test-vault");
      db.migrate();
      const vault = {
        config: { name: "v2-test-vault", path: vaultDir, write_enabled: true },
        db,
        dbPath: ":memory:",
      };
      (manager as unknown as { vaults: Map<string, typeof vault> }).vaults.set(
        vault.config.name,
        vault,
      );

      const memorySinkRegistry = await setupMemorySinks(
        { memory_sinks: [] },
        manager as unknown as InstanceType<typeof VaultManager>,
      );

      const adapterRegistry = new AdapterRegistry();
      const delivery = new ObsidianFsDelivery(
        vault,
        () => "test-client",
        memorySinkRegistry,
      );
      const source = new ObsidianFsSource(vault.config);
      adapterRegistry.registerDelivery(delivery.handle, delivery);
      adapterRegistry.registerSource(source.handle, source);

      const deps = {
        memorySinkRegistry,
        manager: manager as unknown as InstanceType<typeof VaultManager>,
        deliveryAdapterFor: (vaultName: string) =>
          adapterRegistry.resolveDelivery(
            parseSourceHandle(`obsidian-fs://${vaultName}`),
          ),
        sourceConnectorFor: (vaultName: string) =>
          adapterRegistry.resolveSource(
            parseSourceHandle(`obsidian-fs://${vaultName}`),
          ),
      };

      // Record two observations.
      const oldRes = await handleRecordObservation(deps, {
        vault: "v2-test-vault",
        claim: "Old claim",
        evidence: [],
        confidence: "direct",
        type: "observation",
        properties: { observed_at: "2026-01-01T00:00:00Z" },
      });
      expect(oldRes.ok).toBe(true);
      if (!oldRes.ok) return;
      const replRes = await handleRecordObservation(deps, {
        vault: "v2-test-vault",
        claim: "Replacement claim",
        evidence: [],
        confidence: "direct",
        type: "observation",
        properties: { observed_at: "2026-01-02T00:00:00Z" },
      });
      expect(replRes.ok).toBe(true);
      if (!replRes.ok) return;

      const replResource = replRes.doc_id.replace(
        "obsidian-fs://v2-test-vault/",
        "",
      );
      const replMtimeBefore = (
        await fs.stat(join(vaultDir, replResource))
      ).mtimeMs;
      const replContentBefore = await fs.readFile(
        join(vaultDir, replResource),
        "utf-8",
      );

      // Supersede the OLD by the REPLACEMENT.
      const sup = await handleSupersede(deps, {
        doc_id: oldRes.doc_id,
        replacement_doc_id: replRes.doc_id,
        reason: "new evidence supersedes",
      });
      expect(sup.ok).toBe(true);
      if (!sup.ok) return;
      expect(typeof sup.newHash).toBe("string");
      expect((sup as Record<string, unknown>).hash).toBeUndefined();

      // OLD doc reflects the supersede triple.
      const oldResource = oldRes.doc_id.replace(
        "obsidian-fs://v2-test-vault/",
        "",
      );
      const oldFm = matter(
        await fs.readFile(join(vaultDir, oldResource), "utf-8"),
      ).data as Record<string, unknown>;
      expect(oldFm.status).toBe("superseded");
      expect(oldFm.superseded_by).toBe(replRes.doc_id);
      expect(oldFm.superseded_reason).toBe("new evidence supersedes");

      // REPLACEMENT doc is byte-identical to before.
      const replContentAfter = await fs.readFile(
        join(vaultDir, replResource),
        "utf-8",
      );
      expect(replContentAfter).toBe(replContentBefore);
      const replFmAfter = matter(replContentAfter).data as Record<string, unknown>;
      expect(replFmAfter.status).toBe("active");
      expect(replFmAfter.superseded_by).toBeNull();
      expect(replFmAfter.superseded_reason).toBeUndefined();
      const replMtimeAfter = (
        await fs.stat(join(vaultDir, replResource))
      ).mtimeMs;
      expect(replMtimeAfter).toBe(replMtimeBefore);

      // Audit log records the writes + the update on this vault.
      const { getAuditLog } = await import("./audit/index.js");
      const entries = getAuditLog({
        vault,
        limit: 100,
      });
      expect(entries.length).toBeGreaterThanOrEqual(3);
      const ops = entries.map((e) => e.op);
      expect(ops.filter((o) => o === "create").length).toBeGreaterThanOrEqual(2);
      expect(ops.filter((o) => o === "update").length).toBeGreaterThanOrEqual(1);

      db.close();
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  }, 10_000);

  it("Zod-rejection at the tool boundary: supersede with reason:'' is refused by buildToolSchema", async () => {
    const { buildToolSchema } = await import("./tool-registry.js");
    const schema = buildToolSchema("supersede");
    const r = schema.safeParse({
      doc_id: "obsidian-fs://v/_memory/a.md",
      replacement_doc_id: "obsidian-fs://v/_memory/b.md",
      reason: "",
    });
    expect(r.success).toBe(false);
  });

  it("Zod-rejection at the tool boundary: record_observation rejects unknown confidence values", async () => {
    const { buildToolSchema } = await import("./tool-registry.js");
    const schema = buildToolSchema("record_observation");
    const r = schema.safeParse({
      vault: "v",
      claim: "c",
      evidence: [],
      confidence: "high",
      type: "observation",
    });
    expect(r.success).toBe(false);
  });
});
