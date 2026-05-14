---
title: Memory Sink Handles
status: Accepted
phase: 0
tags: memory, memory-sink, provenance, sentinel-file, folder-default, separate-vault
depends-on: ADR-001, ADR-002, ADR-003
---

# ADR-004: Memory Sink Handles

**Status:** Accepted — Phase 0 foundation
**Date:** 2026-05-14
**Scope:** Phase 2 (memory namespace & provenance contract), Phase 6 (briefs),
Phase 7 (contracts)
**Depends on:** ADR-001 (Document Identity), ADR-002 (Seams), ADR-003 (Document
Shape)
**Related:** [`docs/v2/MEMORY_CONTRACT.md`](../MEMORY_CONTRACT.md) — the
operational, validator-level expression of the safety invariant this ADR
establishes.
**Supersedes:** —
**Superseded by:** —

## Context

Phase 2 introduces the **memory namespace** as the safety invariant for agent
write-back: agent-authored documents go to a labeled location with mandatory
provenance properties; user notes never receive agent writes silently.

In v2 the memory namespace defaults to a folder (`_memory/`) inside an Obsidian
vault. In v3 the namespace might be:

- A separate Obsidian vault dedicated to agent memory.
- A Notion database with an enforced schema.
- A multi-sink fan-out (write briefs to Obsidian, write status updates to
  Notion).

Phase 6 (compiled briefs) and Phase 7 (task contracts) both reference the
memory namespace by name. If those phases hardcode a folder concept, v3
becomes a rewrite of Phases 6–7. The abstraction must come in **before**
Phase 2.

## Decision

A **`MemorySink`** is a handle — a URI per ADR-001/002 — that resolves through
the adapter registry to a `DeliveryAdapter` plus a routing payload.

```
<delivery-scheme>://<authority>/<sink-resource>
```

### Examples

```
# v2 — Obsidian filesystem, folder inside the vault (the default)
obsidian-fs://my-vault/_memory

# v2 — Obsidian filesystem, separate dedicated vault
obsidian-fs://agent-memory/

# v3 (does not ship in v2) — Notion database
notion-api://acme/databases/agent-memory

# v3 — multiple sinks for different content types
obsidian-fs://my-vault/_memory/observations
obsidian-fs://my-vault/_memory/briefs
notion-api://acme/databases/status-updates
```

### Config

```toml
[[vaults]]
name = "my-vault"
path = "/Users/me/Documents/Obsidian Vaults/My Vault"

[[memory_sinks]]
name = "default"                            # how contracts/tools reference it
handle = "obsidian-fs://my-vault/_memory"
default = true                              # used when no sink is specified
contract = "default-memory-v1"              # named property contract

[[memory_sinks]]
name = "briefs"
handle = "obsidian-fs://my-vault/_memory/_briefs"
contract = "brief-memory-v1"

# v3 sketch — does not ship in v2:
# [[memory_sinks]]
# name = "team-memory"
# handle = "notion-api://acme/databases/agent-memory"
# contract = "default-memory-v1"
```

**Multiple sinks per server.** A user can configure several. Each has a
unique `name` (the user-facing reference) and a unique `handle` (the
adapter-resolvable URI). Exactly one is marked `default = true`.

### Resolution

`src/adapters/registry.ts` resolves a `MemorySink` handle to a
`DeliveryAdapter` instance plus a parsed routing payload (folder, database
ID, etc.). The resolution is the **only** place that knows what the URI's
resource part means. Phase 2's tools call the registry; the tools never see a
folder path.

```typescript
interface MemorySink {
  readonly name: string;
  readonly handle: SinkHandle;
  readonly contract: MemoryContract;
  readonly default: boolean;
  readonly adapter: DeliveryAdapter;       // resolved by registry
}

interface Registry {
  // (additive to the methods in ADR-002)
  listMemorySinks(): MemorySink[];
  resolveMemorySink(nameOrHandle: string): MemorySink;
  getDefaultMemorySink(): MemorySink;
}
```

### MemoryContract — the property rules

Each sink has a **`MemoryContract`**: the property keys that documents written
to this sink must carry, plus optional validation rules. Contracts are
declared in code or in a `_contracts/memory/<name>.yaml` file (Phase 2
deliverable):

```yaml
# default-memory-v1
name: default-memory-v1
required_properties:
  source: { type: string, allowed: [agent, user, imported] }
  confidence: { type: string, allowed: [observed, inferred, user-confirmed] }
  status: { type: string, allowed: [active, superseded, rejected], default: active }
  observed-at: { type: date }
  evidence:
    type: array
    items: { type: reference }
    min_length: 0
optional_properties:
  superseded-by: { type: reference }
  expires-at: { type: date }
naming:
  strategy: date-slug
  pattern: "{observed-at:YYYY-MM-DD}-{slug}.md"
```

The `DeliveryAdapter.write()` for a memory sink applies the contract before
persisting. Violations are rejected with a structured error. Phase 2's
`record_observation` tool prefills required properties from arguments;
unprovided required properties are an error.

### Naming strategies

```yaml
naming:
  strategy: caller-provided                  # caller passes the path/title
  # OR
  strategy: date-slug
  pattern: "{observed-at:YYYY-MM-DD}-{slug}.md"
  # OR
  strategy: adapter-assigned                 # delivery adapter picks an ID (notion)
```

For `obsidian-fs` the strategy is typically `date-slug` (memory documents get
predictable filenames). For `notion-api`, the strategy is `adapter-assigned`
because Notion gives the page ID on creation.

### Write-guard logic

Phase 2 guards the existing `write_note` / `update_frontmatter` /
`delete_note` tools:

```
Guard A: If the target DocId resolves into a configured memory sink,
         REJECT — caller must use record_observation / supersede / etc.

Guard B: If the caller passes `source: agent` in properties,
         AND the target DocId does NOT resolve into a configured memory sink,
         REJECT.
```

Guard A keeps human-authoring tools from accidentally writing into the memory
namespace without the contract validation. Guard B keeps agent provenance from
leaking into user notes. Both guards consult the registry.

### Hard-isolation question (open in v2)

Should the default memory sink be:

1. A **folder inside the user's vault** (`obsidian-fs://my-vault/_memory`), or
2. A **separate vault** (`obsidian-fs://agent-memory/`)?

This ADR is **neutral on the default**. The handle shape supports both;
the registry resolves either. Recommendation for the Phase 2 implementation:

- Default to a folder for ease of installation — the user does not need to
  set up a second vault.
- Document "use a separate vault" as the recommended production deployment in
  `MEMORY_CONTRACT.md`, with the rationale (hard isolation; user can sync
  agent memory separately; user can wipe agent memory without touching their
  notes).
- The `add-vault` skill could grow a `--memory-vault` flag that creates a
  paired memory vault and points `[[memory_sinks]].default` at it.

This is a recommendation, not a binding decision. The Phase 2 implementer can
choose either default and document the trade-off; the abstraction does not
care.

### Read paths

Memory sinks are also readable. `recall({query, sink?})` consults one sink (if
specified) or every configured memory sink (if not). Reads go through the
`SourceConnector` for the sink's adapter, not directly through the delivery
side. This means every memory sink needs a paired source connector with the
same handle authority — naturally satisfied by `obsidian-fs` (one adapter
plays both roles) and by `notion-api` in v3.

The MCP tool `list_sinks` (new in Phase 2) returns every configured sink with
its handle, contract, and `default` flag, for client discoverability.

### Cross-sink references

Memory documents can reference each other across sinks via `DocId`:

```yaml
# In obsidian-fs://my-vault/_memory/observations/2026-05-14-alice.md
properties:
  source: agent
  confidence: inferred
  evidence:
    - notion-api://acme/page/abc-123       # cross-source link works
    - obsidian-fs://my-vault/people/Alice.md
```

The graph table stores these edges with full URIs. Phase 5 (`expand`,
`cluster`) walks them transparently. In v2 (single source type) this is
exercised only between two obsidian-fs handles; in v3 it works across schemes.

## Amendment — Folder-default is the only code path

The original `## Decision` section above (drafted before this amendment) left
the choice of folder-default vs separate-vault open as a "Phase 2 implementer
decision" in the *Hard-isolation question* subsection. **This amendment closes
that question.**

The folder-default `MemorySink` — a `_memory/` folder inside an existing
Obsidian vault — is the **ONLY code path in v2**. Routing a memory sink to a
separate Obsidian vault is achieved purely through `config.toml`: **no code branch** distinguishes folder-inside-vault from separate-dedicated-vault. The
handle parser in `src/adapters/registry.ts` resolves both forms uniformly:
both are `obsidian-fs://<authority>/<sink-resource>` URIs and both go through
the same `DeliveryAdapter` instance.

The user-facing differentiation lives in the `[memory]` and `[[memory_sinks]]`
config blocks (illustrated in `### Config examples` below): the user picks
which folder, or which dedicated vault, by editing TOML — not by selecting a
different code path. This is a tightening of the original handle abstraction,
not a redesign: the URI shape `obsidian-fs://<authority>/<resource>` always
supported both forms; this amendment commits to the *implementation* having
exactly one code path for them.

**Rationale.** The handle abstraction already provides isolation through the
URI scheme + authority. A separate code branch for "separate vault" would
duplicate the resolution logic and create two places to keep in sync. By
making the separation a config-only concern, we get:

1. A single code path to test (Phase 2 ADP-13 conformance — see ADR-002).
2. Zero-cost migration from folder-default to separate-vault: edit
   `config.toml`, no rebuild, no migration step.
3. A natural extension point for v3 connectors: a `notion-api://` sink is
   resolved by the same registry call, with the same handle shape — see the
   Examples section for the parallel `notion-api://` worked example.

### Sentinel file — `.memory-sink`

Any folder used as a memory sink **MUST** contain a `.memory-sink` file at its
root. The handle parser refuses to resolve a `MemorySink` against a folder
that lacks the sentinel.

- **Purpose.** Defense in depth against accidental memory-sink misconfiguration
  ("I deleted the `_memory/` folder; my next agent write created a top-level
  `_memory/observations/...md` in my regular vault root, polluting my notes").
  The sentinel is a positive marker: only folders explicitly opted in receive
  agent writes.
- **Content.** The sentinel file is informational only (timestamp of sink
  creation + the sink's configured `name` for human readability); its
  *presence* is the gate. The parser does not validate sentinel contents.
- **Provisioning.** Server startup creates the sentinel automatically the
  first time a configured sink resolves successfully and the target folder
  exists but lacks the sentinel — provided the folder is empty or contains
  only files matching the contract's expected document shape. If the folder
  has unrelated user notes, startup aborts with a structured error rather
  than silently labeling user data as a memory sink.
- **Sync hygiene.** The sentinel is checked into Obsidian's sync mechanism
  (whatever the user uses — Git, Obsidian Sync, iCloud, Syncthing) so other
  machines recognize the same folder as a sink without re-provisioning.

### Config examples

Both examples below use the same code path. The only difference is the TOML
shape — folder inside a vault vs a dedicated second vault.

**(a) Folder-default — the recommended starting configuration.**

```toml
# config.toml — folder-default
[[vaults]]
name = "my-vault"
path = "/Users/me/Documents/Obsidian Vaults/My Vault"

[[memory_sinks]]
name = "default"
handle = "obsidian-fs://my-vault/_memory"
default = true
contract = "default-memory-v1"

[memory]
# The agent-tool surface (record_observation, supersede, recall) refers to
# memory by the named sink. `sink = "@default"` is the implicit value when
# no sink is specified by the caller.
sink = "@default"
```

`obsidian-fs://my-vault/_memory` resolves to `<my-vault path>/_memory/`. The
sentinel lives at `<my-vault path>/_memory/.memory-sink`. Agent writes from
Phase 2's `record_observation` tool land at
`<my-vault path>/_memory/observations/<date>-<slug>.md`. User write tools
(`write_note`, `update_frontmatter`, `delete_note`) refuse target paths
under `<my-vault path>/_memory/` (Guard A); they also refuse `source: agent`
writes anywhere outside this folder (Guard B). See `### Write-guard logic`
inside `## Decision` for the guard text.

**(b) Separate-vault — recommended production deployment.**

```toml
# config.toml — separate-vault (config-only difference; same code path)
[[vaults]]
name = "my-vault"
path = "/Users/me/Documents/Obsidian Vaults/My Vault"

[[vaults]]
name = "agent-memory"
path = "/Users/me/Documents/Obsidian Vaults/Agent Memory"

[[memory_sinks]]
name = "default"
handle = "obsidian-fs://agent-memory/"
default = true
contract = "default-memory-v1"

[memory]
sink = "@default"
```

`obsidian-fs://agent-memory/` resolves through the same handle parser as the
folder-default case — the parser sees `agent-memory` as just another
`<authority>` in `obsidian-fs://<authority>/<resource>` (per ADR-001's
URI-opaque identity rule). The trailing `/` (empty resource) means the entire
second vault is the sink. The sentinel lives at the vault root:
`<agent-memory path>/.memory-sink`. From the code's perspective there is no
distinction: `registry.resolveMemorySink("@default")` returns a
`DeliveryAdapter` configured for vault `agent-memory`, and writes land at
`<agent-memory path>/observations/<date>-<slug>.md`.

The user-visible benefit (hard isolation; separately syncable; wipeable
without touching user notes) is real, but it is achieved through TOML, not
through a code branch. The `add-vault` skill grows a `--memory-vault` flag
(Phase 2 enhancement) that creates the second vault and writes the
`[[memory_sinks]]` stanza for the user — pure config code-gen.

## Consequences

### Positive

- Phase 2 tools accept `sink: string` (a sink name or handle). Default
  resolution removes ceremony for the common case.
- Phase 6 briefs write through `DeliveryAdapter` for the brief sink — no
  filesystem code in `src/briefs/`.
- Phase 7 contracts reference sinks by name. The same contract works whether
  the named sink resolves to a folder, a vault, or a Notion database.
- v3 adds new sinks via config; no code change to Phases 2/6/7.
- "Separate vault for memory" is a config change, not a code path.

### Negative / costs

- The user-facing surface gains a new concept (memory sinks). The default
  configuration (one sink, folder inside the vault) is invisible to users who
  don't care; advanced users get the flexibility.
- The registry must be initialized before any tool runs. Server startup grows
  a config-validation pass that resolves every configured sink's adapter and
  contract; failures abort startup with clear errors.
- Two adapters playing the same role (a source + delivery for one handle) is
  the common case; the registry must ensure they share state where it matters
  (the obsidian-fs source and delivery for one vault should share file
  locking, hash caches, etc.).

### Open follow-ups

- **Sink contracts as code vs as YAML.** Phase 2 ships the contract types and
  one default-memory contract. We could load contracts purely from YAML
  files in `_contracts/memory/`, or define them in code and let users
  override. Recommendation: define in code with a YAML-override layer. To
  finalize in Phase 2.
- **Schema-enforced sinks (Notion databases).** A Notion database can enforce
  its own property schema. The MemoryContract's properties must be a subset
  of the database's schema, or writes will fail at the API layer. Phase 10
  adds a startup check that compares contract requirements against connector
  capabilities.
- **Deletion semantics.** When a memory document is "deleted", do we hard-
  delete or soft-delete (set `status: rejected`)? Recommendation: soft-delete
  by default (`supersede` and `reject` both set status flags; the document
  stays in the sink). Hard-delete is a separate, explicit operation. Phase 2
  ADR amendment.

## Alternatives considered

### (a) Hardcode `_memory/` as a folder name

Rejected. Phases 6 and 7 would then encode the folder assumption, and v3
becomes a rewrite.

### (b) Tools take a path string with no abstraction

Rejected. The validation and write-guard logic ends up scattered across every
tool that touches memory. Discoverability suffers — there's no `list_sinks`
to ask "what memory namespaces exist?"

### (c) Make MemorySink an MCP resource type

Considered. MCP has a `resources` concept distinct from `tools`. We could
expose sinks as MCP resources with their own URI scheme.

Partially adopted: `list_sinks` is an MCP **tool** in v2 for symmetry with
the rest of vault-memory's surface. Exposing sinks as MCP **resources** as
well is a future option — additive, no API break — if MCP clients evolve
to consume `resources` more richly.

### (d) Single global memory sink

Rejected. Users will want to separate observation memory from compiled
briefs, and from status updates, and from per-project memory. The cost of
supporting multiple sinks at the abstraction level is negligible once the
handle resolution exists.

### (e) Sinks as first-class MCP servers (chain MCP-through-MCP)

Considered for v3. A "memory sink" could itself be an MCP server with
write/read tools, and vault-memory would just be a client. Rejected as the
v2 internal architecture — too much overhead for in-process operations. The
external interface (tools that take sink handles) is compatible with that
internal restructure if it ever matters; this ADR does not foreclose it.

## Invariants

These are the normative statements Phase 9's adversarial review will grep for
(`^- \*\*M-[1-9]\*\*:`). They are MUST/MUST-NOT statements about the memory
sink subsystem; any implementation that violates one of them is non-conformant
and the relevant phase deliverable must be reworked.

- **M-1**: A MemorySink handle MUST follow ADR-001 URI syntax
  (`<scheme>://<authority>/<resource>`). The handle parser in
  `src/adapters/registry.ts` is the ONLY resolver of sink-as-path; no other
  module MUST interpret a sink handle as a filesystem path or a Notion
  database ID directly.
- **M-2**: The folder-default and separate-vault forms differ ONLY in
  `config.toml`. No source code MUST branch on which form is in use. A
  unit test in Phase 2 enforces this by exercising the same
  `DeliveryAdapter.write()` code path through both config shapes and
  asserting bytewise-equal call graphs.
- **M-3**: A `.memory-sink` sentinel file MUST be present at the sink-folder
  root before any agent write resolves to that folder. The handle parser MUST
  refuse to resolve against a folder lacking the sentinel and MUST return a
  structured error rather than creating the sentinel implicitly when the
  folder contains pre-existing user content.
- **M-4**: All agent writes to a MemorySink MUST route through
  `DeliveryAdapter.write()` (per ADR-002's single-chokepoint invariant).
  Bypass paths — direct `fs.writeFile`, `vault.queries.upsertNote`, raw SQL
  inserts into the notes table — are FORBIDDEN for `source: agent` documents.
  Phase 2 enforces this with a static lint (CI grep) and a runtime audit log.
- **M-5**: User-facing write tools (`write_note`, `update_frontmatter`,
  `delete_note`) MUST refuse to target a path that resolves into any
  configured MemorySink (Guard A) AND MUST refuse `source: agent` property
  writes outside any configured sink (Guard B). The two guards together
  preserve the memory-namespace safety invariant from both directions:
  agents cannot write to user notes, and users cannot accidentally write
  agent-provenance content to non-sink locations.

## Examples

The two worked examples below demonstrate the property M-2 enshrines: the
same `DeliveryAdapter.write()` call site, configured by two different TOML
shapes (one in v2 with `obsidian-fs://`, one in v3 with `notion-api://`),
resolves through the same registry and produces analogous outputs without
any code-level differentiation.

### Example A — Folder-default worked example (v2, ships)

**Config**

```toml
[[vaults]]
name = "my-vault"
path = "/Users/me/Documents/Obsidian Vaults/My Vault"

[[memory_sinks]]
name = "default"
handle = "obsidian-fs://my-vault/_memory"
default = true
contract = "default-memory-v1"

[memory]
sink = "@default"
```

**Sentinel**

```
/Users/me/Documents/Obsidian Vaults/My Vault/_memory/.memory-sink
```

(Contents: `created_at: 2026-05-14T10:00:00Z\nsink_name: default\n`. Presence
is the gate; content is informational.)

**Resolution**

```typescript
const sink = registry.resolveMemorySink("@default");
// → MemorySink {
//     name: "default",
//     handle: "obsidian-fs://my-vault/_memory",
//     adapter: <ObsidianFsDeliveryAdapter for "my-vault">,
//     contract: <MemoryContract "default-memory-v1">,
//     default: true,
//   }
```

**Write call (Phase 2 `record_observation` tool)**

```typescript
await sink.adapter.write({
  sink,
  doc: {
    id: "obsidian-fs://my-vault/_memory/observations/2026-05-14-alice.md",
    properties: {
      source: "agent",
      confidence: "observed",
      status: "active",
      "observed-at": "2026-05-14",
      evidence: ["obsidian-fs://my-vault/people/Alice.md"],
    },
    blocks: [
      { type: "paragraph", text: "Alice confirmed the Q3 deadline shift." },
    ],
  },
});
```

**On-disk result**

```
/Users/me/Documents/Obsidian Vaults/My Vault/_memory/observations/2026-05-14-alice.md
```

```yaml
---
source: agent
confidence: observed
status: active
observed-at: 2026-05-14
evidence:
  - obsidian-fs://my-vault/people/Alice.md
---

Alice confirmed the Q3 deadline shift.
```

User-write tools refuse this path (Guard A); the agent-write path validates
required properties (the `default-memory-v1` contract) before writing
(Guard B's converse — agent writes require a configured sink).

### Example B — Parallel `notion-api://` worked example (v3 sketch, same code path)

This example does not ship in v2. It demonstrates M-2: the v3 Notion sink is
introduced by adding a `[[memory_sinks]]` block with a `notion-api://` handle
and a `NotionDeliveryAdapter` registration — **no change** to the
`record_observation` tool, the registry's `resolveMemorySink` signature, or
the call site shown in Example A.

**Config**

```toml
[[memory_sinks]]
name = "team-memory"
handle = "notion-api://acme/databases/agent-memory"
default = false
contract = "default-memory-v1"

[memory]
sink = "@default"  # still points at the obsidian-fs default
```

(The Notion sink is added alongside, not as a replacement. The `[memory]`
block's `sink = "@default"` still routes implicit writes to the v2
obsidian-fs sink; explicit `sink: "@team-memory"` arguments route to Notion.)

**Resolution (same parser, different adapter)**

```typescript
const sink = registry.resolveMemorySink("@team-memory");
// → MemorySink {
//     name: "team-memory",
//     handle: "notion-api://acme/databases/agent-memory",
//     adapter: <NotionDeliveryAdapter for workspace "acme">,
//     contract: <MemoryContract "default-memory-v1">,
//     default: false,
//   }
```

**Write call — bytewise-identical shape to Example A**

```typescript
await sink.adapter.write({
  sink,
  doc: {
    id: "notion-api://acme/page/<assigned-on-create>",
    properties: {
      source: "agent",
      confidence: "observed",
      status: "active",
      "observed-at": "2026-05-14",
      evidence: ["obsidian-fs://my-vault/people/Alice.md"],
    },
    blocks: [
      { type: "paragraph", text: "Alice confirmed the Q3 deadline shift." },
    ],
  },
});
```

**Result** — a new Notion page in the `agent-memory` database with the
contract's required properties as typed Notion properties, the block text as
Notion blocks, and a cross-source `evidence` reference pointing into the
obsidian-fs vault. The Notion adapter assigns the page ID
(`naming.strategy: adapter-assigned`); the rest of the call is identical.

**Source-neutrality conclusion.** Adding the v3 Notion sink required: (1) a
`[[memory_sinks]]` config block, (2) a `NotionDeliveryAdapter` implementation
behind the existing `DeliveryAdapter` interface (ADR-002), (3) a registry
registration. It required **zero** changes to: the handle parser, the
`record_observation` tool, the `MemoryContract` validator, the user-facing
write-guard logic, or the `Document` shape. This is the property M-2
enshrines — and is the reason ADR-004 commits the folder-vs-separate-vault
distinction to config.
