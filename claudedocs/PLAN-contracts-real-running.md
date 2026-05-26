# Plan: Contracts that REALLY run + user-editable + as a context spec

## Problem (evidenced by a live run + two code investigations)

Three sources of truth about verb outputs contradict each other:

| Layer | says about `expand` |
|---|---|
| JSDoc (`src/contracts/verbs/index.ts`) | `→ {doc_ids, edges}` |
| Plugin catalog (`plugin/.../verb-catalog.ts`) | `outputShape: "{ doc_ids: string[] }"` |
| **Real impl** (`src/graph/expand.ts`) | `→ {documents, warnings}` |

**9 of 11 verbs** diverge. Consequences:
1. The shipped `meeting-prep` fixture contract does **not** run against the real server (green only when mocked).
2. The plugin editor offers **wrong** output fields → users wire up `{{linked.doc_ids}}`, which never exists.
3. The template resolver supports **no array projection** → `expand → compile_brief` is impossible via templates.

## Decisions (confirmed by the user)

1. **Normalize verbs** → uniform `doc_ids: string[]`, one source of truth.
2. **Verb catalog from the real impl** synchronized + live `{{ref}}` validation in the editor.
3. **Think the context-window assembly through now** → its own ADR.

---

## Part A — Verb output normalization (makes contracts really chainable)

**Goal:** Every verb output carries a documented, uniform `doc_ids: string[]` IN ADDITION to the rich objects. Backward compatible (additive, no fields removed).

| Verb | today → | normalized → |
|---|---|---|
| expand | `{documents, warnings}` | `{doc_ids, documents, warnings}` |
| recall | `{packets, count}` | `{doc_ids, packets, count}` |
| query_frontmatter | `NoteRow[]` | `{doc_ids, rows}` |
| search_hybrid | `SearchHit[]` | `{doc_ids, hits}` |
| cluster | `{ok, clusters}` | `{ok, doc_ids, clusters}` (all member doc_ids) |
| search_sections | `{results, count}` | `{doc_ids, results, count}` |
| get_outline | `OutlineResult` | + `doc_ids: [self]` (consistency) |
| read_note / get_brief / list_backlinks / compile_brief | (single/own) | unchanged / `doc_id` where sensible |

**Implementation:** A small normalization layer in the `verbDispatcher` (`src/contracts/verbs/index.ts`) that derives the `doc_ids` field from the rich output AFTER the handler call (a pure `extractDocIds(verb, output)` function). No change to the v1 handlers themselves → no regression on the 23 MCP tools.

**Tests:** One test per verb, "output contains doc_ids matching documents/hits." Align the eval-runner mocks to the NEW real shapes (today they log fiction).

## Part B — One source of truth for verb signatures

**Goal:** JSDoc, plugin catalog, and impl can no longer drift.

1. **Canonical verb spec server-side** — new file `src/contracts/verb-spec.ts`: per baseline verb `{verb, args: ArgSpec[], output_fields: string[], output_type, title, description}`. ONE structured definition (replaces/extends the name list `BASELINE_VERBS`).
2. **MCP resource `contract-verbs` serves the full spec** (today: names only). The plugin editor reads it at runtime instead of the hand-maintained `verb-catalog.ts`.
3. **CI drift gate** — a test that checks `verb-spec.ts` `output_fields` against the real handler return types (or against the `extractDocIds` map from Part A). Drift breaks the build.
4. **Plugin catalog becomes a consumer** — `verb-catalog.ts` sources signatures from the resource/shared-types instead of duplicating them; only UI text (help, labels) stays hand-maintained.

## Part C — Editor: trustworthy + live validation

1. **Correct output fields** in the reference picker (follows automatically from Part B).
2. **Live `{{ref}}` validation** (`inspector-pane.svelte`): checks that `{{alias.field}}` (a) points to an existing upstream step and (b) `field` appears in its `output_fields`. Broken refs → visible warning instead of a silent failure.
3. **Parse-time check on load** — hand-edited YAML with dead refs is flagged in the inspector.

## Part D — Make fixtures really runnable (the actual proof)

1. Rewrite `meeting-prep`, `person-dossier`, `project-status` so they return `ok:true` against the REAL server (verified like the Sarah-Maihaus run, not just mocked).
2. **No redundant `write_back`** where `compile_brief` writes itself (design finding from the live run).
3. **Document/ease memory-sink auto-provisioning** (today it fails when `_memory/.memory-sink` is missing — an onboarding hurdle).
4. A **smoke test against the real built server** (analogous to `scripts/eval-real-vault.mjs`) that runs at least one contract end-to-end — as a CI or release gate.

## Part E — ADR: Contract as context-window spec

New ADR `docs/v2/adr/026-contract-as-context-spec.md`. Content:
- **Thesis:** A contract is not just a retrieval pipeline but the **process spec that compiles an optimally composed context window for an agent's recurring activity.**
- **Context-assembly model:** token budget per contract; prioritization (which sources first), dedup (same note from multiple hops), order (meeting note before background), truncation strategy on budget overflow.
- **Relationship to `compile_brief`:** today it compiles a *brief*; the ADR generalizes to *context assembly* (brief = one realization).
- **Discovery:** how an agent (via `describe_contract`) reads the spec as a process instruction (ties into the `use-contracts` skill + ADR-023).
- **Boundary:** what v2.0.0 delivers vs. what is a follow-up milestone (no scope creep into the release).

---

## Order & effort

1. **Part A** (normalization) — foundation, ~verb handlers + tests. Medium.
2. **Part D** (fixtures real) — proves A, delivers immediate value. Small-medium.
3. **Part B** (single source + CI gate) — prevents future drift. Medium.
4. **Part C** (editor validation) — user trust. Medium (plugin/Svelte).
5. **Part E** (Context-Spec ADR) — can be written first/in parallel as design. Small (docs).

## Constraints (from CLAUDE.md)
- Backward compatible: 23 v1 tools unchanged; normalization purely additive.
- Adapter seams: no new `fs`/`yaml` imports outside the adapters; `lint-adapters.sh` must stay green.
- Test discipline: no regression of existing tests; new verbs/refs with unit tests in the same PR.
- MEM-05: write_back only via DeliveryAdapter; untouched.
- GSD: execution runs through a GSD command (likely `/gsd-execute-phase` as the new Phase 8.5, or `/gsd-quick` per part).

## Release positioning (decided)
- **New GSD Phase 8.5 BEFORE v2.0.0.** v2.0.0 slips until contracts demonstrably run for real. Rationale: shipping non-runnable reference contracts in a `.0` release undermines the core promise. Plan 08-08 (v2.0.0 cut) waits until Phase 8.5 is green.

## Starting step (decided)
1. **FIRST docs only, no code:**
   - `docs/v2/adr/026-contract-as-context-spec.md` (Part E) — Contract as context-window spec.
   - Pin the normalized verb spec as a design table (Parts A+B) in the ADR or a separate `docs/v2/adr/027-verb-output-normalization.md` — the approved template for the implementation.
2. **Then set up GSD Phase 8.5** and execute A→D against the ADRs.
3. Only after Phase-8.5 sign-off (real smoke test green) return to Plan 08-08 / the v2.0.0 cut.

## Next concrete step
Write ADR-026 (Context-Spec) + ADR-027 (Verb Normalization). Then get approval, then plan/execute Phase 8.5 via GSD.
