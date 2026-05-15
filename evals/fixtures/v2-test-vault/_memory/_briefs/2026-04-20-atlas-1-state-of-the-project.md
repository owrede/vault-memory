---
title: Atlas-1 — state of the project (compiled 2026-04-20)
source: agent
confidence: direct
evidence:
  - projects/atlas-1.md
  - decisions/2026-03-12-pivot-to-warehouse.md
  - meetings/2026-04-15-q2-okr-review.md
  - references/atlas-1-component-spec.md
status: active
observed_at: "2026-04-20T09:00:00Z"
superseded_by: null
type: brief
compiled_from:
  - projects/atlas-1.md
  - decisions/2026-03-12-pivot-to-warehouse.md
  - meetings/2026-04-15-q2-okr-review.md
  - references/atlas-1-component-spec.md
compiled_at: "2026-04-20T09:00:00Z"
---

# Atlas-1 — state of the project (compiled 2026-04-20)

**Positioning.** Atlas-1 is now a warehouse and small-light-industrial
mobile manipulator. The consumer positioning was retired on 2026-03-12
after fourteen months of consumer-pilot data showed median active hours of
47 minutes per day and a 90+ day sales cycle.

**Hardware.** Stable at revision C — same boards as shipped to the four
February pilots. BOM is documented in `references/atlas-1-component-spec.md`.
No hardware roadmap changes pending.

**Software.** Q2 work pivots to the warehouse task library: pallet
identification, parcel singulation, conveyor hand-off. The previous
household-task library is shelved.

**Q2 targets (revised 2026-04-15).** Pilot count target 8 (was 12).
Two-shift uptime: 16-hour floor (Q3 stretch 24). Carlos Yim owns the
reliability metric. Current median uptime on the test floor: ~6 hours.

**Risks.** The gap from 6 hours to the 16-hour floor is the dominant
engineering risk for the quarter. Pipeline-wise, the post-pivot funnel is
still rebuilding — eight pilots from a customer list that was assembled in
the last six weeks is aggressive.
