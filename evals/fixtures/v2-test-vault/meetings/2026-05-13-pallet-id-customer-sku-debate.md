---
title: Pallet ID Custom-SKU Debate — 2026-05-13
date: 2026-05-13
attendees:
  - eli-sato
  - carlos-yim
  - dana-park
  - priya-rao
created: 2026-05-13
---

# Pallet ID Custom-SKU Debate — 2026-05-13

Working session on how to handle the custom short-pallet variant at
Site D (one of the new warehouse pilots — see
[[projects/spire-pallet-identification]] open risks).

## Context

Site D uses a custom short pallet — 48"×30" rather than the standard
48"×40". The pallet is structurally different (extra cross-bracing)
and not in the training distribution. On the current detector
([[projects/spire-pallet-identification]]) Site D pallets misclassify
as either "standard 48×40" (wrong) or "unknown" (correct but
unactionable). Misclassification produces a hard-fail intervention.

## Options

1. **Per-site fine-tune.** Add 200–500 Site-D pallets to the training
   set as a fine-tune layer. Pros: fast, accurate. Cons: introduces a
   per-site fine-tune workflow that doesn't generalize.
2. **Push Site D to a standard pallet.** Customer ops conversation
   ([[people/priya-rao]]). Pros: keeps the model clean. Cons: customer
   has 10,000+ pallets in their existing inventory.
3. **Add the variant to the standard training distribution.** Curate
   a dataset of unusual pallet variants in the wild and retrain the
   base model. Pros: long-term right answer. Cons: 4–6 week effort.

## Outcome (preliminary — not yet a decision record)

The room leaned toward option 3 with option 1 as a short-term bridge:

- **Short term (this quarter):** Option 1 — fine-tune for Site D
  with their data. Ship by 2026-05-30.
- **Long term (Q3):** Option 3 — base-model retrain across a curated
  variant dataset. Eli scopes by end of June.
- **Not option 2.** Asking the customer to swap pallets is not a
  product strategy.

Dana will draft a decision record this week.

## Action items

- [ ] Priya — collect 200–500 Site D pallet images during the next
  cadence call, due 2026-05-19.
- [ ] Eli — fine-tune workflow for Site D, due 2026-05-30.
- [ ] Dana — decision record `2026-05-15-pallet-id-custom-sku-handling`,
  due 2026-05-16.
- [ ] Eli — scope of the Q3 base-model retrain, due 2026-06-27.

## Notes

The two-shift uptime program ([[projects/atlas-1-reliability-program]])
is sensitive here — Site D enters operation Q2, and a hard-fail
intervention on every Site-D pallet kills the uptime metric at that
site immediately.
