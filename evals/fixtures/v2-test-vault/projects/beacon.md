---
title: Beacon
status: paused
owner: bob-martinez
created: 2025-08-12
---

# Beacon

Beacon was an R&D side bet — an experimental project to prototype a
ceiling-mounted environmental-perception node that could feed
warehouse-scale state into the Spire orchestrator without requiring every
Atlas-1 unit to carry a full perception stack. Through Q1 2026 it ran
with two engineers seconded from the perception team ([[people/eli-sato]]
and one other). The Q2 OKR review paused the program; engineers were
rolled back to [[projects/atlas-1-perception-stack]].

## Current state (2026-Q2)

**Paused.** Decision: [[decisions/2026-04-16-beacon-pause]]. Engineers
reassigned (see
[[_memory/status-updates/2026-04-21-beacon-engineers-reassigned]]).
Next review at the Q3 OKR cycle. Hardware prototypes are in storage; the
codebase is on a `beacon-frozen-q2` branch and will not be re-opened
without a formal restart decision.

## Why it was paused, not killed

The technical signal from Q1 was encouraging — the ceiling node demoed
a 30% reduction in on-robot perception compute during warehouse
sub-tasks. The reason it was paused rather than killed: the warehouse
pivot is the company-staking bet, and during a pivot the right move is
to focus engineering on the things that prove the pivot's thesis. Beacon
became "we will come back to this once the warehouse story has
traction." See [[_memory/_briefs/2026-04-20-pivot-aftermath-brief]] for
the framing.

## Team

- Was: [[people/bob-martinez]] (sponsor), [[people/eli-sato]] +
  one (build).
- Now: nobody; archived.

## Future

A Q3 review will either restart Beacon, fold its IP into Spire, or
formally retire it. Until then, no further work happens on the program.
See [[references/beacon-q1-results-summary]] for the snapshot at pause.
