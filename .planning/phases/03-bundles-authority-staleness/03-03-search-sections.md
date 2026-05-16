---
plan: 03-03-search-sections
phase: 03
wave: 1
depends_on: [03-01-sections-infrastructure]
asm: [ASM-03, ASM-05]
status: pending
---

# Slice 03-03: `search_sections` MCP tool

## Objective

Ship `search_sections({query, limit})` MCP tool that performs section-level retrieval by composing the existing v1 chunk-level hybrid pipeline (`hybridSearch`) with a chunk-to-section promotion step. Composition strategy: run `hybridSearch` with an inflated `topK = limit × 5`, then map each chunk hit to its enclosing section via `SectionsQueries.findContainingChunk`, de-duplicate by section anchor, score each section as `max(constituent chunk scores)`, sort descending, slice to `limit`. Preserves the v1 RRF pipeline byte-for-byte.

## Requirements covered

- **ASM-03** — `search_sections({query, limit})` whole-section retrieval reusing the hybrid pipeline.
- **ASM-05** (partial) — every returned section carries a section-level citation packet `{doc_id, source_handle, title, heading_path: [non-empty], anchor, mtime, hash, display_url}`.

## Files to create / modify

### Create

- `src/assembly/search-sections.ts` — `searchSections(deps, args)` implementation per RESEARCH §3.
- `src/assembly/search-sections.test.ts` — unit tests with a mocked `hybridSearch` that returns fixed chunk hits; assertions cover: (a) single-section query → one result with score = the chunk's score; (b) multi-chunk-per-section query → result count ≤ limit; section score = max of constituent chunks; (c) chunks across multiple notes → one section hit per (note, section) pair; (d) tie-break: equal scores sort by `chunk_id_first` ascending (earlier section in doc order wins); (e) chunk with `findContainingChunk → null` (orphan chunk, e.g. legacy pre-migration row) is silently dropped; (f) section hit carries non-empty `heading_path` per the convention.

### Modify

- `src/tool-registry.ts` — register `search_sections`. Zod input:
  ```ts
  export const SearchSectionsArgs = z.object({
    query: z.string(),
    limit: z.number().int().positive().max(50).default(10),
    vaults: z.array(z.string()).optional(),
    // Mirrors the additive search_hybrid params from slice 03-05 — same defaults, same behavior.
    recency_weight: z.number().min(0).optional().default(0),
    authority_weight: z.number().min(0).optional().default(0),
    include_superseded: z.boolean().optional().default(false),
  });
  ```
  Per RESEARCH §3 "Open questions for the planner" — yes, accept the rescore params; the underlying `hybridSearch` already does the rescore so the promoted section score is post-rescore.
- `src/server.ts` — handler dispatch mirroring 03-02's pattern.

## Approach

**Composition algorithm (per RESEARCH §3 option 3):**

```ts
export async function searchSections(deps, args: SearchSectionsArgs): Promise<SearchSectionsResult> {
  // 1. Inflate topK to cover enough sections (a section may have 1..N chunks; 5x is a safe cushion).
  const chunkHits = await deps.hybridSearch({
    query: args.query,
    topK: args.limit * 5,
    vaults: args.vaults,
    recencyWeight: args.recency_weight,
    authorityWeight: args.authority_weight,
    includeSuperseded: args.include_superseded,
  });

  // 2. Promote each chunk hit to its enclosing section. Dedup by (note_id, section_anchor).
  const sectionMap = new Map<string /* `${noteId}#${anchor}` */, SectionHit>();
  for (const hit of chunkHits) {
    const section = deps.sectionsByVaultByChunk(hit.vaultName, hit.chunkId);
    if (!section) continue;
    const key = `${section.note_id}#${section.anchor}`;
    const existing = sectionMap.get(key);
    const score = hit.score; // post-rescore by 03-05
    if (!existing || score > existing.score) {
      sectionMap.set(key, buildSectionHit({ section, chunkHit: hit, score, ...deps }));
    }
  }

  // 3. Sort by score DESC, tie-break by chunk_id_first ASC, slice to limit.
  return [...sectionMap.values()]
    .sort((a, b) => b.score - a.score || a._tiebreak_chunk_id - b._tiebreak_chunk_id)
    .slice(0, args.limit);
}
```

**Section hit shape:**

```ts
interface SectionHit {
  doc_id: DocId;
  source_handle: SourceHandle;
  title: string;
  heading_path: string[];        // non-empty (section-level packet)
  anchor: string;                // section's content-hash anchor
  mtime: number;
  hash: string;
  display_url: string;
  score: number;
  snippet?: string;              // optional: from the highest-scoring chunk
  chunk_ids: string[];           // every chunk in this section that scored (post-de-dup)
  status?: string;               // if doc has properties.status
  superseded_by?: string;
}
```

**Aggregation function: max** (over sum) per RESEARCH §3 rationale: RRF scores encode rank position; summing punishes short sections. Max gives "the section's best chunk's score" — the natural reading of "how relevant is this section."

**Tiebreak:** equal scores sort by `min(chunk_id_first)` ascending — earlier sections in document order win.

**Edge cases:**
- Orphan chunks (`findContainingChunk` returns `null`) are silently dropped. This can happen for legacy chunks indexed before migration 010 if the user has not yet re-indexed.
- Sections with chunks across multiple chunk hits collapse into one section hit; `chunk_ids` lists every contributing chunk in the result (not just the max-scoring one).
- `include_superseded: false` (default) filters at the chunk level (handled inside `hybridSearch` per 03-05). Sections whose ALL chunks were filtered out don't appear; sections with at least one surviving chunk do.

**Adapter-seam discipline:** same as 03-02 — no fs/path/gray-matter imports.

**No new SQL queries needed** — `findContainingChunk` lives in `SectionsQueries` (created in 03-01) and uses the `sections_chunk_range` index.

## Tasks

1. **`searchSections` implementation** in `src/assembly/search-sections.ts`. (~150 LOC)
2. **Tool registration in `src/tool-registry.ts`** with full Zod schema including the three additive params from 03-05. (~30 LOC)
3. **Server handler** dispatch in `src/server.ts`. (~30 LOC)
4. **Unit tests `src/assembly/search-sections.test.ts`** — 6 cases per the Files-to-create list, with `hybridSearch` mocked. (~200 LOC)
5. **Integration smoke** — extend `src/assembly/search-sections.test.ts` with one integration case that wires a real `hybridSearch` against an in-memory DB seeded with a few indexed notes; asserts section results are returned in expected order. (~80 LOC)

## Tests

- 6 unit cases + 1 integration case in `src/assembly/search-sections.test.ts`
- 1 conformance assertion lands in slice 03-07 ("`search_sections` promotes chunks to sections by max RRF on both adapters")

**Estimated new test cases:** 8–10.

## Acceptance criteria

- [ ] `search_sections` registered, listed, callable.
- [ ] Response = `SectionHit[]` with `heading_path` always non-empty.
- [ ] Score aggregation = max; tie-break = `chunk_id_first` ASC.
- [ ] Orphan chunks silently dropped; section count ≤ `limit`.
- [ ] Underlying `hybridSearch` is called exactly once with `topK = limit × 5`.
- [ ] `recency_weight` / `authority_weight` / `include_superseded` are wired through to `hybridSearch` (post-rescore section scores).
- [ ] All unit + integration tests pass; v1-baseline still green (this tool doesn't perturb existing tools).
- [ ] No fs/path/gray-matter/chokidar imports.

## Estimated effort

- **Tasks:** 5
- **Lines changed:** ~490 added across 2 new files + 2 modified files
- **PR shape:** one PR; depends on 03-01 merged. Independent of 03-02/03-04/03-06.

## Citations

- `src/search/hybrid.ts:153` — `hybridSearch()` entry point
- `src/search/hybrid.ts:210` — chunk hydration pattern (sections analog)
- 03-CONTEXT.md §"Claude's Discretion" `search_sections` ranking — option 3 picked
- 03-RESEARCH.md §3 — full composition algorithm + tiebreak rationale
