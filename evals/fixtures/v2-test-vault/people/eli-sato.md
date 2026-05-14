---
title: Eli Sato
role: Senior Perception Engineer
joined: 2025-04-15
created: 2026-01-15
---

# Eli Sato

Eli is a senior perception engineer on the Atlas-1 team, hired April 2025
out of a research lab where they spent four years on multi-view stereo.
They report to [[people/bob-martinez]] and work day-to-day on the
detection-and-segmentation pipeline inside
[[projects/atlas-1-perception-stack]]. Through Q1 2026 they were temporarily
seconded to [[projects/beacon]] to prototype the R&D side bet; the
[[decisions/2026-04-16-beacon-pause]] decision rolled them back to the
perception team for Q2.

## What they own

- Object-detection model pipeline — training data curation, eval
  fixtures, deployment to the on-device runtime
  ([[references/perception-stack-spec]]).
- Parcel-singulation detector for the warehouse task library
  ([[projects/atlas-1-warehouse-task-library]]).
- The perception eval harness — internal, not in the vault.

## Working style

Heads-down weeks, weekly written update Sundays for Bob to read Mondays.
Reachable in the test cell with Carlos most Friday afternoons. Comfortable
shipping a model improvement late if the eval doesn't move; uncomfortable
shipping a model improvement that moves eval but is risky on real-world
distribution shift.

## Active threads

- Parcel singulation — re-training on the warehouse-pilot data from the
  February trials (see
  [[meetings/2026-04-27-parcel-singulation-design-review]]). Target: 95%
  precision @ 90% recall on the warehouse eval set by 2026-06-15.
- Calibration tooling refresh — coordinating with Carlos to make the
  RGBD-to-lidar extrinsic calibration a 5-minute field procedure rather
  than a 30-minute bench procedure.
- Q3 staffing — Eli is part of the loop for the second senior-perception
  hire Bob is running.

## Notes

Eli is the second person on the perception side who knows the on-device
runtime well enough to debug it in the field; Bob is the first. This is
called out in [[_memory/observations/2026-05-02-eli-runtime-bus-factor-two]]
as a deliberate bus-factor improvement.
