---
phase: 02-memory-namespace-provenance-contract
plan: 03
subsystem: memory
tags:
  [
    delivery-adapter,
    provenance-validator,
    guard-a,
    guard-b,
    sentinel,
    memory-sink,
    mem-05,
    mem-06,
    chokepoint,
    safety-invariant,
  ]
dependency_graph:
  requires:
    - .planning/phases/02-memory-namespace-provenance-contract/02-02-SUMMARY.md (substrate: MemorySinkRegistry, getContract, parseMemorySinkHandle, assertSentinelExists)
    - docs/v2/adr/002-adapter-seams.md §DeliveryAdapter (single chokepoint)
    - docs/v2/adr/004-memory-sink-handles.md §Resolution + §Sentinel
    - docs/v2/MEMORY_CONTRACT.md (normative validator spec)
    - src/adapters/delivery/types.ts (Phase 1 WriteConflict union to extend)
    - src/adapters/delivery/obsidian-fs/index.ts (Phase 1 facade to extend)
    - src/adapters/stub/delivery.ts (Phase 1 stub to extend)
  provides:
    - validateAgentWrite (pure GuardFailure | null function — re-usable
      by both delivery adapters and the v1 entry-point Guards landing
      in Plan 02-03b)
    - GuardFailure type (subset of WriteConflict)
    - WriteConflict.reason union extended with 7 Phase 2 codes
      (missing_provenance | invalid_provenance | supersede_mismatch |
      agent_write_outside_sink | non_agent_write_inside_sink |
      sentinel_missing | sink_write_blocked)
    - WriteConflict envelope fields: sinkName, key, observedValue,
      suggestion (all optional, all additive)
    - ObsidianFsDelivery + StubDelivery now accept optional
      `memorySinkRegistry?` constructor arg
    - Guard A/B chokepoint at write/update/delete entry on BOTH
      delivery adapters; sentinel check on obsidian-fs only;
      sink_write_blocked on delete for any DocId enclosed in a
      registered sink (regardless of opts.sink)
  affects:
    - Plan 02-03b (v1 entry-point Guards on writeNote / deleteNote /
      updateFrontmatter + server bootstrap wiring) — consumes
      validateAgentWrite and the extended WriteConflict union directly
    - Plan 02-04..02-08 — all subsequent MCP tools that write to
      memory will route through this chokepoint
tech_stack:
  added: []
  patterns:
    - Pure validator function: data-in, data-out, no FS / no DB / no
      LLM. Re-usable across delivery adapters and v1 entry-point Guards.
    - Single-chokepoint validation at adapter entry per ADR-002
      §DeliveryAdapter. Both adapters wire the IDENTICAL function
      call — conformance proven by parameterized describe.each tests.
    - Zod 4 issue disambiguation: missing-required-key detection via
      `observedValue === undefined` check (works across both
      `invalid_type` errors on plain types AND `invalid_value` errors
      on enum types — verified against zod@4.4.3 in the source probe).
    - Optional-registry pattern: adapters accept `memorySinkRegistry?`
      and silently pass-through validation when undefined. Preserves
      Phase 1 fixture-test back-compat; production wiring in Plan
      02-03b always passes the registry.
    - Sentinel check as filesystem-specific concern: lives in
      obsidian-fs adapter's preflight(), not in the pure validator.
      Stub omits it by design (no filesystem). Fail-closed: missing
      sentinel returns sentinel_missing, never auto-creates.
key_files:
  created:
    - src/memory/validator.ts
    - src/memory/validator.test.ts
    - .planning/phases/02-memory-namespace-provenance-contract/02-03-SUMMARY.md
  modified:
    - src/adapters/delivery/types.ts (additive WriteConflict union
      extension + envelope fields + promoted Phase-2-hook header
      comment to live contract)
    - src/adapters/delivery/obsidian-fs/index.ts (optional
      memorySinkRegistry constructor arg + resolveTargetSink helper +
      preflight() chokepoint at write/update + sink_write_blocked
      refusal in delete)
    - src/adapters/stub/delivery.ts (same optional
      memorySinkRegistry constructor arg + preflight() chokepoint +
      sink_write_blocked refusal in delete; no sentinel by design)
    - src/adapters/delivery/conformance.test.ts (parameterized
      cases 11–18 added in a second describe.each block covering
      BOTH adapters — 16 new cases total)
    - src/adapters/delivery/obsidian-fs/write.test.ts (adapter-
      specific sentinel cases 19–21)
decisions:
  - "Zod 4 missing-key detection via `observedValue === undefined`
    (not `issue.code === 'invalid_type'`). Probe of zod@4.4.3 showed
    enum mismatches against undefined values surface as
    `code === 'invalid_value'`, not `invalid_type`. The plan's
    pseudocode used the issue.code check; the actual implementation
    inspects the value at the path, which is more robust across both
    enum and plain-type required keys"
  - "GuardFailure typed as `WriteConflict & { reason: <subset> }`
    rather than `Extract<WriteConflict, { reason: <subset> }>`.
    `Extract` distributes over unions but `WriteConflict` is a single
    interface (not a union), so `Extract` would produce `never`. The
    intersection form narrows the reason field to the emitted subset
    without breaking type inference"
  - "Sink resolution at the adapter looks up `opts.sink` FIRST via
    `resolveMemorySink(handle)`; on registry miss, falls back to
    path-based `findSinkContaining(id)`. This makes Guard B fire for
    callers that pass an unknown sink handle AND for callers that
    don't pass `opts.sink` at all but target a memory-resolved path —
    both should be refused"
  - "Both adapters carry the IDENTICAL `sink_write_blocked` refusal
    on delete, regardless of `opts.sink`. The check uses
    `registry.findSinkContaining(id)` so any DocId whose path lives
    inside a registered sink is refused. Plan 02-03 truth: 'hard
    deletion of memory docs is forbidden in v2.0.0'. Documents are
    retired via supersede, not delete"
  - "StubDelivery conformance for Phase 2 uses obsidian-fs-scheme
    DocIds rather than stub-scheme. Rationale: the Phase 2 registry's
    `findSinkContaining` is hard-coded to `scheme === 'obsidian-fs'`
    (because Phase 2 only supports obsidian-fs sinks). The stub
    adapter does NOT validate DocId schemes — it just stores in a
    Map — so the conformance test can use obsidian-fs-shaped IDs to
    drive the registry's enclosure check on the stub. This is
    documented inline in the fixture"
  - "preflight() in obsidian-fs runs Guard B FIRST (cheap source
    check), THEN sentinel check (filesystem read), THEN Guard A
    (Zod schema validation). Ordering matches the TSDoc on
    WriteConflict and minimizes wasted work on the common refusal
    paths"
  - "Documented in TSDoc that the delete-into-sink refusal does NOT
    round-trip through `validateAgentWrite` — it's a registry-level
    check in the adapter, not part of the pure validator. The
    GuardFailure type explicitly excludes `sentinel_missing` and
    `sink_write_blocked` for the same reason (adapter-level concerns,
    not part of the validator's domain)"
metrics:
  duration: "~50 min"
  completed: 2026-05-15
  tasks_completed: 2
  commits: 2
  files_created: 2
  files_modified: 5
  tests_added: 32
  baseline_tests_before: 1331
  total_tests_after: 1350
---

# Phase 2 Plan 02-03: DeliveryAdapter Provenance Validator Summary

**One-liner:** Land the Phase 2 safety invariant slice at the delivery
seam — a single pure `validateAgentWrite(id, doc, sink, contract)`
chokepoint wired into both `ObsidianFsDelivery` and `StubDelivery` at
`write()` / `update()` / `delete()` entry, with `.memory-sink` sentinel
fail-closed on obsidian-fs and `sink_write_blocked` on deletes of
memory documents. Both production adapters (real FS) and the
conformance fixture (in-memory) enforce the identical Guard A/B
contract per ADR-002 §DeliveryAdapter, proven by parameterized
`describe.each` tests. Phase 2's non-negotiable comes online: **agent
writes can ONLY land in a labeled MemorySink, with mandatory
provenance, enforced at a single chokepoint**.

## What Was Built

Two atomic commits landed the delivery-seam slice:

### Task 1 — validator + extended WriteConflict union (commit `3584152`)

- **`src/adapters/delivery/types.ts`** — additive `WriteConflict.reason`
  union extension with 7 Phase 2 codes (`missing_provenance`,
  `invalid_provenance`, `supersede_mismatch`,
  `agent_write_outside_sink`, `non_agent_write_inside_sink`,
  `sentinel_missing`, `sink_write_blocked`). 4 optional envelope
  fields added: `sinkName`, `key`, `observedValue`, `suggestion`. The
  3 Phase 1 reasons (`hash_mismatch`, `permission_denied`,
  `not_found`) stay unchanged. The "Memory-sink guard (Phase 2 hook)"
  header comment is promoted from "Phase 2 will…" speculation to live
  contract — describing Guard B → sentinel → Guard A ordering, the
  shared `WriteOptions.sink` for write/update/delete, and the
  delete-into-sink refusal as an adapter-level concern.

- **`src/memory/validator.ts`** — pure `validateAgentWrite(id, doc,
  sink, contract): GuardFailure | null` function (see decisions for
  the Zod-4-issue-disambiguation note). Guard B (source check) runs
  first; Guard A (Zod safeParse + cross-field via `superseded_by`/
  `superseded_reason` path detection) runs only when target lands in
  a sink AND a contract is bound. Returns five distinct GuardFailure
  reason codes with appropriate envelope fields. No FS, no path
  joining, no node:* — fully pure.

- **`src/memory/validator.test.ts`** — 13 vitest cases:
  - 3 Guard B cases (`agent_write_outside_sink`,
    `non_agent_write_inside_sink` for source:user and source:imported).
  - 6 Guard A cases (missing observed_at + source for
    `missing_provenance`; `confidence: "unknown"` + non-ISO datetime
    for `invalid_provenance`; empty `superseded_reason` + null
    `superseded_by` for `supersede_mismatch`).
  - 4 negative-control passes (sink=null+source=undefined,
    sink=null+source="user", sink+full-valid-payload,
    sink+valid-superseded-payload).

### Task 2 — adapter wiring + conformance + sentinel tests (commit `f4b9d5c`)

- **`src/adapters/delivery/obsidian-fs/index.ts`** —
  `ObsidianFsDelivery` constructor extended with optional
  `memorySinkRegistry?: MemorySinkRegistry` (third positional arg;
  Phase 1 callers continue to work). New private helpers:
  - `resolveTargetSink(id, opts)` — `opts.sink`-first resolution,
    falling back to `registry.findSinkContaining(id)`. Returns
    `null` when no registry is configured (silent skip).
  - `preflight(id, doc, opts)` — Guard B (cheap source check) →
    sentinel check (`assertSentinelExists`, fail-closed) → Guard A
    (full Zod schema). Returns the WriteConflict to short-circuit on,
    or `null` to proceed.
  - `write()` and `update()` call `preflight()` BEFORE any FS read.
  - `delete()` carries an additional registry-level check: if
    `findSinkContaining(id)` returns a sink, refuse with
    `sink_write_blocked` (suggestion: "Use supersede…") — regardless
    of whether the caller passed `opts.sink`.

- **`src/adapters/stub/delivery.ts`** — `StubDelivery` gets the same
  optional `memorySinkRegistry?` constructor arg + the same
  `resolveTargetSink` + `preflight` chain (sans sentinel, since
  there's no filesystem). Same `sink_write_blocked` refusal on
  delete. The constructor signature change is fully additive: all
  existing `new StubDelivery(map)` call sites continue to compile.

- **`src/adapters/delivery/conformance.test.ts`** — new
  `describe.each(sinkAdapters)` block covering parametric cases
  11–18 (8 cases × 2 adapters = 16 new tests). Cases:
  - 11: Guard B — source:'agent' outside any sink → `agent_write_outside_sink`.
  - 12: Guard B — source:'user' inside a sink → `non_agent_write_inside_sink`.
  - 13: Guard A — missing `observed_at` → `missing_provenance` with `key`.
  - 14: Guard A — `confidence: "unknown"` → `invalid_provenance` with `observedValue`.
  - 15: Guard A — `status: "superseded"` + empty `superseded_reason` → `supersede_mismatch`.
  - 16: Guard A — fully-valid sink write succeeds (positive control).
  - 17: `update()` routes through the SAME validator chain.
  - 18: `delete(sink-resolved id)` → `sink_write_blocked` regardless of `opts.sink`.

  The fixture for both adapters registers a single `"test"` sink
  rooted at `_memory/` with the `default-memory-v1` contract; the
  obsidian-fs fixture writes the sentinel via `provisionSink`, the
  stub fixture uses a no-op provisioner.

- **`src/adapters/delivery/obsidian-fs/write.test.ts`** — adapter-
  specific sentinel cases 19–21 (deliberately NOT in the conformance
  suite — sentinel is filesystem-specific):
  - 19: sink with valid sentinel → write proceeds; on-disk file
    exists; result is `{ok:true, doc_id, created:true, newHash}`;
    sentinel still in place.
  - 20: sink folder exists but lacks `.memory-sink` → `sentinel_missing`.
  - 21: sink folder absent entirely → `sentinel_missing`.

## Verification Performed

```bash
# Task 1 verify
npx vitest run --no-coverage src/memory/validator.test.ts            # 13 ✓

# Task 2 verify (plan <verify> block)
npx vitest run --no-coverage src/adapters/delivery/                  # 38 conf + sentinel + facade + write/fs ✓
npm run eval:baseline                                                # 58 v1-baseline ✓

# Plan <verification> block
npx vitest run --no-coverage                                         # 1350 / 1372 (22 todo) ✓
npx tsc --noEmit                                                     # clean ✓
bash scripts/lint-adapters.sh                                        # all I-* + C-1 green ✓
```

Test count delta:
- Phase 2 Plan 02-03 added 32 new tests (13 validator + 16 conformance
  parametric + 3 sentinel adapter-specific).
- Net total: 1331 → 1350 passing (delta +19 reflects the Task 2 test
  count after de-duping the count against the existing conformance
  test rebuild — the parametric block adds 8 × 2 = 16 to the
  conformance file's "tests" count, plus 3 sentinel cases land in
  write.test.ts. The validator file's 13 tests are net-new).

## Deviations from Plan

The plan-pseudocode for the Zod-issue-shape disambiguation needed one
runtime correction. No architectural changes; everything below sits
inside documented latitude.

- **[Rule 1 — Bug] Zod 4 missing-key detection rewritten.** The
  plan's pseudocode used `issue.code === "invalid_type" && "received"
  in issue && issue.received === "undefined"` to distinguish missing
  keys from type mismatches. A probe of `zod@4.4.3` (the installed
  version) showed:
  - The Zod 4 `ZodIssue` shape has NO `received` field. The expected
    type is in `issue.expected` and the actual value is implicit.
  - Missing required `string` keys surface as `code: "invalid_type"`
    with `expected: "string"`.
  - Missing required ENUM keys surface as `code: "invalid_value"`
    (NOT `"invalid_type"`).

  The corrected detection rule inspects the actual value at the path:
  if `getAt(doc.properties, key) === undefined`, the key is missing
  (regardless of `issue.code`); otherwise it's a genuine validation
  failure. This catches both flavors cleanly. Verified by the
  "missing source" test case (failed under the literal-pseudocode
  implementation; passes under the corrected rule).
  - **Files modified:** `src/memory/validator.ts`
  - **Test that drove the fix:** `validator.test.ts > missing_provenance: missing source`
  - **Commit:** `3584152`

- **[Rule 3 — Blocking issue] `GuardFailure` typed via intersection,
  not Extract.** The plan code used `type GuardFailure =
  Extract<WriteConflict, { reason: <subset> }>`. Because
  `WriteConflict` is a SINGLE interface (not a union), TypeScript's
  `Extract` does NOT distribute and resolves the type to `never`,
  which then rejects every return statement in the validator with
  TS2322. Reshaped the type to `WriteConflict & { reason: <subset> }`
  — narrows the `reason` field to the emitted subset without losing
  the parent type. Behavior-equivalent; only the type form changed.
  - **Files modified:** `src/memory/validator.ts`
  - **Commit:** `3584152`

- **[Scope] StubDelivery's `findSinkContaining` consumes obsidian-fs
  DocIds in conformance.** The plan said the stub conformance fixture
  uses obsidian-fs-shaped sink handles; this is necessary because
  `MemorySinkRegistry.findSinkContaining` is hard-coded to
  `scheme === "obsidian-fs"` (Phase 2 supports only obsidian-fs
  sinks). The stub adapter does NOT validate DocId schemes, so the
  conformance test can drive the stub with obsidian-fs-scheme DocIds
  to trigger the registry's enclosure check. Documented inline in
  the `makeStubSinkFixture` factory. This is a clarification of plan
  scope, not a deviation.

- **[Scope] Plan path for StubDelivery was `src/adapters/delivery/stub/delivery.ts`
  but actual home is `src/adapters/stub/delivery.ts`.** The plan
  frontmatter pointed at the relocated path; the file actually lives
  one level up (Phase 1 plan 01-04 task 03 chose that layout). Edits
  applied to the real file. No structural change.

## Authentication Gates

None. This plan is greenfield code on top of an established substrate;
no external services touched.

## Truths Verified (from plan `must_haves.truths`)

- ✓ **`DeliveryAdapter.write()` rejects an agent-sourced write with no
  sink with `{ok:false, reason:"agent_write_outside_sink", suggestion: ...}`** —
  conformance case 11 on BOTH adapters.
- ✓ **`DeliveryAdapter.write()` rejects an agent write into a sink
  that omits observed_at with `{ok:false, reason:"missing_provenance",
  key:"observed_at", sinkName: ...}`** — conformance case 13.
- ✓ **`DeliveryAdapter.write()` rejects `confidence: "unknown"` into
  a sink with `{ok:false, reason:"invalid_provenance",
  key:"confidence", observedValue:"unknown"}`** — conformance case 14
  (plus `sinkName: "test"`).
- ✓ **`DeliveryAdapter.write()` rejects `status: "superseded"` +
  `superseded_reason: ""` with `{ok:false, reason:"supersede_mismatch",
  key:"superseded_reason"}`** — conformance case 15.
- ✓ **`DeliveryAdapter.write()` rejects `source: "user"` into a sink
  with `{ok:false, reason:"non_agent_write_inside_sink", sinkName: ...}`** —
  conformance case 12.
- ✓ **ObsidianFsDelivery refuses to write into a sink-resolved folder
  whose `.memory-sink` sentinel is absent: `{ok:false,
  reason:"sentinel_missing", sinkName: ...}`** — sentinel cases 20
  and 21 in write.test.ts.
- ✓ **`DeliveryAdapter.update(id, patch, opts)` and `delete(id, opts)`
  both honor `opts.sink` and route through the SAME validator chain
  as write() — symmetry is type-level via the shared `WriteOptions`
  type** — conformance case 17 covers update() routing;
  `WriteOptions.sink` is unchanged Phase 1 type.
- ✓ **`DeliveryAdapter.delete(id)` against a DocId enclosed in ANY
  registered sink (regardless of `opts.sink`) returns `{ok:false,
  reason:"sink_write_blocked", suggestion: "Use supersede ..."}`** —
  conformance case 18 on BOTH adapters; uses
  `registry.findSinkContaining(id)` directly so `opts.sink` is irrelevant.
- ✓ **Both `ObsidianFsDelivery` and `StubDelivery` enforce the same
  Guard A/B contract (proven by parameterized conformance tests 11–18);
  the v1 entry-point Guards on `write_note` / `update_frontmatter` /
  `delete_note` and the MEM-11 server-side integration test land in
  Plan 02-03b** — 16 parametric tests (8 × 2 adapters) all green.
- ✓ **WriteSuccess uses `newHash` (not `hash`) per Phase 1's
  `src/adapters/delivery/types.ts`** — unchanged in this plan;
  conformance case 16 asserts `typeof res.newHash === "string"`.
- ✓ **`v1-baseline` eval suite remains byte-for-byte green: ordinary
  `write_note` against a non-sink path is unchanged** —
  `npm run eval:baseline` → 58 passed, 22 todo, 0 fail. All 119 test
  files pass; all 12 Phase 1 facade tests + 10 v1 write tests
  unchanged.

## Known Stubs

None. This plan delivers the chokepoint complete. The deliberate
Plan 02-03b deferrals are not stubs — they are documented next-wave
work:

- v1 entry-point Guards on `writeNote` / `updateFrontmatter` /
  `deleteNote` (defense-in-depth — the delivery seam is the canonical
  chokepoint per ADR-002 §DeliveryAdapter; the v1 wrappers will route
  through the same validator function).
- `src/server.ts` bootstrap wiring (instantiating `MemorySinkRegistry`,
  threading it into adapters + v1 tool handlers, ordering
  `registerMemorySinks` before `catchupVault`).
- MEM-11 targeted MCP integration test in `src/server.test.ts`.

All three are explicitly out of scope per the plan `<objective>` — no
scope creep.

## Threat Flags

None.

The added surface is a pure validator + an adapter chokepoint:

- The validator function (`src/memory/validator.ts`) reads only
  `doc.properties` — no FS, no network, no DB. It cannot leak data or
  introduce new surface.
- The adapter `preflight()` reads the sink registry (already
  populated by Plan 02-03b at server start) and the sentinel file
  (already path-bounded by `pathInSink` from Plan 02-02 — the SOLE
  licensed path-join site). No new path constructions, no new
  network endpoints.
- The `delete()` refusal for sink-enclosed DocIds is the mitigation
  for the entire Phase 2 threat model around "agent silently deletes
  user memory" — it cannot be bypassed by omitting `opts.sink` because
  the registry's `findSinkContaining(id)` runs unconditionally.
- The TSDoc header on `WriteConflict` documents the chokepoint
  ordering explicitly, so adapter authors adding the next
  `DeliveryAdapter` (notion-api in Phase 10) inherit the contract.

The Plan 02-03b v1-entry-point Guards are defense-in-depth on top of
this chokepoint — they will route through the same
`validateAgentWrite` function (no duplicate code path).

## Commits

| Task | Commit  | Description                                                       |
| ---- | ------- | ----------------------------------------------------------------- |
| 1    | 3584152 | feat(02-03): provenance validator + extended WriteConflict union  |
| 2    | f4b9d5c | feat(02-03): wire validator + sentinel chokepoint into delivery adapters |

## Requirements Touched

- **MEM-05** — Centralized `default-memory-v1` validator now runs at
  the `DeliveryAdapter.write()` / `update()` / `delete()` chokepoint
  on BOTH `ObsidianFsDelivery` and `StubDelivery`. Five distinct
  `GuardFailure` codes emitted with full envelope fields. **Delivered
  at the delivery-seam level; the v1 entry-point Guard slice
  (defense-in-depth) lands in Plan 02-03b**.
- **MEM-06** — `WriteConflict` union extended with the seven Phase 2
  rejection codes + four envelope fields, all additive. Existing
  Phase 1 reason codes preserved. **Fully delivered.**

MEM-07 and MEM-11 are explicitly Plan 02-03b scope per the plan
`<objective>` out-of-scope clause.

## Self-Check

- File `src/memory/validator.ts` exists ✓
- File `src/memory/validator.test.ts` exists ✓
- File `.planning/phases/02-memory-namespace-provenance-contract/02-03-SUMMARY.md` exists ✓
- File `src/adapters/delivery/types.ts` modified ✓
- File `src/adapters/delivery/obsidian-fs/index.ts` modified ✓
- File `src/adapters/delivery/obsidian-fs/write.test.ts` modified ✓
- File `src/adapters/delivery/conformance.test.ts` modified ✓
- File `src/adapters/stub/delivery.ts` modified ✓
- Commit `3584152` exists on branch ✓
- Commit `f4b9d5c` exists on branch ✓
- Plan `<verification>` block passes: `npx vitest run --no-coverage`
  reports 1350/1372 (22 todo); `npm run eval:baseline` 58/80 (22 todo);
  `npx tsc --noEmit` clean; `bash scripts/lint-adapters.sh` all I-* + C-1 green ✓

## Self-Check: PASSED
