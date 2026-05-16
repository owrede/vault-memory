# Phase 3: Bundles + Authority/Staleness — Research

**Researched:** 2026-05-16
**Domain:** Document-tree assembly + ranking signals over an existing hybrid retrieval substrate
**Confidence:** HIGH (every recommendation pins to existing file:line or to a locked CONTEXT decision)

## Summary

Phase 3 delivers four assembly tools (`get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier`), the universal citation packet across all read tools (including additive fields on `search_hybrid`), and a post-RRF additive rescore step for recency/authority — all proven source-neutral against the existing Phase-1 `StubSource`. The locked decisions D-01..D-08 already pin the hard contracts (anchor + heading_path, nested outline tree, additive rescore math, no `_v2` tool); the remaining design surface is implementation placement, schema strategy, ranking composition, and the audit/eval shape.

**Top recommendations (one-liners):**

1. **Materialize sections in a new `sections` table** (migration 010) keyed by `(note_id, anchor)`, populated by the chunker on every (re)index. Reading sections at query time becomes a single indexed SELECT — vital for Phase 5's repeated section reads.
2. **`search_sections` aggregates chunk RRF, then promotes top-K chunks to enclosing sections** (Claude's-Discretion option 3) — keeps the v1 chunk pipeline as the working set, adds a thin post-RRF projection.
3. **Extend `BlockNode`** with an optional `Section` aggregation type (`{kind: "section", anchor, heading_path, level, blocks: BlockNode[]}`) — this is the canonical Phase 3 surface that Phase 5 briefs consume directly. ADR-003 gets a tiny Invariants addendum (H-7) but no breaking change.
4. **Post-RRF additive rescore lives in `src/search/hybrid.ts` at one new insertion point** (after `flat.sort` at line 196, before the reranker block at line 202). A small `clock?: () => number` option is injected for deterministic `age_days`.
5. **Recent edits read from `audit_log`**, filtered by `note_id`, capped at 10 — already returns `{at, op, client_id}` per Phase-2 work. No new infrastructure.
6. **Assembly module lives at `src/assembly/`** with five files: `bundle.ts`, `outline.ts`, `sections.ts`, `dossier.ts`, `index.ts`. Sections support code lives in `src/sections/` (extraction + materialization), separate from `src/chunker/` (which already exists at L0).
7. **Stub fixture is purpose-built** as a `Document[]` array of ~8 documents covering the four tools' contracts (dossier types, aliases, status, authoritative, nested headings) — separate from the obsidian-fs Atlas-Robotics fixture which drives the precision/recall evals.
8. **MCP Resources promotion: defer entirely for Phase 3** — none of the four new tools have a clean stable-URI list operation in their MVP shape. `list_dossiers` is not in ASM-01..ASM-04 and adding it is out of scope; if needed, promote in a Phase-3 follow-up rather than expanding scope mid-phase.
9. **The five-query dossier eval is already drafted in `_queries/dossier.yaml`** — research recommends keeping the existing six dossier queries (alice, atlas-1, pivot, bob, spire, reliability) and extending Atlas-Robotics with `aliases:` frontmatter on at least one person doc so D-04 alias matching has an eval.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `get_document_bundle` controller | L3 Assembly (`src/assembly/bundle.ts`) | L2 (cites memory docs via packet) | New L3 surface per ARCHITECTURE.md §Layer model |
| `get_outline` controller | L3 Assembly (`src/assembly/outline.ts`) | L0 (reads `sections` + `chunks`) | Outline is a tree query over indexed section data |
| `search_sections` controller | L3 Assembly (`src/assembly/sections.ts`) | L0 (delegates to `hybridSearch`) | Aggregation step on top of existing RRF pipeline |
| `assemble_dossier` controller | L3 Assembly (`src/assembly/dossier.ts`) | L1 graph (`src/graph/`) + L0 (FTS + property reads) | Walks edges + properties — natural L3 composition |
| Section identity (anchor + heading_path) | L0 Substrate (`src/sections/`) | Adapter (reads `Document.blocks`) | Computed once at index time, queried hot at L3 |
| Post-RRF rescore (recency + authority) | L0 Substrate (`src/search/hybrid.ts`) | — | Single insertion point; keeps `hybridSearch` the canonical search entry |
| Citation packet build | L2 (`src/memory/citation-packet.ts`, already shipped) | L3 (every assembly tool calls `toCitationPacket`) | Re-use Phase 2's already-correct builder |
| Stub adapter assertions (ASM-12) | Adapter tier (`src/adapters/stub/`) | L3 (conformance.test.ts asserts contracts) | Source-neutrality proof at the seam |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASM-01 | `get_document_bundle({doc_id, depth?: 1})` | §1 placement, §5 recent_edits, §6 citation packet |
| ASM-02 | `get_outline({doc_id})` nested tree | §2 sections table, §4 BlockNode extension |
| ASM-03 | `search_sections({query, limit})` | §2 sections, §3 ranking composition |
| ASM-04 | `assemble_dossier({type, key})` | §9 eval design; D-03/D-04 locked |
| ASM-05 | Citation packet on every result | §6 reuse `toCitationPacket` (already at packet floor) |
| ASM-06 | Results carry mtime/status/superseded_by | §10 additive fields on `SearchHit` |
| ASM-07 | `search_hybrid` accepts recency_weight, authority_weight | §10 rescore insertion point |
| ASM-08 | `superseded` filter, default-hide | §10 pre-rescore filter |
| ASM-09 | v1 default unchanged when no weights/filters | §10 — math vanishes at weight=0; filter no-op on baseline fixture |
| ASM-10 | ≥5 dossier eval queries ≥0.8 P/R | §9 — six queries already in `_queries/dossier.yaml` |
| ASM-11 | Stale-vs-fresh duplicates rank fresh higher when weight>0 | §10 eval scenario sketch |
| ASM-12 | Stub adapter passes the same eval suite | §7 purpose-built Document[] fixture |
| ASM-13 | List-style ops promoted to Resources where applicable | §8 defer entirely; no clean candidates in MVP shape |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Section identity** — content-hash `anchor: string` (hash of heading text + body bytes for the section) + `heading_path: string[]` (root-to-leaf heading texts). The anchor is the chunk-level `source_hashes` referenced by ADR-003 D-05 — Phase 5 briefs consume them directly.
- **D-02: `get_outline` returns a nested tree** of `{anchor, heading_path, heading_text, level, chunk_ids: string[], children: OutlineNode[]}`.
- **D-03: `assemble_dossier` matches strictly on `properties.type`** (exact string match). No tag-based fallback. No TOML registry (deferred to Phase 6).
- **D-04: `key` matches `title` OR any entry in `properties.aliases: string[]`.** No explicit `properties.id` matching in v2.0.0.
- **D-05: Dossier output shape**: `{anchor, linked_documents (with `relation: "wikilink"|"frontmatter-ref"|"mention"|"hyperlink"` per packet), property_rollups: {linked_count, linked_types, status_distribution}}`. Additional rollups discretionary.
- **D-06: Three-tier authority** — `status` (hard filter), `properties.authoritative === true` (binary 1.0 boost), `mtime` (soft recency).
- **D-07: Post-RRF additive rescore.** `final = rrf_score + recency_weight × exp(-age_days / half_life) + authority_weight × authority_signal`. Defaults: weights 0, half_life 30 days, fixed. `include_superseded: false` default.
- **D-08: All `search_hybrid` additions strictly additive** — new optional params + new optional result fields. No `_v2` tool.

### Claude's Discretion

- Where assembly code lives (recommended split below).
- Section storage strategy (recommended: materialized table).
- `search_sections` ranking composition (recommended: chunk RRF → promote to section).
- BlockNode extension vs new Section type (recommended: extend BlockNode additively).
- Recent-edits source (recommended: audit_log, ≤10 entries).
- Citation packet `display_url` for non-Obsidian sources (StubSource already returns `null` → packet falls back to docId — confirmed correct).
- Stub-adapter eval coverage (recommended: purpose-built Document[]).
- MCP Resources promotion (recommended: defer entirely from Phase 3).
- Dossier eval queries (recommended: keep existing six in `_queries/dossier.yaml` + add alias case).
- `search_hybrid` rescore implementation surface (recommended insertion point + clock injection).

### Deferred Ideas (OUT OF SCOPE)

- Per-vault TOML dossier-type registry → Phase 6 (contracts DSL).
- Configurable `half_life` for recency decay → defer indefinitely (re-visit only if real usage demands).
- Numeric `properties.priority` authority signal → defer; boolean `authoritative` is sufficient for v2.0.0.
- Multiplicative authority math → rejected; additive cleaner for v1-baseline proof.
- Pre-RRF authority/recency as fourth ranker → rejected for v2.0.0.
- Subscribable MCP Resources → polled-only.
- Explicit `properties.id` key matching for dossiers → v2.x or later.
- Cross-source citation packets → v3 / Phase 10.
- Edge-type filtering on dossier rollups → Phase 4.

## Standard Stack

Phase 3 introduces **no new runtime dependencies**. Every primitive is already in the codebase:

| Library / Module | Version | Purpose | Why Standard |
|---|---|---|---|
| `better-sqlite3` `^11.7.0` | (existing) | Sync SQLite + new `sections` table | Already the v1 storage substrate (`src/db/database.ts:1`) |
| `zod` `^4.x` | (existing, Phase 1) | Input schemas for four new tools | Already used for all 23 v1 tools (`src/tool-registry.ts`) |
| `@modelcontextprotocol/sdk` `^1.29.x` | (existing, Phase 1) | `registerTool` for the four new tools | Phase 1 already migrated to SDK 1.29 with `registerTool` |
| `src/search/hybrid.ts` | (existing) | RRF pipeline that `search_sections` reuses + rescore insertion point | Phase-1 stable surface; no change to `rrfMerge()` signature |
| `src/memory/citation-packet.ts` | (existing, Phase 2) | `toCitationPacket(doc, displayUrl)` | D-01 packet floor already implemented and tested |
| `src/audit/audit.ts` | (existing, Phase 2) | `getAuditLog({vault, notePath, limit})` for recent_edits | Already enriched with note path/title at the audit-layer boundary |
| `src/graph/graph.ts` | (existing) | `listBacklinks` / `listForwardLinks` for bundle + dossier | Phase 4 will replace with typed-edge surface; Phase 3 uses the v1 surface |

**No new external dependencies.** Phase 3 is entirely composition + new internal modules.

## Package Legitimacy Audit

Phase 3 installs **zero external packages**. No legitimacy audit required.

## Per-item Findings (Claude's Discretion areas)

### 1. Where assembly code lives

**Options considered:**

- (a) New module `src/assembly/` with one file per tool (4–5 files).
- (b) Embed into existing `src/search/` (re-uses the search module's boundary).
- (c) Embed into `src/graph/` (since dossier walks edges).

**Recommendation: Option (a) — `src/assembly/`, with sections support split out under `src/sections/`.**

Concrete layout:

```
src/assembly/
├── index.ts          # barrel; exports four tool functions + types
├── bundle.ts         # get_document_bundle
├── outline.ts        # get_outline (consumes src/sections)
├── search-sections.ts# search_sections (consumes src/sections + hybridSearch)
├── dossier.ts        # assemble_dossier
└── types.ts          # OutlineNode, BundleResult, DossierResult, etc.

src/sections/
├── index.ts          # barrel
├── extract.ts        # extractSections(blocks) → SectionInfo[] (pure, in-memory)
├── anchor.ts         # computeAnchor(headingText, body) → sha256
└── queries.ts        # Database-bound SectionsQueries (read-side)
```

Plus a new DB query namespace:

```
src/db/queries/sections.ts  # SectionsQueries (insert/getByNote/getById/getByAnchor)
```

**Rationale:**

- ARCHITECTURE.md L3 mandates a new module; this is the natural home (`docs/v2/ARCHITECTURE.md:50`).
- Splitting sections out from `src/chunker/` preserves the existing chunker's stability — the chunker still emits chunks for L0 BM25/semantic; sections are a parallel index produced from the same parsed blocks.
- Keeping a single `index.ts` barrel matches the codebase convention (every existing module exposes one — see `src/search/index.ts`, `src/graph/index.ts`).
- CI grep enforcement: assembly code must NOT import `node:fs`, `node:path`, `gray-matter`, `chokidar`. Phase 1's `scripts/lint-adapters.sh` already enforces this — Phase 3 inherits the discipline by sitting outside the adapter tier.

**Citations:**

- `src/server.ts:381` — current `search_hybrid` handler shape that the four new tool handlers will mirror.
- `src/tool-registry.ts:1` — TOOLS + TOOL_SCHEMAS dual-export pattern that the four new tool registrations follow.
- `src/memory/tools/recall.ts:1` — exemplar L3 tool: pure controller, no fs/path imports, accepts injected closures for testability.

**Open questions for the planner:**

- Should the section-anchor computation share a `canonicalize` helper with ADR-003's `Document.hash` algorithm (NFC + LF, RFC 8785 for properties)? Recommendation: **yes** — anchors must survive cross-adapter (Phase 10) without normalization divergence. Reuse the existing `src/render/plain-text.ts` mentioned in ADR-003 §"Hash semantics" if it's been written; if not, ship a minimal NFC+LF helper in `src/sections/anchor.ts`.

### 2. Section storage strategy

**Options considered:**

- (1) Compute sections + anchors on demand from `chunks.heading_path` + `notes.content` at every `get_outline` / `search_sections` call (zero migration).
- (2) Materialize `sections(note_id, anchor, heading_path, level, chunk_id_first, chunk_id_last)` table; populated by indexer.
- (3) Compute on demand + in-memory `(note_id, hash) → outline` cache with mtime invalidation.

**Recommendation: Option (2) — materialize a `sections` table via migration 010.**

Schema sketch (migration 010):

```sql
CREATE TABLE sections (
  id           INTEGER PRIMARY KEY,
  note_id      INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  anchor       TEXT NOT NULL,             -- sha256 hex of heading_text + section body bytes
  heading_path TEXT NOT NULL,             -- JSON array of strings (root → leaf)
  heading_text TEXT NOT NULL,             -- leaf heading text (or "" for preamble)
  level        INTEGER NOT NULL,          -- 0 = preamble, 1..6 = heading level
  parent_id    INTEGER REFERENCES sections(id) ON DELETE CASCADE,
                                          -- nested tree pointer for O(1) outline assembly
  ord          INTEGER NOT NULL,          -- order among siblings (stable iteration)
  chunk_id_first INTEGER REFERENCES chunks(id),
  chunk_id_last  INTEGER REFERENCES chunks(id),
                                          -- inclusive chunk-id range owned by this section
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX sections_note_anchor ON sections(note_id, anchor);
CREATE INDEX sections_note_ord ON sections(note_id, parent_id, ord);
```

**Why materialize:**

- Phase 5 briefs read sections often (cited section → re-fetch on staleness check); compute-on-demand would re-parse blocks on every read.
- The migration ladder is well-established (`src/db/database.ts:97`, `src/db/schema.ts:503` shows v9 currently at top). Adding v10 is mechanically trivial.
- Anchor lookups become `WHERE note_id = ? AND anchor = ?` — O(log N) on a unique index — vs O(blocks) on demand.
- `chunk_id_first`/`chunk_id_last` give `search_sections` a free "section → chunks" projection without joining heading text.
- `parent_id` lets `get_outline` produce the D-02 nested tree with one indexed SELECT + a tiny in-memory tree-building loop, instead of re-walking the markdown.

**Implications for indexer:**

- The indexer (`src/indexer/indexer.ts`) gains a `sections` build step alongside `chunks`. Both are derived from the same parsed `BlockNode[]` (post-Phase-1) or the `ParsedNote.content` + `extractHeadings()` output (current shape) — this is a tactical decision the planner picks.
- On note delete, `ON DELETE CASCADE` handles cleanup.
- On note update, the indexer deletes-and-reinserts sections for that `note_id` (mirrors existing `chunks` re-insert in `ChunksQueries.deleteByNote`).

**Migration cost:** one migration file, ~80 lines of SQL + a backfill step that walks all existing notes' content and computes sections lazily (or accepts that older notes have no sections until next re-index — `catchup` will fix it on next start). Recommend lazy backfill (cheap, idempotent).

**Citations:**

- `src/db/schema.ts:503` — MIGRATIONS array (current top: v9, Plan 02-06).
- `src/db/queries/chunks.ts:13` — exemplar QueryClass shape that `SectionsQueries` mirrors.
- `src/chunker/headings.ts:28` — `extractHeadings()` already produces `HeadingRef[]` with level + text + line + offset. Section extraction extends this by walking from heading offset to next equal-or-shallower heading.

**Open questions for the planner:**

- Does Phase 5 staleness need the anchor stored alongside the brief's `source_hashes` map (per ADR-003 H-5 the chunk-uri form is `<doc_uri>#chunk-<n>` — but D-01 from this phase mandates anchor==chunk-level source_hash)? Recommendation: **store anchor as the canonical map key**, deprecate `#chunk-<n>` form via a future ADR-003 amendment. Out of scope for Phase 3; flag for Phase 5 plan.

### 3. `search_sections` ranking composition

**Options considered:**

- (1) Rank chunks first (existing pipeline unchanged), aggregate per section as max/sum of constituent chunk scores.
- (2) Rerun BM25/FTS against section-aggregated text — requires materializing `section_text` and a parallel FTS index.
- (3) Hybrid: chunk RRF, then promote top-K chunks to enclosing section (de-dup by section id).

**Recommendation: Option (3) — chunk RRF, promote to section.**

Sketch of the new `search_sections` controller:

```typescript
// src/assembly/search-sections.ts
export async function searchSections(deps, opts: SearchSectionsOpts): Promise<SectionHit[]> {
  // 1. Run existing hybridSearch with a generous topK multiplier (e.g. topK * 5)
  //    so we have enough chunks to cover the requested number of sections.
  const chunkHits = await deps.hybridSearch({
    ...opts,
    topK: opts.limit * 5,
  });

  // 2. Project each chunk to its enclosing section via SectionsQueries.
  //    Multiple chunks of the same section collapse into one section hit;
  //    section score = max(constituent chunk RRF scores).
  const sectionMap = new Map<string /* anchor */, SectionHit>();
  for (const hit of chunkHits) {
    const section = deps.sectionsByNote.findContaining(hit.noteId, hit.chunkId);
    if (!section) continue;
    const existing = sectionMap.get(section.anchor);
    if (!existing || hit.score > existing.score) {
      sectionMap.set(section.anchor, { ...buildSectionHit(section), score: hit.score });
    }
  }

  // 3. Sort by score desc; slice to opts.limit.
  return [...sectionMap.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit);
}
```

**Why option 3 over 1/2:**

- Option 2 doubles the FTS storage cost and forks the search pipeline — two parallel pipelines for chunks vs sections invites drift.
- Option 1 still requires the "chunk → section" projection; once you have that, the promotion-via-max is mechanically identical and uses the same indexed lookup.
- Option 3 preserves the existing v1-baseline `search_hybrid` pipeline byte-for-byte (D-07's v1 default-invariance proof generalizes — the new tool doesn't perturb the old one).

**Aggregation function:** **max** over sum, because RRF scores already encode rank position; summing would punish short sections (fewer chunks → lower sum even if each chunk is highly ranked). Max gives "the section's best chunk's score" which is the natural human reading of "how relevant is this section."

**Tiebreak:** when two sections tie on score, sort by min `chunk_id_first` (earlier sections in document order win).

**Citations:**

- `src/search/hybrid.ts:153` — `hybridSearch()` entry point that `searchSections` calls.
- `src/search/hybrid.ts:210` — `vault.db.chunks.getById(h.chunkId)` shows how chunks are hydrated from RRF hits; sections need an analogous `SectionsQueries.findContainingChunk(chunkId)` query.

**Open questions for the planner:**

- Should `search_sections` accept `recency_weight` / `authority_weight` like `search_hybrid` (D-08)? Recommendation: **yes — same additive params**, since the underlying hybridSearch call already does the rescore. The section-level promotion preserves the rescored chunk order, so the section's `score` is post-rescore.

### 4. `BlockNode` extension vs. new `Section` type

**Options considered:**

- (a) Add a `Section` aggregation type to the `BlockNode` union: `{kind: "section", anchor, heading_path, level, blocks: BlockNode[]}`.
- (b) Keep `BlockNode` flat; compute sections on demand in `src/sections/`; store materialized rows in DB.
- (c) Add fields directly to `HeadingNode` (`anchor`, `heading_path`).

**Recommendation: Option (a) AND (b) combined.**

Concretely:
- `BlockNode` union gets one new variant: `{kind: "section", anchor: string, heading_path: string[], level: 1|2|3|4|5|6, blocks: BlockNode[]}` — used as the canonical *return* shape from `get_outline` and consumed by Phase 5 briefs.
- Sections are still materialized in DB (option 2 above) — the union variant is the **type** Phase 3+ assembly tools return; the DB rows are how they're stored.
- `HeadingNode` is **unchanged**. Adding fields there muddies the line between "a heading is a block" and "a section is an aggregation that begins with a heading."

ADR-003 currently defines (`docs/v2/adr/003-document-shape.md:67–79`) `BlockNode` as a union of paragraph/heading/list/code/table/quote/callout/embed/raw. Phase 1 implemented a minimal subset in `src/types.ts:311–315` (only paragraph/heading/code/list). Phase 3's `Section` is a natural addition.

**ADR-003 addendum needed:** add an Invariants entry:

> **H-7**: A `Section` block aggregates a `HeadingNode` and all `BlockNode` descendants up to (but not including) the next equal-or-shallower heading. The `anchor` is the sha256 hex of `NFC(heading_text) || "\n" || render_blocks_to_plain_text(blocks)`. The `heading_path` is the array of ancestor heading texts (NFC-normalized, root → leaf, inclusive of this section's heading). Top-of-document content with no preceding heading is wrapped as `{kind: "section", level: 0, heading_path: [], heading_text: "", anchor: sha256(NFC("") || "\n" || body)}`.

This addendum is small and additive — no breaking change to existing Phase-1 BlockNode consumers.

**Citations:**

- `src/types.ts:311–315` — current `BlockNode` shape; extension is `| { kind: "section"; anchor: string; heading_path: string[]; level: 1|2|3|4|5|6; blocks: BlockNode[] }`.
- `docs/v2/adr/003-document-shape.md:67` — ADR-003's `BlockNode` definition; H-7 fits as the seventh invariant.

**Open questions for the planner:**

- Should `BlockBase.anchor?: string` from the ADR-003 spec (`docs/v2/adr/003-document-shape.md:79–82`) be used to carry the anchor on *every* block (not just sections)? Recommendation: **scope creep — defer**. Phase 3 only needs anchors on sections (which is what citations cite). Block-level anchors are useful for paragraph-level citations but no Phase 3 requirement asks for them.

### 5. `get_document_bundle.recent_edits` source

**Options considered:**

- (a) `audit_log` table entries filtered by `note_id` (write events: create/update/delete).
- (b) `change_feed` events (file-system level — finer-grained but transient).
- (c) Indexer-run timestamps (`getIndexRuns()` — coarse, only marks "the indexer touched this note", not "the user/agent edited it").

**Recommendation: Option (a) — `audit_log`.**

The `getAuditLog()` function (`src/audit/audit.ts:87`) already returns enriched `AuditLogEntry[]` with `{id, notePath, noteTitle, op, at, client_id, diffSummary, is_memory_sink_write}`. The bundle's recent-edits surface needs only a subset:

```typescript
interface BundleRecentEdit {
  at: number;             // epoch ms
  op: "create" | "update" | "delete";
  client_id: string | null;  // surfaced as "who" — null for user writes
}
```

Per the CONTEXT.md guidance, cap at **≤10 most recent**. The audit-log API already accepts `limit` (`src/audit/audit.ts:62`).

**Filter strategy:** Pass `notePath` = doc's vault-relative path (extracted from `doc_id` via `decomposeDocId`).

**Why audit_log over change_feed:**

- Audit log persists across server restarts; change_feed is a live stream.
- Audit log already carries `client_id` — separates "user edited in Obsidian" (null) from "agent edited via `record_observation`" (a real client_id).
- `is_memory_sink_write` discriminator is already wired in (Plan 02-06) — bundle can optionally surface "this note was edited by the memory subsystem" cleanly.

**Why ≤10 cap matters:** bundles are JSON responses returned to agents; one bundle can carry one note's last-10 edits without blowing the token budget. Larger histories belong to a dedicated `audit_log` tool call.

**Citations:**

- `src/audit/audit.ts:87–125` — `getAuditLog()` already returns the shape needed.
- `src/audit/audit.ts:19–43` — `AuditLogEntry` is rich; bundle picks the subset.

**Open questions for the planner:**

- Should `recent_edits` include `is_memory_sink_write` as a tag (so an agent sees "this was edited by an agent" vs "this was edited by the user")? Recommendation: **yes — additive surface**, costs nothing, useful for agents reasoning about provenance.

### 6. Citation packet `display_url` for non-Obsidian sources

`toCitationPacket(doc, displayUrl)` already exists at `src/memory/citation-packet.ts`. The packet shape is the D-01 8-field surface that `recall` already returns and Phase 3 makes universal.

**StubSource:** `formatDisplayUrl()` returns `null` (`src/adapters/stub/source.ts:81`). The `displayUrlFor()` helper (`src/memory/citation-packet.ts`) falls back to the docId string when the adapter returns null. So the packet's `display_url` is always non-null — `obsidian://open?…` for the obsidian-fs adapter, the raw `stub://memory/a.md` DocId for stub.

**Recommendation:** **No change needed.** The current contract is exactly what Phase 3 requires. The four new assembly tools call `toCitationPacket(doc, displayUrlFor(doc.id, source))` and inherit the existing behavior. This is verified by the existing `src/memory/citation-packet.test.ts`.

The `heading_path: []` convention (empty array for document-level packets, non-empty for section-level packets per CONTEXT.md §specifics) is already supported by the packet builder's `heading_path?: string[]` input field.

**Open questions for the planner:**

- The packet currently treats `display_url` as required-non-null (`display_url: string`). For future non-Obsidian sources that genuinely have no deep link, should the type be `string | null`? Recommendation: **keep `string`** and lean on the docId fallback — agents prefer a copy-pasteable string over null. Re-visit only if a v3 adapter has both no display URL *and* no useful docId surface (unlikely).

### 7. Stub-adapter extension for ASM-12 source-neutrality

**Options considered:**

- (a) Extend the existing `StubSource` Atlas-Robotics-mirror Document[] to cover the four new tools' contracts.
- (b) Build a purpose-built, smaller `Document[]` set focused on the four new tools' contracts.

**Recommendation: Option (b) — purpose-built fixture.**

The current StubSource fixture (`src/adapters/source/conformance.test.ts:31–64`) is three trivial docs (a/b/c) used to assert seam contracts (listDocuments, readDocument, hash, exists). It's not a content-rich fixture. ASM-12 requires that the four new assembly tools produce the same shape against StubSource as against ObsidianFsSource — that's a *contract* assertion, not a precision/recall assertion. The precision/recall evals (ASM-10) run against the obsidian-fs Atlas-Robotics fixture only.

Purpose-built `Document[]` skeleton for ASM-12 (≈8 docs):

```typescript
function makeAssemblyStubDocs(): Document[] {
  return [
    // Person doc with aliases (D-04 alias-match case)
    { id: docId("stub://memory/people/alice.md"), title: "Alice",
      properties: { type: "Person", aliases: ["Alice C.", "ac"], status: "active" },
      blocks: [
        { kind: "heading", level: 1, text: "Alice" },
        { kind: "paragraph", text: "CEO since 2024." },
        { kind: "heading", level: 2, text: "Working style" },
        { kind: "paragraph", text: "Async-first." },
      ], … },

    // Authoritative doc (D-06 authority boost case)
    { id: docId("stub://memory/projects/atlas-1.md"), title: "Atlas-1",
      properties: { type: "Project", status: "active", authoritative: true,
                    owner: "alice" },
      blocks: [
        { kind: "heading", level: 1, text: "Atlas-1" },
        { kind: "paragraph", text: "Flagship project." },
      ], … },

    // Superseded doc (ASM-08 default-hide)
    { id: docId("stub://memory/projects/atlas-0.md"), title: "Atlas-0",
      properties: { type: "Project", status: "superseded",
                    superseded_by: "stub://memory/projects/atlas-1.md" },
      blocks: [...], … },

    // Doc referencing alice via frontmatter (dossier edge-type case)
    { id: docId("stub://memory/meetings/2026-04-15.md"), title: "Q2 Review",
      properties: { type: "Meeting", attendees: ["Alice", "Bob"] },
      links: [{ type: "frontmatter-ref", target: docId("stub://memory/people/alice.md") }], … },

    // Doc with wikilink to alice (wikilink edge-type case)
    { id: docId("stub://memory/notes/sync.md"), title: "Sync notes",
      links: [{ type: "wikilink", target: docId("stub://memory/people/alice.md") }], … },

    // Doc with mention edge to alice
    { id: docId("stub://memory/notes/mention.md"), title: "Mention",
      links: [{ type: "mention", target: docId("stub://memory/people/alice.md") }], … },

    // Doc with hyperlink edge to alice
    { id: docId("stub://memory/notes/hyperlink.md"), title: "Hyperlink",
      links: [{ type: "hyperlink", target: docId("stub://memory/people/alice.md") }], … },

    // Multi-section doc for outline + search_sections tests
    { id: docId("stub://memory/long.md"), title: "Long",
      blocks: [
        { kind: "heading", level: 1, text: "Intro" },
        { kind: "paragraph", text: "..." },
        { kind: "heading", level: 2, text: "Background" },
        { kind: "paragraph", text: "..." },
        { kind: "heading", level: 2, text: "Conclusion" },
        { kind: "paragraph", text: "..." },
      ], … },
  ];
}
```

The conformance suite (`src/adapters/source/conformance.test.ts`) gets a new section parameterized over `[obsidian-fs Atlas, stub assembly fixture]` asserting:

- `get_outline(longDocId)` returns a tree of three sections (Intro at level-1, Background + Conclusion as children).
- `assemble_dossier({type: "Person", key: "Alice C."})` returns alice's anchor + four linked_documents (one per edge type) + property_rollups.
- `search_sections({query: "Working style", limit: 5})` returns the section anchor for "Working style" first.
- `get_document_bundle(superseded_atlas_0)` works (bundles never filter by status — only search does).

**Citations:**

- `src/adapters/source/conformance.test.ts:78–95` — existing adapter parameterization; the assembly suite plugs in here.
- `src/adapters/stub/source.ts:31` — StubSource accepts `Document[]` or shared `Map`; the assembly fixture passes an array.

**Open questions for the planner:**

- Should StubDelivery be exercised by Phase 3? Phase 3 is read-side; no writes. Recommendation: **no** — keep StubDelivery untouched.

### 8. MCP Resources promotion candidates (ASM-13)

**Audit of the four tools' read-only sub-operations:**

| Sub-op | Promotable to Resource? | Why |
|---|---|---|
| `get_outline(doc_id)` | No — keyed on doc_id (caller input), not a stable URI list | Resources are LIST-style, addressable by stable URI |
| `get_document_bundle(doc_id, depth)` | No — caller-parameterized | Same as above |
| `search_sections(query, limit)` | No — query is dynamic | Search is never a Resource |
| `assemble_dossier(type, key)` | No — keyed on type + key | Per-result keyed, not a list |
| Hypothetical `list_dossiers()` | Maybe — list of all `properties.type` values + their counts | Not in ASM-01..ASM-04; out of scope |
| Hypothetical `list_authoritative_docs()` | Maybe | Not in spec; out of scope |

**Recommendation: defer Resources promotion entirely from Phase 3.**

Reasoning:
- ASM-13 says "where applicable." None of the four tools have a clean Resource shape in their MVP form.
- `list_dossiers` is the obvious-but-out-of-scope candidate — adding it would expand the four-tool surface to five, contradicting the v2 tool-budget discipline (REL-08 ≤32 tools after promotion).
- Phase 2 already promoted the obvious cases (`memory_stats`, `list_sinks` — MEM-09).
- Future phases (5/6) introduce `list_briefs` and `list_contracts` which ARE natural Resources; their promotion is in their respective phases.

**ASM-13 disposition:** Mark as "investigated; no candidates found in MVP scope" in the phase sign-off — not "skipped."

**Open questions for the planner:**

- If `list_dossier_types()` (returns distinct values of `properties.type` across the vault + counts) is judged useful by the maintainer in PR review, it would be the single cleanest Resource. Scope it as a one-task plan, gated on maintainer approval. Default: out of scope.

### 9. Dossier eval design (ASM-10)

`evals/fixtures/v2-test-vault/_queries/dossier.yaml` already contains **six** dossier queries (alice, atlas-1, pivot, bob, spire, reliability — `evals/fixtures/v2-test-vault/_queries/dossier.yaml:5-75`). ASM-10 requires ≥5, so the floor is already met.

**Recommendation:** Keep the existing six queries, with two augmentations:

1. **Add `aliases:` frontmatter to at least one person doc** (e.g. alice-chen.md gains `aliases: ["Alice C.", "ac"]`) so the existing alice-chen-dossier query exercises D-04 alias matching. Currently the obsidian-fs fixture has no `aliases:` field on any doc (verified via grep: `grep -rn 'aliases:' evals/fixtures/v2-test-vault/` returns nothing).

2. **Add a 7th query: an authoritative-document-promoted case.** Mark `projects/atlas-1.md` as `authoritative: true` in its frontmatter (and add a new dossier query that runs with `authority_weight: 1.0`, expecting atlas-1 to rank above any other Project-type doc).

**Edge-type coverage check** (D-05 requires the `relation` field tagging each linked-document by wikilink/frontmatter-ref/mention/hyperlink):

- The existing fixture has `[[wikilinks]]` extensively (confirmed in alice-chen.md:14, 23).
- `attendees:` frontmatter on meeting docs are frontmatter-refs (need to verify; likely present given the OKR review docs).
- `mention` and `hyperlink` types are likely under-represented. Phase 4 will surface these as typed Edges; Phase 3 reads via the v1 `vault.db.wikilinks` surface (which only knows `wikilink`).

**Honest assessment:** Phase 3's dossier `relation` field can only be `"wikilink"` in v2.0.0 if it reads from the v1 wikilinks table. The CONTEXT.md D-05 lists all four edge types as if they were available — they're not yet, because Phase 4 (GRA-04) is what introduces the typed-edge schema. Two paths:

- **Path 1: Phase 3 ships dossier with `relation: "wikilink"` only**, with a documented future-additive plan to widen the field in Phase 4. This is consistent with CONTEXT.md "Phase 4 graph-as-retrieval — Phase 3 dossier returns all edge types with the relation field on each linked-document citation" being aspirational.
- **Path 2: Phase 3 ships a minimal typed-edge surface for `properties.aliases`, frontmatter references, and inline URL links** to populate the four edge types — but this is essentially doing Phase 4's job ahead of time.

**Recommendation: Path 1.** Ship dossier with `relation` field whose value is always `"wikilink"` in v2.0.0; document that Phase 4 widens this to the full four-type vocabulary. This is strictly additive (new optional `relation` field, single value in v2.0.0, four values in v2.1.0).

The five queries to count for ASM-10 floor:

| Query ID | What it tests | Expected behavior |
|---|---|---|
| alice-chen-dossier | type:Person + key match + wikilink edges | 5 docs returned, all with `relation: "wikilink"` |
| atlas-1-dossier | type:Project + key match + nested edges | 5 docs returned |
| pivot-dossier | type:Decision + linked observation + brief | 4 docs returned |
| bob-martinez-dossier | type:Person + project + decision + meeting edges | 5 docs returned |
| spire-dossier | type:Project + sub-projects + PM + meeting | 6 docs returned |
| reliability-program-dossier | type:Project + decision + retro + observation | 4 docs returned |
| **NEW: alice-by-alias** | D-04 alias match (`key: "Alice C."`) | Resolves to alice-chen.md anchor |
| **NEW: authoritative-atlas-1** | `authority_weight: 1.0` promotes `authoritative: true` doc | atlas-1.md ranks above other Project docs |

**Citations:**

- `evals/fixtures/v2-test-vault/_queries/dossier.yaml:1-75` — existing six queries.
- `evals/fixtures/v2-test-vault/people/alice-chen.md:1-6` — frontmatter currently lacks `aliases`; one-line addition unlocks the alias eval.

**Open questions for the planner:**

- The ≥0.8 precision/recall floor requires the four new tools to be production-quality, not stubs. The Phase-0 baseline tests use `it.todo` for not-yet-implemented behavioral floors (`evals/v1-baseline/baseline.test.ts:18`). Phase 3 lights up the `it.todo` placeholders — confirm with planner that this is the expected pattern.

### 10. `search_hybrid` rescore implementation surface

**Insertion point:** `src/search/hybrid.ts` between line 196 (`flat.sort((a, b) => b.rrf - a.rrf)`) and line 202 (the reranker block). The rescore runs on the global flat-sorted candidate list BEFORE optional reranker re-scores. Rationale: the reranker is a cross-encoder operating on chunk text and produces its own absolute score; running rescore-then-rerank means the rerank score overwrites the additive rescore but the candidate pool is correctly shaped by the rescore-driven order. If both rescore and reranker are used, the reranker's order wins (matches existing precedence). When `recency_weight=0` AND `authority_weight=0` (D-07 default), the rescore is a no-op and v1 default behavior is byte-identical.

**Math:**

```typescript
// New step inserted at src/search/hybrid.ts:~200 (between flat.sort and reranker block)
if (opts.recencyWeight !== 0 || opts.authorityWeight !== 0) {
  const now = opts.clock?.() ?? Date.now();
  const halfLifeMs = (opts.halfLifeDays ?? 30) * 24 * 60 * 60 * 1000;
  for (const h of flat) {
    // Hydrate mtime + properties from the chunk's parent note (one DB read per candidate).
    const vault = vaultByName.get(h.vaultName)!;
    const chunk = vault.db.chunks.getById(h.chunkId);
    if (!chunk) continue;
    const note = vault.db.notes.getById(chunk.note_id);
    if (!note) continue;
    const ageMs = Math.max(0, now - note.mtime);
    const recencyTerm = opts.recencyWeight * Math.exp(-ageMs / halfLifeMs);
    const authoritative = parseFrontmatter(note.frontmatter)?.authoritative === true;
    const authorityTerm = opts.authorityWeight * (authoritative ? 1.0 : 0);
    h.rrf += recencyTerm + authorityTerm;  // post-RRF additive
  }
  flat.sort((a, b) => b.rrf - a.rrf);  // resort
}
```

**Pre-rescore filter for `superseded`:** insert BEFORE the rescore (cheaper to filter than to rescore). The filter reads `properties.status` per candidate; on `"superseded"` AND `!opts.includeSuperseded`, drop from `flat`.

**Clock injection:** add `clock?: () => number` to `HybridSearchOptions` (`src/search/hybrid.ts:26`). Default `Date.now`. Recall already uses this pattern at `src/memory/tools/recall.ts:205` — same idiom. Tests inject a fixed clock for deterministic `age_days`.

**New `HybridSearchOptions` fields (all optional, all default to "v1 behavior"):**

```typescript
export interface HybridSearchOptions {
  // ...existing fields unchanged...
  recencyWeight?: number;        // default 0
  authorityWeight?: number;      // default 0
  halfLifeDays?: number;         // default 30
  includeSuperseded?: boolean;   // default false
  clock?: () => number;          // default Date.now
}
```

**New `SearchHit` fields (all optional, additive per D-08):**

```typescript
export interface SearchHit {
  // ...existing fields unchanged...
  doc_id?: DocId;
  source_handle?: SourceHandle;
  heading_path?: string[];       // empty array for doc-level hits, non-empty for section-level
  mtime?: number;
  hash?: string;
  display_url?: string;
  status?: string;
  superseded_by?: string;
  properties?: Record<string, unknown>;
}
```

These fields are populated in the hydration loop at `src/search/hybrid.ts:259-287`. The hydration call also reads each chunk's note frontmatter and surfaces `status` / `superseded_by` / `properties.authoritative` etc.

**Performance note:** the additional DB reads (`notes.getById` for mtime + frontmatter) run only when rescore is active (weights ≠ 0) or when the new fields are requested. v1 baseline path is byte-identical — same code path as today.

**Tools-list snapshot regeneration:** because Zod params are added as `.optional()`, the `tools/list` JSON Schema picks them up automatically (verified by Phase 1's TOOL_SCHEMAS pattern — `src/tool-registry.ts:11–35`). The snapshot test will fail until `evals/v1-baseline/tools-list.snapshot.json` is regenerated via `npm run eval:snapshot` (confirmed at `package.json:33`). This is a one-time regeneration per phase; the PR diff shows additive-only changes per D-08 enforcement.

**Citations:**

- `src/search/hybrid.ts:194-252` — exact insertion zone for rescore + filter.
- `src/search/hybrid.ts:264` — current hydration; field additions extend the existing builder.
- `package.json:33` — `eval:snapshot` script regenerates `tools-list.snapshot.json` manually (not a pre-commit hook — confirmed via `.github/workflows/` audit).
- `evals/v1-baseline/baseline.test.ts:62-68` — snapshot equality test pinning the additive shape.

**Open questions for the planner:**

- The new optional `SearchHit` fields use snake_case (`doc_id`, `source_handle`) for consistency with the citation packet (`src/memory/citation-packet.ts:35`), but existing `SearchHit` uses camelCase (`notePath`, `chunkText`). Recommendation: **use snake_case for the new fields** to align with the citation packet contract, and document in code comments that this is intentional. Mixed-case within a single result is awkward but additive-only.
- Should `heading_path` on the new fields be populated via the materialized `sections` table (looking up the section whose `chunk_id_first <= chunkId <= chunk_id_last`)? Recommendation: **yes** — same query path as `search_sections` uses, reuses the section materialization.

## Eval Plan (ASM-10 / ASM-11 / ASM-12)

### ASM-10 — Dossier precision/recall (≥0.8 on ≥5 queries)

Use the six existing queries in `evals/fixtures/v2-test-vault/_queries/dossier.yaml` plus one new alias query plus one new authority-aware query:

| Query | Expected anchor | Expected linked count | New eval mechanism |
|---|---|---|---|
| alice-chen-dossier | people/alice-chen.md | 5 (from fixture) | Verify all linked have `relation: "wikilink"` |
| atlas-1-dossier | projects/atlas-1.md | 5 | Verify property_rollups.linked_types includes Decision, Meeting, Reference, Brief |
| pivot-dossier | decisions/2026-03-12-pivot-to-warehouse.md | 4 | Verify status_distribution computes correctly |
| bob-martinez-dossier | people/bob-martinez.md | 5 | Multi-project ownership case |
| spire-dossier | projects/spire.md | 6 | Sub-project rollup case |
| reliability-program-dossier | projects/atlas-1-reliability-program.md | 4 | Decision + retro + observation rollup |
| **NEW alice-by-alias** | people/alice-chen.md | 5 | D-04 alias resolution (key: "Alice C.") |
| **NEW authoritative-atlas-1** | projects/atlas-1.md | n/a | `authority_weight=1.0` ranks atlas-1 above peers |

Precision/recall threshold: 0.8 per CONTEXT.md ASM-10.

### ASM-11 — Stale-vs-fresh ranking

Add two near-duplicate docs to the fixture (or to a new `_queries/recency.yaml` config):

- `notes/old-status.md` with `mtime` 90 days ago, content: "Atlas-1 status: prototyping"
- `notes/new-status.md` with `mtime` 1 day ago, content: "Atlas-1 status: shipping"

Two evals:

- `search_hybrid("Atlas-1 status")` with `recency_weight=0` → either ranking acceptable.
- `search_hybrid("Atlas-1 status", recency_weight=1.0)` → `new-status.md` ranked above `old-status.md`.

### ASM-12 — Source-neutrality conformance (stub adapter)

Extend `src/adapters/source/conformance.test.ts` with an assembly section parameterized over `[obsidianFsAdapter, stubAdapter]`:

```typescript
describe.each([obsidianFsCase, assemblyStubCase])("Assembly tools — $name", (c) => {
  it("get_outline returns nested tree with anchors", ...);
  it("assemble_dossier matches type=Person + alias key", ...);
  it("search_sections promotes chunks to sections by max RRF", ...);
  it("get_document_bundle includes recent_edits up to 10", ...);
  it("citation packet shape is byte-identical to recall", ...);
});
```

The stub fixture's 8 documents (sketch in §7) cover every assertion.

### v1 baseline invariance (ASM-09)

Re-run `evals/v1-baseline/baseline.test.ts` as part of Phase 3 CI. Two assertions must hold:

1. `evals/v1-baseline/tools-list.snapshot.json` matches TOOLS literal — regenerated once with additive optional fields only.
2. Every existing `*.yaml` semantic-floor (search_hybrid.yaml, etc.) produces the same hit list when no new weights/filters are supplied. The math in §10 (`weights=0 → rescore is no-op`) is the construction proof.

## Plan Dependencies (for vertical slicing)

This phase is MVP-mode → vertical feature slices preferred. Dependency graph:

```
                 ┌──────────────────────────────────────────┐
                 │  Wave 0 (foundation)                     │
                 │  - BlockNode `Section` variant (types)   │
                 │  - sections table migration (010)        │
                 │  - SectionsQueries                       │
                 │  - src/sections/ extract + anchor        │
                 │  - indexer hook: produce sections        │
                 └────┬──────────┬───────────┬──────────────┘
                      │          │           │
                      ▼          ▼           ▼
   ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐
   │  Wave 1a:    │  │  Wave 1b:       │  │  Wave 1c:        │
   │  get_outline │  │  search_sections│  │  get_document_   │
   │  (tree of    │  │  (chunk RRF +   │  │  bundle (audit + │
   │  sections)   │  │  promote)       │  │  links + outline)│
   └──────────────┘  └────────┬────────┘  └────────┬─────────┘
                              │                    │
                              ▼                    ▼
                     ┌─────────────────────────────────────┐
                     │  Wave 1d (independent slice):       │
                     │  assemble_dossier                   │
                     │  (type+alias + edges + rollups)     │
                     └─────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────┐
   │  Wave 2 (independent, runs parallel to Wave 1):          │
   │  - search_hybrid additive fields (doc_id, source_handle, │
   │    heading_path, mtime, status, …)                       │
   │  - post-RRF rescore + clock injection                    │
   │  - superseded filter                                     │
   │  - tools-list.snapshot.json regenerated                  │
   └──────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────┐
   │  Wave 3 (closing):                                       │
   │  - Stub Document[] fixture for ASM-12                    │
   │  - Conformance test extension (parameterized)            │
   │  - Atlas fixture: add aliases to alice, authoritative on │
   │    atlas-1, regenerate any affected dossier YAML         │
   │  - Phase 3 ADR-003 addendum (H-7 section invariant)      │
   └──────────────────────────────────────────────────────────┘
```

**Vertical slice candidates** (each one shippable independently against the same Wave 0):

- Slice A: `get_outline` + outline tests (smallest; pure read over sections table).
- Slice B: `search_sections` + tests (depends on hybridSearch; can ship before/after rescore work).
- Slice C: `get_document_bundle` + tests (composes outline + recent_edits + links; depends on Slice A's outline builder).
- Slice D: `assemble_dossier` + tests (independent — touches different tables).
- Slice E: `search_hybrid` rescore + additive fields (independent from A–D; gated only by its own snapshot regen).
- Slice F: ASM-12 conformance suite extension (after A–E exist, since it parameterizes over all of them).

**Critical path:** Wave 0 → Slice A → Slice C. Total of ~6 plans; Wave 2 (Slice E) can run in parallel.

## Open Risks

1. **Snapshot regeneration semantics.** Confirmed: `npm run eval:snapshot` is manual, not auto. `package.json:33` defines it; `.github/workflows/ci.yml` and `publish.yml` are present but no pre-commit hook regenerates it. **Risk closed.** Phase 3 PRs will include a single snapshot-regen commit alongside the rescore work; PR reviewer verifies the diff is additive-only.

2. **`relation` field for dossier in v2.0.0.** As noted in §9, the v1 wikilinks table only stores `"wikilink"` type. Phase 3 ships `relation: "wikilink"` for every linked document. Phase 4 widens. **Risk: mild** — CONTEXT.md D-05 reads as if all four types are available; the planner should call this out in the phase changelog so the maintainer is not surprised.

3. **Concurrent-vault editing and section anchor stability.** D-01 anchors are content-hashed; the operating environment is "few expert users collaborating concurrently." If two users edit the same section, anchors diverge — by design — but in-flight citations from a brief compiled before the edit point at an anchor that no longer exists. **Risk: deferred to Phase 5.** Phase 3 just produces stable anchors; Phase 5's staleness daemon detects divergence and flips briefs to `stale`. Document the lifecycle clearly in the assembly module README.

4. **Performance: full-vault `assemble_dossier` does an O(N) scan of `notes.frontmatter`** to find docs whose `properties.type` matches. The v1 `query_frontmatter` tool already does this via the `query_frontmatter` API path (`src/server.ts:418`); reuse it. **Risk: low**, but planner should add an index on `notes.frontmatter` `LIKE '%type":%'` only if benchmarks show a hot spot. Don't pre-optimize.

5. **`audit_log` recent_edits requires `note_id`, but the bundle is keyed on `doc_id`.** The decompose-doc-id → vault + path → note_id chain already exists (`src/adapters/registry.ts` exports `decomposeDocId`, used by `recall` at `src/memory/tools/recall.ts:48`). Reuse. **Risk closed.**

6. **`include_paths` optimization for sink-scoped search** — out of scope, but the recall code (`src/memory/tools/recall.ts:38–44`) notes this as a documented contingency if dossier perf is bad. Same pattern applies to dossier scoping if needed. Flag for the planner but don't ship pre-emptively.

7. **`search_sections` aggregation by max-score can fragment**: a section with one strong chunk and twenty weak chunks ranks the same as a section with one strong chunk and zero weak ones. Acceptable for v2.0.0; if precision/recall evals show fragmentation hurts, swap max → top-N mean as an additive optimization. **Risk: low.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Phase 1's existing `src/render/plain-text.ts` may or may not exist; ADR-003 mentions it as the canonical renderer | §1 (anchor compute) | If absent, Phase 3 ships a minimal NFC+LF helper in `src/sections/anchor.ts`. Low-risk because the helper is ~20 lines. |
| A2 | `properties.aliases` is an array of strings (D-04 reads "any entry in `properties.aliases`") | §9 (alias eval) | If aliases are objects rather than strings, the alias matcher needs adjustment. Low risk — Obsidian convention is `aliases: [str, str]`. |
| A3 | The audit_log API performance is adequate for ≤10 recent edits per note | §5 | The query is already indexed on `note_id` via the `notes` FK; no risk. |

(All three assumptions are low-confidence-but-low-impact; the planner can verify A1 in one grep at plan time.)

## Sources

### Primary (HIGH confidence — existing code)

- `src/types.ts:280–465` — canonical Document/BlockNode/Edge/SourceHandle/DocId types.
- `src/search/hybrid.ts:1–384` — entire RRF pipeline + rescore insertion zone.
- `src/chunker/headings.ts:1–88` — heading extraction reused by section materialization.
- `src/graph/graph.ts:1–130` — backlink/forward-link reads for bundle + dossier.
- `src/audit/audit.ts:1–156` — getAuditLog() supplies recent_edits.
- `src/memory/citation-packet.ts:1–100` — toCitationPacket already at D-01 floor.
- `src/memory/tools/recall.ts:1–215` — exemplar L3 tool pattern (injected deps, no fs imports).
- `src/adapters/source/types.ts:1–161` — SourceConnector contract surface.
- `src/adapters/stub/source.ts:1–84` — StubSource for ASM-12.
- `src/adapters/source/conformance.test.ts:1–100` — parameterized adapter conformance pattern.
- `src/db/schema.ts:503–550` — MIGRATIONS array (top is v9; v10 is the sections migration).
- `src/db/queries/chunks.ts:1–62` — query-class pattern for SectionsQueries to mirror.
- `src/db/queries/fts.ts:1–155` — BM25 entry; unchanged.
- `src/tool-registry.ts:1–120` — TOOLS + TOOL_SCHEMAS dual-export pattern.
- `src/server.ts:381–402` — search_hybrid handler shape that new handlers mirror.
- `package.json:33` — `eval:snapshot` script; manual regeneration confirmed.
- `evals/fixtures/v2-test-vault/_queries/dossier.yaml:1–75` — six existing dossier queries.
- `evals/fixtures/v2-test-vault/_queries/bundle.yaml:1–58` — five existing bundle queries.
- `evals/v1-baseline/baseline.test.ts:1–80` — snapshot test that catches non-additive changes.

### Primary (HIGH confidence — ADRs + Phase context)

- `docs/v2/adr/001-document-identity.md` — DocId opaque URI; I-1..I-6 invariants.
- `docs/v2/adr/002-adapter-seams.md` — SourceConnector/DeliveryAdapter/ChangeFeed seams + capabilities; CI grep enforcement.
- `docs/v2/adr/003-document-shape.md` — Document/BlockNode/Edge canonical shape; H-1..H-6 hash invariants; chunk-level source_hashes schema.
- `docs/v2/ARCHITECTURE.md:50–115` — L3 assembly placement, source-neutrality contract.
- `.planning/phases/03-bundles-authority-staleness/03-CONTEXT.md` — D-01..D-08 locks.
- `.planning/phases/02-memory-namespace-provenance-contract/02-CONTEXT.md` (referenced) — citation packet D-01, supersede semantics.
- `.planning/REQUIREMENTS.md` ASM-01..ASM-13 — phase deliverable spec.
- `.planning/ROADMAP.md` Phase 3 — 5 success criteria.

### Secondary (MEDIUM confidence — derivation from existing code)

- ADR-003 §H-7 invariant proposal (this RESEARCH §4) — additive to ADR-003; needs maintainer approval in PR.
- The `relation: "wikilink"` v2.0.0-only constraint (§9) — derived from v1 wikilinks schema lacking type discrimination; will be widened in Phase 4 GRA-04.

### Tertiary (LOW confidence)

- (none — every claim above pins to a file:line, an ADR statement, or a locked CONTEXT decision).

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — zero new dependencies; every primitive in the codebase.
- Architecture: **HIGH** — placements pinned to ARCHITECTURE.md layer model + CI grep discipline.
- Section storage: **HIGH** — materialization recommendation pins to existing migration pattern + Phase 5 read-load argument.
- `search_hybrid` rescore: **HIGH** — exact insertion point at `src/search/hybrid.ts:200`, math is a pure post-sort transform.
- Dossier `relation` field gap: **MEDIUM** — derivation from v1 wikilinks schema; planner should confirm with maintainer.
- Stub fixture shape: **MEDIUM** — sketched but not constructed; planner refines.
- ADR-003 H-7 addendum: **MEDIUM** — proposed but not yet drafted; needs PR-review-time wording polish.

**Research date:** 2026-05-16
**Valid until:** ~2026-06-15 (one month — stable codebase, no fast-moving deps).

---

**Output file:** `.planning/phases/03-bundles-authority-staleness/03-RESEARCH.md`
