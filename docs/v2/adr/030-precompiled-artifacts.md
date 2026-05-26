# ADR-030 — Precompiled Artifacts: structured, materialized contract outputs

**Status:** Proposed (concept; strategic bet — see §Positioning)
**Date:** 2026-05-26
**Phase:** v2.x / v3 concept — no implementation in this ADR
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-005 (Brief Compile), ADR-006 (Contracts), ADR-026 (Context-Spec),
ADR-028 (Workflows vs Contracts), ADR-029 (Learning loops). External reference:
Pinecone Nexus "Context Compiler / artifacts" (2026).

---

## Context

Pinecone Nexus introduced **precompiled artifacts**: *"a typed, governed piece of
information constructed for a specific task or outcome."* Concretely, a **schema
pre-filled with normalized data extracted from unstructured sources, built ahead of
query time** and served as-is. Their stated principle:

> *"Don't make the consumer derive structure per query. Pre-shape the data into
> artifacts that already encode the structure consumers care about, and serve those."*

Reported gains vs. agentic RAG: **68% vs 41.3% accuracy, 22.7s vs 37.9s latency,
~7× fewer tokens vs RAG (~80× vs a coding agent).** The driving insight: *"most of an
agent's effort goes into orientation, not reasoning."*

The maintainer observed that vault-memory contracts already lean toward this idea — a
contract is a saved recipe for **things asked often**, which is exactly when
precomputation amortizes. A code-level comparison confirms vault-memory already holds
**three of the four building blocks** Nexus needs:

| Nexus artifact piece | vault-memory today |
|---|---|
| Structure / pattern (schema) | Contract `output_shape` (Zod-validated) — exists |
| Harvest data from unstructured space | The assembly verbs (search / expand / cluster / read) — exists |
| Materialize with provenance | `write_back` → MemorySink with provenance stamp — exists |
| **Freshness when sources change** | **Brief staleness daemon** (`source_hashes` + ChangeFeed) — exists, and is the piece **Pinecone explicitly leaves unsolved** |

The fourth piece — *typed extraction instead of prose compilation, built proactively* —
is the gap this ADR names.

---

## Decision

**Define "Artifact" as a new contract flavor: a typed, materialized, auto-invalidated
structured output — distinct from today's prose brief.** Three properties separate an
Artifact from a Brief:

| | Brief (today) | Artifact (this ADR) |
|---|---|---|
| Output | LLM-compiled **prose** (`compile_brief`) | **Typed structured data** (fields/rows), extracted not narrated |
| Final stage | LLM ladder writes prose | An `extract` stage maps harvested docs → typed fields (LLM optional, schema-bound) |
| When built | On-demand at request time | **Precomputed / materialized** ahead of query as a "structured cache" |
| Freshness | Staleness daemon (exists) | **Same daemon** — the cache self-invalidates when a source changes |

An Artifact stays inside the **safe research lane**: it harvests and materializes into the
MemorySink with provenance. It does **not** act on external systems — that is a Workflow
(ADR-028). An Artifact is the *structured, materialized realization* of the Context-Spec
idea (ADR-026): not "compile a brief," but "pre-shape a typed table consumers care about."

### How it relates to the existing layers

```
ADR-026 Context-Spec   "compose the right context window"
        └── Brief       prose realization (on-demand)        ← exists
        └── Artifact    typed, materialized realization      ← this ADR
                         (precomputed structured cache)
```

### Who defines the schema

Two paths, not mutually exclusive:
1. **Author-defined** (near term) — you declare the artifact's `output_shape` in the
   contract editor. Transparent, inspectable, versioned (vault-memory's bias).
2. **Compiler-discovered** (far term, Nexus-style) — an agent derives the schema from an
   eval set. Powerful, opaque; deferred and explicitly out of scope here.

---

## Positioning: this is a strategic bet, not a present requirement

The strongest case for Artifacts is **not** the personal Obsidian vault (low query
volume — precomputation rarely pays off). It is the maintainer's projected direction:

> vault-memory is built **agnostic by design** (adapter seams for both the content
> source *and* the storage layer, ADR-002) — the architecture already foresees use
> beyond a single notebook. In **Industrial-AI** settings, work is dominated by
> **recurring process optimization**, i.e. **structured, repeated questions** over an
> evolving fact base.

In that frame the economics invert:

| Personal vault | Industrial-AI process |
|---|---|
| Queries sporadic, ad hoc | Queries structured, recurring, process-bound |
| Few iterations | Many iterations over the same fact base |
| Token cost marginal | Token cost scales with process frequency → Artifacts' ~7× saving compounds |
| Precompute rarely amortizes | Precompute amortizes per repetition |

**The Artifacts × Learning-loop multiplier (the real reason to care):**

```
ADR-029 learning needs MANY cheap iterations to learn from feedback.
   Each iteration re-harvesting full context = slow + token-expensive.
A precomputed Artifact makes each iteration cheap, fast, reproducible.
   → Ralph-loops become practical at all; evaluation gets a STABLE, typed,
     versioned fact base to vary processing against (clean eval methodology).
```

So Artifacts are not merely a speed feature beside the learning system — they are a
**precondition** for the learning system to be practical, and they give evaluation a
reproducible substrate.

**Honest caveat (the bet):** the agnostic architecture and the Industrial-AI use are a
*hypothesis about future deployments*, not today's shipped reality. This ADR is recorded
as a **strategic bet**, not a derived requirement. The bet is well-grounded (Industrial-AI
is the maintainer's stated field) but remains a bet; we should not build the materialization
engine until a concrete recurring-process use case justifies it.

---

## The core tension (and why vault-memory is positioned to win it)

**Precomputation and freshness pull against each other.** The more you precompute, the
faster/cheaper the query — and the more state can silently go stale. In Industrial-AI,
process data changes constantly (orders, inventory, sensors). A precomputed artifact that
silently ages is *more* dangerous in an optimization loop than no artifact at all.

This is exactly the gap Pinecone's writeup leaves open (*"no mechanism for incremental
updates, invalidation, or re-compilation"*). vault-memory already has the answer: the
hash-based staleness daemon auto-invalidates a materialized artifact the moment a source
changes. **The freshness mechanism is the precondition that makes Artifacts defensible
here — not a detail.**

---

## Consequences

**Positive**
- Turns "things asked often" into a typed, cached, self-invalidating structured store —
  the orientation cost is paid once, reused many times.
- Unlocks practical Ralph-loops (ADR-029) and reproducible evaluation.
- Differentiates against Nexus precisely where Nexus is weakest (freshness).

**Negative / risk**
- Building the materialization engine before a concrete recurring-process use case is
  speculative infrastructure (the bet). Guard: don't build until LAG-EPIX-class need is real.
- Typed `extract` stage is genuinely new (today's final stage is prose `compile_brief`);
  needs a schema-bound extractor with honest "field not found" semantics, not hallucinated fills.
- A second output flavor (Brief vs Artifact) adds surface and user-facing concepts; must be
  framed clearly ("prose summary" vs "structured table").

**Neutral**
- Out of scope for v2.0.0 entirely. Recorded now so the contract layer is designed
  artifact-ready (typed output_shape, materialization-friendly write_back, versioning).

## Open questions (for the implementation ADR, not now)

1. **Extraction semantics** — schema-bound extraction with explicit nulls + provenance per
   field; how to avoid hallucinated fills when a field has no source evidence.
2. **Materialization trigger** — proactive on schedule, on first request, or on a declared
   "warm this artifact" signal? Where does the structured cache live (sink? a typed store?).
3. **Partial invalidation** — when one source changes, recompute only affected fields/rows,
   not the whole artifact (finer-grained than today's whole-brief staleness).
4. **Forward link to optimizers** — Industrial-AI optimization often needs *deterministic*
   selection (e.g. Hungarian method) to reduce thousands of scenarios to a human-reviewable
   3–12, distinct from LLM/Ralph-loop selection. Where such optimizers attach (likely a
   Workflow-layer quality gate, possibly a separate system / vault-memory 4.0) is a separate
   concern — flagged here only because Artifacts are the natural *input* such optimizers
   would consume. Tracked separately; NOT decided in this ADR.
