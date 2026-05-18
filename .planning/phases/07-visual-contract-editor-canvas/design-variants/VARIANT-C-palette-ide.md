# Variant C — Palette-driven "blueprint" (IDE-like, structured editor)

**Status:** Draft for Phase 7 discuss-phase
**Date:** 2026-05-18
**Author:** Claude (discuss-phase brainstorm)

## Mental model

*"This is an IDE for contracts — Canvas is just the renderer. The palette
is the truth."*

This variant treats Obsidian Canvas as a *render target* for the assembly
DAG only. Inputs, sources, sinks, write_back, and per-step args do not live
as canvas nodes — they live in a palette sidebar and a properties inspector.
The canvas shows the data-flow DAG; everything else is form-edited.

## Visual layout (ASCII)

```
┌─ PALETTE ───────────┐  ┌─ CANVAS (rendered DAG only) ──────────────┐
│ Inputs              │  │                                            │
│   ▢ DocId           │  │  ┌─meeting──┐                              │
│   ▢ integer         │  │  │read_note │                              │
│   ▢ ChunkId         │  │  │doc_id:   │                              │
│   ▢ MemorySink      │  │  │ {{i.md}} │                              │
│                     │  │  └────┬─────┘                              │
│ Read verbs          │  │       ▼                                    │
│   ▣ read_note       │  │  ┌─linked───┐                              │
│   ▣ search_hybrid   │  │  │expand    │                              │
│   ▣ search_sections │  │  │hops:1    │                              │
│   ▣ query_frontmatter│  │  └────┬─────┘                              │
│   ▣ list_backlinks  │  │       ▼                                    │
│   ▣ get_outline     │  │  ┌─clustered┐    ┌─compiled──┐             │
│   ▣ recall          │  │  │cluster   │───►│compile_   │             │
│                     │  │  │method:   │    │ brief     │             │
│ Assembly verbs      │  │  │ edge-com │    │ max_tok:  │             │
│   ▣ expand          │  │  └──────────┘    │  2000     │             │
│   ▣ cluster         │  │                  └────┬──────┘             │
│   ▣ compile_brief   │  │                       ▼ body               │
│   ▣ get_brief       │  │                   ┌──write_back─┐          │
│   ▣ literal         │  │                   │ sink: …     │          │
│                     │  │                   │ kind: brief │          │
│ Peer-MCP            │  │                   └─────────────┘          │
│   ▣ mcp://…         │  │                                            │
│                     │  │                                            │
│ ─────────────────── │  │ ┌─ PROPERTIES (selected node) ───────────┐ │
│ Drag onto canvas    │  │ │ as: clustered                          │ │
│ to add a step       │  │ │ verb: cluster                          │ │
│ ─────────────────── │  │ │ method: edge-community                 │ │
│                     │  │ │ seed_doc_ids: {{linked.doc_ids}}       │ │
│ INPUTS BAR ▼        │  │ │   [autocomplete from upstream aliases] │ │
│  • meeting_doc_id   │  │ └────────────────────────────────────────┘ │
│  • context_hops     │  │                                            │
│ SOURCES BAR ▼       │  │                                            │
│  • default_source   │  │                                            │
│ SINKS BAR ▼         │  │                                            │
│  • default_sink     │  │                                            │
└─────────────────────┘  └────────────────────────────────────────────┘
```

## Mapping rules

| YAML construct                | Canvas / UI representation                              |
|-------------------------------|---------------------------------------------------------|
| `name`, `description`         | Editor header bar (form field), NOT a canvas node       |
| `inputs.<field>`              | Entry in the INPUTS palette panel; typed form           |
| `sources.<handle>`            | Entry in the SOURCES palette panel                       |
| `sinks.<handle>`              | Entry in the SINKS palette panel                         |
| `assembly[i]`                 | One canvas text node (rendered, args minimal)           |
| Step args                     | Properties inspector form (Zod schema → typed fields)   |
| `{{alias.field}}` references  | Dropdown autocomplete in the args form; rendered as edge |
| Edges                         | Ordering + data flow (same as Variant A)                |
| `write_back`                  | Special right-anchored node + properties inspector form |
| `output_shape`                | Properties panel on canvas-level metadata               |

## Authoring flow

1. Header bar prompts for `name` + `description` first (modal-ish).
2. Use INPUTS / SOURCES / SINKS panels to declare slots — each row is a
   typed form (e.g. for an input: name, `$ref` type or primitive, required,
   default).
3. Drag a verb chip from the palette → drops a canvas step node. Editor
   auto-assigns an `as:` alias (e.g. `step1`); user renames inline.
4. Click the step → properties inspector on the right renders a typed form
   from the verb's Zod schema. Filling args is filling form fields, not
   typing YAML.
5. For args that reference upstream output (`{{alias.field}}`), the field
   becomes a dropdown listing all in-scope aliases × their output fields.
6. Drag-connect the last assembly node into the `write_back` panel button;
   the editor stamps a write_back node with a form-driven inspector.
7. Save. The editor serializes its state into both the `.canvas` (geometry +
   step node minimal text) AND the `.yaml` (full contract).

## Round-trip mechanics

- **Source of truth split:** the `.yaml` is the canonical contract; the
  `.canvas` is geometry + step IDs + minimal labels. Inputs / sources /
  sinks / write_back / args live ONLY in YAML, not in canvas nodes.
- **Decompiler reconstructs the canvas** from YAML: each `assembly[i]`
  becomes a step node at a default layout position; edges inferred from
  `{{alias.field}}` references.
- **Re-rendering is non-destructive** because the YAML is authoritative —
  you can delete the `.canvas` and regenerate it.
- **Properties round-trip requires a sidecar OR custom YAML keys.** Without
  a sidecar, properties-inspector-only state (e.g., which palette panel
  was last expanded) is lost on close. That's an acceptable loss, but the
  decision is non-trivial.

## Pros

- **Best authoring UX overall** — typed forms for args eliminate the largest
  source of contract errors (mistyped `{{alias.field}}`, wrong verb args,
  missing required args).
- **Palette is the natural home for the closed-baseline verb enum** (Phase 6
  D-A2a). CAN-04 ("palette nodes for every available assembly tool") is
  satisfied directly and discoverably.
- **Inputs / sources / sinks panels match plain-language mental models**:
  "what does this contract need?", "where does it look?", "where does it
  write?".
- **Zero ambiguity on arg validation** — the form is generated from Zod, so
  the editor can show errors as you type.

## Cons

- **This is not "natural Obsidian Canvas."** It is a custom editor that
  *renders into* Canvas geometry. That implies a real Obsidian plugin (or a
  standalone Electron/web app), which collides with the spike's default
  "no plugin, just file-watcher" recommendation (CAN-01).
- **Watcher-only fallback is broken** for Variant C. Without the plugin,
  users opening a `.canvas` in plain Obsidian see only the bare DAG with
  no panels, no inspector, no palette — they can't edit productively. The
  variant *requires* the plugin to deliver its value.
- **Round-trip story is muddiest.** Most editor state (palette state,
  inspector forms, panel selection) lives outside the canvas. Either we
  add a sidecar `.canvas.meta.json`, or we accept that the editor session
  is non-resumable, or we stuff state into custom YAML keys the contract
  consumer ignores.
- **Highest implementation effort.** Plugin scaffolding, Zod-to-form
  renderer, properties inspector, sidebar UI — substantially more code
  than Variants A/B/D.

## Usability profile

| Metric                 | Rating       | Notes                                       |
|------------------------|--------------|---------------------------------------------|
| Simplicity (visual)    | medium-low   | Three-pane editor; more chrome              |
| Learnability (non-dev) | HIGHEST      | Forms + autocomplete; very accessible       |
| Learnability (dev)     | high         | Familiar IDE pattern                        |
| Error tolerance        | HIGHEST      | Typed forms catch most errors pre-save      |
| Round-trip cost        | high         | Editor state outside canvas needs strategy  |
| Canvas-native fit      | poor         | Canvas is render target, not authoring surf |
| Empty-canvas usability | HIGH         | Palette + panels guide user immediately     |
| Implementation effort  | HIGH         | Plugin required; custom UI surface          |
| Works without plugin   | **NO**       | Broken in plain Obsidian Canvas             |
| Diff-friendliness      | low          | Decompiler-generated geometry varies        |

## Best fit when

- The maintainer is willing to commit to building (and maintaining) an
  Obsidian plugin as part of v2.0.0.
- Audience includes non-developers for whom typed forms are dramatically
  more accessible than free-form YAML-in-text-nodes.
- The spike outcome explicitly approves the plugin path (i.e. resolves
  CAN-01 in favour of plugin, not watcher).

## Worst fit when

- The spike confirms the default (watcher, no plugin) — Variant C would
  effectively be unusable in plain Obsidian.
- Maintainer effort is constrained (solo dev per PROJECT.md). Plugin
  maintenance adds an Obsidian API compatibility surface that costs
  long-term.

## Failure mode for the Phase 7 spike

Variant C *is* the plugin path. If the spike chooses the plugin path, this
is the design. If the spike confirms the watcher default, Variant C is
out — there is no graceful degradation to Variants A/B/D from C because
they have different `.canvas` shapes.

---

*See also:* [VARIANT-A-literal-dag.md](./VARIANT-A-literal-dag.md),
[VARIANT-B-swimlanes.md](./VARIANT-B-swimlanes.md),
[VARIANT-D-whiteboard.md](./VARIANT-D-whiteboard.md),
[SUMMARY-comparison.md](./SUMMARY-comparison.md).
