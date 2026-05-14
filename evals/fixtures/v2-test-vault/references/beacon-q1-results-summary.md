---
title: Beacon Q1 2026 Results Summary
kind: archive-summary
created: 2026-04-21
---

# Beacon Q1 2026 Results Summary

Snapshot of the [[projects/beacon]] R&D side bet at the time of pause
([[decisions/2026-04-16-beacon-pause]]). Maintained for future restart
(see [[projects/beacon-r-and-d-archive]] for the archive document).

## Headline results

- **30% reduction in on-robot perception compute** during single
  warehouse sub-task demos (n=4 task types — limited eval).
- **12 Hz dynamic-object tracking** across a 20m × 20m cell from a
  single ceiling node.
- **SLAM fusion proof-of-concept** demonstrated; not productized.

## What worked

1. The ceiling-mounted vantage point gave dramatically better
   long-baseline triangulation than the robot-mounted head.
2. Compute offload to the site-local server (the same host that will
   eventually run the Spire orchestrator) was clean — no networking
   bottleneck at the demoed scale.
3. The hand-fabricated prototype hit the design power budget on first
   build (rare).

## What didn't

1. Hand-off latency between Beacon's tracker and the on-robot SLAM
   front-end was 80–120ms — too long for the low-level control loop,
   acceptable for orchestrator-level planning.
2. Calibration between ceiling node and robot was a one-off bench
   procedure; productizing it for field installation was unsolved.
3. The dynamic-object tracker degraded fast at >2 moving agents — a
   real warehouse has many more.

## People (at time of pause)

- Sponsor: [[people/bob-martinez]].
- Build: [[people/eli-sato]] + one other perception engineer.
- Both rolled back to [[projects/atlas-1-perception-stack]] per
  [[_memory/status-updates/2026-04-21-beacon-engineers-reassigned]].

## Hardware artifacts

- 1× ceiling node prototype (in storage on the test floor).
- 1× spare power supply.
- Calibration target (custom-printed, in storage with prototype).

## Codebase

`beacon-frozen-q2` branch in the internal git remote. No further commits
will be made; documented as such in the branch description.
