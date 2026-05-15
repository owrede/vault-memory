---
slug: fix-chokidar-timing-flake
quick_id: 260515-hkc
date: 2026-05-15
status: partial
flags: [needs-followup]
commits:
  - 678dde3: "fix(quick): bump chokidar stabilityThreshold 200->400ms"
  - 9216944: "fix(quick): bump drain() test sleep 400->500ms"
files-modified:
  - src/adapters/change-feed/obsidian-fs/chokidar-config.ts
  - src/adapters/change-feed/obsidian-fs/watcher.test.ts
---

# Fix chokidar timing flake — SUMMARY

**Status: PARTIAL.** Tasks 1, 2, 3 all shipped cleanly. The Pitfall 6
suppression conformance suite is green. The previously-deterministic
drain() regression is gone (drain test now passes in 510ms). But the
**original flake the plan targeted is mitigated, not eliminated**: 6
back-to-back full-suite runs yielded 5 green / 1 fail (83%), with the
failure landing on the same `change-feed.test.ts:79` create-event race
that motivated the plan.

The PLAN's strict Task 2 / Task 4 acceptance gate ("3/3 runs MUST exit
0") is NOT met. The PLAN's own escalation guidance ("If any of the 3
runs fails: escalate — the 400ms threshold isn't enough; consider 600ms
OR fall back to test.retry(1)") applies. Next step: a second user
decision on threshold value or retry strategy.

## One-liner

`stabilityThreshold` bumped 200->400ms + drain() test sleep 400->500ms;
suppression integration green; **original 700ms-sleep flake mitigated
to ~17% incidence (1/6 runs) but not eliminated** — 400ms is not enough
under full-suite load.

## Tasks executed

| # | Task                                              | Status         | Commit  |
|---|---------------------------------------------------|----------------|---------|
| 1 | Bump stabilityThreshold + update header comment   | done           | 678dde3 |
| 2 | 3 consecutive full-suite runs (initial)           | blocked        | —       |
| 3 | Bump drain() test sleep 400->500ms                | done           | 9216944 |
| 4 | 3 consecutive full-suite runs (re-run)            | partial: 5/6   | —       |

## Task 1 — Bump stabilityThreshold + update header comment

**Files modified:**

- `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`

**Changes applied (per PLAN.md):**

1. Line 48 runtime value: `stabilityThreshold: 200` -> `400`.
2. Header comment: doc-string updated to match new value.
3. Header comment: added a one-sentence note explaining the 400ms choice
   and re-affirming Pitfall 6 (suppression integration) was re-verified.

**Per-task verification (PASS):**

- `npm run lint:check` exits 0 (tsc + prettier + adapter-seam invariants
  I-1..I-6 + C-1 branding all green).
- `npm test -- --run src/adapters/change-feed/conformance.test.ts` exits 0:
  13/13 tests passed in 2.64s; includes the Pitfall 6 suppression
  integration test.

**Commit:** `678dde3`

## Task 2 — Initial full-suite verification (BLOCKED, superseded by Task 4)

Run 1 hit a deterministic failure on `watcher.test.ts:128`
`drain() forces pending events to flush`. The test sleeps exactly 400ms
before calling `drain()`, which now equals the chokidar
`stabilityThreshold` — the event hasn't fired by drain() time, so
`drain()` flushes an empty queue.

The PLAN's "Out of scope" had incorrectly asserted this test "works for
unrelated reasons". Surfaced as EXECUTION BLOCKED for user decision.

User approved **Option 1** (bump the test's sleep 400->500ms) — see
Task 3.

## Task 3 — Bump drain() test sleep 400->500ms

**Files modified:**

- `src/adapters/change-feed/obsidian-fs/watcher.test.ts`

**Changes applied (per user direction):**

- Line 132: `await sleep(400);` -> `await sleep(500);`
- Inline comment updated to "let chokidar deliver (400ms stabilityThreshold
  + 100ms margin)" to make the dependency explicit for future readers.

**Per-task verification (PASS):**

- `npm test -- --run src/adapters/change-feed/obsidian-fs/watcher.test.ts`
  exits 0: 6/6 tests pass; drain() test completes in 510ms (matches
  500ms sleep + ~10ms overhead).

**Commit:** `9216944`

## Task 4 — Full-suite stability verification (re-run after Task 3)

**Plan called for:** 3 consecutive `npm test -- --run` runs, all 3 exit
0 with 578 passing, 11 todo, durations recorded, <= +10% wall-clock vs
the ~7.83s pre-bump baseline (target ceiling: 8.6s).

### Run-by-run results

| Run     | Result   | Wall-clock | Tests                                                   |
|---------|----------|------------|---------------------------------------------------------|
| Run 1   | PASS     | 8.40s      | 578 passed, 11 todo (589)                               |
| Run 2   | PASS     | 8.40s      | 578 passed, 11 todo (589)                               |
| Run 3   | **FAIL** | 8.45s      | 577 passed, **1 failed**, 11 todo (589)                 |
| Retry A | PASS     | 8.29s      | 578 passed, 11 todo (589)                               |
| Retry B | PASS     | 8.41s      | 578 passed, 11 todo (589)                               |
| Retry C | PASS     | 8.24s      | 578 passed, 11 todo (589)                               |

**Aggregate:** 5 green / 1 fail / 6 total = **83% pass rate**.

### Wall-clock baseline comparison

All 6 runs fell between 8.24s and 8.45s. Mean ~8.37s vs verifier
baseline ~7.83s — about +7%, **within the +10% / 8.6s budget**. No
material performance regression from the changes themselves.

### The Run-3 failure

- **Failing test:** `src/adapters/change-feed/obsidian-fs/change-feed.test.ts:79`
  `ObsidianFsChangeFeed > emits create on a newly written .md file`
- **Test body:** writes `new.md`, sleeps 700ms, asserts at least one
  `create` event was observed.
- **Failure mode:** `created.length` was 0 — the chokidar event had
  not fired by the 700ms mark. This is **exactly the same flake class
  the plan was designed to fix**, surviving at lower frequency.
- **Root cause:** With `stabilityThreshold: 400` + `pollInterval: 50`,
  the chokidar event fires *at the earliest* 400ms after the write —
  typically 450-500ms. The 700ms sleep leaves only ~200-250ms of
  margin. Under full-suite load (the failure landed on the third
  run-in-rapid-succession, with the previous two runs warming up the
  event loop), that margin can collapse on a single GC pause or
  chokidar poll-cadence miss.

### Why this is not deterministic (vs. the Task-2 drain() failure)

The drain() test slept exactly at the threshold (400ms == 400ms) →
deterministic loss. The create() test sleeps 300ms past the threshold
(700ms - 400ms) → race that *usually* wins but occasionally loses
under adversarial CPU/GC conditions.

## Why this is reported PARTIAL and not COMPLETE

The PLAN's Task 2 acceptance gate is strict: **"all 3 runs MUST exit 0"**.
At 5/6 = 83%, the gate is not satisfied — a single re-run is enough
to flip the count to 5/7 (71%) or 6/7 (86%) and that volatility is the
exact failure mode the plan was designed to eliminate.

The PLAN's own escalation guidance (Task 2 body):

> If any of the 3 runs fails: **escalate** — the 400ms threshold isn't
> enough; consider 600ms OR fall back to `test.retry(1)` on the two
> flaky cases.

This guidance triggers. Per Rule 4 (the next bump in threshold or the
introduction of `test.retry(1)` is an architectural decision that
re-opens the original "root-cause vs. band-aid" choice the user already
made once), I am **not auto-extending** the fix. Surfacing for a
second user decision.

## Recommended next steps (for a follow-up `/gsd-quick`)

Three options, ordered by intrusion:

1. **Bump `stabilityThreshold` from 400ms to 500ms** (the
   PLAN-recommended next notch — actually the PLAN said 600ms, but
   500ms is the conservative midpoint). The 700-800ms test sleeps
   then have 200-300ms margin against a 500ms threshold + 50ms
   pollInterval, which is the same margin shape that took these
   tests from "flaky" to "rare flake" in this plan. To also keep
   the drain() test happy, bump its sleep correspondingly:
   `sleep(500)` -> `sleep(600)`. Two-line follow-up.

2. **Bump `stabilityThreshold` to 600ms** (the PLAN's actual
   suggested next notch). Larger margin, but the 700-800ms test
   sleeps then have only 100-200ms margin — likely still flaky
   under adversarial load. The drain() test would need
   `sleep(500)` -> `sleep(700)`. This is approaching diminishing
   returns and the wall-clock impact is real (~30 tests sleep, +200ms
   each in worst case = +6s if every test hit the worst case;
   realistic impact ~+1-2s).

3. **Keep the current 400ms threshold + add `test.retry(1)`** to the
   two original flaky tests (`change-feed.test.ts:74` "emits create
   on a newly written .md file" and `watcher.test.ts:84` "indexes a
   newly created .md file"). The user originally rejected this band-aid,
   but option 1's two-line follow-up may also fail, in which case
   `test.retry(1)` is the ultimate insurance. Pragmatic if the
   80%-of-the-time fix is judged "good enough" for the rare CI miss.

My recommendation: **option 1** (smallest delta, consistent with the
PLAN's "next notch" framing). If option 1 still leaves a flake, option 3
becomes mandatory.

## STATE.md / ROADMAP.md instructions for the orchestrator

- **Do NOT remove** the "Phase 1 wave-5 known flake" entry from
  `.planning/STATE.md` Blockers/Concerns. The flake's incidence is
  reduced (was ~25% per verifier; now ~17% in this 6-run sample) but
  not eliminated. Update the entry to reflect the mitigation:
  "Phase 1 wave-5 known flake: mitigated by 260515-hkc (stabilityThreshold
  200->400ms + drain() test sleep 400->500ms). Pre-bump incidence ~25%;
  post-bump incidence ~17%. Follow-up quick plan recommended to bump
  threshold one more notch."
- These two commits (`678dde3` + `9216944`) are safe to merge —
  they're net-positive (fewer flakes, no regressions, no perf
  penalty). The remaining flake is a known-shape mitigation
  improvement, not a new defect.

## Deviations from PLAN

1. **PLAN "Out of scope" was wrong.** The plan asserted that the two
   400ms-sleep tests (closed-feed + drain()) "work for unrelated
   reasons" and forbade touching them. That premise was incorrect for
   the drain() test — the test's own inline comment says the chokidar
   event must fire before drain(). User approved Option 1 (bump test
   sleep) after the executor surfaced the inconsistency. Plan
   document remains unchanged per user direction; the deviation is
   recorded here.

2. **Task 4 acceptance not met (5/6 vs required 3/3).** The PLAN's
   own escalation clause triggers; not auto-extending without user
   approval.

## Self-Check: PASSED

- File `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`: FOUND;
  `stabilityThreshold: 400` at line 48; header comment updated.
- File `src/adapters/change-feed/obsidian-fs/watcher.test.ts`: FOUND;
  line 132 reads `await sleep(500); // let chokidar deliver (400ms
  stabilityThreshold + 100ms margin)`.
- Commit `678dde3`: FOUND in `git log --all`.
- Commit `9216944`: FOUND in `git log --all`.
- Conformance test (13 tests): GREEN.
- Watcher.test (6 tests, isolated): GREEN, drain() in 510ms.
- Full-suite: 5/6 GREEN (83%); 1 failure on the original flake target.
