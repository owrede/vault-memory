---
phase: 00-foundation-decisions
plan: 09
subsystem: evals-fixture
tags: [fixture, eval, atlas-robotics, memory-namespace]
requires:
  - 00-02-phase-plan
provides:
  - eval-fixture-vault-scaffold
  - 7-query-yaml-files
  - 15-memory-notes
affects:
  - evals/fixtures/v2-test-vault/
tech-stack:
  added: []
  patterns:
    - "vault-relative paths in expected_doc_ids (per RESEARCH Open Question 5)"
    - "MEMORY_CONTRACT seven-key frontmatter on every _memory/ note"
key-files:
  created:
    - evals/fixtures/v2-test-vault/README.md
    - evals/fixtures/v2-test-vault/_memory/.memory-sink
    - evals/fixtures/v2-test-vault/people/alice-chen.md
    - evals/fixtures/v2-test-vault/projects/atlas-1.md
    - evals/fixtures/v2-test-vault/meetings/2026-04-15-q2-okr-review.md
    - evals/fixtures/v2-test-vault/decisions/2026-03-12-pivot-to-warehouse.md
    - evals/fixtures/v2-test-vault/references/atlas-1-component-spec.md
    - evals/fixtures/v2-test-vault/_memory/observations/ (8 notes)
    - evals/fixtures/v2-test-vault/_memory/_briefs/ (3 notes)
    - evals/fixtures/v2-test-vault/_memory/status-updates/ (4 notes)
    - evals/fixtures/v2-test-vault/_queries/search.yaml
    - evals/fixtures/v2-test-vault/_queries/bundle.yaml
    - evals/fixtures/v2-test-vault/_queries/dossier.yaml
    - evals/fixtures/v2-test-vault/_queries/brief.yaml
    - evals/fixtures/v2-test-vault/_queries/graph.yaml
    - evals/fixtures/v2-test-vault/_queries/memory.yaml
    - evals/fixtures/v2-test-vault/_queries/contract.yaml
  modified: []
decisions:
  - "Used un-indented YAML list items under `queries:` to match the plan's literal acceptance regex `^- id:` (functionally equivalent to indented form; YAML spec permits both)."
  - "contract.yaml uses placeholder expected_doc_ids that point at the closest existing substrate notes (status-update, brief, decision) — the formal contract format is not yet defined, so the maintainer will swap these in Task 4 or in a Phase 1+ contract plan. Documented in each query's rationale."
metrics:
  duration: "~8 minutes (Claude scope: Tasks 1-3)"
  completed: 2026-05-14
status: claude-scope-complete-awaiting-maintainer-task-4
---

# Phase 0 Plan 9: Atlas Robotics Fixture — Summary (Claude scope)

The synthetic Atlas Robotics eval fixture vault has been scaffolded under
`evals/fixtures/v2-test-vault/`. Claude completed Tasks 1–3 of the plan
(directory structure + README + 5 illustrative example notes + 15-note
`_memory/` subset + 7 query YAML files). Task 4 is a maintainer
`checkpoint:human-action` for hand-authoring the remaining 30+ narrative
notes to reach the 50-note VALIDATION floor.

## What landed (Claude scope)

### Task 1 — Directory tree + README

- All seven directories created: `projects/`, `meetings/`, `people/`,
  `decisions/`, `references/`, `_memory/` (with `observations/`,
  `_briefs/`, `status-updates/` subfolders), `_queries/`.
- ADR-004 sentinel: `_memory/.memory-sink` present.
- `README.md` documents the Atlas Robotics narrative (Alice Chen CEO,
  Bob Martinez CTO, Carlos Yim Lead Engineer; Atlas-1 / Spire / Beacon
  product threads; 2026-03-12 pivot decision; 2026-Q2 OKR cycle), the
  folder map, the 50–110 note count target, the authoring conventions
  (kebab-case, YAML frontmatter, wikilinks, no real PII), and a Status
  table for Task 4 to fill in.
- Commit: `232ca58`.

### Task 2 — 5 illustrative example notes

Templates demonstrating the desired note voice, frontmatter shape, and
wikilink usage. Each note has YAML frontmatter, at least one `[[wikilink]]`,
~30–60 lines of fictional narrative, no LLM-flavor artifacts.

| Path | Frontmatter keys | Wikilinks to |
| --- | --- | --- |
| `people/alice-chen.md` | title, role, joined, created | projects/atlas-1, meetings/2026-04-15-q2-okr-review, decisions/2026-03-12-pivot-to-warehouse |
| `projects/atlas-1.md` | title, status, owner, created | decisions/2026-03-12-pivot-to-warehouse, meetings/2026-04-15-q2-okr-review, people/alice-chen, references/atlas-1-component-spec |
| `meetings/2026-04-15-q2-okr-review.md` | title, date, attendees, created | decisions/2026-03-12-pivot-to-warehouse, projects/atlas-1, people/alice-chen |
| `decisions/2026-03-12-pivot-to-warehouse.md` | title, date, status, created | projects/atlas-1, meetings/2026-04-15-q2-okr-review |
| `references/atlas-1-component-spec.md` | title, kind, created | projects/atlas-1, decisions/2026-03-12-pivot-to-warehouse |

- Commit: `d7009db`.

### Task 3 — `_memory/` subset (15 notes) + 7 query YAMLs

**`_memory/` notes — every note has the full MEMORY_CONTRACT seven-key
frontmatter** (`source`, `confidence`, `evidence`, `status`, `observed_at`,
`superseded_by`, `type`).

| Subfolder | Count | Type frontmatter |
| --- | --- | --- |
| `observations/` | 8 | `type: observation` |
| `_briefs/` | 3 | `type: brief` (with `compiled_from`, `compiled_at`) |
| `status-updates/` | 4 | `type: status-update` |
| **Total** | **15** | |

**Provenance diversity** (from frontmatter scan):
- `confidence`: 14 × `direct`, 1 × `inferred` (`bob-prefers-stretch-targets`).
  `uncertain` is intentionally left for the maintainer to introduce as the
  fixture grows.
- `type`: 8 × `observation`, 3 × `brief`, 4 × `status-update`.
- **Supersede chain**: 1 entry with `status: superseded`
  (`2026-04-20-atlas-1-pilot-target-was-12.md`, superseded_by
  `2026-04-16-atlas-1-pilot-count-reduced.md`) — gives the supersede-tool
  eval a target as required by the plan.

**7 query YAML files** — each with ≥3 entries in the D-09 schema
(`id`, `query`, `expected_doc_ids`, optional `expected_must_contain`,
`rationale`):

| File | Entries (Task-3 baseline) | Notes |
| --- | --- | --- |
| `_queries/search.yaml` | 4 | Hybrid retrieval surface |
| `_queries/bundle.yaml` | 3 | Document-tree surface |
| `_queries/dossier.yaml` | 3 | Entity-scoped exhaustive surface |
| `_queries/brief.yaml` | 3 | Compiled-brief surface |
| `_queries/graph.yaml` | 3 | Wikilink-graph traversal surface |
| `_queries/memory.yaml` | 4 | Provenance/supersede/status surface |
| `_queries/contract.yaml` | 3 | Task-contract discovery (placeholder targets) |

**Referential integrity (Pitfall 5)** — every `expected_doc_ids` resolves
to a real file at Task-3 time. Verified via Python YAML parse + filesystem
existence check; passed for all 7 files / 23 total queries.

Vault-relative paths used throughout (e.g., `projects/atlas-1.md`), not
`obsidian-fs://` URIs — consistent with RESEARCH Open Question 5
(URI translation lands in Phase 1's adapter extraction).

- Commit: `8a24891`.

## What is pending (maintainer scope — Task 4)

The 50-note VALIDATION floor is **not yet reached**. Current total:

- 5 narrative notes (Task 2) + 15 _memory/ notes (Task 3) = **20 markdown
  files** (excluding README and `_queries/`).
- Floor: ≥50. Target: ~75 (CONTEXT).
- Required to reach floor: ≥30 more narrative notes.
- Suggested distribution per PLAN: 5 more `people/`, 8 more `projects/`,
  10 more `meetings/`, 5 more `decisions/`, 5 more `references/`.

The maintainer also extends each `_queries/*.yaml` file with 1–3 more
queries referencing the newly-authored notes, and re-runs the referential
integrity check.

## Deviations from Plan

**None.** The Claude-scope tasks (1–3) executed exactly as written. One
small structural note documented under `decisions`: the query YAML uses
un-indented list items under `queries:` so the plan's literal acceptance
regex `^- id:` matches without ambiguity. Both indented and un-indented
forms are valid YAML; the un-indented form is what the plan's grep
expects.

## Authorship split

| Subset | Author | Count |
| --- | --- | --- |
| `README.md` | Claude (Task 1) | 1 |
| Narrative example notes | Claude (Task 2) | 5 |
| `_memory/` notes | Claude (Task 3) | 15 |
| Query YAMLs | Claude (Task 3) | 7 × ≥3 entries = 23 queries |
| Remaining narrative notes | Maintainer (Task 4) | 30+ (to floor); 55+ (to target) |
| Query extensions | Maintainer (Task 4) | 7 × 1–3 = up to 21 new queries |
| Status table update | Maintainer (Task 4) | README revision |

## Self-Check: PASSED

- File: `evals/fixtures/v2-test-vault/README.md` → FOUND
- File: `evals/fixtures/v2-test-vault/_memory/.memory-sink` → FOUND
- File: `evals/fixtures/v2-test-vault/people/alice-chen.md` → FOUND
- File: `evals/fixtures/v2-test-vault/projects/atlas-1.md` → FOUND
- File: `evals/fixtures/v2-test-vault/meetings/2026-04-15-q2-okr-review.md` → FOUND
- File: `evals/fixtures/v2-test-vault/decisions/2026-03-12-pivot-to-warehouse.md` → FOUND
- File: `evals/fixtures/v2-test-vault/references/atlas-1-component-spec.md` → FOUND
- Dir: `evals/fixtures/v2-test-vault/_memory/observations/` → 8 .md files
- Dir: `evals/fixtures/v2-test-vault/_memory/_briefs/` → 3 .md files
- Dir: `evals/fixtures/v2-test-vault/_memory/status-updates/` → 4 .md files
- 7 query YAMLs in `_queries/` → all parse, all have ≥3 entries
- Commits: `232ca58`, `d7009db`, `8a24891` → all present in git log

## Status

**CLAUDE SCOPE COMPLETE. AWAITING MAINTAINER TASK 4 (checkpoint:human-action).**

The plan's Task 4 is a `checkpoint:human-action` per the plan frontmatter
(`autonomous: false`). The maintainer hand-authors the remaining 30+
narrative notes to reach the 50-note VALIDATION floor (per D-08:
"narrative notes are hand-authored by the maintainer"), extends the query
YAML files to cover the newly-authored notes, re-runs referential
integrity, and updates the README `## Status` section. Upon completion
the maintainer replies `approved` (or `approved with adjustments`) to the
orchestrator.
