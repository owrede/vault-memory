---
title: Atlas-1 Perception Stack
status: active
owner: bob-martinez
created: 2024-10-01
---

# Atlas-1 Perception Stack

The perception stack is the sub-system inside [[projects/atlas-1]] that
turns the RGBD head, lidar, and IMU outputs (see
[[references/atlas-1-component-spec]]) into the scene understanding the
manipulation and navigation layers consume. Owned by
[[people/bob-martinez]]; senior engineer [[people/eli-sato]].

## Current state (2026-Q2)

The stack runs on the rev-C hardware and is the bottleneck for the
two-shift uptime program — perception failures account for the majority
of human interventions during warehouse trials (see
[[_memory/observations/2026-04-26-perception-fails-dominate-interventions]]).
Q2 work concentrates on:

1. Re-training detectors on the warehouse pilot data (parcels, pallets,
   conveyors). See [[projects/spire-pallet-identification]] for the
   pallet-specific work.
2. Improving the RGBD-to-lidar extrinsic calibration tooling so a
   field-tech can re-calibrate in 5 minutes rather than 30.
3. Reducing the on-device runtime memory footprint to free headroom for
   the future Spire orchestrator client.

## Architecture

See [[references/perception-stack-spec]] for the authoritative
component diagram. The depth-vs-stereo trade-off was formally settled in
[[decisions/2026-04-08-rgbd-over-stereo-only]] — we keep the RGBD head
as the primary sensor and use stereo only as a fallback when structured
light fails on highly reflective surfaces.

## Team

- Owner: [[people/bob-martinez]].
- Senior engineer: [[people/eli-sato]].
- Second senior-perception hire in flight (see
  [[meetings/2026-05-06-perception-hire-debrief]]).

## Related decisions

- [[decisions/2026-04-08-rgbd-over-stereo-only]]
- [[decisions/2026-04-29-second-source-perception-head]]
