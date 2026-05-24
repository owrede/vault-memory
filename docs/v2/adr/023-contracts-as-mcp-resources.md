# ADR-023 — Contracts as MCP Resources, not just Tools

**Status:** Proposed
**Date:** 2026-05-21
**Phase:** post-v2.0.0 (v2.x extension; complements ADR-006 verb surface)
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-006 (Task Contract DSL), ADR-020 (Contract as first-class type).

---

## Context

ADR-006 exposes contracts to MCP-aware agents via two verbs:
`describe_contract({name})` and `instantiate_contract({name, inputs})`.
ADR-006 D-A1 explicitly chose Tools over MCP Prompts for ChatGPT Custom
Connector compatibility.

The verb surface answers *"how does the agent invoke a contract?"*. It
does not answer *"how does the agent know a contract is available
without making a tool call?"*. The current discovery flow is:

```
agent: list_tools()  → sees instantiate_contract, describe_contract
agent: describe_contract({name: "discovery-call"})   ← round trip
agent: instantiate_contract({name: "discovery-call", inputs: {...}})
```

That works. It also costs a tool round trip per contract the agent
wants to consider, and it forces the agent to *know to ask* for
`discovery-call` by name. There is no surface that says *"these N
contracts exist, here are their shapes, in your context."*

MCP has a second primitive for exactly this: **Resources.** A resource
is a URI an MCP host can list, subscribe to, and embed in a model's
context. The MCP SDK 1.29 surface (already used by ADR-007 for
`vault-memory://contracts/reloaded` notifications) supports it.

The principle: **verbs are how agents *do* things; resources are how
agents *know* things.** Both surfaces matter. A contract is both a
callable verb (instantiate it) AND a piece of knowledge (this is the
shape). Exposing only the verb under-uses the protocol.

---

## Decision

Expose each loaded contract as an MCP Resource at
`contract://<vault>/<name>`, additive to the verb surface from ADR-006.

### Resource shape

Each contract becomes a resource entry returned by `resources/list`:

```jsonc
{
  uri: "contract://my-vault/discovery-call",
  name: "discovery-call",
  description: "Customer discovery call follow-up contract",
  mimeType: "application/vnd.vault-memory.contract+json"
}
```

`resources/read` on the URI returns the contract record from the
ADR-020 `contracts` table, serialized as JSON, plus the rendered
markdown summary inline:

```jsonc
{
  uri: "contract://my-vault/discovery-call",
  mimeType: "application/vnd.vault-memory.contract+json",
  text: "<JSON document>",
  // ... plus a sibling markdown resource for human/LLM readability
}
```

A companion resource at
`contract://my-vault/discovery-call?format=summary` returns the
markdown summary alone, mimeType `text/markdown` — the same content
`describe_contract` produces. This lets an MCP host that prefers
markdown over JSON embed the summary in context cheaply.

### Resource list scope

`resources/list` returns every `load_status = 'loaded'` contract from
the ADR-020 `contracts` table, across all vaults. The vault appears in
the URI authority position; no separate per-vault list endpoint is
needed.

### Subscriptions

The plugin (ADR-007) and any MCP host MAY subscribe to resource
changes via the MCP SDK's `resources/subscribe`. The change feed is
the same one ADR-006 ChangeFeed dispatch already uses; emission is a
`notifications/resources/updated` per URI when a contract is
loaded/updated/removed. ADR-006's `notifications/tools/list_changed`
fires independently when `auto_register_tools = true`; both
notifications may fire on the same contract change.

### What this is NOT

This ADR is **not** a replacement for `describe_contract` or
`instantiate_contract`. The verbs stay. Three reasons:

1. **Custom Connector compatibility.** ChatGPT Custom Connectors expose
   Tools, not Resources (ADR-006 D-A1 rationale). The verb surface
   remains the lowest-common-denominator entry point.
2. **Side-effect-free guarantee.** Resources are read-only by MCP
   spec. `instantiate_contract` writes; it cannot be a resource.
3. **Composability with ADR-006's auto-register.** A contract that
   surfaces as a top-level tool (`vm_discovery_call` under
   `auto_register_tools = true`) ALSO surfaces as a resource. Both
   surfaces are additive.

### Resource granularity

One resource per contract. Not one resource per *field*; that pushes
the resource list past anything useful. The full JSON shape lives in
the resource body; an MCP host can parse and present subfields.

`contract://<vault>/<name>` is canonical. `contract://<vault>` (vault
root) is reserved for a future v2.x release to expose the
*resource collection* — a listing of all contracts in the vault. Not
shipped in this ADR to keep the surface minimal.

---

## Invariants

| ID | Statement | Enforced by |
|---|---|---|
| C-23-1 | Resource URIs are read-only. No mutation MCP verb operates on a `contract://` URI. | `src/contracts/resources.ts` exposes only read handlers; mutation lives in `instantiate_contract` and the plugin's `.contract` write path. |
| C-23-2 | The resource body is sourced from the ADR-020 `contracts` table, never from the on-disk YAML directly. | Resource handlers import only `registry-db.ts`; no `fs` import. |
| C-23-3 | A contract whose `load_status != 'loaded'` does NOT appear in `resources/list`. | `WHERE load_status = 'loaded'` predicate in the list query. |
| C-23-4 | Resource update notifications fire on the same trigger as ADR-006 ChangeFeed dispatch; no second watcher. | `notifications/resources/updated` emitted from the existing loader hook. |
| C-23-5 | The verb surface (`describe_contract`, `instantiate_contract`) and the resource surface return semantically equivalent contract data. | Snapshot test: serialize both, assert deepEqual on the core fields (`inputs`, `sources`, `sinks`, `assembly`, `write_back`, `output_shape`). |

---

## Examples

### MCP host lists available contracts at session start

```jsonc
// host → vault-memory
resources/list

// response
{
  "resources": [
    { "uri": "contract://my-vault/discovery-call", "name": "discovery-call", "mimeType": "application/vnd.vault-memory.contract+json", "description": "Customer discovery call follow-up contract" },
    { "uri": "contract://my-vault/deal-review",    "name": "deal-review",    "mimeType": "application/vnd.vault-memory.contract+json", "description": "Weekly deal-review contract" }
  ]
}
```

The host can attach these resources to the model's context — the model
sees the available contracts without a tool call.

### MCP host embeds the contract summary in context

```jsonc
// host attaches resource to next user turn
resources/read({ uri: "contract://my-vault/discovery-call?format=summary" })

// → returns markdown summary
// → host injects into context as a `<resource uri="..."> ... </resource>` block
```

The model can now answer "what fields does a discovery-call have?"
without an additional roundtrip.

### Plugin observes contract change

```jsonc
// plugin sends
resources/subscribe({ uri: "contract://my-vault/discovery-call" })

// later, when the YAML changes (either via plugin save or external edit):
notifications/resources/updated({ uri: "contract://my-vault/discovery-call" })

// plugin re-fetches and re-renders the canvas
```

---

## Consequences

**Positive.**

- Hosts that support Resources (Claude Desktop, Claude.ai web) get
  context-time contract discovery without spending tool budget.
- The same `contracts` table backs both the verb surface and the
  resource surface — no duplication of source-of-truth.
- ADR-006's `notifications/tools/list_changed` mechanism extends
  naturally to `notifications/resources/updated`; the loader already
  knows when contracts change.

**Negative.**

- More surface area to test (resource list, resource read, subscribe,
  updated). The C-23-5 snapshot test mitigates drift between verb and
  resource representations.
- ChatGPT Custom Connectors will ignore the resource surface (per
  ADR-006 D-A1 they only support Tools). The verb surface remains
  authoritative for those clients. This is a documented asymmetry,
  not a bug.

**Neutral.**

- Tool budget unchanged (resources do not count against the tool
  budget tracked by `evals/v1-baseline/tools-list.snapshot.json`).

---

## Open follow-ups

- **Vault-collection resource.** `contract://my-vault` as a directory
  resource listing all contracts in the vault, mimeType
  `application/vnd.vault-memory.contract-list+json`. Deferred — needs
  host support to be useful; revisit when usage data warrants.
- **Resource-templated instantiation.** A future MCP feature
  (`prompts/` with resource-templates) could let a host present
  "Instantiate discovery-call" as a one-click action with the contract
  schema pre-bound. Watching the MCP spec evolution.
- **Cross-vault resource URI.** `contract:///<name>` (empty authority)
  to address a contract by name across all vaults. Deferred — semantics
  unclear when two vaults define the same contract name.

---

## References

- ADR-006 — Task Contract DSL; the verb surface this ADR complements.
- ADR-020 — Contract as first-class type; the `contracts` table this
  ADR reads from.
- ADR-007 — Contract Editor; the plugin is the first MCP-host
  consumer of the resource surface and the resource-change
  notifications.
- MCP SDK 1.29 `resources/*` API and `notifications/resources/updated`
  shape.
