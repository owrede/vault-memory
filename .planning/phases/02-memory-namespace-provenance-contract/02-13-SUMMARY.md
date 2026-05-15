---
phase: 02-memory-namespace-provenance-contract
plan: 13
subsystem: memory
tags: [gap-closure, provenance, security, write-path, contract, types]
gap_closure: true
resolves: [WR-04, WR-07, IN-04]
forward_declares: [sentinel_check_failed]
requires:
  - 02-08 (record_observation controller)
  - 02-03 (WriteConflict union baseline)
provides:
  - "WriteConflict.reason: 'collision_retry_exhausted' literal (consumed by record_observation)"
  - "WriteConflict.reason: 'sentinel_check_failed' literal (forward declaration; consumed by Plan 02-10 in wave 10)"
  - "PROTECTED_PROVENANCE_KEYS server-side enforcement (D-02 refinement)"
affects:
  - src/memory/tools/record-observation.ts
  - src/memory/tools/record-observation.test.ts
  - src/adapters/delivery/types.ts
  - src/server.test.ts
tech-stack:
  added: []
  patterns:
    - "crypto.randomBytes for per-retry collision salts"
    - "Explicit Unicode escape form (\\u0300-\\u036F) for combining-mark regex"
    - "Defensive merge ordering: callerExtras first, sugar last for protected keys"
key-files:
  created: []
  modified:
    - src/adapters/delivery/types.ts
    - src/memory/tools/record-observation.ts
    - src/memory/tools/record-observation.test.ts
    - src/server.test.ts
decisions:
  - "D-02 REFINEMENT (not replacement): the 'caller properties win over sugar defaults' escape-hatch is explicitly scoped to non-provenance extras (tags, expires_at, priority, etc.). The 8 provenance-critical keys (source, evidence, confidence, observed_at, type, status, superseded_by, superseded_reason) are stripped from caller-supplied properties before merge so sugar always wins. The validator at DeliveryAdapter.write() (Plan 02-03) remains the single source of truth for which non-protected keys the contract accepts."
  - "Consolidated wave-9 types.ts edit: BOTH new WriteConflict.reason literals (collision_retry_exhausted AND sentinel_check_failed) added in a single edit owned by this plan, preventing a file-overlap with Plan 02-10 (which has been moved to wave 10 with depends_on: [02-08, 02-13] and consumes sentinel_check_failed downstream)."
  - "Defensive merge order (callerExtras first, sugarProps last) means even a hypothetical future filter-bypass cannot let caller-supplied protected keys reach the validator."
metrics:
  duration: "≈30 minutes wall clock"
  tasks_completed: 2
  files_modified: 4
  commits: 3
  completed: 2026-05-16
---

# Phase 2 Plan 13: Gap Closure — WR-04 / WR-07 / IN-04 + consolidated types.ts edit Summary

Closes three findings in `src/memory/tools/record-observation.ts` and consolidates the wave-9 `WriteConflict.reason` extension into a single edit so Plan 02-10 (wave 10) can consume the `sentinel_check_failed` literal without a file-overlap.

## What landed

**WR-04 (a)** — `record_observation` now returns
`{ok:false, reason:"collision_retry_exhausted", message: ...}` on retry exhaustion, NOT `permission_denied`. Callers can distinguish "vault is read-only" from "vary the claim text and retry" via the structured reason.

**WR-04 (b)** — per-retry collision salt is now `crypto.randomBytes(3).toString("hex")` instead of `String(attempt)`. Three identical same-millisecond calls now produce three different DocId suffixes — no deterministic 0/1/2 collision chain.

**WR-07** — D-02 refinement: `PROTECTED_PROVENANCE_KEYS` (8 keys: `source`, `evidence`, `confidence`, `observed_at`, `type`, `status`, `superseded_by`, `superseded_reason`) are stripped from caller-supplied `properties` before merge. Sugar values land LAST so they win unconditionally. Non-provenance extras (`tags`, `expires_at`, `priority`, etc.) still flow through — the D-02 escape-hatch is preserved for contract-allowed extras.

**IN-04** — `slugify` combining-mark regex now uses the explicit Unicode escape form `[̀-ͯ]` instead of literal combining characters that some editors / log aggregators silently drop into an empty char-class.

**Consolidated types.ts edit** — `WriteConflict.reason` extended with BOTH new literals (`collision_retry_exhausted` AND `sentinel_check_failed`) in a single edit, with a header comment noting the cross-plan coordination. Plan 02-10 (wave 10) will consume `sentinel_check_failed` from `ObsidianFsDelivery.preflight()` without touching `types.ts`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add `collision_retry_exhausted` + `sentinel_check_failed` to WriteConflict.reason | `f9b637f` | `src/adapters/delivery/types.ts` |
| 2a (RED) | Failing tests for WR-04, WR-07, IN-04 | `ecbec70` | `src/memory/tools/record-observation.test.ts` |
| 2b (GREEN) | Protect provenance keys + randomize collision salt + IN-04 regex | `c0d63f0` | `src/memory/tools/record-observation.ts`, `src/server.test.ts` |

## D-02 refinement — what changed, what was preserved

D-02 (locked by Plan 02-04) said: "caller-supplied keys in `properties` win over sugar defaults — escape-hatch for contract-allowed extras."

The phase-2 code-review (WR-07) showed this rule is unsafe when applied to provenance keys: a caller could pass `properties: { evidence: [] }` and the validator's audit trail would record `evidence: []` as "MCP-validated" even though the caller-supplied evidence array bypassed the Zod sugar-arg schema.

**The refinement:** D-02 still applies — caller properties STILL win over sugar — but the 8 provenance-critical keys are stripped from caller-supplied properties BEFORE the merge. So:

- `properties: { tags: ["a","b"], expires_at: "2030-01-01T00:00:00Z" }` → both keys land in the document verbatim. Escape-hatch preserved.
- `properties: { source: "user", evidence: [], confidence: "uncertain" }` → all three keys silently stripped before merge; the document records `source: "agent"`, `evidence: <args.evidence>`, `confidence: <args.confidence>` (sugar values).

Critically, the WR-07 fix is at the **controller layer** (before the merge); the validator at `DeliveryAdapter.write()` (Guard A/B, Plan 02-03) is unchanged. The single source of truth for "which non-protected keys the contract accepts" is still the contract's Zod `propertiesSchema`. This is a scope-narrowing refinement, not a behavior replacement.

## Cross-plan coordination — types.ts ownership

**Wave-9 file-overlap risk eliminated.** This plan (02-13) and Plan 02-10 both originally proposed adding a literal to `WriteConflict.reason`:
- 02-13: `collision_retry_exhausted` (consumed here in Task 2 of this plan).
- 02-10: `sentinel_check_failed` (consumed by `ObsidianFsDelivery.preflight()`).

In a parallel wave-9 execution that would race on `src/adapters/delivery/types.ts`. The resolution: this plan owns the consolidated single edit; Plan 02-10 was moved to wave 10 with `depends_on: [02-08, 02-13]` so its `preflight()` wiring can read the `sentinel_check_failed` literal already present in the union.

The `types.ts` header carries a `// Added in Plan 02-13; sentinel_check_failed is wired by Plan 02-10 in wave 10.` marker so future readers understand why both literals were added together.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] Updated obsolete D-02 caller-override assertion in `src/server.test.ts`**
- **Found during:** Task 2 (full-suite test run after GREEN implementation)
- **Issue:** `src/server.test.ts:686` had a pre-existing assertion that expected `caller-supplied source:'user'` to bubble up as `non_agent_write_inside_sink`. The WR-07 fix strips `source` from caller-supplied properties BEFORE merge, so the assertion no longer matches reality — the write now succeeds with sugar `source: "agent"`.
- **Fix:** Updated the assertion to expect `res3.ok === true` and `fm3.source === "agent"`. The new assertion verifies the WR-07 invariant in an end-to-end (server-level) context, complementing the unit-level it.each coverage in `record-observation.test.ts`.
- **Files modified:** `src/server.test.ts`
- **Commit:** `c0d63f0`

No other deviations. The plan's 8 protected-key list, merge ordering, salt-randomization, regex form, and reason-code additions all landed exactly as specified.

## Tests added

| Test | Coverage |
|---|---|
| `WR-07: caller-supplied properties.{source\|evidence\|confidence\|observed_at\|type\|status\|superseded_by\|superseded_reason} is stripped — sugar value survives` (it.each, 8 cases) | Each of the 8 protected keys cannot be overridden via the escape-hatch |
| `WR-07: caller-supplied non-provenance extras flow through (D-02 refinement preserves extras)` | `tags`, `expires_at`, `priority` flow through unchanged |
| `WR-04: returns collision_retry_exhausted (NOT permission_denied) when 3 retries fail` | Exhaustion returns the new structured reason |
| `WR-04: each collision retry mints a DIFFERENT random salt (not deterministic '0','1','2')` | `Set(suffixes).size === 3` after 3 attempts |
| `IN-04: slugify strips combining diacritical marks (Unicode escape form)` | `slugify("café résumé")` → DocId contains `cafe-resume` |

Existing 02-04 tests retained (happy path, observed-at-driven naming, DocId-collision retry behavior, sink/vault-mismatch, unknown-sink throw).

## Verification

- `npx vitest run --no-coverage src/memory/tools/record-observation.test.ts` → 17 passed
- `npm test` → **833 passed | 11 todo (844 total)** — 0 failures
- `npx tsc --noEmit` → clean
- `bash scripts/lint-adapters.sh` → all 9 invariants green (I-1..I-6, I-5b, C-1)
- Acceptance-criteria grep audit:
  - `grep -nE "PROTECTED_PROVENANCE_KEYS" src/memory/tools/record-observation.ts` → 2 matches (decl + use)
  - `grep -nE "randomBytes" src/memory/tools/record-observation.ts` → 2 matches (import + call)
  - `grep -nE "collision_retry_exhausted" src/memory/tools/record-observation.ts` → 1 match (return reason)
  - `grep -nE 'String\(attempt\)' src/memory/tools/record-observation.ts` → **0 matches** (deterministic salt removed)
  - `grep -nE "\\\\u0300-\\\\u036[fF]" src/memory/tools/record-observation.ts` → 1 match (explicit escape)
  - `grep -nE "collision_retry_exhausted|sentinel_check_failed" src/adapters/delivery/types.ts` → 5 matches (both literals in union + comment block)

## Success Criteria

- [x] WR-04 closed: callers see `collision_retry_exhausted` (distinct from `permission_denied`); retries have genuine randomness via `crypto.randomBytes(3)`.
- [x] WR-07 closed: provenance integrity is server-enforced; the audit trail can be trusted; D-02 refined (not replaced) to scope the escape-hatch to contract-allowed extras only.
- [x] IN-04 closed: combining-mark regex uses `̀-ͯ` escape form; source-stable across editor / log-aggregator round-trips.
- [x] File-overlap with Plan 02-10 eliminated: a single wave-9 plan owns `src/adapters/delivery/types.ts` edits; Plan 02-10 has been bumped to wave 10 with a dependency on this plan.
- [x] MEM-02 + MEM-05 + MEM-06 safety invariant strengthened: the chokepoint validator now sees the provenance the user-facing args specified, not a caller-controlled facsimile.

## TDD Gate Compliance

| Gate | Commit | Status |
|---|---|---|
| RED (failing tests) | `ecbec70` (`test(02-13): add failing tests for WR-04, WR-07, IN-04 (RED)`) | ✓ 9 tests RED |
| GREEN (implementation) | `c0d63f0` (`feat(02-13): protect provenance keys + randomize collision salt + IN-04 (GREEN)`) | ✓ all GREEN |
| REFACTOR | Not required — implementation landed minimal | n/a |

Task 1 (types.ts) was a non-behavioral types-only addition that does not require a RED/GREEN cycle on its own; the consumer-test for `collision_retry_exhausted` is in the RED suite of Task 2.

## Self-Check: PASSED

- Files exist:
  - FOUND: `src/adapters/delivery/types.ts` (extended)
  - FOUND: `src/memory/tools/record-observation.ts` (extended)
  - FOUND: `src/memory/tools/record-observation.test.ts` (extended)
  - FOUND: `src/server.test.ts` (one assertion updated)
- Commits exist:
  - FOUND: `f9b637f` — types.ts consolidated edit
  - FOUND: `ecbec70` — RED tests
  - FOUND: `c0d63f0` — GREEN implementation + server.test.ts assertion update
- Acceptance-criteria greps: see "Verification" section above.
- Test totals: 833 passed (up from 824 baseline = +9 new tests, accounting for the 3 replaced D-02 caller-override tests).
