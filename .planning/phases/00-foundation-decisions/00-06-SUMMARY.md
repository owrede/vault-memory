---
phase: "00-foundation-decisions"
plan: "06"
subsystem: "docs/v2"
tags: [architecture, layer-model, source-neutrality, adapter-tier, phase-0]
requires:
  - "ADRs 001-004 (cross-linked; siblings 002/003/004 land in same wave)"
  - ".planning/research/ARCHITECTURE.md (primary source)"
  - "docs/dev/gsd-agent-knowledg-layer.md (v2 brief)"
provides:
  - "Public-facing v2 layer model (L0..L4 + Adapter tier)"
  - "Responsibility map (per-layer interfaces / ADR / phase table)"
  - "Read-path and write-path data-flow diagrams"
  - "Source-neutrality contract demonstrating notion-api additivity"
affects:
  - "Every later v2 phase plan (can now `@docs/v2/ARCHITECTURE.md` for context)"
  - "Phase 9 adversarial review (plan 14) — primary input alongside ADRs"
tech-stack:
  added: []
  patterns:
    - "Layer model with single horizontal seam at the Adapter tier"
    - "Cross-link ADRs by `(adr/00X-name.md)` relative path"
    - "Source-neutrality demonstrated by dual-scheme examples (obsidian-fs:// + notion-api://)"
key-files:
  created:
    - "docs/v2/ARCHITECTURE.md"
  modified: []
decisions:
  - "Adopt research-derived 5-layer model unchanged (L0..L4 + Adapter tier)"
  - "Fold L4 into a single section (compiled briefs + task contracts) — they share the staleness/provenance mechanism, separating them would duplicate prose"
  - "Authority/staleness signals described as PropertyBag fields propagated by L3 (not separate tools) — matches research §0 + Phase 4/5 plan boundary"
  - "Out-of-scope list reproduces REQUIREMENTS.md categories without re-justifying them — this doc names; REQUIREMENTS.md justifies"
metrics:
  duration: "single session"
  completed: "2026-05-14"
  tasks_completed: 1
  files_changed: 1
  lines_changed: 455
---

# Phase 00 Plan 06: v2 Architecture Doc — Summary

Published `docs/v2/ARCHITECTURE.md` as the canonical layer-model reference for every later v2 phase — 455 lines (well under the 800-line bound), structured around L0..L4 on the Adapter tier, with cross-links to ADRs 001-004 and dual-scheme worked examples for source-neutrality.

## What was built

Single deliverable: `docs/v2/ARCHITECTURE.md`. Sections in order:

1. **Overview** — three-paragraph framing: v1 retrieval substrate → v2 agentic knowledge layer; three constraints (memory sacrosanct, opaque URI identity, seams own source-neutrality).
2. **Layer model** — ASCII layer diagram + one `### H3` subsection per layer (`Adapter tier`, `L0 — Retrieval substrate`, `L1 — Graph as retrieval`, `L2 — Memory namespace & provenance`, `L3 — Assembly`, `L4 — Compiled briefs + Task contracts`). Each subsection: one paragraph of responsibility prose + a fenced code block listing primary tools/interfaces + cross-links to relevant ADR(s).
3. **Responsibility map** — markdown table with columns `Layer | Primary tier | Key interfaces / tools | Owning ADR | Phase` (7 rows).
4. **Data flow — read path** — narrative + 17-line ASCII diagram showing `MCP client → server → handler → registry → adapter → L0 → assembly → citation packet → MCP response`.
5. **Data flow — write path** — narrative + 24-line ASCII diagram with Guard A (memory-namespace validator per ADR-004) and Guard B (hash-OCC per ADR-003).
6. **Source-neutrality contract** — explicit `obsidian-fs://` and `notion-api://` handle examples; five-file enumeration of what Phase 10's Notion connector touches (and what it does not).
7. **Out of scope (v2)** — six bullets reproducing REQUIREMENTS.md categories.
8. **See also** — link list: MEMORY_CONTRACT.md and AGENT_AGNOSTIC.md (sibling docs that may not yet exist — linked anyway per plan instruction), the four ADRs, ROADMAP.md, REQUIREMENTS.md, the v2 brief.

## Acceptance criteria

All passed (validation grep'd live):

| Criterion                                                           | Result            |
|---------------------------------------------------------------------|-------------------|
| `test -f docs/v2/ARCHITECTURE.md`                                   | PASS              |
| `grep -qE 'L0\|L1\|L2\|L3\|L4'`                                     | PASS              |
| Line count ≤ 800                                                    | PASS (455)        |
| Line count ≥ 200                                                    | PASS              |
| `grep -q '^## Layer model'`                                         | PASS              |
| `grep -q '^### Adapter tier'`                                       | PASS              |
| ADR-001 cross-link present                                          | PASS              |
| Dual schemes present (`obsidian-fs://` AND `notion-api://`)         | PASS              |
| No marketing language (`blazingly fast / magnificent / game-changing`) | PASS           |

VALIDATION row 00-05-01 (the matrix entry this plan satisfies): `test -f docs/v2/ARCHITECTURE.md && grep -qE 'L0|L1|L2|L3|L4' docs/v2/ARCHITECTURE.md && [ $(wc -l < docs/v2/ARCHITECTURE.md) -le 800 ]` exits 0.

## Deviations from plan

None of substance. Minor stylistic choices Claude's discretion permitted:

- **L4 kept as a single H3** ("Compiled briefs + Task contracts") rather than split into two — the plan allows L4 to fold into L3 or take its own row; gave it its own row since briefs and contracts are conceptually distinct even though they share machinery. Responsibility-map table reflects this (7 rows: L4, L3, L2, L1, L0, Adapter tier, Implementations).
- **No TypeScript code blocks** beyond pseudo-signatures like `compile_brief(target, sources, payload) → DocId` — the plan explicitly prohibited implementation TypeScript (interface signatures belong in ADRs). Stayed within that bound; the fenced blocks list tool names + return-shape stubs only.
- **Cross-links to ADR-002/003/004 use the target filenames** (`002-adapter-seams.md`, `003-document-shape.md`, `004-memory-sink-handles.md`) per CONTEXT.md D-01 — those files are created in this same wave by sibling executors. Links will resolve once Wave 2 PRs merge.
- **`See also` includes both `MEMORY_CONTRACT.md` and `AGENT_AGNOSTIC.md`** even though they do not yet exist — the plan explicitly says "link anyway".

## Deferred / out of scope

Nothing from the plan was deferred. Outside-of-plan items observed but not touched (would be other plans / phases):

- The sibling docs `MEMORY_CONTRACT.md` and `AGENT_AGNOSTIC.md` are linked but not authored here — they are separate Phase 0 plans (`00-07`, `00-08` per wave assignment).
- ROADMAP.md and STATE.md updates explicitly excluded per the executor prompt.

## Commit

| Commit  | Files changed                  |
|---------|--------------------------------|
| 5539463 | `docs/v2/ARCHITECTURE.md` (new, 455 lines) |

## Self-Check: PASSED

- `docs/v2/ARCHITECTURE.md` exists (455 lines): verified via `test -f`.
- Commit `5539463` present in `git log`: verified.
- All acceptance criteria pass: verified live before commit.
- STATE.md / ROADMAP.md untouched: verified via `git status` after commit (clean).
