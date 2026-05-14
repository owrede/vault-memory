---
title: Beacon — R&D Archive
status: archived
owner: bob-martinez
created: 2026-04-21
---

# Beacon — R&D Archive

This is the archive document for the [[projects/beacon]] R&D side bet,
created at the time of pause (see
[[decisions/2026-04-16-beacon-pause]]) so the knowledge from Q1 doesn't
evaporate when the program restarts in Q3 or later.

## What Beacon was

A ceiling-mounted environmental-perception node concept. The idea: a
warehouse with N Atlas-1 units does not need every unit to carry a full
perception stack if there is a shared site-scale perception fabric
overhead. The Beacon node provided occupancy and dynamic-object tracking
to the [[projects/spire-fleet-orchestrator]] at warehouse-scale
resolution, freeing on-robot compute for fine-manipulation tasks.

## Q1 results (snapshot at pause)

- One ceiling node prototype, hand-fabricated.
- 30% reduction in on-robot perception compute observed during single
  warehouse sub-task demos (limited eval — n=4 task types).
- Dynamic-object tracking at 12 Hz across a 20m × 20m cell.
- Localization fusion with the Atlas-1 SLAM front-end demonstrated as a
  proof-of-concept, not productized.

## Artifacts

- Hardware prototype: in storage at the test floor.
- Codebase: frozen on the `beacon-frozen-q2` branch.
- Reference summary: [[references/beacon-q1-results-summary]].

## Restart criteria

Restarting Beacon is gated on two conditions:

1. The [[projects/spire]] product line has at least two productionized
   warehouse engagements running multi-robot deployments
   ([[projects/spire-fleet-orchestrator]] hits the Q3 multi-robot
   milestone).
2. The on-robot perception compute headroom turns out to be the
   binding constraint for adding new task primitives — not battery,
   not network, not manipulation reliability.

Until both are true, Beacon stays archived. Bob
([[people/bob-martinez]]) revisits at each quarterly OKR cycle.
