---
title: Carlos Yim
role: Lead Engineer
joined: 2024-09-01
created: 2026-01-15
---

# Carlos Yim

Carlos is the third co-founder and the lead engineer for the Atlas-1 build.
Before Atlas Robotics he spent five years on the controls team of an
agricultural-robotics company, then three years at a humanoid research lab
running the manipulation group. He owns the engineering organization
day-to-day — sprint planning, hiring below the senior bar, and the
mechanical + drive sub-system. See [[projects/atlas-1]] for the program
he runs the build for.

## What he owns

- All Atlas-1 hardware below the perception head — chassis, drives,
  arms, end effectors, power. The BOM in
  [[references/atlas-1-component-spec]] is curated by him.
- Engineering sprint planning across both Atlas-1 and Spire builds.
- Engineering hiring pipeline below the senior-engineer line. Alice
  ([[people/alice-chen]]) owns hiring above that line.
- The reliability program ([[projects/atlas-1-reliability-program]]) on the
  hardware side — Bob owns it on the perception side.

## Working style

Carlos works on the floor more than at a desk. The fastest way to get
him on a question is to walk to the test cell where he is debugging
something. He runs the Friday 14:00 build review
([[meetings/2026-04-17-atlas-1-build-review]]) and personally signs off
on every hardware revision. Written communication is brief; in-person
walk-throughs are detailed.

## Active threads

- 8-pilot Q2 target — converting the four pre-pivot pilots and onboarding
  the four new warehouse customers. Coordination with
  [[people/priya-rao]] on customer-side logistics.
- Two-shift uptime program — owns the hardware-MTBF side. The current
  6-hour median (see [[_memory/observations/2026-04-16-two-shift-uptime-metric]])
  is mostly driven by drive-motor thermal cycling, which he is mitigating
  with a duty-cycle change documented in
  [[decisions/2026-04-22-drive-motor-duty-cycle-cap]].
- Sourcing the spare-parts pipeline for warehouse trials (see
  [[references/vendor-shortlist-q2-2026]]).

## Notes

Carlos and Bob are the technical-disagreement axis of the company; Alice
acts as tiebreaker when it goes to a decision record. The depth-vs-stereo
decision ([[decisions/2026-04-08-rgbd-over-stereo-only]]) is the only
formal tiebreak so far.
