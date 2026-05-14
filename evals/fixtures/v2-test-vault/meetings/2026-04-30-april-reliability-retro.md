---
title: April Reliability Retro — 2026-04-30
date: 2026-04-30
attendees:
  - bob-martinez
  - carlos-yim
  - eli-sato
  - priya-rao
created: 2026-04-30
---

# April Reliability Retro — 2026-04-30

Monthly retrospective for the
[[projects/atlas-1-reliability-program]] — covers April activity, the
top failure modes, and what the program does differently in May.

## Numbers

| Metric | March | April | Q2 target |
| --- | --- | --- | --- |
| Median uninterrupted uptime (test floor) | 4.2 h | 6.0 h | 16 h |
| Total interventions logged | 73 | 49 | n/a |
| Perception % of interventions | 64% | 58% | ≤ 25% |
| Drive-motor thermal % | 18% | 22% | ≤ 25% |
| Battery hot-swap % | 9% | 11% | ≤ 25% |

## What worked in April

- The duty-cycle cap on the drive motors
  ([[decisions/2026-04-22-drive-motor-duty-cycle-cap]]) stabilized the
  motor-B failures; no new motor failures in the last 10 days.
- Priya's weekly cadence with Site A produced four high-quality
  field observations that translated into engineering tickets within
  48 hours each.

## What didn't

- Perception still dominates (58% — target is 25%). The parcel
  singulation retrain is the headline lever but not landed yet.
- Battery hot-swap edge cases: an order-of-attachment timing issue
  surfaced at Site A but did not reproduce on the test floor. Eli to
  reproduce.

## Decisions

- **Singulation retrain ships by 2026-05-15.** Hard date — Bob owns.
- **Calibration tooling refresh ships by 2026-05-22.** Eli owns.
- **Battery hot-swap edge case becomes a P1.** Carlos to assign next
  week.

## Action items

- [ ] Bob — singulation retrain in production, due 2026-05-15.
- [ ] Eli — calibration tooling refresh, due 2026-05-22.
- [ ] Carlos — P1 owner for battery hot-swap issue, assign by 2026-05-04.
- [ ] Priya — keep cadence calls weekly through May (no exception
  weeks).

## Notes

Median uptime moved from 4.2h → 6.0h in one month. Linear extrapolation
puts us at ~10h by end of May and ~14h by end of Q2. Linear
extrapolation is unreliable — but the trend is in the right direction.
