# ADR-028 — Workflows vs. Contracts: the research/outcome split

**Status:** Proposed (concept)
**Date:** 2026-05-26
**Phase:** v2.x concept — no implementation in this ADR
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-006 (Task Contract DSL), ADR-026 (Contract as Context-Spec),
ADR-023 (Contracts as MCP Resources), ADR-029 (Learning loops), the `use-contracts` skill.

---

## Context

A user trying to "prepare a meeting with Sarah Maihaus" surfaced a conceptual gap
that the current design blurs. Tracing it through the code (ADR-006, Invariant C-1)
confirmed the user's diagnosis exactly:

> *"The 11 baseline verbs are all read-only. Writes happen ONLY via `write_back:`.
> No open `tool:` form … because it would let a contract author smuggle a write tool
> into an assembly block, bypassing the memory-namespace invariant."*

So **a contract is, by construction, a research pipeline — not a workflow.** It
answers *"which information is relevant?"* and deposits a brief into the memory sink.
It deliberately **cannot act**: no email, no note in the user's own vault, no calendar
entry, no external side effect. This is a sound safety decision (the memory invariant
is un-bypassable). But it leaves a hole the user named precisely:

> *"The agent would be well-informed — but it wouldn't know HOW to fulfil a request.
> When I say 'prepare the meeting', I've defined nowhere what a meeting preparation
> should be: just a note? Also an email to the participants?"*

The contract optimizes the **input** (context). Nobody has specified the **outcome**
(what should exist or happen). That outcome currently lives only in the agent's head,
ad hoc — not repeatable, not inspectable, not improvable.

### The editor confusion this explains

The user also correctly diagnosed a UI confusion: offering *other MCP servers*
(GitHub, Gmail, Notion) in the editor's left column only makes sense for a **workflow**
editor — because only a workflow *acts* in external systems. A pure research pipeline
needs no foreign write tools. And in a workflow editor, `vault-memory` would appear as
*one building block among many*, whose function is **"run a contract"** (deliver
optimized research) — i.e. a list of **contracts**, not a list of vault-memory's raw
functions. This ADR ratifies that reading.

---

## Decision

**Name and separate two artifact layers. Keep contracts as the safe research core;
introduce `Workflow` as the outcome layer that composes contracts, agent judgment, and
external actions.**

### The two layers

| | **Contract** (exists today) | **Workflow** (new concept) |
|---|---|---|
| Answers | *Which information is relevant?* | *What should happen / be produced?* |
| Output | A brief in the memory sink | Concrete outcomes: a note in the **user's** vault, an email, a task, a calendar entry |
| Determinism | Fully deterministic | Mixed: deterministic steps + agent-judgment steps |
| Side effects | **None** (sink-write only) | **Yes — that is the point** |
| Safety model | Closed, cannot harm | Requires approval, confirmation, audit |
| Contains | Read-only verbs + one `write_back` | Contract steps + agent steps + **action steps** |

### Nesting: a workflow embeds contracts

```
WORKFLOW "meeting-prep"           ← declares the OUTCOME
  ├─ step 1  research   → vault-memory: run contract "meeting-prep-research"   (safe, closed)
  ├─ step 2  judge      → agent: read brief, decide what matters, draft the prep doc
  ├─ step 3  produce    → vault-memory write_note → a note in the USER's vault (with approval)
  └─ step 4  act        → gmail: send agenda to participants (with approval)
```

Step 1 is today's contract. Steps 2–4 are the missing layer. The contract stays inside
its safe lane; the workflow is the chain that *also* acts.

### What a Workflow spec declares (the outcome surface)

A workflow is the place the user finally answers *"what is a meeting preparation FOR
the agent?"*. Sketch (concept only — schema TBD in implementation):

```yaml
workflow: meeting-prep
goal: "Prepare me to walk into this meeting ready."
questions_to_answer:          # the agent MUST be able to answer these from the context
  - "Who are the participants and what do they want?"
  - "What are the win-win docking points?"
  - "What open questions must I resolve in the room?"
research:                     # delegate to a contract (the safe core)
  contract: meeting-prep-research
  inputs: { meeting_path: "{{trigger.meeting_note}}" }
produces:                     # the OUTCOMES — what should exist when done
  - kind: note
    where: user-vault
    template: meeting-prep-note
    require_approval: true
  - kind: action
    via: "mcp://gmail/send"
    when: user_confirms
    require_approval: true
acceptance:                   # how we know the workflow succeeded (feeds ADR-029)
  - "Prep note exists and answers every question_to_answer."
  - "User did not have to ask a follow-up the brief should have covered."
```

The `questions_to_answer`, `produces`, and `acceptance` blocks are exactly the
"outcome definition" the user is missing today.

### Where the boundary sits (the rule)

- **In the Contract:** everything **repeatable and safety-critical** — which notes, in
  what order, what token budget; writes only to the memory sink.
- **In the Workflow:** everything **outcome-shaped** — what document is produced, what
  action is taken, what questions must be answered, what acceptance means.
- **In the Agent:** everything **judgment-bearing** — confirming choices, drafting prose,
  deciding *whether* to take an action, mirroring the user's language.
- **In the Skill:** the **trigger logic** — "when the user wants X, run workflow Y."
  (Today the `use-contracts` skill only bridges to contracts; a future `run-workflows`
  skill bridges to workflows.)

---

## Quality gates: human, learning loop, AND deterministic optimizer

A workflow step that produces an outcome needs a **gate** before the outcome is
accepted. The maintainer identified that gates are not all the same kind — and crucially
that **not every gate is an LLM choosing.** Three distinct gate types belong in the
workflow layer:

| Gate type | What it is | When it fits | Determinism |
|---|---|---|---|
| **Human-in-the-loop** | A person approves/edits/rejects | Final judgment, irreversible actions | human |
| **Learning loop** (ADR-029) | Feedback accumulates → proposes improvements | Tuning a spec over time | LLM-assisted |
| **Deterministic optimizer** | A mathematical algorithm selects/ranks among many candidates | Choosing among hundreds/thousands of scenarios | **algorithmic, reproducible** |

The third is the one today's design has no place for. In Industrial-AI optimization, a
process can generate **thousands of valid scenarios** (e.g. 32,311 assignment variants).
A human gate cannot choose among 32,311 — and an LLM gate is the wrong tool: the choice is
a well-defined combinatorial optimization (e.g. the **Hungarian method** for assignment),
which is **deterministic, provably optimal, and cheap**, not a judgment call.

The right composition is therefore a **pipeline of gates**:

```
many candidate scenarios (10²–10⁴)
   → deterministic optimizer   reduce to the best 3–12   (algorithmic, reproducible)
      → human-in-the-loop       pick / approve one        (judgment, on a tractable set)
         → learning loop        capture the choice as a signal (ADR-029)
```

The optimizer's job is to make the human gate **tractable**: turn an impossible choice
(thousands) into a reviewable one (a handful). It consumes structured input — which is
exactly what a **precompiled Artifact** (ADR-030) provides: a typed, materialized fact base
is the natural input to an algorithmic optimizer. Artifacts feed optimizers; optimizers
feed humans; humans feed the learning loop.

**Scope note:** these optimizers are *not* part of the memory core. vault-memory's job is
to assemble and materialize context (research + artifacts); the optimizer is a
**workflow-layer quality gate**, a pluggable component the workflow runner invokes. Whether
it ships as a vault-memory module or as a separate system is the architectural fork below.

## Architectural fork: separate the Workflow concern from the Memory concern

The maintainer raised a structural question worth recording as a decision point, not a
decision: **should the Workflow layer (including optimizers and actions) be a separate
system from the Memory core?**

The case **for separation**:
- The memory core has ONE non-negotiable invariant: agent writes only to a labeled sink,
  never to user notes. It is small, safe, auditable. Bolting actions + optimizers + external
  MCP fan-out onto it risks eroding that clarity.
- Workflows *act* (external side effects); the memory core deliberately does not. Different
  safety models, different blast radius, different release cadence.
- Optimizers are a distinct engineering domain (operations research) with their own
  dependencies and testing needs — a poor fit inside a local-first retrieval server.

The case **against (keep unified)**:
- Tight integration is simpler for the user (one install, one editor surface).
- The workflow runner needs deep, low-latency access to contracts/artifacts — a process
  boundary adds friction.

**Recorded position (not yet decided):** the memory core (retrieval, contracts, artifacts,
memory-safety) is the stable foundation. The Workflow layer — outcomes, actions, gates,
**deterministic optimizers** — is a candidate for a **separate system / separate milestone
(provisionally "vault-memory 4.0" or a sibling project)**, consuming the memory core through
its MCP surface like any other client. This keeps the safety-critical core minimal and lets
the action/optimization layer evolve independently. The fork is flagged here so the contract/
artifact layers are not designed in a way that *presumes* an in-process workflow runner.

---

## Consequences

**Positive**
- Resolves the user's "bessere Ergebnisse — da fehlt was": the outcome becomes a
  first-class, inspectable, versioned declaration, not ad-hoc agent improvisation.
- Clarifies the editor: a **contract editor** (research) and a **workflow editor**
  (outcomes + external MCP servers) are different surfaces with different building
  blocks. The left-column MCP servers belong to the workflow editor.
- Preserves the memory-safety invariant untouched: contracts never gain action verbs;
  actions live in the workflow layer where approval + audit apply.

**Negative / risk**
- A genuinely new artifact type is a significant surface (schema, editor, runner,
  approval/audit model). Must be scoped as its own milestone, NOT folded into v2.0.0.
- Action steps cross the memory-safety boundary by design — they need their own,
  explicit safety model (approval gates, dry-run, per-action audit). This is the
  hardest part and must not be hand-waved.
- Two editors risk user confusion if not clearly framed ("research recipe" vs
  "outcome workflow").

**Neutral**
- v2.0.0 ships contracts only (research). Workflows are a v2.x/v3 concept. This ADR
  records the model now so the contract layer is not accidentally bent toward actions
  (which would break ADR-006 C-1).

## Open questions (for the implementation ADR, not now)

1. **Action safety model** — approval gates, dry-run preview, per-action audit rows,
   revocation. How does a workflow request an external write without becoming a
   silent-action risk?
2. **Determinism boundary** — which steps are fixed vs agent-judgment, and how is that
   marked so the runner knows where to pause for the agent / the user?
3. **Reuse** — can a workflow embed multiple contracts? Other workflows?
4. **Relationship to Skills** — is a Workflow a *typed, versioned* Skill, or a distinct
   thing a Skill triggers? (Leaning: distinct — Skills are prose triggers, Workflows are
   inspectable specs.)
5. **Optimizer plug-in contract** — how does the workflow runner invoke a deterministic
   optimizer (Hungarian method, ILP solver, …) as a gate? What is the input/output shape
   (candidate set → ranked top-k), and how does it consume an Artifact (ADR-030) as input?
6. **System boundary** — does the Workflow layer (actions + optimizers + gates) ship inside
   vault-memory or as a separate system consuming the memory core over MCP? (See
   "Architectural fork" above — recorded as undecided; leaning separate to keep the
   safety-critical memory core minimal.)
