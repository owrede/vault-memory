---
phase: 7
slug: visual-contract-editor-canvas
status: draft
shadcn_initialized: false
preset: not applicable
component_framework: svelte-5
host_environment: obsidian-plugin-desktop
node_editor: "@xyflow/svelte ^1.5"
created: 2026-05-19
---

# Phase 7 — UI Design Contract

> Visual and interaction contract for the **vault-memory Obsidian plugin**: contract editor (PRIMARY surface) + plugin chrome (SECONDARY surface).
>
> This contract is host-constrained: the plugin runs inside Obsidian's renderer process. The design system inherits Obsidian's CSS custom properties so the plugin renders correctly under every Obsidian theme (default light/dark, Minimal, AnuPpuccin, etc.). No bespoke color, type, or spacing tokens that override the host.
>
> Anchored on Variant C (palette + canvas + inspector, locked by `07-CONTEXT.md` D-UI). Renderer locked on Svelte Flow `@xyflow/svelte` 1.5.2 (locked by `07-RESEARCH.md` §3 and user confirmation). Custom `.contract` JSON file format, opened via `registerView` + `registerExtensions(['contract'])`.

---

## Design System

| Property | Value | Source |
|----------|-------|--------|
| Tool | none (shadcn N/A — Svelte stack, not React) | RESEARCH §"Standard Stack" |
| Preset | not applicable | — |
| Component library | hand-rolled Svelte 5 components + `@xyflow/svelte` 1.5.2 for canvas | CONTEXT D-UI + RESEARCH §3 |
| Host design system | **Obsidian CSS custom properties** (`--background-primary`, `--text-normal`, `--interactive-accent`, etc.) — theme-inheriting | Project convention; CONTEXT "Obsidian chrome" |
| Icon library | **Lucide** (`obsidian.setIcon()` API — Obsidian's bundled icon set) | RESEARCH §"Architecture Patterns" |
| Font | **Inherits Obsidian** — `var(--font-interface)` for chrome, `var(--font-text)` for prose, `var(--font-monospace)` for code/aliases/verb args | Host convention |
| Modal/notice primitives | **Obsidian-native** — `Modal`, `Setting`, `Notice`, `Menu` classes; never custom dialogs | CLAUDE.md adapter-seam discipline applied to UI primitives |
| Bundler | `esbuild` + `esbuild-svelte` | RESEARCH §"Code Examples" |
| Mobile support | **None** — `isDesktopOnly: true` in `manifest.json` | RESEARCH §"Code Examples" Ex. 1 |

**Design system rule (load-bearing):** Every color, font, and spacing token in plugin CSS must reference an Obsidian CSS variable, NOT a hex/px literal. The only literal values permitted are (a) Svelte Flow's internal canvas geometry (controlled by its theme prop), (b) the two-color edge/handle accents declared in §Color, and (c) the two custom z-index values for the toast and inline error banners.

---

## Spacing Scale

Declared values, all multiples of 4. Maps onto Obsidian's `--size-4-*` token family where available, falls back to inline values for cases Obsidian does not expose.

| Token | Value | Obsidian variable (if any) | Usage |
|-------|-------|----------------------------|-------|
| xs | 4px  | `var(--size-4-1)` | Icon gaps; inline form spacing; tag chip padding |
| sm | 8px  | `var(--size-4-2)` | Compact element spacing; palette item padding |
| md | 16px | `var(--size-4-4)` | Default element spacing; pane internal padding; inspector field gap |
| lg | 24px | `var(--size-4-6)` | Section padding; settings group gap |
| xl | 32px | `var(--size-4-8)` | Layout gaps between the three editor panes |
| 2xl | 48px | `var(--size-4-12)` | Empty-state vertical padding |
| 3xl | 64px | — | Reserved; not used in v2.0.0 |

**Exceptions:**
- Canvas node minimum size: **220×120px** (fixed, drives the default left-to-right topo-sort layout per RESEARCH "Default node layout"). Off-scale but pinned by Svelte Flow grid.
- Canvas grid snap: **20px** (Svelte Flow `snapGrid={[20, 20]}`). Off-scale.
- Keyboard focus ring: **2px** outline at `--interactive-accent` — Obsidian's convention is to NOT show a focus ring on hover, so we explicitly add one for keyboard-only accessibility.

---

## Typography

All sizes resolved via Obsidian's font stack. Plugin declares the **role**, the **px size** (resolves against root `font-size` which Obsidian sets), and the **font family slot**.

| Role | Size | Weight | Line Height | Font slot |
|------|------|--------|-------------|-----------|
| Body (inspector labels, panel copy) | 14px | 400 (regular) | 1.5 | `var(--font-interface)` |
| Label (palette item labels, tab titles, setting names) | 13px | 600 (semibold) | 1.4 | `var(--font-interface)` |
| Heading (panel section headings: "Read verbs", "Secrets", "Stats") | 16px | 600 (semibold) | 1.3 | `var(--font-interface)` |
| Mono (alias references `{{step.field}}`, verb arg keys, `mcp://` URIs, JSON previews, SHA hashes) | 13px | 400 (regular) | 1.45 | `var(--font-monospace)` |

**Rules:**
- **Exactly 3 sans-serif sizes + 1 mono size = 4 total.** No display/hero type — plugin chrome is dense IDE-style, not marketing.
- **Exactly 2 weights** (400 + 600). No light, no extra-bold, no italic for emphasis (italic is reserved for inline annotations in error copy).
- Mono is reserved for **machine-readable strings the user must type or read character-by-character**: alias references, verb names, secret names, hashes, paths, base64 editor-state preview. Never use mono for prose.
- Heading line-height 1.3 (tighter than body) keeps multi-line panel titles compact in narrow side panels.

---

## Color

The plugin does NOT declare its own color palette. Every visible color resolves to an Obsidian CSS variable, which is theme-aware. The 60/30/10 split below describes **which Obsidian variable plays which role**, not custom hex values.

| Role | Obsidian variable | Usage |
|------|-------------------|-------|
| Dominant (60%) | `--background-primary` | Editor canvas background; settings tab background; all major panel surfaces |
| Secondary (30%) | `--background-secondary` | Palette pane; inspector pane; stats panel; modal surfaces; canvas node body |
| Accent (10%) | `--interactive-accent` (text on accent: `--text-on-accent`) | **Reserved-for list — see below** |
| Destructive | `--text-error` (background tint: `color-mix(in srgb, var(--text-error) 12%, transparent)`) | Destructive action labels + confirmation modals only |
| Success/info inline | `--text-success` / `--text-muted` | "Connection OK" badges; "Saved → `<path.yaml>`" toast |

**Accent reserved for (closed list — do NOT use anywhere else):**

1. Primary CTA in modals (e.g., the "Save" button in the unsaved-changes confirmation)
2. The single **active/selected** Svelte Flow node border (1px solid `--interactive-accent`)
3. The single **active/selected** edge stroke
4. The keyboard focus ring (2px outline) when the user is keyboard-navigating
5. The "Test connection" green-state badge in PLG-05 (uses `--text-success`, not accent — but listed here so it is unambiguous)
6. The progress bar fill in the reindex toast (PLG-03)
7. The dot indicator next to the tab title when the `.contract` has unsaved changes (matches Obsidian's native unsaved-file dot)

**Anti-rules:**
- Accent is NOT used for hover (use `--background-modifier-hover`).
- Accent is NOT used for hyperlinks within plugin copy (use `--text-accent`).
- Accent is NOT used for the active palette item (use a 1px left-border in `--interactive-accent`, but the fill stays `--background-secondary`).
- Validation severity is NOT color-only — every error/warning carries a text label (`Error:` / `Warning:`) to meet WCAG 1.4.1.

---

## Copywriting Contract

All copy is **English-only** in v2.0.0 (i18n deferred). Tone: technical, second-person, no marketing language. Mirrors Obsidian's own copy register.

### Editor surface (PRIMARY — `.contract` view)

| Element | Copy |
|---------|------|
| **Primary CTA (toolbar save button)** | `Save` (icon: `save`; tooltip: "Save contract (Cmd-S)") |
| **Secondary CTA (toolbar)** | `Validate` (icon: `check-circle`; tooltip: "Validate contract schema") |
| **Tertiary CTA (toolbar)** | `Open YAML` (icon: `file-text`; tooltip: "Open the emitted `.yaml` companion") |
| **Empty-canvas state heading** | `New contract` |
| **Empty-canvas state body** | `Drag a verb from the palette to add the first step. Or pick a starter:  meeting-prep · project-status · code-review-brief` (the three starter names are clickable; clicking inserts the corresponding reference contract) |
| **Empty-inspector state (nothing selected)** | Heading: `Contract details` — body shows the contract-level form (`name`, `description`, `inputs`, `sources`, `sinks`, `write_back`). Never blank. |
| **Multi-selection inspector state** | `{N} steps selected` (no editable fields shown; only Delete and Group actions) |
| **Save-success toast (Notice)** | `Saved → _contracts/{name}.yaml` (5s, `--text-success` left-border) |
| **Save-blocked-by-validation toast** | `Cannot save: {N} validation errors. Open the inspector to fix.` (sticky until dismissed; offers `Save anyway` only when severity is warning-only) |
| **External-edit prompt (D-WATCH-SERVER-NOTIFY)** | Modal title: `External edit detected`. Body: `The YAML for "{name}" was changed outside the editor. Reload editor view? Your unsaved spatial layout will be regenerated.` Buttons: `Reload` (primary) / `Keep editor state` (secondary) |
| **Malformed `.contract` banner** | `This contract file is malformed and cannot be edited visually. {error_summary}` — actions: `Open as text` / `Reset to blank contract` |
| **Server-unreachable banner** | `vault-memory server is not running. Some features (validation, peer-MCP palette, save) are disabled.` — actions: `Start server` (runs `vm-install` skill check) / `Retry connection` / `Open settings` |

### Plugin chrome (SECONDARY)

| Element | Copy |
|---------|------|
| **Settings tab heading** | `vault-memory` (matches Obsidian convention; one-word plugin name) |
| **Settings — Restart-required flag** | Inline pill after the setting name: `Restart required` (background `--background-modifier-warning`, text `--text-warning`) |
| **Secrets panel empty state** | Heading: `No secrets stored`. Body: `Secrets are encrypted with your operating system's keychain. They are local to this device — secrets you add here will not work on another machine until you re-enter them.` CTA: `Add secret` |
| **Secrets — add modal** | Title: `Add secret`. Fields: `Name` (text), `Value` (password input, masked). CTA: `Store` (primary) / `Cancel`. After save: secret value is never shown again. |
| **Secrets — destructive confirm** | Modal title: `Delete secret "{name}"?`. Body: `This cannot be undone. Connectors referencing this secret will fail until re-added.` Buttons: `Delete` (destructive) / `Cancel` |
| **Reindex CTA (primary)** | `Reindex this vault` |
| **Reindex CTA (secondary)** | `Reindex all vaults` |
| **Reindex confirm modal** | Title: `Reindex "{vault_name}"?`. Body: `This will re-embed every note in the vault. Estimated time depends on note count and embedding model.` Buttons: `Reindex` (primary) / `Cancel` |
| **Reindex progress toast** | `Reindexing {vault}: {chunks_done} / {chunks_total} chunks ({elapsed})` — bottom-right Notice with progress bar fill in accent |
| **Reindex error toast** | `Reindex failed: {reason}. See vault-memory log for details.` (sticky) |
| **Stats panel — empty/no-data state** | `Stats are unavailable while the vault-memory server is starting. Try again in a moment.` CTA: `Refresh` |
| **Connectors panel empty state** | Heading: `No peer-MCP clients`. Body: `Peer MCP clients let your contracts call tools on other MCP servers (e.g., a code-review MCP).` CTA: `Add client` |
| **Connectors — test connection states** | Idle: `Test connection`. Pending: `Testing…`. OK: `Connected ✓` (success color). Fail: `Connection failed — {short_reason}` (error color) |
| **Connectors — destructive confirm** | Modal title: `Remove "{name}"?`. Body: `Contracts using this client will fail to instantiate until the client is re-added or contracts are edited.` Buttons: `Remove` (destructive) / `Cancel` |

### Destructive actions (full inventory)

| Action | Location | Confirmation copy | Modal type |
|--------|----------|-------------------|------------|
| Delete a step from canvas | Editor, `Delete` / `Backspace` on selected node | `Delete step "{alias}"? Downstream steps referencing {{` `{alias}.* }}` `will become invalid.` | Modal — `Delete` (destructive) / `Cancel` |
| Reset malformed contract to blank | Malformed-contract banner | `Reset this contract? The current malformed content will be overwritten. There is no undo for this action.` | Modal — `Reset` (destructive) / `Cancel` |
| Delete a secret | Secrets panel | (see above) | Modal |
| Remove a peer-MCP client | Connectors panel | (see above) | Modal |
| Reindex (any vault) | Reindex panel | (see above — not technically destructive but blocks the server for the duration) | Modal |
| Discard unsaved changes (close `.contract` tab with edits) | Obsidian tab close | Uses Obsidian's native unsaved-changes prompt (`Save / Don't save / Cancel`). Plugin does not override. | Obsidian-native |

---

## Layout — Editor Surface (Variant C, locked)

Anchored on `design-variants/VARIANT-C-palette-ide.md`. No layout alternatives are open for discussion.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Tab title: "{name}.contract" • [unsaved-dot]                              │
│ Toolbar:  [Save] [Validate] [Open YAML] · · ·  [Zoom −][1.0×][Zoom +][Fit]│
├──────────┬──────────────────────────────────────────────┬─────────────────┤
│ PALETTE  │  CANVAS (Svelte Flow — assembly DAG only)    │  INSPECTOR      │
│ (260px)  │  (flex)                                       │  (320px)        │
│          │                                               │                 │
│ ▸ Types  │   ┌──────────┐                                │ When 1 node    │
│ ▸ Read   │   │ meeting  │                                │ selected:      │
│ ▸ Assbly │   │ read_note│──┐                             │  Zod-derived   │
│ ▸ Literal│   └──────────┘  │                             │  form          │
│ ▸ Peer   │              ┌──▼──────────┐                  │                │
│  MCP     │              │ linked      │                  │ When nothing:  │
│          │              │ expand h:1  │                  │  Contract-     │
│          │              └─────────────┘                  │  level form    │
│          │                                               │  (name, desc,  │
│          │                                               │  inputs,       │
│          │                                               │  sources, ...) │
│          │                                               │                │
│          │                                               │ When N>1:      │
│ Inputs ▼ │                                               │  "{N} steps    │
│ Sources▼ │                                               │   selected"    │
│ Sinks  ▼ │                                               │  + Delete /    │
│ Write_back▼                                              │  Group actions │
└──────────┴──────────────────────────────────────────────┴─────────────────┘
```

### Pane sizing

| Pane | Default | Min | Max | Resize |
|------|---------|-----|-----|--------|
| Palette (left) | 260px | 200px | 400px | Drag-handle on right edge; persisted to `data.json` |
| Canvas (center) | flex | — | — | Auto |
| Inspector (right) | 320px | 240px | 480px | Drag-handle on left edge; persisted to `data.json` |
| Toolbar height | 40px | fixed | fixed | — |

### Toolbar contents (left-to-right)

1. `[Save]` — icon `save`. Disabled when no unsaved changes. Cmd-S / Ctrl-S.
2. `[Validate]` — icon `check-circle`. Always enabled. Shows inline error count badge if validation errors exist.
3. `[Open YAML]` — icon `file-text`. Opens the emitted `_contracts/{name}.yaml` in a side-pane Obsidian text view. Disabled until first save.
4. Spacer (flex).
5. `[Zoom −]` `[1.0×]` `[Zoom +]` `[Fit to view]` — canvas viewport controls. The center label is a click-to-reset-to-100% button. `[Fit to view]` icon `maximize`.

No additional toolbar items in v2.0.0. Undo/redo is handled by Svelte Flow's built-in history (Cmd-Z / Cmd-Shift-Z) — does not appear in the toolbar.

---

## Palette Structure (CAN-04 — full verb surface)

The palette has **five collapsible sections** plus **four panel-bar groups** at the bottom (Inputs/Sources/Sinks/Write_back). Sections collapse-state persists per-plugin (not per-contract) in `data.json`.

### Sections (top — drag-to-canvas)

| Section | Default state | Source | Items |
|---------|---------------|--------|-------|
| **Types** | collapsed | `src/contracts/types-catalog.ts` (compile-time import) | `DocId`, `Handle`, `ChunkId`, `MemorySink` |
| **Read verbs** | expanded | `src/contracts/verbs/index.ts` (compile-time enum) | `read_note`, `search_hybrid`, `search_sections`, `query_frontmatter`, `list_backlinks`, `get_outline`, `recall` |
| **Assembly verbs** | expanded | same enum | `expand`, `cluster`, `compile_brief`, `get_brief` |
| **Escape-hatch** | collapsed | same enum | `literal` |
| **Peer-MCP** | collapsed; **hidden** when empty | MCP `list_contract_verbs` Resource — refreshed on plugin focus + on `notifications/tools/list_changed` | Dynamic per `[contracts.mcp_clients]` |

### Panel bars (bottom — accordion, contract-level state)

| Bar | Opens to | Behavior |
|-----|----------|----------|
| **Inputs ▼** | List of declared inputs (`name`, type ref, required flag); `[+ Add input]` CTA | Click an input row → inspector shows inspector form for that input |
| **Sources ▼** | List of declared sources by handle; `[+ Add source]` | Click → contract-level inspector scrolls to `sources` group |
| **Sinks ▼** | Same pattern | Same |
| **Write_back ▼** | Single write-back declaration form (or `[+ Declare write_back]` if absent) | Single-row, never a list |

### Palette item visual contract

```
┌─ Read verbs ───────── ▾ ┐
│ ▸ read_note            │   ← search-icon prefix; mono font for verb name
│ ▸ search_hybrid        │
│ ▸ search_sections      │
│ ▸ query_frontmatter ⊗  │   ← ⊗ = "blocked by missing dependency" tag (rare; on hover shows reason)
│ ▸ ...                  │
└────────────────────────┘
```

- **Item label:** mono font (`var(--font-monospace)`), 13px regular.
- **Item left padding:** 16px; left border 2px transparent → `--interactive-accent` when item is being dragged.
- **Drag affordance:** entire row is draggable; cursor `grab` on hover, `grabbing` during drag; drop target on the canvas glows with a 2px dashed outline in `--interactive-accent`.
- **Drop preview:** while dragging, the canvas shows a ghost node at the cursor position in the verb's color (`--background-secondary` + dashed border).
- **Recently used / favorites:** **out of scope for v2.0.0.** All items shown in declared order.
- **Search/filter:** a single search input at the top of the palette filters across all sections. ESC clears.

---

## Canvas Interaction Grammar

Locked to Svelte Flow defaults except where called out.

### Node types

Only **one node type** in v2.0.0: `StepNode` (one Svelte Flow node per `assembly[i]` entry). Inputs/sources/sinks/write_back are NOT nodes (per VARIANT-C lock).

**StepNode visual contract:**

```
┌──────────────────────┐
│ ● {alias}            │   ← top-left: status dot (●=ok, ⚠=warning, ✕=error); alias in mono semibold
│ {verb}               │   ← verb name in mono regular, smaller
│                      │
│ ◯ (left handle)      │   ← read_back inputs
│              (right) ◯   ← outputs to downstream steps
└──────────────────────┘
```

- Size: **220×120px** fixed.
- Background: `--background-secondary`.
- Border: 1px solid `--background-modifier-border` (idle); 1px solid `--interactive-accent` (selected); 1px solid `--text-error` (validation error).
- Status dot colors: `--text-success` / `--text-warning` / `--text-error`.
- Handles: 8px diameter circles at vertical center of left and right edges. Hover state grows to 12px.

### Edge types

Only **one edge type** in v2.0.0: read-back edge. Edges are derived from `{{alias.field}}` references in step args.

- **Style:** smooth bezier (Svelte Flow `default` edge); 1.5px stroke; `--text-muted` idle; `--interactive-accent` selected.
- **Arrow head:** Svelte Flow default `arrowclosed` at target.
- **Edge label:** the source field path in mono 11px (`{step.field}`) at the edge midpoint, with `--background-primary` background pill. Hidden at zoom < 0.6.
- **Step-ordering edges (implicit dependency edges without read-back):** **not rendered in v2.0.0.** Assembly order is derived from topological sort + tiebreak by node Y position; users do NOT draw explicit ordering edges. (Future: a dashed-gray "ordering only" edge type. Deferred.)

### Interactions

| Action | Trigger | Effect |
|--------|---------|--------|
| Add step | Drag verb from palette → drop on canvas | Inserts `StepNode` at drop position; auto-assigns `as: step{n}` alias; selects new node; inspector switches to that step's form |
| Add step (keyboard) | Cmd-K / Ctrl-K → fuzzy verb picker → Enter | Same as drag-drop; node placed at viewport center |
| Select single | Left-click node | Selects; inspector switches |
| Select multiple | Shift-click or marquee-drag on empty canvas | Adds to selection; inspector shows "{N} selected" |
| Deselect | Click on empty canvas | Clears selection; inspector shows contract-level form |
| Wire read_back | Drag from a step's right handle to another step's left handle | Creates edge; opens inspector at the target step's argument that received the binding |
| Wire read_back (keyboard) | With one step selected, press `W` → fuzzy picker of in-scope aliases × fields | Inserts `{{alias.field}}` into the first eligible arg of the next step or prompts which arg |
| Delete step | `Delete` or `Backspace` on selected node(s) | Destructive confirm modal (see Copywriting); on confirm, removes node + all dangling edges + warns about downstream refs |
| Delete edge | `Delete` on selected edge | No confirm; removes the `{{alias.field}}` reference from the target arg |
| Undo / Redo | Cmd-Z / Cmd-Shift-Z (Ctrl-Z / Ctrl-Y on Windows/Linux) | Svelte Flow history; tracks node add/remove/move + edge add/remove + inspector field edits |
| Move node | Drag node body | Snaps to 20px grid; updates `editor.nodes[i].x/y` |
| Pan canvas | Space-hold + drag, OR middle-click drag, OR two-finger trackpad | Updates `editor.viewport`; saves to disk only on idle 5s+ |
| Zoom | Cmd/Ctrl + scroll, OR pinch trackpad, OR toolbar buttons | Range 0.25–2.0; default 1.0; viewport saves on idle |
| Fit to view | `F` key or toolbar button | Auto-fit all nodes with 40px margin |
| Tab focus through nodes | `Tab` cycles palette → canvas-first-node → other-nodes → inspector → toolbar | Each node receives 2px accent focus ring; Enter on focused node selects it; Arrow keys move focused node by 20px |

**Save behavior:**
- **User-initiated mutations** (add/delete/move/wire/edit field) → call `requestSave()` immediately.
- **Viewport-only changes** (pan, zoom) → debounce 5s of idle; commit only when a user-initiated save also triggers.
- **Unsaved-state indicator:** tab title shows a dot (Obsidian native behavior for `TextFileView`); plugin does NOT add a second indicator.

**Reordering execution order (Phase 6 `assembly[i]` is ordered):**
- Order is derived deterministically on emit: **topological sort by read_back dependency, tiebreaker by node Y position ascending, then X position ascending** (RESEARCH "Default node layout").
- No explicit "reorder" UI in v2.0.0. To force a step earlier, the user moves the node up on canvas. The inspector shows the computed execution index (`Step 3 of 7`) read-only.

---

## Properties Inspector — Behavior

The inspector is **always populated**. Three modes:

### Mode A: Single step selected
- Header: `▣ {alias}` (mono semibold) + verb badge.
- Form: generated from the verb's Zod schema via `zod-to-form.ts` (RESEARCH §"Standard Stack" — Zod 4 `.toJSONSchema()` + ~150 LOC Svelte form renderer).
- Field types supported in v2.0.0:
  - **String** → `<input type="text">` (Obsidian-styled)
  - **Number / integer** → `<input type="number">` with min/max from schema
  - **Boolean** → Obsidian `Toggle`
  - **Enum (closed set)** → Obsidian `Dropdown`
  - **Alias reference (`{{alias.field}}` token)** → custom **AliasPicker** widget: mono `<input>` + button that opens a tree picker of in-scope aliases × their output fields (sourced from Phase 6 `list_contract_verbs` Resource). Typing `{{` triggers autocomplete inline. Invalid alias references underline in `--text-error`.
  - **Array** → `ArrayEditor`: vertical list of typed entries + `[+ Add]` + `[− Remove]` per row
  - **Object (nested record)** → recurses; uses indented Svelte `<details>` block
  - **Free-form `unknown` / `Record<string, unknown>`** → JsonEditor (Monaco-free; a styled `<textarea>` with JSON.parse validation on blur; future: replace with a small CodeMirror 6 embed)
- Validation: runs **on blur** of each field AND **on save**. Inline error text below the field in `--text-error` with `Error:` prefix. Warnings (non-blocking) in `--text-warning` with `Warning:` prefix.

### Mode B: Nothing selected (default)
- Header: `Contract details`.
- Form: contract-level fields — `name`, `description`, `inputs` list, `sources` list, `sinks` list, `output_shape`, `write_back`.
- This is the FIRST screen a user sees when opening an empty `.contract` — it doubles as the empty-state surface.

### Mode C: Multiple steps selected
- Header: `{N} steps selected`.
- Body: no form. Only two actions: `Delete selected` (destructive) and `Group as subassembly` (deferred to v2.x — button shown but disabled with tooltip "Coming in v2.1").

**Reference picker for `{{alias.field}}` tokens — explicit behavior:**

Typeahead-with-tree-picker hybrid:
1. While the user types `{{` in any string field, an inline dropdown appears anchored below the cursor.
2. The dropdown shows in-scope aliases (steps declared **earlier** in execution order than the current step) as a single flat list.
3. Hitting `.` after an alias narrows to that alias's output fields (read from the verb's output Zod schema).
4. ESC closes; Tab/Enter accepts the highlighted suggestion and inserts `{{alias.field}}` into the field.
5. The picker button (`[…]`) next to the field opens the same picker as a modal tree (alias → fields).

---

## State Inventory (every required visual state)

| State | When | Visual |
|-------|------|--------|
| **Loading — opening `.contract`** | While JSON parse + schema validate runs | Center spinner with copy `Loading {filename}.contract…`; canvas dimmed |
| **Empty — new file** | `.contract` has no `assembly[]` entries | Empty canvas with empty-state heading + body (see Copywriting); palette + inspector fully interactive |
| **Populated — happy path** | Valid contract with steps | Standard three-pane layout |
| **Saving** | Between `requestSave()` and the file-write Promise resolving | Save button shows spinner; tab unsaved-dot remains until success |
| **Save success** | File written + suppression registered + YAML emitted | Toast: `Saved → _contracts/{name}.yaml` (5s) |
| **Save failed — validation errors** | Schema validation rejects on save | Modal/toast (sticky): error count + "open inspector to fix" CTA; save button stays enabled |
| **Save failed — IO error** | Vault adapter write throws | Sticky toast: `Save failed: {short_reason}. Retry or check the vault-memory log.` |
| **Server unreachable** | MCP client connection lost or never established | Banner across top of editor pane (above toolbar) with three actions (see Copywriting) |
| **Malformed `.contract`** | JSON parse or `vmFormatVersion` mismatch | Banner replaces canvas with two actions (see Copywriting) |
| **External edit detected** | MCP `notifications/contracts/reloaded` arrives for an open file | Modal (see Copywriting) — user picks reload vs keep |
| **Stale palette (peer-MCP)** | `list_contract_verbs` Resource has not been fetched in >60s | Palette section header shows tiny `↻ refreshing` text; auto-refreshes |
| **Validation pending** | Any field changed since last validation pass | Toolbar `Validate` button shows a pulsing dot until next debounce-tick (300ms) |
| **Multi-select on canvas** | Marquee or shift-click selected ≥2 nodes | Selected nodes get accent border; inspector shows count + actions |
| **Drag-source-active (palette)** | User is dragging a verb chip | Canvas shows ghost preview; valid drop zones glow (currently: anywhere on the canvas pane) |
| **Connection-failed (PLG-05)** | "Test connection" returned error | Inline error text under the entry + red status dot |

---

## Accessibility (WCAG 2.2 AA — required)

| Requirement | Implementation |
|-------------|----------------|
| **Keyboard navigation through all three panes** | Tab order: toolbar → palette (search, then sections in declared order, items within section) → canvas (focuses first node, then arrow keys within canvas) → inspector (header, then form fields top-to-bottom) → back to toolbar |
| **Keyboard shortcuts** | Save: Cmd/Ctrl-S · Validate: Cmd/Ctrl-Shift-V · Open YAML: Cmd/Ctrl-Shift-Y · Fuzzy verb add: Cmd/Ctrl-K · Fit to view: F · Undo/Redo: Cmd/Ctrl-Z / Cmd/Ctrl-Shift-Z · Delete: Delete or Backspace · Multi-select: Shift+click or marquee · Wire-mode: W (when one node selected) |
| **Focus indicators** | 2px solid outline in `var(--interactive-accent)` on every focusable element. Explicitly declared because some Obsidian community themes strip the default focus ring. Outline-offset 2px so it doesn't crowd 1px borders. |
| **Screen reader: DAG access** | The canvas is a visual surface; the inspector + palette are the SR-accessible authoring surface. The canvas exposes an **accessible linear outline** via ARIA: `<nav aria-label="Contract steps in execution order"><ol>` with one `<li>` per step (alias + verb + brief arg summary). Hidden visually unless `prefers-reduced-motion: reduce` AND screen-reader mode detection trips, in which case it replaces the canvas. (Detection is heuristic — Obsidian does not expose an "SR active" signal — but the linear outline is always reachable via a `Skip to linear view` link that becomes visible on keyboard focus.) |
| **ARIA live regions** | One `aria-live="polite"` region announces selection changes ("Step `linked` selected; verb expand") and save/error toasts. One `aria-live="assertive"` region announces validation errors on save attempts. |
| **Color contrast** | Plugin uses Obsidian variables which pass AA in the default themes. The plugin runs an automated AA contrast check in CI (`plugin/tests/contrast.test.ts`) against the **default Obsidian light + dark themes only**; community themes are explicitly out of scope (any failure under a community theme is the theme's bug). Custom-color uses (selection border, edge stroke, focus ring) are individually contrast-validated. |
| **Motion** | Respects `prefers-reduced-motion: reduce` — disables Svelte Flow's pan/zoom inertia, edge-draw animation, and toast slide-in. Static fades only. |
| **Touch targets** | Plugin is desktop-only — touch targets not enforced. Handles on canvas nodes are 8px (12px on hover) which is below mobile guidance but acceptable for mouse use. |
| **Minimum interactive element size** | 32×32px for icon buttons (toolbar, panel headers); 16px row height minimum for palette items. |
| **Forms (inspector)** | Every input has an associated `<label>` (the field name); required fields marked with `aria-required="true"` and a visible `*`; validation errors use `aria-describedby` linking to the inline error text. |
| **Color is never the sole indicator** | All status uses an icon **plus** a text label. The validation status dot is paired with a tooltip reading the error message. |

---

## Motion & Micro-Interaction Policy

| Surface | Default motion | `prefers-reduced-motion: reduce` |
|---------|----------------|----------------------------------|
| Canvas pan/zoom | Svelte Flow default inertia (~150ms decay) | Disabled — direct response |
| Canvas node drag | Real-time follow + 100ms ease-out on release snap-to-grid | Snap-to-grid is instant on release; no ease |
| Edge draw on wire | Svelte Flow default (animated bezier extension) | Static line draw |
| Palette drag ghost | 80ms fade-in of ghost element | Instant appearance |
| Toast slide-in (Notice) | 120ms slide-up + fade-in | Fade-only |
| Modal open/close | Obsidian-native (do not override) | Obsidian-native |
| Validation status dot pulse | 1.2s pulse loop while validation pending | Static dot only |
| Inspector mode transitions | 80ms cross-fade between Mode A/B/C | Instant swap |
| Focus ring | Instant (no animation) | Same |

**No decorative motion.** Every animation listed above signals a state change. Onboarding animations, idle "breathing" effects, and similar are **out of scope.**

---

## Component Inventory (concrete — for planner & executor)

### Editor surface (`plugin/src/views/contract-editor/`)

| Component | Role | Inputs (props) | Owns |
|-----------|------|----------------|------|
| `ContractEditorView` (`view.ts`, extends `TextFileView`) | Obsidian view host | `WorkspaceLeaf` | Mount/unmount Svelte root; file lifecycle |
| `Editor.svelte` | Three-pane root | `file: ContractFile`, `onChange` | Layout, pane resize state |
| `Toolbar.svelte` | Top toolbar | `dirty: boolean`, `errorCount: number`, callbacks | Save / Validate / Open YAML / Zoom controls |
| `PalettePane.svelte` | Left pane container | `mcpClient`, `searchQuery: string` | Section accordion state |
| `PaletteSection.svelte` | One collapsible group | `title`, `items`, `expanded` | Expand/collapse |
| `PaletteItem.svelte` | One draggable row | `verb` or `type` or `peerMcpRef` | Drag handlers |
| `PalettePanelBar.svelte` | Bottom-of-palette panel (Inputs/Sources/Sinks/Write_back) | `bar` (one of four) | Open/close |
| `CanvasPane.svelte` | Center pane | `nodes`, `edges`, callbacks | Svelte Flow wrapper config |
| `StepNode.svelte` | Custom Svelte Flow node | `data: { alias, verb, status, errorCount }` | Render |
| `InspectorPane.svelte` | Right pane | `selection`, `contract`, callbacks | Mode A/B/C routing |
| `ZodForm.svelte` | Generated form from Zod schema | `schema`, `value`, `onChange` | Field-by-field rendering |
| `TextField.svelte` | Single text input with inline error | `name`, `value`, `error`, `required` | Blur validation |
| `NumberField.svelte` | Number input with min/max | same shape | — |
| `BooleanToggle.svelte` | Wraps Obsidian `Toggle` | same shape | — |
| `EnumDropdown.svelte` | Wraps Obsidian `Dropdown` | `options`, `value` | — |
| `AliasPicker.svelte` | `{{alias.field}}` typeahead + tree picker | `scope: AliasField[]`, `value` | Picker dropdown state |
| `ArrayEditor.svelte` | Add/remove rows of a typed array | `itemSchema`, `value[]` | Add/remove |
| `JsonEditor.svelte` | Styled `<textarea>` for `Record<string, unknown>` | `value`, `onChange` | Parse-on-blur validation |
| `ValidationBanner.svelte` | Sticky top banner inside editor | `severity`, `message`, `actions[]` | Dismiss |
| `MalformedBanner.svelte` | Replaces canvas when file is invalid | `error`, two actions | Reset / Open as text dispatch |
| `ServerUnreachableBanner.svelte` | Above toolbar when MCP client disconnected | callbacks | Retry / Start server / Open settings |

### Plugin chrome (`plugin/src/chrome/`)

| Component | Role | Notes |
|-----------|------|-------|
| `VaultMemorySettingsTab` (`settings-tab.ts`, extends `PluginSettingTab`) | Settings tab root | Uses Obsidian `Setting` primitive throughout |
| `SecretsPanel.svelte` | List + add + delete secrets | Below or beside settings; clearly grouped under heading `Secrets` |
| `AddSecretModal` (extends Obsidian `Modal`) | Add secret form | Password input; never echoes value |
| `ConfirmDeleteSecretModal` (extends Obsidian `Modal`) | Destructive confirm | — |
| `ReindexPanel.svelte` | Two CTAs + progress display | Polls MCP `progress` notifications |
| `ReindexProgressNotice` (uses Obsidian `Notice` constructor) | Bottom-right progress toast | Replaces itself in place; uses `setMessage` |
| `StatsPanel.svelte` | Read-only stats grid | Refresh button at top-right |
| `ConnectorsPanel.svelte` | List + add + remove + test-connection per peer-MCP | — |
| `AddConnectorModal` (extends `Modal`) | Add peer-MCP form | Fields: `name`, `command`, `args`, `env_secrets` (multi-select from PLG-02 secrets) |

### Stats panel location decision

The stats panel (PLG-04) is **integrated into the Settings tab** as a labelled section (`Stats`) below the runtime config. Justification: single discovery surface for plugin chrome; matches Obsidian convention where status info appears in plugin settings. Alternatives considered:
- Sidebar pane: rejected — sidebars are reserved for content navigation in Obsidian's UX register.
- Command-palette modal: rejected — modals are transient; users want to glance and leave.
- Status bar item: rejected — status bar is for single-line passive info, not panels.

---

## File Save Lifecycle (load-bearing — see RESEARCH "Pattern 2", D-AUTH, D-WATCH-PLUGIN-OUT)

On any user-initiated mutation:

1. Plugin updates in-memory `ContractFile` (`{ $schema, vmFormatVersion, contract, editor }`).
2. Svelte component calls `view.requestSave()`.
3. Obsidian calls `view.getViewData()` — plugin returns `JSON.stringify(currentJson, null, 2)`.
4. Obsidian writes `.contract` to disk.
5. **In parallel**, plugin emits the companion YAML:
   - a. Canonicalize the `contract` block per `codec/canonicalize.ts` (key order = ADR-006 schema order; default omitting; description block scalars preserved).
   - b. Encode `editor` block as base64; prepend `# vm-editor-state: <base64>\n`.
   - c. Compute SHA-256 of the **YAML body** (excluding the leading editor-state comment line, to keep the suppression hash content-stable across editor-state churn — open question for plan 07-01: include or exclude the comment line in hash).
   - d. MCP call `suppress_contract_write({ path: '_contracts/{name}.yaml', hash })`.
   - e. `app.vault.adapter.write('_contracts/{name}.yaml', yamlText)`.
6. Obsidian's vault watcher fires; server `loader.ts` calls `suppression.consume(path, hash)` → matches → skips reload.
7. UI shows save-success toast with path: `Saved → _contracts/{name}.yaml`.

**Open YAML CTA** opens the just-written `.yaml` in a side-pane read-only Obsidian view (`workspace.openLinkText({path}, '', 'split')`).

**Autosave behavior:** matches the Obsidian user's global "Always update internal links" / autosave setting. The plugin does NOT override the Obsidian default — if Obsidian is configured for explicit-save, the plugin respects it; if autosave, every `requestSave()` round-trips immediately.

**Save discoverability:** the save-success toast is the canonical signal that the YAML was emitted. The toast persists for 5s and includes the YAML path. Clicking the path in the toast opens the YAML in a side pane.

---

## Skeleton MVP Slice (smallest end-to-end UI for the spike, CAN-10)

Matches `mvp` mode of this phase. The spike's UI deliverable:

1. Plugin loads, registers view + extension.
2. User opens `examples/contracts/meeting-prep.contract`.
3. Editor renders three panes; canvas shows the assembly DAG via Svelte Flow with the default LTR topo layout.
4. User clicks one step node → inspector shows the verb's form populated from the contract.
5. User edits one field (e.g., `hops` from 1 to 2).
6. User presses Cmd-S → save lifecycle runs → `_contracts/meeting-prep.yaml` on disk reflects the change → toast shows the path.
7. Open YAML CTA opens the new YAML in a side pane.

**What the skeleton OMITS:** PLG-01..PLG-05 chrome (other than a minimal manifest install path), peer-MCP palette section, validation banners beyond inline field errors, secrets, reindex, stats, connectors, malformed-file handling, external-edit prompt, accessible linear outline. These are all required for v2.0.0 but **not for the spike gate**.

---

## Out of Scope for v2.0.0 UI (anchored to CONTEXT `<deferred>`)

- Mobile / tablet (plugin is `isDesktopOnly: true`)
- i18n — English only
- Theming customization beyond Obsidian theme inheritance
- Real-time multi-user collaborative editing
- Animated onboarding tutorial — README + screencast (`D-SCREENCAST`) is the onboarding
- Recently-used / favorite palette items
- Subassembly grouping (button shown disabled)
- Visual diff between `.contract` versions
- Stats time-series / graphs
- Per-peer-MCP capability inspection beyond verb names
- Cloud-source connector UI (deferred to Phase 10 / v3)
- Multi-vault workspace plugin config
- External secret stores beyond Electron `safeStorage`
- Web-based version of the editor
- Mobile responsive layouts
- Incremental reindex progress beyond what MCP SDK 1.29 emits
- Step-ordering edges (dashed dependency edges)
- Plugin telemetry (permanently rejected)

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none — shadcn is React-only and this is a Svelte plugin | not applicable |
| Third-party shadcn registries | none | not applicable |
| `@xyflow/svelte` 1.5.2 | Svelte Flow renderer + custom node primitives | RESEARCH §"Package Legitimacy Audit" verified — MIT, 107K weekly installs, same team as React Flow. No `shadcn view` equivalent for Svelte ecosystem; legitimacy gate satisfied by RESEARCH manual audit on 2026-05-19. |
| Obsidian SDK | `Plugin`, `TextFileView`, `PluginSettingTab`, `Setting`, `Modal`, `Notice`, `Menu`, `setIcon` — all platform primitives | not applicable (host platform, not third-party UI) |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — every state has explicit copy; destructive actions enumerate confirmation copy; CTAs are specific verb+noun
- [ ] Dimension 2 Visuals: PASS — Variant C three-pane layout is fully specified with sizes, min/max, resize behavior, and component inventory
- [ ] Dimension 3 Color: PASS — Obsidian variables drive 60/30/10; accent reserved-for list is closed and explicit
- [ ] Dimension 4 Typography: PASS — exactly 4 type roles (3 sans + 1 mono), exactly 2 weights, all sized in px with line-height
- [ ] Dimension 5 Spacing: PASS — multiples of 4, mapped to Obsidian `--size-4-*` tokens, exceptions enumerated (canvas grid 20px, node 220×120)
- [ ] Dimension 6 Registry Safety: PASS — shadcn not applicable; the one third-party UI dep (`@xyflow/svelte`) was vetted in RESEARCH

**Approval:** pending — awaiting `gsd-ui-checker` review
