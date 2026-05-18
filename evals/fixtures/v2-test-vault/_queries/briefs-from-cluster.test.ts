/**
 * Phase 5 / BRF-10 pipeline-integration eval (D-02 secondary).
 *
 * Slice 3 floor: parse `briefs-from-cluster.yaml` and assert the
 * pipeline-integration query is well-formed (every entry parses as
 * DocId, expected_member_count window is sensible, cluster_opts are
 * non-empty). The actual cluster()+compile_brief end-to-end pipeline
 * lands in slice 4 once the eval harness binds the fixture vault's
 * indexed corpus to the real Phase 4 `cluster()` helper.
 *
 * Catches regressions where the YAML is accidentally cleared / one of
 * the seed DocIds becomes malformed — the slice-4 harness will then
 * crash on parse-time rather than mid-pipeline.
 */

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { parseDocId } from "../../../../src/adapters/registry.js";

interface BriefsFromClusterQuery {
  id: string;
  seed_doc_ids: string[];
  target: string;
  purpose: string;
  max_tokens?: number;
  cluster_opts?: {
    max_iterations?: number;
    resolution?: number;
  };
  expected_member_count?: {
    min?: number;
    max?: number;
  };
  rationale?: string;
}

interface BriefsFromClusterYaml {
  queries: BriefsFromClusterQuery[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const YAML_PATH = join(__dirname, "briefs-from-cluster.yaml");

async function loadYaml(): Promise<BriefsFromClusterYaml> {
  const raw = await fs.readFile(YAML_PATH, "utf-8");
  return parseYaml(raw) as BriefsFromClusterYaml;
}

describe("Phase 5 / BRF-10 — briefs-from-cluster.yaml pipeline integration", () => {
  it("parses with at least one query (D-02 secondary populated in slice 3)", async () => {
    const yaml = await loadYaml();
    expect(Array.isArray(yaml.queries)).toBe(true);
    expect(yaml.queries.length).toBeGreaterThanOrEqual(1);
  });

  it("every query has ≥ 1 seed_doc_id and a target slug", async () => {
    const yaml = await loadYaml();
    for (const q of yaml.queries) {
      expect(q.id).toBeTruthy();
      expect(q.target).toBeTruthy();
      expect(q.purpose).toBeTruthy();
      expect(Array.isArray(q.seed_doc_ids)).toBe(true);
      expect(q.seed_doc_ids.length).toBeGreaterThanOrEqual(1);
      for (const docId of q.seed_doc_ids) {
        // Every seed DocId parses (catches malformed authority / scheme).
        expect(() => parseDocId(docId)).not.toThrow();
      }
    }
  });

  it("expected_member_count window is sensible when set (min <= max)", async () => {
    const yaml = await loadYaml();
    for (const q of yaml.queries) {
      if (q.expected_member_count) {
        const { min, max } = q.expected_member_count;
        if (typeof min === "number" && typeof max === "number") {
          expect(min).toBeLessThanOrEqual(max);
          expect(min).toBeGreaterThan(0);
        }
      }
    }
  });

  it("cluster_opts (when set) carries sensible defaults", async () => {
    const yaml = await loadYaml();
    for (const q of yaml.queries) {
      if (q.cluster_opts?.max_iterations !== undefined) {
        expect(q.cluster_opts.max_iterations).toBeGreaterThan(0);
      }
      if (q.cluster_opts?.resolution !== undefined) {
        expect(q.cluster_opts.resolution).toBeGreaterThan(0);
      }
    }
  });
});
