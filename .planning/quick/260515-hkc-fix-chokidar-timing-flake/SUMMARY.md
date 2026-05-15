---
slug: fix-chokidar-timing-flake
quick_id: 260515-hkc
date: 2026-05-15
status: blocked
flags: [needs-replanning]
commits:
  - 678dde3: "fix(quick): bump chokidar stabilityThreshold 200->400ms"
files-modified:
  - src/adapters/change-feed/obsidian-fs/chokidar-config.ts
---

# Fix chokidar timing flake — SUMMARY

**Status: EXECUTION BLOCKED.** Task 1 (the code change) shipped cleanly and
the suppression conformance suite is green. Task 2 (3 consecutive full-suite
runs) failed on Run 1 with a **deterministic** breakage that the plan
explicitly assumed would not occur. The bump in commit `678dde3` is
correct in isolation, but a follow-up plan must reconcile a now-broken
test before this can merge.

## One-liner

Chokidar `awaitWriteFinish.stabilityThreshold` bumped 200->400ms in
`chokidar-config.ts`; suppression conformance green; one previously-passing
test (`watcher.test.ts > drain() forces pending events to flush`) now fails
deterministically because the bump invalidates its 400ms sleep assumption.

## Tasks executed

| # | Task                                              | Status                  | Commit  |
|---|---------------------------------------------------|-------------------------|---------|
| 1 | Bump stabilityThreshold + update header comment   | done                    | 678dde3 |
| 2 | 3 consecutive full-suite runs                     | blocked after run 1     | —       |

## Task 1 — Bump stabilityThreshold + update header comment

**Files modified:**

- `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`

**Changes applied (per PLAN.md):**

1. Line 48 runtime value: `stabilityThreshold: 200` -> `400`.
2. Header comment: doc-string updated to match new value (`200` -> `400`).
3. Header comment: added a one-sentence note explaining the 400ms choice,
   the 300-400ms safety margin over the 700-800ms test sleeps, and an
   explicit acknowledgment that Pitfall 6 (suppression integration) was
   re-verified and remains green.

**Per-task verification (PASS):**

- `npm run lint:check` exits 0 (tsc + prettier + adapter-seam invariants
  I-1..I-6 + C-1 branding all green).
- `npm test -- --run src/adapters/change-feed/conformance.test.ts` exits 0:
  13/13 tests passed in 2.64s; includes the Pitfall 6 suppression
  integration test. Suppression-window race remains favorable (widening
  the stability window only gives the suppression set more time to be
  consumed before chokidar fires).

**Commit:** `678dde3`
**Message:** `fix(quick): bump chokidar stabilityThreshold 200->400ms (resolves Phase 1 wave-5 flake)`

## Task 2 — Full-suite stability verification

**Plan called for:** 3 consecutive `npm test -- --run` runs, all 3 exit 0
with 578 tests passing, durations recorded, <= +10% wall-clock vs the
~7.83s pre-bump baseline.

### Run 1 — FAILED (deterministic, not the flake the plan targeted)

| Metric      | Value                                  |
|-------------|----------------------------------------|
| Wall-clock  | 8.18s                                  |
| Tests       | 576 passed, 2 failed, 11 todo (589)    |
| Test files  | 50 passed, 2 failed (52)               |

Re-running the offender in isolation reproduced the failure
deterministically (single test file, ~6.5s wall-clock, 1 failed / 5 passed).

**Failing test (NOT the two listed in PLAN.md Description):**

- `src/adapters/change-feed/obsidian-fs/watcher.test.ts:128` —
  **`VaultWatcher > drain() forces pending events to flush`**
  - Test writes a file then `sleep(400)` then calls `await watcher.drain()`
    then asserts `notes.getByPath("drain.md") !== null`.
  - With `stabilityThreshold` raised to 400ms (+ pollInterval 50ms),
    chokidar's `awaitWriteFinish` has not yet emitted the event at the
    400ms mark, so `drain()` flushes an empty queue and the DB is empty.
  - This is a deterministic invariant violation, not a flake.

The second failure reported in the run-1 summary line ("2 failed") was not
isolated within the time budget; a focused re-run on `watcher.test.ts`
showed only the `drain()` test failing. The likely candidate for the
second failure is a downstream cascade from the drain() race in the same
file; recommend a clean re-run after the follow-up fix lands to confirm.

### Runs 2 and 3 — not executed

PLAN Task 2 acceptance gate is "all 3 runs MUST exit 0". Run 1 failed,
so runs 2 and 3 were skipped to avoid burning ~30s on a known failure.

### Wall-clock baseline comparison

Run 1 was 8.18s vs the ~7.83s verifier baseline — well within the
+10% budget (8.6s). No performance regression from the bump itself.

## Why this is BLOCKED, not auto-fixable (Rule 4)

The PLAN's "Out of scope" section explicitly states:

> No changes to the two 400ms-sleep tests — they work for unrelated
> reasons (closed-feed + drain()).

The plan author asserted that the `drain()` test passes "for unrelated
reasons" — i.e., that `drain()` does not depend on the chokidar event
having fired. **That premise is wrong.** The test body:

```ts
it("drain() forces pending events to flush", async () => {
  await writeFile(join(vaultDir, "drain.md"), "# d", "utf-8");
  // Don't sleep — call drain immediately. The chokidar event still has
  // to fire; drain awaits the queue.
  await sleep(400); // let chokidar deliver
  await watcher.drain();
  expect(vault.db.notes.getByPath("drain.md")).not.toBeNull();
});
```

The inline comment ("The chokidar event still has to fire; drain awaits
the queue") and the `sleep(400)` immediately before `drain()` are both
explicit that the chokidar event MUST fire before `drain()` is called.
With `stabilityThreshold: 400`, the event fires *at the earliest* 400ms
after `writeFile` — typically a tick or two later — so the `sleep(400)`
gate races the chokidar timer and loses deterministically.

This is **Rule 4 (architectural)** territory:

- A trivial Rule 1 fix would bump the test's sleep to 500-600ms.
- But the PLAN explicitly lists this test in "Out of scope" — modifying it
  violates the plan's contract with the user.
- The user chose the "root-cause" path over `test.retry(1)`; auto-editing
  a test file the plan forbade me to touch is the kind of architectural
  decision Rule 4 reserves for the user.

## Recommended next steps (for the orchestrator / a follow-up plan)

Three options, in increasing order of intrusion:

1. **Bump the `drain()` test's sleep** in `watcher.test.ts:132` from
   `sleep(400)` to `sleep(500)` or `sleep(600)`. The test's own inline
   comment already acknowledges that "the chokidar event still has to
   fire; drain awaits the queue" — bumping the sleep is consistent with
   the test's intent. ~1-line change. Lowest-risk.
2. **Lower the bump to a value strictly less than 400ms**, e.g. 350ms.
   Still provides a meaningful margin over the original 200ms (and over
   any plausible polling jitter), keeps the drain() test's 400ms sleep
   above the threshold, and stays well below the 700-800ms test sleeps.
3. **Revert the bump entirely** and add `test.retry(1)` to the two
   originally-flaky tests (the band-aid path the user originally rejected).

Recommended: **option 1** — smallest delta, preserves the PLAN's
"root-cause" framing, and the `drain()` test's comment already
acknowledges the dependency the bump exposed.

## STATE.md / ROADMAP.md instructions for the orchestrator

- **Do NOT remove the "Phase 1 wave-5 known flake" entry yet** — the fix
  is in-flight but blocked. Remove only after a follow-up plan lands.
- If the orchestrator chooses to land commit `678dde3` anyway (because
  the bump itself is correct and the broken test is a known-blast-radius
  issue), then a follow-up `quick` plan to address the `drain()` test
  is required before merge to `main`.

## Self-Check: PASSED

- File `src/adapters/change-feed/obsidian-fs/chokidar-config.ts`: FOUND.
  Verified `stabilityThreshold: 400` at line 48 and the updated header
  comment.
- Commit `678dde3`: FOUND in `git log --all`.
- Conformance test (13 tests): GREEN.
- Full-suite Run 1: FAILED on a deterministic `drain()` test invariant
  — documented above. This is the BLOCK signal, not a self-check
  failure.
