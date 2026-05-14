---
title: Spire Pallet Identification
status: active
owner: eli-sato
created: 2026-03-25
---

# Spire Pallet Identification

Pallet identification is the perception primitive inside
[[projects/atlas-1-warehouse-task-library]] that classifies pallets by
type (standard 48"×40", Euro 800×1200, custom site SKUs) and estimates
pose for the manipulation primitives. It is the first warehouse-specific
perception module to ship and the most reliability-sensitive — a
mis-classified pallet causes the manipulation primitive to use the wrong
grasp plan, which is a hard-fail intervention rather than a soft retry.

## Current state (2026-Q2)

- Detector: 87% precision @ 84% recall on the warehouse eval set.
- Target: 95% precision @ 90% recall by 2026-06-15.
- Owner: [[people/eli-sato]].
- Coordination: weekly with Carlos ([[people/carlos-yim]]) on
  manipulation hand-off.

## Approach

- Retraining on the pilot data collected from the February warehouse
  trials.
- Hard-negative mining on the misclassification cases logged by
  [[people/priya-rao]]'s field-observation pipeline.
- Test-time-augmentation experiments paused — moved budget to data
  curation; per
  [[_memory/observations/2026-05-08-pallet-id-data-curation-priority]].

## Risks

- Custom site SKUs (one customer has a unique short-pallet variant) —
  not in the training distribution. Decision pending on whether to
  add per-site fine-tuning or push the customer to a standard SKU; see
  the open thread in
  [[meetings/2026-05-13-pallet-id-customer-sku-debate]].
- The two-shift uptime metric
  ([[projects/atlas-1-reliability-program]]) is sensitive to
  pallet-identification precision; the 95% precision number is the
  reliability program's gating input, not the user-facing target.

## Related

- Parent program: [[projects/atlas-1-warehouse-task-library]].
- Consumer: [[projects/spire-fleet-orchestrator]] schedules pallet
  tasks using this module's output.
