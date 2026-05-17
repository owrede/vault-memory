---
phase: 03-bundles-authority-staleness
plan: 02
subsystem: assembly/get-outline
tags: [assembly, get-outline, mcp-tool, doc-tree, citation-packet, ASM-02, ASM-05]
requirements: [ASM-02, ASM-05]
dependency_graph:
  requires:
    - 03-01 # sections substrate (SectionsQueries, migration 010, anchor algorithm)
  provides:
    - src/assembly/* # module skeleton that 03-03 / 03-04 / 03-06 extend
    - OutlineNode # canonical D-02 shape consumed by future bundle tools
    - DocNotFoundError # tagged error class reusable by future assembly tools
    - errorResponseJson # structured isError payload helper in server.ts
  affects:
    - src/server.ts # +1 handler entry, +1 import, +1 catch-block branch, +1 helper
    - src/tool-registry.ts # +1 TOOLS row, +1 TOOL_SCHEMAS entry
    - evals/v1-baseline/tools-list.snapshot.json # additive (26 → 27)
tech_stack:
  added: []
  patterns:
    - parent-pointer-tree-reconstruction
    - injected-dependencies (manager + sourceConnectorFor)
    - adapter-seam-discipline (assembly layer touches no fs/path)
    - dual-export-tool-registration (TOOLS + TOOL_SCHEMAS)
    - tagged-error-class-for-structured-mcp-payload
key_files:
  created:
    - src/assembly/index.ts # barrel
    - src/assembly/types.ts # OutlineNode, OutlineResult, GetOutlineArgs
    - src/assembly/outline.ts # getOutline controller + buildOutlineTree
    - src/assembly/outline.test.ts # 13 unit tests (6 plan cases + 7 error/packet)
  modified:
    - src/tool-registry.ts # register get_outline
    - src/server.ts # handler dispatch + DocNotFoundError catch branch
    - src/server.test.ts # bump 3 tool-count progress markers
    - src/tool-registry.test.ts # bump count assertion 26 → 27
    - evals/v1-baseline/baseline.test.ts # bump count assertion 26 → 27
    - evals/v1-baseline/tools-list.snapshot.json # regen (additive)
decisions:
  - "Document-level citation packet fields (title/mtime/hash/display_url) are sourced through the SourceConnector seam, not from the DB-cached note row. This stays aligned with `read_note` (Plan 01-03 Task 06) and means future Notion/Slack adapters automatically participate without an assembly-layer change."
  - "`chunk_ids` carries STRING values (e.g. `\"42\"`), not numbers, even though the underlying chunk-table FK is an integer. Reason: downstream connector-ecosystem code (the v1 `search` / `fetch` adapter) treats these as opaque tokens; keeping the string convention everywhere prevents quiet type-coercion bugs when consumers paste IDs through JSON-RPC."
  - "Range-resolution for `chunk_ids` filters from a single `chunks.getByNote()` read rather than running one SQL query per section. For v2-size docs (chunks per note ≤ low thousands, sections per note ≤ low hundreds) this is O(N + S·N) — well under a millisecond. A range-keyed SQL helper can be added later if profiling demands."
  - "`DocNotFoundError` is a dedicated `Error` subclass with a `doc_id` field; the registerTool catch branch pattern-matches `instanceof` and emits `{error:\"doc_not_found\", doc_id}` via a new `errorResponseJson` helper. Free-text errors still flow through the existing `errorResponse`. Result: callers can `JSON.parse(content[0].text).error === \"doc_not_found\"` to distinguish missing-doc from generic validation failure, and 03-04 / 03-06 (forthcoming) can throw the same error class without touching server.ts."
  - "An optional `vaults` filter was kept on the schema (even though the DocId already names a vault) because the v1 ecosystem's recall + search tools both accept a vaults filter — symmetry helps multi-tenant guards and exploratory tools that pre-bind the filter regardless of which subsequent tool they call. Filter mismatch returns DocNotFoundError, NOT a generic 'vault not allowed' message, because the caller asked about a specific doc by ID — the error is about that specific document not being reachable."
  - "Snapshot regenerated locally as drafted in plan §Acceptance criteria — 03-05 will confirm the cumulative Phase 3 snapshot diff is additive-only across all phase-3 slices."
metrics:
  duration: ~70m
  completed: 2026-05-16
  commits: 5
  tests_added: 13
  files_created: 4
  files_modified: 6
---

# Phase 03 Plan 02: `get_outline` MCP tool Summary

**One-liner:** Ships the `get_outline({doc_id})` MCP tool that returns a nested
`OutlineNode` tree built from the 03-01 sections substrate, plus the
`src/assembly/` module skeleton (barrel + types + dependency-injection scaffolding)
that 03-03 (`get_bundle`), 03-04 (`dossier`), and 03-06 (authority/staleness)
will extend.

## Outcome

A new MCP tool, `get_outline`, is registered, callable, and pinned by 13 unit
tests:

| Input | Output |
| --- | --- |
| Valid DocId of an indexed doc | `{ doc_id, source_handle, title, root: OutlineNode[], mtime, hash, display_url }` |
| Malformed DocId / unknown vault / missing note / unread doc / `vaults` filter mismatch | `isError:true` with JSON body `{error:"doc_not_found", doc_id}` |

`OutlineNode` exactly matches D-02:
`{ anchor, heading_path, heading_text, level, chunk_ids: string[], children: OutlineNode[] }`.

The doc-level packet fields are sourced through the same `SourceConnector` seam as
`read_note` and `recall`, so a future non-Obsidian adapter automatically participates
in `get_outline` without an assembly-layer code change.

## Files changed

Created (4):

- `src/assembly/index.ts` — barrel re-exports `OutlineNode`, `OutlineResult`,
  `GetOutlineArgs`, `getOutline`, `GetOutlineDeps`. 03-03 / 03-04 / 03-06 will
  extend this barrel additively.
- `src/assembly/types.ts` — D-02 `OutlineNode`, response shape `OutlineResult`,
  Zod-input mirror `GetOutlineArgs`.
- `src/assembly/outline.ts` — `getOutline(deps, args)` controller; pure
  `buildOutlineTree(rows, allChunks)` exported for tests; `DocNotFoundError`
  tagged error class.
- `src/assembly/outline.test.ts` — 13 unit tests (6 plan-mandated shapes + 7
  error/packet cases).

Modified (6):

- `src/tool-registry.ts` — TOOLS literal + TOOL_SCHEMAS Zod shape for
  `get_outline`. Mirrors the v1 dual-export pattern.
- `src/server.ts` — handler dispatch (15 lines), import, registerTool catch
  branch for `DocNotFoundError`, and the new `errorResponseJson` helper.
- `src/server.test.ts` — bumped three plan-progress-marker count assertions
  from 26 → 27 with updated narrative comments.
- `src/tool-registry.test.ts` — `TOOLS.toHaveLength(26)` → `(27)`.
- `evals/v1-baseline/baseline.test.ts` — same count bump; the 23-v1 byte-identity
  slice test still holds (`get_outline` is appended at index 26).
- `evals/v1-baseline/tools-list.snapshot.json` — regenerated via
  `npm run eval:snapshot` (additive: one new tool entry at the tail).

## Tests added

13 unit tests in `src/assembly/outline.test.ts`:

| # | Case | Pins |
| --- | --- | --- |
| 1 | `buildOutlineTree([],[])` | Empty input → empty tree |
| 2 | (a) flat doc, 3 root sections | All 3 at root, no children, level 1 |
| 3 | (b) H1>H2>H2 | Root has 1 node with 2 children |
| 4 | (c) H1>H2>H3 | Three-level tree, deep `heading_path` |
| 5 | (d) level-0 preamble | Empty `heading_text`, `heading_path: []` |
| 6 | (e) doc with no sections | `root: []`, doc-level packet still populated |
| 7 | (f) chunk_id range resolution | Two sections with valid ranges + one NULL range → `[]` |
| 8 | Malformed DocId | `DocNotFoundError` |
| 9 | Unknown vault | `DocNotFoundError` |
| 10 | Missing note row | `DocNotFoundError` |
| 11 | Source seam read failure | `DocNotFoundError` |
| 12 | `vaults` filter mismatch | `DocNotFoundError` |
| 13 | Full citation packet propagation | `doc_id`, `source_handle`, `title`, `mtime`, `hash`, `display_url` all populated from the `Document` read |

The conformance assertion ("`get_outline` returns nested tree with anchors on both
obsidian-fs and stub adapters") is deferred to slice 03-07 per the plan.

## Test results

| Gate | Result |
| --- | --- |
| `npx vitest run` | **973 passed**, 11 skipped (pre-existing), 0 failed |
| `npx vitest run src/assembly/outline.test.ts` | 13 passed |
| `npx tsc --noEmit` | Clean, no errors |
| `bash scripts/lint-adapters.sh` | All 8 invariants green (I-1..I-6, I-5b, C-1) |
| `npm run eval:baseline` | 30 passed, 11 skipped, including the regenerated tools-list snapshot |

## Deviations

Two deviations, both Rule 3 (blocking issue auto-fix). See
`03-02-DEVIATIONS.md` for the full rationale.

1. **Stale worktree** — The agent's worktree branch was created from a v1.0.0-era
   commit (`cbed220`) that predated Phase 2 and 03-01. Fast-forwarded the
   `worktree-agent-aec993f2b49fee40e` branch onto `main` (FF-only, zero conflicts,
   no history rewrite, branch attachment preserved per the pre-commit allow-list
   invariant). Installed deps fresh with `npm ci`.
2. **Stray writes to main repo** — Initial `Write` calls used absolute paths under
   `/Users/wrede/Documents/GitHub/vault-memory/src/assembly/`, which resolve to the
   main repo checkout, not the worktree (the `#3099` cwd-drift class). Removed the
   two stray untracked files from the main repo and re-wrote them under the
   worktree absolute path. All subsequent writes go to the worktree path.

## Citations

- Plan: `.planning/phases/03-bundles-authority-staleness/03-02-PLAN.md`
- Phase context: `03-CONTEXT.md` D-02 (OutlineNode shape), §specifics (level-0 preamble convention)
- 03-01 substrate: `src/sections/` + `src/db/queries/sections.ts` + migration 010
- Exemplar L3 tool: `src/memory/tools/recall.ts`
- Citation packet: `src/memory/citation-packet.ts` (`toCitationPacket`, `displayUrlFor`)
- DocId helpers: `src/adapters/registry.ts` (`decomposeDocId`, `parseDocId`, `parseSourceHandle`)
- Tool-registration pattern: `src/tool-registry.ts:1-50` (TOOLS + TOOL_SCHEMAS dual export)
- Error response wiring: `src/server.ts` registerTool catch block (now branches on `DocNotFoundError`)
- Test fixture pattern: `src/db/queries/sections.test.ts` (seed-via-insertMany)

## Self-Check

- [x] `src/assembly/index.ts` exists
- [x] `src/assembly/types.ts` exists
- [x] `src/assembly/outline.ts` exists
- [x] `src/assembly/outline.test.ts` exists (13 tests pass)
- [x] `src/tool-registry.ts` includes `get_outline` (TOOLS + TOOL_SCHEMAS)
- [x] `src/server.ts` includes `get_outline` handler dispatch
- [x] Commits exist: `84376df`, `5d5d45e`, `6290d7f`, `4e9f994`, `c3a336a`
- [x] All 8 adapter-seam invariants green
- [x] `npm run eval:baseline` passes
- [x] Full `npx vitest run` 973 passed / 11 skipped / 0 failed
