---
source: agent
confidence: high
evidence: []
status: active
observed_at: "2026-04-30T12:00:00-07:00"
superseded_by: null
type: observation
title: "Test fixture — invalid confidence enum value"
expected_reason: invalid_provenance
expected_key: confidence
expected_observed_value: high
---

Body unused. `confidence: high` is not in the contract enum
[direct, inferred, uncertain] — Guard A must emit `invalid_provenance`
with `key: "confidence"` and `observedValue: "high"`.
