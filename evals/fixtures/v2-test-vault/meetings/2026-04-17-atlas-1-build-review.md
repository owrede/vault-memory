---
title: Atlas-1 Build Review — 2026-04-17
date: 2026-04-17
attendees:
  - carlos-yim
  - quinn-vega
  - priya-rao
created: 2026-04-17
---

# Atlas-1 Build Review — 2026-04-17

Standing Friday 14:00 build review run by [[people/carlos-yim]]. Focuses
on the hardware build queue, spare-parts pipeline, and site readiness.

## Agenda

1. Build queue status — units in production for the four new
   warehouse pilots.
2. Spare-parts pipeline for the eight Q2 pilot sites.
3. Site-A re-configuration (converted pre-pivot pilot).
4. Open hardware decisions.

## Discussion

- **Build queue.** Two of four new-pilot units assembled, on the test
  bench for the standard 48-hour shake-out. Remaining two on track for
  delivery by end of Q2. No BOM substitutions needed
  ([[references/atlas-1-component-spec]] unchanged this week).
- **Spare-parts pipeline.** Quinn flagged that the drive-motor
  inventory buffer needs to roughly double under the
  [[decisions/2026-04-22-drive-motor-duty-cycle-cap]] thermal-cycling
  context — even with the duty-cycle cap, MTBF tail expectations are
  higher than the pre-pivot consumer assumption. Quinn will revise the
  inventory model by end of next week.
- **Site-A.** Priya reported the conveyor hand-off zone is the slowest
  part of the re-configuration. Customer ops lead is engaged and
  responsive; expected ready-state 2026-04-24.
- **Open hardware decisions.** Single-source risk on perception head
  flagged again ahead of the [[meetings/2026-04-29-vendor-risk-review]].

## Action items

- [ ] Quinn — revised spare-parts inventory model, due 2026-04-24.
- [ ] Priya — Site-A ready-state confirmation, due 2026-04-25.
- [ ] Carlos — sign off on the second new-pilot unit's shake-out,
  due 2026-04-22.
