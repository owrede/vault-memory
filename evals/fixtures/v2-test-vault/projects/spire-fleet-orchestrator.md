---
title: Spire Fleet Orchestrator
status: active
owner: dana-park
created: 2026-04-02
---

# Spire Fleet Orchestrator

The fleet orchestrator is the multi-robot coordination layer at the heart
of the [[projects/spire]] product. It schedules work across multiple
Atlas-1 units at a single warehouse site, balances task assignment
against battery state and physical locality, and exposes a configuration
UI for warehouse operators to declare zones, schedules, and exception
handling. Owned by [[people/dana-park]] from 2026-05-04 onward; before
that it was a side-project of [[people/alice-chen]].

## Current state (2026-Q2)

Single-robot orchestration works in test-cell environments. Multi-robot
is the Q3 target. Current focus: stabilize the task contract with the
warehouse task library
([[projects/atlas-1-warehouse-task-library]]) so the orchestrator can
be developed against a frozen API surface
([[references/warehouse-task-library-api]]).

The Q2 deliverable is a clean separation between "task scheduling" (the
orchestrator's job) and "task execution" (the library's job). See
[[decisions/2026-04-25-orchestrator-library-split]] for the contract.

## Architecture

See [[references/spire-architecture]]. The orchestrator runs as a
single-process service on a site-local server (one per warehouse), not
on the robots themselves; robots are clients.

## Team

- PM: [[people/dana-park]].
- Engineering: rotates from the Atlas-1 build team — Carlos
  ([[people/carlos-yim]]) currently allocates one engineer at 50%.

## Open risks

1. Multi-robot contention scenarios are not yet exercised. The eval
   harness has single-robot cases only.
2. The site-local server is currently a beefy laptop. Production
   hardware spec is unresolved (see
   [[meetings/2026-05-11-spire-server-spec-debate]]).
3. UI is a placeholder; productization happens in Q3.
