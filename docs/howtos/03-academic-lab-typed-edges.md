# How-To 03 — The lab notebook that answers two-hop questions

**Principle:** Typed cross-contract edges turn a wikilink graph into
a typed graph (ADR-022).
**Domain:** Academic / wet-lab research group.
**One-sentence takeaway:** When the connection between two documents
carries a *type* (this is the `cited_paper` field of an experiment),
queries like *"which experiments cited which papers by which
co-authors"* collapse from "ask the LLM and pray" to a SQL join.

---

## Meet the Hayashi lab

Professor Akemi Hayashi runs a 12-person developmental-biology lab.
Each lab member keeps an Obsidian vault. Experiments are written up
as `experiment` notes; cited papers as `paper` notes; co-authors as
`person` notes. The wikilink discipline is good — every experiment
note has `[[Tanaka 2024]]`-style links to the papers it builds on.

**The new postdoc's job:** Lin just joined. Her advisor (Hayashi)
told her: *"Before you propose your project, find every experiment
this lab has done in the last three years that cited any paper
co-authored by Rajesh Kumar. He's coming as visiting professor next
month."*

That is a **two-hop typed query**:
`experiment → cites paper → co-authored-by person(name="Rajesh Kumar")`.

---

## The naive stack

Lin's first instinct: agentic search.

```
Lin: "find experiments in the lab vault that cite any paper by Rajesh Kumar"
Agent: search_hybrid("experiments citing Rajesh Kumar")
       → 12 hits, mostly experiment notes that mention "Kumar" in
         the body. Some are Kumar T., not Kumar R.
       → also misses 4 experiments that cite [[Liu 2021]] which has
         Kumar as second author but never names him in the body.
```

The semantic search returns text that *mentions* Kumar. It cannot
follow the citation *as a citation*. It cannot distinguish "Kumar
R." from "Kumar T." because the disambiguation lives in the
`[[Liu 2021]]` note, not in the experiment that cites it.

Lin compiles a manual list. Three days later her advisor finds two
experiments she missed.

---

## The vault-memory way

The Hayashi lab has had three contracts in place for two years.

```yaml
# _contracts/experiment.yaml
name: experiment
required: [title, lead, date, cites_papers, hypothesis, outcome]
inputs:
  title:        { type: string }
  lead:         { $ref: "#/types/DocId", x-ref-kind: person }
  date:         { type: string, format: date }
  cites_papers: { type: array, items: { $ref: "#/types/DocId", x-ref-kind: paper } }
  ...
```

```yaml
# _contracts/paper.yaml
name: paper
required: [title, year, authors, doi]
inputs:
  title:   { type: string }
  year:    { type: integer }
  authors: { type: array, items: { $ref: "#/types/DocId", x-ref-kind: person } }
  doi:     { type: string }
```

```yaml
# _contracts/person.yaml
name: person
required: [full_name, affiliation]
inputs:
  full_name:    { type: string }
  affiliation:  { type: string }
  orcid:        { type: string, pattern: "^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$" }
```

`cites_papers` is a typed list of refs to `paper` instances.
`paper.authors` is a typed list of refs to `person` instances. ADR-022's
`typed_refs` table was populated at write time for every experiment and
paper instance.

### Lin's two-hop query

```jsonc
// Step 1: who is "Rajesh Kumar" precisely? (disambiguates Kumar R. vs Kumar T.)
queryFrontmatter({
  where: { kind: "person", full_name: "Rajesh Kumar" }
})
// → [obsidian://hayashi-lab/People/kumar-rajesh.md]
//   (one Person instance; ORCID matches)

// Step 2: which paper instances list him as an author? (typed reverse edge)
query_typed_refs({
  source_kind: "paper",
  field_path: "authors[*]",
  target_doc_id: "obsidian://hayashi-lab/People/kumar-rajesh.md"
})
// → 23 paper instances

// Step 3: which experiments cite any of those papers? (typed forward edge)
query_typed_refs({
  source_kind: "experiment",
  field_path: "cites_papers[*]",
  target_doc_id: [ /* the 23 DocIds from step 2 */ ]
})
// → 11 experiment instances, deterministic
```

Three queries. Three SQL index lookups. ~80 ms total. Lin has the
right answer before her coffee is half gone.

### What the naive stack got wrong, structurally

- It searched **body text** for "Kumar." Two papers cite Kumar R. as
  second author without mentioning him in the experiment body. The
  citation is encoded as `cites_papers: [[Liu 2021]]` — the link to
  Kumar lives **inside the cited paper**. The typed graph traverses
  through.
- It mixed up Kumar R. and Kumar T. The `person` contract requires
  ORCID. Disambiguation happens once, at `person` write time. Every
  downstream query is unambiguous.
- It returned text that *mentioned* citation. The `typed_refs` table
  knows that "this string is the `cites_papers` field of an
  experiment," not "this string appears near the word 'cite'."

### The bonus query Lin runs before walking into Hayashi's office

```jsonc
// Which of those 11 experiments are still active (not yet published)?
queryFrontmatter({
  where: { kind: "experiment", status: "active" },
  doc_id_in: [ /* the 11 from above */ ]
})
// → 4 active experiments
```

Lin's project proposal arrives at Hayashi's desk with: *"I propose
to extend the line of inquiry in [4 specific experiments] that
build on Kumar's 2019 and 2022 work, by..."*. Hayashi nods.

---

## What the principle bought you

> A `[[Liu 2021]]` wikilink is the *same edge* whether it appears in
> a sentence or as a `cites_papers` field. The semantic role is
> what makes the query tractable.

Untyped graphs collapse the role and you get back text matches.
Typed graphs preserve the role and you get back structural answers.
Two-hop queries that the naive stack returns 12 wrong rows for
become three SQL lookups that return the right 11.

For the load-bearing decision, see
[ADR-022 — Typed cross-contract edges](../v2/adr/022-typed-cross-contract-edges.md).
