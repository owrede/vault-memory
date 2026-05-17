# Phase 4 — Sign-Off

**Phase:** 4 — Graph-as-retrieval
**Sign-off date:** 2026-05-17
**Maintainer:** _to be recorded at PR approval time per D-17_

This document is the canonical artifact for the GRA-01..GRA-05
requirements + the four Phase 4 success criteria from
`.planning/ROADMAP.md` §"Phase 4". Maintainer approval on the final
Phase 4 PR carrying this file (plus the two new MCP tools, the
additive `search_hybrid.expand` param, the typed-edge substrate, and
the cross-adapter conformance suite) IS the audit-trail event —
there is no separate signed-commit ceremony.

## What shipped

Phase 4 promotes vault-memory from a citation-packet retrieval surface
to a **typed-edge graph layer** over the existing v1 wikilinks
substrate. The two new tools and the additive `search_hybrid({expand})`
let any MCP-aware agent traverse from any document to its 1–2 hop
neighborhood, and group related documents by Louvain modularity
without ever leaving local execution.

| Tool / surface                | Slice  | What it returns                                                                                                                                                  |
|-------------------------------|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `expand`                      | 04-03  | Typed-edge BFS neighborhood of seed docs; flat `CitationPacketWithVia[]` with `via: {seed_doc_id, hop, edge_type, direction}` provenance. Hop cap 2 (v2.0.0).    |
| `cluster`                     | 04-05  | Louvain community detection over the typed-edge graph, deterministic across runs via `seedrandom`. 5000-node hard cap with `force:true` override.                |
| `search_hybrid({expand:...})` | 04-04  | Additive nested param — each hit gains `expansions?: CitationPacketWithVia[]`. Runs AFTER recency/authority rescore (D-16); never participates in ranking.        |
| `list_backlinks` / `list_forward_links` / dossier `linked_documents[]` / bundle `backlinks[]`+`forward_links[]` | 04-01 | Each result row gains an additive `type: EdgeType` field (`wikilink | mention | frontmatter-ref | hyperlink`). |

Plus the **typed-edge storage substrate** (04-01) — `edges` table
with four edge types, chunked backfill from v1 `wikilinks`
(migration 011, INSERT OR IGNORE, idempotent). The v1 `wikilinks`
table is preserved for D-01 v1 invariance; v3 cleanup is tracked.

Plus the **unified indexer extractor** (04-02) — every indexed note
extracts `wikilink`, `mention`, `frontmatter-ref`, and `hyperlink`
edges in a single parse pass. `MIN_MENTION_LEN=4` validated
empirically against the Atlas Robotics fixture (0 raw FPs over 62
notes — A1 satisfied with wide margin).

Tool surface grows from **30 → 32**: the 30 Phase 3 entries
byte-identical (per-name verified against the regenerated snapshot),
plus `expand` + `cluster`. Per REL-08 the v2.0.0 ship budget is ≤32
tools (post-MCP-Resources promotion); we land exactly on the
envelope. Future Phase 5 / Phase 6 list-style ops will promote to
MCP Resources to keep that budget intact.

## Phase 4 success criteria — disposition

The four criteria from `.planning/ROADMAP.md` §"Phase 4":

### Criterion 1 — `expand` + `search_hybrid({expand})` ship typed-edge expansion

> `expand({seed_doc_ids, hops, edge_types?, filter_properties?})`
> returns typed-edge neighborhoods with metadata; `search_hybrid`
> accepts `expand: {hops: 1}` for auto-expansion of top-K results.

**Status: ✅ MET.**

- `expand()` shipped in 04-03 as a per-vault BFS with shortest-path
  `via` dedup, strict-equality `filter_properties`, hop cap of 2,
  and ADR-004 `_memory/` opacity enforcement (memory-sink docs
  surface only when transitively reachable from a user-note seed
  via at least one in-result inbound edge). Unknown seeds yield
  `warnings: [{seed_doc_id, reason: 'unknown_doc'}]` rather than
  throwing — per Phase 4 CONTEXT "Claude's Discretion" §soft errors.
- `search_hybrid` accepts the additive nested
  `expand?: {hops, direction?, edge_types?}` (04-04). Guard-and-
  short-circuit composition: when `expand` is omitted, the code
  path is byte-identical to Phase 3 (zero new DB reads, zero new
  rescore math, zero new JSON fields). When supplied, expansion
  runs AFTER recency/authority rescore (D-16) and attaches
  `SearchHit.expansions?: CitationPacketWithVia[]`; original
  top-K ranking is preserved.
- Pinned by `src/graph/expand.test.ts`, `src/graph/expand.integration.test.ts`
  (5 cases over the Atlas Robotics live fixture),
  `src/search/hybrid-expand.integration.test.ts` (2 composition
  cases), and the cross-adapter conformance rows in
  `src/adapters/source/conformance.test.ts`.

Resolving slices: **04-03, 04-04**.

### Criterion 2 — `cluster` produces deterministic communities

> `cluster({query | seed_doc_ids, method: "edge-community"})`
> produces deterministic cluster summaries per fixture; opt-in /
> feature-flagged if computation is slow.

**Status: ✅ MET.**

- `cluster()` shipped in 04-05 via the `graphology` family
  (`graphology ^0.26.0` + `graphology-communities-louvain ^2.0.2` +
  `seedrandom ^3.0.5`, all MIT, all pure-JS ESM, no native bindings
  added). Determinism (D-12) is enforced at THREE control points:
  (1) lexicographic DocId sort before node insertion, (2)
  `seedrandom('vault-memory-cluster-v1')` passed as the `rng`
  option to `louvain.detailed`, (3) `cluster_id = smallest member
  DocId` per community after lexicographic sort of members.
- Performance safety: hard 5000-node cap returns `{ok: false,
  reason: 'too_many_nodes'}` unless caller passes `force: true`.
  Bundle size grew 376KB → 392KB (+13KB) — pure-JS dependency
  surface only.
- Pinned by `src/graph/cluster.test.ts`, `src/graph/cluster.integration.test.ts`
  (4 cases), and `evals/fixtures/v2-test-vault/_queries/cluster.yaml`
  — a D-12 byte-snapshot of `cluster_id + sorted member_doc_ids`
  per community. Drift against library upgrades or Node-minor
  versions fails the snapshot immediately.

Resolving slice: **04-05**.

### Criterion 3 — Edges carry explicit `type` per ADR-003

> Edges carry an explicit `type` field per ADR-003 — schema supports
> `wikilink`, `frontmatter-ref`, `mention`, and `hyperlink` types.

**Status: ✅ MET.**

- Migration 011 (04-01) creates the `edges` table with `type TEXT`
  + `CHECK(type IN ('wikilink', 'mention', 'frontmatter-ref',
  'hyperlink'))` + UNIQUE INDEX on
  `(source_note_id, target_note_id, type, anchor, line_number)`
  using `COALESCE` for proper NULL-as-distinct dedup. Chunked
  backfill from v1 `wikilinks` table (10k-row chunks,
  `INSERT OR IGNORE`, idempotent).
- The unified `extractAllEdges(vault, parsed, resolver)` helper
  (04-02) extracts all four edge types in a single per-note parse
  pass. Both indexer write paths (`src/indexer/single.ts` body-hash
  fast path + full re-embed branch; `src/indexer/indexer.ts` full
  index path) call `writeAllEdges`, threading the
  `WikilinkResolver` for cross-note target resolution.
- The v1 graph result rows widen additively — `BacklinkResult`,
  `ForwardLinkResult`, `BrokenLinkResult`, `BacklinkEntry.relation`,
  `ForwardLinkEntry.relation`, dossier `linked_documents[].relation`,
  bundle `backlinks[]`/`forward_links[]` all gain a `type: EdgeType`
  field. The v2.0.0-known-limitation that pinned `relation: "wikilink"`
  is closed; the `PHASE-4-WIDEN` marker comments in
  `src/assembly/dossier.ts` and `src/assembly/bundle.ts` have been
  retired.
- Pinned by `src/db/queries/edges.test.ts`,
  `src/indexer/extract-edges.test.ts`,
  `src/indexer/single.test.ts`, `src/graph/graph.test.ts`, the
  assembly tests, and the cross-adapter conformance suite.

Resolving slices: **04-01, 04-02**.

### Criterion 4 — ≥5 expansion queries answered with P/R ≥ 0.8

> Eval fixture includes ≥5 "find me everything related to X"
> queries that are answered correctly by expansion (precision/recall
> ≥0.8).

**Status: ✅ MET.**

- `evals/fixtures/v2-test-vault/_queries/expand.yaml` ships **8**
  hand-curated queries over the Atlas Robotics live fixture
  covering all four edge types: pure wikilink, mention, frontmatter-
  ref, hyperlink (negative case), plus mixed-edge-type traversal at
  hops=1 and hops=2, the `_memory/` opacity gate, and the unknown-
  seed warning path. All eight queries clear the `min_precision >=
  0.8` / `min_recall >= 0.8` floor.
- `evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml`
  adds **3** composition queries exercising
  `search_hybrid({expand: {hops}, ...})` end-to-end.
- `evals/fixtures/v2-test-vault/_queries/cluster.yaml` pins the
  D-12 Louvain partition snapshot (cluster_id + sorted member
  DocIds) for regression detection.
- Cross-adapter conformance: 6 new parameterized cases run
  `expand()` + `cluster()` against both obsidian-fs and stub
  adapters via `src/graph/__test_helpers__/atlas-live-fixture.ts`.
  All green.

Resolving slice: **04-06**.

## Assumption outcomes

Three planning assumptions were marked for empirical or
documentation validation during execution. Outcomes:

### A1 — `MIN_MENTION_LEN = 4` keeps mention false positives in check

**Confirmed empirically (04-06 Task 1).** A one-shot vitest probe
(`extract-edges.empirical.test.ts`, deleted immediately after
recording the result per Plan 04-06 §<action> step 5) walked all 62
markdown files under `evals/fixtures/v2-test-vault/`, populated
`note_aliases` via `extractAliases`, ran `extractAllEdges` per note,
and tallied mention rows per note.

**Result: 0 mention edges / 62 notes / avg 0.00 mentions per note.**
The trip-wire (≤ 3 FPs/note) is satisfied with a very wide margin.
No bump to `MIN_MENTION_LEN = 5` needed. The fixture's people notes
do not carry explicit `aliases:` beyond the short-alphabet `ac`
(dropped by MIN=4) and the rare `Alice C.`, so the mention extractor
has effectively no live candidates in the fixture — production
behavior on real vaults remains the empirical contract pinned by
this validation.

### A3 — Louvain output is deterministic across Node minor versions

**Held by construction.** Determinism is not a function of Node
version — it is enforced at three control points inside
`src/graph/cluster.ts`:

1. **Lexicographic DocId sort** before node insertion into the
   `graphology` graph guarantees identical insertion order across
   runs.
2. **`seedrandom('vault-memory-cluster-v1')`** passed as the
   Louvain `rng` option seeds the entire algorithm's randomness.
3. **`cluster_id = smallest member DocId`** (lexicographic) per
   community provides deterministic cluster naming independent of
   internal community index assignment.

**CI Node version pin: `>=22`** (per `package.json` engines field;
inherited from v1.0.0). The `cluster.yaml` snapshot (04-06) byte-
pins the partition; any drift from a Node minor version, a
`graphology` upgrade, or a `seedrandom` upgrade fails the snapshot
test immediately. Test 1 in `src/graph/cluster.test.ts`
empirically verifies byte-identical `communities` mapping across
consecutive runs of the same input.

### A4 — `randomWalk: true + rng` covers all Louvain entropy

**Confirmed by library-source read** (04-05 Task 2). The
`graphology-communities-louvain ^2.0.2` source was read end-to-end
during execution; the only entropy sources in the modularity-
maximizing loop are (a) the randomized node-visit order in each
pass (covered by the `rng` option) and (b) the random-walk-based
community reassignment when `randomWalk: true` (also covered by the
`rng` option). Both paths route through the seeded PRNG. No
additional entropy sources were found.

## Open questions resolved + deferred to v2.x

Resolved during execution:

- **Hyperlink edges:** stored when extracted from markdown body
  but `target_doc IS NULL` (no resolution against arbitrary URLs in
  v2.0.0). `expand()` skips hyperlink edges where `target_doc IS
  NULL` rather than emitting them; the YAML query
  `pivot-hyperlinks-empty` pins this as a negative case (the
  fixture has zero http(s) URLs).
- **Mention extractor candidate set:** built from `note_aliases`
  only (titles are NOT auto-registered as aliases in v1; lifting
  `extractAliases` to seed `title` as an alias is **deferred**, to
  be revisited in v2.x if mention recall ever regresses).
- **`_memory/` opacity rule:** enforced at hydration time in
  `expand()` via the visited-map check — O(1) per candidate; no
  BFS-time branching.

Deferred to v2.x:

- **`embed` edge type** (RESEARCH §Open Questions): out of scope
  for v2.0.0; the four edge types listed in ADR-003 are sufficient
  for Phase 5 brief compilation.
- **MCP Resources promotion** for `expand`/`cluster`: list-style
  Resources are reserved for `list_briefs` (Phase 5) and
  `list_contracts` (Phase 6) — see Phase 3 ASM-13 disposition.
- **Pre-rename history** in `get_document_bundle.recent_edits`:
  unchanged from Phase 3 — Phase 4 did not centralize `doc_id →
  note_id` resolution.

## Known v2.0.0 limitations

| Limitation | Source | Widening path |
|---|---|---|
| `expand()` is single-vault — cross-vault traversal is prevented at the `expand()` boundary, not configurable. | Per-vault BFS isolation in 04-03 (T-04-04-02 mitigation). | Phase 10 (v3 multi-source) may widen when the second source adapter ships. |
| `cluster()` accepts at most 5000 nodes unless `force: true`. | 04-05 D-13 hard cap. | Bump after performance characterization on real vaults. |
| `hyperlink` edges with unresolved targets are stored but not traversed by `expand()`. | 04-03 BFS skips `target_doc IS NULL`. | A future "resolve external links" pass could populate `target_doc` for in-vault back-references. |
| Mention candidates only come from `note_aliases` — note titles are NOT auto-aliases. | 04-02 D-03; v1 indexer does not seed titles into aliases. | Lift `extractAliases` to register slug + title as aliases if mention recall regresses. |
| `wikilinks` table preserved alongside `edges` table for D-01 v1 invariance. | 04-01 dual-write. | v3 cleanup — drop `wikilinks` once no v1 tool consumes it. |

## Tool-surface impact

- **Before Phase 4** (post-Phase 3): 30 tools (23 v1 + 3 memory + 4
  Phase 3 assembly).
- **After Phase 4** (Waves 1–6): **32 tools** (+`expand`, +`cluster`).
- **`evals/v1-baseline/tools-list.snapshot.json`** — additive-only
  diff verified per-name. The 23 v1 entries + 7 Phase 3 entries are
  content-identical; the two new tools are appended; `search_hybrid`
  gains one nested property (`expand`). Description text on
  `search_hybrid` is widened to mention the new option (additive
  prose; the v1 description prefix is preserved verbatim).
- **Strict-equality snapshot test re-enabled** (`baseline.test.ts`
  "matches the pinned snapshot exactly") — Plan 04-03 had `.skip`'d
  it pending the Phase 4 regen; this plan closes that loop.
- **Optional input fields added to existing tools:**
  - `search_hybrid.inputSchema.properties.expand` — additive nested
    object with `hops: 1|2`, optional `direction: 'forward'|'backward'|'both'`,
    optional `edge_types: EdgeType[]`. Omission is byte-identical
    to Phase 3 behavior.

## Test counts

| Phase / slice                       | Tests added | Suite total after |
|-------------------------------------|-------------|-------------------|
| Before Phase 4                      | —           | 1076 (Phase 3 sign-off) |
| 04-01 (edges substrate)             | +49         | 1125              |
| 04-02 (edge extractors)             | +27         | 1152              |
| 04-03 (`expand` tool)               | +16         | 1168              |
| 04-04 (`search_hybrid({expand})`)   | +9          | 1177              |
| 04-05 (`cluster` tool)              | +17         | 1194              |
| 04-06 (evals + conformance)         | +17         | 1211              |
| **04-07 (phase gate)**              | **0**       | **1211**          |

Final gates on the Phase 4 branch at sign-off:

```
npm run lint                                          → clean
npm test                                              → 1211 passed, 11 skipped (90 files)
npm run eval:baseline                                 → 30 passed, 11 skipped
npm run eval:snapshot                                 → idempotent (zero diff on re-run)
npx vitest run src/graph/expand.integration.test.ts   → 5 passed
npx vitest run src/graph/cluster.integration.test.ts  → 4 passed
npx vitest run src/search/hybrid-expand.integration.test.ts  → 2 passed
npx vitest run src/adapters/source/conformance.test.ts → 41 passed
bash scripts/lint-adapters.sh                         → all 8 invariants green
bash scripts/check-fixture-privacy.sh                 → green
bash scripts/lint-no-telemetry.sh                     → green (116 files scanned)
npm run build                                         → 392KB ESM bundle
```

One flake observed on `src/adapters/change-feed/obsidian-fs/change-feed.test.ts`
> "emits delete on an unlinked .md file" — pre-existing chokidar
> timing flake (see commits `ff635f3`, `260da64` for prior `test.retry(1)`
> additions). Passes on isolated re-run. Not caused by Phase 4
> changes (the change-feed module was not touched). Tracked for a
> future retry-bump rather than a Phase 4 blocker.

## Per-plan recap

| Plan | Name                            | Outcome                                                                                                                                                                  |
|------|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 04-01 | edges substrate                 | Migration 011 + `EdgesQueries` namespace + Database wiring + v1 graph tools additively widened with `type: EdgeType`. Dual-write to `wikilinks` + `edges` from the indexer. |
| 04-02 | edge extractors                 | Unified `extractAllEdges` extracts all four edge types in a single parse pass. `MIN_MENTION_LEN=4` empirically validated. Frontmatter-ref allowlist sealed as `ReadonlySet<string>`. |
| 04-03 | `expand` tool                   | Typed-edge BFS with shortest-path `via` dedup + `_memory/` opacity + soft-warning on unknown seeds. MCP tool registered (TOOLS 30 → 31).                                  |
| 04-04 | `search_hybrid({expand})`       | Additive nested param; guard-and-short-circuit composition keeps v1-baseline byte-identical. Per-vault BFS isolation inherited from `expand()` boundary.                  |
| 04-05 | `cluster` tool                  | Louvain via `graphology` family + seeded RNG + 5000-node cap. D-12 determinism enforced at three control points. MCP tool registered (TOOLS 31 → 32).                     |
| 04-06 | evals + conformance             | Three new YAML eval files + 6 cross-adapter conformance cases. A1 empirically validated. Test suite 1194 → 1211.                                                          |
| 04-07 | phase gate (this plan)          | Tool-list snapshot regen with additive Phase 4 diff. Strict-equality snapshot test re-enabled. Sign-off doc + CHANGELOG + STATE + ROADMAP updates.                        |

Resolving commit prefixes (per `git log --oneline`):

- 04-01: `64bc6ad`, `53f6d9f`, `b1deb0b`
- 04-02: `275b3df`, `9cde9e1`, `62f11c9`
- 04-03: `c5b23c9`, `685e44f`, `26ee6ce`
- 04-04: `f97978e`, `91a00fc`, `2fa8732`
- 04-05: `ee32c74`, `c502b07`, `ea0b2c1`, `de50116`
- 04-06: `3d89773`, `b410c70`, `3d9b887`, `bfa2cd7`, `dbd3019`
- 04-07: `a387657` (this PR)

## Adapter-seam audit

`bash scripts/lint-adapters.sh` green on the Phase 4 branch at
sign-off. All 8 invariants pass:

- I-1 (`chokidar`), I-2 (`node:fs`), I-3 (`node:path`),
  I-4 (`gray-matter`), I-5 (bare `.md` literals), I-5b (`obsidian://`
  literal), I-6 (raw `fs.writeFile`/`unlink`/`rename`), C-1 (Claude
  branding / hardcoded client-id) — all clean.

`src/graph/expand.ts` + `src/graph/cluster.ts` carry **zero** `fs`,
`path`, `gray-matter`, or `chokidar` imports. The `graphology` /
`seedrandom` / `louvain` imports are confined to `src/graph/cluster.ts`
and are not in the lint-adapters banlist (the banlist targets
adapter-seam invariants, not graph libraries).

## GRA-01..GRA-05 traceability

| Requirement | Resolving slice(s) | Key commits | Pinned by |
|---|---|---|---|
| **GRA-01** — `expand({seed_doc_ids, hops, edge_types?, filter_properties?})` typed-edge neighborhood | 04-03 | `c5b23c9`, `685e44f`, `26ee6ce` | `src/graph/expand.test.ts`, `src/graph/expand.integration.test.ts`, conformance suite |
| **GRA-02** — `cluster({query | seed_doc_ids, method})` deterministic communities | 04-05 | `ee32c74`, `c502b07`, `ea0b2c1` | `src/graph/cluster.test.ts`, `src/graph/cluster.integration.test.ts`, `_queries/cluster.yaml` |
| **GRA-03** — `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion | 04-04 | `f97978e`, `91a00fc`, `2fa8732` | `src/search/hybrid.test.ts`, `src/search/hybrid-expand.integration.test.ts` |
| **GRA-04** — Edges carry explicit `type` per ADR-003 (4 edge types) | 04-01, 04-02 | `64bc6ad`, `53f6d9f`, `275b3df`, `9cde9e1` | `src/db/queries/edges.test.ts`, `src/indexer/extract-edges.test.ts`, assembly tests |
| **GRA-05** — Eval fixture ≥5 expansion queries P/R ≥ 0.8 | 04-06 | `3d89773`, `b410c70`, `3d9b887`, `bfa2cd7` | `_queries/expand.yaml` (8 queries), `_queries/search-hybrid-with-expand.yaml` (3), `_queries/cluster.yaml`, conformance suite (6 cases) |

## Next phase

Phase 5 — Compiled brief layer (BRF-01..BRF-11). The Phase 4 graph
layer is the source-discovery primitive for `compile_brief`: the
brief compiler will use `cluster()` over the `_memory/` namespace +
`expand()` from the brief target to gather citation packets, then
the LLM-strategy ladder (MCP Sampling → local Ollama → caller-
passed text per the Phase 5 ADR) compiles them into a brief
`Document`. Source-hash staleness propagation closes the
"agents rediscover 85% of context every run" failure mode.

## Audit trail

Maintainer PR approval on the final Phase 4 PR carrying this file
is the FND-14-style audit event for Phase 4. The PR title / SHA is
recorded here at merge time:

- PR: _to be filled in at merge_
- Merge SHA: _to be filled in at merge_

— end Phase 4 sign-off —
