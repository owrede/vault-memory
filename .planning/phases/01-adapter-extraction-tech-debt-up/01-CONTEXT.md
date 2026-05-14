# Phase 1: Adapter extraction & tech-debt-up - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Install three adapter seams (`SourceConnector` / `DeliveryAdapter` / `ChangeFeed`) per ADR-002, extract `obsidian-fs` as the v2 implementation of each from the existing `src/reader/`, `src/indexer/`, `src/write/`, `src/watcher/` modules, bundle MCP SDK `^1.29.x` + Zod `^4.x` upgrades, ship the dual-column `doc_uri` Strategy-A migration with backfill, ship the stub-adapter conformance suite, prove client-agnosticism via `scripts/smoketest-non-claude.mjs`, and rewrite README to lead with "any MCP-aware agent" framing — **all without user-visible behavior change**. Phase 1 is purely architectural: zero new features, zero v1 tool surface change, all 324 tests must remain green throughout, and the v1-baseline eval suite must stay PASS. ADR-002 invariants I-1..I-7 are enforced by CI greps that fail the build on any leak.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-14): two narrow gray areas were discussed; everything else falls under "Claude's Discretion" — researcher and planner decide using ADR-002, the Phase 0 outputs (concerns map, fixture vault, v1-baseline suite, CI lints), and the requirements list as the constraints. Maintainer retains veto in PR review.

### Obsidian-concept reabsorption (3 concrete leaks identified in `.planning/codebase/CONCERNS.md`)

- **D-01: `obsidian://` URL generation moves into `SourceConnector.formatDisplayUrl(id): string | null`.**
  Each source adapter knows how to deep-link its own documents. `obsidian-fs` returns `obsidian://open?vault=…&file=…`; a future `notion-api` adapter returns `https://notion.so/<id>` or `null` (its choice). The result lands in `Document.display_url`, computed at `readDocument()` time, not at search-render time. This propagates cleanly into Phase 3's `ASM-05` citation packet (already requires `display_url` per ROADMAP success criterion #1). Removes `obsidianUrl()` from `src/server.ts:891` entirely.

- **D-02: `DEFAULT_CLIENT_ID = "claude-code"` replaced by MCP `client_info` handshake capture.**
  At server bootstrap, capture the client name + version from the MCP `InitializeRequest` (`@modelcontextprotocol/sdk` exposes this on the connected session). Thread the captured value as the default `client_id` into `write.ts`, `frontmatter/update.ts`, and `deleteNote`. Fall back to literal string `"unknown"` when `client_info` is absent (older or non-conformant clients). This removes the Claude-Code attribution leak entirely while preserving real attribution in audit logs. Does not require any tool-shape change (v1 `client_id` arg stays optional and overrides the default when supplied).

- **D-03: `DEFAULT_EXCLUDES` (`.obsidian/**`, `.trash/**`, …) hardcoded inside the obsidian-fs source adapter only.**
  Excludes live in `src/adapters/source/obsidian-fs/scanner.ts` as the adapter's built-in defaults. User config (`config.toml`) and `ListOptions.excludeGlobs` overlay/replace them per ADR-002 §`ListOptions`. Core code carries no exclude defaults. Future adapters define their own (or none). Existing users see zero behavior change because the Obsidian-specific defaults are still applied — just by the adapter, not by core.

### Wikilinks-as-schema (deeply embedded in core DB layer per CONCERNS.md)

- **D-04: Wikilinks abstraction is deferred entirely to Phase 4 (GRA-04 typed-edge schema).**
  Phase 1 leaves the `wikilinks` table (`src/db/schema.ts:103`), `WikilinksQueries` (`src/db/queries/wikilinks.ts`), and `WikilinkResolver` (`src/indexer/resolver.ts`) in their current locations. The Phase 1 CI greps therefore do **not** flag the token `wikilink` — it is a legitimate Phase-1 concept; abstraction is Phase 4's job. CONTEXT.md adds the deferral as a Phase-4 carry-forward note so Phase 4's planner knows it inherits this debt.

- **D-05: Wikilinks extracted by the obsidian-fs source adapter surface as `Document.properties.wikilinks: WikilinkRef[]`.**
  When `parseNote()` moves into `src/adapters/source/obsidian-fs/parser.ts`, the `extractWikilinks()` call stays inside the adapter. The adapter populates `Document.properties.wikilinks` during `readDocument()`. The core wikilinks table + resolver continue to consume that property (instead of consuming `ParsedNote` directly). Other adapters (e.g., stub, future notion-api) simply don't populate the field — they emit their own link types in their own properties or as edges. Honors ADR-003's "properties are untyped for obsidian-fs" capability and gives the conformance suite a single Document field to assert against. Phase 4 will promote this to first-class `Document.edges: Edge[]` with `type:"wikilink" | "mention" | "frontmatter-ref" | "hyperlink"` per ADR-003 / GRA-04.

### Claude's Discretion

Five implementation areas were deliberately **not discussed**. Researcher + planner choose, anchored by ADRs and Phase 0 artifacts. Maintainer reviews in PR.

- **PR cadence and refactor sequence.** Sequence of seam extractions (source → delivery → change-feed?), SDK/Zod bump position, smoketest, conformance — the planner picks the wave/dependency graph that keeps `main` (or the `phase-1-<slug>` phase branch) green at every PR boundary. ADR-002 Invariants I-1..I-7 + CI greps are enforced from the moment the relevant code lands in `src/adapters/`; the planner sequences PRs so each PR ends green.
- **`doc_uri` Strategy-A staging.** ADP-07 says "dual-column, staged across two migration versions" (`v7` + `v8`) with backfill. The planner picks the exact column shape, whether `v7` adds nullable + writes both columns (`doc_uri` and the existing path-PK) and `v8` flips read preference / backfills / asserts NOT-NULL — or any equivalent staging that preserves rollback safety. Constraint: the v1-baseline eval suite must remain green at every migration boundary; the planner cites the migration sequencing in the PLAN.md `<files_modified>` / `<acceptance_criteria>`.
- **MCP SDK 1.29 + Zod 4 migration approach (`registerTool` vs `setRequestHandler`).** The planner decides whether to migrate all 23 tools to `registerTool(...)` in this phase or keep the existing `setRequestHandler(CallToolRequestSchema, …)` dispatch and just bump the deps + add Standard Schema wiring. Either is acceptable provided ADP-08 (`^1.29.x`), ADP-09 (`^4.x`), and ADP-15 (324 tests green) all hold. The planner is encouraged to read the official MCP SDK 1.29 migration notes before deciding; if `setRequestHandler` is being deprecated, prefer `registerTool` to avoid a future breaking-bump cycle.
- **Stub-adapter conformance suite scope (ADP-13).** Phase 1 success criterion #5 says "conformance test suite is green" without naming a precise bar. Researcher recommends a behavioral suite with a hand-coded in-memory `StubSource` / `StubDelivery` / `StubChangeFeed` (returning fixed `Document` objects, accepting writes into an in-memory map) that asserts every method signature, every capability descriptor field, and every invariant I-1..I-7 the stub *can* satisfy. The full "stubbed second adapter passes the v1-baseline eval queries" target belongs to Phase 3 (ASM-12). Planner has discretion to scope tighter if behavioral cost grows large; the floor is "interface-shape + capability-descriptor + invariant assertions all green for both obsidian-fs and stub."
- **`scripts/smoketest-non-claude.mjs` target client (ADP-10).** Planner picks one of: official `@modelcontextprotocol/inspector` (likely easiest, scriptable, well-supported), `@modelcontextprotocol/sdk` test client, or both. Constraint: the script must run **in CI** (gates merge), not just as a one-shot README instruction — otherwise client-agnosticism is unenforceable and rots.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 spec (locks the interface shapes)
- `docs/v2/adr/002-adapter-seams.md` — `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` interfaces; `SourceCapabilities` / `DeliveryCapabilities` types including `refHashKind` and `hashProtected` enum tier semantics; `DocumentRef.hash` contract; Invariants I-1..I-7; Examples A/B/C with obsidian-fs and notion-api capability deltas; adapter-private `__adapter_<scheme>_*` SQLite permission
- `docs/v2/adr/001-document-identity.md` — opaque URI-style `DocId` (`<scheme>://<authority>/<resource>`); I-6 canonical-serialization rule; `obsidian-fs` Example
- `docs/v2/adr/003-document-shape.md` — `Document`, `BlockNode`, `PropertyBag`, hash semantics H-1..H-6 (versioned-API normalization rule); `source_hashes` chunk-level schema
- `docs/v2/adr/004-memory-sink-handles.md` — `MemorySink` handle parser, `.memory-sink` sentinel (Phase 2 dependency; Phase 1 must not break sink-resolution assumptions)
- `docs/v2/ARCHITECTURE.md` — layer model (Adapter / L0 retrieval / L1 graph / L2 memory / L3 assembly / L4 contracts); informs where new modules land
- `docs/v2/AGENT_AGNOSTIC.md` — MCP-as-canonical-interface stance; constrains the smoketest target choice and `client_info` capture

### Requirements / roadmap / state
- `.planning/REQUIREMENTS.md` lines 28–44 — ADP-01..ADP-15 (precise deliverable list for Phase 1)
- `.planning/REQUIREMENTS.md` §"Out of Scope" lines 172–193 — non-negotiable exclusions; especially **"Path-as-primary-key in DB after Phase 1"** (ADP-07 lands the replacement) and **"YAML-frontmatter-specific logic outside the obsidian-fs adapter"** + **"File-path manipulation outside `src/adapters/*`, `src/config/`, `cli.ts`"** (Invariants I-2..I-4 enforce these)
- `.planning/ROADMAP.md` lines 56–67 — Phase 1 goal + 5 success criteria (the WHAT this phase must achieve)
- `.planning/STATE.md` — current position post-Phase-0; Phase 0 ADR amendments now Accepted; CI lints + workflow gate live
- `.planning/PROJECT.md` — full v2 mission, eval discipline, branch hygiene, ESM-only / Node ≥22 constraints

### Phase 0 outputs to consume directly
- `docs/v2/adr/ADVERSARIAL-REVIEW.md` — 10 findings; especially Findings 1 (env-var secrets convention — informs ADP-08 if any future adapter needs config), 7 (`DocumentRef.hash` two-tier contract — informs `obsidian-fs` capability descriptors), 9 (`__adapter_<scheme>_*` private tables — informs ADP-04 type shapes), 10 (`hashProtected` enum — informs `obsidian-fs` `DeliveryCapabilities`)
- `docs/v2/adr/README.md` — MADR-style index; the 4 Accepted ADRs are Phase 1's spec; 14 Open Deferred-v3 rows clarify what is NOT Phase 1's job
- `docs/v2/SIGN-OFF.md` — Phase 0 maintainer sign-off; everything below the line is Phase 1's licensed substrate
- `evals/fixtures/v2-test-vault/` (Atlas Robotics fixture) — Phase 1 conformance suite + smoketest use this; do not modify the vault, only read
- `evals/v1-baseline/` — must stay green at every commit; baseline.test.ts + per-tool YAML floors + tools-list.snapshot.json
- `src/tool-registry.ts` — extracted from `server.ts` in Phase 0 (plan 00-10); the single source for SDK 1.29 `registerTool(...)` migration if planner picks that path
- `scripts/check-fixture-privacy.sh` + `scripts/lint-no-telemetry.sh` + `.github/workflows/ci.yml` — existing CI gates; Phase 1 adds a third lint script `scripts/lint-adapters.sh` (per ADR-002 §"Co-location & enforcement") that enforces I-1..I-6 mechanically

### Codebase maps (read for Phase 1 mechanics)
- `.planning/codebase/CONCERNS.md` — **seam-leak hotspot inventory** (the most important map for Phase 1 — every leak listed is a Phase 1 todo):
  - `src/config/add-vault.ts` (fs.writeFile/readFile/mkdir/appendFile/stat, join, resolve, basename) — fs.* allowed by I-2 in `src/config/` but path-safety guard is missing
  - `src/rerank/onnx-reranker.ts` (existsSync, path join for model + tokenizer) — out-of-bounds per I-2/I-3; needs adapter or special carve-out
  - `src/frontmatter/update.ts` (fs.readFile line 237) — should be absorbed by the write adapter
  - `src/write/write.ts` (matter import line 13) — duplicates gray-matter import; should route through the source adapter's parser
  - `src/reader/parser.ts`, `src/reader/scanner.ts` — entire module relocates into `src/adapters/source/obsidian-fs/`
  - `src/server.ts:891` (`obsidianUrl`) — see D-01
  - `src/write/write.ts:76` (`DEFAULT_CLIENT_ID = "claude-code"`) — see D-02
  - `src/reader/scanner.ts:8` (`DEFAULT_EXCLUDES = [".obsidian/**", …]`) — see D-03
  - All `.md` literals listed (`src/reader/wikilinks.ts:108`, `src/server.ts:1276`, `src/reader/scanner.ts:47`, `src/watcher/watcher.ts:134`, `src/frontmatter/update.ts:208`, `src/schema/combiner.ts:154`, `src/write/write.ts:99`) — must move into adapter modules per I-5
- `.planning/codebase/STRUCTURE.md` — directory layout, naming conventions, "Where to Add New Code" recipes (informs the new `src/adapters/{source,delivery,change-feed}/` directory shape)
- `.planning/codebase/STACK.md` + `CONVENTIONS.md` — ESM + `.js` extension, kebab-case, TOML for config, co-located `*.test.ts`, type-checking-is-the-linter
- `.planning/codebase/TESTING.md` — vitest layout, conformance suite goes under `src/adapters/**/conformance.test.ts` or `tests/conformance/`
- `.planning/codebase/INTEGRATIONS.md` — Ollama, ONNX, chokidar integration points; chokidar's single import boundary is already clean (`src/watcher/watcher.ts` lines 15–16) and relocates wholesale into `src/adapters/change-feed/obsidian-fs/`

### External references
- MCP SDK 1.29 migration notes — read upstream changelog / official guide; `registerTool(...)` API + Standard Schema integration with Zod 4
- Zod 4 migration guide — breaking changes from v3 (refinement API, error map shape, `safeParse` discriminants); the planner consults this for the SDK 1.29 wiring
- `@modelcontextprotocol/inspector` (or equivalent) — official non-Claude MCP smoketest harness candidate (ADP-10 / D-?? — Claude's Discretion)
- RFC 4122 — referenced by ADR-001 I-6 (canonical UUID form for future adapters; obsidian-fs uses path slugs not UUIDs, so this is informational)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Existing module boundaries are already mostly adapter-shaped.** `src/reader/`, `src/indexer/`, `src/write/`, `src/watcher/` map cleanly to the three seams. Bulk of Phase 1 is `git mv` + interface extraction + import-path rewrites + adapter-private re-imports of `fs`/`path`/`chokidar`/`gray-matter`. ADR-002 §"Decision" already specifies the target layout (`src/adapters/{source,delivery,change-feed}/obsidian-fs.ts` + `types.ts` + `registry.ts` + `capabilities.ts`).
- **chokidar is already isolated** to `src/watcher/watcher.ts` (CONCERNS.md: "Finding: clean"). Move is mechanical; no leak hunt required.
- **`src/tool-registry.ts`** (extracted from `server.ts` in Phase 0 plan 00-10) is the single source of truth for the 23-tool surface — the SDK 1.29 `registerTool(...)` migration touches this file plus `server.ts` bootstrap, not 23 separate places.
- **`evals/v1-baseline/` snapshot + per-tool YAML floors** are the safety net for ADP-15 ("all 324 v1 tests still pass"). Any Phase 1 PR that flips a search/write/frontmatter result is caught before merge.
- **Atlas Robotics fixture vault** (`evals/fixtures/v2-test-vault/`, ~75 notes) is the conformance suite + smoketest substrate. Read-only; do not modify.
- **POSIX shell + `scripts/check-fixture-privacy.sh` + `scripts/lint-no-telemetry.sh`** establish the lint convention; `scripts/lint-adapters.sh` (Phase 1 addition) follows the same shebang/style.
- **`safeJoinInsideVault`** (`src/write/fs.ts:72`) is the existing path-safety guard for vault writes; moves into `src/adapters/delivery/obsidian-fs/` and continues to protect write paths. `src/config/add-vault.ts` does not use it (CONCERNS.md flags this as a low-severity gap — Claude's Discretion whether Phase 1 touches it; not in ADP scope).
- **Migration pattern** (`src/db/schema.ts` `MIGRATIONS[]` array, `runMigration00X` functions, `PRAGMA user_version`) — ADP-07 follows the established pattern; sample sketch in `CONCERNS.md` §"Adding `doc_uri` Columns Safely" lines 134–144.

### Established Patterns

- **Kebab-case filenames** — applies to new files: `obsidian-fs.ts`, `change-feed.ts`, `capabilities.ts`, `registry.ts`, `lint-adapters.sh`.
- **ESM + `.js` extension on relative imports** — applies to every new import path; `verbatimModuleSyntax: true` means type-only imports must use `import type`.
- **Co-located `*.test.ts`** — new adapter modules get co-located tests; conformance suite can either co-locate (`src/adapters/source/conformance.test.ts`) or land under a top-level `tests/conformance/` directory (planner's choice — TESTING.md says co-located is the default, conformance is the candidate exception because it's cross-module).
- **Type-checking is the linter** — branded `DocId` nominal type (ADP-05) is enforced by `tsc --noEmit`, not by a separate ESLint rule.
- **One file per class/concept; no catch-all `utils.ts`** — applies to adapter helpers too.

### Integration Points

- **`.github/workflows/ci.yml`** — Phase 1 adds a step that runs `scripts/lint-adapters.sh` (the new I-1..I-6 grep enforcer). Existing `npm run lint:check` chains both shell lints + `tsc --noEmit` + `prettier --check`; the new lint joins this chain.
- **`package.json` scripts** — add `lint:adapters` (or extend `lint:check`); add `eval:smoketest` (or wire `scripts/smoketest-non-claude.mjs` into existing `eval:*` family); SDK + Zod major bumps land here in the `dependencies` section.
- **`src/server.ts` bootstrap** — captures MCP `client_info` from the initialization handshake (D-02), instantiates the adapter registry (`src/adapters/registry.ts`), registers `obsidian-fs` for all three roles.
- **`~/.vault-memory/config.toml`** — `[vaults]` entries gain (or already imply) a `source` handle; no user-visible config change required for v1.x users (default handle is `obsidian-fs://<vault-name>`).
- **CHANGELOG.md `[Unreleased]`** — Phase 1 appends entries under `### Added` (adapter seams, conformance suite), `### Changed` (SDK 1.29, Zod 4, README rewrite, client_id default), `### Migration` (doc_uri Strategy A).

</code_context>

<specifics>
## Specific Ideas

- **Phase 1 is the architectural-pivot phase; "no user-visible behavior change" is the safety net.** Every PR ends with all 324 tests green AND v1-baseline eval green. The phase mode is `mvp` (vertical-slice) — the planner is encouraged to land the three seams as separate vertical slices (source, then delivery, then change-feed) rather than a horizontal "interfaces first, then implementations" cut.
- **The `obsidian-fs` adapter is the *reference implementation* of the three interfaces; the stub adapter is the *conformance proof*.** Both exist after Phase 1. Phase 3 will introduce additional stubs for source-neutrality (ASM-12); Phase 1's stub is the minimum needed to assert ADR-002 invariants and capability-descriptor honesty (I-7).
- **Branded `DocId` (ADP-05)** rejects raw `string` at compile time. The planner uses `type DocId = string & { readonly __brand: 'DocId' }` (TS nominal type pattern) — every existing `string` call-site that should be a `DocId` becomes a compile error until the cast goes through the URI parser. This is the mechanical enforcement of ADR-001's identity contract; the v1-baseline test suite catches the runtime behavior.
- **`scripts/smoketest-non-claude.mjs` lives in CI as a merge gate.** A README-only smoketest rots within months; CI enforcement is what makes "any MCP-aware agent" framing honest.
- **Phase 0 already shipped `src/tool-registry.ts`** — SDK 1.29 migration touches that file + `server.ts` bootstrap, not 23 places.
- **CI grep enforcement (Invariants I-1..I-6) lands as `scripts/lint-adapters.sh`** per ADR-002 §"Co-location & enforcement". Each invariant becomes one grep with a clear failure message naming the offending file + line + the invariant ID.

</specifics>

<deferred>
## Deferred Ideas

### To Phase 4 (Graph-as-retrieval, GRA-01..GRA-05)
- **Promote `wikilinks` table → `edges` table with `type` column** (per D-04). Today the wikilinks table + `WikilinksQueries` + `WikilinkResolver` are core-DB concerns despite encoding one specific edge type. Phase 4 GRA-04 introduces the typed-edge schema (`wikilink`, `frontmatter-ref`, `mention`, `hyperlink`); that is the natural moment to abstract. Phase 1 does NOT touch any of these files.
- **Promote `Document.properties.wikilinks: WikilinkRef[]` → `Document.edges: Edge[]` with `type:"wikilink"`** (per D-05). Phase 4 picks the `Edge` shape (ADR-003 already sketches it) and the obsidian-fs adapter migrates its emission accordingly. Phase 1 ships the property-based intermediate form.

### To Phase 2 (Memory namespace, MEM-01..MEM-12)
- **Memory-sink write guard inside `DeliveryAdapter.write()`** — Phase 1 establishes the seam; Phase 2 puts Guard A (provenance required) and Guard B (`source: agent` outside any configured sink rejected) inside the adapter. Phase 1's `obsidian-fs` `DeliveryAdapter` has no guards yet, only the existing `write_enabled` flag + `safeJoinInsideVault` path safety.

### To Phase 10 (v3, Notion connector — deferred milestone)
- **`VAULT_MEMORY_<SCHEME>_*` env-var convention** (resolved in Phase 0 Adversarial Finding 1, amended into ADR-002) — Phase 1 has no secrets to handle (obsidian-fs needs none). The `config.toml` `${env:VAULT_MEMORY_*}` substitution lands when the first adapter needs secrets, which is Phase 10.
- **Adapter-private `__adapter_<scheme>_*` SQLite tables** (Adversarial Finding 9) — Phase 1's `obsidian-fs` adapter doesn't need a cache (content hashes are cheap via `sha256(body)`); the permission lands in the registry contract but no table is created.
- **Third-party adapter plugin loading** — explicitly out of v2 per ADR-002 "Open follow-ups"; registry registrations stay hardcoded at startup.

### Considered, kept out of Phase 1
- **`src/config/add-vault.ts` path-safety hardening** (CONCERNS.md §"Path Traversal on Write Operations" lines 237–243). The `add-vault` CLI path is not vault-content writes and is not covered by `safeJoinInsideVault`. Low-severity in practice (CLI is run by the vault owner). Not in ADP-* scope; Claude's Discretion to address opportunistically if the file is touched by the refactor.
- **Pre-migration DB backup** (CONCERNS.md §"No Pre-Migration DB Backup" lines 154–157). Useful for Phase 1's `doc_uri` migration but not blocked on it; SQLite transaction rollback is sufficient safety for the additive `ALTER TABLE ADD COLUMN` pattern. Deferred to Phase 8 release-gate work or earlier if a migration with destructive risk lands.
- **`src/rerank/onnx-reranker.ts` path operations** (`existsSync`, path join for model + tokenizer) (CONCERNS.md §"Raw File-Path Operations"). These are *config-layer* file operations against `~/.vault-memory/models/`, not vault-content operations. Treat as `src/config/`-equivalent for I-2/I-3 carve-out, OR confine to the adapter via a thin `ModelLoader` interface. Planner decides; either is acceptable so long as CI greps pass.

</deferred>

---

*Phase: 01-adapter-extraction-tech-debt-up*
*Context gathered: 2026-05-14*
