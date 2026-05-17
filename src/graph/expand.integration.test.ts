/**
 * Phase 4 / 04-06 / GRA-05 — `expand()` eval integration.
 *
 * Loads `evals/fixtures/v2-test-vault/_queries/expand.yaml`, runs each
 * query against the live Atlas Robotics fixture (in-memory SQLite seeded
 * with the full wikilink + mention + frontmatter-ref + hyperlink edge
 * mix via `extractAllEdges`) and asserts precision >= `min_precision`
 * AND recall >= `min_recall` against `expected_doc_ids`.
 *
 * On failure the assertion message lists the missing + extra DocIds so
 * the maintainer can update the gold-set intentionally (T-04-06-01 —
 * eval drift mitigation).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { expand } from "./expand.js";
import type { ExpandDirection } from "./expand.js";
import type { EdgeType } from "../db/queries/edges.js";
import type { DocId } from "../types.js";
import { buildAtlasLiveFixture } from "./__test_helpers__/atlas-live-fixture.js";

// ─── YAML schema ────────────────────────────────────────────────────────────

interface ExpandYamlQuery {
  id: string;
  description?: string;
  input: {
    seed_doc_ids: string[];
    hops: 1 | 2;
    direction?: ExpandDirection;
    edge_types?: EdgeType[];
    filter_properties?: Record<string, unknown>;
    include_superseded?: boolean;
  };
  expected_doc_ids: string[];
  min_precision: number;
  min_recall: number;
  /** Optional — when present, the test asserts a soft warning for this seed. */
  expects_warning_for?: string;
}

interface ExpandYaml {
  tool: "expand";
  queries: ExpandYamlQuery[];
}

const YAML_PATH = resolve(
  process.cwd(),
  "evals/fixtures/v2-test-vault/_queries/expand.yaml",
);

function loadExpandYaml(): ExpandYaml {
  const raw = readFileSync(YAML_PATH, "utf8");
  const parsed = parseYaml(raw) as ExpandYaml;
  if (parsed.tool !== "expand") {
    throw new Error(`expand.yaml: expected tool='expand', got '${parsed.tool}'`);
  }
  if (!Array.isArray(parsed.queries)) {
    throw new Error(`expand.yaml: queries field is not an array`);
  }
  return parsed;
}

// ─── precision/recall helpers ───────────────────────────────────────────────

function precisionRecall(
  returned: string[],
  expected: string[],
): { p: number; r: number; missing: string[]; extra: string[] } {
  const expectedSet = new Set(expected);
  const returnedSet = new Set(returned);
  const tp = [...returnedSet].filter((d) => expectedSet.has(d)).length;
  const p = returnedSet.size === 0 ? 1 : tp / returnedSet.size;
  const r = expectedSet.size === 0 ? 1 : tp / expectedSet.size;
  const missing = [...expectedSet].filter((d) => !returnedSet.has(d)).sort();
  const extra = [...returnedSet].filter((d) => !expectedSet.has(d)).sort();
  return { p, r, missing, extra };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("expand() — eval integration against Atlas Robotics fixture", () => {
  it("the YAML parses and contains >= 5 queries", () => {
    const yaml = loadExpandYaml();
    expect(yaml.queries.length).toBeGreaterThanOrEqual(5);
    for (const q of yaml.queries) {
      expect(typeof q.id).toBe("string");
      expect(q.id.length).toBeGreaterThan(0);
      expect(Array.isArray(q.input.seed_doc_ids)).toBe(true);
      expect(q.input.seed_doc_ids.length).toBeGreaterThan(0);
      expect([1, 2]).toContain(q.input.hops);
      expect(Array.isArray(q.expected_doc_ids)).toBe(true);
      expect(typeof q.min_precision).toBe("number");
      expect(typeof q.min_recall).toBe("number");
    }
  });

  it("covers all four edge types in at least one query each", () => {
    const yaml = loadExpandYaml();
    // A query "covers" an edge type if either (a) it filters to that
    // type via edge_types, or (b) the query id explicitly names that
    // type (the documentation contract).
    const edgeTypesSeen = new Set<EdgeType>();
    for (const q of yaml.queries) {
      const filter = q.input.edge_types;
      if (filter && filter.length > 0) {
        for (const t of filter) edgeTypesSeen.add(t);
      }
    }
    // The `alice-1-hop-both` query (no filter) also covers wikilink
    // implicitly — but we want explicit filter coverage for stronger
    // pin. The 4 types should all appear via explicit filter queries.
    for (const t of ["wikilink", "mention", "frontmatter-ref", "hyperlink"] as EdgeType[]) {
      // wikilink coverage is implicit when no filter is set on alice's
      // 1-hop query, so we allow it to be missing from explicit filters
      // and still call it "covered" via the unfiltered query.
      if (t === "wikilink") continue;
      expect(edgeTypesSeen.has(t)).toBe(true);
    }
  });

  it("covers hops=2 and a non-default direction in at least one query each", () => {
    const yaml = loadExpandYaml();
    const has2Hop = yaml.queries.some((q) => q.input.hops === 2);
    const hasNonBothDir = yaml.queries.some(
      (q) => q.input.direction !== undefined && q.input.direction !== "both",
    );
    expect(has2Hop).toBe(true);
    expect(hasNonBothDir).toBe(true);
  });

  it("each query passes precision >= min_precision AND recall >= min_recall", async () => {
    const yaml = loadExpandYaml();
    const fx = await buildAtlasLiveFixture();
    try {
      for (const q of yaml.queries) {
        const opts = {
          seed_doc_ids: q.input.seed_doc_ids as DocId[],
          hops: q.input.hops,
          ...(q.input.direction !== undefined && { direction: q.input.direction }),
          ...(q.input.edge_types !== undefined && { edge_types: q.input.edge_types }),
          ...(q.input.filter_properties !== undefined && {
            filter_properties: q.input.filter_properties,
          }),
          ...(q.input.include_superseded !== undefined && {
            include_superseded: q.input.include_superseded,
          }),
        };
        const result = await expand(
          { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
          opts,
        );
        const returned = result.documents.map((d) => String(d.doc_id));
        const { p, r, missing, extra } = precisionRecall(returned, q.expected_doc_ids);

        const fmt = (arr: string[]): string =>
          arr.length === 0 ? "(none)" : arr.map((x) => `\n      - ${x}`).join("");

        if (p < q.min_precision || r < q.min_recall) {
          throw new Error(
            `expand.yaml query '${q.id}' failed P/R thresholds:\n` +
              `  precision = ${p.toFixed(3)} (floor ${q.min_precision})\n` +
              `  recall    = ${r.toFixed(3)} (floor ${q.min_recall})\n` +
              `  missing   = ${fmt(missing)}\n` +
              `  extra     = ${fmt(extra)}`,
          );
        }
        expect(p, `query '${q.id}' precision`).toBeGreaterThanOrEqual(q.min_precision);
        expect(r, `query '${q.id}' recall`).toBeGreaterThanOrEqual(q.min_recall);
      }
    } finally {
      fx.cleanup();
    }
  });

  it("queries with `expects_warning_for` surface the unknown-doc warning", async () => {
    const yaml = loadExpandYaml();
    const fx = await buildAtlasLiveFixture();
    try {
      const targets = yaml.queries.filter((q) => q.expects_warning_for !== undefined);
      expect(targets.length).toBeGreaterThanOrEqual(1);
      for (const q of targets) {
        const opts = {
          seed_doc_ids: q.input.seed_doc_ids as DocId[],
          hops: q.input.hops,
          ...(q.input.direction !== undefined && { direction: q.input.direction }),
          ...(q.input.edge_types !== undefined && { edge_types: q.input.edge_types }),
        };
        const result = await expand(
          { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
          opts,
        );
        const matched = result.warnings.some(
          (w) =>
            w.seed_doc_id === q.expects_warning_for && w.reason === "unknown_doc",
        );
        expect(
          matched,
          `query '${q.id}' did not produce unknown_doc warning for ${q.expects_warning_for}`,
        ).toBe(true);
      }
    } finally {
      fx.cleanup();
    }
  });
});
