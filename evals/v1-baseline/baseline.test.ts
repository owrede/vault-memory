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
// Precision/recall scoring is `.todo` — the actual tool invocation against
// a fully-indexed fixture vault requires Ollama and a one-time index, which
// is Phase 1 territory. Phase 1 converts the `.todo` to `it(...)` and
// asserts >= 0.8 precision and >= 0.8 recall vs expected_doc_ids (D-14).
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = join(__dirname, "..", "fixtures", "v2-test-vault");

// --- FND-10: tools/list snapshot pin ----------------------------------------

describe("v1 tools/list surface (FND-10)", () => {
  it("matches the pinned snapshot exactly", () => {
    const actual = { tools: TOOLS };
    const pinned = JSON.parse(
      readFileSync(join(__dirname, "tools-list.snapshot.json"), "utf-8"),
    );
    expect(actual).toEqual(pinned);
  });

  it("has exactly 26 tools (23 v1 + Plan 02-04 record_observation + supersede + Plan 02-05 recall)", () => {
    expect(TOOLS).toHaveLength(26);
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

      // Per-tool precision/recall floor (D-14: 0.8). Phase 1 lights this up
      // after the fixture vault is indexed by Ollama.
      if (queries.length > 0) {
        it.todo(
          "achieves >= 0.8 precision and >= 0.8 recall vs expected_doc_ids",
        );
      }
    });
  }
});
