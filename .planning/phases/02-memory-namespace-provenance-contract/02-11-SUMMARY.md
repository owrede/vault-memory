---
phase: 02-memory-namespace-provenance-contract
plan: 11
subsystem: adapters/delivery/obsidian-fs
tags: [gap-closure, CR-03, path-helpers, cross-platform, seam-discipline, mem-05, mem-06]
gap_closure: true
resolves: [CR-03]
requirements: [MEM-05, MEM-06]
dependency-graph:
  requires:
    - 02-02 (MemorySinkHandle / resolveToRelativePath, forward-slash by parser)
    - 02-08 (findSinkContaining + path helpers seam)
    - adapters/registry.ts (formatDocId / decomposeDocId; DOC_ID_PATTERN forward-slash invariant)
  provides:
    - joinVaultPathPosix — forward-slash POSIX join for vault-relative paths used in comparisons or SQL LIKE prefixes
    - vaultRelativeInSink — forward-slash form of <sink.resolveToRelativePath><relativeSubpath> for DocId-resource comparison
    - Documented split between FS-bound (OS-native) and comparison-bound (forward-slash) helpers
  affects:
    - Future Windows-portable consumers of findSinkContaining, lastMemoryWriteAtForPathPrefix SQL LIKE, recall's notePath.startsWith
    - Plan 02-14 (WR-08) will adopt vaultRelativeInSink for audit-row stamping paths
tech-stack:
  added: []
  patterns:
    - Helper-by-consumer-category split (FS-bound vs comparison-bound) — TSDoc locks the contract
    - Defensive backslash normalization on comparison helpers, even when upstream parsers already refuse them
key-files:
  created: []
  modified:
    - src/adapters/delivery/obsidian-fs/path.ts (+76 -14, 2 new exports; node:path access remains confined per ADR-002 I-2)
    - src/adapters/delivery/obsidian-fs/path.test.ts (+106 -11, 11 new tests covering new helpers + DocId round-trip)
decisions:
  - Kept the existing names joinVaultPath / pathInSink (no rename) — they are FS-bound and existing call sites are correct. Added two new exports for comparison-bound paths. Avoids a churn rename that would have touched every existing caller.
  - Chose backslash NORMALIZATION over rejection in joinVaultPathPosix / vaultRelativeInSink. Recommended in the plan; less surprising for callers and locks the forward-slash invariant on output even if a future caller smuggles a backslash in.
  - path.posix.join preserves the trailing slash for single-segment input (verified via `node -e`). vaultRelativeInSink(sink) (no subpath) therefore returns "_memory/" — load-bearing for findSinkContaining's prefix-match semantics where the trailing slash distinguishes "_memory/" from "_memory-staging/".
  - The interface SinkLike { resolveToRelativePath } stays local to path.ts (not Pick<MemorySink>) so this gap-closure plan does not entangle with the broader MemorySink shape; structural typing handles compatibility.
metrics:
  duration: 13 minutes
  completed: 2026-05-16
---

# Phase 02 Plan 11: Split path helpers into FS-bound and comparison-bound Summary

Closed CR-03 (critical) by splitting the obsidian-fs path helpers along consumer category: FS-bound helpers (`joinVaultPath`, `pathInSink`) retain OS-native separators for `fs.*` calls; new comparison-bound helpers (`joinVaultPathPosix`, `vaultRelativeInSink`) always emit forward-slash regardless of `process.platform`, locking the Phase 2 safety chain against silent Guard B no-ops on Windows.

## Objective Recap

`joinVaultPath` and `pathInSink` wrap `node:path.join`, which emits backslashes on Windows. Downstream comparisons in `findSinkContaining`, `lastMemoryWriteAtForPathPrefix` (SQL `LIKE '_memory/%'`), `countByPathPrefix`, `recall`'s `notePath.startsWith`, and the auto-discovery probe all assume forward-slash. The DocId resource is always forward-slash (`DOC_ID_PATTERN`), and `notes.path` storage is forward-slash by indexer convention. On Windows this mismatch silently turns the Phase 2 guard chain into a no-op.

The fix lives at the seam — `path.ts` becomes the single point where vault-relative paths are minted, and ALWAYS emits forward-slash for any value compared against a DocId resource, a SQL `notes.path` row, or a `findSinkContaining` lookup. OS-native separators stay confined to absolute on-disk paths that FS calls actually consume.

## What Changed

### `src/adapters/delivery/obsidian-fs/path.ts`

Two new exports added, existing exports unchanged:

| Helper | Category | Separator | Purpose |
|---|---|---|---|
| `joinVaultPath(vaultRoot, relPath)` | FS-bound | OS-native | Absolute path for `fs.*` (unchanged) |
| `pathInSink(vaultAbsolutePath, sink, relativeSubpath?)` | FS-bound | OS-native | Absolute path inside a sink for `fs.*` (unchanged) |
| `joinVaultPathPosix(...segments)` | **NEW** comparison-bound | Forward-slash | Generic POSIX-join for DocId / SQL / registry-match callers |
| `vaultRelativeInSink(sink, relativeSubpath?)` | **NEW** comparison-bound | Forward-slash | `<sink.resolveToRelativePath><relativeSubpath>` for DocId-resource comparison |

The new helpers are pure `path.posix.join` plus defensive `normalizeToForwardSlash`. `node:path` access remains confined to this file (ADR-002 I-2 / lint-adapters.sh I-3 green).

Each helper carries explicit TSDoc documenting FS-bound vs comparison-bound and the consequences of using the wrong one — locked so future readers cannot accidentally pick the FS-bound helper for a comparison path.

### `src/adapters/delivery/obsidian-fs/path.test.ts`

11 new tests across 4 describe-blocks. Highlights:

- **Forward-slash invariant** — every comparison-bound output is byte-clean of `\\` regardless of input.
- **Backslash normalization** — caller-supplied `\\` in either the sink or the subpath is normalized to `/` on output.
- **Round-trip property test** (load-bearing): `vaultRelativeInSink(sink, subpath)` is byte-equal with the `resource` portion of `decomposeDocId(formatDocId("obsidian-fs", vault, rel))`. Proves the relative-form round-trips with the canonical DocId resource form — exactly what `findSinkContaining` consumes.
- **Prefix-match invariant** — `vaultRelativeInSink(sink, x).startsWith(sink.resolveToRelativePath)` is true, locking the contract that `findSinkContaining` relies on.

## Consumer Audit (Step 3 — for Windows CI follow-up)

Inventory of every existing `pathInSink` / `joinVaultPath` call site, categorized by usage:

| File | Helper | Line(s) | Category | Notes |
|---|---|---|---|---|
| `src/adapters/delivery/obsidian-fs/sentinel.ts` | `pathInSink` | 103, 104, 158 | **FS-bound** | Passes result to `fs.access` / `fs.writeFile` / `fs.readFile`. Correct — OS-native is fine. |
| `src/adapters/delivery/obsidian-fs/contract-yaml-read.ts` | `joinVaultPath` | 40 | **FS-bound** | Passes result to `readFile`. Correct — OS-native is fine. |

**Verdict:** No existing consumer uses the result for comparison or SQL. Every current call site is correctly FS-bound. The new comparison-bound helpers exist for **future** Windows-touching code (Plan 02-14 WR-08 audit-row stamping; any future code that constructs a vault-relative path to compare against a DocId resource or feed a SQL `LIKE` prefix).

`findSinkContaining` (`src/memory/registry.ts:190–202`) compares `resource.startsWith(sink.resolveToRelativePath)` — both sides are forward-slash by construction (`DOC_ID_PATTERN` regex + `MemorySinkHandle` parser hardened in 02-09). No call to `path.ts` helpers involved, so this consumer is already correct.

`recall.ts` `notePath.startsWith` (lines 168–174) compares `notes.path` rows (forward-slash by indexer convention) against `sink.resolveToRelativePath` (forward-slash by parser). No call to `path.ts` helpers involved.

The auto-discovery probe in `sentinel.ts` (lines 174–188) uses an explicit `/` literal, not a path helper.

## Why Not Switch the FS Helpers to `path.posix.join`?

`pathInSink` returns an ABSOLUTE path that goes into `fs.access` / `fs.readFile`. Windows `fs` accepts forward-slash absolute paths, but the convention is OS-native, and unit tests that assert containment of `\\` segments would break across OSes. The cleanest seam — and the variant recommended in 02-REVIEW.md — is to keep the FS path absolute + OS-native and add a parallel comparison helper that is relative + forward-slash. The split is the seam-level fix.

## Verification

- `npx vitest run --no-coverage src/adapters/delivery/obsidian-fs/path.test.ts` — 16/16 pass (5 existing + 11 new).
- `npx vitest run --no-coverage src/adapters/delivery/ src/memory/` — 226/226 pass.
- `bash scripts/lint-adapters.sh` — all 8 invariants green (I-3 `node:path` still confined to licensed dirs).
- `npx tsc --noEmit` — clean.
- `npm test` — **836 passing | 11 todo** (was 825+; +11 new path tests). Zero regressions.

## Acceptance Criteria — All Met

- [x] `grep -nE "path\.posix\.join" src/adapters/delivery/obsidian-fs/path.ts` → 1 match (in `joinVaultPathPosix`).
- [x] `grep -nE "vaultRelativeInSink|joinVaultPathPosix" src/adapters/delivery/obsidian-fs/path.ts` → both helpers exported.
- [x] `npx vitest run --no-coverage src/adapters/delivery/obsidian-fs/path.test.ts` → 16 passing tests including the round-trip property test.
- [x] `bash scripts/lint-adapters.sh` → zero new violations.
- [x] `npx tsc --noEmit` → clean.
- [x] `npm test` → 836 passing, zero regressions.
- [x] SUMMARY documents the consumer audit (above).

## Deviations from Plan

None. The plan was executed exactly as written. One test expectation in the initial RED commit was corrected during the GREEN phase after verifying actual `path.posix.join` behavior for single-segment input — the trailing slash is preserved by Node, and the test now documents that this is load-bearing for `findSinkContaining`'s prefix-match semantics. No behavior change; only the test's `expect(...).toBe(...)` was adjusted from `"_memory"` to `"_memory/"`.

## Known Stubs

None. All helpers are fully implemented and tested.

## TDD Gate Compliance

- RED: `043e4a5 test(02-11): add failing tests for forward-slash vault-relative helpers` — 11/16 failing as expected (`TypeError: vaultRelativeInSink is not a function`).
- GREEN: `0f72199 feat(02-11): split path helpers into FS-bound and comparison-bound` — 16/16 passing.

Gate sequence verified.

## Follow-ups (out of scope; tracked elsewhere)

- **Windows CI** (post-v2): once Windows runners exist, lift the cross-OS assertion in the unit tests from containment-based to exact-equality-based for OS-native helpers, and exact-equality-based for comparison helpers (forward-slash on both OSes).
- **Plan 02-14 (WR-08)**: thread `findSinkContaining(docId)` through audit-row stamping. Will adopt `vaultRelativeInSink` for any new comparison paths the audit row needs.
- **Indexer `notes.path` convention audit**: a low-priority follow-up could add a CI check that `notes.path` rows never contain `\\` — defensive belt-and-braces for v2.0 ship.

## Self-Check: PASSED

- `src/adapters/delivery/obsidian-fs/path.ts` — exists, contains `path.posix.join` (1 match), exports `joinVaultPathPosix` and `vaultRelativeInSink`.
- `src/adapters/delivery/obsidian-fs/path.test.ts` — exists, 16 tests pass.
- Commits in worktree branch: `043e4a5` (RED) and `0f72199` (GREEN) both present in `git log --oneline`.
- `STATE.md` / `ROADMAP.md` untouched (per instructions).
