---
title: Warehouse Task Library API
kind: api-spec
created: 2026-04-10
---

# Warehouse Task Library API

The API contract between the [[projects/spire-fleet-orchestrator]] and
the [[projects/atlas-1-warehouse-task-library]]. Semver-pinned; the
orchestrator declares a minor-version compatibility window in its
manifest.

## Versioning

Current: **v0.4.x** (Q2).
Q3 target: **v0.5.x** (introduces multi-robot semantics for shared tasks).
v1.0.0 not before the first formal Spire engagement.

Breaking changes coordinate with [[people/dana-park]] and require a
two-week deprecation window per
[[decisions/2026-04-25-orchestrator-library-split]].

## Tasks

| Task name | Status | Primitive |
| --- | --- | --- |
| `pallet.identify` | Beta | [[projects/spire-pallet-identification]] |
| `parcel.singulate` | Alpha | Eli-owned |
| `conveyor.handoff` | Alpha | Carlos-owned |
| `nav.transit` | Beta | Carlos-owned |
| `robot.dock` | Beta | Carlos-owned |

## Task envelope

```
TaskRequest {
  task_name: string         // e.g. "pallet.identify"
  task_args: map<string, value>
  deadline_ms: uint32
  priority: enum { LOW, NORMAL, HIGH }
  correlation_id: string
}

TaskResult {
  correlation_id: string
  status: enum { OK, RETRY, HARD_FAIL, ABORTED }
  result_args: map<string, value>
  intervention_required: bool
  human_readable_reason: string
}
```

## Intervention semantics

The `intervention_required: true` signal is the single mechanism by
which a task asks for human help. The reliability program
([[projects/atlas-1-reliability-program]]) counts these — every
`intervention_required` event is a row in Priya's field-observation log.

## Open questions

- Multi-robot task semantics (Q3 — see
  [[meetings/2026-05-11-spire-server-spec-debate]] for the adjacent
  hardware-spec conversation).
- Whether `RETRY` is a status the orchestrator can mandate or only the
  library can suggest. Currently library-suggested; debated for v0.5.
