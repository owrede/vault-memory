---
title: Spire
status: active
owner: dana-park
created: 2025-11-08
---

# Spire

Spire is Atlas Robotics' warehouse-ops product line — software-led, runs
on top of the Atlas-1 hardware platform, sold as a per-site licensed
package rather than per-unit. Spire is the strategic bet of the 2026-Q2
roadmap (see [[decisions/2026-03-12-pivot-to-warehouse]]): the pivot away
from consumer was as much a bet on Spire as a retreat from the household
product.

## Current state (2026-Q2)

The Spire codebase exists as a thin orchestration layer
([[projects/spire-fleet-orchestrator]]) sitting above the warehouse task
library that [[projects/atlas-1-warehouse-task-library]] produces. Through
Q1 it was a side-project of [[people/alice-chen]]; the
[[meetings/2026-04-15-q2-okr-review]] decision moved it to its own PM
slot. [[people/dana-park]] joined on 2026-05-04 as the dedicated PM.

The current customer story: the four Q2 warehouse pilots are running
Atlas-1 hardware with the unbundled task library. When the orchestrator is
stable enough for multi-robot deployments (Q3 target), the same sites
become the first formal Spire engagements.

## Sub-projects

- [[projects/spire-fleet-orchestrator]] — multi-robot scheduling layer.
- [[projects/spire-pallet-identification]] — warehouse-specific
  perception module.

## Team and references

- PM: [[people/dana-park]].
- Engineering: shared with [[projects/atlas-1]] — Spire does not yet
  have a dedicated build team.
- Architecture reference: [[references/spire-architecture]].
- Customer-side: [[people/priya-rao]] runs the pilot cadence; Dana takes
  over for graduated engagements.

## Recent decisions

- **2026-03-12** — Pivot to warehouse focus elevated Spire's priority.
  See [[decisions/2026-03-12-pivot-to-warehouse]].
- **2026-04-15** — Dedicated PM slot approved; JD published 2026-04-20.
  See [[meetings/2026-04-15-q2-okr-review]].
- **2026-05-04** — Dana onboarded; sub-project structure formalized.
  See [[meetings/2026-05-04-dana-onboarding-kickoff]].
