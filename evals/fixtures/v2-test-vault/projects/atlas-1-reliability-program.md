---
title: Atlas-1 Reliability Program
status: active
owner: bob-martinez
created: 2026-04-15
---

# Atlas-1 Reliability Program

The reliability program is the Q2 cross-cutting effort to lift Atlas-1
from a ~6-hour median uninterrupted-uptime baseline to a 16-hour
two-shift uptime target. Initiated by the
[[meetings/2026-04-15-q2-okr-review]] decision; co-owned by
[[people/bob-martinez]] (perception-side reliability) and
[[people/carlos-yim]] (hardware-side reliability).

## Current state (2026-Q2)

- Baseline: ~6 hours median uninterrupted operation on the test floor.
- Target: 16 hours by end of Q2; 24 hours is the Q3 stretch
  ([[_memory/observations/2026-04-22-bob-prefers-stretch-targets]] for
  background on why 24 was not the Q2 commitment).
- Current top-three failure modes (per
  [[_memory/observations/2026-04-26-perception-fails-dominate-interventions]]):
  1. Perception: 58% of human interventions.
  2. Drive-motor thermal cycling: 22% (mitigated by
     [[decisions/2026-04-22-drive-motor-duty-cycle-cap]]).
  3. Battery hot-swap edge cases: 11%.

## Program structure

- Weekly reliability stand-up Fridays at 11:00 (Carlos + Bob + Eli +
  Priya).
- Per-pilot intervention log maintained by [[people/priya-rao]] — every
  field intervention gets a row.
- Monthly retro at end of month (April retro
  [[meetings/2026-04-30-april-reliability-retro]]; May at end of May).

## Inputs

- Field observations from the eight pilot sites (Priya's pipeline).
- Test-floor uptime telemetry — captured automatically by the
  on-device runtime ([[references/perception-stack-spec]]).
- Sub-project status: each primitive in
  [[projects/atlas-1-warehouse-task-library]] reports its intervention
  rate weekly.

## Q2 exit criteria

- Two-shift uptime metric ≥ 16 hours median.
- Top three failure modes each ≤ 25% of total interventions
  (currently 58% / 22% / 11% — perception is the bottleneck).
- Zero unplanned hardware swaps in the last two weeks of Q2.
