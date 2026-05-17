---
phase: 04-graph-as-retrieval
plan: 05
type: execute
wave: 4
depends_on:
  - 04-03
files_modified:
  - package.json
  - package-lock.json
  - src/graph/cluster.ts
  - src/graph/cluster.test.ts
  - src/graph/index.ts
  - src/db/queries/edges.ts
  - src/db/queries/edges.test.ts
  - src/tool-registry.ts
  - tsup.config.ts
autonomous: false
requirements:
  - GRA-02
user_setup: []

must_haves:
  truths:
    - "`graphology`, `graphology-communities-louvain`, and `seedrandom` are installed (with `@types/seedrandom` as dev dep) at pinned versions from RESEARCH §Standard Stack."
    - "`cluster({query | seed_doc_ids, method: \"edge-community\"})` returns deterministic Louvain communities; same input → byte-identical cluster_id assignment across runs."
    - "Determinism is enforced by: (a) sorting nodes by DocId before insertion into graphology; (b) `seedrandom('vault-memory-cluster-v1')` passed as Louvain's `rng` option; (c) `cluster_id = smallest member DocId` per community."
    - "Hard cap at 5000 nodes — beyond, return `{ok: false, reason: \"node_count_exceeded\", node_count, threshold: 5000, hint: \"pass force:true to compute\"}` unless `force: true`."
    - "Per-cluster output carries `{cluster_id, size, members: CitationPacket[], summary: {top_types, top_titles, edge_density}}` per D-14."
    - "`query` path composes existing primitives: `search_hybrid({query, limit: query_top_k ?? 50})` → `expand({seed_doc_ids: top_k, hops: 1, direction: \"both\"})` → cluster the union (D-15a)."
    - "MCP tool `cluster` registered in tool-registry with full Zod schema."
  artifacts:
    - path: "src/graph/cluster.ts"
      provides: "cluster() Louvain wrapper + node sort + seeded rng + summary computation; discriminated-union return"
      min_lines: 200
      contains: "export async function cluster"
    - path: "src/graph/cluster.test.ts"
      provides: "Determinism snapshot (same input → same cluster_id assignment); node_count_exceeded gate; query path composition; D-14 summary shape"
      contains: "describe(\"cluster\""
    - path: "package.json"
      provides: "graphology + graphology-communities-louvain + seedrandom + @types/seedrandom"
      contains: "graphology-communities-louvain"
    - path: "tsup.config.ts"
      provides: "external entries for graphology family if needed (verify during build smoke)"
      contains: "external"
    - path: "src/tool-registry.ts"
      provides: "MCP tool registration for `cluster`"
      contains: "name: \"cluster\""
  key_links:
    - from: "src/graph/cluster.ts"
      to: "graphology + graphology-communities-louvain + seedrandom"
      via: "external lib imports — ONLY allowed in cluster.ts (Pattern A)"
      pattern: "import.*graphology"
    - from: "src/graph/cluster.ts"
      to: "src/graph/expand.ts"
      via: "query-path composition (D-15a)"
      pattern: "await expand\\(vault"
---

<objective>
Wave 4 — implement community-detection tool. Pull in graphology family, wrap Louvain with a deterministic seed + DocId-sorted node insertion, and ship the discriminated-union return shape from D-13. Compose `expand()` for the `query` path (D-15a) so all primitives compose; no new graph plumbing.

Purpose: GRA-02 fulfillment. The largest dependency-surface plan in Phase 4 (3 net-new runtime deps), and the smallest blast-radius if anything slips (cluster has no v1 callers).

Output: `src/graph/cluster.ts` + co-located tests + tool-registry registration + package.json updates. Determinism contract pinned by snapshot test.

**Checkpoint:** This plan inserts a `checkpoint:human-verify` BEFORE `npm install` (per RESEARCH §Package Legitimacy Audit closing paragraph) since slopcheck CLI was unavailable.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/04-graph-as-retrieval/04-CONTEXT.md
@.planning/phases/04-graph-as-retrieval/04-RESEARCH.md
@.planning/phases/04-graph-as-retrieval/04-PATTERNS.md
@.planning/phases/04-graph-as-retrieval/04-03-expand-tool-PLAN.md
@docs/v2/adr/003-document-shape.md
@src/types.ts
@src/graph/expand.ts
@src/graph/index.ts
@src/tool-registry.ts
@package.json
@tsup.config.ts

<interfaces>
ClusterOptions:
```typescript
export type ClusterOptions =
  | { query: string; method: "edge-community"; query_top_k?: number; force?: boolean }
  | { seed_doc_ids: DocId[]; method: "edge-community"; force?: boolean };
// query and seed_doc_ids are mutually exclusive (D-15a both-present errors).
```

Result (D-13 + D-14):
```typescript
export type ClusterResult =
  | { ok: false; reason: "node_count_exceeded"; node_count: number; threshold: 5000; hint: string }
  | { ok: false; reason: "both_seeds_and_query"; hint: string }
  | { ok: true; clusters: Cluster[]; node_count: number };

export interface Cluster {
  cluster_id: DocId;            // smallest member DocId (D-12)
  size: number;
  members: CitationPacket[];
  summary: {
    top_types: Array<{ type: string; count: number }>;     // top 5 by count of properties.type
    top_titles: Array<{ title: string; degree: number }>;  // top 3 by degree within cluster (ties → DocId sort)
    edge_density: number;                                  // edges_in_cluster / (size * (size-1) / 2), 0 when size <= 1
  };
}
```

D-12 determinism contract:
1. Collect node DocIds → sort lexicographically (string compare).
2. Insert into `new Graph({type: "undirected", multi: false})` in sorted order.
3. Insert edges via `vault.db.edges.getAllForNodes(sortedNodes)` (NEW EdgesQueries method — Task 1 adds it); dedupe `(min(src,tgt), max(src,tgt))` to collapse parallel edges; skip self-loops.
4. Call `louvain.detailed(g, { rng: seedrandom("vault-memory-cluster-v1"), randomWalk: true })`.
5. `cluster_id = smallest member DocId per community` (string sort over the community's DocIds).
6. Sort returned clusters by `cluster_id` ascending.

Build-time external-marking (tsup):
- `graphology` and `graphology-communities-louvain` are pure JS ESM. Try bundling first; verify with `npm run build && node -e "import('./dist/cli.js')"` smoke. If a native binding leaks (none expected), mark as `external` in `tsup.config.ts` mirroring the existing pattern for `better-sqlite3`.
- `seedrandom` is pure JS — bundle normally.

Tool-list snapshot regen is deferred to Plan 04-07.
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking-human">
  <what-built>NOTHING YET — this checkpoint runs BEFORE `npm install`. Per RESEARCH §Package Legitimacy Audit closing paragraph: slopcheck CLI was unavailable on 2026-05-17, so we require explicit human confirmation that the three package names match the verified GitHub URLs before running `npm install`.</what-built>
  <how-to-verify>
    Confirm each package below by visiting npmjs.com AND its GitHub URL, checking:
    - npm package name matches exactly (no homoglyphs)
    - Author / org matches `RESEARCH §Package Legitimacy Audit`
    - Weekly download volume is in the right order of magnitude
    - Repo last commit is within ~12 months

    1. `graphology` — https://www.npmjs.com/package/graphology — repo https://github.com/graphology/graphology — ≥1M weekly downloads, org `graphology` (Yomguithereal et al.) — MIT
    2. `graphology-communities-louvain` — https://www.npmjs.com/package/graphology-communities-louvain — same monorepo — ≥80k weekly downloads — MIT
    3. `seedrandom` — https://www.npmjs.com/package/seedrandom — repo https://github.com/davidbau/seedrandom — ≥5M weekly downloads — MIT
    4. `@types/seedrandom` — https://www.npmjs.com/package/@types/seedrandom — DefinitelyTyped scope — bundled with `seedrandom`

    If any check fails, ABORT — do not run `npm install`.
  </how-to-verify>
  <resume-signal>Type "verified" to proceed; "abort" + reason to halt and revise.</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 1: Install deps + add `getAllForNodes` to EdgesQueries</name>
  <files>package.json, package-lock.json, src/db/queries/edges.ts, src/db/queries/edges.test.ts, tsup.config.ts</files>
  <behavior>
    - Test 1: `package.json` lists `graphology ^0.26.0`, `graphology-communities-louvain ^2.0.2`, `seedrandom ^3.0.5` under `dependencies`; `@types/seedrandom` under `devDependencies`. Versions are exactly the pinned ones from RESEARCH §Standard Stack.
    - Test 2: `npm install` exits 0; `node -e "import('graphology').then(m => console.log(typeof m.default))"` prints `function`.
    - Test 3: `npm run build` exits 0; `node -e "import('./dist/cli.js')"` exits 0 (no native binding errors).
    - Test 4: `vault.db.edges.getAllForNodes(noteIds: number[]): EdgeRowFull[]` returns ALL edges where BOTH `source_doc` and `target_doc` are in the input set. Each row carries `{source_doc, target_doc, type, anchor, line_number}`. Edges with `target_doc IS NULL` (unresolved hyperlinks) are excluded — Louvain needs resolved-DocId graph only.
    - Test 5: Empty `noteIds` → empty array; single-noteId → empty (no self-loops in `edges` since indexer skips them — verify; if not, filter here).
  </behavior>
  <action>
    1. **Install pinned deps** (after the checkpoint passes):
       ```bash
       npm install graphology@^0.26.0 graphology-communities-louvain@^2.0.2 seedrandom@^3.0.5
       npm install --save-dev @types/seedrandom
       ```
       Commit `package.json` + `package-lock.json` together.

    2. **Build smoke**: `npm run build && node -e "import('./dist/cli.js').then(() => console.log('ok'))"`. If a native binding leaks (none expected — all three are pure JS), add the offending packages to `external` in `tsup.config.ts` mirroring `better-sqlite3` (currently external per CLAUDE.md tech stack notes).

    3. **Extend EdgesQueries** with `getAllForNodes(noteIds: number[]): EdgeRowFull[]`:
       ```typescript
       getAllForNodes(noteIds: number[]): EdgeRowFull[] {
         if (noteIds.length === 0) return [];
         const placeholders = noteIds.map(() => "?").join(",");
         const sql = `
           SELECT source_doc, target_doc, type, anchor, line_number
             FROM edges
            WHERE source_doc IN (${placeholders})
              AND target_doc IN (${placeholders})
              AND target_doc IS NOT NULL
         `;
         const stmt = this.db.prepare(sql);
         return stmt.all(...noteIds, ...noteIds).map(r => ({
           sourceDoc: r.source_doc, targetDoc: r.target_doc, type: r.type,
           anchor: r.anchor, lineNumber: r.line_number,
         }));
       }
       ```
       Note: dynamic placeholder generation is acceptable here because `noteIds` are integers; no Zod-bypass risk. Cached prepares are not worth it (this method is called once per cluster() call).

       Append tests 4–5 to `src/db/queries/edges.test.ts`.

    Pattern A: zero new `fs`/`path.join` imports. graphology family imports are allowed ONLY in `src/graph/cluster.ts` (Task 2).
  </action>
  <verify>
    <automated>npm install --silent && npm run build && node -e "import('./dist/cli.js').then(() => console.log('ok'))" && npx vitest run src/db/queries/edges.test.ts</automated>
  </verify>
  <done>Deps installed; build smoke passes; `getAllForNodes` lands.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement cluster() Louvain wrapper with determinism contract</name>
  <files>src/graph/cluster.ts, src/graph/cluster.test.ts, src/graph/index.ts</files>
  <behavior>
    - Test 1 (determinism snapshot): Same fixture + same opts → byte-identical `cluster_id` assignment across two consecutive runs. (Pin via vitest `toMatchInlineSnapshot` or equivalent against the Atlas Robotics edges fixture.)
    - Test 2 (cluster_id rule): For each cluster, `cluster.cluster_id` equals the lexicographically smallest DocId among `cluster.members.map(m => m.doc_id)`.
    - Test 3 (sort): Returned `clusters` array is sorted by `cluster_id` ascending.
    - Test 4 (hard cap D-13): With `node_count > 5000` (synthesize via test fixture) and `force` omitted, returns `{ok: false, reason: "node_count_exceeded", node_count, threshold: 5000, hint: "pass force:true to compute"}`. With `force: true`, computes regardless.
    - Test 5 (mutual exclusion D-15a): Both `query` and `seed_doc_ids` provided → returns `{ok: false, reason: "both_seeds_and_query", hint}`.
    - Test 6 (query path D-15a): `cluster({query: "atlas", method: "edge-community", query_top_k: 5})` calls `search_hybrid` for top-5 → calls `expand({seed_doc_ids: top5_ids, hops: 1, direction: "both"})` → clusters the union. Top-K + expansion union is the input node set.
    - Test 7 (seed_doc_ids path): `cluster({seed_doc_ids: ["..."], method: "edge-community"})` clusters that set plus its 1-hop neighborhood (D-15a "exactly that set with their induced 1-hop neighborhood").
    - Test 8 (D-14 summary): Each cluster's `summary.top_types` is sorted-by-count desc (ties broken by alpha), capped at 5; `summary.top_titles` is sorted-by-degree-within-cluster desc (ties broken by DocId asc), capped at 3; `summary.edge_density` is in [0, 1] (0 when size ≤ 1).
    - Test 9 (no LLM): No imports from `src/ollama/`, no `fetch()`, no network calls; cluster summary fields are all pure-deterministic computations.
    - Test 10 (memory opacity inherited): `_memory` opacity is enforced via `expand()` (Plan 04-03) for the query/seed_doc_ids path; `cluster.ts` does not re-implement the rule. Verify by clustering a fixture where a `_memory` doc would be included only if opacity is bypassed — confirm it is NOT in results.
    - Test 11 (force:true with seed_doc_ids > 5000): When force=true, the computation runs; hard cap doesn't gate.
  </behavior>
  <action>
    Create `src/graph/cluster.ts` per RESEARCH Pattern 5 (lines 446–491). Header comment block cites Phase 4 / 04-05 / GRA-02 / D-10–D-15a / Pitfall 1 / Blondel et al. 2008.

    Imports (the ONLY file in `src/graph/` permitted these — Pattern A):
    ```typescript
    import Graph from "graphology";
    import louvain from "graphology-communities-louvain";
    import seedrandom from "seedrandom";
    ```

    Function signature:
    ```typescript
    export async function cluster(
      vault: Vault,
      opts: ClusterOptions,
      hybridSearch: (vault: Vault, query: string, limit: number) => Promise<SearchHit[]>,
    ): Promise<ClusterResult>;
    ```
    The `hybridSearch` injection avoids circular deps between `src/search/hybrid.ts` and `src/graph/cluster.ts` (search → graph → search). The MCP tool handler in `src/tool-registry.ts` is responsible for binding the real `hybridSearch` at call time.

    Implementation steps:
    1. **Validate mutual exclusion** (D-15a both-present errors). If `opts.query` AND `opts.seed_doc_ids` both present → return `{ok: false, reason: "both_seeds_and_query", hint: "..."}`.
    2. **Resolve seeds**:
       - `query` path: call `hybridSearch(vault, opts.query, opts.query_top_k ?? 50)` → take `doc_id`s.
       - `seed_doc_ids` path: use provided DocIds directly.
    3. **Compute 1-hop neighborhood** via `expand(vault, { seed_doc_ids, hops: 1, direction: "both" })`. The `_memory` opacity rule comes for free from `expand()` (Plan 04-03).
    4. **Build node set**: `unique([...seeds, ...expansion.documents.map(d => d.doc_id)])` → map to noteIds via `vault.db.notes.getByDocUri`.
    5. **Hard cap check (D-13)**: If `nodeIds.length > 5000 && !opts.force` → return `{ok: false, reason: "node_count_exceeded", ...}`.
    6. **Sort by DocId** (D-12 critical step — Pitfall 1): `const sortedDocIds = unique(seeds ∪ expansionDocIds).sort()` (lexicographic). Map to sortedNoteIds.
    7. **Build graphology graph**:
       ```typescript
       const g = new Graph({ type: "undirected", multi: false });
       for (const docId of sortedDocIds) g.addNode(docId);
       for (const e of vault.db.edges.getAllForNodes(sortedNoteIds)) {
         const srcDocId = noteIdToDocId.get(e.sourceDoc)!;
         const tgtDocId = noteIdToDocId.get(e.targetDoc!)!;
         if (srcDocId === tgtDocId) continue;
         const [a, b] = srcDocId < tgtDocId ? [srcDocId, tgtDocId] : [tgtDocId, srcDocId];
         if (g.hasEdge(a, b)) continue;  // collapse multi-edges to undirected single edge
         g.addEdge(a, b, { weight: 1 });
       }
       ```
    8. **Louvain with seeded RNG (D-12)**: `const rng = seedrandom("vault-memory-cluster-v1"); const detailed = louvain.detailed(g, { rng, randomWalk: true });`. `detailed.communities` is `Record<nodeId (DocId), communityIndex>`.
       - Per A4: verify by reading library source that `randomWalk + rng` covers all entropy. If a second `Math.random()` call site is found in the library, document in cluster.ts header comment as a known assumption + add a snapshot regression test that would catch drift.
    9. **Group nodes by community**: `const byCommunity = groupBy(Object.entries(detailed.communities), ([, idx]) => idx);`. For each group, compute:
       - `member_doc_ids: DocId[] = group.map(([nodeId]) => nodeId).sort()` (sort for cluster_id).
       - `cluster_id = member_doc_ids[0]` (smallest DocId).
       - Hydrate members → `CitationPacket[]` via existing `toCitationPacket` helper (same one `expand()` uses).
    10. **Summary computation (D-14)**:
        - `top_types`: histogram of `member.properties.type` (skip undefined); sort by count desc, ties alpha; take top 5.
        - `top_titles`: for each member, compute degree within the cluster (count of edges in `g` to other cluster members); sort by degree desc, ties by DocId asc; take top 3.
        - `edge_density`: number of edges in `g` where both endpoints are in the cluster ÷ `size * (size - 1) / 2`; clamp to 0 when `size ≤ 1`.
    11. **Sort clusters by cluster_id ascending** and return `{ok: true, clusters, node_count: sortedDocIds.length}`.

    Add re-exports to `src/graph/index.ts`.

    Source-neutrality: `cluster.ts` is the ONLY file in `src/graph/` that may import from `graphology*` or `seedrandom`. Update `scripts/lint-adapters.sh` allowlist if necessary (or scope the existing lint to exclude this file from the relevant grep — but it should not be needed; lint-adapters.sh checks for `fs`/`path`/`gray-matter`/`chokidar`, not `graphology`).

    Co-locate `src/graph/cluster.test.ts`. For determinism snapshot (test 1), use a tiny hand-crafted edge graph (e.g., 8 nodes, 10 edges) in the test file itself — not the Atlas Robotics fixture (which lives outside the test and could shift). The snapshot pins one specific cluster_id mapping; if Louvain returns a different partition, the test fails LOUDLY (per A3 mitigation).
  </action>
  <verify>
    <automated>npx vitest run src/graph/cluster.test.ts</automated>
  </verify>
  <done>All 11 tests green; determinism snapshot passes on repeated `vitest run`; `npm run build` smoke green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Register `cluster` MCP tool</name>
  <files>src/tool-registry.ts</files>
  <behavior>
    - Test 1: Tool dispatch for `cluster` with `{seed_doc_ids: [...], method: "edge-community"}` returns a non-error response.
    - Test 2: Zod rejects `{method: "label-propagation"}` (only `"edge-community"` is valid in v2.0.0).
    - Test 3: Zod requires EXACTLY one of `query` OR `seed_doc_ids` (use `z.union(...).refine(...)` for mutual exclusion).
    - Test 4: Zod accepts optional `query_top_k`, `force` booleans.
    - Test 5: Tool description text covers: (a) Louvain via graphology, (b) deterministic across runs (D-12), (c) 5000-node hard cap (D-13), (d) cluster_id = smallest member DocId (D-14).
  </behavior>
  <action>
    Per PATTERNS line 431–476. Add JSON Schema TOOLS entry and Zod TOOL_SCHEMAS entry for `cluster`.

    Zod (D-15a mutual exclusion):
    ```typescript
    cluster: z.union([
      z.object({
        query: z.string().min(1),
        method: z.literal("edge-community"),
        query_top_k: z.number().int().positive().max(200).optional().default(50),
        force: z.boolean().optional().default(false),
      }),
      z.object({
        seed_doc_ids: z.array(z.string().regex(DOC_ID_PATTERN)).min(1),
        method: z.literal("edge-community"),
        force: z.boolean().optional().default(false),
      }),
    ]),
    ```

    Tool description (long-form):
    > Community detection over the typed-edge graph via Louvain modularity (Blondel et al. 2008). Deterministic: same input produces byte-identical cluster_id assignment via DocId-sorted node insertion + seeded RNG. cluster_id = smallest member DocId per community. Hard-capped at 5000 nodes; pass `force: true` to override. Either `query` (composes search_hybrid + expand 1-hop) OR `seed_doc_ids` (uses provided seeds + 1-hop neighborhood); not both. Returns per-cluster `{cluster_id, size, members[], summary: {top_types, top_titles, edge_density}}`. No LLM enrichment — summary fields are pure-deterministic computations (LLM enrichment is Phase 5 brief layer's job).

    Handler in `src/server.ts` dispatch: bind `hybridSearch` to the live function at call time:
    ```typescript
    case "cluster": {
      const opts = TOOL_SCHEMAS.cluster.parse(args);
      const vault = manager.require(/* resolve from doc_id or active vault */);
      return ok(await cluster(vault, opts, async (v, q, lim) => hybridSearch({...}).hits));
    }
    ```

    Tool-list snapshot regen deferred to Plan 04-07.
  </action>
  <verify>
    <automated>npx vitest run src/server.test.ts -t "cluster"</automated>
  </verify>
  <done>cluster tool registered; Zod mutual exclusion enforced; description covers all locked rules.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client → `cluster` Zod | Validated `seed_doc_ids` / `query` / `force` flag. |
| `cluster()` → graphology + Louvain | External library calls with seeded RNG; no untrusted input reaches lib beyond DocId strings (which are validated by `DOC_ID_PATTERN`). |
| npm install supply chain | NEW external runtime deps — 3 packages (`graphology`, `graphology-communities-louvain`, `seedrandom`). Manual provenance check + checkpoint gate at install time (T-04-05-SC). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-05-01 | Tampering (determinism break) | Louvain non-determinism leaking through insertion order | mitigate | DocId-sorted node insertion (Pitfall 1); `seedrandom('vault-memory-cluster-v1')` as Louvain's `rng` option; snapshot test (test 1) catches drift. |
| T-04-05-02 | DoS | Memory exhaustion on a large vault | mitigate | Hard cap at 5000 nodes (D-13); return structured error before computing; `force: true` is an explicit opt-in for callers who accept the cost. |
| T-04-05-03 | DoS | Pathological dense graph (V=5000, E=V²) | accept | better-sqlite3 sync + 5000-node cap bounds wall-time even on a complete graph (≈12.5M edges); Louvain is O(E log V) in practice. If cluster() blocks the event loop in real-world use, Phase 5 streaming/async path is the resolution (RESEARCH Open Question 3). |
| T-04-05-04 | Information Disclosure | `_memory` docs surfacing in clusters | mitigate | Inherited from `expand()` (Plan 04-03) — cluster's input set is filtered by expand's opacity rule. Test 10 pins this. |
| T-04-05-05 | Tampering | Cluster output changes across Node minor versions | mitigate | `seedrandom('vault-memory-cluster-v1')` is deterministic across Node versions (per A3 + RESEARCH §Assumptions A3); test 1 snapshot would catch any drift; pin Node version in CI. |
| T-04-05-06 | Information Disclosure | LLM enrichment leaking into cluster summary | mitigate | D-14 hard rule: no LLM; summary fields are pure-deterministic. Test 9 verifies no `src/ollama/` or `fetch` imports. |
| T-04-05-SC | Tampering | Supply chain — slopsquat / typosquat on graphology family | mitigate | Manual provenance check documented in RESEARCH §Package Legitimacy Audit (slopcheck CLI unavailable on 2026-05-17); BLOCKING human-verify checkpoint BEFORE `npm install`; pinned versions + lockfile commit. |
</threat_model>

<verification>
**Acceptance:**
- Checkpoint passes (human-verify of three npm package names against GitHub URLs).
- `npm install` exits 0; `package-lock.json` committed.
- `npm run build && node -e "import('./dist/cli.js')"` exits 0 (build smoke).
- `npx vitest run src/graph/cluster.test.ts src/db/queries/edges.test.ts` — all tests green.
- `npm test` — full suite green (modulo deferred tool-list snapshot regen).
- `npm run lint` clean; `bash scripts/lint-adapters.sh` zero hits.
- `npm run eval:baseline` — green (cluster is a NEW tool; no v1 surface).

**Eval queries:** `_queries/cluster.yaml` snapshot lands in Plan 04-06.

**Snapshot checks:** Determinism snapshot lives INLINE in `src/graph/cluster.test.ts` (test 1 — `toMatchInlineSnapshot` over a tiny graph fixture). Tool-list snapshot regen deferred to Plan 04-07.
</verification>

<validation>
**Nyquist Dimension 8:**
- **Coverage map:**
  - GRA-02 (Louvain determinism D-12) → `src/graph/cluster.test.ts` tests 1–3
  - GRA-02 (D-13 hard cap + force override) → tests 4, 11
  - GRA-02 (D-15a mutual exclusion) → test 5
  - GRA-02 (D-15a query-path composition) → test 6
  - GRA-02 (seed_doc_ids path) → test 7
  - GRA-02 (D-14 summary shape) → test 8
  - GRA-02 (no LLM coupling) → test 9
  - GRA-02 (`_memory` opacity inherited from expand) → test 10
  - GRA-02 (MCP tool dispatch + Zod) → server.test.ts tests 1–5
  - GRA-02 (build smoke / no native binding leak) → `npm run build && node -e "..."` in verify
- **Sampling:** per-task vitest + lint; per-wave full suite + eval:baseline.
</validation>

<success_criteria>
1. Checkpoint passes — three graphology-family packages verified against GitHub URLs.
2. `npm install` succeeds; `npm run build` smoke green; no native binding leaks.
3. `cluster()` is deterministic — snapshot test 1 stable across consecutive runs.
4. D-12 contract enforced: DocId-sorted node insertion + `seedrandom('vault-memory-cluster-v1')` + `cluster_id = smallest member DocId`.
5. D-13 hard cap at 5000 nodes; structured error return; `force: true` override.
6. D-15a `query` path composes `search_hybrid + expand`; mutual exclusion enforced via Zod refine.
7. D-14 summary shape exact; no LLM imports anywhere.
8. MCP tool `cluster` registered with full Zod + descriptive text.
9. `npm test` + `npm run lint` + `scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
</success_criteria>

<commit>
Atomic commit message:

```
feat(04-05): cluster() Louvain community detection + 3 graphology deps

- deps: graphology ^0.26.0, graphology-communities-louvain ^2.0.2,
  seedrandom ^3.0.5; @types/seedrandom dev. Provenance verified via
  human-verify checkpoint (slopcheck CLI unavailable 2026-05-17).
- src/graph/cluster.ts: Louvain wrapper with D-12 determinism
  contract — DocId-sorted node insertion + seedrandom-keyed rng +
  cluster_id = smallest member DocId. D-13 hard cap at 5000 nodes
  (force:true override). D-14 summary: top_types, top_titles,
  edge_density — all pure deterministic, no LLM.
- D-15a query path composes search_hybrid + expand; seed_doc_ids path
  uses provided seeds + 1-hop neighborhood. Mutual exclusion enforced
  via Zod union + refine.
- EdgesQueries.getAllForNodes() supports cluster's edge-set retrieval.
- _memory opacity inherited from expand() (Plan 04-03).
- MCP tool `cluster` registered; tool-list snapshot regen deferred
  to Plan 04-07.

GRA-02 complete.

Refs: GRA-02, D-10, D-11, D-12, D-13, D-14, D-15a, Pitfall 1, A3, A4
```
</commit>

<output>
Create `.planning/phases/04-graph-as-retrieval/04-05-cluster-tool-SUMMARY.md` when done.
</output>
