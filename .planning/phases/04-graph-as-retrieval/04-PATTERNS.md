# Phase 4: Graph-as-retrieval — Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 18 (8 new, 10 modified)
**Analogs found:** 16 / 18 (2 with no direct analog — `cluster.ts` Louvain wrapping and `seedrandom`/graphology integration)

## File Classification

### New files

| New file | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/db/queries/edges.ts` | query namespace (model adapter) | CRUD | `src/db/queries/wikilinks.ts` | exact (same role + flow) |
| `src/db/queries/edges.test.ts` | unit test | CRUD | `src/db/queries/aliases.test.ts` (db queries co-located test) | exact |
| `src/graph/expand.ts` | service / graph traversal | request-response (BFS) | `src/graph/graph.ts` (`listBacklinks`/`listForwardLinks`) + `src/indexer/resolver.ts` (cache-per-run idiom) | role-match + idiom |
| `src/graph/expand.test.ts` | unit test | request-response | `src/graph/graph.test.ts` | exact |
| `src/graph/cluster.ts` | service / community detection | batch transform | none direct — composes `expand` + `graphology` + `seedrandom` | partial (composition only) |
| `src/graph/cluster.test.ts` | unit test (incl. determinism snapshot) | batch | `src/graph/graph.test.ts` | role-match |
| `src/indexer/extract-edges.ts` (new helper, sibling of `resolver.ts`) | service / extractor | transform | `src/indexer/single.ts` `insertWikilinks` (lines 312–326) | role-match |
| `evals/fixtures/v2-test-vault/_queries/expand.yaml` | eval fixture | data-only YAML | `evals/fixtures/v2-test-vault/_queries/dossier.yaml` | exact |
| `evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml` | eval fixture | data-only YAML | `evals/fixtures/v2-test-vault/_queries/recency.yaml` | exact |
| `evals/fixtures/v2-test-vault/_queries/cluster.yaml` | eval fixture (snapshot) | data-only YAML | `evals/fixtures/v2-test-vault/_queries/dossier.yaml` | exact |

### Modified files

| Modified file | Role | Change | Analog change pattern in same file |
|---------------|------|--------|------------------------------------|
| `src/db/schema.ts` | substrate / migration | add `runMigration011` + register | `runMigration010` (lines 531–596) and `runMigration008` (lines 443–464, with backfill) |
| `src/db/database.ts` | substrate / wiring | wire `EdgesQueries` | wikilinks wiring at lines 8, 29, 69 |
| `src/indexer/resolver.ts` / `src/indexer/single.ts` | indexer | call new extractors; write to `edges` | `insertWikilinks` (`single.ts:312–326`) + `WikilinkResolver` (`resolver.ts:33–96`) |
| `src/graph/graph.ts` | service | additive `type` field on `BacklinkResult`/`ForwardLinkResult` | additive `status?` / `superseded_by?` shape used in `BundleAnchor` (`src/assembly/bundle.ts:132–135`) |
| `src/graph/index.ts` | barrel export | add `expand`/`cluster` exports | existing single-line re-export (`graph/index.ts:1–2`) |
| `src/search/hybrid.ts` | search post-processor | post-rescore expand attachment | post-RRF rescore block (`hybrid.ts:245–294`) |
| `src/assembly/bundle.ts` | service | extend `BacklinkEntry.relation` from literal `"wikilink"` to `Edge.type` union | `BacklinkEntry` literal field (lines 154–166) — strictly additive widening |
| `src/tool-registry.ts` | tool registry | register `expand`/`cluster`; additive Zod for `search_hybrid` + `list_backlinks` + `list_forward_links` | Phase 3 additive Zod params on `search_hybrid` (lines 829–843) |
| `src/adapters/source/conformance.test.ts` | conformance test | extend with expand/cluster cases | existing stub edges (`src/adapters/stub/assembly-fixture.ts:148, 185, 200`) |
| `evals/v1-baseline/tools-list.snapshot.json` | snapshot | one regen for additive diff | Phase 3 sign-off regen (history visible in git) |
| `package.json` | config | add graphology + graphology-communities-louvain + seedrandom + @types/seedrandom | existing dep list shape |

---

## Pattern Assignments

### `src/db/queries/edges.ts` (NEW — query namespace, CRUD)

**Analog:** `src/db/queries/wikilinks.ts` (canonical sibling — 117 lines, full surface)

**Imports + class skeleton pattern** (analog `wikilinks.ts:1, 29–50`):
```typescript
import type BetterSqlite3 from "better-sqlite3";

export interface WikilinkInput { /* ... */ }
export interface BacklinkRow { /* ... */ }
export interface ForwardLinkRow { /* ... */ }

export class WikilinksQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByNote: BetterSqlite3.Statement<[number]>;
  private readonly _backlinks: BetterSqlite3.Statement<
    [number],
    { source_note: number; line_number: number | null; link_text: string | null }
  >;
  // …
  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT OR IGNORE INTO wikilinks
        (source_note, target_path, target_note, link_text, anchor, line_number)
      VALUES (@source_note, @target_path, @target_note, @link_text, @anchor, @line_number)
    `);
    // …
  }
}
```

**`INSERT OR IGNORE` discipline** (analog `wikilinks.ts:51–55`) — required per D-02 to make re-extraction idempotent. The UNIQUE constraint on `(source_doc, target_doc, type, anchor)` (per D-01) replaces the implicit dedup wikilinks relied on.

**Batch insert via single `db.transaction`** (analog `wikilinks.ts:74–88`):
```typescript
insertBatch(sourceNoteId: number, links: WikilinkInput[]): void {
  const tx = this.db.transaction((xs: WikilinkInput[]) => {
    for (const x of xs) {
      this._insert.run({
        source_note: sourceNoteId,
        target_path: x.targetPath,
        // ...
      });
    }
  });
  tx(links);
}
```

**Prepared-statement-returning-typed-row pattern** (analog `wikilinks.ts:32–48` — see the second type param to `BetterSqlite3.Statement<P, R>`). New file needs to expose a third filter overload accepting an optional `type?: EdgeType[]` to support D-04 server-side filtering once enabled (deferred per D-04 — Phase 4 keeps signature parameter-free but the SQL `WHERE type IN (...)` shape is straightforward).

**Delete-by-note + cascade-friendly FK** (analog `wikilinks.ts:56, 90–92`): `_deleteByNote = db.prepare("DELETE FROM wikilinks WHERE source_note = ?")` — same shape for edges; the FK on `source_doc REFERENCES notes(id) ON DELETE CASCADE` (per migration 011) does the same job during note delete.

**Row-mapping snake_case → camelCase at the query boundary** (analog `wikilinks.ts:94–116`):
```typescript
getBacklinks(noteId: number): BacklinkRow[] {
  return this._backlinks.all(noteId).map((r) => ({
    sourceNoteId: r.source_note,
    lineNumber: r.line_number,
    linkText: r.link_text,
  }));
}
```

---

### `src/db/queries/edges.test.ts` (NEW — unit test)

**Analog:** `src/db/queries/aliases.test.ts` (sibling co-located test pattern — verified by directory listing). Tests are colocated with the queries file and use `:memory:` DB construction. The graph test (`src/graph/graph.test.ts:73–80`) shows the canonical fixture-creation idiom:

```typescript
beforeEach(() => {
  db = new Database(":memory:", "test-vault");
  db.migrate();
  vault = makeVault(db);
});
```

**Seed helper that uses `db.notes.upsertByPath` then `db.wikilinks.insertBatch`** (analog `src/graph/graph.test.ts:18–71`) — `edges.test.ts` does the same but with `db.edges.insertBatch`.

---

### `src/db/schema.ts` — add `runMigration011` (MODIFIED)

**Analog:** `runMigration008` (lines 443–464) — backfill migration with idempotency short-circuit. **AND** `runMigration010` (lines 531–596) — multi-step DDL+backfill function-style migration.

**`runMigration008` short-circuit + ctx-aware pattern** (lines 444–464):
```typescript
function runMigration008(db: BetterSqlite3Database, ctx: MigrationContext): void {
  // Short-circuit: zero notes to backfill means we don't need vaultName at all.
  const pending = db
    .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM notes WHERE doc_uri IS NULL")
    .get();
  if (!pending || pending.c === 0) return;
  // …
  const update = db.prepare(`UPDATE notes SET doc_uri = @prefix || path WHERE doc_uri IS NULL`);
  update.run({ prefix });
}
```

**`runMigration010` multi-step pattern** (lines 531–596) — DDL + idempotent column-add via PRAGMA introspection + backfill helper, all inside the outer `db.transaction(...)` from `database.ts:118`:
```typescript
function runMigration010(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  // ── Step A: DDL with IF NOT EXISTS ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS sections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id         INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      // ...
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sections_note_anchor ON sections(note_id, anchor);
    CREATE INDEX IF NOT EXISTS sections_note_parent_ord ON sections(note_id, parent_id, ord);
  `);

  // ── Step B: idempotent column add via PRAGMA ──
  const cols = db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
  const hasStatus = cols.some((c) => c.name === "status");
  if (!hasStatus) {
    db.exec("ALTER TABLE notes ADD COLUMN status TEXT");
  }
  // ── Step C: helper-driven backfill ──
  backfillSectionsFromChunks(db);
}
```

**Migration registration** (analog lines 598–651):
```typescript
export const MIGRATIONS: readonly Migration[] = [
  // ...
  {
    version: 10,
    description: "sections table + notes.status denormalization + one-time section backfill (Phase 3 / 03-01)",
    run: runMigration010,
  },
];
```
Phase 4 adds an entry with `version: 11`, function-style (because of chunked backfill per Pitfall 5 in RESEARCH.md).

**Chunked backfill loop** — RESEARCH.md Pattern 1 (lines 297–321) is the prescribed shape. The driving idiom (`id > @after_id` pagination + `LIMIT @chunk`) has no exact analog in the codebase, but the `runMigration010` step-C helper call (line 595) is the closest precedent for "function-style migration with TS-level control flow over SQL." Plan should treat that pattern as authoritative.

---

### `src/db/database.ts` — wire EdgesQueries (MODIFIED)

**Analog:** wikilinks wiring at lines 8, 29, 69.

**Three-line wiring pattern** (lines 8, 29, 69):
```typescript
// Line 8: import
import { WikilinksQueries } from "./queries/wikilinks.js";

// Line 29: declare readonly field
readonly wikilinks: WikilinksQueries;

// Line 69: construct after migrate
this.wikilinks = new WikilinksQueries(this.handle);
```

Phase 4 adds an equivalent triplet for `edges`. Construction order matters only if `EdgesQueries` reads other namespaces in its constructor (it does not — only prepares statements against the table).

---

### `src/indexer/extract-edges.ts` + extension of `src/indexer/single.ts` (NEW + MODIFIED)

**Analog:** `insertWikilinks` helper at `src/indexer/single.ts:312–326`:
```typescript
function insertWikilinks(vault: Vault, sourceNoteId: number, wikilinks: ParsedWikilink[]): void {
  if (wikilinks.length === 0) return;
  const inputs = wikilinks.map((wl) => {
    // shape transform from ParsedWikilink → WikilinkInput
    return {
      targetPath: wl.targetPath,
      targetNoteId: /* resolved id */,
      // ...
    };
  });
  vault.db.wikilinks.insertBatch(sourceNoteId, inputs);
}
```

**Existing delete-then-insert + write-after-upsert pattern** (analog `single.ts:117–119, 160–161, 167, 236`):
```typescript
// Body-hash fast path branch:
vault.db.aliases.setForNote(upsert.id, extractAliases(parsed.frontmatter));
vault.db.wikilinks.deleteByNote(upsert.id);
insertWikilinks(vault, upsert.id, parsed.wikilinks);

// Full re-embed branch:
vault.db.chunks.deleteByNote(upsert.id);
vault.db.wikilinks.deleteByNote(upsert.id);
// ... chunk/embed ...
insertWikilinks(vault, upsert.id, parsed.wikilinks);
```

Phase 4 extends each `deleteByNote(...)` + `insertWikilinks(...)` pair with the corresponding `vault.db.edges.deleteByNote(...)` + new unified `insertAllEdges(vault, upsert.id, parsed)` call. The unified extractor is `extractAllEdges()` per RESEARCH.md Code Examples section (lines 565–578):

```typescript
// New: src/indexer/extract-edges.ts
export function extractAllEdges(vault: Vault, parsed: ParsedNote, resolver: WikilinkResolver): EdgeInput[] {
  return [
    ...extractWikilinkEdges(parsed, resolver),
    ...extractMentionEdges(parsed, vault),
    ...extractFrontmatterRefEdges(parsed, vault),
    ...extractHyperlinkEdges(parsed),
  ];
}
```

**Resolver cache-per-run pattern** (analog `src/indexer/resolver.ts:33–96`) — the new mention extractor builds a single casefolded candidate-set from `note_aliases` once per indexer run (mirrors `WikilinkResolver`'s single-run cache scope; see file header at `resolver.ts:14–22`).

---

### `src/graph/expand.ts` (NEW — graph BFS)

**Analog:** No direct BFS analog in the codebase — but two adjacent patterns combine:
1. **`listBacklinks`/`listForwardLinks` shape** (`src/graph/graph.ts:37–95`) — vault read + hydrate + return citation-packet-like results.
2. **Single-run cache + resolver idiom** (`src/indexer/resolver.ts:33–96`) — for the `visited: Map<noteId, ViaTrace>` shape.

**Throw on missing seed + early return** (analog `src/graph/graph.ts:37–55`):
```typescript
export function listBacklinks(vault: Vault, notePath: string): BacklinkResult[] {
  const note = vault.db.notes.getByPath(notePath);
  if (!note) {
    throw new Error(`Note not found: ${notePath}`);
  }
  const rows = vault.db.wikilinks.getBacklinks(note.id);
  const results: BacklinkResult[] = [];
  for (const row of rows) {
    const src = vault.db.notes.getById(row.sourceNoteId);
    if (!src) continue; // FK should prevent this, but be defensive.
    results.push({ /* ... */ });
  }
  return results;
}
```

**Phase 4 deviation:** D-08 (recommendation in CONTEXT "Claude's Discretion") says do NOT throw on broken `seed_doc_ids` — return `{ documents, warnings: [{seed_doc_id, reason: "unknown_doc"}] }`. So expand uses the rest of the shape (defensive `continue`, vault-keyed reads) but replaces `throw` with `warnings` array accumulation. RESEARCH.md Pattern 3 (lines 372–413) is the canonical BFS skeleton.

**Note-cache pattern to avoid repeat note lookups during hydration** (analog `src/graph/graph.ts:110–120`):
```typescript
const noteCache = new Map<number, { path: string; title: string }>();
for (const row of rows) {
  let src = noteCache.get(row.sourceNoteId);
  if (!src) {
    const n = vault.db.notes.getById(row.sourceNoteId);
    if (!n) continue;
    src = { path: n.path, title: n.title };
    noteCache.set(row.sourceNoteId, src);
  }
  // …
}
```

`expand.ts` adopts the same cache idiom inside hydration after BFS completes.

---

### `src/graph/cluster.ts` (NEW — Louvain)

**Analog:** None direct in vault-memory. The closest internal idioms are:
- **External-lib wrapping with deterministic seed init** — none exists in the codebase yet. The cross-encoder `OnnxReranker` at `src/rerank/onnx-reranker.ts` is the closest "wrap an external library" precedent (lazy-load + error swallow).
- **Compose existing primitives** (`expand` + `search_hybrid` for D-15a `query` path) — pattern visible in `src/assembly/dossier.ts` which composes search + bundle reads.

**Anchoring code from RESEARCH.md Pattern 5 (lines 446–491)** — this is the authoritative skeleton; the plan should treat it as the analog because no closer codebase analog exists:
```typescript
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import seedrandom from "seedrandom";

export async function cluster(vault: Vault, opts: ClusterOptions): Promise<ClusterResult> {
  // 1. Resolve seeds (query path composes search_hybrid + expand per D-15a)
  // 2. Compute 1-hop neighborhood via expand()
  // 3. Hard-cap check (D-13)
  if (nodeIds.length > 5000 && !opts.force) {
    return { ok: false, reason: "node_count_exceeded", node_count: nodeIds.length, threshold: 5000,
             hint: "pass force:true to compute" };
  }

  // 4. Build graphology graph — D-12 sort by DocId for determinism
  const sortedNodes = [...nodeIds].sort();
  const g = new Graph({ type: "undirected", multi: false });
  for (const id of sortedNodes) g.addNode(String(id));
  for (const edge of vault.db.edges.getAllForNodes(sortedNodes)) {
    if (g.hasEdge(String(edge.source_doc), String(edge.target_doc))) continue;
    g.addEdge(String(edge.source_doc), String(edge.target_doc), { weight: 1 });
  }

  // 5. Louvain with seeded RNG (D-12)
  const rng = seedrandom("vault-memory-cluster-v1");
  const detailed = louvain.detailed(g, { rng, randomWalk: true });
  // 6. Group nodes → cluster_id = min DocId; hydrate summary
}
```

**Discriminated-union return pattern** (analog `src/write/write.ts` `WriteResult = WriteSuccess | WriteConflict`) — cluster() error path returns `{ok: false, reason, ...}`, mirroring the project's discriminated-error convention.

---

### `src/graph/graph.ts` — additive `type` field (MODIFIED)

**Analog change:** Phase 3's additive widening of `BundleAnchor` in `src/assembly/bundle.ts:132–135`:
```typescript
export type BundleAnchor = CitationPacket & {
  status?: string;
  superseded_by?: string;
};
```

Phase 4 mirrors this on `BacklinkResult` and `ForwardLinkResult` (lines 10–23 of `graph.ts`):
```typescript
export interface BacklinkResult {
  sourcePath: string;
  sourceTitle: string;
  lineNumber: number | null;
  linkText: string | null;
  type: EdgeType;  // ← NEW, additive (post-backfill all rows have type='wikilink' at minimum)
}
```

The reads underneath switch from `vault.db.wikilinks.getBacklinks(note.id)` (line 43) to `vault.db.edges.getBacklinks(note.id)`. Same row → result mapping shape.

---

### `src/graph/index.ts` — barrel export (MODIFIED)

**Analog:** existing line-by-line re-export at `src/graph/index.ts:1–2`:
```typescript
export { listBacklinks, listForwardLinks, findBrokenLinks } from "./graph.js";
export type { BacklinkResult, ForwardLinkResult, BrokenLinkResult } from "./graph.js";
```
Phase 4 adds two more lines for `expand`/`cluster` functions and their result types. No structural change to the barrel.

---

### `src/search/hybrid.ts` — post-rescore expand attachment (MODIFIED)

**Analog:** The post-RRF rescore block at `src/search/hybrid.ts:245–294` is the canonical "Phase N adds an additive optional post-processor that short-circuits when the new param is omitted" pattern.

**Guard-and-short-circuit pattern** (`hybrid.ts:262–294`):
```typescript
const recencyWeight = opts.recencyWeight ?? 0;
const authorityWeight = opts.authorityWeight ?? 0;
if (recencyWeight !== 0 || authorityWeight !== 0) {
  // ── per-hit hydration + score adjustment ──
  const clock = opts.clock ?? Date.now;
  const now = clock();
  const halfLifeMs = (opts.halfLifeDays ?? 30) * 24 * 60 * 60 * 1000;
  const vaultByNameLocal = new Map<string, Vault>();
  for (const v of opts.vaults) vaultByNameLocal.set(v.config.name, v);
  for (const h of flat) {
    const vault = vaultByNameLocal.get(h.vaultName);
    if (!vault) continue;
    const chunk = vault.db.chunks.getById(h.chunkId);
    if (!chunk) continue;
    // ... score modification ...
  }
  flat.sort((a, b) => b.rrf - a.rrf);
}
```

**v1-baseline invariance comment** (`hybrid.ts:248–251`) — this comment style is the canonical documentation for additive Phase N changes:
> When both weights are zero (v1 default), the guard short-circuits entirely and the rescore loop does zero work and zero DB reads — preserving v1 perf exactly.

Phase 4's `if (opts.expand)` guard (per D-15/D-16, RESEARCH.md Pattern 4) goes at the END of the function (after rescore + rerank, before return) using the same guard idiom. The comment block should mirror this language verbatim for `expand`.

---

### `src/assembly/bundle.ts` — extend `BacklinkEntry.relation` (MODIFIED)

**Current state** (`bundle.ts:154–166`):
```typescript
export type BacklinkEntry = CitationPacket & {
  property_snippet: string;
  relation: "wikilink";   // ← v2.0.0 literal; Phase 4 widens
};
```

Comment at lines 145–148 already telegraphs the change:
> `"wikilink"` only (the v1 wikilinks table is the only edge source). Phase 4 widens to typed edges; the literal becomes the actual `Edge.type`.

**Phase 4 change** — widen the literal to the `EdgeType` union (the canonical `Edge.type` from `src/types.ts:470`). This is a strictly additive type widening (all existing values still type-check; "wikilink" remains a valid member). Same change for `ForwardLinkEntry` at line 163–166.

---

### `src/tool-registry.ts` — register expand/cluster + additive Zod (MODIFIED)

**Analog: existing tool descriptor pattern** (lines 113–172, 175–198):
```typescript
{
  name: "search_hybrid",
  description: "Hybrid search: combines semantic (embedding) and BM25 (full-text) results via Reciprocal Rank Fusion. Best general-purpose query.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      vaults: { type: "array", items: { type: "string" } },
      // ...
    },
  },
},
{
  name: "list_backlinks",
  description: "Find all notes that link TO a given note.",
  inputSchema: {
    type: "object",
    required: ["vault", "path"],
    properties: {
      vault: { type: "string" },
      path: { type: "string" },
    },
  },
},
```

**Analog: Phase 3's additive Zod params on `search_hybrid`** (`tool-registry.ts:829–843`):
```typescript
search_hybrid: {
  query: z.string().min(1),
  vaults: z.array(z.string()).optional(),
  top_k: z.number().int().positive().max(100).optional().default(10),
  rrf_k: z.number().int().positive().max(1000).optional().default(60),
  exclude_paths: z.array(z.string()).optional(),
  rerank: z.boolean().optional().default(false),
  // Phase 3 / 03-05 additive params — D-07, D-08, ASM-07, ASM-08.
  // All `.optional()` with defaults that vanish when unset, so v1
  // callers see no behavior change.
  recency_weight: z.number().optional().default(0),
  authority_weight: z.number().optional().default(0),
  half_life_days: z.number().positive().optional().default(30),
  include_superseded: z.boolean().optional().default(false),
},
```

**Phase 4 pattern application:**
1. Add `expand` field to `search_hybrid` Zod schema as nested `z.object({ hops: z.union([z.literal(1), z.literal(2)]), direction: z.enum([...]).optional(), edge_types: z.array(...).optional() }).optional()`. Mirror the "additive optional with comment block" idiom.
2. New tool descriptors for `expand` and `cluster` follow the same shape as `search_hybrid` / `list_backlinks` (raw JSON Schema in TOOLS array + Zod shape in TOOL_SCHEMAS). The literal-union via `z.union([z.literal(1), z.literal(2)])` (D-05) is the canonical Zod 4 idiom for `hops: 1 | 2`.

---

### Eval YAMLs (NEW)

**Analog:** `evals/fixtures/v2-test-vault/_queries/dossier.yaml` — already verified shape:
```yaml
queries:
- id: alice-chen-dossier
  query: "Build me a dossier for Alice Chen."
  expected_doc_ids:
  - people/alice-chen.md
  - projects/atlas-1.md
  # ...
  rationale: >
    Her bio + the project she owns + the recent meeting + observed
    preferences + the working-style brief — everything an agent would need
    to interact with her.
```

**`expand.yaml` shape (D-17):** Same top-level `queries:` array. Each item carries `id`, `description`, `input: { seed_doc_ids, hops, direction?, edge_types?, filter_properties? }`, `expected_doc_ids: string[]`, `min_precision: 0.8`, `min_recall: 0.8` per D-17.

**`cluster.yaml` shape (D-12):** Same `queries:` array; each item has `input: { query | seed_doc_ids }` and an `expected_clusters: [{ cluster_id, member_doc_ids: [...] }]` snapshot. The format follows the dossier eval — list of doc paths the test runner compares.

**`search-hybrid-with-expand.yaml` shape (D-18):** Mirrors `recency.yaml` (which exercises search with rescore params). Each query has `input: { query, expand: {hops: 1} }` plus assertions on (a) top-K ranking preserved, (b) `expansions` field present per hit.

---

## Shared Patterns

### Pattern A: Adapter-seam discipline (CI grep enforced)

**Source:** `.planning/codebase/CONVENTIONS.md` + the existing `scripts/lint-adapters.sh`.
**Apply to:** `src/graph/expand.ts`, `src/graph/cluster.ts`, `src/db/queries/edges.ts`, `src/indexer/extract-edges.ts`

**Rule:** No imports of `fs`, `path` (except `path.posix` join — already widely-used), `gray-matter`, or anything under `src/adapters/source/obsidian-fs/` from these new files. All data flow goes through `vault.db.*` (SQLite) and pre-parsed `Document` / `ParsedNote` shapes. Permitted external imports for Phase 4: `graphology`, `graphology-communities-louvain`, `seedrandom` (in `cluster.ts` only).

---

### Pattern B: Additive-optional Zod schema + guarded short-circuit

**Source:** `src/tool-registry.ts:829–843` (Phase 3) + `src/search/hybrid.ts:262–294` (Phase 3 rescore).
**Apply to:** `search_hybrid({expand})` extension; `list_backlinks` / `list_forward_links` additive `type` field on output; any future Phase 5 brief-aware Zod additions.

**Rule:** Every new input param is `.optional()` with a default that — when omitted — produces byte-identical behavior to today. Every guard inside the implementation reads `const x = opts.x ?? defaultValue; if (x !== defaultValue) { /* new path */ }`. The Phase 3 comment block (`hybrid.ts:245–251, 296–298`) is the documentation template.

---

### Pattern C: `INSERT OR IGNORE` + UNIQUE constraint = idempotent re-extraction

**Source:** `src/db/queries/wikilinks.ts:51–55` + `src/db/schema.ts` wikilinks DDL (line 118).
**Apply to:** `src/db/queries/edges.ts` `_insert` statement + migration 011 DDL `UNIQUE (source_doc, target_doc, type, anchor)`.

**Rule:** Re-indexing a note (delete-then-insert per `single.ts:118–119, 161, 167`) must always produce the same row-set in the table. `INSERT OR IGNORE` + UNIQUE constraint makes this safe even if a deletion is somehow skipped (e.g., a watcher race).

---

### Pattern D: Discriminated-union return for ok/error

**Source:** `src/write/write.ts` `WriteResult = WriteSuccess | WriteConflict`.
**Apply to:** `cluster()` hard-cap error path per D-13: `{ ok: false, reason: "node_count_exceeded", node_count, threshold, hint }`. `expand()` may also return `{ documents, warnings: [...] }` per Claude's Discretion recommendation; this is a soft warning shape, not a discriminated error.

---

### Pattern E: Single-run cache for derived data

**Source:** `src/indexer/resolver.ts:33–96` (`WikilinkResolver` cache scope: one instance per indexer run).
**Apply to:**
- `extractMentionEdges` candidate-set construction (build casefolded title+alias map once per indexer run, not per note).
- `cluster()` graphology graph construction (build once per call, do not memo across calls).

**Rule:** Caches that bridge runs introduce subtle staleness bugs. Confine all caching to function-local or per-call scope.

---

### Pattern F: Comment-block idiom for Phase N additive changes

**Source:** `src/search/hybrid.ts:245–261` and `src/tool-registry.ts:836–842`.

**Rule:** Every additive change site gets a comment block of the form:
```
// ── Phase 4 / GRA-NN (D-XX, D-YY): ${what} ──
//
// Inserted ${where}. When ${flag} is omitted (the v1/v2 default), the
// guard short-circuits entirely and ${this loop} does zero work — preserving
// ${prior-phase} perf exactly.
```
This is project-wide convention; planner should produce these for every change site in the diff.

---

## No Analog Found

Files where no close codebase precedent exists. Planner should treat RESEARCH.md patterns as canonical:

| File | Role | Data Flow | Reason | Fall back to |
|------|------|-----------|--------|--------------|
| `src/graph/cluster.ts` | service / Louvain | batch transform | First external graph-library integration in the codebase | RESEARCH.md Pattern 5 (lines 446–491) |
| `src/indexer/extract-edges.ts` mention regex builder | service / extractor | transform | No prior aliased-tokenization code in the codebase | RESEARCH.md "Mention extractor" example (lines 581–611) |

---

## Metadata

**Analog search scope:**
- `src/db/queries/` (all 9 query namespace files)
- `src/graph/` (graph.ts, graph.test.ts, index.ts)
- `src/indexer/` (resolver.ts, single.ts, indexer.ts)
- `src/search/hybrid.ts`
- `src/assembly/bundle.ts`
- `src/tool-registry.ts`
- `src/db/schema.ts` migration functions (lines 443–651)
- `evals/fixtures/v2-test-vault/_queries/dossier.yaml` (representative)

**Files read (full):** `src/db/queries/wikilinks.ts`, `src/db/database.ts`, `src/graph/graph.ts`, `src/graph/index.ts`, `src/indexer/resolver.ts`

**Files read (targeted ranges):** `src/db/schema.ts:440–651`, `src/search/hybrid.ts:240–340`, `src/tool-registry.ts:100–230, 820–910`, `src/assembly/bundle.ts:130–220`, `src/indexer/single.ts:90–220`, `src/graph/graph.test.ts:1–80`

**Key patterns identified:**
1. All db query namespaces follow `WikilinksQueries` shape: typed `BetterSqlite3.Statement<P, R>` fields prepared in constructor + snake_case→camelCase mapping at the boundary + `INSERT OR IGNORE` + batched `db.transaction`.
2. All migrations after v5 are function-style (`run: runMigrationNNN`) so they can interleave SQL + TS control flow inside the outer `db.transaction` from `database.ts:118`.
3. All additive Phase N changes use the guard-and-short-circuit pattern (`opts.x ?? default → if (x !== default) { ... }`) with the canonical "v1 invariance preserved" comment block.
4. Graph operations live behind the `Vault` struct and read only via `vault.db.*` — never via direct `BetterSqlite3.Database` access.
