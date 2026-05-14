---
title: Orchestrator/Library split — formal contract
date: 2026-04-25
status: accepted
created: 2026-04-25
---

# Orchestrator/Library split — formal contract

## Decision

The boundary between [[projects/spire-fleet-orchestrator]] and
[[projects/atlas-1-warehouse-task-library]] is formalized as a semver-pinned
API contract documented in
[[references/warehouse-task-library-api]]. The orchestrator does
"task scheduling"; the library does "task execution"; neither side may
reach into the other's responsibilities. Breaking changes to the
contract require a two-week deprecation window.

## Context

Through Q1 the orchestrator and the task library were a tangled
codebase — orchestrator code reached directly into perception module
internals, library code occasionally embedded scheduling heuristics.
This was workable when both were maintained by the same small team but
becomes untenable now that [[projects/spire]] has a dedicated PM
([[people/dana-park]]) and the library is part of the cross-project
hardware product.

The cleanup is a hard prerequisite for the Q3 multi-robot milestone:
the orchestrator cannot reason about cross-robot task coordination
while it can also reach into a single robot's manipulation primitives.

## Alternatives considered

- **Leave the boundary informal.** Rejected — Dana cannot own
  Spire's roadmap without a stable surface to plan against.
- **Merge the codebases.** Rejected — opposite direction from the
  cleanup we need; would make multi-robot intractable.
- **Pin the contract but allow private extensions per customer.**
  Rejected — would re-introduce the per-site fork problem the
  contract is supposed to prevent.

## Consequences

- Refactor work scoped for the remainder of Q2. Owner: a rotating
  engineer from Carlos's team (currently the 50% allocation from
  [[projects/spire-fleet-orchestrator]]).
- The API contract becomes a code artifact (typed schema) and a doc
  artifact ([[references/warehouse-task-library-api]]) — both must
  stay in sync. Pre-commit hook checks both, lives in the build repo
  (not in the vault).
- The pallet-id custom-SKU work
  ([[meetings/2026-05-13-pallet-id-customer-sku-debate]]) was the
  first design conversation framed in terms of this contract — the
  Site-D fine-tune is library-side, the per-site routing is
  orchestrator-side.
- Versioning policy: v0.4.x today, v0.5.x adds multi-robot semantics
  in Q3, v1.0.0 not before first formal Spire engagement.
