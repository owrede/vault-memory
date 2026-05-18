# Phase 7 — Canvas ↔ Contract Editor: Variant Comparison

**Status:** Draft for Phase 7 discuss-phase
**Date:** 2026-05-18
**Author:** Claude (discuss-phase brainstorm)

This document compares four UI mapping variants for the Phase 7 visual
contract editor. Each variant is described fully in its own file; this
summary surfaces the trade-offs in one place to support the gray-area
discussion.

## Variants at a glance

| Variant | One-liner |
|---------|-----------|
| [A — Literal DAG](./VARIANT-A-literal-dag.md) | Each `assembly` step = one canvas node; edges = `{{alias.field}}` references; inputs/sources/sinks/write_back in group nodes. |
| [B — Swimlanes](./VARIANT-B-swimlanes.md) | Each top-level YAML key = a horizontal swimlane (form-shaped for non-assembly lanes; left-to-right DAG inside the ASSEMBLY lane). |
| [C — Palette IDE](./VARIANT-C-palette-ide.md) | Custom three-pane editor (palette / canvas / properties inspector). Canvas renders only the assembly DAG; everything else is form-edited. Requires an Obsidian plugin. |
| [D — Whiteboard](./VARIANT-D-whiteboard.md) | Free-form sticky notes with leading sigils (`★ HEADER ★`, `▶ STEP ▶`, …). Canvas geometry is decoration; compiler reads node text only. |

## Usability comparison matrix

```
                                │ Var A          │ Var B          │ Var C            │ Var D
                                │ Literal DAG    │ Swimlanes      │ IDE w/ palette   │ Whiteboard
────────────────────────────────┼────────────────┼────────────────┼──────────────────┼────────────────
Simplicity (visual)             │ medium         │ high           │ medium-low       │ highest
Learnability for non-devs       │ medium-high    │ high           │ HIGHEST (plugin) │ low
Learnability for devs           │ high           │ high           │ high             │ high
Error tolerance                 │ high           │ med-high       │ HIGHEST          │ LOW
Round-trip cost                 │ low            │ medium         │ high             │ low
Canvas-native fit               │ excellent      │ good           │ poor             │ excellent
Works without plugin (CAN-01)   │ YES            │ YES            │ NO               │ YES
Args editing leverage           │ low (text)     │ low (text)     │ HIGH (typed form)│ none (text)
Visible data flow               │ YES (edges)    │ partial        │ YES (edges)      │ NO
Discoverability of verbs        │ palette sidebar│ palette sidebar│ palette is core  │ examples only
Empty-canvas usability          │ medium         │ HIGH (skeleton)│ HIGH (palette)   │ low (blank)
Implementation effort           │ medium         │ medium-high    │ HIGH (plugin)    │ low
Aligns w/ default spike path    │ YES            │ YES            │ NO               │ YES
Aligns w/ descope spike path    │ partial        │ partial        │ NO               │ IS the descope
Diff-friendliness of saves      │ HIGH           │ medium         │ low              │ HIGHEST
```

## Per-metric notes

### Simplicity (visual)
- **A** is busy for long contracts (~25 nodes for a 10-step assembly).
- **B** uses lanes to compartmentalize; visually calmer.
- **C** adds editor chrome (palette + inspector) — three panes of UI.
- **D** is the simplest visually because there's no structure at all.

### Learnability
- **C** wins for non-developers because typed forms are dramatically more
  accessible than text-based YAML.
- **B** is the best non-plugin option because the empty canvas already
  documents the structure via labelled lanes.
- **D** is essentially "edit YAML in spatial groups" — fine for devs,
  alienating for non-devs.

### Error tolerance
- **C** catches most errors at form-validation time (Zod-driven).
- **A** prevents mistyped alias references by using edges instead of text.
- **B** uses autocomplete for `{{...}}` references; better than nothing.
- **D** is silently fragile — sigil typos drop nodes; alias typos fail at
  contract instantiation, not save.

### Round-trip cost (lower = better)
- **A** and **D** have low cost: each YAML construct has one canvas idiom
  (A) or geometry is decoration (D).
- **B** has medium cost: lane geometry is semantic in the ASSEMBLY lane,
  decorative elsewhere.
- **C** has the highest cost: most editor state lives outside the canvas
  and needs a sidecar or custom YAML keys.

### CAN-01 alignment (spike outcome)
- The ROADMAP default is "file-watcher recompile, no plugin." **A, B, D**
  all work in that world.
- **C** requires an Obsidian plugin. Choosing C effectively prejudges the
  spike toward the plugin path.
- **D** *is* the descope path ("Canvas as view, YAML as authoring") —
  it's the natural fallback shape if any of A/B/C's spike fails.

## Recommendation matrix

| If you optimize for…                                      | Pick     |
|-----------------------------------------------------------|----------|
| Lowest implementation effort and zero plugin              | **D**    |
| Best authoring UX, accepting plugin maintenance           | **C**    |
| Best learnability without a plugin                        | **B**    |
| Cleanest mental model + best diff hygiene without a plugin| **A**    |
| Hedging — primary + cheap fallback                        | **B → D**|

## My recommendation

**Variant B (swimlanes) as primary, with Variant D (whiteboard) as the
documented descope fallback if the spike fails.**

Reasons:
- B has the highest learnability for "few expert users collaborating on a
  shared vault" (the audience per PROJECT.md).
- B works without an Obsidian plugin — aligns with the ROADMAP's default
  spike recommendation (file-watcher recompile).
- The empty-canvas skeleton makes first-time authoring concrete (you see
  what slots need to be filled before touching anything).
- If the spike finds swimlane geometry can't be reliably preserved across
  multi-client edits, the natural descope is D — drop lane semantics,
  keep sigil-based identification.

**Variant A is the strong runner-up** — pick A if diff hygiene matters
more than learnability for non-devs. Variant C is the right call only
if the maintainer is committed to shipping (and maintaining) an Obsidian
plugin as part of v2.0.0.

## What gets decided here vs later

This document supports a single discuss-phase decision:

> **Which UI mapping shape does Phase 7 ship?**

It does NOT decide:
- Canonicalization rules (separate gray area — what is canonicalized vs
  preserved across round-trip).
- Spike scope and descope trigger (separate gray area — what concrete
  signal triggers the fallback).
- Palette content + file layout + watcher wiring (separate gray area —
  which verbs get palette nodes, where `.canvas` files live, how the
  ChangeFeed handler is structured).

Those three decisions remain for follow-up turns once the UI shape is
locked.

---

*Variant files:*
[A — Literal DAG](./VARIANT-A-literal-dag.md) ·
[B — Swimlanes](./VARIANT-B-swimlanes.md) ·
[C — Palette IDE](./VARIANT-C-palette-ide.md) ·
[D — Whiteboard](./VARIANT-D-whiteboard.md)
