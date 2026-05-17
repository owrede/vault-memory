# Phase 4: Graph-as-retrieval - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Promote backlinks/forward-links from **navigation** tools (Phase 1 `list_backlinks` / `list_forward_links` over the wikilink-only graph) to **retrieval expansion** over a typed-edge graph. Phase 4 lands three concrete surfaces:

1. **Typed-edge substrate** (GRA-04) — all four `Edge.type` values from `src/types.ts:470` (`wikilink`, `mention`, `frontmatter-ref`, `hyperlink`) become first-class persisted edges. Today only wikilinks are persisted (`src/db/queries/wikilinks.ts`). Phase 4 adds a new `edges` table (migration 011), backfills existing wikilinks into it, and extends the indexer to extract the three new edge types in the same per-note parse pass as the wikilink resolver.

2. **`expand` MCP tool** (GRA-01) — `expand({ seed_doc_ids, hops, direction?, edge_types?, filter_properties?, include_superseded? })`. Returns a flat, deduplicated array of citation packets where each packet carries an additive `via: { seed_doc_id, hop, edge_type, direction }` field naming the shortest path that surfaced it. Hops are hard-capped at 2. Mirrors Phase 3 read-side filter conventions: superseded hidden by default, simple property-equality predicates supported.

3. **`cluster` MCP tool** (GRA-02) — `cluster({ query | seed_doc_ids, method: "edge-community" })`. Runs Louvain modularity-maximizing community detection over the typed-edge graph via `graphology` + `graphology-communities-louvain`. Returns one entry per cluster with `{ cluster_id, size, members: CitationPacket[], summary: { top_types, top_titles, edge_density } }`. Deterministic per fixture: nodes sorted by `DocId` before running; `cluster_id` = smallest member DocId. Hard-capped at 5000 nodes unless `force: true` is passed.

4. **`search_hybrid({ expand: {hops: 1} })` auto-expansion** (GRA-03) — strictly additive optional param. Each top-K hit gets an additive `expansions?: CitationPacket[]` field carrying 1-hop neighbors. Phase 3 recency/authority rescore runs *before* expand; original ranking is preserved. v1-baseline invariance: when `expand` is omitted (the default), behavior is byte-identical to today.

5. **v1 graph tools get the edge type field** — `list_backlinks` and `list_forward_links` start returning an additive `type` field on each result (strictly additive per Phase 3 D-08). With no edge-type filter the default behavior is unchanged: all edge types are returned (including the new mention/frontmatter-ref/hyperlink rows once the indexer populates them).

6. **Eval coverage** (GRA-05) — new `evals/fixtures/v2-test-vault/_queries/expand.yaml` with ≥5 "find me everything related to X" queries spanning all four edge types (manual gold-set on Atlas Robotics), `_queries/search-hybrid-with-expand.yaml` (~3 integration queries), and `_queries/cluster.yaml` (input → expected `cluster_id` assignment snapshot for the determinism guarantee).

Phase 4 is the graph layer (sits at L3 alongside Phase 3 assembly per `docs/v2/ARCHITECTURE.md`). It feeds Phase 5 (compiled briefs — graph-driven source discovery for brief compilation), and the typed-edge surface is what makes Phase 6 contracts' "this dossier walks edges of type X" possible.

**Operating environment** (inherited from Phase 3): few expert users collaborating on a shared Obsidian vault via Syncthing / iCloud / git-sync. Implications for Phase 4: (a) edge extraction must tolerate concurrent renames — edges store target by `DocId` (resolved) or raw target string (unresolved), mirroring the existing `wikilinks.target_note` SET NULL pattern; (b) `mention` extraction must be deterministic and tokenizer-stable across vaults that sync on slightly different timing (no NLP / no LLM — exact title+alias matching only); (c) cluster_id stability across collaborators implies sorting by `DocId` (opaque + stable per ADR-001), not by mtime or title.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-17): four gray areas were presented and discussed. The user accepted the recommended option on most sub-questions; one decision deviated from the recommendation — D-12 (Louvain over Label Propagation) — for cluster quality on Phase 5 brief compilation. Decisions D-01..D-18 below are the locked outputs; remaining areas live under Claude's Discretion, anchored by ADR-003 + GRA-01..GRA-05 + the Phase 1/2/3 seam discipline.

### Edge Storage & Extraction

- **D-01: New `edges` table; backfill from wikilinks; wikilinks table stays.** Migration 011 creates `edges(id, source_doc, target_doc, type, rel?, anchor?, line_number?, UNIQUE(source_doc, target_doc, type, anchor))` plus indexes on `(source_doc)` and `(target_doc)`. A one-time backfill copies every existing `wikilinks` row into `edges` with `type='wikilink'`. The `wikilinks` table is **kept in place** so the v1 `list_backlinks`/`list_forward_links` tool handlers and the indexer's wikilink resolver continue working untouched; v1 tools start reading from `edges` (with a default no-op type filter) only as part of D-04 below. Storage cost: ~doubling on the wikilink subset until v3 cleanup — acceptable given the regression-risk savings.
  - **Rationale (rejected alternatives):** Renaming `wikilinks` → `edges` + adding `edge_type` column rewrites a stable v1 table and forces every v1 tool to filter on type (higher regression surface). Computing non-wikilink edges on-the-fly turns Phase 5 brief compilation into a hot-loop body re-parser.

- **D-02: Indexer extracts all four edge types in one note-parse pass.** Extend `src/indexer/resolver.ts` (or a sibling under `src/indexer/`) to extract `wikilink`, `mention`, `frontmatter-ref`, and `hyperlink` in a single pass over the parsed `Document`. The body is already in memory; adding three extractors keeps indexing time roughly constant and avoids a second-pass watcher path. Edge upserts use the same `INSERT OR IGNORE` discipline as `src/db/queries/wikilinks.ts:52`.

- **D-03: `mention` = exact title-or-alias token match in body paragraph blocks.** Reuses the existing `note_aliases` table (migration 002) for the candidate set. Excludes wikilinks (already typed), headings, code blocks. Tokenization rules: casefold, min-length 4 chars (avoid matching pronouns and common short words like "API", "the", "log"), word-boundary regex. Deterministic; no NLP; no LLM. False-positive risk acknowledged — mitigated by the min-length + word-boundary rules. Frontmatter `mentions: [...]` arrays as a user-curated escape hatch (the second option) are **deferred** to v2.x — adds an Obsidian convention that doesn't yet exist in Atlas Robotics fixtures.

- **D-04: v1 `list_backlinks` / `list_forward_links` gain an additive `type` field.** `BacklinkResult.type` and `ForwardLinkResult.type` are added (typed as the four `Edge.type` literals). Default behavior unchanged: with no filter the tools return all rows from `edges` for the given doc (which, after backfill, equals the v1 behavior plus the new edge types once the indexer populates them). The optional `edge_types?: string[]` filter param (third option from the question) is **deferred** to v2.x — additive without it, and Phase 4's primary consumer (`expand()`) has its own filter. Tool snapshot (`evals/v1-baseline/tools-list.snapshot.json`) regenerates once with the additive diff, reviewed in the Phase 4 PR.

### `expand()` API Shape & Hop Semantics

- **D-05: Hops hard-capped at 2 via Zod literal union.** `hops: 1 | 2`. v2.0.0 ships a tractable contract; hops≥3 explodes neighborhood size on real vaults (Atlas Robotics has ~75 nodes — at 3 hops from a dense seed the entire vault returns). Phase 5 brief compilation needs 1–2 hops. v2.x can lift the cap on demonstrated demand.

- **D-06: `direction?: 'forward' | 'backward' | 'both' = 'both'`.** Most "everything related to X" use cases want both inbound and outbound edges. Explicit param lets Phase 5 brief compilation scope when it knows the topology it wants (e.g., "what cites this decision?" = `backward`).

- **D-07: Result shape — flat array of citation packets, each carrying `via: { seed_doc_id, hop, edge_type, direction }`.** Deduplicated by `doc_id`; multiple paths to the same target collapse to one packet with `via` capturing the **shortest** path (lowest hop, ties broken by sort order on `seed_doc_id` then `edge_type`). Citation packets follow the Phase 3 D-05 contract (the same 8-field shape returned by `recall`, bundles, dossiers); `via` is the only Phase-4-specific additive field. Easy for `search_hybrid({expand})` to merge into hits per D-15.

- **D-08: Filter conventions mirror Phase 3 read-side defaults.** `include_superseded?: boolean = false`, `filter_properties?: Record<string, unknown>`. `filter_properties` accepts simple equality predicates (e.g. `{ type: "Project", status: "active" }`) — matched against `Document.properties` with strict equality. Same `_memory` opacity rules as Phase 3 apply (memory-sink docs are returned only if they were already linked from a user note, never traversed *into* `_memory` via untyped scans). Forward-only supersede from Phase 2 D-03 means superseded filter is a pure property check, no graph traversal needed.

- **D-09: Module path — `src/graph/expand.ts` next to existing `src/graph/graph.ts`.** Phase 4 = graph layer; expand is a graph operation, cluster also lands here as `src/graph/cluster.ts`. Keeps graph operations cohesive; `src/assembly/` stays for Phase 3 document-tree retrieval. `src/graph/index.ts` exports the new public API.

### `cluster()` Algorithm & Feature-Flag Policy

- **D-10: Algorithm — Louvain modularity-maximizing community detection.** Selected over Label Propagation (Recommended) for cluster quality on Phase 5 brief topic clustering. Trade-off accepted: heavier dependency surface, but Phase 5 brief compilation reads cluster output directly, and Louvain produces higher-modularity communities on the typically-sparse vault graphs that vault-memory operates on. Connected-Components-only was rejected: in a well-linked vault, one giant component swallows everything and the "community" aspect is lost.

- **D-11: Implementation — pull in `graphology` (^0.26) + `graphology-communities-louvain` (^2.x).** Pure JS, ESM, MIT-licensed, no network calls, no native bindings. Two net-new runtime deps + small transitive surface (≤5 transitive packages). Aligns with PROJECT.md "no premature LLM coupling" (graphology is not an LLM; the rule is silent on graph libs). Reimplementing Louvain in pure TS was rejected for bug-risk + maintenance reasons. Marked `external` in tsup only if their bundle includes native code; otherwise bundled normally.

- **D-12: Determinism contract — same input produces byte-identical `cluster_id` assignment.** Nodes are sorted by `DocId` (opaque string sort) before running Louvain. `cluster_id` is assigned as the smallest member `DocId` per cluster. Louvain's randomness is seeded explicitly via the library's `randomWalk` option (or equivalent — planner verifies the API). Snapshotted in `evals/fixtures/v2-test-vault/_queries/cluster.yaml`. Algorithm choice and library version stable across v2.x patch releases (pinned via `package.json` caret + lockfile).

- **D-13: Feature-flag policy — always available, hard-reject at >5000 nodes unless `force: true`.** Above the cap: cluster() returns a structured error `{ ok: false, reason: "node_count_exceeded", node_count, threshold: 5000, hint: "pass force:true to compute" }`. Predictable contract; no hidden "sometimes available" failure mode. Atlas Robotics fixture (~75 nodes) and realistic user vaults (~thousands) stay well under the cap. Async escape isn't available (better-sqlite3 sync), so the cap protects the event loop. Per-vault TOML config flag (the second option) was rejected — one fewer knob to discover.

- **D-14: Per-cluster output — `{ cluster_id, size, members: CitationPacket[], summary: { top_types, top_titles, edge_density } }`.** All fields deterministic, no LLM. `top_types` = histogram of `properties.type` across members (top 5). `top_titles` = top-3 member titles ordered by degree within the cluster (ties broken by `DocId` sort). `edge_density` = `edges_in_cluster / (size * (size - 1) / 2)` (clipped to 0 when `size ≤ 1`). LLM-generated `description` was rejected — crosses the "no premature LLM coupling" rule; Phase 5 brief layer is the place for LLM enrichment over cluster output.

- **D-15a: `cluster()` accepts `query` OR `seed_doc_ids` (mutually exclusive is fine; both-present errors).** When `query` is given: run `search_hybrid({query, limit: top_k})` → take top-K (default 50, configurable via `query_top_k?: number`) → call `expand({seed_doc_ids: top_k_ids, hops: 1, direction: "both"})` → cluster the deduplicated union of (seeds ∪ expansions). This composes Phase 4's own primitives; no new graph plumbing. When `seed_doc_ids` is given: cluster exactly that set with their induced 1-hop neighborhood.

### `search_hybrid({expand})` Composition + Eval

- **D-15: Additive `expansions?: CitationPacket[]` field per hit.** When `expand: {hops: 1}` is supplied to `search_hybrid`, each top-K original hit gets its own `expansions` array carrying 1-hop neighbors (citation packets + `via` provenance from D-07). Top-K hit ranking is **stable** — v1-baseline invariance preserved by construction when `expand` is omitted. Agents see the original ranking AND graph context per result without flat-list mixing.

- **D-16: Rescore order — Phase 3 recency/authority rescore FIRST, then expand top-K.** Authority/recency weights apply to original hits only; expand is a strict post-processing step reading the rescored top-K seeds. Phase 3 invariance unchanged; expand never participates in score computation. Per-expansion docs do carry `mtime` (already in their citation packet) so agents can post-filter.

### Eval Design (GRA-05)

- **D-17: `evals/fixtures/v2-test-vault/_queries/expand.yaml` with manual gold-set on Atlas Robotics.** Mirrors Phase 0/3 `_queries/dossier.yaml`/`_queries/recency.yaml` pattern. ≥5 "find me everything related to X" queries spanning all four edge types. Each query: `{ id, description, input: {seed_doc_ids, hops, direction?, edge_types?, filter_properties?}, expected_doc_ids: string[], min_precision: 0.8, min_recall: 0.8 }`. Manual ground truth — Atlas Robotics is ~75 notes, tractable to curate. PR review confirms gold-set quality before merge.

- **D-18: Coverage = both `_queries/expand.yaml` AND `_queries/search-hybrid-with-expand.yaml`.** Tests the contract (`expand()`) and the auto-expansion integration (`search_hybrid({expand})`) separately. The integration eval has ~3 queries verifying: (a) expanded neighbors land in the `expansions` field, (b) original ranking is preserved, (c) v1-baseline is green when `expand` is omitted (overlap with the existing `evals/v1-baseline/baseline.test.ts` is intentional — defense in depth). Also `_queries/cluster.yaml` per D-12 for cluster determinism (input → expected `cluster_id` assignment, snapshotted).

### Claude's Discretion

Several implementation areas were deliberately **not discussed**. Researcher + planner choose, anchored by ADR-002/003 + GRA-01..GRA-05 + Phase 0/1/2/3 outputs.

- **Where `frontmatter-ref` extraction lives in the adapter chain.** Frontmatter is already parsed by the obsidian-fs source adapter into `Document.properties`. The extractor needs to scan property *values* for shapes that look like links (e.g., `project: [[Acme Q3]]`, `assigned_to: alice`, or bare strings matching known titles/aliases). Planner picks the rule set; recommendation lean: detect (a) wikilink syntax inside property values (any depth), (b) bare-string match against the `note_aliases` table for properties named in a heuristic allowlist (`assignee`, `owner`, `project`, `related`, `parent`, `child`, plus any property whose value parses as a wikilink). Document the heuristic in the tool description; users can extend later via the same Phase 6 contract DSL surface that handles dossier-type registries.

- **`hyperlink` extraction scope.** Markdown `[text](url)` and bare URLs. `target` is the raw URL string (unresolved — hyperlinks don't resolve to internal `DocId`s in v2.0.0). Planner decides whether to filter out common noise (footnote anchors, image refs); recommendation lean: include image links only when target starts with `http(s)://`; skip relative paths (those are Obsidian asset embeds, which become `embed` edges in v3 per the open `EdgeType` enum in `src/adapters/capabilities.ts:23` — Phase 4 does not introduce `embed` since `Edge` in `src/types.ts:470` deliberately excludes it).

- **Stub-adapter coverage extension.** The Phase 3 stub already includes `frontmatter-ref`, `mention`, and `hyperlink` edges (forward-compat per `src/adapters/stub/assembly-fixture.ts:148/185/200`). Planner extends `src/adapters/source/conformance.test.ts` with `expand`/`cluster` assertions against both `obsidian-fs` and the stub. Recommendation lean: reuse the existing stub fixture; add 2–3 conformance cases covering `expand` over each edge type + a `cluster` determinism case.

- **`search_hybrid({expand})` query-shape Zod schema.** Recommendation lean: nest under a single optional `expand?: { hops: 1 | 2, direction?: ..., edge_types?: string[] }` object (matches GRA-03 wording verbatim). Planner picks the exact Zod tree; ensures the tool snapshot diff is unambiguous.

- **Edge backfill performance for large vaults.** Migration 011's one-time backfill from `wikilinks` → `edges` is `O(N)` on the wikilinks table. Planner verifies it stays under the existing migration timeout (better-sqlite3 sync); if a vault has >100k wikilinks the backfill might need chunking. Recommendation lean: chunked in batches of 10k inside the migration's `run` function (matches the `runMigration008` pattern at `src/db/schema.ts:638`).

- **MCP Resources promotion for cluster (ASM-13 parallel).** `cluster()` is a computed-on-demand tool; `expand()` likewise. Neither is list-style. Recommendation: **both stay as Tools**, no Resources promotion in Phase 4. (Phase 5 `list_briefs` and Phase 6 `list_contracts` remain the candidates per Phase 3 deferral.)

- **Error semantics on broken seed_doc_ids.** If any seed in `expand({seed_doc_ids})` doesn't resolve to a known doc, recommendation lean: return a partial result with a `warnings: [{ seed_doc_id, reason: "unknown_doc" }]` array, not a hard throw. Consistent with Phase 3 dossier's "empty result on no-match" convention (Phase 3 D-04 spirit). Hard throw only on Zod-input violations.

- **Async/streaming for `cluster()` near the 5000 cap.** v2.0.0 ships sync (matches the rest of the codebase). If Phase 5 brief compilation needs cluster() on vaults near the cap, Phase 5 (not Phase 4) revisits whether to add a streaming surface. Out of Phase 4 scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 4 specs (the WHAT)
- `.planning/REQUIREMENTS.md` §"Graph-as-Retrieval (Phase 4)" — GRA-01..GRA-05 (precise deliverable list)
- `.planning/ROADMAP.md` §"Phase 4: Graph-as-retrieval" — goal + 4 success criteria
- `.planning/PROJECT.md` — v2 mission; especially "no premature LLM coupling" (informs D-14 cluster output: no LLM-generated descriptions)

### ADRs (lock the type contracts and invariants)
- `docs/v2/adr/001-document-identity.md` — opaque `DocId`; URI shape; identity contract Phase 4 honors (every citation packet's `doc_id` is opaque; cluster_id stability uses `DocId` sort)
- `docs/v2/adr/002-adapter-seams.md` — `SourceConnector` interface; Phase 4 reads through `readDocument(id)` / iteration; no fs/path imports outside adapter dir (CI grep enforces); `EdgeType` capability descriptor at `src/adapters/capabilities.ts:23`
- `docs/v2/adr/003-document-shape.md` — `Document`, `BlockNode`, `Edge`, `PropertyBag` shapes; `Edge.type` union (`wikilink | mention | frontmatter-ref | hyperlink`) at `src/types.ts:470` — Phase 4 makes this concrete in storage
- `docs/v2/adr/004-memory-sink-handles.md` — `_memory` opacity rules carry into D-08 expand filter behavior
- `docs/v2/MEMORY_CONTRACT.md` — provenance keys (`status`, `superseded_by`) that D-08 filter reads
- `docs/v2/ARCHITECTURE.md` — L3 graph layer placement; new `src/graph/expand.ts` + `src/graph/cluster.ts` sit here alongside existing `src/graph/graph.ts`
- `docs/v2/AGENT_AGNOSTIC.md` — MCP-as-canonical-interface stance; cluster() stays as Tool, not Resource

### Prior phase outputs Phase 4 consumes directly
- `.planning/phases/03-bundles-authority-staleness/03-CONTEXT.md` — D-05 citation packet shape (Phase 4 reuses verbatim; adds `via` field for expand); D-06/D-07 authority/staleness model that D-16 rescore order respects; D-08 strictly-additive `search_hybrid` rule
- `.planning/phases/03-bundles-authority-staleness/03-PHASE-SUMMARY.md` (or sign-off doc) — Phase 3 closed assets including stub-adapter forward-compat edges (`frontmatter-ref`/`mention`/`hyperlink` already in the stub fixture)
- `.planning/phases/02-memory-namespace-provenance-contract/02-CONTEXT.md` — D-03 forward-only supersede; D-01 citation-packet origin; `_memory` opacity
- `.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md` — adapter-seam CI greps (must stay zero outside adapters in Phase 4); `Document`/`Edge` type contracts
- `.planning/phases/00-foundation-decisions/00-CONTEXT.md` — eval-fixture discipline; Atlas Robotics is the Phase 4 manual gold-set source
- `docs/v2/adr/ADVERSARIAL-REVIEW.md` — Phase 0 findings; check anything touching edge typing or graph contracts

### Phase 1/2/3 code Phase 4 reads and extends
- `src/types.ts:470` — canonical `Edge` interface (4-type union); Phase 4 makes these concrete in `edges` table
- `src/types.ts` — `Document.properties.wikilinks: WikilinkRef[]` (the existing intermediate shape from the obsidian-fs adapter; Phase 4 promotes to first-class `Document.links: Edge[]`)
- `src/adapters/capabilities.ts:23` — `EdgeType` capability descriptor (5-type incl. `embed`; Phase 4 ships 4 of 5, `embed` deferred to v3)
- `src/adapters/stub/assembly-fixture.ts:148,185,200` — stub edges already include `frontmatter-ref`/`mention`/`hyperlink`; conformance suite extension reuses these
- `src/db/schema.ts:118` — current `wikilinks` table DDL (kept in place per D-01); migration 011 adds `edges` table; backfill copies rows
- `src/db/schema.ts:638` — `runMigration008` pattern for backfill migrations; D-01's backfill follows this shape
- `src/db/queries/wikilinks.ts:52` — `INSERT OR IGNORE` discipline; new `src/db/queries/edges.ts` follows the same pattern
- `src/db/queries/note_aliases` (in `src/db/queries/`) — D-03 mention extractor reads from here
- `src/graph/graph.ts` — existing `listBacklinks`/`listForwardLinks`/`findBrokenLinks`; D-04 extends these with additive `type` field; D-09 places `expand.ts`/`cluster.ts` here
- `src/graph/index.ts` — public exports; Phase 4 adds `expand`/`cluster` and their result types
- `src/indexer/resolver.ts` — wikilink resolver; D-02 extends to extract the three new edge types in the same pass
- `src/search/hybrid.ts` — Phase 3 added the post-RRF rescore; D-15/D-16 add post-rescore expand attachment per hit
- `src/assembly/bundle.ts` — Phase 3 backlinks/forward-links in bundles; should start carrying `type` via the same D-04 additive change to graph results
- `src/tool-registry.ts` — Phase 0 extracted; Phase 4 registers `expand` and `cluster` MCP tools here
- `src/adapters/source/conformance.test.ts` — Phase 4 extends with `expand`/`cluster` assertions against `obsidian-fs` and the stub
- `evals/v1-baseline/baseline.test.ts` — must stay green; `search_hybrid({expand omitted})` byte-identical
- `evals/v1-baseline/tools-list.snapshot.json` — strictly additive params; one regen for `expand` field + new `expand`/`cluster` tools + additive `type` on graph tools
- `evals/fixtures/v2-test-vault/_queries/` — new `expand.yaml` (D-17), `search-hybrid-with-expand.yaml` (D-18), `cluster.yaml` (D-12 snapshot)

### Codebase maps (read for Phase 4 mechanics)
- `.planning/codebase/ARCHITECTURE.md` — current layer model; `src/graph/` is L3 alongside `src/assembly/`
- `.planning/codebase/STRUCTURE.md` — "Where to Add New Code" recipes
- `.planning/codebase/CONVENTIONS.md` — ESM + `.js` extension, kebab-case, Zod validation, type-check-as-lint
- `.planning/codebase/TESTING.md` — vitest layout; new tests co-located; conformance extension lives next to `src/adapters/source/conformance.test.ts`
- `.planning/codebase/CONCERNS.md` — known v1 quirks (especially around indexer + watcher edge cases that the new edge extractors must not regress)
- `.planning/codebase/INTEGRATIONS.md` — Ollama + MCP SDK touchpoints (Phase 4 adds no new external integrations)

### External references
- `graphology` docs (https://graphology.github.io/) — graph data structure; ESM-compatible; pinned via lockfile
- `graphology-communities-louvain` docs — algorithm parameters, especially the seed/random options that D-12 determinism contract needs
- Blondel et al. 2008 — Louvain modularity-maximizing community detection (original paper); cite in `src/graph/cluster.ts` header comment alongside Cormack 2009 (RRF) pattern from `src/search/hybrid.ts:9`
- MCP SDK 1.29 `registerTool` API — used for the two new tools and the two v1-graph-tool re-registrations (additive params trigger Zod schema regen)

### Operating-environment context (informs design choices)
- **Few expert users collaborating concurrently on a shared Obsidian vault** (Syncthing / iCloud / git-sync sync substrate; vault-memory itself local-first). Frames: (a) D-03 deterministic mention extraction (no NLP tied to model timing), (b) D-12 `DocId`-sorted Louvain (cluster_id stable across collaborators), (c) D-07 shortest-path `via` deduplication (collaborators' parallel edits don't change which seed surfaced a doc).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`Edge` interface** (`src/types.ts:470`) — 4-type union already defined; Phase 4 wires it through storage + tools verbatim. No type change.
- **`EdgeType` capability descriptor** (`src/adapters/capabilities.ts:23`) — 5-type enum at the adapter contract; Phase 4 ships 4 of 5 (`embed` deferred to v3 with the Notion connector).
- **Stub-adapter edges already typed** (`src/adapters/stub/assembly-fixture.ts:148,185,200`) — `frontmatter-ref`, `mention`, `hyperlink` already in the Phase 3 stub fixture. Conformance suite extension reuses these without modification.
- **`wikilinks` table + indexes** (`src/db/schema.ts:118`) — stays in place per D-01; migration 011's backfill is a one-time `INSERT INTO edges SELECT ... FROM wikilinks` style.
- **`runMigration008` backfill pattern** (`src/db/schema.ts:638`) — D-01's backfill follows this shape (function-style migration over SQL-string for chunked execution).
- **`note_aliases` table** (migration 002) — D-03 mention extractor reads from here; already indexed by `alias_norm`.
- **`listBacklinks`/`listForwardLinks`** (`src/graph/graph.ts:37/64`) — D-04 adds additive `type` field to result rows; existing call paths unaffected by default.
- **`src/indexer/resolver.ts`** — wikilink resolver; D-02 extends to extract the three new edge types in the same pass.
- **`src/search/hybrid.ts` post-RRF rescore** — Phase 3 added this; D-15/D-16 attach an expand step after rescore, before return.
- **`src/assembly/` citation-packet builders** — Phase 4 reuses the citation-packet shape verbatim; `via` is an additive field on the same shape, not a new shape.
- **`tool-registry.ts`** (Phase 0) — central registration; two new tools (`expand`, `cluster`) land here plus additive schema updates for `search_hybrid` + `list_backlinks` + `list_forward_links`.
- **`evals/fixtures/v2-test-vault/`** — Atlas Robotics fixture; D-17/D-18 author new YAMLs under `_queries/`.

### Established Patterns
- **Citation packet shape is Phase 2/3 locked** — Phase 4 adds only the `via?: { seed_doc_id, hop, edge_type, direction }` field; never reshapes existing fields.
- **Strictly additive search_hybrid changes** (Phase 3 D-08) — Phase 4's `expand?: ...` input param + per-hit `expansions?: ...` output field are additive; v1-baseline snapshot diff is reviewed once in the Phase 4 PR.
- **Adapter-seam discipline** — no `fs`, `gray-matter`, `path.join` outside `src/adapters/source/` and `src/adapters/delivery/`. CI greps enforce. Phase 4's `expand`/`cluster` read only via the existing `SourceConnector` surface (transitively, through SQLite queries that the adapter populated).
- **`INSERT OR IGNORE` for edge upserts** (`src/db/queries/wikilinks.ts:52` pattern) — `src/db/queries/edges.ts` follows this; UNIQUE constraint on `(source_doc, target_doc, type, anchor)` makes re-extraction idempotent.
- **Forward-only supersede check** — pure property read; never traverses the graph at filter time. D-08 honors this.
- **Vitest co-location** — `*.test.ts` next to source files (`src/graph/expand.test.ts`, `src/graph/cluster.test.ts`).
- **Conformance suite as cross-adapter contract surface** — `src/adapters/source/conformance.test.ts` extends with Phase 4 `expand`/`cluster` assertions for both `obsidian-fs` and stub.
- **Snapshot pinning** — `evals/v1-baseline/tools-list.snapshot.json` catches breaking changes; additive optional params permitted. One regen in the Phase 4 PR.

### Integration Points
- **`src/db/schema.ts`** — migration 011 (DDL + backfill function); register in the MIGRATIONS array.
- **`src/db/queries/edges.ts` (new)** — query namespace for the new table; follows `src/db/queries/wikilinks.ts` shape.
- **`src/db/database.ts`** — wire the new `EdgesQueries` namespace onto the `Database` class (`vault.db.edges.*`).
- **`src/indexer/resolver.ts`** — extend with three new extractors (mention, frontmatter-ref, hyperlink); write into `edges` table alongside existing wikilinks writes.
- **`src/graph/expand.ts` (new)** — BFS over `vault.db.edges.*` with hop cap, direction filter, edge-type filter, property filter; returns citation packets via the existing assembly hydration helpers.
- **`src/graph/cluster.ts` (new)** — Louvain via graphology; node-sort + cluster_id assignment per D-12; result hydration via citation packets + summary computation.
- **`src/graph/graph.ts`** — D-04 additive `type` field on `BacklinkResult`/`ForwardLinkResult`; switch reads to `vault.db.edges.*`.
- **`src/search/hybrid.ts`** — post-rescore expand attachment per top-K hit when `expand` param present.
- **`src/assembly/bundle.ts`** — backlinks/forward_links in bundles should carry the new `type` field (consistency with D-04).
- **`src/tool-registry.ts`** — register `expand`, `cluster`; update Zod schemas for `search_hybrid`, `list_backlinks`, `list_forward_links`.
- **`src/adapters/source/conformance.test.ts`** — extend with expand/cluster assertions against obsidian-fs and stub.
- **`evals/fixtures/v2-test-vault/_queries/`** — `expand.yaml`, `search-hybrid-with-expand.yaml`, `cluster.yaml`.
- **`evals/v1-baseline/tools-list.snapshot.json`** — one regen with the additive diff.
- **`package.json`** — add `graphology` + `graphology-communities-louvain`.

</code_context>

<specifics>
## Specific Ideas

- **The `edges` table is the single source of truth for Phase 4+ graph queries.** Once D-01's backfill completes, all graph reads (v1 tools, expand, cluster, bundle backlinks/forward_links, dossier rollups) go through `vault.db.edges.*`. The `wikilinks` table stays only as a write-target for the existing wikilink resolver path (which writes to both during a transition, or — planner's choice — only to `edges` with the resolver updated). Recommendation lean: planner picks "single-write to edges only; wikilinks table becomes read-deprecated and is removed in v3 cleanup."

- **The `via` field on expand citation packets is THE provenance handle for Phase 5 briefs.** When Phase 5 compiles a brief from an `expand` neighborhood, the per-source `via` lets the brief carry "this paragraph cites X because X was a 1-hop frontmatter-ref from seed Y" without re-running expand. The `via.hop` field gates brief-level relevance weighting (1-hop sources stronger than 2-hop).

- **`cluster_id = smallest_member_DocId`** (D-12) means cluster IDs are inherently human-readable when DocIds carry path-like structure (e.g., `obsidian-fs://atlas/people/alice.md`). Snapshots are diffable. Collaborator-stable: two users who index the same vault see the same cluster_ids modulo edge differences.

- **Louvain's deterministic-seed knob is library-specific.** Planner verifies `graphology-communities-louvain` accepts a `randomWalk: false` or equivalent option; if not, wrap the call with `seedrandom` (or equivalent ESM lib) before invocation. Document the chosen mechanism inline.

- **The 5000-node cap for cluster() is a starting heuristic.** Phase 5 may discover a vault size at which cluster() is the bottleneck on brief compilation; cap may move in v2.x. Don't bake the number into too many places — single source-of-truth constant.

- **Mention extraction min-length = 4 chars is a guess** (D-03). May tune downward if Atlas Robotics has notes whose titles include 3-char acronyms that should be matched. Planner empirically validates against the fixture; if false-positive rate is too high at length 3, keep 4.

- **Backfill of edges from wikilinks during migration 011 is a one-time cost paid at vault upgrade.** For an `obsidian-fs` user upgrading from v1.x: ~one second per 10k wikilinks (chunked, per the Claude's Discretion entry on backfill perf). Documented in `MIGRATION-V1-TO-V2.md` (Phase 8 release artifact).

</specifics>

<deferred>
## Deferred Ideas

- **`embed` edge type** (Obsidian's `![[asset]]` syntax) — present in `src/adapters/capabilities.ts:23` `EdgeType` but deliberately excluded from `Edge.type` in `src/types.ts:470`. Defer to v3 with the Notion connector phase. Phase 4 ships 4 of 5 edge types.

- **Frontmatter `mentions: [...]` array as a user-curated mention escape hatch** — second option from area 1 mention sub-question. Defer to v2.x; no Atlas Robotics fixture demand yet. Phase 4 ships exact-match mention extraction only.

- **`edge_types?: string[]` filter param on `list_backlinks`/`list_forward_links`** — third option from area 1 v1-tools sub-question. Defer to v2.x. Phase 4 adds the `type` field on result rows; the filter is callable client-side via the new field, just not server-side.

- **Hops≥3 in `expand()`** — Phase 4 hard-caps at 2. Lift the cap if Phase 5/6 demonstrate real demand. No Zod change needed (literal union → bumped to `1 | 2 | 3`).

- **Label Propagation + Connected Components alternative algorithms for `cluster()`** — D-10 picks Louvain. If Louvain quality disappoints on real vaults, LP is a near-linear backup; CC is a degenerate fallback. Phase 5 brief quality is the signal that would trigger a revisit.

- **Per-vault TOML `[features.cluster]` flag** — second option from area 3 feature-flag sub-question. Defer; D-13's hard-cap + `force:true` override covers the same ergonomic without a discoverable knob.

- **LLM-generated cluster descriptions** — third option from area 3 cluster-output sub-question. Crosses the "no premature LLM coupling" rule. Phase 5 brief layer owns LLM enrichment over Phase 4 cluster output.

- **Streaming/async `cluster()` for vaults near the 5000-node cap** — Phase 5 (not Phase 4) revisits if brief compilation needs it.

- **`expand()` accepting `query` as input** (search-and-expand in one call) — `cluster({query})` does this internally per D-15a; `expand` does not. Defer to v2.x if real-world usage shows demand. Callers compose externally: `search_hybrid` → take top-K → `expand({seed_doc_ids: ids})`.

- **MCP Resources promotion for `expand`/`cluster`** — neither is list-style; both stay as Tools. Phase 5 `list_briefs` and Phase 6 `list_contracts` remain the Resources candidates.

- **v3 `wikilinks` table cleanup** — once `edges` is the single source of truth (per Specifics section), the `wikilinks` table can be dropped. v3 task, not v2.

- **Hyperlink resolution to known DocIds (when hyperlink target matches a published vault URL)** — v2.0.0 stores hyperlink `target` as raw URL. v3+ may add a `targetDocId?` resolution step. Out of v2 scope.

- **Cross-source expand (graph traversal across Notion + Obsidian)** — out of v2 per Phase 10 deferral.

- **Edge-type-aware ranking weights in `expand()`** (e.g. "frontmatter-refs are stronger evidence than mentions") — Phase 4 returns all edges with equal provenance weight in the `via` field. Phase 5/6 may add weight tuning when brief quality justifies.

</deferred>

---

*Phase: 04-graph-as-retrieval*
*Context gathered: 2026-05-17*
