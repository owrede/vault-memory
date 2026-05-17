---
phase: 04-graph-as-retrieval
plan: 04
subsystem: search + tool-registry + server
tags:
  - GRA-03
  - search_hybrid-expand
  - phase-4-composition
  - additive-zod
dependency_graph:
  requires:
    - "expand() primitive (Plan 04-03)"
    - "CitationPacketWithVia type (Plan 04-03)"
    - "ExpandDeps shape — manager + sourceConnectorFor (Plan 04-03)"
    - "ExpandDirection type (Plan 04-03)"
    - "EdgeType union (Plan 04-01 / 04-03)"
    - "Phase 3 rescore block in src/search/hybrid.ts (lines 245–294)"
    - "Phase 3 9-field hydration in src/search/hybrid.ts (doc_id / source_handle / …)"
  provides:
    - "search_hybrid({expand: {hops: 1|2, direction?, edge_types?}}) end-to-end"
    - "SearchHit.expansions?: CitationPacketWithVia[] (additive widening)"
    - "HybridSearchOptions.expand?: { hops, direction?, edge_types? }"
    - "HybridSearchOptions.expandDeps?: ExpandDeps (DI seam)"
  affects:
    - "Plan 04-06 (eval gold-set) — exercises this exact tool surface"
    - "Plan 04-07 (snapshot regen) — tool-list snapshot will pick up the description text + the expand JSON Schema property"
    - "Phase 5 (briefs) — search_hybrid({expand}) is a citation-bundle feeder"
tech-stack:
  added: []
  patterns:
    - "Guard-and-short-circuit composition (analog Phase 3 recencyWeight rescore at hybrid.ts:262–294) — `if (opts.expand && opts.expandDeps && hits.length > 0)` keeps v1-baseline byte-identical when omitted."
    - "Strictly additive Zod nested-object pattern — mirrors Phase 3 D-07 additive params on `search_hybrid` (PATTERNS lines 460–476)."
    - "Single `expand(deps, opts)` call with all hit doc_ids — per-vault BFS isolation happens INSIDE expand() (Plan 04-03), so cross-vault traversal is prevented at the expand() boundary rather than via a per-vault loop in hybrid.ts."
    - "Defensive try/catch around expand() — failures are silent (same posture as the reranker fallback at hybrid.ts:342–347); the rest of the hybrid result is intact."
    - "Structural inline type for SearchHit.expansions — types.ts stays free of a top-level graph-layer import (keeps the type dependency direction `graph → types`)."
key-files:
  created:
    - .planning/phases/04-graph-as-retrieval/04-04-search-hybrid-expand-SUMMARY.md
  modified:
    - src/search/hybrid.ts
    - src/search/hybrid.test.ts
    - src/types.ts
    - src/tool-registry.ts
    - src/server.ts
    - src/server.test.ts
decisions:
  - "Use a SINGLE `expand(deps, opts)` call with all hit doc_ids rather than the plan §<action> pseudocode's per-vault loop. The plan's pseudocode (`expand(vault, {...})`) referenced the WRONG expand signature — the actual Plan 04-03 signature is `expand(deps, opts)` where `deps = {manager, sourceConnectorFor}`. The simpler single-call approach matches the real contract and is functionally equivalent: `expand()` already groups seeds by vault internally (per-vault BFS isolation), so T-04-04-02 (cross-vault expansion) is mitigated at the expand() boundary, not in hybrid.ts. The plan's `groupBy` helper was therefore unnecessary and was not added."
  - "Inject `expandDeps` as a SEPARATE HybridSearchOptions field (mirrors the existing `displayUrlFor` seam pattern) rather than bundling deps into the `expand` config object. Rationale: the user-facing tool input is `expand: {hops, direction?, edge_types?}` (per D-15 — three fields, no deps). Deps live on the call site, not in the tool surface. This keeps the Zod schema clean and matches how Plan 04-03's standalone `expand` tool dispatcher constructs deps in server.ts:845–851."
  - "`SearchHit.expansions` declared as a STRUCTURAL inline type in `src/types.ts` rather than `expansions?: CitationPacketWithVia[]` with an import. Rationale: `types.ts` currently has zero imports — importing from `src/graph/expand.ts` would invert the natural `graph → types` dependency direction. The structural shape (8 citation-packet fields + via trace) is documented inline with a 'MUST stay in sync with CitationPacketWithVia' contract note."
  - "Expand failures (throw) are silently swallowed — same posture as the reranker fallback. The rest of the hybrid result is intact; only the `expansions` field stays unset. Acceptable for a strictly-additive composition layer: a corrupted/failing graph traversal must not break search."
  - "Wired `search_hybrid({expand})` through to runtime via `handleSearchHybrid` + the existing tool dispatcher (Rule 3 - Blocking deviation from the plan's task split). The plan listed only `src/tool-registry.ts` under Task 2 <files>, but a Zod-validated `expand` field that doesn't reach `hybridSearch` is non-functional. Server wiring is the missing closing link; it's a one-line change in the dispatcher + a two-param extension on handleSearchHybrid."
metrics:
  duration: "~25 min"
  tasks: 2
  files: 6
  completed_date: "2026-05-17"
---

# Phase 04 Plan 04: search-hybrid-expand Summary

Wave 4 — strictly additive composition of Plan 03's recency/authority
rescore and Plan 04-03's typed-edge `expand()` primitive. When a caller
passes `search_hybrid({expand: {hops: 1}})`, hybridSearch attaches a
1–2 hop typed-edge neighborhood as `expansions[]` per top-K hit. The
top-K ranking is unchanged; rescore happens BEFORE expand (D-16);
expand never participates in score computation.

This is the smallest plan in Phase 4 — pure composition over two
already-locked primitives, no new files (beyond this SUMMARY).

## What was built

### Task 1 — `src/search/hybrid.ts` post-rescore expand attachment + tests

- **`HybridSearchOptions.expand?: {hops: 1 | 2, direction?, edge_types?}`** —
  additive optional input mirroring the locked D-15 shape.
- **`HybridSearchOptions.expandDeps?: ExpandDeps`** — DI seam for the
  `manager + sourceConnectorFor` deps required by Plan 04-03's
  `expand()`. Mirrors the existing `displayUrlFor` injection idiom.
- **End-of-`hybridSearch()` block** — guarded by
  `if (opts.expand && opts.expandDeps && hits.length > 0)`. When the
  guard is false (the v1/v2 default), zero new DB reads and zero new
  computation — preserving v1-baseline byte-identity by construction
  (the existing `evals/v1-baseline/baseline.test.ts` stays green; the
  rescore-test invariance check `recency_weight=0 → v1` keeps the
  same RRF scores).
- **D-16 order locked** — expand block runs AFTER the Phase 3
  recency/authority rescore (lines 245–294) AND AFTER hit hydration,
  so expansions attach to the RESCORED top-K. Verified by Test 7: a
  hit whose rank only became top-K after rescore still receives its
  graph neighborhood.
- **Per-hit grouping** — single `expand(deps, opts)` call with ALL
  hit doc_ids as seeds; result documents are grouped by
  `via.seed_doc_id` in a one-pass O(n) Map and attached to the
  corresponding hit. No cross-hit pollution (Test 2).
- **Defensive try/catch** — expand failures are silent (same posture
  as the reranker fallback at hybrid.ts:342–347). The rest of the
  hybrid result is intact; only the `expansions` field stays unset.
- **`SearchHit.expansions?: CitationPacketWithVia[]`** — declared
  structurally inline in `src/types.ts` (keeps types.ts free of a
  graph-layer top-level import; shape is documented inline as a
  contract that MUST stay in sync with `CitationPacketWithVia`).
- **9 new behavior tests** in `src/search/hybrid.test.ts` covering
  the D-15 / D-16 contracts: additive happy path (Test 1), multi-seed
  grouping with no cross-hit pollution (Test 2), default
  direction='both' surfacing backward edges (Test 3), edge_types
  filter (Test 4), v1-invariance — no `expansions` field when
  omitted (Test 5), ranking + score preservation (Test 6),
  rescore-then-expand order (Test 7), hop=2 chain (Test 8), and
  empty-hits short-circuit (Test 9).

### Task 2 — `src/tool-registry.ts` Zod + JSON Schema + `src/server.ts` wiring

- **`search_hybrid` Zod schema** gains nested
  `expand: z.object({ hops: z.union([z.literal(1), z.literal(2)]),
  direction: z.enum(["forward","backward","both"]).optional(),
  edge_types: z.array(z.enum([...4 EdgeType values])).optional() }).optional()`.
  `hops` is the D-05 hop cap enforced at the boundary; `direction` is
  a closed three-value enum; `edge_types` is a closed four-value enum
  (same set as the standalone `expand` tool's schema in Plan 04-03).
- **`TOOLS` JSON Schema entry for `search_hybrid`** mirrors the Zod
  shape: `expand` property of type object, required `hops` with enum
  `[1, 2]`, optional `direction` and `edge_types` enums. The tool
  description gains a single sentence per the plan's <action>:
  "Pass `expand: {hops: 1}` to auto-attach 1–2 hop typed-edge
  neighbors as `expansions[]` per hit (preserves ranking; runs after
  recency/authority rescore)."
- **`src/server.ts` runtime wiring** (Rule 3 - Blocking deviation —
  see Deviations §1):
  - `search_hybrid` dispatcher reads the optional `p.expand` from the
    Zod-parsed input.
  - `handleSearchHybrid` gains two new params: `expandOpts` and
    `expandDeps`. The dispatcher constructs `ExpandDeps` from the
    existing `manager` + `adapterRegistry.resolveSource(...)` (same
    shape used by the standalone `expand` tool dispatcher in
    server.ts:845–851).
  - `handleSearchHybrid` forwards both into the `hybridSearch` call;
    when undefined, the inner guard short-circuits.
- **6 new tests** in `src/server.test.ts` (`Plan 04-04` describe
  block): Zod accept paths (`{hops:1}` + fully specified), hops/3
  rejection, direction/sideways rejection, v1-callers (no `expand`
  arg) still validate, JSON Schema property presence and structure,
  and the tool description change.

## Commits

- `f97978e` — feat(04-04): hybridSearch({expand}) — additive auto-expansion of top-K
- `91a00fc` — feat(04-04): tool-registry + server wire search_hybrid({expand}) end-to-end

## Verification

- `npx vitest run src/search/hybrid.test.ts` — 21 / 21 green (12 pre-existing + 9 new Plan 04-04 tests).
- `npx vitest run src/search/hybrid.rescore.test.ts` — 16 / 16 green (Phase 3 v1-invariance + rescore math untouched).
- `npx vitest run src/server.test.ts -t "Plan 04-04"` — 6 / 6 green.
- `npm test` — 1172 passing / 12 skipped / 0 failing (was 1157 / 12 baseline after Plan 04-03; +15 new tests = +9 in hybrid.test.ts and +6 in server.test.ts).
- `npm run lint` (`tsc --noEmit`) — clean.
- `bash scripts/lint-adapters.sh` — all 8 adapter-seam invariants green; no new `fs` / `gray-matter` / `path.join` / `chokidar` / bare-`.md` literals.
- `npm run eval:baseline` — 29 passing / 12 skipped (same skip count as Plan 04-03; the strict-equality tool-list snapshot test stays `.skip`'d per Plan 04-03 SUMMARY decision, regen deferred to Plan 04-07).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan §<action> pseudocode used the wrong `expand()` signature**

- **Found during:** Task 1 — the plan's <action> block shows
  `await expand(vault, {...})` with `vault` as the first argument and a
  `groupBy(hits, h => h.vaultName)` helper to loop over vaults. The
  actual Plan 04-03 signature is `expand(deps, opts)` where
  `deps = {manager, sourceConnectorFor}` and seed_doc_ids carry their
  own vault in the DocId URI. `expand()` already groups seeds by vault
  INTERNALLY (`src/graph/expand.ts` `byVault` map at lines 291–303),
  so the plan's per-vault outer loop in hybrid.ts would have been
  redundant and required passing a Vault through an unsupported
  signature. RESEARCH.md Pattern 4 (lines 416–438) has the same
  signature mismatch (`expand(opts.vaults[0], {...})`).
- **Fix:** Use a SINGLE `expand(opts.expandDeps, {seed_doc_ids, hops,
  direction, edge_types})` call with ALL hit doc_ids as seeds. Group
  result documents by `via.seed_doc_id` in one O(n) pass and attach to
  the corresponding hit. The cross-vault traversal threat (T-04-04-02)
  is still mitigated — it happens INSIDE `expand()` at the
  per-vault-state BFS boundary, not in hybrid.ts. The `groupBy` helper
  the plan inlined was therefore not needed and was not added.
- **Files modified:** `src/search/hybrid.ts`
- **Commit:** `f97978e`

**2. [Rule 3 — Blocking] Plan task split omitted runtime wiring**

- **Found during:** Task 2 — the plan listed only `src/tool-registry.ts`
  in Task 2 `<files>`. But a Zod-validated `expand` field that doesn't
  flow through to `hybridSearch` is non-functional. The success
  criterion `npm test` green + GRA-03 fulfillment require the tool to
  actually attach expansions when called.
- **Fix:** Extended the `search_hybrid` dispatcher in `src/server.ts`
  to forward `p.expand` into `handleSearchHybrid`; extended
  `handleSearchHybrid` to take two new optional params (`expandOpts`,
  `expandDeps`) and forward them into the inner `hybridSearch` call.
  The deps are constructed from the existing `manager` + adapter
  registry — same pattern used by the standalone `expand` tool
  dispatcher (server.ts:845–851). Server.test.ts was already in scope
  for Task 2 (Plan 04-04 Zod tests landed there) so the wiring change
  needed no separate test-file plan adjustment.
- **Files modified:** `src/server.ts`
- **Commit:** `91a00fc`

### Carryover

None. This plan is purely additive — no prior-plan code path is
mutated. The v1 `search_hybrid` shape (without `expand`) is preserved
byte-for-byte (Test 5 + the rescore-test v1-invariance suite).

### Test-fixture design choice

The plan's <behavior> describes tests where each hit has expansions
attached. Plan 04-03's locked seed-suppression rule
(SUMMARY decision: "seeds are excluded from result documents in ALL
cases") means a hit can never appear in another hit's expansions —
when a seed walks into another seed, the target is suppressed. So
the test fixture intentionally separates HITS (contain the query
token "atlas") from EXTRAS (contain no "atlas"; non-hits) and
arranges edges from hits to extras and from one extra to a hit. This
gives well-defined per-hit expansions: forward / backward / 2-hop /
typed-filter / rescore-promotion / short-circuit all exercise the
expected `via` trace shape.

This is a CLARIFICATION, not a deviation — the plan's <behavior>
descriptions match the implemented behavior; the fixture design just
makes the behavior testable under expand()'s pre-existing seed rule.

## TDD Gate Compliance

Both tasks were `tdd="true"` and ran the test-first cycle:

- **Task 1:** 9 new tests in `src/search/hybrid.test.ts` written
  FIRST → ran → all 9 RED (no `expansions` field; no `expand` opt) →
  implemented hybrid.ts + types.ts → ran → 5 still RED on first
  green pass (fixture design issue with seed-suppression) → iterated
  fixture design (HITS-vs-EXTRAS separation) → 21 / 21 green.
- **Task 2:** 6 new tests in `src/server.test.ts` written FIRST →
  ran → 4 / 6 RED (2 passed because Zod accepts unknown fields by
  default; the 4 that explicitly checked rejection / property
  presence / description text failed) → implemented tool-registry
  Zod + JSON Schema + description update + server wiring → ran →
  6 / 6 green.

Per-task RED commits not separated from GREEN commits (the executor
deviation-rules path was used rather than strict per-step commits),
but tests-before-code in both tasks. Both commits carry `feat(04-04)`
prefixes with co-located test changes.

## Known Stubs

None. The composition layer either fully attaches expansions (when
`opts.expand` is supplied with deps) or omits the field entirely (when
the guard short-circuits). No placeholder data; no TODO comments.

## Threat Flags

None new beyond the plan's `<threat_model>` register. Mitigations
applied per the plan:

- **T-04-04-01** (per-hit expansion ballooning result size): topK is
  already bounded (default 10, max 100 per existing Zod); expand's
  own hop cap=2 (D-05) + visited-set dedup bound the worst case.
- **T-04-04-02** (cross-vault expand): mitigated at the `expand()`
  boundary — per-vault BFS isolation lives INSIDE expand (Plan 04-03
  `byVault` map). The single-call composition pattern in hybrid.ts
  inherits this mitigation; no separate per-vault loop needed.
- **T-04-04-03** (`_memory` opacity bypass via search → expand):
  inherited from Plan 04-03 — `expand()` enforces opacity at
  hydration via the parallel `inboundSourceNoteId` recorded during
  BFS. This plan only composes the call; the opacity invariant
  travels with the result.
- **T-04-04-04** (v1-baseline invariance broken): guard
  `if (opts.expand && opts.expandDeps && hits.length > 0)`
  short-circuits when any of the three preconditions are unmet.
  Tests 5 + 6 explicitly pin the byte-identity property; the
  `evals/v1-baseline/baseline.test.ts` regression gate stays green.
- **T-04-04-SC** (npm install): No new npm deps; only existing
  imports were touched.

## Self-Check: PASSED

Verified files exist:

- `src/search/hybrid.ts` (modified) ✓
- `src/search/hybrid.test.ts` (modified) ✓
- `src/types.ts` (modified) ✓
- `src/tool-registry.ts` (modified) ✓
- `src/server.ts` (modified) ✓
- `src/server.test.ts` (modified) ✓
- `.planning/phases/04-graph-as-retrieval/04-04-search-hybrid-expand-SUMMARY.md` ✓

Verified commits exist (`git log --oneline -3`):

- `91a00fc` ✓ (feat(04-04): tool-registry + server wire search_hybrid({expand}) end-to-end)
- `f97978e` ✓ (feat(04-04): hybridSearch({expand}) — additive auto-expansion of top-K)

Verified test counts:

- `npx vitest run src/search/hybrid.test.ts` — 21 passing ✓
- `npx vitest run src/search/hybrid.rescore.test.ts` — 16 passing (Phase 3 v1-invariance untouched) ✓
- `npx vitest run src/server.test.ts -t "Plan 04-04"` — 6 passing ✓
- `npm test` — 1172 passing / 12 skipped / 0 failing ✓
- `npm run lint` (`tsc --noEmit`) — clean ✓
- `bash scripts/lint-adapters.sh` — all 8 invariants green ✓
- `npm run eval:baseline` — 29 passing / 12 skipped ✓
