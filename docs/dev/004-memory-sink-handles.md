# ADR-004: Memory Sink Handles

**Status:** Proposed — Phase 0 foundation
**Date:** 2026-05-14
**Scope:** Phase 2 (memory namespace & provenance contract), Phase 6 (briefs),
Phase 7 (contracts)
**Depends on:** ADR-001 (Document Identity), ADR-002 (Seams), ADR-003 (Document
Shape)
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
