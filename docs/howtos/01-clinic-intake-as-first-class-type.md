# How-To 01 — A clinic intake form is not "a note"

**Principle:** Contracts are a first-class persisted type (ADR-020).
**Domain:** Healthcare practice / clinic intake.
**One-sentence takeaway:** When the *shape* of your work is a typed
object in the knowledge layer, the questions you can ask it stop
being "what notes match this query" and start being "which instances
satisfy this predicate."

---

## Meet Dr. Brigitte

Dr. Brigitte runs a small naturopathic clinic. She sees 12 patients
a week. After every consultation she dictates a short intake note
into Plaud — chief complaint, current medications, three relevant
findings, the next-appointment plan. She has been doing this for
eight years. She has 4,800 intake notes.

**Her job to be done:** *"Pull every patient I have ever seen for
migraines whose current medication list includes a beta-blocker, so
I can offer them the new study slot."*

---

## The naive stack

Brigitte's competing tool is "ChatGPT with Custom Connector to my
Google Drive folder."

```
Brigitte: "find every migraine patient on a beta-blocker"
Agent:   semantic search → 38 chunks across 22 notes
         → reads top 10
         → "I found 4 patients but I'm not sure about 2 others — would
            you like me to keep reading?"
```

What actually happened: the search returned text that *mentions*
migraines and *mentions* beta-blockers. It does not know that
"migraine" is a `chief_complaint` field or that "metoprolol" is a
`current_medication.name` field. It has no notion of structural
predicate. It also can't tell the difference between "patient was
prescribed a beta-blocker" and "patient asked about beta-blockers."

Brigitte ends up scrolling Google Drive search results manually.
The agent has produced an article, not an answer.

---

## The vault-memory way

Brigitte's clinic uses vault-memory with the canvas editor. Two
years ago her assistant Mark drew a `clinic-intake` contract:

```yaml
name: clinic-intake
description: One consultation visit
required: [patient, chief_complaint, current_medications, plan]
sources:
  recording: { handle: "obsidian-fs://clinic/Recordings/" }
sinks:
  intake_sink: { handle: "obsidian-fs://clinic/_memory/Intakes/" }

inputs:
  patient:              { $ref: "#/types/DocId" }
  chief_complaint:      { type: string, enum: [migraine, joint_pain, fatigue, gi, sleep, anxiety, other] }
  current_medications:
    type: array
    items:
      type: object
      properties:
        name:    { type: string }
        class:   { type: string, enum: [beta_blocker, ssri, ace_inhibitor, nsaid, antihistamine, other] }
        dose:    { type: string }
  findings:             { type: array, items: { type: string } }
  plan:                 { type: string }
  next_visit:           { type: string, format: date }

write_back:
  sink: "{{intake_sink}}"
  kind: clinic-intake
```

Note: `current_medications.class` is an **enum**, not free text.
Brigitte's assistant looks up the class from a small lookup table at
write time. The contract makes that lookup *required*.

When Brigitte dictates her Plaud note, the plaud-followup agent
calls `instantiate_contract({name: "clinic-intake", ...})`. The
instance lands at `_memory/Intakes/2026-05-21-fischer-helga.md` with
typed frontmatter.

### Brigitte's question becomes a typed query

```jsonc
// Step 1: structural predicate via queryFrontmatter
queryFrontmatter({
  where: {
    kind: "clinic-intake",
    chief_complaint: "migraine",
    "current_medications.class": "beta_blocker"   // matches if any list item has class=beta_blocker
  }
})
// → 17 instance DocIds, deterministic, in 40 ms.
```

```jsonc
// Step 2: confirm she really wants all 17 (ADR-020 list verb)
list_contracts({ owner: "brigitte" })
// → confirms `clinic-intake` is the governing contract she expects
```

Brigitte has 17 candidates by the time her coffee finishes brewing.
She did not write a single prompt that contained the word "migraine."

### The non-obvious second-order benefit

Two months later Brigitte's assistant ships a corrected version of
the contract — she realized `current_medications.class` was missing
`statin`. ADR-020's `validate_against_contract` is a query, so the
clinic runs it as part of weekly hygiene:

```jsonc
validate_against_contract({ contract_name: "clinic-intake", limit: 4800 })
// → 11 historical instances flagged: medications recorded as
//    `class: other` whose `name` matches a known statin.
```

Brigitte fixes the 11 records. Her corpus self-audits as the
contract evolves.

---

## What the principle bought you

> The clinic-intake is **not a note Brigitte happens to write in a
> consistent style.** It is a typed object the knowledge layer
> understands, queries, and validates.

The "agent with vector search" stack treats the corpus as text.
vault-memory treats it as *instances of contracts*. Once you can
ask *"which instances satisfy this predicate?"* you stop fighting
the tool and start asking real questions of your own data.

For the load-bearing decision, see
[ADR-020 — Contract as a first-class persisted type](../v2/adr/020-contract-as-first-class-type.md).
