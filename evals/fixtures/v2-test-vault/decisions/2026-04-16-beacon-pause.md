---
title: Pause Beacon for Q2
date: 2026-04-16
status: accepted
created: 2026-04-16
---

# Pause Beacon for Q2

## Decision

[[projects/beacon]] is paused for the remainder of 2026-Q2. The two
engineers seconded to Beacon roll back to
[[projects/atlas-1-perception-stack]] effective the week of
2026-04-20. Beacon is **paused**, not killed; the program is reviewed
at the Q3 OKR cycle.

## Context

The 2026-04-15 OKR review ([[meetings/2026-04-15-q2-okr-review]])
flagged that maintaining Beacon while executing the post-pivot
warehouse focus was straining the engineering organization. Beacon's
Q1 results were technically encouraging (see
[[references/beacon-q1-results-summary]] — 30% on-robot perception
compute reduction in single-task demos) but did not de-risk the
two-shift uptime metric or the 8-pilot Q2 target. With three engineers
on perception and two of them on Beacon, the warehouse task library
re-train ([[projects/atlas-1-warehouse-task-library]]) was bottlenecked.

## Alternatives considered

- **Kill Beacon outright.** Rejected — the Q1 technical signal is
  too good to throw away, and the program likely matters more once
  Spire is multi-robot in production.
- **Reduce Beacon to one engineer.** Rejected — at one engineer the
  program is below the floor of meaningful progress; effectively the
  same as a pause with worse optics for the engineer in question.
- **Keep Beacon at two engineers and slip the warehouse task library
  retrain.** Rejected — the retrain is on the critical path for the
  Q2 OKRs and the company-staking warehouse pivot.

## Consequences

- [[people/eli-sato]] returns to lead the parcel-singulation re-train
  ([[projects/spire-pallet-identification]]) and the calibration
  tooling refresh.
- The second perception engineer (not named here) re-joins the
  detection-pipeline group.
- Hardware prototype goes into storage; codebase frozen on the
  `beacon-frozen-q2` branch. See [[projects/beacon-r-and-d-archive]]
  for the archive document.
- A Beacon-restart review happens at the Q3 OKR cycle. The restart
  criteria are documented in [[projects/beacon-r-and-d-archive]].
- Communicated to the two engineers individually before any
  team-wide announcement (per Alice's standard practice). Logged in
  [[_memory/status-updates/2026-04-21-beacon-engineers-reassigned]].
