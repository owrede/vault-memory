# Phase 4: Graph-as-retrieval - Research

**Researched:** 2026-05-17
**Domain:** Typed-edge graph storage + traversal + community detection over SQLite
**Confidence:** HIGH (stack is small, decisions are locked, downstream code is well-mapped)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from 04-CONTEXT.md `<decisions>`)

**Edge storage & extraction**
- **D-01:** New `edges` table (migration 011); backfill from `wikilinks`; `wikilinks` table stays in place. `edges(id, source_doc, target_doc, type, rel?, anchor?, line_number?, UNIQUE(source_doc, target_doc, type, anchor))` + indexes on `(source_doc)` and `(target_doc)`.
- **D-02:** Indexer extracts all four edge types in one note-parse pass. Extend `src/indexer/resolver.ts` (or sibling). `INSERT OR IGNORE` discipline.
- **D-03:** `mention` = exact title-or-alias token match in body paragraphs. Reuses `note_aliases`. Excludes wikilinks/headings/code blocks. Casefold + min-length-4 + word-boundary. No NLP, no LLM. Frontmatter `mentions: [...]` escape hatch deferred to v2.x.
- **D-04:** v1 `list_backlinks` / `list_forward_links` gain additive `type` field (typed as the four `Edge.type` literals). Default returns all edge types. `edge_types?: string[]` server-side filter deferred to v2.x.

**`expand()` API & hop semantics**
- **D-05:** Hops hard-capped at 2 via Zod literal union (`hops: 1 | 2`).
- **D-06:** `direction?: 'forward' | 'backward' | 'both' = 'both'`.
- **D-07:** Flat array of citation packets, each carrying `via: { seed_doc_id, hop, edge_type, direction }`. Deduplicated by `doc_id`; multiple paths collapse to **shortest** path (lowest hop, ties broken by `seed_doc_id` then `edge_type`).
- **D-08:** Filter conventions mirror Phase 3 read-side defaults. `include_superseded?: boolean = false`. `filter_properties?: Record<string, unknown>` with strict equality. `_memory` opacity rules (ADR-004) carry over.
- **D-09:** Module path — `src/graph/expand.ts` next to `src/graph/graph.ts`; `cluster.ts` likewise. `src/graph/index.ts` exports the new public API.

**`cluster()` algorithm & feature-flag policy**
- **D-10:** Louvain modularity-maximizing community detection (not Label Propagation, not Connected Components).
- **D-11:** Pull in `graphology` (^0.26) + `graphology-communities-louvain` (^2.x).
- **D-12:** Deterministic — nodes sorted by `DocId` (opaque string sort) before running. `cluster_id` = smallest member `DocId`. Louvain randomness seeded via library's `rng` option (uses `seedrandom`).
- **D-13:** Always available; hard-reject at >5000 nodes unless `force: true`. Structured error `{ ok: false, reason: "node_count_exceeded", node_count, threshold: 5000, hint: "pass force:true to compute" }`.
- **D-14:** Per-cluster output `{ cluster_id, size, members: CitationPacket[], summary: { top_types, top_titles, edge_density } }`. All fields deterministic, no LLM.
- **D-15a:** `cluster()` accepts `query` OR `seed_doc_ids` (both-present errors). `query` path: `search_hybrid({query, limit: query_top_k ?? 50})` → `expand({seed_doc_ids, hops: 1, direction: "both"})` → cluster the union.

**`search_hybrid({expand})` composition + eval**
- **D-15:** Additive `expansions?: CitationPacket[]` field per hit when `expand: {hops: 1}` is supplied. Top-K hit ranking is stable. v1-baseline invariance preserved by construction.
- **D-16:** Rescore order — Phase 3 recency/authority rescore FIRST, then expand top-K. Expand never participates in score computation.

**Eval design**
- **D-17:** `evals/fixtures/v2-test-vault/_queries/expand.yaml` with ≥5 manual gold-set queries spanning all four edge types. `{ id, description, input: {...}, expected_doc_ids: string[], min_precision: 0.8, min_recall: 0.8 }`.
- **D-18:** Coverage = `_queries/expand.yaml` AND `_queries/search-hybrid-with-expand.yaml` AND `_queries/cluster.yaml` (D-12 snapshot).

### Claude's Discretion (research recommendations below in Architectural Responsibility + Patterns sections)
- Where `frontmatter-ref` extraction lives in the adapter chain (recommendation: extractor reads `Document.properties` deep-scan + heuristic allowlist).
- `hyperlink` extraction scope (recommendation: `[text](url)` + bare URLs, image embeds only when `http(s)://`, skip relative paths).
- Stub-adapter coverage extension (reuse existing forward-compat edges; +2–3 conformance cases).
- `search_hybrid({expand})` Zod schema shape (nest under single optional `expand?` object).
- Edge backfill performance (chunked batches of 10k inside migration `run` function, matches `runMigration008` pattern).
- MCP Resources promotion for `expand`/`cluster` (recommendation: both stay as Tools).
- Error semantics on broken `seed_doc_ids` (recommendation: partial result with `warnings: [{seed_doc_id, reason: "unknown_doc"}]`, not hard throw).
- Async/streaming `cluster()` near the cap (recommendation: deferred to Phase 5 if needed).

### Deferred Ideas (OUT OF SCOPE for Phase 4)
- `embed` edge type (Obsidian `![[asset]]` syntax) → v3 with Notion connector.
- Frontmatter `mentions: [...]` user-curated escape hatch → v2.x.
- `edge_types?` filter param on v1 graph tools → v2.x.
- Hops ≥ 3 in `expand()` → v2.x on demonstrated demand.
- Label Propagation / Connected Components alternative algorithms → revisit if Louvain disappoints.
- Per-vault TOML `[features.cluster]` flag → covered by hard-cap.
- LLM-generated cluster descriptions → "no premature LLM coupling" rule; Phase 5 owns it.
- Streaming/async `cluster()` near 5000-node cap → Phase 5 territory.
- `expand({query})` (search-and-expand in one call) → callers compose externally.
- MCP Resources promotion for `expand`/`cluster` → both stay as Tools.
- v3 `wikilinks` table cleanup → v3 task.
- Hyperlink resolution to known DocIds → v3+.
- Cross-source expand (Notion + Obsidian traversal) → v3 (Phase 10).
- Edge-type-aware ranking weights in `expand()` → Phase 5/6 territory.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRA-01 | `expand({seed_doc_ids, hops: 1\|2, edge_types?, filter_properties?})` MCP tool — typed-edge neighborhood with metadata | §Architecture Patterns → BFS over `edges` table (D-09); §Code Examples → BFS skeleton with shortest-path dedup |
| GRA-02 | `cluster({query \| seed_doc_ids, method: "edge-community"})` MCP tool — community detection on typed edge graph; deterministic per fixture; feature-flagged if slow | §Standard Stack → graphology + Louvain pinned; §Pitfalls → determinism via `seedrandom`; §D-13 hard-cap at 5000 nodes |
| GRA-03 | `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion of top-K results | §Architecture Patterns → post-rescore expand attachment; rescore order D-16 |
| GRA-04 | Edges carry explicit `type` field per ADR-003 — schema supports `wikilink`, `frontmatter-ref`, `mention`, `hyperlink` | §Architecture Patterns → migration 011 DDL; D-02 unified extractor pass; D-04 additive type field on v1 graph tools |
| GRA-05 | Eval fixture includes ≥5 "find me everything related to X" queries answered with expansion (≥0.8 precision/recall) | §Architecture Patterns → eval YAML shapes mirror existing `_queries/recency.yaml` + `_queries/dossier.yaml`; D-17/D-18 |
</phase_requirements>

## Summary

Phase 4 is a small, well-scoped graph layer that lands on top of stable Phase 1–3 substrate. The implementation work splits cleanly into three vertical slices: **(a) typed-edge storage + indexer extraction**, **(b) graph traversal (`expand`) + auto-expansion in `search_hybrid`**, **(c) community detection (`cluster`)**. Every external dependency (graphology + graphology-communities-louvain + seedrandom) is pure JavaScript, ESM-friendly, MIT-licensed, has high download volume, and has been published for 5+ years — there is no slopsquat risk. Every internal extension point already exists: the `Edge` type is canonical in `src/types.ts:470`, the citation-packet shape is locked from Phase 3, the migration pattern is established (`runMigration008` / `runMigration010` at `src/db/schema.ts`), and the stub adapter already carries forward-compat edges for the three new types.

The non-trivial complexity in this phase is **not** in any single component — it is in (1) making the indexer's three new extractors deterministic across syncing collaborators (D-03 min-length-4 mention rule + extractor ordering), (2) the shortest-path `via` deduplication semantics for `expand` (D-07), and (3) the Louvain determinism contract (D-12 `seedrandom` + `DocId`-sorted node iteration + `cluster_id = smallest_member_DocId`). All three are addressable with deterministic, testable code paths — no fuzziness involved.

**Primary recommendation:** Ship the three slices in dependency order — storage + extraction first (gates everything else), then `expand` + `search_hybrid({expand})` together (they share the BFS code path), then `cluster()` last (largest dep surface, smallest blast radius if it slips). Mirror the Phase 3 plan structure (7 plans, 4 tools, ~3 waves).

## Architectural Responsibility Map

vault-memory is a single-process MCP server (no multi-tier app), so the "tier" axis maps to **layer** (L0 substrate / L1 graph / L2 memory / L3 assembly / Adapter seam) per `docs/v2/ARCHITECTURE.md`.

| Capability | Primary Layer | Secondary Layer | Rationale |
|------------|---------------|-----------------|-----------|
| `edges` table DDL + queries | L0 substrate (`src/db/`) | — | All persistence lives here; mirrors `wikilinks` table location |
| Edge extraction (4 types) | Indexer (`src/indexer/`) | Adapter seam (reads through `Document.properties`) | Already the home of `WikilinkResolver`; reads adapter-produced `Document` objects |
| `expand()` BFS traversal | L1 graph (`src/graph/expand.ts`) | L0 substrate (read-only) | D-09 explicit |
| `cluster()` Louvain | L1 graph (`src/graph/cluster.ts`) | L0 substrate (read-only) | D-09 explicit |
| `search_hybrid({expand})` post-processing | Search (`src/search/hybrid.ts`) | L1 graph (calls `expand()`) | Post-rescore attachment per D-16 |
| `list_backlinks`/`list_forward_links` additive `type` | L1 graph (`src/graph/graph.ts`) | L0 substrate | D-04 |
| Tool registration | Tool registry (`src/tool-registry.ts`) | Server bootstrap | Phase 0 extracted |
| Eval YAMLs | Eval harness (`evals/`) | — | D-17/D-18 |
| Conformance tests | Adapter conformance (`src/adapters/source/conformance.test.ts`) | — | Cross-adapter contract surface |

**Crucial layer invariant:** The new `expand`/`cluster` code MUST NOT import `fs`, `path.join`, `gray-matter`, or any adapter internals. It reads SQLite via `vault.db.edges.*` (which the adapter populated transitively through the indexer). Phase 1's CI greps (`scripts/lint-adapters.sh`) enforce this. The new `src/graph/cluster.ts` may import `graphology` + `graphology-communities-louvain` (allowed pure-JS deps). The new `src/db/queries/edges.ts` imports only `better-sqlite3` types.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `graphology` | `^0.26.0` | In-memory graph data structure for Louvain input | [CITED: https://graphology.github.io] Author: Yomguithereal / graphology org. ESM-first (`dist/graphology.mjs` via `exports.import`). 1.15M weekly downloads. The canonical graph lib in the JS ecosystem; standard library design (one core + many algorithms as sibling pkgs). Pure JS, no native bindings. |
| `graphology-communities-louvain` | `^2.0.2` | Modularity-maximizing community detection (Blondel et al. 2008) | [CITED: github.com/graphology/graphology/tree/master/src/communities-louvain] Same author/org as `graphology`. Standard implementation; supports `randomWalk` + `rng` options for determinism. 83k weekly downloads. Peer-dep `graphology-types >= 0.19.0` only. |
| `seedrandom` | `^3.0.5` | Deterministic PRNG to feed into Louvain's `rng` option | [VERIFIED: npm registry — 7.2M weekly downloads, 10+ year history, used by 600k+ packages]. The standard JS seeded-PRNG. Required by D-12 determinism contract because Louvain calls `Math.random` by default. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (already installed) `zod ^4.4.3` | — | Tool input validation | All 3 new/extended Zod schemas (expand, cluster, search_hybrid `expand` param) |
| (already installed) `@modelcontextprotocol/sdk ^1.29.0` | — | MCP tool registration via `registerTool` | `expand` + `cluster` registration in `src/tool-registry.ts` |
| (already installed) `yaml ^2.9.0` | — | Eval YAML parsing | Reuses existing eval harness loader |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Decision |
|------------|-----------|----------|----------|
| `graphology-communities-louvain` | Hand-rolled Louvain in TypeScript | Smaller dep surface, but Louvain is non-trivial (modularity gain caching, dendrogram pass, fast-local-move optimization) — bug surface | Locked: D-11 rejects hand-roll; library is mature + maintained by `graphology` org |
| `graphology-communities-louvain` | `cytoscape` + its community plugin | Larger lib (~500kb), older codebase, weaker ESM story | Not considered viable |
| `seedrandom` | Custom `splitmix32` impl (~10 LOC) | Avoids dep, but `seedrandom` is the documented pairing in graphology-communities-louvain docs; mismatch risks non-determinism | Use `seedrandom` — matches official pattern; trivial install |
| Persistent edges table | Compute non-wikilink edges on-the-fly per query | Saves storage but makes Phase 5 brief compilation re-parse bodies on every call | Locked: D-01 rejects this |

**Installation:**
```bash
npm install graphology graphology-communities-louvain seedrandom
npm install --save-dev @types/seedrandom
```

**Version verification (run 2026-05-17 against npm registry):**
```bash
$ npm view graphology version          # 0.26.0 (latest)
$ npm view graphology-communities-louvain version  # 2.0.2 (latest)
$ npm view seedrandom version          # 3.0.5
```

All three packages have well-established GitHub repos under organizations with prior `vault-memory`-relevant track record (the `graphology` org has shipped 40+ pkgs over 8+ years). All three are MIT-licensed.

## Package Legitimacy Audit

> slopcheck CLI was unavailable in this research session. Verification performed via manual cross-checks: npm registry `view`, GitHub repo existence + organization age, weekly download volume from npm-stat API, postinstall-hook scan, and official documentation cross-reference.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `graphology` | npm | 8+ years (org `graphology` est. 2016) | 1.15M/wk [VERIFIED 2026-05-17] | github.com/graphology/graphology | UNAVAILABLE — manual verify passed | Approved |
| `graphology-communities-louvain` | npm | 6+ years (in `graphology` monorepo) | 83k/wk [VERIFIED 2026-05-17] | github.com/graphology/graphology | UNAVAILABLE — manual verify passed | Approved |
| `seedrandom` | npm | 10+ years (author: davidbau, since 2014) | 7.2M/wk [VERIFIED 2026-05-17] | github.com/davidbau/seedrandom | UNAVAILABLE — manual verify passed | Approved |
| `@types/seedrandom` | npm DefinitelyTyped | matches `seedrandom` | bundled with DT | github.com/DefinitelyTyped/DefinitelyTyped | UNAVAILABLE — DT scope | Approved |

**Postinstall scan (run 2026-05-17):**
- `graphology`: scripts include `prepare: 'npm run build'`. Build runs locally before publish, no runtime postinstall. Safe.
- `graphology-communities-louvain`: scripts are `prepublishOnly` + `test` only. No postinstall. Safe.
- `seedrandom`: no postinstall. Safe.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Because slopcheck CLI was unavailable, the planner SHOULD nonetheless insert a `checkpoint:human-verify` task immediately before the `npm install` step of plan 04-01 (or whichever plan installs deps), confirming the three package names match the GitHub URLs above before running `npm install`. This protects against a registry-takeover that the manual verify on 2026-05-17 cannot detect retroactively.*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ MCP client (Claude, ChatGPT Custom Connector, MCP Inspector, …)     │
└─────────────────────────────────────────────────────────────────────┘
                              │ tool calls
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ src/server.ts  (CallToolRequestSchema dispatch)                      │
│   ├─ expand        ─── new                                           │
│   ├─ cluster       ─── new                                           │
│   ├─ search_hybrid ─── extended (additive `expand?` param)           │
│   ├─ list_backlinks      ─── extended (additive `type` on results)   │
│   └─ list_forward_links  ─── extended (additive `type` on results)   │
└─────────────────────────────────────────────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ src/search/  │    │ src/graph/       │    │ src/graph/       │
│  hybrid.ts   │    │  expand.ts (new) │    │  cluster.ts (new)│
│  (extended)  │    │  graph.ts        │    │                  │
│              │    │  (extended)      │    │                  │
└──────────────┘    └──────────────────┘    └──────────────────┘
       │                      │                      │
       └─ post-rescore: ───── calls expand() ────────┤
            attach .expansions per hit               │ Louvain via
                                                     │ graphology +
                                                     │ seeded RNG
                              ▼                      ▼
                     ┌─────────────────────────────────────┐
                     │ vault.db.edges (new — migration 011)│
                     │   one row per (src, tgt, type, anchor)│
                     │   indexes on (source_doc), (target_doc)│
                     └─────────────────────────────────────┘
                              ▲
                              │ INSERT OR IGNORE during indexing
                              │
┌─────────────────────────────────────────────────────────────────────┐
│ src/indexer/                                                          │
│   ├─ resolver.ts (extended — extracts 4 edge types per parse pass)   │
│   ├─ single.ts / indexer.ts (call into extended resolver)            │
│   └─ uses note_aliases (existing) for mention candidate set          │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Document (from src/types.ts)
                              │
┌─────────────────────────────────────────────────────────────────────┐
│ src/adapters/source/obsidian-fs/  (Phase 1)                          │
│   readDocument(id) → Document { id, blocks, properties, links, … }  │
└─────────────────────────────────────────────────────────────────────┘

Data-flow primary use case ("expand from seed"):
  caller → expand({seed_doc_ids: [X]}) → BFS over vault.db.edges
  → hydrate each visited doc_id into CitationPacket (via existing
  src/assembly/ helpers) → attach via:{seed_doc_id, hop, edge_type,
  direction} → dedup by doc_id (shortest path wins) → return flat array
```

### Recommended Project Structure

```
src/
├── graph/
│   ├── graph.ts            # existing; D-04 extended with additive `type`
│   ├── expand.ts           # NEW — BFS over typed edges, hop-cap, dedup
│   ├── expand.test.ts      # NEW — vitest co-located
│   ├── cluster.ts          # NEW — Louvain wrapper, determinism contract
│   ├── cluster.test.ts     # NEW
│   └── index.ts            # extended — re-export expand + cluster public types
├── db/queries/
│   ├── edges.ts            # NEW — EdgesQueries (mirrors WikilinksQueries shape)
│   ├── edges.test.ts       # NEW
│   └── wikilinks.ts        # existing — unchanged; D-01 keeps wikilinks table
├── db/
│   └── schema.ts           # extended — adds MIGRATION 011 (function-style w/ chunked backfill)
├── indexer/
│   ├── resolver.ts         # extended — wikilink resolver stays; D-02 adds 3 sibling extractors
│   └── single.ts           # extended — calls the 3 new extractors + writes to edges
├── search/
│   └── hybrid.ts           # extended — D-15/D-16 post-rescore expand attachment
└── tool-registry.ts        # extended — register expand + cluster; additive schema updates

evals/fixtures/v2-test-vault/_queries/
├── expand.yaml                       # NEW (D-17)
├── search-hybrid-with-expand.yaml    # NEW (D-18)
└── cluster.yaml                      # NEW (D-12 snapshot)

evals/v1-baseline/
└── tools-list.snapshot.json          # ONE regen with the additive diff

package.json                            # add: graphology, graphology-communities-louvain, seedrandom
```

### Pattern 1: Migration 011 — `edges` table DDL + chunked backfill

**What:** New table + indexes + one-time copy from `wikilinks`. Function-style migration so backfill can chunk to survive better-sqlite3 sync constraints on vaults with 100k+ wikilinks (per `runMigration008` pattern).

**When to use:** Plan 04-01 (storage substrate). MUST land before any extractor code or graph-tool code.

**Example:**
```typescript
// Source: src/db/schema.ts pattern (mirrors runMigration008 at :443, runMigration010 at :531)
function runMigration011(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  // Step A — DDL (idempotent via IF NOT EXISTS)
  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_doc   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_doc   INTEGER REFERENCES notes(id) ON DELETE SET NULL,
      target_path  TEXT,                  -- raw target string for unresolved edges (mirrors wikilinks.target_path)
      type         TEXT NOT NULL CHECK (type IN ('wikilink','mention','frontmatter-ref','hyperlink')),
      rel          TEXT,                  -- ADR-003 Edge.rel
      anchor       TEXT,                  -- section anchor for wikilinks ([[target#section]])
      line_number  INTEGER,
      UNIQUE (source_doc, target_doc, type, anchor)
    );
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_doc);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_doc);
    CREATE INDEX IF NOT EXISTS idx_edges_type   ON edges(type);
  `);

  // Step B — chunked backfill from wikilinks
  // Atlas Robotics (~75 docs) backfills in < 5 ms. Worst-case
  // 100k+ wikilinks chunks at 10k/batch survives the sync transaction.
  const COUNT = (db.prepare("SELECT COUNT(*) AS c FROM wikilinks").get() as {c:number}).c;
  if (COUNT === 0) return;
  const CHUNK = 10_000;
  const copy = db.prepare(`
    INSERT OR IGNORE INTO edges (source_doc, target_doc, target_path, type, anchor, line_number)
    SELECT source_note, target_note, target_path, 'wikilink', anchor, line_number
      FROM wikilinks
     WHERE id > @after_id
     ORDER BY id ASC
     LIMIT @chunk
  `);
  let lastId = 0;
  while (true) {
    const before = (db.prepare("SELECT MAX(id) AS m FROM edges").get() as {m:number|null}).m ?? 0;
    copy.run({ after_id: lastId, chunk: CHUNK });
    const after = (db.prepare("SELECT MAX(id) AS m FROM edges").get() as {m:number|null}).m ?? 0;
    if (after === before) break;
    // Walk lastId forward by wikilinks.id, NOT edges.id — copy is one-to-one
    const nextLast = (db.prepare(
      "SELECT id FROM wikilinks WHERE id > ? ORDER BY id ASC LIMIT 1 OFFSET ?"
    ).get(lastId, CHUNK - 1) as {id:number}|undefined)?.id;
    if (!nextLast) break;
    lastId = nextLast;
  }
}
```

### Pattern 2: `EdgesQueries` — query namespace mirroring `WikilinksQueries`

**What:** New file `src/db/queries/edges.ts`. Wires onto `Database` as `vault.db.edges.*` (mirroring `vault.db.wikilinks.*`).

**When:** Plan 04-01. Required surface: `insertBatch(sourceNoteId, EdgeInput[])`, `getBacklinks(targetId, type?)`, `getForwardLinks(sourceId, type?)`, `deleteByNote(noteId)`. `INSERT OR IGNORE` discipline per `src/db/queries/wikilinks.ts:52`.

**Example:**
```typescript
// Source: src/db/queries/wikilinks.ts (the canonical sibling)
export interface EdgeInput {
  targetNoteId: number | null;
  targetPath: string | null;   // raw target for unresolved edges (hyperlink URLs, dangling refs)
  type: "wikilink" | "mention" | "frontmatter-ref" | "hyperlink";
  rel: string | null;
  anchor: string | null;
  lineNumber: number | null;
}

export class EdgesQueries {
  private readonly _insert: BetterSqlite3.Statement<EdgeInput & { source_note: number }>;
  // … prepared statements
  insertBatch(sourceNoteId: number, edges: EdgeInput[]): void {
    const tx = this.db.transaction((xs: EdgeInput[]) => {
      for (const e of xs) this._insert.run({ source_note: sourceNoteId, ...e });
    });
    tx(edges);
  }
}
```

### Pattern 3: `expand()` BFS with shortest-path `via` dedup

**What:** Bounded BFS (hops ≤ 2 per D-05) over `edges`. Dedupes by `doc_id`; multiple paths collapse to the **shortest** (D-07). When `direction = 'both'`, run two single-direction passes and merge.

**When:** Plan 04-03 (the largest plan — `expand` is the surface Phase 5 depends on).

**Example:**
```typescript
// Source: D-07 + standard BFS idiom
export interface ExpandOptions {
  seed_doc_ids: DocId[];
  hops: 1 | 2;
  direction?: "forward" | "backward" | "both";
  edge_types?: EdgeType[];   // optional filter
  filter_properties?: Record<string, unknown>;  // strict-equality, applied at hydration time
  include_superseded?: boolean;
}

export async function expand(vault: Vault, opts: ExpandOptions): Promise<ExpansionResult> {
  // 1. Resolve seed DocIds → note ids; collect warnings on misses (do not throw — recommendation)
  const seedRows = opts.seed_doc_ids.map(id => ({ doc_id: id, note: vault.db.notes.getByDocUri(id) }));
  const warnings = seedRows.filter(r => !r.note).map(r => ({ seed_doc_id: r.doc_id, reason: "unknown_doc" as const }));
  const seeds = seedRows.filter(r => r.note);

  // 2. Bounded BFS — track shortest path per visited noteId.
  // Map<noteId, { hop, via: { seed_doc_id, hop, edge_type, direction } }>
  const visited = new Map<number, ViaTrace>();
  const directions = opts.direction === "both" ? ["forward","backward"] : [opts.direction ?? "both"];
  for (const seed of seeds) {
    let frontier: Array<{ noteId: number; depth: number }> = [{ noteId: seed.note!.id, depth: 0 }];
    while (frontier.length && frontier[0].depth < opts.hops) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        for (const dir of directions) {
          const neighbors = dir === "forward"
            ? vault.db.edges.getForwardLinks(node.noteId, opts.edge_types)
            : vault.db.edges.getBacklinks(node.noteId, opts.edge_types);
          for (const e of neighbors) {
            const targetId = dir === "forward" ? e.target_note : e.source_note;
            if (!targetId || targetId === seed.note!.id) continue;
            const newHop = node.depth + 1 as 1 | 2;
            const existing = visited.get(targetId);
            // shortest path wins; ties → lower seed_doc_id (string sort), then lower edge_type
            const candidate: ViaTrace = { hop: newHop, seed_doc_id: seed.doc_id, edge_type: e.type, direction: dir };
            if (!existing || isShorterPath(candidate, existing)) {
              visited.set(targetId, candidate);
              if (newHop < opts.hops) next.push({ noteId: targetId, depth: newHop });
            }
          }
        }
      }
      frontier = next;
    }
  }

  // 3. Hydrate noteIds → citation packets (existing helper in src/assembly/)
  // 4. Apply filter_properties + include_superseded post-hydration
  // 5. Skip _memory docs unless they were already linked from a user note (D-08 / ADR-004)
  // 6. Return { documents: CitationPacket[], warnings }
}
```

### Pattern 4: `search_hybrid({expand})` — post-rescore attachment

**What:** Strict additive. When `expand` param present, call `expand({seed_doc_ids: topK_ids, hops: 1})` AFTER the existing recency/authority rescore at `src/search/hybrid.ts:264–289`. Attach the resulting citation packets per top-K hit. Top-K ranking is unchanged.

**When:** Plan 04-04 (composes existing expand + existing rescore).

**Example:**
```typescript
// Source: D-15 + D-16; sits at the end of hybridSearch() in src/search/hybrid.ts
const hits = /* existing rescored topK hits */;
if (opts.expand) {
  const seedIds = hits.map(h => h.doc_id);
  const expansion = await expand(opts.vaults[0], {
    seed_doc_ids: seedIds,
    hops: opts.expand.hops,
    direction: opts.expand.direction ?? "both",
    edge_types: opts.expand.edge_types,
  });
  // Group expanded packets by seed and attach per hit
  const bySeed = groupBy(expansion.documents, d => d.via.seed_doc_id);
  for (const hit of hits) hit.expansions = bySeed.get(hit.doc_id) ?? [];
}
return hits;
```

**v1-baseline invariance:** when `opts.expand === undefined`, the new code path is short-circuited at the `if (opts.expand)` guard. Zero new DB reads, zero new HTTP calls. `evals/v1-baseline/baseline.test.ts` stays green by construction.

### Pattern 5: Louvain wrapping with deterministic seed

**What:** Build a graphology graph from `edges`, sort node insertion by `DocId`, pass `seedrandom('vault-memory-cluster-v1')` as `rng`. Use `louvain.detailed()` for the modularity score in the response.

**When:** Plan 04-05 (final slice).

**Example:**
```typescript
// Source: D-12 + graphology-communities-louvain official docs
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import seedrandom from "seedrandom";

export async function cluster(vault: Vault, opts: ClusterOptions): Promise<ClusterResult> {
  // 1. Resolve seeds (composed via D-15a if query path)
  const seedNotes = opts.query
    ? await resolveQueryToTopK(vault, opts.query, opts.query_top_k ?? 50)
    : opts.seed_doc_ids.map(id => vault.db.notes.getByDocUri(id)).filter(Boolean);

  // 2. Compute 1-hop neighborhood (composes expand)
  const expansion = await expand(vault, {
    seed_doc_ids: seedNotes.map(n => n!.doc_uri), hops: 1, direction: "both",
  });
  const nodeIds = unique([...seedNotes.map(n => n!.id), ...expansion.documents.map(d => /* …looked up */)]);

  // 3. Hard-cap check (D-13)
  if (nodeIds.length > 5000 && !opts.force) {
    return { ok: false, reason: "node_count_exceeded", node_count: nodeIds.length, threshold: 5000,
             hint: "pass force:true to compute" };
  }

  // 4. Build graphology graph — D-12 sort by DocId for determinism
  const sortedNodes = [...nodeIds].sort((a, b) => /* DocId string compare */);
  const g = new Graph({ type: "undirected", multi: false });
  for (const id of sortedNodes) g.addNode(String(id));
  for (const edge of vault.db.edges.getAllForNodes(sortedNodes)) {
    if (g.hasEdge(String(edge.source_doc), String(edge.target_doc))) continue;
    g.addEdge(String(edge.source_doc), String(edge.target_doc), { weight: 1 });
  }

  // 5. Louvain with seeded RNG (D-12)
  const rng = seedrandom("vault-memory-cluster-v1");
  const detailed = louvain.detailed(g, { rng, randomWalk: true });
  // detailed.communities: Record<nodeId, communityIndex>

  // 6. Group nodes by community, assign cluster_id = smallest member DocId
  // 7. Hydrate members → citation packets; compute summary (top_types, top_titles, edge_density)
  // 8. Sort clusters by cluster_id; return { ok: true, clusters: [...] }
}
```

### Anti-Patterns to Avoid

- **Calling DB query objects from outside the `vault.db.*` namespace:** Per CONVENTIONS, `src/graph/` and `src/search/` must NOT instantiate `EdgesQueries` directly — wire it onto `Database` once.
- **Using `Math.random` (default) in Louvain:** Breaks D-12 determinism. ALWAYS pass `rng: seedrandom(...)`.
- **Sorting graphology nodes by insertion order:** Some Louvain implementations iterate in Map insertion order, others in alphabetical. Sort `DocId`s explicitly before `g.addNode(...)` (D-12).
- **Traversing into `_memory` via untyped scans:** Per ADR-004 + D-08, `_memory` docs surface only when they were already linked from a user note. Apply the filter at hydration time, not in the BFS frontier.
- **Reshaping the citation-packet contract:** Phase 2/3-locked. Phase 4 ADDS exactly one optional field `via?: {...}` per D-07; never touches the existing 8 fields.
- **Bundling graphology inside tsup:** Almost certainly fine (pure JS, ESM exports), but the planner should run `npm run build && node -e "import('./dist/cli.js')"` smoke before merge to verify no native binding leaked in (none expected).
- **Hand-rolling Levenshtein / fuzzy matching for `mention` extraction:** D-03 is exact match only. Resist any urge to soften it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Community detection / modularity optimization | Custom Louvain in TypeScript | `graphology-communities-louvain` | Modularity gain caching, dendrogram pass, fast-local-move queue, multigraph collapse — non-trivial; library has 6+ years of bug fixes |
| Seeded PRNG | `Math.sin`-based seed hash, mulberry32 inline | `seedrandom` | Matches what graphology docs document; 7M weekly downloads; deterministic across Node versions |
| Graph data structure | `Map<string, Set<string>>` adjacency | `graphology` | Louvain needs a typed graph anyway; pre-existing Edge iteration APIs; multigraph handling |
| Markdown link extraction (for hyperlink edge) | Custom regex for `[text](url)` | Reuse existing wikilink-style extraction approach in indexer | Avoid yet-another markdown parser; phase 4 only needs lossy URL extraction |
| Mention tokenization | Word boundary regex hand-written from scratch | Standard `\b` regex with negative lookbehinds for code-fence + heading detection (built in same pass as wikilink resolver) | Stay deterministic + simple per D-03; no NLP libs |

**Key insight:** Phase 4's "hand-roll risk" is concentrated in **one** place — Louvain. Everything else (BFS, citation-packet hydration, migration, Zod schemas) is straightforward. Locking the dep choice early (D-11) is what makes this phase small.

## Common Pitfalls

### Pitfall 1: Louvain non-determinism leaking through graphology insertion order
**What goes wrong:** Even with `rng: seedrandom(...)`, if nodes are inserted into the graphology graph in a non-deterministic order (e.g., from `Set.values()` iteration over a Map populated by an unordered query), Louvain's local-move phase can produce different community assignments across runs.
**Why it happens:** Graphology iterates nodes in insertion order; Louvain reads them in that order during the first sweep; the random walk only randomizes ties.
**How to avoid:** Sort `DocId`s explicitly (string compare) before `g.addNode(...)`. Also sort edges before insertion. Document this in `cluster.ts` header.
**Warning signs:** Eval `cluster.yaml` snapshot diff between two runs on the same fixture.

### Pitfall 2: Mention extractor false-positives at min-length-3
**What goes wrong:** D-03 picks min-length 4 to avoid pronouns and 3-char acronyms. But the Atlas Robotics fixture has title "Spire" (5 chars), "Alice" (5 chars), and slugs like "ac" (alias, 2 chars). With min-length-4, "Alice" matches everywhere — including inside `Alice C.` and `Alice's`. Apostrophe is a word-boundary, so `Alice's` produces a `mention(Alice)`. That's correct for the fixture, but at min-length-3 acronyms like "BOM" or "RGB" would over-match.
**Why it happens:** Exact-match extraction over a corpus where person and project names commonly appear in prose.
**How to avoid:** Keep D-03's min-length-4. Empirically validate on Atlas Robotics: run extractor over all 63 fixture notes, manually inspect produced mention edges in a debug dump. If "Spire" or "Alice" produces > 3 false positives per note, raise min-length to 5 (NOT a downgrade to 3).
**Warning signs:** Eval expand queries that target "everything related to Alice" surface unrelated notes via mention edges.

### Pitfall 3: `_memory` opacity violated by untyped backlink traversal
**What goes wrong:** A user note has a wikilink to `_memory/observations/2026-04-26-…` (an agent-authored observation). When `expand()` runs with `direction: backward` from the observation, it returns the user note. But when `expand()` runs with `direction: forward` from a different user note that has NO link to `_memory`, untyped BFS could surface the observation via a 2-hop path if a sibling user note happens to link both sides. ADR-004 says `_memory` docs surface only when **already linked** from a user note in the result set.
**Why it happens:** BFS treats all edges equally; `_memory` opacity is a property-level filter, not an edge-type filter.
**How to avoid:** At hydration time, drop any visited noteId whose `doc_uri` starts with `_memory/` UNLESS one of its inbound edges traces back to a non-`_memory` seed in `visited`. Document this rule in `expand.ts` header citing ADR-004.
**Warning signs:** `_queries/expand.yaml` query "everything related to atlas-1" surfaces agent observations the user never linked to.

### Pitfall 4: `via` dedup tiebreaker drift
**What goes wrong:** D-07 specifies "shortest path wins; ties broken by `seed_doc_id` then `edge_type`". If the tiebreaker order is silently flipped (e.g., by sorting differently in a Map iteration), the snapshot in `cluster.yaml` and `expand.yaml` diffs across runs.
**Why it happens:** Sort-order assumptions baked into Map iteration order, which Node guarantees per insertion but tests sometimes seed Maps in non-deterministic order.
**How to avoid:** Materialize the tiebreaker as an explicit comparator function `isShorterPath(a, b)` and unit-test it directly. Reference this comparator from both `expand.ts` and `cluster.ts`.
**Warning signs:** Snapshot eval flakes on rerun.

### Pitfall 5: Migration 011 backfill exceeds transaction budget on huge vaults
**What goes wrong:** A user with 100k+ wikilinks runs `npm install @owrede/vault-memory@2.0.0`; first server start applies migration 011; the backfill copies 100k rows in one `INSERT … SELECT` statement; better-sqlite3's synchronous transaction holds the event loop for several seconds → MCP client times out.
**Why it happens:** `INSERT … SELECT` is not naturally chunked.
**How to avoid:** Chunked backfill via `LIMIT @chunk` + `id > @after_id` pagination loop (see Pattern 1 above). Mirrors `runMigration008` pattern. 10k chunk size is conservative; backfill of 100k rows = 10 chunks × ~50ms each = ~500ms total.
**Warning signs:** Slow first-start on upgraded users; CI test for migration 011 should include a `1000 wikilink` fixture and assert < 100ms migration time.

### Pitfall 6: `frontmatter-ref` heuristic over-matches on common property names
**What goes wrong:** If the heuristic is "any property value matching a known title", a property like `status: "active"` will generate a spurious `frontmatter-ref → /path/to/active-status-note` if a note titled "Active Status" exists in the vault. The allowlist (`assignee`, `owner`, `project`, `related`, `parent`, `child`) prevents this, but the second leg "any property whose value parses as a wikilink" is permissive.
**Why it happens:** YAML property values are untyped; not every string is a reference.
**How to avoid:** Two-rule extraction: (a) ANY property at ANY depth whose value is a string matching the wikilink syntax `[[…]]` → resolve via existing `WikilinkResolver`; (b) Properties whose name is IN the allowlist AND value is a bare string → match against `note_aliases` only (not against all titles). The Atlas fixture's `owner: alice-chen`, `attendees: [bob-martinez, …]`, `superseded_by: <doc_id>` all fit rule (b). Document the allowlist in `extractFrontmatterRefs.ts` header + the `expand` tool description.
**Warning signs:** Conformance test exposes spurious frontmatter-ref edges in stub adapter.

## Runtime State Inventory

**Skip rationale:** Phase 4 is greenfield additive work — no rename, no rebrand, no migration of existing user data beyond the one-time `wikilinks → edges` copy (which is a one-way derived-data backfill, not a key/identifier rename). The `wikilinks` table stays in place (D-01) so v1 tool handlers see no behavior change. There is no runtime state to inventory.

For the in-scope migration concern (chunked backfill performance under SQLite sync constraint), see **Pitfall 5** above.

## Code Examples

### Edge extractor entry point (D-02 unified pass)
```typescript
// Source: D-02 + src/indexer/resolver.ts pattern
// File: src/indexer/extract-edges.ts (new)
export function extractAllEdges(
  vault: Vault,
  parsed: ParsedNote,             // existing — produced by parseNote()
  resolver: WikilinkResolver,     // existing — reused
): EdgeInput[] {
  return [
    ...extractWikilinkEdges(parsed, resolver),    // existing path, reshaped to EdgeInput
    ...extractMentionEdges(parsed, vault),         // new — uses note_aliases
    ...extractFrontmatterRefEdges(parsed, vault),  // new — heuristic per Pitfall 6
    ...extractHyperlinkEdges(parsed),              // new — [text](url) + bare URLs
  ];
}
```

### Mention extractor (D-03)
```typescript
// Source: D-03 + Pitfall 2
const MIN_MENTION_LEN = 4;

export function extractMentionEdges(parsed: ParsedNote, vault: Vault): EdgeInput[] {
  const candidates = buildMentionCandidateSet(vault);  // titles + aliases, casefold, length ≥ 4
  const edges: EdgeInput[] = [];
  // Walk paragraph blocks only — D-03 excludes headings and code blocks
  for (const block of parsed.blocks.filter(b => b.kind === "paragraph")) {
    // Build a single regex `\b(cand1|cand2|...)\b` per casefolded candidate set.
    // Critically: BEFORE matching, strip:
    //   - inline `code spans`
    //   - wikilink syntax `[[…]]` (already typed as wikilink edge)
    const stripped = stripWikilinksAndCode(block.text);
    for (const m of stripped.matchAll(mentionRegex)) {
      const matched = m[0].toLowerCase();
      const hit = candidates.get(matched);
      if (!hit) continue;
      edges.push({
        targetNoteId: hit.noteId,
        targetPath: hit.path,
        type: "mention",
        rel: null,
        anchor: null,
        lineNumber: block.line,
      });
    }
  }
  return dedupBy(edges, e => `${e.targetNoteId}:${e.lineNumber}`);
}
```

### Frontmatter-ref extractor (Pitfall 6 heuristic)
```typescript
// Source: Claude's discretion area + Pitfall 6
const FRONTMATTER_REF_ALLOWLIST = new Set([
  "assignee", "owner", "project", "related", "parent", "child", "attendees", "superseded_by",
]);

export function extractFrontmatterRefEdges(parsed: ParsedNote, vault: Vault): EdgeInput[] {
  const edges: EdgeInput[] = [];
  // Rule (a) — ANY property at any depth whose string value matches [[wikilink]] syntax
  walkPropertyValues(parsed.frontmatter, (path, value) => {
    if (typeof value !== "string") return;
    const wlMatch = value.match(/^\s*\[\[([^\]]+)\]\]\s*$/);
    if (wlMatch) {
      const hit = vault.resolver.resolve(wlMatch[1]);
      if (hit) edges.push({ targetNoteId: hit.id, targetPath: hit.path,
                            type: "frontmatter-ref", rel: path, anchor: null, lineNumber: null });
    }
  });
  // Rule (b) — allowlisted properties whose value is a bare string → match against note_aliases only
  for (const key of FRONTMATTER_REF_ALLOWLIST) {
    const val = parsed.frontmatter[key];
    const stringValues: string[] = Array.isArray(val)
      ? val.filter((x): x is string => typeof x === "string")
      : typeof val === "string" ? [val] : [];
    for (const sv of stringValues) {
      // First try direct path / filename match (Obsidian-style "alice-chen" or "people/alice-chen")
      const direct = vault.resolver.resolve(sv);
      if (direct) {
        edges.push({ targetNoteId: direct.id, targetPath: direct.path,
                     type: "frontmatter-ref", rel: key, anchor: null, lineNumber: null });
        continue;
      }
      // Fall back to alias-only match
      const aliasHit = vault.db.aliases.resolve(sv);
      if (aliasHit) {
        edges.push({ targetNoteId: aliasHit.note_id, targetPath: aliasHit.path,
                     type: "frontmatter-ref", rel: key, anchor: null, lineNumber: null });
      }
    }
  }
  return edges;
}
```

### Eval YAML shape (mirrors recency.yaml / dossier.yaml patterns)
```yaml
# Source: evals/fixtures/v2-test-vault/_queries/recency.yaml pattern
# File: evals/fixtures/v2-test-vault/_queries/expand.yaml
tool: expand
queries:
  - id: alice-1-hop
    description: "Everything 1-hop from people/alice-chen.md across all edge types"
    input:
      seed_doc_ids: ["obsidian-fs://test-vault/people/alice-chen.md"]
      hops: 1
      direction: both
    expected_doc_ids:
      - obsidian-fs://test-vault/projects/atlas-1.md          # via frontmatter-ref (owner: alice-chen)
      - obsidian-fs://test-vault/meetings/2026-04-15-q2-okr-review.md  # via wikilink
      # …
    min_precision: 0.8
    min_recall: 0.8

  - id: atlas-1-2-hop-frontmatter-only
    description: "Filter to frontmatter-ref edges only"
    input:
      seed_doc_ids: ["obsidian-fs://test-vault/projects/atlas-1.md"]
      hops: 2
      direction: both
      edge_types: ["frontmatter-ref"]
    expected_doc_ids: [...]
    min_precision: 0.8
    min_recall: 0.8
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 1–3: single `wikilinks` table, no typed edges | Phase 4: persisted `edges` table with 4 types | Now (migration 011) | Phase 5 brief compilation can walk frontmatter-ref edges; Phase 6 contracts can scope by edge type |
| Phase 1–3: graph traversal via `listBacklinks`/`listForwardLinks` only (1-hop nav) | Phase 4: `expand()` for 1–2 hop retrieval with citation packets | Now | `search_hybrid({expand})` gets graph context for free; agents see neighborhood, not just top-K |
| (no clustering surface) | Louvain community detection, deterministic per fixture | Now | Phase 5 brief compilation can scope to a cluster; users can see topic groupings |
| `Document.links: Edge[]` empty at runtime | Indexer populates `edges` table; `Document.links` reserved for adapter contract | Now | Closes the contract opened in ADR-003 |

**Deprecated/outdated:**
- The intermediate `Document.properties.wikilinks: WikilinkRef[]` shape (in `src/types.ts:491`) remains in place — adapter contract per Phase 1 D-05. Phase 4 reads it through the existing resolver path; it is NOT being deprecated, just enriched with three sibling extractors.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | min-length 4 for mention extraction produces < 3 false positives per note on Atlas Robotics fixture | §Pitfalls / Pitfall 2 | False-positive surge → eval queries surface noise; mitigation: empirically validate during plan 04-02 implementation, bump to 5 if needed |
| A2 | `wikilinks` → `edges` backfill on 100k+ wikilinks fits inside one chained sync transaction at 10k-row chunks | §Patterns / Pattern 1 + §Pitfalls / Pitfall 5 | Migration timeout on first-start for huge vaults; mitigation: stress-test fixture with `1000 wikilinks` in migration test |
| A3 | `seedrandom('vault-memory-cluster-v1')` + `DocId`-sorted node insertion produces byte-identical Louvain partitions across Node versions (22.x → 22.x and across minor releases) | §Patterns / Pattern 5 + §Pitfalls / Pitfall 1 | Snapshot drift on Node upgrade; mitigation: pin Node version + add cluster snapshot test that fails loudly |
| A4 | The `graphology-communities-louvain` `randomWalk: true` + seeded `rng` combination is sufficient for full determinism (no other internal `Math.random` calls) | §Standard Stack + §Patterns / Pattern 5 | Snapshot drift; mitigation: read library source during plan 04-05 to confirm no other entropy sources |
| A5 | Frontmatter-ref allowlist (`assignee`, `owner`, `project`, `related`, `parent`, `child`, `attendees`, `superseded_by`) covers Atlas Robotics frontmatter shape without over- or under-matching | §Code Examples / extractFrontmatterRefEdges + §Pitfalls / Pitfall 6 | Eval misses or noise; mitigation: dump extracted frontmatter-ref edges during plan 04-02 + inspect manually |
| A6 | `Document.links` in `Document` type is still adapter-contract-only (Phase 1 reserved it; Phase 4 doesn't promote it to runtime) — and Phase 4's runtime source-of-truth is `vault.db.edges.*`, not `Document.links` | §Standard Stack / Architecture | If Phase 4 plans accidentally try to populate `Document.links` from the indexer, they violate ADR-003's "adapter-contract surface" semantics; mitigation: planner explicitly notes runtime path is via `edges` table |
| A7 | Sub-30-second eval suite for `expand.yaml` (≥5 queries × 1-2 hops over 63-note Atlas fixture) is achievable per query in single-digit ms | §Validation Architecture | Eval slowdown blocks CI; mitigation: SQLite indexes on `(source_doc)` and `(target_doc)` make this O(degree) per hop |
| A8 | `cluster_id = smallest_member_DocId` (string sort over opaque URIs) produces human-readable cluster IDs because Atlas DocIds carry path-like structure (`obsidian-fs://test-vault/people/alice-chen.md`) | §Specifics (in CONTEXT.md) | If a vault uses opaque hash-style DocIds, cluster_ids become unreadable but still deterministic — no behavioral break |

**If this table is empty:** N/A — 8 assumptions logged. Each carries an explicit mitigation. None block planning; all are validation tasks during execution.

## Open Questions (RESOLVED)

1. **Should `Document.links` be runtime-populated by the indexer (in addition to `edges` table)?**
   - What we know: ADR-003 + `src/types.ts:540` reserve `Document.links: Edge[]` as the adapter contract surface; current adapters return `[]`.
   - What's unclear: whether Phase 4 should promote it to runtime (so adapter writers in v3 don't have to populate `edges` themselves), or keep it adapter-contract-only and have the indexer be the sole writer to `edges`.
   - **RESOLVED:** keep adapter-contract-only for v2; runtime path is `edges` table. v3 Notion connector can populate `Document.links` if it wants; the indexer will write through to `edges`. Locked into Plan 04-02 (indexer is sole writer to `edges`; `Document.links` stays adapter-contract-only).

2. **Cross-vault expand?**
   - What we know: vault-memory supports multi-vault; current `expand` signature does not specify which vault each seed lives in (DocId carries it implicitly via `obsidian-fs://<vault-name>/…`).
   - What's unclear: should `expand` cross vault boundaries when seeds are in different vaults?
   - **RESOLVED:** v2.0.0 — single-vault expand only. Multi-vault seeds → error per-vault. Cross-vault traversal is Phase 10 territory (where source-neutral edges become meaningful). Locked into Plan 04-03 (single-vault; documented in tool description; multi-vault seeds rejected at Zod layer).

3. **Should `cluster()` accept an `edge_types?` filter (like `expand` does)?**
   - What we know: D-13/D-14 doesn't mention edge-type filter.
   - What's unclear: whether the planner should add it as a Claude's-discretion additive surface (e.g., "cluster only over frontmatter-ref + wikilink edges, ignore mentions").
   - **RESOLVED:** defer to v2.x; ship v2.0.0 `cluster()` as a single algorithm over the full typed-edge graph. Edge weighting in Louvain (treating different edge types differently) is also v2.x. Locked into Plan 04-05 (no `edge_types?` param on cluster v2.0.0).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥ 22 | runtime | ✓ | 22.x (CI pinned) | — |
| npm | install | ✓ | — | — |
| `graphology` (to install) | cluster() | ✗ (not yet installed) | will install ^0.26.0 | — (hard requirement) |
| `graphology-communities-louvain` | cluster() | ✗ (not yet installed) | will install ^2.0.2 | — (hard requirement) |
| `seedrandom` | cluster() determinism | ✗ (not yet installed) | will install ^3.0.5 | — (hard requirement) |
| `@types/seedrandom` (dev) | TypeScript build | ✗ (not yet installed) | will install latest | could declare module manually but DT is cheap |
| Ollama / sqlite-vec / onnxruntime | unrelated to Phase 4 | ✓ | inherited from Phase 1–3 | — |

**Missing dependencies with no fallback:** the 4 npm packages above. All are pure JS, no native bindings, no system tooling required. Install is a single `npm install` step inside plan 04-01.

**Missing dependencies with fallback:** none.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.8 |
| Config file | none — uses vitest defaults; root is repo root |
| Quick run command | `npx vitest run src/graph/expand.test.ts -t "<test name>"` (single test) |
| Full suite command | `npm test` (1076+ tests, runs full vitest suite incl. Phase 3 conformance) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRA-04 | Migration 011 creates `edges` table with correct DDL + indexes | unit | `npx vitest run src/db/queries/edges.test.ts -t "migration 011"` | ❌ Wave 0 |
| GRA-04 | Backfill copies all wikilinks rows into edges with `type='wikilink'` | unit | `npx vitest run src/db/queries/edges.test.ts -t "backfill"` | ❌ Wave 0 |
| GRA-04 | EdgesQueries.insertBatch is idempotent under INSERT OR IGNORE | unit | `npx vitest run src/db/queries/edges.test.ts -t "idempotent"` | ❌ Wave 0 |
| GRA-04 | Indexer extracts all 4 edge types in single pass | unit | `npx vitest run src/indexer/extract-edges.test.ts` | ❌ Wave 0 |
| GRA-04 | `mention` extractor honors D-03 (casefold + min-len-4 + word boundary) | unit | `npx vitest run src/indexer/extract-edges.test.ts -t "mention"` | ❌ Wave 0 |
| GRA-04 | `frontmatter-ref` extractor honors Pitfall 6 allowlist | unit | `npx vitest run src/indexer/extract-edges.test.ts -t "frontmatter-ref"` | ❌ Wave 0 |
| GRA-04 | v1 graph tools return additive `type` field (D-04) | unit | `npx vitest run src/graph/graph.test.ts -t "type field"` | ❌ Wave 0 |
| GRA-01 | `expand({hops:1})` returns 1-hop neighbors with `via` field | unit | `npx vitest run src/graph/expand.test.ts -t "1 hop"` | ❌ Wave 0 |
| GRA-01 | `expand({hops:2})` dedups by shortest path | unit | `npx vitest run src/graph/expand.test.ts -t "shortest path"` | ❌ Wave 0 |
| GRA-01 | `expand({direction:'both'})` merges fwd + bwd | unit | `npx vitest run src/graph/expand.test.ts -t "direction both"` | ❌ Wave 0 |
| GRA-01 | `expand` honors `edge_types?` + `filter_properties?` + `include_superseded` (D-08) | unit | `npx vitest run src/graph/expand.test.ts -t "filters"` | ❌ Wave 0 |
| GRA-01 | `expand` returns partial result with warnings on unknown seed_doc_ids | unit | `npx vitest run src/graph/expand.test.ts -t "warnings"` | ❌ Wave 0 |
| GRA-01 | `expand` respects `_memory` opacity (Pitfall 3) | unit | `npx vitest run src/graph/expand.test.ts -t "memory opacity"` | ❌ Wave 0 |
| GRA-03 | `search_hybrid({expand:{hops:1}})` attaches `expansions` per hit | unit | `npx vitest run src/search/hybrid.test.ts -t "expand"` | ❌ Wave 0 |
| GRA-03 | `search_hybrid` v1-invariance: `expand` omitted → byte-identical to v1 | unit (pre-existing) | `npm run eval:baseline` | ✅ exists at `evals/v1-baseline/baseline.test.ts` |
| GRA-02 | `cluster({seed_doc_ids: …})` produces deterministic `cluster_id` assignment | snapshot | `npx vitest run src/graph/cluster.test.ts -t "deterministic"` | ❌ Wave 0 |
| GRA-02 | `cluster` hard-rejects > 5000 nodes unless `force:true` (D-13) | unit | `npx vitest run src/graph/cluster.test.ts -t "node_count_exceeded"` | ❌ Wave 0 |
| GRA-02 | `cluster({query})` composes via search_hybrid + expand (D-15a) | integration | `npx vitest run src/graph/cluster.test.ts -t "query path"` | ❌ Wave 0 |
| GRA-02 | `cluster.detailed` reports `top_types`, `top_titles`, `edge_density` per D-14 | unit | `npx vitest run src/graph/cluster.test.ts -t "summary"` | ❌ Wave 0 |
| GRA-05 | Eval: `_queries/expand.yaml` ≥5 queries pass ≥0.8 precision + recall | eval | `npx vitest run evals/v2/expand-eval.test.ts` (new) OR via existing eval harness | ❌ Wave 0 |
| GRA-05 | Eval: `_queries/search-hybrid-with-expand.yaml` ~3 queries | eval | analogous | ❌ Wave 0 |
| GRA-05 | Eval: `_queries/cluster.yaml` snapshot equality | snapshot | analogous | ❌ Wave 0 |
| (cross-cutting) | Conformance: stub adapter exhibits same expand/cluster behavior | conformance | `npx vitest run src/adapters/source/conformance.test.ts -t "expand"` | partial — file exists, new cases needed |
| (cross-cutting) | Tool-list snapshot regenerated additively (3 schema diffs + 2 new tools) | snapshot | `npm run eval:snapshot && git diff evals/v1-baseline/tools-list.snapshot.json` | partial — script exists |
| (cross-cutting) | Lint-adapters greps stay zero outside adapter dirs | lint | `bash scripts/lint-adapters.sh` | ✅ exists |
| (cross-cutting) | TypeScript strict mode passes | type | `npm run lint` (= `tsc --noEmit`) | ✅ exists |

### Sampling Rate

- **Per task commit:** `npx vitest run <file-under-edit>` + `npm run lint`
- **Per wave merge:** `npm test` + `npm run lint:check` + `npm run eval:baseline`
- **Phase gate (before `/gsd:verify-work`):** full suite green + `npm run eval:smoketest` + `_queries/expand.yaml` + `_queries/cluster.yaml` + `_queries/search-hybrid-with-expand.yaml` all ≥0.8 precision/recall (or snapshot-equal for cluster.yaml)

### Wave 0 Gaps

- [ ] `src/db/queries/edges.ts` — EdgesQueries namespace
- [ ] `src/db/queries/edges.test.ts` — unit tests for query namespace + migration 011
- [ ] `src/db/schema.ts` — append `MIGRATION 011 = { version: 11, description: …, run: runMigration011 }` to the MIGRATIONS array at line 651
- [ ] `src/indexer/extract-edges.ts` (and .test.ts) — 3 new extractors (mention, frontmatter-ref, hyperlink)
- [ ] `src/graph/expand.ts` (and .test.ts) — BFS implementation
- [ ] `src/graph/cluster.ts` (and .test.ts) — Louvain wrapper
- [ ] `src/graph/graph.ts` — D-04 additive `type` field on BacklinkResult + ForwardLinkResult
- [ ] `src/search/hybrid.ts` — D-15/D-16 post-rescore expand attachment
- [ ] `src/tool-registry.ts` — register `expand`, `cluster`; extend `search_hybrid` + `list_backlinks` + `list_forward_links` schemas
- [ ] `evals/fixtures/v2-test-vault/_queries/expand.yaml` (D-17)
- [ ] `evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml` (D-18)
- [ ] `evals/fixtures/v2-test-vault/_queries/cluster.yaml` (D-12 snapshot)
- [ ] `evals/v1-baseline/tools-list.snapshot.json` — one regen (additive diff only)
- [ ] `src/adapters/source/conformance.test.ts` — extend with ~3 expand/cluster conformance cases against stub adapter
- [ ] `package.json` — add `graphology`, `graphology-communities-louvain`, `seedrandom`, `@types/seedrandom`

## Security Domain

> security_enforcement not explicitly set in `.planning/config.json`; default-enabled per template. Phase 4 introduces zero new I/O, zero new credentials, zero new endpoints — security surface is essentially unchanged from Phase 3.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | MCP stdio transport; no auth in v2 (local-first) |
| V3 Session Management | no | stateless tool calls |
| V4 Access Control | partial | `_memory` opacity in `expand()` (D-08 / ADR-004) — agent can't surface memory docs that weren't already user-linked |
| V5 Input Validation | yes | Zod schemas on all 5 affected tool entry points (expand, cluster, search_hybrid, list_backlinks, list_forward_links); DocId regex `DOC_ID_PATTERN` in `src/tool-registry.ts:786` |
| V6 Cryptography | no | no crypto in phase 4 |
| V12 File Resources | no | no file ops outside adapter (CI grep-enforced) |
| V14 Configuration | no | no new config keys |

### Known Threat Patterns for `vault-memory` + Phase 4 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquatted graph lib | Tampering | Pinned `graphology` ^0.26.0 + `graphology-communities-louvain` ^2.0.2 + `seedrandom` ^3.0.5 via package-lock; manual provenance check documented in §Package Legitimacy Audit; recommended `checkpoint:human-verify` before `npm install` |
| Maliciously crafted edge that causes BFS to recurse infinitely | Denial of Service | Hops hard-capped at 2 (D-05); visited-set dedup; cluster hard-cap at 5000 nodes (D-13) |
| Memory exhaustion via huge cluster() input | Denial of Service | 5000-node cap (D-13) returns structured error before computing |
| `_memory` content surfaced to agent that should not access it | Information Disclosure | D-08 + ADR-004 opacity rules in `expand` (see Pitfall 3) |
| Migration 011 backfill blocking event loop on huge vault | Denial of Service | Chunked backfill (Pattern 1); 10k-row chunks |
| Mention extractor false-match on private name in agent-authored memory | Information Disclosure | D-03 exact-match-only (no fuzzy); mention extraction runs against `note_aliases` which the user controls |
| Louvain non-determinism leaking PRNG state across vaults | Tampering / non-repro | Per-call `seedrandom('vault-memory-cluster-v1')` — does NOT share state across calls |

## Sources

### Primary (HIGH confidence)
- `src/types.ts:470` — `Edge` interface; canonical 4-type union [VERIFIED: codebase grep]
- `src/db/schema.ts:118` — wikilinks table DDL [VERIFIED: codebase grep]
- `src/db/schema.ts:443` — `runMigration008` chunked-backfill pattern [VERIFIED: codebase grep]
- `src/db/schema.ts:531` — `runMigration010` function-style migration with multi-step transaction [VERIFIED: codebase grep]
- `src/db/queries/wikilinks.ts:52` — `INSERT OR IGNORE` upsert discipline [VERIFIED: codebase grep]
- `src/graph/graph.ts:37,64` — `listBacklinks` / `listForwardLinks` (extend with D-04 additive type) [VERIFIED: codebase grep]
- `src/adapters/stub/assembly-fixture.ts:148,185,200` — Phase 3 forward-compat edges for `frontmatter-ref`/`mention`/`hyperlink` [VERIFIED: codebase grep]
- `src/indexer/resolver.ts` — wikilink resolver (extension target) [VERIFIED: codebase read]
- `src/search/hybrid.ts:264-289` — Phase 3 post-RRF rescore block (insertion point for D-15/D-16 expand attachment) [VERIFIED: codebase read]
- `src/tool-registry.ts:113,175,187,829,845,850` — schemas for `search_hybrid`, `list_backlinks`, `list_forward_links` [VERIFIED: codebase grep]
- `package.json` — existing deps + scripts [VERIFIED: file read]
- `.planning/phases/04-graph-as-retrieval/04-CONTEXT.md` — D-01..D-18 locked decisions [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` — GRA-01..GRA-05 [VERIFIED: file read]
- npm registry — `graphology` 0.26.0, `graphology-communities-louvain` 2.0.2, `seedrandom` 3.0.5 [VERIFIED: `npm view` 2026-05-17]
- npm-stat — download volumes (1.15M / 83k / 7.2M weekly) [VERIFIED: api.npmjs.org/downloads 2026-05-17]
- `graphology-communities-louvain` GitHub README [CITED: github.com/graphology/graphology/blob/master/src/communities-louvain/README.md]
- `graphology` graphology.github.io [CITED: graphology.github.io/standard-library/communities-louvain]

### Secondary (MEDIUM confidence)
- Blondel et al. 2008 — original Louvain modularity paper (well-cited foundation; library implementation reflects it) [ASSUMED — paper not re-verified this session, library is the artifact under research]
- ESM compat of `graphology-communities-louvain` — main field is `index.js`, no `exports` map; consumed cleanly when imported via `import louvain from '…'` per docs example [CITED: official docs example]

### Tertiary (LOW confidence)
- None — all key claims verified at HIGH or MEDIUM.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — three deps, all verified against npm registry + GitHub repo + official docs + download volume
- Architecture: HIGH — all extension points exist in the codebase and are pointed-to by CONTEXT.md verbatim; migration pattern reused without modification
- Pitfalls: HIGH for Pitfalls 1/3/4/5 (mechanical concerns with deterministic mitigations); MEDIUM for Pitfalls 2 (mention false-positive rate) and 6 (frontmatter-ref allowlist completeness) — both require empirical validation during plan execution against Atlas Robotics fixture
- Validation Architecture: HIGH — existing harness handles eval YAML; new YAMLs follow established `_queries/recency.yaml` shape verbatim

**Research date:** 2026-05-17
**Valid until:** 2026-06-16 (30 days — graphology + Louvain ecosystem are stable; the only volatility would be a new minor of `graphology-communities-louvain` introducing a different `rng` option — unlikely)
