# Variant A — One-node-per-step DAG (literal mapping)

**Status:** Draft for Phase 7 discuss-phase
**Date:** 2026-05-18
**Author:** Claude (discuss-phase brainstorm)

## Mental model

*"What I see is what I get — each assembly step is one canvas node, edges are data flow."*

This variant maps the Phase 6 contract YAML onto the Obsidian Canvas substrate as
literally as possible: every `assembly:` step becomes exactly one Canvas text node,
every `{{alias.field}}` template reference becomes exactly one Canvas edge with
the field name as its label, and the supporting sections (`inputs`, `sources`,
`sinks`, `write_back`) become Canvas *group nodes* containing one text node per
declared entry.

## Visual layout (ASCII)

```
┌──── inputs ────┐   ┌── sources ──┐   ┌── sinks ──┐
│ meeting_doc_id │   │ default_src │   │ default_sk│
│ context_hops:1 │   │  obsidian-fs│   │ _briefs   │
└────────┬───────┘   └──────┬──────┘   └─────┬─────┘
         │                  │                │
         ▼                  ▼                │
    ┌──────────────┐   uses                  │
    │ meeting      │   ────►                 │
    │ verb:read_note│                        │
    └──────┬───────┘                         │
           ▼                                 │
    ┌──────────────┐                         │
    │ linked       │                         │
    │ verb:expand  │                         │
    │ hops:{{ctx}} │                         │
    └──────┬───────┘                         │
           ▼                                 │
    ┌──────────────┐                         │
    │ clustered    │                         │
    │ verb:cluster │                         │
    └──────┬───────┘                         │
           ▼                                 │
    ┌──────────────┐                         │
    │ compiled     │       ┌──── write_back ─▼─┐
    │ verb:compile_│──────►│ kind: brief        │
    │      brief   │ body  │ target: {{...}}    │
    └──────────────┘       └────────────────────┘
```

## Mapping rules

| YAML construct                | Canvas representation                                 |
|-------------------------------|-------------------------------------------------------|
| `name`, `description`         | Single Canvas text node, top-left, fixed color/badge  |
| `inputs.<field>`              | Text node inside an `inputs` group node               |
| `sources.<handle>`            | Text node inside a `sources` group node               |
| `sinks.<handle>`              | Text node inside a `sinks` group node                 |
| `assembly[i]` (each step)     | One text node; title bar = `as:`, body = `verb:` + `args:` as compact YAML |
| `{{alias.field}}` in args     | An edge from producer step → consumer step; label = `field` |
| `{{inputs.foo}}`              | An edge from input node → consumer step               |
| `write_back`                  | A bordered, distinctly-coloured node anchored right; one edge labeled `body` from producing step |
| `output_shape`                | Sidebar properties of the canvas-level metadata node  |

## Authoring flow

1. Open a new `.canvas` file (or use a template canvas).
2. A palette sidebar shows the 11 baseline verbs + `literal` + `mcp://`.
3. Drag a verb → a step node lands with an empty `as:` placeholder; user types
   the alias.
4. Edit args inside the node body in YAML.
5. Draw an edge from a producing step → the consumer; the edge label
   auto-suggests fields known from the producer's output schema.
6. Save. The compiler reads the canvas JSON, infers `{{alias.field}}` from
   edges + labels, and emits the YAML.

## Round-trip mechanics

- **Canonicalized on save:** node positions (snap to a grid), node sizes
  (uniform), group ordering (alphabetic by section name).
- **Preserved across round-trip:** node colours (user-chosen for visual
  grouping), edge bend points (cosmetic), YAML comments in node bodies
  (via `yaml ^2.6`).
- **Compiler ambiguity rule:** if two edges leave a step node without distinct
  field labels, the compile-time error message points to the canvas node ID.

## Pros

- **Mechanical round-trip.** Each YAML construct has exactly one canvas idiom;
  decompiler is a 1:1 emitter.
- **Edges are the data flow.** A user reading the canvas sees `{{alias.field}}`
  visually rather than as text — that is the entire point of moving to a
  visual editor.
- **Diff-friendly.** Re-arranging nodes spatially never changes YAML because
  positions are canonicalized on save.
- **Plays well with file-watcher recompile path** (CAN-01 default). No plugin
  required; user can edit the `.canvas` in Obsidian and the watcher recompiles.

## Cons

- **Verbose for long contracts.** A 10-step assembly with 4 inputs / 2 sources
  / 1 sink / 1 write_back ≈ 25 nodes and 20+ edges. Cognitive load scales
  poorly past ~6 steps.
- **No leverage on args.** The args inside each step node are still
  hand-typed YAML; the Canvas adds nothing to args authoring.
- **Edge density.** When one step's output fans out to 3+ downstream steps,
  edge labels overlap and become hard to read.

## Usability profile

| Metric                 | Rating       | Notes                                       |
|------------------------|--------------|---------------------------------------------|
| Simplicity (visual)    | medium       | Many nodes for non-trivial contracts        |
| Learnability (non-dev) | medium-high  | Looks like familiar node-graph editors      |
| Learnability (dev)     | high         | 1:1 mapping makes mental model trivial      |
| Error tolerance        | high         | Mistyped aliases impossible (edge does it)  |
| Round-trip cost        | low          | Each YAML construct has one canvas idiom    |
| Canvas-native fit      | excellent    | Uses only standard Canvas primitives        |
| Empty-canvas usability | medium       | Blank canvas; needs palette discovery       |
| Implementation effort  | medium       | Compiler/decompiler is straightforward      |
| Works without plugin   | YES          | Vanilla Obsidian Canvas + file watcher      |
| Diff-friendliness      | HIGH         | Canonical positions; minimal noise          |

## Best fit when

- The maintainer (Oliver, solo dev per PROJECT.md) wants the lowest-friction
  implementation and an immediately legible mental model for collaborators
  who already know node-graph editors.
- The spike comes out as expected (file-watcher default, no plugin) — A is
  the most honest match for "edit canvas in plain Obsidian, watcher recompiles."

## Worst fit when

- Contracts grow long (10+ assembly steps). The canvas becomes a wall of
  small nodes; the visual editor stops feeling like a leverage point.
- The audience is non-developers who would benefit from a form-style editor
  for args (Variant B or C territory).

---

*See also:* [VARIANT-B-swimlanes.md](./VARIANT-B-swimlanes.md),
[VARIANT-C-palette-ide.md](./VARIANT-C-palette-ide.md),
[VARIANT-D-whiteboard.md](./VARIANT-D-whiteboard.md),
[SUMMARY-comparison.md](./SUMMARY-comparison.md).
