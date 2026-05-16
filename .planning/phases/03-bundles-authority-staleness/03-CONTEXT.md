# Phase 3: Bundles + authority/staleness - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Promote the retrieval unit from chunks/notes to **document trees** and add **authority/staleness ranking signals** on top of existing `search_hybrid` — all proven source-neutral against a stub adapter.

Concretely, Phase 3 lands:

1. **Four new MCP tools** (ASM-01..ASM-04):
   - `get_document_bundle({doc_id, depth?: 1})` — document + backlinks (with property snippets) + forward links + section tree + recent edits.
   - `get_outline({doc_id})` — navigable section tree (nested), with per-section anchors and heading paths.
   - `search_sections({query, limit})` — section-level retrieval reusing the existing RRF hybrid pipeline.
   - `assemble_dossier({type, key})` — type/key-based assembly walking edges + properties, returning rollups and citation packets.

2. **Citation packet on every result** (ASM-05) — the Phase 2 D-01 shape, additive: `{ doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties? }`. `recall` already returns this; Phase 3 makes it the universal contract across all four new tools AND extends `search_hybrid` results to carry it (additive).

3. **Authority/staleness signals** (ASM-06..ASM-09, folded brief Phase 4):
   - All search/bundle results carry `mtime`, `status?`, `superseded_by?`.
   - `search_hybrid` accepts optional `recency_weight`, `authority_weight`.
   - `superseded` hard filter (default-hide; `include_superseded: true` to override).
   - v1 default behavior unchanged when no weights/filters supplied — proven by re-running `evals/v1-baseline/`.

4. **Section addressing infrastructure** — `BlockNode` is enriched (per ADR-003 forward-compat) so each section carries (a) a content-hash anchor as its stable citation token, (b) a heading-path array for human-readable navigation. The anchor doubles as the chunk-level `source_hashes` referenced by ADR-003 D-05 — Phase 5 briefs consume them directly.

5. **Source-neutrality proof** (ASM-12) — the existing stub adapter (Phase 1 conformance suites) is extended; all four new tools must pass the same eval scenarios against `obsidian-fs` and against a hard-coded `Document[]` stub.

6. **MCP Resources promotion where applicable** (ASM-13) — list-style assembly ops (e.g. `list_dossiers`) promoted from MCP tools to MCP Resources, continuing the MEM-09 surface-reduction discipline.

Phase 3 is the assembly layer (L3 per ARCHITECTURE.md) and feeds Phase 4 (graph-as-retrieval), Phase 5 (compiled briefs — which consume section anchors as `source_hashes`), Phase 6 (contracts — which orchestrate dossiers and bundles).

**Operating environment for design choices: few expert users collaborating on the same Obsidian vault concurrently** (Syncthing / iCloud / git-sync — vault-memory itself stays local-first; sync is the user's problem). This reshapes Phase 3's design pressure: mtime drifts under sync timing and is therefore a weak authority signal; section addresses must survive concurrent edits without invalidating citations; dossier matching must tolerate collaborators renaming notes.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-16): four gray areas were researched and discussed. The user asked for plausible options for the operating environment (few expert users collaborating concurrently) and accepted the recommended option on all four. Decisions D-01..D-08 below are the locked outputs; the remaining items live under Claude's Discretion, anchored by ADR-003 + ASM-01..ASM-13 + the Phase 1/2 seam discipline.

### Section Identity & Outline Shape

- **D-01: Each section carries BOTH a content-hash anchor AND a heading-path array.** The anchor (`anchor: string` — content hash of heading text + body bytes per section) is the citation token: stable across reorder and rename, breaks only on content edit. The heading-path (`heading_path: string[]` — ordered heading texts from root to this section) is the human-readable navigation and display string. Anchors are the chunk-level `source_hashes` (ADR-003 D-05) that Phase 5's brief layer consumes — invalidation is automatic when a section's anchor changes.
  - **Rationale for collaborative-vault context:** Two collaborators editing the same section produce different anchors, correctly signalling divergence. Positional chunk IDs (rejected) would break every citation after any prepended section. Heading-path slugs (rejected) collide when users name H2s identically and don't give Phase 5 a hash to detect edits.
  - **Implication:** `BlockNode` from Phase 1 (`paragraph | heading | code | list`) is extended with a `Section` aggregation concept — a section is a heading block plus all descendant blocks until the next equal-or-shallower heading. Researcher consults `src/chunker/headings.ts` for the existing extraction logic and proposes whether sections become a new top-level type or are computed on demand. Planner picks; ADR-003 may need an Invariants addendum.

- **D-02: `get_outline` returns a nested tree, not a flat list.** Each node: `{ anchor, heading_path, heading_text, level, chunk_ids: string[], children: OutlineNode[] }`. Nested matches how agents reason about hierarchy and how Phase 5 briefs need to cite "the Status section under Q3-Status". `chunk_ids` are the v1 chunk-table IDs (still exists, still BM25/FTS5 unit) — keeps the new outline addressable to the existing storage layer without forcing a migration.

### Dossier Semantics

- **D-03: `assemble_dossier({type, key})` matches strictly on `properties.type`.** Type is an exact match against `Document.properties.type` (string). Tag-only users (`#person` without `type: Person`) get a clear "no documents found" with a hint pointing at the convention. Atlas Robotics fixture already uses `type:`, so this is testable from day one. Per-vault TOML dossier-type registries (proposed option A3 / second-choice) are **deferred** to Phase 6 (contracts) where the contract DSL is the natural surface for "what counts as a Person in this vault."

- **D-04: `key` matches against `title` OR any entry in `properties.aliases`.** `properties.aliases: string[]` is the Obsidian-native alias mechanism (already populated by the obsidian-fs source adapter). Survives renames if the user maintains aliases. If no match found, dossier returns an empty result with a structured "no matching anchor document" error, not silently. Explicit `properties.id` matching is deferred — adds complexity without a clear v2 demand.

- **D-05: Dossier output = `{ anchor, linked_documents, property_rollups }`.**
  - `anchor`: the citation packet for the matched anchor document (the "Alice" document itself).
  - `linked_documents`: array of citation packets for every document linking TO the anchor (backlinks) — each packet includes a `relation: "wikilink" | "frontmatter-ref" | "mention" | "hyperlink"` field telling the agent how it links.
  - `property_rollups`: value aggregates across linked docs. Default rollups: `linked_count: number`, `linked_types: Record<string, number>` (e.g. `{ "Project": 4, "Meeting": 12 }`), `status_distribution: Record<string, number>` (e.g. `{ "active": 5, "done": 8, "superseded": 1 }`). Additional rollups discretionary to the planner — Phase 6 contracts may extend.
  - Counts-only output (proposed option C1, rejected) wouldn't give agents enough signal to act.

### Authority Signal & Weight Math

- **D-06: Three-tier authority composition — `status` (hard filter), `properties.authoritative` (soft boost), `mtime` (soft recency signal).**
  - `status: "superseded"` → hidden by default; surfaced only with `include_superseded: true`. Hard filter, not a weight, because superseded docs are *factually wrong*, not just lower-priority. Matches Phase 2 D-03's forward-only supersede semantics; no graph traversal needed at search time (Phase 4 derives back-edges later).
  - `properties.authoritative === true` → contributes `1.0` to the authority signal, otherwise `0`. Boolean for v2.0.0. Numeric `properties.priority` deferred — expert users in a shared vault agree on enums faster than on numbers.
  - `mtime` → soft recency signal. Critical caveat for collaborative vaults: mtime drifts with sync timing, not content quality. The default `recency_weight = 0` reflects this — callers opt in when they explicitly want freshness pressure (e.g. an agent compiling a "what's changed this week" brief).

- **D-07: Math is post-RRF additive rescore.** `final = rrf_score + recency_weight × exp(-age_days / half_life) + authority_weight × authority_signal`, then re-sort. Defaults: `recency_weight = 0`, `authority_weight = 0`, `half_life = 30 days`.
  - **v1-baseline invariance is proven by construction**: when both weights are 0, the rescore terms vanish and final order == rrf order. ASM-09 acceptance follows trivially.
  - **`include_superseded` defaults to `false`** but the filter is a no-op on the v1 baseline (no docs in `evals/fixtures/` have `status: superseded`). v1 fixture still produces identical hit lists.
  - **half_life is fixed at 30 days for v2.0.0.** Configurable half-life deferred — adds a knob without a clear v2 demand. If real-world usage shows expert users wanting "weekly relevance," Phase 5 (briefs) is the place to revisit, not search.
  - **Authority signal is binary, not continuous, in v2.0.0.** `authoritative: true → 1, else 0`. Multiplicative authority (proposed option C, rejected) reads more naturally but makes the v1-baseline proof harder.

### Backwards-Compatibility of `search_hybrid`

- **D-08: All Phase 3 additions to `search_hybrid` are strictly additive.**
  - **New optional params**: `recency_weight?: number = 0`, `authority_weight?: number = 0`, `include_superseded?: boolean = false`, `half_life_days?: number = 30` (planner may close this if D-07's "fixed at 30" wins; cheap to leave open).
  - **New optional result fields** on every hit: `source_handle`, `doc_id`, `heading_path`, `mtime`, `hash`, `display_url`, `status?`, `superseded_by?`, `properties?`. Existing fields (`path`, `chunk_id`, `score`, `snippet`, etc.) are unchanged.
  - **No versioned tool name (`search_hybrid_v2` rejected)**. Doubles the tool surface and contradicts PROJECT.md / REQUIREMENTS.md "Backwards-compat v1.x API non-negotiable."
  - **Enforcement**: `evals/v1-baseline/baseline.test.ts` + `evals/v1-baseline/tools-list.snapshot.json` catch any breaking change in CI. The snapshot test specifically pins the `tools/list` output for `search_hybrid` — adding optional params is permitted (Zod `optional()`); changing required params or removing fields fails the snapshot diff.
  - **The same additive rule applies to all four new tools**: their first v2.0.0 shapes set the API surface; subsequent v2.x minor versions may add optional params/fields but cannot remove or rename.

### Claude's Discretion

Several implementation areas were deliberately **not discussed**. Researcher + planner choose, anchored by ADR-003 + ASM-01..ASM-13 + Phase 1/2 outputs. Maintainer reviews in PR.

- **Where assembly code lives.** `src/assembly/` (new module, L3 per ARCHITECTURE.md) is the obvious answer, with sub-files per tool. Planner picks the final split. Sections might live in `src/sections/` if section identity gets large enough to warrant separation, or stay in `src/chunker/` as an extension. The single-resolver discipline from Phase 1 still applies.

- **Section storage strategy.** Three options:
  1. Compute sections + anchors on demand from the existing `chunks` table + a small index of heading positions (zero migration, slower for repeated outline calls).
  2. Materialize sections in a new SQLite table `sections(doc_id, anchor, heading_path, level, chunk_id_first, chunk_id_last)` — adds a migration but makes `get_outline` and `search_sections` cheap.
  3. Compute outline on demand but cache `(doc_id, hash) → outline` in memory with mtime invalidation.
  Recommendation lean: option 2 (materialize) — Phase 5 briefs will read sections often, and migrations are cheap given the existing migration ladder. Planner decides.

- **`search_sections` ranking.** The existing hybrid pipeline returns chunks; `search_sections` must return whole sections. Three composition strategies:
  1. Rank chunks first (existing pipeline unchanged), then aggregate each section's score as the max (or sum) of its chunks' scores.
  2. Rerun BM25/FTS against section-aggregated text directly.
  3. Hybrid: chunk-level RRF, then upgrade each top-K chunk to its enclosing section.
  Recommendation lean: option 3 — keeps existing v1 chunk pipeline as the working set, then promotes to sections at result-shaping time. Planner picks.

- **Error shape for the new tools.** Phase 2 D-01 established `recall` returns `[]` for no results, not an error. Phase 3 should follow: empty arrays for "no match," structured errors only for genuinely exceptional cases (unknown `doc_id`, malformed input). The Phase 1/2 `WriteResult`-style discriminated union doesn't apply here (these are read-side tools); plain throwing-on-invalid-input via the existing Zod input schemas + standard MCP `isError: true` envelope is sufficient.

- **Recent-edits surface in `get_document_bundle`.** The spec says "+ recent edits." The planner picks: last N audit entries from `audit_log`, or last N change-feed events, or last N indexer runs that touched the doc. Recommendation lean: audit-log entries since they survive across restarts and don't require change-feed buffering. Constrain to ≤10 most recent for token-budget reasons.

- **Dossier eval design (ASM-10).** ≥5 dossier queries on Atlas Robotics fixture. Planner picks the queries; recommendation lean: cover all four matched edge types (`wikilink`, `frontmatter-ref`, `mention`, `hyperlink`) plus a multi-alias case and a "no match found" negative case.

- **MCP Resources promotion candidates (ASM-13).** `list_dossiers` is the obvious one. Planner audits the four tools' read-only sub-operations and proposes which become Resources vs. stay as tools. Default to **Tools** when in doubt (Resources require a stable resource URI scheme and add API-surface complexity; Phase 2 MEM-09 already promoted the obvious cases).

- **Stub-adapter eval coverage (ASM-12).** The stub adapter from Phase 1 has a small `Document[]` fixture. Phase 3 extends it to cover the four new tools' eval scenarios. Planner decides whether to expand the stub's fixture to mirror Atlas Robotics structurally, or build a smaller purpose-built `Document[]` set focused on the four tools' contract. Recommendation lean: purpose-built — fewer test inputs, more focused assertions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 specs (the WHAT)
- `.planning/REQUIREMENTS.md` §"Assembly + Authority/Staleness (Phase 3)" — ASM-01..ASM-13 (the precise deliverable list)
- `.planning/ROADMAP.md` §"Phase 3: Bundles + authority/staleness" — goal + 5 success criteria
- `.planning/PROJECT.md` — v2 mission; especially "agents never write silently into user notes" (no agent-writes in Phase 3, but the rule frames where assembly *results* may surface and the recent-edits inclusion in bundles)

### ADRs (lock the type contracts and invariants)
- `docs/v2/adr/001-document-identity.md` — opaque `DocId`; URI shape; identity contract Phase 3 honors (every citation packet's `doc_id` is opaque)
- `docs/v2/adr/002-adapter-seams.md` — `SourceConnector` interface; Phase 3 reads through `readDocument(id)` and the document iterator; no fs/path imports outside adapter dir (CI grep)
- `docs/v2/adr/003-document-shape.md` — `Document`, `BlockNode`, `Edge`, `PropertyBag` shapes; H-1..H-6 hash semantics; D-05 chunk-level `source_hashes` schema (D-01's section anchors are the chunk-level hashes); typed `Edge` types `wikilink | mention | frontmatter-ref | hyperlink` that Phase 3 dossier rollups consume
- `docs/v2/adr/004-memory-sink-handles.md` — citation packet shape interaction (memory-sink documents returned by `recall` must produce identical citation packets to bundles; Phase 3 enforces the union)
- `docs/v2/MEMORY_CONTRACT.md` — provenance keys (`source`, `confidence`, `status`, `superseded_by`, `authoritative?`) that authority-filter and authority-boost read
- `docs/v2/ARCHITECTURE.md` — L3 assembly layer placement; new `src/assembly/` (or equivalent) sits here
- `docs/v2/AGENT_AGNOSTIC.md` — MCP-as-canonical-interface stance constrains the four new tools' shape and the optional Resources promotion

### Prior phase outputs Phase 3 consumes directly
- `.planning/phases/02-memory-namespace-provenance-contract/02-CONTEXT.md` — D-01 establishes the citation-packet shape Phase 3 makes universal; D-03 establishes forward-only supersede (no back-link materialization — Phase 3's filter must work without it)
- `.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md` — adapter seam discipline (CI greps zero-hit outside adapters), Document/BlockNode/Edge types
- `.planning/phases/00-foundation-decisions/00-CONTEXT.md` — eval-fixture discipline; v1-baseline regression suite frozen
- `docs/v2/adr/ADVERSARIAL-REVIEW.md` — Phase 0 findings; especially anything touching property/type contracts and citation shapes

### Phase 1/2 code to consume directly
- `src/types.ts` — canonical `Document`, `BlockNode`, `Edge`, `SourceHandle`, `MemorySinkHandle`, `WikilinkRef` (lines 280..420). Phase 3 extends `BlockNode` (or adds a `Section` aggregation) with anchors per D-01.
- `src/adapters/source/types.ts` + `src/adapters/source/obsidian-fs/` — Phase 1 source connector; Phase 3 reads only via `SourceConnector.readDocument()` / iteration (never `gray-matter` / `fs.readFile` directly — enforced by CI greps)
- `src/adapters/source/conformance.test.ts` — Phase 3 extends with assertions covering the four new tools against `obsidian-fs` and the stub
- `src/search/hybrid.ts` — RRF pipeline; D-07 adds a post-RRF additive rescore step; `rrfMerge()` is unchanged
- `src/chunker/headings.ts` + `src/chunker/chunker.ts` — existing heading-aware chunker; D-01's section identity reuses this for heading extraction
- `src/graph/graph.ts` — Phase 1 wikilink graph; Phase 3 `get_document_bundle` reads backlinks/forward links via this module (no edge typing yet — that's Phase 4)
- `src/audit/audit.ts` — `get_document_bundle.recent_edits` likely reads from here (Claude's Discretion)
- `src/tool-registry.ts` — Phase 0 extracted; Phase 3 registers four new MCP tools here
- `src/db/queries/chunks.ts` + `src/db/queries/fts.ts` — existing chunk + BM25 storage; `search_sections` aggregates chunk scores into sections per D-07's Claude's-Discretion section
- `evals/v1-baseline/baseline.test.ts` — Phase 3 must keep green; `search_hybrid` default behavior with no weights/filters produces identical hits
- `evals/v1-baseline/tools-list.snapshot.json` — strictly additive params; Phase 3 PR will need to regenerate this snapshot once (showing the additive diff) and the PR review confirms additive-only

### Codebase maps (read for Phase 3 mechanics)
- `.planning/codebase/ARCHITECTURE.md` — current layer model; new `src/assembly/` at L3
- `.planning/codebase/STRUCTURE.md` — directory layout + "Where to Add New Code" recipes
- `.planning/codebase/CONVENTIONS.md` — ESM + `.js` extension, kebab-case, Zod validation, type-check-as-lint
- `.planning/codebase/TESTING.md` — vitest layout; new tests co-located; conformance suite extension lives in `src/adapters/source/conformance.test.ts`
- `.planning/codebase/CONCERNS.md` — known v1 quirks (especially around chunking + heading extraction edge cases)

### External references
- MCP SDK 1.29 Resource API — needed if ASM-13 promotes any list-style ops to Resources; consult official docs for `setRequestHandler(ListResourcesRequestSchema, ...)` / `setRequestHandler(ReadResourceRequestSchema, ...)` or the newer `registerResource(...)` API
- Cormack et al. 2009 (RRF) — already cited in `src/search/hybrid.ts:9`; Phase 3 does not alter RRF, just rescores its output

### Operating-environment context (informs design choices)
- **Few expert users collaborating concurrently on a shared Obsidian vault** (Syncthing / iCloud / git-sync as the sync substrate; vault-memory itself stays local-first per PROJECT.md "Out of Scope: Cloud sync / Multi-user"). This frames why mtime is a weak authority signal (D-06), why section anchors must be content-hashed (D-01), why alias matching beats title-strict (D-04), and why `recency_weight` defaults to 0.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`Document` / `BlockNode` / `Edge` canonical types** (`src/types.ts:280..420`) — already in place from Phase 1. Phase 3 extends `BlockNode` (or layers a `Section` aggregation) with anchor + heading-path per D-01; no breaking change.
- **`Edge.type` discriminator** (`src/types.ts:329..336`) — already supports `wikilink | mention | frontmatter-ref | hyperlink`; the dossier `linked_documents[].relation` field reuses this verbatim.
- **`Document.properties.aliases: WikilinkRef[]` and friends** — already populated by the obsidian-fs source adapter (D-05 from Phase 1). Dossier key-matching reads these directly.
- **`rrfMerge()` and the hybrid pipeline** (`src/search/hybrid.ts`) — Phase 3 wraps it in a post-RRF rescore step; the existing function signature is untouched.
- **Heading extraction** (`src/chunker/headings.ts`) — D-01's heading-path construction reuses this. Sections aggregate chunks under heading boundaries.
- **`SourceConnector.readDocument()` / iteration** (`src/adapters/source/types.ts`) — the only entry point for reading `Document`s; Phase 3 honors this strictly.
- **Stub adapter from Phase 1** (`src/adapters/source/conformance.test.ts` + companion stub files) — already proves source-neutrality. Phase 3 extends, doesn't reinvent.
- **`tool-registry.ts`** (Phase 0) — central registration; four new tools land here.
- **`audit_log`** (`src/audit/audit.ts`) — candidate source for `get_document_bundle.recent_edits` (Claude's Discretion).
- **`evals/v1-baseline/`** — frozen regression suite; CI fails any breaking change to `search_hybrid`.

### Established Patterns
- **Citation packet shape is Phase 2 D-01 locked**: `{ doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties? }`. `recall` returns it. Phase 3 makes it universal across all four new tools AND the additive fields on `search_hybrid`.
- **Discriminated-union write results** (`src/adapters/delivery/types.ts`) — Phase 3 is read-side, doesn't extend this. Empty arrays for "no match"; Zod throws for malformed input.
- **Adapter seam discipline** — no `fs`, `gray-matter`, `path.join` outside `src/adapters/source/` and `src/adapters/delivery/`. CI greps enforce; Phase 3 must not regress.
- **`PropertyBag` provenance lives in `Document.properties`** (`src/types.ts`); authority/staleness signals (`status`, `authoritative`, `superseded_by`) read from there.
- **Conformance suite as the cross-adapter contract surface** (`src/adapters/source/conformance.test.ts`) — every `SourceConnector` (obsidian-fs + StubSource + future notion-api) passes the same Phase-3 assembly assertions.
- **Vitest co-location** — `*.test.ts` next to source files.
- **v1-baseline + tool-snapshot pin** — `evals/v1-baseline/tools-list.snapshot.json` catches any breaking change to `search_hybrid`'s public shape. Additive optional params/fields permitted; renames/removals fail CI.

### Integration Points
- **`src/assembly/` (new)** — the four new tools live here; L3 layer per ARCHITECTURE.md.
- **`src/search/hybrid.ts`** — post-RRF rescore step inserts after `rrfMerge()`, before return.
- **`src/tool-registry.ts`** — `get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier` register here.
- **`src/db/queries/chunks.ts` + `src/db/queries/fts.ts`** — read-side queries; sections may need either a new aggregation step OR a new materialized `sections` table (Claude's Discretion).
- **`src/graph/graph.ts`** — backlink/forward-link reads for `get_document_bundle` and `assemble_dossier`.
- **`src/audit/audit.ts:appendWrite()` + audit queries** — likely source for `recent_edits` in bundles.
- **`src/adapters/source/conformance.test.ts`** — extended with Phase 3 assertions covering all four tools against both adapters.
- **`evals/fixtures/v2-test-vault/`** — Atlas Robotics fixture provides the dossier test queries (ASM-10); Phase 3 may add `_queries/assembly/` YAMLs to mirror the per-category pattern from Phase 0.
- **`evals/v1-baseline/baseline.test.ts`** — must continue to pass; the snapshot file regenerates once with the additive diff in the Phase 3 PR.

</code_context>

<specifics>
## Specific Ideas

- **The section anchor IS the chunk-level `source_hash` referenced by ADR-003 D-05.** Phase 5 brief staleness watches anchors directly — no separate hashing infrastructure needed. The `source_hashes: { chunk_id → hash }` map in a brief's properties is literally `{ section_anchor → "stable" }`. This is the single most important downstream coupling Phase 3 sets up.

- **Citation packet field `heading_path` for a *document-level* citation (e.g. a `recall` hit, a `search_hybrid` hit that didn't promote to section) is an empty array `[]`.** Section-level citations have a non-empty `heading_path`. This convention lets agents detect granularity from the citation alone.

- **`status: "superseded"` filter is mechanically simple but semantically important.** Forward-only supersede from Phase 2 D-03 means we never need to traverse a graph at search time to check supersession — the `status` property on the doc itself is authoritative. Phase 4 (graph-as-retrieval) computes back-edges *separately* for the `superseded_by` reverse-pointer surface, but Phase 3's filter does not depend on that.

- **`include_superseded: true` is the v2-version of "show me everything."** Not a debug flag — it's a real use case (auditor agent reviewing supersede history, time-travel queries). Document it as such in the tool description.

- **Recency `half_life = 30 days` is a guess, locked for v2.0.0.** Once we have real usage signal we can revisit; do not parameterize it in v2.0.0 unless the planner finds a strong reason.

- **For the collaborative-vault audience, an agent doing "what's authoritative on topic X?" should set `recency_weight = 0` and `authority_weight = 1.0`** — surfacing user-curated truth, not sync-recency. Worth documenting in the tool description / a recipe.

</specifics>

<deferred>
## Deferred Ideas

- **Per-vault TOML dossier-type registry** (`[dossier_types.Person] match = "type:Person OR #person"`) — option A3 from area 2 discussion. Defer to Phase 6 (task contract DSL); contracts are the natural home for "what counts as a Person in this vault." Phase 3 ships with strict `properties.type` matching only.

- **Configurable half-life for the recency decay term.** Defer until real usage shows a need. v2.0.0 hard-codes 30 days.

- **Numeric `properties.priority` as an authority signal.** Boolean `authoritative` is sufficient for v2.0.0. If expert-collaborator usage shows a need for ranked authority (e.g. "this draft is more authoritative than that draft but less than the published spec"), Phase 5 (briefs) or Phase 6 (contracts) revisits.

- **Multiplicative authority math** (option C from area 3). Rejected for v2.0.0 in favor of additive (cleaner v1-baseline proof). May revisit in v2.x if additive feels too weak in practice.

- **Pre-RRF authority/recency as a fourth ranker.** Rejected for v2.0.0 in favor of post-RRF additive. May revisit if section-search ranking quality demands it.

- **Subscribable MCP Resources for `list_dossiers`-style ops** — Phase 2 already deferred this for `memory_stats` / `list_sinks`. Same call here: polled-only in v2.0.0 unless trivially small.

- **Materialized `sections` table** — a Claude's-Discretion choice, leaning toward "yes materialize" for Phase 5's read load. If the planner picks compute-on-demand, materialization becomes a Phase 5 prereq.

- **Explicit `properties.id` key matching for dossiers.** v2.0.0 matches title OR alias only; explicit-ID matching can come in v2.x without breaking changes.

- **Cross-source citation packets** (a citation that points to a Notion doc from within an Obsidian-vault dossier rollup) — out of v2 scope per Phase 10 deferral.

- **Edge-type filtering on dossier rollups** (e.g. "show only `mention`-typed backlinks") — Phase 4 surface; Phase 3 dossier returns all edge types with the `relation` field on each linked-document citation.

</deferred>

---

*Phase: 03-bundles-authority-staleness*
*Context gathered: 2026-05-16*
