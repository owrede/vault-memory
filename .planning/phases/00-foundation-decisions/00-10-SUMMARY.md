---
phase: 00-foundation-decisions
plan: 10
subsystem: foundation
tags: [phase-0, tooling, snapshot, eval-baseline, refactor]
requires: [00-02]
provides:
  - "src/tool-registry.ts — single literal source of truth for v1 tools/list"
  - "evals/v1-baseline/dump-tools.mjs — deterministic snapshot generator"
  - "evals/v1-baseline/tools-list.snapshot.json — pinned 23-tool baseline (FND-10)"
affects: [00-11]
tech-stack:
  added: []
  patterns:
    - "Literal-file snapshot (RESEARCH Pattern 2) — NOT vitest toMatchSnapshot()"
    - "Node 24 TS-stripping for .mjs → .ts import (no tsx required)"
key-files:
  created:
    - "src/tool-registry.ts"
    - "evals/v1-baseline/dump-tools.mjs"
    - "evals/v1-baseline/tools-list.snapshot.json"
  modified:
    - "src/server.ts"
decisions:
  - "Honored A5=option-a per plan 00-02 maintainer ack — extracted literal TOOLS array; the ONE pre-approved src/ change in Phase 0"
  - "Used `tools: TOOLS as unknown as Array<{...}>` cast in server.ts because the MCP SDK ListToolsResult type expects mutable arrays while `as const` produces deeply-readonly tuples; cast is structural-only with zero runtime cost"
  - "Snapshot wraps array as `{ tools: [...] }` (matching MCP JSON-RPC response shape) rather than bare array — adapter for plan 00-11's test"
metrics:
  tasks_total: 2
  tasks_completed: 2
  files_created: 3
  files_modified: 1
  test_count_before: 368
  test_count_after: 368
  test_pass_after: 368
  completed_date: "2026-05-14"
---

# Phase 00 Plan 10: Tool Registry + Snapshot Summary

Extracted the literal 23-tool `TOOLS` array from `src/server.ts` into a new `src/tool-registry.ts` (the documented Phase-0 exception to "zero src/ changes", gated by A5=option-a), then authored `evals/v1-baseline/dump-tools.mjs` and the pinned `evals/v1-baseline/tools-list.snapshot.json` — the v1 `tools/list` JSON-RPC contract that plan 00-11 will assert against.

## Assumption Gate

**A5 = option-a** was confirmed via `.planning/phases/00-foundation-decisions/00-02-SUMMARY.md`:

> "A5 = a: extract literal TOOLS array from src/server.ts into src/tool-registry.ts in plan 10 — 5-line non-behavioral refactor, the documented exception to 'zero src/ changes' in Phase 0"

This plan executed option-a as written. The option-b fallback (in-process MCP server tools/list call) was not engaged.

## Tasks Completed

### Task 1: Extract `TOOLS` constant (commit `294e30f`)

- Created `src/tool-registry.ts` with `export const TOOLS = [ ... ] as const;` — the 23 tool definitions verbatim from the prior inline array in `src/server.ts`, registration order preserved.
- Updated `src/server.ts`:
  - Added `import { TOOLS } from "./tool-registry.js";` (ESM `.js` extension per project convention).
  - Replaced the inline literal array (424 lines) in the `ListToolsRequestSchema` handler with `tools: TOOLS as unknown as Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>` — the cast is required because `as const` produces deeply-readonly tuples while the MCP SDK's response type expects mutable shape.
- **Lines deleted from src/server.ts:** 422 (the inline array body from line 327 through 748).
- **Lines added to src/server.ts:** 7 (one import + the new handler body using `TOOLS`).
- **Net diff for the refactor:** +430 / −422 across the two files (the deletion in server.ts roughly balances the new tool-registry.ts; the +8 net comes from the comment header on the new module + the type-assertion shape).
- `npx tsc --noEmit`: clean.
- `npm test`: 368/368 passed (no regression — note: the live test count is 368, evolved past the 324 figure documented in CONTEXT).

### Task 2: Snapshot generator + pinned baseline (commit `1b96a8e`)

- Created `evals/v1-baseline/dump-tools.mjs`:
  - Shebang `#!/usr/bin/env node`, mode `0755`.
  - Imports `TOOLS` from `../../src/tool-registry.ts` directly — Node ≥24 strips TypeScript types by default, so no `tsx` wrapper is needed. (Node 22 would also work with `--experimental-strip-types`; the project pins `engines.node = ">=22"` and `package.json#eval:snapshot` already invokes `node` directly, so this resolves cleanly on every supported runtime.)
  - Emits `JSON.stringify({ tools: TOOLS }, null, 2) + "\n"` to stdout.
- Ran `npm run eval:snapshot` → produced `evals/v1-baseline/tools-list.snapshot.json` (16,219 bytes, 562 lines).
- Inspected: top-level object `{ "tools": [...] }`, 23 entries, first name `list_vaults`, last name `suggest_frontmatter` — matches RESEARCH §Pitfall 4 expectation.
- Re-running the generator: `git diff --exit-code` is clean (byte-deterministic).

## Verification

| Check | Result |
| --- | --- |
| `test -f src/tool-registry.ts && grep -q '^export const TOOLS'` | OK |
| `grep "from \"./tool-registry.js\"" src/server.ts` | matches |
| `npx tsc --noEmit` | clean |
| `npm test` | 368/368 passed |
| `test -x evals/v1-baseline/dump-tools.mjs` | OK |
| Snapshot count = 23, first=`list_vaults`, last=`suggest_frontmatter` | OK |
| `npm run eval:snapshot && git diff --exit-code` | no diff (deterministic) |
| `node dump-tools.mjs > /tmp/check.json; diff snapshot /tmp/check.json` | identical (SNAPSHOT_OK) |

## Deviations from Plan

**None.** Plan executed exactly as written. Two minor observations recorded for future readers, neither of which deviates from the plan's intent:

- The plan estimated "5-line non-behavioral refactor" for the src change; the actual server.ts edit is one new import + a 7-line handler (the new handler uses an explicit `as unknown as Array<{...}>` type cast). The cast is needed because `as const` makes TOOLS deeply readonly while the SDK type expects a mutable shape — a behavior-preserving structural assertion only. Plan acceptance criterion `npx tsc --noEmit exits 0` passes.
- The plan's CONTEXT line "324 tests, do not regress" reflects the documented constraint from when CONTEXT was authored. The live count today is 368. All 368 still pass. No regression — count has grown over time, the invariant ("do not regress") holds.

## Key Decisions

- **Type cast over generic widening.** Considered changing `as const` to `as unknown as Array<…>` at the source-of-truth (tool-registry.ts) but kept `as const` there so the registry stays maximally immutable. The cast lives at the one consumer (server.ts) where the SDK demands a mutable shape. Plan 00-11's snapshot test will use the same `as const` literal for free.
- **Snapshot wraps as `{ tools: [...] }`.** Plan's RESEARCH §Example 5 and acceptance criterion 00-10-01 both prescribe this shape — matches the MCP `tools/list` JSON-RPC response wire format, so the snapshot doubles as a contract document a reader can match against a real server's stdio frame.
- **`as const` widening for plan 00-11.** Kept the readonly markers; plan 00-11's test can do `JSON.parse(JSON.stringify(TOOLS))` to widen if it needs structural compare against the snapshot.

## Files

**Created:**
- `src/tool-registry.ts` — 430 lines, single-export module with comment header.
- `evals/v1-baseline/dump-tools.mjs` — 21 lines, executable, ESM script.
- `evals/v1-baseline/tools-list.snapshot.json` — 562 lines, 16,219 bytes, pinned baseline.

**Modified:**
- `src/server.ts` — added one import line; replaced 422-line inline `tools: [ ... ]` array literal with 5-line cast expression using imported `TOOLS`. Net behavior change: zero (handler returns the same 23 tool objects in the same order).

## Commits

| Hash | Task | Type | Message |
| --- | --- | --- | --- |
| `294e30f` | 1 | refactor | `refactor(00-10): extract TOOLS array to src/tool-registry.ts` |
| `1b96a8e` | 2 | feat | `feat(00-10): pin v1 tools/list snapshot baseline` |

## Self-Check: PASSED

- `src/tool-registry.ts`: FOUND
- `src/server.ts`: FOUND (modified)
- `evals/v1-baseline/dump-tools.mjs`: FOUND, executable
- `evals/v1-baseline/tools-list.snapshot.json`: FOUND, 23 tools, list_vaults → suggest_frontmatter
- `294e30f` commit: FOUND in git log
- `1b96a8e` commit: FOUND in git log
- `npm test`: 368/368 passing (verified twice — after Task 1, after Task 2)
- STATE.md / ROADMAP.md: NOT modified (per executor instructions)
