---
title: Atlas-1 Warehouse Task Library
status: active
owner: carlos-yim
created: 2026-03-20
---

# Atlas-1 Warehouse Task Library

The warehouse task library is the collection of manipulation and
navigation primitives that Atlas-1 units execute on the warehouse floor.
The library was scoped immediately after
[[decisions/2026-03-12-pivot-to-warehouse]] as the software half of the
pivot — the hardware did not need to change, but the task vocabulary
did. Owned by [[people/carlos-yim]] on the build side, with
[[people/eli-sato]] owning the perception modules each task consumes.

## Current state (2026-Q2)

Three primitives in flight:

| Primitive | Owner | State |
| --- | --- | --- |
| Pallet identification | Eli (perception) + Carlos (manipulation) | Detector at 87% precision, target 95% by 2026-06-15 |
| Parcel singulation | Eli | Re-training on Feb-pilot data; design review on 2026-04-27 |
| Hand-off to conveyor | Carlos | Prototype on test cell; field validation 2026-05 |

## API surface

The library is consumed by the Spire orchestrator
([[projects/spire-fleet-orchestrator]]) over a typed contract documented
in [[references/warehouse-task-library-api]]. Versioning is semver;
breaking changes must coordinate with Dana
([[people/dana-park]]) since Spire pins exact minor versions.

## Q2 OKR linkage

The 8-pilot Q2 target ([[meetings/2026-04-15-q2-okr-review]]) requires
all three primitives in production by end of June. The two-shift uptime
metric ([[_memory/observations/2026-04-16-two-shift-uptime-metric]])
gates which primitives can be activated on which sites — currently only
pallet identification is gated to "always on"; singulation and hand-off
need manual supervision until reliability improves.

## Related

- Project parent: [[projects/atlas-1]].
- Reliability program: [[projects/atlas-1-reliability-program]] tracks
  the per-primitive intervention rate.
