# Variant D — Whiteboard with sticky-note bindings (low-structure, high-freedom)

**Status:** Draft for Phase 7 discuss-phase
**Date:** 2026-05-18
**Author:** Claude (discuss-phase brainstorm)

## Mental model

*"A canvas is a whiteboard. Let users arrange notes however they want;
the compiler reads the underlying meaning, not the layout."*

This variant deliberately treats Canvas geometry as decoration. Each node's
role (input, source, sink, step, write_back) is identified by a leading
*sigil* in its text body. Position, edges, colours are cosmetic — the
compiler ignores them. Step ordering comes from explicit `order: N` or
inferred topologically from `$alias` references.

## Visual layout (ASCII)

```
Anywhere on the canvas, in any arrangement:

    ┌── ★ HEADER ★ ───────┐         ┌── ◐ INPUT ◑ ─────────┐
    │ meeting-prep        │         │ meeting_doc_id       │
    │ "Compile meeting…"  │         │ : DocId, required    │
    └─────────────────────┘         └──────────────────────┘

         ┌── ▶ STEP ▶ ────────┐          ┌── ◐ INPUT ◑ ───────┐
         │ as: meeting        │          │ context_hops: 1    │
         │ verb: read_note    │          └────────────────────┘
         │ doc_id: $meeting_  │
         │         doc_id     │          ┌── ⬢ SOURCE ⬢ ──────┐
         └─────────┬──────────┘          │ default_source     │
                   │ doc                 │ obsidian-fs://…    │
                   ▼                     └────────────────────┘
         ┌── ▶ STEP ▶ ────────┐
         │ as: linked         │
         │ verb: expand       │          ┌── ⬡ SINK ⬡ ────────┐
         │ seed: $meeting.doc │          │ default_sink       │
         │ hops: $context_hops│          │ _memory/_briefs    │
         └─────────┬──────────┘          └────────────────────┘
                   ▼
         ┌── ▶ STEP ▶ ────────┐
         │ as: clustered      │          ┌── ✎ WRITE ✎ ───────┐
         │ verb: cluster      │          │ sink: $default_sink│
         │ seed: $linked.docs │          │ kind: brief        │
         └─────────┬──────────┘          │ body: $compiled    │
                   ▼                     │       .body        │
         ┌── ▶ STEP ▶ ────────┐          └────────▲───────────┘
         │ as: compiled       │                   │
         │ verb: compile_brief│───────────────────┘
         │ src: $linked.docs  │
         └────────────────────┘
```

## Mapping rules

| YAML construct                | Canvas representation                                |
|-------------------------------|------------------------------------------------------|
| `name`, `description`         | One text node prefixed with `★ HEADER ★`             |
| `inputs.<field>`              | One text node per input, prefixed `◐ INPUT ◑`        |
| `sources.<handle>`            | One text node per source, prefixed `⬢ SOURCE ⬢`      |
| `sinks.<handle>`              | One text node per sink, prefixed `⬡ SINK ⬡`          |
| `assembly[i]`                 | One text node per step, prefixed `▶ STEP ▶`; body holds `as:`/`verb:`/args |
| `write_back`                  | One text node prefixed `✎ WRITE ✎`                   |
| `{{alias.field}}`             | Shorthand `$alias.field` inside step body            |
| Edges                         | Optional decoration — compiler ignores               |
| Step ordering                 | Explicit `order: N` OR topological from `$alias` refs|
| Position                      | Fully canonicalized on save (irrelevant)             |

## Authoring flow

1. Open one of the reference canvases (CAN-06) as a starting template.
2. Add new nodes anywhere; edit text by hand or copy-paste a sigil prefix.
3. Edit the YAML-like body inside each node.
4. Save. Compiler parses node text → builds YAML.

There is no palette, no inspector, no editor chrome — just Canvas + the
sigil convention.

## Round-trip mechanics

- **Canvas geometry is fully canonicalized.** On save, all nodes are
  re-laid-out by section (HEADER top, INPUTS row, SOURCES/SINKS row,
  STEPS column, WRITE bottom). Edges are dropped.
- **Or the opposite**: preserve user-chosen positions verbatim because they
  do not carry meaning. (Pick one — the maintainer's call.) The "fully
  canonicalize on save" mode maximizes diff hygiene; the "preserve verbatim"
  mode maximizes user agency over the whiteboard.
- **Compiler parses sigils** with a strict regex (`^\s*[★◐⬢⬡▶✎] [A-Z]+ [★◐⬢⬡▶✎]\s*$`
  as the first line of a node body). Typos in sigils → node silently
  ignored unless we add a "lint" pass.
- **YAML comments** survive because the node body IS a small YAML fragment;
  `yaml ^2.6` round-trip handles comments per-fragment.

## Pros

- **Works with plain Obsidian Canvas, no plugin required.** Genuinely
  watcher-only — this is the natural shape of the CAN-01 descope path
  ("Canvas as view, YAML as authoring").
- **Lowest implementation effort.** Compiler is a text-pattern matcher;
  decompiler is a layout-by-section emitter. No graph algorithm beyond
  topological sort.
- **Maximum spatial freedom.** Power users can arrange the whiteboard
  however helps them think — affinity groups, chronology, blast radius.
  Variant A/B/C all constrain layout.
- **Diff hygiene is highest** (when canonicalize-on-save mode is chosen).

## Cons

- **Asks users to author YAML-like text inside text nodes.** The Canvas
  adds essentially zero leverage to authoring — it's a fancy YAML editor
  with spatial grouping. The "visual editor" premise is mostly abandoned.
- **Lowest error tolerance.** Typos in sigils silently drop nodes. Typos
  in `$alias.field` fail at instantiation time, not save time. Missing
  required fields aren't visually obvious because there's no skeleton.
- **Learnability is low for non-developers.** It's still YAML — the visual
  packaging doesn't change that.
- **Sigil convention is fragile across multi-client edits.** If Obsidian
  on one device escapes special characters differently, the sigil might
  not survive a Syncthing round trip.

## Usability profile

| Metric                 | Rating       | Notes                                       |
|------------------------|--------------|---------------------------------------------|
| Simplicity (visual)    | highest      | Just text nodes; no editor chrome           |
| Learnability (non-dev) | low          | Still YAML; sigils add cognitive load       |
| Learnability (dev)     | high         | "It's spatial YAML" — obvious                |
| Error tolerance        | LOW          | Typos in sigils/aliases fail silently or late |
| Round-trip cost        | low          | Geometry is decoration; trivial canonicalize |
| Canvas-native fit      | excellent    | Uses only text nodes; no fancy structure    |
| Empty-canvas usability | low          | Blank canvas; user must know sigil grammar  |
| Implementation effort  | LOW          | Text pattern matcher + emitter              |
| Works without plugin   | YES          | Plain Obsidian Canvas + file watcher        |
| Diff-friendliness      | HIGHEST      | (in canonicalize-on-save mode)              |

## Best fit when

- The Phase 7 spike fails and we *must* descope. Variant D is the natural
  fallback because it explicitly leans into the constraint ("Canvas is a
  whiteboard; YAML is authoring").
- The maintainer wants minimum implementation cost and accepts that the
  visual editor is more "visual reference for YAML" than "visual authoring".
- Audience is power users / devs who already think in YAML.

## Worst fit when

- The audience is non-developers — the YAML-in-text-nodes model offers no
  leverage over editing the YAML file directly.
- The team's CAN-04 ambition is "palette nodes for every available
  assembly tool" — Variant D has no palette, only examples.

## Failure mode for the Phase 7 spike

Variant D is the failure mode. If the spike succeeds with any of Variants
A/B/C, Variant D is what we ship behind it as the documented "edit by hand"
fallback. If the spike fails entirely, Variant D becomes the only shipped
path and we re-label CAN-01 as resolved against the descope option.

---

*See also:* [VARIANT-A-literal-dag.md](./VARIANT-A-literal-dag.md),
[VARIANT-B-swimlanes.md](./VARIANT-B-swimlanes.md),
[VARIANT-C-palette-ide.md](./VARIANT-C-palette-ide.md),
[SUMMARY-comparison.md](./SUMMARY-comparison.md).
