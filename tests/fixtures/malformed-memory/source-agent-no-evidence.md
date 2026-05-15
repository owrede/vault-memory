---
source: agent
confidence: direct
evidence: []
status: active
observed_at: "2026-04-30T12:00:00-07:00"
superseded_by: null
type: observation
title: "Test fixture — source:agent write outside any sink"
expected_reason: agent_write_outside_sink
---

Body unused. This fixture passes `propertiesSchema` (it is structurally
well-formed) but Guard B at the validator boundary must refuse it when
the resolved sink is `null` — i.e. when the target DocId does not land
under any registered `MemorySink`. The expected rejection code is
`agent_write_outside_sink`. The test calls
`validateAgentWrite(id, doc, sink=null, contract=null)` to drive Guard B.
