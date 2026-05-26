# ADR-031 — Reusable canvas component (contract editor & workflow editor)

**Status:** Proposed (concept; no extraction in this ADR)
**Date:** 2026-05-26
**Phase:** v2.x / cross-repo concept
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-007 (Contract Editor), ADR-028 (Workflows vs Contracts).
External: `owrede/perspecta-workflows` (the planned workflow-editor repo).

---

## Context

Two editors are now foreseen:

1. **Contract editor** (exists, in `plugin/src/views/contract-editor/`) — authors a
   *research* pipeline of vault-memory verbs. Lives in the vault-memory Obsidian plugin.
2. **Workflow editor** (planned, separate repo `owrede/perspecta-workflows`) — authors an
   *outcome* pipeline: research steps + agent-judgment steps + external action steps +
   quality gates (ADR-028).

Both are **node-and-edge canvas editors**: drag building blocks onto a canvas, wire their
outputs to inputs, edit each block's properties in an inspector. The contract editor today
is built from three panes (`canvas/`, `inspector/`, `palette/`) on top of `@xyflow/svelte`
(Svelte Flow). The maintainer's observation: **the canvas machinery is generic; only the
building blocks differ.** It would be wasteful to rebuild the canvas for the workflow editor.

This ADR defines the **seam** between what is reusable and what is domain-specific — so a
later extraction is clean — **without extracting anything now** (avoiding speculative
abstraction before the workflow editor concretely exists).

---

## Decision

**Record the reuse seam now; defer the actual extraction until `perspecta-workflows` starts.**

### What is reusable (the generic canvas component)

The domain-agnostic node-graph editing substrate:

| Reusable | What it does |
|---|---|
| Canvas surface | Pan/zoom, node placement, edge drawing (Svelte Flow wrapper) |
| Node rendering shell | A generic node box: title, category color, input/output handles |
| Edge model | Connect output handle → input handle; visual edge from a `{{ref}}` |
| Inspector shell | A generic right-pane form host that renders controls from a schema |
| Layout + editor-state persistence | Node positions, viewport, selection (the `vm-editor-state` pattern) |
| Connection validation hook | A *callback* `isValidConnection(source, target)` — the host supplies the rule |
| Reference/field-picker shell | The two-level "which upstream step / which field" picker UI |

These know nothing about contracts, verbs, workflows, or actions. They operate on an
abstract `{ nodes, edges, nodeKindCatalog, validateConnection, renderInspectorFor }` contract.

### What is domain-specific (stays in each repo)

| Domain-specific | Contract editor | Workflow editor |
|---|---|---|
| Block catalog | 11 baseline verbs (from the verb spec, ADR-027) | research/judgment/action steps + gates |
| Block output fields | verb `output_fields` (ADR-027) | step output contracts |
| Connection rules | research-verb compatibility | step compatibility + gate placement |
| Serialization target | `.contract` ↔ Phase-6 YAML | workflow file format (TBD in perspecta-workflows) |
| Safety model | read-only; sink-only write_back | actions + approval gates (ADR-028) |
| Inspector controls | verb arg shapes | step + action + optimizer config |

**The rule:** the canvas component owns *how you draw and wire a graph*; each editor owns
*what the nodes mean and what is legal*. The domain plugs in via a small interface
(catalog + validators + inspector renderer + codec), never by forking the canvas.

### Distribution shape (decision deferred, options recorded)

When extraction happens, the canvas component could be:
- an **npm package** (`@perspecta/graph-canvas` or similar) depended on by both repos — cleanest, versioned, but adds a publish/release axis;
- a **git submodule / shared source** — simpler to start, harder to version;
- **copy-once, diverge** — pragmatic if the two editors drift more than they share.

Not decided here. The seam definition above is what makes any of these cheap later.

---

## Why not extract now

- The workflow editor does not exist yet; its real needs (action nodes, gate nodes,
  optimizer config) will shape the canvas interface. Extracting against a guessed interface
  risks a wrong abstraction that both repos then fight.
- The contract editor works today. Pulling its canvas into a package is real work
  (build, publish, dependency wiring) with no immediate payoff.
- **Right time to extract:** when `perspecta-workflows` begins and needs the canvas — then
  the second consumer reveals the true shared interface. Two real consumers beat one guess.

---

## Consequences

**Positive**
- A clear, recorded seam means the contract editor can be developed in Phase 8.5 (editor
  trustworthiness, ADR-027) *without* painting the canvas into a contract-only corner.
- The workflow editor in `perspecta-workflows` has a documented starting point: reuse the
  canvas substrate, supply a workflow block catalog + validators + codec.

**Negative / risk**
- A recorded-but-unbuilt seam can rot if the contract editor evolves without keeping the
  domain/generic split clean. Mitigation: when touching the editor in Phase 8.5, keep
  catalog/validator/codec as injectable inputs, not hardcoded internals.

**Neutral**
- Out of scope for v2.0.0. This ADR is a cross-repo design note; the vault-memory repo
  ships the contract editor, `perspecta-workflows` will ship the workflow editor.

## Open questions (for the extraction ADR, not now)

1. Exact interface the canvas component exposes (props/events/slots) — driven by the
   workflow editor's real needs once they exist.
2. Distribution (npm vs submodule vs copy) — decided when the second consumer is real.
3. Does the inspector's schema-driven control rendering generalize across both domains, or
   does each editor need its own inspector with only the canvas shared?
