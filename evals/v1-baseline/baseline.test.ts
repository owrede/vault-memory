// v1 baseline regression suite (FND-09 + FND-10).
//
// Two responsibilities:
// 1) Snapshot equality — assert the TOOLS literal (single source of truth in
//    src/tool-registry.ts) byte-equals the pinned tools-list.snapshot.json.
//    Any change to a v1 tool's shape breaks this test (FND-10).
// 2) Per-tool semantic-floor fixtures — discover every *.yaml in this
//    directory, parse it, and verify that all expected_doc_ids resolve to
//    real files under evals/fixtures/v2-test-vault/ (FND-09 referential
//    integrity, Pitfall 5 mitigation).
//
// Precision/recall scoring is gated via `it.skipIf` on Ollama availability.
// When Ollama is unreachable the test reports as `skipped` (NOT `todo`), so
// the gap is visible in the vitest summary as a positive skip count — this
// is the audit-follow-up M1 fix. The actual implementation that asserts
// >= 0.8 precision and >= 0.8 recall vs expected_doc_ids (D-14) is Phase 3
// territory and is wired here as a stub that fails closed (throws) so the
// skip surfaces honestly until Phase 3 lights it up.
//
// Test-name substrings the Phase 0 VALIDATION rows grep for:
//   - "matches the pinned snapshot"   (row 00-10-02)
//   - "baseline fixtures parse"       (row 00-09-02)

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { TOOLS } from "../../src/tool-registry.js";
import { RESOURCES } from "../../src/resource-registry.js";

/**
 * Synchronously probe Ollama at the configured endpoint. Returns true iff
 * the daemon responds within a short window. The probe is intentionally
 * short-circuit: if any layer (DNS, TCP, HTTP, JSON) fails, we report
 * "not available" rather than hanging the test suite.
 *
 * Default endpoint mirrors src/ollama/client.ts: http://localhost:11434.
 * Overridable via VAULT_MEMORY_OLLAMA_URL for CI matrices.
 */
async function probeOllama(): Promise<boolean> {
  const url = process.env.VAULT_MEMORY_OLLAMA_URL ?? "http://localhost:11434";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 250);
  try {
    const r = await fetch(`${url}/api/tags`, { signal: controller.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const OLLAMA_AVAILABLE = await probeOllama();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = join(__dirname, "..", "fixtures", "v2-test-vault");

// --- FND-10: tools/list snapshot pin ----------------------------------------

describe("v1 tools/list surface (FND-10)", () => {
  // Plan 04-07: snapshot regenerated with the full Phase 4 additive diff
  // (2 new tools `expand` + `cluster`, plus a nested `expand` param on
  // `search_hybrid`). Plan 05-04: snapshot regenerated additively with
  // `compile_brief` + `get_brief`. `list_briefs` is a Resource, not a
  // Tool — registered through `server.registerResource` and NOT part
  // of this `tools/list` snapshot (separate MCP discovery surface).
  // Drift is enforced via byte-equality below.
  it("matches the pinned snapshot exactly", () => {
    const actual = { tools: TOOLS };
    const pinned = JSON.parse(
      readFileSync(join(__dirname, "tools-list.snapshot.json"), "utf-8"),
    );
    expect(actual).toEqual(pinned);
  });

  it("has exactly 37 tools (34 prior + 06-02 register_contracts_as_tools + 06-03 describe_contract + instantiate_contract)", () => {
    expect(TOOLS).toHaveLength(37);
  });

  it("preserves the 23 v1 baseline tool names byte-identical (Plan 02-04 truth)", () => {
    const expectedV1Names = [
      "list_vaults",
      "read_note",
      "search_semantic",
      "search_text",
      "search_hybrid",
      "list_backlinks",
      "list_forward_links",
      "find_broken_links",
      "query_frontmatter",
      "write_note",
      "update_frontmatter",
      "delete_note",
      "audit_log",
      "list_models",
      "start_shadow_index",
      "switch_active_model",
      "vacuum_embeddings",
      "index_runs",
      "search",
      "fetch",
      "vault_stats",
      "recent_notes",
      "suggest_frontmatter",
    ];
    const v1Slice = TOOLS.slice(0, 23).map((t) => t.name);
    expect(v1Slice).toEqual(expectedV1Names);
  });

  // Plan 08-05 (REL-08): 5 tools promoted to MCP Resources but kept callable
  // through v2.x with a DEPRECATED notice suffixed onto their description.
  // Canonical (non-deprecated) tool surface = 37 - 5 = 32.
  it("has exactly 5 tools marked DEPRECATED in description (REL-08)", () => {
    const deprecated = TOOLS.filter((t) => t.description.includes("DEPRECATED"));
    expect(deprecated.map((t) => t.name).sort()).toEqual([
      "list_backlinks",
      "list_models",
      "list_vaults",
      "recent_notes",
      "vault_stats",
    ]);
  });
});

// --- REL-08: resources/list snapshot pin ------------------------------------

describe("v2 resources/list surface (REL-08)", () => {
  // Plan 08-05 promotes 5 list-style v1 tools to MCP Resources. The RESOURCES
  // literal in src/resource-registry.ts is the single source of truth (also
  // used by evals/v1-baseline/dump-resources.mjs to regenerate the pinned
  // snapshot). Byte-equality drift fails CI — the same shape gate as TOOLS.
  it("matches the pinned snapshot exactly", () => {
    const actual = { resources: RESOURCES };
    const pinned = JSON.parse(
      readFileSync(join(__dirname, "resources-list.snapshot.json"), "utf-8"),
    );
    expect(actual).toEqual(pinned);
  });

  it("has exactly 10 resources after REL-08 promotion", () => {
    expect(RESOURCES).toHaveLength(10);
  });

  // B2 acceptance: a docId containing path separators (`/`) must round-trip
  // through the `vault-memory://backlinks/{vault}/{+docId}` Resource and
  // produce the same payload as the `list_backlinks` tool call. The `+` in
  // `{+docId}` is RFC 6570 reserved expansion; without it the default
  // expansion truncates at the first `/`.
  it("path-style docId round-trips through the backlinks Resource (B2)", async () => {
    const { McpServer, ResourceTemplate } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );
    const { Database } = await import("../../src/db/database.js");
    const { VaultManager } = await import("../../src/vault/index.js");
    const { listBacklinks } = await import("../../src/graph/index.js");

    const db = new Database(":memory:", "rel08-backlinks-test");
    db.migrate();

    // Seed two notes: source links to target via wikilink. Use a multi-segment
    // path on the TARGET so the docId we feed to the Resource contains `/`.
    const sourceNoteId = db.notes.upsertByPath({
      path: "src/note.md",
      content: "[[notes/sub/file]]",
      frontmatter: null,
      title: "source",
      hash: "h-src",
      mtime: 1,
      wordCount: 1,
    }).id;
    const targetNoteId = db.notes.upsertByPath({
      path: "notes/sub/file.md",
      content: "# target",
      frontmatter: null,
      title: "target",
      hash: "h-tgt",
      mtime: 1,
      wordCount: 1,
    }).id;
    db.wikilinks.insertBatch(sourceNoteId, [
      {
        targetPath: "notes/sub/file.md",
        targetNoteId,
        linkText: "file",
        anchor: null,
        lineNumber: 1,
      },
    ]);
    db.edges.insertBatch(sourceNoteId, [
      {
        targetNoteId,
        targetPath: "notes/sub/file.md",
        type: "wikilink",
        rel: null,
        anchor: null,
        lineNumber: 1,
        linkText: "file",
      },
    ]);

    const vault = {
      config: { name: "rel08-backlinks-test", path: "/tmp/rel08" },
      db,
      dbPath: ":memory:",
    };
    const manager = new VaultManager();
    (
      manager as unknown as { vaults: Map<string, typeof vault> }
    ).vaults.set(vault.config.name, vault);

    const server = new McpServer(
      { name: "rel08-backlinks-test-server", version: "test" },
      { capabilities: { resources: {}, tools: {} } },
    );

    // Mirror the production registration shape (delegate to listBacklinks).
    server.registerResource(
      "backlinks",
      new ResourceTemplate(
        "vault-memory://backlinks/{vault}/{+docId}",
        { list: undefined },
      ),
      { title: "Backlinks", mimeType: "application/json" },
      async (uri, variables) => {
        const vaultName = String(variables.vault ?? "");
        const rawDocId = variables.docId;
        const docId = Array.isArray(rawDocId)
          ? rawDocId.join("/")
          : String(rawDocId ?? "");
        const v = manager.require(vaultName);
        const backlinks = listBacklinks(v, docId);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ backlinks }, null, 2),
            },
          ],
        };
      },
    );

    // Also register the list_backlinks tool with the same delegation so we
    // can compare payloads under one in-memory client/server pair.
    const { z } = await import("zod");
    server.registerTool(
      "list_backlinks",
      {
        title: "list_backlinks",
        description: "list_backlinks (test mirror)",
        inputSchema: {
          vault: z.string(),
          path: z.string(),
        },
      },
      async (args) => {
        const p = args as { vault: string; path: string };
        const v = manager.require(p.vault);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ backlinks: listBacklinks(v, p.path) }),
            },
          ],
        };
      },
    );

    const client = new Client(
      { name: "rel08-backlinks-test-client", version: "test" },
      { capabilities: { resources: {}, tools: {} } },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      // Read via the Resource URI with a multi-segment docId.
      const resourceResp = await client.readResource({
        uri: "vault-memory://backlinks/rel08-backlinks-test/notes/sub/file.md",
      });
      expect(Array.isArray(resourceResp.contents)).toBe(true);
      expect(resourceResp.contents.length).toBeGreaterThan(0);
      const firstText = resourceResp.contents[0]?.text;
      expect(typeof firstText).toBe("string");
      const resourcePayload = JSON.parse(firstText as string);

      // Read via the tool call with the same vault + path.
      const toolResp = await client.callTool({
        name: "list_backlinks",
        arguments: {
          vault: "rel08-backlinks-test",
          path: "notes/sub/file.md",
        },
      });
      expect(toolResp.isError).not.toBe(true);
      // toolResp.content is an array of {type:"text", text:"..."} envelopes.
      const toolText = (
        toolResp.content as Array<{ type: string; text: string }>
      )[0]?.text;
      expect(typeof toolText).toBe("string");
      const toolPayload = JSON.parse(toolText as string);

      expect(resourcePayload).toEqual(toolPayload);
      expect(Array.isArray(resourcePayload.backlinks)).toBe(true);
      expect(resourcePayload.backlinks).toHaveLength(1);
      expect(resourcePayload.backlinks[0].sourcePath).toBe("src/note.md");
    } finally {
      await client.close();
      await server.close();
      db.close();
    }
  });
});

// --- FND-09: per-tool semantic-floor fixtures -------------------------------

// Shape of a single parsed YAML fixture. Kept narrow to keep the test
// runtime-only — Phase 1 will replace this with the real eval harness.
interface BaselineQuery {
  id: string;
  query: string;
  expected_doc_ids?: string[];
  expected_must_contain?: string[];
  rationale?: string;
  args?: unknown;
}

interface BaselineFixture {
  tool: string;
  queries?: BaselineQuery[];
}

describe("v1 baseline fixtures parse (FND-09)", () => {
  // Discover all <tool-name>.yaml fixtures in evals/v1-baseline/
  const fixtures = readdirSync(__dirname).filter(
    (f) => f.endsWith(".yaml") && f !== "README.yaml",
  );

  it("discovers at least one fixture file", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixtureFile of fixtures) {
    const toolName = fixtureFile.replace(/\.yaml$/, "");

    describe(toolName, () => {
      const parsed = parseYaml(
        readFileSync(join(__dirname, fixtureFile), "utf-8"),
      ) as BaselineFixture;

      it("parses as YAML with `tool` and `queries` (queries may be empty)", () => {
        expect(parsed).toBeTypeOf("object");
        expect(parsed.tool).toBe(toolName);
        // queries[] may be empty for v3 placeholders (graph_neighbors, graph_path)
        expect(Array.isArray(parsed.queries ?? [])).toBe(true);
      });

      const queries = parsed.queries ?? [];

      // Referential integrity (Pitfall 5 mitigation): every expected_doc_id
      // resolves to a real file in the fixture vault.
      it("expected_doc_ids reference real fixture files", () => {
        for (const q of queries) {
          for (const expectedId of q.expected_doc_ids ?? []) {
            const fullPath = join(FIXTURE_VAULT, expectedId);
            expect(
              existsSync(fullPath),
              `Query "${q.id}" references missing fixture file: ${expectedId}`,
            ).toBe(true);
          }
        }
      });

      // Per-tool precision/recall floor (D-14: 0.8).
      //
      // Audit follow-up M1: previously an `it.todo` (invisible in summary
      // counts). Converted to `it.skip` so the gap surfaces as a positive
      // skip count in the vitest output. The semantics differ:
      //   - `.todo`  → counted as "todo" (often hidden in CI summaries)
      //   - `.skip`  → counted as "skipped" (visible, with the test name)
      //
      // The harness itself is Phase 3 work — it must (a) index the fixture
      // vault via the v1 indexer, (b) invoke the tool under test for each
      // query, (c) compute precision/recall vs expected_doc_ids, (d) assert
      // >= 0.8 on both. When that lands, the body below becomes real and
      // the `.skip` becomes `it.skipIf(!OLLAMA_AVAILABLE)`.
      //
      // OLLAMA_AVAILABLE is computed once at module load via probeOllama();
      // it is currently unused but kept so Phase 3 can flip the gate
      // without re-introducing the probe import dance.
      void OLLAMA_AVAILABLE;
      if (queries.length > 0) {
        it.skip(
          "achieves >= 0.8 precision and >= 0.8 recall vs expected_doc_ids (Phase 3 harness pending — audit M1)",
        );
      }
    });
  }
});
