# ADR-029 — Learning loops & the missing quality signals

**Status:** Proposed (concept)
**Date:** 2026-05-26
**Phase:** v2.x concept — no implementation in this ADR
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-006 (Contracts), ADR-021 (Staleness as curation signal — amended),
ADR-026 (Context-Spec), ADR-028 (Workflows vs Contracts), ADR-024 (Failure modes).

---

## Context

The maintainer's requirement: **the system must learn.** When a user complains or makes
a request — *"please also research X next time"*, *"the brief missed the budget angle"* —
that feedback should be **automatically captured and folded back** into the relevant
contract / workflow / note. Every component (contracts, workflows, briefs, notes) should
be subject to continuous quality review and improvement via **Ralph-loops** (autonomous
improve-on-feedback cycles).

A loop can only improve what it can **measure**. A code audit of today's system found the
hard truth:

| Signal that exists today | What it tells us |
|---|---|
| `contract_audit` verb usage (`invocation_count`, `last_seen`) | *How often* a verb ran — frequency, not quality |
| Brief staleness (`source_hashes` changed) | A brief's *sources* changed — freshness, not correctness |
| `staleness` curation flag (ADR-021 amended) | A note *may need review* — age, not a judged defect |

**There is no signal that captures whether a contract, brief, workflow, or note was
actually GOOD.** No acceptance, no rejection, no user correction, no outcome success.
A Ralph-loop today would be flying blind: it can see *that* meeting-prep ran 40 times,
but not that 12 of those produced briefs the user had to correct the same way.

This ADR does the "ralph-loop on the ralph-loops" the maintainer asked for: it identifies
**which components should be looped**, and **which quality signals must be prepared first**
so looping is possible at all.

---

## Decision

**Adopt a layered learning model. Before any autonomous loop, instrument the system with
the missing quality signals. Then attach Ralph-loops to each improvable artifact, gated by
human-in-the-loop approval for anything that changes a user's saved spec.**

### Part 1 — The missing quality signals (instrument FIRST)

Five signal classes, none of which exist today. All are **captured into the memory sink /
audit substrate**, never silently into user notes (memory invariant holds).

| Signal | Captured when | Feeds |
|---|---|---|
| **Acceptance / rejection** | User opens, keeps, edits, or discards a produced brief/note | Contract & workflow quality score |
| **Correction-as-instruction** | User says "also research X" / "you missed Y" / "don't include Z" | Targeted contract/workflow amendment proposal |
| **Outcome success** | A workflow's `acceptance` criteria (ADR-028) verified met / unmet | Workflow quality score |
| **Follow-up gap** | User had to ask a follow-up the brief should have covered | Context-spec (ADR-026) budget/ordering tuning |
| **Curation hit** | A note repeatedly surfaced-but-flagged-stale (ADR-021) | Vault-health / note-review queue |

Critical design point: **capture is structured, not free-text scraping.** A correction
becomes a typed `feedback` record `{target_contract, kind: add|remove|reweight, payload,
evidence, observed_at}` in the sink — inspectable, reversible, attributable. This is the
single biggest missing piece; everything else builds on it.

### Part 2 — What gets looped (the Ralph-loop targets)

| Loopable artifact | The loop's job | Signal it consumes | Autonomy |
|---|---|---|---|
| **Contract (research)** | Propose adding/removing a research step or reweighting context (ADR-026) | acceptance, correction, follow-up gap | **propose → human approves** |
| **Workflow (outcome)** | Propose changing produced artifacts, questions, or actions | outcome success, correction | **propose → human approves** |
| **Brief content** | Recompile when sources changed (EXISTS) or when a correction pattern repeats | staleness (exists) + correction | recompute autonomous; structural change proposed |
| **Notes (curation)** | Surface stale-but-valid notes for the user to refresh | curation hit | **suggest only** — never auto-edit user notes |
| **Verb catalog / signatures** | Detect drift between declared and real (ADR-027 CI gate) | drift gate | autonomous (it's a correctness check) |

**The governing rule for autonomy:** a loop may *act autonomously* only on things vault-memory
owns and that are reversible (recompute a brief, flag a note, fail a CI drift gate). A loop
that would change a **user's saved spec** (a contract, a workflow) or **touch user notes**
must **propose and wait for approval**. This keeps the memory-safety invariant and the
"never silently change the user's vault" principle intact even under autonomous learning.

### Part 3 — The feedback→improvement flow (concept)

```
user signal ("also research X next time")
   → captured as typed feedback record in the sink (Part 1)
      → accumulates against target contract/workflow
         → Ralph-loop reads accumulated feedback, drafts an amendment
            ("add an expand step over X; here's why, here's the evidence")
               → surfaced to user as a reviewable diff
                  → user approves → amendment applied to the contract YAML (versioned)
                  → user rejects  → feedback marked won't-fix, loop learns the boundary
```

The loop never edits the contract silently. It produces a **reviewable proposal** with
evidence (the accumulated signals). This is what makes it trustworthy *and* improvable.

---

## Consequences

**Positive**
- Turns the maintainer's "the system should learn" into a concrete, staged path:
  instrument signals → score artifacts → propose improvements → human-gated apply.
- Reuses existing substrate: the audit table and memory sink already exist; the new work
  is the **typed feedback record** and the scoring/proposal logic.
- The amended staleness signal (ADR-021) becomes a learning input rather than a dead-end
  penalty — the two ADRs reinforce each other.

**Negative / risk**
- **Quality signals are the prerequisite and the hard part.** Without honest acceptance/
  correction capture, the loops optimize noise. This ADR deliberately puts instrumentation
  *before* any loop.
- Autonomous amendment of saved specs is a trust hazard — mitigated by the propose-don't-apply
  rule, but the approval UX must be genuinely good or users will rubber-stamp (a known
  failure mode worth its own design pass).
- Free-text user complaints are ambiguous; turning them into typed feedback records needs an
  interpretation step (likely the agent itself) that can mis-classify — corrections must be
  reversible and attributable so a wrong classification is cheap to undo.

**Neutral**
- Out of scope for v2.0.0 entirely. This is a v2.x/v3 capability. Recording it now ensures
  the contract/workflow/brief artifacts are designed *loop-ready* (versioned, inspectable,
  diff-able) rather than retrofitted.

## Open questions (for implementation, not now)

1. **Feedback interpretation** — who turns "you missed the budget angle" into a typed
   record: the agent at capture time, or a batched classifier? How is mis-classification
   caught?
2. **Scoring** — how do acceptance/correction/outcome signals combine into one comparable
   quality score per contract/workflow without over-indexing on rare loud complaints?
3. **Proposal cadence** — does a loop run on every signal, on a threshold, or on a schedule?
   (Connects to the actual Ralph-loop runner mechanics.)
4. **Versioning & rollback** — contracts/workflows need version history so an applied
   amendment that makes things worse can be reverted, and the loop can learn from the
   reversion.
5. **Privacy** — feedback records may quote user content; they live in the sink under the
   same provenance rules, but the interpretation step must not leak across vaults.
