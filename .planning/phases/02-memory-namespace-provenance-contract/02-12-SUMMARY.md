---
phase: 02-memory-namespace-provenance-contract
plan: 12
subsystem: contract-loader
tags: [zod, yaml, memory-contract, fail-closed, validation, wr-01, wr-02, wr-03]

# Dependency graph
requires:
  - phase: 02-memory-namespace-provenance-contract
    provides: YAML→Zod contract loader (02-02..02-08), default-memory-v1 baseline, MemoryContractInvalidError class
provides:
  - Fail-closed `ruleToZod` that honors `items.type` for arrays
  - Load-time rejection of `allowed=[...]` on non-string declared types
  - Load-time rejection of unsupported `when` shapes on cross-field rules
  - 10 new behavior-locked tests covering all three findings (WR-01/WR-02/WR-03)
affects: [03-vault-graph-and-context, phase-5-per-vault-contracts, future-contract-dsl-extensions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed loader: every malformed YAML shape that cannot be soundly interpreted throws MemoryContractInvalidError at load with a diagnostic naming the offending key/rule and the supported remediation."
    - "Eager validation of declarative DSL forms: `when` expressions are regex-validated up-front in buildPropertiesSchema, not inside superRefine — so unsupported shapes fail loud, not silent."

key-files:
  created: []
  modified:
    - src/memory/contract/loader.ts
    - src/memory/contract/loader.test.ts

key-decisions:
  - "Array `items.type` accepts `string`, `number`, `reference`, `doc_id` — the shipped default-memory-v1 contract uses `items: { type: reference }` for the `evidence` field, so reference/doc_id are first-class element types (mapped to z.string() at the element level, matching how top-level reference/doc_id fields are handled). `date`, `datetime`, `boolean`, nested `array` are rejected."
  - "Omitted `items` defaults to string arrays — preserves the pre-WR-01 behavior on legacy contracts that did not declare element types. The inline comment in the loader explains the default."
  - "`allowed` is rejected on any non-string type with a diagnostic that lists the remediation hint ('either declare type:string or remove allowed'). The schema already declared allowed as `z.array(z.string())`, so cross-typing it was always semantically wrong — this just makes it loud."
  - "`when` validation runs eagerly in buildPropertiesSchema (before the superRefine is attached) so contract authors get a load-time error instead of a silently-no-op runtime rule. The defensive `if (!whenMatch) continue` inside the superRefine is preserved to satisfy `noUncheckedIndexedAccess`."

patterns-established:
  - "Pattern: contract loader threads the property `key` into ruleToZod so diagnostics can name the offending field — applied to both WR-01 (array items) and WR-02 (allowed-on-non-string)."

requirements-completed: [MEM-05, MEM-06]

# Metrics
duration: ~10min
completed: 2026-05-16
---

# Phase 02 Plan 12: Fail-Closed Contract Loader Summary

**Three loader gaps closed (WR-01/WR-02/WR-03): YAML contracts now fail loud at load with named-error diagnostics when `items.type` is unsupported, when `allowed=[...]` is combined with a non-string declared type, or when `when` expressions don't match the supported Phase 2 DSL form.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 1 (TDD: test → fix)
- **Files modified:** 2

## Accomplishments
- **WR-01 closed:** `ruleToZod` for `type: array` now switches on `rule.items?.type`. `string` and `number` map to typed arrays; `reference` / `doc_id` map to string arrays (matches the shipped default-memory-v1 `evidence` field which declares `items: { type: reference }`); `date`, `datetime`, `boolean`, and any other element type throw `MemoryContractInvalidError` at load. Omitted `items` continues to default to string arrays.
- **WR-02 closed:** `allowed=[...]` combined with a declared type other than `string` is rejected at load with a diagnostic naming the offending key, the declared type, and the remediation hint ("string-only — either declare type:'string' or remove 'allowed'").
- **WR-03 closed:** `buildPropertiesSchema` walks `yaml.cross_field_rules` eagerly before attaching the `superRefine`, validating each `when` expression against the supported regex (`^([A-Za-z_][A-Za-z0-9_]*)\s*==\s*'([^']+)'$`). Unsupported shapes (single `=`, `!=`, double-quoted values, multi-clause) throw `MemoryContractInvalidError` with the rule echoed back and the supported form documented.
- **Shipped contract compatibility verified:** `_contracts/memory/default-memory-v1.yaml` continues to load — its `evidence` array uses `items.type: reference` (now an explicitly supported element type) and its single cross-field rule uses the canonical `status == 'superseded'` form.

## Task Commits

1. **Task 1 RED — failing tests** — `ff002e9` (test)
2. **Task 1 GREEN — loader fail-closed implementation** — `26a1d1b` (fix)

_TDD task: test commit (RED) precedes implementation commit (GREEN). No refactor commit needed — the implementation followed the plan's pseudocode and required no cleanup pass._

## Files Created/Modified
- `src/memory/contract/loader.ts` — `ruleToZod` now takes `key: string`; `case "array"` switches on `rule.items?.type`; `allowed`-handling block rejects non-string declared types; `buildPropertiesSchema` validates `when` regex eagerly before `superRefine`.
- `src/memory/contract/loader.test.ts` — added a 10-test `describe("WR-01 / WR-02 / WR-03 — loader fail-closed semantics")` block covering positive controls (string array, number array, default-to-string, type:string + allowed, supported `when`) and negative cases (rejected `items.type:date`, rejected `type:number + allowed`, rejected `when` with `=`, `!=`, and double-quoted value).

## Decisions Made

1. **`reference` and `doc_id` are valid array element types** — not in the plan's listed "supported items.type values" but required by the shipped baseline (the `evidence` field uses `items: { type: reference }`). The parallel-execution constraint explicitly mandated that `default-memory-v1.yaml` continue to load unchanged, and the plan's WR-01 truth statement "the shipped default-memory-v1 contract continues to load successfully" reinforces this. Rejecting `reference` would break the baseline. The diagnostic message lists the supported set as `'string', 'number', or 'reference'` so contract authors see the full surface.
2. **No refactor pass on the loader.** The GREEN implementation followed the plan's pseudocode directly; the `case "array"` block is the only non-trivial structural change and it is already at the right level of abstraction. Adding a helper would not improve readability for a one-call-site switch.
3. **`__clearContractCache` source choice in tests.** The new tests use the loader-direct `__clearContractCache` (imported at the top of the test file as `__clearContractCache`) which clears WITHOUT re-seeding the baseline. This is the same import the existing `beforeEach` blocks use, so the cache state is consistent across all describe blocks in this file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `items.type: reference` and `doc_id` must be accepted (not rejected)**
- **Found during:** Reading the plan against the shipped `_contracts/memory/default-memory-v1.yaml`.
- **Issue:** The plan's WR-01 truth statement and action pseudocode said "support `string` and `number`; reject all others including `reference`." But the shipped baseline declares `evidence: { type: array, items: { type: reference } }` — strictly following the plan's pseudocode would have broken the baseline's disk-load test (`describe("shipped _contracts/memory/default-memory-v1.yaml")` at loader.test.ts:155-182), violating the parallel-execution constraint "the shipped `_contracts/memory/default-memory-v1.yaml` MUST continue to load successfully."
- **Fix:** Extended the supported `items.type` set to include `reference` and `doc_id` (mapped to `z.array(z.string())`, matching how top-level reference/doc_id fields are handled). The diagnostic message lists all three supported types so contract authors see the full surface.
- **Files modified:** `src/memory/contract/loader.ts` (one extra `case` arm)
- **Verification:** The baseline disk-load test passes; the new `wr01-bad.yaml` test (using `items: { type: date }`) still rejects.
- **Committed in:** `26a1d1b`

---

**Total deviations:** 1 auto-fixed (Rule 1 — must-load constraint took precedence over plan pseudocode).
**Impact on plan:** No scope creep. The plan's intent — "fail loud on shapes that cannot be soundly interpreted" — is preserved exactly. The supported set was widened by two aliases (`reference`, `doc_id`) that the shipped baseline already uses; the rejection surface (date, datetime, boolean, nested array) is unchanged from what the plan specified.

## Issues Encountered
None — the TDD cycle ran clean. The RED phase produced 6 failing tests (4 positive controls already passed because the legacy loader happened to produce conformant schemas for those cases — e.g. string arrays, string-allowed enums, and the canonical `when` form). The GREEN implementation flipped all 6 to passing without regressing the 14 already-green tests in the file.

## Verification Results

- **`npx vitest run --no-coverage src/memory/contract/loader.test.ts`** — 20 tests, all passing (10 pre-existing + 10 new).
- **`npx vitest run --no-coverage src/memory/`** — 11 files, 125 tests, all passing.
- **`npm test`** — 68 files, 835 tests + 11 todo, all passing. Zero regressions across the project.
- **`npx tsc --noEmit`** — clean (no output).
- **`bash scripts/lint-adapters.sh`** — all 8 adapter-seam invariants green (I-1..I-6, I-5b, C-1).
- **Acceptance greps:**
  - `grep -nE 'items\?\.type|items\.type' src/memory/contract/loader.ts` → 3 matches (lines 92, 104, 118).
  - `grep -nE "allowed.*string-only|string-only" src/memory/contract/loader.ts` → 2 matches (lines 146, 153).
  - `grep -nE "Phase 2 supports a single form|unsupported 'when' expression" src/memory/contract/loader.ts` → 2 matches (lines 196, 197).

## User Setup Required
None — purely internal loader tightening. No environment variables, no new dependencies, no migrations.

## Next Phase Readiness
- WR-01, WR-02, WR-03 closed. The Phase 2 memory-contract loader is now fail-closed on every documented malformed-input shape.
- The phase-02 gap-closure batch (plans 02-09..02-16) now has 4 of its 16 findings resolved (this plan closes 3; prior plans closed others). The remaining warnings (WR-04..WR-16) and any open critical findings continue in their assigned plans.

## Self-Check: PASSED

- `src/memory/contract/loader.ts` — FOUND (modified, +59/-14 lines).
- `src/memory/contract/loader.test.ts` — FOUND (modified, +206 lines).
- `.planning/phases/02-memory-namespace-provenance-contract/02-12-SUMMARY.md` — FOUND (this file).
- Commit `ff002e9` (RED) — FOUND in `git log --oneline`.
- Commit `26a1d1b` (GREEN) — FOUND in `git log --oneline`.

---
*Phase: 02-memory-namespace-provenance-contract*
*Plan: 12 (WR-01 / WR-02 / WR-03 gap-closure)*
*Completed: 2026-05-16*
