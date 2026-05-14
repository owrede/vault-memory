---
title: Atlas-1 Perception Stack Spec
kind: spec
created: 2026-02-08
---

# Atlas-1 Perception Stack Spec

Module-level specification of the perception stack running on Atlas-1
revision-C hardware. Owned by [[people/bob-martinez]]. See
[[projects/atlas-1-perception-stack]] for the program; this doc is the
component contract.

## Inputs

| Sensor | Topic | Rate | Notes |
| --- | --- | --- | --- |
| RGBD head | `/percep/rgbd/raw` | 30 Hz | OF-RGBD-S2, see BOM |
| Lidar | `/percep/lidar/scan` | 25 Hz | CL-L4, 4-plane |
| IMU | `/percep/imu/ekf` | 200 Hz | CL-IMU-9, EKF-fused |
| Wheel odometry | `/percep/odom` | 100 Hz | Drive encoders |

## Outputs

| Topic | Rate | Consumer |
| --- | --- | --- |
| `/percep/objects` | 15 Hz | Manipulation primitives |
| `/percep/occupancy` | 10 Hz | Navigation, orchestrator |
| `/percep/pose` | 50 Hz | Control loop |
| `/percep/health` | 1 Hz | Reliability telemetry |

## Modules

1. **Sensor fusion** — owned by Bob.
2. **Object detection** — owned by [[people/eli-sato]].
3. **SLAM front-end** — owned by Bob.
4. **Calibration manager** — being refactored to support 5-minute field
   recalibration ([[projects/atlas-1-perception-stack]]).

## Decisions referenced

- [[decisions/2026-04-08-rgbd-over-stereo-only]] — primary sensor is
  RGBD, stereo is fallback only.
- [[decisions/2026-04-29-second-source-perception-head]] — second-source
  vendor for OF-RGBD-S2 to mitigate single-source risk.

## Health and telemetry

The `/percep/health` topic publishes per-module status at 1 Hz. The
[[projects/atlas-1-reliability-program]] uses this stream to attribute
interventions to specific modules.
