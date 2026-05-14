---
title: Second-source the perception head (OF-RGBD-S2)
date: 2026-04-29
status: accepted
created: 2026-04-29
---

# Second-source the perception head (OF-RGBD-S2)

## Decision

Atlas Robotics will fund a Q3 integration of the Vellum Optics
VO-RGBD-2 as a true second source for the OF-RGBD-S2 perception head.
Integration work begins Q2; productionization completes in Q3 with
both vendors qualified on the rev-C platform.

## Context

The 2026-04-29 vendor risk review ([[meetings/2026-04-29-vendor-risk-review]])
identified three single-sourced components in the BOM
([[references/atlas-1-component-spec]]). Of those, the OF-RGBD-S2
perception head is the most critical:

1. There is no functional substitute on-platform — every Atlas-1 unit
   needs working RGBD.
2. Optic Forge is a small supplier; supply continuity is a real risk
   over a 5-year product horizon.
3. The [[decisions/2026-04-08-rgbd-over-stereo-only]] decision
   concentrated *more* dependency on this exact component by making
   RGBD primary.

The shortlist ([[references/vendor-shortlist-q2-2026]]) identified
Vellum Optics VO-RGBD-2 as the only candidate that is a true
second source (different vendor relationship, different supply chain).

## Alternatives considered

- **Stay single-sourced.** Rejected — risk magnitude unacceptable for
  a hardware platform expected to ship over multi-year horizons.
- **Stockpile inventory instead of qualifying a second vendor.**
  Rejected — inventory cushions a one-quarter outage, not a vendor
  failure or a multi-year supply disruption.
- **Move to Optic Forge's next-generation OF-RGBD-S3.** Rejected —
  same vendor, doesn't address single-vendor risk.

## Consequences

- Engineering time allocation: one perception engineer in Q3 to drive
  integration (Bob to assign per
  [[meetings/2026-04-29-vendor-risk-review]] action item).
- 6-month integration estimate (from Vellum's side) — productionize
  in Q3, qualify-on-platform in early Q4.
- BOM ([[references/atlas-1-component-spec]]) gets a "Primary /
  Second source" column when VO-RGBD-2 is productionized.
- The decision is communicated to the board in the Q2 mid-quarter
  update (per Alice's action item from the vendor review).
- Note: the BS-NX-512 (compute) and NW-PACK-48-200 (battery)
  single-source risks are *not* mitigated by this decision —
  see [[meetings/2026-04-29-vendor-risk-review]] for the deferral
  rationale.
