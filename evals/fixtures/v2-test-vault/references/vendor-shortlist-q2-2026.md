---
title: Vendor Shortlist Q2 2026
kind: vendor-list
created: 2026-04-29
---

# Vendor Shortlist Q2 2026

Alternative vendors evaluated during the Q2 vendor-risk review (see
[[meetings/2026-04-29-vendor-risk-review]]). Maintained by
[[people/quinn-vega]]. The authoritative current BOM is in
[[references/atlas-1-component-spec]]; this doc captures second-source
candidates for the three single-sourced components flagged at the review.

## Flagged single-source components

| Component (BOM) | Primary | Risk |
| --- | --- | --- |
| BS-NX-512 (compute) | Boreal Systems | Single source, 14-week lead time |
| OF-RGBD-S2 (RGBD head) | Optic Forge | Single source, mitigated by [[decisions/2026-04-29-second-source-perception-head]] |
| NW-PACK-48-200 (battery) | Northwave Cells | Single source, cell shortage signals in market |

## Second-source candidates

### For BS-NX-512 (compute)

| Vendor (fictional) | Part | Pros | Cons |
| --- | --- | --- | --- |
| Greenway Compute | GW-NPU-480 | 6-week lead, similar perf | New supplier relationship |
| Tidemark Edge | TM-EDGE-540 | Slight perf advantage | 18-week lead, worse than incumbent |

### For OF-RGBD-S2 (RGBD head)

| Vendor (fictional) | Part | Pros | Cons |
| --- | --- | --- | --- |
| Optic Forge | OF-RGBD-S3 | Same vendor, new SKU | Doesn't solve single-vendor risk |
| Vellum Optics | VO-RGBD-2 | True second source | 6-month integration estimate |

**Selected per [[decisions/2026-04-29-second-source-perception-head]]:** Vellum Optics VO-RGBD-2, integration in Q3.

### For NW-PACK-48-200 (battery)

| Vendor (fictional) | Part | Pros | Cons |
| --- | --- | --- | --- |
| Northwave Cells | NW-PACK-48-200-B | Same vendor, drop-in | Same supply-chain risk |
| Cell Forge | CF-PACK-48-180 | Independent source | 12% less capacity |

Decision deferred to 2026-Q3 — capacity drop unattractive at current
shift schedules.

## Process notes

The shortlist is reviewed quarterly. Adding a vendor requires Quinn
sign-off plus the technical owner of the component
([[people/bob-martinez]] for perception, [[people/carlos-yim]] for
mechanical/drive/compute).
