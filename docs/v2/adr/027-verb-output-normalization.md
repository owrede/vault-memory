# ADR-027 — Verb Output Normalization (`doc_ids` invariant)

**Status:** Proposed
**Date:** 2026-05-26
**Phase:** 9 (contracts-real-laufen; pre-v2.0.0)
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-006 (Task Contract DSL), ADR-007 (Contract Editor), ADR-023
(Contracts as MCP Resources), ADR-026 (Contract as Context-Spec).

---

## Context

A live end-to-end run of the `meeting-prep` reference contract against the
**real** built server (not the mocked eval harness) failed six times in a row,
each failure exposing a different layer of the same root cause: **three sources
of truth about verb outputs disagree.**

| Layer | claims `expand` outputs |
|---|---|
| JSDoc verb contract (`src/contracts/verbs/index.ts`) | `{doc_ids, edges}` |
| Plugin verb catalog (`plugin/.../palette/verb-catalog.ts`) | `outputShape: "{ doc_ids: string[] }"` |
| **Real implementation** (`src/graph/expand.ts`) | `{documents, warnings}` |

A code audit found **9 of 11 baseline verbs** carry such a mismatch:

| Verb | JSDoc claims | Real return | Mismatch |
|---|---|---|---|
| search_hybrid | `{hits}` | `SearchHit[]` (bare array) | yes |
| expand | `{doc_ids, edges}` | `{documents, warnings}` | yes |
| cluster | `{clusters}` | `{ok, clusters?, node_count?, reason?}` | yes |
| recall | `{hits}` | `{packets, count}` | yes |
| compile_brief | `{ok, doc_id, body?}` | `{ok, doc_id, model?}` (no `body`) | yes |
| get_brief | `Brief \| {stale} \| null` | 6-variant union, `brief: Document\|null` | yes |
| query_frontmatter | `{doc_ids, rows}` | `NoteRow[]` (bare array) | yes |
| list_backlinks | `{backlinks}` | `{backlinks}` | no |
| get_outline | `{nodes}` | full `OutlineResult` | yes |
| search_sections | `{hits}` | `{results, count}` | yes |
| read_note | `{body, properties}` | `{path, title, content, frontmatter, hash, mtime, word_count}` | yes |

Two consequences make contracts **unusable in production**:

1. **No verb returns a `doc_ids: string[]` field** that downstream `cluster` /
   `compile_brief` seed args can consume. They return arrays of *objects*
   (`documents`, `hits`, `packets`).
2. **The template resolver (`src/contracts/templates.ts`) cannot project arrays.**
   `{{linked.documents[].doc_id}}` is not supported syntax — only fixed indices
   (`documents[0]`). So even with correct field names, an author cannot extract a
   `doc_id` list from `expand` to feed `compile_brief`.

The shipped reference contracts pass tests **only because the eval-runner mocks
every verb** with the (wrong) documented shape. Mocks hid the gap; the real run
revealed it.

A second contributing finding: `compile_brief` **writes the brief itself** via the
DeliveryAdapter and returns `{ok, doc_id}` — no `body`. The fixture's
`write_back: { body_from: "{{compiled.body}}" }` therefore always fails with
`unresolved_template`. This ADR scopes the verb-output fix; ADR-026 and the Phase-9
fixture rewrite address the redundant-write_back design issue.

---

## Decision

**Every assembly verb output carries a uniform, documented `doc_ids: string[]`
field, derived additively. No existing field is removed or reshaped.**

The `doc_ids` invariant is the single contract between a producing verb and any
downstream verb that needs a seed/source list. Rich object arrays
(`documents`, `hits`, `packets`, `rows`) remain for verbs/authors that want detail.

### Normalized output shapes

| Verb | normalized output |
|---|---|
| expand | `{doc_ids, documents, warnings}` |
| recall | `{doc_ids, packets, count}` |
| query_frontmatter | `{doc_ids, rows}` |
| search_hybrid | `{doc_ids, hits}` |
| search_sections | `{doc_ids, results, count}` |
| cluster | `{ok, doc_ids, clusters}` (`doc_ids` = union of all member doc_ids, order-stable) |
| get_outline | `OutlineResult & {doc_ids: [self]}` |
| list_backlinks | `{doc_ids, backlinks}` |
| read_note | `{doc_id, ...}` (single — `doc_id`, not `doc_ids`) |
| get_brief | `{doc_id?, brief, ...}` (single) |
| compile_brief | `{ok, doc_id, model?}` (single — unchanged) |

### Where the normalization lives

A pure function `extractDocIds(verb, output): string[]` plus a thin wrapper applied
in `verbDispatcher` **after** the handler returns. The v1 handlers and the 23 MCP
tools are **not touched** — normalization is a contract-layer concern only. This
preserves the v1 API (CLAUDE.md constraint) and the adapter seams.

### Single source of truth for signatures

A canonical, structured verb spec server-side (`src/contracts/verb-spec.ts`):
`{ verb, args, output_fields, output_type, title, description }` per baseline verb.
- The `contract-verbs` MCP resource serves the full spec (today: names only).
- The plugin catalog **consumes** the spec at runtime; it keeps only UI prose.
- A **CI drift gate** asserts `verb-spec.output_fields` matches the real
  `extractDocIds` map + handler return keys. Drift breaks the build — the three
  layers can never silently diverge again.

---

## Consequences

**Positive**
- Reference contracts become real-runnable: `expand → cluster → compile_brief`
  chains via `{{linked.doc_ids}}` — the field now exists.
- The editor offers correct upstream fields (it reads the spec), so the guided
  happy path produces contracts that actually run.
- Drift is structurally impossible (CI gate), not merely discouraged by docs.

**Negative / cost**
- Touches the verb dispatcher + every verb's output assertion test.
- Eval-runner mocks must be rewritten to the real shapes (they currently encode
  fiction — a net correctness win, but churn).
- `cluster.doc_ids` requires flattening community members; needs a defined,
  stable ordering (decision: hop-order then lexicographic, mirroring expand).

**Neutral**
- Array projection in the template resolver is explicitly **out of scope** — the
  `doc_ids` invariant removes the need for the 90% case. A future ADR may add
  projection for advanced authors; not required for v2.0.0.

## Validation

A smoke test drives the **built** server over stdio and runs at least one
reference contract end-to-end to `ok:true` (the Sarah-Maihaus run is the manual
template). This becomes a Phase-9 sign-off gate and a release gate — mocks alone
no longer count as proof a contract runs.
