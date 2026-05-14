---
title: Memory Contract — v2
status: Accepted
phase: 0
tags: memory, provenance, validator, property-bag, safety-invariant
depends-on: ADR-003, ADR-004
---

# Memory Contract — v2

**Status:** Accepted — Phase 0 foundation
**Date:** 2026-05-14
**Scope:** All agent-authored writes through `DeliveryAdapter.write()` from Phase 2 onward
**Supersedes:** —
**Superseded by:** —

## Purpose

vault-memory's single non-negotiable safety invariant is that agents never write
silently into user notes. Every agent-authored document carries provenance
properties and lives in a labeled `MemorySink`. The Memory Contract is the
machine-checkable expression of that invariant: the exact set of properties
that an agent-authored `Document` must carry, the values those properties may
take, and the validator behavior at the single chokepoint where writes are
gated.

The contract is enforced by `DeliveryAdapter.write()` (per ADR-002 invariant —
single chokepoint), **not** by individual tool handlers. Two guards run at the
adapter boundary:

- **Guard A — required keys present.** Every write whose target resolves into
  a configured `MemorySink` MUST carry the seven required provenance keys on
  its `Document.properties` payload. Missing keys are rejected.
- **Guard B — `source: agent` confinement.** A write whose
  `properties.source === "agent"` is FORBIDDEN unless the target `DocId`
  resolves into a configured `MemorySink`. The validator rejects all other
  paths — protecting user notes from silent agent writes.

The contract is expressed against `Document.properties` — the canonical
`PropertyBag` defined in ADR-003 — **not** against raw Obsidian YAML
frontmatter. Adapters translate frontmatter ↔ PropertyBag at the boundary so
the same contract applies uniformly when a v3 Notion delivery adapter lands:
its typed page-properties map into the same PropertyBag shape, and the same
validator catches missing or invalid provenance.

## Required properties

Every agent-authored `Document` written to a `MemorySink` MUST carry the
following seven keys on `Document.properties`. The keys are listed in
REQUIREMENTS.md FND-06 verbatim; this section is the authoritative spec for
their types, allowed values, defaults, and validator behavior.

### source

- **Type:** string enum
- **Allowed values:** `"agent"`, `"user"`, `"imported"`
- **Default for memory-sink writes:** `"agent"`
- **Validator behavior on missing:** reject with
  `{ok: false, reason: "missing_provenance", key: "source"}`
- **Validator behavior on invalid:** reject with
  `{ok: false, reason: "invalid_provenance", key: "source", value: <observed>}`
- **Worked example:**
  ```json
  "source": { "type": "string", "value": "agent" }
  ```

`source` identifies who authored the document. `agent` is the only value
permitted to land inside a `MemorySink`; the validator's Guard B refuses
`source: agent` writes outside any configured sink, and refuses
`source: user` / `source: imported` writes into a sink (a sink is for agent
writes; user material belongs in the surrounding vault).

### confidence

- **Type:** string enum
- **Allowed values:** `"direct"`, `"inferred"`, `"uncertain"`
- **Default:** none — MUST be set explicitly by the writer
- **Validator behavior on missing:** reject with
  `{ok: false, reason: "missing_provenance", key: "confidence"}`
- **Validator behavior on invalid:** reject with
  `{ok: false, reason: "invalid_provenance", key: "confidence", value: <observed>}`
- **Worked example:**
  ```json
  "confidence": { "type": "string", "value": "inferred" }
  ```

`confidence` is the agent's self-reported certainty about the claim recorded
in the document. `direct` means the claim is a verbatim quote, an explicit
user statement, or a directly observed fact in the source material.
`inferred` means the agent derived the claim from one or more sources but
the source material does not literally contain it. `uncertain` means the
agent flags the claim as a working hypothesis that future evidence may
revise. The `recall()` tool (Phase 2, MEM-03) filters on this property via
`min_confidence`.

### evidence

- **Type:** array of strings; each element is either a `DocId` (per ADR-001)
  or a free-text citation
- **Default:** none — MUST be present; MAY be an empty array
- **MAY be empty:** when `confidence: "direct"` and the claim is the agent's
  own first-hand observation (e.g., a brief that summarizes the agent's own
  reasoning state); otherwise SHOULD contain at least one citation
- **Validator behavior on missing:** reject with
  `{ok: false, reason: "missing_provenance", key: "evidence"}`
- **Validator behavior on invalid:** reject with
  `{ok: false, reason: "invalid_provenance", key: "evidence", value: <observed>}`
  when the value is not an array of strings
- **Worked example:**
  ```json
  "evidence": {
    "type": "array",
    "value": [
      "obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md",
      "obsidian-fs://atlas/projects/Atlas-1.md"
    ]
  }
  ```

`evidence` lists the documents (or external references) that ground the
claim. When entries are `DocId` strings, downstream tools (briefs, dossiers,
the staleness daemon) can resolve them through the adapter registry; when
entries are free text, they are treated as opaque citations. The validator
checks shape only, not link resolution — broken citations are a Phase 5
brief-staleness concern, not a write-time concern.

### status

- **Type:** string enum
- **Allowed values:** `"active"`, `"superseded"`, `"archived"`
- **Default:** `"active"`
- **Validator behavior on missing:** treat as `"active"` (default applied at
  the adapter; the persisted PropertyBag carries the explicit value after
  the write)
- **Validator behavior on invalid:** reject with
  `{ok: false, reason: "invalid_provenance", key: "status", value: <observed>}`
- **Worked example:**
  ```json
  "status": { "type": "string", "value": "active" }
  ```

`status` is the lifecycle marker. `active` documents are returned by
`recall()` by default. `superseded` documents are hidden unless the caller
opts in (per ASM-08, mirroring `search_hybrid`'s `include_superseded`
flag), and MUST be linked forward via `superseded_by`. `archived` documents
are retained for audit and history but excluded from default assembly.

### observed_at

- **Type:** ISO 8601 timestamp string (RFC 3339 profile, UTC, second
  precision or finer)
- **Default:** none — MUST be set by the writer at write time
- **Validator behavior on missing:** reject with
  `{ok: false, reason: "missing_provenance", key: "observed_at"}`
- **Validator behavior on invalid:** reject with
  `{ok: false, reason: "invalid_provenance", key: "observed_at", value: <observed>}`
  when the value is not a parseable ISO 8601 timestamp
- **Worked example:**
  ```json
  "observed_at": { "type": "datetime", "value": "2026-04-15T10:23:00Z" }
  ```

`observed_at` is when the agent recorded the observation — not when the
document was last written to disk (the adapter tracks that separately as
`mtime`). The two diverge when an agent records yesterday's meeting today:
`observed_at` is yesterday's meeting time; `mtime` is now. The
authority/staleness layer (Phase 3, ASM-07) uses `observed_at` for recency
weighting; the validator only checks shape.

### superseded_by

- **Type:** `DocId | null` (per ADR-001 — opaque URI-style identifier)
- **Default:** `null`
- **Cross-field constraint:** non-null **iff** `status === "superseded"`.
  The validator rejects mismatches.
- **Validator behavior on missing:** treat as `null` (default applied at the
  adapter)
- **Validator behavior on invalid:** reject with one of:
  - `{ok: false, reason: "invalid_provenance", key: "superseded_by", value: <observed>}`
    when the value is neither `null` nor a syntactically valid `DocId`
  - `{ok: false, reason: "supersede_mismatch", key: "superseded_by", status: <observed>}`
    when `status === "superseded"` and the value is `null`, or vice versa
- **Worked example (active document):**
  ```json
  "superseded_by": { "type": "doc_id", "value": null }
  ```
- **Worked example (superseded document):**
  ```json
  "superseded_by": {
    "type": "doc_id",
    "value": "obsidian-fs://atlas/_memory/observations/2026-05-01-alice-now-prefers-sync.md"
  }
  ```

`superseded_by` is the forward link that the `supersede()` tool (Phase 2,
MEM-04) sets when a new observation replaces an older one. Cross-sink
supersession is permitted — a document in one sink MAY be superseded by a
document in another sink, provided both `DocId`s resolve through the
adapter registry. The validator does not resolve the target at write time;
broken forward links are a runtime concern (Phase 4 graph navigation
returns them as `unresolved`).

### type

- **Type:** free-form short string tag
- **Allowed values:** any non-empty string; conventional values include
  `"observation"`, `"brief"`, `"note"`, `"status-update"`, `"hypothesis"`,
  `"decision"`, `"action-item"`. New types MAY be introduced by tools or
  contracts without amending this contract.
- **Default:** none — MUST be set explicitly by the writer
- **Validator behavior on missing:** reject with
  `{ok: false, reason: "missing_provenance", key: "type"}`
- **Validator behavior on invalid:** reject with
  `{ok: false, reason: "invalid_provenance", key: "type", value: <observed>}`
  when the value is not a non-empty string
- **Worked example:**
  ```json
  "type": { "type": "string", "value": "observation" }
  ```

`type` is a free-form classifier used by `recall()` filtering. Unlike
`source` / `confidence` / `status`, `type` is intentionally open: tools and
contracts add new types over time without needing a contract amendment.
The validator enforces only the shape — non-empty string — so that
`recall({types: ["observation", "brief"]})` and similar filters have
something predictable to match against.

## Validator behavior

Both guards run at `DeliveryAdapter.write()` — the single chokepoint
established by ADR-002. Per-tool handlers (`write_note`, `update_frontmatter`,
`delete_note`, `record_observation`, `supersede`, `compile_brief`, and any
future writing tool) MUST route through the adapter and MUST NOT replicate
or bypass the guards. CI greps (see Phase 1 ADP-12 and successors) enforce
that all write paths terminate at `DeliveryAdapter.write()`; the guards live
there exactly once.

### Guard A — required keys present

For any write whose target `DocId` resolves into a configured `MemorySink`,
the `Document.properties` payload MUST contain every key in the §Required
properties list. The validator iterates the seven keys; the first missing or
invalid key terminates with a structured error.

**Structured error responses (from §Required properties — collated here for
the Phase 2 implementer):**

- Missing key (any of the seven, in iteration order):
  ```json
  { "ok": false, "reason": "missing_provenance", "key": "<key-name>" }
  ```
- Invalid value (enum violation, wrong type, malformed timestamp, malformed
  `DocId`):
  ```json
  {
    "ok": false,
    "reason": "invalid_provenance",
    "key": "<key-name>",
    "value": "<observed-value>"
  }
  ```
- Cross-field constraint violation (`status` / `superseded_by` mismatch):
  ```json
  {
    "ok": false,
    "reason": "supersede_mismatch",
    "key": "superseded_by",
    "status": "<observed-status>"
  }
  ```

The validator MUST NOT mutate the input — it inspects and returns. Defaults
(`status: "active"`, `superseded_by: null`) are applied by the adapter
**after** Guard A succeeds, before persistence. This separation keeps the
guards purely diagnostic: a failed guard means a real provenance bug in the
caller, not a missing default.

### Guard B — `source: agent` confinement

For any write whose `Document.properties.source === "agent"`, the target
`DocId` MUST resolve into a configured `MemorySink` (per ADR-004 — the
sink resolution layer is the only path resolver). The validator rejects all
other targets with:

```json
{ "ok": false, "reason": "agent_write_outside_sink", "doc_id": "<target>" }
```

The check runs at the `DeliveryAdapter.write()` entry — before any
filesystem operation, before any DB write, before any audit-log entry. There
is no escape hatch. The validator does not branch on tool name, capability
flag, or environment variable: an agent-authored write either lands in a
labeled sink or it is refused.

The inverse rule — `source: user` or `source: imported` writes into a sink
— is also rejected (a sink is for agent material by definition). This case
returns the same structured error with a different reason:

```json
{ "ok": false, "reason": "non_agent_write_inside_sink", "doc_id": "<target>" }
```

Both guards short-circuit: Guard B runs first (cheap — single property
check), Guard A runs second (iterates seven keys). A write rejected by
Guard B never has Guard A evaluated; the error returned is Guard B's.

## PropertyBag mapping for Obsidian

The Memory Contract is expressed against `Document.properties` (the ADR-003
`PropertyBag`). The Obsidian source/delivery adapter pair translates between
YAML frontmatter and PropertyBag at the boundary. This section shows the
mapping for the seven required keys so that Phase 2's adapter implementation
has no ambiguity.

The PropertyBag is a typed map: each cell is `{type, value}` where `type` is
one of `string`, `array`, `datetime`, `doc_id`, `number`, `boolean`, `null`
(per ADR-003 — the full list lives there). Obsidian YAML frontmatter is
untyped, so the adapter applies these rules:

- `source`, `confidence`, `status`, `type` → YAML scalar string → PropertyBag
  `{type: "string", value: <scalar>}`
- `evidence` → YAML list of strings → PropertyBag `{type: "array",
  value: <list>}` (each element a string; the adapter does not introspect
  whether elements are `DocId`s — the validator checks shape only)
- `observed_at` → YAML ISO 8601 string → PropertyBag `{type: "datetime",
  value: <iso-string>}`
- `superseded_by` → YAML string or YAML `null` → PropertyBag
  `{type: "doc_id", value: <string-or-null>}`

### Worked example — Obsidian frontmatter

```yaml
---
source: agent
confidence: inferred
evidence:
  - obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md
  - obsidian-fs://atlas/projects/Atlas-1.md
status: active
observed_at: 2026-04-15T10:23:00Z
superseded_by: null
type: observation
---

Alice mentioned twice this week that she prefers async standups over
synchronous ones. Carlos pushed back on this in the 2026-04-12 standup
but Alice repeated the preference in 1:1 notes from 2026-04-15.
```

### Worked example — PropertyBag JSON

```json
{
  "properties": {
    "source":        { "type": "string",   "value": "agent" },
    "confidence":    { "type": "string",   "value": "inferred" },
    "evidence":      {
      "type": "array",
      "value": [
        "obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md",
        "obsidian-fs://atlas/projects/Atlas-1.md"
      ]
    },
    "status":        { "type": "string",   "value": "active" },
    "observed_at":   { "type": "datetime", "value": "2026-04-15T10:23:00Z" },
    "superseded_by": { "type": "doc_id",   "value": null },
    "type":          { "type": "string",   "value": "observation" }
  }
}
```

The adapter is responsible for round-tripping: every read translates YAML
→ PropertyBag; every write translates PropertyBag → YAML. The validator
operates on the PropertyBag side exclusively. A Phase 10 Notion delivery
adapter performs the analogous mapping (Notion typed page-properties →
PropertyBag) and the same validator applies unchanged.

## Examples

### Example A — valid agent observation

The agent records a new observation in the default folder-style memory sink.

**Target `DocId`:**

```
obsidian-fs://atlas/_memory/observations/2026-04-15-alice-prefers-async.md
```

**`Document.properties` payload:**

```json
{
  "source":        { "type": "string",   "value": "agent" },
  "confidence":    { "type": "string",   "value": "inferred" },
  "evidence":      {
    "type": "array",
    "value": [
      "obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md",
      "obsidian-fs://atlas/projects/Atlas-1.md"
    ]
  },
  "status":        { "type": "string",   "value": "active" },
  "observed_at":   { "type": "datetime", "value": "2026-04-15T10:23:00Z" },
  "superseded_by": { "type": "doc_id",   "value": null },
  "type":          { "type": "string",   "value": "observation" }
}
```

**Validator decision:** Guard B passes (target resolves into the configured
`obsidian-fs://atlas/_memory/` sink). Guard A passes (all seven required
keys present and valid). The adapter writes; `audit_log` records the write
with the memory-sink flag (per MEM-08).

### Example B — valid brief with cross-document evidence

The brief compiler (Phase 5) writes a compiled brief into the briefs subtree
of the sink. The `type` is `brief`; `evidence` cites multiple source `DocId`s.

**Target `DocId`:**

```
obsidian-fs://atlas/_memory/_briefs/2026-04-14-atlas-q2-review.md
```

**`Document.properties` payload:**

```json
{
  "source":        { "type": "string",   "value": "agent" },
  "confidence":    { "type": "string",   "value": "inferred" },
  "evidence":      {
    "type": "array",
    "value": [
      "obsidian-fs://atlas/projects/Atlas-1.md",
      "obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md",
      "obsidian-fs://atlas/decisions/2026-03-12-pivot-to-warehouse.md"
    ]
  },
  "status":        { "type": "string",   "value": "active" },
  "observed_at":   { "type": "datetime", "value": "2026-04-14T18:30:00Z" },
  "superseded_by": { "type": "doc_id",   "value": null },
  "type":          { "type": "string",   "value": "brief" }
}
```

**Validator decision:** Guard B passes, Guard A passes. The brief is written
with its `compiled_from` and `source_hashes` (the brief-specific keys from
ADR-003 §Chunk-level source_hashes) sitting alongside the seven required
provenance keys.

### Example C — rejected write missing `observed_at`

The agent attempts to record an observation but forgets the `observed_at`
property. The write reaches `DeliveryAdapter.write()`.

**Target `DocId`:**

```
obsidian-fs://atlas/_memory/observations/2026-04-15-alice-prefers-async.md
```

**`Document.properties` payload (missing key bolded — `observed_at` absent):**

```json
{
  "source":        { "type": "string", "value": "agent" },
  "confidence":    { "type": "string", "value": "inferred" },
  "evidence":      { "type": "array",  "value": [] },
  "status":        { "type": "string", "value": "active" },
  "superseded_by": { "type": "doc_id", "value": null },
  "type":          { "type": "string", "value": "observation" }
}
```

**Validator decision:**

- Guard B: passes (target resolves into the sink).
- Guard A: iterates the seven required keys. `observed_at` is missing. The
  validator returns:

```json
{ "ok": false, "reason": "missing_provenance", "key": "observed_at" }
```

No filesystem operation runs; no `audit_log` entry is written; the calling
tool propagates the structured error to its MCP response. The agent SHOULD
retry the write with the missing property populated.

### Example D — rejected `source: agent` write outside any sink

The agent attempts to write into the user's notes (no `_memory/` prefix).

**Target `DocId`:**

```
obsidian-fs://atlas/projects/Atlas-1.md
```

**`Document.properties` payload (all seven keys present and valid):**

```json
{
  "source":        { "type": "string",   "value": "agent" },
  "confidence":    { "type": "string",   "value": "direct" },
  "evidence":      { "type": "array",    "value": [] },
  "status":        { "type": "string",   "value": "active" },
  "observed_at":   { "type": "datetime", "value": "2026-04-15T10:23:00Z" },
  "superseded_by": { "type": "doc_id",   "value": null },
  "type":          { "type": "string",   "value": "note" }
}
```

**Validator decision:**

- Guard B runs first. The target `DocId` does not resolve into any configured
  `MemorySink`. The validator returns:

```json
{
  "ok": false,
  "reason": "agent_write_outside_sink",
  "doc_id": "obsidian-fs://atlas/projects/Atlas-1.md"
}
```

Guard A is never evaluated. The user's note is untouched. The agent has been
prevented from silently editing a user-authored document — the safety
invariant the contract exists to enforce.

## See also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — layer model; the Memory Contract is
  the L2 (memory) layer's write-side spec.
- [ADR-003: Document shape and PropertyBag](./adr/003-document-shape.md) —
  defines `Document.properties` and the typed-cell PropertyBag this contract
  is expressed against.
- [ADR-004: Memory sink handles](./adr/004-memory-sink-handles.md) — defines
  the `MemorySink` resolution layer, the `.memory-sink` sentinel file, and
  the `obsidian-fs://_memory/` handle syntax that Guard B consults.
- [AGENT_AGNOSTIC.md](./AGENT_AGNOSTIC.md) — the MCP-canonical client
  interface that surfaces the structured errors above to any MCP-aware agent.
