# malformed-memory fixture

Five deliberately-broken memory documents used by Phase 2 validator unit
tests (MEM-10).

Each file's `expected_reason` frontmatter property names the rejection
code the `default-memory-v1` validator (Guard A) or `validateAgentWrite`
(Guard B) must produce.

| File | Expected reason | Expected key |
|------|-----------------|--------------|
| `missing-observed-at.md`     | `missing_provenance`        | `observed_at` |
| `missing-source.md`          | `missing_provenance`        | `source`      |
| `invalid-confidence.md`      | `invalid_provenance`        | `confidence`  |
| `supersede-no-target.md`     | `supersede_mismatch`        | `superseded_by` |
| `source-agent-no-evidence.md`| `agent_write_outside_sink`  | —             |

## Do not move these into the clean fixture tree

`evals/fixtures/v2-test-vault/_memory/` is the CLEAN tree consumed by the
v1-baseline eval suite. Moving malformed docs in would either skip the
v1-baseline scan or fail it.

Greps in the clean-fixture tree (e.g. the hyphenated-key check in Plan
02-07 Task 2's verify block, or any future Phase-3 schema lint) MUST
exclude this directory by living under `evals/fixtures/` only — this
malformed tree is under `tests/fixtures/` for that reason.

## Why `expected_reason` is in frontmatter

The `default-memory-v1` `propertiesSchema` uses `.passthrough()` (per
Plan 02-02 ADR-001 D-02), so unknown contract-extra keys do not break
validation. That lets us co-locate the *expected outcome* with the
fixture itself rather than maintaining a parallel JSON manifest.
