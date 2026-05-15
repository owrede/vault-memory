---
phase: 02-memory-namespace-provenance-contract
plan: 07
subsystem: testing
tags:
  [
    mem-10,
    fixture,
    default-memory-v1,
    supersede-chain,
    malformed-fixtures,
    wave-0-lint,
    yaml-quoting,
    gray-matter,
  ]

# Dependency graph
requires:
  - phase: 02 (this phase)
    provides: |
      02-02 — DEFAULT_MEMORY_V1 contract + propertiesSchema (Guard A target);
      02-03 — validator.ts (validateAgentWrite) with five GuardFailure codes;
      02-04 / 02-05 — record_observation / recall consume fixture via integration tests;
      02-06 — list_sinks / memory_stats MCP Resources iterate the same tree.
provides:
  - 20-doc memory fixture under evals/fixtures/v2-test-vault/_memory/
    (13 observations + 3 briefs + 4 status-updates)
  - A→B→C Spire-budget supersede chain (2026-04-23 → 2026-04-24 → 2026-04-26)
    that exercises recall.ts hide-superseded filtering
  - confidence / type / status enum-coverage across all 20 docs
    (uncertain + hypothesis + decision newly added)
  - tests/fixtures/malformed-memory/ — 5 deliberately-broken docs +
    README, each tagged with `expected_reason` / `expected_key`
  - evals/v2-fixtures.test.ts — 35-assertion smoke test that validates
    both trees on every `npm test`
  - .memory-sink sentinel rewritten in three-line k:v format matching
    formatSentinelContent (Plan 02-02)
  - Full DocId normalization on superseded_by across the clean tree
    (obsidian-fs://atlas-fixture/...)
affects:
  - Phase 3 (assembly tools) — fixture is the substrate for ASM-* eval tests
  - Phase 5 (briefs) — brief-memory-v1 contract reuses the fixture's brief docs
  - Future malformed-fixture additions — tests/fixtures/malformed-memory/ is
    the canonical home; clean-fixture greps must exclude it by directory

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Quoted ISO 8601 timestamps in YAML frontmatter to avoid gray-matter
      auto-coercing to JS Date (the contract's z.string().datetime() rejects
      Date objects). Quoting at the YAML layer is cheaper than teaching every
      contract field to accept Date."
    - "expected_reason / expected_key co-located in malformed-fixture
      frontmatter: leverages default-memory-v1's `.passthrough()` to keep the
      expected outcome adjacent to the fixture (no parallel JSON manifest)."
    - "Two-tree separation: clean fixtures under evals/fixtures/; malformed
      fixtures under tests/fixtures/. The directory boundary is the lint
      safety net so v1-baseline never accidentally scans broken docs."
    - "Full DocId form for cross-doc references (superseded_by, evidence) —
      vault-relative paths are presentation, not identity."
    - "Vitest `it.each(docs)` + `$path` interpolation for per-doc assertion
      reporting — surfaces the failing fixture path on red rather than a
      generic 'fixture N broken'."

key-files:
  created:
    - evals/fixtures/v2-test-vault/_memory/observations/2026-04-23-spire-budget-uncertain.md
    - evals/fixtures/v2-test-vault/_memory/observations/2026-04-23-hypothesis-warehouse-roi.md
    - evals/fixtures/v2-test-vault/_memory/observations/2026-04-24-spire-budget-revised.md
    - evals/fixtures/v2-test-vault/_memory/observations/2026-04-26-spire-budget-final.md
    - evals/fixtures/v2-test-vault/_memory/observations/2026-04-28-q2-okr-decision.md
    - tests/fixtures/malformed-memory/missing-observed-at.md
    - tests/fixtures/malformed-memory/missing-source.md
    - tests/fixtures/malformed-memory/invalid-confidence.md
    - tests/fixtures/malformed-memory/supersede-no-target.md
    - tests/fixtures/malformed-memory/source-agent-no-evidence.md
    - tests/fixtures/malformed-memory/README.md
    - evals/v2-fixtures.test.ts
  modified:
    - evals/fixtures/v2-test-vault/_memory/.memory-sink (three-line k:v body)
    - evals/fixtures/v2-test-vault/_memory/observations/2026-04-20-atlas-1-pilot-target-was-12.md (full DocId superseded_by + superseded_reason)
    - 14 other docs under _memory/ (quoted observed_at / compiled_at ISO timestamps)

key-decisions:
  - "Fix-up YAML quoting rather than relax the contract: the post-amendment
    contract intentionally requires `z.string().datetime({offset:true})`. Quoting
    the source is the single-source-of-truth fix — the contract stays strict and
    gray-matter's YAML-1.2 timestamp rule becomes inert."
  - "Author the malformed tree under tests/fixtures/ not evals/fixtures/.
    The directory boundary lets v1-baseline scans (and future Phase-3 schema
    lints) safely traverse `evals/fixtures/` without filtering."
  - "Use atlas-fixture as the DocId authority across all new evidence /
    superseded_by references — matches the existing single fixture file that
    already used `obsidian-fs://atlas-fixture/...` in evidence lists."
  - "Test invokes validateAgentWrite directly for the `agent_write_outside_sink`
    case rather than asserting via propertiesSchema — that fixture is
    structurally valid; only Guard B catches it. Splitting the assertion path
    keeps each fixture's reason code unambiguous."

patterns-established:
  - "Quoted ISO datetimes in fixture YAML — required for any Phase-3+ fixture
    that needs to validate against default-memory-v1 or brief-memory-v1."
  - "expected_reason + expected_key in malformed-fixture frontmatter —
    reusable shape for future Guard A / Guard B failure-mode fixtures."

requirements-completed:
  - MEM-10

# Metrics
duration: 35min
completed: 2026-05-15
---

# Phase 02 Plan 07: Fixture Slice (MEM-10) Summary

**20-doc memory fixture with diverse provenance (confidence × type × status × age) plus a 5-doc malformed-memory tree under `tests/fixtures/`, both lit by a 35-assertion vitest smoke test that validates against `default-memory-v1` on every `npm test`.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-15T20:40:00Z (approx)
- **Completed:** 2026-05-15T21:16:32Z
- **Tasks:** 3 (per plan — Task 1 bundled into Task 2 per plan's explicit instruction)
- **Files created:** 12
- **Files modified:** 16

## Accomplishments

- Lifted the memory fixture from 15 → 20 docs with the previously missing provenance dimensions:
  - `confidence: uncertain` — first occurrence in the fixture
  - `type: hypothesis` — first occurrence
  - `type: decision` — first occurrence
  - `status: superseded` count went from 1 → 3 (the new A→B→C Spire chain)
- A→B→C Spire-budget supersede chain (2026-04-23-spire-budget-uncertain → 2026-04-24-spire-budget-revised → 2026-04-26-spire-budget-final) is in place with forward-only superseded_by and non-empty superseded_reason on the two superseded links, exercising the D-03 / Guard A supersede invariant end-to-end.
- Wave-0 lint closed: all 15 pre-existing docs now pass `DEFAULT_MEMORY_V1.propertiesSchema` (they failed before this plan because gray-matter was promoting unquoted ISO strings to JS `Date` objects).
- Authored a separate `tests/fixtures/malformed-memory/` tree with 5 deliberately-broken docs covering all five GuardFailure reason codes (missing_provenance × 2, invalid_provenance, supersede_mismatch, agent_write_outside_sink) plus a README explaining the tree's purpose and non-overlap with the clean fixture.
- `evals/v2-fixtures.test.ts` runs 35 assertions on every `npm test` and pins the fixture's structural invariants.

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: Audit existing 15 fixture docs + apply fix-ups + drop sentinel + author 5 net-new docs** — `e84f979` (test). Task 1's diagnostic findings were folded into the same commit per the plan's explicit "this task does not commit fix-ups in isolation — they are bundled with Task 2" directive.
2. **Task 3: Author malformed-memory tree + v2-fixtures smoke test** — `34e2092` (test)

_Plan metadata commit:_ included with this SUMMARY (separate from per-task commits).

## Files Created/Modified

**Created (5 net-new memory docs):**
- `evals/fixtures/v2-test-vault/_memory/observations/2026-04-23-spire-budget-uncertain.md` — chain link A; `confidence: uncertain` (new dimension)
- `evals/fixtures/v2-test-vault/_memory/observations/2026-04-23-hypothesis-warehouse-roi.md` — `type: hypothesis` (new), `confidence: inferred`
- `evals/fixtures/v2-test-vault/_memory/observations/2026-04-24-spire-budget-revised.md` — chain link B
- `evals/fixtures/v2-test-vault/_memory/observations/2026-04-26-spire-budget-final.md` — chain link C (live tip)
- `evals/fixtures/v2-test-vault/_memory/observations/2026-04-28-q2-okr-decision.md` — `type: decision`, `evidence: []` boundary case

**Created (malformed tree):**
- `tests/fixtures/malformed-memory/missing-observed-at.md` — Guard A `missing_provenance`
- `tests/fixtures/malformed-memory/missing-source.md` — Guard A `missing_provenance`
- `tests/fixtures/malformed-memory/invalid-confidence.md` — Guard A `invalid_provenance`
- `tests/fixtures/malformed-memory/supersede-no-target.md` — Guard A `supersede_mismatch`
- `tests/fixtures/malformed-memory/source-agent-no-evidence.md` — Guard B `agent_write_outside_sink`
- `tests/fixtures/malformed-memory/README.md` — purpose, table, non-overlap caveat

**Created (test):**
- `evals/v2-fixtures.test.ts` — 35-assertion vitest smoke test walking both trees

**Modified:**
- `evals/fixtures/v2-test-vault/_memory/.memory-sink` — rewritten to three-line k:v form matching `formatSentinelContent`
- `evals/fixtures/v2-test-vault/_memory/observations/2026-04-20-atlas-1-pilot-target-was-12.md` — `superseded_by` normalized to full DocId form + added `superseded_reason` (Guard A supersede invariant)
- 14 other docs under `_memory/observations/`, `_memory/_briefs/`, `_memory/status-updates/` — quoted `observed_at` (and `compiled_at` on briefs) ISO timestamps so gray-matter emits strings, not Date objects

## Decisions Made

See `key-decisions` in frontmatter. The most consequential is the YAML-quoting decision: relaxing the contract to accept `Date` was rejected because the contract is the runtime source of truth for `record_observation` / `supersede` writes, where the payload is JSON (always string).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Fix-ups expected to be hyphenated-key / enum-value drifts were actually YAML-Date-vs-string drifts.**
- **Found during:** Task 1 audit (`DEFAULT_MEMORY_V1.propertiesSchema.safeParse` on each existing doc).
- **Issue:** Plan §Task 1 predicted the drift would be hyphenated keys (`observed-at` / `superseded-by`) or pre-amendment `confidence` enum values, but the actual drift was 15/15 docs failing on `observed_at` because gray-matter (a YAML 1.2 parser) auto-promotes unquoted ISO 8601 strings to JS `Date` objects per the YAML `tag:yaml.org,2002:timestamp` rule. The contract requires `z.string().datetime({offset:true})`, which rejects `Date`.
- **Fix:** Quoted all `observed_at` and `compiled_at` ISO datetimes across the 15 existing docs via a single `perl -i -pe 's/^(observed_at|compiled_at): (...)$/$1: "$2"/'` sweep.
- **Files modified:** 11 observation/brief/status docs under `evals/fixtures/v2-test-vault/_memory/`.
- **Verification:** Re-ran the audit script; `Total docs: 20; drift: 0`. The wider `npm test` run shows 825 passing tests (1 chokidar timing flake unrelated to this plan, confirmed pre-existing by `git stash` re-run on the prior tree).
- **Committed in:** `e84f979` (part of the Task 2 commit, as the plan directed for Task 1's fix-ups).

**2. [Rule 2 — Missing critical] Added `superseded_reason` to the existing 2026-04-20 doc.**
- **Found during:** Task 2 fix-up.
- **Issue:** `2026-04-20-atlas-1-pilot-target-was-12.md` had `status: superseded` but no `superseded_reason`. The `DEFAULT_MEMORY_V1.superRefine` cross-field rule (D-03) demands a non-empty `superseded_reason` whenever `status === "superseded"`. Without it, the doc would fail Guard A with `supersede_mismatch`. The plan's action block mentioned this as part of the fix-up; the audit confirmed it was necessary.
- **Fix:** Added `superseded_reason: "Earlier count was based on stale ops report; corrected to 8 pilots after the 2026-04-16 OKR rewrite locked the warehouse-only scope."`
- **Files modified:** `evals/fixtures/v2-test-vault/_memory/observations/2026-04-20-atlas-1-pilot-target-was-12.md`.
- **Verification:** Doc now passes `propertiesSchema.safeParse`.
- **Committed in:** `e84f979`.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical). No Rule 4 architectural-decision deviations.
**Impact on plan:** Both deviations were anticipated by the plan's RESEARCH §Pitfall 1/2 framing — only the *symptom* of the YAML drift differed (Date vs hyphenated keys). No scope creep. The fix-up surface is exactly what Task 1+2 was designed to handle; the deviation is in the diagnosis, not the remediation.

## Issues Encountered

- **Pre-existing chokidar timing flake** in `src/adapters/change-feed/obsidian-fs/change-feed.test.ts > emits delete on an unlinked .md file`. First full-suite run showed 1 failure; second run (and isolated re-run on the prior tree via `git stash`) passed. Documented as known flake in the Phase 1 retrospective (see `0939c4b fix(quick): add test.retry(1) to 3 chokidar-timing-sensitive tests`). Not caused by this plan; this plan touches no watcher / chokidar / fs-event code.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 3 (assembly tools) can now consume the fixture and rely on the diverse confidence/type/status coverage for eval scenarios.
- The malformed tree is reusable: future plans needing additional Guard A / Guard B failure-mode coverage drop new fixtures under `tests/fixtures/malformed-memory/` with the same `expected_reason` / `expected_key` shape.
- ROADMAP Phase 2 success criterion 5 ("20-doc `_memory/` fixture with diverse provenance labels") is satisfied. MEM-10 fully closed.

## Self-Check

- `evals/fixtures/v2-test-vault/_memory/.memory-sink` — FOUND
- `evals/v2-fixtures.test.ts` — FOUND
- `tests/fixtures/malformed-memory/README.md` — FOUND
- 5 net-new observation docs — FOUND
- 5 malformed-memory docs — FOUND
- Commit `e84f979` (test: extend memory fixture to 20 docs + provenance fix-ups) — FOUND
- Commit `34e2092` (test: add malformed-memory tree + v2-fixtures smoke test) — FOUND
- `npx vitest run --no-coverage evals/v2-fixtures.test.ts` — 35/35 passing
- `npm run eval:baseline` — 30/30 passing (+ 11 todo)
- `bash scripts/lint-adapters.sh` — all 8 adapter-seam invariants green
- `npx tsc --noEmit` — clean

## Self-Check: PASSED

---
*Phase: 02-memory-namespace-provenance-contract*
*Completed: 2026-05-15*
