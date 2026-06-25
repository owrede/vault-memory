/**
 * Phase 5 / BRF-03 — `handleCompileBrief` tests.
 *
 * Strategy: stand up a real `Database` + `MemorySinkRegistry` and
 * `StubDelivery`+`StubSource` (sharing a Map) against an `mkdtemp`'d
 * vault directory. The McpServer + OllamaClient are stubbed via
 * `vi.fn()` — the ladder + tier dispatch are unit-tested in
 * `llm-ladder.test.ts`, so here we just need a tier-2 ollama mock and
 * an empty MCP capability object so the ladder falls to tier 2 / 3.
 *
 * Test 13 (YAML round-trip — RESEARCH A3 / Pitfall 4 mitigation) uses
 * the REAL `ObsidianFsDelivery` + `ObsidianFsSource` so we can prove
 * `source_hashes` keys (which contain `#chunk-` substrings) survive
 * the gray-matter / js-yaml frontmatter writer/reader byte-for-byte.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import matter from "gray-matter";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Database } from "../db/index.js";
import { VaultManager } from "../vault/index.js";
import type { Vault } from "../vault/index.js";
import { ObsidianFsDelivery } from "../adapters/delivery/obsidian-fs/index.js";
import { ObsidianFsSource } from "../adapters/source/obsidian-fs/index.js";
import { StubDelivery } from "../adapters/stub/delivery.js";
import { StubSource } from "../adapters/stub/source.js";
import { provisionSink } from "../adapters/delivery/obsidian-fs/sentinel.js";
import { MemorySinkRegistry, parseMemorySinkHandle } from "../memory/index.js";
import { computeChunkIdFragment } from "../chunker/chunk-id.js";
import type { BriefConfig, ChunkId, Document, DocId, MemorySink } from "../types.js";
import { parseDocId } from "../adapters/registry.js";
import { handleCompileBrief, type CompileBriefDeps } from "./compile.js";

const VAULT_NAME = "test-vault";
const BRIEF_SINK_REL_PATH = "_memory/_briefs/";

// ── Helpers ─────────────────────────────────────────────────────────

function stubServer(
  opts: {
    sampling?: boolean;
    createMessage?: (params: unknown) => Promise<unknown>;
  } = {},
): McpServer {
  return {
    server: {
      getClientCapabilities: () => (opts.sampling ? { sampling: {} } : undefined),
      createMessage:
        opts.createMessage ??
        (async () => ({
          content: { type: "text", text: "stub body" },
          model: "stub-model",
          role: "assistant",
        })),
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

async function buildStubFixture() {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-compile-brief-"));
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

  // Shared-Map StubDelivery + StubSource so the find-by-target lookup
  // sees what compile_brief writes.
  const docs = new Map<DocId, Document>();
  const delivery = new StubDelivery(docs, registry);
  const source = new StubSource(docs);

  return {
    vault,
    vaultDir,
    manager,
    registry,
    docs,
    delivery,
    source,
    cleanup: async () => {
      db.close();
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

async function buildObsidianFixture() {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-compile-brief-fs-"));
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

  const delivery = new ObsidianFsDelivery(vault, "test-client", registry);
  const source = new ObsidianFsSource(vault.config);

  return {
    vault,
    vaultDir,
    manager,
    registry,
    delivery,
    source,
    cleanup: async () => {
      db.close();
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

/**
 * Seed the notes + chunks tables for source DocIds so `buildSourceHashes`
 * and `brief_sources.insertBatch` have something to map. Returns the
 * resolved DocId strings.
 */
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

// ── Test suite ──────────────────────────────────────────────────────

describe("handleCompileBrief — BRF-03 controller (stub adapters)", () => {
  let fixture: Awaited<ReturnType<typeof buildStubFixture>>;

  beforeEach(async () => {
    fixture = await buildStubFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function deps(
    opts: {
      sampling?: boolean;
      createMessage?: (p: unknown) => Promise<unknown>;
      ollamaReply?: string;
      briefConfig?: BriefConfig;
    } = {},
  ): CompileBriefDeps {
    return {
      memorySinkRegistry: fixture.registry,
      manager: fixture.manager,
      deliveryAdapterFor: () => fixture.delivery,
      sourceConnectorFor: () => fixture.source,
      server: stubServer(opts),
      ollama: stubOllama(opts.ollamaReply ?? "Brief body. [[Atlas-1]]") as never,
      briefConfig: opts.briefConfig,
    };
  }

  it("Test 1: happy path returns {ok, doc_id} on first compile (no supersede)", async () => {
    const [d1, d2] = seedSourceDocs(fixture.vault, [
      { path: "projects/atlas-1.md", title: "Atlas-1", text: "Atlas-1 is the flagship." },
      { path: "projects/atlas-2.md", title: "Atlas-2", text: "Atlas-2 follows Atlas-1." },
    ]);
    const res = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "llama3.2" } } }), {
      vault: VAULT_NAME,
      target: "atlas-q3",
      source_doc_ids: [d1!, d2!],
      purpose: "Q3 Atlas snapshot",
      max_tokens: 500,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc_id).toMatch(
      /^obsidian-fs:\/\/test-vault\/_memory\/_briefs\/atlas-q3--\d{8}T\d{4}\.md$/,
    );
    expect(res.supersededPrior).toBeUndefined();
  });

  it("Test 2: D-12 auto-supersede chain on existing target", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/atlas-1.md", title: "Atlas-1", text: "Atlas-1 doc." },
    ]);
    const firstNow = new Date("2026-05-18T10:00:00Z");
    const secondNow = new Date("2026-05-18T11:00:00Z");
    const first = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "atlas-q3",
      source_doc_ids: [d1!],
      purpose: "v1",
      _now: firstNow,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "atlas-q3",
      source_doc_ids: [d1!],
      purpose: "v2",
      _now: secondNow,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.supersededPrior).toBe(first.doc_id);

    // Old brief now has status: superseded, superseded_by, reason.
    const oldDoc = fixture.docs.get(first.doc_id as DocId);
    expect(oldDoc).toBeDefined();
    expect(oldDoc?.properties.status).toBe("superseded");
    expect(oldDoc?.properties.superseded_by).toBe(second.doc_id);
    expect(oldDoc?.properties.superseded_reason).toBe("recompiled");
  });

  it("Test 3: brief path is _memory/_briefs/{target}--YYYYMMDDTHHmm.md", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/p.md", title: "P", text: "P doc." },
    ]);
    const res = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "my-target",
      source_doc_ids: [d1!],
      purpose: "explore",
      _now: new Date("2026-05-18T14:30:42Z"),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc_id).toBe("obsidian-fs://test-vault/_memory/_briefs/my-target--20260518T1430.md");
  });

  it("Test 4: dedupes source_doc_ids (D-03 planner-lean)", async () => {
    const [d1, d2] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "A" },
      { path: "projects/b.md", title: "B", text: "B" },
    ]);
    const res = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "dedup",
      source_doc_ids: [d1!, d1!, d2!, d1!],
      purpose: "dedupe me",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const written = fixture.docs.get(res.doc_id as DocId);
    expect((written?.properties.compiled_from as string[]).length).toBe(2);
  });

  it("Test 5: returns too_many_sources when source_doc_ids exceeds 50", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `obsidian-fs://${VAULT_NAME}/notes/x${i}.md`);
    const res = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "huge",
      source_doc_ids: ids,
      purpose: "too many",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("too_many_sources");
    if (res.reason === "too_many_sources") expect(res.limit).toBe(50);
  });

  it("Test 6: cross-vault gate rejects source_doc_ids from a different vault", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [{ path: "projects/p.md", title: "P", text: "P" }]);
    const foreign = "obsidian-fs://other-vault/p.md";
    const res = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "cross",
      source_doc_ids: [d1!, foreign],
      purpose: "wrong vault",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("cross_vault_sources");
    if (res.reason === "cross_vault_sources") {
      expect(res.offending).toEqual([foreign]);
    }
  });

  it("Test 7: no_llm_strategy_available when sampling + ollama + prepared_text all absent", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [{ path: "projects/p.md", title: "P", text: "P" }]);
    const res = await handleCompileBrief(deps({}), {
      vault: VAULT_NAME,
      target: "no-llm",
      source_doc_ids: [d1!],
      purpose: "no llm",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no_llm_strategy_available");
    if (res.reason === "no_llm_strategy_available") {
      expect(res.attempted).toEqual(["sampling", "ollama", "prepared_text"]);
      expect(res.hint).toMatch(/prepared_text|sampling|brief\.ollama/);
    }
  });

  it("Test 8: brief_sources reverse-index populated with one row per chunk", async () => {
    const [d1, d2] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "Alpha doc." },
      { path: "projects/b.md", title: "B", text: "Beta doc." },
    ]);
    const res = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "rev-index",
      source_doc_ids: [d1!, d2!],
      purpose: "verify reverse-index",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = fixture.vault.db.briefSources.listBriefDocIds();
    expect(ids).toContain(res.doc_id);
    const rows = fixture.vault.db.briefSources.sourcesForBrief(res.doc_id);
    expect(rows.length).toBe(2); // one chunk per source (seeded with 1 chunk each)
    const docIds = rows.map((r) => r.chunkDocId).sort();
    expect(docIds).toEqual([d1!, d2!].sort());
  });

  it("Test 9: body validator appends Sources footer when LLM omits wikilinks", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "Atlas-Special", text: "doc text" },
    ]);
    const res = await handleCompileBrief(
      deps({
        briefConfig: { ollama: { model: "x" } },
        ollamaReply: "Brief with no wikilinks at all.",
      }),
      {
        vault: VAULT_NAME,
        target: "no-links",
        source_doc_ids: [d1!],
        purpose: "verify footer",
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = fixture.docs.get(res.doc_id as DocId);
    const text = (doc?.blocks?.[0] as { kind: string; text: string }).text;
    expect(text).toContain("Brief with no wikilinks at all.");
    expect(text).toContain("## Sources");
    expect(text).toContain("- [[Atlas-Special]]");
  });

  it("Test 10: property bag carries the default-brief-v1 contract keys", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [{ path: "projects/p.md", title: "P", text: "P" }]);
    const res = await handleCompileBrief(deps({ briefConfig: { ollama: { model: "x" } } }), {
      vault: VAULT_NAME,
      target: "bag",
      source_doc_ids: [d1!],
      purpose: "verify property bag",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const props = fixture.docs.get(res.doc_id as DocId)?.properties as Record<string, unknown>;
    expect(props.source).toBe("agent");
    expect(props.confidence).toBe("inferred");
    expect(props.status).toBe("active");
    expect(props.superseded_by).toBeNull();
    expect(props.type).toBe("brief");
    expect(props.target).toBe("bag");
    expect(props.purpose).toBe("verify property bag");
    expect(props.compiled_from).toEqual([d1]);
    expect(typeof props.observed_at).toBe("string");
    expect(typeof props.compiled_at).toBe("string");
    expect(props.source_hashes).toBeDefined();
    const keys = Object.keys(props.source_hashes as Record<string, string>);
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/#chunk-[0-9a-f]{7}$/);
  });

  it("Test 12: sampling_refused when MCP createMessage throws", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [{ path: "projects/p.md", title: "P", text: "P" }]);
    const res = await handleCompileBrief(
      deps({
        sampling: true,
        createMessage: async () => {
          throw new Error("client refused sampling");
        },
      }),
      {
        vault: VAULT_NAME,
        target: "refused",
        source_doc_ids: [d1!],
        purpose: "verify refusal path",
      },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("sampling_refused");
  });

  it("prepared_text tier writes caller body verbatim and stamps model='prepared_text'", async () => {
    const [d1] = seedSourceDocs(fixture.vault, [
      { path: "projects/p.md", title: "Pdoc", text: "P" },
    ]);
    const res = await handleCompileBrief(deps({}), {
      vault: VAULT_NAME,
      target: "stitched",
      source_doc_ids: [d1!],
      purpose: "stitched body",
      prepared_text: "Caller-provided body with [[Pdoc]] inside.",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = fixture.docs.get(res.doc_id as DocId);
    const text = (doc?.blocks?.[0] as { kind: string; text: string }).text;
    expect(text).toContain("Caller-provided body with [[Pdoc]] inside.");
    expect((doc?.properties as Record<string, unknown>).model).toBe("prepared_text");
  });
});

// ── Test 13: YAML round-trip against the real obsidian-fs adapter ──

describe("handleCompileBrief — YAML round-trip (Pitfall 4 / RESEARCH A3)", () => {
  let fixture: Awaited<ReturnType<typeof buildObsidianFixture>>;

  beforeEach(async () => {
    fixture = await buildObsidianFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function obsidianDeps(): CompileBriefDeps {
    return {
      memorySinkRegistry: fixture.registry,
      manager: fixture.manager,
      deliveryAdapterFor: () => fixture.delivery,
      sourceConnectorFor: () => fixture.source,
      server: stubServer(),
      ollama: stubOllama("Round-trip body. [[A]] [[B]]") as never,
      briefConfig: { ollama: { model: "llama3.2" } },
    };
  }

  it("Test 13: source_hashes keys (containing #chunk-) survive gray-matter/js-yaml round-trip byte-for-byte", async () => {
    const [d1, d2] = seedSourceDocs(fixture.vault, [
      { path: "projects/a.md", title: "A", text: "Alpha content here." },
      { path: "projects/b.md", title: "B", text: "Beta content here." },
    ]);

    const res = await handleCompileBrief(obsidianDeps(), {
      vault: VAULT_NAME,
      target: "round-trip",
      source_doc_ids: [d1!, d2!],
      purpose: "round-trip check",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 1. Read the file via SourceConnector — the canonical path.
    const reread = await fixture.source.readDocument(parseDocId(res.doc_id));
    const rereadSourceHashes = reread.properties.source_hashes as Record<string, string>;
    expect(rereadSourceHashes).toBeDefined();
    const keys = Object.keys(rereadSourceHashes).sort();
    expect(keys.length).toBe(2);
    for (const k of keys) {
      expect(k).toMatch(/^obsidian-fs:\/\/[^/]+\/.+#chunk-[0-9a-f]{7}$/);
      expect(rereadSourceHashes[k]).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    // 2. Compare against the on-disk YAML byte-for-byte (the parsed
    // map values must equal the structured ones).
    const resource = res.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const onDisk = await fs.readFile(join(fixture.vaultDir, resource), "utf-8");
    const parsed = matter(onDisk);
    const fmHashes = parsed.data.source_hashes as Record<string, string>;
    const fmKeys = Object.keys(fmHashes).sort();
    expect(fmKeys).toEqual(keys);
    for (const k of fmKeys) {
      expect(fmHashes[k]).toBe(rereadSourceHashes[k]);
    }
  });

  it("Test 13b: ChunkId fragments survive — keys' 7-hex suffix is intact post-roundtrip", async () => {
    const text = "## Heading\n\nContent body.\n";
    const [d1] = seedSourceDocs(fixture.vault, [{ path: "notes/x.md", title: "X", text }]);
    const expectedFragment = computeChunkIdFragment(text);
    const expectedKey =
      `obsidian-fs://${VAULT_NAME}/notes/x.md#chunk-${expectedFragment}` as ChunkId;

    const res = await handleCompileBrief(obsidianDeps(), {
      vault: VAULT_NAME,
      target: "fragment-check",
      source_doc_ids: [d1!],
      purpose: "fragment integrity",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const reread = await fixture.source.readDocument(parseDocId(res.doc_id));
    const hashes = reread.properties.source_hashes as Record<string, string>;
    expect(Object.keys(hashes)).toEqual([expectedKey]);
  });
});
