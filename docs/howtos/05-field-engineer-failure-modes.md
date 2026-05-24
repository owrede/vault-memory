# How-To 05 — The site-visit log that stopped inventing work orders

**Principle:** Contracts must declare failure modes (ADR-024).
**Domain:** Industrial field service / wind-turbine maintenance.
**One-sentence takeaway:** When the contract declares what to do
about *missing* facts, the agent stops papering over gaps with
plausible-sounding fiction.

---

## Meet Tomáš

Tomáš is a field service technician for a Czech wind-farm operator.
He services 14 turbines across two sites. After each climb he
records a Plaud note from inside the nacelle — what he saw, what he
did, what needs to come back as a work order.

**The job:** every site visit produces a `site-visit-log` that
feeds the next-week work order. If the work order is wrong, the
crew shows up with the wrong parts and the climb is wasted.

---

## The naive stack — and the day it nearly cost a crew climb

Three months ago, before vault-memory, Tomáš used a generic agent
to transcribe and structure his Plaud notes. The contract was
informal — "extract the issues and the recommended actions."

One Tuesday Tomáš climbed turbine T-09 and recorded:

> "Yaw bearing makes a noise I haven't heard before. Hard to
> describe — kind of a click on the second rotation. Might be
> nothing. Want to check the manual before deciding."

The generic agent produced:

```markdown
# Site visit T-09 — 2026-02-18
## Issues
- Yaw bearing emitting clicking noise on second rotation. Likely lubrication failure or bearing race damage.
## Recommended actions
- Replace yaw bearing assembly. Schedule for next maintenance window.
- Order replacement bearing (part #WT-YB-3140) — lead time 6 weeks.
```

The replacement bearing is €38,000 and a four-day shutdown.

Tomáš did not say *"replace the yaw bearing."* He said *"want to
check the manual."* The agent filled the shape — "issues" demands
a diagnosis, "recommended actions" demands a verb — by inventing
both.

His supervisor, reading the structured report at 19:00 from home,
approved the order. Tomáš noticed the next morning. They cancelled
the order with two hours to spare. The bearing was fine — the
click was a frost-related tolerance shift that resolved itself by
the next inspection.

---

## The vault-memory way

Tomáš and his supervisor sat down with the canvas editor and
authored a `site-visit-log` contract. The thing they fought about
for an hour was the `failure_modes` block.

```yaml
name: site-visit-log
required: [turbine_id, technician, date, observations, action_taken, follow_up_needed]

failure_modes:
  - field: turbine_id
    on_unresolved: refuse                # we never write a log without knowing which turbine
  - field: technician
    on_unresolved: refuse                # who climbed?
  - field: date
    on_unresolved: default
    default_value: "{{today}}"           # the recording's date, never invented
  - field: observations
    on_unresolved: mark_unresolved       # we may not have observed anything notable; flag if extraction is thin
  - field: action_taken
    on_unresolved: mark_unresolved       # the technician may have decided to defer; do not invent a verb
  - field: follow_up_needed
    on_unresolved: mark_unresolved       # critical — do NOT invent a work-order recommendation
```

The fight was over `follow_up_needed`. Tomáš wanted `refuse` — *"if
we don't know, don't write."* His supervisor wanted `mark_unresolved`
— *"if we don't write, I don't know there was a visit."*
`mark_unresolved` won. The compromise: the instance is written, but
carries `unresolved: [follow_up_needed]` and `review_required:
true`. Tomáš's supervisor sees it in his morning review queue.

### The same Tuesday, replayed

Tomáš records:

> "Yaw bearing makes a noise I haven't heard before. Hard to
> describe — kind of a click on the second rotation. Might be
> nothing. Want to check the manual before deciding."

The agent runs `instantiate_contract({name: "site-visit-log", ...})`
with what it extracted:

```jsonc
inputs: {
  turbine_id: "T-09",
  technician: "tomas-novak",
  observations: "Yaw bearing clicking on second rotation; novel sound; possibly insignificant.",
  // action_taken — not in source
  // follow_up_needed — not in source
}
```

The orchestrator looks up `failure_modes`:

- `action_taken: mark_unresolved` → write succeeds with `unresolved: [action_taken]`
- `follow_up_needed: mark_unresolved` → write succeeds with `unresolved: [follow_up_needed]`

The instance:

```yaml
---
kind: site-visit-log
turbine_id: T-09
technician: tomas-novak
date: 2026-02-18
observations: Yaw bearing clicking on second rotation; novel sound; possibly insignificant.
unresolved: [action_taken, follow_up_needed]
review_required: true
authored_by: agent:plaud-followup
---
```

Tomáš's supervisor opens the next morning's review queue:

```jsonc
list_review_required({ vault: "wind-ops", kind: "site-visit-log" })
// → [T-09 2026-02-18 — unresolved: action_taken, follow_up_needed]
```

He reads the observations. He calls Tomáš. Tomáš says *"I want
another inspection in two weeks; might be frost."* The supervisor
fills `action_taken: "Deferred — re-inspect 2026-03-04"` and
`follow_up_needed: { type: "re-inspect", date: "2026-03-04" }`,
clears the `review_required` flag, and books the re-inspection.

No €38,000 bearing order. No cancelled crew climb. The decision was
made by the human who could make it, with the right information.

### The signal the failure modes block adds

Six weeks later the supervisor runs:

```jsonc
list_review_required({ vault: "wind-ops", limit: 200 })
// → 47 site-visit-logs flagged across the quarter
```

Of those 47, 38 are `action_taken` unresolved. He notices: the same
technician on the same turbine type produces unresolved
`action_taken` six times in two months. He has a coaching
conversation, not a postmortem about a wasted crew climb.

---

## What the principle bought you

> The dangerous failure mode of an LLM-driven contract is not
> "refuses to answer." It is "fills the shape with plausible
> fiction." `failure_modes` makes that the contract author's
> decision, not the agent's improvisation.

A generic agent stack treats schema validation as binary: either
the instance satisfies the shape or it doesn't. When the source is
thin, the agent's path of least resistance is to invent values that
satisfy the shape. The contract becomes a *more confident*
hallucination surface than free text would have been.

ADR-024 closes that gap. The contract declares, per field, what
happens when extraction fails. The orchestrator enforces it. The
agent has no path to "satisfy the shape by inventing." The user
gets an honest gap — surfaced as `review_required: true` — and the
operator can act on real signal.

For the load-bearing decision, see
[ADR-024 — Contracts MUST declare failure modes](../v2/adr/024-contract-failure-modes.md).
