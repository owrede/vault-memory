/**
 * Phase 4 / 04-06 / GRA-05 (D-12) — `cluster()` determinism snapshot
 * integration.
 *
 * Loads `evals/fixtures/v2-test-vault/_queries/cluster.yaml`, runs
 * `cluster()` against the live Atlas Robotics fixture, and asserts the
 * Louvain partition matches the pinned `expected_clusters` byte-for-byte
 * (cluster_id + lex-sorted member DocId arrays).
 *
 * Additional in-process determinism check: run `cluster()` twice on the
 * same fixture and assert the two outputs are identical (D-12 step 3).
 *
 * Reverse-input check: re-run with the seed_doc_ids array reversed and
 * assert the output STILL matches the snapshot — because `cluster()`
 * sorts DocIds before inserting into graphology (D-12 step 1), input
 * order is not a determinism input.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { cluster, type ClusterResult } from "./cluster.js";
import type { DocId } from "../types.js";
import { buildAtlasLiveFixture } from "./__test_helpers__/atlas-live-fixture.js";

// ─── YAML schema ────────────────────────────────────────────────────────────

interface ClusterYamlExpectedCluster {
  cluster_id: string;
  member_doc_ids: string[];
}

interface ClusterYamlQuery {
  id: string;
  description?: string;
  input: {
    seed_doc_ids: string[];
    method: "edge-community";
  };
  expected_node_count: number;
  expected_clusters: ClusterYamlExpectedCluster[];
}

interface ClusterYaml {
  tool: "cluster";
  queries: ClusterYamlQuery[];
}

const YAML_PATH = resolve(
  process.cwd(),
  "evals/fixtures/v2-test-vault/_queries/cluster.yaml",
);

function loadYaml(): ClusterYaml {
  const raw = readFileSync(YAML_PATH, "utf8");
  const parsed = parseYaml(raw) as ClusterYaml;
  if (parsed.tool !== "cluster") {
    throw new Error(`cluster.yaml: expected tool='cluster', got '${parsed.tool}'`);
  }
  if (!Array.isArray(parsed.queries) || parsed.queries.length === 0) {
    throw new Error(`cluster.yaml: queries field must be a non-empty array`);
  }
  return parsed;
}

/**
 * Normalize a cluster() result into the shape pinned by cluster.yaml:
 * `[{cluster_id, member_doc_ids: sorted}]` sorted by cluster_id asc.
 */
function normalizeClusters(result: ClusterResult): ClusterYamlExpectedCluster[] {
  if (!result.ok) {
    throw new Error(`cluster() returned ok:false reason=${result.reason}`);
  }
  return result.clusters.map((c) => ({
    cluster_id: String(c.cluster_id),
    member_doc_ids: c.members.map((m) => String(m.doc_id)).sort(),
  }));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("cluster() — eval integration against Atlas Robotics fixture", () => {
  it("the YAML parses and contains >= 1 query", () => {
    const yaml = loadYaml();
    expect(yaml.queries.length).toBeGreaterThanOrEqual(1);
    for (const q of yaml.queries) {
      expect(typeof q.expected_node_count).toBe("number");
      expect(Array.isArray(q.expected_clusters)).toBe(true);
      expect(q.expected_clusters.length).toBeGreaterThan(0);
    }
  });

  it("each query: cluster() output matches the pinned snapshot byte-for-byte (D-12)", async () => {
    const yaml = loadYaml();
    const fx = await buildAtlasLiveFixture();
    try {
      for (const q of yaml.queries) {
        const res = await cluster(
          {
            manager: fx.manager,
            sourceConnectorFor: fx.sourceConnectorFor,
            hybridSearch: async () => [],
          },
          {
            method: q.input.method,
            seed_doc_ids: q.input.seed_doc_ids as DocId[],
          },
        );
        expect(res.ok, `query '${q.id}': cluster() returned ok=false`).toBe(true);
        if (!res.ok) continue;
        expect(res.node_count, `query '${q.id}': node_count`).toBe(q.expected_node_count);
        const normalized = normalizeClusters(res);
        expect(
          normalized,
          `query '${q.id}': cluster snapshot drift — regenerate intentionally if the change is desired`,
        ).toEqual(q.expected_clusters);
      }
    } finally {
      fx.cleanup();
    }
  });

  it("in-process determinism: two consecutive cluster() calls produce identical output", async () => {
    const yaml = loadYaml();
    const fx = await buildAtlasLiveFixture();
    try {
      const q = yaml.queries[0]!;
      const a = await cluster(
        {
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          hybridSearch: async () => [],
        },
        { method: q.input.method, seed_doc_ids: q.input.seed_doc_ids as DocId[] },
      );
      const b = await cluster(
        {
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          hybridSearch: async () => [],
        },
        { method: q.input.method, seed_doc_ids: q.input.seed_doc_ids as DocId[] },
      );
      expect(normalizeClusters(a)).toEqual(normalizeClusters(b));
    } finally {
      fx.cleanup();
    }
  });

  it("input-order independence: reversed seed_doc_ids produce the same snapshot (D-12 step 1)", async () => {
    const yaml = loadYaml();
    const fx = await buildAtlasLiveFixture();
    try {
      const q = yaml.queries[0]!;
      const reversed = [...q.input.seed_doc_ids].reverse();
      const res = await cluster(
        {
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          hybridSearch: async () => [],
        },
        { method: q.input.method, seed_doc_ids: reversed as DocId[] },
      );
      expect(normalizeClusters(res)).toEqual(q.expected_clusters);
    } finally {
      fx.cleanup();
    }
  });
});
