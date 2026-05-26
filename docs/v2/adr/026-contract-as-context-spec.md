# ADR-026 — Contract as Context-Window Spec

**Status:** Proposed
**Date:** 2026-05-26
**Phase:** 9 (contracts-real-laufen; pre-v2.0.0) — concept; full realization is v2.x
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-006 (Task Contract DSL), ADR-005 (Brief Compile Strategy),
ADR-021 (Authority/Staleness Ranking), ADR-023 (Contracts as MCP Resources),
ADR-027 (Verb Output Normalization).

---

## Context

ADR-006 frames a contract as a **retrieval-and-assembly pipeline** that compiles a
brief into the memory sink. That is accurate but undersells what a contract is
*for*. The recurring failure mode this project exists to beat is: *"agents
rediscover 85% of their context every run."* A contract is the user's saved answer
to that — a **repeatable recipe for assembling exactly the right context** for a
recurring activity (meeting prep, project status, person dossier, code review).

Reframed: **a contract is a process specification that, when instantiated, hands an
agent an optimally composed context window for one recurring kind of work.**
`compile_brief` is one concretion (the context, rendered as a brief document). The
general object is *context assembly*.

Today the assembly is implicit and unbudgeted:
- `compile_brief` dedupes and caps `source_doc_ids` (≤ MAX_SOURCES) and reads each
  fully. There is no token budget, no priority ordering, no truncation policy.
- Order of sources is the order the author listed them, not relevance/recency.
- A 2-hop `expand` can pull dozens of notes; the only guard is the source cap.

For "real laufen" (ADR-027) we only need the pipeline to *execute*. For the
contract to be a genuine **context spec**, assembly needs to be a first-class,
declarable, budgeted concern. This ADR sets that direction without expanding
v2.0.0 scope.

---

## Decision

**Adopt "contract as context-window spec" as the conceptual model, and define the
context-assembly contract surface. Implement the minimum in Phase 9; defer the
budgeting engine to a named follow-up.**

### 1. The context-assembly model (declarable, not hardcoded)

A contract MAY declare a `context` block describing how the assembled sources
become a context window:

```yaml
context:
  token_budget: 4000          # hard ceiling for the assembled window
  order: [recency, authority] # ranking signals (see ADR-021); first wins ties
  dedup: doc                  # doc | chunk — collapse repeats
  truncation: tail-drop       # tail-drop | per-source-quota | summarize
  per_source_max_tokens: 800  # optional cap so one note can't dominate
```

Semantics:
- **token_budget** — the assembler stops adding sources once the budget is hit.
- **order** — sources sorted by the named signals before inclusion, so the most
  valuable context survives truncation. Reuses ADR-021 authority/staleness signals.
- **dedup** — the same note reached via multiple hops counts once.
- **truncation** — what happens at the ceiling: drop the tail, give each source a
  quota, or summarize overflow (summarize = LLM-ladder, ADR-005).

When `context` is absent, behavior is exactly today's (`compile_brief` cap + full
read) — **fully backward compatible.**

### 2. Relationship to `compile_brief`

`compile_brief` becomes one consumer of an assembled context. The assembly step
(budget/order/dedup) runs **before** the LLM sees the sources, so the brief is
compiled from a context window that already fits the budget and leads with the
highest-value material. No new verb is required for the MVP — the `context` block
parameterizes the existing `source_doc_ids → compile_brief` path.

### 3. Discovery: the spec IS the process anleitung

Via `describe_contract` (ADR-006) and the contract MCP resource (ADR-023), an agent
reads not just inputs but the **assembly intent**: which sources, in what order,
within what budget. That is the "process spec" an agent follows for a recurring
activity — it knows *what good context looks like* for meeting-prep without
rediscovering it. The `use-contracts` skill already routes agents to prefer a
matching contract over ad-hoc assembly; this ADR gives that routing a richer target.

---

## Scope split (avoid v2.0.0 creep)

**In Phase 9 (pre-v2.0.0):**
- This ADR (the model + the `context` block schema as *documented, optional, parsed*).
- The schema parses and round-trips; an absent block = today's behavior.
- NO budgeting engine yet — declaring `token_budget` is accepted but the enforcing
  assembler is a follow-up. Phase 9 ships the *spec surface*, proven by the
  normalized, real-running contracts (ADR-027).

**Deferred to a named follow-up milestone (v2.x):**
- The context-assembly engine: token counting, ranking integration (ADR-021),
  truncation strategies, summarize-overflow via the LLM ladder.
- Per-source quota enforcement and budget telemetry.

---

## Consequences

**Positive**
- Names the real value: a contract is a context-window spec, not just a brief maker.
- Gives users a place to express "how much / which order / what to drop" — the
  knobs your question called for ("Optionen und Variablen im Contract editieren").
- Editor can later expose the `context` block as a small, high-value form section.

**Negative / risk**
- Declaring a budget that isn't yet enforced is a half-promise — must be documented
  clearly as "parsed, enforcement in v2.x" to avoid misleading authors.
- Ranking-for-assembly overlaps ADR-021; the two must share one signal definition,
  not fork it.

**Neutral**
- The MVP is mostly schema + docs; the heavy engine is honestly deferred, keeping
  the v2.0.0 cut focused on "contracts run and are editable," not "contracts
  budget-optimize context."
