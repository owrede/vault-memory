---
name: use-contracts
description: Discover and run vault-memory task contracts on the user's behalf. A task contract is a saved, repeatable knowledge-assembly recipe (e.g. "meeting prep brief", "project status", "code review brief") that gathers the right notes and compiles a brief into the memory sink. Use this skill PROACTIVELY whenever the user asks for an outcome a contract already produces — "prep me for this meeting", "give me a status on project X", "pull together a review brief", "Briefing für das Meeting", "Status zu Projekt X", "fass das zusammen für …" — and whenever the user says "/use-contracts", "list contracts", "which contracts do I have", "run a contract", "welche Contracts gibt es", "Contract ausführen". Bridges intent → list_contracts → describe_contract → instantiate_contract so the user never has to know the tool names.
---

# /use-contracts — Discover and run task contracts

vault-memory task contracts are saved, repeatable knowledge-assembly recipes.
Each one knows which notes to gather (by link, tag, or search), how to compile
them, and where to write the result. The user authored them (or shipped the
references); your job is to **notice when a request matches one and run it** —
not to make the user remember tool names or input shapes.

This skill is the missing bridge: the MCP tools `list_contracts`,
`describe_contract`, and `instantiate_contract` exist and are discoverable, but
nothing tells an agent *when* to reach for them. This does.

## When to invoke

**Proactively**, when the user's request matches an outcome a contract produces:

- "prep me for the Acme meeting" / "Briefing fürs Meeting morgen" → likely a
  `meeting-prep`-style contract
- "where does project Atlas stand?" / "Status zu Projekt X" → likely a
  `project-status`-style contract
- "pull together a review brief for this PR" / "Review-Briefing" → likely a
  `code-review-brief`-style contract
- any "compile / summarize / pull together X from my notes" request

**Explicitly**, when the user says: `/use-contracts`, "list contracts", "which
contracts do I have", "run the … contract", "welche Contracts gibt es",
"Contract ausführen".

If you are unsure whether a contract fits, **list first** (cheap) and check —
don't guess.

## Requirements

- `mcp__vault-memory__*` tools available in the session
- At least one vault registered; contracts live under `_contracts/*.yaml`

## Workflow

### Phase 1 — Discover what exists

Read the contracts Resource for the target vault:

```
vault-memory://contracts/{vault}
```

Each entry carries `name`, `description`, source/sink counts, and a
`write_back` boolean. This is a pure read — always do it before claiming a
contract does or doesn't exist. On a multi-vault setup, resolve `{vault}` from
context or ask which vault.

If no contract matches the user's intent, say so plainly and offer the
alternatives (a plain `search_hybrid`, authoring a new contract with the
[`create-contract`](../create-contract/SKILL.md) skill, or the Obsidian
plugin's contract editor). Do **not** invent a contract.

**Additionally, log the gap (additive, no tool/behavior change).** When you
conclude no contract matches, append a structured gap entry to the memory sink
at `_memory/_contract-gaps/`. This is a plain MemorySink write — it falls under
the existing safety invariant (only ever the labeled sink, never the user's own
notes). Capture:

- the user's request (verbatim or lightly paraphrased),
- the inferred intent shape (the recurring question with its moving part, e.g.
  "status of project ‹X›"),
- the vault,
- a timestamp.

These accumulated gaps feed the `create-contract` skill's **discovery mode**,
which clusters recurring unmet requests and proposes the most frequent as
contract candidates. Logging the gap does **not** change any tool call, contract
behavior, or the alternatives you offer — it is purely additive guidance.

### Phase 2 — Understand the match

For the contract that fits, call:

```
describe_contract({ name, vault? })
```

It returns `{ json_schema, summary }` — a pure function, it does **not** run
anything. The `summary` lists Inputs / Sources / Sinks / Assembly (numbered
steps) / write_back / Output Shape. Read the **Inputs** section: those are the
values you must collect from the user.

### Phase 3 — Collect inputs

From the JSON Schema, gather every **required** input. Map the user's request
onto them:

- A `DocId` input (e.g. `meeting_doc_id`, `pr_doc_id`) → find the note the user
  means. If they named it, resolve it with `search` / `search_hybrid` and
  confirm the match before proceeding. Never guess a DocId.
- A string key input (e.g. `project_key`) → take it from the request or ask.
- Optional inputs (defaults shown in the schema) → only set if the user
  specified them; otherwise let the default apply.

**Confirm the resolved inputs with the user before running** — especially any
DocId you resolved by search. One line: "I'll run `project-status` for
`project_key=atlas-1`, freshness 30 days — go?"

### Phase 4 — Run

```
instantiate_contract({ name, inputs, vault? })
```

Zod-validates inputs (`additionalProperties:false` — a typo'd key is rejected,
fix it and retry). It executes the assembly end-to-end and writes the result
through the MemorySink (the safety invariant: contracts can only write to the
labeled memory sink, never silently into user notes).

The result envelope is `{ steps, write_back: { doc_id } }`. The
`write_back.doc_id` is the ground-truth location of the compiled brief.

### Phase 5 — Report

Tell the user:

- **what was produced** (a brief) and **where it lives** (`write_back.doc_id`,
  in the memory sink — e.g. `_memory/_briefs/…`)
- a one-line synthesis of the brief content if they want it inline
- offer the obvious next step (open it, refine inputs and re-run, or export)

## Failure handling

`instantiate_contract` returns a closed-enum `reason` on failure. The common ones:

| reason | meaning | what to do |
|---|---|---|
| `unknown_contract` | no contract by that name in the vault | re-list (Phase 1); you may have the wrong vault |
| `ambiguous_vault` | multi-vault setup, no `vault` passed | ask which vault, pass it explicitly |
| `validation_error` | inputs don't match the schema | re-read `describe_contract` Inputs; fix the key/type |
| `sink_override_not_a_memory_sink` | a sink override didn't resolve to a labeled MemorySink | drop the override or point it at a real sink |
| `unresolved_template` | a `{{…}}` step ref didn't resolve | the contract itself is misauthored — tell the user, point at the contract editor |

Surface the reason in plain language; don't dump the raw envelope.

## Safety & boundaries

- Contracts write **only** to the memory sink — never into user notes. This is
  enforced server-side (`DeliveryAdapter` chokepoint); you cannot bypass it and
  should not try.
- Always confirm resolved DocId inputs with the user before running — a wrong
  meeting note produces a confidently wrong brief.
- This skill **runs** contracts. It does not **author** them — authoring now has
  its own skill, [`create-contract`](../create-contract/SKILL.md) (intent →
  validated YAML), alongside the Obsidian plugin's contract editor. If the user
  wants a new contract or a changed pipeline, hand off to `create-contract`.

## Bilingual

Triggers and confirmations work in German and English. Mirror the user's
language in your confirmations and the final report.

## Out of scope

- Authoring / editing contracts (→ [`create-contract`](../create-contract/SKILL.md) skill or the Obsidian plugin contract editor)
- Raw retrieval with no contract (→ just call `search_hybrid` directly)
- Registering contracts as standalone MCP tools (`register_contracts_as_tools`
  is an advanced, config-gated path; this skill uses `instantiate_contract`
  directly, which always works regardless of the auto-register gate)
