# ADR-024 — Contracts MUST declare failure modes

**Status:** Proposed
**Date:** 2026-05-21
**Phase:** post-v2.0.0 (v2.x extension; schema-only change to ADR-006 ContractFileSchema)
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-004 (Memory Sink Handles), ADR-006 (Task Contract DSL), ADR-020 (Contract as first-class type).

---

## Context

ADR-006 defines what a *good* contract instance looks like: every
required input present, every assembly step typed, every write target a
MemorySink. The Zod schema rejects malformed instances at the
DeliveryAdapter chokepoint.

What ADR-006 does not address: **what should happen when an agent
*cannot* produce a good instance because the source is thin or
ambiguous?**

Concrete case. A `discovery-call` contract requires `next_step: text`.
The agent has a 90-second Plaud recording that ended with "alright,
talk soon." There is no next step in the source. Three failure modes
the contract currently leaves to the agent's improvisation:

1. **Hallucinate.** The agent invents a plausible-sounding next step
   ("send follow-up email Tuesday"). The write succeeds the Zod check.
   The contract has just become a more confident hallucination
   surface.
2. **Fail silently.** The agent gives up and writes nothing. The user
   has no record that the call happened.
3. **Refuse.** The agent returns an error. The user is forced to do
   the data entry themselves.

None of these are good. Option (1) is the worst — it pollutes the
knowledge layer with confident untruths. Option (3) is also bad — the
contract becomes a barrier to capture rather than an enabler.

The missing third option: **partial capture with explicit gaps**.
Write the call record with the fields the source supports, mark the
missing ones with a typed "unresolved" sentinel, and flag the instance
for human review. The instance enters the corpus; the contract's
shape is preserved; the gap is honest.

The principle: **a contract must declare its failure modes, not just
its happy path.** Otherwise agents will hallucinate to satisfy the
shape, and the knowledge layer degrades faster than a search layer
would.

---

## Decision

Extend the ADR-006 `ContractFileSchema` with a top-level
`failure_modes` block declaring per-field behavior when the agent
cannot extract a value from the source. The contract is invalid
without it for any field whose absence would be ambiguous.

### Schema extension

```yaml
failure_modes:
  - field: next_step
    on_unresolved: mark_unresolved        # default; instance carries `unresolved.next_step: true`
  - field: company
    on_unresolved: refuse                  # instantiation fails — company is required for the instance to mean anything
  - field: objections
    on_unresolved: skip                    # field stays absent; no flag; semantically optional
  - field: stage
    on_unresolved: default
    default_value: "intro"                 # used only with on_unresolved: default
```

`on_unresolved` enum:

| Value | Semantics |
|---|---|
| `mark_unresolved` | Instance is written; `properties.unresolved` array gains the field name; the instance carries `properties.review_required: true`. Default for required fields without a more specific declaration. |
| `refuse` | Instantiation fails with `{ok: false, reason: "unresolvable_required_field", field, hint}`. Nothing is written. |
| `skip` | Field stays absent. No flag. For genuinely optional fields where absence ≠ a problem. |
| `default` | Field is set to `default_value`. The instance carries `properties.defaulted` array. |

### The contract-side default

A contract author MUST specify `failure_modes` for every required
field. The Zod schema enforces this:

```typescript
// In ContractFileSchema
.refine((contract) => {
  const requiredFields = contract.required ?? [];
  const declaredFailureFields = new Set((contract.failure_modes ?? []).map(f => f.field));
  return requiredFields.every(f => declaredFailureFields.has(f));
}, { message: "every required field must declare a failure_modes entry" })
```

Phase 6 contracts ship today without `failure_modes`. The migration:
v2.x adds `failure_modes` as optional initially with a deprecation
warning ("contract X has required fields without failure_modes; this
will become an error in v2.next"). v2.next promotes it to required.
Backwards-compatibility carries through one minor version per repo
policy.

### The instance-side surface

When `on_unresolved: mark_unresolved` fires, the written instance
carries:

```yaml
---
kind: discovery-call
authored_by: agent:plaud-followup
source: obsidian://my-vault/Recordings/plaud-abc123
unresolved:
  - next_step
review_required: true
---
```

ADR-021's authority/staleness ranking incorporates
`review_required: true` as a flag on `scoreBreakdown.review_warning`.
The instance is not down-ranked — it is *visible* with its gap.

A separate MCP tool, `list_review_required({vault?, kind?, limit?})`,
enumerates instances whose gaps need human attention. This becomes the
user's "agent inbox" — the documents the agent wrote but flagged.

### The orchestrator chokepoint

`instantiate_contract` (ADR-006) is the enforcement site. The
orchestrator receives the agent-filled inputs. For each required field
NOT present in inputs:

1. Look up its `failure_modes` entry.
2. `refuse` → return error envelope; do not write.
3. `mark_unresolved` → continue write; add field to
   `properties.unresolved`; set `properties.review_required: true`.
4. `default` → fill with `default_value`; add field to
   `properties.defaulted`.
5. `skip` → continue write without the field.

The agent never makes this decision. The contract author made it once,
at authoring time, and the orchestrator enforces it. This is the same
"no agent agency over invariant" pattern as MemorySink (ADR-004) and
the closed verb enum (ADR-006 C-1).

### What this is NOT

This ADR does **not** define a generic "validation severity" scheme.
It defines exactly four behaviors for exactly the case of *required
fields the agent could not extract from source*. Other failure cases
(verb timeout, peer-MCP unavailable, write-back failed) keep their
ADR-006 error envelope.

This ADR does **not** mandate human review tooling. It surfaces the
`review_required` flag; the user's plugin / IDE / agent stack
implements the review surface.

---

## Invariants

| ID | Statement | Enforced by |
|---|---|---|
| C-24-1 | Every required field in a contract MUST have a `failure_modes` entry. | Zod `.refine` on `ContractFileSchema` at load time. |
| C-24-2 | The orchestrator NEVER hallucinates a value on the agent's behalf. Missing required fields trigger one of `refuse`, `mark_unresolved`, `default`, or `skip` — never "agent please retry with a guess". | `instantiate_contract` orchestrator code; no LLM call in the missing-field branch. |
| C-24-3 | `on_unresolved: default` carries a `default_value`; the orchestrator does not invent defaults. | Zod schema requires `default_value` when `on_unresolved === 'default'`. |
| C-24-4 | An instance written via `mark_unresolved` carries both `properties.unresolved: string[]` AND `properties.review_required: true`. They are written atomically with the rest of the instance. | Write transaction sets both fields in a single SQLite write. |
| C-24-5 | `list_review_required` returns instances ordered by `authored_at DESC` and includes the `unresolved` field list per row. | Tool implementation; eval covers row shape. |

---

## Examples

### Discovery call with no captured next step

Contract:

```yaml
name: discovery-call
required: [company, participants, next_step]
failure_modes:
  - field: company
    on_unresolved: refuse
  - field: participants
    on_unresolved: refuse
  - field: next_step
    on_unresolved: mark_unresolved
```

Agent runs the contract against a Plaud recording that has clear
company and participants but no agreed next step.

```jsonc
instantiate_contract({
  name: "discovery-call",
  inputs: {
    company: "obsidian://my-vault/Companies/acme.md",
    participants: ["obsidian://my-vault/People/alice.md"],
    // next_step omitted — agent could not extract
  }
})

// → write succeeds
// → instance frontmatter:
//     unresolved: [next_step]
//     review_required: true
```

The user sees the instance in their `list_review_required` results
next morning, opens it, types the actual next step they recall, and
clears the flag.

### Company missing → refuse

```jsonc
instantiate_contract({
  name: "discovery-call",
  inputs: {
    participants: ["obsidian://my-vault/People/alice.md"],
    // company omitted, contract declares on_unresolved: refuse
  }
})

// → {ok: false, reason: "unresolvable_required_field", field: "company",
//    hint: "discovery-call requires a company; nothing was written"}
```

Nothing in the vault. The agent surfaces the error to the user. The
user clarifies which company; the agent re-runs.

### Optional `objections` absent → skip

`objections` is not in the `required` array. Its `failure_modes` entry
is `on_unresolved: skip`. The instance is written without the field.
No flag. This is the *good* case — the contract author thought about
it and said "absence is fine here."

---

## Consequences

**Positive.**

- Eliminates the dominant hallucination-into-shape failure mode.
  Agents cannot satisfy a contract by inventing values; the contract
  declares what happens when extraction fails.
- The `review_required` flag turns the corpus into a self-auditing
  knowledge layer. The user's inbox is the set of instances flagged
  by contracts, not a separate workflow.
- Contract authoring becomes more honest. The canvas editor
  (ADR-007) prompts for `failure_modes` per required field; the
  author has to think about what happens when the source is thin.

**Negative.**

- Contract YAML grows. A simple contract with 5 required fields gains
  ~25 lines. Mitigated by canvas authoring (typed forms in the
  inspector, not hand-written YAML).
- Migration noise. Existing contracts emit deprecation warnings until
  they declare `failure_modes`. One minor version of pain.
- The `mark_unresolved` path can produce a vault with many
  `review_required: true` instances if the agent is sloppy. The
  signal is the right kind of signal — it surfaces sloppy agents
  rather than hiding their output.

**Neutral.**

- Tool budget rises by 1 (`list_review_required`). To 41 total
  including ADR-020. Phase 8 REL-08 reconciliation will revisit.

---

## Open follow-ups

- **Cross-field failure rules.** A failure rule that depends on
  multiple fields ("if `stage = qual` and `next_step` is unresolved,
  refuse; otherwise mark_unresolved"). Useful but adds DSL complexity.
  Defer until usage data warrants.
- **Agent-side guidance from `failure_modes`.** When the agent
  receives `describe_contract`, the rendered markdown summary should
  enumerate the `failure_modes` block prominently — so a model
  reading the contract context-side knows it is allowed to omit
  fields and which behavior to expect. Lands with the next iteration
  of ADR-006's `describe_contract` template.
- **Failure-mode telemetry.** A `contract_audit kind:
  'unresolved_field'` row per instance written under `mark_unresolved`
  lets the user see which contracts produce the most gaps and which
  agents are worst at extraction. Lands v2.1.

---

## References

- ADR-004 — MemorySink chokepoint pattern; same shape of
  "no agent agency over invariant" applies here.
- ADR-006 — Task Contract DSL; `ContractFileSchema` and
  `instantiate_contract` orchestrator are the extension points.
- ADR-020 — Contract as first-class type; the `validate_against_contract`
  tool naturally surfaces unresolved fields in its issue list.
- ADR-021 — Authority and staleness as ranking inputs;
  `review_required` is a sibling signal on `scoreBreakdown`.
- ADR-007 — Contract Editor; the canvas inspector prompts for
  `failure_modes` per required field.
