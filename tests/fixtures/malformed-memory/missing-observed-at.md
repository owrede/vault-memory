---
source: agent
confidence: direct
evidence: []
status: active
superseded_by: null
type: observation
title: "Test fixture — missing observed_at"
expected_reason: missing_provenance
expected_key: observed_at
---

Body unused for validation. The frontmatter intentionally omits the
required `observed_at` key — Guard A must emit `missing_provenance`
with `key: "observed_at"`.
