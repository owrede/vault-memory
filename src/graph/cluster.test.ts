/**
 * Tests for `cluster()` — Phase 4 / 04-05 / GRA-02.
 *
 * Coverage (Plan 04-05 §<behavior>):
 *   - Test 1  determinism snapshot — same input → byte-identical cluster_id
 *             assignment across two consecutive runs.
 *   - Test 2  cluster_id rule — smallest member DocId per community.
 *   - Test 3  cluster sort — returned clusters sorted by cluster_id asc.
 *   - Test 4  hard cap D-13 — node_count > 5000 + no force → structured error.
 *   - Test 5  mutual exclusion D-15a — both `query` and `seed_doc_ids` → error.
 *   - Test 6  query path D-15a — search_hybrid → expand → cluster composition.
 *   - Test 7  seed_doc_ids path — clusters the seeds + their 1-hop neighborhood.
 *   - Test 8  D-14 summary shape — top_types, top_titles, edge_density.
 *   - Test 9  no LLM — no imports from src/ollama/ in cluster.ts (static check).
 *   - Test 10 `_memory` opacity inherited from expand() — _memory targets
 *             are NOT clustered when only reachable via _memory→_memory chain.
 *   - Test 11 force:true with seed set > 5000 — computation proceeds.
 *
 * Strategy mirrors `src/graph/expand.test.ts` and `src/assembly/dossier.test.ts`:
 * in-memory SQLite fixture + stub `SourceConnector` + faked `VaultManager`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { Database } from "../db/index.js";
import type { DocId, Document, SearchHit, SourceHandle } from "../types.js";
import { VaultManager, type Vault } from "../vault/index.js";
import { cluster, type ClusterDeps } from "./cluster.js";

const VAULT_NAME = "test-vault";

// ─── fixture builder ─────────────────────────────────────────────────────────

interface FxNote {
  notePath: string;
  title: string;
  frontmatter?: Record<string, unknown>;
}

interface FxEdge {
  source: string;
  target: string;
  type: "wikilink" | "mention" | "frontmatter-ref" | "hyperlink";
}

interface Fixture {
  vault: Vault;
  manager: VaultManager;
  deps: ClusterDeps;
  hybridSearchCalls: Array<{ query: string; limit: number }>;
  hybridSearchReturn: SearchHit[];
  cleanup: () => void;
}

function buildFixture(
  notes: FxNote[],
  edges: FxEdge[] = [],
  hybridSearchReturn: SearchHit[] = [],
): Fixture {
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: "/fake/vault/path", write_enabled: false },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  const notesByPath = new Map<string, FxNote>();
  const idByPath = new Map<string, number>();
  const now = Date.now();
  for (const spec of notes) {
    notesByPath.set(spec.notePath, spec);
    const res = vault.db.notes.upsertByPath({
      path: spec.notePath,
      content: spec.title,
      frontmatter: spec.frontmatter ? JSON.stringify(spec.frontmatter) : null,
      title: spec.title,
      hash: `hash-${spec.notePath}`,
      bodyHash: `bhash-${spec.notePath}`,
      mtime: now,
      wordCount: 1,
      vaultName: VAULT_NAME,
    });
    idByPath.set(spec.notePath, res.id);
  }

  const bySource = new Map<string, FxEdge[]>();
  for (const e of edges) {
    if (!idByPath.has(e.source)) throw new Error(`fixture edge.source missing: ${e.source}`);
    if (!idByPath.has(e.target)) throw new Error(`fixture edge.target missing: ${e.target}`);
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source)?.push(e);
  }
  for (const [src, group] of bySource) {
    const srcId = idByPath.get(src) as number;
    const inputs = group.map((e, idx) => ({
      targetNoteId: idByPath.get(e.target) ?? null,
      targetPath: e.target,
      type: e.type,
      rel: null,
      anchor: null,
      lineNumber: idx + 1,
      linkText: null,
    }));
    vault.db.edges.insertBatch(srcId, inputs);
  }

  const source: SourceHandle = parseSourceHandle(`obsidian-fs://${VAULT_NAME}`);
  const sourceConnectorFor = (_vaultName: string): SourceConnector => ({
    handle: source,
    capabilities: {
      bodyShape: "flat-text",
      properties: "untyped",
      linkTypes: [],
      identityStable: true,
      permissions: false,
      contentHashStable: true,
      refHashKind: "content",
      watch: "push",
    },
    listDocuments: async function* () {
      // not used
    },
    readDocument: async (id: DocId): Promise<Document> => {
      for (const [notePath, spec] of notesByPath) {
        if (id.endsWith(`/${notePath}`)) {
          return {
            id,
            source,
            title: spec.title,
            blocks: [{ kind: "paragraph", text: spec.title }],
            properties: { ...(spec.frontmatter ?? {}) },
            links: [],
            mtime: now,
            hash: `hash-${notePath}`,
          };
        }
      }
      throw new Error(`Doc not found: ${id}`);
    },
    hash: async (id: DocId) => {
      for (const [notePath] of notesByPath) {
        if (id.endsWith(`/${notePath}`)) return `hash-${notePath}`;
      }
      throw new Error(`Doc not found: ${id}`);
    },
    exists: async (id: DocId) => {
      for (const notePath of notesByPath.keys()) {
        if (id.endsWith(`/${notePath}`)) return true;
      }
      return false;
    },
    formatDisplayUrl: (id: DocId): string => {
      const schemeEnd = (id as string).indexOf("://");
      const rest = (id as string).slice(schemeEnd + 3);
      const slashIdx = rest.indexOf("/");
      const vaultName = rest.slice(0, slashIdx);
      const resource = rest.slice(slashIdx + 1);
      return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(resource)}`;
    },
  });

  const hybridSearchCalls: Array<{ query: string; limit: number }> = [];
  const hybridSearch = async (
    _vault: Vault,
    query: string,
    limit: number,
  ): Promise<SearchHit[]> => {
    hybridSearchCalls.push({ query, limit });
    return hybridSearchReturn;
  };

  return {
    vault,
    manager,
    deps: { manager, sourceConnectorFor, hybridSearch },
    hybridSearchCalls,
    hybridSearchReturn,
    cleanup: () => db.close(),
  };
}

function docIdFor(path: string): DocId {
  return formatDocId("obsidian-fs", VAULT_NAME, path);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("cluster() — Plan 04-05 / GRA-02", () => {
  let fx: Fixture;
  afterEach(() => {
    fx?.cleanup();
  });

  // ── Test 1: determinism snapshot ────────────────────────────────────────
  it("Test 1: determinism — same input produces byte-identical cluster_id assignment", async () => {
    // Hand-crafted 8-node graph with two clear communities + a bridge.
    // {a,b,c} triangle + {d,e,f} triangle + g-h pair + a-d bridge.
    // Determinism contract: cluster_id assignment must be stable across
    // consecutive runs of cluster() with the same inputs.
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A", frontmatter: { type: "Project" } },
        { notePath: "b.md", title: "B", frontmatter: { type: "Project" } },
        { notePath: "c.md", title: "C", frontmatter: { type: "Person" } },
        { notePath: "d.md", title: "D", frontmatter: { type: "Project" } },
        { notePath: "e.md", title: "E", frontmatter: { type: "Person" } },
        { notePath: "f.md", title: "F", frontmatter: { type: "Person" } },
        { notePath: "g.md", title: "G" },
        { notePath: "h.md", title: "H" },
      ],
      [
        { source: "a.md", target: "b.md", type: "wikilink" },
        { source: "b.md", target: "c.md", type: "wikilink" },
        { source: "c.md", target: "a.md", type: "wikilink" },
        { source: "d.md", target: "e.md", type: "wikilink" },
        { source: "e.md", target: "f.md", type: "wikilink" },
        { source: "f.md", target: "d.md", type: "wikilink" },
        { source: "g.md", target: "h.md", type: "wikilink" },
        { source: "a.md", target: "d.md", type: "wikilink" }, // bridge
      ],
    );
    const seeds = [
      docIdFor("a.md"),
      docIdFor("b.md"),
      docIdFor("c.md"),
      docIdFor("d.md"),
      docIdFor("e.md"),
      docIdFor("f.md"),
      docIdFor("g.md"),
      docIdFor("h.md"),
    ];
    const r1 = await cluster(fx.deps, {
      seed_doc_ids: seeds,
      method: "edge-community",
    });
    const r2 = await cluster(fx.deps, {
      seed_doc_ids: seeds,
      method: "edge-community",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    // Byte-identical cluster_id assignment.
    const sig1 = r1.clusters
      .map((c) => `${c.cluster_id}=${c.members.map((m) => m.doc_id).sort().join(",")}`)
      .join("|");
    const sig2 = r2.clusters
      .map((c) => `${c.cluster_id}=${c.members.map((m) => m.doc_id).sort().join(",")}`)
      .join("|");
    expect(sig1).toBe(sig2);
    // And node_count matches the input set size.
    expect(r1.node_count).toBe(8);
  });

  // ── Test 2: cluster_id = smallest member DocId ──────────────────────────
  it("Test 2: cluster_id equals the lexicographically smallest member DocId", async () => {
    fx = buildFixture(
      [
        { notePath: "p.md", title: "P" },
        { notePath: "q.md", title: "Q" },
        { notePath: "r.md", title: "R" },
      ],
      [
        { source: "p.md", target: "q.md", type: "wikilink" },
        { source: "q.md", target: "r.md", type: "wikilink" },
        { source: "p.md", target: "r.md", type: "wikilink" },
      ],
    );
    const seeds = [docIdFor("p.md"), docIdFor("q.md"), docIdFor("r.md")];
    const res = await cluster(fx.deps, {
      seed_doc_ids: seeds,
      method: "edge-community",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const c of res.clusters) {
      const memberIds = c.members.map((m) => m.doc_id).sort();
      expect(c.cluster_id).toBe(memberIds[0]);
    }
  });

  // ── Test 3: clusters sorted by cluster_id ascending ─────────────────────
  it("Test 3: returned clusters sorted by cluster_id ascending", async () => {
    fx = buildFixture(
      [
        { notePath: "z.md", title: "Z" },
        { notePath: "y.md", title: "Y" },
        { notePath: "a.md", title: "A" },
        { notePath: "b.md", title: "B" },
      ],
      [
        { source: "z.md", target: "y.md", type: "wikilink" },
        { source: "a.md", target: "b.md", type: "wikilink" },
      ],
    );
    const seeds = [docIdFor("z.md"), docIdFor("y.md"), docIdFor("a.md"), docIdFor("b.md")];
    const res = await cluster(fx.deps, {
      seed_doc_ids: seeds,
      method: "edge-community",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.clusters.map((c) => c.cluster_id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  // ── Test 4: hard cap (D-13) ─────────────────────────────────────────────
  it("Test 4: node_count > 5000 + no force → node_count_exceeded error", async () => {
    // Synthesize a 5001-note fixture cheaply: linear chain so each seed
    // expands to one neighbor → total node set is 5001.
    const notes: FxNote[] = [];
    const edges: FxEdge[] = [];
    for (let i = 0; i < 5001; i += 1) {
      notes.push({ notePath: `n${i}.md`, title: `N${i}` });
      if (i > 0) {
        edges.push({ source: `n${i - 1}.md`, target: `n${i}.md`, type: "wikilink" });
      }
    }
    fx = buildFixture(notes, edges);
    const seeds: DocId[] = notes.map((n) => docIdFor(n.notePath));
    const res = await cluster(fx.deps, {
      seed_doc_ids: seeds,
      method: "edge-community",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("node_count_exceeded");
    if (res.reason !== "node_count_exceeded") return;
    expect(res.node_count).toBeGreaterThan(5000);
    expect(res.threshold).toBe(5000);
    expect(res.hint).toContain("force");
  }, 30_000);

  // ── Test 5: mutual exclusion (D-15a) ────────────────────────────────────
  it("Test 5: both query and seed_doc_ids → both_seeds_and_query error", async () => {
    fx = buildFixture([{ notePath: "a.md", title: "A" }]);
    const res = await cluster(fx.deps, {
      query: "anything",
      seed_doc_ids: [docIdFor("a.md")],
      method: "edge-community",
    } as never);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("both_seeds_and_query");
  });

  // ── Test 6: query path composition (D-15a) ──────────────────────────────
  it("Test 6: query path composes search_hybrid → expand → cluster", async () => {
    // search_hybrid returns 2 hits → cluster expands each by 1 hop and
    // clusters the union. Confirm hybridSearch was called with the
    // expected (query, limit).
    fx = buildFixture(
      [
        { notePath: "x1.md", title: "X1" },
        { notePath: "x2.md", title: "X2" },
        { notePath: "x3.md", title: "X3" },
      ],
      [
        { source: "x1.md", target: "x3.md", type: "wikilink" },
        { source: "x2.md", target: "x3.md", type: "wikilink" },
      ],
      // hybridSearch stub returns x1 + x2 as hits.
      [
        {
          vault: VAULT_NAME,
          notePath: "x1.md",
          noteTitle: "X1",
          chunkText: "",
          chunkIdx: 0,
          headingPath: null,
          score: 0.9,
          doc_id: docIdFor("x1.md"),
        },
        {
          vault: VAULT_NAME,
          notePath: "x2.md",
          noteTitle: "X2",
          chunkText: "",
          chunkIdx: 0,
          headingPath: null,
          score: 0.8,
          doc_id: docIdFor("x2.md"),
        },
      ],
    );
    const res = await cluster(fx.deps, {
      query: "atlas",
      method: "edge-community",
      query_top_k: 5,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // hybridSearch was called once with (query, limit).
    expect(fx.hybridSearchCalls).toHaveLength(1);
    expect(fx.hybridSearchCalls[0]).toEqual({ query: "atlas", limit: 5 });
    // Node set = seeds (x1, x2) ∪ 1-hop expansion (x3) = 3 nodes.
    expect(res.node_count).toBe(3);
    // At least one cluster surfaces.
    expect(res.clusters.length).toBeGreaterThan(0);
  });

  // ── Test 7: seed_doc_ids path with induced 1-hop neighborhood ───────────
  it("Test 7: seed_doc_ids path clusters seeds + induced 1-hop neighborhood", async () => {
    // Seed = a only; 1-hop expansion brings b and c into the node set.
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "b.md", title: "B" },
        { notePath: "c.md", title: "C" },
      ],
      [
        { source: "a.md", target: "b.md", type: "wikilink" },
        { source: "a.md", target: "c.md", type: "wikilink" },
      ],
    );
    const res = await cluster(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      method: "edge-community",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Node set = {a, b, c} via 1-hop expansion.
    expect(res.node_count).toBe(3);
    // All three docs appear across the clusters.
    const allMembers = res.clusters.flatMap((c) => c.members.map((m) => m.doc_id)).sort();
    expect(allMembers).toEqual([docIdFor("a.md"), docIdFor("b.md"), docIdFor("c.md")].sort());
  });

  // ── Test 8: D-14 summary shape ─────────────────────────────────────────
  it("Test 8: D-14 summary — top_types, top_titles, edge_density well-formed", async () => {
    fx = buildFixture(
      [
        { notePath: "p1.md", title: "P1", frontmatter: { type: "Project" } },
        { notePath: "p2.md", title: "P2", frontmatter: { type: "Project" } },
        { notePath: "p3.md", title: "P3", frontmatter: { type: "Person" } },
      ],
      [
        { source: "p1.md", target: "p2.md", type: "wikilink" },
        { source: "p2.md", target: "p3.md", type: "wikilink" },
        { source: "p1.md", target: "p3.md", type: "wikilink" },
      ],
    );
    const res = await cluster(fx.deps, {
      seed_doc_ids: [docIdFor("p1.md"), docIdFor("p2.md"), docIdFor("p3.md")],
      method: "edge-community",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Combine clusters — across all clusters, sum of sizes = 3.
    const sumSize = res.clusters.reduce((acc, c) => acc + c.size, 0);
    expect(sumSize).toBe(3);
    for (const c of res.clusters) {
      // top_types capped at 5
      expect(c.summary.top_types.length).toBeLessThanOrEqual(5);
      // top_titles capped at 3
      expect(c.summary.top_titles.length).toBeLessThanOrEqual(3);
      // edge_density in [0, 1]
      expect(c.summary.edge_density).toBeGreaterThanOrEqual(0);
      expect(c.summary.edge_density).toBeLessThanOrEqual(1);
      // top_types entries sorted by count desc
      for (let i = 1; i < c.summary.top_types.length; i += 1) {
        expect(c.summary.top_types[i - 1]!.count).toBeGreaterThanOrEqual(
          c.summary.top_types[i]!.count,
        );
      }
      // top_titles entries sorted by degree desc
      for (let i = 1; i < c.summary.top_titles.length; i += 1) {
        expect(c.summary.top_titles[i - 1]!.degree).toBeGreaterThanOrEqual(
          c.summary.top_titles[i]!.degree,
        );
      }
    }
    // If a cluster contains the full triangle p1+p2+p3, edge_density === 1.
    const triangle = res.clusters.find((c) => c.size === 3);
    if (triangle) expect(triangle.summary.edge_density).toBeCloseTo(1, 5);
  });

  // ── Test 9: no LLM coupling — static check on cluster.ts source ────────
  it("Test 9: cluster.ts does not import from src/ollama/ and contains no fetch()", () => {
    const src = readFileSync(resolve(__dirname, "cluster.ts"), "utf8");
    // No imports from the ollama client.
    expect(src).not.toMatch(/from\s+["'][^"']*ollama[^"']*["']/);
    // No fetch() calls — cluster() is pure-local computation.
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  // ── Test 10: _memory opacity inherited from expand() ───────────────────
  it("Test 10: _memory targets reachable only via _memory→_memory chain are not clustered", async () => {
    // Setup: user note a links to _memory/m1; _memory/m1 links to _memory/m2.
    // Cluster with seed=a, hops=1 (inside cluster()): expand picks up _memory/m1
    // (user-linked), but not _memory/m2 (only reachable via _memory→_memory).
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "_memory/m1.md", title: "M1" },
        { notePath: "_memory/m2.md", title: "M2" },
      ],
      [
        { source: "a.md", target: "_memory/m1.md", type: "wikilink" },
        { source: "_memory/m1.md", target: "_memory/m2.md", type: "wikilink" },
      ],
    );
    const res = await cluster(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      method: "edge-community",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const allMembers = res.clusters.flatMap((c) => c.members.map((m) => m.doc_id));
    // _memory/m2 must NOT appear (opacity rule inherited from expand).
    expect(allMembers).not.toContain(docIdFor("_memory/m2.md"));
    // _memory/m1 MAY appear (user-linked from a.md).
    // a.md must appear (it's a seed; seeds always anchor cluster).
    expect(allMembers).toContain(docIdFor("a.md"));
  });

  // ── Test 11: force:true bypasses the hard cap ──────────────────────────
  it("Test 11: force:true allows computation past the 5000-node cap", async () => {
    // Use 5001 disconnected nodes — Louvain handles isolates trivially.
    const notes: FxNote[] = [];
    for (let i = 0; i < 5001; i += 1) {
      notes.push({ notePath: `f${i}.md`, title: `F${i}` });
    }
    fx = buildFixture(notes, []);
    const seeds: DocId[] = notes.map((n) => docIdFor(n.notePath));
    const res = await cluster(fx.deps, {
      seed_doc_ids: seeds,
      method: "edge-community",
      force: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.node_count).toBeGreaterThan(5000);
  }, 60_000);
});
