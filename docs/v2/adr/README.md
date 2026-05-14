# ADR Index

This directory holds the v2 architectural decision records (ADRs) for
vault-memory's evolution from a retrieval substrate into a full agentic
knowledge layer. Every accepted ADR has an explicit `## Invariants` section
(normative MUST/MUST-NOT statements) and an `## Examples` section showing
worked round-trips for both `obsidian-fs://` and `notion-api://` schemes —
Phase 9's adversarial review greps both. Open ADRs (005+) are reserved for
v3 / Phase-10 connector work and are listed once all four v2 ADRs land.

## Accepted v2 ADRs

| # | Title | Status | Phase | Supersedes | Tags |
|---|---|---|---|---|---|
| 001 | [Document identity is opaque, URI-style](001-document-identity.md) | Accepted | 0 | — | identity, source-agnostic, uri, opaque-id |
| 002 | [Source & Delivery Seams](002-adapter-seams.md) | Accepted | 0 | — | adapters, seams, source-connector, delivery-adapter, change-feed, capability-descriptors |
| 003 | [Normalized Document Shape](003-document-shape.md) | Accepted | 0 | — | document-shape, hash, canonicalization, rfc-8785, source-hashes, property-bag |

## Open ADRs (v3 / Phase 10)

The 14 open ADRs covering v3 connector concerns (auth, rate limits,
change-feed semantics, cross-source memory sinks, etc.) will be enumerated
here once all four v2 ADRs (001–004) are amended and accepted. Plan 13
finalizes this list and audits the table. Until then, treat this section as
a placeholder — open questions live in the individual ADRs' "Open
follow-ups" sections and in `.planning/phases/00-foundation-decisions/00-RESEARCH.md`.
