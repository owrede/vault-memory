---
title: Q2 Vendor Risk Review — 2026-04-29
date: 2026-04-29
attendees:
  - quinn-vega
  - carlos-yim
  - bob-martinez
  - alice-chen
created: 2026-04-29
---

# Q2 Vendor Risk Review — 2026-04-29

Quarterly vendor-risk review owned by [[people/quinn-vega]]. Inputs:
the BOM ([[references/atlas-1-component-spec]]) and the operations
spreadsheet (not in vault).

## Agenda

1. Single-sourced components — risk register.
2. Second-source candidates ([[references/vendor-shortlist-q2-2026]]).
3. Decisions: which second-source integrations get funded this quarter.

## Risk register (single-sourced)

| Component | Risk | Current mitigation |
| --- | --- | --- |
| BS-NX-512 compute | 14-week lead time | Buffer stock |
| OF-RGBD-S2 RGBD head | Single supplier | None — driving today's decision |
| NW-PACK-48-200 battery | Cell-shortage signals | Buffer stock |

## Decisions

- **OF-RGBD-S2 gets a true second source.** Vellum Optics VO-RGBD-2
  integration to start Q2, productionize in Q3. See
  [[decisions/2026-04-29-second-source-perception-head]] for the
  decision record.
- **BS-NX-512 stays single-sourced for Q2.** Greenway Compute is the
  obvious second source but the perception team can't integrate
  without taking time away from the parcel-singulation re-train. Defer
  to Q3.
- **Battery second source deferred to Q3.** Capacity drop on the
  Cell Forge alternative makes it unattractive at current shift
  schedules. Quinn keeps watching cell-shortage signals.

## Action items

- [ ] Quinn — open the Vellum Optics VO-RGBD-2 NDA and engineering
  contact, due 2026-05-06.
- [ ] Bob — assign a perception engineer to drive the VO-RGBD-2
  integration in Q3 planning, due 2026-06-15.
- [ ] Alice — communicate the second-source funding allocation in the
  Q2 mid-quarter update to the board, due 2026-05-15.

## Notes

The room agreed the OF-RGBD-S2 risk is the most important to mitigate
because a 6-month sole-supplier outage there would halt every Atlas-1
build, while the BS-NX-512 risk is mitigatable with sufficient buffer.
