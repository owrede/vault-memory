# Phase 0: Foundation & decisions - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 0-foundation-decisions
**Areas discussed:** ADR relocation strategy, Eval fixture narrative, v1-baseline regression suite, Adversarial review format, CI lint scripts, ADR index & open-question parking

---

## Pre-discussion analysis

Claude analyzed the phase and identified six implementation gray areas. User was offered four (max-options limit) to select for active discussion:

| Option | Description |
|--------|-------------|
| ADR relocation strategy | Git mv vs. fresh copy; one PR vs. amendment follow-up; shape of ADR-003 hash-semantics + ADR-004 folder-default amendments; what 'Invariants + Examples' sections look like. |
| Eval fixture narrative | Accept 'Atlas Robotics' or pick a different narrative; how 50–100 notes are authored; shape of ≥3 hand-labeled queries per tool category. |
| v1-baseline regression suite | Tool-snapshot pinning (exact JSON equality) vs. semantic floors (precision/recall thresholds); per-tool fixtures vs. aggregate; how 'expected behavior' for all 23 v1 tools is captured. |
| Adversarial review format | What 'a Phase 10 agent could implement Notion from ADRs alone' looks like — separate Claude session, codex gap-finding, human checklist, or real skeleton spike. |

**User's response:** "I do not want to discuss — or rather: I can't discuss. You have to help me with that. Is this discussion just for the sake of it or is there really a need? You need to figure the most elegant solution that offers a robust system that is easy to install and maintain."

**Resolution:** User delegated all four areas (plus the two Claude-default ones — CI lint scripts and ADR index) to Claude's judgment, with the directive "elegant, robust, easy to install and maintain." Claude proposed decisions in CONTEXT.md. All decisions are reversible in PR review.

---

## ADR relocation strategy

| Option | Description | Selected |
|--------|-------------|----------|
| `git mv` + amend in same PR | Preserves git history; amendments and relocation read together | ✓ |
| Fresh copy, delete originals | Clean slate; loses blame trail | |
| Move now, amend in follow-up PRs | Smaller PRs; risks stale-link drift | |

**User's choice:** Delegated to Claude.
**Notes:** Chose `git mv` because history-loss is a permanent cost; small PR churn is recoverable. One-PR-per-ADR (four PRs total) keeps each amendment auditable.

## Eval fixture narrative

| Option | Description | Selected |
|--------|-------------|----------|
| Accept brief's "Atlas Robotics" | Coherent, suggested; avoids bikeshedding | ✓ |
| Hand-pick alternative theme | Sometimes increases ownership | |
| LLM-draft the notes | Fast; hallucination-friendly fixtures hurt eval debug-ability | |

**User's choice:** Delegated to Claude.
**Notes:** Accepted brief's suggestion. Hand-authored ~75 notes; YAML query fixtures grouped by upcoming tool category in `evals/fixtures/v2-test-vault/_queries/`.

## v1-baseline regression suite

| Option | Description | Selected |
|--------|-------------|----------|
| Pure tool-snapshot (exact JSON) | Loud breakage signal; over-pins fluctuating scores | |
| Pure semantic floors | Tolerates legitimate drift; misses contract drift | |
| Hybrid: snapshot for `tools/list` + semantic floors for behaviors | Best of both | ✓ |

**User's choice:** Delegated to Claude.
**Notes:** `tools/list` is contractual → exact equality. Search/graph/frontmatter behaviors fluctuate with embedding model versions → precision/recall floor 0.8 on labeled IDs. Single `vitest` runner.

## Adversarial review format

| Option | Description | Selected |
|--------|-------------|----------|
| Separate Claude session, ADRs only as input → ADVERSARIAL-REVIEW.md | Pressure-tests ADR completeness without forcing premature v3 decisions | ✓ |
| Real Notion-skeleton spike PR | Strongest evidence; commits to v3 design too early | |
| Human checklist | Cheap; depends on the reviewer remembering every Phase 10 gotcha | |
| Codex-driven gap-finding | Useful but ADRs > 800 lines combined → codex context risk | |

**User's choice:** Delegated to Claude.
**Notes:** Each finding becomes (a) ADR amendment or (b) "deferred to Phase 10" line in the ADR index. Never silently dropped.

## CI lint scripts

| Option | Description | Selected |
|--------|-------------|----------|
| POSIX shell scripts, block-merge on `ci.yml` | Zero deps; matches existing scripts; loud failure | ✓ |
| TypeScript via `tsx` | More expressive; extra build step | |
| Warn-only mode | Soft enforcement; invites drift | |

**User's choice:** Delegated to Claude (was Claude-discretion bucket).
**Notes:** New `.github/workflows/ci.yml` separate from existing `publish.yml`. Block-merge. `lint-no-telemetry.sh` uses curated banlist + opt-out comment escape.

## ADR index & open-question parking

| Option | Description | Selected |
|--------|-------------|----------|
| MADR-style index table with v3 open ADRs parked inline | Single entry point; one source of truth | ✓ |
| Plain list per ADR | Loses tag/status overview | |
| Separate "open questions" doc | Splits attention; invites drift | |

**User's choice:** Delegated to Claude.
**Notes:** v3 deferred ADRs (005–01x) listed as `Status: Open, Phase: v3-Phase-10` in the same table. Tags frontmatter on each ADR enables a regenerator script (stretch).

---

## Claude's Discretion

- ADR doc tone matches existing `docs/dev/gsd-agent-knowledg-layer.md` — technical, no marketing.
- ARCHITECTURE/MEMORY_CONTRACT/AGENT_AGNOSTIC each ≤ 800 lines.
- CHANGELOG entry under `[Unreleased] → ### Documentation` (no version bump until Phase 8).
- Fixture-privacy lint does NOT retroactively scan committed history (forward-only).

## Deferred Ideas

- ADR-index regenerator script (manual table is acceptable shipping state).
- Per-PR comment automation linking PR → FND-* satisfaction.
- LLM-as-judge eval layer (reserved for v3).
- Cross-platform CI matrix (Linux-only at Phase 0; revisit at Phase 8).
- Historical-leak detector for fixture-privacy (forward-only enforcement is acceptable).
