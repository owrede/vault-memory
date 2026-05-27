---
quick_id: 260527-j7h
slug: create-contract-skill
status: complete
date: 2026-05-27
branch: quick/create-contract-skill
---

# Quick Task — create-contract skill

## What was asked

Make `create-contract` a command/skill in vault-memory so users can describe — in
free language — what kind of recurring search routine they want as a contract; the
skill designs an optimal contract. Later the skill also defines an **artifact schema**
for precomputed artifacts, and the agent should **auto-discover missing contracts**:
recurring requests that no existing contract could satisfy get surfaced as candidates
for a `create-contract` run.

## Decisions (locked before building)

- **Form = agent Skill**, not an MCP server tool — zero `src/` change, zero regression
  risk to the 324-test baseline. Sibling to `skills/use-contracts/`.
- **Discovery = "full now" but entirely on the skill + memory-sink layer.** ADR-029
  quality-signals are not implemented in the server, so full discovery is realized
  without server changes: gap-logging to the memory sink + in-skill clustering/suggestion.

## What was delivered

| File | Change |
|---|---|
| `skills/create-contract/SKILL.md` | **New.** Interactive intent→YAML authoring bridge. Three modes: default authoring (free-language intake → four design questions → verb selection → `doc_ids` chaining → memory-sink/brief-LLM setup → write validated YAML to `_contracts/` → "test before you trust" handoff), **discovery mode** (read gap log, cluster recurring unmet requests, propose candidates), **artifact-schema mode** (ADR-030 precomputed-artifact fields). References `AUTHORING-CONTRACTS.md` for the DSL rather than duplicating it. Honest about Phase-8.5-not-yet-real items (ADR-027 reference picker, ADR-030 materialization, ADR-029 loops). |
| `skills/use-contracts/SKILL.md` | **Additive edit.** When no contract matches, append a structured entry to the memory sink (`_memory/_contract-gaps/`: request + inferred intent shape + vault + timestamp). Cross-references `create-contract`. No tool/contract behavior changed. |
| `scripts/install-skills.sh` | Added `create-contract` to the `SKILLS` array + `files_for()` case. `bash -n` clean. |

## The discovery loop (skill + sink only)

```
use-contracts: "no contract matches"
        │
        ▼  (memory-sink write — allowed under the sacrosanct-namespace invariant)
_memory/_contract-gaps/<entry>
        │
        ▼  create-contract --discovery
cluster recurring requests → propose top candidates → run create-contract design
```

No server change, no new DB table, no LLM coupling in the server.

## Constraint compliance

- **Zero `src/` changes** — verified (`git diff --name-only HEAD~2 HEAD | grep -c '^src/'` = 0).
- **Memory namespace sacrosanct** — gap log → memory sink; contract YAML → `_contracts/`
  only after explicit user confirmation. Never silent writes into user notes.
- **Backwards-compatible** — use-contracts edit is additive guidance; the 23 tools unchanged.
- **No premature server LLM coupling** — design intelligence lives in the agent reading the skill.

## Commits

| SHA | Message |
|---|---|
| `aba05f4` | feat(skills): add create-contract authoring skill (intent→YAML + discovery + artifact modes) |
| `c6e0f4a` | feat(skills): log unmet-request gaps from use-contracts; install create-contract |

## Verification

`npm test` → **1693 passed | 11 skipped (1704 total), 0 failures**. Well above the
324 baseline; zero regression — proving the skill-only change touched nothing in `src/`.

## Honest limits

- The discovery loop is **collect + suggest**, not autonomous learning. It surfaces gaps;
  a human still decides whether to author. True quality-signal learning waits on ADR-029
  server instrumentation.
- The skill assumes the agent reads SKILL.md and does the design reasoning. It is not a
  deterministic generator — there is no server-side validation of the proposed YAML beyond
  the existing `_contracts/` loader (`ContractDocumentSchema`) at registration time.
- Artifact-schema mode (ADR-030) defines fields the skill can write into a contract today;
  actual self-invalidating **materialization** is not implemented (Phase 8.5+).
