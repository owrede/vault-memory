---
title: Atlas-1 Component Spec (BOM)
kind: bom
created: 2026-02-20
---

# Atlas-1 Component Spec (BOM)

Authoritative bill of materials for the Atlas-1 platform at hardware revision C.
Update this document when procurement substitutes a part; keep the vendor /
part-number column accurate so the operations team can re-order without
asking. See [[projects/atlas-1]] for the project context and
[[decisions/2026-03-12-pivot-to-warehouse]] for the program scope this BOM
supports.

## Mechanical and drive

| Component | Vendor (fictional) | Part number | Notes |
| --- | --- | --- | --- |
| Drive motors (×2) | Helios Motion | HM-DR-280 | 280 W brushless, integrated encoder. |
| Wheel hubs (×2) | Helios Motion | HM-WH-08-C | 8-inch, urethane tread. |
| Caster (×2) | Quincor | QC-CAST-3 | 3-inch swivel, sealed bearing. |
| Chassis frame | In-house | ATL-CHASSIS-C | Welded aluminum, rev C. |

## Compute and perception

| Component | Vendor (fictional) | Part number | Notes |
| --- | --- | --- | --- |
| Main compute | Boreal Systems | BS-NX-512 | 512-core NPU module, 64 GB. |
| RGBD head | Optic Forge | OF-RGBD-S2 | Stereo + structured-light, USB-C. |
| Lidar | Crestline | CL-L4 | 4-plane, 25 Hz. |
| IMU | Crestline | CL-IMU-9 | 9-axis, EKF-fused output. |

## Power and arms

| Component | Vendor (fictional) | Part number | Notes |
| --- | --- | --- | --- |
| Battery pack | Northwave Cells | NW-PACK-48-200 | 48 V, 200 Wh, hot-swappable. |
| Arm modules (×2) | In-house | ATL-ARM-C | 6-DOF, harmonic-drive joints. |
| End effector | In-house | ATL-EE-PAR-2 | Parallel jaw, 5 kg payload. |

Procurement contacts and current lead times live in the operations spreadsheet,
not in the vault.
