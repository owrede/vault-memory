/**
 * Phase 5 / BRF-09 — `list_briefs` MCP Resource tests.
 *
 * Stand-up mirrors `get.test.ts`: real `Database` +
 * `MemorySinkRegistry` + `StubDelivery`/`StubSource` (shared Map).
 * Briefs are produced by `handleCompileBrief` so the
 * `brief_sources` reverse-index gets populated end-to-end.
 *
 * Adapter-seam discipline check: the test asserts that
 * `src/brief/resources.ts` imports no fs / path / gray-matter / chokidar
 * (in addition to `scripts/lint-adapters.sh` enforcement).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Database } from "../db/index.js";
import { VaultManager } from "../vault/index.js";
import type { Vault } from "../vault/index.js";
import { StubDelivery } from "../adapters/stub/delivery.js";
import { StubSource } from "../adapters/stub/source.js";
import { provisionSink } from "../adapters/delivery/obsidian-fs/sentinel.js";
import {
  MemorySinkRegistry,
  parseMemorySinkHandle,
} from "../memory/index.js";
import { computeChunkIdFragment } from "../chunker/chunk-id.js";
import type { Document, DocId, MemorySink } from "../types.js";
import { parseDocId } from "../adapters/registry.js";
import type { CompileBriefDeps } from "./compile.js";
import { handleCompileBrief } from "./compile.js";
import { readListBriefs, type ListBriefsDeps } from "./resources.js";

const VAULT_NAME = "test-vault";
const BRIEF_SINK_REL_PATH = "_memory/_briefs/";

function stubServer(): McpServer {
  return {
    server: {
      getClientCapabilities: () => undefined,
      createMessage: async () => ({
        content: { type: "text", text: "stub" },
        model: "stub",
        role: "assistant",
      }),
    },
  } as unknown as McpServer;
}

function stubOllama(reply = "Body [[Atlas-1]]"): unknown {
  return {
    chat: vi.fn(async () => ({
      model: "llama3.2",
      message: { role: "assistant" as const, content: reply },
    })),
  };
}

async function buildFixture() {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-list-briefs-"));
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(
    VAULT_NAME,
    vault,
  );

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

/** Seed a chunked source doc so `compile_brief` has something to reference. */
function seedSourceDoc(vault: Vault, slug: string): DocId {
  const noteId = vault.db.notes.upsertByPath({
    path: `projects/${slug}.md`,
    content: `${slug} doc.`,
    frontmatter: null,
    title: slug,
    hash: `h-${slug}`,
    bodyHash: `b-${slug}`,
    mtime: Date.now(),
    wordCount: 2,
    vaultName: VAULT_NAME,
  }).id;
  vault.db.chunks.insertBatch(noteId, [
    {
      idx: 0,
      text: `${slug} doc.`,
      headingPath: null,
      startOffset: 0,
      endOffset: 12,
      tokenCount: 2,
      chunkIdFragment: computeChunkIdFragment(`${slug} doc.`),
    },
  ]);
  return parseDocId(`obsidian-fs://${VAULT_NAME}/projects/${slug}.md`);
}

describe("readListBriefs (BRF-09)", () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function compileDeps(): CompileBriefDeps {
    return {
      memorySinkRegistry: fixture.registry,
      manager: fixture.manager,
      deliveryAdapterFor: () => fixture.delivery,
      sourceConnectorFor: () => fixture.source,
      server: stubServer(),
      ollama: stubOllama() as never,
      briefConfig: { ollama: { model: "llama3.2" } },
    };
  }

  function listDeps(): ListBriefsDeps {
    return {
      registry: fixture.registry,
      manager: fixture.manager,
      sourceConnectorFor: () => fixture.source,
    };
  }

  let sourceCounter = 0;
  async function compile(target: string, purpose = "snap", _now?: Date): Promise<DocId> {
    const src = seedSourceDoc(fixture.vault, `${target}-${++sourceCounter}-src`);
    const res = await handleCompileBrief(compileDeps(), {
      vault: VAULT_NAME,
      target,
      source_doc_ids: [src],
      purpose,
      ..._now ? { _now } : {},
    });
    if (!res.ok) throw new Error(`compile failed: ${JSON.stringify(res)}`);
    return res.doc_id as DocId;
  }

  it("Test 1: empty vault → {total: 0, briefs: []}", async () => {
    const out = await readListBriefs(listDeps());
    expect(out).toEqual({ total: 0, briefs: [] });
  });

  it("Test 2: three briefs with distinct targets → three entries with brief shape", async () => {
    await compile("atlas");
    await compile("spire");
    await compile("nimbus");

    const out = await readListBriefs(listDeps());
    expect(out.total).toBe(3);
    expect(out.briefs).toHaveLength(3);
    const targets = out.briefs.map((b) => b.target).sort();
    expect(targets).toEqual(["atlas", "nimbus", "spire"]);
    // Every entry must carry the documented shape (all 8 fields).
    for (const entry of out.briefs) {
      expect(typeof entry.doc_id).toBe("string");
      expect(typeof entry.target).toBe("string");
      expect(typeof entry.purpose).toBe("string");
      expect(typeof entry.compiled_at).toBe("string");
      expect(typeof entry.status).toBe("string");
      expect(typeof entry.source_count).toBe("number");
      expect(typeof entry.age_days).toBe("number");
      expect(entry.vault).toBe(VAULT_NAME);
    }
  });

  it("Test 3: includes superseded briefs (discovery surface; callers filter client-side)", async () => {
    // Compile the same target twice (spaced by > 1 minute so the
    // brief slug (compactIso, minute precision) differs and the DocIds
    // are distinct). The first compile becomes `status: "superseded"`
    // via the D-12 supersede chain in `handleCompileBrief`.
    const t1 = new Date("2026-05-18T10:00:00Z");
    const t2 = new Date("2026-05-18T11:00:00Z");
    await compile("atlas", "v1", t1);
    await compile("atlas", "v2", t2);

    const out = await readListBriefs(listDeps());
    expect(out.total).toBe(2);
    const statuses = out.briefs.map((b) => b.status).sort();
    expect(statuses).toEqual(["active", "superseded"]);
  });

  it("Test 4: opts.target filters by substring of properties.target", async () => {
    await compile("atlas-q3");
    await compile("atlas-q4");
    await compile("spire-budget");

    const filtered = await readListBriefs(listDeps(), { target: "atlas" });
    expect(filtered.total).toBe(2);
    expect(filtered.briefs.every((b) => b.target.includes("atlas"))).toBe(true);

    const spire = await readListBriefs(listDeps(), { target: "spire" });
    expect(spire.total).toBe(1);
    expect(spire.briefs[0]!.target).toBe("spire-budget");
  });

  it("Test 5: source_count equals brief_sources.sourcesForBrief(briefId).length", async () => {
    const briefId = await compile("atlas-q3");
    const expected = fixture.vault.db.briefSources.sourcesForBrief(briefId).length;
    expect(expected).toBeGreaterThan(0); // sanity — compile_brief populated the reverse-index

    const out = await readListBriefs(listDeps());
    const entry = out.briefs.find((b) => b.doc_id === briefId);
    expect(entry).toBeDefined();
    expect(entry!.source_count).toBe(expected);
  });

  it("Test 6: age_days = floor((now - compiled_at) / 86400000)", async () => {
    const past = new Date(Date.now() - 5 * 86_400_000 - 500); // 5d-and-a-bit ago
    await compile("atlas", "snap", past);

    // Use fixed `_now` so the math is exact and independent of real wall clock drift.
    const now = past.getTime() + 5 * 86_400_000 + 500;
    const out = await readListBriefs(listDeps(), { _now: now });
    expect(out.briefs).toHaveLength(1);
    expect(out.briefs[0]!.age_days).toBe(5);
  });

  it("Test 10: src/brief/resources.ts imports no fs / path / gray-matter / chokidar", () => {
    // Adapter-seam discipline check (in addition to scripts/lint-adapters.sh).
    const file = readFileSync(join(__dirname, "resources.ts"), "utf-8");
    expect(file).not.toMatch(/from\s+["']node:fs["']/);
    expect(file).not.toMatch(/from\s+["']node:path["']/);
    expect(file).not.toMatch(/from\s+["']gray-matter["']/);
    expect(file).not.toMatch(/from\s+["']chokidar["']/);
    // path.join must not appear either (defense in depth).
    expect(file).not.toMatch(/\bpath\.join\b/);
  });
});
