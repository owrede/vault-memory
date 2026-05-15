---
phase: 02-memory-namespace-provenance-contract
plan: 01
subsystem: docs
tags: [memory-contract, adr-004, provenance, doc-only, mem-12]
dependency_graph:
  requires:
    - docs/v2/adr/004-memory-sink-handles.md (existing Accepted ADR)
    - docs/v2/MEMORY_CONTRACT.md (existing canonical contract spec)
  provides:
    - byte-aligned ADR-004 / MEMORY_CONTRACT.md / fixture key naming
    - superseded_reason field formalised as optional + cross-field rule
    - amendment recorded under CHANGELOG [Unreleased] → Documentation
  affects:
    - Phase 2 plans 02-02..02-08 (validator, record_observation, supersede, recall)
      can now consume the contract without forking on key naming or confidence enum
tech_stack:
  added: []
  patterns: [doc-only amendment, cross-field provenance invariant]
key_files:
  created:
    - .planning/phases/02-memory-namespace-provenance-contract/02-01-SUMMARY.md
  modified:
    - docs/v2/adr/004-memory-sink-handles.md
    - docs/v2/MEMORY_CONTRACT.md
    - CHANGELOG.md
decisions:
  - "superseded_reason is OPTIONAL globally but REQUIRED (non-empty) when status === 'superseded'; Guard A enforces under supersede_mismatch reason code"
  - "Stale ADR-004 example enum [observed, inferred, user-confirmed] is removed; canonical confidence enum is [direct, inferred, uncertain] across docs"
  - "Underscored PropertyBag keys (observed_at, superseded_by, superseded_reason) are the single canonical form across ADR-004, MEMORY_CONTRACT.md, and the existing fixture"
metrics:
  duration: "~10 min"
  completed: 2026-05-15
  commits: 2
  tasks_completed: 2
  files_modified: 3
---

# Phase 2 Plan 01: ADR-004 Doc Amendment Summary

**One-liner:** Doc-only amendment ratifying underscored PropertyBag keys, the `[direct, inferred, uncertain]` confidence enum, and the new `superseded_reason` cross-field rule across ADR-004 + MEMORY_CONTRACT.md + CHANGELOG before any Phase 2 code reads the contract.

## What Was Built

Three targeted documentation edits resolving the three contract discrepancies identified in Phase 2 research:

### 1. ADR-004 (`docs/v2/adr/004-memory-sink-handles.md`) — amended

- Rewrote every hyphenated PropertyBag key in the `default-memory-v1` example YAML (`observed-at` → `observed_at`, `superseded-by` → `superseded_by`).
- Replaced `confidence: { allowed: [observed, inferred, user-confirmed] }` with `confidence: { allowed: [direct, inferred, uncertain] }` to match MEMORY_CONTRACT.md.
- Added optional property `superseded_reason: { type: string }` to the example YAML with a normative paragraph: when `status === "superseded"`, `superseded_reason` MUST be present and non-empty; Guard A enforces under the `supersede_mismatch` reason code.
- Updated the §Naming-strategies pattern (`"{observed_at:YYYY-MM-DD}-{slug}.md"`), the cross-sink references YAML example, and worked Examples A (folder-default) and B (Notion sketch) to use underscored keys + `confidence: direct`.
- Added a dated amendment footer: `**Amended: 2026-05-15 — Phase 2 plan 02-01** (underscored keys, confidence enum, superseded_reason).`

### 2. MEMORY_CONTRACT.md (`docs/v2/MEMORY_CONTRACT.md`) — extended

- Verified canonical underscored keys (`observed_at`, `superseded_by`) and confidence enum (`[direct, inferred, uncertain]`) were already in place; no stragglers found.
- Added a new `### superseded_reason` subsection under the `## Required properties` block (placed immediately after `### superseded_by` since the two are tightly paired). Documents:
  - Optional globally, required (non-empty string) iff `status === "superseded"`.
  - Validator behavior on missing-while-superseded → `supersede_mismatch` reason.
  - Validator behavior on invalid value → `invalid_provenance` reason.
  - Worked example showing the PropertyBag cell shape.
  - Plain-English rationale: the audit log can answer "why was this replaced?" without loading the replacement document.

### 3. CHANGELOG.md — entry added

Added a single line under `## [Unreleased] → ### Documentation`:

```
- ADR-004 amended: underscored PropertyBag keys, confidence enum aligned to [direct, inferred, uncertain], superseded_reason field added (Phase 2 plan 02-01).
```

Placed adjacent to the existing FND-03 ADR-004 amendment line (folder-default decision) for chronological grouping under the same ADR.

## Verification Performed

All plan-specified automated checks pass:

```bash
# Task 1 verify (ADR-004)
grep -E "observed-at|superseded-by|user-confirmed|observed,\s*inferred,\s*user-confirmed" \
  docs/v2/adr/004-memory-sink-handles.md | grep -v '^#' | grep -v 'Amended'
# → exits 1 (no matches outside Amended footer) ✓
grep -q "superseded_reason" docs/v2/adr/004-memory-sink-handles.md            # ✓
grep -q "direct, inferred, uncertain" docs/v2/adr/004-memory-sink-handles.md  # ✓
grep -q "Amended:.*Phase 2" docs/v2/adr/004-memory-sink-handles.md            # ✓

# Task 2 verify (MEMORY_CONTRACT + CHANGELOG)
grep -E "observed-at|superseded-by|user-confirmed" docs/v2/MEMORY_CONTRACT.md | grep -v '^#'
# → exits 1 (no matches) ✓
grep -q "superseded_reason" docs/v2/MEMORY_CONTRACT.md                        # ✓
grep -q "ADR-004 amended" CHANGELOG.md                                        # ✓

# Overall plan verification
grep -rE "observed-at|superseded-by|user-confirmed" docs/v2/                  # → no matches ✓
```

`npm test` was not run — the plan is doc-only and the v1 test suite touches no doc paths. Per plan's `<verification>` block: "`npm test` is unaffected (this plan does not touch test code)."

## Deviations from Plan

None. Plan executed exactly as written. Two minor structural decisions inside the documented latitude of each task:

- The §superseded_reason subsection in MEMORY_CONTRACT.md was placed under `## Required properties` (immediately after `### superseded_by`) rather than under `## Cross-field invariants`. The plan allowed "whichever fits the doc structure"; current MEMORY_CONTRACT.md uses per-property subsections (no top-level Cross-field invariants section exists), so co-locating with `superseded_by` is the documentary-cohesion choice and keeps the cross-field rule next to the field it constrains.
- The ADR-004 amendment footer was written as a single `**Amended: …**` line followed by a short prose paragraph rather than a single dense paragraph. This lets the verify grep `grep -v 'Amended'` cleanly exclude the header without false-positive matches on prose lines that happen to mention historical stale-key examples — so the verify pattern stays clean without HTML-comment tricks.

## Truths Verified (from plan `must_haves.truths`)

- ✓ ADR-004 example YAML uses underscored PropertyBag keys (`observed_at`, `superseded_by`, `superseded_reason`).
- ✓ ADR-004 and MEMORY_CONTRACT.md agree on confidence enum: `[direct, inferred, uncertain]`.
- ✓ `superseded_reason: string` documented as an optional contract property with the cross-field rule "required (non-empty) when `status === 'superseded'`".
- ✓ CHANGELOG `[Unreleased] → ### Documentation` notes the ADR-004 amendment.

## Authentication Gates

None.

## Known Stubs

None. This plan is doc-only and produces no code, no test stubs, and no placeholder data.

## Threat Flags

None. No new security-relevant surface introduced. The amendment tightens an existing validator invariant (Guard A's `supersede_mismatch` now covers two paired keys: `superseded_by` + `superseded_reason`), which is a defense-in-depth improvement, not a new surface.

## Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1    | aab862e | docs(02-01): amend ADR-004 with underscored keys, confidence enum, superseded_reason |
| 2    | 7771fea | docs(02-01): align MEMORY_CONTRACT and CHANGELOG with ADR-004 amendment |

## Requirements Closed

- **MEM-12** — ADR-004 amendment ratifying memory-contract field naming, confidence enum, and `superseded_reason` cross-field rule. Roadmap Phase 2 success criterion 5 ("ADR-004 amendment committed before implementation") satisfied; downstream Phase 2 plans (02-02 through 02-08) can now consume the contract without ambiguity.

## Self-Check: PASSED

- File `docs/v2/adr/004-memory-sink-handles.md` exists ✓
- File `docs/v2/MEMORY_CONTRACT.md` exists ✓
- File `CHANGELOG.md` exists ✓
- File `.planning/phases/02-memory-namespace-provenance-contract/02-01-SUMMARY.md` exists ✓
- Commit `aab862e` exists on branch ✓
- Commit `7771fea` exists on branch ✓
- All plan verify greps pass ✓
- Zero stale hyphenated PropertyBag keys remain in `docs/v2/` ✓
