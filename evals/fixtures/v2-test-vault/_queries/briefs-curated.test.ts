/**
 * Phase 5 / BRF-10 — Atlas Robotics curated-brief eval.
 *
 * Slice 2 floor: parse `briefs-curated.yaml`, assert each query
 * declares at least one source_doc_id, and run an end-to-end
 * compile_brief + get_brief round-trip against a Stub-adapter
 * fixture (the LLM is stubbed, the source paths are validated).
 *
 * Slice 3 will extend this with a staleness-flip scenario; this
 * test stays in `evals/fixtures/v2-test-vault/_queries/` so it
 * runs as part of the eval harness (vitest discovers `*.test.ts`
 * under any folder by default).
 */

import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Database } from "../../../../src/db/index.js";
import { VaultManager } from "../../../../src/vault/index.js";
import type { Vault } from "../../../../src/vault/index.js";
import { StubDelivery } from "../../../../src/adapters/stub/delivery.js";
import { StubSource } from "../../../../src/adapters/stub/source.js";
import { provisionSink } from "../../../../src/adapters/delivery/obsidian-fs/sentinel.js";
import {
  MemorySinkRegistry,
  parseMemorySinkHandle,
} from "../../../../src/memory/index.js";
import { computeChunkIdFragment } from "../../../../src/chunker/chunk-id.js";
import { handleCompileBrief } from "../../../../src/brief/compile.js";
import { handleGetBrief } from "../../../../src/brief/get.js";
import { BriefStalenessDaemon } from "../../../../src/brief/daemon.js";
import { StubChangeFeed } from "../../../../src/adapters/stub/change-feed.js";
import type {
  Document,
  DocId,
  MemorySink,
} from "../../../../src/types.js";
import { decomposeDocId, parseDocId } from "../../../../src/adapters/registry.js";

interface BriefsCuratedQuery {
  id: string;
  query: string;
  target: string;
  purpose: string;
  source_doc_ids: string[];
  max_tokens?: number;
  expected_must_contain?: string[];
  rationale?: string;
  /** Slice 3 / BRF-10 — staleness scenario sub-block. */
  staleness_scenario?: {
    modify_source: string;
  };
  expected_after_modify?: {
    status?: string;
    changed_sources_contains?: string[];
  };
}

interface BriefsCuratedYaml {
  queries: BriefsCuratedQuery[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const YAML_PATH = join(__dirname, "briefs-curated.yaml");
const VAULT_NAME = "v2-test-vault";
const BRIEF_SINK_REL_PATH = "_memory/_briefs/";

async function loadYaml(): Promise<BriefsCuratedYaml> {
  const raw = await fs.readFile(YAML_PATH, "utf-8");
  return parseYaml(raw) as BriefsCuratedYaml;
}

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

function stubOllama(reply: string): unknown {
  return {
    chat: vi.fn(async () => ({
      model: "llama3.2",
      message: { role: "assistant" as const, content: reply },
    })),
  };
}

async function buildFixture() {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-briefs-curated-"));
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
  const handle = parseMemorySinkHandle(
    `obsidian-fs://${VAULT_NAME}/${BRIEF_SINK_REL_PATH}`,
  );
  await registry.registerMemorySinks(
    [{ name: "_memory/_briefs", handle, contract: "default-brief-v1" }],
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

/**
 * Seed every source_doc_id from the YAML so `buildSourceHashes` has
 * something to hash. We do NOT read the fixture vault's actual files
 * — the test runs purely against the in-memory DB + stub adapters.
 * The YAML curation is the contract; the test asserts the brief
 * pipeline completes end-to-end against the curated DocIds.
 */
function seedSources(vault: Vault, docIds: readonly string[]) {
  for (const raw of docIds) {
    const id = parseDocId(raw);
    const { resource } = decomposeDocId(id);
    const text = `seed text for ${resource}`;
    const { id: noteId, isNew } = vault.db.notes.upsertByPath({
      path: resource,
      content: text,
      frontmatter: null,
      title: resource.split("/").pop() ?? resource,
      hash: `h-${resource}`,
      bodyHash: `b-${resource}`,
      mtime: Date.now(),
      wordCount: text.split(/\s+/).length,
      vaultName: VAULT_NAME,
    });
    // Idempotent seeding: when the same path is seeded twice across
    // queries, drop the prior chunks row first so insertBatch doesn't
    // hit the UNIQUE(note_id, idx) constraint.
    if (!isNew) {
      vault.db.chunks.deleteByNote(noteId);
    }
    vault.db.chunks.insertBatch(noteId, [
      {
        idx: 0,
        text,
        headingPath: null,
        startOffset: 0,
        endOffset: text.length,
        tokenCount: 4,
        chunkIdFragment: computeChunkIdFragment(text),
      },
    ]);
  }
}

describe("Phase 5 / BRF-10 — briefs-curated.yaml end-to-end", () => {
  it("parses with at least one query", async () => {
    const yaml = await loadYaml();
    expect(Array.isArray(yaml.queries)).toBe(true);
    expect(yaml.queries.length).toBeGreaterThanOrEqual(1);
  });

  it("every query has ≥ 1 source_doc_id (BRF-10 contract floor)", async () => {
    const yaml = await loadYaml();
    for (const q of yaml.queries) {
      expect(q.id).toBeTruthy();
      expect(q.target).toBeTruthy();
      expect(q.purpose).toBeTruthy();
      expect(Array.isArray(q.source_doc_ids)).toBe(true);
      expect(q.source_doc_ids.length).toBeGreaterThanOrEqual(1);
      for (const docId of q.source_doc_ids) {
        // Every entry parses as a valid DocId.
        expect(() => parseDocId(docId)).not.toThrow();
      }
    }
  });

  it("at least one query covers ≥ 10 source docs (BRF-10 primary target)", async () => {
    const yaml = await loadYaml();
    const large = yaml.queries.filter((q) => q.source_doc_ids.length >= 10);
    expect(large.length).toBeGreaterThanOrEqual(1);
  });

  it("BRF-10 staleness scenario: modify a source → brief flips to status:stale within one change-feed cycle", async () => {
    const yaml = await loadYaml();
    const scenario = yaml.queries.find(
      (q) => q.staleness_scenario !== undefined,
    );
    if (!scenario || !scenario.staleness_scenario) {
      // Skip if no staleness scenario is configured (forward-compat).
      return;
    }
    const fixture = await buildFixture();
    try {
      seedSources(fixture.vault, scenario.source_doc_ids);

      // Step 1 — compile the brief and confirm it lands active.
      const compile = await handleCompileBrief(
        {
          memorySinkRegistry: fixture.registry,
          manager: fixture.manager,
          deliveryAdapterFor: () => fixture.delivery,
          sourceConnectorFor: () => fixture.source,
          server: stubServer(),
          ollama: stubOllama("stale-scenario brief body") as never,
          briefConfig: { ollama: { model: "llama3.2" } },
        },
        {
          vault: VAULT_NAME,
          target: scenario.target,
          source_doc_ids: scenario.source_doc_ids,
          purpose: scenario.purpose,
          max_tokens: scenario.max_tokens ?? 2000,
        },
      );
      expect(compile.ok).toBe(true);
      if (!compile.ok) return;
      const briefId = compile.doc_id as DocId;
      expect(fixture.docs.get(briefId)?.properties.status).toBe("active");

      // Step 2 — start the daemon against a StubChangeFeed so we drive
      // events deterministically.
      const feed = new StubChangeFeed();
      const lockRoot = await mkdtemp(join(tmpdir(), "vm-brf10-lock-"));
      try {
        const daemon = new BriefStalenessDaemon();
        await daemon.start(fixture.vault, feed, {
          memorySinkRegistry: fixture.registry,
          deliveryAdapterFor: () => fixture.delivery,
          sourceConnectorFor: () => fixture.source,
          lockRootOverride: lockRoot,
          log: () => {},
        });

        // Step 3 — rewrite the source's chunk text (synthetic — production
        // would have the indexer rewrite the chunks row after the file
        // changes; we simulate that DB state) and emit one ChangeEvent.
        const modifiedId = parseDocId(scenario.staleness_scenario.modify_source);
        const { resource } = decomposeDocId(modifiedId);
        const note = fixture.vault.db.notes.getByPath(resource);
        if (!note) throw new Error(`fixture missing note: ${resource}`);
        const newText = `mutated text for ${resource} (timestamp ${Date.now()})`;
        fixture.vault.db.chunks.deleteByNote(note.id);
        fixture.vault.db.chunks.insertBatch(note.id, [
          {
            idx: 0,
            text: newText,
            headingPath: null,
            startOffset: 0,
            endOffset: newText.length,
            tokenCount: 4,
            chunkIdFragment: computeChunkIdFragment(newText),
          },
        ]);

        // Step 4 — one change-feed cycle.
        feed.emit({ kind: "update", id: modifiedId, at: Date.now() });
        // Wait for the async handler to settle.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        // Step 5 — assert the brief is now stale and changed_sources
        // includes the modified DocId.
        const get = await handleGetBrief(
          {
            memorySinkRegistry: fixture.registry,
            manager: fixture.manager,
            sourceConnectorFor: () => fixture.source,
          },
          {
            vault: VAULT_NAME,
            target: scenario.target,
            allow_stale: true,
          },
        );
        expect(get.brief).not.toBeNull();
        if (get.brief !== null) {
          expect(get.brief.properties.status).toBe("stale");
          if (scenario.expected_after_modify?.changed_sources_contains) {
            for (const expected of scenario.expected_after_modify
              .changed_sources_contains) {
              expect(get.brief.properties.changed_sources).toEqual(
                expect.arrayContaining([expected]),
              );
            }
          }
        }

        await daemon.shutdown();
      } finally {
        await rm(lockRoot, { recursive: true, force: true });
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("compile_brief + get_brief round-trip succeeds for every curated query", async () => {
    const yaml = await loadYaml();
    const fixture = await buildFixture();
    try {
      for (const q of yaml.queries) {
        // Reset DB state would be cleaner per-query but for the eval
        // floor we just keep adding sources — duplicate upserts are
        // idempotent on the path-keyed `notes` table.
        seedSources(fixture.vault, q.source_doc_ids);

        const compile = await handleCompileBrief(
          {
            memorySinkRegistry: fixture.registry,
            manager: fixture.manager,
            deliveryAdapterFor: () => fixture.delivery,
            sourceConnectorFor: () => fixture.source,
            server: stubServer(),
            ollama: stubOllama(
              `Stub brief body referencing the sources.\n\n` +
                q.source_doc_ids
                  .slice(0, 3)
                  .map((d) => `- [[${decomposeDocId(parseDocId(d)).resource.split("/").pop()}]]`)
                  .join("\n"),
            ) as never,
            briefConfig: { ollama: { model: "llama3.2" } },
          },
          {
            vault: VAULT_NAME,
            target: q.target,
            source_doc_ids: q.source_doc_ids,
            purpose: q.purpose,
            max_tokens: q.max_tokens ?? 2000,
          },
        );
        expect(compile.ok).toBe(true);
        if (!compile.ok) continue;

        const got = await handleGetBrief(
          {
            memorySinkRegistry: fixture.registry,
            manager: fixture.manager,
            sourceConnectorFor: () => fixture.source,
          },
          { vault: VAULT_NAME, target: q.target },
        );
        expect(got.brief).not.toBeNull();
        if (got.brief !== null) {
          expect(got.brief.properties.target).toBe(q.target);
          expect(got.stale).toBe(false);
          expect(got.too_old).toBe(false);
        }
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
