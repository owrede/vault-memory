# Slice 03-03 — Deviations

## 1. Worktree vs. main checkout (operational)

The agent prompt designated a sibling worktree at
`.claude/worktrees/agent-a798adf094acafd66` as the project root and
asked to "stay on the worktree's branch." In practice, that worktree
was based on commit `cbed220`, which is BEFORE slice 03-01 landed
(`d1bbdaf`); the worktree branch therefore did not contain the section
infrastructure this slice depends on (`src/sections/`, `SectionsQueries`,
migration 010).

Decision: execute on the main checkout (`/Users/wrede/Documents/GitHub/vault-memory`)
on branch `main`, where 03-01 IS shipped. All five commits land on `main`
directly. The work is correctly built on top of 03-01.

Sibling worktrees (`.claude/worktrees/agent-*`) are scratch spaces for
other agents and contain stale, locked state. `npm test` from the repo
root scans them by default (no `vitest.config.ts` filter is present);
their stale test files produce noise but are not part of CI (CI runs on
a clean checkout). To get a clean signal, run:

    npx vitest run --exclude "**/.claude/**"

## 2. Rescore params forwarded as placeholders (per plan)

The plan instructed: "params are placeholder until 03-05 merges; merge
order: 03-05 → 03-03 → resolve forwarding."

`search_sections` accepts `recency_weight`, `authority_weight`, and
`include_superseded` in:
  - the Zod input schema in `tool-registry.ts`,
  - the JSON-Schema literal in `TOOLS`,
  - the `SearchSectionsArgs` interface in `src/assembly/search-sections.ts`,
  - the server handler dispatch.

`hybridSearch` (per slice 03-05's not-yet-merged signature) will route
these into its authority/staleness rescore. Until then, the controller
accepts and ignores them. The Zod-validated arguments still flow into
`searchSections` unchanged — when 03-05 lands, a single change in the
server handler (extending the inner `hybridSearch` call to pass them
through) finishes the wiring.

Unit test `accepts rescore params on the args boundary (forward-compat
with 03-05)` pins this expectation; it asserts the controller does not
crash when the params are supplied.

## 3. SearchHit does NOT carry chunk_id

The plan's pseudo-code referenced `hit.chunkId`. `SearchHit` (defined in
`src/types.ts:208`) carries `chunkIdx` (per-note 0-based ordinal), not
the absolute `chunks.id` row key. The promotion step therefore takes the
indirection through the injected `sectionForHit(vaultName, notePath,
chunkIdx)` resolver, which does:

    notes.getByPath(notePath).id → chunks.getByNote(noteId).find(idx)
        → sections.findContainingChunk(noteId, chunkId)

This keeps the resolver pluggable for tests (no SearchHit shape change
required, no `searchHybrid` contract change, no migration). The cost is
one extra `chunks.getByNote` call per chunk hit; with `topK = limit × 5`
and `limit ≤ 50` that is at most 250 lookups per query, each a single
SQLite index hit. Acceptable.

If, in a later phase, profiling shows this is a bottleneck, the
optimization is to expose `chunkId` on `SearchHit` (additive D-08-style
change) and pass it through `findContainingChunk` directly. Not needed
for v2.0.0.

## 4. Preamble sections (level 0) dropped from results

The plan acceptance says "heading_path always non-empty." A preamble
section (level 0, empty heading_path) covers content that precedes any
heading in a note. Returning a preamble would violate the acceptance —
a citation with an empty heading_path renders as "the section at the
top of <note>" with no anchor a user can navigate to.

The controller filters preamble sections at the promote step. A chunk
in the preamble is treated identically to an orphan: silently dropped.

Documented in the file header of `src/assembly/search-sections.ts` and
asserted by unit test `(f) every section hit carries non-empty
heading_path`.

## 5. readDocument throw → silent drop (recall-style)

When a hit's owning Document has been deleted between the index write
and the search-sections call (a stale index pointer), `readDocument`
throws. The controller catches and silently drops the hit, matching
recall's behavior in `src/memory/tools/recall.ts:198`.

Consequence: the result count may dip below `limit` in this edge case.
We accept this rather than re-running with a larger inflation factor;
stale rows are an indexing-loop issue best fixed by watcher catch-up,
not by search-time retry.

## 6. tools-list snapshot regenerated, length assertions bumped 26 → 27

The pinned `evals/v1-baseline/tools-list.snapshot.json` and four
`expect(TOOLS).toHaveLength(...)` assertions were updated:

| File                              | Old | New |
|-----------------------------------|-----|-----|
| `src/tool-registry.test.ts`       | 26  | 27  |
| `src/server.test.ts` (3 sites)    | 26  | 27  |
| `evals/v1-baseline/baseline.test.ts` | 26  | 27  |
| `evals/v1-baseline/tools-list.snapshot.json` | (24 entries) | (25 entries) |

The 23 v1 baseline tool names are still in slots 0–22 and remain
byte-identical (`preserves the 23 v1 baseline tool names byte-identical`
test still passes).

## 7. Pre-existing dirty working tree on entry

The main checkout had uncommitted edits to `src/types.ts`,
`src/db/queries/fts.ts`, `AGENTS.md`, `.planning/config.json`,
`dist/cli.js`, `dist/cli.js.map` when this slice started. These are
in-flight work from slices 03-05 (and miscellaneous chores); not part of
03-03. All commits in this slice stage only files this slice touches.
The pre-existing diffs are left untouched.

The pre-existing `src/types.ts` change happens to violate adapter-seam
invariant I-5b (a stray `obsidian://` literal in a comment); this is
NOT caused by 03-03 and is left for the 03-05 author to clean up.
`scripts/lint-adapters.sh` is green when those uncommitted changes are
not applied.
