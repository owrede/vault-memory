---
phase: 04-graph-as-retrieval
verified: 2026-05-17T23:15:00Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 4: Graph-as-retrieval Verification Report

**Phase Goal:** Promote backlinks/forward links from navigation tools to retrieval expansion via typed-edge graph traversal and community clustering, enabling Phase 5 brief compilation to use graph-driven source discovery.

**Verified:** 2026-05-17
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria + Phase Gate must_haves)

| #  | Truth                                                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                                                          |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | `expand({seed_doc_ids, hops, edge_types?, filter_properties?})` returns typed-edge neighborhoods with metadata (GRA-01 / SC1a)                                                                          | ✓ VERIFIED | `src/graph/expand.ts:228` exports `expand()`; registered as MCP tool `src/tool-registry.ts:750`; dispatched in `src/server.ts:860`; integration eval `src/graph/expand.integration.test.ts` runs 8 queries against `_queries/expand.yaml` with `via: {seed_doc_id, hop, edge_type, direction}` provenance |
| 2  | `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion of top-K results (GRA-03 / SC1b)                                                                                                          | ✓ VERIFIED | `src/search/hybrid.ts:126` declares `expand?: {...}` nested param; `src/search/hybrid.ts:510` attaches `expansions[]` to hits AFTER recency/authority rescore (D-16); registered in `src/tool-registry.ts:1003`; eval `src/search/hybrid-expand.integration.test.ts` runs 3 queries                |
| 3  | `cluster({query \| seed_doc_ids, method: "edge-community"})` produces deterministic cluster summaries per fixture; opt-in / capped if slow (GRA-02 / SC2)                                                | ✓ VERIFIED | `src/graph/cluster.ts:213` implements Louvain with `seedrandom("vault-memory-cluster-v1")`; 5000-node hard cap with `force:true` override; integration test `src/graph/cluster.integration.test.ts` pins byte-identical cluster_id assignment against `_queries/cluster.yaml`                       |
| 4  | Edges carry an explicit `type` field per ADR-003 — schema supports `wikilink`, `frontmatter-ref`, `mention`, `hyperlink` (GRA-04 / SC3)                                                                  | ✓ VERIFIED | `src/db/schema.ts:670` `CHECK (type IN ('wikilink','mention','frontmatter-ref','hyperlink'))`; all 4 extractors produce edges with corresponding types in `src/indexer/extract-edges.ts:128,178,264,384`                                                                                          |
| 5  | Eval fixture includes ≥5 expansion queries answered correctly (precision/recall ≥0.8) (GRA-05 / SC4)                                                                                                     | ✓ VERIFIED | `evals/fixtures/v2-test-vault/_queries/expand.yaml` contains 8 queries with `min_precision: 0.8` / `min_recall: 0.8`; `search-hybrid-with-expand.yaml` adds 3; `graph.yaml` adds 5; integration tests assert P/R thresholds and fail on regression                                                |
| 6  | CR-01 (idx_edges_unique conflict key too narrow → silent row drops) resolved with migration 012 + regression tests                                                                                       | ✓ VERIFIED | `src/db/schema.ts:768` `runMigration012` widens unique key to `(source_doc, COALESCE(target_doc,-1), COALESCE(target_path,''), type, COALESCE(rel,''), COALESCE(anchor,''), COALESCE(line_number,-1))` + Step C re-runs wikilink backfill; 5 CR-01 regression tests in `src/db/queries/edges.test.ts:280-421` |
| 7  | CR-02 (cluster() query-path silently scopes to first vault) resolved with required `vault` parameter on multi-vault setups + regression tests                                                            | ✓ VERIFIED | `src/graph/cluster.ts:213-260` CR-02 fix: `opts.vault` resolved via `deps.manager.require()`; multi-vault setups without explicit `vault` return `{ok:false, reason:"vault_required", configured_vaults:[...]}`; CR-02 regression suite in `src/graph/cluster.test.ts:415-551`                  |
| 8  | Tool-list snapshot regenerated EXACTLY ONCE with additive diff (2 new tools + 1 nested param + additive `type` on backlinks/forward_links results); zero v1 fields removed                              | ✓ VERIFIED | `evals/v1-baseline/tools-list.snapshot.json` line 856 (`expand`), 918 (`cluster`), 165 (`search_hybrid.expand`); 23 v1 tools still present                                                                                                                                                       |
| 9  | Full test suite, lint, adapter-lint, fixture-privacy lint, telemetry-lint, and full eval suite all green                                                                                                | ✓ VERIFIED | `npm test -- --exclude='.claude/worktrees/**'` → 90 files, **1221 passed**, 11 skipped, 0 failed (28.65s); `npm run lint` (`tsc --noEmit`) → clean exit                                                                                                                                          |
| 10 | `docs/v2/PHASE-4-SIGN-OFF.md` exists with GRA-01..GRA-05 checklist + resolving commit SHAs                                                                                                              | ✓ VERIFIED | `docs/v2/PHASE-4-SIGN-OFF.md` contains traceability table with commit SHAs (`c5b23c9, 685e44f, 26ee6ce` for GRA-01; `ee32c74, c502b07, ea0b2c1` for GRA-02; etc.) and per-requirement test file references                                                                                       |
| 11 | `CHANGELOG.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` reflect Phase 4 = COMPLETE                                                                                                                  | ✓ VERIFIED | `CHANGELOG.md:17-21` enumerates expand/cluster/search_hybrid({expand})/edges substrate/extractors; `.planning/STATE.md:28` `Phase: 04 (graph-as-retrieval) — COMPLETE (2026-05-17)`; `.planning/ROADMAP.md:17,117` Phase 4 marked complete                                                       |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact                                          | Expected                                                                            | Status     | Details                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `src/graph/expand.ts`                             | Typed-edge BFS with hops 1-2, direction, edge_types filter, _memory opacity         | ✓ VERIFIED | 497 LOC; `expand()` exported at line 228; wired into `tool-registry.ts` and `server.ts`            |
| `src/graph/cluster.ts`                            | Louvain over typed-edge graph, deterministic via seedrandom, 5000-node cap          | ✓ VERIFIED | 582 LOC; CR-02 fix at lines 213-260; wired into `tool-registry.ts:815` and `server.ts:895`          |
| `src/db/schema.ts` (edges table + migrations 011/012) | `edges` table with type CHECK, 4 types, widened unique index                       | ✓ VERIFIED | Migration 011 creates table; migration 012 (lines 729-822) widens `idx_edges_unique`               |
| `src/db/queries/edges.ts`                         | INSERT, getBacklinks, getForwardLinks, getAllForNodes                              | ✓ VERIFIED | 339 LOC; 14 tests in `edges.test.ts` including 5 CR-01 regression cases                            |
| `src/indexer/extract-edges.ts`                    | Unified extractor for all 4 edge types in single per-note pass                     | ✓ VERIFIED | 538 LOC; `extractAllEdges` at line 106 composes wikilink/mention/frontmatter-ref/hyperlink extractors |
| `src/search/hybrid.ts` (expand integration)       | Additive nested `expand` param; byte-identical to v1 when omitted                  | ✓ VERIFIED | Lines 491-545 implement guard + post-rescore expansion; v1-byte-identity test passes               |
| `evals/fixtures/v2-test-vault/_queries/expand.yaml` | ≥5 expansion queries with P/R thresholds                                          | ✓ VERIFIED | 8 queries; min_precision/min_recall 0.8 per query                                                  |
| `evals/fixtures/v2-test-vault/_queries/cluster.yaml` | Cluster snapshot for determinism check                                            | ✓ VERIFIED | Pinned cluster output for snapshot test                                                            |
| `evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml` | 3 queries exercising auto-expansion                              | ✓ VERIFIED | 3 queries wired into `hybrid-expand.integration.test.ts`                                           |
| `evals/v1-baseline/tools-list.snapshot.json`      | Additive diff: 2 new tools + 1 nested param + additive `type` field                | ✓ VERIFIED | `expand` (line 856), `cluster` (line 918), `search_hybrid.expand` (line 165); 23 v1 tools intact   |
| `docs/v2/PHASE-4-SIGN-OFF.md`                     | GRA-01..GRA-05 traceability + resolving commits                                    | ✓ VERIFIED | Full traceability table; per-requirement commit SHAs and test file refs                            |

### Key Link Verification

| From                                          | To                                                | Via                                          | Status     | Details                                                                                              |
| --------------------------------------------- | ------------------------------------------------- | -------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| MCP tool dispatcher (server.ts)               | `expand()` impl                                   | `tool-registry.ts:750` + `server.ts:860`     | ✓ WIRED    | Tool name registered, handler dispatch case present, schema validated via Zod                        |
| MCP tool dispatcher (server.ts)               | `cluster()` impl                                  | `tool-registry.ts:815` + `server.ts:895`     | ✓ WIRED    | Tool name registered, handler dispatch case present, mutually-exclusive input enforced               |
| `search_hybrid` handler                       | `expand()` post-rescore attachment                | `src/search/hybrid.ts:510-545`               | ✓ WIRED    | Guarded by `if (opts.expand && opts.expandDeps && hits.length > 0)`; expansions attached per hit     |
| Indexer single-note pipeline                  | `extractAllEdges` → `edges` table                 | `src/indexer/single.ts` + `single.test.ts`   | ✓ WIRED    | Indexer test suite green; edges populated on every note re-index                                     |
| Migration 011                                 | Migration 012 (CR-01 fix)                         | `runMigration012` in migration runner        | ✓ WIRED    | Sequential migration ordering preserved; auto-applies on Database construction                       |
| Eval fixtures                                 | Integration tests (P/R assertions)                | `expand.integration.test.ts:165`             | ✓ WIRED    | Tests fail on threshold regression; suite green in this verification run                             |
| `docs/v2/PHASE-4-SIGN-OFF.md`                 | `.planning/REQUIREMENTS.md` GRA-01..GRA-05         | Inline GRA-0[12345] checklist                | ✓ WIRED    | Every GRA ID mapped to plan-id, commits, and test files                                              |

### Data-Flow Trace (Level 4)

| Artifact                          | Data Variable                    | Source                                                       | Produces Real Data | Status      |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------ | ------------------ | ----------- |
| `expand()` output                 | typed-edge neighborhoods         | `edges` table via `getAllForNodes`/getBacklinks/getForwardLinks | Yes               | ✓ FLOWING   |
| `cluster()` output                | community assignments            | graphology-louvain over `edges` adjacency                    | Yes                | ✓ FLOWING   |
| `search_hybrid({expand})` hits    | `expansions[]` per hit            | post-rescore call to `expand()` against top-K seed doc_ids   | Yes                | ✓ FLOWING   |
| `edges` table                     | rows per note                    | indexer `extractAllEdges` per note + migration 011 backfill  | Yes                | ✓ FLOWING   |
| Integration tests                 | precision/recall scores          | runtime BFS over real fixture vault (50+ notes)              | Yes                | ✓ FLOWING   |

### Behavioral Spot-Checks

| Behavior                                                          | Command                                                       | Result                          | Status |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------- | ------ |
| Full test suite passes (1221 expected)                            | `npm test -- --exclude='.claude/worktrees/**'`                | 1221 passed, 11 skipped, 0 failed | ✓ PASS |
| TypeScript strict lint passes                                     | `npm run lint` (`tsc --noEmit`)                               | Clean exit, zero errors          | ✓ PASS |
| `expand` MCP tool registered in tool-list snapshot                | `grep -n 'expand' evals/v1-baseline/tools-list.snapshot.json` | Found at line 856                | ✓ PASS |
| `cluster` MCP tool registered in tool-list snapshot               | `grep -n 'cluster' evals/v1-baseline/tools-list.snapshot.json`| Found at line 918                | ✓ PASS |
| Schema CHECK constraint covers all 4 edge types per ADR-003       | `grep CHECK src/db/schema.ts`                                 | `('wikilink','mention','frontmatter-ref','hyperlink')` | ✓ PASS |
| CR-02 vault_required guard present                                | `grep 'vault_required' src/graph/cluster.ts`                  | Found at line 154, 246           | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan            | Description                                                                  | Status      | Evidence                                                                                                                                            |
| ----------- | ---------------------- | ---------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GRA-01      | 04-03                  | `expand` MCP tool — typed-edge neighborhood with metadata                    | ✓ SATISFIED | `[x]` in REQUIREMENTS.md:79; `src/graph/expand.ts` + integration eval; tool-list snapshot entry                                                     |
| GRA-02      | 04-05                  | `cluster` MCP tool — Louvain communities; deterministic; opt-in/capped       | ✓ SATISFIED | `[x]` in REQUIREMENTS.md:80; `src/graph/cluster.ts` + `cluster.integration.test.ts`; CR-02 fix verified                                              |
| GRA-03      | 04-04                  | `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion               | ✓ SATISFIED | `[x]` in REQUIREMENTS.md:81; `src/search/hybrid.ts:126,510`; `hybrid-expand.integration.test.ts` covers 3 queries                                    |
| GRA-04      | 04-01, 04-02           | Edges carry explicit `type` per ADR-003 — 4 edge types                       | ✓ SATISFIED | `[x]` in REQUIREMENTS.md:82; `src/db/schema.ts:670` CHECK constraint; all 4 extractors in `src/indexer/extract-edges.ts`                            |
| GRA-05      | 04-06                  | Eval fixture ≥5 expansion queries (precision/recall ≥0.8)                    | ✓ SATISFIED | `[x]` in REQUIREMENTS.md:83; `_queries/expand.yaml` has 8 P/R-asserted queries + `search-hybrid-with-expand.yaml` (3) + `graph.yaml` (5)             |

All 5 GRA requirements present in REQUIREMENTS.md AND have working implementation evidence. No orphans.

### Anti-Patterns Found

| File                                          | Line | Pattern                          | Severity | Impact                                                                              |
| --------------------------------------------- | ---- | -------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| (none)                                        | —    | —                                | —        | `grep -rE 'TODO\|FIXME\|XXX\|TBD\|HACK'` against `src/graph/`, `src/indexer/extract-edges.ts`, `src/db/queries/edges.ts` returned zero results in production code. Test files do reference `TODO` only inside comments documenting behavior. |

### Human Verification Required

None. All success criteria are verifiable programmatically via tests (P/R thresholds, snapshot stability, additive-diff lint, type-safe schema). No visual / real-time / external-service behaviors in this phase.

### Gaps Summary

No gaps. All 4 ROADMAP success criteria, all 5 GRA requirements, all 7 Phase 4 plans' must-have artifacts, both CR-01 and CR-02 fixes (with regression tests), and the full sign-off documentation are in place. The remaining 7 warnings + 4 info items from `04-REVIEW.md` are explicitly marked as advisory ("triage in a follow-up gap-closure phase or close out individually") and do not block goal achievement.

**Notable strengths:**

- v1 byte-identity guard in `search_hybrid` is correctly gated — when `opts.expand` is omitted the code path is byte-identical to Phase 3 (confirmed by `src/search/hybrid.ts:113-115` and the unchanged 23 v1 tool-list entries).
- CR-01 fix uses idempotent migration: drop narrow index → create widened index → re-run wikilink backfill with `INSERT OR IGNORE` against the new key. Safe on partial-replay.
- CR-02 fix preserves single-vault backwards compatibility while requiring explicit `vault` only on multi-vault setups; rejection path returns structured `{ok:false, reason:"vault_required", configured_vaults:[...]}` for clean caller UX.
- Eval-driven testing: `expand.integration.test.ts`, `cluster.integration.test.ts`, `hybrid-expand.integration.test.ts` all consume YAML fixtures, so future regressions in retrieval quality fail the suite automatically.

---

_Verified: 2026-05-17T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
