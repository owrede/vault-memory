---
title: Weekly Engineering Sync — 2026-04-13
date: 2026-04-13
attendees:
  - bob-martinez
  - carlos-yim
  - eli-sato
created: 2026-04-13
---

# Weekly Engineering Sync — 2026-04-13

Standing Monday 10:00 sync run by [[people/bob-martinez]]. Two-week
cadence captured here so the eval fixture has a representative
non-decision-bearing operational meeting.

## Agenda

1. Last week's interventions on the test floor.
2. Status of the parcel singulation re-training
   ([[projects/spire-pallet-identification]] adjacent).
3. Hardware: drive-motor thermal cycling investigation.
4. Calendar: design review on 2026-04-27 (see
   [[meetings/2026-04-27-parcel-singulation-design-review]]).

## Notes

- 11 interventions logged across the test floor and Site A this week,
  down from 14 last week. Bob asked Eli for a per-category breakdown
  ahead of the April retro ([[meetings/2026-04-30-april-reliability-retro]]).
- Parcel singulation re-training is on the warehouse-pilot data
  collected in February. Eli's eval on the new dataset shows +6 points
  precision over the consumer-era detector; recall is unchanged.
- Carlos shared early data on the drive-motor thermal-cycling theory —
  the median MTBF on motor B is two-thirds of motor A. Investigation
  continues; decision on a duty-cycle cap likely next week (it landed
  on 2026-04-22 — see
  [[decisions/2026-04-22-drive-motor-duty-cycle-cap]]).
- Eli flagged that the calibration-tooling refresh is on track for the
  Q2 OKR. No blockers.

## Action items

- [ ] Eli — intervention breakdown by failure category, due 2026-04-20.
- [ ] Carlos — drive-motor data summary for next sync, due 2026-04-20.
- [ ] Bob — circulate design review agenda by 2026-04-24.
