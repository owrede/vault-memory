---
slug: fix-chokidar-timing-flake
quick_id: 260515-hkc
date: 2026-05-15
status: blocked-again
flags: [needs-followup, retry-fallback-candidate]
commits:
  - 678dde3: "fix(quick): bump chokidar stabilityThreshold 200->400ms"
  - 9216944: "fix(quick): bump drain() test sleep 400->500ms"
  - 72a749f: "fix(quick): bump chokidar stabilityThreshold 400->500ms (second notch)"
  - 57560ff: "fix(quick): bump drain() test sleep 500->600ms"
files-modified:
  - src/adapters/change-feed/obsidian-fs/chokidar-config.ts
  - src/adapters/change-feed/obsidian-fs/watcher.test.ts
---

# Fix chokidar timing flake — SUMMARY

**Status: BLOCKED AGAIN (worse than before).** The second-notch bump
(400→500ms) broke MORE tests than it fixed. Tasks 6 and 7 shipped per
spec; conformance suite remains green; the watcher.test.ts drain()
test still passes. But Task 8 Run 1 and Run 2 each failed deterministically
on **3 tests in change-feed.test.ts** that use `sleep(500)` as a setup
wait — at the new 500ms threshold those sleeps lost all margin.

The right next step is NOT another threshold bump. Either:
(a) bump the affected test sleeps in lock-step (same pattern as
drain()), or
(b) fall back to `test.retry(1)` on the originally-flaky tests
(the user's pre-approved Plan-B escalation).

## One-liner

`stabilityThreshold: 500` deterministically breaks three tests in
`change-feed.test.ts` (`update`, `delete-unlink`, `rename`) because
their `sleep(500)` setup waits no longer exceed the threshold.
**Net result of the 500ms bump is strictly worse than 400ms** —
the bump must be reverted OR the affected tests must be bumped
in lock-step.

## Tasks executed

| # | Task                                                | Status                  | Commit  |
|---|-----------------------------------------------------|-------------------------|---------|
| 1 | Bump stabilityThreshold 200->400ms                  | done                    | 678dde3 |
| 2 | Initial 3-run verification                          | blocked (drain race)    | —       |
| 3 | Bump drain() test sleep 400->500ms                  | done                    | 9216944 |
| 4 | 3-run verification (re-run)                         | partial: 5/6 (~17%)     | —       |
| 6 | Bump stabilityThreshold 400->500ms (second notch)   | done                    | 72a749f |
| 7 | Bump drain() test sleep 500->600ms                  | done                    | 57560ff |
| 8 | 5-run verification (third attempt)                  | blocked: 0/2 (det.)     | —       |

## Task 6 — Bump stabilityThreshold 400->500ms

**Files modified:** `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`

**Changes:**

1. Line 57 runtime value: `stabilityThreshold: 400` -> `500`.
2. Line 15 header doc-string: updated to match.
3. Header note rewritten to document both notches (200->400 and
   400->500), the ~17% post-400ms flake incidence, and the lock-step
   bump of the drain() and closed-feed test sleeps.

**Per-task verification (PASS):**

- `npm run lint:check` exits 0.
- `npm test -- --run src/adapters/change-feed/conformance.test.ts`
  exits 0: 13/13 incl. Pitfall 6 suppression integration.

**Commit:** `72a749f`

## Task 7 — Bump drain() test sleep 500->600ms

**Files modified:** `src/adapters/change-feed/obsidian-fs/watcher.test.ts`

**Changes:**

- Line 132: `await sleep(500)` -> `await sleep(600)`.
- Inline comment updated: "let chokidar deliver (500ms
  stabilityThreshold + 100ms margin)".

**Per-task verification (PASS):**

- `npm test -- --run src/adapters/change-feed/obsidian-fs/watcher.test.ts`
  exits 0: 6/6; drain() in 612ms.

**Commit:** `57560ff`

## Task 8 — Full-suite stability verification (BLOCKED)

**Plan called for:** 5 consecutive `npm test -- --run` runs, all 5
exit 0 with 578 passing, durations recorded, suite still within the
+10% / 8.6s budget.

### Run-by-run results

| Run   | Result    | Wall-clock | Tests                                  |
|-------|-----------|------------|----------------------------------------|
| Run 1 | **FAIL**  | 8.57s      | 575 passed, **3 failed**, 11 todo (589)|
| Run 2 | **FAIL**  | 8.23s      | 575 passed, **3 failed**, 11 todo (589)|

Runs 3-5 NOT executed — per user direction ("Do NOT auto-extend
further"), stopped after the failure pattern was confirmed
deterministic.

### Failing tests (identical across both runs, in identical order — DETERMINISTIC)

All three failures are in
`src/adapters/change-feed/obsidian-fs/change-feed.test.ts`:

1. **Line 84 `emits update on a modified .md file`** (assertion at :93)
   - Body: write file v1, `sleep(500)`, clear events, write file v2,
     `sleep(700)`, assert `>= 1` update event.
   - With `stabilityThreshold: 500`, the initial create event for
     v1 fires *at the earliest* 500ms in — typically 510-550ms. The
     `sleep(500)` and the subsequent `events.length = 0` clear can
     race the chokidar event such that the v1 create event lands
     *after* the clear (so it's recorded as part of the update
     measurement window) OR the v2 update event itself fails to
     fire within the 700ms window after the second write. Either
     way, `updates.length === 0` at assertion time.

2. **Line 96 `emits delete on an unlinked .md file`** (assertion at :105)
   - Body: write file, `sleep(500)`, clear events, unlink, `sleep(500)`,
     assert `>= 1` delete event.
   - `sleep(500)` after unlink == threshold — chokidar unlink event
     does NOT fire by the 500ms mark. Pure margin collapse.

3. **Line 125 `rename surfaces as delete + create`** (assertion at :137)
   - Body: write `old.md`, `sleep(500)`, clear, rename old->new,
     `sleep(700)`, assert delete >= 1 AND create >= 1.
   - Same pattern as the update test: the initial create event
     races the clear; the rename's delete+create events race the
     700ms window with only 200ms margin (vs the 300ms it had
     at 400ms threshold).

### Why this is deterministic (not flaky)

The drain() test at the previous notch failed deterministically
because its sleep was EXACTLY equal to the threshold. The three
change-feed.test.ts tests above have the same pattern: each has a
`sleep(500)` step that is now EXACTLY equal to the new threshold.
Chokidar fires the event no earlier than the threshold mark; at
exactly the threshold the queue may be empty, may have just been
drained, or may be mid-flush. Two runs in a row producing the
identical 3-test failure list in the same order confirms the
deterministic loss.

### Wall-clock baseline

8.23s and 8.57s — within the 8.6s budget. **No perf regression**
from the threshold bump itself; the bump's pathology is purely
test correctness, not test duration.

## Why this is reported BLOCKED-AGAIN

The PARTIAL-summary recommendation 1 (this round's option 1) was
**wrong on the merits**: I underestimated how many other tests in
change-feed.test.ts use `sleep(500)` as a setup wait. The bump
exchanged a single ~17%-flake test for three 100%-fail tests. Net
result strictly worse than the 400ms state.

Per the user's pre-stated direction:

> If Task 8 fails (any of 5 runs): report EXECUTION BLOCKED again
> with the failing test and incidence rate. Do NOT auto-extend
> further — user will then likely fall back to test.retry(1)
> (the originally-rejected band-aid).

Stopping for user decision rather than auto-extending.

## Recommended next steps — user decision required

Three options, ordered by intrusion:

### Option A (cleanest, parallel to drain() fix) — bump the affected test sleeps in lock-step

In `src/adapters/change-feed/obsidian-fs/change-feed.test.ts`:

- Line 88: `await sleep(500)` -> `await sleep(600)` (create-event
  settling before the update phase).
- Line 100: `await sleep(500)` -> `await sleep(600)` (create-event
  settling before the unlink phase).
- Line 103: `await sleep(500)` -> `await sleep(600)` (unlink event
  margin).
- Line 130: `await sleep(500)` -> `await sleep(600)` (create-event
  settling before the rename phase).

Also consider in the same file:
- Line 121: `await sleep(500)` after a non-`.md` write (test asserts
  zero events; lower-risk, but for consistency could also bump).
- Line 148: `await sleep(400)` after a post-close write (test asserts
  zero events when feed is closed; 400ms < 500ms threshold so the
  test is now over-tolerant rather than racy — leaving as-is is
  safe).

Pattern matches the drain() fix exactly: every `sleep(N)` that
gates on chokidar firing must satisfy `N >= threshold + ~100ms`.
Estimated **5-line follow-up**.

### Option B (revert to 400ms + add `test.retry(1)` band-aid)

1. Revert `72a749f` and `57560ff` (back to threshold=400, drain
   sleep=500).
2. Add `test.retry(1)` to the two originally-flaky tests:
   - `change-feed.test.ts:74` "emits create on a newly written .md file"
   - `watcher.test.ts:84` "indexes a newly created .md file"

The user originally rejected this; raising again because Option A
keeps growing in scope as we discover more co-located `sleep(500)`
tests.

### Option C (full revert)

Revert all 4 commits and accept the original ~25% flake. This is
the "do nothing" baseline; only sensible if the test-suite scope
keeps expanding and the cost-benefit no longer makes sense. Not
recommended — Option A is small.

**My recommendation: Option A.** It's a 4-line follow-up plan,
matches the established lock-step pattern, and converges the
margin-management discipline across all tests in the directory.

## STATE.md / ROADMAP.md instructions for the orchestrator

- **Do NOT remove** the "Phase 1 wave-5 known flake" entry yet.
- The 4 commits land in this worktree's history but should be
  considered **provisional** — they need either Option A's
  follow-up or a partial revert before merge to main.
- If merging anyway: **DO NOT merge to main without Option A or
  Option B applied first** — Run 1/2 demonstrate 3 deterministic
  test failures in CI, which will block phase progression.

## Deviations from PLAN

1. The user's option-1 escalation was based on the executor's
   prior PARTIAL recommendation. That recommendation was incorrect
   in scope (didn't account for 5 other `sleep(500)` test gates
   in the same file). Surfaced as BLOCKED rather than papering
   over.
2. Stopped after Run 2 (vs the planned 5 runs) because the failure
   is deterministic and runs 3-5 would produce identical results
   with no additional information.

## Self-Check: PASSED

- File `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`:
  FOUND; `stabilityThreshold: 500` at line 57; header comment
  updated.
- File `src/adapters/change-feed/obsidian-fs/watcher.test.ts`:
  FOUND; line 132 reads
  `await sleep(600); // let chokidar deliver (500ms stabilityThreshold + 100ms margin)`.
- All 4 commits FOUND in `git log --all`: 678dde3, 9216944,
  72a749f, 57560ff.
- Conformance test (13 tests): GREEN at both notches.
- Full-suite: 0/2 GREEN at 500ms threshold; 3 deterministic
  failures documented above.
