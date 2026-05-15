---
confidence: direct
evidence: []
status: active
observed_at: "2026-04-30T12:00:00-07:00"
superseded_by: null
type: observation
title: "Test fixture — missing source"
expected_reason: missing_provenance
expected_key: source
---

Body unused. Frontmatter omits the required `source` key — Guard A must
emit `missing_provenance` with `key: "source"`.
