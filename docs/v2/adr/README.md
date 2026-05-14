# ADR Index

This directory holds the v2 architectural decision records (ADRs) for
vault-memory's evolution from a retrieval substrate into a full agentic
knowledge layer. Every accepted ADR has an explicit `## Invariants` section
(normative MUST/MUST-NOT statements) and an `## Examples` section showing
worked round-trips for both `obsidian-fs://` and `notion-api://` schemes —
Phase 9's adversarial review greps both. Open ADRs (005+) are reserved for
v3 / Phase-10 connector work and are listed below alongside the v2 set.

See also:

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — layer model these ADRs constrain.
- [`../MEMORY_CONTRACT.md`](../MEMORY_CONTRACT.md) — operational expression of
  the safety invariant established by ADR-004.

## Status Legend

- **Accepted** — decision is binding for v2; code MUST conform; Phase 9
  adversarial review greps for violations.
- **Open** — question is parked for v3 / Phase 10 work; no v2 code may depend
  on a particular resolution.
- **Superseded** — replaced by a later ADR; kept for historical context.

## Accepted v2 ADRs

| # | Title | Status | Phase | Supersedes | Tags |
|---|---|---|---|---|---|
| 001 | [Document identity is opaque, URI-style](001-document-identity.md) | Accepted | 0 | — | identity, source-agnostic, uri, opaque-id |
| 002 | [Source & Delivery Seams](002-adapter-seams.md) | Accepted | 0 | — | adapters, seams, source-connector, delivery-adapter, change-feed, capability-descriptors |
| 003 | [Normalized Document Shape](003-document-shape.md) | Accepted | 0 | — | document-shape, hash, canonicalization, rfc-8785, source-hashes, property-bag |
| 004 | [Memory Sink Handles](004-memory-sink-handles.md) | Accepted | 0 | — | memory, memory-sink, provenance, sentinel-file, folder-default, separate-vault |

## Open ADRs (v3 / Phase 10)

The following 14 ADRs cover v3 connector concerns (identity stability,
authentication, rate limits, change-feed semantics, cross-source memory,
caching, capability discovery, etc.). They are parked here as the single
visible parking lot for v3 work per D-22 — there is no separate tracking
document. None of these ADRs may be written or merged until Phase 9's
premise check passes (see `.planning/ROADMAP.md` §Phase 9 HARD GATE).

| # | Title | Status | Phase | Supersedes | Tags |
|---|---|---|---|---|---|
| 005 | Identity stability across sources (Notion stable IDs vs Obsidian rename) | Open | v3-Phase-10 | — | identity, stability, notion, rename |
| 006 | Link resolution across heterogeneous sources | Open | v3-Phase-10 | — | links, resolution, cross-source, wikilinks |
| 007 | Property equivalence between Notion typed properties and Obsidian YAML | Open | v3-Phase-10 | — | properties, equivalence, frontmatter, typed |
| 008 | Document granularity — pages vs sub-pages vs blocks | Open | v3-Phase-10 | — | granularity, blocks, pages, document-shape |
| 009 | Write semantics — Notion atomic writes vs Obsidian filesystem | Open | v3-Phase-10 | — | write-semantics, atomicity, transactions |
| 010 | Authentication & OAuth flow for Notion adapter | Open | v3-Phase-10 | — | auth, oauth, credentials, notion |
| 011 | Watch / change-feed for Notion (poll-only, webhook later) | Open | v3-Phase-10 | — | watch, change-feed, polling, webhooks |
| 012 | Rate-limiting & backoff for source APIs | Open | v3-Phase-10 | — | rate-limiting, backoff, retry, api-limits |
| 013 | Embedding strategy for non-text Notion blocks (databases, properties) | Open | v3-Phase-10 | — | embedding-strategy, non-text, databases |
| 014 | Cross-source memory — `_memory/` sink shape when source ≠ Obsidian | Open | v3-Phase-10 | — | cross-source-memory, memory-sink, provenance |
| 015 | Caching layer between SourceConnector and core | Open | v3-Phase-10 | — | caching, source-connector, performance |
| 016 | Sync state — handling missed change events on adapter restart | Open | v3-Phase-10 | — | sync-state, missed-events, restart, durability |
| 017 | Notion-native memory sinks (page-as-document vs database-as-sink) | Open | v3-Phase-10 | — | notion-sinks, memory, database-sink |
| 018 | Capability discovery — runtime feature flags vs static descriptors | Open | v3-Phase-10 | — | capability-discovery, feature-flags, descriptors |

### Open ADR enumeration (for grep + at-a-glance scan)

The same 14 entries are repeated below as a flat bullet list so the literal
`Status: Open` token appears once per ADR for tooling that scans by line
rather than by table cell (validation row 00-13-02):

- ADR-005 — Identity stability across sources (Notion stable IDs vs Obsidian rename) — Status: Open, Phase: v3-Phase-10
- ADR-006 — Link resolution across heterogeneous sources — Status: Open, Phase: v3-Phase-10
- ADR-007 — Property equivalence between Notion typed properties and Obsidian YAML — Status: Open, Phase: v3-Phase-10
- ADR-008 — Document granularity — pages vs sub-pages vs blocks — Status: Open, Phase: v3-Phase-10
- ADR-009 — Write semantics — Notion atomic writes vs Obsidian filesystem — Status: Open, Phase: v3-Phase-10
- ADR-010 — Authentication & OAuth flow for Notion adapter — Status: Open, Phase: v3-Phase-10
- ADR-011 — Watch / change-feed for Notion (poll-only, webhook later) — Status: Open, Phase: v3-Phase-10
- ADR-012 — Rate-limiting & backoff for source APIs — Status: Open, Phase: v3-Phase-10
- ADR-013 — Embedding strategy for non-text Notion blocks (databases, properties) — Status: Open, Phase: v3-Phase-10
- ADR-014 — Cross-source memory — `_memory/` sink shape when source ≠ Obsidian — Status: Open, Phase: v3-Phase-10
- ADR-015 — Caching layer between SourceConnector and core — Status: Open, Phase: v3-Phase-10
- ADR-016 — Sync state — handling missed change events on adapter restart — Status: Open, Phase: v3-Phase-10
- ADR-017 — Notion-native memory sinks (page-as-document vs database-as-sink) — Status: Open, Phase: v3-Phase-10
- ADR-018 — Capability discovery — runtime feature flags vs static descriptors — Status: Open, Phase: v3-Phase-10

These ADRs are addressed in v3 Phase 10 only after the Phase 9 premise check
passes — adapter seams unbroken, ADRs 001–004 unviolated by code shipped in
Phases 2–8, conformance suite green, capability-descriptor coverage meeting
threshold, and explicit maintainer sign-off. Until then, no v3 code is
written and no Open ADR is promoted.

## Deferred-v3

Findings surfaced by the Phase-0 adversarial review (see
[`ADVERSARIAL-REVIEW.md`](ADVERSARIAL-REVIEW.md)) that are
Notion-specific operational realities — not v2 architectural gaps —
are deferred to v3 Phase-10 work. They are catalogued here for the
Phase-10 contractor; each finding's source language lives in
ADVERSARIAL-REVIEW.md.

| # | Finding source | Theme | Lands in (v3 Open ADR) | Status |
|---|---|---|---|---|
| F3 | ADVERSARIAL-REVIEW §Finding 3 | `listDocuments` scope — Notion's `/v1/search` returns only the integration's *shared* set; "list everything in the workspace" is impossible without an externally configured seed (`root_pages`, `root_databases`). Adapter MUST document its visibility scope as part of identity for staleness/audit. | ADR-010 (Auth & OAuth for Notion) + ADR-018 (Capability discovery) | Deferred-v3 |
| F5 | ADVERSARIAL-REVIEW §Finding 5 | `ListOptions.modifiedSince` as hint vs guarantee. Notion has no server-side `last_edited_time` filter — pagination is full-workspace every catchup. Adapter MUST publish `listSupportsModifiedSince: boolean` capability. Operational impact: 30+ second startups against large workspaces. | ADR-011 (Watch / change-feed for Notion) + ADR-018 (Capability discovery) | Deferred-v3 |
| F6 | ADVERSARIAL-REVIEW §Finding 6 | `ListOptions.excludeGlobs` grammar — "semantically interpreted by adapter" is too loose for non-filesystem sources. Each adapter MUST document its glob grammar in its capability descriptor or README; Notion's proposed grammar matches `page/<uuid>` / `database/<uuid>` as exact-DocId blocklist entries, ignoring path-shaped patterns with a startup warning. | ADR-018 (Capability discovery — runtime feature flags vs static descriptors) | Deferred-v3 |
| F8 | ADVERSARIAL-REVIEW §Finding 8 | `BlockNode` unbounded depth/size — Notion pages can have thousands of blocks and pathological toggle nesting. Adapter MUST publish `maxBlockCount`, `maxBlockDepth`, `readTimeoutMs` and on overflow return a partial `Document` ending in a `RawNode { format: 'truncated' }` with `truncated: true` in `Document.properties` (the truncation marker is part of the hash so repeat reads are stable). | ADR-008 (Document granularity) + ADR-018 (Capability discovery) | Deferred-v3 |

These four findings did NOT trigger v2 ADR amendments because the
underlying decisions are adapter-internal capability surface, not
cross-source architectural invariants. The general principle —
adapters publish honest capability descriptors and core code branches
on capabilities — is already established by ADR-002 I-7 and the
SourceCapabilities/DeliveryCapabilities contracts. v3 Phase-10 work
will land each finding's resolution in the listed Open ADR(s).

## Contributing new ADRs

When writing a new ADR (whether amending a v2 ADR or promoting an Open ADR
in v3):

1. Use the next free integer (`NNN-kebab-case-title.md`); do not renumber.
2. Follow the MADR-style template used by ADR-001..004: frontmatter
   (`title`, `status`, `phase`, `tags`, optional `depends-on`), an H1
   matching the title, then `**Status:**`, `**Date:**`, `**Scope:**`,
   `**Supersedes:**`, `**Superseded by:**`, and the standard sections
   (`## Context`, `## Decision`, `## Invariants`, `## Examples`, `##
   Consequences`, `## Open follow-ups`).
3. Add a row to the appropriate table above. Open rows MUST carry
   `Status: Open` and `Phase: v3-Phase-10`; Accepted rows MUST carry
   `Status: Accepted` and a concrete phase number.
4. If superseding an existing ADR, set the old ADR's `**Superseded by:**`
   field and add a `Superseded` row beneath the Accepted table (do not
   delete superseded ADRs — they remain for historical context).
