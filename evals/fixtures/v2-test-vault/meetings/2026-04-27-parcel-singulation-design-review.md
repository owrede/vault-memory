---
title: Parcel Singulation Design Review — 2026-04-27
date: 2026-04-27
attendees:
  - bob-martinez
  - eli-sato
  - carlos-yim
created: 2026-04-27
---

# Parcel Singulation Design Review — 2026-04-27

Design review for the parcel-singulation primitive inside
[[projects/atlas-1-warehouse-task-library]]. Owned by
[[people/eli-sato]]; review chaired by [[people/bob-martinez]].

## Agenda

1. Detector approach (single-stage vs two-stage).
2. Manipulation primitive coupling.
3. Eval methodology.
4. Reliability program implications.

## Discussion

- **Detector approach.** Eli proposed a two-stage detector — coarse
  region proposal followed by a fine instance-segmentation head — to
  reduce false-merge errors on touching parcels. Bob pushed back on the
  latency budget (two-stage costs +18ms on the rev-C compute); Eli
  agreed to benchmark both before locking it in.
- **Manipulation coupling.** Carlos requested the detector output
  include a confidence score per parcel, not just per-image, so the
  manipulation primitive can fall back to a coarser grasp when
  confidence is low. Eli will add this to the output schema in
  [[references/warehouse-task-library-api]] (non-breaking, additive).
- **Eval methodology.** Re-training set = February-pilot warehouse
  data (full set, no synthetic augmentation). Eval set = held-out
  20% with strict site-stratification (no site appears in both train
  and eval). 95% precision @ 90% recall is the program target.
- **Reliability implications.** Singulation is one of the three
  failure modes contributing to the perception 58% intervention rate
  ([[projects/atlas-1-reliability-program]]). The retrain has to
  measurably move that number by the April retro on 2026-04-30.

## Action items

- [ ] Eli — two-stage vs single-stage benchmark, due 2026-05-01.
- [ ] Eli — confidence-score field in output schema, due 2026-04-29.
- [ ] Bob — re-circulate review notes by 2026-04-29.

## Decisions

No binding decisions today — benchmark gates the detector-architecture
call.
