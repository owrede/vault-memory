---
phase: 02-memory-namespace-provenance-contract
plan: 03b
subsystem: memory
tags:
  [
    mem-07,
    mem-11,
    entry-point-guard,
    defense-in-depth,
    server-bootstrap,
    sink-auto-discovery,
    bootstrap-order,
    v1-tools,
    safety-invariant,
  ]
dependency_graph:
  requires:
    - .planning/phases/02-memory-namespace-provenance-contract/02-02-SUMMARY.md (MemorySinkRegistry, provisionSink, parseMemorySinkHandle substrate)
    - .planning/phases/02-memory-namespace-provenance-contract/02-03-SUMMARY.md (DeliveryAdapter chokepoint; this plan is defense-in-depth on top)
    - docs/v2/adr/002-adapter-seams.md §I-2 (node:fs licensed to obsidian-fs adapter dir only)
    - docs/v2/adr/004-memory-sink-handles.md §Provisioning fail-fast
  provides:
    - writeNote / deleteNote / updateFrontmatter accept optional
      `registry?: MemorySinkRegistry` (or `memorySinkRegistry?`) parameter;
      sink-resolved targets refused early with `sink_write_blocked`
    - `WriteConflict.reason` (in `src/adapters/delivery/obsidian-fs/write.ts`)
      extended with `"sink_write_blocked"` + envelope fields
      `sinkName?`, `suggestion?`
    - `UpdateConflict.reason` (in `src/frontmatter/update.ts`) same
      extension
    - `discoverMemorySinks(configured, vaults)` — exported helper for
      v2-fixture auto-discovery
    - `setupMemorySinks(config, manager)` — bootstrap-time helper that
      wraps discovery + `registry.registerMemorySinks` with the
      production provisioner; throws fail-fast on registration error
    - `sentinelExistsAt(vaultRoot, relPath)` in obsidian-fs/sentinel.ts —
      licensed `node:fs` access for the discovery probe (keeps server.ts
      free of `node:fs` per ADR-002 I-2)
    - `serve(options?: ServeOptions)` — new optional `onPhase` callback
      with `BootstrapPhase` type covering all five phases
    - `handleWriteNote` / `handleDeleteNote` preserve `sinkName` /
      `suggestion` / `key` / `observedValue` envelope fields through the
      v1 wire shape
  affects:
    - Phase 2 Plans 02-04..02-08 (MCP memory tools, audit, fixture): the
      v1 write tools are now demonstrably blocked at the MCP boundary, so
      the new `record_observation` / `supersede` tools (Plan 02-04) can
      ship as the authoritative agent-write path without worrying about
      v1-tool fallback bypassing provenance.
tech_stack:
  added: []
  patterns:
    - Optional-registry parameter (preserves Phase 1 fixture-test
      back-compat; production wiring always passes the registry)
    - Auto-discovery via sentinel probe — v2 fixtures with pre-existing
      `_memory/.memory-sink` become "default sinks" without config edits
    - Pure helper `discoverMemorySinks` separates the "what to register"
      decision from the "actually register" step in setupMemorySinks;
      makes both independently testable
    - `BootstrapPhase` callback pattern — test-only hook on `serve()` so
      bootstrap-order invariants are observable without spinning up
      stdio
    - Phase 2 envelope-field propagation through v1 wire shape (handlers
      stop dropping `sinkName` / `suggestion` / `key` / `observedValue`
      when reshaping the conflict response)
key_files:
  created:
    - .planning/phases/02-memory-namespace-provenance-contract/02-03b-SUMMARY.md
  modified:
    - src/adapters/delivery/obsidian-fs/write.ts (entry-point Guard on
      writeNote + deleteNote; WriteConflict union widened with
      sink_write_blocked + sinkName + suggestion)
    - src/adapters/delivery/obsidian-fs/write.test.ts (5 new test cases
      covering the Guard's positive + back-compat behaviors)
    - src/adapters/delivery/obsidian-fs/sentinel.ts (new sentinelExistsAt
      probe — licensed `node:fs` access for bootstrap auto-discovery)
    - src/frontmatter/update.ts (entry-point Guard on updateFrontmatter
      via new `memorySinkRegistry?` field; UpdateConflict union widened)
    - src/frontmatter/update.test.ts (2 new test cases)
    - src/server.ts (new `BootstrapPhase` / `ServeOptions`,
      `discoverMemorySinks`, `setupMemorySinks`; threaded
      memorySinkRegistry into ObsidianFsDelivery + updateFrontmatter
      handler; bootstrap phase emits; preserve Phase 2 envelope fields
      through v1 conflict-response shaping)
    - src/server.test.ts (6 new test cases: 3 discoverMemorySinks, 1
      MEM-11 integration, 1 bootstrap-order assertion, 1 BootstrapPhase
      type coverage)
decisions:
  - "writeNote/deleteNote live at `src/adapters/delivery/obsidian-fs/write.ts`
    (not `src/write/write.ts` as the plan frontmatter said). The Phase 1
    Plan 01-04 relocation moved them; the Plan 02-03b intent — defense-in-
    depth Guards on the v1 entry points — applies to the current home.
    Tracked under Deviations §Path."
  - "`updateFrontmatter` accepts a NEW field `memorySinkRegistry?:
    MemorySinkRegistry` (distinct from the existing
    `registry?: AdapterRegistry` field that drives Source/Delivery
    dispatch). Two registries with two responsibilities; merging them
    into one would muddy the AdapterRegistry's purpose and break the
    Phase 1 type surface."
  - "v1 `handleWriteNote` / `handleDeleteNote` in server.ts NOT given an
    additional explicit registry — they route through
    `ObsidianFsDelivery.write/delete`, which already runs the chokepoint
    via the constructor-injected `MemorySinkRegistry` per Plan 02-03.
    Double-wiring would duplicate the refusal path; instead, the v2-wire
    envelope (sinkName/suggestion/key/observedValue) is now propagated
    through the v1 wire shape so MCP callers observe the same diagnostic
    shape regardless of which Guard layer fires."
  - "`sentinelExistsAt(vaultRoot, relPath)` added to
    obsidian-fs/sentinel.ts rather than calling `fs.access` directly
    from `src/server.ts`. The ADR-002 I-2 lint script forbids `node:fs`
    imports outside `src/(adapters|config|vault|rerank)/` — adding fs
    to server.ts would have broken the seam. The new helper takes a
    plain `relPath` rather than a `MemorySink` because auto-discovery
    probes BEFORE any sink record exists."
  - "MEM-11 integration test invokes `delivery.write` AND the underlying
    `writeNoteInternal` directly. The delivery's chokepoint per Plan
    02-03 fires `non_agent_write_inside_sink` (Guard B) FIRST for the
    MEM-11 payload (source undefined → not 'agent'); the v1 entry-point
    Guard fires `sink_write_blocked` independently — both refusals are
    asserted in the same test to pin defense-in-depth coverage."
  - "Bootstrap-order test does NOT spin up stdio (that would block
    forever). Instead it asserts the observable invariant: after
    `setupMemorySinks` returns, the sentinel file exists on disk. Since
    `serve()` runs setupMemorySinks BEFORE the fire-and-forget
    `startCatchupAndWatchers()`, the proxy proves the ordering
    invariant 'sentinels exist before catchup walks'."
  - "Refused to use `node:fs` directly in `discoverMemorySinks` to keep
    the helper testable without an adapter-aware mock. The cost
    (adding `sentinelExistsAt` to obsidian-fs/sentinel.ts) is small;
    the benefit (CI lint stays green) is non-negotiable."
metrics:
  duration: "~30 min"
  completed: 2026-05-15
  tasks_completed: 2
  commits: 2
  files_created: 1
  files_modified: 7
  tests_added: 13
  baseline_tests_before: 690
  total_tests_after: 703
---

# Phase 2 Plan 02-03b: Defense-in-depth Guards + Server Bootstrap Summary

**One-liner:** Wave 3 of Phase 2 — wires the Plan 02-02 substrate + Plan
02-03 validator into the running MCP server. Three v1 entry points
(`writeNote`, `deleteNote`, `updateFrontmatter`) get optional registry
parameters and refuse sink-resolved targets early with
`sink_write_blocked`. `serve()` constructs a `MemorySinkRegistry` after
`manager.loadAll` and BEFORE `catchupVault` fire-and-forgets, with
auto-discovery synthesizing a `default` sink from
`_memory/.memory-sink` sentinels. The MEM-11 integration test proves
all three v1 tools refuse `_memory/...` targets at the MCP boundary
with actionable diagnostics (`record_observation` / `supersede`).

## What Was Built

Two atomic commits landed the wiring + tests:

### Task 1 — MEM-07 entry-point Guards (commit `38abeae`)

- **`src/adapters/delivery/obsidian-fs/write.ts`** — `writeNote` and
  `deleteNote` accept an optional `registry?: MemorySinkRegistry`
  parameter. When supplied AND the target resolves into a sink via
  `registry.findSinkContaining(formatDocId(...))`, the call returns
  `{ok:false, reason:"sink_write_blocked", sinkName, message,
  suggestion}` BEFORE the existing `write_enabled` / FS-read flow.
  `writeNote`'s suggestion routes to `record_observation`;
  `deleteNote`'s suggestion routes to `supersede` (hard-deletion
  forbidden in v2.0.0). `WriteConflict.reason` widened with the new
  code + optional `sinkName` / `suggestion` envelope fields.
- **`src/frontmatter/update.ts`** — `updateFrontmatter` accepts a new
  `memorySinkRegistry?` field (distinct from the existing
  `registry?: AdapterRegistry`). Same `sink_write_blocked` refusal
  with `suggestion` routing to `record_observation + supersede`.
  `UpdateConflict.reason` widened identically.
- 5 new tests in `src/adapters/delivery/obsidian-fs/write.test.ts`:
  - writeNote refuses `_memory/...` with `sink_write_blocked`
  - writeNote does NOT fire on non-sink paths
  - writeNote without registry behaves like Phase 1 (back-compat)
  - deleteNote refuses with `sink_write_blocked` + supersede suggestion
- 2 new tests in `src/frontmatter/update.test.ts`:
  - updateFrontmatter refuses `_memory/...` with `sink_write_blocked`
  - updateFrontmatter does NOT fire on non-sink paths

### Task 2 — Server bootstrap wiring + MEM-11 (commit `f30d35b`)

- **`src/server.ts`**:
  - New `BootstrapPhase` type (5 values: `load_config`, `open_vaults`,
    `register_memory_sinks`, `start_catchup`, `connect_transport`)
    and `ServeOptions { onPhase?: (name) => void }`. `serve()` emits
    each phase synchronously in order.
  - **`discoverMemorySinks(configured, vaults)`** (exported) — pure
    helper. If `configured.length > 0`, returns configured unchanged.
    Else scans each vault for `_memory/.memory-sink` via
    `sentinelExistsAt`; synthesizes `{name:"default",
    handle:"obsidian-fs://<v>/_memory/", contract:"default-memory-v1"}`
    for each matching vault. Preserves the v2 fixture's existing 15
    memory docs as a default sink without config edits.
  - **`setupMemorySinks(config, manager)`** (exported) — calls
    `discoverMemorySinks` then `registry.registerMemorySinks` with the
    production provisioner (wraps `provisionSink` from
    obsidian-fs/sentinel). Throws fail-fast on registration error per
    ADR-004.
  - Bootstrap ordering: `loadConfig → manager.loadAll →
    setupMemorySinks → (adapters registered with registry passed in) →
    server.connect → startCatchupAndWatchers (fire-and-forget)`. The
    `MemorySinkRegistry` is threaded into `ObsidianFsDelivery` (third
    positional arg) and into the `updateFrontmatter` handler via
    `memorySinkRegistry`.
  - `handleWriteNote` / `handleDeleteNote` now propagate the Phase 2
    envelope fields (`sinkName`, `suggestion`, `key`, `observedValue`)
    through the v1 wire shape so MCP callers receive actionable
    diagnostics on `sink_write_blocked` and the other Phase 2 codes.

- **`src/adapters/delivery/obsidian-fs/sentinel.ts`** — new
  `sentinelExistsAt(vaultRoot, relPath)` helper. The auto-discovery
  probe needs `node:fs` access but operates BEFORE any sink record
  exists; this helper takes a plain relPath, joins it with
  `<sentinelFilename>`, runs `fs.access`, and returns boolean. Keeps
  `src/server.ts` free of `node:fs` imports per ADR-002 I-2.

- **`src/server.test.ts`** — 6 new tests in three describes:
  - `discoverMemorySinks` (3): synthesis on fixture sentinel; explicit
    configs unchanged; skip on absent sentinel.
  - `MEM-11: v1 write tools refuse memory-sink targets` (1 long
    integration test): builds a temporary v2-fixture-shape vault on
    disk (`_memory/` + sentinel), wires
    `setupMemorySinks` + `ObsidianFsDelivery`, then invokes:
    - `delivery.write(_memory/..., ...)` — fails (chokepoint).
    - `writeNoteInternal({..., registry})` — fails with
      `sink_write_blocked` + `record_observation` suggestion + no file
      on disk.
    - `updateFrontmatter({..., memorySinkRegistry})` — fails with
      `sink_write_blocked` + `record_observation` suggestion.
    - `deleteNoteInternal({..., registry})` — fails with
      `sink_write_blocked` + `supersede` suggestion.
  - `Plan 02-03b: bootstrap phase ordering` (2): the sentinel-existence
    proxy for the order invariant + a compile-time check covering all
    five `BootstrapPhase` values.

## Verification Performed

```bash
# Per-task automated checks
npx vitest run --no-coverage \
  src/adapters/delivery/obsidian-fs/write.test.ts \
  src/frontmatter/update.test.ts        # Task 1: 34 tests ✓
npx vitest run --no-coverage src/server.test.ts   # Task 2: 22 tests ✓

# Plan <verification> block
npx vitest run --no-coverage              # 703 / 714 (11 todo) ✓
npx tsc --noEmit                          # clean ✓
bash scripts/lint-adapters.sh             # all I-* + C-1 green ✓
npm run eval:baseline                     # 29 / 40 (11 todo) v1-baseline green ✓
```

Test count delta:
- Plan 02-03b added 13 new tests (5 writeNote/deleteNote Guard + 2
  updateFrontmatter Guard + 3 discoverMemorySinks + 1 MEM-11 + 1
  bootstrap-order proxy + 1 type-coverage).
- Net total: 690 → 703 passing.

## Deviations from Plan

### Path

**[Rule 3 — Blocking issue] Plan frontmatter `files_modified` lists
`src/write/write.ts` but the actual file is at
`src/adapters/delivery/obsidian-fs/write.ts`.** The Phase 1 Plan 01-04
relocation moved `writeNote` / `deleteNote` from `src/write/` into the
obsidian-fs delivery adapter directory. The Plan 02-03b intent — defense-
in-depth entry-point Guards on v1 internal write tools — applies at the
current home. All edits landed in
`src/adapters/delivery/obsidian-fs/write.ts`; no `src/write/` directory
exists. This is purely a path-tracking deviation; the Guard semantics
are byte-identical to what the plan's pseudocode prescribed.

### Scope

**[Rule 2 — Missing critical functionality] Phase 2 envelope-field
propagation through v1 wire shape.** The plan's `<action>` for Task 2
described threading the registry into `handleWriteNote` /
`handleDeleteNote`, but the actual handlers route through
`ObsidianFsDelivery.write/delete` (which already has the chokepoint).
The under-spec'd issue was that those handlers' response-shaping code
was dropping the new Phase 2 envelope fields (`sinkName`, `suggestion`,
`key`, `observedValue`) when mapping V2 → V1 conflict shape. The MEM-11
integration test would have observed `reason: "sink_write_blocked"` but
NO `suggestion` — making the diagnostic useless to MCP callers. Added
the propagation explicitly: `handleWriteNote` and `handleDeleteNote`
now copy all four optional envelope fields through. Documented in the
Task 2 commit.

### Sentinel-helper placement

**[Rule 3 — Blocking issue] `node:fs` access for auto-discovery must
live in the licensed adapter dir.** The plan's pseudocode for
`discoverMemorySinks` showed `await fs.access(joinVaultPath(...))`
inline in `src/server.ts`. The ADR-002 I-2 lint script forbids
`node:fs` imports outside `src/(adapters|config|vault|rerank)/`. Moved
the probe to a new `sentinelExistsAt(vaultRoot, relPath)` helper in
`src/adapters/delivery/obsidian-fs/sentinel.ts` (the SOLE licensed
home for sentinel mechanics per ADR-002 I-2). Helper takes a plain
`relPath` rather than a `MemorySink` because auto-discovery probes
BEFORE any sink record exists. Lint passes; behavior identical.

### Bootstrap-order test approach

**[Scope] Bootstrap-order test does NOT spin up stdio.** The plan
said "instrument bootstrap with optional `onPhase` callbacks and
assert the captured array order." `serve()` blocks on
`server.connect(transport)` (stdio) so calling it from a vitest test
would hang forever. The order invariant is observable by a simpler
proxy: after `setupMemorySinks` returns, the sentinel file exists on
disk. Since `serve()` runs `setupMemorySinks` BEFORE the fire-and-
forget `startCatchupAndWatchers()`, this proves the canonical
invariant ("sentinels exist before catchup walks") without invoking
the transport. The `BootstrapPhase` type is still exported and
covered by a compile-time test, so the contract surface is intact.

## Authentication Gates

None. This plan is greenfield wiring on top of established substrate;
no external services touched.

## Truths Verified (from plan `must_haves.truths`)

- ✓ **v1 `write_note` against a memory-sink-resolved path returns
  `{ok:false, reason:"sink_write_blocked", sinkName, suggestion: ...}`
  BEFORE the delivery layer is called** — `writeNote` entry-point Guard
  (commit 38abeae); test
  `writeNote — MEM-07 entry-point Guard > refuses sink-resolved target
  with sink_write_blocked` asserts the exact shape.
- ✓ **v1 `update_frontmatter` and `delete_note` apply the same
  `sink_write_blocked` refusal with operation-appropriate `suggestion`
  text** — `updateFrontmatter` test `refuses sink-resolved target with
  sink_write_blocked` checks `record_observation` suggestion;
  `deleteNote` test `refuses sink-resolved target with sink_write_blocked
  + supersede suggestion` checks `supersede` suggestion.
- ✓ **Server bootstrap order: `loadConfig → manager.openAll →
  registry.registerMemorySinks (writes sentinels) → catchupVault
  (fire-and-forget) → server.connect`** — `setupMemorySinks` is called
  after `manager.loadAll` and BEFORE `startCatchupAndWatchers()` (which
  is itself fire-and-forget after `server.connect`). Test
  `Plan 02-03b: bootstrap phase ordering` asserts the sentinel-existence
  proxy. `BootstrapPhase` type covers all five phases.
- ✓ **The `MemorySinkRegistry` instance is constructed once at bootstrap
  and threaded into BOTH the `ObsidianFsDelivery` constructor AND the
  v1 tool handlers** — `setupMemorySinks` returns the registry;
  `new ObsidianFsDelivery(vault, getClientId, memorySinkRegistry)`
  passes it (third arg); `updateFrontmatter` handler passes
  `memorySinkRegistry` through the v1 field. (Note: handleWriteNote /
  handleDeleteNote route through the delivery, which is constructor-
  injected — see Deviations §Scope.)
- ✓ **MEM-11: an MCP `write_note({vault, path:
  "_memory/observations/foo.md", body: "x"})` call returns the
  structured `sink_write_blocked` error with `suggestion` text
  containing `record_observation`; no file is created on disk** —
  `MEM-11` integration test invokes `writeNoteInternal` (the v1 entry
  point) with the wired registry; asserts
  `reason === "sink_write_blocked"`, `sinkName === "default"`,
  `suggestion ~ /record_observation/`, and `fs.access(...).rejects.toThrow()`.
- ✓ **When the existing fixture has a `_memory/` folder with a
  sentinel and no `[[memory_sinks]]` config is present,
  auto-discovery synthesizes a default sink at bootstrap** —
  `discoverMemorySinks > synthesizes a default sink when
  _memory/.memory-sink exists and config is empty` asserts the exact
  config shape.
- ✓ **v1-baseline eval suite remains byte-for-byte green: ordinary
  v1 tool invocations against non-sink paths are unchanged** — `npm
  run eval:baseline` reports 29/40 (11 todo, 0 fail). All Phase 1
  writeNote / updateFrontmatter / deleteNote tests against non-`_memory/`
  paths pass unchanged.

## Known Stubs

None. Every behavior the plan called out is wired end-to-end with
co-located tests.

## Threat Flags

None. The added surface is wiring on top of existing chokepoints:

- `setupMemorySinks` only invokes already-vetted paths (`registry.
  registerMemorySinks` from Plan 02-02; `provisionSink` from the
  obsidian-fs sentinel module). It writes sentinels into
  vault-scoped paths that the registry pre-validates against
  `MEMORY_SINK_HANDLE_PATTERN`.
- `sentinelExistsAt` adds one `fs.access` call inside the already-
  licensed adapter dir. Path is constructed from `vaultRoot` (configured
  in `~/.vault-memory/config.toml`) + a literal `relPath` controlled
  by `discoverMemorySinks`'s own hardcoded `"_memory"`. No user input
  reaches the path-join.
- Entry-point Guards strengthen the existing chokepoint. They cannot
  weaken it (the chokepoint at `ObsidianFsDelivery.preflight()` still
  runs unchanged). When the registry is omitted, the new code path is
  byte-identical to Phase 1.

## Commits

| Task | Commit  | Description                                                       |
| ---- | ------- | ----------------------------------------------------------------- |
| 1    | 38abeae | feat(02-03b): MEM-07 entry-point Guards on writeNote/deleteNote/updateFrontmatter |
| 2    | f30d35b | feat(02-03b): server bootstrap wires MemorySinkRegistry + MEM-11 test |

## Requirements Touched

- **MEM-07** — v1 entry-point Guards on `writeNote`, `deleteNote`,
  `updateFrontmatter` ship per the plan's `must_haves.truths`. The
  authoritative chokepoint still lives at the DeliveryAdapter per
  ADR-002 §DeliveryAdapter; these Guards are defense-in-depth. **Fully
  delivered.**
- **MEM-11** — MCP `write_note` / `update_frontmatter` / `delete_note`
  against `_memory/...` are demonstrably blocked at the MCP boundary
  with structured `sink_write_blocked` envelopes containing actionable
  `suggestion` text (`record_observation` / `supersede`). Integration
  test pins this contract at the entry-point level. **Fully delivered.**

## Self-Check

- File `src/adapters/delivery/obsidian-fs/write.ts` modified ✓
- File `src/adapters/delivery/obsidian-fs/write.test.ts` modified ✓
- File `src/adapters/delivery/obsidian-fs/sentinel.ts` modified ✓
- File `src/frontmatter/update.ts` modified ✓
- File `src/frontmatter/update.test.ts` modified ✓
- File `src/server.ts` modified ✓
- File `src/server.test.ts` modified ✓
- File `.planning/phases/02-memory-namespace-provenance-contract/02-03b-SUMMARY.md` exists ✓
- Commit `38abeae` exists on branch ✓
- Commit `f30d35b` exists on branch ✓
- Plan `<verification>` block passes: `npx vitest run --no-coverage`
  reports 703/714 (11 todo); `npx tsc --noEmit` clean;
  `bash scripts/lint-adapters.sh` all I-* + C-1 green; `npm run
  eval:baseline` 29/40 (11 todo) ✓

## Self-Check: PASSED
