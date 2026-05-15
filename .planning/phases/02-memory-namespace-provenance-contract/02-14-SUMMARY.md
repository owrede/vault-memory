---
phase: 02-memory-namespace-provenance-contract
plan: 14
subsystem: memory-sink-safety
tags: [gap-closure, WR-05, WR-08, occ, audit, hashProtected]
gap_closure: true
resolves: [WR-05, WR-08]
requirements: [MEM-05, MEM-06, MEM-08]
wave: 11
depends_on: [02-08, 02-10]
dependency_graph:
  requires:
    - src/adapters/delivery/obsidian-fs/index.ts (Plan 02-10's sentinel-check preflight wiring; already in wave 10)
    - src/memory/registry.ts (findSinkContaining — unchanged)
  provides:
    - update() honors hashProtected:"strong" — callers must supply opts.expectedHash
    - is_memory_sink_write audit flag derived from resolved-target truth, not caller intent
    - isMemorySinkWriteFor(id) helper consolidates the derivation across write/update/delete
  affects:
    - any caller of ObsidianFsDelivery.update() that previously omitted opts.expectedHash (NONE in production — record_observation/supersede/update_frontmatter all supply it)
    - any future bypass that lands inside a sink without routing through opts.sink — now correctly flagged in the audit log
tech_stack:
  added: []
  patterns:
    - resolved-target derivation for audit fields (vs. caller-intent signals) — closes defense-in-depth gap
    - mandatory OCC tokens for hashProtected="strong" adapters (matches existing delete() shape)
key_files:
  created: []
  modified:
    - src/adapters/delivery/obsidian-fs/index.ts
    - src/adapters/delivery/obsidian-fs/index.test.ts
    - src/adapters/delivery/conformance.test.ts
key_decisions:
  - 'WR-05 refusal placed AFTER preflight (so sink/Guard errors win) and BEFORE safeJoinInsideVault — symmetric with delete() which probes for not_found first. Conformance test #5 + filesystem-invariant test updated to supply a placeholder expectedHash so the not_found path remains reachable; StubDelivery still publishes hashProtected:"none" and is unaffected.'
  - 'WR-08 derivation extracted into a single private helper (isMemorySinkWriteFor) called from all three operations. Avoids duplicated `?? null` logic and lets a future read of the audit-flag invariant happen at one site.'
  - 'No-registry fallback returns false (preserves Phase 1 fixture constructors that omit the registry).'
  - 'computeNoteHash import in index.ts removed (it was the only consumer of the now-deleted silent fallback).'
metrics:
  duration: '~8 min wall'
  completed: 2026-05-16T01:14:30Z
  files_touched: 3
  tests_added: 8  # 3 WR-05 + 5 WR-08
  tests_passing_total: 884
---

# Phase 02 Plan 14: WR-05 + WR-08 gap-closure — update() OCC + is_memory_sink_write derivation summary

Closes two `WriteConflict`-layer findings on `ObsidianFsDelivery` in `src/adapters/delivery/obsidian-fs/index.ts`:

- **WR-05** — `update()` no longer silently fabricates `opts.expectedHash` from the on-disk hash. Callers MUST supply the OCC token; omission returns `{ ok: false, reason: "hash_mismatch", message: "update() requires opts.expectedHash for hashProtected=\"strong\" adapters" }`. The `hashProtected: "strong"` capability descriptor is now honest across `write` / `update` / `delete`.
- **WR-08** — The `is_memory_sink_write` audit-row flag is now derived from `registry.findSinkContaining(id) !== null` (resolved-target truth) rather than `opts.sink !== undefined` (caller intent). Applied symmetrically to `write` / `update` / `delete` via a single private helper `isMemorySinkWriteFor(id)`. No-registry fallback returns `false` (Phase 1 fixture back-compat).

## Tasks executed

### Task 1 (commits 8147c91 + 6b45add) — WR-05 refusal

- RED (8147c91): added 3 failing tests covering update with no opts, update with empty opts, and update with correct expectedHash (success baseline). Updated the existing `update(unknown id) → not_found` test to supply a placeholder expectedHash so the not_found path stays reachable.
- GREEN (6b45add): added the refusal block right after preflight, removed the silent `existingHash`/`effectiveExpectedHash` computation, dropped the now-unused `computeNoteHash` import, and updated conformance test #5 + the filesystem-invariant test to supply expectedHash where required (mirroring the conditional `opts` pattern used by conformance test #4).

### Task 2 (commits ddffa3f + 1977d9b) — WR-08 derivation

- RED (ddffa3f): added 5 new tests in a dedicated `describe` block — write-inside-sink, update-inside-sink (both expected to flag true), delete-inside-sink (refused upstream with sink_write_blocked; parallel symmetry), write-outside-sink with registry (false), write with no registry (false).
- GREEN (1977d9b): added private helper `isMemorySinkWriteFor(id)` and replaced the three `opts?.sink !== undefined` call sites in `write` / `update` / `delete`. Updated the inline comments at each call site to reference WR-08 and the resolved-target derivation.

## Verification

| Check | Result |
|------|--------|
| `npx vitest run --no-coverage src/adapters/delivery/obsidian-fs/index.test.ts` | 20 tests passing (8 new) |
| `npx vitest run --no-coverage src/adapters/delivery/obsidian-fs/sentinel.test.ts` | 15 tests passing (02-10 wiring intact) |
| `npx vitest run --no-coverage src/adapters/delivery/obsidian-fs/write.test.ts` | 23 tests passing (no regression in legacy write tests) |
| `npx vitest run --no-coverage src/memory/tools/record-observation.test.ts src/memory/resources/` | 27 tests passing (02-04 + 02-06 audit-row stamping unchanged) |
| `npx tsc --noEmit` | clean |
| `npm test` (full suite) | 884 passing / 11 todo |
| `npm run eval:baseline` | 30/30 |
| `bash scripts/lint-adapters.sh` | all 9 invariants green |
| Acceptance `grep -nE "update\(\) requires opts\.expectedHash"` | 1 match |
| Acceptance `grep -nE "computeNoteHash"` (post-fix) | 0 matches |
| Acceptance `grep -nE "isMemorySinkWriteFor"` | 4 matches (helper + 3 call sites) |
| Acceptance `grep -nE "isMemorySinkWrite: opts\?\.sink !== undefined"` | 0 matches |

## Deviations from Plan

**One auto-fix during test authoring** (Rule 1 — Bug, caught by test):

- The first draft of the WR-08 update test used `confidence: "indirect"` as the new value. The `DEFAULT_MEMORY_V1` contract restricts `confidence` to the enum `"direct" | "inferred" | "uncertain"`, so Guard A's invalid_provenance refusal fired before the audit row was written. Changed the test value to `"inferred"`. No production-code change.

**Two conformance-test updates required by WR-05 refusal:**

- Conformance test #5 (`update(unknown id) → not_found`) previously called `update()` without `opts.expectedHash`; after WR-05 this returned `hash_mismatch` instead of `not_found`. Updated to supply `{ expectedHash: "0".repeat(64) }` when the adapter publishes `hashProtected: "strong"`, mirroring the pattern in conformance test #4. StubDelivery (which publishes `hashProtected: "none"`) is unaffected.
- The adapter-specific "write produces a file on disk" filesystem-invariant test used `update()` as a not-found probe; same fix — supply the post-write `newHash` so the success path is exercised.

These are test-shape updates required by the new contract; they preserve the test intent (verify the success/not_found discrimination) under the now-honest OCC semantics.

## Stubs

None.

## Threat Flags

None. WR-05 + WR-08 both *strengthen* existing invariants (OCC honesty, audit-trail truthfulness) rather than introduce new surface.

## Self-Check: PASSED

Files verified:
- `src/adapters/delivery/obsidian-fs/index.ts` — FOUND
- `src/adapters/delivery/obsidian-fs/index.test.ts` — FOUND
- `src/adapters/delivery/conformance.test.ts` — FOUND
- `.planning/phases/02-memory-namespace-provenance-contract/02-14-SUMMARY.md` — FOUND

Commits verified:
- `8147c91` test(02-14): add failing tests for WR-05 update() expectedHash refusal — FOUND
- `6b45add` fix(02-14): WR-05 — refuse update() without opts.expectedHash — FOUND
- `ddffa3f` test(02-14): add failing tests for WR-08 is_memory_sink_write derivation — FOUND
- `1977d9b` fix(02-14): WR-08 — derive is_memory_sink_write from findSinkContaining(id) — FOUND
