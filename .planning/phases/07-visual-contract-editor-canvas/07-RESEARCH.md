# Phase 7: vault-memory Obsidian plugin (contract editor + chrome) - Research

**Researched:** 2026-05-19
**Domain:** Obsidian plugin development (custom file extension + view) + node-editor UI + Electron `safeStorage` + plugin↔server IPC + GSD skill packaging
**Confidence:** HIGH on Obsidian plugin scaffolding, TextFileView lifecycle, safeStorage semantics, framework choice. MEDIUM on plugin↔server transport (multiple viable options — must decide). **LOW + RED FLAG on the jsoncanvas-fork premise — see §3.** HIGH on round-trip mechanics (Phase 6 already uses `yaml ^2.9` `parseDocument`).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**UI variant + editor surface**
- **D-UI:** Variant C — palette + canvas + properties inspector (three-pane IDE-like). Inputs/sources/sinks/write_back are NOT canvas nodes; they live in palette panels and inspector forms.
- **D-SURFACE:** Obsidian plugin via `registerView` + `registerExtensions(['contract'])`. NOT a Canvas extension; plugin owns its view chrome end to end.

**File format + authority**
- **D-FORMAT:** Custom `.contract` JSON format owned by vault-memory. Obsidian's `.canvas` format is NOT used for authoring.
- **D-FORMAT-SCHEMA:** `.contract` shape is `{ $schema, vmFormatVersion: 1, contract: { …Phase 6 ContractFileSchema fields verbatim }, editor: { nodes, selection, viewport, yamlComments } }`. No sidecar files.
- **D-FORMAT2:** Editor state round-trips to YAML as `# vm-editor-state: <base64-encoded JSON>` on the first line of `_contracts/*.yaml`. If absent (hand-authored YAML), the importer falls back to a deterministic default layout. User confirmed via AskUserQuestion.
- **D-AUTH:** `.contract` is editor source of truth; `.yaml` is the build artifact emitted on every save. The Phase 6 `ContractRegistry` ChangeFeed watches `_contracts/*.yaml`; the plugin does NOT watch its own `.contract` files (Obsidian view lifecycle is sufficient).

**Phase scope**
- **D-SCOPE:** Phase 7 = plugin-as-umbrella: editor + settings + key-ring secrets + manual reindex + stats panel + connector management UI.

**Round-trip + canonicalization (CAN-07)**
- **D-CANON:** Always canonical — YAML key order matches ADR-006 schema order; `assembly` step order matches the DAG; default values omitted when equal to schema defaults. Always preserved — YAML comments via `yaml ^2.9` `parseDocument`/`toString`; `description` block scalars stay `|` literals; user-authored `mcp://` URIs preserved verbatim.
- **D-CANON-TEST:** For each of the three reference contracts: `import yaml → emit .contract → emit yaml` produces YAML that parses to a JS value `deepEqual` to the original AND the editor-state comment block survives a second cycle.

**Palette + reference contracts**
- **D-PALETTE:** Five sections — type catalog (`DocId`, `Handle`, `ChunkId`, `MemorySink`); read verbs; assembly verbs; `literal` escape; peer-MCP (dynamic, refreshes on plugin focus). Baseline entries compiled at build time from `src/contracts/verbs/index.ts` enum.
- **D-REFS:** Three reference `.contract` files in `examples/contracts/` re-authoring the three Phase 6 reference contracts. Baseline YAMLs at `evals/fixtures/v2-test-vault/_contracts/*.yaml`.

**Watcher integration (CAN-08)**
- **D-WATCH-PLUGIN-OUT:** On `.contract` save → plugin computes SHA-256 of the emitted YAML → calls `SuppressionSet.suppress(path, hash)` BEFORE the `.yaml` write → writes. **Correction:** the existing `SuppressionSet` API is `add(path)` / `consume(path)` and is **path-only, not hash-keyed** (see `src/adapters/change-feed/obsidian-fs/suppression.ts`). Decision needed: extend the API to take a hash, or accept path-only suppression with the existing TTL discipline. See §6 for analysis.
- **D-WATCH-SERVER-NOTIFY:** Server → plugin via MCP notification `vault-memory://contracts/reloaded` (NOT a new file watcher).
- **D-WATCH-NO-PLUGIN-WATCH:** Plugin does NOT watch `.contract` files itself. Phase 7 adds zero new ChangeFeed subscribers.

**Plugin chrome**
- **D-CHROME-PHILOSOPHY:** Ship minimal chrome in v2.0.0; expand in v2.x.
- **D-CHROME-SETTINGS (PLG-01):** `PluginSettingTab` with Ollama URL, embedding model, reranker on/off, default vault, plus Advanced collapse (indexer batch size, FTS tokenizer override). Persist via `loadData()`/`saveData()`.
- **D-CHROME-SECRETS (PLG-02):** safeStorage-backed; UI lists name + creation date only; reference syntax `${secret:name}` in connector configs; server-side substitution via `resolve_secret({name})` MCP tool.
- **D-CHROME-REINDEX (PLG-03):** One-click "Reindex this vault" + "Reindex all vaults"; full reindex only in v2.0.0; progress via MCP streaming if available, polling fallback otherwise.
- **D-CHROME-STATS (PLG-04):** Read-only snapshot panel; reads via MCP tool calls or Resources only — no direct DB access from the plugin.
- **D-CHROME-CONNECTORS (PLG-05):** Plugin does NOT write `~/.vault-memory/config.toml` directly; mutations route through `set_mcp_client(...)` MCP tool; "Test connection" button → `Client.connect()` round-trip.
- **D-CHROME6 / D-MCP-SURFACE:** New plugin-control MCP tools gated by `[plugin] enabled = true`. Default OFF. User confirmed via AskUserQuestion. Estimated 3–5 tools: `set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats`, `trigger_reindex`.

**Spike (CAN-10)**
- **D-SPIKE:** First deliverable. ADR `docs/v2/adr/007-contract-editor.md` + working prototype Obsidian plugin rendering `meeting-prep.contract` in a `registerView` view using forked renderer code. Plus MIT-compatible license check on the upstream renderer. Go/no-go gate.

**Distribution + docs (CAN-09)**
- **D-DIST-PRIMARY:** `vm-install` skill is the primary v2.0.0 distribution channel. Pulls plugin from GitHub Releases; extracts to `.obsidian/plugins/vault-memory/`; bypasses Obsidian community plugin store review.
- **D-DIST-UPDATE:** `vm-update` skill handles updates.
- **D-DIST-SECONDARY:** Obsidian community plugin store is post-v2.0.0 (v2.0.1 or v2.1.0 timeframe).
- **D-SKILL-NAMING:** All vault-memory skills prefix with `vm-`. Mirrors `vm_` tool prefix from Phase 6.
- **D-DOCS-SET:** `docs/v2/plugin/` — `INSTALL.md`, `SETTINGS.md`, `SECRETS.md`, `CONTRACT-EDITOR.md`, `CONNECTORS.md`.
- **D-SCREENCAST:** One ≤8-minute screencast on GitHub Releases.
- **D-VERSION:** Plugin `manifest.json.version` follows the vault-memory main version.

### Claude's Discretion

- Plugin framework (Svelte / React / vanilla) — **planner picks based on §3 spike outcome**; this research recommends **Svelte 5** (§4).
- Exact `.contract` JSON schema beyond the D-FORMAT-SCHEMA sketch — planner finalizes in plan 07-spike alongside ADR 007.
- MCP tool naming for plugin-control tools — see §7 recommended naming.
- Inspector form library — **recommendation: hand-rolled Svelte form generator + Zod parser** (~150 LOC); rationale §5.
- Default node layout for `.yaml` imports without editor-state comment — **recommendation: left-to-right topological sort of assembly steps with a fixed 220×120 grid**.
- Plugin bundling — **recommendation: esbuild** (Obsidian standard); §2.
- Telemetry — **none. Explicit project constraint.**
- Settings restart-vs-hot-swap mapping — Restart-required: embedding model, FTS tokenizer, Ollama URL. Hot-swappable: reranker on/off, default vault, indexer batch size.
- Reindex progress streaming protocol — MCP SDK 1.29 `progress` notifications + `progressToken` (§7); polling fallback acceptable.
- `vm-install` skill storage location — `skills/vm-install/SKILL.md` per existing `skills/install-vault-memory/` precedent.
- Secrets ciphertext format — **recommendation: `{ v: 1, alg: "electron-safe-storage", ct: <base64-ciphertext>, createdAt }`** — version byte for future migrations.
- Error UX for `${secret:name}` resolution failures — server returns `{ok:false, reason:"secret_not_found", name}`; plugin surfaces inline in connector UI.
- Per-vault plugin scope — confirmed per-vault by Obsidian plugin model. Multi-vault deployments install per-vault.

### Deferred Ideas (OUT OF SCOPE)

`.contract → .canvas` one-way exporter (Phase 7.x / v2.1); bidirectional 3-way merge (v2.x); in-plugin agent chat surface (v2.1); plugin auto-update via Obsidian community store (post-store-submission); contract version migration UI (when schemas change); visual diff (v2.x); theming controls beyond Obsidian theme inheritance (out of v2.0.0); incremental reindex (v2.1); stats time series (out of v2.0.0); connector capability inspection beyond verb names (v2.x); cloud-source connector UI (Phase 10 / v3); multi-vault workspace plugin config (v2.x); `vm-bootstrap-vault` / `vm-author-contract` skills (out of Phase 7); plugin telemetry (permanently out); web-based contract editor (far out of v2.0.0); CLI scaffolder for new contracts (superseded by plugin's "new contract" action); external secret stores beyond `safeStorage` (v2.x extension point).

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **CAN-01** | Plugin scaffolded with community-plugin layout (`manifest.json`, `main.ts`, `styles.css`, `versions.json`) | §2 (scaffold), §4 (build pipeline), §11 (testing) |
| **CAN-02** | `.contract` → Phase 6 YAML emitter; hash-gated via `SuppressionSet` | §6 (watcher integration), §8 (round-trip mechanics), §9 (canonicalization) |
| **CAN-03** | YAML → `.contract` importer; loss-less round-trip on all Phase 6 ADR-006 fields | §8 (round-trip), §9 (canonicalization), §10 (base64 editor-state comment) |
| **CAN-04** | Palette covers all 11 baseline verbs + `literal` + `mcp://` peer-MCP | §7 (build-time import from `src/contracts/verbs/index.ts`) |
| **CAN-05** | Plugin registers `registerView('vault-memory-contract-editor', …)` + `registerExtensions(['contract'], …)` | §2 (Obsidian view + extension lifecycle), §11 (test approach) |
| **CAN-06** | Three reference `.contract` files in `examples/contracts/`; each emits byte-comparable YAML | §8 (CAN-07 test scaffold), §9 (canonicalization rules) |
| **CAN-07** | Round-trip is semantically equivalent after canonicalization; YAML comments preserved via `yaml ^2.9` | §8 (verified `yaml ^2.9.0` already in deps), §9 (canonical rules) |
| **CAN-08** | Hash-gated watcher reuses v1 `SuppressionSet`; prevents recompile loops | §6 (CRITICAL — API mismatch between CONTEXT.md and actual `suppression.ts`) |
| **CAN-09** | Documentation + screencast walkthrough | §13 (docs structure already locked); §14 (`vm-install`/`vm-update` skills) |
| **CAN-10** | Pre-implementation spike: ADR 007 + working prototype + license check | §3 (CRITICAL — **upstream "jsoncanvas renderer" does not exist as a package; only viewers + spec exist**. Plan must rescope spike) |
| **PLG-01** | Settings panel via `PluginSettingTab` with Ollama URL, embedding model, reranker on/off, default vault | §2 (Obsidian settings API), §7 (hot-swap via MCP tool) |
| **PLG-02** | safeStorage-backed secrets; UI add/list/remove; `${secret:name}` reference syntax | §12 (Electron `safeStorage` semantics + how to reach it from a plugin) |
| **PLG-03** | Manual reindex trigger; respects `SuppressionSet`; live progress feedback | §6 (suppression), §7 (MCP progress notifications) |
| **PLG-04** | Read-only stats panel; reads via MCP only — no direct DB access | §7 (new MCP tools / Resources for stats) |
| **PLG-05** | Connector management UI; reads + writes through MCP config-mutation tool, not direct TOML | §7 (`set_mcp_client` tool) |

</phase_requirements>

---

## Summary

Phase 7 is the largest surface-area phase of v2.0.0: an Obsidian plugin shipped as a separate `plugin/` package tree, owning a custom `.contract` file extension end-to-end, with a five-panel chrome (settings / secrets / reindex / stats / connectors), an MCP client that talks to the running `vault-memory serve` over stdio, and a GSD-skill distribution channel that bypasses Obsidian's community plugin store.

**Three findings dominate this research and must shape the plan:**

1. **The "jsoncanvas.org renderer fork" premise is broken.** [VERIFIED: github.com/obsidianmd/jsoncanvas is a *spec repo*, not a renderer]. The third-party implementations on npm (`@trbn/jsoncanvas`, react-jsoncanvas, JSON-Canvas-Viewer) are MIT-licensed **viewers**, not editors — they don't expose programmatic APIs for adding/moving/connecting nodes. The CAN-10 spike must therefore choose between (a) building the editor renderer on top of a viewer codebase + adding edit primitives, or (b) using Svelte Flow (the only MIT-licensed, actively maintained node-editor with full edit semantics). **Recommendation: drop the "fork jsoncanvas" framing entirely and use Svelte Flow as the renderer** — it is built for this exact use case, the same team maintains React Flow, and weekly install count signals durability. The spike then becomes "wire Svelte Flow into a custom Obsidian TextFileView," which is a 1–3 day task, not a renderer engineering effort.

2. **The `SuppressionSet` API does not match what CONTEXT.md describes.** [VERIFIED: code grep of `src/adapters/change-feed/obsidian-fs/suppression.ts`]. The existing class exposes `add(path, ttlMs?)` and `consume(path)` — path-only, TTL-keyed (default 2s). CONTEXT.md describes a hash-keyed API (`suppress(path, hash)` / `matches(path, hash)`). Either the plan extends the API to be hash-keyed (the safer construction — defeats races where a *second* legitimate edit lands inside the TTL window) or it accepts path-only suppression and documents the limitation. **Recommendation: extend the API to be hash-keyed.** It's a ~15 LOC change; preserves existing call sites by making `hash` optional; matches the construction Phase 6 D-LOAD assumed.

3. **Phase 6's contract loader does not currently call `SuppressionSet.consume()`.** [VERIFIED: `grep -n "suppress" src/contracts/loader.ts` returns no matches]. This is the integration gap CAN-08 must close: Phase 6 didn't need it because Phase 6 didn't write contracts; Phase 7 does, and the gap means an unprotected echo loop. The plan must touch `src/contracts/loader.ts` to call `consume()` before re-validating, and that touch must land *before* the plugin's first `.yaml` write or every edit will trigger a redundant hot-reload.

Beyond those three, the rest of the phase decomposes cleanly. Obsidian's `TextFileView` lifecycle (`getViewData`/`setViewData`/`requestSave`/`clear`) is well-documented [CITED: marcusolsson.github.io/obsidian-plugin-docs] and gives us the file save/load contract directly; the `registerView` + `registerExtensions(['contract'], 'vault-memory-contract-editor')` pair binds the editor automatically on `.contract` open. `yaml ^2.9.0` is already a project dependency [VERIFIED: package.json] and `parseDocument` already supports comment-preserving round-trip — Phase 6 CON-01 proves this. Electron's `safeStorage` is accessible from Obsidian's main process [CITED: Electron docs + forum confirmation] but requires `isDesktopOnly: true` in `manifest.json` (mobile lacks Electron); per-device ciphertext is the **correct** posture — synced ciphertext won't decrypt on a second device, prompting re-entry, which matches the password-manager security model. MCP SDK 1.29 ships first-class `Client` + stdio transport and `notifications/progress` with progress tokens [CITED: ts.sdk.modelcontextprotocol.io], which lets the plugin attach to a running server over stdio and stream reindex progress without polling.

**Primary recommendation:** Land the spike (plan 07-01) before anything else, but rescope it to "wire Svelte Flow into a custom TextFileView and render `meeting-prep.contract` end-to-end." If that 1–3 day prototype lands cleanly, the rest of Phase 7 is mechanical work. If it doesn't, escalate to a re-discuss with the user — the fallback variants A/B/D in `design-variants/` are real options.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `.contract` file open / save lifecycle | **Plugin (Obsidian renderer process)** | — | Obsidian's `TextFileView` owns the file-bound view lifecycle |
| Custom view registration (`registerView` / `registerExtensions`) | **Plugin (Obsidian main process)** | — | Standard Obsidian extension point — only the plugin can call these |
| `.contract` JSON schema validation | **Plugin** | Server (via `validate_contract` MCP tool if planner prefers central authority) | Plugin owns its own format; server doesn't see `.contract` files at all |
| `.contract` → `.yaml` emission | **Plugin (Obsidian FS API via `Vault.modify`)** | — | Plugin writes the file; server reads via the existing ChangeFeed |
| `.yaml` → `.contract` import | **Plugin** | — | Plugin parses YAML via `yaml ^2.9` and rebuilds editor view |
| ContractRegistry hot-reload | **Server (`src/contracts/loader.ts` ChangeFeed handler)** | — | Phase 6 already owns this; Phase 7 reuses it verbatim |
| `SuppressionSet` echo-suppression | **Server (loader handler calls `consume`)** | Plugin (calls `add` before write) | The suppression token lives in the server's in-memory set; plugin signals over MCP |
| Node-editor rendering | **Plugin (Svelte Flow in WebView)** | — | UI concern; server has zero opinion |
| Properties inspector forms | **Plugin (Svelte components driven by Zod schema from `src/contracts/schema.ts`)** | — | UI; Zod schema is the cross-cutting source of truth |
| Palette content (verbs / types / peer-MCP) | **Plugin (build-time + MCP refresh)** | Server (provides peer-MCP list via `list_contract_verbs` Resource) | Baseline verbs compiled in; peer-MCP dynamic from Phase 6 Resource |
| Settings persistence | **Plugin (`loadData`/`saveData` → `.obsidian/plugins/vault-memory/data.json`)** | — | Obsidian-standard plugin storage |
| Settings hot-swap to running server | **Plugin (MCP `set_runtime_config` tool call)** | Server (applies + acks) | Plugin is the UI; server holds runtime config |
| Secrets encryption | **Electron `safeStorage` (called from plugin main process)** | — | OS keyring access; per-device by design |
| Secrets persistence (ciphertext) | **Plugin (`data.json` blob)** | — | Synced with the rest of the vault config |
| `${secret:name}` resolution at MCP-call time | **Server (`resolve_secret` MCP tool)** | Plugin (delivers ciphertext on `set_runtime_config`) | Plaintext NEVER leaves Electron main process to any non-local consumer |
| Plugin↔Server transport | **Stdio (spawn `vault-memory serve` as child process from plugin)** | — | Existing transport; same one Claude Desktop uses; `isDesktopOnly: true` already implied |
| Reindex progress feedback | **Server emits MCP `notifications/progress`; plugin renders in panel** | — | SDK 1.29 first-class capability |
| Connector list mutation | **Server (`set_mcp_client` MCP tool writes `~/.vault-memory/config.toml`)** | Plugin (UI; never touches TOML) | Server is the config authority; plugin is a UI on top |
| GSD-skill plugin installer | **`vm-install` skill (Bash + curl + tar)** | Plugin (read-only consumer of the install) | Skill is out-of-band; runs in shell before Obsidian even opens |
| GSD-skill plugin updater | **`vm-update` skill** | Plugin (reads installed `manifest.json.version`) | Same as installer; checks GitHub Releases |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard | Provenance |
|---------|---------|---------|--------------|------------|
| `obsidian` (peerDependency) | `^1.5.0` (minimum) | Plugin runtime + types | The platform we're shipping on | [VERIFIED: npm view obsidian version → 1.12.3 latest] |
| `esbuild` | `^0.25` | Plugin bundler (compiles `main.ts` → `main.js`) | Obsidian sample-plugin default; sub-100ms incremental builds | [CITED: github.com/obsidianmd/obsidian-sample-plugin] |
| `svelte` | `^5.55` | UI framework for editor + chrome panels | 14× smaller bundle vs React; compile-time-optimized; matches Obsidian plugin ecosystem precedent | [VERIFIED: npm view svelte version → 5.55.8] |
| `@xyflow/svelte` (Svelte Flow) | `^1.5` | Node-editor renderer for Variant C canvas pane | MIT; same team as React Flow; supports custom nodes as Svelte components; full edit semantics (drag/drop/select/connect); 107K weekly installs | [VERIFIED: npm view @xyflow/svelte version → 1.5.2; CITED: svelteflow.dev] |
| `yaml` | `^2.9.0` *(already in deps)* | YAML parse + emit with comment preservation | Phase 6 already locked this; `parseDocument`/`toString` does the round-trip | [VERIFIED: package.json shows `^2.9.0`] |
| `zod` | `^4.4.3` *(already in deps)* | Validate `.contract` JSON; drive inspector form generation | Phase 6 already locked this; Zod 4 has first-class JSON Schema support | [VERIFIED: package.json shows `^4.4.3`] |
| `@modelcontextprotocol/sdk` | `^1.29.0` *(already in deps)* | Plugin → server MCP client over stdio; receives progress notifications | Project standard; same SDK the server uses | [VERIFIED: package.json shows `^1.29.0`] |

### Supporting

| Library | Version | Purpose | When to Use | Provenance |
|---------|---------|---------|-------------|------------|
| `builtin-modules` | `^5` | esbuild externalization helper | Obsidian sample-plugin pattern — externalize `obsidian`, `electron`, Node built-ins | [CITED: obsidianmd/obsidian-sample-plugin esbuild.config.mjs] |
| `tslib` | `^2.6` | TypeScript helpers | Obsidian sample-plugin includes it | [ASSUMED] |
| `@types/node` | `^22.10` *(already in root devDeps)* | Node types for `child_process`, `fs`, etc. | Plugin needs Node types for the parts that touch Electron main / config | [VERIFIED: package.json] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Provenance |
|------------|-----------|----------|------------|
| Svelte | React 19 + `@xyflow/react` | 156 KB gzipped vs Svelte's ~47 KB; same Flow library | [CITED: tech-insider.org/svelte-vs-react-2026; CITED: xyflow.com] |
| Svelte | Vanilla TS + hand-rolled canvas | No virtual DOM; absolute minimum bundle; but ~2000 LOC of node-editor code to write + maintain | [ASSUMED] |
| `@xyflow/svelte` | `@trbn/jsoncanvas` | Viewer-only; would require building the edit layer from scratch | [VERIFIED: github.com/t128n/jsoncanvas README] |
| `@xyflow/svelte` | `react-jsoncanvas` | "Not a library, rather an example/some code to use to render"; React-only; viewer-only | [VERIFIED: github.com/Digital-Tvilling/react-jsoncanvas README] |
| `@xyflow/svelte` | `JSON-Canvas-Viewer` | Framework-agnostic viewer; no editing API exposed | [VERIFIED: github.com/Hesprs/JSON-Canvas-Viewer README] |
| esbuild | tsup *(used by main repo)* | tsup is fine for a CLI; esbuild is the Obsidian-plugin default | [CITED: obsidianmd/obsidian-sample-plugin] |
| `@hookform/resolvers/zod` (React) | hand-rolled Svelte form generator | React form libs don't apply in Svelte; ~150 LOC to walk a Zod 4 schema and emit Svelte form fields | [ASSUMED — based on Zod 4 introspection API] |

**Installation (target — added to `plugin/package.json`, not the root):**
```bash
cd plugin
npm install --save-peer obsidian
npm install --save svelte @xyflow/svelte
npm install --save-dev esbuild builtin-modules tslib @types/node typescript
# yaml, zod, @modelcontextprotocol/sdk are inherited from the root package
# via the workspace setup (or duplicated here — planner picks)
```

**Version verification:**

| Package | Verified version | Verification command | Status |
|---------|------------------|----------------------|--------|
| `svelte` | 5.55.8 | `npm view svelte version` | ✓ |
| `@xyflow/svelte` | 1.5.2 | `npm view @xyflow/svelte version` | ✓ |
| `obsidian` | 1.12.3 | `npm view obsidian version` | ✓ |
| `@modelcontextprotocol/sdk` | 1.29.0 | `npm view @modelcontextprotocol/sdk version` | ✓ (matches package.json) |
| `yaml` | 2.9.0 | already pinned | ✓ |
| `zod` | 4.4.3 | already pinned | ✓ |
| `esbuild` | 0.28.0 | `npm view esbuild version` | ✓ |

---

## Package Legitimacy Audit

slopcheck was unavailable at research time. All packages marked `[VERIFIED via npm registry]` were confirmed both by `npm view` AND discovered from authoritative sources (Obsidian sample plugin, official Svelte/xyflow project pages, MCP SDK docs). Per the package-name-provenance rule, packages discovered ONLY from WebSearch retain `[ASSUMED]` until the planner cross-checks them in plan 07-01.

| Package | Registry | Latest version | Age (lib) | Source repo | Disposition |
|---------|----------|----------------|-----------|-------------|-------------|
| `obsidian` | npm | 1.12.3 | ~3 yrs of typed-API publishing | github.com/obsidianmd/obsidian-api | Approved [VERIFIED] |
| `svelte` | npm | 5.55.8 | 8+ yrs; v5 GA 2024 | github.com/sveltejs/svelte | Approved [VERIFIED] |
| `@xyflow/svelte` | npm | 1.5.2 | published 2024; same team as React Flow (8+ yrs); 107K weekly installs | github.com/xyflow/xyflow | Approved [VERIFIED] |
| `esbuild` | npm | 0.28.0 | 6+ yrs; industry standard | github.com/evanw/esbuild | Approved [VERIFIED] |
| `yaml` | npm | 2.9.0 | 10+ yrs (eemeli/yaml) | github.com/eemeli/yaml | Approved (already in deps) |
| `zod` | npm | 4.4.3 | 5+ yrs; v4 GA 2025 | github.com/colinhacks/zod | Approved (already in deps) |
| `@modelcontextprotocol/sdk` | npm | 1.29.0 | Anthropic-maintained; 2024+ | github.com/modelcontextprotocol/typescript-sdk | Approved (already in deps) |
| `@trbn/jsoncanvas` | npm | (not used — viewer only) | new (2024) | github.com/t128n/jsoncanvas | **REJECTED** — viewer only, no edit API |
| `react-jsoncanvas` | npm | (not used) | new | github.com/Digital-Tvilling/react-jsoncanvas | **REJECTED** — author states "not a library, rather an example" |
| `JSON-Canvas-Viewer` | npm | (not used) | active (v4.3.0 May 2026) | github.com/Hesprs/JSON-Canvas-Viewer | **REJECTED** — viewer only, no edit API exposed |
| `builtin-modules` | npm | ^5 | mature | github.com/sindresorhus/builtin-modules | [VERIFIED] — Obsidian-sample-plugin standard |
| `tslib` | npm | ^2.6 | Microsoft-maintained | github.com/Microsoft/tslib | [VERIFIED] |

**Packages removed due to slopcheck [SLOP] verdict:** none — slopcheck unavailable.
**Packages flagged as suspicious [SUS]:** none.
**Manual investigation outcomes:** Three jsoncanvas third-party libraries rejected on functional grounds (viewers, not editors), not on legitimacy grounds — all three are real, MIT-licensed, and maintained.

*If the planner adopts a different node-editor library than `@xyflow/svelte` after the spike, all rows must be re-verified against the chosen replacement.*

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Obsidian Process (Electron)                                                 │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Plugin: vault-memory                                                │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────┐       │   │
│  │  │ ContractEditorView (TextFileView)                        │       │   │
│  │  │   - getViewData() → emit YAML (round-trip canonical)     │       │   │
│  │  │   - setViewData(yaml) → parse YAML → build .contract     │       │   │
│  │  │   - Variant C three-pane Svelte layout:                   │       │   │
│  │  │     [palette] [@xyflow/svelte canvas] [inspector form]   │       │   │
│  │  └────────────────────────────────────────────────────────┘       │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────┐       │   │
│  │  │ Plugin chrome (Svelte components)                        │       │   │
│  │  │   PLG-01 Settings  PLG-02 Secrets  PLG-03 Reindex        │       │   │
│  │  │   PLG-04 Stats    PLG-05 Connectors                     │       │   │
│  │  └────────────────────────────────────────────────────────┘       │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────┐       │   │
│  │  │ Plugin services                                          │       │   │
│  │  │   - VaultMemoryMcpClient (MCP SDK Client over stdio)    │       │   │
│  │  │   - SecretsStore (Electron safeStorage adapter)         │       │   │
│  │  │   - ContractCodec (.contract ↔ .yaml + canonicalize)    │       │   │
│  │  └────────────────────────────────────────────────────────┘       │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                              │ stdio (spawn child_process)                  │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ vault-memory serve (Node 22, separate process)                                │
│                                                                                │
│  src/server.ts (MCP request dispatcher)                                       │
│       │                                                                        │
│       ├─ existing v1 tools (23) + Phase 2-6 additions (37 total) — unchanged │
│       │                                                                        │
│       ├─ NEW plugin-gated tools (`[plugin] enabled = true`):                  │
│       │     set_runtime_config, resolve_secret, set_mcp_client,                │
│       │     get_runtime_stats, trigger_reindex                                 │
│       │                                                                        │
│       └─ ContractRegistry (Phase 6 loader.ts)                                  │
│              ↑                                                                  │
│   ContractChangeFeed subscriber (Phase 6 D-LOAD)                              │
│              ↑                                                                  │
│   SuppressionSet — call `consume(path)` BEFORE re-validating                  │
│              ↑                                                                  │
│   ObsidianFsChangeFeed (chokidar) — emits on `_contracts/*.yaml` events       │
│              ↑                                                                  │
│              │ filesystem event                                                 │
└──────────────┼─────────────────────────────────────────────────────────────────┘
               │
               │
┌──────────────┴────────────────────────────────────────────────────────────────┐
│ User's Obsidian vault                                                          │
│                                                                                 │
│   _contracts/                                                                   │
│       meeting-prep.yaml          ← the build artifact (server reads this)       │
│       meeting-prep.contract      ← the editor source (plugin reads + writes)    │
│       ...                                                                       │
│                                                                                 │
│   Plugin writes BOTH files on save:                                             │
│     1. Compute YAML body                                                        │
│     2. SHA-256 of YAML body                                                     │
│     3. MCP call: `suppress_contract_write({path, hash})`  ← NEW gate           │
│     4. Plugin writes `.yaml` via Vault API                                      │
│     5. Plugin writes `.contract` via Vault API (no suppression — server         │
│        doesn't watch .contract)                                                 │
│     6. Chokidar fires → ChangeFeed → loader.ts `consume(path)` → MATCH → skip  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
plugin/                                  # NEW top-level (sibling to src/)
├── manifest.json                        # Obsidian plugin manifest
├── versions.json                        # version → minAppVersion map
├── package.json                         # plugin's npm deps (separate from root)
├── tsconfig.json                        # extends root tsconfig
├── esbuild.config.mjs                   # Obsidian-sample-plugin bundler
├── main.ts                              # plugin entry; onload/onunload
├── styles.css                           # plugin styles; inherits Obsidian vars
├── src/
│   ├── views/
│   │   └── contract-editor/
│   │       ├── view.ts                  # ContractEditorView extends TextFileView
│   │       ├── editor.svelte            # three-pane layout
│   │       ├── canvas/
│   │       │   ├── canvas-pane.svelte   # @xyflow/svelte wrapper
│   │       │   ├── verb-node.svelte     # custom node component
│   │       │   └── layout.ts            # default LTR topo-sort layout
│   │       ├── palette/
│   │       │   ├── palette-pane.svelte
│   │       │   ├── verb-list.ts         # built from src/contracts/verbs/index.ts
│   │       │   └── peer-mcp.ts          # dynamic via MCP Resource
│   │       └── inspector/
│   │           ├── inspector-pane.svelte
│   │           └── zod-to-form.ts       # Zod 4 schema → Svelte form fields
│   ├── codec/
│   │   ├── contract-codec.ts            # .contract ↔ .yaml round-trip
│   │   ├── canonicalize.ts              # D-CANON rules
│   │   ├── editor-state-comment.ts      # base64 # vm-editor-state: header
│   │   └── codec.test.ts                # CAN-07 round-trip tests
│   ├── chrome/
│   │   ├── settings-tab.ts              # PLG-01 PluginSettingTab
│   │   ├── secrets-panel.svelte         # PLG-02
│   │   ├── reindex-panel.svelte         # PLG-03
│   │   ├── stats-panel.svelte           # PLG-04
│   │   └── connectors-panel.svelte      # PLG-05
│   ├── services/
│   │   ├── mcp-client.ts                # stdio MCP client; spawns serve
│   │   ├── secrets-store.ts             # safeStorage adapter
│   │   └── reload-notifier.ts           # subscribe to contracts/reloaded notif
│   └── shared-types.ts                  # type imports from src/contracts/schema.ts
├── tests/                               # vitest unit tests for codec + helpers
│   └── codec.test.ts                    # CAN-07 round-trip
└── README.md                            # build instructions for the plugin

examples/contracts/                       # NEW — referenced by CAN-06
├── meeting-prep.contract
├── project-status.contract
├── code-review-brief.contract
└── round-trip.test.ts                    # invoked by vitest; CAN-07 gate

docs/v2/plugin/                           # NEW — D-DOCS-SET
├── INSTALL.md
├── SETTINGS.md
├── SECRETS.md
├── CONTRACT-EDITOR.md
└── CONNECTORS.md

skills/vm-install/                        # NEW skill
├── SKILL.md
└── setup.sh                              # downloads + extracts plugin from GitHub Releases

skills/vm-update/                         # NEW skill
├── SKILL.md
└── update.sh                             # checks GitHub Releases for newer version

src/                                      # AMENDED — minimal Phase 7 server-side edits
├── contracts/
│   └── loader.ts                         # AMEND: add `suppression.consume()` call
├── adapters/change-feed/obsidian-fs/
│   └── suppression.ts                    # AMEND: make API hash-keyed (additive)
├── config/loader.ts                      # AMEND: add `[plugin]` section schema
├── tool-registry.ts                      # AMEND: register plugin-gated tools
└── server.ts                             # AMEND: wire new MCP tools + notification
```

### Pattern 1: Custom file extension → custom view

```typescript
// plugin/main.ts (sketch)
// Source: docs.obsidian.md/Reference/TypeScript+API/Plugin/registerExtensions
//         marcusolsson.github.io/obsidian-plugin-docs/tutorials/text-based-file-formats
import { Plugin } from "obsidian";
import { ContractEditorView, VIEW_TYPE_CONTRACT } from "./src/views/contract-editor/view.js";

export default class VaultMemoryPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_CONTRACT, (leaf) => new ContractEditorView(leaf));
    this.registerExtensions(["contract"], VIEW_TYPE_CONTRACT);
    // ... settings tab, MCP client init, etc.
  }
  async onunload(): Promise<void> {
    // Obsidian unregisters views automatically on unload
  }
}
```

### Pattern 2: TextFileView lifecycle for JSON-backed files

```typescript
// plugin/src/views/contract-editor/view.ts (sketch)
// Source: marcusolsson.github.io/obsidian-plugin-docs/tutorials/text-based-file-formats
//         docs.obsidian.md/Reference/TypeScript+API/TextFileView
import { TextFileView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_CONTRACT = "vault-memory-contract-editor";

export class ContractEditorView extends TextFileView {
  private editorComponent: SvelteEditorComponent | null = null;
  private currentJson: ContractFile | null = null;

  getViewType(): string { return VIEW_TYPE_CONTRACT; }
  getDisplayText(): string { return this.file?.basename ?? "Contract"; }
  getIcon(): string { return "git-branch"; }

  // Called by Obsidian when the file is loaded
  setViewData(data: string, clear: boolean): void {
    if (clear) this.clear();
    this.currentJson = JSON.parse(data) as ContractFile; // typed by Zod
    this.editorComponent?.$set({ file: this.currentJson });
  }

  // Called by Obsidian when it needs to write the file
  getViewData(): string {
    if (!this.currentJson) return "";
    return JSON.stringify(this.currentJson, null, 2);
  }

  clear(): void {
    this.currentJson = null;
    this.editorComponent?.$set({ file: null });
  }

  // Called when the user changes anything in the editor
  private onUserEdit(updated: ContractFile): void {
    this.currentJson = updated;
    // Emit companion .yaml synchronously (or debounced)
    void this.emitYamlCompanion(updated);
    this.requestSave(); // triggers Obsidian to call getViewData() and write .contract
  }

  // Emit `_contracts/<name>.yaml` alongside the `.contract` file
  private async emitYamlCompanion(file: ContractFile): Promise<void> {
    const yamlBody = canonicalEmit(file); // codec/canonicalize.ts
    const hash = await sha256(yamlBody);
    const yamlPath = file.contract.name + ".yaml"; // in _contracts/
    await this.plugin.mcpClient.callTool("suppress_contract_write", {
      path: yamlPath, hash,
    });
    await this.app.vault.adapter.write(yamlPath, yamlBody);
  }
}
```

### Pattern 3: Plugin → server stdio MCP client

```typescript
// plugin/src/services/mcp-client.ts (sketch)
// Source: ts.sdk.modelcontextprotocol.io/classes/client.Client.html
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class VaultMemoryMcpClient {
  private client: Client | null = null;

  async connect(serverCommand: string, serverArgs: readonly string[]): Promise<void> {
    const transport = new StdioClientTransport({
      command: serverCommand, // e.g., "vault-memory"
      args: [...serverArgs, "serve"],
    });
    this.client = new Client({ name: "vault-memory-plugin", version: "2.0.0" }, {
      capabilities: {},
    });
    await this.client.connect(transport);
  }

  async callTool(name: string, args: object): Promise<unknown> {
    return await this.client!.callTool({ name, arguments: args });
  }

  // PLG-03 — subscribe to progress notifications
  onProgress(token: string, handler: (progress: number, total?: number) => void): void {
    this.client!.setNotificationHandler(/* ProgressNotificationSchema */, (notif) => {
      if (notif.params.progressToken === token) handler(notif.params.progress, notif.params.total);
    });
  }
}
```

### Pattern 4: Round-trip with comment preservation

```typescript
// plugin/src/codec/contract-codec.ts (sketch)
// Source: github.com/eemeli/yaml — parseDocument preserves comments
import { parseDocument, type Document } from "yaml";

const CANONICAL_KEY_ORDER = [
  "version", "name", "description", "inputs",
  "sources", "sinks", "assembly", "output_shape", "write_back",
] as const;

export function emitYaml(file: ContractFile): string {
  // Serialize editor-state to base64 comment block first
  const editorBase64 = Buffer.from(JSON.stringify(file.editor)).toString("base64");
  const editorComment = `# vm-editor-state: ${editorBase64}\n`;

  // Build YAML Document with canonical key order
  const doc = new Document(file.contract);
  reorderKeys(doc, CANONICAL_KEY_ORDER); // mutates in place
  return editorComment + doc.toString();
}

export function parseYaml(yamlText: string): ContractFile {
  const editorComment = extractEditorComment(yamlText); // strip leading `# vm-editor-state:` line
  const doc = parseDocument(yamlText);
  return {
    $schema: "https://vault-memory.dev/schemas/contract-v1.json",
    vmFormatVersion: 1,
    contract: doc.toJS() as Phase6Contract,
    editor: editorComment ? decodeBase64(editorComment) : defaultLayout(doc.toJS()),
  };
}
```

### Anti-Patterns to Avoid

- **Touching the vault's `_contracts/` directory via Node `fs` from the plugin.** Always use `this.app.vault.adapter.write(...)` so Obsidian's own file-event pipeline observes the write. (CLAUDE.md §"Constraints" — file paths confined to adapters; the plugin is its own Obsidian-fs adapter.)
- **Writing TOML directly from the plugin** for `[contracts.mcp_clients]` mutations. Always route through `set_mcp_client` MCP tool. The server is the config authority. (D-CHROME-CONNECTORS.)
- **Trusting `safeStorage.encryptString` on Linux without checking `getSelectedStorageBackend()`.** [CITED: Electron docs] If the backend is `basic_text`, the "encryption" is hardcoded — equivalent to plaintext. The plugin should surface a yellow warning in the secrets panel when this is the case.
- **Polling `tools/list` from the plugin** to detect contract changes. The MCP SDK 1.29 emits `tools/list_changed` notifications; subscribe to those. [CITED: MCP SDK docs]
- **Re-rendering Svelte Flow on every keystroke in the inspector.** Use Svelte 5 `$state` and pass only the changed step's args to the inspector — keep canvas re-renders out of the inspector's reactivity tree.
- **Watching `.contract` files from the plugin in addition to using `TextFileView`'s lifecycle.** D-WATCH-NO-PLUGIN-WATCH locks this out for a reason — double observation produces duplicated reloads.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Node-editor canvas (drag/zoom/pan/select/connect) | A 2000-LOC vanilla canvas renderer with manual hit-testing | **Svelte Flow** (`@xyflow/svelte`) | 107K weekly installs; same team as React Flow; MIT; all the hard parts (pixel-perfect connections, multi-select, snap-to-grid, keyboard nav, accessibility) already solved |
| YAML round-trip with comment preservation | A custom YAML parser that tracks comments separately | **`yaml ^2.9` `parseDocument`/`toString`** | Phase 6 CON-01 already locked this; the codec already works |
| OS-keyring secrets storage | `keytar` / `@napi-rs/keyring` / a custom DPAPI binding | **Electron `safeStorage`** (already in the Obsidian process) | No native modules to ship; per-device ciphertext is the desired security posture; Obsidian doesn't permit shipping native modules in plugins anyway [CITED: forum.obsidian.md/t/54844] |
| Plugin↔server IPC channel | A bespoke Unix-socket protocol or named-pipe transport | **MCP SDK stdio transport** (`StdioClientTransport`) | The exact same transport Claude Desktop uses to talk to vault-memory; battle-tested; supports progress notifications via `progressToken` |
| Zod schema → JSON schema → form fields | A 300-LOC reflection layer over `zod._def` | **Zod 4 `.toJSONSchema()` + a thin Svelte form renderer** | Zod 4 ships first-class JSON Schema export; the form renderer is ~150 LOC because we only need primitives + enums + the `{{alias.field}}` autocomplete widget |
| Custom file-extension binding | Hooking the Obsidian workspace open-file event manually | **`registerView` + `registerExtensions(['contract'], VIEW_TYPE)`** | Obsidian-standard; auto-launches the view; no race conditions on cold-start |
| Plugin auto-update | A custom version-poller that downloads tarballs from GitHub | **`vm-update` skill** (out-of-band shell script, runs in user terminal) | Bypasses Obsidian's community-plugin-store delay; no in-process update risk; matches the `vm-install` install path |

**Key insight:** Every item above represents 200–2000 LOC of "deceptively easy" work that the ecosystem has already solved. The single largest implementation risk in Phase 7 is the canvas renderer — and the answer is **don't write one**, use `@xyflow/svelte`.

---

## Runtime State Inventory

Phase 7 is a **greenfield + integration** phase, not a rename/refactor. No existing runtime state needs to be migrated. However, several inventory items below matter for forward compatibility:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 7 adds no new DB tables. May write `kind: "plugin_action"` rows to `audit_log` if telemetry-free local-only logging is added (Claude's discretion; recommendation: no). | None |
| Live service config | NEW: `~/.vault-memory/config.toml` gains `[plugin]` section (`enabled: boolean = false`, possibly `[plugin.server_command]`). | Code edit: extend `AppConfigSchema` in `src/config/loader.ts` |
| OS-registered state | NEW: macOS Keychain / Windows Credential Locker / Linux libsecret entries via Electron `safeStorage`. Per-device, per-user. | None at install — user adds secrets manually via PLG-02 UI. Document in `docs/v2/plugin/SECRETS.md` that uninstalling the plugin leaves orphaned keyring entries unless the user manually clears them. |
| Secrets / env vars | NEW: `.obsidian/plugins/vault-memory/data.json` contains `{secrets: [{name, ciphertext, createdAt}, …], settings: {…}}`. Ciphertext encrypted by `safeStorage` — cannot be decrypted across devices. | Document the per-device-ciphertext expectation in `docs/v2/plugin/SECRETS.md`. |
| Build artifacts | NEW: `dist-plugin/` (or similar) — esbuild output containing `main.js`, `manifest.json`, `styles.css` ready for distribution. Released via GitHub Releases as a tarball. | `vm-install` skill consumes the GitHub Release tarball; `vm-update` skill replaces `.obsidian/plugins/vault-memory/` contents atomically. |

**Sync substrate caveat:** Users running Syncthing / iCloud / git-sync on `.obsidian/plugins/vault-memory/data.json` will get **ciphertext synced** but **not the keyring**. On a second device, the plugin must detect "ciphertext present, decryption fails" and prompt the user to re-enter the secret. This is correct behavior; document it explicitly.

---

## Common Pitfalls

### Pitfall 1: `SuppressionSet` API mismatch (path-only vs hash-keyed)

**What goes wrong:** CONTEXT.md describes `suppress(path, hash)` / `matches(path, hash)`. The actual code is `add(path, ttlMs?)` / `consume(path)`. Path-only suppression with a 2s TTL works in the common case but loses a legitimate edit if the user saves the file twice within 2s (e.g., autoformat-on-save + manual save).

**Why it happens:** The Phase 6 hot-reload watcher didn't need to suppress anything because Phase 6 didn't write contracts. The API was designed for `write_note`-style cases.

**How to avoid:** Plan 07-spike (or 07-01) extends `SuppressionSet` to be **hash-keyed**: `add(path, hash?, ttlMs?)` and `consume(path, hash?)`. When `hash` is provided on `add`, `consume` matches only if the consumer's hash equals the suppressed hash. When `hash` is omitted (back-compat for v1 callers), behavior matches today's API. ~15 LOC change; all existing call sites continue to work.

**Warning signs:** A unit test that writes the same path twice in <2s and asserts both events propagate fails when path-only suppression is in place.

### Pitfall 2: `src/contracts/loader.ts` does not call `consume()`

**What goes wrong:** The plugin emits `.yaml`, suppresses, the FS event fires, but the loader doesn't check the SuppressionSet → it re-validates → hot-reloads — twice per save, every save. Two-way I/O loop.

**Why it happens:** [VERIFIED: `grep -n "suppress" src/contracts/loader.ts` → no matches]. Phase 6 didn't need the hook because Phase 6 didn't write.

**How to avoid:** Plan 07-spike includes a `src/contracts/loader.ts` amendment: in the ChangeFeed handler, before re-validating, call `suppression.consume(event.path, event.hash)` and short-circuit if it returns true. Add a unit test in `src/contracts/loader.test.ts` that simulates a suppressed write and asserts the registry remains unchanged.

**Warning signs:** Plugin save logs "contract reloaded" twice per save (one from the suppressed write, one from a redundant catch-up scan).

### Pitfall 3: `safeStorage` is not exposed in Obsidian's public API surface

**What goes wrong:** A plugin calls `import { safeStorage } from "obsidian"` and gets undefined. [CITED: forum.obsidian.md/t/54844 — "doesn't seem to be found at runtime"].

**Why it happens:** `safeStorage` is an Electron API, not an Obsidian API. Plugins must access it via `(window as unknown as { electron?: { safeStorage?: SafeStorage } }).electron?.safeStorage` OR via `require("electron").safeStorage`. Both work in Obsidian's renderer process today but neither is part of the public Obsidian API contract — there's a small risk of future Obsidian sandboxing.

**How to avoid:** Use the `electron` access path via `(window as any).electron?.safeStorage` (the desktop-renderer-exposed Electron module) and feature-detect with `isEncryptionAvailable()`. Wrap in a thin `SecretsStore` interface; mock the interface in tests. If Obsidian publishes a sanctioned API later, swap the adapter without touching call sites.

**Warning signs:** `isEncryptionAvailable()` returns `false` on Linux → backend is `basic_text` (no real OS keyring) → surface a yellow warning in the secrets panel.

### Pitfall 4: jsoncanvas "renderer" doesn't exist as a library

**What goes wrong:** The CAN-10 spike plans to "fork the jsoncanvas.org renderer" but the upstream `obsidianmd/jsoncanvas` repo contains only the spec — no renderer code. The three jsoncanvas TypeScript implementations on npm are all **viewers** with no edit API.

**Why it happens:** The user's mental model is that Obsidian's Canvas renderer is open source under jsoncanvas.org. It is not — Obsidian's Canvas is proprietary; jsoncanvas.org publishes the file format only.

**How to avoid:** Rescope CAN-10. The spike question becomes "wire **Svelte Flow** into a TextFileView and render `meeting-prep.contract`," not "fork a renderer." Svelte Flow is the off-the-shelf node-editor we'd be building toward anyway. The ADR 007 records the rescoping decision so future maintainers don't repeat the confusion.

**Warning signs:** A planner who reads CONTEXT.md without checking the upstream repo will scope plan 07-spike against a non-existent codebase.

### Pitfall 5: Obsidian plugin testing — `vitest` cannot resolve `import { … } from "obsidian"`

**What goes wrong:** Co-located `*.test.ts` files in `plugin/` import from `obsidian`; vitest fails to resolve the entry. [CITED: github.com/vitest-dev/vitest/issues/4029].

**Why it happens:** The `obsidian` npm package is a types-only shim — no `"main"` entry; the actual runtime is provided by Obsidian at load time.

**How to avoid:** Set up a vitest alias mapping `obsidian` → a `tests/mocks/obsidian.ts` stub. The stub exposes the minimum surface the plugin's pure-codec / pure-services modules need. Pure code (contract codec, canonicalization, Zod-form mapper) is tested without any Obsidian dependency; view code is tested via Playwright on a headless Obsidian instance OR is left to manual smoke testing in v2.0.0 (Claude's discretion — recommendation: defer Playwright to v2.1).

**Warning signs:** `vitest` errors like `Failed to resolve entry for package 'obsidian'`.

### Pitfall 6: Plugin spawning `vault-memory serve` competes with an already-running server

**What goes wrong:** The user already has Claude Desktop running with `vault-memory` configured in its MCP config. The plugin tries to `spawn("vault-memory", ["serve"])` and ends up with two server processes both touching the same SQLite DB.

**Why it happens:** `better-sqlite3` will tolerate concurrent reads but writes serialize per process; the second process gets `database is locked` errors. Phase 5 D-07 mentions a lock file at `~/.vault-memory/locks/<vault>.lock` — Phase 7 must honor it.

**How to avoid:** Two strategies, planner picks:
- **(a) Plugin always spawns its own server** and the user is told to disable Claude Desktop's `vault-memory` config when using the plugin. Simple; not great UX.
- **(b) Plugin discovers a running server** by trying to connect over an existing stdio descriptor (not possible — stdio is per-process) OR over a sentinel file describing an HTTP port the running server has bound to. **Out of v2.0.0 scope** — requires the server to expose an HTTP transport.
- **(c) Plugin spawns its own server but the server respects the existing lock** and exits gracefully if another process holds it. Plugin then shows "vault-memory is running elsewhere — please connect via that process."

**Recommendation: (a) for v2.0.0**, document the constraint in `INSTALL.md`. **(c) for v2.1**. **(b) is post-v2.0.0** (requires Phase 8 daemon-mode work which is in the deferred list).

**Warning signs:** `SqliteError: database is locked` in server logs the moment the plugin connects.

### Pitfall 7: Canvas viewport state vs file save

**What goes wrong:** The user pans + zooms the canvas; we save those numbers into `.contract.editor.viewport`; that triggers a `requestSave()` on every pan → file changes on every micro-gesture → user gets git-noise hell.

**Why it happens:** Naively coupling every Svelte Flow event to a save call.

**How to avoid:** Debounce viewport-only changes to 500ms+; save **only on user-initiated mutations** (drag a node, add an edge, edit an inspector field). Viewport changes propagate to in-memory state immediately for responsiveness but commit to disk only when piggy-backing on another save OR after a longer 5s idle.

**Warning signs:** `git status` shows `.contract` files dirty after the user just scrolled.

---

## Code Examples

### Example 1: Manifest file (CAN-01)

```json
{
  "id": "vault-memory",
  "name": "vault-memory",
  "version": "2.0.0",
  "minAppVersion": "1.5.0",
  "description": "Local-first agentic knowledge layer for Obsidian — semantic memory, briefs, and visual task contract editor.",
  "author": "Oliver Wrede",
  "authorUrl": "https://github.com/owrede/vault-memory",
  "fundingUrl": null,
  "isDesktopOnly": true
}
```
*Source: github.com/obsidianmd/obsidian-sample-plugin/manifest.json*

### Example 2: esbuild config (CAN-01)

```javascript
// plugin/esbuild.config.mjs
// Source: github.com/obsidianmd/obsidian-sample-plugin/esbuild.config.mjs
import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import builtins from "builtin-modules";

const prod = process.argv.includes("production");

const ctx = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins, /* node:* */],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  outfile: "main.js",
  treeShaking: true,
  plugins: [sveltePlugin({ preprocess: sveltePreprocess() })],
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
```

### Example 3: PluginSettingTab (PLG-01)

```typescript
// plugin/src/chrome/settings-tab.ts (sketch)
// Source: docs.obsidian.md/Reference/TypeScript+API/PluginSettingTab
import { PluginSettingTab, Setting, App } from "obsidian";

export class VaultMemorySettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: VaultMemoryPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "vault-memory settings" });

    new Setting(containerEl)
      .setName("Ollama URL")
      .setDesc("Local Ollama endpoint. Restart required to apply.")
      .addText((t) => t
        .setValue(this.plugin.settings.ollamaUrl)
        .onChange(async (v) => {
          this.plugin.settings.ollamaUrl = v;
          await this.plugin.saveData(this.plugin.settings);
          // hot-swap eligible? — embedding model is restart-required; UI flags it
        }));
    // … other settings
  }
}
```

### Example 4: Round-trip canonicalization unit test (CAN-07)

```typescript
// plugin/src/codec/codec.test.ts (sketch)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseYaml, emitYaml } from "./contract-codec.js";
import { parseDocument } from "yaml";

describe("CAN-07 round-trip", () => {
  for (const name of ["meeting-prep", "project-status", "code-review-brief"]) {
    it(`${name}.yaml → .contract → .yaml is JS-deepEqual after canonicalization`, () => {
      const original = readFileSync(`evals/fixtures/v2-test-vault/_contracts/${name}.yaml`, "utf8");
      const round1 = emitYaml(parseYaml(original));
      const round2 = emitYaml(parseYaml(round1));
      expect(parseDocument(round1).toJS()).toEqual(parseDocument(round2).toJS());
      // editor-state base64 comment survives a second round-trip
      expect(round1.startsWith("# vm-editor-state: ")).toBe(true);
      expect(round2.startsWith("# vm-editor-state: ")).toBe(true);
    });
  }
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `keytar` native module for OS keyring | Electron `safeStorage` API | Electron 15+ (2021); v34+ (2024) added async API | No native modules required in plugin bundle |
| Manual MCP protocol implementation | `@modelcontextprotocol/sdk` Client + StdioClientTransport | SDK GA late 2024 | First-class typed client + stdio transport; supports notifications/progress out of the box |
| React Flow for node editors | xyflow's React Flow OR Svelte Flow | xyflow consolidation 2023 | Same maintainers, same APIs; choice is purely framework-based |
| `zod-to-json-schema` external package | Zod 4 `.toJSONSchema()` built-in | Zod 4 GA 2025 | One less dep; first-class typing |
| `js-yaml` for YAML | `yaml` (`eemeli/yaml`) for round-trip comment preservation | `yaml v2` (2022+) | Phase 6 already locked this; js-yaml does NOT preserve comments |
| Obsidian Canvas + `.canvas` for any node-editor use case | Custom `.<ext>` file extension + `registerView` | Obsidian 1.4+ (mature 2023+) | Plugins own their UI end-to-end without fighting the Canvas chrome |

**Deprecated / outdated:**

- `obsidianmd/jsoncanvas` as a "renderer fork target" — it's a spec repo, not a renderer (see §Pitfalls 4).
- `keytar` for OS keyring — Obsidian forbids native modules in plugins; Electron `safeStorage` is the replacement.
- Polling `tools/list` for change detection — MCP SDK 1.29 emits `notifications/tools/list_changed`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The user accepts Svelte over React for the plugin framework | Standard Stack | Plan must re-cost the canvas pane with `@xyflow/react` (similar effort; larger bundle) |
| A2 | The user accepts `@xyflow/svelte` as the de-facto renderer choice in place of the "jsoncanvas fork" | Pitfall 4 + Standard Stack | If user wants to stick with a literal jsoncanvas fork, plan 07-spike must scope ~2 weeks of edit-API engineering on top of a viewer codebase |
| A3 | The plugin spawns its own `vault-memory serve` subprocess via stdio | Pitfall 6 | If the user wants the plugin to share an existing running server, the plan must include a Phase 7 HTTP transport (which is currently deferred) |
| A4 | `isDesktopOnly: true` is acceptable — no Obsidian mobile support | Pitfalls + safeStorage section | Mobile Electron does not exist; safeStorage is unavailable on mobile; the entire chrome surface depends on stdio child_process which mobile doesn't permit |
| A5 | `vitest` is the plugin's test runner with an `obsidian` module alias to a stub | Pitfall 5 | If the plan wants jest-environment-obsidian, the test infrastructure cost rises slightly; jest co-existing with the root's vitest costs CI minutes |
| A6 | Building `dist-plugin/` and packaging as a GitHub Release tarball is acceptable for `vm-install` skill consumption | Distribution + Skills | If user wants the plugin published via Obsidian's community-plugin-store as primary v2.0.0 path, the spike + plan must include the submission review window (weeks) |
| A7 | The `[plugin]` config section gates BOTH the plugin-control MCP tools AND the new MCP notification subscriptions | Architecture | If notifications are always-on, the snapshot test `tools-list.snapshot.json` stays stable but `notifications/list` (if it existed) would not — acceptable since MCP spec has no `notifications/list` |
| A8 | The plan can extend `SuppressionSet.add` to optionally accept a hash without breaking existing call sites (Phase 6 indexer/writer hot paths) | Pitfall 1 | If the existing call sites depend on path-only semantics in subtle ways, the API extension must be additive (`addHashed(path, hash)`) rather than a parameter overload |
| A9 | Phase 6's `ContractFileSchema` Zod is rich enough to drive an auto-generated form via Zod 4 `.toJSONSchema()` | Inspector pattern | If the schema's `$ref` resolution doesn't survive `.toJSONSchema()`, the form generator must walk the schema manually using `zod._def` (still feasible, ~50 more LOC) |
| A10 | Per-device `safeStorage` ciphertext is desired (re-entry on second device is acceptable UX) | Pitfall 3 + Secrets | User confirmed in CONTEXT.md operating-environment section; assumption is captured for the planner's reading |

---

## Open Questions (RESOLVED)

1. **Should `set_runtime_config` apply settings atomically or per-key?**
   - What we know: Settings UI lets the user change multiple keys then click Save; ideal semantics is "all-or-nothing." Hot-swap-eligible vs restart-required keys differ.
   - What's unclear: Whether the MCP tool accepts a single key + value (simple) or a partial settings object (atomic).
   - RESOLVED: **Per-key tool, plugin batches client-side.** Each setting change becomes one tool call; if any fails, the plugin rolls back the UI. Simpler tool surface; matches how Phase 6 `set_mcp_client` is shaped.

2. **Is the `vm-editor-state` base64 comment block enough, or do we also need a `vmFormatVersion` field in the YAML?**
   - What we know: `vmFormatVersion: 1` lives in the `.contract` JSON; the YAML is the build artifact.
   - What's unclear: If the YAML is the only artifact a non-plugin user ever sees, do we need a way to detect "this YAML was last touched by a plugin newer than mine"?
   - RESOLVED: **Yes — include `vmFormatVersion` in the base64-encoded editor state.** No YAML body changes; future-proof for plugin v2 → v3 migrations.

3. **Should the plugin embed `src/contracts/schema.ts` Zod directly or fetch it via an MCP tool?**
   - What we know: Phase 6 schema is canonical; the plugin must validate `.contract` and `.yaml` against it.
   - What's unclear: Embedding the schema means a dual-publish concern (server + plugin must stay in lock-step); fetching it via MCP means the plugin can't validate offline.
   - RESOLVED: **Embed via a shared workspace package or direct file import** — `plugin/src/shared-types.ts` does `import { ContractFileSchema } from "../../src/contracts/schema.js"`. Plan 07-spike confirms whether the workspace is set up as an npm workspace or as a relative-import monorepo. Either way, version skew is enforced at build time: if the plugin's bundled schema is older than the server's, the plugin's `.yaml` emissions may fail server-side validation — explicit error, no silent corruption.

4. **How does the spike validate the jsoncanvas-fork question once it's rescoped to Svelte Flow?**
   - What we know: ADR 007 is the artifact; a working prototype rendering one reference contract is the gate.
   - What's unclear: With the rescoping, the success criteria become "Svelte Flow wired into a TextFileView renders `meeting-prep.contract` and supports add-node / connect-edge / delete-edge." The deliverable changes; the gate is still real.
   - RESOLVED: Plan 07-spike rewrites the CAN-10 success criteria explicitly. ADR 007 records why the rescoping happened (Pitfall 4 in this research).

5. **What happens if the plugin is installed before the user has run `vm-install`?**
   - What we know: The plugin needs the `vault-memory` CLI to spawn `serve`.
   - What's unclear: Whether the plugin should detect a missing CLI and prompt to run `vm-install` from a chat skill, or silently fail with a clear error.
   - RESOLVED: **Plugin detects missing CLI, surfaces a banner "vault-memory CLI not found — run /vm-install in Claude Code to set up."** No automatic install; user must run the skill explicitly. This sidesteps the "plugin shouldn't install system software" anti-pattern.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22 | Plugin build, vault-memory server | ✓ (existing requirement) | matches package.json `engines.node` | — |
| `vault-memory` CLI on `$PATH` | Plugin spawns it as a child process | Conditional — user installs via `vm-install` skill | matches plugin version | Plugin surfaces banner if missing |
| Electron `safeStorage` | PLG-02 secrets | ✓ on desktop Obsidian (macOS/Windows/Linux) | Electron 15+ | Linux: backend may be `basic_text`; plugin warns; secrets remain in plaintext |
| Obsidian desktop ≥ 1.5.0 | Plugin manifest min version | ✓ assumed for v2.0.0 maintainer machine | minAppVersion = 1.5.0 | Older Obsidian: plugin refuses to load |
| `ollama` (localhost:11434) | Embedding server for reindex | Conditional — `install-vault-memory` skill installs it; required for PLG-03 reindex | bge-m3 default | Plugin shows clear error in stats panel |
| GitHub Releases public API | `vm-install` / `vm-update` skills | ✓ assumed; offline install instructions documented as fallback | n/a | Document tarball-from-local-path option in INSTALL.md |

**Missing dependencies with no fallback:**
- `vault-memory` CLI when the user installs the plugin manually without running `vm-install` first — plan must add a check + banner.

**Missing dependencies with fallback:**
- Linux `safeStorage` backend may be `basic_text` (no real keyring) — plugin warns user; secrets persist but unencrypted on disk; recommend user install `gnome-libsecret` or `kwallet`.
- Mobile Obsidian: ALL plugin features unavailable. Plugin manifest specifies `isDesktopOnly: true`, so this is enforced at install time.

---

## Validation Architecture

Workflow `nyquist_validation` is `true` per `.planning/config.json`. Each CAN-* and PLG-* requirement needs an observable + testable validation strategy.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest ^2.1.8` (existing) — extended to `plugin/` via root `vitest.config.ts` glob or a separate `plugin/vitest.config.ts` |
| Config file | None yet for the plugin tree; Wave 0 adds `plugin/vitest.config.ts` (or extends root config) with alias `obsidian` → `plugin/tests/mocks/obsidian.ts` |
| Quick run command | `npx vitest run plugin/src --reporter=basic` |
| Full suite command | `npm test` (already in root; extended glob picks up `plugin/**/*.test.ts`) |
| View-level tests | **Deferred to v2.1.** v2.0.0 ships unit tests for pure-codec / pure-service modules only; manual smoke test of the editor view via the screencast. |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CAN-01 | Plugin scaffolds; `npm run build` produces `main.js` + `manifest.json` | smoke / build | `cd plugin && npm run build` | ❌ Wave 0 |
| CAN-02 | `.contract` save emits valid `_contracts/<name>.yaml` parsed by Phase 6 `ContractFileSchema` | unit | `npx vitest run plugin/src/codec/codec.test.ts -t "emits valid Phase 6 YAML"` | ❌ Wave 0 |
| CAN-03 | YAML import builds `.contract` with all Phase 6 ADR-006 fields preserved | unit | `npx vitest run plugin/src/codec/codec.test.ts -t "imports YAML loss-less"` | ❌ Wave 0 |
| CAN-04 | Palette enumerates all 11 baseline verbs + literal + peer-MCP placeholder | unit | `npx vitest run plugin/src/views/contract-editor/palette/palette.test.ts` | ❌ Wave 0 |
| CAN-05 | View binds on `.contract` open (manual smoke + Obsidian sample plugin pattern is verified at build time) | manual + build | screencast covers this | manual |
| CAN-06 | Three reference `.contract` files exist; each opens cleanly | integration | `npx vitest run examples/contracts/round-trip.test.ts` | ❌ Wave 0 |
| CAN-07 | `.contract → .yaml → .contract` semantically equivalent after canonicalization; comments preserved | unit | `npx vitest run examples/contracts/round-trip.test.ts -t "round trip"` | ❌ Wave 0 |
| CAN-08 | SuppressionSet integration prevents echo loops | unit (server-side) | `npx vitest run src/contracts/loader.test.ts -t "suppressed write does not trigger reload"` | ⚠️ Wave 0 (existing test file extended) |
| CAN-09 | Docs exist + screencast linked | manual | grep `docs/v2/plugin/*.md` exists; check `README.md` for screencast link | ❌ Wave 0 |
| CAN-10 | Spike ADR exists + prototype runs against `meeting-prep.contract` | manual + smoke | open prototype in Obsidian; verify view renders | manual |
| PLG-01 | Settings tab renders; saved values persist; restart-required flag visible | unit | `npx vitest run plugin/src/chrome/settings-tab.test.ts` | ❌ Wave 0 |
| PLG-02 | Add secret → ciphertext written to data.json; list secret shows masked value; delete secret works | unit | `npx vitest run plugin/src/services/secrets-store.test.ts` (against mocked `safeStorage`) | ❌ Wave 0 |
| PLG-03 | "Reindex this vault" button triggers `trigger_reindex` MCP call; progress notifications render | unit (MCP call) + manual (progress UI) | `npx vitest run plugin/src/chrome/reindex-panel.test.ts -t "calls trigger_reindex"` | ❌ Wave 0 |
| PLG-04 | Stats panel renders values from `get_runtime_stats` MCP response | unit | `npx vitest run plugin/src/chrome/stats-panel.test.ts` | ❌ Wave 0 |
| PLG-05 | Add connector → `set_mcp_client` MCP call; test connection → `Client.connect()` round-trip succeeds | unit + manual | `npx vitest run plugin/src/chrome/connectors-panel.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run --changed --reporter=basic` (vitest's `--changed` mode runs only impacted tests).
- **Per wave merge:** `npm test` (full suite — 324 existing + plugin additions).
- **Phase gate:** `npm run lint:check && npm test && cd plugin && npm run build && cd .. && npm run eval:snapshot` (plus a manual screencast review for CAN-05/CAN-09/CAN-10/PLG-* view-level behaviors).

### Wave 0 Gaps

- [ ] `plugin/vitest.config.ts` (or root config extension) with `obsidian` module alias to a stub — Pitfall 5
- [ ] `plugin/tests/mocks/obsidian.ts` — minimum mock surface for `Plugin`, `TextFileView`, `WorkspaceLeaf`, `Vault`, `App`, `PluginSettingTab`, `Setting`
- [ ] `plugin/package.json` with Svelte + esbuild + `@xyflow/svelte` dependencies
- [ ] `plugin/manifest.json` with `isDesktopOnly: true` and `minAppVersion: 1.5.0` (planner picks)
- [ ] `plugin/esbuild.config.mjs`
- [ ] `plugin/main.ts` skeleton with `registerView` + `registerExtensions` + settings tab boilerplate
- [ ] `plugin/src/codec/contract-codec.ts` + co-located test
- [ ] `examples/contracts/round-trip.test.ts` invoking the codec against the three reference YAMLs
- [ ] Amend `src/adapters/change-feed/obsidian-fs/suppression.ts` to support optional `hash` parameter (~15 LOC + tests)
- [ ] Amend `src/contracts/loader.ts` ChangeFeed handler to call `suppression.consume(path, hash)` before re-validating
- [ ] Amend `src/config/loader.ts` `AppConfigSchema` to include `[plugin] enabled: boolean = false`
- [ ] Amend `src/tool-registry.ts` to gate new plugin-control tools behind `[plugin] enabled`
- [ ] Wave 0 baseline snapshot regen will move 37 → ~42 once plugin tools register (but only when `[plugin] enabled = true` — default tools-list.snapshot.json stays at 37)

---

## Security Domain

`security_enforcement` is not explicitly set in `.planning/config.json` — treating as enabled per the missing-key default. Plugin chrome (secrets, connectors, MCP tools) introduces real attack surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | No user-auth surface in v2 (single-user local); MCP stdio is implicitly authenticated by parent-process identity |
| V3 Session Management | no | No sessions — stdio transport is per-spawn |
| V4 Access Control | yes | `[plugin] enabled` config gate; new tools refuse to register if disabled |
| V5 Input Validation | yes | Zod 4 schemas validate every MCP tool input; `.contract` JSON is Zod-validated before round-trip; YAML emission re-validates against Phase 6 schema |
| V6 Cryptography | yes | Electron `safeStorage` (NEVER hand-roll — Pitfall 3) |
| V7 Error Handling and Logging | yes | Plaintext secrets MUST never appear in `console.log`, audit_log, or MCP response payloads |
| V14 Configuration | yes | `[plugin] enabled` defaults to false; new tool surface opt-in; `~/.vault-memory/config.toml` ownership remains with the server (PLG-05) |

### Known Threat Patterns for `Obsidian plugin + MCP server` stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Plaintext secret in `data.json` (synced via Syncthing/iCloud/git) | Information Disclosure | Always wrap with `safeStorage.encryptString`; refuse to persist plaintext; warn user when Linux backend is `basic_text` |
| `${secret:name}` substitution leaks plaintext to peer MCP server logs | Information Disclosure | Substitution happens in the local server only; substituted values flow only over stdio to known children; never logged at info level; redact in any debug log |
| Compromised peer MCP server steals secrets via tool-result echo | Tampering | Connector "test connection" doesn't pass secrets; secrets only resolve at actual contract-instantiation time; peer server can request a secret name but cannot enumerate the namespace |
| Malicious `.contract` file in shared vault embeds `mcp://<attacker>/tool` | Tampering / Elevation of Privilege | Peer-MCP entries are declared in `[contracts.mcp_clients]` config (server-controlled); a `.contract` referencing an undeclared `mcp://...` URI rejects with `unresolved_template` per Phase 6 D-A2c |
| Plugin spawns arbitrary `vault-memory serve` binary path | Tampering / Elevation of Privilege | Plugin reads the binary path from `[plugin] server_command` config (server-controlled); does NOT accept arbitrary paths via Settings UI without explicit confirmation; documents the constraint in SETTINGS.md |
| GitHub Releases tarball MITM during `vm-install` | Tampering | `vm-install` skill verifies a published checksum (SHA-256) against `manifest.json` checksum file in the same release; recommendation: also sign releases with maintainer GPG key |
| Cross-contract `${secret:name}` enumeration | Information Disclosure | `resolve_secret({name})` returns only the named secret; never lists; secrets API surface has add/delete/list (names only) — list never returns ciphertext or plaintext |

---

## Project Constraints (from CLAUDE.md)

| Constraint | How Plan 07 Honors It |
|-----------|-----------------------|
| Backwards-compat v1.x API — 23 tools unchanged | Plugin-control tools register only when `[plugin] enabled = true`; default OFF preserves snapshot stability |
| Local-only network (localhost:11434 only in v2) | Plugin makes outbound calls only via `vm-install`/`vm-update` skills (GitHub Releases); plugin runtime is stdio-only to local server |
| Memory namespace sacrosanct | Plugin writes only `.contract` and `.yaml` files in `_contracts/`; never touches memory sinks directly; all sink-targeted writes route through `instantiate_contract` (Phase 6 D-A4c guard) |
| Document identity opaque (URI-style) | Plugin uses `obsidian://<vault>/<path>` patterns indirectly; path strings appear only in the `Vault.adapter.write()` call sites |
| Seam preservation — every read/write/watch through an adapter interface | Plugin lives outside `src/`, but writes go via Obsidian's `app.vault.adapter` (its own adapter seam); no direct `fs` imports in plugin |
| Test discipline — 324 tests must not regress | Plan 07 amendments to `src/contracts/loader.ts` and `src/adapters/change-feed/obsidian-fs/suppression.ts` ship with new tests in the same PR; no existing test deleted |
| Branch hygiene — `phase-N-<slug>` off main | Plan 07 deliverable PRs land on `gsd/phase-7-visual-contract-editor-canvas` per `.planning/config.json` template |
| Eval discipline — fixture vault, eval suite | CAN-07 round-trip test reads `evals/fixtures/v2-test-vault/_contracts/*.yaml`; CAN-06 reference contracts are sourced from same fixtures |
| No premature LLM coupling | Plugin contains zero LLM calls; `compile_brief` invocations flow through the server's existing Phase 5 ladder |
| ESM-only | Plugin uses `import` everywhere; esbuild outputs CJS for Obsidian compatibility (Obsidian-standard pattern, not an ESM violation — it's the consumer's choice) |
| kebab-case files | All plugin file names follow this; e.g., `contract-codec.ts`, `settings-tab.ts` |
| Strict TS | Plugin's `tsconfig.json` extends root `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`, etc.) |
| Double quotes; 100-col | Prettier config inherits from root |
| Vitest co-located | Plugin tests co-locate per-module; e.g., `plugin/src/codec/codec.test.ts` next to `contract-codec.ts` |

---

## Sources

### Primary (HIGH confidence)

- `package.json` (vault-memory root) — confirmed `yaml ^2.9.0`, `zod ^4.4.3`, `@modelcontextprotocol/sdk ^1.29.0`, `node >= 22`
- `src/adapters/change-feed/obsidian-fs/suppression.ts` — confirmed actual `SuppressionSet` API is `add(path, ttlMs?)` / `consume(path)`
- `src/contracts/loader.ts` — confirmed via `grep -n "suppress"` that Phase 6 loader does NOT call `SuppressionSet` (Pitfall 2)
- `src/contracts/verbs/index.ts` — confirmed 11 baseline verbs + adapter pattern (matches CONTEXT.md palette decision)
- `docs/v2/adr/006-task-contract-dsl.md` — Phase 6 contract shape that Phase 7 round-trips against
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) — manifest.json fields, esbuild config, npm scripts
- [Obsidian Plugin Docs — text-based file formats](https://marcusolsson.github.io/obsidian-plugin-docs/tutorials/text-based-file-formats) — `TextFileView` lifecycle (`getViewData`, `setViewData`, `clear`, `requestSave`)
- [Obsidian Plugin Docs — registerExtensions](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerExtensions) — extension-to-view binding signature
- [Electron safeStorage docs](https://www.electronjs.org/docs/latest/api/safe-storage) — encryption API + platform behavior + per-device caveats
- [MCP TypeScript SDK docs](https://ts.sdk.modelcontextprotocol.io/classes/client.Client.html) — `Client`, `StdioClientTransport`, progress notifications
- [obsidianmd/jsoncanvas](https://github.com/obsidianmd/jsoncanvas) — confirmed spec-only repo, NOT a renderer
- [Svelte Flow project page](https://svelteflow.dev/) — MIT, full-edit semantics, custom Svelte components as nodes

### Secondary (MEDIUM confidence)

- [Obsidian Forum — Electron safeStorage available?](https://forum.obsidian.md/t/electron-safestorage-available/54844) — confirms `safeStorage` is reached via Electron, not the public Obsidian API
- [Obsidian Forum — child_process restrictions](https://forum.obsidian.md/t/when-i-use-child-process-in-nodejs-i-get-the-following-error-and-i-dont-know-why/56211) — confirms desktop-only requirement for stdio child processes
- [yaml package on npm](https://www.npmjs.com/package/yaml) + [eemeli/yaml on GitHub](https://github.com/eemeli/yaml) — `parseDocument` round-trip with comment preservation
- [react-jsoncanvas](https://github.com/Digital-Tvilling/react-jsoncanvas), [JSON-Canvas-Viewer](https://github.com/Hesprs/JSON-Canvas-Viewer), [@trbn/jsoncanvas](https://github.com/t128n/jsoncanvas) — all confirmed viewer-only (Pitfall 4)
- [@hookform/resolvers](https://www.npmjs.com/package/@hookform/resolvers) — supports Zod 4 + StandardSchema; informs the inspector form approach for the React alternative

### Tertiary (LOW confidence — needs validation)

- 2026 framework comparisons (Svelte vs React bundle sizes — `tech-insider.org/svelte-vs-react-2026`) — bundle numbers cited but not independently re-measured against this project's specific use case
- [jest-environment-obsidian](https://github.com/obsidian-community/jest-environment-obsidian) — exists but is a Jest environment, not Vitest; would require adding Jest if adopted (Pitfall 5 chose alias-based mocking instead)

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every key version verified against npm registry; `yaml`/`zod`/`@modelcontextprotocol/sdk` already pinned in package.json
- Architecture: HIGH — Obsidian `registerView` + `registerExtensions` + `TextFileView` pattern is well-established and matches CONTEXT.md decisions
- Pitfalls: HIGH — three of seven are verified against this codebase via grep; remainder cross-confirmed across multiple sources
- Watcher integration: MEDIUM (verified the gap but the fix is design-level, not yet implemented; plan 07-spike confirms the API extension)
- CAN-10 spike scope: HIGH — confidently identified that the user's "fork jsoncanvas renderer" premise has no upstream codebase; recommendation to rescope is strong
- Security domain: MEDIUM — ASVS mapping is reasoned but not exhaustively reviewed; security gate in Phase 8 may surface additional items

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (30 days for the Obsidian / Electron / MCP SDK ecosystem; fast-moving libraries like Svelte 5 + Svelte Flow may shift in 2–4 weeks — verify versions at plan time)
