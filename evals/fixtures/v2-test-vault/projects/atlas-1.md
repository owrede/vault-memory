---
title: Atlas-1
status: active
owner: alice-chen
created: 2024-09-15
---

# Atlas-1

Atlas-1 is the company's flagship general-purpose mobile manipulator — a
wheeled base, two 6-DOF arms, and an onboard perception stack tuned for cluttered
indoor environments. Originally scoped as a consumer-grade household helper, the
program was repositioned in March 2026 to focus on warehouse and small-light
industrial work where the unit economics are defensible. See
[[decisions/2026-03-12-pivot-to-warehouse]] for the pivot rationale and the
consequences for the roadmap.

## Current state (2026-Q2)

The hardware platform is stable at revision C — power, drives, and the
perception head are all running on the same boards that shipped to the four
pilot customers in February. Software work this quarter focuses on the
warehouse-task library: pallet identification, parcel singulation, and the
hand-off-to-conveyor primitives. The OKR review on 2026-04-15 (see
[[meetings/2026-04-15-q2-okr-review]]) reduced the pilot count target from 12
to 8 and added a new "two-shift uptime" reliability metric — 16 hours of
continuous operation with no human intervention. Currently we are at ~6 hours
median on the test floor.

## Team and references

[[people/alice-chen]] owns the roadmap and the customer relationships for the
pilots. Carlos Yim runs the engineering team behind the build; Bob Martinez
owns the perception stack. The component BOM is documented in
[[references/atlas-1-component-spec]] and is the authoritative source for
hardware procurement.

## Recent decisions

- **2026-03-12** — Pivot from consumer to warehouse. See
  [[decisions/2026-03-12-pivot-to-warehouse]].
- **2026-04-15** — Quarterly OKR revision (pilot count down, reliability metric
  added). See [[meetings/2026-04-15-q2-okr-review]].
