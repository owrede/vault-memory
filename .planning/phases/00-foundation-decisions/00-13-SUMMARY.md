---
phase: 00-foundation-decisions
plan: 13
subsystem: docs/v2/adr
tags: [adr, index, madr, v3, phase-10]
requires: [00-02, 00-03, 00-04, 00-05]
provides: [adr-index-final, v3-open-adr-parking-lot]
affects: [docs/v2/adr/README.md]
tech-stack:
  added: []
  patterns: [madr-index, parking-lot-table]
key-files:
  created: []
  modified:
    - docs/v2/adr/README.md
decisions:
  - "Open ADRs surfaced as both a table (column-cell `| Open |`) and a parallel bullet enumeration (`Status: Open, Phase: v3-Phase-10`) — satisfies both human scan and literal-token grep tooling (VALIDATION row 00-13-02)."
  - "ADR-005..018 reserved for v3 / Phase 10 themes named in ROADMAP §v3.0.0 and RESEARCH §Open Questions. No separate parking-lot document (per D-22, the index is the single visible parking lot)."
  - "MADR conformance reinforced via a Contributing section: frontmatter shape, H1 + status/date/scope/supersedes block, standard sections (Context, Decision, Invariants, Examples, Consequences, Open follow-ups)."
metrics:
  duration: ~10 min
  completed: 2026-05-14
---

# Phase 0 Plan 13: ADR Index Finalize Summary

Finalized `docs/v2/adr/README.md` as the single ADR index for v2 (Accepted)
and v3 / Phase 10 (Open) decisions, with status legend, cross-links to
ARCHITECTURE.md and MEMORY_CONTRACT.md, and contribution guidance for future
ADRs.

## What Changed

- Added a status legend (Accepted / Open / Superseded).
- Added cross-links to `../ARCHITECTURE.md` (layer model) and
  `../MEMORY_CONTRACT.md` (operational expression of the safety invariant).
- Replaced the Open-ADRs placeholder paragraph with:
  - a table mirroring the Accepted-ADRs table shape (`| # | Title | Status |
    Phase | Supersedes | Tags |`), with 14 rows for ADR-005..018; and
  - a parallel bullet enumeration carrying the literal token
    `Status: Open, Phase: v3-Phase-10` once per ADR (for VALIDATION row
    00-13-02 grep tooling that scans by line rather than table cell).
- Added a closing paragraph explaining the Phase 9 HARD GATE: no v3 code
  is written and no Open ADR is promoted until Phase 9's premise check
  passes.
- Added a "Contributing new ADRs" section codifying MADR conformance for
  future authors.

## Accepted v2 ADRs (4 rows audited — no drift, no fixes applied)

1. ADR-001 — **Document identity is opaque, URI-style** — Accepted, Phase 0
2. ADR-002 — **Source & Delivery Seams** — Accepted, Phase 0
3. ADR-003 — **Normalized Document Shape** — Accepted, Phase 0
4. ADR-004 — **Memory Sink Handles** — Accepted, Phase 0

For each row: `Status` cell reads `Accepted`; `Phase` cell reads `0`;
`Supersedes` cell reads `—`; `Title` matches the file's H1; `Tags` cell
matches the file's frontmatter `tags:` field verbatim. No drift, no
amendments required.

## Open v3 / Phase-10 ADRs (14 entries — single visible parking lot per D-22)

1. ADR-005 — Identity stability across sources (Notion stable IDs vs Obsidian rename)
2. ADR-006 — Link resolution across heterogeneous sources
3. ADR-007 — Property equivalence between Notion typed properties and Obsidian YAML
4. ADR-008 — Document granularity — pages vs sub-pages vs blocks
5. ADR-009 — Write semantics — Notion atomic writes vs Obsidian filesystem
6. ADR-010 — Authentication & OAuth flow for Notion adapter
7. ADR-011 — Watch / change-feed for Notion (poll-only, webhook later)
8. ADR-012 — Rate-limiting & backoff for source APIs
9. ADR-013 — Embedding strategy for non-text Notion blocks (databases, properties)
10. ADR-014 — Cross-source memory — `_memory/` sink shape when source ≠ Obsidian
11. ADR-015 — Caching layer between SourceConnector and core
12. ADR-016 — Sync state — handling missed change events on adapter restart
13. ADR-017 — Notion-native memory sinks (page-as-document vs database-as-sink)
14. ADR-018 — Capability discovery — runtime feature flags vs static descriptors

All 14 carry `Status: Open` and `Phase: v3-Phase-10` in the parallel bullet
enumeration.

## Audit Fixes Applied to Accepted Table

None. The four rows seeded by plans 00-02, 00-03, 00-04, and 00-05 are
internally consistent and consistent with the underlying ADR files. No
drift in `Title`, `Status`, `Phase`, `Supersedes`, or `Tags` cells.

## Verification

- Acceptance criterion 00-13-01: `for n in 001 002 003 004; do grep -qE "^\\| ${n} \\|" docs/v2/adr/README.md || exit 1; done && grep -q 'Accepted' docs/v2/adr/README.md` — PASSES (all four rows present, `Accepted` appears 9 times across the legend, file headers, and table cells).
- Acceptance criterion 00-13-02: `[ $(grep -c 'Status: Open' docs/v2/adr/README.md) -ge 14 ] && grep -q 'v3-Phase-10' docs/v2/adr/README.md` — PASSES (`Status: Open` appears 16 times: 14 bullet rows + 2 prose references; `v3-Phase-10` appears throughout the Open table and bullet list).
- Both required H2 sections present: `## Accepted v2 ADRs` and `## Open ADRs (v3 / Phase 10)` — PASSES.
- All 14 theme keywords present in the file (identity stability, link resolution, property equivalence, granularity, write semantics, auth, rate, embedding strategy, cross-source memory, caching, capability discovery) — PASSES.

## Deviations from Plan

None — plan executed exactly as written. The Open ADRs section was
implemented as a table + parallel bullet enumeration (the exact pattern
the plan's `<acceptance_criteria>` recommended as the simplest fix for
the `Status: Open` literal-grep requirement).

## Self-Check: PASSED

- FOUND: docs/v2/adr/README.md (modified)
- FOUND commit: ac8e14f
- 4/4 Accepted ADR rows present
- 14/14 Open ADR themes covered
- `Status: Open` literal count = 16 (≥14 required)
- `v3-Phase-10` token present
- Both required H2 headers present
