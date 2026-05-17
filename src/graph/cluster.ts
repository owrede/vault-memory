/**
 * `cluster()` — Phase 4 / 04-05 / GRA-02 Louvain community detection.
 *
 * Runs modularity-maximizing community detection (Blondel et al. 2008)
 * over the typed-edge graph via `graphology` + `graphology-communities-
 * louvain`. Returns one entry per community with deterministic
 * `cluster_id = smallest member DocId` (D-12, D-14).
 *
 * Locked contracts (Phase 4 CONTEXT.md):
 *   - D-10  Algorithm: Louvain modularity-maximizing (over Label
 *           Propagation / Connected Components).
 *   - D-11  Implementation: pure-JS ESM via graphology + graphology-
 *           communities-louvain (no native bindings, no LLM).
 *   - D-12  Determinism contract — same input produces byte-identical
 *           `cluster_id` assignment. Enforced by:
 *             1. Sort node DocIds lexicographically BEFORE insertion.
 *             2. Insert into `new Graph({type:"undirected", multi:false})`
 *                in sorted order.
 *             3. Pass `seedrandom("vault-memory-cluster-v1")` as
 *                Louvain's `rng` option (Pitfall 1).
 *             4. `cluster_id = smallest member DocId per community`.
 *             5. Sort returned clusters by `cluster_id` ascending.
 *   - D-13  Hard cap at 5000 nodes; structured error return; `force: true`
 *           override.
 *   - D-14  Per-cluster output:
 *             { cluster_id, size, members: CitationPacket[],
 *               summary: { top_types, top_titles, edge_density } }
 *           All pure-deterministic — NO LLM enrichment (Phase 5 brief
 *           layer owns LLM coupling over cluster output).
 *   - D-15a `query` path composes existing primitives:
 *             search_hybrid({query, limit: query_top_k ?? 50})
 *               → expand({seed_doc_ids: top_k, hops: 1, direction: "both"})
 *               → cluster the union.
 *           `seed_doc_ids` path: cluster exactly that set + its induced
 *           1-hop neighborhood. Both `query` AND `seed_doc_ids` present
 *           → return `{ok:false, reason:"both_seeds_and_query"}`.
 *
 * `_memory` opacity rule (ADR-004) is INHERITED from `expand()` (Plan
 * 04-03): `cluster()` calls expand() to compute the neighborhood; the
 * opacity filter applies there. This module does NOT re-implement the
 * rule — Test 10 in cluster.test.ts verifies inheritance.
 *
 * Pitfall 1 (RESEARCH.md §"Louvain non-determinism"): a second
 * `Math.random()` call site inside the louvain library would defeat
 * the seeded RNG. The determinism snapshot test in cluster.test.ts is
 * the regression gate that would catch any future library drift on
 * this assumption.
 *
 * Adapter-seam discipline: `graphology`, `graphology-communities-
 * louvain`, and `seedrandom` are imported ONLY in this file (per Plan
 * 04-05 Pattern A). No `fs`, `path`, `gray-matter`, or `chokidar`
 * imports. The library imports are pure-JS ESM with zero native
 * bindings, so the adapter-seam invariants are not weakened.
 *
 * References:
 *   - Blondel et al. 2008, "Fast unfolding of communities in large
 *     networks" — original Louvain paper.
 *   - graphology / graphology-communities-louvain: Yomguithereal et al.,
 *     MIT-licensed, https://graphology.github.io/.
 */

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import seedrandom from "seedrandom";

import { decomposeDocId, formatDocId, parseDocId } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import type { EdgeType } from "../db/queries/edges.js";
import {
  type CitationPacket,
  displayUrlFor,
  toCitationPacket,
} from "../memory/citation-packet.js";
import type { DocId, Document, SearchHit } from "../types.js";
import type { Vault, VaultManager } from "../vault/index.js";
import { expand } from "./expand.js";

// ─── public types ────────────────────────────────────────────────────────────

/**
 * Cluster() input — discriminated by which of `query` / `seed_doc_ids`
 * is present. Both-present is a runtime error (D-15a) returned as
 * `{ok:false, reason:"both_seeds_and_query"}`; we accept either at the
 * type level and validate at call time so callers can use a single
 * `ClusterOptions` variable.
 */
export type ClusterOptions =
  | {
      query: string;
      method: "edge-community";
      query_top_k?: number;
      force?: boolean;
      seed_doc_ids?: undefined;
    }
  | {
      seed_doc_ids: DocId[];
      method: "edge-community";
      force?: boolean;
      query?: undefined;
    };

/**
 * Per-cluster output shape (D-14). All fields are pure-deterministic.
 * NO LLM enrichment — that's Phase 5 brief layer's job.
 */
export interface Cluster {
  /** Smallest member DocId in this community (lexicographic). */
  cluster_id: DocId;
  /** Member count — `members.length`. */
  size: number;
  /** Hydrated citation packets, one per member. */
  members: CitationPacket[];
  /** Pure-deterministic summary fields. */
  summary: ClusterSummary;
}

export interface ClusterSummary {
  /** Top 5 `properties.type` values by count; ties broken alpha. */
  top_types: Array<{ type: string; count: number }>;
  /** Top 3 member titles by intra-cluster degree; ties broken by DocId asc. */
  top_titles: Array<{ title: string; degree: number }>;
  /** Intra-cluster edges ÷ (size choose 2). Zero when `size ≤ 1`. */
  edge_density: number;
}

/**
 * cluster() return — discriminated union. Hard-cap and mutual-exclusion
 * errors return `{ok:false, ...}`; success returns `{ok:true, clusters,
 * node_count}` with clusters sorted by `cluster_id` ascending.
 */
export type ClusterResult =
  | {
      ok: false;
      reason: "node_count_exceeded";
      node_count: number;
      threshold: 5000;
      hint: string;
    }
  | { ok: false; reason: "both_seeds_and_query"; hint: string }
  | { ok: true; clusters: Cluster[]; node_count: number };

/**
 * Dependencies injected at call time. Mirrors `ExpandDeps` shape
 * (Plan 04-03) so production wiring and unit tests share one contract.
 *
 * `hybridSearch` is injected as a thin callback rather than imported
 * directly to avoid the `src/search/ → src/graph/cluster.ts →
 * src/search/hybrid.ts` circular dependency. The MCP tool dispatcher in
 * `src/server.ts` binds the real `hybridSearch` at call time.
 */
export interface ClusterDeps {
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  hybridSearch: (vault: Vault, query: string, limit: number) => Promise<SearchHit[]>;
}

// ─── constants (D-13) ───────────────────────────────────────────────────────

/** Hard-cap on node count (D-13). `force: true` overrides. */
const NODE_CAP = 5000;
/** Louvain seed string. Bump version when changing the determinism contract. */
const LOUVAIN_SEED = "vault-memory-cluster-v1";

// ─── public entry point ─────────────────────────────────────────────────────

/**
 * Cluster the union of seeds + their 1-hop neighborhood via Louvain
 * community detection. See file header for the full contract.
 */
export async function cluster(
  deps: ClusterDeps,
  opts: ClusterOptions,
): Promise<ClusterResult> {
  // ── D-15a mutual exclusion ────────────────────────────────────────────
  if (opts.query !== undefined && opts.seed_doc_ids !== undefined) {
    return {
      ok: false,
      reason: "both_seeds_and_query",
      hint: "Pass exactly one of `query` or `seed_doc_ids`; not both.",
    };
  }
  if (opts.query === undefined && opts.seed_doc_ids === undefined) {
    return {
      ok: false,
      reason: "both_seeds_and_query",
      hint: "Pass exactly one of `query` or `seed_doc_ids`.",
    };
  }

  // ── Resolve seeds (D-15a) ─────────────────────────────────────────────
  //
  // `query` path: search_hybrid → take top-K doc_ids → use as expand seeds.
  // `seed_doc_ids` path: use provided DocIds directly.
  let seedDocIds: DocId[] = [];
  let vault: Vault | null = null;
  let vaultName: string | null = null;
  let scheme: string | null = null;

  if (opts.query !== undefined) {
    // Resolve the vault from the active manager. cluster() composes over
    // search_hybrid which is multi-vault; we infer the working vault from
    // the FIRST hit's `doc_id`. If there are no hits, we still return an
    // empty success — no work to do, no nodes to cluster.
    const limit = opts.query_top_k ?? 50;
    // We don't have a concrete `vault` to pass in yet (search_hybrid is
    // multi-vault). The convention from the production dispatcher is to
    // pass the first configured vault as a placeholder; the deps wiring
    // in server.ts can route to all vaults if needed. For the unit-test
    // contract we use the first vault available from manager.
    const allVaults = deps.manager.list();
    if (allVaults.length === 0) {
      return { ok: true, clusters: [], node_count: 0 };
    }
    const firstVault = allVaults[0];
    if (!firstVault) {
      return { ok: true, clusters: [], node_count: 0 };
    }
    const hits = await deps.hybridSearch(firstVault, opts.query, limit);
    const ids: DocId[] = [];
    for (const h of hits) {
      if (h.doc_id !== undefined) ids.push(h.doc_id);
    }
    seedDocIds = ids;
  } else {
    seedDocIds = (opts.seed_doc_ids ?? []) as DocId[];
  }

  // Trivial empty case — no seeds → no clusters.
  if (seedDocIds.length === 0) {
    return { ok: true, clusters: [], node_count: 0 };
  }

  // ── 1-hop expansion (D-15a "induced 1-hop neighborhood") ──────────────
  //
  // The `_memory` opacity rule is inherited from expand() — we do NOT
  // re-filter here. expand() returns CitationPacketWithVia[] (already
  // filtered for opacity + superseded). For cluster() we only need the
  // doc_ids; we re-hydrate properties/titles separately below to keep
  // the per-cluster member shape consistent for both the seed path AND
  // the query path.
  const expansion = await expand(
    {
      manager: deps.manager,
      sourceConnectorFor: deps.sourceConnectorFor,
    },
    { seed_doc_ids: seedDocIds, hops: 1, direction: "both" },
  );

  // Union: seeds ∪ 1-hop expansion (deduplicated, sorted).
  const allDocIdsSet = new Set<DocId>();
  for (const s of seedDocIds) allDocIdsSet.add(s);
  for (const d of expansion.documents) allDocIdsSet.add(d.doc_id);
  const sortedDocIds = Array.from(allDocIdsSet).sort() as DocId[];

  // Resolve the working vault from the first seed (or the first
  // expansion doc). All DocIds inside a single cluster() invocation are
  // assumed to share a vault (the typed-edge BFS is per-vault per Plan
  // 04-03); cross-vault clustering is out of scope for v2.0.0.
  if (vault === null) {
    const firstId = sortedDocIds[0];
    if (firstId === undefined) {
      return { ok: true, clusters: [], node_count: 0 };
    }
    try {
      const parsed = parseDocId(firstId);
      const dec = decomposeDocId(parsed);
      vault = deps.manager.require(dec.authority);
      vaultName = dec.authority;
      scheme = dec.scheme;
    } catch {
      // Malformed DocId or unknown vault — return empty success rather
      // than crash. The expand() call above would have already returned
      // its own warnings for unknown seeds.
      return { ok: true, clusters: [], node_count: 0 };
    }
  }

  // Map DocIds ↔ noteIds for the SQL edge lookup. Skip DocIds that do
  // not resolve to a known note row (defensive — expand() may have
  // returned a doc whose note row was deleted between BFS and our
  // re-resolution).
  const docIdToNoteId = new Map<DocId, number>();
  const noteIdToDocId = new Map<number, DocId>();
  for (const docId of sortedDocIds) {
    try {
      const parsed = parseDocId(docId);
      const dec = decomposeDocId(parsed);
      if (dec.authority !== vaultName) continue; // skip cross-vault
      const note = vault.db.notes.getByPath(dec.resource);
      if (!note) continue;
      docIdToNoteId.set(docId, note.id);
      noteIdToDocId.set(note.id, docId);
    } catch {
      continue;
    }
  }

  // The actual node set is the docIds we successfully resolved.
  const resolvedDocIds = Array.from(docIdToNoteId.keys()).sort() as DocId[];

  // ── D-13 hard cap ─────────────────────────────────────────────────────
  if (resolvedDocIds.length > NODE_CAP && !opts.force) {
    return {
      ok: false,
      reason: "node_count_exceeded",
      node_count: resolvedDocIds.length,
      threshold: NODE_CAP,
      hint: "pass force:true to compute",
    };
  }

  // Empty / single node — nothing to cluster.
  if (resolvedDocIds.length === 0) {
    return { ok: true, clusters: [], node_count: 0 };
  }
  if (resolvedDocIds.length === 1) {
    const singleId = resolvedDocIds[0];
    if (singleId === undefined) {
      return { ok: true, clusters: [], node_count: 0 };
    }
    // Hydrate the lone member into a single-element cluster.
    const cp = await hydratePacket(deps, scheme!, vaultName!, singleId, vault);
    if (cp === null) {
      return { ok: true, clusters: [], node_count: 0 };
    }
    return {
      ok: true,
      node_count: 1,
      clusters: [
        {
          cluster_id: singleId,
          size: 1,
          members: [cp],
          summary: { top_types: [], top_titles: [], edge_density: 0 },
        },
      ],
    };
  }

  // ── Build graphology graph (D-12 step 1–3) ────────────────────────────
  //
  // Sorted DocId insertion is the FIRST determinism gate. The graph is
  // undirected (Louvain operates on undirected graphs) and `multi: false`
  // — parallel edges are collapsed to one. Self-loops are skipped.
  const g = new Graph({ type: "undirected", multi: false });
  for (const docId of resolvedDocIds) g.addNode(docId);

  const sortedNoteIds = resolvedDocIds.map((d) => docIdToNoteId.get(d)!);
  const edges = vault.db.edges.getAllForNodes(sortedNoteIds);
  for (const e of edges) {
    const srcDocId = noteIdToDocId.get(e.sourceDoc);
    const tgtDocId = noteIdToDocId.get(e.targetDoc);
    if (!srcDocId || !tgtDocId) continue;
    if (srcDocId === tgtDocId) continue; // skip self-loops defensively
    // Normalize endpoint order so (a,b) and (b,a) collapse to one.
    const a = srcDocId < tgtDocId ? srcDocId : tgtDocId;
    const b = srcDocId < tgtDocId ? tgtDocId : srcDocId;
    if (g.hasEdge(a, b)) continue;
    g.addEdge(a, b, { weight: 1 });
  }

  // ── Louvain with seeded RNG (D-12 step 4) ─────────────────────────────
  //
  // `randomWalk: true` keeps the algorithm's documented behavior; `rng`
  // overrides the library's internal `Math.random` use. See Pitfall 1.
  const rng = seedrandom(LOUVAIN_SEED);
  const detailed = louvain.detailed(g, {
    rng,
    randomWalk: true,
  });

  // `detailed.communities` maps nodeId (DocId) → community index.
  const communities = detailed.communities as Record<string, number>;

  // ── Group nodes by community → compute cluster_id + summary ──────────
  const byCommunity = new Map<number, DocId[]>();
  for (const [nodeId, communityIdx] of Object.entries(communities)) {
    const docId = nodeId as DocId;
    const arr = byCommunity.get(communityIdx);
    if (arr === undefined) byCommunity.set(communityIdx, [docId]);
    else arr.push(docId);
  }

  const clusters: Cluster[] = [];
  for (const [, memberDocIds] of byCommunity) {
    const sortedMembers = [...memberDocIds].sort() as DocId[];
    const firstMember = sortedMembers[0];
    if (firstMember === undefined) continue;
    const clusterId = firstMember;

    // Hydrate each member into a CitationPacket. Drop members that fail
    // to hydrate (note row deleted between BFS and now).
    const members: CitationPacket[] = [];
    for (const docId of sortedMembers) {
      const cp = await hydratePacket(deps, scheme!, vaultName!, docId, vault);
      if (cp !== null) members.push(cp);
    }
    if (members.length === 0) continue;

    const summary = computeSummary(members, sortedMembers, g);
    clusters.push({
      cluster_id: clusterId,
      size: members.length,
      members,
      summary,
    });
  }

  // ── D-12 step 5: sort clusters by cluster_id ascending ────────────────
  clusters.sort((a, b) => (a.cluster_id < b.cluster_id ? -1 : a.cluster_id > b.cluster_id ? 1 : 0));

  return { ok: true, clusters, node_count: resolvedDocIds.length };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Hydrate a single DocId into a CitationPacket via the adapter seam.
 * Returns `null` when the source connector is unavailable or the read
 * fails — callers drop the member silently (same defensive posture as
 * expand()).
 */
async function hydratePacket(
  deps: ClusterDeps,
  scheme: string,
  vaultName: string,
  docId: DocId,
  _vault: Vault,
): Promise<CitationPacket | null> {
  const source = (() => {
    try {
      return deps.sourceConnectorFor(vaultName);
    } catch {
      return null;
    }
  })();
  if (!source) return null;
  const canonicalDocId = formatDocId(scheme, vaultName, decomposeDocId(parseDocId(docId)).resource);
  let doc: Document;
  try {
    doc = await source.readDocument(canonicalDocId);
  } catch {
    return null;
  }
  return toCitationPacket(doc, displayUrlFor(canonicalDocId, source));
}

/**
 * D-14 summary computation — pure-deterministic, no LLM.
 *
 *   - `top_types`: histogram over `members[*].properties.type`, sorted
 *     by count desc; ties broken alphabetically; capped at 5.
 *   - `top_titles`: per-member intra-cluster degree (count of edges in
 *     `g` to OTHER cluster members); sorted by degree desc; ties broken
 *     by DocId ascending; capped at 3.
 *   - `edge_density`: |intra-cluster edges| / C(size, 2); 0 when
 *     `size ≤ 1`.
 */
function computeSummary(
  members: CitationPacket[],
  sortedDocIds: DocId[],
  g: Graph,
): ClusterSummary {
  const size = members.length;

  // top_types histogram.
  const typeCounts = new Map<string, number>();
  for (const m of members) {
    const t = m.properties.type;
    if (typeof t !== "string") continue;
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const topTypes = Array.from(typeCounts.entries())
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1]; // count desc
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; // alpha asc
    })
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  // Intra-cluster degree per member. A node's degree within the cluster
  // is the count of its graphology neighbors that are ALSO in the
  // sortedDocIds set.
  const memberSet = new Set<string>(sortedDocIds);
  const degreeByDocId = new Map<DocId, number>();
  for (const docId of sortedDocIds) {
    if (!g.hasNode(docId)) {
      degreeByDocId.set(docId, 0);
      continue;
    }
    let d = 0;
    for (const neighbor of g.neighbors(docId)) {
      if (memberSet.has(neighbor)) d += 1;
    }
    degreeByDocId.set(docId, d);
  }

  // Member → title + degree. Sort desc by degree, ties by DocId asc.
  const titleEntries = members.map((m) => ({
    doc_id: m.doc_id,
    title: m.title,
    degree: degreeByDocId.get(m.doc_id) ?? 0,
  }));
  titleEntries.sort((a, b) => {
    if (a.degree !== b.degree) return b.degree - a.degree;
    return a.doc_id < b.doc_id ? -1 : a.doc_id > b.doc_id ? 1 : 0;
  });
  const topTitles = titleEntries
    .slice(0, 3)
    .map(({ title, degree }) => ({ title, degree }));

  // edge_density.
  let edgeDensity = 0;
  if (size >= 2) {
    let intraEdgeCount = 0;
    // Count unique edges where both endpoints are in the cluster. We
    // iterate the cluster's nodes and count each (a,b) once by requiring
    // a < b in DocId order.
    for (const docId of sortedDocIds) {
      if (!g.hasNode(docId)) continue;
      for (const neighbor of g.neighbors(docId)) {
        if (!memberSet.has(neighbor)) continue;
        if (docId < neighbor) intraEdgeCount += 1;
      }
    }
    const possible = (size * (size - 1)) / 2;
    edgeDensity = possible > 0 ? intraEdgeCount / possible : 0;
  }

  return { top_types: topTypes, top_titles: topTitles, edge_density: edgeDensity };
}
