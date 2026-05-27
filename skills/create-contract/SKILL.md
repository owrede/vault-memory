---
name: create-contract
description: Turn a recurring search/knowledge-assembly need expressed in free language into an optimal, validated vault-memory task contract written to the vault's _contracts/ directory. A contract is a saved, repeatable research recipe (gather the right notes, compile a brief into the memory sink) — this skill is the interactive intent→design bridge that authors one. Use this skill PROACTIVELY whenever the user describes a recurring need — "I keep pulling the same notes together for X", "I keep asking the same thing", "we always search for the same stuff", "wir suchen immer wieder nach …", "ich stelle ständig dieselbe Frage" — and EXPLICITLY when the user says "/create-contract", "create a contract", "design a contract", "author a contract", "build me a contract", "neuen Contract erstellen", "Contract entwerfen", "Contract bauen". It also has a discovery mode (mine the memory-sink gap log of unmet requests and propose the most frequent as candidates) and an artifact-schema mode (ADR-030). Contrast with use-contracts, which RUNS existing contracts; this skill AUTHORS new ones.
---

# /create-contract — Author a task contract from intent

This skill takes a free-language description of a recurring search/assembly need and
walks it to a **validated YAML contract** written to the vault's `_contracts/`
directory. It is the interactive **intent → design** bridge.

It is the sibling of [`use-contracts`](../use-contracts/SKILL.md): that skill **runs**
existing contracts; this one **authors** new ones. The full DSL reference,
the closed verb enum, the chaining rule, the onboarding gotchas, and a minimal
runnable example all live in
[`docs/v2/plugin/AUTHORING-CONTRACTS.md`](../../docs/v2/plugin/AUTHORING-CONTRACTS.md) —
**lean on that document, do not restate it here.** This skill is the conversation
that turns intent into a contract that follows it.

## When to invoke

**Proactively**, when the user reveals a *recurring* knowledge-assembly need:

- "I keep pulling the same notes together before every board meeting."
- "Every time someone joins a project I rebuild the same onboarding dossier."
- "We keep searching for the same risk notes across projects."
- German: "Ich stelle ständig dieselbe Frage zu …", "Wir suchen immer wieder nach …".

The tell is **repetition of a question's *shape***, with one moving part. A one-off
("summarize this single note") is just `search_hybrid` — not a contract.

**Explicitly**, when the user says `/create-contract`, "create / design / author /
build a contract", "neuen Contract erstellen", "Contract entwerfen / bauen".

**For discovery**, when the user asks "what should I turn into a contract?" or when
`use-contracts` recently logged no-match gaps (see Discovery mode below).

Contrast with [`use-contracts`](../use-contracts/SKILL.md): if the user wants to **run**
a recipe that already exists, that's use-contracts, not this skill.

## Requirements

- `mcp__vault-memory__*` tools available in the session
- At least one vault registered; contracts live under `_contracts/*.yaml` and are
  hot-reloaded by the server (`startContractRegistry`)

---

## Default authoring mode — intent → validated YAML

An ordered workflow. Do the conversation first, write the YAML last.

### 1. Read what already exists (avoid duplicates)

Before designing anything, read the contracts Resource for the target vault:

```
vault-memory://contracts/{vault}
```

This is the same Resource `use-contracts` reads. If an existing contract already
covers the user's intent, **stop and hand off to `use-contracts`** — don't author a
near-duplicate. On a multi-vault setup, resolve `{vault}` from context or ask.

### 2. The four design questions

Answer the four design questions from
[AUTHORING-CONTRACTS.md Step 1](../../docs/v2/plugin/AUTHORING-CONTRACTS.md#step-1--answer-four-questions-on-paper)
*with the user*, in their own words: what the caller supplies each time (**inputs**),
the **seed** notes, the surrounding **context**, and the **purpose** the brief must
answer. Name the single moving part — that becomes the input; everything else is the
fixed recipe. Don't restate the table here; walk the user through it.

### 3. Select verbs from the closed assembly enum

Pick building blocks from the **11-verb closed assembly enum** documented in
[AUTHORING-CONTRACTS.md Step 2](../../docs/v2/plugin/AUTHORING-CONTRACTS.md#step-2--pick-the-building-blocks-verbs).
The pattern is almost always **one gatherer** (`read_note` / `search_hybrid` /
`query_frontmatter` / `expand` / `cluster`) + the **compose** verb (`compile_brief`).
Point the user at the verb map there — do not recopy the table.

### 4. Wire the chaining (`doc_ids`)

A gatherer hands the next step a list of note IDs via the **`doc_ids`** field;
`compile_brief`'s `source_doc_ids` is fed from a prior step's `{{step.doc_ids}}`.
Follow the
[chaining rule in AUTHORING-CONTRACTS.md Step 2/3](../../docs/v2/plugin/AUTHORING-CONTRACTS.md#step-3--wire-the-steps-in-the-canvas);
wiring a field the upstream step does not produce fails at run time with
`unresolved_template`.

> **Honesty — not yet real.** The editor's **reference-field picker** that shows the
> *real* available upstream fields (verb-output normalization, ADR-027) is a **Phase
> 8.5** item and is **not implemented today**. Do not promise it. Until it ships, you
> must reason about field names by hand against the verb map and the runnable example
> in AUTHORING-CONTRACTS.md, and verify by running the contract (step 7).

### 5. Memory-sink + brief-LLM setup

`compile_brief` writes the briefing into a labeled **memory sink** and needs a
brief-text engine. Both onboarding gotchas — creating `_memory/.memory-sink` and
having an LLM available (MCP Sampling from the calling agent, a local Ollama *chat*
model, or passed-in text) — are covered in
[AUTHORING-CONTRACTS.md Step 4](../../docs/v2/plugin/AUTHORING-CONTRACTS.md#step-4--the-two-onboarding-gotchas-one-time-setup).
Cite that, confirm both exist, and remember: do **not** add a `write_back` block when
`compile_brief` is the last step.

### 6. Write the validated YAML to `_contracts/<name>.yaml`

The contract YAML must validate against `ContractDocumentSchema`
(`src/contracts/contract-file-schema.ts`).

> **STOP and confirm before any write.** `_contracts/` is the user's **explicit
> contract directory — it is NOT the memory sink.** Writing there changes the user's
> saved configuration. Show the user the full YAML, name the exact target path
> (`_contracts/<name>.yaml`), and get an explicit yes before writing. Never write a
> contract silently.

### 7. Test it before you trust it

Don't trust a contract because the YAML parsed. Hand off:

- Instruct the user to **run the new contract via [`use-contracts`](../use-contracts/SKILL.md)**
  (or run it yourself through `instantiate_contract`).
- Read the produced brief; confirm its `## Sources` footer lists the notes you expected.
- If it fails, map the closed-enum reason using
  [AUTHORING-CONTRACTS.md Step 5](../../docs/v2/plugin/AUTHORING-CONTRACTS.md#step-5--test-it-before-you-trust-it),
  fix the YAML, re-run. Grow it one step at a time (Step 6 there) — never wire five
  speculative steps at once.

---

## Discovery mode — mine the gap log, propose candidates

Invoke this when the user asks "what should I make a contract for?" or proactively
when `use-contracts` has been logging no-match gaps.

1. **Read the gap log** in the memory sink at `_memory/_contract-gaps/`. These are
   structured entries `use-contracts` appends every time it concludes *no contract
   matched* a request (the request, the inferred intent shape, the vault, a timestamp).
2. **Cluster by intent shape** — group recurring requests that share a moving part and
   a purpose ("status of project ‹X›" appearing eight times across different X's is one
   cluster, not eight requests).
3. **Surface the most frequent clusters** as contract candidates, ranked by how often
   they recurred. Present them to the user: "You asked for a project-status-shaped
   answer 8 times last month and no contract covers it — want to author one?"
4. **Flow the chosen candidate into the default authoring mode** above (start at step 1,
   re-checking the contracts Resource so you don't duplicate something authored since).

This gap-discovery loop is the skill-layer precursor to the quality-signal learning
loops in [ADR-029](../../docs/v2/adr/029-learning-loops-quality-signals.md) — that is
its conceptual home. The server-side learning loops described there are **not
implemented**; here the loop lives entirely in the skill + the memory-sink gap log.

---

## Artifact-schema mode — shape a typed artifact (ADR-030)

Invoke when the user wants a **typed, structured output** ("a table of every open risk
with owner and due date") rather than a prose brief.

[ADR-030](../../docs/v2/adr/030-precompiled-artifacts.md) defines an **Artifact** as a
typed, materialized, self-invalidating contract flavor — distinct from today's prose
brief. In this mode you help the user **shape the typed schema** (the `output_shape`):
the fields/rows consumers care about, with honest "field not found" semantics rather
than hallucinated fills.

> **Honesty — forward-looking.** Only the **schema shaping** is something you can do
> today (a typed `output_shape` is expressible). The **materialization** (precomputed
> structured cache) and **self-invalidation** (the staleness daemon re-firing on source
> change) described in ADR-030 are a **forward-looking concept, not implemented**. Help
> the user define the shape; be explicit that the cache/invalidation behavior is not yet
> real and the contract will, for now, still produce its output on demand.

---

## Safety & boundaries

- **Contracts are RESEARCH, not ACTION** ([ADR-028](../../docs/v2/adr/028-workflows-vs-contracts.md)).
  A contract may only gather notes and compile a brief into the memory sink. If the user
  asks for a step that **writes outside the memory sink, touches their own notes, or acts
  on the world** (send an email, create a calendar entry, post to Slack), **reject it and
  redirect**: "that's a *workflow*, not a contract — out of scope here." Never smuggle a
  write/action verb into an assembly block; the 11 verbs are read-only by construction and
  the only write is `compile_brief` → the sink.
- **Memory namespace is sacrosanct.** The only places this skill writes are:
  (a) the labeled **MemorySink** — the gap log at `_memory/_contract-gaps/` (discovery
  input), and (b) `_contracts/<name>.yaml`, the user's explicit contract directory, and
  **only after explicit confirmation** (step 6). Never write silently into user notes.

## Honesty about not-yet-real features

State these plainly when they come up — do not imply they work today:

- **Reference-field picker / verb-output normalization (ADR-027)** — **Phase 8.5, not
  implemented.** You reason about upstream field names by hand and verify by running.
- **Artifact materialization & self-invalidation (ADR-030)** — forward-looking concept;
  only schema shaping is available now.
- **Server-side learning loops / quality signals (ADR-029)** — not implemented; the
  gap-discovery loop is a skill-layer precursor, not the server feature.

## Bilingual

Triggers, the design conversation, and confirmations all work in German and English.
Mirror the user's language throughout, including the final report and the confirm-
before-write prompt.

## Out of scope

- **Running** contracts → [`use-contracts`](../use-contracts/SKILL.md).
- Any `src/` server change, new MCP tool, new DB table, or server-side LLM call — this
  skill authors Markdown/YAML only.
- Implementing the ADR-029 quality signals or Ralph-loops server-side — the gap log is a
  skill-layer precursor only.
- Implementing ADR-027 verb-output normalization or ADR-030 materialization — the skill
  acknowledges them as not-yet-real; it does not build them.
- **Workflows** (outcomes/actions, ADR-028) — out of scope; redirect, don't author.
