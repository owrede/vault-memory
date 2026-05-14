---
phase: 00-foundation-decisions
plan: 14
subsystem: adversarial-review
tags: [adr, adversarial-review, fnd-04, notion-adapter, capability-descriptors]
provides: [ADVERSARIAL-REVIEW disposition ledger, ADR-001 I-6, ADR-002 DocumentRef.hash contract + hashProtected enum + secrets convention + adapter-private cache permission, ADR-003 H-6, ADR-index Deferred-v3 section]
requires: [ADR-001..004, ARCHITECTURE.md, MEMORY_CONTRACT.md, AGENT_AGNOSTIC.md, NOTION-ADAPTER-PLAN.md, 00-13 ADR-index]
affects: [v2 ADRs 001/002/003, ADR index README.md, Phase-1 adapter contract surface, Phase-10 Notion contractor brief]
tech-stack:
  added: []
  patterns: [adapter capability descriptors as branch points, two-tier hash contract (content vs marker), private adapter SQLite tables under __adapter_<scheme>_ prefix, hashProtected enum tier ladder, env-var namespacing VAULT_MEMORY_<SCHEME>_*]
key-files:
  created:
    - .planning/phases/00-foundation-decisions/00-14-SUMMARY.md
  modified:
    - docs/v2/adr/ADVERSARIAL-REVIEW.md
    - docs/v2/adr/001-document-identity.md
    - docs/v2/adr/002-adapter-seams.md
    - docs/v2/adr/003-document-shape.md
    - docs/v2/adr/README.md
decisions:
  - "Adversarial-review findings split 6:4 amend:defer (matches reviewer's own §Stop-summary recommendation)"
  - "Cross-source architectural gaps (F1/F2/F4/F7/F9/F10) become v2 ADR amendments"
  - "Adapter-internal capability surface (F3/F5/F6/F8) defers to v3 Phase-10 work via README Deferred-v3 section"
  - "hashProtected becomes enum 'strong' | 'best-effort' | 'none' (was boolean) — contracts declare write_back.minHashProtected"
  - "DocumentRef.hash contract is two-tier: 'content' (e.g. obsidian-fs) vs 'marker' (e.g. notion-api, sha256(last_edited_time))"
  - "Adapter-private SQLite tables permitted under __adapter_<scheme>_* prefix — closes the apparent H-1 cost contradiction for fetch-heavy adapters"
  - "Connector secrets convention: VAULT_MEMORY_<SCHEME>_* env vars + ${env:…} substitution in config.toml (vendor-prefixed env vars remain forbidden per AGENT_AGNOSTIC.md)"
metrics:
  duration: 18m
  completed: 2026-05-14
---

# Phase 0 Plan 14: Adversarial Review Disposition Summary

FND-04 adversarial review of v2 ADRs 001–004 + architecture docs (executed in a
restricted-context Claude session per D-15) produced 10 findings; Task 2
dispositioned all 10 with no silent ignores. Six findings became v2 ADR
amendments (cross-source architectural gaps); four deferred to v3 Phase 10
via a new `Deferred-v3` section in the ADR index (Notion-specific
operational realities — adapter-internal capability surface).

## What happened

**Task 1 (separate Claude session, per D-15):** The `gsd-advisor-researcher`
agent was given restricted access to the seven canonical v2 docs (ADR-001..004,
ARCHITECTURE.md, MEMORY_CONTRACT.md, AGENT_AGNOSTIC.md) and asked to produce a
Notion-adapter implementation plan, filing a numbered Finding at every point
where the docs left a decision unspecified. The output (`ADVERSARIAL-REVIEW.md`
+ companion `NOTION-ADAPTER-PLAN.md`) landed in commit `e5593bd` with 10
findings — a healthy outcome per RESEARCH §Pitfall 6 (4–8 expected; ≥4 floor;
zero findings = rubber-stamp reject; all-deferred = ADRs-not-tightened reject).

**Task 2 (this execution):** Dispositioned each finding per the executor brief's
table — amend in place for cross-source gaps, defer to v3 for adapter-internal
capability surface.

## Findings and disposition

| Finding | Status | Target | Commit | Subject |
|---|---|---|---|---|
| F1 | Amended | ADR-002 §Open follow-ups | `709339a` | Connector secrets: `VAULT_MEMORY_<SCHEME>_*` + `${env:…}` substitution |
| F2 | Amended | ADR-003 §Invariants (new H-6) | `01ba6bd` | Versioned-API hash invariant (version-or-normalize) |
| F3 | Deferred-v3 | README §Deferred-v3 row F3 | `e911d53` | `listDocuments` scope (Notion sharing model) → ADR-010 + ADR-018 |
| F4 | Amended | ADR-001 §Invariants (new I-6) | `aa320de` | Canonical serialization invariant (lowercase hyphenated UUID for notion-api) |
| F5 | Deferred-v3 | README §Deferred-v3 row F5 | `e911d53` | `modifiedSince` as hint vs guarantee → ADR-011 + ADR-018 |
| F6 | Deferred-v3 | README §Deferred-v3 row F6 | `e911d53` | `excludeGlobs` grammar per adapter → ADR-018 |
| F7 | Amended | ADR-002 §SourceConnector | `709339a` | DocumentRef.hash contract (`content` vs `marker`) + `SourceCapabilities.refHashKind` |
| F8 | Deferred-v3 | README §Deferred-v3 row F8 | `e911d53` | BlockNode caps + truncation marker → ADR-008 + ADR-018 |
| F9 | Amended | ADR-002 §Open follow-ups + ADR-003 §Hash semantics | `709339a` + `01ba6bd` | Adapter-private `__adapter_<scheme>_*` SQLite cache permission |
| F10 | Amended | ADR-002 §DeliveryCapabilities | `709339a` | `hashProtected` extended to enum `'strong' | 'best-effort' | 'none'` + contracts declare `minHashProtected` |

**Amend:** 6 — F1, F2, F4, F7, F9, F10.
**Deferred-v3:** 4 — F3, F5, F6, F8.

## Commit ledger (for SIGN-OFF.md FND-04 row)

| SHA | Scope | Subject |
|---|---|---|
| `aa320de` | adr-001 | add I-6 — canonical serialization invariant (Finding 4) |
| `709339a` | adr-002 | amend per ADVERSARIAL-REVIEW Findings 1, 7, 9, 10 |
| `01ba6bd` | adr-003 | amend hash semantics — versioned APIs + Notion cost note (Findings 2, 9) |
| `e911d53` | adr-index | add Deferred-v3 section for Findings 3, 5, 6, 8 |
| `ebf5369` | adversarial-review | disposition all 10 findings + add audit section |

## Verification

- `test -f docs/v2/adr/ADVERSARIAL-REVIEW.md` → present.
- `grep -cE '^### Finding' …` → 10 (matches VALIDATION row 00-17-01 floor of ≥4).
- `grep -cE '^\*\*Status\*\*: (Amended|Deferred-v3)' …` → 10 (matches VALIDATION row 00-17-02 parity with finding count).
- `grep -cE '^\*\*Status\*\*: Open$|^Status: Open$' …` → 0 (no silent ignores).
- `grep -q '^## Audit' …` → present.
- All four amend-target ADR files contain the cross-references the
  ADVERSARIAL-REVIEW.md Status lines name (`I-6` in ADR-001, `DocumentRef.hash
  contract` + `hashProtected tier semantics` + `__adapter_<scheme>_*` in ADR-002,
  `H-6` + "Cost note for fetch-heavy adapters" in ADR-003).
- All four Deferred-v3 findings have matching rows in
  `docs/v2/adr/README.md` §Deferred-v3.
- `npm test` → 40 files, 397 passed, 0 failed.
- `bash scripts/check-fixture-privacy.sh` → ✓ allowlist clean.
- `bash scripts/lint-no-telemetry.sh` → ✓ 65 files scanned, clean.

## Health-check verdict (per RESEARCH §Pitfall 6)

- **Finding count:** 10 ≥ 4. PASS.
- **Amend-to-defer ratio:** 6:4 ≈ 60:40. Within healthy band — not all-deferred
  (would mean ADRs are not being tightened), not zero (would be rubber-stamp).
  PASS.
- **Per-ADR coverage:** ADR-001 (1 amendment), ADR-002 (4 amendments), ADR-003
  (2 amendments), ADR-004 (0 findings — the most tightly specified ADR; the
  reviewer surfaced nothing additional on the memory-sink contract). PASS.
- **Silent ignores:** 0. Every finding terminates in Amended or Deferred-v3 with
  a captured commit SHA. PASS.

## Deviations from plan

None. The executor brief's disposition table was followed verbatim. One minor
adjustment: the original ADVERSARIAL-REVIEW.md used `**Status:**` (colon inside
bold markers) which neither the plan's done-criteria regex nor its
verify-Open regex would have matched; this commit aligned all Status lines to
`**Status**:` (colon outside) so VALIDATION row 00-17-02 grep parity works
correctly. The change is purely formatting and does not alter the content of
any finding.

## Self-Check: PASSED

- `docs/v2/adr/001-document-identity.md` exists and contains new I-6 invariant.
- `docs/v2/adr/002-adapter-seams.md` exists and contains DocumentRef.hash
  contract + hashProtected enum + secrets convention + adapter-private cache
  permission.
- `docs/v2/adr/003-document-shape.md` exists and contains H-6 invariant + cost
  note for fetch-heavy adapters.
- `docs/v2/adr/README.md` exists and contains §Deferred-v3 section with rows
  F3/F5/F6/F8.
- `docs/v2/adr/ADVERSARIAL-REVIEW.md` exists, 10 findings all Amended or
  Deferred-v3, Audit section present.
- All five commits (`aa320de`, `709339a`, `01ba6bd`, `e911d53`, `ebf5369`)
  exist in `git log`.
