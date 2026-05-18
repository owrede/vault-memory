# Phase 7: vault-memory Obsidian plugin (contract editor + chrome) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `07-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 07-visual-contract-editor-canvas (ROADMAP title pivoted mid-discussion to: vault-memory Obsidian plugin (contract editor + chrome))
**Areas discussed:** UI mapping variant, Spike outcome, Plugin surface, File format / authority, Phase scope, Round-trip + .contract schema, Palette + reference contracts + watcher wiring, Plugin chrome (settings/secrets/reindex/stats/connectors), Distribution + skill naming + documentation
**Sessions:** Two — session 1 paused at checkpoint (`07-DISCUSS-CHECKPOINT.json`), session 2 resumed after ROADMAP + REQUIREMENTS pre-flight rewrite

---

## Session 1 — Architecture decisions

### Gray area selection (initial)

User asked Claude to write design docs for 3–4 UI mapping variants before picking which gray areas to discuss (deviating from the standard "pick from a list" flow). Four variants drafted as standalone markdown files at `.planning/phases/07-visual-contract-editor-canvas/design-variants/`, plus `SUMMARY-comparison.md`, plus four `.canvas` mockups in `/Users/wrede/Documents/Obsidian Vaults/VM-Dev/Phase-07-Canvas-Variants/`.

### UI mapping variant

| Option | Description | Selected |
|--------|-------------|----------|
| Variant A — Literal DAG | One node per assembly step; edges = `{{alias.field}}` references; inputs/sources/sinks in group nodes | |
| Variant B — Swimlanes | Each top-level YAML key = a horizontal swimlane (HEADER / INPUTS / SOURCES & SINKS / ASSEMBLY / WRITE_BACK) | |
| Variant C — Palette IDE | Three-pane editor — palette / canvas / properties inspector | ✓ |
| Variant D — Whiteboard | Sigil-tagged free-layout sticky notes; canvas geometry decorative | |

**User's choice:** Variant C.
**Notes:** "A looks clearest visually but lacks scaffolding; C's structured editing is essential for users to actually leverage the v2.0.0 Agentic Knowledge Layer. Without good usability, users will not understand or discover the feature."

### Phase 7 scope (plugin breadth)

| Option | Description | Selected |
|--------|-------------|----------|
| Tight: editor only | Plugin shell + Variant C editor + round-trip + 3 reference canvases + docs. Settings/secrets/reindex/stats deferred to Phase 7.5 or Phase 8 polish | |
| Expanded: plugin as umbrella feature | Phase 7 ships editor + settings + key-ring secrets + manual reindex + stats + connector management | ✓ |
| Split: two sub-phases | 7a = plugin shell + chrome; 7b = editor | |

**User's choice:** Expanded.
**Notes:** "I may want to give users control about configuration options, methods to trigger re-indexing, statistics, and tuning. It would also offer means to attach data sources, memory sinks, cloud services and MCP services leveraging the Obsidian secrets feature (Schlüsselbund)."

### Editor surface

| Option | Description | Selected |
|--------|-------------|----------|
| Separate plugin view (registerView) | Plugin registers a new view type for the file; full UI control | ✓ |
| Render inside Obsidian Canvas | Extension overlays on the built-in Canvas view; tighter integration but constrained API | |
| Investigate via spike | Defer the decision to a spike | |

**User's choice:** Separate plugin view.
**Notes:** "It would allow to control the UI better without the need to interfere with Obsidian canvas. It would make the editor UI more stable and help control what it does and how it looks."

### Authority direction (file watching)

| Option | Description | Selected |
|--------|-------------|----------|
| .yaml authoritative; plugin regenerates .canvas | Watcher fires on .yaml; plugin owns export | |
| Bidirectional | User can edit either .yaml or .canvas; conflict resolution required | |
| .canvas authoritative; .yaml generated | Plugin owns both files; .yaml is the build artifact | ✓ |

**User's choice:** `.canvas` authoritative, `.yaml` generated (initially).
**Notes:** This was then immediately pivoted in the next question — see ".contract format" below.

### .canvas encoding strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Path 1: visible YAML in node bodies | Each node holds typed args as YAML text; .canvas fully self-describing | |
| Path 2: hidden metadata fields or sidecar | Plugin stores structured args in custom node fields | |
| Hybrid: summary visible, full structure in metadata | Compromise | |
| (free-text) User pivoted to a fourth option | Drop .canvas entirely; introduce custom `.contract` JSON format owned by vault-memory; fork the jsoncanvas.org renderer | ✓ |

**User's choice:** Free-text — drop `.canvas` entirely.
**Notes:** "I lean to path 2 (YAML is not user-friendly enough!). I ALSO want to indicate that we might fully use the jasoncanvas.org code as fork and implement an OWN file `.contract`. This file automatically would be opened in the new node-editor — and not depend on Obsidians canvas feature. This would allow to control the UI better without the need to interfere with the Obsidian canvas. It would make the editor UI more stable and help to control what it does and how it looks. Correct?"

### Lock the format pivot

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — lock .contract format | Custom .contract JSON + forked jsoncanvas renderer; .yaml as build artifact; .canvas dropped from authoring | ✓ |
| Yes, but keep .canvas as second-class export | Same + ship a `.contract → .canvas` exporter for vanilla Obsidian | |
| Hold — spike first, lock format later | 1-week spike before locking the architecture | |

**User's choice:** Lock `.contract` format.
**Notes:** Original ROADMAP framing (`.canvas` round-trip, file-watcher default, spike-gated plugin decision) replaced. Spike narrowed to "is the jsoncanvas fork viable?"

### Next-step routing

| Option | Description | Selected |
|--------|-------------|----------|
| Update ROADMAP + REQUIREMENTS first, then finish discuss-phase | Pre-flight before continuing | ✓ |
| Continue discuss-phase now; update ROADMAP later | Capture everything; clean up pre-plan | |
| Capture as a draft CONTEXT.md and stop | Let user think | |

**User's choice:** Pre-flight first.
**Notes:** Session paused; checkpoint written to `07-DISCUSS-CHECKPOINT.json`. ROADMAP + REQUIREMENTS rewrites landed before session 2.

---

## Session 2 — Implementation details (remaining 9 gray areas)

User opted to follow Claude's recommendations across all four remaining bundles, with two specific user-driven additions (`vm-install`/`vm-update` skills + `vm-` skill naming convention). Two G-detail questions were explicitly confirmed via AskUserQuestion.

### Gray area bundle selection

| Option | Description | Selected |
|--------|-------------|----------|
| G1 — Round-trip + .contract format details | CAN-07 canonicalization rules + .contract JSON schema specifics | ✓ (delegated to recommendation) |
| G2 — Palette + reference contracts + watcher wiring | CAN-04 palette content, CAN-06 reference contracts, CAN-08 watcher mechanics | ✓ (delegated to recommendation) |
| G3 — Plugin chrome scope (PLG-01..05) | Settings, secrets, reindex, stats, connector mgmt | ✓ (delegated to recommendation) |
| G4 — Plugin distribution + documentation | Distribution channel + CAN-09 expanded scope | ✓ (delegated to recommendation, with explicit user additions: `vm-install`/`vm-update` skills, `vm-` skill prefix) |

**User's choice:** All four bundles, delegated to Claude's recommendations.
**Notes:** "I'd rather would like to follow along with your recommendations. Regarding G4: There is a install-vault-memory skill that could be used to download the plugin. An extra update-skill could update it as well. Be aware that I think we should prefix all vault-memory skills with 'vm' so that there is no namespace collision and clear distinction of the skills that belong to vault-memory!"

### G1 detail — Editor-state location across round-trip

| Option | Description | Selected |
|--------|-------------|----------|
| Base64 JSON comment block at YAML head | `# vm-editor-state: <base64>` ignored by YAML parsers; importer reads on round-trip; fallback layout if absent | ✓ |
| Separate sidecar .editor.json file | Cleaner separation; desync risk on edits | |
| Discard editor state on yaml emission | Simplest; loses spatial work between sessions | |

**User's choice:** Base64 comment block.
**Notes:** D-FORMAT2 in CONTEXT.md.

### G3 detail — Gating strategy for new plugin-control MCP tools

| Option | Description | Selected |
|--------|-------------|----------|
| Public MCP tools, gated by [plugin] config | Tools registered only when `[plugin] enabled = true`; default OFF; preserves Phase 8 REL-08 ≤32-tool budget | ✓ |
| Public MCP tools, always registered | Always available; pollutes tool surface for non-plugin deployments | |
| Private IPC channel (not MCP tools) | Separate Unix-socket / named-pipe channel; most code; least surface pollution | |

**User's choice:** Gated by `[plugin] enabled` config.
**Notes:** D-CHROME6 / D-MCP-SURFACE in CONTEXT.md. Mirrors Phase 6 D-A1 `auto_register_tools` default-OFF gating pattern.

---

## Claude's Discretion

The following areas were not discussed; planner + researcher choose, anchored by the locked decisions in CONTEXT.md:

- Plugin framework choice (Svelte/React/vanilla)
- Exact `.contract` JSON schema beyond the D-FORMAT-SCHEMA sketch
- MCP tool naming for the plugin-control tools
- Inspector form library (Zod→form adapter)
- Default node layout algorithm for `.yaml` imports without editor-state comment
- Plugin bundling/build pipeline (likely esbuild)
- Settings restart-vs-hot-swap mapping per setting
- Reindex progress streaming protocol (MCP 1.29 streaming vs polling)
- `vm-install` skill storage location in the repo
- Secrets ciphertext format details
- Error UX for `${secret:name}` resolution failures
- Per-vault vs global plugin scope (per-vault confirmed)

---

## Deferred Ideas

(Full list in `07-CONTEXT.md` `<deferred>` block — summarized here.)

- `.contract → .canvas` one-way exporter (Phase 7.x / v2.1)
- Bidirectional .contract ↔ .yaml editing with full 3-way merge (v2.x)
- In-plugin agent chat surface (v2.1)
- Plugin auto-update via Obsidian community store (post-store-submission)
- Contract version migration UI (when schemas change)
- Visual diff for `.contract` changes (v2.x)
- Theming controls beyond Obsidian theme inheritance (out of v2.0.0)
- Incremental reindex (v2.1)
- Stats panel time series / graphs (out of v2.0.0)
- Connector capability inspection beyond verb names (v2.x)
- Cloud-source connector UI — Notion/GitHub (Phase 10 / v3)
- Multi-vault workspace plugin config (v2.x)
- Reserved skills under `vm-` namespace: `vm-bootstrap-vault`, `vm-author-contract` (out of Phase 7)
- Plugin telemetry — explicitly rejected per project constraint, permanently out
- Web-based contract editor (far out of v2.0.0)
- CLI scaffolder for new contracts (superseded by plugin's "new contract" action)
- External secret stores beyond `safeStorage` (v2.x extension point)
