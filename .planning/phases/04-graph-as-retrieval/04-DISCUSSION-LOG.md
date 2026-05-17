# Phase 4: Graph-as-retrieval - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 04-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 04-graph-as-retrieval
**Areas discussed:** Edge storage strategy, expand() API shape & hop semantics, cluster() algorithm & feature-flag policy, search_hybrid({expand}) composition + eval design

---

## Area Selection (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Edge storage strategy | How to persist mention/frontmatter-ref/hyperlink alongside wikilinks | ✓ |
| expand() API shape & hop semantics | Hops cap, direction, result shape, dedupe rule | ✓ |
| cluster() algorithm & feature-flag policy | Algorithm choice, determinism, slow-trigger | ✓ |
| search_hybrid({expand}) composition + eval design | Score merging, rescore order, eval gold-set | ✓ |

**User's choice:** All four areas.

---

## Area 1 — Edge storage strategy

### Q1: How should typed edges be stored?

| Option | Description | Selected |
|--------|-------------|----------|
| New `edges` table, backfill from wikilinks (Recommended) | Migration 011 creates `edges`, backfills wikilinks. wikilinks table stays for v1 tools. | ✓ |
| Extend wikilinks with edge_type column | Rewrites stable v1 table, forces v1 tools to filter on type | |
| Compute non-wikilink edges on-the-fly | Zero migration but expand() re-parses bodies; Phase 5 hot path | |

**User's choice:** Recommended.

### Q2: When does the indexer extract non-wikilink edges?

| Option | Description | Selected |
|--------|-------------|----------|
| Same pass as wikilink resolver (Recommended) | Extend src/indexer/resolver.ts; single parse pass | ✓ |
| Separate post-indexing pass | Doubles I/O, complicates watcher | |
| Lazy extraction on first expand() per doc, cached | Cold-start unpredictable; cache invalidation hard | |

**User's choice:** Recommended.

### Q3: What counts as a `mention` edge?

| Option | Description | Selected |
|--------|-------------|----------|
| Exact title or alias match in body text (Recommended) | Token-matching against note_aliases; min-length + casefold | ✓ |
| Same plus frontmatter `mentions: [...]` array | User-curated escape hatch | |
| Defer mention extraction to v2.x | Ship 3 of 4 edge types now | |

**User's choice:** Recommended.

### Q4: Should v1 list_backlinks/list_forward_links return edge `type`?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — additive `type` field on existing result shape (Recommended) | Strictly additive; default unchanged | ✓ |
| No — keep v1 tools wikilink-only | Inconsistent with bundles | |
| Yes — add type AND optional `edge_types?` filter param | Future-proofs; slightly more API surface | |

**User's choice:** Recommended.

---

## Area 2 — expand() API shape & hop semantics

### Q1: Hops cap?

| Option | Description | Selected |
|--------|-------------|----------|
| 1 or 2, hard-capped at 2 (Recommended) | Zod literal union; tractable; covers Phase 5 needs | ✓ |
| 1..N with soft warning at >=3 | More flexible, punts on protection | |
| Only hops=1, hops=2 deferred | Smallest surface; loses 2-hop patterns | |

**User's choice:** Recommended.

### Q2: Default direction?

| Option | Description | Selected |
|--------|-------------|----------|
| Both — default; direction?: forward/backward/both = both (Recommended) | Most retrieval use cases want both | ✓ |
| Forward-only by default | Matches Phase 2 supersede mental model; loses backlinks by default | |
| Both, no direction param | Smallest API; cannot scope | |

**User's choice:** Recommended.

### Q3: Result shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat array + each carries `via: {seed_doc_id, hop, edge_type, direction}` (Recommended) | Matches citation-packet contract; easy to merge into search hits | ✓ |
| Grouped: {seeds: [{seed, hops: {1:[...], 2:[...]}}]} | Preserves seed grouping; harder to merge | |
| Subgraph: {nodes, edges} | Most information-rich; largest token cost | |

**User's choice:** Recommended.

### Q4: Filter interaction with Phase 2/3 superseded + property filtering?

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Phase 3 defaults (Recommended) | Consistent across read-side tools; filter_properties for simple equality | ✓ |
| No filter at all — caller filters | Inconsistent; risks superseded polluting briefs | |
| Hide superseded only, no filter_properties | Drops GRA-01 filter_properties | |

**User's choice:** Recommended.

### Q5: Module path?

| Option | Description | Selected |
|--------|-------------|----------|
| `src/graph/expand.ts` next to existing graph.ts (Recommended) | Cohesive graph operations | ✓ |
| `src/assembly/expand.ts` | Cohesive with citation-packet shape; mixes graph into assembly | |
| New `src/retrieval/` module | One more directory | |

**User's choice:** Recommended.

---

## Area 3 — cluster() algorithm & feature-flag policy

### Q1: Algorithm?

| Option | Description | Selected |
|--------|-------------|----------|
| Label Propagation (Recommended) | Near-linear, simple, ~150 LOC pure TS | |
| Louvain (modularity-maximizing) | Higher quality on dense graphs; needs new dep or ~500 LOC | ✓ |
| Connected Components only | Simplest; misses "community" in well-linked vaults | |

**User's choice:** Louvain (deviated from recommendation). Trade-off: heavier dependency surface accepted for cluster quality on Phase 5 brief topic clustering.

### Q2: What does "deterministic per fixture" mean?

| Option | Description | Selected |
|--------|-------------|----------|
| Same input → byte-identical cluster_id assignment (Recommended) | Sort by DocId; cluster_id = smallest member; snapshot in eval | ✓ |
| Same input → same partition structure (IDs may differ) | Set-equality on membership | |
| Snapshot-only — whatever produced is gold | Pragmatic; punts on guarantee | |

**User's choice:** Recommended.

### Q3: Louvain implementation source?

| Option | Description | Selected |
|--------|-------------|----------|
| Pull in graphology + graphology-communities-louvain (Recommended) | Battle-tested, ESM, MIT; ~50 LOC integration | ✓ |
| Reimplement in pure TS (~500 LOC, no new deps) | Zero deps; bug risk on non-trivial algorithm | |
| Defer Louvain — ship CC in v2.0.0, add Louvain in v2.1 | Smallest Phase 4; weaker brief clustering | |

**User's choice:** Recommended.

### Q4: Feature-flag policy?

| Option | Description | Selected |
|--------|-------------|----------|
| Always available, reject if >5000 nodes unless force:true (Recommended) | Predictable contract; structured error with hint | ✓ |
| Config flag in ~/.vault-memory/config.toml — disabled by default | Cleaner separation; adds discoverable knob | |
| Always on, no cap | Cleanest API; event-loop risk on large vaults | |

**User's choice:** Recommended.

### Q5: Per-cluster output shape?

| Option | Description | Selected |
|--------|-------------|----------|
| {cluster_id, size, members: CitationPacket[], summary: {top_types, top_titles, edge_density}} (Recommended) | All deterministic; no LLM | ✓ |
| Just {cluster_id, members: DocId[]} | Smallest; agents must enrich per member | |
| Include LLM-generated description | Crosses "no premature LLM coupling" rule | |

**User's choice:** Recommended.

### Q6: cluster() accepts `query` input per GRA-02?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — if query given, search_hybrid → top-K → expand 1 hop → cluster (Recommended) | Matches GRA-02 verbatim | ✓ |
| Yes for query only OR seed_doc_ids only (mutually exclusive) | Discriminated union; explicit mode | |
| Defer query input — seed_doc_ids only | Smaller surface; drops a GRA-02 acceptance bullet | |

**User's choice:** Recommended.

---

## Area 4 — search_hybrid({expand}) composition + eval design

### Q1: How do expanded docs surface in search_hybrid results?

| Option | Description | Selected |
|--------|-------------|----------|
| Additive `expansions?: CitationPacket[]` field per hit (Recommended) | Top-K stable; v1-baseline preserved by construction | ✓ |
| Expanded docs join score pool with synthesized scores | Single flat hit list; invariance risk | |
| Flat list with via_expansion field | Loses per-seed grouping | |

**User's choice:** Recommended.

### Q2: Rescore order with Phase 3 weights?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 3 rescore first, THEN expand top-K (Recommended) | Expand reads authority-weighted seeds; orthogonal | ✓ |
| Expand first, then rescore merged set | Mixes graph distance with content signals | |
| Both default zero — decision moot in baseline | Documents orthogonality; still need to spec interaction | |

**User's choice:** Recommended.

### Q3: Eval queries location and gold-set?

| Option | Description | Selected |
|--------|-------------|----------|
| New _queries/expand.yaml + manual gold-set (Recommended) | Mirrors Phase 0/3 pattern; manual ground truth on Atlas Robotics | ✓ |
| Auto-derive from frontmatter `related: [...]` arrays | Couples eval to fixture maintenance | |
| Snapshot-only — freeze today's output | Doesn't deliver ROADMAP precision/recall ≥0.8 | |

**User's choice:** Recommended.

### Q4: Eval coverage scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Both: dedicated expand.yaml AND search-hybrid-with-expand.yaml (Recommended) | Tests contract + integration separately | ✓ |
| Just expand.yaml — trust unit tests for integration | Loses end-to-end semantic verification | |
| Just search-hybrid-with-expand.yaml | Skips direct expand() eval | |

**User's choice:** Recommended.

---

## Claude's Discretion

Areas the user did not discuss; planner decides anchored by ADR-002/003 + GRA-01..GRA-05:

- Where `frontmatter-ref` extraction lives in the adapter chain (heuristic property allowlist + wikilink-in-value detection)
- `hyperlink` extraction scope (http(s)://-only; skip Obsidian asset embeds)
- Stub-adapter conformance coverage extension (reuse existing Phase 3 stub fixture)
- `search_hybrid({expand})` query-shape Zod schema (nested `expand?:` object)
- Edge backfill chunking strategy for large vaults (chunks of 10k per `runMigration008` pattern)
- MCP Resources promotion for expand/cluster (neither — both stay as Tools)
- Error semantics on unknown seed_doc_ids in expand (partial result + warnings array)
- Async/streaming cluster() for vaults near the cap (out of Phase 4 scope)

---

## Deferred Ideas (added during discussion)

- `embed` edge type — defer to v3 with Notion connector
- Frontmatter `mentions: [...]` user-curated escape hatch — v2.x
- `edge_types?: string[]` filter param on v1 graph tools — v2.x
- Hops≥3 in expand() — v2.x if demand emerges
- Label Propagation / Connected Components fallbacks — only if Louvain disappoints
- Per-vault TOML `[features.cluster]` flag — D-13 hard-cap covers the ergonomic
- LLM-generated cluster descriptions — Phase 5 brief layer
- Streaming/async cluster() — Phase 5 if needed
- expand() accepting `query` input — v2.x; cluster() composes internally instead
- v3 wikilinks table cleanup — once edges is sole source of truth
- Hyperlink resolution to DocIds — v3+
- Cross-source expand (Notion + Obsidian) — out of v2 per Phase 10 deferral
- Edge-type-aware ranking weights in expand() — Phase 5/6 if brief quality justifies
