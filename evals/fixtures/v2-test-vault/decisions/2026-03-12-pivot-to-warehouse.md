---
title: Pivot from consumer to warehouse focus
date: 2026-03-12
status: accepted
created: 2026-03-12
---

# Pivot from consumer to warehouse focus

## Decision

[[projects/atlas-1]] is being repositioned from a consumer household-helper
product to a warehouse and small-light-industrial product. All consumer-facing
positioning, marketing collateral, and pilot agreements will be wound down in
Q2. New customer development from this date forward targets warehouse
operators with under 200 employees.

## Context

We launched the consumer-facing positioning for Atlas-1 at the start of 2025.
Over fourteen months we landed four pilots — two in consumer households, two
in small commercial settings (a restaurant prep kitchen and a hotel
back-of-house). The four pilots produced a consistent signal:

1. **Consumer households underused the unit.** Median active hours per day
   was 47 minutes. The unit-economics math at that utilization does not work
   at any plausible price.
2. **Commercial pilots saturated immediately.** The kitchen and the hotel
   were both running the unit 9+ hours a day within a week. The bottleneck
   was reliability, not demand.
3. **Sales cycle length differed by 4×.** Consumer prospects took 90+ days
   from first contact to pilot agreement. Warehouse operators we had reached
   out to opportunistically were closing in under 30 days.

## Alternatives considered

- **Keep both positionings.** Rejected — the engineering organization is too
  small to maintain two product narratives, and the perception stack tuning
  diverges between the two settings.
- **Pivot to the kitchen / hospitality segment.** Rejected — the kitchen
  pilot data was good, but the segment is fragmented, the regulatory surface
  is wider (food-safety certifications), and the unit economics are worse
  than warehouse at scale.
- **Wind down Atlas-1 and double down on Spire.** Rejected — Spire is still
  pre-revenue and Atlas-1's hardware is the platform Spire's software will
  eventually run on.

## Consequences

- Hardware roadmap unchanged (already converging on rev C).
- Software roadmap rewritten — warehouse task library replaces the
  household-task library this quarter. See
  [[meetings/2026-04-15-q2-okr-review]] for the Q2 metric changes.
- Two of the four existing pilots convert to warehouse trials at the same
  customer site; two are wound down with apology + refund.
- Public communication: a brief positioning update goes out at the next
  industry event. No press release.
