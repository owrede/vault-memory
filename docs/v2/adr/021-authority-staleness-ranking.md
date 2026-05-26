# ADR-021 — Authority and staleness as retrieval-ranking inputs

**Status:** Proposed
**Date:** 2026-05-21
**Phase:** post-v2.0.0 (v2.x extension; small additive change to `hybridSearch`)
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-003 (Document shape), ADR-006 (Task Contract DSL), ADR-020 (Contract as first-class type).

---

## Context

The v2 brief lists "authority/staleness signals" as a feature of the
agentic knowledge layer. The current implementation surfaces these as
**properties** on a Document: a contract may declare
`lifecycle.fresh_for: 14d`; an instance may carry `authored_by`,
`source`, and `kind`. These are observable in
`queryFrontmatter` results.

What the brief does *not* yet do: feed those signals into the **ranking**
that `hybridSearch` produces. A stale `discovery-call` from nine months
ago and a fresh one from this morning, on the same company, rank identically
under RRF + cross-encoder rerank — both match the query text equally well.

That is exactly the failure mode that pushes a knowledge layer back into
a search layer. The agent has no signal to prefer the fresh one over the
stale one; it cites the first matching chunk and the user gets a
confidently wrong answer.

The principle: **authority and staleness are not labels on retrieval
results; they are inputs to retrieval ranking.** A contract's
`lifecycle.fresh_for` clause is *executable* — it bounds the validity
window of every instance authored against that contract.

---

## Decision

Extend `hybridSearch` to consume authority and staleness signals as a
first-class ranking input, and to filter by them by default.

### Signal sources

Three signal sources, in increasing strength:

| Signal | Source | Default behavior |
|---|---|---|
| `staleness` | `Document.properties.authored_at` vs the governing contract's `lifecycle.fresh_for` (resolved via `kind` → contract lookup) | Stale results down-ranked by configurable factor; filtered when `fresh_only: true` |
| `authority` | `Document.properties.authored_by` (allowlist per contract `provenance.allowed_writers`) | Out-of-allowlist results flagged in `scoreBreakdown.authority_warning`; not filtered by default |
| `superseded` | `Document.properties.superseded_by` set to another DocId | Filtered by default (returned only with `include_superseded: true`) |

### Ranking integration

`hybridSearch` produces an RRF-fused, optionally reranked, list. The
ranking pipeline gains a final **bias stage**, after rerank and before
return:

```
RRF fusion  →  (optional cross-encoder rerank)  →  bias stage  →  return
```

The bias stage applies:

```typescript
final_score = base_score * staleness_factor * authority_factor
```

- `staleness_factor`: `1.0` when fresh, `config.staleness_penalty` (default
  `0.5`) when past `fresh_for`, `0.0` when filtered.
- `authority_factor`: `1.0` when authored_by ∈ allowed_writers, `1.0` when
  no contract governs the doc, `0.7` when authored_by ∉ allowed_writers
  (still returned, downranked).

The factors are multiplicative because they compose independently: a stale
out-of-authority result is *both* problems.

### Default filters

Default behavior on `hybridSearch`:

- `superseded` documents are **filtered out** unless `include_superseded: true`.
- Stale documents are **down-ranked**, not filtered. To filter, pass
  `fresh_only: true`.
- Out-of-authority documents are **down-ranked**, not filtered.

The default flip is deliberate: stale data is the most common production
failure (cited confidently as fresh). Superseded data is the *most*
egregious failure and gets a hard filter.

### Amendment (2026-05-26) — staleness is a CURATION signal, not a relevance penalty

> Maintainer feedback corrected a conceptual flaw in the original framing above.
> The `staleness_factor = 0.5` down-rank treats an old note as *less relevant*.
> That is wrong in the general case: **an old note is not less important — it may
> simply be incomplete** (newer information exists elsewhere that should be folded
> in). Age is therefore primarily a **quality / curation signal** ("this note may
> need review"), NOT a relevance signal ("rank this lower").

This amendment splits the one overloaded mechanism into two distinct concepts:

| Concept | Question it answers | Effect | Default |
|---|---|---|---|
| **Recency bias** (opt-in) | "For *this query*, is a fresher version more relevant right now?" | Temporary rank nudge within one result set | **off** (weight 0) |
| **Curation staleness** (new) | "Does this note need *maintenance* because newer info likely exists?" | A durable **flag** surfaced to the user, never a relevance penalty | n/a — a signal, not a filter |

Revised rules:

1. **The default `staleness_factor` is `1.0` (no penalty).** Past `fresh_for`, a note
   is NOT down-ranked by default. The `0.5` down-rank becomes strictly opt-in
   (`recency_weight > 0` or an explicit staleness-penalty config), for the narrow
   class of queries where freshness genuinely is relevance ("current status of X").
2. **Past `fresh_for` raises a `needs_review` curation flag**, surfaced in
   `scoreBreakdown.curation` and as a queryable signal — feeding a future
   vault-health / curation surface (and the learning loop in ADR-029). The note stays
   fully findable and equally weighted in ordinary retrieval.
3. **`superseded` is unaffected** — it remains a hard filter (it is a correctness
   signal: the note is explicitly replaced, not merely aged).

Rationale: this aligns with the project principle of *suggesting vault quality control*
rather than silently degrading old-but-valid knowledge. It also turns staleness into a
**learning input** (ADR-029): a note repeatedly surfaced-but-flagged is a candidate for
the curation loop, not a candidate for demotion.

### Score transparency

The `scoreBreakdown` object on each `SearchHit` gains three fields:

```typescript
scoreBreakdown: {
  // existing
  semantic, bm25, rrf, rerank,
  // new
  staleness_factor: number,
  authority_factor: number,
  superseded: boolean,
}
```

so a calling agent can introspect *why* a result was ranked where it was,
and so the eval harness can pin behavior.

### Contract-less documents

A Document whose `kind` does not resolve to a contract has
`staleness_factor = 1.0` and `authority_factor = 1.0` — no bias applied.
This is the safe default: documents not governed by a contract continue
to rank as they do today.

---

## Invariants

| ID | Statement | Enforced by |
|---|---|---|
| C-21-1 | The bias stage runs AFTER rerank — never before. | `src/search/hybrid.ts` pipeline order; unit test asserts call order. |
| C-21-2 | A document whose `kind` has no governing contract MUST receive `staleness_factor = 1.0` and `authority_factor = 1.0`. | Bias resolver returns identity factors on registry miss. |
| C-21-3 | `superseded: true` documents are filtered by default. | `applyBiasStage()` filter pass before final return. |
| C-21-4 | `fresh_only: true` filters stale results AFTER bias multiplication, so deterministic test snapshots remain stable. | Filter is the last step in the pipeline. |
| C-21-5 | The bias stage MUST NOT call into the contract loader; it reads the cached registry state (ADR-020 `contracts` table). | `src/search/bias.ts` imports only `registry-db.ts` read API. |

---

## Examples

### Default search returns fresh results first

```jsonc
search_hybrid({ query: "Acme onboarding pains" })

// Response (ordered by final_score desc)
[
  {
    doc_id: "obsidian://my-vault/Sales/Calls/2026-05-19-acme.md",
    base_score: 0.81,
    scoreBreakdown: { staleness_factor: 1.0, authority_factor: 1.0, superseded: false, /* … */ }
  },
  {
    doc_id: "obsidian://my-vault/Sales/Calls/2025-08-04-acme.md",
    base_score: 0.79,  // semantically very similar
    scoreBreakdown: { staleness_factor: 0.5, authority_factor: 1.0, superseded: false }
    // ↑ authored 9 months ago, contract `discovery-call` says fresh_for: 14d
  }
]
```

The 2025-08 call is still returned, but ranked below the fresh one. The
agent gets the right answer by default.

### Including stale results explicitly

```jsonc
search_hybrid({
  query: "Acme onboarding pains",
  include_stale: true,        // surfaces stale at full weight for historical research
})
```

### Filtering to fresh only

```jsonc
search_hybrid({
  query: "Acme onboarding pains",
  fresh_only: true,            // hard filter — only fresh results returned
})
```

### Authority warning on an out-of-allowlist write

```jsonc
search_hybrid({ query: "Q3 strategy" })

// Response includes a doc authored_by "agent:random-llm" while the
// `strategy-doc` contract allows only [user, agent:strategy-author]
[
  {
    doc_id: "obsidian://my-vault/Strategy/q3.md",
    scoreBreakdown: { authority_factor: 0.7, authority_warning: "authored_by 'agent:random-llm' not in allowed_writers" }
  }
]
```

The result is returned but down-ranked and the warning makes the
authority gap visible to the agent.

---

## Consequences

**Positive.**

- The most common production failure (citing stale data as fresh) is
  mitigated by default, with no API change for existing callers.
- Eval harnesses can pin behavior via `scoreBreakdown` factors — the
  bias stage is testable in isolation.
- Contract authors gain operational leverage from `lifecycle.fresh_for`
  beyond a metadata badge. The clause now *does* something.

**Negative.**

- `hybridSearch` gains one stage and three response fields. Existing
  consumers parsing `SearchHit` will be unaffected (additive), but
  snapshot tests that pin the full `SearchHit` shape will need refresh.
- The bias factors are heuristic. They WILL be wrong for some classes
  of queries. The mitigation is full transparency in `scoreBreakdown` —
  if a query needs different bias, the caller can re-rank the results
  themselves using the raw `base_score` and the documented factors.
- A contract with a too-aggressive `fresh_for` will demote useful
  historical context. Documented in `docs/v2/AGENTIC_KNOWLEDGE_LAYER.md`
  and in the canvas editor inspector hint when authoring the field.

**Neutral.**

- Tool budget unchanged (no new tools; `hybridSearch` extended).

---

## Open follow-ups

- **Tunable factors per vault.** A `[search.bias]` config block lets
  power users tune `staleness_penalty` and `authority_penalty` without
  rebuilding. Default values land in v2.x.
- **Time-decay model.** `staleness_factor` is currently a step function
  (fresh = 1.0, stale = 0.5). A continuous decay
  (`factor = e^(-age / half_life)`) may rank better. Decision deferred to
  v2.1 after eval data accumulates.
- **Contract-declared bias weights.** A contract could declare its own
  `bias_weights: { stale: 0.3 }` to override the vault default. Useful
  for "this kind of doc must NEVER be cited stale" cases. Deferred.

---

## References

- ADR-003 — Document shape; `properties.authored_at`, `properties.kind`,
  `properties.authored_by`, `properties.superseded_by` are the load-bearing
  fields.
- ADR-006 — Task Contract DSL; `lifecycle.fresh_for` and
  `provenance.allowed_writers` are the clauses this ADR makes executable.
- ADR-020 — Contract as first-class type; the bias stage reads the
  `contracts` table to resolve `kind` → contract.
- `src/search/hybrid.ts` — extension point.
