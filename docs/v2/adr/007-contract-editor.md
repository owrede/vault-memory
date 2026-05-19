# ADR-007 — Contract Editor (Obsidian plugin + `.contract` JSON format)

**Status:** Accepted
**Date:** 2026-05-19
**Phase:** 7 — vault-memory Obsidian plugin (contract editor + chrome)
**Supersedes:** none
**Superseded by:** none
**Related:** ADR-001 (document identity), ADR-002 (adapter seams), ADR-003 (document shape), ADR-006 (task contract DSL).

---

## Context

Phase 7 makes vault-memory's Phase 6 task contracts authorable from inside Obsidian. v1.0.0 ships a strong retrieval substrate (23 MCP tools, hybrid search, live indexing); Phase 6 added the task-contract layer (`describe_contract`, `instantiate_contract`, `register_contracts_as_tools`); Phase 7 closes the loop with a **visual editor** so users do not hand-edit YAML to author a contract.

Two co-equal parts ship in v2.0.0:

1. A **visual contract editor** — a three-pane Obsidian plugin view (palette + canvas + properties inspector) that authors a vault-memory-owned `.contract` JSON file and emits valid Phase 6 YAML on every save.
2. **Plugin chrome** — settings, key-ring secrets, manual reindex, stats panel, peer-MCP connector management — so vault-memory is operable from inside Obsidian without dropping to a terminal.

The original ROADMAP framing assumed (a) Obsidian's built-in `.canvas` format would be the authoring file, and (b) a "fork of the jsoncanvas.org renderer" would supply the editor canvas. Both assumptions are rejected by this ADR. See the `## Pitfalls` section below.

This ADR locks the surface area, the file format, the canonicalization rules, the watcher integration, and the MCP-tool gating posture for the entire phase. It is the source of truth that every subsequent Phase 7 plan reads.

Phase 7 introduces an **L5 user-surface layer** in `docs/v2/ARCHITECTURE.md` terms — the only non-MCP user interface in the project. The MCP server surface is extended additively (a small set of new tools gated by `[plugin] enabled`); no v1 tool is modified.

---

## Decision: D-UI — Variant C (palette + canvas + properties inspector)

The contract editor is a three-pane IDE-like surface:

- **Left palette** — type catalog + read/assembly verbs + `literal` escape + peer-MCP (dynamic).
- **Center canvas** — assembly DAG only, rendered via Svelte Flow. **Inputs, sources, sinks, and `write_back` are NOT canvas nodes.** They live in palette panels and inspector forms.
- **Right properties inspector** — typed forms generated from each verb's Zod schema; `{{alias.field}}` typeahead picker built from in-scope alias × field pairs.

Rationale: typed forms eliminate the largest single class of contract-authoring errors — mistyped `{{alias.field}}` references, wrong verb args, missing required args — by making the wrong thing un-typeable, not just invalid.

Three alternative UI variants (A literal-DAG / B swimlanes / D whiteboard) were explored as full design docs at `.planning/phases/07-visual-contract-editor-canvas/design-variants/` and rendered as `.canvas` mockups for visual comparison. Variant C was chosen for typed-form-arg editing. Variants A/B/D remain on file as the fallback path if the spike outcome forces a re-discuss.

## Decision: D-SURFACE — Obsidian plugin via `registerView` + `registerExtensions(["contract"])`

The plugin registers a custom view type (`vault-memory-contract-editor`) for the `.contract` file extension. Opening any `.contract` file in Obsidian launches the editor automatically via the standard Obsidian `TextFileView` lifecycle.

**The plugin is NOT an Obsidian Canvas extension.** It does not extend or interact with Obsidian's built-in `.canvas` view. Rationale (user direction): the plugin must control its UI without fighting Obsidian's canvas chrome — that gives a more stable editor and clearer visual contract.

`isDesktopOnly: true` is set in `manifest.json`. Mobile Electron does not exist; `safeStorage`, `child_process`, and the MCP-stdio transport all require desktop.

## Decision: D-FORMAT — Custom `.contract` JSON format owned by vault-memory

Obsidian's built-in `.canvas` is **not** the authoring file. `.canvas` is generic infinite-canvas storage (text/file nodes + edges + groups) with no native model for typed-DAG contracts; every workaround (sigil-tagged text, custom metadata fields, hidden sidecars) leaks back to the same problem — Obsidian Canvas has no concept of a "contract step".

`.contract` is a vault-memory-owned typed JSON document with a defined schema (`ContractDocumentSchema` extending Phase 6's `ContractFileSchema`) and an additive-only evolution policy (version field `vmFormatVersion: 1` reserved for migrations). Phase 7 is the moment vault-memory takes ownership of its authoring file format.

## Decision: D-FORMAT-SCHEMA — `.contract` JSON shape (verbatim)

The `.contract` file carries the Phase 6 contract verbatim plus a single editor-state block. No sidecar files.

```jsonc
{
  "$schema": "https://vault-memory.dev/schemas/contract-v1.json",
  "vmFormatVersion": 1,
  "contract": { /* Phase 6 ContractFileSchema fields, byte-equivalent to YAML's parsed JS value */ },
  "editor": {
    "nodes": [ { "id": "step:meeting", "x": 0, "y": 0 }, /* ... */ ],
    "selection": null,
    "viewport": { "x": 0, "y": 0, "zoom": 1.0 },
    "yamlComments": { /* preserved YAML comment payload, see D-CANON */ }
  }
}
```

The `contract` block is the source of truth for everything Phase 6 cares about. The `editor` block is plugin-only state. Plugins newer than the file extend `editor` additively; older plugins must round-trip `editor` unchanged (treat unknown editor keys as opaque).

## Decision: D-FORMAT2 — editor state round-trips to YAML as a base64 comment block

Editor state survives the `.contract → .yaml → .contract` cycle as `# vm-editor-state: <base64-encoded JSON>` on the first line of the emitted `_contracts/*.yaml`. YAML parsers ignore the line; Phase 6's `yaml ^2.9` `parseDocument` preserves it across reloads; the plugin importer reads it to rebuild the editor view exactly.

If the comment is absent (e.g., user hand-authored the YAML), the importer falls back to a default layout computed deterministically from `assembly` step order (left-to-right topological sort, 220×120 grid per UI-SPEC). No data loss — only spatial layout regenerates from scratch.

Sidecar files were rejected to avoid desync risk. Discarding editor state on emission was rejected because users would lose spatial work when switching between Obsidian-edit and editor-edit sessions.

`vmFormatVersion` is also embedded INSIDE the base64-encoded editor state (Resolved Question 2 in 07-RESEARCH §"Open Questions"). This future-proofs `.yaml`-only round-trips against plugin format migrations.

## Decision: D-AUTH — `.contract` is editor source of truth; `.yaml` is the build artifact

The plugin writes `.contract` (editor source) and synthesizes `_contracts/*.yaml` on every save. The Phase 6 `ContractRegistry` watches `_contracts/*.yaml` for hot reload (D-LOAD pattern unchanged). The plugin does NOT watch its own `.contract` files — Obsidian's view lifecycle already fires open/close/save events (D-WATCH-NO-PLUGIN-WATCH).

The watcher direction inverts what the original ROADMAP assumed: the editor writes YAML; the server reads YAML; there is no `.canvas → .yaml` watcher path.

## Decision: D-CANON — Canonicalization rules (verbatim, normative)

These rules apply on every `.contract → .yaml` emission. Test target lives at `examples/contracts/round-trip.test.ts` (CAN-07 acceptance test).

**Always canonical (no user agency):**

- YAML key order matches Phase 6 ADR-006 §Decision 2 schema order: `version`, `name`, `description`, `inputs`, `required`, `sources`, `sinks`, `assembly`, `output_shape`, `write_back`.
- `assembly` step order matches the DAG: topological sort by read-back dependency edges; tiebreak by node Y position ascending, then node X position ascending (deterministic per UI-SPEC §"Canvas Interaction Grammar — Reordering execution order").
- Default values are omitted when they equal schema defaults (do not emit `required: true` if it is the schema default; do not emit empty `description: ""` blocks; do not emit `additionalProperties: false` for `inputs` JSON Schema fragments — Phase 6 wraps it internally).

**Always preserved:**

- YAML comments via `yaml ^2.9` `parseDocument` / `toString` (Phase 6 CON-01 mechanism). Comments attached to specific document nodes ride with those nodes through the round-trip.
- `description` block scalars stay as `|` literal-block-scalar style (do not collapse to a folded `>` or to a flow `"…"`).
- User-authored `mcp://<server>/<tool>` URIs preserved verbatim (no normalization of case, no path canonicalization).

**Editor state survives:**

- `# vm-editor-state: <base64>` comment block at the YAML head per D-FORMAT2.

## Decision: D-CANON-TEST — CAN-07 acceptance test

For each of the three reference contracts (`meeting-prep`, `project-status`, `code-review-brief`) and the trivial smoke-test fixture (`smoketest-trivial`):

```
read original.yaml
  → parse → emit .contract                        (round 1: import)
  → emit .yaml from .contract                     (round 1: export)
  → parse → emit .contract                        (round 2: import)
  → emit .yaml from .contract                     (round 2: export)
```

Assertions:

1. `parseDocument(round1_yaml).toJS()` `deepEqual` `parseDocument(round2_yaml).toJS()` (semantic equivalence after canonicalization — the second round-trip is byte-equivalent because the first round canonicalized).
2. Both `round1_yaml` and `round2_yaml` start with `# vm-editor-state: <base64>` (editor-state preservation).
3. Original YAML parses semantically equivalent to `round1_yaml.toJS()` modulo canonicalization (the documented intentional reordering / default-omission cases).

The test fixture lives at `examples/contracts/round-trip.test.ts`. The plugin's codec module is the implementation under test.

## Decision: D-PALETTE — Five sections plus four panel bars

The palette has five collapsible top sections (draggable items) plus four bottom panel bars (contract-level state).

| Section | Source | Items |
|---|---|---|
| Types (collapsed default) | `src/contracts/types-catalog.ts` (compile-time) | `DocId`, `Handle`, `ChunkId`, `MemorySink` |
| Read verbs (expanded) | `src/contracts/verbs/index.ts` (compile-time enum) | `read_note`, `search_hybrid`, `search_sections`, `query_frontmatter`, `list_backlinks`, `get_outline`, `recall` |
| Assembly verbs (expanded) | same enum | `expand`, `cluster`, `compile_brief`, `get_brief` |
| Escape-hatch (collapsed) | same enum | `literal` |
| Peer-MCP (hidden when empty) | MCP `list_contract_verbs` Resource (Phase 6 D-A2b) — refreshed on plugin focus and on `notifications/tools/list_changed` | Dynamic per `[contracts.mcp_clients]` |

Bottom panel bars (Inputs / Sources / Sinks / Write_back) drive contract-level state and route through the inspector, not the canvas.

Baseline entries are compiled into the plugin at build time. Adding a baseline verb in Phase 6 (Phase 6 `src/contracts/verbs/index.ts`) automatically appears in the palette in Phase 7 on the next plugin rebuild — single source of truth.

## Decision: D-WATCH-PLUGIN-OUT — plugin signals echo suppression by hash

On `.contract` save, the plugin computes SHA-256 of the emitted YAML body, calls an MCP tool to register that hash with the server's `SuppressionSet` BEFORE writing the `.yaml`, then writes through Obsidian's `Vault.adapter.write(...)`.

`SuppressionSet`'s existing API is path-only (`add(path, ttlMs?)` / `consume(path)`). 07-RESEARCH §6 Pitfall 1 identifies that path-only TTL suppression loses a legitimate second edit if it lands inside the TTL window. **The plan extends `SuppressionSet` to be hash-keyed** as an additive change (~15 LOC): `add(path, { ttlMs?, hash? })` / `consume(path, hash?)`. Existing v1 call sites pass no hash and behave as before. Phase 7 plan 07-04 (or earlier) owns the amendment in `src/adapters/change-feed/obsidian-fs/suppression.ts` and the accompanying test.

## Decision: D-WATCH-SERVER-NOTIFY — server → plugin via MCP notification

When the Phase 6 ChangeFeed handler hot-reloads a contract from a YAML change that wasn't suppressed (i.e., the user edited the YAML directly outside the plugin), the server emits an MCP notification (`vault-memory://contracts/reloaded`). The plugin subscribes; if the path matches an open `.contract` view, it prompts the user via modal:

- Accept → re-import the YAML, rebuild the editor view (spatial layout regenerates from comment block or default).
- Decline → keep the editor state; the next plugin save overwrites the external YAML edits.

This is NOT a new file watcher. It rides MCP SDK 1.29's `notifications/*` mechanism — the same mechanism Phase 6 uses for `notifications/tools/list_changed`.

## Decision: D-WATCH-NO-PLUGIN-WATCH — plugin watches nothing

Phase 7 adds **zero** new ChangeFeed subscribers. Obsidian's `TextFileView` lifecycle (`onLoadFile`, `onUnloadFile`, `requestSave`) supplies everything the plugin needs for `.contract` events. The Phase 6 ChangeFeed handler already watches `_contracts/*.yaml`. No second watcher.

## Decision: D-MCP-SURFACE — plugin-control tools gated by `[plugin] enabled`

New plugin-control MCP tools are gated by `[plugin] enabled = true` in `~/.vault-memory/config.toml`. **Default OFF.** Confirmed via AskUserQuestion in the discuss phase.

The new tools (estimated 3–5: `set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats` (or Resource), `trigger_reindex`) are additive to the v1 surface but registered only when the plugin flag is set. This keeps `evals/v1-baseline/tools-list.snapshot.json` byte-stable for non-plugin deployments (Phase 8 REL-08 ≤32-tool budget preserved by default; plugin users opt into a slightly larger surface).

The `vm-install` skill sets the flag during install. Users can also flip it manually for headless plugin-less deployments that still want runtime config control.

The gating mirrors Phase 6 D-A1's `auto_register_tools` pattern verbatim (`src/contracts/auto-register.ts`'s `syncAutoRegistered` default-OFF gate).

## Decision: D-CHROME-PHILOSOPHY — minimal chrome in v2.0.0

Phase 7 ships the minimum chrome required to be discoverable and operable from inside Obsidian: settings (PLG-01), secrets (PLG-02), reindex (PLG-03), stats (PLG-04), connectors (PLG-05). Expansion is v2.x territory. Goal: "good enough", not "everything".

## Decision: D-DIST-PRIMARY — `vm-install` skill is the primary v2.0.0 distribution channel

A standalone GSD-compatible skill downloads the plugin from GitHub Releases, extracts to `.obsidian/plugins/vault-memory/`, and prompts the user to enable in Obsidian Settings → Community Plugins. This bypasses the Obsidian community plugin store review delay (weeks) for the v2.0.0 launch.

`vm-update` handles updates. Both skills are out-of-band with Obsidian's built-in update flow.

Obsidian community plugin store submission is a post-v2.0.0 secondary path (v2.0.1 or v2.1.0 timeframe).

## Decision: D-SKILL-NAMING — `vm-*` prefix for all vault-memory skills

All Phase 7+ skills prefix with `vm-` (mirrors `vm_` tool-prefix from Phase 6 D-A1c; separator differs because skill conventions use kebab, tool conventions use snake). v2.0.0 ships at minimum `vm-install` and `vm-update`. The existing `install-vault-memory` skill is NOT renamed (to avoid breaking user invocations); new skills sit under the new prefix alongside it.

## Decision: D-VERSION — plugin `manifest.json.version` follows the vault-memory main version

v2.0.0 plugin matches v2.0.0 server. `minAppVersion` is pinned to Obsidian 1.5.0 (current LTS-equivalent at Phase 7 ship time).

---

## Invariants

| ID | Statement | Enforced by |
|---|---|---|
| C-7-1 | The plugin writes only `.contract` and `.yaml` files in `_contracts/` (or sibling paths owned by the user); it never writes to memory sinks directly. | All sink-targeted writes route through `instantiate_contract` (Phase 6 D-A4c MemorySink chokepoint, unchanged). |
| C-7-2 | The plugin never imports Node `fs` against vault paths. | Use `app.vault.adapter.write(...)` only. The plugin is its own Obsidian-fs adapter per ADR-002 seam discipline. |
| C-7-3 | New plugin-control MCP tools register only when `config.plugin?.enabled === true`. | `syncPluginTools(...)` follows the `syncAutoRegistered` default-OFF gate verbatim (mirrors Phase 6 D-A1). |
| C-7-4 | `.contract → .yaml` canonicalization preserves YAML comments via `yaml ^2.9` `parseDocument` / `toString`. | CAN-07 round-trip test asserts this on three reference contracts + smoketest-trivial. |
| C-7-5 | The plugin never logs `${secret:name}` plaintext at any log level. | `resolve_secret` MCP tool returns plaintext only over local stdio; plugin redacts before any debug log. |
| C-7-6 | The `editor` block in `.contract` is opaque to non-Phase-7 readers; future plugin versions extend `editor` additively. | `EditorStateSchema` allows unknown keys (Zod `.passthrough()` or equivalent); older plugins round-trip unknown keys unchanged. |

---

## Threat Model

STRIDE coverage of the new attack surface introduced by Phase 7.

| ID | STRIDE | Component | Mitigation |
|---|---|---|---|
| T-07-SAFESTORAGE-DEVICE | Information Disclosure | `safeStorage` per-device ciphertext synced via Syncthing/iCloud/git | **Per-device ciphertext is the correct security posture** — synced ciphertext won't decrypt on a second device → user re-enters secret. Matches the password-manager security model. Documented in `docs/v2/plugin/SECRETS.md`. |
| T-07-SAFESTORAGE-LINUX | Information Disclosure | Linux `safeStorage` backend may be `basic_text` (no real keyring) | Plugin calls `getSelectedStorageBackend()` and surfaces a yellow warning in the Secrets panel when the backend is plaintext-equivalent. User can install `gnome-libsecret` / `kwallet` to upgrade. |
| T-07-PLUGIN-GATE | Elevation of Privilege | New plugin-control MCP tools could ship as default-on, polluting v1 baseline snapshot | **`[plugin] enabled` default-OFF gate.** v1 baseline `tools-list.snapshot.json` byte-stable for non-plugin deployments. Plan adds the gate to `src/config/loader.ts` and `src/plugin-tools/index.ts` mirroring Phase 6 D-A1's `auto_register_tools` shape (`syncAutoRegistered`). |
| T-07-V1-SNAPSHOT | Spoofing | Adding new tools to the always-on surface would invalidate `evals/v1-baseline/tools-list.snapshot.json` and break Phase 8 REL-08 budget | New tools register only when the gate is on; gate is OFF by default. Snapshot test stays green for non-plugin deployments. |
| T-07-TARBALL-MITM | Tampering | GitHub Releases tarball MITM during `vm-install` / `vm-update` | `vm-install` skill verifies SHA-256 checksum against a published `manifest.json` checksum file in the same release. Recommendation: also sign releases with maintainer GPG key (Phase 8 follow-up). |
| T-07-SECRET-LOG | Information Disclosure | Resolved `${secret:name}` plaintext leaks to a debug log or audit row | `recordContractStep` does not accept an output payload (Phase 6 Invariant C-5). `resolve_secret` returns plaintext only over local stdio; plugin redacts before any UI surface. Plaintext never reaches `audit_log`. |
| T-07-PEER-MCP-CRED | Tampering | A malicious peer-MCP entry steals credentials via tool-result echo | Connector "Test connection" does not pass secrets — only verifies reachability. Secrets resolve at actual contract-instantiation time, not at connection-test time. Peer server can request a secret BY NAME but cannot enumerate the namespace. |
| T-07-SUPPLY-CHAIN | Tampering | `npm install @xyflow/svelte` and the other plugin devDeps introduce JS that runs in Obsidian's renderer process | Per 07-RESEARCH §"Package Legitimacy Audit", all 7 packages (`@xyflow/svelte`, `svelte`, `esbuild`, `esbuild-svelte`, `svelte-preprocess`, `builtin-modules`, `tslib`) are [VERIFIED] npm-registry-confirmed + source-repo-confirmed + MIT-licensed. The Phase 7 spike checkpoint (Plan 07-01 Task 3) re-verifies `@xyflow/svelte`'s MIT license via `npm view @xyflow/svelte license` before Wave 2 begins. |

---

## Pitfalls

These are the load-bearing pitfalls that shaped this ADR. Future maintainers reading it should understand WHY the rescoping decisions were made.

### Pitfall 1 — jsoncanvas-fork rescope (07-RESEARCH §3, Pitfall 4)

**What we discovered.** The CAN-10 spike was originally framed as "fork the jsoncanvas.org renderer". On verification (07-RESEARCH §3), `github.com/obsidianmd/jsoncanvas` is a **spec repo** — it contains no renderer code. The three third-party `jsoncanvas` packages on npm (`@trbn/jsoncanvas`, `react-jsoncanvas`, `JSON-Canvas-Viewer`) are all MIT-licensed **viewers** without programmatic edit APIs.

**Why this matters.** A planner reading the original brief without verifying the upstream would scope plan 07-spike against a non-existent codebase — weeks of wheel-spinning before realizing the renderer must be built from scratch.

**Decision.** Drop the "fork jsoncanvas" framing entirely. Use **Svelte Flow (`@xyflow/svelte` 1.5.2, MIT-licensed)** as the canvas renderer. Svelte Flow:
- is built for this exact use case (typed-DAG editor),
- is maintained by the same team as React Flow (8+ years of production deployment),
- exposes full edit semantics (add/move/delete/connect nodes, snap-to-grid, accessibility, custom node components),
- has 107K weekly npm installs as a durability signal.

The spike thus becomes "wire Svelte Flow into a custom Obsidian `TextFileView`" — a 1–3 day prototype, not a renderer engineering effort. Plan 07-01 Task 2 lands this prototype; Plan 07-01 Task 3 is the go/no-go human-verify checkpoint.

### Pitfall 2 — SuppressionSet API mismatch (07-RESEARCH §6, Pitfall 1)

**What we discovered.** CONTEXT.md describes `SuppressionSet.suppress(path, hash)` / `matches(path, hash)`. The existing code at `src/adapters/change-feed/obsidian-fs/suppression.ts` is path-only TTL: `add(path, ttlMs?)` / `consume(path)`. Path-only suppression with a 2s TTL loses a legitimate second edit landing inside the TTL window (e.g., autoformat-on-save + manual save).

**Decision.** Extend `SuppressionSet` to be **hash-keyed** as a backwards-compatible additive change. New shape:

```typescript
add(path: string, opts?: { ttlMs?: number; hash?: string }): void;
consume(path: string, hash?: string): boolean;
```

When `hash` is omitted (v1 call sites), behavior is unchanged. When `hash` is provided on both sides, `consume` matches ONLY if hashes equal — a legitimate second edit with a different hash propagates as a real change event. Plan 07-04 (or earlier) owns the amendment + the accompanying unit test.

### Pitfall 3 — `src/contracts/loader.ts` does not call `consume()` (07-RESEARCH §6, Pitfall 2)

**What we discovered.** `grep -n "suppress" src/contracts/loader.ts` returns no matches. Phase 6 added `_contracts/*.yaml` watching but did not need suppression because Phase 6 did not write contracts.

**Why this matters.** Without the loader honoring suppression, the plugin's `.yaml` emission echoes back through ChangeFeed → loader re-validates → registry hot-reloads — twice per save, every save. Two-way I/O loop.

**Decision.** Plan 07-04 (or earlier) amends `src/contracts/loader.ts`'s `handleChangeEvent` to read the on-disk hash of the YAML body and short-circuit if `suppression.consume(path, hash) === true`. New unit test in `src/contracts/loader.test.ts` simulates a suppressed write and asserts the registry remains unchanged.

### Pitfall 4 — Plugin↔server stdio collision (07-RESEARCH §6, Pitfall 6)

**What we discovered.** If a user has Claude Desktop running with `vault-memory` already configured as an MCP server, and then opens Obsidian with the plugin, the plugin's `spawn("vault-memory", ["serve"])` results in two server processes touching the same SQLite DB. `better-sqlite3` serializes writes per process → the second process gets `database is locked`.

**Decision for v2.0.0 — strategy (a) per 07-RESEARCH.** Plugin always spawns its own `vault-memory serve` subprocess. INSTALL.md documents the constraint: "while using the Obsidian plugin, disable any other host's vault-memory MCP config (Claude Desktop, ChatGPT Custom Connector, etc.) — they fight over the same SQLite DB."

Strategy (c) — server respects an existing lock and exits gracefully with a clear error — is deferred to v2.1. Strategy (b) — discover an existing server over HTTP — requires a daemon-mode HTTP transport that is not yet built and remains in the deferred list.

### Pitfall 5 — `vitest` cannot resolve `import … from "obsidian"` (07-RESEARCH §3, Pitfall 5)

**What we discovered.** The `obsidian` npm package is a types-only shim; no `main` entry. Co-located plugin tests fail with `Failed to resolve entry for package 'obsidian'`.

**Decision.** Plugin's `vitest.config.ts` aliases the `obsidian` module to a stub at `plugin/tests/mocks/obsidian.ts` that exposes the minimum surface the codec / services / chrome code imports. Pure code (codec, canonicalize, zod-form mapper) tests with no Obsidian dependency; view code is manually smoke-tested via the screencast in v2.0.0 — Playwright is deferred to v2.1.

### Pitfall 6 — Canvas viewport state must not save on every pan/zoom (07-RESEARCH §6, Pitfall 7)

**What we discovered.** Naively coupling every Svelte Flow viewport event to `requestSave()` produces a dirty `.contract` file on every micro-gesture — `git status` shows churn after the user just scrolled.

**Decision.** Viewport-only changes propagate to in-memory state immediately for responsiveness, but commit to disk only after a 5s idle OR when a user-initiated mutation (drag a node, add an edge, edit an inspector field) triggers a save. Plan 07-02 (codec / save lifecycle) owns the debounce.

---

## Rationale (rejected alternatives)

| Decision | Rejected | Why |
|---|---|---|
| Variant C (palette + canvas + inspector) | Variant A (literal one-node-per-step DAG) | Inputs/sources/sinks/write_back on canvas grow the visual surface too much; typed forms in inspector eliminate `{{alias.field}}` errors structurally. |
| Variant C | Variant B (swimlanes by YAML section) | Useful as a discovery layout, but the editing surface still wants typed forms. Swimlanes are a navigation aid for static viewers, not an authoring affordance. |
| Variant C | Variant D (whiteboard with sigil-tagged free layout) | Free layout pushes the schema discipline back into the user. Defeats the entire reason for a visual editor. |
| `.contract` JSON format | Obsidian `.canvas` as authoring file | Obsidian Canvas has no concept of a typed contract step. Every workaround leaks back to the same gap. `.contract` is owned end-to-end by vault-memory. |
| Custom `.contract` extension | YAML wrapper with editor sidecar | Sidecars desync. Editor state in YAML comments survives the same sync substrate as the contract. |
| Svelte Flow as canvas renderer | Fork jsoncanvas viewer | Upstream renderer does not exist (see Pitfall 1). Building edit semantics on top of a viewer codebase = weeks of work for zero new capability vs. Svelte Flow off-the-shelf. |
| Svelte Flow | React Flow + React UI throughout the plugin | Svelte bundles ~14× smaller than React for this use case (~47 KB gz vs ~156 KB gz per RESEARCH §"Standard Stack"); same team maintains both; choice is framework, not feature. |
| Hand-rolled Svelte form generator from Zod 4 `.toJSONSchema()` | `@hookform/resolvers/zod` | React-only library. Hand-rolled Svelte form generator is ~150 LOC and matches Obsidian's existing Setting primitives. |
| `[plugin] enabled` default-OFF | Plugin tools always-on | Breaks v1 baseline snapshot (`evals/v1-baseline/tools-list.snapshot.json`) and Phase 8 REL-08 ≤32-tool budget. Default-OFF + opt-in via `vm-install` is the only posture that preserves both. |
| Per-device `safeStorage` ciphertext | Cross-device-portable secret format (e.g., passphrase-derived AES) | Secret portability across devices via syncing ciphertext is the wrong UX — synced ciphertext that decrypts on any device contradicts the OS-keyring security model. Re-entry on each device is correct (matches password managers). |
| `vm-install` skill as primary distribution | Obsidian community plugin store as primary distribution | Store review takes weeks. v2.0.0 ships when ready; store submission is a v2.0.1 / v2.1.0 follow-up. |

---

## Forward compatibility

- **`vmFormatVersion: 1`** is the only supported version in v2.0.0. Future formats extend `editor` additively (unknown editor keys round-trip unchanged); breaking format changes bump the version.
- **Palette baseline verbs** track Phase 6's `src/contracts/verbs/index.ts` enum verbatim. Adding a baseline verb in Phase 6 automatically surfaces in the palette on the next plugin rebuild.
- **Peer-MCP palette section** populates dynamically from Phase 6's `list_contract_verbs` Resource. Adding a `[contracts.mcp_clients.<name>]` entry to `~/.vault-memory/config.toml` surfaces the new server's verbs in the palette without a plugin rebuild.
- **Plugin-control tool surface** is additive-only. New plugin tools land behind the same `[plugin] enabled` gate; users opt in via `vm-install`. v1 baseline snapshot remains byte-stable.
- **Plugin auto-update via Obsidian community store** becomes available after store submission (D-DIST-SECONDARY); `vm-update` skill remains for skill-installed users.

---

## References

- **CONTEXT**: `.planning/phases/07-visual-contract-editor-canvas/07-CONTEXT.md` (D-UI, D-SURFACE, D-FORMAT, D-FORMAT-SCHEMA, D-FORMAT2, D-AUTH, D-CANON, D-CANON-TEST, D-PALETTE, D-WATCH-PLUGIN-OUT, D-WATCH-SERVER-NOTIFY, D-WATCH-NO-PLUGIN-WATCH, D-MCP-SURFACE, D-CHROME-PHILOSOPHY, D-DIST-PRIMARY, D-SKILL-NAMING, D-VERSION).
- **RESEARCH**: `.planning/phases/07-visual-contract-editor-canvas/07-RESEARCH.md` (§3 Pitfall 4 jsoncanvas rescope; §6 Pitfalls 1–2 suppression API + loader gap; §6 Pitfall 6 plugin↔server stdio; §"Package Legitimacy Audit").
- **UI-SPEC**: `.planning/phases/07-visual-contract-editor-canvas/07-UI-SPEC.md` (Variant C three-pane layout, full state inventory, accessibility contract).
- **PATTERNS**: `.planning/phases/07-visual-contract-editor-canvas/07-PATTERNS.md` (analog map; Pattern A adapter-seam, Pattern B default-OFF config gating, Pattern C Zod schema documentation, Pattern D MCP tool error wrapping).
- **ADR-001** — opaque DocId; `obsidian://<vault>/<vault-relative-path>` URI shape Phase 7 palette type catalog uses.
- **ADR-002** — adapter seams; the plugin's Obsidian-fs adapter (`app.vault.adapter`) is its own seam.
- **ADR-003** — `Document` shape and `properties: Record<string, unknown>` PropertyBag — `.contract` `properties` blocks reference these.
- **ADR-006** — Phase 6 task contract DSL — `ContractFileSchema` is the source of truth Phase 7 round-trips against; D-A1 `auto_register_tools` pattern is the analog for D-MCP-SURFACE.
- **`src/contracts/schema.ts`** — Phase 6 `ContractFileSchema` Zod, reused verbatim inside the Phase 7 `ContractDocumentSchema` wrapper.
- **`src/contracts/verbs/index.ts`** — 11 baseline verbs + literal; palette compile-time source.
- **`src/contracts/types-catalog.ts`** — palette type-catalog section source.
- **`src/adapters/change-feed/obsidian-fs/suppression.ts`** — CAN-08 reuse target (extended hash-keyed in Phase 7).
- **`evals/fixtures/v2-test-vault/_contracts/*.yaml`** — round-trip baseline for CAN-07 acceptance test.
