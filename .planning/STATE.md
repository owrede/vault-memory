---
gsd_state_version: 1.0
milestone: v2.0.0
milestone_name: release
status: ready_to_plan
stopped_at: Phase 5 context gathered
last_updated: "2026-05-18T07:51:29.350Z"
last_activity: 2026-05-17
progress:
  total_phases: 10
  completed_phases: 5
  total_plans: 51
  completed_plans: 51
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-14)

**Core value:** Local-first, source-agnostic-ready, agentic knowledge layer over your Obsidian notes — with the memory namespace as a non-negotiable safety invariant.
**Current focus:** Phase 5 — compiled brief layer

## Current Position

Phase: 5
Plan: Not started
Plans: 7 implementation slices, all signed off. Phase 4 sign-off doc at `docs/v2/PHASE-4-SIGN-OFF.md`.

Phase 4 ships:

- 2 new MCP tools: `expand` (typed-edge BFS), `cluster` (Louvain communities, deterministic)
- Additive `search_hybrid({expand})` nested param — auto-attaches per-hit typed-edge neighbors as `expansions[]`; ranking unchanged
- Typed-edge storage substrate: `edges` table with 4 edge types (`wikilink`, `mention`, `frontmatter-ref`, `hyperlink`), migration 011 + chunked backfill from v1 `wikilinks`
- Unified indexer extractor — all four edge types in a single per-note parse pass; `MIN_MENTION_LEN=4` empirically validated (0 raw FPs / 62 notes)
- Graph result rows widen from `relation: "wikilink"` to `relation: EdgeType` (additive); Phase 3 `PHASE-4-WIDEN` markers retired
- Strict-equality tool-list snapshot test re-enabled after Plan 04-03 deferral
- 1211 tests passing (was 1076 at Phase 3 sign-off; +135 net Phase 4)
- Tool surface 30 → 32 (additive only; 23 v1 + 7 Phase 3 entries content-identical)
- 3 new deps (Phase 4 plan 04-05): `graphology`, `graphology-communities-louvain`, `seedrandom` — all pure-JS ESM MIT, provenance-verified; bundle 376KB → 392KB

Next: `/gsd-plan-phase 5` — Compiled brief layer (BRF-01..BRF-11).
Last activity: 2026-05-17

---

Phase 3 (kept for context, completed 2026-05-17):

- 4 new MCP tools: `get_outline`, `search_sections`, `get_document_bundle`, `assemble_dossier`
- Additive `search_hybrid` rescore signals (recency, authority, superseded filter)
- Section identity substrate (migration 010 + ADR-003 H-7 anchors)
- Source-neutrality conformance suite (ASM-12) parameterized over obsidian-fs + stub adapters
- 1076 tests passing (was 903 at Phase 2 sign-off; +173 net)
- Tool surface 26 → 30 (additive only; 23 v1 entries byte-identical)

Next: `/gsd-plan-phase 4` — Graph-as-retrieval (GRA-01..GRA-05).
Last activity: 2026-05-17 -- Phase 04 execution started

Progress: [██████████████░░░░░░] 50%

## Performance Metrics

**Velocity:**

- Total plans completed: 23
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02 | 16 | - | - |
| 04 | 7 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Phase 4 D-01: `wikilinks` table preserved alongside new `edges` table for v1 invariance; v3 cleanup will drop the v1 table once no v1 tool reads from it
- Phase 4 D-12: Louvain determinism enforced at three control points — lexicographic DocId sort before node insertion + `seedrandom('vault-memory-cluster-v1')` rng + `cluster_id = smallest member DocId`. Snapshot-pinned in `_queries/cluster.yaml`
- Phase 4 D-15: `search_hybrid({expand})` is a strictly additive nested param — guard-and-short-circuit composition keeps v1-baseline byte-identical when omitted; expansion runs AFTER rescore (D-16) and never participates in score
- Phase 4 D-16: `_memory/` opacity rule enforced at hydration time in `expand()` via visited-map check; O(1) per candidate; memory-sink docs surface only when transitively reachable from a user-note seed
- Phase 4 A1 (validated): `MIN_MENTION_LEN = 4` produces 0 raw FPs over 62 Atlas-Robotics notes — trip-wire (≤3 FPs/note) satisfied with very wide margin; no bump to 5 needed
- Phase 4 A4 (validated): library-source read of `graphology-communities-louvain@2.0.2` confirms `randomWalk: true + rng` covers all Louvain entropy sources (randomized node-visit order + random-walk-based reassignment)
- Roadmap: Fold brief's Phase 4 (authority/staleness) into Phase 3 (bundles) — shared result shape
- Roadmap: Insert Phase 9 as hard premise-check gate before any v3 Notion work
- Roadmap: Defer brief's Phase 10 (Notion connector) to v3.0.0 — listed as deferred milestone, not active phase
- Roadmap: Renumber sequentially 0–9 to avoid confusion (brief's 4 folded, brief's 9.5 → 9)
- Phase 0: Expand from 6 brief-deliverables to 14 (ADR relocation, hash-semantics amendment, v1 eval baseline, tool-snapshot tests, fixture-privacy + telemetry CI lints, adversarial ADR review)
- Phase 2 D-01: `recall` returns the Phase-3 citation-packet shape (8 fields) from day one — avoids a breaking shape-change between v2.0.0 minor versions
- Phase 2 D-02: `record_observation` accepts a freeform `properties: Record<string, unknown>` escape hatch; sugar args pre-fill canonical keys, `properties` merges LAST so contract-allowed extras win
- Phase 2 D-03: `supersede` is forward-only — writes status/superseded_by/superseded_reason on the OLD doc only; back-edges derived at query time in Phase 4 (no materialization in Phase 2)
- Phase 2 D-04: `record_observation` + `supersede` stay as separate primitives (no composite tool) — supports MEM-09's tool-surface-reduction goal
- Phase 2 plan-split: 02-03 stayed focused on the centralized DeliveryAdapter chokepoint; the v1 entry-point Guards + server bootstrap wiring split out into a new 02-03b plan (wave 1) — kept each plan's chokepoint focused and isolated MEM-07 + MEM-11 from the validator slice

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- ~~Phase 0: ADRs 001–004 currently gitignored at `docs/dev/`; first Phase 0 PR must relocate them to public `docs/v2/adr/`~~ — resolved Wave 2/3, all four ADRs now Accepted at `docs/v2/adr/`
- ~~Phase 2: ADR-004 amendment (folder vs separate-vault) must land before implementation~~ — resolved in plan 00-05 (folder-default + sentinel)
- Phase 5: ADR on LLM strategy (MCP Sampling → Ollama → caller-text ladder) must land before implementation
- Phase 7: Spike outcome (file-watcher vs full Obsidian plugin) decides scope; descope path to "Canvas as view, YAML as authoring" if spike fails
- Phase 0 follow-up: Alpine docker bake-test for CI lint scripts (00-12) — static review + telemetry red-test + suppression test passed locally; Alpine container POSIX run deferred (Docker daemon was unavailable). Re-verify before Phase 1.
- ~~Phase 1 wave-5 known flake: chokidar `awaitWriteFinish` timing race in `src/adapters/change-feed/obsidian-fs/{change-feed,watcher}.test.ts` under full-suite load~~ — resolved 2026-05-15 by quick task 260515-hkc (commits `678dde3` `9216944` `260da64` `ff635f3` plus 3 reverts of an over-eager threshold pursuit). Final mitigation: chokidar `stabilityThreshold` bumped 200ms→400ms + drain test sleep 400ms→500ms (root-cause; reduces incidence ~25%→~17%) + `test.retry(1)` on 4 ObsidianFsChangeFeed/VaultWatcher positive-assertion timing tests (insurance against residual ~17% race). 5/5 full-suite runs green on main at mean 8.3s wall-clock. Lessons learned: (i) threshold pursuit beyond 400ms regresses sibling sleep-based tests; (ii) any timing-sensitive test in this family needs retry-1 as belt-and-suspenders; (iii) executor's 5/5 in-worktree run was lucky — flake distribution shifts on main under different load (post-merge testing surfaced a 4th retry candidate beyond the 3 originally annotated).
- Phase 1 wave-5 environment lesson: after merging the SDK/Zod bump worktree, `npm install` MUST be run on main — npm initially dedupped to the SDK's transitive Zod 3.25 hoist, leaving the project running v3 with a v4 package.json declaration. After explicit `npm install`, Zod 4.4.3 is live and the snapshot regen produces zero diff. The verifier (or 01-06) should re-confirm `node -e "require('zod/package.json').version"` reads `4.x` post-CI install.
- Phase 2 plan 02-08 latent issue (discovered + resolved): `lint-no-telemetry.sh` banlist regex `sentry` matched the substring `sEntry` in the new `MemoryStatsEntry` type (Plan 02-06). Resolved by appending the prescribed `// vault-memory:no-telemetry-ok` escape comment to the 5 offending lines (commit `3a365b9`). Future Phase 2+ plans introducing identifiers with embedded ban-list substrings should append the same escape marker proactively. The lint script itself documents this remedy.
- Phase 2 plan 02-08 deferred item (NOT a blocker): `npm run lint:check` reports prettier formatting warnings across 34 Phase 2 source files. This is a cumulative formatting-only debt; none of the four critical gates (`npm test`, `npx tsc --noEmit`, `bash scripts/lint-adapters.sh`, `npm run eval:baseline`) regress. Phase 3 or Phase 8 (polish) should run `prettier --write src/**/*.ts` and commit the result; it is out of scope for the 02-08 sign-off plan.

## Phase 2 Summary (2026-05-15)

Phase 2 (memory-namespace-provenance-contract) shipped across 9 plans in 5 waves: 02-01 (ADR-004 amendment, MEM-12), 02-02 (MemorySink runtime substrate — handle parser, registry, sentinel, default-memory-v1 contract, MEM-01/05/06), 02-03 (centralized validator at the DeliveryAdapter chokepoint with parametric conformance, MEM-05/06), 02-03b (v1 entry-point Guards + server bootstrap wiring, MEM-07/11), 02-04 (`record_observation` + `supersede` MCP tools, MEM-02/04), 02-05 (`recall` MCP tool + Phase-3-shaped 8-field citation packet, MEM-03), 02-06 (`is_memory_sink_write` audit column via migration v9 + the 2 promoted MCP Resources `vault-memory://memory/sinks` and `vault-memory://memory/stats`, MEM-08/09), 02-07 (20-doc memory fixture extension + 5 malformed fixtures under `tests/fixtures/malformed-memory/` + 35-assertion smoke test, MEM-10), 02-08 (final phase-gate verification + traceability + CHANGELOG/STATE + maintainer checkpoint). Plan 02-03 was split mid-phase into 02-03 (validator chokepoint, wave 1) and 02-03b (v1 Guards + bootstrap wiring, wave 1) per maintainer direction to keep each plan's scope focused. The safety invariant ("agent writes go only to a labeled `MemorySink` with mandatory provenance, centralized at `DeliveryAdapter.write()`") is now demonstrably true at runtime — `npm test` reports 825 passing tests; `npm run eval:baseline` 30/30 (+11 todo); `scripts/lint-adapters.sh` 8/8 invariants green; `node scripts/smoketest-non-claude.mjs` exercises ≥1 memory tool + ≥1 memory Resource end-to-end. The tool surface is 26 (23 v1 byte-identical + 3 net-new memory tools); the only audit_log diff is one new optional `is_memory_sink_write` input field on the JSON Schema (description text byte-identical to Phase 1).

## Quick Tasks Completed

| Date | Slug | Description | Outcome |
|------|------|-------------|---------|
| 2026-05-15 | [260515-hkc](.planning/quick/260515-hkc-fix-chokidar-timing-flake/SUMMARY.md) | Fix chokidar timing flake (Phase 1 carry-forward) | complete via option B fallback — 400ms `stabilityThreshold` + drain test 500ms sleep + `test.retry(1)` on 4 tests. 5/5 post-merge full-suite runs green (mean 8.3s wall-clock). 4 rounds, 9 commits + 3 reverts. |
| 2026-05-16 | [20260516-test-suite-quality-audit](.planning/quick/20260516-test-suite-quality-audit/SUMMARY.md) | Audit test-suite quality vs Phase 2 safety claims + apply 5/6 recommended fixes | Audit found 3 overclaims (H1/H2/M2) + 2 acknowledged gaps (M1/M3). Fixes applied: H1 disk-read sibling test, H2 5 Windows-simulation tests via path.win32, M1 it.todo→it.skip (11 visible skips), M2 delete test split + isolated derivation sibling, M3 12-test composition characterization. Net: 884 passed | 11 todo → 903 passed | 11 skipped. Deferred: Phase 3 retrieval-quality harness; defense-in-depth at pathInSink. |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v3.0.0 | Notion connector (NOT-01..07) | Deferred to v3 | Roadmap creation |
| v3.0.0 | MCP daemon mode (DMN-01..03) | Deferred to v2.1.x/v3.0.0 | Roadmap creation |
| post-v3 | Third-party connectors (TPC-01..03) | Deferred post-v3 | Roadmap creation |

## Session Continuity

Last session: 2026-05-18T07:51:29.343Z
Stopped at: Phase 5 context gathered
Resume file: .planning/phases/05-compiled-brief-layer/05-CONTEXT.md
Next: `/gsd-execute-phase 3`
