---
phase: 00-foundation-decisions
plan: 11
subsystem: evals
tags: [test-infrastructure, regression-baseline, fnd-09, fnd-10]
requires: [09, 10]
provides: [v1-baseline-regression-suite, tools-list-snapshot-test, fixture-integrity-test]
affects: [evals/v1-baseline/]
tech_added: []
patterns_used: [vitest-discovery, literal-file-snapshot, referential-integrity-check]
key_files_created:
  - evals/v1-baseline/baseline.test.ts
  - evals/v1-baseline/search_semantic.yaml
  - evals/v1-baseline/search_text.yaml
  - evals/v1-baseline/search_hybrid.yaml
  - evals/v1-baseline/list_backlinks.yaml
  - evals/v1-baseline/list_forward_links.yaml
  - evals/v1-baseline/find_broken_links.yaml
  - evals/v1-baseline/query_frontmatter.yaml
  - evals/v1-baseline/search.yaml
  - evals/v1-baseline/fetch.yaml
  - evals/v1-baseline/vault_stats.yaml
  - evals/v1-baseline/suggest_frontmatter.yaml
  - evals/v1-baseline/graph_neighbors.yaml
  - evals/v1-baseline/graph_path.yaml
key_files_modified: []
key_decisions:
  - "v3-graph-tool-placeholders: ship graph_neighbors.yaml and graph_path.yaml with empty queries to satisfy VALIDATION row 00-09-01's literal file-existence grep, rather than amend VALIDATION (lower-friction; placeholder content explains the v1-vs-VALIDATION tool-name mismatch)"
  - "todo-not-skip: precision/recall assertions use it.todo() per D-14 — Phase 1 converts to live it() after the fixture vault is Ollama-indexed; reports as 'todo' in vitest output rather than 'skipped'"
  - "yaml-shape: each fixture carries a top-level `tool:` field plus the D-09 queries[] schema; the test asserts `tool` matches the filename stem to catch rename desync"
metrics:
  duration_seconds: 396
  task_count: 2
  file_count: 14
  completed: 2026-05-14T16:07:52Z
---

# Phase 0 Plan 11: v1 Baseline Regression Suite Summary

Build the v1 regression baseline: 13 YAML fixtures + a vitest suite that pins
the `tools/list` snapshot (FND-10) and enforces fixture referential integrity
(FND-09 Pitfall 5). Precision/recall stays `.todo` for Phase 1 to wire after
the fixture vault is Ollama-indexed.

## What Shipped

### Per-tool semantic-floor YAMLs (FND-09)

11 real v1 behavioral tools, each with ≥ 3 D-09-schema queries reaching real
files in `evals/fixtures/v2-test-vault/`:

| Tool                  | Queries | Example expected source                                                |
| --------------------- | ------- | ---------------------------------------------------------------------- |
| `search_semantic`     | 4       | `decisions/2026-03-12-pivot-to-warehouse.md` (semantic paraphrase)     |
| `search_text`         | 4       | `decisions/2026-04-29-second-source-perception-head.md` (literal BM25) |
| `search_hybrid`       | 4       | `meetings/2026-04-15-q2-okr-review.md` + project-page combo            |
| `list_backlinks`      | 3       | `projects/atlas-1.md` ← three sub-project pages                        |
| `list_forward_links`  | 3       | OKR review → three attendee people-pages                               |
| `find_broken_links`   | 3       | Sentinel files (decisions/, projects/) — Phase 1 asserts count         |
| `query_frontmatter`   | 3       | status=active projects, status=accepted decisions, role $exists        |
| `search` (flat)       | 4       | Connector-style id format: `v2-test-vault:decisions/…`                 |
| `fetch` (flat)        | 3       | `id` → body roundtrip with content assertions                          |
| `vault_stats`         | 3       | Sentinel files from each major folder                                  |
| `suggest_frontmatter` | 3       | Existing project + draft meeting + draft decision modes                |

**Total: 37 active query specs across 11 real tools.**

### Placeholders for v3 graph tools

`graph_neighbors.yaml` and `graph_path.yaml` ship with `queries: []` and a
top-of-file comment explaining the v1-vs-VALIDATION mismatch (see Deviations
below).

### Test runner — `evals/v1-baseline/baseline.test.ts`

Layout:

| `describe` block                            | `it` blocks                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `v1 tools/list surface (FND-10)`            | `matches the pinned snapshot exactly`; `has exactly 23 tools`             |
| `v1 baseline fixtures parse (FND-09)`       | `discovers at least one fixture file`                                     |
| `v1 baseline fixtures parse > <toolName>`   | `parses as YAML with tool and queries`; `expected_doc_ids reference real fixture files`; `it.todo("achieves >= 0.8 precision and >= 0.8 recall …")` for non-empty fixtures |

Discovery is dynamic: `readdirSync(__dirname).filter(f => f.endsWith(".yaml"))`
— adding a new YAML automatically gets covered.

### Test results

- `npx vitest run evals/v1-baseline/baseline.test.ts`: **40 tests, 29 pass + 11 todo**
- `npm test` (full suite): **40 test files, 397 pass + 11 todo** (was 39 / 368 → +1 file, +29 tests, +11 todos; no regressions)
- `npx tsc --noEmit`: clean
- VALIDATION row 00-09-02 (`-t 'baseline fixtures parse'`): passes
- VALIDATION row 00-10-02 (`-t 'matches the pinned snapshot'`): passes

## Deviations from Plan

### `[Rule 2 — placeholder strategy]` v1-vs-VALIDATION tool-name mismatch (documented per plan §action)

- **Found during:** Task 1 — VALIDATION row 00-09-01's grep manifest lists `graph_neighbors` and `graph_path`, but those tools don't exist in v1.0.0's `src/tool-registry.ts`. The v1 graph surface is `list_backlinks`, `list_forward_links`, `find_broken_links`.
- **Plan resolution chosen:** Ship empty-queries placeholder YAMLs (the plan's explicit default option). `graph_neighbors.yaml` and `graph_path.yaml` each carry `tool: <name>\nqueries: []` plus a comment block flagging the discrepancy and pointing at this SUMMARY. The validator's file-existence check passes; no real graph-traversal semantic floor is asserted (correct — those tools don't exist yet).
- **Maintainer action:** When the phase that introduces `graph_neighbors` / `graph_path` runs, replace these placeholders with real D-09 fixtures. Or, when convenient, update VALIDATION row 00-09-01 to list the actual v1 graph tool names.

No other deviations — both tasks executed as planned. No bugs, no scope expansion, no architectural surprises.

## Phase 1 `.todo` hooks to light up

`baseline.test.ts` emits 11 `it.todo(...)` entries — one per non-empty fixture
(the 11 real tool YAMLs). Phase 1 must:

1. Stand up the fixture vault as a Vault registered with `VaultManager` (likely an in-process `:memory:` SQLite + a sandbox tmpdir copy of `evals/fixtures/v2-test-vault/`).
2. Run a one-time Ollama index against it (per D-14 — the eval harness needs real embeddings).
3. Convert each `it.todo("achieves >= 0.8 precision and >= 0.8 recall vs expected_doc_ids")` into an `it(...)` that:
   - Loads the YAML with `parseYaml`.
   - For each query: invokes the tool with `q.args` (when present) or constructs the minimal call from `q.query`.
   - Computes precision = |response ∩ expected_doc_ids| / |response (top-k)|, recall = |response ∩ expected_doc_ids| / |expected_doc_ids|.
   - Asserts both ≥ 0.8 per D-14.

For tools whose response shape differs (`fetch` returns a single doc; `vault_stats` returns counts not docs; `find_broken_links` returns broken-link records; `query_frontmatter` returns a filtered list; `suggest_frontmatter` returns `{existing, suggestions, conflicts}`), Phase 1 will define per-tool scoring functions — the `args` block in each YAML provides the call signature.

## Commits

- `ace89bc` — test(00-11): add v1 baseline semantic-floor YAMLs (FND-09) — 13 yaml files
- `9a4dceb` — test(00-11): add baseline.test.ts — snapshot pin + fixture integrity (FND-09, FND-10)

## Self-Check: PASSED

All 14 created files present on disk; both commits (`ace89bc`, `9a4dceb`) on
worktree branch. Acceptance criteria for both tasks verified:

- 11 real-tool YAMLs each have ≥ 3 `- id:` entries (per `grep -c`)
- 2 placeholder YAMLs exist (`graph_neighbors.yaml`, `graph_path.yaml`)
- Every `expected_doc_ids` resolves to a real file under `evals/fixtures/v2-test-vault/`
- `npx vitest run evals/v1-baseline/baseline.test.ts` → 29 pass + 11 todo
- `npx vitest run evals/v1-baseline/baseline.test.ts -t 'baseline fixtures parse'` → 27 pass (VALIDATION row 00-09-02)
- `npx vitest run evals/v1-baseline/baseline.test.ts -t 'matches the pinned snapshot'` → 1 pass (VALIDATION row 00-10-02)
- `npm test` → 397 pass + 11 todo across 40 files (was 368/39 — +29 active +11 todo, zero regressions)
- `npm run eval:baseline` → green
- `npx tsc --noEmit` → clean
