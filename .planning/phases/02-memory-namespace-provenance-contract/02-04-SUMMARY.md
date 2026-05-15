---
phase: 02-memory-namespace-provenance-contract
plan: 04
subsystem: memory
tags:
  [
    mem-02,
    mem-04,
    record-observation,
    supersede,
    mcp-tool,
    delivery-chokepoint,
    d-02,
    d-03,
    safety-invariant,
    tools-list-snapshot,
  ]
dependency_graph:
  requires:
    - .planning/phases/02-memory-namespace-provenance-contract/02-02-SUMMARY.md (MemorySinkRegistry, parseMemorySinkHandle, pathInSink, decomposeDocId)
    - .planning/phases/02-memory-namespace-provenance-contract/02-03-SUMMARY.md (DeliveryAdapter chokepoint validator at write/update)
    - .planning/phases/02-memory-namespace-provenance-contract/02-03b-SUMMARY.md (server bootstrap wires MemorySinkRegistry; v1 entry-point Guards)
    - docs/v2/adr/004-memory-sink-handles.md §Resolution + naming
    - docs/v2/MEMORY_CONTRACT.md (default-memory-v1 contract)
    - src/tool-registry.ts (single source of truth for tools/list + Zod raw shapes)
    - src/adapters/delivery/types.ts (Phase 1 WriteResult / UpdateResult)
    - src/adapters/source/types.ts (Phase 1 SourceConnector.readDocument)
  provides:
    - handleRecordObservation(deps, args) — MEM-02 controller (record_observation MCP tool)
    - handleSupersede(deps, args)         — MEM-04 controller (supersede MCP tool)
    - RecordObservationDeps / RecordObservationArgs / SupersedeDeps / SupersedeArgs types
    - TOOLS literal extended with `record_observation` + `supersede` (snapshot grows 23 → 25)
    - TOOL_SCHEMAS extended with the Zod 4 raw shapes for both tools
    - DOC_ID_PATTERN exported from src/adapters/registry.ts (forward-compatibility for future consumers)
  affects:
    - Plan 02-05 (recall tool) — same controller-shape model + `src/memory/tools/` barrel pattern
    - Plan 02-06 (MCP Resources `memory_stats` / `list_sinks`) — record_observation writes now visible in audit_log
    - Plan 02-07 (fixture extension) — the controllers can ship initial fixture seeds
    - v1-baseline regression suite — tools-list snapshot now has 25 entries; baseline.test.ts pins 23 v1 names byte-identical
tech_stack:
  added: []
  patterns:
    - Controller-shape model: a single async function per MCP tool that
      accepts a `Deps` struct + an `Args` struct and returns the
      discriminated `WriteResult` / `UpdateResult`. The server-side
      dispatch in `src/server.ts` builds the `Deps` closures from
      bootstrap-time singletons (manager + adapterRegistry +
      memorySinkRegistry).
    - D-02 merge-LAST: `{...sugarProps, ...(args.properties ?? {})}` so
      caller-supplied keys win. The tool NEVER pre-validates beyond
      Zod's required-args check; the contract validator at the
      delivery chokepoint (Plan 02-03) is the single source of
      enforcement.
    - D-03 forward-only supersede: writes status=superseded +
      superseded_by + superseded_reason ONLY on the OLD doc. The
      replacement doc is never touched (back-link materialization is
      Phase 4 graph-layer territory). Single OCC delivery.update()
      call with `expectedHash` sourced from
      `SourceConnector.readDocument(oldId).hash`.
    - Pure controllers: no `node:fs`, `node:path`, `chokidar`, or
      `gray-matter` imports under `src/memory/tools/`. `node:crypto` is
      allowed (used for the 6-char collision-suffix hash); the
      seam-preservation lint script doesn't gate `node:crypto`.
    - Same-day collision retry: the date-slug naming pattern
      `{YYYY-MM-DD}-{slug}-{hash6}.md` salts the hash with an
      attempt-counter so consecutive retries produce different DocIds.
      Up to 3 attempts via `SourceConnector.exists(docId)`.
    - Inlined DOC_ID_PATTERN in tool-registry.ts (with documented
      single-source-of-truth invariant against
      `src/adapters/registry.ts`) so the plain-Node snapshot generator
      can resolve imports without traversing into `./adapters/`. The
      pattern is also exported from `src/adapters/registry.ts` for
      future consumers.
key_files:
  created:
    - src/memory/tools/record-observation.ts
    - src/memory/tools/record-observation.test.ts
    - src/memory/tools/supersede.ts
    - src/memory/tools/supersede.test.ts
    - src/memory/tools/index.ts (barrel)
    - .planning/phases/02-memory-namespace-provenance-contract/02-04-SUMMARY.md
  modified:
    - src/tool-registry.ts (TOOLS + TOOL_SCHEMAS extended; inlined DOC_ID_PATTERN)
    - src/tool-registry.test.ts (6 new schema cases + 23 v1 byte-identical pin)
    - src/server.ts (handler dispatch for both tools; imports + suppression integration)
    - src/server.test.ts (5 new MEM-02/04 end-to-end cases)
    - src/adapters/registry.ts (DOC_ID_PATTERN exported)
    - evals/v1-baseline/tools-list.snapshot.json (regenerated, 25 entries)
    - evals/v1-baseline/baseline.test.ts (length pin → 25; new 23 v1 byte-identical pin)
decisions:
  - "Patch sent to delivery.update() in supersede() carries the full
    merged property set (existing on-read props + the three supersede
    keys), NOT just the three supersede keys. Plan 02-03 conformance
    case 17 pins 'update() routes through the SAME validator (missing
    observed_at refused)' — i.e. the chokepoint runs the contract
    schema against the patch ALONE. A minimal patch of just
    {status, superseded_by, superseded_reason} would falsely fail
    missing_provenance on source/observed_at/etc. The delivery layer
    itself shallow-merges with disk before writing (see
    ObsidianFsDelivery.update() lines 273–284), so passing the merged
    full set is idempotent — the on-disk frontmatter ends up at
    exactly the same shape as if a minimal patch had been
    post-merged. The controller already has the OLD doc in hand for
    its OCC hash fetch, so the merge costs nothing extra."
  - "DOC_ID_PATTERN inlined in tool-registry.ts rather than imported
    from src/adapters/registry.ts. The snapshot generator
    (evals/v1-baseline/dump-tools.mjs) is a plain Node ESM script that
    imports `.ts` via Node 22.7+'s native type-stripping. When
    tool-registry.ts imports from './adapters/registry.js', Node fails
    with ERR_MODULE_NOT_FOUND because only `registry.ts` exists at
    that path. Two options: (a) make the dump script transpile, or
    (b) inline the regex. Option (b) is minimally invasive and the
    inline copy carries an explicit single-source-of-truth invariant
    comment + a test-coverage pin (`supersede` schema cases reject
    malformed DocIds via this exact pattern). DOC_ID_PATTERN is also
    exported from src/adapters/registry.ts for future consumers — the
    export is harmless and provides a clean import path the day
    dump-tools.mjs is rewritten."
  - "Path-collision retry uses SourceConnector.exists(docId) rather
    than node:fs directly. Keeps the controller seam-pure
    (no node:fs/node:path imports under src/memory/tools/). The
    bootstrap-time AdapterRegistry already has the ObsidianFsSource
    instance for each vault; the closure-style `sourceConnectorFor`
    keeps the controller decoupled from the registry's resolve
    semantics."
  - "WriteSuccess.newHash / UpdateSuccess.newHash returned UNCHANGED.
    The plan's truth `record_observation`'s successful return value
    carries `newHash` (NOT `hash`)` is preserved through three layers:
    (a) the controller returns delivery.write() / delivery.update()
    output verbatim; (b) the server.ts dispatch wraps the result
    object in an `ok()` MCP response without renaming fields; (c)
    tests assert `typeof res.newHash === 'string'` AND
    `(res as Record<string, unknown>).hash === undefined`."
  - "Watcher-suppression added on the server.ts dispatch (post-write)
    rather than inside the controller. The controller never touches
    the SuppressionSet — that's a server.ts-level concern; the
    controller is pure data-in/data-out. After a successful write the
    server.ts handler extracts the vault-relative resource from the
    minted DocId and calls `suppression.add(resource)` so the
    live-indexer doesn't re-fire on the atomic rename event."
  - "MEM-02/04 end-to-end test in src/server.test.ts deliberately
    skips the MCP stdio transport (Plan 02-03b precedent: `serve()`
    blocks on `server.connect(transport)`). Tests drive the
    controllers through the same wiring serve() does in production —
    setupMemorySinks → AdapterRegistry → handler deps with closures —
    so anything that ships in the dispatch is exercised; only the
    Zod-parse + ok/errorResponse MCP wrapper is omitted. Zod
    boundary behavior is covered independently via buildToolSchema."
metrics:
  duration: "~40 min"
  completed: 2026-05-15
  tasks_completed: 3
  commits: 3
  files_created: 5
  files_modified: 7
  tests_added: 24
  baseline_tests_before: 703
  total_tests_after: 732
---

# Phase 2 Plan 02-04: Memory-Write Tool Slice Summary

**One-liner:** Lands `record_observation` (MEM-02) and `supersede`
(MEM-04) as the two MCP tools that ride the Plan 02-03 validator
chokepoint. Both controllers are pure (no node:fs / node:path /
gray-matter / chokidar) and return the delivery's discriminated
`WriteResult` / `UpdateResult` UNCHANGED — so the Phase 2 envelope
fields (`sinkName`, `key`, `observedValue`, `suggestion`) reach MCP
callers verbatim. Sugar args (`claim`/`evidence`/`confidence`/`type`)
pre-fill the contract-required keys; caller-supplied `properties`
merge LAST so contract-allowed extras win (D-02). Supersede is
forward-only (D-03): writes the supersede triple on the OLD doc
only; the replacement doc is never touched. Both tools are wired
into `src/tool-registry.ts` (the single source of truth) and
exposed via SDK 1.29's `registerTool` from `src/server.ts`. The
v1-baseline `tools-list.snapshot.json` grows from 23 to 25 entries;
the 23 v1 entries are byte-identical (new `baseline.test.ts`
assertion pins this explicitly).

## What Was Built

Three atomic commits landed the slice:

### Task 1 — `handleRecordObservation` controller + tests (commit `1ee9d00`)

- **`src/memory/tools/record-observation.ts`** —
  `handleRecordObservation(deps, args)` controller. Resolves the
  target sink (default OR caller-named); composes the sugar property
  bag (`source: "agent"`, `observed_at: now`, `status: "active"`,
  plus `confidence` / `evidence` / `type` / `superseded_by: null`);
  merges `args.properties` LAST per D-02; mints a DocId following
  the default-memory-v1 naming pattern
  (`{observed_at:YYYY-MM-DD}-{slug}-{hash6}.md`); retries up to 3×
  on path collision via `SourceConnector.exists`; delegates to
  `DeliveryAdapter.write()` and returns the result UNCHANGED.

- **`src/memory/tools/record-observation.test.ts`** — 9 vitest
  cases covering: happy path (file on disk + all 7 required
  frontmatter keys + `newHash` not `hash`), D-02 escape hatch
  (passthrough extras land in frontmatter), D-02
  `properties.confidence` override (caller-last wins), D-02
  `properties.source: "user"` bubbles up as
  `non_agent_write_inside_sink` UNCHANGED, D-02
  `properties.observed_at` override (backfill flow), unknown sink
  name throws, vault/sink mismatch throws, DocId collision retry
  yields a distinct file, and validator-rejection returned UNCHANGED.

- **`src/memory/tools/index.ts`** (barrel) — re-exports
  `handleRecordObservation` + its types. Plan 02-04 Task 2 extends
  it with `handleSupersede`.

### Task 2 — `handleSupersede` controller + tool-registry wiring (commit `8dd5b73`)

- **`src/memory/tools/supersede.ts`** — `handleSupersede(deps, args)`
  controller. Parses both DocIds at the boundary; verifies the OLD
  doc lives inside a registered sink; reads its current
  `Document.hash` via `SourceConnector.readDocument`; merges the
  existing property bag with the three supersede keys (per
  decisions: full merged patch, not minimal — Plan 02-03 conformance
  case 17 requires it); calls `delivery.update()` with
  `expectedHash` set for OCC. Returns the `UpdateResult` UNCHANGED.

- **`src/memory/tools/supersede.test.ts`** — 6 vitest cases:
  happy path (OLD frontmatter reflects supersede + REPLACEMENT
  content + mtime UNCHANGED + `newHash` not `hash`), OCC concurrent-
  edit `hash_mismatch` returned UNCHANGED (simulated via a
  readDocument wrapper that mutates the file post-read), out-of-sink
  target throws, idempotent re-supersede (second call updates
  `superseded_reason` to the new value), malformed `replacement_doc_id`
  rejected at `parseDocId`, malformed `doc_id` rejected at
  `parseDocId`.

- **`src/tool-registry.ts`** — TOOLS gains `record_observation`
  + `supersede` literal entries (preserving the JSON-snapshot-
  stability invariant — entries are pure JSON-serializable);
  TOOL_SCHEMAS gains the Zod 4 raw shapes with per-field
  `.describe()`. `DOC_ID_PATTERN` is inlined (with a documented
  single-source-of-truth invariant against the canonical pattern
  in `src/adapters/registry.ts`) to keep the plain-Node snapshot
  generator working.

- **`src/tool-registry.test.ts`** — 6 new schema cases pinning the
  expected accept/reject behavior of `record_observation` and
  `supersede` Zod shapes; 2 amendments to the existing tests for the
  25-tool length.

- **`src/server.ts`** — handler dispatch added for both new tools.
  Imports the two handlers from the new barrel; constructs the
  `Deps` closures from `memorySinkRegistry` (Plan 02-03b bootstrap),
  `manager`, and `adapterRegistry.resolveDelivery/resolveSource`.
  Successful writes call `suppression.add(resource)` so the
  live-indexer doesn't re-fire on our own atomic renames.

- **`src/adapters/registry.ts`** — `DOC_ID_PATTERN` made exported
  (additive change; no consumers yet under tool-registry.ts, but
  the export is a clean future-proof seam).

- **`evals/v1-baseline/tools-list.snapshot.json`** — regenerated
  via `npm run eval:snapshot`; grows from 23 to 25 entries; the
  pre-existing 23 v1 entries are byte-identical (asserted by the
  new pin below).

- **`evals/v1-baseline/baseline.test.ts`** — length pin updated
  to 25; new pin `preserves the 23 v1 baseline tool names
  byte-identical (Plan 02-04 truth)` enumerates the 23 names and
  asserts `TOOLS.slice(0, 23).map(t => t.name)` equals them.

### Task 3 — Server-level integration tests (commit `9daba33`)

- **`src/server.test.ts`** — new
  `describe("Plan 02-04: MEM-02 (record_observation) + MEM-04 (supersede) end-to-end")`
  block. 5 cases mirror Plan 02-03b's MEM-11 approach (handler
  invocation through the same wiring `serve()` builds, sans the
  stdio transport): tools/list shape, end-to-end record_observation
  (happy + escape-hatch + source-override rejection), end-to-end
  record_observation → supersede flow (OLD reflects supersede +
  REPLACEMENT untouched + audit_log records 2 creates + 1 update),
  Zod boundary `reason: ""` rejection, Zod boundary unknown
  confidence enum rejection.

## Verification Performed

```bash
# Per-task automated checks
npx vitest run --no-coverage src/memory/tools/record-observation.test.ts  # Task 1: 9 ✓
npx vitest run --no-coverage src/memory/tools/                            # Task 2: 15 ✓
npx vitest run --no-coverage src/memory/tools/ src/tool-registry.test.ts  # 31 ✓
node evals/v1-baseline/dump-tools.mjs --check                             # snapshot regen ✓
npx vitest run --no-coverage src/server.test.ts                           # Task 3: 27 ✓

# Plan <verification> block
npx vitest run --no-coverage             # 732 / 743 (11 todo) ✓
npx tsc --noEmit                         # clean ✓
bash scripts/lint-adapters.sh            # all I-* + C-1 green ✓
npm run eval:baseline                    # 30 / 41 (11 todo) v1-baseline green ✓

# Pre-flight contract verification (from plan)
grep -E "^\s*(readDocument|fetchDocument|readNote)\b" src/adapters/source/types.ts
# → single match on `readDocument` ✓
```

Test count delta:
- Plan 02-04 added 29 new tests:
  - 9 record-observation.test.ts
  - 6 supersede.test.ts
  - 6 new tool-registry.test.ts (Plan 02-04 schema cases)
  - 1 amended tool-registry.test.ts (25-tool length)
  - 1 new baseline.test.ts (23 v1 byte-identical names pin)
  - 5 server.test.ts (MEM-02/04 end-to-end)
  - 1 unchanged baseline.test.ts (25-tool length, replaces the
    old 23-tool pin)
- Net total: 703 → 732 passing.

## Deviations from Plan

Two adjustments — both inside Rule 3 (blocking issue) or Rule 2
(missing critical functionality) latitude. No architectural changes.

- **[Rule 2 — Missing critical functionality] Supersede patch carries
  the FULL merged property set, not just the three supersede keys.**
  The plan's pseudocode showed `patch: { properties: { status:
  "superseded", superseded_by, superseded_reason } }`. Running that
  against Plan 02-03's chokepoint surfaces `missing_provenance` on
  `source` (and would surface the same on `observed_at`, etc.)
  because conformance case 17 pins the contract validator running
  the schema against the PATCH ALONE. The minimal-patch shape is
  incompatible with that chokepoint contract. Fix: the controller
  reads the OLD doc anyway for its OCC hash (`source.readDocument`),
  so it already has the existing property bag in hand; the patch
  now ships as `{ ...existingProps, status, superseded_by,
  superseded_reason }`. The delivery layer ITSELF shallow-merges
  with disk before writing (see `ObsidianFsDelivery.update()` lines
  273–284), so passing the merged full set is idempotent — the
  on-disk frontmatter is byte-identical to what a "minimal patch +
  delivery merge" would produce. Documented inline in
  supersede.ts. Test that drove the fix:
  `supersede.test.ts > happy path > ...`. The `wikilinks` field is
  stripped at the controller boundary (D-05 — adapter-injected on
  read, never written back) to avoid an unnecessary frontmatter
  delta.
  - **Files modified:** `src/memory/tools/supersede.ts`
  - **Commit:** `8dd5b73`

- **[Rule 3 — Blocking issue] DOC_ID_PATTERN inlined in
  tool-registry.ts, not imported.** The plan's Step 2 said the
  pattern import comes from `src/adapters/registry.ts`. Wiring that
  import broke the snapshot generator
  (`evals/v1-baseline/dump-tools.mjs`) — a plain Node ESM script
  that imports tool-registry.ts via Node 22.7+'s native type-
  stripping. Node fails with ERR_MODULE_NOT_FOUND when the chain
  reaches `./adapters/registry.js` because only `.ts` exists at
  that path; the type-stripper does not chain across `.js`
  extension fixups. Two repair options: (a) make the snapshot
  generator transpile (changes the eval-pipeline contract), or
  (b) inline the regex. Option (b) is minimally invasive; the
  inline copy carries an explicit single-source-of-truth invariant
  comment and is pinned by the supersede schema cases. The
  exported `DOC_ID_PATTERN` in `src/adapters/registry.ts` is
  retained — the export is harmless and provides a clean import
  path the day dump-tools.mjs is rewritten.
  - **Files modified:** `src/tool-registry.ts`,
    `src/adapters/registry.ts`
  - **Commit:** `8dd5b73`

## Authentication Gates

None. This plan is greenfield code on top of an established
substrate; no external services touched.

## Truths Verified (from plan `must_haves.truths`)

- ✓ **`record_observation` accepts the documented args and writes
  through `DeliveryAdapter.write()`; missing required args fail at
  the Zod handler boundary** — `tool-registry.test.ts >
  record_observation schema > rejects empty input` +
  `record-observation.test.ts > happy path > ...`.
- ✓ **Caller `properties` merges LAST so contract-allowed extras
  win** — `record-observation.test.ts > D-02 escape hatch` (extras
  land in frontmatter) + `D-02 override` (caller `confidence`
  overrides sugar arg).
- ✓ **`record_observation` never pre-validates beyond required-args
  presence** — the controller has zero validation logic between the
  Zod boundary and `delivery.write()`; rejections always come back
  from the chokepoint, asserted by `D-02 source override` (delivery
  returns `non_agent_write_inside_sink` unchanged) and
  `validator-rejection returned UNCHANGED`
  (`invalid_provenance` with `key`/`observedValue`).
- ✓ **`record_observation`'s successful return value carries
  `newHash` (NOT `hash`)** — asserted at every successful-path test
  with `expect((res as Record<string, unknown>).hash).toBeUndefined()`.
- ✓ **`supersede` writes status:superseded + superseded_by +
  superseded_reason on the OLD doc ONLY — forward-only (D-03)** —
  `supersede.test.ts > happy path` asserts OLD frontmatter +
  REPLACEMENT file byte-identical + mtime unchanged.
- ✓ **`supersede` is a single OCC `delivery.update()` call** —
  controller body is a straight-line read → patch → update; no
  loops, no fallback paths. Asserted by `OCC conflict` test:
  hash_mismatch returned UNCHANGED.
- ✓ **`supersede`'s successful return carries `newHash`** —
  asserted in happy path + `(res as Record<string, unknown>).hash`
  is `undefined`.
- ✓ **Both tools resolve the sink-relative target path correctly**
  — the controller composes the path as
  `sink.resolveToRelativePath + "observations/" + filename`; the
  sink's trailing-slash invariant (enforced by
  `MemorySinkHandle` regex in Plan 02-02) is exercised by
  `record-observation.test.ts > happy path`.
- ✓ **Both tools use `parseDocId` / `formatDocId` / `decomposeDocId`
  from `src/adapters/registry.ts`** — `formatDocId` mints the
  record_observation DocId; `parseDocId` validates supersede's two
  inputs; `decomposeDocId` extracts the OLD doc's vault.
- ✓ **`SourceConnector.readDocument(docId)` is the read-side seam**
  — supersede.ts line 71 calls `source.readDocument(oldId)` to
  fetch `Document.hash` for the OCC token.
- ✓ **Both tools registered through `src/tool-registry.ts`** — both
  entries land in `TOOLS` and `TOOL_SCHEMAS`; `server.ts`'s
  existing `for (const tool of TOOLS)` loop picks them up.
- ✓ **Both Zod schemas exported via TOOL_SCHEMAS** — verified by
  `tool-registry.test.ts > has one entry per TOOLS row`.
- ✓ **All Phase 1 tools/list snapshot assertions still pass** —
  `baseline.test.ts > matches the pinned snapshot exactly` passes
  (snapshot regenerated); new pin
  `preserves the 23 v1 baseline tool names byte-identical`
  asserts the 23 v1 names slice unchanged.

## Known Stubs

None. Every behavior in the plan's `<behavior>` blocks is wired
end-to-end with co-located tests.

## Threat Flags

None.

The added surface is two pure controllers on top of the
already-vetted DeliveryAdapter chokepoint:

- `handleRecordObservation` reads only `args` + the
  `MemorySinkRegistry` + the `SourceConnector` (for the collision
  check). No FS, no network, no DB beyond the existing delivery
  audit log.
- `handleSupersede` reads only `args` + the registry + the
  source's `Document.hash`. The delivery's OCC check refuses
  stale writes; the same chokepoint validator that Plan 02-03
  hardened runs the contract schema against the patch.
- `tool-registry.ts` adds two declarative entries; the snapshot
  generator + the existing v1-baseline test verify the additions
  don't perturb v1 byte-for-byte.
- `server.ts`'s suppression-add post-write is bounded by the
  watcher's 2s TTL; misses are harmless (one extra re-index
  event on the just-written file).

## Commits

| Task | Commit  | Description                                                              |
| ---- | ------- | ------------------------------------------------------------------------ |
| 1    | 1ee9d00 | feat(02-04): handleRecordObservation controller + tests                  |
| 2    | 8dd5b73 | feat(02-04): handleSupersede controller + tool-registry wiring           |
| 3    | 9daba33 | test(02-04): server-level integration tests for record_observation + supersede |

## Requirements Touched

- **MEM-02** — `record_observation` MCP tool registered, validated
  by Zod at the handler boundary, schema published in
  `TOOL_SCHEMAS.record_observation`, end-to-end tested
  (controller-level + server-level). **Fully delivered.**
- **MEM-04** — `supersede` MCP tool registered, validated by Zod
  (including DOC_ID_PATTERN regex on both DocIds + min-1-char
  reason), schema published, end-to-end tested. Forward-only
  per D-03 verified by the REPLACEMENT-untouched assertion.
  **Fully delivered.**

MEM-03 (recall) is explicitly Plan 02-05 scope.

## Self-Check

- File `src/memory/tools/record-observation.ts` exists ✓
- File `src/memory/tools/record-observation.test.ts` exists ✓
- File `src/memory/tools/supersede.ts` exists ✓
- File `src/memory/tools/supersede.test.ts` exists ✓
- File `src/memory/tools/index.ts` exists ✓
- File `.planning/phases/02-memory-namespace-provenance-contract/02-04-SUMMARY.md` exists ✓
- File `src/tool-registry.ts` modified ✓
- File `src/tool-registry.test.ts` modified ✓
- File `src/server.ts` modified ✓
- File `src/server.test.ts` modified ✓
- File `src/adapters/registry.ts` modified ✓
- File `evals/v1-baseline/tools-list.snapshot.json` regenerated ✓
- File `evals/v1-baseline/baseline.test.ts` modified ✓
- Commit `1ee9d00` exists on branch ✓
- Commit `8dd5b73` exists on branch ✓
- Commit `9daba33` exists on branch ✓
- Plan `<verification>` block passes: `npx vitest run --no-coverage`
  reports 732 / 743 (11 todo); `npm run eval:baseline` 30 / 41
  (11 todo); `npx tsc --noEmit` clean; `bash scripts/lint-adapters.sh`
  all I-* + C-1 green; pre-flight contract grep returns single
  match on `readDocument` ✓

## Self-Check: PASSED
