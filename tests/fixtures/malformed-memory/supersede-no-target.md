---
source: agent
confidence: direct
evidence: []
status: superseded
observed_at: "2026-04-30T12:00:00-07:00"
superseded_by: null
type: observation
title: "Test fixture — status=superseded but superseded_by is null"
expected_reason: supersede_mismatch
expected_key: superseded_by
---

Body unused. `status: superseded` requires both `superseded_by` (non-null
DocId) and `superseded_reason` (non-empty string) per the
`DEFAULT_MEMORY_V1` cross-field invariant. Guard A must emit
`supersede_mismatch` with `key: "superseded_by"` (the FIRST issue Zod
emits from the `.superRefine` block).
