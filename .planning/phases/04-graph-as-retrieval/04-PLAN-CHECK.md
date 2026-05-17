---
phase: 04
phase_name: graph-as-retrieval
checked: 2026-05-17
verdict: PASS
checker: gsd-plan-checker (sonnet)
iteration: 1 + orchestrator revisions
---

# Phase 4 Plan Check

## Verdict

**PASS** — after orchestrator-applied revisions to address 1 blocker + 3 warnings from the initial `REVISE` verdict.

Initial verdict was `REVISE` with 2 blockers and 4 warnings. Blocker B-2 was waived by precedent (Phase 3 shipped without a standalone VALIDATION.md and passed verification; the project convention is to embed Validation Architecture inside RESEARCH.md). All remaining blockers and required warnings were fixed.

## Plan Inventory

| Plan | Wave | depends_on | Tasks | Files | Auto | Reqs |
|------|------|------------|-------|-------|------|------|
| 04-01 edges-substrate | 1 | [] | 2 | 9 | yes | GRA-04 |
| 04-02 edge-extractors | 2 | [04-01] | 2 | 6 | yes | GRA-04 |
| 04-03 expand-tool | 3 | [04-01, 04-02] | 2 | 6 | yes | GRA-01 |
| 04-04 search-hybrid-expand | 4 | [04-03] | 2 | 3 | yes | GRA-03 |
| 04-05 cluster-tool | 4 | [04-03] | 3 + checkpoint | 9 | no | GRA-02 |
| 04-06 evals-conformance | 5 | [04-03, 04-04, 04-05] | 5 | 8 | yes | GRA-01..05 |
| 04-07 phase-gate | 6 | all prior | 4 + checkpoint | 5 | no | GRA-01..05 |

## Goal Coverage

| ROADMAP Success Criterion | Plans satisfying it |
|---------------------------|---------------------|
| 1. `expand({…})` + `search_hybrid({expand})` | 04-03 + 04-04 |
| 2. `cluster({…})` deterministic per fixture | 04-05 + 04-06 (cluster.yaml) |
| 3. Edges carry explicit `type` field; 4 types | 04-01 (table + DDL CHECK) + 04-02 (extractors) |
| 4. ≥5 expand queries with P/R ≥0.8 | 04-06 expand.yaml (D-17) |

## Requirement Coverage

All 5 GRA-NN IDs appear in plan `requirements:` frontmatter:
- GRA-01 → 04-03 (primary), 04-06 (eval)
- GRA-02 → 04-05 (primary), 04-06 (eval)
- GRA-03 → 04-04 (primary), 04-06 (eval)
- GRA-04 → 04-01 + 04-02, 04-06 (eval)
- GRA-05 → 04-06 (primary)

## Decision Adherence (D-01..D-18 + D-15a)

All 19 locked decisions implemented or explicitly deferred:
- D-01 → 04-01 (new edges table, backfill, wikilinks kept)
- D-02 → 04-02 (single-pass extraction)
- D-03 → 04-02 (mention rules)
- D-04 → 04-01 (additive type field on v1 graph tools)
- D-05..D-09 → 04-03 (expand API)
- D-10..D-14 → 04-05 (cluster + Louvain)
- D-15 + D-16 → 04-04 (rescore-then-expand)
- D-15a → 04-05 (query OR seed_doc_ids)
- D-17 + D-18 → 04-06 (eval YAMLs)

## Pitfall Mitigation (all 7 RESEARCH pitfalls)

| Pitfall | Plan(s) | Mitigation |
|---------|---------|------------|
| 1. Louvain determinism 2-prong | 04-05 | DocId-sorted insertion + seedrandom('vault-memory-cluster-v1') |
| 2. Mention false-positive rate | 04-02 + 04-06 (A1 validation) | Empirical check against Atlas Robotics fixture |
| 3. `_memory` opacity at hydration | 04-03 | In-memory check via BFS-recorded `via` chain (W-3 fix) |
| 4. Shortest-path comparator | 04-03 | `isShorterPath` unit-tested directly |
| 5. Chunked backfill (10k rows) | 04-01 | `runMigration008` pattern |
| 6. Frontmatter-ref allowlist | 04-02 | 2-rule heuristic documented in tool description |
| 7. Hyperlink scope (http(s):// only, skip relative/embed) | 04-02 | Filter rule encoded |

## Revisions Applied (Orchestrator)

### B-1 (BLOCKER) — RESEARCH Open Questions resolution marker
**File:** `04-RESEARCH.md` line 716
**Fix:** Renamed `## Open Questions` → `## Open Questions (RESOLVED)`. Prefixed each recommendation with `**RESOLVED:**` and added explicit plan-lock reference (04-02, 04-03, 04-05).

### B-2 (BLOCKER) — Waived by precedent
**Issue:** No standalone `04-VALIDATION.md` file.
**Resolution:** Phase 3 shipped without a separate VALIDATION.md and passed verification. Project convention is to embed Validation Architecture inside RESEARCH.md (§"Validation Architecture" lines 749–797 of `04-RESEARCH.md`). Downgraded to documentation-only by orchestrator on Phase 3 precedent. If config.json adds an explicit gate later, the convention can be reified into a standalone file via `/gsd:plan-phase 4 --research`.

### W-3 (WARNING) — `_memory` opacity action wording
**File:** `04-03-expand-tool-PLAN.md`
**Fix:** Tightened action language to specify the in-memory check via BFS-recorded `via` chain (parallel `Map<noteId, inboundSourceId>`), avoiding the N+1 query path implied by the original wording.

### W-4 (WARNING) — 04-02 Test 3 contradiction
**File:** `04-02-edge-extractors-PLAN.md` line 144
**Fix:** Rewrote Test 3 example to remove the "ZERO additional mention edges" / "DOES generate a mention edge" contradiction. New expected behavior: `[[Alice]] and Alice C. attended.` produces ONE wikilink + ONE mention; pre-stripping `[[…]]` prevents double-counting the bracketed name.

### W-5 (WARNING) — 04-04 groupBy commitment
**File:** `04-04-search-hybrid-expand-PLAN.md` line 152
**Fix:** Verified `groupBy` does NOT exist in `src/` (grep evidence inline). Committed to inlining a file-local 7-line helper at the top of the expand block in `src/search/hybrid.ts` (not a new utility module).

### W-1, W-2 (WARNINGS) — Documentation-only, no fix required
- W-1: 04-05 scope (3 tasks + checkpoint, 9 files) — acceptable as natural single-library integration unit.
- W-2: `EdgesQueries` surface evolves across 04-01 / 04-03 / 04-05 — acceptable per YAGNI; each extension is additive and tested in the plan that introduces it.

## Source-Coverage Audit

- **GOAL** (ROADMAP Phase 4 goal) — COVERED by 04-01..04-05 (storage + 2 tools + composition).
- **REQ** — all 5 GRA-NN IDs covered.
- **RESEARCH** — all 7 Pitfalls + 19 decisions + 3 Open Questions woven into plans.
- **CONTEXT** — all D-01..D-18 + D-15a implemented; no deferred ideas planned; no scope reductions.
- **PATTERNS** — 16/18 files have direct analog refs cited in plan tasks; 2 fall back to RESEARCH code examples (cluster.ts Louvain, mention regex builder).

## Threat Model Adequacy

- **Supply-chain (04-05)**: BLOCKING `checkpoint:human-verify` before `npm install graphology graphology-communities-louvain seedrandom` per RESEARCH §Package Legitimacy Audit.
- **Memory-namespace leakage (Pitfall 3)**: T-04-03-01 logs hydration-time filter + ADR-004 citation + test 16. T-04-05-04 inherits via `expand()`.
- **No new outbound network calls**: explicit forbid-import test in 04-05.

## Execution Readiness

Plans are **execution-ready**. Recommended next step:

```
/clear
/gsd:execute-phase 04
```

Wave 4 (04-04 + 04-05) can run in parallel since they touch disjoint files. Two BLOCKING human-verify checkpoints: 04-05 start (supply chain), 04-07 (tool-list snapshot diff review).

---

*Plan check completed: 2026-05-17*
*Verdict: PASS after orchestrator revisions*
