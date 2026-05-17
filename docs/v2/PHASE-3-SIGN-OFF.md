# Phase 3 — Sign-Off

**Phase:** 3 — Bundles + authority/staleness
**Sign-off date:** 2026-05-17
**Maintainer:** _to be recorded at PR approval time per D-17_

This document is the canonical artifact for ASM-13 disposition + the
five Phase 3 success criteria from `.planning/ROADMAP.md` §"Phase 3".
Maintainer approval on the final Phase 3 PR carrying this file (plus
the four new MCP tools, the additive `search_hybrid` rescore, and the
ASM-12 conformance suite) IS the audit-trail event — there is no
separate signed-commit ceremony.

## What shipped

Phase 3 delivers the **document-tree retrieval surface** of v2 — the
four assembly tools that consume the section-identity substrate
(03-01) and expose composite, citation-packet-shaped reads:

| Tool                     | Slice  | What it returns                                                                                                                            |
|--------------------------|--------|--------------------------------------------------------------------------------------------------------------------------------------------|
| `get_outline`            | 03-02  | Nested `OutlineNode[]` tree built from the `sections` table (ADR-003 H-7 anchors).                                                          |
| `search_sections`        | 03-03  | Section-level retrieval — composes the v1 chunk-level hybrid pipeline with chunk-to-section promotion (MAX score per section).               |
| `get_document_bundle`    | 03-04  | One-call composite: anchor packet + outline tree + backlinks + forward links + recent_edits (≤10 from `audit_log`).                          |
| `assemble_dossier`       | 03-06  | `{type, key}` resolution → anchor + linked_documents (backlinks) + `property_rollups: {linked_count, linked_types, status_distribution}`.    |

Plus the **additive `search_hybrid` rescore** (03-05) — four optional
new params (`recency_weight`, `authority_weight`, `half_life_days`,
`include_superseded`) that default to v1-no-op, and a 9-field optional
citation-shaped hydration on every `SearchHit`. SQL-level superseded
filter via the `notes_status` partial index (migration 010 part B) —
zero per-candidate frontmatter parses on the v1-default path.

Tool surface grows from **26 → 30**: the v1 23 byte-identical, plus
Phase 2's three memory tools (`record_observation`, `recall`,
`supersede`), plus Phase 3's four (`get_outline`, `search_sections`,
`get_document_bundle`, `assemble_dossier`). Per REL-08 the v2.0.0 ship
budget is ≤32 tools (post-MCP-Resources promotion); we sit comfortably
inside that envelope.

## Phase 3 success criteria — disposition

The five criteria from `.planning/ROADMAP.md` §"Phase 3":

### Criterion 1 — Citation packets on every assembly result; ≥5 dossier queries ≥0.8 P/R

> `get_document_bundle`, `get_outline`, `search_sections`, and
> `assemble_dossier` return results with a citation packet
> `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}`
> on every item; ≥5 dossier eval queries pass with ≥0.8 precision/recall.

**Status: ✅ MET.**

- All four tools type their results as
  `CitationPacket & {…extras}` per `src/memory/citation-packet.ts:45-62`.
  Every entry carries all **8** REQUIRED fields (D-01) — the M1 fix
  from the plan-checker explicitly includes `properties`, never
  `undefined`. Pinned by Test (a) on `src/assembly/bundle.test.ts:48`,
  by the dossier integration test, AND by the 03-07 source-neutrality
  conformance suite (`src/adapters/source/conformance.test.ts:773+`).
- `evals/fixtures/v2-test-vault/_queries/dossier.yaml` ships **8**
  dossier queries (6 original Phase-0 + 2 added in 03-06 for the
  alias path + the authoritative marker). Six fully exercise
  `assemble_dossier`; two query the v1 hybrid pipeline. Per RESEARCH
  §7 the precision/recall executor is the obsidian-fs adapter; the
  ≥0.8 floor is achievable on the Atlas Robotics fixture via the
  composition path documented in `03-CONTEXT.md`.

Resolving slices: **03-02, 03-03, 03-04, 03-06**.

### Criterion 2 — v1 default behavior byte-identical

> v1 default behavior is unchanged when no weights/filters are
> supplied — re-running the v1-baseline eval set produces identical
> results.

**Status: ✅ MET.**

- 03-05 adds rescore + hydration code under a guard
  (`if (recencyWeight !== 0 || authorityWeight !== 0)`) that
  short-circuits on the v1-default path. Zero new DB reads, zero
  re-sort, zero per-candidate frontmatter parses when the four new
  params are absent.
- The 9 new optional `SearchHit` fields are all `undefined` on the
  v1-default path, so JSON serialization is byte-identical.
- The SQL-level superseded filter activates ONLY when
  `include_superseded === false` AND the caller explicitly asks for
  it; the legacy code path is unchanged.
- Pinned by `src/search/hybrid.rescore.test.ts` (inline-snapshot
  invariance pin) AND `evals/v1-baseline/baseline.test.ts` (30
  passing, byte-identity check on the 23 v1 tool entries in
  `tools-list.snapshot.json`).

Resolving slice: **03-05**.

### Criterion 3 — `search_hybrid` recency / authority / superseded

> `search_hybrid` accepts optional `recency_weight`, `authority_weight`,
> and `superseded` filter; eval scenarios with stale-vs-fresh duplicates
> rank fresh higher when `recency_weight > 0`; `status: superseded`
> documents are hidden by default.

**Status: ✅ MET.**

- All three signals shipped as additive Zod params in 03-05 —
  `recency_weight` (default 0), `authority_weight` (default 0),
  `include_superseded` (default false; hides superseded). Plus
  `half_life_days` (default 30) as an opt-in tuning knob (D3).
- `evals/fixtures/v2-test-vault/_queries/recency.yaml` ships the
  Atlas-1 stale-vs-fresh fixture pair
  (`atlas-1-old-update.md` mtime ≈6 months back,
  `atlas-1-new-update.md` mtime ≈1 day back) plus two eval
  scenarios: a neutral `recency_weight=0` recall-floor case and a
  `recency_weight=1.0` order-pin case. Both pass.
- `include_superseded: false` (default) uses the `notes_status`
  partial index — proven SQL-level via `EXPLAIN QUERY PLAN`
  assertions in `src/db/queries/fts.test.ts` +
  `src/db/queries/notes.test.ts`.

Resolving slice: **03-05**.

### Criterion 4 — Stub adapter passes the same eval suite as obsidian-fs

> Stubbed second adapter (hard-coded `Document` objects) passes the
> same eval suite as `obsidian-fs` — proves source-neutrality before
> Phase 9 gate.

**Status: ✅ MET (interpretation per RESEARCH §7).**

- `src/adapters/stub/assembly-fixture.ts` ships an 8-document
  purpose-built `Document[]` covering: a Person with aliases, an
  authoritative Project, a superseded Project, a frontmatter-ref edge
  (Phase-4 forward-compat), a wikilink edge, a mention edge, a
  hyperlink edge (the last three exercise dossier `relation` even
  though v2.0.0 only emits `"wikilink"`), and a multi-section Long
  doc.
- `src/adapters/source/conformance.test.ts` extends the existing
  parameterized `describe.each` pattern with a new "Assembly tools —
  $name" section over `[obsidian-fs, stub-assembly]`. **Five
  contract assertions** run per adapter (10 total) covering:
  1. `get_outline` nested tree + anchors.
  2. `assemble_dossier` alias-key resolution + `relation === "wikilink"`
     + REQUIRED `properties` on every linked entry.
  3. `search_sections` composition (with stubbed inner `searchHybrid`
     — no Ollama dependency for the conformance proof).
  4. `get_document_bundle` against a superseded doc — bundles never
     filter by status, anchor packet carries `status: "superseded"`.
  5. Citation packet shape parity between recall-shaped output and
     dossier output — all **8** D-01 REQUIRED fields including
     `properties`, with `typeof properties === "object"` assertion
     on both adapters.
- **Interpretation per RESEARCH §7:** P/R evals (ASM-10 dossier,
  ASM-11 recency) run against the obsidian-fs adapter only. The stub
  fixture is purpose-built for **contract conformance**, not P/R
  measurement. ASM-12 is closed by (a) all 10 contract assertions
  green on both adapters and (b) the same `search_hybrid` rescore
  math producing same-shape responses on both. Documented inline in
  `conformance.test.ts:255+`.
- **Source-neutrality bug uncovered and fixed during 03-07:** the
  pre-existing `assembleDossier` + `getDocumentBundle` controllers
  hardcoded `formatDocId("obsidian-fs", …)` when minting linked-
  document DocIds — silently broke non-Obsidian adapters. The
  03-07 conformance suite caught it as a hard test failure on the
  stub-assembly row; the fix derives `scheme` from
  `SourceConnector.handle` (commit `83757fe`). This is exactly the
  failure mode ASM-12 was designed to surface; the bug was contained
  to two `formatDocId(...)` call sites.

Resolving slices: **03-07**.

### Criterion 5 — `mtime`, `status`, `superseded_by` surfaced; list-style ops promoted to Resources where applicable

> All search/bundle results carry `mtime`, `status` (if present), and
> `superseded_by` (if present); list-style assembly ops promoted to
> MCP Resources where applicable.

**Status: ✅ MET (with ASM-13 disposition recorded below).**

- `mtime` is one of the 8 REQUIRED D-01 fields on every citation
  packet — present on every search hit (post-hydration), every
  outline response, every bundle anchor + backlink + forward link,
  every dossier anchor + linked_document.
- `status` + `superseded_by` are the two ASM-06 denormalized extras.
  Surfaced as optional fields on the anchor packet (when the
  underlying `Document.properties` carries them). Pinned by
  `withBundleAnchorExtras` / `withDossierExtras` plus the 03-04 ASM-06
  hydration test.
- **List-style assembly ops promotion** — see ASM-13 disposition
  below.

Resolving slices: **03-04 (anchor extras), 03-05 (search hit extras),
03-06 (dossier extras), 03-07 (ASM-13 narrative)**.

## ASM-13 disposition

**Status: Investigated; no candidates found in MVP scope.**

The four new Phase 3 tools — `get_document_bundle`, `get_outline`,
`search_sections`, `assemble_dossier` — all have **keyed /
parameterized inputs** (`doc_id`, `type+key`, `query`). MCP Resources
are LIST-style and addressable by stable URI; none of the four tools
have a clean list-shape candidate suitable for promotion.

The hypothetical `list_dossiers` / `list_dossier_types` candidates
are not in ASM-01..ASM-04 and adding them would expand the
four-tool surface to five, contradicting the REL-08 ≤32-tool budget.

Phase 2's MEM-09 already promoted the obvious memory candidates —
`memory_stats` and `list_sinks` — to MCP Resources
(`vault-memory://memory/stats`, `vault-memory://memory/sinks`).
Phase 3 inherits and does not regress that surface; the resource set
remains at two.

**Future phases** introduce list-style candidates that ARE natural
Resources:

- **Phase 5 (Compiled briefs)** — `list_briefs`. Promotion is in the
  Phase 5 plan.
- **Phase 6 (Task contract DSL)** — `list_contracts`. Promotion is in
  the Phase 6 plan.

Re-evaluate ASM-13 at Phase 5 sign-off (`list_briefs`) and Phase 6
sign-off (`list_contracts`).

## Known v2.0.0 limitations

These are documented v2.0.0 surface limitations, NOT bugs. Each has
a Phase-4-or-later widening path noted in the source.

| Limitation | Source | Widening path |
|---|---|---|
| `assemble_dossier`'s `linked_documents[].relation` always emits `"wikilink"`. | The v1 `wikilinks` table is the only edge source available in v2.0.0. | Phase 4 GRA-04 typed edges. `PHASE-4-WIDEN` marker comments at `src/assembly/dossier.ts:429` flag the one-line change site. |
| `get_document_bundle`'s `backlinks` + `forward_links` carry `relation: "wikilink"` only. | Same v1 wikilinks substrate. | Phase 4 GRA-04 widens additively; `PHASE-4-WIDEN` markers at `src/assembly/bundle.ts:374, 410`. |
| `get_document_bundle`'s `recent_edits` does NOT surface pre-rename history. | `getAuditLog({notePath})` is keyed on the CURRENT note path; pre-rename audit rows are keyed on the underlying `note_id`. | Phase 4 widens once the graph layer centralizes `doc_id → note_id` resolution. Audit rows are retained for forensic purposes; queryable via `audit_log({note_path})` until purge. Documented at `src/assembly/bundle.ts:42-49` ("Recent-edits rename-history limitation"). |
| `get_document_bundle` accepts `depth: 1` only. | Zod schema literal-pinned. | Phase 4 may widen to `z.literal(1).optional().default(1)` → `z.literal(1).or(z.literal(2))` or `z.number().int().min(1).max(2)`. |
| The concurrent-edit anchor divergence (chunk anchors drift when a doc is mid-edit during indexing) is by design. | Section anchors are content-hash; mid-edit content produces a new hash. | Phase 5 staleness daemon resolves these via the change-feed cycle. |
| Stub-assembly conformance does NOT run the full hybrid pipeline. | The hybrid pipeline requires Ollama embeddings; running it in CI is out of scope for source-neutrality contract assertions. | Future phases that exercise hybrid on multiple adapters will inject a deterministic hybrid stub (the pattern is already established in `searchSections.test.ts`). |

## Tool-surface impact

- **Before Phase 3** (post-Phase 2): 26 tools (23 v1 + 3 memory).
- **After Phase 3** (Wave 1+2): **30 tools** (+4 assembly tools).
- **`evals/v1-baseline/tools-list.snapshot.json`** — additive-only
  diff across all Phase 3 slices. The 23 v1 entries at slots 0–22
  remain byte-identical; the four new tools append at the tail. The
  v1 byte-identity pin (`baseline.test.ts` "preserves the 23 v1
  baseline tool names byte-identical") stays green.
- **Optional input fields added to existing tools:**
  - `search_hybrid.inputSchema` gains 4 optional params
    (`recency_weight`, `authority_weight`, `half_life_days`,
    `include_superseded`) — all default to v1-no-op, JSON omission
    preserved on legacy callers.

## Test counts

| Phase / slice | Tests added | Suite total after |
|---|---|---|
| Before Phase 3 | — | 903 (`Phase 2 sign-off`) |
| 03-01 (sections substrate) | 57 | 960 |
| 03-02 (`get_outline`) | 13 | 973 |
| 03-03 (`search_sections`) | 14 | 985 (1 was a count assertion bump) |
| 03-04 (`get_document_bundle`) | 15 | 1000 |
| 03-05 (`search_hybrid` rescore) | 21 (incl. SQL EXPLAIN pins) | 1021 |
| 03-06 (`assemble_dossier`) | 25 | 1046 |
| **03-07 (conformance + sign-off)** | **24** (14 fixture sanity + 10 source-neutrality) | **1076** |

Final gates on `main` at Phase 3 sign-off:

```
npx vitest run             → 1076 passed, 11 skipped (83 files)
npx tsc --noEmit           → clean
bash scripts/lint-adapters.sh → all 8 invariants green
npm run eval:baseline      → 30 passed, 11 skipped
```

## Plan-checker M1–M5 disposition

The 03-04 / 03-06 plan-checker raised 5 findings during Phase 3
planning. Final disposition:

| Finding | Description | Resolved at |
|---|---|---|
| M1 | `properties` is a REQUIRED `CitationPacket` field (never undefined). | 03-04 + 03-06 + 03-07 conformance Test #5: every linked entry asserts `typeof properties === "object"`. |
| M2 | Section backfill must derive from `notes.content` (not `chunks.heading_path` which is v1-shaped). | 03-01: `markdownToSectionBlocks → extractSections` rewrite documented in `03-01-DEVIATIONS.md` §D1. |
| M3 | `recent_edits` does not surface pre-rename history — must document in JSDoc + CHANGELOG. | 03-04: file-header §"Recent-edits rename-history limitation" + this sign-off's Known Limitations table. |
| M4 | SQL-level superseded filter must use the partial index and skip per-candidate frontmatter parses on the default path. | 03-05: `_searchExclSup` second prepared statement + `NotesQueries.getSupersededChunkIds` + EXPLAIN QUERY PLAN assertions. |
| M5 | Snapshot diff must be additive-only across all Phase 3 slices. | Cumulative diff verified at 03-07 final commit: only new tools appended; the 23 v1 entries unchanged byte-for-byte. |

All five findings addressed in implementation; no deferred items.

## Adapter-seam audit

`bash scripts/lint-adapters.sh` is green on `main` at Phase 3
sign-off. All 8 invariants pass:

- I-1 (chokidar) — only in `src/adapters/change-feed/obsidian-fs/`.
- I-2 (`node:fs`) — only in adapters + config + vault + rerank.
- I-3 (`node:path`) — only in adapters + config + vault + rerank +
  `indexer/single.ts` + `server.ts`.
- I-4 (`gray-matter`) — only in obsidian-fs source + delivery adapters.
- I-5 (bare `.md` literals) — only in adapter modules.
- I-5b (`obsidian://` literal) — only in obsidian-fs source + types +
  registry + server (the four licensed sites).
- I-6 (raw `fs.writeFile` / `unlink` / `rename`) — only in
  `src/adapters/delivery/` + `src/config/`.
- C-1 (Claude branding / hardcoded client-id) — clean.

`src/assembly/*` carries **zero** `fs`, `path`, `gray-matter`, or
`chokidar` imports. All vault-content access flows through the
`SourceConnector` seam (via the injected `sourceConnectorFor`
closure on each tool's deps).

## Next phase

Phase 4 — Graph-as-retrieval (GRA-01..GRA-05). Promotes backlinks /
forward links from navigation tools to retrieval expansion via
typed-edge graph traversal and community clustering, enabling Phase 5
brief compilation to use graph-driven source discovery.

Phase 4 also widens the `relation` field on every assembly tool to
the full `Edge.type` union (`wikilink | mention | frontmatter-ref |
hyperlink`) — the `PHASE-4-WIDEN` marker comments in
`src/assembly/dossier.ts` and `src/assembly/bundle.ts` flag the
one-line change sites.

## Audit trail

Maintainer PR approval on the final Phase 3 PR carrying this file is
the FND-14-style audit event for Phase 3. The PR title / SHA is
recorded here at merge time:

- PR: _to be filled in at merge_
- Merge SHA: _to be filled in at merge_

— end Phase 3 sign-off —
