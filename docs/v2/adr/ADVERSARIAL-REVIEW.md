# Adversarial Review — v3 Phase-10 Notion Adapter

**Reviewer role:** v3 Phase-10 contractor implementing
`notion-api` `SourceConnector` / `DeliveryAdapter` / `ChangeFeed`.

**Inputs consulted:** ADR-001..004, ARCHITECTURE.md, MEMORY_CONTRACT.md,
AGENT_AGNOSTIC.md. Source code intentionally NOT consulted.

**Companion artifact:** `docs/v3/NOTION-ADAPTER-PLAN.md`.

**Stop condition:** ≥10 findings (reached at Finding 10; continued through
Finding 30 inline in the plan as parenthetical references — the 10 findings
below are the load-bearing ambiguities; remaining marks in the plan are
implementer judgment calls, not ADR gaps).

---

### Finding 1
**ADR / doc:** ADR-002 §Open follow-ups — "Adapter configuration secrets";
AGENT_AGNOSTIC.md §Anti-patterns — env-var rules.
**Ambiguity:** ADR-002 defers secret-handling to "Phase 10 defines how
secrets are passed (env vars, OS keychain, …)" but Phase 10 is *this*
phase, and the choice between env var, OS keychain, and TOML-with-substitution
materially affects the `[[connectors]]` schema and startup-validation logic.
AGENT_AGNOSTIC.md forbids vendor-prefixed env vars (`ANTHROPIC_*`,
`OPENAI_*`, `CLAUDE_*`) but does not say whether *integration*-prefixed
env vars (`NOTION_TOKEN`) are acceptable, or whether everything must be
namespaced `VAULT_MEMORY_*`.
**Impact on Notion adapter:** Implementer must invent either
`VAULT_MEMORY_NOTION_TOKEN`, `NOTION_TOKEN`, or a keychain entry name —
and decide whether `${env:NAME}` substitution in TOML is supported. The
choice is user-visible and irreversible.
**Recommended resolution:** ADR amendment to ADR-002 §Open follow-ups:
"Connector secrets MUST be read from `VAULT_MEMORY_<SCHEME>_*` env vars,
with `${env:VAULT_MEMORY_NOTION_TOKEN}` substitution supported in
`config.toml`. OS keychain integration deferred."
**Status**: Amended in 709339a (ADR-002 §Open follow-ups — "Adapter
configuration secrets" subsection now carries the
`VAULT_MEMORY_<SCHEME>_*` convention + `${env:VAULT_MEMORY_*}`
substitution rule).

### Finding 2
**ADR / doc:** ADR-002 §Decision — `SourceCapabilities`; ADR-003 §"Adapter-
produced Document".
**Ambiguity:** Notion's API is versioned via the `Notion-Version` header.
No ADR pins a version. The shape of `paragraph.rich_text[].plain_text`,
the existence of `unique_id` property, the schema of `synced_block`, and
many other fields all depend on the version sent. Conformance test
fixtures (ADR-003 H-1) recorded against version X may diverge against
version Y.
**Impact on Notion adapter:** Implementer must pick a version and bake it
into the adapter. A future Notion API change would silently alter the
content hash for previously-unchanged documents — violating the staleness
invariant (H-5) by appearing to mark every brief stale.
**Recommended resolution:** ADR amendment to ADR-003 §"Hash semantics":
"For adapters that interface with versioned external APIs, the API
version MUST be part of the canonical input feeding `hash()`, OR the
adapter MUST guarantee bytewise-identical normalized output across
supported API versions and document that guarantee in its capability
descriptor." Recommend the latter for Notion: the parse layer
normalizes away version differences.
**Status**: Amended in 01ba6bd (ADR-003 new invariant H-6 — adapters
interfacing with versioned external APIs MUST either include the
version in the hash input or guarantee cross-version normalized
output; notion-api adapter ships under the latter option, asserted by
the Phase-1 conformance suite).

### Finding 3
**ADR / doc:** ADR-002 §Decision — `SourceConnector.listDocuments`.
**Ambiguity:** Notion's `/v1/search` endpoint returns only pages and
databases the integration has been *explicitly shared with* — there is
no "list all pages in workspace" endpoint. ADR-002 implies
`listDocuments()` enumerates the source. For obsidian-fs, this means
"walk the vault". For Notion, "walk the workspace" is impossible without
a manually-provided seed list.
**Impact on Notion adapter:** Implementer must require user to specify
`root_pages` and `root_databases` in `[[connectors]]` config, OR document
that `listDocuments()` returns "everything the integration can see" with
no guarantee of completeness. The full-vault-index user expectation
(carried over from obsidian-fs) is broken; this needs a docs amendment
the contractor cannot make alone.
**Recommended resolution:** ADR-002 amendment: "`listDocuments()`
returns the *visible* document set for the adapter's authentication
scope. For adapters where visibility is configured externally (Notion's
integration sharing model), the configured scope is part of the adapter's
identity for staleness/audit purposes."
**Status**: Deferred-v3 (index row added in e911d53 — docs/v2/adr/README.md
§Deferred-v3 row F3; resolution lands in ADR-010 Auth/OAuth + ADR-018
Capability discovery). Notion's integration-sharing model is genuinely
Notion-specific operational reality, not a cross-source architectural
gap; the general principle that adapters publish honest capability
descriptors is already ADR-002 I-7.

### Finding 4
**ADR / doc:** ADR-001 §Decision — `<resource>` grammar; ADR-001 §Open
follow-ups.
**Ambiguity:** ADR-001 leaves URL-encoding of `<resource>` as an open
follow-up ("Recommendation: yes, percent-encoded; the adapter handles
encoding/decoding. To be confirmed when Phase 1 starts the obsidian-fs
refactor."). It is now Phase 10 and the decision was apparently not made
visible. Notion page IDs are UUIDs and have two canonical serializations
(hyphenated and unhyphenated); ADR-001 does not say which is canonical.
**Impact on Notion adapter:** Two adapters processing the same Notion
page could emit different DocIds (`notion-api://acme/page/c5b9f3a2-1234-...`
vs `notion-api://acme/page/c5b9f3a212344abc...`). The "primary key"
guarantee of identity-stability collapses if both forms coexist in the
index; foreign-key joins against the `notes` table fail.
**Impact on Notion adapter:** Implementer must invent a normalization
rule. Recommended: lowercase hyphenated UUID, but this must be
authoritative.
**Recommended resolution:** ADR-001 amendment to §Invariants: "I-6: For
adapters whose source IDs have multiple canonical serializations, the
adapter MUST pick exactly one and document it. For `notion-api`, page IDs
are serialized as lowercase hyphenated UUIDs (RFC 4122 form)."
**Status**: Amended in aa320de (ADR-001 new invariant I-6 — adapters
whose source IDs admit multiple serializations MUST pick exactly one
canonical form at the adapter boundary and emit only that form; concrete
rule for notion-api is lowercase hyphenated UUID with `page/`/`database/`
prefix).

### Finding 5
**ADR / doc:** ADR-002 §`ListOptions` — `modifiedSince`.
**Ambiguity:** `ListOptions.modifiedSince: number` (unix ms) implies the
adapter can efficiently filter by last-modification time. The Notion
Search API does NOT support server-side filtering by `last_edited_time`
— callers must paginate fully and filter client-side. The interface
contract suggests an efficiency the adapter cannot deliver.
**Impact on Notion adapter:** A `catchupVault()`-style reconciliation
that uses `modifiedSince` against a large Notion workspace performs a
full enumeration on every server start. The user observes 30+ second
startup hangs that ADR-002 implicitly attributes to a small cheap delta.
**Recommended resolution:** ADR-002 amendment to §`ListOptions`:
"`modifiedSince` is a hint, not a guarantee. Adapters whose backing
store cannot filter server-side MUST still return correct results, but
MAY do so by full enumeration. Adapters MUST publish
`listSupportsModifiedSince: boolean` in `SourceCapabilities`." OR mark as
Deferred-v3 with a `Deferred-v3` index row noting that Notion startups
will paginate the full workspace.
**Status**: Deferred-v3 (index row added in e911d53 — docs/v2/adr/README.md
§Deferred-v3 row F5; resolution lands in ADR-011 Watch/change-feed for
Notion + ADR-018 Capability discovery). The capability-flag pattern
(`listSupportsModifiedSince`) is adapter-capability detail rather than
a v2 architectural gap.

### Finding 6
**ADR / doc:** ADR-002 §`ListOptions` — `excludeGlobs: string[]`
"semantically interpreted by adapter".
**Ambiguity:** "Semantically interpreted by adapter" is too loose. For
obsidian-fs, globs are filesystem globs. For Notion, there is no path-
like structure to glob over — pages are a graph. `excludeGlobs: ["**/Archive/**"]`
has no defined meaning. An indexer that excludes `_memory/**` (the
default Obsidian exclude per ADR-004) against a Notion source must do
*something*, but ADR-002 does not say what.
**Impact on Notion adapter:** Implementer must invent a grammar — accept
`page/<id>` as a literal DocId blocklist? Accept database-id prefix
matches? Silently ignore globs that don't look applicable? Each choice
has different observable behavior and shapes the user's mental model.
**Recommended resolution:** ADR-002 amendment to §`ListOptions`: "Adapter
MUST document its `excludeGlobs` grammar in its capability descriptor or
its README. For `notion-api`, glob entries matching `page/<id>` or
`database/<id>` (with `<id>` being a lowercase hyphenated UUID) act as
exact DocId blocklist matches; all other entries are ignored with a
startup warning."
**Status**: Deferred-v3 (index row added in e911d53 — docs/v2/adr/README.md
§Deferred-v3 row F6; resolution lands in ADR-018 Capability discovery).
The per-adapter glob-grammar declaration is adapter-internal capability
surface; the general principle (capability descriptors carry adapter
grammars) is already in ADR-002 I-7.

### Finding 7
**ADR / doc:** ADR-002 §`SourceConnector` — `hash(id)` "cheap relative to
read"; ADR-002 §`DocumentRef` — "cheap pre-flight hash; may be coarse".
**Ambiguity:** ADR-002 specifies that `hash()` is cheap and that
`DocumentRef.hash` may be coarse, but it does not define what "coarse"
means or how `DocumentRef.hash` relates to `Document.hash`. For obsidian-
fs, `hash(body)` is the same value used as `Document.hash`'s body input.
For Notion, fetching the body is the expensive operation — there is no
way to be both cheap AND identical to `Document.hash`. The indexer
presumably uses `DocumentRef.hash` to short-circuit re-reads ("if the
ref hash matches what's stored, skip"); if Notion's ref-hash is just
`sha256(last_edited_time)`, that's correct (the indexer never sees a
stale doc) but means every change triggers a full re-fetch — which is
the only correct outcome but should be acknowledged.
**Impact on Notion adapter:** Implementer must decide: emit
`DocumentRef.hash = sha256(last_edited_time)` (cheap, never matches
`Document.hash`, forces re-fetch on every change) or emit
`Document.hash` (correct, expensive, defeats the cheap-pre-flight
purpose). Either choice changes the indexer's caching behavior.
**Recommended resolution:** ADR-002 amendment to §`DocumentRef`:
"`DocumentRef.hash` MUST equal `Document.hash` when the adapter can
produce both cheaply; otherwise it MAY be any deterministic function of
metadata that changes-iff-content-changes (e.g.
`sha256(last_modified_marker)`). Indexer treats inequality as
'must re-read'; never as 'staleness'."
**Status**: Amended in 709339a (ADR-002 new §`DocumentRef.hash` contract
subsection under `SourceConnector`, plus `SourceCapabilities.refHashKind:
'content' | 'marker'` field). The indexer treats `DocumentRef.hash`
inequality as a re-read signal, never as a staleness verdict; the
authoritative staleness comparison uses `Document.hash` from
`readDocument()`. notion-api ships `refHashKind: 'marker'`; obsidian-fs
ships `refHashKind: 'content'`.

### Finding 8
**ADR / doc:** ADR-003 §`BlockNode` — body shape; ARCHITECTURE.md
§"Adapter tier" — "at-least-once change delivery".
**Ambiguity:** ADR-003 specifies a recursive `BlockNode` tree without
bounding depth or total size. Notion pages can contain arbitrarily deep
nesting (toggles inside toggles inside…) and a single page can have
thousands of blocks. There is no documented timeout, concurrency cap,
or partial-document semantics. A `readDocument()` call against a
pathological page could take minutes or exhaust memory.
**Impact on Notion adapter:** Implementer must invent a cap. Pick "max
1000 blocks, max depth 50, max 30s wall-clock" — values not derivable
from any ADR — and decide whether to: (a) error out, (b) truncate and
emit a `RawNode` placeholder, (c) emit an incomplete `Document` with a
warning property. Each choice has different staleness-daemon
implications: a truncated doc has a different hash from the same doc
re-read without the limit.
**Recommended resolution:** ADR-003 amendment to §"Implications for
existing modules": "Adapters MUST publish `maxBlockCount`,
`maxBlockDepth`, and `readTimeoutMs` in their capability descriptors.
On exceeding any limit, the adapter MUST return a partial `Document` with
a single trailing `RawNode { format: 'truncated', text: <reason> }` and
include `truncated: true` in `Document.properties`. The truncation marker
is part of the hash input — re-reading a truncated doc produces a stable
hash even though the underlying source is larger."
**Status**: Deferred-v3 (index row added in e911d53 — docs/v2/adr/README.md
§Deferred-v3 row F8; resolution lands in ADR-008 Document granularity +
ADR-018 Capability discovery). The `maxBlockCount` / `maxBlockDepth` /
`readTimeoutMs` cap and truncation-marker mechanism are adapter
capability-descriptor details, not a v2 cross-source architectural gap;
ADR-002 I-7 already establishes that adapters publish honest capability
descriptors.

### Finding 9
**ADR / doc:** ADR-003 §"Hash semantics" — H-1 (hash covers both
`blocks` and `properties`); ADR-002 §`SourceConnector.hash()`.
**Ambiguity:** H-1 says "a frontmatter-only change is still a content
change" — the hash MUST cover both blocks and properties. For Notion,
the page metadata response (`/v1/pages/<id>`) returns properties cheaply
but block content requires recursive `/v1/blocks/<id>/children` calls.
There is no way to compute the H-1-conformant hash without fetching the
full block tree, contradicting ADR-002's "cheap relative to read" framing
for `hash()`. Phase 5's staleness daemon (BRF-05) is documented to use
the per-document and per-chunk hashes; if `hash()` is in fact equal to
`readDocument()` for Notion, the daemon's poll cost is multiplied by the
average page block-count.
**Impact on Notion adapter:** Implementer cannot avoid the full-fetch
cost on every `hash()` call unless they introduce a cache (see plan
§4.3). The cache shape (`(id, last_edited_time) → content_hash`) is
nowhere in ADR-002; the adapter must invent its own SQLite side-table
and migration. Whether this is acceptable, where it lives, and how it
interacts with the indexer's existing chunk-level caching is undefined.
**Recommended resolution:** ADR-002 amendment to §"Open follow-ups":
"Adapters MAY maintain a private cache (in their own SQLite tables under
a `__adapter_<scheme>_` prefix) of `(DocId, modification-marker) →
Document.hash`. Cache invalidation is the adapter's responsibility;
the cache MUST NOT be visible to core code."
**Status**: Amended in 709339a + 01ba6bd (ADR-002 §Open follow-ups grants
adapters permission to maintain `__adapter_<scheme>_*` SQLite tables —
core code MUST NOT read or mutate, conformance suite enforces. ADR-003
§Hash semantics adds a "Cost note for fetch-heavy adapters" paragraph
cross-linking to this permission, closing the apparent cost
contradiction between H-1 (hash covers blocks AND properties) and
ADR-002's "cheap relative to read" framing).

### Finding 10
**ADR / doc:** ADR-002 §`DeliveryCapabilities` — `atomic: boolean`,
`hashProtected: boolean`; ARCHITECTURE.md §"Data flow — write path"
Guard B ("hash-protected OCC").
**Ambiguity:** Notion has no atomic multi-block write and no `If-Match`
equivalent on `PATCH /v1/pages/<id>`. ADR-002 invariant I-7 requires
honest capability descriptors. ARCHITECTURE.md Guard B requires
"compare expected_hash with current source hash; reject as
`{ok:false, reason:'conflict'}` if drifted." For Notion this means a
read-then-compare-then-write sequence with a TOCTOU window — the
adapter advertises `hashProtected: false` honestly, but Phase 7
contracts that declare `write_back: {hashProtected: true}` will then
refuse to use the Notion sink, making Notion sinks unusable for any
contract that takes optimistic concurrency seriously. This is the core
unresolved question for Notion as a memory sink.
**Impact on Notion adapter:** Implementer must decide:
(a) Advertise `hashProtected: false`. Honest, but the memory sink is
unusable from contracts that need OCC — Phase 7's
`describe_contract` rejects the sink. The team-memory sink in
ADR-004 Example B becomes a write-only quarantine.
(b) Advertise `hashProtected: true` and implement best-effort
read-compare-write. Violates I-7 (the adapter is not actually
atomic) but is the only way Notion sinks function for OCC-aware
contracts.
(c) Add a third capability tier (`hashProtected: 'best-effort'`) — a
type-system change to ADR-002.
Each choice is irreversible once shipped because it shapes the
contract-author's expectations.
**Recommended resolution:** ADR-002 amendment to §`DeliveryCapabilities`:
"Extend `hashProtected` to enum: `'strong' | 'best-effort' | 'none'`.
`'strong'` = atomic compare-and-swap (e.g., obsidian-fs with rename(2)
+ fsync). `'best-effort'` = read-check-write with a TOCTOU window
documented by the adapter. `'none'` = no concurrency control.
Contracts MAY declare `min_hashProtected: 'best-effort'` (default) or
`'strong'`." Notion adapter ships as `'best-effort'`.
**Status**: Amended in 709339a (ADR-002 §`DeliveryCapabilities`
`hashProtected` field changed from `boolean` to enum `'strong' |
'best-effort' | 'none'`; new "hashProtected tier semantics" subsection
documents tier definitions and `write_back.minHashProtected` contract
declaration default `'best-effort'`. obsidian-fs ships `'strong'`
(rename(2) + fsync); notion-api ships `'best-effort'` (documented
TOCTOU window between GET and PATCH). Memory-sink writes against
`'none'` rejected by Phase-2 write-guard unless contract opts in
explicitly).

---

## Stop summary

10 specific findings filed. Plan is complete to the level where every
remaining decision is either:

- An implementer-internal choice (block-translation table details,
  polling cadence, SQLite cache schema) where ADRs deliberately defer
  to the adapter, OR
- Cross-referenced inline in `NOTION-ADAPTER-PLAN.md` with a parenthetical
  "(see Finding N)" for the 10 above; OR
- A parenthetical marker (F11..F31 in the plan) that, once Findings 1–10
  resolve, reduces to a mechanical follow-on decision the implementer
  can make without further ADR text.

Recommended next action: maintainer triages the 10 findings into either
ADR amendments (preferred for 1, 2, 4, 7, 9, 10 — they affect more than
just Notion) or `Deferred-v3` index rows (acceptable for 3, 5, 6, 8 —
they are Notion-specific operational realities).

---

## Audit

**Date:** 2026-05-14
**Agent identity:** `gsd-advisor-researcher` (per D-15) — Phase-10
Notion-adapter contractor with restricted document access (the seven
canonical v2 docs only: ADR-001..004, ARCHITECTURE.md,
MEMORY_CONTRACT.md, AGENT_AGNOSTIC.md). v2 brief and `src/` source
code were NOT consulted.
**Prompt used:** Verbatim from Phase-0 plan
`00-14-adversarial-review-PLAN.md` Task 1 (which itself quotes
RESEARCH §Pitfall 6). Future audits can re-run the prompt against the
post-amendment ADRs to verify gaps were genuinely closed.
**Plan reference:** `.planning/phases/00-foundation-decisions/00-14-adversarial-review-PLAN.md`.
**Companion artifact:** `docs/v2/adr/NOTION-ADAPTER-PLAN.md` (the
Phase-10 contractor's in-progress implementation draft that surfaced
the 10 findings).

**Finding count:** 10. **Amend:** 6 (Findings 1, 2, 4, 7, 9, 10).
**Deferred-v3:** 4 (Findings 3, 5, 6, 8). The amend/defer split
matches the reviewer's own recommendation in §Stop summary above —
findings that affect more than just Notion (cross-source
architectural gaps) become v2 ADR amendments; findings that are
adapter-internal capability surface defer to v3 Phase-10 work.

### Disposition table

| Finding | Disposition | Target file | Commit | One-line summary |
|---|---|---|---|---|
| 1 | Amended | ADR-002 §Open follow-ups | `709339a` | Connector secrets read from `VAULT_MEMORY_<SCHEME>_*`; `${env:…}` substitution in `config.toml`. |
| 2 | Amended | ADR-003 §Invariants (new H-6) | `01ba6bd` | Versioned-API adapters MUST version-or-normalize hash input; notion-api ships under the normalize option. |
| 3 | Deferred-v3 | README.md §Deferred-v3 row F3 | `e911d53` | `listDocuments` scope is Notion's integration-sharing surface; lands in ADR-010 + ADR-018. |
| 4 | Amended | ADR-001 §Invariants (new I-6) | `aa320de` | Multi-serialization source IDs MUST pick exactly one canonical form at the adapter boundary; notion-api = lowercase hyphenated UUID. |
| 5 | Deferred-v3 | README.md §Deferred-v3 row F5 | `e911d53` | `modifiedSince` as hint vs guarantee; capability flag `listSupportsModifiedSince`; lands in ADR-011 + ADR-018. |
| 6 | Deferred-v3 | README.md §Deferred-v3 row F6 | `e911d53` | `excludeGlobs` grammar per adapter; lands in ADR-018. |
| 7 | Amended | ADR-002 §SourceConnector (new `DocumentRef.hash` contract) | `709339a` | Two-tier hash contract: `content` vs `marker`; `SourceCapabilities.refHashKind` field. |
| 8 | Deferred-v3 | README.md §Deferred-v3 row F8 | `e911d53` | BlockNode caps + truncation marker; lands in ADR-008 + ADR-018. |
| 9 | Amended | ADR-002 §Open follow-ups + ADR-003 §Hash semantics | `709339a` + `01ba6bd` | Adapter-private `__adapter_<scheme>_*` SQLite cache permission; ADR-003 cost note cross-links. |
| 10 | Amended | ADR-002 §DeliveryCapabilities + new "hashProtected tier semantics" | `709339a` | `hashProtected` extended from boolean to `'strong' \| 'best-effort' \| 'none'` enum; contracts declare `minHashProtected`. |

### Commit ledger

| SHA | Scope | Subject |
|---|---|---|
| `aa320de` | adr-001 | add I-6 — canonical serialization invariant (Finding 4) |
| `709339a` | adr-002 | amend per ADVERSARIAL-REVIEW Findings 1, 7, 9, 10 |
| `01ba6bd` | adr-003 | amend hash semantics — versioned APIs + Notion cost note (Findings 2, 9) |
| `e911d53` | adr-index | add Deferred-v3 section for Findings 3, 5, 6, 8 |

### Health check (per RESEARCH §Pitfall 6 warning signs)

- Finding count: 10 ≥ 4 (floor). PASS.
- Amend-to-defer ratio: 6:4 ≈ 60%:40%. Within healthy band (RESEARCH
  warned that *all*-deferred would mean ADRs are not being tightened;
  *zero*-findings would be rubber-stamp). PASS.
- Per-ADR coverage: ADR-001 (1 amendment), ADR-002 (4 amendments),
  ADR-003 (2 amendments), ADR-004 (no findings — note that ADR-004's
  memory-sink contract is the *most* tightly specified of the four and
  the reviewer surfaced nothing additional). PASS.
- Silent ignores: zero — every finding terminates in Amended or
  Deferred-v3 with a captured SHA.
- VALIDATION row 00-17-02 grep parity: 10 findings, 10 Status lines
  matching `(Amended|Deferred-v3)`.
