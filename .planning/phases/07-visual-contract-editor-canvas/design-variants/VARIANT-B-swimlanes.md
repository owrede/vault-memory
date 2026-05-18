# Variant B — Swimlane by section (form-meets-graph)

**Status:** Draft for Phase 7 discuss-phase
**Date:** 2026-05-18
**Author:** Claude (discuss-phase brainstorm)

## Mental model

*"The contract YAML has sections — make each section a horizontal swimlane.
The assembly lane shows the DAG; the other lanes are forms."*

This variant treats the contract YAML's top-level keys (`name`/`description`,
`inputs`, `sources`, `sinks`, `assembly`, `write_back`) as horizontal
*swimlanes* rendered as Canvas group nodes. Inside each lane, the editing
metaphor matches the section's nature: form-like grids for inputs/sources/
sinks/write_back, and a left-to-right DAG for assembly.

## Visual layout (ASCII)

```
═══════════════════════════════════════════════════════════
║ HEADER ↓                                                ║
║   ┌───────────────────────────────────────┐             ║
║   │ name: meeting-prep                    │             ║
║   │ description: Compile a meeting prep…  │             ║
║   └───────────────────────────────────────┘             ║
╠═════════════════════════════════════════════════════════╣
║ INPUTS ↓                                                ║
║   ┌──────────────────┐  ┌──────────────────┐            ║
║   │ meeting_doc_id   │  │ context_hops     │            ║
║   │ type: DocId      │  │ int, default=1   │            ║
║   │ required: yes    │  │                  │            ║
║   └──────────────────┘  └──────────────────┘            ║
╠═════════════════════════════════════════════════════════╣
║ SOURCES & SINKS ↓                                       ║
║   ┌──────────────┐   ┌──────────────┐                   ║
║   │ default_src  │   │ default_sink │                   ║
║   │ obsidian-fs  │   │ _briefs      │                   ║
║   └──────────────┘   └──────────────┘                   ║
╠═════════════════════════════════════════════════════════╣
║ ASSEMBLY (executes left → right) →                      ║
║   [meeting]─►[linked]─►[clustered]─►[compiled]          ║
╠═════════════════════════════════════════════════════════╣
║ WRITE_BACK ↓                                            ║
║   ┌───────────────────────────────────────┐             ║
║   │ sink: {{default_sink}}                │             ║
║   │ kind: brief, target: {{…}}--prep      │             ║
║   │ body_from: {{compiled.body}}          │             ║
║   └───────────────────────────────────────┘             ║
╚═════════════════════════════════════════════════════════╝
```

## Mapping rules

| YAML construct                  | Canvas representation                                |
|---------------------------------|------------------------------------------------------|
| Top-level keys                  | Horizontal Canvas group nodes (one per section) with a colored header banner |
| `name`, `description`           | Two text nodes inside the HEADER lane                |
| `inputs.<field>`                | Form-card text node in the INPUTS lane; one field per row inside the card |
| `sources.<handle>`              | Form-card text node in the SOURCES lane              |
| `sinks.<handle>`                | Form-card text node in the SINKS lane                |
| `assembly[i]`                   | Compact step node inside the ASSEMBLY lane          |
| Step ordering                   | **Left-to-right x-position inside the ASSEMBLY lane** (geometry is semantic here only) |
| `{{alias.field}}` references    | Plain text inside step nodes (NOT edges); editor offers autocomplete |
| Edges between assembly steps    | Visual ordering hint; compiler uses them to confirm topological order |
| `write_back`                    | Form-card text node in the WRITE_BACK lane          |
| `output_shape`                  | Either form-card in HEADER lane or a hidden YAML-only key |

## Authoring flow

1. A new canvas opens with empty swimlanes already stamped (lane headers
   visible, slots empty). The skeleton itself documents the structure.
2. Fill HEADER (name + description) by editing the two text nodes.
3. Click "+" in INPUTS → a new form-card lands in the lane.
4. Same for SOURCES, SINKS.
5. Drag verbs from a palette sidebar into the ASSEMBLY lane; arrange
   left-to-right.
6. Inside each step node, edit args; `{{...}}` references autocomplete from
   in-scope aliases (lane scan + upstream steps).
7. Fill WRITE_BACK form-card.
8. Save. Compiler walks lane geometry → emits structured YAML.

## Round-trip mechanics

- **Canonicalized on save:** lane order is fixed (HEADER, INPUTS, SOURCES,
  SINKS, ASSEMBLY, WRITE_BACK). Vertical position of form-cards inside
  non-ASSEMBLY lanes is canonicalized (sorted alphabetically or by declaration
  order). Lane height auto-fits.
- **Preserved across round-trip:** left-to-right x-position of nodes inside
  the ASSEMBLY lane (because it's semantic — it determines step order). Node
  colours, comments inside YAML node bodies.
- **Toggleable guides:** an editor mode draws faint dotted lines from
  `{{alias.field}}` references to their producer (read-only visualization);
  these are not stored in `.canvas`, just rendered on demand.
- **Compiler ambiguity rule:** if two assembly nodes share the same x-position
  (within snap tolerance), the compiler errors with both node IDs and asks
  the user to order them explicitly.

## Pros

- **Highest learnability for non-developers.** The empty canvas already
  *documents the structure* with labelled lanes — "Inputs", "Sources",
  "Assembly", "Write back". A novice can read it before touching anything.
- **Form-style editing for the form-shaped sections.** Inputs / sources /
  sinks / write_back are structurally forms; rendering them as form-cards
  matches their nature far better than free-form nodes.
- **Less visual noise than Variant A.** `{{alias.field}}` references stay
  as text inside step nodes; we skip the edge-per-reference clutter.
- **Works without an Obsidian plugin** (CAN-01 default path). The lane
  skeleton can be seeded via a template `.canvas` file; the watcher does
  the rest.

## Cons

- **Hybrid model is more compiler code.** The compiler must understand
  lane geometry as semantic — "is this node inside the INPUTS group?",
  "what is its x-position inside ASSEMBLY?" That's more parsing than
  Variant A's pure-graph mapping.
- **Position becomes load-bearing** inside the ASSEMBLY lane (left-to-right
  = step order). Conflicts with "canonicalize positions on save" — must
  be partially preserved. Diff hygiene is weaker than Variant A.
- **Lacks the explicit-edge "show me the data flow" insight** of Variant A.
  The toggleable guides help, but they are render-time, not editor-state.
- **Lane skeleton requires bootstrapping.** A blank `.canvas` won't show
  lanes unless seeded by a template or generated by a "new contract"
  command. The watcher-only path needs a CLI scaffolder.

## Usability profile

| Metric                 | Rating       | Notes                                       |
|------------------------|--------------|---------------------------------------------|
| Simplicity (visual)    | high         | Lanes act as their own documentation        |
| Learnability (non-dev) | high         | Plain-language section names; form-shaped UX|
| Learnability (dev)     | high         | YAML structure is visible in lane labels    |
| Error tolerance        | medium-high  | Autocomplete + visible empty slots          |
| Round-trip cost        | medium       | Lane geometry must be partially preserved   |
| Canvas-native fit      | good         | Uses group nodes heavily; standard primitives |
| Empty-canvas usability | HIGH         | Skeleton stamps the structure for you       |
| Implementation effort  | medium-high  | Compiler must reason about lane geometry    |
| Works without plugin   | YES          | With a scaffolder for the lane skeleton     |
| Diff-friendliness      | medium       | x-position inside ASSEMBLY lane is semantic |

## Best fit when

- Target audience is "few expert users collaborating on a shared vault"
  (per PROJECT.md) and includes people who think in forms more than in
  node graphs.
- Empty-canvas onboarding matters — the lane skeleton means a first-time
  author isn't staring at a blank rectangle.
- The maintainer accepts moderately more compiler complexity in exchange
  for substantially better authoring UX.

## Worst fit when

- Diff hygiene is paramount (Variant A wins).
- The team would rather invest the plugin effort once and get even better
  authoring UX (Variant C wins).
- The contract DSL grows rich enough that swimlanes become cramped (multi-row
  assembly chains, multi-source contracts) — at that point the spatial
  metaphor breaks down.

## Failure mode for the Phase 7 spike

If the spike validates Variant B and the round-trip works in plain Obsidian
Canvas, this is the v2.0.0 shape. If the spike finds that lane geometry
can't be reliably preserved across multi-client edits (Syncthing / iCloud
races), the natural descope is to Variant D (whiteboard) — drop lane
semantics, keep sigil-based node identification.

---

*See also:* [VARIANT-A-literal-dag.md](./VARIANT-A-literal-dag.md),
[VARIANT-C-palette-ide.md](./VARIANT-C-palette-ide.md),
[VARIANT-D-whiteboard.md](./VARIANT-D-whiteboard.md),
[SUMMARY-comparison.md](./SUMMARY-comparison.md).
