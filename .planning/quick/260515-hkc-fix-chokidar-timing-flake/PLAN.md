---
slug: fix-chokidar-timing-flake
quick_id: 260515-hkc
date: 2026-05-15
status: in-progress
flags: []
---

# Fix chokidar timing flake

## Description

Bump `awaitWriteFinish.stabilityThreshold` from **200ms → 400ms** in
`src/adapters/change-feed/obsidian-fs/chokidar-config.ts` to eliminate the
intermittent full-suite flake in:

- `src/adapters/change-feed/obsidian-fs/change-feed.test.ts:91`
  ("emits update on a modified .md file")
- `src/adapters/change-feed/obsidian-fs/watcher.test.ts:95`
  ("indexes a newly created .md file")

These tests sleep 700–800ms after writing to give chokidar time to fire its
`awaitWriteFinish`-debounced event. Under full-suite load (multiple parallel
chokidar watchers + onnxruntime warmup + DB migrations running in other
test files), the 200ms threshold + 50ms pollInterval window can stretch
past 700ms, causing the assertion to run before the listener fires.

400ms threshold gives a 300–400ms safety margin on the 700–800ms sleeps
while remaining safely below the two 400ms-sleep test cases (which work
for unrelated reasons — closed-feed and drain()).

## Origin

Verifier PASS-with-caveats from `/gsd-verify-work` (Phase 1 verification —
commit `0df8b0c`). Logged in `.planning/STATE.md` Blockers/Concerns:

> Phase 1 wave-5 known flake: `src/adapters/change-feed/obsidian-fs/
> change-feed.test.ts:91` ("emits update on a modified .md file")
> occasionally fails under full-suite load due to a 700ms chokidar
> `awaitWriteFinish` race. Individual file run is stable (3/3);
> full-suite run was 3/4 green locally. Same flake pattern exists
> pre-wave in `watcher.test.ts`. Plan 01-06 verifier should add a
> retry-once or bump the stabilityThreshold for these two test files
> if the flake recurs in CI.

Verifier recommendation reproduced in `01-VERIFICATION.md`. User chose
the "bump stabilityThreshold to 400ms" approach over `test.retry(1)` —
fixes root cause rather than papering over symptom.

## Tasks

### Task 1 — Bump stabilityThreshold + update header comment

**Files:**
- `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`

**Changes:**
1. Line 15 (header comment): update inline doc from
   `stabilityThreshold: 200, pollInterval: 50` to
   `stabilityThreshold: 400, pollInterval: 50` so the comment doesn't
   lie about the actual value.
2. Line 48 (runtime value): change `stabilityThreshold: 200` to
   `stabilityThreshold: 400`.
3. Add a one-sentence note in the header comment explaining the
   400ms choice (margin over the 700–800ms test sleeps; safely below
   the two 400ms-sleep tests that are racy-by-design but tolerant).

**Pitfall #6 acknowledgment:** the header comment at lines 8–13 says
"DO NOT change without first re-running the suppression conformance
test." The verification at the bottom of this plan does exactly that.

**Verify (per task):**
- `npm run lint:check` exits 0 (tsc + prettier on the file).
- `npm test -- --run src/adapters/change-feed/conformance.test.ts`
  exits 0 — suppression integration test specifically asserts that
  own-writes don't fire ChangeEvents. The 400ms threshold extends the
  suppression-window race favorably (suppression entry has even more
  time to be consumed before chokidar fires).

**Acceptance:** the file's runtime value matches the header doc;
prettier passes; conformance suite passes.

### Task 2 — Full-suite stability verification

**Files:** none modified.

**Verify:** run `npm test -- --run` **3 times** in succession. All 3
runs MUST exit 0 with 578 tests passing. Record the durations in
SUMMARY.md.

If any of the 3 runs fails: **escalate** — the 400ms threshold isn't
enough; consider 600ms OR fall back to `test.retry(1)` on the two
flaky cases.

**Acceptance:** 3/3 full-suite runs green; no test takes more than
+10% wall-clock vs the pre-bump baseline (Phase 1 verifier reported
~7.83s for the full suite; new target ≤ 8.6s).

## Out of scope

- No new test cases (config file is too small to warrant unit tests).
- No `test.retry(1)` — user chose root-cause fix over band-aid.
- No changes to `pollInterval` (50ms is fine; the issue is the
  stability window, not the polling cadence).
- No changes to the two 400ms-sleep tests — they work for unrelated
  reasons (closed-feed + drain()).

## STATE.md updates

After completion:
- Remove the "Phase 1 wave-5 known flake" entry from
  `.planning/STATE.md` Blockers/Concerns (resolved).
- Append a row to "Quick Tasks Completed" table (if it exists) or
  create the table with this as the first row.
