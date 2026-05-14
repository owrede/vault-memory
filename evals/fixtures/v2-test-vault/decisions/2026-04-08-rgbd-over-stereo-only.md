---
title: RGBD-only perception, stereo as fallback
date: 2026-04-08
status: accepted
created: 2026-04-08
---

# RGBD-only perception, stereo as fallback

## Decision

The Atlas-1 perception stack ([[projects/atlas-1-perception-stack]])
keeps the RGBD head (OF-RGBD-S2 — see
[[references/atlas-1-component-spec]]) as the primary depth sensor. The
on-platform stereo capability stays in the codebase but is only invoked
as a runtime fallback when the structured-light signal is degraded
(highly reflective surfaces, intense direct sun on receiver, IR
interference). We will not build a stereo-only operating mode.

## Context

The depth-vs-stereo debate has been simmering since rev-B hardware.
[[people/bob-martinez]] argued for RGBD as primary; [[people/carlos-yim]]
argued for a stereo-first design with structured light as augmentation.
Both positions had real engineering rationale; neither was a clear win.

Driving factors that resolved the call:

1. The warehouse pivot ([[decisions/2026-03-12-pivot-to-warehouse]])
   narrowed the deployment environment to indoor warehouse settings —
   the lighting variance that would have favored stereo (outdoor, mixed)
   is largely out of scope.
2. The structured-light failure modes that worried Carlos (reflective
   surfaces) are addressable with a stereo *fallback*, which is much
   simpler than maintaining two co-equal primary pipelines.
3. The two-shift uptime program
   ([[projects/atlas-1-reliability-program]]) values predictable
   perception over a slightly-better-on-best-case baseline. RGBD
   gives more predictable depth on the median frame.

## Alternatives considered

- **Stereo as primary, RGBD as augmentation.** Rejected — structured
  light's depth quality on parcel surfaces is too good to demote.
- **Co-equal primary, fused at runtime.** Rejected — doubles the
  perception team's maintenance burden for marginal accuracy gains.

## Consequences

- The perception stack code paths around stereo move to a fallback
  module with explicit invocation triggers.
- The calibration tooling refresh ([[projects/atlas-1-perception-stack]])
  scopes around RGBD-as-primary; stereo intrinsics get re-validated
  quarterly, not weekly.
- Vendor risk on the RGBD head ([[references/atlas-1-component-spec]])
  rises in importance — this decision is part of the trigger for
  [[decisions/2026-04-29-second-source-perception-head]].
