---
phase: 04-graph-as-retrieval
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/db/schema.ts
  - src/db/database.ts
  - src/db/queries/edges.ts
  - src/db/queries/edges.test.ts
  - src/graph/graph.ts
  - src/graph/graph.test.ts
  - src/graph/index.ts
  - src/assembly/bundle.ts
  - src/assembly/dossier.integration.test.ts
autonomous: true
requirements:
  - GRA-04
user_setup: []

must_haves:
  truths:
    - "A new vault DB has an `edges` table (migration 011) with the columns and indexes from D-01."
    - "Existing wikilinks rows are present in `edges` with `type='wikilink'` after migration; backfill is chunked and idempotent."
    - "`vault.db.edges` is wired onto `Database` and exposes `insertBatch`/`deleteByNote`/`getBacklinks`/`getForwardLinks`/`resolveBrokenLinks` mirroring `WikilinksQueries`."
    - "`list_backlinks` / `list_forward_links` return rows with an additive `type` field; default behavior (all edge types returned) is unchanged."
    - "Bundle/dossier backlinks/forward_links carry `relation` typed as `EdgeType` (still `'wikilink'` until Plan 04-02 lands)."
    - "All 1076 existing tests stay green; `evals/v1-baseline/baseline.test.ts` stays green; `npm run lint` (tsc --noEmit) is clean."
  artifacts:
    - path: "src/db/queries/edges.ts"
      provides: "EdgesQueries — typed insertBatch/deleteByNote/getBacklinks/getForwardLinks; INSERT OR IGNORE upsert; snake_case→camelCase mapping"
      contains: "class EdgesQueries"
    - path: "src/db/queries/edges.test.ts"
      provides: "Migration 011 DDL + backfill + EdgesQueries idempotency unit tests"
      contains: "describe(\"EdgesQueries\""
    - path: "src/db/schema.ts"
      provides: "runMigration011 (function-style) appended to MIGRATIONS array (version: 11)"
      contains: "runMigration011"
    - path: "src/db/database.ts"
      provides: "EdgesQueries wired as readonly field `edges`"
      contains: "this.edges = new EdgesQueries"
    - path: "src/graph/graph.ts"
      provides: "BacklinkResult/ForwardLinkResult additive `type: EdgeType` field; reads route through vault.db.edges"
      contains: "type: EdgeType"
  key_links:
    - from: "src/db/database.ts"
      to: "src/db/queries/edges.ts"
      via: "import + constructor wiring"
      pattern: "new EdgesQueries"
    - from: "src/db/schema.ts"
      to: "MIGRATIONS array"
      via: "version 11 entry"
      pattern: "version: 11"
    - from: "src/graph/graph.ts"
      to: "vault.db.edges.getBacklinks / getForwardLinks"
      via: "method calls replacing vault.db.wikilinks.* read paths"
      pattern: "vault\\.db\\.edges\\.(getBacklinks|getForwardLinks)"
---

<objective>
Wave 1 substrate slice. Land the `edges` table (migration 011) with chunked backfill from `wikilinks`, the `EdgesQueries` namespace, and switch v1 `list_backlinks`/`list_forward_links` reads onto `edges` while adding the additive `type` field per D-04. This unblocks every other Phase 4 plan; no graph-tool behavior changes for end users (after backfill, `edges` contains exactly the same wikilink rows as the old `wikilinks` table, plus a new `type` column always equal to `'wikilink'` until Plan 04-02 starts populating the three new types).

Purpose: GRA-04 substrate. Phase 4's BFS (`expand`), Louvain (`cluster`), and `search_hybrid({expand})` all read from `vault.db.edges.*`. Lock the storage shape and read path first.

Output: New table + queries + wiring + additive `type` on v1 graph tools and bundle/dossier link entries. Zero externally-visible behavior change beyond the additive output field.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/04-graph-as-retrieval/04-CONTEXT.md
@.planning/phases/04-graph-as-retrieval/04-RESEARCH.md
@.planning/phases/04-graph-as-retrieval/04-PATTERNS.md
@docs/v2/adr/003-document-shape.md
@src/types.ts
@src/db/queries/wikilinks.ts
@src/db/schema.ts
@src/db/database.ts
@src/graph/graph.ts
@src/graph/index.ts
@src/assembly/bundle.ts

<interfaces>
<!-- Canonical contracts the executor wires through. Do not re-explore the codebase. -->

From src/types.ts:470 — `Edge.type` union (the column CHECK constraint must mirror this verbatim):
```typescript
export interface Edge {
  type: "wikilink" | "mention" | "frontmatter-ref" | "hyperlink";
  target: DocId | string;
  rel?: string;
}
```

From src/db/queries/wikilinks.ts:1–117 — canonical shape EdgesQueries mirrors:
```typescript
export class WikilinksQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByNote: BetterSqlite3.Statement<[number]>;
  private readonly _backlinks: BetterSqlite3.Statement<[number], {...}>;
  private readonly _forward: BetterSqlite3.Statement<[number], {...}>;
  private readonly _broken: BetterSqlite3.Statement<[], {...}>;
  constructor(db: BetterSqlite3.Database) { /* prepare statements */ }
  insertBatch(sourceNoteId: number, links: WikilinkInput[]): void;
  deleteByNote(noteId: number): number;
  getBacklinks(noteId: number): BacklinkRow[];
  getForwardLinks(noteId: number): ForwardLinkRow[];
  resolveBrokenLinks(): BrokenLinkRow[];
}
```

Migration registration shape — see existing MIGRATION_010 entry near src/db/schema.ts:651:
```typescript
{ version: 11, description: "edges table + backfill from wikilinks (Phase 4 / 04-01 / GRA-04)", run: runMigration011 }
```

`BacklinkResult` / `ForwardLinkResult` widening target (src/graph/graph.ts:10–23):
```typescript
export interface BacklinkResult {
  sourcePath: string;
  sourceTitle: string;
  lineNumber: number | null;
  linkText: string | null;
  type: EdgeType;  // ← NEW; sourced from src/types.ts Edge.type union
}
```

`BacklinkEntry.relation` in src/assembly/bundle.ts:154–166 — widen from `"wikilink"` literal to `EdgeType` (strict type widening; all current values still type-check).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Author migration 011 + EdgesQueries (per D-01)</name>
  <files>src/db/schema.ts, src/db/queries/edges.ts, src/db/queries/edges.test.ts, src/db/database.ts</files>
  <behavior>
    - Test 1: After `db.migrate()`, the `edges` table exists with columns `(id, source_doc, target_doc, target_path, type, rel, anchor, line_number)`, CHECK constraint on `type` matching `Edge.type` union (`wikilink|mention|frontmatter-ref|hyperlink`), UNIQUE(`source_doc`, `target_doc`, `type`, `anchor`), and indexes `idx_edges_source` / `idx_edges_target` / `idx_edges_type`.
    - Test 2: Backfill is idempotent — running migration on a DB that already has rows from a prior partial backfill does not duplicate; INSERT OR IGNORE + UNIQUE constraint enforces this.
    - Test 3: Backfill chunks at 10k rows. Synthesize a fixture with 25,000 wikilinks, run migration, assert all 25,000 rows are present in `edges` with `type='wikilink'`, assert migration completes (no transaction timeout) in < 1s on `:memory:`.
    - Test 4: When `wikilinks` is empty, migration 011 short-circuits without scanning (mirrors `runMigration008` zero-pending short-circuit).
    - Test 5: `EdgesQueries.insertBatch` followed by re-running the same batch leaves the row count unchanged (INSERT OR IGNORE idempotency per Pattern C).
    - Test 6: `EdgesQueries.deleteByNote(id)` removes only rows where `source_doc = id`; FK ON DELETE CASCADE from `notes` is also active (deleting a note removes its outgoing edges).
    - Test 7: `getBacklinks(id)` returns rows where `target_doc = id`; `getForwardLinks(id)` returns rows where `source_doc = id`; both map snake_case → camelCase at the boundary.
  </behavior>
  <action>
    Implement per D-01 + RESEARCH Pattern 1 + PATTERNS analog `src/db/queries/wikilinks.ts`.

    In `src/db/schema.ts`: add `runMigration011(db, _ctx)` between the existing `runMigration010` and the MIGRATIONS array. Step A: idempotent DDL via `CREATE TABLE IF NOT EXISTS edges (...)` exactly matching the column list in `<interfaces>` (FK `source_doc REFERENCES notes(id) ON DELETE CASCADE`, FK `target_doc REFERENCES notes(id) ON DELETE SET NULL`, `target_path TEXT` for unresolved targets mirroring `wikilinks.target_path`, `CHECK (type IN (...))` matching `Edge.type`). Step B: zero-row short-circuit on `wikilinks` via `SELECT COUNT(*) AS c` (mirrors `runMigration008` lines 444–448). Step C: chunked backfill loop with `LIMIT 10000` + `id > @after_id` pagination (per RESEARCH Pattern 1 lines 297–321). DO NOT use ORM helpers — raw prepared statements only, mirroring `runMigration010` style. Append to `MIGRATIONS` array with `version: 11, description: "edges table + backfill from wikilinks (Phase 4 / 04-01 / GRA-04)", run: runMigration011`.

    Create `src/db/queries/edges.ts` mirroring `src/db/queries/wikilinks.ts` verbatim in structure. Export `EdgeInput`, `EdgeBacklinkRow`, `EdgeForwardLinkRow`, `EdgeType` (re-exported from `src/types.ts` Edge.type union), and `EdgesQueries` class. Statements: `_insert` (INSERT OR IGNORE INTO edges with all 8 named params), `_deleteByNote` (DELETE WHERE source_doc = ?), `_backlinks` (SELECT source_doc, type, anchor, line_number FROM edges WHERE target_doc = ?), `_forward` (SELECT target_doc, target_path, type, anchor, line_number FROM edges WHERE source_doc = ?), `_broken` (SELECT source_doc, target_path, type FROM edges WHERE target_doc IS NULL). `insertBatch` wraps in `db.transaction` per analog wikilinks.ts:74–88. Row mapping snake_case → camelCase at the boundary per analog wikilinks.ts:94–116.

    Wire onto `Database` in `src/db/database.ts` (three-line pattern from PATTERNS line 190–200): import EdgesQueries, declare `readonly edges: EdgesQueries`, construct after migrate as `this.edges = new EdgesQueries(this.handle)`. Construction order does not matter (EdgesQueries only prepares statements, reads no other namespace).

    Create `src/db/queries/edges.test.ts` co-located, building on `:memory:` DB + `db.migrate()` per PATTERNS line 114–119. Use a seed helper that calls `db.notes.upsertByPath` for source/target then `db.wikilinks.insertBatch` to seed the backfill input. Assert via `db.prepare("PRAGMA table_info(edges)").all()` for DDL, `db.prepare("PRAGMA index_list(edges)").all()` for indexes.

    Comment block at top of `runMigration011` cites Phase 4 / GRA-04 / D-01 and points to PATTERNS analog `runMigration008` + `runMigration010`. No `fs`/`path.join`/`gray-matter` imports anywhere in either file (Pattern A adapter-seam discipline).
  </action>
  <verify>
    <automated>npx vitest run src/db/queries/edges.test.ts</automated>
  </verify>
  <done>Migration 011 + EdgesQueries + Database wiring all green; existing tests (full suite) stay green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Switch `list_backlinks`/`list_forward_links` reads onto `edges` with additive `type` field (per D-04)</name>
  <files>src/graph/graph.ts, src/graph/graph.test.ts, src/graph/index.ts, src/assembly/bundle.ts, src/assembly/dossier.integration.test.ts</files>
  <behavior>
    - Test 1: `listBacklinks(vault, "people/alice-chen.md")` returns the same source paths as today (post-backfill) AND every result row carries `type: "wikilink"`. No throw on a path that has zero backlinks (returns empty array, per existing behavior).
    - Test 2: `listForwardLinks(vault, "projects/atlas-1.md")` returns the same target paths as today AND every result carries `type: "wikilink"`. `findBrokenLinks` continues to return unresolved-target rows (target_doc IS NULL) but now also carries the `type` field (default `"wikilink"` until Plan 04-02 populates other types).
    - Test 3: Type-level — `BacklinkResult["type"]` and `ForwardLinkResult["type"]` accept the four `Edge.type` literals. (Compile-time check via `npm run lint`.)
    - Test 4: `BacklinkEntry.relation` and `ForwardLinkEntry.relation` in `src/assembly/bundle.ts` accept the `EdgeType` union (widening from `"wikilink"` literal). All existing assertions in `dossier.integration.test.ts` that pin `relation === "wikilink"` stay green — backfill guarantees this.
    - Test 5 (regression): `evals/v1-baseline/baseline.test.ts` is green — `list_backlinks` / `list_forward_links` JSON shape gained one field but every previously-asserted field is unchanged.
  </behavior>
  <action>
    Switch reads (not writes — writes stay on `wikilinks` until Plan 04-02): in `src/graph/graph.ts`, replace `vault.db.wikilinks.getBacklinks(note.id)` with `vault.db.edges.getBacklinks(note.id)` at the existing call site (PATTERNS line 263–277). Replace `vault.db.wikilinks.getForwardLinks(...)` likewise. Replace `vault.db.wikilinks.resolveBrokenLinks()` with `vault.db.edges.resolveBrokenLinks()` for `findBrokenLinks`. Map the new `type` column straight through onto the result row.

    Widen result interfaces in `src/graph/graph.ts:10–23`: add `type: EdgeType` to `BacklinkResult` and `ForwardLinkResult` (additive). Import `Edge` from `src/types.ts` and re-export `EdgeType = Edge["type"]` from `src/graph/graph.ts` (or co-locate in `src/graph/index.ts` barrel). `BrokenLinkResult` also gains `type: EdgeType`.

    Update `src/graph/index.ts` barrel to re-export the new `EdgeType` alongside existing exports (PATTERNS line 370–374).

    Widen `BacklinkEntry.relation` and `ForwardLinkEntry.relation` in `src/assembly/bundle.ts:154–166` from `"wikilink"` literal to `EdgeType`. The widening is strict — existing string values still type-check. Per PATTERNS line 413–424, the existing comment in `bundle.ts:145–148` already telegraphs this change; keep that comment and append `// COMPLETED Phase 4 / 04-01.`

    Add a Phase-4-conventional comment block above each modified site per Pattern F (PATTERNS lines 560–567):
    ```
    // ── Phase 4 / 04-01 / GRA-04 (D-01, D-04): switch reads to edges table ──
    //
    // Reads route through vault.db.edges; writes stay on vault.db.wikilinks
    // until Plan 04-02 lands the unified extractor. The `type` field is
    // strictly additive: pre-backfill no row existed, post-backfill every
    // row is type='wikilink', and Plan 04-02 starts producing the other
    // three types in the same column.
    ```

    Update `src/assembly/dossier.integration.test.ts` ONLY if a pre-existing assertion would fail when reads switch to `edges` (none should — the backfill is row-equivalent). If `dossier.integration.test.ts:159–163` currently pins `linked.relation === "wikilink"`, that assertion stays green (post-backfill `edges` has only `type='wikilink'` rows). Do not change the assertion until Plan 04-02.

    Source-neutrality CI grep: no new imports of `fs`, `path.join`, `gray-matter`, or `chokidar` in any modified file (Pattern A).
  </action>
  <verify>
    <automated>npx vitest run src/graph/graph.test.ts src/assembly/dossier.integration.test.ts && npm run lint -- --silent</automated>
  </verify>
  <done>v1 graph tools read from `edges`; bundle/dossier link entries carry `relation: EdgeType`; full suite + `evals/v1-baseline/baseline.test.ts` green; lint-adapters greps zero outside adapters.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client → tool input | Untrusted seed paths / vault names; existing Zod guards on `list_backlinks`/`list_forward_links` still apply. No new tool params in this plan. |
| Indexer → `edges` table | Plan 04-01 does not yet write user data into `edges` from the indexer (Plan 04-02 does); the only write path is the migration backfill from `wikilinks` (data already user-trusted). |
| Migration runner → SQLite | Synchronous transaction; chunked backfill avoids holding the event loop. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-01-01 | Denial of Service | Migration 011 backfill on huge vault (≥100k wikilinks) | mitigate | Chunked backfill (10k rows / chunk) per RESEARCH Pattern 1; short-circuit when wikilinks count is 0; tested with 25k-row fixture in `edges.test.ts`. |
| T-04-01-02 | Tampering / Integrity | UNIQUE constraint bypass via stale watcher race | mitigate | UNIQUE(`source_doc`, `target_doc`, `type`, `anchor`) + INSERT OR IGNORE on the EdgesQueries `_insert` statement guarantees idempotency; FK ON DELETE CASCADE on `source_doc` cleans up on note delete. |
| T-04-01-03 | Information Disclosure | `_memory` docs surfacing via untyped backlink reads | accept (for this plan) | Plan 04-01 only switches reads; the `_memory` opacity rule (Pitfall 3) is enforced in `expand()` (Plan 04-03). Backlinks of `_memory` docs surface today via wikilinks already — no new exposure. |
| T-04-01-04 | Tampering | SQL injection via prepared-statement param drift | mitigate | All statements use named params (`@source_doc`, `@target_doc`, …) bound by better-sqlite3; no string interpolation anywhere in `edges.ts` or `runMigration011`. |
| T-04-01-SC | Tampering | npm install steps | N/A | No `npm install` in Plan 04-01 (graphology deps land in Plan 04-05). No supply-chain checkpoint needed. |
</threat_model>

<verification>
**Acceptance:**
- `npm test` — 1076+ tests pass (current baseline) + new `edges.test.ts` + new graph.test.ts cases pass.
- `npm run lint` (= `tsc --noEmit`) clean.
- `bash scripts/lint-adapters.sh` — zero hits outside adapter dirs (no new `fs`/`path.join`/`gray-matter`/`chokidar` imports).
- `npm run eval:baseline` — v1-baseline byte-identical (additive `type` field on graph-tool result rows is reviewed and accepted; tool-list snapshot regen is deferred to Plan 04-07).
- Manual: `git diff src/types.ts` — zero changes (Edge type was already canonical; this plan only consumes it).

**Eval queries:** none new this plan. `_queries/expand.yaml` / `cluster.yaml` land in Plan 04-06.

**Snapshot checks:** No tool-list snapshot regen in Plan 04-01 — the additive `type` field on `list_backlinks`/`list_forward_links` output rows is a Zod schema diff that lands in Plan 04-02 along with the indexer's new edge types (one regen with the full additive diff in Plan 04-07).
</verification>

<validation>
**Nyquist Dimension 8 — Validation Architecture (per RESEARCH §Validation Architecture):**

- **Test framework:** vitest ^2.1.8, co-located `*.test.ts`, run via `npx vitest run <file>`.
- **Per-task verify:** see `<verify>` blocks above.
- **Coverage map:**
  - GRA-04 (migration 011 DDL + backfill) → `src/db/queries/edges.test.ts` "migration 011" + "backfill" + "idempotent"
  - GRA-04 (EdgesQueries shape) → `src/db/queries/edges.test.ts` "insertBatch" + "deleteByNote" + "getBacklinks" + "getForwardLinks"
  - GRA-04 (D-04 additive `type` on v1 graph tools) → `src/graph/graph.test.ts` "type field"
  - GRA-04 (bundle/dossier link `relation` widening) → `src/assembly/dossier.integration.test.ts` (existing assertions stay green)
- **Sampling per RESEARCH:** per task — `npx vitest run <file>` + `npm run lint`. Per wave merge — `npm test` + `npm run eval:baseline`.
- **Wave 0 gap:** all test files in `files_modified` are new or extended within this plan; no pre-existing scaffolding gap.
</validation>

<success_criteria>
1. Migration 011 lands; `edges` table exists with the D-01 columns + indexes + CHECK; tests prove DDL.
2. Backfill is chunked (10k rows), idempotent, short-circuits on empty source, completes in <1s on 25k-row test fixture.
3. `vault.db.edges.*` is wired and exposes the WikilinksQueries-shaped surface.
4. v1 `list_backlinks`/`list_forward_links` read from `edges` and return rows with additive `type: EdgeType`.
5. `BacklinkEntry.relation` / `ForwardLinkEntry.relation` in bundle/dossier are widened to `EdgeType`.
6. `npm test` + `npm run lint` + `scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
7. Zero new imports of `fs`/`path.join`/`gray-matter`/`chokidar` outside adapter dirs.
</success_criteria>

<commit>
Atomic commit message:

```
feat(04-01): edges table substrate + EdgesQueries + v1 graph tools widened

- Migration 011: `edges` table with type union + UNIQUE + indexes; chunked
  backfill from `wikilinks` (10k-row chunks, INSERT OR IGNORE idempotent).
- EdgesQueries mirrors WikilinksQueries surface; wired as vault.db.edges.
- list_backlinks/list_forward_links/findBrokenLinks now read from edges and
  return rows with an additive `type: EdgeType` field. Default behavior
  unchanged: post-backfill all rows have type='wikilink' until Plan 04-02
  lands the unified extractor.
- BacklinkEntry.relation / ForwardLinkEntry.relation in bundle/dossier
  widened from literal `"wikilink"` to `EdgeType` union (strict widening).

GRA-04 substrate. Plan 04-02 wires the indexer to populate the other three
edge types. v1-baseline + lint-adapters greps stay green.

Refs: GRA-04, D-01, D-04
```
</commit>

<output>
Create `.planning/phases/04-graph-as-retrieval/04-01-edges-substrate-SUMMARY.md` when done.
</output>
