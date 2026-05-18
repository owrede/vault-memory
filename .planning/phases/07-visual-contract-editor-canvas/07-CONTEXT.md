# Phase 7: vault-memory Obsidian plugin (contract editor + chrome) - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the **vault-memory Obsidian plugin** as the user-facing surface of the v2.0.0 Agentic Knowledge Layer. Two co-equal parts:

1. **Visual contract editor (Variant C — palette + canvas + properties inspector).** A structured editor that authors Phase 6 task contracts using a **custom `.contract` JSON file format** (typed for vault-memory) rendered by a **forked jsoncanvas.org renderer**. The editor emits valid Phase 6 YAML (`_contracts/*.yaml`, Zod-validated by `ContractFileSchema`) on every save. `.yaml` is the build artifact; `.contract` is the authoring file. Obsidian's built-in `.canvas` format is **not** used.

2. **Plugin chrome — settings, key-ring secrets, manual reindex, stats, connector management.** Makes vault-memory operable from inside Obsidian without dropping to a terminal.

Distribution is via two new GSD-compatible **skills** (`vm-install`, `vm-update`) that pull plugin releases from GitHub. Obsidian community plugin store submission is a post-v2.0.0 secondary path.

**Architectural pivot recorded:** the original ROADMAP framing assumed Obsidian's `.canvas` format + file-watcher recompile + spike-gated plugin decision. That framing is replaced. Phase 7 ships the plugin path; the spike (CAN-10) is narrowed to "is the jsoncanvas fork viable?" with a real-prototype gate. See `07-DISCUSS-CHECKPOINT.json` for the full decision history and `.planning/phases/07-visual-contract-editor-canvas/design-variants/SUMMARY-comparison.md` for the four UI variants considered (A literal-DAG / B swimlanes / **C palette-IDE** / D whiteboard).

Phase 7 sits at the L5 surface layer in `docs/v2/ARCHITECTURE.md` terms — it is the only phase that introduces a non-MCP user interface. The MCP server surface itself is extended additively (a small number of new tools gated behind a `[plugin] enabled = true` config flag) but no v1 tool is modified.

**Operating environment (inherited)** — solo maintainer (Oliver), few expert users collaborating on shared vaults via Syncthing / iCloud / git-sync, multiple MCP clients per server. Implications: (a) plugin must survive multi-device sync of `.contract` files; (b) `safeStorage` ciphertext is per-device — synced ciphertext can't be decrypted on a different machine without re-entering the secret, which is the correct security posture; (c) editor-state in YAML comments survives the same sync substrate as the contract itself.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-18, across two discuss-phase sessions). The first session locked four architectural decisions (UI variant, surface, format, scope); the second resumed from checkpoint and worked through the nine remaining gray areas with Claude proposing recommendations and the user accepting them (with two specific user-driven additions: skill-based distribution and the `vm-` skill-naming convention). Two G-detail questions were explicitly confirmed via AskUserQuestion (D-FORMAT2 editor-state location, D-CHROME6 MCP tool surface gating).

### UI Variant + Editor Surface (locked session 1)

- **D-UI: Variant C — palette + canvas + properties inspector.** The contract editor is a three-pane IDE-like surface: a left palette (type catalog + verbs + peer-MCP), a center canvas (assembly DAG only, rendered via forked jsoncanvas), and a right properties inspector (typed forms generated from each verb's Zod schema). Inputs/sources/sinks/write_back are NOT canvas nodes — they live in palette panels and inspector forms. Rationale: typed forms eliminate the largest single source of contract errors (mistyped `{{alias.field}}`, wrong verb args, missing required args). The four UI mapping variants explored are documented as full design docs at `.planning/phases/07-visual-contract-editor-canvas/design-variants/` with rendered `.canvas` mockups in the VM-Dev vault at `/Users/wrede/Documents/Obsidian Vaults/VM-Dev/Phase-07-Canvas-Variants/`.

- **D-SURFACE: Obsidian plugin via `registerView` + `registerExtensions(['contract'])`.** Plugin registers a custom view type for the `.contract` extension; opening any `.contract` file in Obsidian launches the editor automatically. Plugin is NOT an Obsidian Canvas extension — it does not extend or interact with the built-in Canvas view. Rationale (user): "Control the UI better without the need to interfere with Obsidian canvas. Makes the editor UI more stable and helps control what it does and how it looks."

### File Format + Authority (locked session 1, detail in session 2)

- **D-FORMAT: Custom `.contract` JSON format owned by vault-memory, NOT Obsidian's `.canvas`.** The `.canvas` format was rejected as an authoring surface because it is generic infinite-canvas storage (text nodes / file nodes / edges / groups) with no native model for typed-DAG contracts. Every workaround (sigil-tagged text, custom metadata fields, hidden sidecars) leaks back to the same problem: Obsidian Canvas doesn't know what a "contract step" is. The `.contract` format is a typed JSON document owned end-to-end by vault-memory. Rationale (user): "Fully use the jsoncanvas.org code as fork and implement an OWN file `.contract`. This file automatically would be opened in the new node-editor — not dependent on Obsidian's canvas feature."

- **D-FORMAT-SCHEMA: `.contract` carries the Phase 6 contract verbatim plus a single editor-state block. No sidecar files.**
  ```jsonc
  {
    "$schema": "https://vault-memory.dev/schemas/contract-v1.json",
    "vmFormatVersion": 1,
    "contract": { ...Phase 6 ContractFileSchema fields, byte-equivalent to YAML's parsed JS value... },
    "editor": {
      "nodes": [ { "id": "input:meeting_doc_id", "x": 0, "y": 0 }, ... ],
      "selection": null,
      "viewport": { "x": 0, "y": 0, "zoom": 1.0 },
      "yamlComments": { ... }
    }
  }
  ```
  The `contract` block is the source of truth for everything Phase 6 cares about. The `editor` block is plugin-only state.

- **D-FORMAT2: Editor state round-trips to YAML as a base64-encoded comment block at the YAML head.** Format: `# vm-editor-state: <base64-encoded JSON>` on the first line of the emitted `_contracts/*.yaml`. YAML parsers ignore it; Phase 6's `yaml ^2.6` `parseDocument` preserves it across reloads; the plugin importer reads it to rebuild the `.contract` view exactly. If the comment is absent (e.g., user authored the YAML by hand), the importer falls back to a default layout computed deterministically from assembly step order. Sidecar files were rejected to avoid desync risk; discard-on-emission was rejected because users would lose spatial work when switching between Obsidian-edit and editor-edit sessions. User confirmed via AskUserQuestion.

- **D-AUTH: `.contract` is the source of truth for the editor; `.yaml` is the build artifact emitted on save.** Plugin writes `.contract` (editor source) and synthesizes `.yaml` on every save. The Phase 6 `ContractRegistry` watches `_contracts/*.yaml` for hot-reload (D-LOAD pattern unchanged). The plugin does NOT watch its own `.contract` files — Obsidian's view lifecycle already fires open/close/save events. The watcher direction inverts what the original ROADMAP assumed: the editor writes YAML; the server reads YAML; there is no `.canvas → .yaml` watcher path.

### Phase Scope (locked session 1)

- **D-SCOPE: Phase 7 is plugin-as-umbrella, not editor-only.** Phase 7 ships the editor PLUS settings, key-ring secrets, manual reindex, stats panel, and connector management UI — all in v2.0.0. Rationale (user): "I may want to give users control about configuration options, methods to trigger re-indexing, statistics, and tuning. It would also offer means to attach data sources, memory sinks, cloud services and MCP services leveraging the Obsidian secrets feature (Schlüsselbund)." v2.0.0 release date may slip; Phase 8 (release polish) becomes simpler because plugin chrome is already done.

### Round-trip + Canonicalization (CAN-07)

- **D-CANON: Canonicalization rules for `.contract` → `.yaml`.**
  - **Always canonical (no user agency):** YAML key order matches Phase 6 ADR-006 schema order; `assembly` step order matches the DAG (topological or explicit `order:`); default values omitted when they equal schema defaults (don't emit `required: true` if it's the default).
  - **Always preserved:** YAML comments via `yaml ^2.6` `parseDocument` / `toString` (Phase 6 CON-01 mechanism); `description` block scalars stay as `|` literals; user-authored `mcp://` URIs preserved verbatim.
  - **Editor state survives:** base64 comment block at YAML head per D-FORMAT2.
- **D-CANON-TEST: CAN-07 acceptance test.** For each of the three reference contracts (`meeting-prep`, `project-status`, `code-review-brief`): `import yaml → emit .contract → emit yaml` produces YAML that parses to a JS value `deepEqual` to the original AND the editor-state comment block survives a second cycle. Test lives in `examples/contracts/round-trip.test.ts` (TBD path; planner confirms).

### Palette + Reference Contracts (CAN-04, CAN-06)

- **D-PALETTE: Static baseline + dynamic peer-MCP, four-section layout.**
  - **Section 1: Type catalog** (drag onto inputs fields): `DocId`, `Handle`, `ChunkId`, `MemorySink` (sourced from `src/contracts/types-catalog.ts`).
  - **Section 2: Read verbs**: `read_note`, `search_hybrid`, `search_sections`, `query_frontmatter`, `list_backlinks`, `get_outline`, `recall`.
  - **Section 3: Assembly verbs**: `expand`, `cluster`, `compile_brief`, `get_brief`.
  - **Section 4: Escape-hatch**: `literal`.
  - **Section 5: Peer MCP (dynamic)**: populated by querying the running `vault-memory serve` for `[contracts.mcp_clients]` declared verbs; empty when no MCP clients configured; refreshes on plugin focus.
  Baseline entries are compiled into the plugin at build time, sourced from `src/contracts/verbs/index.ts` enum (single source of truth — adding a baseline verb in Phase 6 automatically appears in the palette in Phase 7 once the plugin is rebuilt).

- **D-REFS: Three reference `.contract` files in `examples/contracts/`.** Re-author the existing three Phase 6 reference contracts (`meeting-prep`, `project-status`, `code-review-brief`) as `.contract` files. Same content, same eval coverage. The Phase 6 fixture YAMLs at `evals/fixtures/v2-test-vault/_contracts/*.yaml` are the round-trip baseline. The cancelled `examples/canvas-contracts/` path from the original ROADMAP is replaced by `examples/contracts/`.

### Watcher Wiring (CAN-08)

- **D-WATCH-PLUGIN-OUT: `SuppressionSet` reuse — plugin → server direction.** On `.contract` save: plugin computes SHA-256 of the emitted YAML body, calls `SuppressionSet.suppress(path, hash)` BEFORE writing the `.yaml` file, then writes. The Phase 6 `ContractRegistry` ChangeFeed handler observes the file event, computes the on-disk hash, checks `SuppressionSet.matches(path, hash)` → match → skip reload. This kills the echo loop by construction.
- **D-WATCH-SERVER-NOTIFY: Server → plugin direction handled via MCP notification, not file watching.** When the Phase 6 handler hot-reloads a contract from a YAML change that wasn't suppressed (i.e., a user edited the YAML directly outside the plugin), the server emits an MCP notification (`vault-memory://contracts/reloaded`). The plugin subscribes; if the file matches an open `.contract` view, it prompts "External edit detected — reload editor?" (Accept → re-import the YAML, rebuild editor view, prompt-discard editor state. Decline → keep editor state; next plugin save overwrites the external YAML edits.)
- **D-WATCH-NO-PLUGIN-WATCH: Plugin does NOT watch `.contract` files itself.** Obsidian's view lifecycle (`onLoadFile`, `onUnloadFile`, `onSave`) provides everything needed. Watching is only against `_contracts/*.yaml` for external-edit awareness, and that watcher is the Phase 6 ChangeFeed handler — not a new one. Phase 7 adds zero new watchers.

### Plugin Chrome — Minimal Shipping Set in v2.0.0

- **D-CHROME-PHILOSOPHY: Ship minimal chrome in v2.0.0; expand in v2.x.** Phase 7 is already large. Goal is "good enough to be discoverable and operable," not "everything you'd ever want."

- **D-CHROME-SETTINGS (PLG-01):** Obsidian-native settings tab (`PluginSettingTab`) with:
  - Ollama URL (default `http://localhost:11434`; restart-required flag in UI)
  - Embedding model (free-text + dropdown of known options; restart-required)
  - Reranker enable/disable (hot-swappable via MCP tool call)
  - Default vault selection
  - "Advanced" collapsed section: indexer batch size, FTS tokenizer override
  Persistence via Obsidian `loadData()` / `saveData()` → `.obsidian/plugins/vault-memory/data.json`. Hot-swappable settings push to the running server via MCP tool call.

- **D-CHROME-SECRETS (PLG-02):** "Secrets & Credentials" UI panel.
  - List secrets by name + creation date only (value masked, never displayed in plaintext).
  - Add: prompt for `name` + `value` → `safeStorage.encryptString(value)` → persist ciphertext blob in `data.json`. (Synced across devices via Syncthing/iCloud if the plugin dir is synced; Electron decrypts per-device. Per-device ciphertext is correct security posture — secrets that don't decrypt on a new device prompt for re-entry.)
  - Delete: confirm + remove.
  - Reference syntax: `${secret:name}` in connector configs and MCP client credential fields. Server-side substitution via a new MCP tool (`resolve_secret({name})`) — returns plaintext only over local stdio transport, never logged.

- **D-CHROME-REINDEX (PLG-03):** One-click triggers — "Reindex this vault" (active) + "Reindex all vaults" (global). Full reindex only in v2.0.0; incremental is v2.x. Progress feedback via MCP streaming if SDK 1.29 supports it, polling fallback otherwise (planner picks). Respects `SuppressionSet` — won't conflict with concurrent watcher activity.

- **D-CHROME-STATS (PLG-04):** Per-vault snapshot, read-only, refresh button. Surfaces: notes indexed, chunks, last-index timestamp, embedding model + dimensions, audit_log row counts by `kind`, peer-MCP client connection status (green/red), contract count + last-load status. No graphs, no time series in v2.0.0. All reads via MCP tool calls — no direct DB access from the plugin.

- **D-CHROME-CONNECTORS (PLG-05):** List/add/remove peer-MCP clients declared in `[contracts.mcp_clients]`.
  - Plugin does NOT write `~/.vault-memory/config.toml` directly. Instead, mutations route through a new MCP tool (`set_mcp_client({name, command, args, env_secrets?})`) that owns the config write. The server is the authority for its own config.
  - Each peer-MCP entry can reference PLG-02 secrets via `${secret:name}` substitution; server resolves at connection time.
  - "Test connection" button per client → server attempts `Client.connect()` → reports success/failure inline.
  - Cloud-source connectors (Notion / GitHub / etc.) are deferred to Phase 10/v3. The `mcp_clients` UI scaffold is the model that scales — same UI grows to handle them.

- **D-CHROME6 / D-MCP-SURFACE: New plugin-control MCP tools are gated by `[plugin] enabled = true` in `~/.vault-memory/config.toml`. Default OFF.** User confirmed via AskUserQuestion. The new tools (estimated 3–5: `set_runtime_config`, `resolve_secret`, `set_mcp_client`, possibly `get_runtime_stats`, `trigger_reindex`) are additive to the v1 surface but registered only when the plugin flag is set. This keeps `evals/v1-baseline/tools-list.snapshot.json` stable for non-plugin deployments (Phase 8 REL-08 ≤32-tool budget is preserved by default; plugin users opt into a slightly larger surface). The `vm-install` skill sets the flag during install; users can also flip it manually for headless plugin-less deployments that still want runtime config control.

### Distribution + Documentation (CAN-09, user-directed)

- **D-DIST-PRIMARY: `vm-install` skill is the primary v2.0.0 distribution channel.** A standalone GSD-compatible skill that downloads the plugin (GitHub Releases tarball — planner picks the exact artifact shape between `npm pack` output, a GitHub Release asset, or both), extracts to `.obsidian/plugins/vault-memory/`, sets the plugin's `manifest.json` enabled state in Obsidian's community-plugins config, and prompts the user to enable it in Obsidian Settings → Community Plugins. This bypasses the Obsidian community plugin store review/approval bottleneck (weeks of delay) for the v2.0.0 launch.

- **D-DIST-UPDATE: `vm-update` skill handles updates.** Same mechanism as `vm-install`; checks GitHub Releases for a newer version than the locally installed `manifest.json.version`. Both skills are out-of-band with the Obsidian plugin update UI (which only checks the community store).

- **D-DIST-SECONDARY: Obsidian community plugin store is a post-v2.0.0 soft launch.** Submitted after v2.0.0 ships and stabilizes (v2.0.1 or v2.1.0 timeframe). The store has review delay (weeks), so it is not on the v2.0.0 critical path. Once approved, Obsidian's built-in update flow becomes available; the `vm-update` skill remains for users who installed via the skill path.

- **D-SKILL-NAMING: All vault-memory skills prefix with `vm-`.** Matches the `vm_` tool prefix from Phase 6 D-A1c (separator differs: `vm-` for skills follows skill-naming convention; `vm_` for tools follows tool-naming convention; both convey the same brand). v2.0.0 ships at minimum `vm-install` and `vm-update`. Future skills out of Phase 7 scope but reserved under the same prefix (e.g., `vm-bootstrap-vault`, `vm-author-contract`). Skill discovery convention + storage path (likely `skills/vm-*/SKILL.md` per GSD conventions) — planner verifies.

- **D-DOCS-SET: Plugin documentation lives in `docs/v2/plugin/`.**
  - `INSTALL.md` — `vm-install` skill instructions + manual sideload fallback (`.obsidian/plugins/vault-memory/` layout)
  - `SETTINGS.md` — every settings knob, with restart-required vs hot-swappable flagged
  - `SECRETS.md` — Schlüsselbund integration explained, how `${secret:name}` works, per-device ciphertext implications
  - `CONTRACT-EDITOR.md` — walkthrough: open a `.contract`, use palette, edit inspector forms, save → see `.yaml` emitted
  - `CONNECTORS.md` — adding peer-MCP servers, testing connections, referencing secrets

- **D-SCREENCAST: One ≤8-minute screencast.** Covers install (`vm-install` skill) → first contract authored in the editor → first `instantiate_contract` call. Published as `.mp4` hosted on GitHub releases (no YouTube dependency), linked from README and `docs/v2/plugin/INSTALL.md`.

- **D-VERSION: Plugin `manifest.json.version` follows the vault-memory main version.** v2.0.0 plugin matches v2.0.0 server. `minAppVersion` in manifest pinned to a known-good Obsidian version (planner picks; likely current LTS at Phase 7 ship time).

### Spike — Jsoncanvas Fork Viability (CAN-10)

- **D-SPIKE: Pre-implementation spike is the first deliverable.** Lands as ADR `docs/v2/adr/007-contract-editor.md` + a working prototype Obsidian plugin rendering one reference contract (`meeting-prep.contract`) in a `registerView` view using forked jsoncanvas renderer code. Includes a verified MIT-compatible license check on the upstream jsoncanvas repo. Go/no-go gate: if the fork is non-viable (renderer too coupled to `.canvas` format semantics, license incompatible, prototype takes >1 week of effort), Phase 7 escalates to a re-discuss to choose between (a) building the renderer from scratch (Phase 7 grows substantially) or (b) descoping to one of the discussed alternative variants (A/B/D) documented at `.planning/phases/07-visual-contract-editor-canvas/design-variants/`. **Spike MUST land before the bulk editor work begins** — this is the single highest implementation risk in Phase 7.

### Claude's Discretion

Several implementation areas are deliberately not discussed. Planner + researcher choose, anchored by the locked decisions above + the new ROADMAP + REQUIREMENTS framing.

- **Plugin framework choice (Svelte / React / vanilla).** Recommendation lean: Svelte (compiles to small footprint suitable for Obsidian; community precedent in popular Obsidian plugins). Planner confirms based on jsoncanvas-fork compatibility.
- **Exact `.contract` JSON schema beyond the D-FORMAT-SCHEMA sketch.** Planner finalizes the schema in plan 07-01 alongside ADR 007.
- **MCP tool naming for plugin-control tools.** Suggested names: `set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats`, `trigger_reindex`. Planner finalizes the closed set; default-OFF `[plugin] enabled` gate keeps snapshot stability.
- **Inspector form library.** Likely Svelte's reactive form primitives + a thin Zod→form adapter (~100 LOC). Planner picks based on Zod-to-form-renderer ergonomics.
- **Default node layout algorithm for `.yaml` imports without editor-state comment.** Recommendation lean: simple left-to-right topological sort of assembly steps with a fixed grid; inputs/sources/sinks rendered in the palette panel (not on canvas in Variant C).
- **Plugin bundling / build pipeline.** Likely esbuild (Obsidian plugin standard). Planner confirms.
- **Telemetry: none.** Plugin emits no telemetry. The stats panel is local-only and reads from the running server via MCP. This aligns with PROJECT.md "no telemetry" constraint.
- **Settings restart-vs-hot-swap mapping.** Planner classifies each setting; UI shows a clear flag per setting. Restart-required = embedding model, FTS tokenizer, Ollama URL. Hot-swappable = reranker on/off, default vault, indexer batch size.
- **Reindex progress streaming protocol.** MCP SDK 1.29 streaming if available; polling fallback. Planner verifies SDK capability.
- **`vm-install` skill storage location in the repo.** Likely `skills/vm-install/SKILL.md` per GSD conventions; planner verifies.
- **Secrets ciphertext format details.** Planner picks `safeStorage.encryptString` directly + base64-wrap in JSON, vs a thin wrapper that adds a version byte for future format migrations.
- **Error UX for `${secret:name}` resolution failures.** Recommendation lean: server returns `{ok:false, reason:"secret_not_found", name:"..."}`; plugin surfaces inline in the connector UI.
- **Per-vault vs global plugin scope.** Plugin is per-vault (Obsidian plugin model). Global settings persist in `data.json` per Obsidian convention; multi-vault deployments need to install per-vault (acceptable for v2.0.0; v2.x may add a workspace-level config).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 7 framing (the WHAT)
- `.planning/REQUIREMENTS.md` §"vault-memory Obsidian Plugin — Contract Editor + Chrome (Phase 7)" — CAN-01..CAN-10 and PLG-01..PLG-05 (the precise deliverable list; just rewritten 2026-05-18)
- `.planning/ROADMAP.md` §"Phase 7: vault-memory Obsidian plugin (contract editor + chrome)" — goal + 5 success criteria (just rewritten 2026-05-18)
- `.planning/PROJECT.md` — v2 mission; "user-defined task contracts that any MCP-aware agent can discover and instantiate" (Phase 6 thesis Phase 7 makes accessible); note PROJECT.md uses Phase 8 numbering for Canvas editor — ROADMAP is authoritative
- `.planning/phases/07-visual-contract-editor-canvas/07-DISCUSS-CHECKPOINT.json` — full decision history including the four UI variants explored and the rationale for each pivot

### Design exploration (the WHY behind Variant C)
- `.planning/phases/07-visual-contract-editor-canvas/design-variants/VARIANT-A-literal-dag.md` — rejected: one-node-per-step DAG
- `.planning/phases/07-visual-contract-editor-canvas/design-variants/VARIANT-B-swimlanes.md` — rejected: swimlanes by YAML section
- `.planning/phases/07-visual-contract-editor-canvas/design-variants/VARIANT-C-palette-ide.md` — **chosen** (with pivot to custom `.contract` format)
- `.planning/phases/07-visual-contract-editor-canvas/design-variants/VARIANT-D-whiteboard.md` — rejected: sigil-tagged free layout
- `.planning/phases/07-visual-contract-editor-canvas/design-variants/SUMMARY-comparison.md` — full usability matrix
- `/Users/wrede/Documents/Obsidian Vaults/VM-Dev/Phase-07-Canvas-Variants/` — four `.canvas` mockups rendering `meeting-prep` four ways (visual proof artifacts; NOT shipped, kept for reference)

### Phase 6 outputs Phase 7 consumes directly
- `.planning/phases/06-task-contract-dsl/06-CONTEXT.md` — D-A1 dual MCP surface (auto_register_tools default OFF — Phase 7 plugin-control tools follow the same gating pattern via `[plugin] enabled`); D-A2a closed verb enum (CAN-04 palette source); D-A2b list_contract_verbs Resource (PLG-04 stats panel reads from this); D-A2c named-binding template grammar (CAN-07 round-trip must preserve verbatim); D-A3a JSON Schema inputs (PLG-04 inspector form generator reads this); D-A3b type catalog ($ref resolver — palette type-catalog source); D-A4c MemorySink invariant (CAN-08 write_back paths must satisfy); D-LOAD hot-reload pattern (CAN-08 SuppressionSet integration)
- `docs/v2/adr/006-task-contract-dsl.md` — defines the YAML contract shape `.contract` round-trips to
- `evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml` — round-trip baseline 1
- `evals/fixtures/v2-test-vault/_contracts/project-status.yaml` — round-trip baseline 2
- `evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml` — round-trip baseline 3
- `evals/fixtures/v2-test-vault/_contracts/smoketest-trivial.yaml` — minimal `literal`-only fixture (Phase 7 should also round-trip this cleanly)

### ADRs lock the type contracts and invariants
- `docs/v2/adr/001-document-identity.md` — opaque `DocId`; URI shape used by `$ref: '#/types/DocId'` in the palette type catalog
- `docs/v2/adr/002-adapter-seams.md` — `DeliveryAdapter` interface (the `.yaml` emission goes through this; plugin does not touch the FS directly for vault writes)
- `docs/v2/adr/003-document-shape.md` — `Document` shape (`.contract` and `.yaml` are both Documents); `PropertyBag` for properties
- `docs/v2/adr/004-memory-sink-handles.md` — `MemorySinkRegistry`; PLG-05 connector mgmt for peer-MCP doesn't touch sinks, but the design parallel (registry + handle resolution) informs the UI shape
- `docs/v2/adr/005-brief-compile-strategy.md` — Phase 5 LLM ladder applies to `compile_brief` verb (palette entry exposes it)
- `docs/v2/adr/006-task-contract-dsl.md` — Phase 6 contract shape (mandatory read for any plugin code touching `.yaml` emission)
- `docs/v2/adr/007-contract-editor.md` (NEW — authored by spike deliverable, plan 07-spike) — `.contract` JSON schema, jsoncanvas fork rationale, Variant C UI, plugin-tool gating, CAN-07 canonicalization rules verbatim
- `docs/v2/ARCHITECTURE.md` §"L4 — Compiled briefs + Task contracts" — Phase 7 introduces an L5 user surface (the plugin); ADR 007 documents the layer addition
- `docs/v2/AGENT_AGNOSTIC.md` — Phase 7 plugin is one delivery mechanism for vault-memory; MCP server is canonical; ChatGPT Custom Connectors / Claude Desktop / generic MCP clients still consume the same surface
- `docs/v2/MEMORY_CONTRACT.md` — contract write_back paths must satisfy MEM-05; plugin editor doesn't change this — it just authors the contract that the server later instantiates

### Phase 1–6 code Phase 7 reads or extends
- `src/contracts/types-catalog.ts` — palette type catalog source (`DocId`, `Handle`, `ChunkId`, `MemorySink`); plugin imports this OR re-encodes the same shape (planner picks based on plugin/server code-sharing strategy)
- `src/contracts/schema.ts` — Phase 6 `ContractFileSchema`; the plugin's `.yaml` emission MUST validate against this; the plugin imports this OR consumes a `validate_contract` MCP tool (planner picks)
- `src/contracts/verbs/index.ts` — 11 baseline verbs + `literal` (palette compile-time source)
- `src/contracts/loader.ts` — Phase 6 D-LOAD watcher; the `ContractRegistry` ChangeFeed handler is the consumer of the plugin's `.yaml` emissions (via SuppressionSet gate)
- `src/contracts/instantiate.ts` — `instantiate_contract` end-to-end orchestrator; PLG-04 stats panel surfaces invocation counts from `audit_log` `kind: "contract_step"` rows that this writes
- `src/adapters/change-feed/obsidian-fs/suppression.ts` — `SuppressionSet` (CAN-08 reuse target)
- `src/adapters/change-feed/types.ts` — `ChangeFeed.subscribe()` (Phase 6 D-LOAD); Phase 7 adds zero new ChangeFeed subscribers
- `src/adapters/delivery/index.ts` — `DeliveryAdapter.write()`; if the plugin needs to write `.yaml` through the same chokepoint as `instantiate_contract` does, route through this — but planner verifies whether the plugin can use this directly or needs an MCP tool wrapper (boundary question)
- `src/tool-registry.ts` — new plugin-control tools register here, gated by `[plugin] enabled`
- `src/server.ts` — wire the new tools after `MemorySinkRegistry` + `ContractRegistry` (existing Phase 6 ordering)
- `src/config/loader.ts` — extend AppConfigSchema with `[plugin]` section: `enabled: boolean (default false)`
- `src/db/queries/audit.ts` — PLG-04 stats reads audit_log row counts via existing aggregation queries (Phase 6 D-A2b adds `kind: "contract_step"` rows; PLG-04 surfaces these)

### Forked dependency
- https://jsoncanvas.org/ — JSON Canvas spec home; renderer code likely at https://github.com/jsoncanvas (planner verifies); MIT-license verification is a CAN-10 spike prerequisite

### NEW Phase 7 modules (`plugin/` — separate package tree, not under `src/`)
- `plugin/manifest.json` — Obsidian plugin manifest; `id: "vault-memory"`, `name: "vault-memory"`, `version: <matches main pkg>`
- `plugin/main.ts` — plugin entry point; registers view (`vault-memory-contract-editor`), extension (`.contract`), settings tab, MCP client connection to running `vault-memory serve`
- `plugin/src/views/contract-editor/*` — Variant C editor (palette + canvas + inspector); forked jsoncanvas renderer lives here
- `plugin/src/settings/*` — PLG-01 settings tab
- `plugin/src/secrets/*` — PLG-02 safeStorage-backed secrets UI
- `plugin/src/panels/stats.ts` — PLG-04 stats panel
- `plugin/src/panels/reindex.ts` — PLG-03 reindex trigger UI
- `plugin/src/panels/connectors.ts` — PLG-05 connector management UI
- `plugin/src/mcp-client.ts` — plugin's MCP client connection to the running server
- `plugin/styles.css` — plugin styles; inherits Obsidian theme variables
- `plugin/tests/*` — vitest unit tests + a small Playwright suite for the editor view

### NEW Phase 7 skill modules (`skills/vm-*` — TBD path)
- `skills/vm-install/SKILL.md` — `vm-install` skill definition
- `skills/vm-update/SKILL.md` — `vm-update` skill definition

### NEW Phase 7 examples + docs
- `examples/contracts/meeting-prep.contract` — reference contract 1
- `examples/contracts/project-status.contract` — reference contract 2
- `examples/contracts/code-review-brief.contract` — reference contract 3
- `examples/contracts/round-trip.test.ts` — CAN-07 acceptance test
- `docs/v2/plugin/INSTALL.md`
- `docs/v2/plugin/SETTINGS.md`
- `docs/v2/plugin/SECRETS.md`
- `docs/v2/plugin/CONTRACT-EDITOR.md`
- `docs/v2/plugin/CONNECTORS.md`
- Screencast `.mp4` hosted on GitHub Releases for v2.0.0 plugin tag

### Codebase maps (read for Phase 7 mechanics)
- `.planning/codebase/ARCHITECTURE.md` — layer model; `plugin/` is L5 (user surface), separate from `src/` (L0–L4)
- `.planning/codebase/STRUCTURE.md` — "Where to Add New Code" recipes; `plugin/` is a NEW top-level directory (not under `src/`)
- `.planning/codebase/CONVENTIONS.md` — ESM, kebab-case files, Zod discipline; plugin follows the same; plugin TypeScript config inherits the root `tsconfig.json` strict mode
- `.planning/codebase/TESTING.md` — vitest layout extends to `plugin/`; Playwright for the editor view is the only new test runner introduced

### External references (the planner researches these against current versions)
- Obsidian Plugin API docs — `Plugin`, `PluginSettingTab`, `View`, `WorkspaceLeaf`, `registerView`, `registerExtensions`, `safeStorage` (https://docs.obsidian.md/)
- Obsidian community plugin store submission process (for D-DIST-SECONDARY post-v2.0.0)
- Electron `safeStorage` API — per-device encryption semantics
- jsoncanvas spec at jsoncanvas.org — file format definition (decorative use only — we are NOT shipping `.canvas` as authoring, but the renderer fork operates on similar data shapes)
- MCP SDK 1.29 docs — `notifications/*` (D-WATCH-SERVER-NOTIFY uses these), streaming responses (PLG-03 progress feedback if supported)

### Operating-environment context (informs design choices)
- **Few expert users, shared vault, multi-device sync** — `safeStorage` per-device ciphertext is the right posture (synced ciphertext won't decrypt on a second device → prompts re-entry, which is correct behavior); editor-state comment in `.yaml` survives the same sync substrate as the contract; per-vault plugin install is acceptable
- **Solo maintainer (Oliver)** — minimal chrome philosophy (D-CHROME-PHILOSOPHY) explicitly trades scope for sustainability; `vm-install`/`vm-update` skills bypass the Obsidian community plugin store review delay so v2.0.0 ships when Oliver decides
- **Local-only network, Ollama localhost only** — plugin makes no outbound network calls except GitHub Releases (for `vm-install`/`vm-update` skills, which are user-triggered); all server communication is local stdio MCP
- **No telemetry** — explicit per PROJECT.md; the stats panel is local-only and the plugin emits nothing externally

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`SuppressionSet`** (`src/adapters/change-feed/obsidian-fs/suppression.ts`) — CAN-08 reuse target verbatim; plugin calls `.suppress(path, hash)` before every `.yaml` write; Phase 6 ChangeFeed handler calls `.matches(path, hash)` to skip echoes.
- **`ContractRegistry` + ChangeFeed pattern** (`src/contracts/loader.ts`, Phase 6 D-LOAD) — already in place; Phase 7 needs zero new watchers; the plugin's `.yaml` emissions land on the existing handler.
- **Phase 6 `ContractFileSchema`** (`src/contracts/schema.ts`) — single Zod validator for `.yaml`; the plugin's `.yaml` emission must pass this. Plugin either imports the schema (if code-shared via a `packages/shared` boundary the planner designs) or consumes a `validate_contract` MCP tool.
- **Phase 6 type catalog** (`src/contracts/types-catalog.ts`) — palette type-catalog section source; same data, two consumers (server-side `$ref` resolver + plugin-side palette UI).
- **Phase 6 verb enum** (`src/contracts/verbs/index.ts`) — palette compile-time source for the 11 baseline verbs + `literal`; single source of truth.
- **MCP SDK 1.29 `Client`** — plugin's MCP client connection to the running `vault-memory serve`; pattern matches Phase 6's peer-MCP `mcp://` extension (`src/contracts/mcp-clients.ts`).
- **MCP SDK 1.29 notifications** — D-WATCH-SERVER-NOTIFY uses `notifications/*` shape; Phase 6 already uses `notifications/tools/list_changed`, so the pattern is in place.
- **`audit_log` aggregation queries** (`src/db/queries/audit.ts`) — PLG-04 stats reads via existing query shapes (Phase 6 D-A2b precedent for aggregating `kind: "contract_step"` rows applies to all `kind` values).
- **Phase 5 brief panel pattern** — for stats panel layout reference (read-only, periodic-refresh, MCP-tool-backed); planner verifies if there's reusable UI primitives or if this is greenfield.
- **`tool-registry.ts` gating pattern** — Phase 6 D-A1 (default-OFF `auto_register_tools` gating) is the exact pattern Phase 7 plugin-control tools follow with `[plugin] enabled`.

### Established Patterns
- **Adapter-seam discipline** — no `fs`, `gray-matter`, `path.join` outside `src/adapters/*/`. The plugin lives outside `src/` entirely (`plugin/`), so the rule technically doesn't apply — but the plugin SHOULD NOT touch the vault's `_contracts/` directory directly via `fs`. Instead, it writes through `DeliveryAdapter` via an MCP tool (or via Obsidian's file API, which is its own adapter). Planner decides which.
- **Strictly additive schema migrations** — Phase 7 adds NO new DB tables. Reuses `audit_log` for plugin-action records (if any). May add a single `audit_log_idx_plugin_action` index — planner decides.
- **Default-OFF config gates for new tool surface** — Phase 6 D-A1 pattern (auto_register_tools), Phase 7 D-MCP-SURFACE pattern (plugin-control tools). `tools-list.snapshot.json` stays stable in the no-plugin default; users opt in.
- **Vitest co-location** — plugin tests co-locate per-module (`plugin/src/views/contract-editor/editor.test.ts`, etc.).
- **Per-vault config in `~/.vault-memory/config.toml`** — Phase 6 `[contracts]` section pattern; Phase 7 adds `[plugin]` section symmetrically.
- **MCP Resources for read-only enumeration** — PLG-04 stats could use a Resource (`vault-memory://stats/{vault}`) instead of a Tool (`get_runtime_stats`); planner picks based on which pattern Phase 5 + Phase 6 settled on for similar read-only enumerations.

### Integration Points
- **`src/config/loader.ts`** — extend AppConfigSchema with `[plugin]` section: `enabled: boolean (default false)`. Future: `plugin.secrets_path` if Phase 7.x adds external secret stores beyond safeStorage.
- **`src/tool-registry.ts`** — register the 3–5 new plugin-control tools gated by `[plugin] enabled`; also register `vault-memory://stats/{vault}` Resource if PLG-04 lands as a Resource.
- **`src/server.ts`** — wire any new MCP notifications (D-WATCH-SERVER-NOTIFY) and instantiate the plugin-control tool handlers after `ContractRegistry`.
- **`src/contracts/loader.ts`** — Phase 6 ChangeFeed handler now MUST honor `SuppressionSet.matches(path, hash)` for `_contracts/*.yaml` events; planner verifies whether Phase 6 already does this or if it needs a Phase 7 amendment (likely needs amendment — Phase 6 watched contract files but didn't suppress its own writes because Phase 6 didn't WRITE contract files).
- **`src/db/queries/audit.ts`** — PLG-04 stats reads existing aggregation queries; possibly extend with one new aggregation for plugin-action rows if those exist as a new `kind`.
- **NEW directory `plugin/`** at repo root — separate npm package (or workspace member), separate tsconfig (extends root), bundled with esbuild (Obsidian convention).
- **NEW directory `examples/contracts/`** — three reference `.contract` files + round-trip test.
- **NEW directory `docs/v2/plugin/`** — 5 markdown docs.
- **NEW directory `skills/vm-install/`, `skills/vm-update/`** — TBD path per GSD skill conventions; planner verifies.
- **GitHub Releases** — `vm-install`/`vm-update` skills consume; planner picks the artifact shape (tarball vs npm pack vs raw zip).

</code_context>

<specifics>
## Specific Ideas

- **The spike (CAN-10) is the first deliverable, not the last.** Plan 07-spike ships before any bulk editor work — same discipline as Phase 0/2/4/5/6 ADR-first authoring. If the jsoncanvas fork is non-viable, Phase 7 escalates BEFORE the team has built around a doomed assumption. ADR 007 + working prototype rendering `meeting-prep.contract` is the gate.

- **The `vm-` skill-naming convention is a project-wide rule, not just a Phase 7 concern.** Reserves the `vm-*` namespace for vault-memory skills indefinitely. Mirrors the Phase 6 `vm_*` tool prefix decision; different separator only because skill conventions and tool conventions differ.

- **Editor state in a YAML comment is a deliberate "be invisible to YAML editors" choice.** A user who never opens the plugin can edit `.yaml` in any editor; the comment block is benign noise to them. If they save and round-trip back into the plugin, the layout falls back to default — no data loss, just spatial-layout loss. This is the correct trade-off for "few expert users on a shared vault."

- **Per-device `safeStorage` ciphertext is the right posture, not a bug.** A secret encrypted on Oliver's MacBook can't be decrypted on his iPad — that's good. The user re-enters the secret on the new device (one-time friction). This matches the security model of every modern password manager.

- **Plugin-control tools gated by `[plugin] enabled` keeps the v1 promise.** Phase 8 REL-08 (≤32 tools) is preserved by default; the snapshot test stays green for non-plugin deployments; plugin users opt in to ~3–5 additional tools. The opt-in is the `vm-install` skill setting the flag during install.

- **`vm-install` + `vm-update` skills sidestep the Obsidian plugin store delay.** Community plugin store review takes weeks. v2.0.0 ships when it's ready; the skills are the canonical install path. Store submission is a v2.0.x cleanup task with no critical-path impact.

- **No new ChangeFeed handlers in Phase 7.** Phase 6 added the third (contract loader). Phase 7 reuses it via `SuppressionSet` — the plugin's `.yaml` emissions echo through the existing handler, and the suppression gate kills the loop. Zero new watcher infrastructure.

- **Plugin documentation is 5 markdown files + 1 screencast.** Not 20 files. Each doc serves one user task (install, settings, secrets, editor walkthrough, connectors). The screencast is one end-to-end flow showing the whole stack working together.

- **`.contract` is a vault-memory-owned format, fully documented in ADR 007.** It is not an Obsidian Canvas variant; it is not a YAML wrapper; it is a typed JSON document with a defined schema and a defined evolution policy (additive only, version field `vmFormatVersion: 1` reserved for future migrations). Phase 7 is the moment vault-memory takes ownership of its authoring file format.

- **Variant C was chosen specifically for typed-form args editing.** The single biggest UX risk in contract authoring is `{{alias.field}}` template errors and wrong verb args. The inspector form, generated from each verb's Zod schema with autocomplete for in-scope aliases, eliminates that error class structurally — not by validation alone but by making the wrong thing un-typeable.

- **Documentation references the four design variants as historical context.** Future maintainers reading ADR 007 can see why C beat A/B/D, what trade-offs were accepted, and what the fallback path looks like if the spike outcome forces a re-discuss.

</specifics>

<deferred>
## Deferred Ideas

- **`.contract → .canvas` one-way exporter** for vanilla Obsidian read-only viewing. Useful for non-plugin users who want a static preview. Phase 7.x or v2.1.
- **Bidirectional `.contract ↔ .yaml` editing where user edits YAML and plugin watches** — partially handled by D-WATCH-SERVER-NOTIFY (prompt on external edit), but full conflict resolution / 3-way merge is deferred. v2.x territory if user demand emerges.
- **In-plugin agent chat surface** (run a contract from inside Obsidian, see results inline). v2.1.
- **Plugin auto-update via Obsidian community store flow** — once the store submission lands (D-DIST-SECONDARY), Obsidian's built-in update UI works; `vm-update` skill remains for skill-installed users.
- **Contract version migration UI** (e.g., v1 → v2 contract schema upgrade). Only relevant when `vmFormatVersion` or Phase 6 `version` changes.
- **Visual diff for `.contract` changes** (compare two `.contract` versions side-by-side). v2.x power-user feature.
- **Theming / dark-mode controls** — inherit from Obsidian theme variables; minimal explicit work in v2.0.0.
- **Incremental reindex** (vs full only in v2.0.0). v2.1.
- **Reindex progress as a streaming notification with a progress bar** beyond what MCP SDK 1.29 ships — polling fallback is acceptable for v2.0.0.
- **Stats panel time series / graphs** — read-only snapshot only in v2.0.0.
- **Connector capability inspection beyond verb names** (e.g., per-peer-MCP server schema browsing). v2.x.
- **Cloud-source connector UI** (Notion, GitHub, etc.) — deferred to Phase 10/v3; PLG-05's scaffold is the model that grows.
- **Multi-vault workspace plugin config** — per-vault only in v2.0.0; v2.x may add workspace-level.
- **`vm-bootstrap-vault` skill** — bootstraps a new vault-memory-ready vault. Out of Phase 7 scope but reserved under the `vm-` namespace.
- **`vm-author-contract` skill** — AI-assisted contract authoring from a natural-language brief. Out of Phase 7 scope but reserved under the `vm-` namespace.
- **Plugin telemetry** — explicitly rejected per project constraint; not deferred, permanently out.
- **Web-based contract editor** (run the same Variant C editor in a browser instead of Obsidian). Far out of v2.0.0; if v3 multi-source demands it, revisit then.
- **CLI scaffolder for new contracts** (the original CAN-05 "OR CLI scaffolder" path) — superseded by the plugin's "new contract" action; CLI scaffolder out of v2.0.0.
- **External secret stores** (1Password CLI / HashiCorp Vault / etc.) — `safeStorage` only in v2.0.0; external stores via custom MCP tools is a v2.x extension point.

</deferred>

---

*Phase: 07-visual-contract-editor-canvas*
*Context gathered: 2026-05-18*
