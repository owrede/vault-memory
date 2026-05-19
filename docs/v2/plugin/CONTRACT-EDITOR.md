# Contract editor

> Phase 7 / v2.0.0 — vault-memory Obsidian plugin / Last verified: 2026-05-19

The visual contract editor authors Phase 6 task contracts inside Obsidian.
You edit `.contract` JSON files in a three-pane IDE-style view; the plugin
emits canonical YAML on save. The YAML is what the Phase 6 `ContractRegistry`
loads.

> **Screencast:** deferred to Phase 8 — see [ROADMAP.md](../../../.planning/ROADMAP.md).

## Overview

- **Editor surface:** Variant C — palette + canvas + properties inspector
  (see [ADR-007 §D-UI](../adr/007-contract-editor.md#decision-d-ui--variant-c-palette--canvas--properties-inspector)).
- **Source file:** `.contract` JSON, owned by vault-memory
  (`vmFormatVersion: 1`). Authored in the editor; never the build artifact.
- **Build artifact:** `_contracts/<name>.yaml`, written on every save. This
  is what Phase 6 hot-reloads via the `ContractRegistry`.
- **Round-trip safety:** the YAML carries the editor's spatial layout as a
  base64-encoded comment block at the YAML head (`# vm-editor-state: …`).
  External YAML edits survive because the YAML parser ignores the comment;
  the plugin rebuilds the editor view from the comment on reload.

The editor never opens `.canvas` files. Obsidian's built-in Canvas is
unrelated — the plugin registers its own view type for the `.contract`
extension.

## Opening a contract

1. Place a `.contract` file in the vault (e.g. copy
   `examples/contracts/meeting-prep.contract`).
2. Click the file in Obsidian's file explorer.
3. The plugin's `registerExtensions(["contract"])` registration routes the
   file to the visual editor view automatically.

If a JSON view opens instead, the plugin is not enabled in Settings →
Community Plugins. See [INSTALL.md](INSTALL.md) §"Verify the install".

## Three-pane layout

```
┌────────────┬──────────────────────────────┬───────────────────┐
│            │                              │                   │
│  Palette   │           Canvas             │     Inspector     │
│            │      (assembly DAG)          │   (typed forms)   │
│            │                              │                   │
└────────────┴──────────────────────────────┴───────────────────┘
```

### Palette (left)

Five sections, in order:

1. **Type catalog** — `DocId`, `Handle`, `ChunkId`, `MemorySink`. Drag onto
   the `inputs` form in the inspector to type an input field.
2. **Read verbs** — `read_note`, `search_hybrid`, `search_sections`,
   `query_frontmatter`, `list_backlinks`, `get_outline`, `recall`.
3. **Assembly verbs** — `expand`, `cluster`, `compile_brief`, `get_brief`.
4. **Escape-hatch** — `literal` (emit a JS value verbatim into the
   assembly).
5. **Peer-MCP (dynamic)** — populated by querying the running server for
   `[contracts.mcp_clients]` declared verbs. Empty when no peer-MCP clients
   are configured. Refreshes on plugin focus.

Baseline entries 2–4 are compiled into the plugin at build time, sourced from
[`src/contracts/verbs/index.ts`](../../../src/contracts/verbs/index.ts).
Adding a new baseline verb in the server's verb registry surfaces it
automatically in the next plugin build.

### Canvas (center)

Renders the assembly DAG only. Drag a verb from the palette onto the canvas
to add an assembly step. Each step is a node; edges encode `{{alias.field}}`
data flow between steps.

The canvas is **not** an Obsidian Canvas surface. It uses a vault-memory-owned
renderer derived from the spike work (see ADR-007 §"Pitfalls — original
ROADMAP framing rejected").

Node positions persist in the `.contract` file under `editor.nodes`:

```json
"editor": {
  "nodes": [
    { "id": "literal:meeting", "x": 80,  "y": 40 },
    { "id": "expand:context",  "x": 320, "y": 40 },
    { "id": "compile_brief:1", "x": 560, "y": 40 }
  ],
  "selection": null,
  "viewport": { "x": 0, "y": 0, "zoom": 1.0 }
}
```

`inputs`, `sources`, `sinks`, and `write_back` are **not** canvas nodes —
they live in the palette and inspector. Only assembly steps are nodes.

### Inspector (right)

Per-selection typed form, generated from each verb's Zod schema. Three modes
based on the current selection:

- **No selection:** shows the contract metadata form (`name`, `description`,
  `inputs`, `sources`, `sinks`, `required`, `write_back`).
- **Step selection:** shows the args form for the selected verb, plus an
  `as` field for the step's output alias and an optional `where` clause.
- **Edge selection:** shows the `{{alias.field}}` template that flows along
  the edge with autocomplete over in-scope aliases.

The inspector's autocomplete over `{{alias.field}}` is the single biggest
authoring assist — it eliminates the largest source of contract errors
(mistyped alias references). See ADR-007 §D-UI for rationale.

## Save cycle

Every save runs through the following sequence:

1. The editor calls `requestSave()` (Obsidian's view lifecycle hook).
2. The plugin serializes the `.contract` to JSON and writes it to disk.
3. The plugin renders the `contract` block to canonical YAML
   (`yaml ^2.6 toString` of `parseDocument`-mutated AST per Phase 6
   conventions; key order matches the Phase 6 schema; defaults omitted; YAML
   comments preserved).
4. The plugin prepends the `# vm-editor-state: <base64>` line carrying the
   `editor` block.
5. The plugin computes the SHA-256 of the resulting YAML body.
6. The plugin calls the
   [`suppress_contract_write`](../../../src/plugin-tools/suppress-contract-write.ts)
   MCP tool with `{path, hash}` **before** writing the `.yaml`.
7. The plugin writes `<vault>/_contracts/<name>.yaml`.
8. The Phase 6 ChangeFeed handler observes the file event, computes the
   on-disk hash, calls `SuppressionSet.matches(path, hash)` — matches — and
   skips the hot-reload (no echo).

The `SuppressionSet` reuse is verbatim from Phase 6's
[`src/adapters/change-feed/obsidian-fs/suppression.ts`](../../../src/adapters/change-feed/obsidian-fs/suppression.ts).
No new watcher is added in Phase 7.

## External edits

If you edit `_contracts/<name>.yaml` outside the plugin — Obsidian's text
editor, vim, a sync substrate pushing a remote change — the hash will not
match the plugin's last `suppress_contract_write` entry. The Phase 6 handler
re-validates and emits the
`vault-memory://contracts/reloaded` MCP notification.

The plugin's `ReloadNotifier`
([`plugin/src/services/reload-notifier.ts`](../../../plugin/src/services/reload-notifier.ts))
subscribes to that notification. If the changed file maps to an open
`.contract` view, it surfaces a modal:

> **External edit detected.** `_contracts/meeting-prep.yaml` changed outside
> the editor. Reload the editor?
>
> [Reload] [Keep editor state]

- **Reload** — re-imports the YAML, rebuilds the editor view, and discards
  the current editor state. If the external YAML lacks a
  `# vm-editor-state:` comment, the plugin falls back to a deterministic
  left-to-right topological layout.
- **Keep editor state** — leaves the editor view unchanged. The next save
  overwrites the external YAML edits.

## Walkthrough — `examples/contracts/meeting-prep.contract`

1. Open `examples/contracts/meeting-prep.contract` (copy it into your vault
   if needed). The visual editor launches.
2. **Inspector → contract metadata:** the inputs panel shows
   `meeting_doc_id` (typed `DocId`) and `context_hops` (typed `integer`).
   `meeting_doc_id` is marked required.
3. **Canvas:** three assembly nodes render — a `literal` node, an `expand`
   node fed by it, and a `compile_brief` node fed by `expand`.
4. **Inspector → click the `expand` node:** the form shows the `seed` arg
   pointing at `{{meeting.doc_id}}` and a `hops` arg with the value
   `{{inputs.context_hops}}`. Both autocomplete dropdowns surface the
   in-scope aliases.
5. **Edit a value:** change `hops` from `{{inputs.context_hops}}` to
   `{{inputs.context_hops}}` again (no-op) — the inspector validates the
   template against the Zod schema in real time.
6. **Click `Save`** (or `Ctrl/Cmd-S`). The plugin writes
   `meeting-prep.contract` and emits `_contracts/meeting-prep.yaml`. Open
   the YAML in a side pane — note the `# vm-editor-state:` comment on
   line 1 and the canonical key order (matches the Phase 6 schema).
7. **Verify the suppress:** the Phase 6 handler logs no hot-reload event
   for this save (the SuppressionSet matched).
8. **Run the contract:** in an MCP client (Claude Code, MCP Inspector), call
   `instantiate_contract({name: "meeting-prep", inputs: {meeting_doc_id:
   "obsidian://test-vault/meetings/2026-05-19.md", context_hops: 1}})`.
   The output is a compiled brief written to the briefs sink.

## Editor state preservation

`.contract` is the source of truth for the editor; `.yaml` is the build
artifact (D-AUTH). The `editor` block carries:

- `nodes` — `{id, x, y}` per assembly step.
- `selection` — currently selected node or edge id (null = nothing
  selected).
- `viewport` — pan/zoom state.
- `yamlComments` — comments the user authored in the YAML that the editor
  preserves across saves.

When the YAML is the only artifact (external edits, sync from another
device), the editor reconstructs the `.contract` from the YAML plus the
`# vm-editor-state:` comment. If the comment is absent — e.g. a user
authored the YAML by hand — the layout falls back to a deterministic
topological sort. No data loss occurs; only spatial layout is lost.

## Known limitations

- The canvas renders the assembly DAG only. Inputs/sources/sinks/write_back
  are not canvas nodes by design (Variant C). If you prefer a literal-DAG
  surface (Variant A), see the design-variants directory in the Phase 7
  planning folder for the rejected alternatives.
- The editor does not run contracts. Use `instantiate_contract` via any
  MCP client to execute. An in-plugin run surface is deferred to v2.1.
- Visual diff between two `.contract` versions is deferred to v2.x.
- Contract version migration UI is deferred — only relevant when
  `vmFormatVersion` changes from 1 to 2.
- The fallback layout for YAMLs without the editor-state comment is
  deterministic but not necessarily readable; consider re-opening in the
  editor and re-saving once to capture a useful layout.

See also: [SETTINGS.md](SETTINGS.md) for `defaultVault` and reranker toggles
that change retrieval behavior contracts depend on;
[SECRETS.md](SECRETS.md) and [CONNECTORS.md](CONNECTORS.md) for peer-MCP
verbs surfaced in palette section 5.
