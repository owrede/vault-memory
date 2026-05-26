# Authoring Contracts — a practical how-to

*From "I keep asking the same thing" to a working, tested contract. This is the practice
to go with the theory in [HOW-IT-WORKS.md](../HOW-IT-WORKS.md) and the reference in
[CONTRACT-EDITOR.md](CONTRACT-EDITOR.md).*

> **First, the mental model that unblocks everything.** A contract is **research, not
> action.** It answers *"which notes are relevant for this recurring question, and how do I
> bundle them?"* It never sends an email, never writes into your own notes — it only
> gathers and compiles a briefing into the AI memory. If you catch yourself wanting a step
> that *does* something to the outside world, that is a **workflow**, not a contract (see
> [ADR-028](../adr/028-workflows-vs-contracts.md)). Keeping this line clear is what makes
> contract authoring feel simple.

---

## Step 0 — Find the recurring question (don't open the editor yet)

A contract pays off when you ask the *same shape* of question repeatedly. Write it down in
one sentence, in your own words. Good candidates:

- "Prepare me for a meeting with **‹person›**."
- "What's the current status of project **‹X›**?"
- "Give me a dossier on **‹person/org›** and who they connect to."

Bad candidates (one-offs, or actions): "summarize this one note" (just search),
"email the team the agenda" (that's a workflow).

**Name the moving part.** In "prepare me for a meeting with ‹person›", the moving part is
*which meeting note*. That becomes an **input**. Everything else is the fixed recipe.

---

## Step 1 — Answer four questions on paper

Before any node, answer these. They map one-to-one onto the contract's structure:

| Question | Becomes |
|---|---|
| What does the caller supply each time? | **inputs** (e.g. `meeting_path`, `vault`) |
| Which notes are the *seed*? | the first read/search step |
| What surrounding context matters? | follow-up steps (links, clusters, searches) |
| What should the briefing answer? | the `compile_brief` step's `purpose` |

For "meeting prep with Sarah":
- inputs: the meeting note's path, the vault name
- seed: read the meeting note
- context: the people/orgs it links to
- purpose: "key docking points, open questions, win-win levers, caveats"

---

## Step 2 — Pick the building blocks (verbs)

The palette groups verbs by what they do. You almost always need **one gatherer** + the
**compose** verb. Here is the plain-language map:

| You want to… | Verb (palette title) | Returns |
|---|---|---|
| Read one specific note | **Read a note** (`read_note`) | that note's content |
| Search the vault by meaning | **Search the vault** (`search_hybrid`) | matching notes |
| Filter notes by a property | **Filter by properties** (`query_frontmatter`) | matching notes |
| Follow the links out of a note | **Follow links between notes** (`expand`) | linked notes |
| Group related notes | **Cluster related notes** (`cluster`) | clusters |
| Turn gathered notes into a briefing | **Compile a brief** (`compile_brief`) | a brief in AI memory |

> **The one rule that makes chaining work** (learned the hard way, see
> [ADR-027](../adr/027-verb-output-normalization.md)): a gatherer verb hands the next step a
> list of note IDs via a field called **`doc_ids`**. So `compile_brief`'s `source_doc_ids`
> is fed from a previous step's `{{step.doc_ids}}`. If you wire a field that the upstream
> step does not actually produce, the contract fails at run time with
> `unresolved_template`. The editor's reference picker (Phase 8.5) shows you the *real*
> available fields — use it rather than typing field names by hand.

---

## Step 3 — Wire the steps in the canvas

1. **Drag** the first verb (e.g. *Read a note*) from the palette onto the canvas.
2. In the **inspector** (right pane), fill its arguments. Use **"Fixed value"** for
   constants and **"Use upstream"** to pull from an input or an earlier step.
   - `read_note` needs `vault` and `path` — both come from inputs: `{{inputs.vault}}`,
     `{{inputs.meeting_path}}`.
3. **Drag** the next verb (*Compile a brief*). Connect the first node's output handle to
   it, or in the inspector set `source_doc_ids` → "Use upstream" → pick the gatherer step →
   pick its `doc_ids` field.
4. Fill `compile_brief`'s `purpose` (the question the briefing must answer) and `target`
   (a name for the brief).

A minimal, *actually-runnable* meeting-prep contract is just two steps:

```yaml
inputs:
  vault:          { type: string }
  meeting_path:   { type: string }
  context_doc_ids:                       # the relevant notes, gathered by you or a search
    type: array
    items: { type: string }
required: [vault, meeting_path, context_doc_ids]
sources:
  default_source: { handle: "obsidian-fs://<your-vault>", required: true }
sinks:
  default_sink:   { handle: "default", required: true }   # the auto-discovered memory sink
assembly:
  - as: meeting
    verb: read_note
    args: { vault: "{{inputs.vault}}", path: "{{inputs.meeting_path}}" }
  - as: compiled
    verb: compile_brief
    args:
      vault: "{{inputs.vault}}"
      target: "{{inputs.meeting_path}}--prep"
      source_doc_ids: "{{inputs.context_doc_ids}}"
      sink: "default"
      purpose: >
        Meeting prep: key docking points, open questions, win-win levers, and
        caveats about the participants and their projects.
      max_tokens: 2000
```

> **Note there is NO `write_back` block.** `compile_brief` writes the briefing itself. Adding
> a `write_back` that references `{{compiled.body}}` will fail — `compile_brief` returns
> `{ok, doc_id}`, not a `body`. (Another lesson from the first real run.)

---

## Step 4 — The two onboarding gotchas (one-time setup)

The first time you run a contract that compiles a brief, two things must exist:

1. **A memory sink.** The briefing goes into a labeled AI-memory folder. If your vault has
   no `_memory/` folder with a `.memory-sink` marker file, no sink is registered and the
   run fails with `sink_override_not_a_memory_sink`. Create `_memory/.memory-sink`
   (a tiny YAML stub) once; the server then auto-discovers a sink named `default`. Reference
   it in the contract as `sink: "default"`.
2. **A brief-text engine.** `compile_brief` needs an LLM to write the prose. It tries, in
   order: the calling agent via MCP Sampling → a local Ollama chat model → text you pass in.
   If you run from an agent like Claude Code, the agent itself is the engine (Sampling) — no
   local model needed. If you run headless, configure `[brief.ollama]` with a *chat* model
   (an embedding model won't do).

---

## Step 5 — Test it before you trust it

Don't assume it runs because the editor accepted it. Run it for real:

- From an agent: ask it to run the contract (the `use-contracts` skill bridges intent →
  `instantiate_contract`). A successful run returns `{ ok: true, steps: { … }, … }` and the
  brief appears in `_memory/`.
- Read the written brief. Check its `## Sources` footer lists the notes you expected.
- If you get a closed-enum failure reason, the common ones:

| reason | meaning | fix |
|---|---|---|
| `unresolved_template` | a `{{step.field}}` doesn't exist | the field name is wrong — pick the real one from the reference picker |
| `sink_override_not_a_memory_sink` | the sink isn't registered | create `_memory/.memory-sink`; use `sink: "default"` |
| `no_llm_strategy_available` | no brief-text engine | run from a Sampling-capable agent, or configure Ollama chat, or pass `prepared_text` |
| `invalid_inputs` | a typo'd or missing input | re-check the inputs against `describe_contract` |

---

## Step 6 — Grow it deliberately

Start with the two-step version above; confirm it runs; *then* add context-gathering:

- Add a **Search the vault** step before compile, feeding its `doc_ids` into
  `source_doc_ids`, to auto-find relevant notes instead of listing them by hand.
- Add **Follow links between notes** to pull in a person's organization and projects.
- Add **Cluster related notes** to group a large link neighborhood before compiling.

Add one step, run it, confirm — don't wire five speculative steps at once. The canvas
makes it tempting; resist. A contract you can't run is worse than no contract.

---

## The shape of a good contract (checklist)

- [ ] Solves a question you genuinely ask repeatedly (Step 0).
- [ ] Has a clear moving part as an **input** (the rest is fixed recipe).
- [ ] Every step's references point to fields the upstream step *actually* produces.
- [ ] Ends in **Compile a brief** with a concrete, answerable `purpose`.
- [ ] No `write_back` block when `compile_brief` is the last step.
- [ ] **Runs for real** — verified, not assumed.
- [ ] Writes only into the memory sink (it can't do otherwise — that's the safety net).

---

*Reference contracts to copy from live in `evals/fixtures/v2-test-vault/_contracts/`
(`meeting-prep`, `person-dossier`, `project-status`). The editor's buttons and panes are
documented in [CONTRACT-EDITOR.md](CONTRACT-EDITOR.md).*
