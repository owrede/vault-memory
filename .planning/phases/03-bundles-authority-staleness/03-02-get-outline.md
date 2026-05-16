---
plan: 03-02-get-outline
phase: 03
wave: 1
depends_on: [03-01-sections-infrastructure]
asm: [ASM-02, ASM-05]
status: pending
---

# Slice 03-02: `get_outline` MCP tool

## Objective

Ship the `get_outline({doc_id})` MCP tool returning a nested tree of `OutlineNode { anchor, heading_path, heading_text, level, chunk_ids: string[], children: OutlineNode[] }` (per D-02 locked shape). This is the smallest assembly slice — pure read from the `sections` table built in 03-01, transformed into a tree via in-memory parent-pointer reconstruction. Lands the `src/assembly/` module skeleton (`index.ts`, `types.ts`) that 03-03, 03-04, and 03-06 will then extend.

## Requirements covered

- **ASM-02** — `get_outline` MCP tool returning nested heading/block tree with chunk IDs per node.
- **ASM-05** (partial) — outline nodes carry `heading_path` and `anchor`, matching the section-level half of the citation packet contract.

## Files to create / modify

### Create

- `src/assembly/index.ts` — module barrel; exports `OutlineNode`, `getOutline`, `BundleResult`, `SectionHit`, `DossierResult`, etc. as those slices land. **No fs/path/gray-matter imports.**
- `src/assembly/types.ts` — `OutlineNode` (per D-02), `OutlineResult` (the tool's response shape: `{ doc_id, source_handle, title, root: OutlineNode[], mtime, hash, display_url }`), `GetOutlineArgs` (Zod schema input type).
- `src/assembly/outline.ts` — `getOutline(deps, args)` implementation. Resolves `doc_id` → `note_id` via `decomposeDocId` (from `src/adapters/registry.ts` per RESEARCH §"Open Risks" #5 and `src/memory/tools/recall.ts:48`); calls `SectionsQueries.getByNote(noteId)`; builds the tree via parent-pointer reconstruction; resolves citation-packet fields (title, mtime, hash, display_url) via `toCitationPacket` from `src/memory/citation-packet.ts`. Returns the nested-tree result. **No fs/path imports.**
- `src/assembly/outline.test.ts` — unit tests over an in-memory DB seeded by the indexer (or directly via `SectionsQueries.insertMany`): (a) flat doc → all sections at root; (b) nested H1>H2>H2 → root has one section with two children; (c) deep H1>H2>H3 → three-level tree; (d) preamble doc (level-0 section) → tree starts at level 0; (e) doc with no sections (e.g. completely empty) → `root: []`; (f) `chunk_ids` populated from `chunk_id_first..chunk_id_last` range.

### Modify

- `src/tool-registry.ts` — register `get_outline`. Follow the existing TOOLS + TOOL_SCHEMAS dual-export pattern (`src/tool-registry.ts:1-120`). Zod input schema:
  ```ts
  export const GetOutlineArgs = z.object({
    doc_id: z.string().describe("Opaque DocId (obsidian://vault/path) of the document"),
    vaults: z.array(z.string()).optional().describe("Vault filter; usually omitted"),
  });
  ```
- `src/server.ts` — add handler under the `CallToolRequestSchema` switch, mirroring `search_hybrid` handler at `src/server.ts:381`. Handler:
  1. Validates input via Zod.
  2. Calls `getOutline({ vaults, sectionsByNote, notes, source }, args)`.
  3. Wraps response via `ok(result)`.
  4. On error (unknown doc_id → returns `{ isError: true, content: [...] }` per the v1 server's error pattern).

## Approach

**Tree-building algorithm** (in-memory, post-DB read):

```ts
function buildOutlineTree(rows: SectionRow[]): OutlineNode[] {
  // SectionsQueries.getByNote returns rows ordered by parent_id ASC NULLS FIRST, then ord ASC.
  const byId = new Map<number, OutlineNode>();
  const roots: OutlineNode[] = [];
  for (const r of rows) {
    const node: OutlineNode = {
      anchor: r.anchor,
      heading_path: JSON.parse(r.heading_path),
      heading_text: r.heading_text,
      level: r.level,
      chunk_ids: collectChunkIdsInRange(r.chunk_id_first, r.chunk_id_last),
      children: [],
    };
    byId.set(r.id, node);
    if (r.parent_id == null) roots.push(node);
    else byId.get(r.parent_id)!.children.push(node);
  }
  return roots;
}
```

The `collectChunkIdsInRange(first, last)` helper returns chunk-id strings (the v1 chunk-table IDs per CONTEXT.md D-02). Look up via `ChunksQueries` — a small batch query. For sections with `chunk_id_first === null` (heading with no body), return `[]`.

**Document-level citation packet:** the outline result carries `title`, `mtime`, `hash`, `display_url` for the document itself (heading_path = `[]` per CONTEXT.md §specifics convention). Each `OutlineNode` carries its own `anchor` + `heading_path` which together form a section-level citation token.

**Empty / unknown doc_id:** the v1 `recall` tool returns empty results for "no match"; for `get_outline`, an unknown `doc_id` is an exceptional case (the caller asked about a specific doc by ID) — return `{ isError: true, content: [{ type: "text", text: JSON.stringify({error: "doc_not_found", doc_id}) }] }` per RESEARCH §"Open questions" for §1.

**Adapter-seam discipline:** `src/assembly/outline.ts` reads `Document` properties (title, mtime, hash, display_url) via `SourceConnector.readDocument()` from `deps.source` — not via `fs.readFile` or `gray-matter`. The `SectionsQueries` access is fine (SQLite is L0 substrate, not the adapter tier). No `fs`/`path.join`/`gray-matter`/`chokidar` imports.

**Dependency injection** — follow `src/memory/tools/recall.ts:1` pattern: `getOutline(deps, args)` where `deps = { sections: SectionsQueries, notes: NotesQueries, chunks: ChunksQueries, source: SourceConnector, displayUrlFor: (docId) => string | null }`. Tests inject in-memory dependencies; the server handler wires the real ones.

## Tasks

1. **Skeleton: `src/assembly/index.ts`, `src/assembly/types.ts`** — barrel + canonical types. Export shapes that 03-03/04/06 will use. `OutlineNode`/`OutlineResult` finalized. (~50 LOC)
2. **`getOutline` implementation in `src/assembly/outline.ts`** — `buildOutlineTree` + `collectChunkIdsInRange` + doc-level packet hydration. (~120 LOC)
3. **Tool registration in `src/tool-registry.ts`** — Zod `GetOutlineArgs`, TOOLS entry with description noting "navigable section tree; consume `anchor` as the section citation token; chunk_ids point to v1 chunk-table IDs". (~30 LOC)
4. **Server handler in `src/server.ts`** — wire the dispatch; error handling for unknown doc_id. (~30 LOC)
5. **Unit tests `src/assembly/outline.test.ts`** — 6 cases per Files-to-create list above. Seed in-memory DB directly via `SectionsQueries.insertMany`; do NOT spin up the indexer (keep test scope tight). (~180 LOC)

## Tests

- 6 cases in `src/assembly/outline.test.ts` covering all tree shapes + edge cases.
- 1 conformance assertion will be added in slice 03-07 ("`get_outline` returns nested tree with anchors on both obsidian-fs and stub adapters").

**Estimated new test cases:** 8–10 (6 here, 1–2 in conformance describe.each rows).

## Acceptance criteria

- [ ] `get_outline({doc_id})` is registered, listed in `tools/list`, and callable.
- [ ] Response shape: `{ doc_id, source_handle, title, root: OutlineNode[], mtime, hash, display_url }`; `OutlineNode` exactly matches D-02.
- [ ] Unknown `doc_id` returns `{ isError: true, ... }` with `error: "doc_not_found"`.
- [ ] All 6 outline unit tests pass.
- [ ] No `fs`/`gray-matter`/`chokidar`/`path.*` imports in `src/assembly/`; `scripts/lint-adapters.sh` clean.
- [ ] Tool registration follows v1 dual-export pattern; tools-list snapshot regenerates additively (Phase 3 PR consolidates the regen in slice 03-05 — but 03-02 may locally regen as a draft, then 03-05 confirms additive-only).

## Estimated effort

- **Tasks:** 5
- **Lines changed:** ~410 added across 5 new files + 2 modified files
- **PR shape:** one PR; depends on 03-01 merged.

## Citations

- `src/memory/tools/recall.ts:1-215` — exemplar L3 tool pattern (injected deps, error handling)
- `src/memory/tools/recall.ts:48` — `decomposeDocId` usage
- `src/memory/citation-packet.ts` — `toCitationPacket(doc, displayUrlFor)` reused
- `src/tool-registry.ts:1-120` — TOOLS + TOOL_SCHEMAS dual-export pattern
- `src/server.ts:381-402` — `search_hybrid` handler shape to mirror
- 03-CONTEXT.md §D-02 — outline tree shape (locked)
- 03-RESEARCH.md §1 (placement), §4 (BlockNode Section variant)
