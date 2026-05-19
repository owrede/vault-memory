---
phase: 07-visual-contract-editor-canvas
plan: 05
subsystem: plugin/contract-editor
tags: [variant-c, svelte-flow, zod-to-form, palette, inspector, canvas, ui]
requires: [07-01, 07-02, 07-03]
provides:
  - "Variant C three-pane contract editor (palette + canvas + inspector)"
  - "Pure layout helper (computeDefaultLayout)"
  - "Palette verb/type/peer-MCP data sources"
  - "Zod-to-form descriptor generator"
  - "view.ts with ContractDocumentSchema validation + debounced YAML companion emission"
affects:
  - "plugin/src/views/contract-editor/* (full editor surface)"
  - "plugin/src/services/mcp-client.ts (readResource method)"
  - "plugin/src/shared-types.ts (BASELINE_VERBS re-export)"
  - "plugin/styles.css (three-pane grid rules)"
tech-stack:
  added:
    - "zod ^4.4.3 as direct plugin dependency (was transitive only)"
  patterns:
    - "Pure-module + Svelte component split — pure modules (layout / verb-list / peer-mcp / zod-to-form) are unit-testable without DOM; Svelte components consume them"
    - "Variant C UI lock — three-pane grid never deviates from UI-SPEC §Layout"
    - "HTML5 drag-and-drop with custom MIME `application/x-vault-memory-verb` for palette → canvas drops"
    - "Debounced viewport vs immediate user-mutation save split (RESEARCH Pitfall 7)"
key-files:
  created:
    - "plugin/src/views/contract-editor/canvas/layout.ts"
    - "plugin/src/views/contract-editor/canvas/layout.test.ts"
    - "plugin/src/views/contract-editor/canvas/canvas-pane.svelte"
    - "plugin/src/views/contract-editor/canvas/StepNode.svelte"
    - "plugin/src/views/contract-editor/palette/palette-pane.svelte"
    - "plugin/src/views/contract-editor/palette/verb-list.ts"
    - "plugin/src/views/contract-editor/palette/verb-list.test.ts"
    - "plugin/src/views/contract-editor/palette/peer-mcp.ts"
    - "plugin/src/views/contract-editor/palette/peer-mcp.test.ts"
    - "plugin/src/views/contract-editor/palette/type-catalog.ts"
    - "plugin/src/views/contract-editor/inspector/inspector-pane.svelte"
    - "plugin/src/views/contract-editor/inspector/zod-to-form.ts"
    - "plugin/src/views/contract-editor/inspector/zod-to-form.test.ts"
    - "plugin/src/views/contract-editor/inspector/AliasPicker.svelte"
    - "plugin/src/views/contract-editor/editor.svelte"
  modified:
    - "plugin/src/views/contract-editor/view.ts (full rewrite — mounts editor.svelte, validates via ContractDocumentSchema, debounced YAML emission)"
    - "plugin/src/services/mcp-client.ts (add readResource method)"
    - "plugin/src/shared-types.ts (re-export BASELINE_VERBS)"
    - "plugin/styles.css (three-pane grid rules using Obsidian variables)"
    - "plugin/package.json (zod ^4.4.3 added as direct dependency)"
decisions:
  - "Hand-rolled Zod 4 walker for the inspector form generator — `.toJSONSchema()` discards `.describe()` annotations the inspector needs (e.g. the alias-ref marker). Walks `schema.def.type` discriminator + recurses into innerType / shape / element / entries."
  - "Drop handler uses `screenToFlowPosition` from `useSvelteFlow` to translate pointer coordinates into flow space — pinned this rather than the obsolete `project()` helper per Svelte Flow 1.5 docs."
  - "Edge-connect handler appends `__ref_<source>` arg keys as a placeholder for the inspector to surface; the inspector's true `{{alias.field}}` typeahead authoring lives in the AliasPicker. Full output-shape introspection is plan 07-06+ territory."
  - "SuppressionSet wiring (CAN-08) is explicitly deferred to plan 07-07. Plan 07-05 emits the `.yaml` companion via `app.vault.adapter.write` and may produce one watcher re-parse per save; the Phase 6 ChangeFeed handler tolerates duplicate parses because the inner index is idempotent. The codec emits the same canonical bytes for the same input contract, so the loop has no fanout."
  - "`mcpClient.readResource(uri)` is the new MCP-client API surface — added now because plan 07-05 already needs it for the peer-MCP palette section. Future plans 07-07/07-08 will piggy-back."
metrics:
  duration: "12m"
  completed: 2026-05-19
---

# Phase 7 Plan 05: Visual Contract Editor — Variant C Three-Pane Editor Summary

Ship the full Variant C three-pane contract editor (palette + canvas + inspector) replacing Wave 1's spike, with Zod-schema-derived inspector forms, dynamic peer-MCP palette, debounced YAML companion emission, and a fully tested pure-module core. Built and typechecks; all 57 plugin tests pass.

## One-liner

Variant C three-pane editor delivering palette drag-drop, Svelte Flow DAG canvas with snap-grid, Zod-walker inspector forms, and debounced canonical YAML emission via the 07-02 codec.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Pure modules (layout, palette lists, zod-to-form) + co-located tests | `bb5954a` | layout.ts/.test.ts · verb-list.ts/.test.ts · peer-mcp.ts/.test.ts · type-catalog.ts · zod-to-form.ts/.test.ts · shared-types.ts |
| 2 | Svelte three-pane editor + Svelte Flow canvas + inspector form | `c1d5d6b` | editor.svelte · canvas-pane.svelte · StepNode.svelte · palette-pane.svelte · inspector-pane.svelte · AliasPicker.svelte · styles.css |
| 3 | view.ts wires editor mount + debounced YAML companion emission | `c84a124` | view.ts · mcp-client.ts · AliasPicker.svelte (placeholder escape fix) |

## Must-Haves — Truths Verified

- ✅ **Variant C three-pane launches on `.contract` open** — `view.ts` mounts `editor.svelte` which is a CSS-grid with palette / canvas / inspector columns (260px / 1fr / 320px per UI-SPEC).
- ✅ **Palette enumerates 11 baseline + `literal` + dynamic peer-MCP** — `palette-pane.svelte` reads `VERB_CATEGORIES.read` (7) + `VERB_CATEGORIES.assembly` (4) + `VERB_CATEGORIES.escape` (`literal`) + `fetchPeerMcpVerbs(mcpClient)` on `onMount` + `visibilitychange`.
- ✅ **Inspector edits trigger save → YAML emission** — `inspector-pane.svelte` calls `onChange` which routes through `view.ts.onUserEdit` → `requestSave()` + 200 ms-debounced `emitYamlCompanion()` → `app.vault.adapter.write('_contracts/<name>.yaml', emitYaml(file))`.
- ✅ **YAML round-trip via codec deepEquals** — `view.ts.emitYamlCompanion` runs `parseYaml(emitYaml(file))` as a pre-write self-check; codec round-trip is verified by Plan 07-02's existing test suite (8 tests).

## Palette Section Counts (5)

| # | Section | Source | Count |
|---|---------|--------|-------|
| 1 | Types | `src/contracts/types-catalog.ts` re-shaped by `type-catalog.ts` | 4 (DocId, Handle, ChunkId, MemorySink) |
| 2 | Read verbs | `VERB_CATEGORIES.read` | 7 (read_note, search_hybrid, search_sections, query_frontmatter, list_backlinks, get_outline, recall) |
| 3 | Assembly verbs | `VERB_CATEGORIES.assembly` | 4 (expand, cluster, compile_brief, get_brief) |
| 4 | Escape-hatch | `VERB_CATEGORIES.escape` | 1 (literal) |
| 5 | Peer-MCP | `fetchPeerMcpVerbs(mcpClient)` against `vault-memory://contract-verbs` MCP Resource | Dynamic; hidden when empty |

## Inspector Form Generator Coverage

The `zodToForm(schema)` walker accepts any `z.object({...})` (or non-object as a single-`value` field) and emits a `FormDescriptor` decoupled from Svelte. Mapping:

| Zod node | Emitted `type` | Notes |
|----------|----------------|-------|
| `z.string()` | `"string"` | Plain text input |
| `z.string().describe("... alias-ref ...")` | `"alias-ref"` | Drives the `AliasPicker` widget |
| `z.number()` / `z.int()` / `z.bigint()` | `"number"` | HTML `<input type="number">` (consumed by inspector) |
| `z.boolean()` | `"boolean"` | Toggle (Obsidian-styled, surfaced by inspector) |
| `z.enum([...])` | `"enum"` + `enum: [...]` | Dropdown over closed values |
| `z.array(inner)` | `"array"` | Inner element walked but not surfaced (ArrayEditor renders rows; planned 07-06+) |
| `z.object(shape)` | `"object"` + `nested: FormDescriptor` | Recurses; renders as `<details>` block |
| `z.optional(inner)` / `z.nullable(...)` / `z.default(...)` | inner type, `required: false` | Wrappers unwrapped recursively |

Unknown Zod nodes degrade gracefully to `"string"` rather than throwing — the inspector still surfaces a text input.

## Debounce Timings

| Surface | Window | Reason |
|---------|--------|--------|
| YAML companion emission (`emitYamlCompanion`) | 200 ms | RESEARCH "rapid edit coalescing"; one disk write per ≤200 ms burst of user edits |
| Canvas node-drag position commit (`schedulePositionCommit` in `canvas-pane.svelte`) | 500 ms | RESEARCH Pitfall 7 — node-drag commits batch over 500 ms idle; viewport pan/zoom are NOT saved (defers to Plan 07-06's explicit viewport CTA path) |

## CAN-08 SuppressionSet Wiring — Deferred to Plan 07-07

Plan 07-05 emits the canonical YAML through `app.vault.adapter.write` without registering a suppression hash. The Phase 6 ContractRegistry will observe the write and re-parse — this is a no-op semantically (codec emits stable bytes for stable input) but does produce one redundant watcher cycle per save. Plan 07-07 lands the `suppress_contract_write` MCP call before the disk write to kill the echo loop. The seam is the `emitYamlCompanion` method in `view.ts`; the SuppressionSet call slots in before the `adapter.write`.

## Deviations from Plan

### Rule 3 — Add missing critical functionality

**1. `mcpClient.readResource(uri)` did not exist; plan called for it.**
- **Found during:** Task 3 (view.ts wiring).
- **Issue:** The plan's `key_links` specified `plugin.mcpClient.readResource('vault-memory://contract-verbs')`, but `VaultMemoryMcpClient` only exposed `callTool`, `onProgress`, `onNotification`, `disconnect`. The MCP SDK `Client` does provide `readResource`, but the wrapper had not surfaced it.
- **Fix:** Added `readResource(uri): Promise<{contents: ...}>` to `VaultMemoryMcpClient` plus optional `readResource` on the `McpClientLike` port. Implementation delegates to `this.client.readResource({uri})` and surfaces a clear error when the client is not connected or does not support resources.
- **Files modified:** `plugin/src/services/mcp-client.ts`
- **Commit:** `c84a124`

**2. `BASELINE_VERBS` was not exported from `shared-types`.**
- **Found during:** Task 1 (verb-list.ts implementation).
- **Issue:** The plan specified `import { BASELINE_VERBS } from "../../../shared-types.js"`, but `shared-types.ts` only re-exported the `ContractFileSchema` + `ContractDocumentSchema`. `BASELINE_VERBS` lived in `src/contracts/resources.ts` and was not re-surfaced for the plugin.
- **Fix:** Added the re-export line `export { BASELINE_VERBS } from "../../src/contracts/resources.js"` to `shared-types.ts`. Single source of truth preserved.
- **Files modified:** `plugin/src/shared-types.ts`
- **Commit:** `bb5954a`

**3. `zod` was not a direct plugin dependency.**
- **Found during:** Task 1 (zod-to-form.ts implementation).
- **Issue:** The plugin's `package.json` had no `zod` entry; the dependency was reaching the plugin transitively via the shared-types imports. The inspector form generator imports `zod` directly (the schema-walker reads `schema.def.type`), so it became a direct dependency.
- **Fix:** Added `"zod": "^4.4.3"` to `plugin/package.json` matching the root version.
- **Files modified:** `plugin/package.json`, `package-lock.json`
- **Commit:** `bb5954a`

### Rule 1 — Bug fix

**1. Svelte 5 parser rejected `placeholder="{{alias.field}}"` in `AliasPicker.svelte`.**
- **Found during:** Task 3 build.
- **Issue:** Svelte 5's parser interpreted the placeholder string `{{alias.field}}` as a template expression and emitted `Unexpected token` at the closing brace. The mustache pattern is meaningful in Svelte source.
- **Fix:** Wrapped the literal in a JavaScript expression: `placeholder={"{{alias.field}}"}`.
- **Files modified:** `plugin/src/views/contract-editor/inspector/AliasPicker.svelte`
- **Commit:** `c84a124`

## Verification

- `cd plugin && npm run typecheck`  — exits 0.
- `cd plugin && npm run build`      — produces `plugin/main.js` (1.9 MB, esbuild + esbuild-svelte).
- `cd plugin && npm test -- --run`  — 57 tests pass across 9 files. Coverage:
  - `layout.test.ts` (3): linear chain · diamond · idempotency.
  - `verb-list.test.ts` (3): partition · escape contains literal · BASELINE size + content.
  - `peer-mcp.test.ts` (4): empty resource · valid envelope · malformed JSON · readResource throws.
  - `zod-to-form.test.ts` (8): string · number · optional · enum · nested object · array · boolean · alias-ref.

Grep acceptance:

- `grep -n "fetchPeerMcpVerbs" palette-pane.svelte` → 3 hits (import + onMount + refresh body).
- `grep -n "ContractDocumentSchema" view.ts` → 3 hits (doc block + import + safeParse).
- `grep -E '#[0-9a-fA-F]{3,8}' plugin/styles.css` → no matches (Obsidian variables only).

## Known Stubs / Deferred

- **Inspector verb-arg schemas** — Plan 07-05 ships the contract-level form (Mode B) and a permissive args-key editor (Mode A) using the existing step `args` keys + `AliasPicker`. Verb-specific Zod schemas (e.g. `search_hybrid` typed inputs) are fetched from the server-side type catalog in plan 07-06+.
- **Multi-select inspector (Mode C)** — UI-SPEC describes a multi-select state; plan 07-05 does not implement it. Single-step (Mode A) and no-selection (Mode B) only. Plan 07-06+.
- **Toolbar (Save / Validate / Open YAML)** — UI-SPEC specifies a 40px toolbar above the three-pane grid; plan 07-05 omits it. Save happens implicitly through `requestSave()`. Plan 07-08 / chrome.
- **Save-success toast + validation banners** — Out of scope; the editor surfaces no toasts in plan 07-05. The `parseYaml(emitYaml(...))` self-check console-warns on codec drift but does not surface to UI.

## Threat Model — Mitigations Implemented

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-07-05-01 (Tampering: `.contract` file load) | ✅ `ContractDocumentSchema.safeParse` runs before mount; failures render the error pane with Zod path; editor never mounts on invalid input. |
| T-07-05-02 (Tampering: palette drop verb) | ⚠️ Partially mitigated — the drop handler accepts any string in the verb MIME slot. The Phase 6 `ContractFileSchema` will reject unknown verbs on the next save round-trip (via `view.ts.emitYamlCompanion` → `parseYaml` → schema validation), but the canvas may briefly render an invalid node. Hardening the drop-time check against `BASELINE_VERBS ∪ peer-MCP ∪ "literal"` is a Plan 07-06+ refinement. |
| T-07-05-03 (DoS: viewport-only saves) | ✅ Per `canvas-pane.svelte` — `onnodedragstop` schedules a 500 ms commit; viewport pan/zoom are NOT bound to a save handler. Only user-initiated mutations (drop, drag, edit) round-trip to disk. |

## Self-Check: PASSED
