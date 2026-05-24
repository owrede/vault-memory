# Agentic Knowledge Layer — Business Shapes, Contracts, and what they buy you

**Status:** Conceptual reference (non-normative)
**Date:** 2026-05-21
**Audience:** Implementors and users orienting to v2 vault-memory.
**Companion:** [`MEMORY_CONTRACT.md`](./MEMORY_CONTRACT.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), and ADRs 006 / 007 / 020–024.

This document captures the design philosophy behind v2 in narrative form.
It distills public framing from Nate B Jones on agentic knowledge layers
(notably [the "Agentic Knowledge Layer" talk](https://www.youtube.com/watch?v=lqiwQiDglGk))
and grounds it in vault-memory's concrete file shapes. Where it interprets
rather than cites him verbatim, the interpretation is marked.

The ADRs are the normative source for any specific decision. This document
exists so a new contributor can read one file and understand *why* the ADRs
are shaped the way they are.

---

## 1. Business Shapes

A **Business Shape** is the recurring structural pattern a piece of work takes
in your organization. Not the content — the shape.

It is the answer to: *"When someone in this company does X, what does the
artifact always look like?"*

Examples:

- A **customer discovery call** has a shape: participants, company, stage,
  pains surfaced, objections, next step, owner.
- A **competitive teardown** has a shape: competitor, segment overlap,
  pricing posture, three differentiators, our counter-positioning.
- A **weekly status update** has a shape: shipped, in flight, blocked, asks,
  risk delta.

Shapes are *latent* in your notes today. Every PM writes status updates the
same way, but the structure lives in their head, not in the file. Plain
semantic search can find "status updates," but it cannot *operate on them
as objects* because the shape was never declared.

Key point: **shapes are organizational, not universal.** Your "discovery
call" shape is not Salesforce's. The knowledge layer must let you *declare
your own shapes* — it must not impose a CRM schema on you.

---

## 2. Contracts

A **Contract** is the machine-readable, executable declaration of a Business
Shape. It is the bridge from *"we all know what a discovery call looks like"*
to *"an agent can produce one, validate one, and reason over the set of
them."*

A contract has roughly four parts:

1. **Identity** — what is this thing called, who owns it, what triggers
   an instance.
2. **Shape** — required and optional fields, their types, their
   vocabularies (enums, allowed tags, references to other shapes).
3. **Provenance & authority** — where instances live, who or what is
   allowed to write them, what counts as a valid source.
4. **Lifecycle** — when an instance is "fresh," when it is "stale," what
   supersedes it, what counts as "done."

The crucial property: **a contract is discoverable by agents.** Any
MCP-aware agent can ask *"what contracts exist in this workspace?"* and get
back enough to instantiate one correctly, without the user re-explaining
the shape in a prompt every time.

This is what moves vault-memory from *retrieval substrate* to *knowledge
layer*: retrieval gives you matching text; contracts give you **typed
objects with rules**.

The DSL itself is locked by [ADR-006](./adr/006-task-contract-dsl.md);
the visual authoring surface by [ADR-007](./adr/007-contract-editor.md).
This document is the *why* those two ADRs exist.

---

## 3. Contracts in practice — once the canvas editor exists

The canvas editor (`plugin/src/views/contract-editor/`) is the **authoring
surface** for contracts. Here is the practical end-to-end loop.

### 3a. Authoring a contract on the canvas

A user opens the canvas and composes a `DiscoveryCall` contract from the
palette. Each canvas node is a typed primitive (Field, Enum, Ref,
ProvenanceRule, LifecycleRule). The inspector edits its props.

```text
┌─ DiscoveryCall ──────────────────────────────────┐
│  identity:                                       │
│    name: discovery-call                          │
│    owner: sales-team                             │
│    instances_live_in: Sales/Calls/               │
│                                                  │
│  shape:                                          │
│    company:        ref(Company)        required  │
│    stage:          enum(intro|qual|demo|neg)     │
│    participants:   list(ref(Person))   required  │
│    pains:          list(text)          required  │
│    objections:     list(text)                    │
│    next_step:      text                required  │
│    next_step_due:  date                          │
│                                                  │
│  provenance:                                     │
│    allowed_writers: [user, agent:plaud-followup] │
│    requires_source: ref(Recording) | manual      │
│                                                  │
│  lifecycle:                                      │
│    fresh_for: 14d                                │
│    superseded_by: next DiscoveryCall(company=X)  │
│    done_when: next_step.completed = true         │
└──────────────────────────────────────────────────┘
```

On save, the editor writes a `.contract` JSON file (see ADR-007 §D-FORMAT)
and emits canonical Phase 6 YAML to `_contracts/discovery-call.yaml`.
vault-memory indexes the YAML like any other note — except its
`properties.kind = "contract"` makes it special.

### 3b. Registering the contract

vault-memory's `describe_contract` and `instantiate_contract` MCP tools
(ADR-006 §"Dual MCP surface") expose the contract to any client. An agent
can call `describe_contract({name: "discovery-call"})` and receive the
JSON Schema for `inputs`, the list of `sources`, the list of `sinks`,
the `assembly` plan, and the `write_back` target.

### 3c. Instantiating a contract

A user finishes a Plaud call and runs `/plaud-followup`, asking the agent
to "file this as a DiscoveryCall." The agent:

1. Calls `contracts.get("discovery-call")` to retrieve the schema.
2. Pulls the Plaud transcript and AI summary.
3. Fills the contract — extracts `company`, `participants`, `pains`,
   `next_step` — *to the contract's schema, not to its own invented
   shape*.
4. Writes the instance via `writeNote` into the MemorySink labeled
   `Sales/Calls/2026-05-21-acme-discovery.md`, with frontmatter
   `kind: discovery-call`, `contract_version: 1`,
   `source: obsidian://vault/Recordings/plaud-abc123`,
   `authored_by: agent:plaud-followup`.
5. The validator at the DeliveryAdapter layer (ADR-004) rejects the write
   if required fields are missing or the agent tries to write outside the
   contract's `instances_live_in` path.

### 3d. Querying the contract corpus

*"Show me every open `DiscoveryCall` in `qual` stage with `next_step_due`
overdue"* becomes a typed query, not a fuzzy search. The existing
`queryFrontmatter` tool already handles the predicate; the contract makes
the predicate **well-typed and shared across agents**.

### 3e. Evolving the contract

The contract file is versioned in git like any note. When the shape
changes, old instances either auto-migrate (additive change) or get
flagged stale by the lifecycle rule. The eval harness from Phase 0 can
run regression tests: *"do all 47 historical DiscoveryCall instances
still validate against contract v2?"*

---

## 4. Why this is a *Knowledge Layer*, not just better search

| Plain semantic search | Contract-driven knowledge layer |
|---|---|
| Returns text that is *similar to* the query | Returns **objects that satisfy a typed predicate** |
| Agent re-discovers shape every run (the "85% problem") | Agent loads the contract once, operates on instances |
| User must phrase the question right | User asks a question of the *shape* — "all overdue follow-ups" |
| No notion of "is this still true?" | Lifecycle + authority give freshness and trust signals |
| Two agents produce two incompatible outputs from the same call | Both agents emit the same shape — interoperable |
| No safety boundary on agent writes | MemorySink + contract validator = silent-write safety invariant |
| Knowledge stays in the user's head | Knowledge is *externalized and executable* |

Concretely, the user gains:

- **Compositionality.** A `WeeklyStatusUpdate` contract can `ref(DiscoveryCall)`
  instances from the past 7 days. The brief layer (Phase 6) becomes
  *"compile a contract instance from contract instances"* — a typed
  dataflow, not a prompt soup.
- **Cross-agent interoperability.** plaud-followup, Claude Code, and a
  ChatGPT connector all read the same `discovery-call` contract. No agent
  *owns* the shape.
- **Auditability.** Every instance carries `authored_by` and `source`.
  *"Which agent wrote this, from what source, when?"* — the provenance
  required for trust.
- **Staleness as a first-class signal.** "Fresh for 14d" is not a comment,
  it is a query the retrieval layer applies *before* ranking. Agents stop
  confidently citing a 9-month-old strategy doc.
- **The compiled-brief play.** Because contracts are typed, briefs are
  pre-compiled deterministically (Phase 6 `compile_brief`) instead of
  rebuilt by re-RAG every session.

---

## 5. Principles the v2 brief did not yet fully grasp

Reading the v2 surface against this framing, five gaps justify the
ADR-020 through ADR-024 series:

### 5a. Contracts as a first-class persisted type (ADR-020)

The v1 surface treats `Document` as canonical and
`properties: Record<string, unknown>` as the universal carrier. That is
right for *instances*. But the contract itself is a different kind of
thing — it is the *schema*, not the data. A contract is to an instance
what a SQL table definition is to a row. ADR-006 lands the loader; ADR-020
elevates `Contract` to a registry-backed peer of `Document`, with its own
`contracts.*` MCP surface beyond the two verbs in ADR-006.

### 5b. Authority and staleness as retrieval inputs (ADR-021)

The v2 brief mentions "authority/staleness signals" in the vision. The
sharper claim: these are not *labels*, they are **ranking inputs that
gate retrieval**. A stale `DiscoveryCall` should not just be marked
stale — it should be down-ranked or filtered by default unless the query
explicitly asks for history. This wires into `hybridSearch`, not on top
of it.

### 5c. Typed cross-contract edges (ADR-022)

vault-memory's graph today is wikilink-based. Contracts introduce a
*typed* edge: `DiscoveryCall.company → Company`. That is a stronger
graph primitive than `[[Acme]]`. ADR-022 decides whether typed refs live
in a separate edge table or as a type annotation in frontmatter. The
decision shapes whether "graph-as-retrieval" can answer
*"all calls with companies in the healthcare segment"* — a two-hop typed
query.

### 5d. Contracts as MCP Resources, not just Tools (ADR-023)

The agent-discovery story in ADR-006 is verb-shaped: an agent calls
`describe_contract({name})` to learn a shape. The richer story exposes
each contract as an MCP **resource URI** (`contract://discovery-call`)
so a model can be handed the schema in context and know how to fill it
without a roundtrip. Verbs are how agents *do* things; resources are how
agents *know* things. Both surfaces matter.

### 5e. Contracts must declare failure modes (ADR-024)

This is the principle absent from most agentic-knowledge writeups,
including Nate's: a contract that only specifies "what a good instance
looks like" produces agents that hallucinate when the source is thin.
A contract should also declare **failure modes** — *"if `next_step`
cannot be extracted, do not invent one; mark `unresolved: true` and
require human review."* Without this, contracts become a more confident
hallucination surface. Pairs naturally with the MemorySink safety
invariant but is not currently explicit.

---

## 6. The non-obvious load-bearing claim

The single load-bearing claim of this whole approach: **a knowledge layer
is not the documents, it is the contracts over the documents.** Documents
are inventory; contracts are the rules that make inventory queryable as
objects.

If vault-memory ships only `Document` and `search_hybrid`, it is a very
good retrieval substrate. If it ships `Contract` as a first-class peer to
`Document`, with provenance, staleness, typed edges, MCP-resource
discovery, and failure modes, it becomes the substrate every other agent
in the user's stack can build on without re-deriving shape.

That is the bet of v2.

---

## References

- [`./MEMORY_CONTRACT.md`](./MEMORY_CONTRACT.md) — operational safety
  invariant the agent-write story rests on.
- [`./ARCHITECTURE.md`](./ARCHITECTURE.md) — layer model.
- [`./adr/006-task-contract-dsl.md`](./adr/006-task-contract-dsl.md) —
  the contract DSL.
- [`./adr/007-contract-editor.md`](./adr/007-contract-editor.md) — the
  visual authoring surface.
- ADRs 020–024 — the five principles above, locked.
- [`../howtos/`](../howtos/) — fictional scenarios each illustrating one
  principle.
- Source talk (interpretation, not verbatim): Nate B Jones,
  *Agentic Knowledge Layer*, https://www.youtube.com/watch?v=lqiwQiDglGk
