/**
 * Phase 4 / 04-06 / GRA-05 — `search_hybrid({expand})` integration.
 *
 * Loads `evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml`
 * and runs each query twice against the live Atlas Robotics fixture —
 * once WITH `expand`, once WITHOUT — to pin the Plan 04-04 composition
 * contract:
 *
 *   1. Top-K ranking is IDENTICAL with vs. without expand (D-16).
 *   2. With expand, each hit carries `expansions: CitationPacketWithVia[]`
 *      and every expansion's `via.seed_doc_id` equals the parent hit's
 *      `doc_id` (no cross-hit pollution — Plan 04-04 Test 2).
 *   3. Without expand, no hit carries an `expansions` field
 *      (v1-baseline shape preserved byte-identically).
 *
 * BM25-only path: the live fixture seeds chunks via `chunkNote` but no
 * embedding model, so `hybridSearch` skips the semantic branch and
 * scores purely on the FTS5 BM25 statement. The mocked OllamaClient
 * here is therefore never invoked — `embed: vi.fn()` exists only to
 * satisfy the type contract.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { hybridSearch } from "./hybrid.js";
import type { EdgeType } from "../db/queries/edges.js";
import type { ExpandDirection } from "../graph/expand.js";
import type { OllamaClient } from "../ollama/index.js";
import { buildAtlasLiveFixture } from "../graph/__test_helpers__/atlas-live-fixture.js";

// ─── YAML schema ────────────────────────────────────────────────────────────

interface HybridExpandYamlQuery {
  id: string;
  description?: string;
  input: {
    query: string;
    top_k?: number;
    expand: {
      hops: 1 | 2;
      direction?: ExpandDirection;
      edge_types?: EdgeType[];
    };
  };
}

interface HybridExpandYaml {
  tool: "search_hybrid";
  queries: HybridExpandYamlQuery[];
}

const YAML_PATH = resolve(
  process.cwd(),
  "evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml",
);

function loadYaml(): HybridExpandYaml {
  const raw = readFileSync(YAML_PATH, "utf8");
  const parsed = parseYaml(raw) as HybridExpandYaml;
  if (parsed.tool !== "search_hybrid") {
    throw new Error(
      `search-hybrid-with-expand.yaml: expected tool='search_hybrid', got '${parsed.tool}'`,
    );
  }
  if (!Array.isArray(parsed.queries)) {
    throw new Error(`search-hybrid-with-expand.yaml: queries is not an array`);
  }
  return parsed;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("hybridSearch({expand}) — eval integration against Atlas Robotics", () => {
  it("the YAML parses and contains >= 3 queries", () => {
    const yaml = loadYaml();
    expect(yaml.queries.length).toBeGreaterThanOrEqual(3);
    for (const q of yaml.queries) {
      expect(typeof q.id).toBe("string");
      expect(typeof q.input.query).toBe("string");
      expect(q.input.query.length).toBeGreaterThan(0);
      expect([1, 2]).toContain(q.input.expand.hops);
    }
  });

  it("each query: WITH expand attaches expansions[]; WITHOUT expand omits the field; ranking is identical", async () => {
    const yaml = loadYaml();
    const fx = await buildAtlasLiveFixture({ withChunks: true });
    try {
      const ollama = { embed: vi.fn() } as unknown as OllamaClient;
      for (const q of yaml.queries) {
        const topK = q.input.top_k ?? 5;

        // --- pass 1: without expand (v1-baseline shape) ---
        const baseline = await hybridSearch({
          query: q.input.query,
          embeddingModel: "test-model",
          ollama,
          vaults: [fx.vault],
          topK,
        });
        if (baseline.length === 0) {
          throw new Error(
            `query '${q.id}' returned zero baseline hits — the fixture's BM25 corpus may have drifted; widen the query string in the YAML.`,
          );
        }
        for (const hit of baseline) {
          expect(
            hit.expansions,
            `query '${q.id}' baseline (no expand): hit ${hit.notePath} should not carry an 'expansions' field`,
          ).toBeUndefined();
        }

        // --- pass 2: with expand ---
        const withExpand = await hybridSearch({
          query: q.input.query,
          embeddingModel: "test-model",
          ollama,
          vaults: [fx.vault],
          topK,
          expand: {
            hops: q.input.expand.hops,
            ...(q.input.expand.direction !== undefined && {
              direction: q.input.expand.direction,
            }),
            ...(q.input.expand.edge_types !== undefined && {
              edge_types: q.input.expand.edge_types,
            }),
          },
          expandDeps: {
            manager: fx.manager,
            sourceConnectorFor: fx.sourceConnectorFor,
          },
        });

        // --- ranking preservation (D-16) ---
        const baseOrder = baseline.map((h) => h.doc_id);
        const expOrder = withExpand.map((h) => h.doc_id);
        expect(
          expOrder,
          `query '${q.id}': top-K ranking must be identical with vs. without expand (D-16)`,
        ).toEqual(baseOrder);
        const baseScores = baseline.map((h) => h.score);
        const expScores = withExpand.map((h) => h.score);
        expect(
          expScores,
          `query '${q.id}': scores must be identical (expand never re-scores)`,
        ).toEqual(baseScores);

        // --- expansions attached + via.seed_doc_id binding ---
        let totalExpansions = 0;
        for (const hit of withExpand) {
          // Every hit gets an expansions array (possibly empty when no
          // typed-edge neighbors exist).
          expect(
            hit.expansions,
            `query '${q.id}': hit ${hit.notePath} missing 'expansions' field with expand active`,
          ).toBeDefined();
          for (const exp of hit.expansions ?? []) {
            expect(
              exp.via.seed_doc_id,
              `query '${q.id}': expansion ${exp.doc_id} from ${hit.notePath} has wrong via.seed_doc_id`,
            ).toBe(hit.doc_id);
            expect([1, 2]).toContain(exp.via.hop);
            if (q.input.expand.edge_types !== undefined) {
              expect(
                q.input.expand.edge_types,
                `query '${q.id}': expansion edge_type ${exp.via.edge_type} not in filter`,
              ).toContain(exp.via.edge_type);
            }
            totalExpansions += 1;
          }
        }
        // At least one expansion must surface across all hits for the
        // composition contract to be meaningful — otherwise the test is
        // a no-op (the v1 invariance check is the only thing the
        // assertions above could fire on). If a maintainer narrows the
        // query and zeroes out the neighborhood, the YAML query string
        // should be widened.
        expect(
          totalExpansions,
          `query '${q.id}': no expansions surfaced — widen the query, lower top_k, or pick a richer seed.`,
        ).toBeGreaterThan(0);
      }
    } finally {
      fx.cleanup();
    }
  });
});
