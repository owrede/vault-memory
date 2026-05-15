---
slug: fix-chokidar-timing-flake
quick_id: 260515-hkc
date: 2026-05-15
status: blocked-final
flags: [needs-followup, retry-fallback-recommended]
commits:
  - 678dde3: "fix(quick): bump chokidar stabilityThreshold 200->400ms"
  - 9216944: "fix(quick): bump drain() test sleep 400->500ms"
  - 72a749f: "fix(quick): bump chokidar stabilityThreshold 400->500ms (second notch)"
  - 57560ff: "fix(quick): bump drain() test sleep 500->600ms"
  - f661b6e: "fix(quick): bump 5 sibling test sleeps 500->600 in change-feed.test.ts"
files-modified:
  - src/adapters/change-feed/obsidian-fs/chokidar-config.ts
  - src/adapters/change-feed/obsidian-fs/watcher.test.ts
  - src/adapters/change-feed/obsidian-fs/change-feed.test.ts
---

# Fix chokidar timing flake — SUMMARY

**Status: BLOCKED-FINAL (option B fallback recommended).** Option A
(threshold 500ms + lock-step bump of all 5 positive-assertion sibling
sleeps in change-feed.test.ts) fixed the deterministic regression but
**did not eliminate the underlying flake**. Run 2 of Task 11 failed
intermittently on the same flake class the plan originally targeted,
now landing on a *different* set of tests (`change-feed.test.ts:74`
and `watcher.test.ts:91`).

Diagnosis: **the bigger the threshold gets, the more tests reduce to
"just barely enough margin" on a 700-800ms sleep, and at sufficient
CPU load there is no margin large enough that doesn't bloat the suite
unreasonably.** The flake is a property of the test-design pattern
(sleep + assert event-fired), not a property of any specific threshold
value. Per the user's pre-stated escalation, **fall back to Option B**:
revert the second-notch bump and add `test.retry(1)` to the two
originally-flaky tests.

## One-liner

Option A landed clean (lint green, change-feed.test.ts:10/10 isolated,
no deterministic failures); Run 1 of Task 11 was 578/0/11. Run 2 hit
the same flake class on different tests. **Margin-pursuit isn't going
to converge** — recommend Option B fallback (revert 72a749f, 57560ff,
f661b6e; keep 400ms threshold from 678dde3 + drain-sleep-500 from
9216944; add `test.retry(1)` on the two known-flaky tests).

## Tasks executed (full history)

| #  | Task                                                            | Status                  | Commit  |
|----|-----------------------------------------------------------------|-------------------------|---------|
| 1  | Bump stabilityThreshold 200->400ms                              | done                    | 678dde3 |
| 2  | Initial 3-run verification                                      | blocked (drain race)    | —       |
| 3  | Bump drain() test sleep 400->500ms                              | done                    | 9216944 |
| 4  | 3-run verification (re-run)                                     | partial: 5/6 (~17%)     | —       |
| 6  | Bump stabilityThreshold 400->500ms (second notch)               | done                    | 72a749f |
| 7  | Bump drain() test sleep 500->600ms                              | done                    | 57560ff |
| 8  | 5-run verification (third attempt)                              | blocked: 0/2 (det.)     | —       |
| 10 | Bump 5 sibling sleeps in change-feed.test.ts 500->600ms         | done                    | f661b6e |
| 11 | 5-run verification (final attempt)                              | blocked: 1/2 (flaky)    | —       |

## Task 10 — Bump 5 sibling test sleeps 500->600ms

**Files modified:** `src/adapters/change-feed/obsidian-fs/change-feed.test.ts`

**Changes:** 5 `sleep(500)` -> `sleep(600)` at lines 88, 100, 103, 130,
159. Inline comments added at each site documenting the threshold
relationship ("500ms threshold + 100ms margin"). The 3 negative-
assertion `sleep(500)` sites (lines 121, 148, 163) left untouched per
the user's audit — those tests assert that no event fires, so a longer
wait is safer and a shorter wait is fine.

**Per-task verification (PASS):**

- `npm run lint:check` exits 0.
- `npm test -- --run src/adapters/change-feed/obsidian-fs/change-feed.test.ts`
  exits 0: 10/10 in 7.62s. The previously-deterministic Run-8 failures
  are gone.

**Commit:** `f661b6e`

## Task 11 — Full-suite stability verification (BLOCKED)

**Plan called for:** 5 consecutive `npm test -- --run` runs, all 5
exit 0 with 578 passing.

### Run-by-run results

| Run   | Result   | Wall-clock | Tests                                    | Notes                                                  |
|-------|----------|------------|------------------------------------------|--------------------------------------------------------|
| Run 1 | PASS     | 8.70s      | 578 passed, 11 todo                      | Just over 8.6s budget (+0.10s) due to +500ms sleeps    |
| Run 2 | **FAIL** | 8.84s      | 577 passed, **1 failed**, 11 todo        | `change-feed.test.ts:74` "emits create on .md file"    |
| Diag-A| FAIL (2) | n/a        | 577 passed, **2 failed**, 11 todo        | Above + `watcher.test.ts:91` "re-indexes a modified"   |

Runs 3-5 NOT executed — per user direction ("If Task 11 fails any of
5: report EXECUTION BLOCKED"), stopped after the first failure.

### Failing tests (different from prior rounds — flaky, not deterministic)

Note the different failing-test surface between Run 2 and the
diagnostic re-run — same flake class but different test landed each
time, confirming this is intermittent (event-loop-load-dependent) and
not a deterministic invariant violation:

1. **`change-feed.test.ts:74` "emits create on a newly written .md file"**
   - Body: write `new.md`, `sleep(700)`, assert `created.length >= 1`.
   - With threshold=500ms + pollInterval=50ms, chokidar fires *at the
     earliest* 500ms (typically 510-570ms). The 700ms sleep leaves
     130-190ms margin — collapses under full-suite GC pressure.

2. **`watcher.test.ts:91` "re-indexes a modified file"** (diagnostic run only)
   - Body: write `# Old` to edit.md, `sleep(800)`, assert
     `title === "Old"`; write `# New Title`, `sleep(800)`, assert
     `title === "New Title"` AND `hash !== oldHash`.
   - 800ms sleep gives ~300ms margin over 500ms threshold — should be
     adequate but evidently isn't under full-suite load.

### Wall-clock baseline (modest budget overrun)

Run 1: 8.70s vs 8.6s budget = +1.2% over. Run 2: 8.84s = +2.8% over.
**Both are still within +12% vs the verifier's 7.83s baseline, but
strictly speaking the +10%/8.6s gate in the PLAN is breached.** The
overrun is the unavoidable cost of the 5 × +100ms sleeps in
change-feed.test.ts plus the 2 × +100ms+200ms in watcher.test.ts —
~+700ms of pure sleep cumulatively.

Confirmation that the budget overrun is from the sleeps (not a code
perf regression): individual test files take measurably longer
post-bump (e.g., change-feed.test.ts isolated: 6.5s pre-bump → 7.6s
post-bump = +1.1s, ~entirely from the +500ms cumulative test sleep
additions).

## Why this should fall back to Option B

The pattern across all 3 verification rounds:

| Round | Threshold | Test sleeps | Flake incidence            | Wall-clock |
|-------|-----------|-------------|----------------------------|------------|
| Baseline | 200ms  | original    | ~25% (verifier observed)   | 7.83s      |
| Round 1  | 400ms  | drain=500   | ~17% (1/6 this plan)       | 8.24-8.45s |
| Round 2  | 500ms  | drain=600   | 100% on 3 sibling tests    | 8.23-8.57s |
| Round 3  | 500ms  | drain=600 + 5 lock-step sibling bumps | flake re-emerges on different tests (1/2) | 8.70-8.84s |

The flake incidence dropped from ~25% (200ms) to ~17% (400ms), then
the threshold pursuit derailed. Round 3 brought us back to a flake-but-
not-deterministic state with **higher wall-clock cost and broken budget
gate**. We have asymptoted: more threshold-pursuit doesn't help, but
the underlying sleep+assert-event-fired pattern remains inherently
flaky under load.

The pragmatic answer is **Option B** (which the user pre-approved in
the instructions for this round): bound the flake at the lower-cost
state (400ms threshold from 678dde3, drain-sleep=500 from 9216944,
no other sleep churn) and add `test.retry(1)` to the two known-flaky
tests. This:

- Reverts the 3 commits that did not help: `72a749f`, `57560ff`, `f661b6e`.
- Keeps the 2 commits that DID help: `678dde3` (the 400ms threshold
  reduces flake incidence ~25% → ~17% with no test-side churn) and
  `9216944` (the drain() test fix is independent of which threshold
  we pick, as long as threshold <= 400ms with the sleep at 500ms).
- Adds `test.retry(1)` to the two tests that are flaky-by-design:
  `change-feed.test.ts:74` "emits create..." and `watcher.test.ts:84`
  "indexes a newly created...". These will retry once on failure;
  vitest reports retries in the summary so CI doesn't lose
  observability of the flake.

## Recommended next steps — user decision required

### Option B (recommended) — revert second-notch + add test.retry(1)

1. `git revert --no-edit f661b6e 57560ff 72a749f` (in reverse order
   on a follow-up `/gsd-quick` worktree). State after revert:
   - `chokidar-config.ts`: threshold=400, header comment from
     post-678dde3 state.
   - `watcher.test.ts:132`: `sleep(500)` (from 9216944).
   - `change-feed.test.ts`: original `sleep(500)` × 7.

2. Add `test.retry(1)` to:
   - `change-feed.test.ts:74` — `it.retry(1)("emits create on a newly written .md file", ...)`
   - `watcher.test.ts:84` — `it.retry(1)("indexes a newly created .md file", ...)`

3. Optionally also add `test.retry(1)` to `watcher.test.ts:91`
   "re-indexes a modified file" (Run-2 diagnostic showed it also
   sometimes flakes at threshold=500; less clear it flakes at
   threshold=400, but the cost is minimal and the safety is real).

### Option C (alternative) — keep the round-3 state, accept the +0.2s budget overrun, add test.retry(1) on top

If the additional 100ms of margin from threshold=500ms is judged
materially valuable, keep `72a749f`, `57560ff`, `f661b6e`, and
on top add `test.retry(1)` to the two (or three) known-flaky tests
listed above. This is the *most* margin we can buy without further
threshold escalation, plus the retry insurance.

Slightly less clean than Option B (more files modified, more code
to maintain), but defensible if the user wants both belt and braces.

### Option D (full revert)

`git revert` all five commits and accept the original ~25% flake.
Not recommended — `678dde3` (400ms threshold) is a clear net win
at zero ongoing cost.

**My recommendation: Option B.** Smallest cumulative footprint that
keeps the most-valuable improvements (400ms threshold + drain fix)
and accepts the band-aid the user originally rejected but pre-
approved as the escalation path.

## STATE.md / ROADMAP.md instructions for the orchestrator

- **Do NOT remove** the "Phase 1 wave-5 known flake" entry yet.
- The 5 in-flight commits should be considered **mixed**:
  - `678dde3` (200->400 threshold) is good — keep.
  - `9216944` (drain test 400->500) is good — keep.
  - `72a749f` (400->500 threshold) — revert recommended.
  - `57560ff` (drain test 500->600) — revert recommended (paired
    with the 72a749f revert).
  - `f661b6e` (5 sibling sleeps 500->600) — revert recommended
    (the dependent fix for 72a749f; reverts together).

## Deviations from PLAN

1. The user's option-A escalation (Task 10) was based on the
   executor's prior BLOCKED-AGAIN recommendation. That recommendation
   correctly identified the 5 deterministic positive-assertion sleeps
   and bumped them clean (Task 10 ✓). But the *premise* of all
   threshold-pursuit options was wrong: the 700-800ms sleep tests
   still don't have enough margin even at threshold=500ms with the
   lock-step bumps applied. Threshold-pursuit asymptotes, the
   underlying test-design pattern doesn't.
2. Stopped after Run 2 of Task 11 + 1 diagnostic re-run, per user
   direction. Did not execute Runs 3-5.
3. Wall-clock budget breached by ~0.1-0.24s (1.2-2.8% over the
   8.6s gate); documented above as an additional rationale to
   revert.

## Self-Check: PASSED

- File `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`:
  FOUND; `stabilityThreshold: 500` at line 63.
- File `src/adapters/change-feed/obsidian-fs/watcher.test.ts`:
  FOUND; line 132 `sleep(600)`.
- File `src/adapters/change-feed/obsidian-fs/change-feed.test.ts`:
  FOUND; positive-assertion sleeps at lines 88, 100, 103, 130, 159
  all read `sleep(600)`; negative-assertion sleeps at 121, 148, 163
  preserved at `sleep(500)` (line 148: `sleep(400)`).
- All 5 commits FOUND in `git log --all`: 678dde3, 9216944, 72a749f,
  57560ff, f661b6e.
- Conformance test (13 tests): GREEN at all rounds.
- change-feed.test.ts isolated: GREEN (10/10).
- Full-suite: 1/2 GREEN at round-3 (Run 1: PASS 578/0/11; Run 2:
  FAIL with 1 test on change-feed.test.ts:74).
