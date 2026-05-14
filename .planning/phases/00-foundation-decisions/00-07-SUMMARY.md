---
phase: 00-foundation-decisions
plan: 07
subsystem: docs/v2
tags: [memory, provenance, contract, property-bag, safety-invariant]
dependency_graph:
  requires:
    - FND-06 (REQUIREMENTS.md)
    - ADR-003 (PropertyBag, published by sibling plan 00-04)
    - ADR-004 (MemorySink, published by sibling plan 00-05)
  provides:
    - docs/v2/MEMORY_CONTRACT.md — canonical property contract for agent-authored writes
  affects:
    - Phase 2 (MEM-05) — DeliveryAdapter validator implementation contract
    - Phase 5 (briefs) — brief writes go through the same validator
    - Phase 6 (contracts) — contract-generated writes go through the same validator
tech_stack:
  added: []
  patterns:
    - Property contract expressed against Document.properties (PropertyBag), not raw YAML
    - Guard A (required keys) + Guard B (source=agent confinement) at single chokepoint
    - Structured error responses ({ok, reason, key, value, ...}) for validator rejections
key_files:
  created:
    - docs/v2/MEMORY_CONTRACT.md (542 lines)
  modified: []
decisions:
  - The contract is enforced at DeliveryAdapter.write() — the single ADR-002 chokepoint — not in tool handlers
  - Guard B runs before Guard A (cheaper single-property check before iterating seven keys)
  - status defaults to "active" and superseded_by to null; defaults are applied AFTER Guard A passes (validator is purely diagnostic, never mutates input)
  - evidence MAY be empty for confidence=direct first-hand observations (e.g., briefs about the agent's own reasoning state) but SHOULD contain citations otherwise
  - Reverse-direction rejection — source=user or source=imported INTO a sink — returns reason="non_agent_write_inside_sink" (a sink is for agent material by definition)
  - The validator checks shape only; evidence link resolution and superseded_by target existence are runtime concerns (Phase 4/5), not write-time concerns
metrics:
  duration: ~15min
  completed: 2026-05-14
  tasks_completed: 1
  files_created: 1
  lines_added: 542
---

# Phase 0 Plan 07: Memory Contract Doc Summary

Published `docs/v2/MEMORY_CONTRACT.md` — the canonical property contract that every agent-authored document in a memory sink must satisfy, expressed against `Document.properties` (PropertyBag from ADR-003) and enforced by `DeliveryAdapter.write()` Guards A and B.

## Seven required properties — allowed values

| Property | Type | Allowed values | Default |
|---|---|---|---|
| `source` | string enum | `agent`, `user`, `imported` | `agent` for memory-sink writes |
| `confidence` | string enum | `direct`, `inferred`, `uncertain` | none (must be set) |
| `evidence` | array of strings | `DocId` strings or free-text citations (MAY be empty) | none (MUST be present; MAY be `[]`) |
| `status` | string enum | `active`, `superseded`, `archived` | `active` |
| `observed_at` | ISO 8601 timestamp | RFC 3339 profile, UTC, second precision or finer | none (must be set at write time) |
| `superseded_by` | `DocId \| null` | `null` iff `status != "superseded"`; non-null iff `status == "superseded"` | `null` |
| `type` | free-form string | any non-empty string; conventional: `observation`, `brief`, `note`, `status-update`, `hypothesis`, `decision`, `action-item` | none (must be set) |

## Two guards — exact structured error responses

### Guard A — required keys present

Validator iterates the seven keys; first failing key terminates.

```json
// Missing key
{ "ok": false, "reason": "missing_provenance", "key": "<key-name>" }

// Invalid value (enum violation, wrong type, malformed timestamp/DocId)
{
  "ok": false,
  "reason": "invalid_provenance",
  "key": "<key-name>",
  "value": "<observed-value>"
}

// Cross-field constraint: status / superseded_by mismatch
{
  "ok": false,
  "reason": "supersede_mismatch",
  "key": "superseded_by",
  "status": "<observed-status>"
}
```

### Guard B — `source: agent` confinement

```json
// source=agent target outside any configured MemorySink
{
  "ok": false,
  "reason": "agent_write_outside_sink",
  "doc_id": "<target-DocId>"
}

// source=user or source=imported targeting a configured MemorySink
{
  "ok": false,
  "reason": "non_agent_write_inside_sink",
  "doc_id": "<target-DocId>"
}
```

Guard B runs first (cheaper). Guard A is never evaluated when Guard B rejects.

## Deviations from REQUIREMENTS FND-06

None — the seven property names match REQUIREMENTS.md FND-06 verbatim (`source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`). The contract adds the supporting spec required for Phase 2 implementation: per-property type / allowed values / defaults / validator behavior, the two guards as `DeliveryAdapter.write()` behavior, structured error responses, the Obsidian frontmatter ↔ PropertyBag mapping, and four worked examples (valid observation, valid brief, rejected missing-observed_at, rejected agent-write-outside-sink). All of this is in scope for FND-06 ("property contract defined in terms of `Document.properties`").

## Deviations from Plan

None — plan executed exactly as written.

## Acceptance criteria — verification results

| Criterion | Result |
|---|---|
| `test -f docs/v2/MEMORY_CONTRACT.md && grep -qE 'confidence\|evidence\|status\|provenance'` (VALIDATION row 00-06-01) | PASS |
| Seven `^### {prop}` H3 headings (source, confidence, evidence, status, observed_at, superseded_by, type) | PASS |
| `grep -q 'Guard A'` and `grep -q 'Guard B'` | PASS |
| `grep -q 'PropertyBag\|properties'` | PASS |
| 150 ≤ line count ≤ 800 (actual: 542) | PASS |
| Marketing-language negative grep (`blazingly fast\|magnificent\|game[ -]?changing`) | PASS (no hits) |

## Commits

- `1dd8945` — docs(00-07): add MEMORY_CONTRACT.md with property contract and DeliveryAdapter validator guards

## Self-Check: PASSED

- File `docs/v2/MEMORY_CONTRACT.md` — FOUND (542 lines, contains all seven properties + both guards + PropertyBag mapping + four worked examples)
- Commit `1dd8945` — FOUND in `git log --oneline`
- STATE.md and ROADMAP.md — UNMODIFIED (per parallel-execution constraint)
