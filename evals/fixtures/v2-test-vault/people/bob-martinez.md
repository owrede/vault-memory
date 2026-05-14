---
title: Bob Martinez
role: CTO
joined: 2024-09-01
created: 2026-01-15
---

# Bob Martinez

Bob co-founded Atlas Robotics with Alice Chen and Carlos Yim in late 2024 and
runs the technical organization as CTO. His background is perception — six
years at a self-driving startup on the sensor-fusion team, then three years at
a robotics-arm company building object-detection pipelines for cluttered
bin-picking. He owns the perception stack end-to-end and is the most senior
voice in the room on RGBD + lidar fusion calls. See
[[projects/atlas-1-perception-stack]] for the program he runs personally.

## What he owns

- The Atlas-1 perception stack — sensor fusion, calibration, the
  object-detection model pipeline, the SLAM front-end.
- Cross-product perception standards — every product that ships an
  Atlas-platform body inherits Bob's perception spec.
- Vendor relationships for the perception head ([[references/atlas-1-component-spec]])
  — he negotiated the [[references/optic-forge-rgbd-spec]] terms personally.
- Q3 perception OKRs — staffed and tracked from his side.

## Working style

Bob is the opposite of Alice on cadence — he prefers daily 15-minute
sync standups over written threads. He runs the engineering weekly sync at
10:00 Monday with Carlos and the perception team (see
[[meetings/2026-04-13-weekly-engineering-sync]]). He pushes back hard on
stretch targets that aren't reliability-grounded and was the dissenter on
the two-shift uptime number (see
[[meetings/2026-04-15-q2-okr-review]] — he wanted 24h, settled on 16h).

## Active threads

- Atlas-1 reliability program (see [[projects/atlas-1-reliability-program]]) —
  the Q2 push to 16h two-shift uptime sits under his accountability.
- Beacon wind-down — Bob managed the personnel side of pausing
  [[projects/beacon]] and reassigning the two engineers
  ([[people/eli-sato]] and another) back to perception.
- Q3 perception staffing — interviewing for a second senior perception
  engineer to backfill Beacon's eventual restart.

## Notes

Bob and Carlos disagree productively about the depth-vs-stereo trade-off on
the perception head; the disagreement is currently parked in
[[decisions/2026-04-08-rgbd-over-stereo-only]]. They share an office and
the disagreement has not affected the rest of the team.
