---
title: Spire Architecture Reference
kind: architecture
created: 2026-04-05
---

# Spire Architecture Reference

Authoritative architecture document for the [[projects/spire]] product
line. Owned by [[people/dana-park]] from 2026-05-04 onward; the doc was
seeded by [[people/alice-chen]] in early Q2 when Spire was still her
side-project.

## Components

| Component | Where it runs | Owner |
| --- | --- | --- |
| Fleet orchestrator | Site-local server | [[projects/spire-fleet-orchestrator]] |
| Warehouse task library | On-robot | [[projects/atlas-1-warehouse-task-library]] |
| Pallet identification | On-robot perception | [[projects/spire-pallet-identification]] |
| Configuration UI | Site-local server | (placeholder, Q3) |
| Customer-side gateway | Customer-network device | (placeholder, Q3) |

## Deployment topology

```
+-----------------------------+
|  Customer network            |
|                              |
|  +-----------+               |
|  |  Gateway  | (Q3 only)     |
|  +-----+-----+               |
|        |                     |
|  +-----v---------------+     |
|  |  Site-local server  |     |
|  |  - Orchestrator     |     |
|  |  - Config UI        |     |
|  +-----+---------------+     |
|        |                     |
|  +-----v--------+ +--------+ |
|  | Atlas-1 (1)  | | (2..N) | |
|  +--------------+ +--------+ |
+-----------------------------+
```

The site-local server is a single beefy host today (a laptop on the test
floor). Production hardware spec is unresolved — debate parked in
[[meetings/2026-05-11-spire-server-spec-debate]].

## API contracts

- Orchestrator ↔ Task library:
  [[references/warehouse-task-library-api]] (semver-pinned).
- Orchestrator ↔ Atlas-1 robot: protobuf over local-network gRPC.
- Configuration UI ↔ Orchestrator: REST + websocket (Q3).

## Related decisions

- [[decisions/2026-04-25-orchestrator-library-split]]
- [[decisions/2026-03-12-pivot-to-warehouse]] (parent program rationale)
