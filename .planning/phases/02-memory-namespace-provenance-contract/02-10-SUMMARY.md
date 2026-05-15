---
phase: 02-memory-namespace-provenance-contract
plan: 10
subsystem: memory-sink-safety
tags: [gap-closure, CR-02, WR-06, sentinel, provisioning]
gap_closure: true
resolves: [CR-02, WR-06]
requirements: [MEM-05, MEM-06]
wave: 10
depends_on: [02-08, 02-13]
dependency_graph:
  requires:
    - src/adapters/delivery/types.ts (WriteConflict.reason "sentinel_check_failed" literal, added by Plan 02-13 in wave 9)
  provides:
    - tightened isExpectedSinkContent (no .md pass-through; CR-02 closed)
    - SinkSentinelCheckError + errno-aware assertSentinelExists (WR-06 closed)
    - preflight() consumes sentinel_check_failed literal
  affects:
    - any caller relying on the previous lenient .md absorption behavior (none in production paths)
tech_stack:
  added: []
  patterns:
    - errno discrimination via instanceof on a typed wrapper error (SinkSentinelCheckError)
    - consume-not-declare protocol for cross-wave parallel union members
key_files:
  created: []
  modified:
    - src/adapters/delivery/obsidian-fs/sentinel.ts
    - src/adapters/delivery/obsidian-fs/sentinel.test.ts
    - src/adapters/delivery/obsidian-fs/index.ts
key_decisions:
  - 'Removed .md pass-through entirely (vs. allow-list per filename) — narrowest safe surface; matches plan and ADR-004 intent.'
  - 'Wrapped non-ENOENT errors in SinkSentinelCheckError rather than rethrowing raw — keeps the seam typed and lets preflight branch with `instanceof` instead of duck-typing on `code`.'
  - 'Combined Task 1 + Task 2 implementations into a single GREEN commit (one RED + one GREEN) because both share sentinel.ts and the same eval gate — splitting would leave the test suite red between commits and harm bisect.'
metrics:
  duration: '~5 min wall'
  completed: 2026-05-15T23:03:01Z
  files_touched: 3
  tests_added: 8
  tests_passing_total: 876
---

# Phase 02 Plan 10: Sentinel Safety (CR-02 + WR-06) Summary

Closes two safety findings against the memory-sink sentinel mechanics: `provisionSink` no longer silently absorbs user `.md` files (CR-02), and `assertSentinelExists` no longer collapses every filesystem error to "sentinel missing" (WR-06). Consumes the `sentinel_check_failed` literal that Plan 02-13 added to the `WriteConflict.reason` union in wave 9.

## Fixture-Layout Audit (Task 1 Step 1 — blocking gate before tightening)

`ls evals/fixtures/v2-test-vault/_memory/` at base commit `d4f1882`:

```
.memory-sink
_briefs/
observations/
status-updates/
```

`find ... -maxdepth 1 -name "*.md"` → **zero matches**. The fixture is clean — all `.md` files live under the three known sink subfolders. Safe to tighten `isExpectedSinkContent` without breaking the eval suite.

The pre- and post-change `npm run eval:baseline` both report **30 passed + 11 todo**.

## What Changed

### CR-02 — `provisionSink` refuses populated folders

`src/adapters/delivery/obsidian-fs/sentinel.ts`:

- `isExpectedSinkContent` dropped the `entry.endsWith(".md")` clause. The allow-list is now strictly: the sentinel file plus the three known subfolders (`observations`, `_briefs`, `status-updates`).
- The file-header `Provisioning policy` doc-comment was rewritten to match the tightened rule (no `.md` in the allow-list).
- A `[[memory_sinks]]` handle pointed at a folder with a `daily-note.md` (or any other `.md` at the root) now trips `SinkProvisioningError` with `code === "SINK_PROVISION_UNSAFE"` and the offending filename in `offendingEntries`.

### WR-06 — Sentinel-check errors distinguish ENOENT from other errno codes

`src/adapters/delivery/obsidian-fs/sentinel.ts`:

- New exported class `SinkSentinelCheckError` carrying `(sinkName, underlyingCode, message)` and `code === "SINK_SENTINEL_CHECK_FAILED"`.
- `assertSentinelExists` now branches: ENOENT → `false`; any other errno → throw `SinkSentinelCheckError` wrapping the original errno.

`src/adapters/delivery/obsidian-fs/index.ts`:

- Imports `SinkSentinelCheckError`.
- `ObsidianFsDelivery.preflight()` wraps `assertSentinelExists` in `try/catch`. On `SinkSentinelCheckError`, returns `{ ok:false, reason:"sentinel_check_failed", sinkName, message, suggestion: "Check filesystem permissions / disk health for {vault}/{relPath}. Underlying errno: {code}." }`. This **consumes** the `sentinel_check_failed` literal added to the `WriteConflict.reason` union by Plan 02-13 Task 1 in wave 9; **`src/adapters/delivery/types.ts` is not modified by this plan**.

### Tests

`src/adapters/delivery/obsidian-fs/sentinel.test.ts` grew from 9 → 15 tests. New cases:

CR-02:
- `writes the sentinel when the folder only contains the three known sink subfolders` (positive control — known-subfolder-only allow-list).
- `refuses to absorb folder with plain .md files (CR-02)` (the negative test the plan named explicitly).
- `refuses to absorb folder with README.md (CR-02 — multiple plain .md files)`.
- `refuses to absorb folder with a mix of plain .md and known subfolders` (asserts `offendingEntries` includes only the foreign `.md` and not the legitimate `observations` folder).
- `is a no-op when only the sentinel file is present (idempotent — positive control)`.

WR-06 (uses `vi.spyOn(fsp, "access")` to mock errno):
- `returns false when fs.access throws ENOENT (sentinel literally absent)`.
- `rejects with SinkSentinelCheckError when fs.access throws EACCES (permission denied)` (asserts `underlyingCode === "EACCES"`, `sinkName === "default"`, `code === "SINK_SENTINEL_CHECK_FAILED"`).
- `rejects with SinkSentinelCheckError when fs.access throws EIO (disk error)`.

The pre-existing test `writes the sentinel when the folder only contains expected sink content` was rewritten to use the three known subfolders only (instead of `observations/` + an `.md` file) — under the tightened policy the original test would have absorbed the `.md`, which is the CR-02 anti-pattern.

## Commits

| Hash      | Type | Subject                                                                    |
| --------- | ---- | -------------------------------------------------------------------------- |
| `29cb8a8` | test | add failing tests for CR-02 + WR-06 sentinel safety                        |
| `f4896fa` | fix  | tighten sink provisioning + distinguish sentinel errno codes (CR-02 + WR-06) |

Single combined GREEN commit chosen over split-per-task to keep the test suite green at every point in history. Both findings share `sentinel.ts`, share a single RED test commit, and share the same eval gate; a split would leave the suite red between intermediate commits.

## Verification Results

| Gate                                                          | Result                            |
| ------------------------------------------------------------- | --------------------------------- |
| `npx vitest run sentinel.test.ts`                             | 15/15 pass                        |
| `npx vitest run src/adapters/delivery/`                       | 118/118 pass                      |
| `npx vitest run` (full project)                               | 876 pass + 11 todo (0 failures)   |
| `npx tsc --noEmit`                                            | clean                             |
| `bash scripts/lint-adapters.sh`                               | I-1..I-6, I-5b, C-1 all green     |
| **`npm run eval:baseline` (BLOCKING)**                        | **30 pass + 11 todo, no regression** |
| `grep -n 'endsWith(".md")' .../sentinel.ts`                   | zero matches (good)               |
| `grep -nE "SinkSentinelCheckError" .../sentinel.ts`           | 4 matches (declaration + throw + docs) |
| `grep -nE "sentinel_check_failed" .../index.ts`               | 2 matches (preflight + comment)   |
| `git diff --name-only HEAD~2 -- src/adapters/delivery/types.ts` | empty (good — types.ts unchanged by this plan) |

## Deviations from Plan

None — plan executed exactly as written. The conditional STOP gate (Task 1 Step 1 fixture audit) returned a clean fixture, so the rest of the plan proceeded.

## Acceptance Criteria

- [x] `grep -n 'endsWith(".md")' src/adapters/delivery/obsidian-fs/sentinel.ts` returns zero matches.
- [x] `npx vitest run --no-coverage src/adapters/delivery/obsidian-fs/sentinel.test.ts` reports ≥ 6 passing tests (15 passing).
- [x] BLOCKING eval gate: `npm run eval:baseline` reports 30/30 + 11 todos.
- [x] `npx tsc --noEmit` clean.
- [x] `grep -nE "SinkSentinelCheckError" src/adapters/delivery/obsidian-fs/sentinel.ts` ≥ 2 matches.
- [x] `grep -nE "sentinel_check_failed" src/adapters/delivery/obsidian-fs/index.ts` ≥ 1 match.
- [x] `src/adapters/delivery/types.ts` unchanged by this plan.
- [x] All sentinel.test.ts tests pass for both ENOENT and EACCES cases.
- [x] `npm test` reports 825+ passes with zero regressions (actual: 876 + 11 todo).

## Threat Flags

None. This plan tightens an existing surface; it does not introduce new network endpoints, auth paths, or trust boundaries.

## Known Stubs

None.

## Self-Check: PASSED

- File `src/adapters/delivery/obsidian-fs/sentinel.ts`: FOUND, modified
- File `src/adapters/delivery/obsidian-fs/sentinel.test.ts`: FOUND, modified
- File `src/adapters/delivery/obsidian-fs/index.ts`: FOUND, modified
- File `src/adapters/delivery/types.ts`: unchanged (verified via `git diff --name-only`)
- Commit `29cb8a8` (test): FOUND in `git log`
- Commit `f4896fa` (fix): FOUND in `git log`
- Eval gate `npm run eval:baseline`: 30 passed + 11 todo (verified twice — pre-change and post-change)
