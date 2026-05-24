# How-To 02 — The news desk that stopped citing last quarter as current

**Principle:** Authority and staleness are retrieval-ranking inputs,
not metadata badges (ADR-021).
**Domain:** News / editorial research.
**One-sentence takeaway:** When the contract declares how fresh an
instance must be to *count*, the search layer stops handing your
agent a confidently wrong answer from six months ago.

---

## Meet the *Tagespost* business desk

The business desk at *Tagespost* runs a research assistant agent for
its three reporters. The agent pulls together background briefs
before a reporter calls a source: company revenue trajectory, recent
exec changes, last analyst call, regulatory exposure. The agent has
access to the desk's vault — five years of clipped earnings reports,
analyst notes, exec biographies, regulatory filings.

Reporter Lina is preparing to interview the new CFO of a freight
company at 14:00 today. She asks the agent for a one-page
backgrounder.

**The job:** the brief must be **current**. A backgrounder that
cites last March's revenue as "their current run rate" is worse than
no brief — it embarrasses Lina mid-interview when the CFO corrects
her.

---

## The naive stack

A retrieval-only agent treats every chunk in the vault as
co-equal. Cosine similarity is blind to time.

```
Agent: search_hybrid("Hagedorn AG revenue trajectory")
       → top 5 chunks
       → chunk #1 is from a beautifully-written analyst note dated
         2025-09. Its language is crisp. Cosine loves it.
       → drafts brief citing $1.2bn run rate.
```

What actually happened: the company put out preliminary Q4 numbers
in March 2026 showing $1.6bn. The September chunk is *better
written* — more vivid language, more quote-worthy — so the embedding
model prefers it. The agent had no way to know the September chunk
was stale.

Lina goes into the interview citing $1.2bn. The CFO says "where did
you get that number?" Lina apologizes for the next ten minutes.

---

## The vault-memory way

The *Tagespost* desk's `company-snapshot` contract:

```yaml
name: company-snapshot
description: One quarter's worth of company state — used by briefing agents
required: [company, period, run_rate, exec_team, last_filing_date]

lifecycle:
  fresh_for: 90d                    # a snapshot stops being "current" after a quarter
  superseded_by:
    field: company                  # a newer snapshot for the same company supersedes the older one

provenance:
  allowed_writers: [editor, agent:filings-importer]   # not just any agent
```

Two things are now *executable*:

1. **`fresh_for: 90d`.** An instance authored more than 90 days ago
   carries a `staleness_factor: 0.5` in any `hybridSearch`
   `scoreBreakdown`.
2. **`superseded_by: { field: company }`.** When a fresh
   `company-snapshot` for "Hagedorn AG" is written, every prior
   `company-snapshot` for "Hagedorn AG" is marked `superseded_by:
   <new doc_id>` at write time.

### Lina's brief request

```jsonc
search_hybrid({ query: "Hagedorn AG revenue trajectory" })
```

What now happens, per ADR-021's bias stage:

| Candidate | base_score | staleness_factor | superseded | final_score |
|---|---|---|---|---|
| 2025-09 analyst note | 0.81 | **0.5** (>90d old) | false | 0.405 |
| 2026-03 preliminary Q4 snapshot | 0.79 | 1.0 | false | 0.79 |
| 2024-11 retrospective | 0.74 | 0.5 | **true** (superseded) | **filtered** |

The 2026-03 snapshot wins by a wide margin. The 2024-11 retrospective
doesn't appear at all (filtered by the default `include_superseded:
false`). The 2025-09 note still appears — but down-ranked, and the
`scoreBreakdown.staleness_factor: 0.5` is visible to the agent,
which mentions in the brief that "the most current snapshot is from
March 2026; older context follows."

Lina walks into the interview with **$1.6bn run rate**. The CFO
nods. The conversation moves on.

### When stale is what you want

Lina's colleague Jonas is writing a retrospective piece — *"how did
the freight industry's narrative shift from 2024 to now?"*. He
explicitly wants the stale data:

```jsonc
search_hybrid({
  query: "freight industry growth narrative",
  include_stale: true,         // full weight to old snapshots
  include_superseded: true,     // include the retired ones too
})
```

Same retrieval surface, different *intent*, surfaced via opt-in
flags. The staleness machinery does not block the use case where
"historical" is the point. It just stops being the **default**.

---

## What the principle bought you

> A `lifecycle.fresh_for: 90d` clause in a contract is not a
> metadata badge that the user might or might not see. It is a
> ranking input that biases the search layer *before* the agent
> reads results.

Without this, the staleness signal is something the agent has to
notice on its own. Agents do not notice. They draft the brief from
the top result and confidently call it current. ADR-021 moves the
signal from *human-must-notice* to *search-must-respect* — which is
where it belongs.

For the load-bearing decision, see
[ADR-021 — Authority and staleness as retrieval-ranking inputs](../v2/adr/021-authority-staleness-ranking.md).
