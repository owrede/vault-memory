# Changelog

All notable changes to **vault-memory** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Release process** — every PR that ships a user-visible change MUST append an entry
> under `## [Unreleased]` below. On release, that section is renamed to the new version
> with today's date, and a fresh `## [Unreleased]` block is started above it. See the
> bottom of this file for the one-paragraph cut-a-release recipe.

## [Unreleased]

### Added

- **Task Contract DSL (Phase 6, ADR-006)** — declarative YAML contracts under `_contracts/<name>.yaml`, addressable by name, instantiable via MCP, with handle-based source/sink portability. Contracts use a closed assembly verb enum (11 baseline + `literal` + `mcp://<server>/<tool>` peer extension), `{{template}}` step composition, JSON-Schema-with-`$ref` inputs, MemorySink-only sinks (un-bypassable per D-A4c), and ChangeFeed hot reload (D-LOAD). See `docs/v2/PHASE-6-SIGN-OFF.md` + `docs/v2/adr/006-task-contract-dsl.md`.
- **3 new MCP tools (Phase 6)** — `describe_contract`, `instantiate_contract`, `register_contracts_as_tools`. Tool count: 34 → 37 (additive only; v1-baseline preserved byte-identical).
- **2 new MCP Resources (Phase 6)** — `vault-memory://contracts/{vault}` (CON-04) lists contracts available in a vault; `vault-memory://contract-verbs/{vault}` (D-A2b) lists baseline + custom `mcp://` verbs with invocation counts. Resources do NOT count toward the REL-08 tool budget per Phase 5 BRF-09 precedent.
- **3 reference contracts (Phase 6)** under `evals/fixtures/v2-test-vault/_contracts/`: `meeting-prep`, `project-status`, `code-review-brief`. Plus `smoketest-trivial` for the CON-09 non-Claude smoketest path (literal-only assembly; no LLM needed in CI).
- **`contract_audit` table (Phase 6, migration 014)** — orchestration audit substrate; one row per assembly step (kind=`contract_step`) and one row per load failure (kind=`contract_load_error`). Payload-free per Invariant C-5 (peer-MCP outputs may carry sensitive data; we never capture them). Feeds `aggregateVerbUsage(vault)` for the D-A2b promotion signal.
- **`[contracts]` config block (Phase 6)** — `auto_register_tools: bool = false`, `tool_prefix: string = "vm_"`, `step_timeout_seconds: number = 30`, `defaults: Record<string, string> = {}`, `mcp_clients: Record<string, {command, args?, env?}> = {}`.
- **`instantiate_contract` write_back chokepoint (Phase 6)** — routes through `DeliveryAdapter.write()` so the MEM-05 invariant is un-bypassable by construction. Sink overrides MUST resolve through `MemorySinkRegistry.resolveMemorySink()` before write; otherwise `{ok:false, reason:"sink_override_not_a_memory_sink"}`.
- **CON-10 stub-parity proof (Phase 6)** — `src/adapters/source/conformance.test.ts` gains a `contracts stub-parity (CON-10)` describe block proving the same contract produces structurally identical bundles across obsidian-fs and stub source connectors.
- **CON-09 non-Claude smoketest extension (Phase 6)** — `scripts/smoketest-non-claude.mjs` spawns the server against a temp HOME with the fixture vault, asserts the three contract tools surface, calls `describe_contract` + `instantiate_contract` + reads the `list_contracts` Resource, and exits 0.
- **`ObsidianFsSource` widened to enumerate `_contracts/*.yaml` (Phase 6)** — non-recursive walk added via `scanContractFiles`; `scanVault` unchanged so the indexer's `.md`-only contract is preserved. `readDocument` handles YAML files by returning raw text as a single paragraph block (bypasses `parseNote`'s markdown assumptions).
- **`expand` MCP tool (Phase 4 plan 04-03 / GRA-01)** — typed-edge BFS retrieval primitive. Returns the typed-edge neighborhood of one or more seed documents as a flat array of citation packets, each carrying `via: {seed_doc_id, hop, edge_type, direction}` provenance. Hops hard-capped at 2 (v2.0.0). Default direction `'both'`. Filterable by `edge_types: EdgeType[]` and by `filter_properties` (strict equality, no operators). Memory-sink documents (`_memory/...`) surface only when transitively reachable from a user-note seed via at least one in-result inbound edge — per ADR-004 memory-namespace opacity rule. Unknown `seed_doc_ids` do NOT throw — they are returned in a `warnings: [{seed_doc_id, reason: 'unknown_doc'}]` array. Shortest path wins on dedup; ties broken by `(seed_doc_id, edge_type, direction)`.
- **`cluster` MCP tool (Phase 4 plan 04-05 / GRA-02)** — Louvain community detection over the typed-edge graph, deterministic across runs via `seedrandom`. Accepts mutually-exclusive `query | seed_doc_ids`. Returns `{ok: true, communities: Cluster[]}` or `{ok: false, reason: 'too_many_nodes' | 'missing_input' | 'mutually_exclusive_input'}`. 5000-node hard cap with `force: true` override. Per-community `cluster_id` is the smallest member DocId by lexicographic order — deterministic naming independent of internal community index assignment. Hybrid-search dependency injected via `ClusterDeps.hybridSearch` closure to avoid the `src/graph/cluster.ts → src/search/hybrid.ts` circular import.
- **`search_hybrid({expand})` additive nested param (Phase 4 plan 04-04 / GRA-03)** — pass `expand: {hops: 1|2, direction?, edge_types?}` to auto-attach 1–2 hop typed-edge neighbors as `SearchHit.expansions?: CitationPacketWithVia[]` per hit. Runs AFTER recency/authority rescore (D-16); never participates in score computation; top-K ranking unchanged. Guard-and-short-circuit composition: when `expand` is omitted, the code path is byte-identical to Phase 3 (zero new DB reads, zero new JSON fields).
- **Typed-edge storage substrate (Phase 4 plan 04-01 / GRA-04)** — `edges` table (migration 011) with four edge types (`wikilink`, `mention`, `frontmatter-ref`, `hyperlink`) and a UNIQUE INDEX on `(source_note_id, target_note_id, type, anchor, line_number)` using `COALESCE` for proper NULL-as-distinct dedup. Chunked backfill from v1 `wikilinks` table (10k-row chunks, `INSERT OR IGNORE`, idempotent). The v1 `wikilinks` table is preserved alongside `edges` for v1 invariance (D-01); v3 cleanup is tracked.
- **Unified edge extractor (Phase 4 plan 04-02 / GRA-04 indexer)** — `extractAllEdges(vault, parsed, resolver): EdgeInput[]` extracts all four edge types in a single per-note parse pass. `MIN_MENTION_LEN = 4` (empirically validated against the Atlas Robotics fixture: 0 raw FPs over 62 notes). `FRONTMATTER_REF_ALLOWLIST` is a sealed 8-key `ReadonlySet<string>` (`assignee`, `owner`, `project`, `related`, `parent`, `child`, `attendees`, `superseded_by`). Mention candidate set built from `note_aliases` only; word-boundary uses `(?<![\w-])`/`(?![\w-])` so aliases containing `-`/`_` are matched as whole tokens. Paragraph-scope masking blanks fenced code, ATX headings, inline backticks, and `[[wikilink]]` spans (byte length preserved so line-offset lookups stay valid).
- **`AliasesQueries.listAll()` (Phase 4 plan 04-02)** — full alias inventory, sorted by `alias_norm ASC` for deterministic mention-regex compilation.
- **Additive `type: EdgeType` field on graph result rows (Phase 4 plan 04-01)** — `list_backlinks`, `list_forward_links`, `find_broken_links` results widen with `type`. `BacklinkEntry.relation` / `ForwardLinkEntry.relation` widen from the v2.0.0-pinned `"wikilink"` literal to the full `EdgeType` union. `assemble_dossier.linked_documents[].relation` and `get_document_bundle.{backlinks,forward_links}[].relation` widen the same way — the `PHASE-4-WIDEN` marker comments in `src/assembly/dossier.ts` + `src/assembly/bundle.ts` (a Phase 3 v2.0.0 limitation) are now retired.
- **3 new eval YAMLs (Phase 4 plan 04-06 / GRA-05):**
  - `evals/fixtures/v2-test-vault/_queries/expand.yaml` — 8 hand-curated queries over the Atlas Robotics live fixture covering all four edge types, mixed-type traversal at hops 1 and 2, `_memory/` opacity, and the unknown-seed warning path. All eight clear `min_precision >= 0.8` / `min_recall >= 0.8`.
  - `evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml` — 3 composition queries exercising `search_hybrid({expand: {hops}, ...})` end-to-end.
  - `evals/fixtures/v2-test-vault/_queries/cluster.yaml` — D-12 byte-snapshot of Louvain partition (cluster_id + sorted member DocIds per community); pins determinism across library upgrades + Node-minor versions.
- **Cross-adapter conformance for graph tools (Phase 4 plan 04-06)** — 6 new parameterized cases in `src/adapters/source/conformance.test.ts` run `expand()` + `cluster()` against both `obsidian-fs` and `stub` adapters via `src/graph/__test_helpers__/atlas-live-fixture.ts`. New harness fields (`graphSeedDocId`, `occludedMemoryDocId`, `reachableMemoryDocId`) carry adapter-specific reference DocIds.
- **Adapter seams (Phase 1, plans 01-01..06)** — `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` interfaces under `src/adapters/` per ADR-002. `obsidian-fs` is the v2 reference implementation for all three. The seam shape is preserved across vault-content read, vault-content write, and change-event paths so future connectors (Notion, Logseq, …) drop in without touching `src/server.ts` or any v1 tool. (ADP-01, ADP-02, ADP-03)
- **Canonical v2 types** in `src/types.ts`: `Document`, `BlockNode`, `Edge`, `ChangeEvent`, `SourceHandle`, `MemorySink`, branded `DocId`, `WikilinkRef`. `Document.properties: Record<string, unknown>` subsumes both YAML frontmatter and future Notion typed properties. (ADP-04, ADP-05)
- **`src/adapters/registry.ts`** — adapter registry + sole minting point for branded `DocId`s via `parseDocId` / `formatDocId`. Future adapters register under their canonical scheme (`obsidian-fs://`, `notion-api://`, …). (ADP-05)
- **Stub-adapter conformance suite** — parameterized over `obsidian-fs` and `stub`, three test files (`src/adapters/{source,delivery,change-feed}/conformance.test.ts`). Lets future adapters validate themselves against the v2 contract before any production code lands. (ADP-13)
- **`scripts/lint-adapters.sh`** — POSIX shell CI gate enforcing ADR-002 Invariants I-1..I-6 + C-1 (Claude-leak) + I-5b (`obsidian://` literal). Wired into `npm run lint:check` and `.github/workflows/ci.yml`. (ADP-12)
- **`scripts/smoketest-non-claude.mjs`** — end-to-end smoketest against the real MCP SDK Client (identifies as `non-claude-smoketest`); CI-gated. Asserts 23 tools listed, all descriptions non-empty, `tools/call list_vaults` succeeds, `tools/call <bogus>` surfaces as error. (ADP-10)
- **`docs/v2/AGENT_AGNOSTIC_AUDIT.md`** — per-leak inventory of every Claude / Obsidian assumption in `src/`, with explicit `fixed-v2` / `mixed` / `deferred-v3` status + rationale per row. Cross-references CONCERNS.md, ADR-002, and the resolving Phase-1 plans. (ADP-11)
- **`record_observation` MCP tool** — write a labeled memory observation through a configured `MemorySink` with mandatory provenance (Phase 2 plan 02-04 / MEM-02). Sugar args (`claim`, `evidence`, `confidence`, `type`, `sink?`) pre-fill the contract-required keys; optional `properties: Record<string, unknown>` escape hatch merges LAST so callers can populate any contract-allowed extra (D-02).
- **`recall` MCP tool** — retrieve memory documents filtered by `min_confidence`, `types`, `max_age_days`, and `sink`; returns Phase 3-shaped citation packets `{doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties}` (Phase 2 plan 02-05 / MEM-03 / D-01). Hides `status: superseded` by default; sorts `observed_at` DESC with `mtime` tiebreak; truncates AFTER filter+sort.
- **`supersede` MCP tool** — forward-only mark of a memory document as superseded by a replacement, with mandatory non-empty `superseded_reason` (Phase 2 plan 02-04 / MEM-04 / D-03). Single OCC `delivery.update()` call; the replacement document is never touched (back-edge derivation deferred to Phase 4 graph layer).
- **`vault-memory://memory/sinks` MCP Resource** — lists configured memory sinks per vault with their handle, contract name, and default-flag (Phase 2 plan 02-06 / MEM-09).
- **`vault-memory://memory/stats` MCP Resource** — per-sink doc counts, `by_type` / `by_status` breakdown, last-write timestamp aggregated from the indexed `notes` table + the `write_audit` partial index (Phase 2 plan 02-06 / MEM-09). Polled-only; no `notifyResourceUpdated` in v2.0.0.
- **`is_memory_sink_write` column on `write_audit`** (migration v9) + partial index on `(is_memory_sink_write, at DESC) WHERE is_memory_sink_write = 1` + optional `is_memory_sink_write` filter on the `audit_log` tool input schema (Phase 2 plan 02-06 / MEM-08).
- **`decomposeDocId` helper** on `src/adapters/registry.ts` for splitting `DocId`s into `{scheme, authority, resource}` parts. Re-uses `DOC_ID_PATTERN`; no second regex (Phase 2 plan 02-02).
- **`pathInSink` + `joinVaultPath` helpers** in `src/adapters/delivery/obsidian-fs/path.ts` — the SOLE licensed sink/vault `path.join` sites for Phase 2+ per ADR-002 I-3 (Phase 2 plan 02-02).
- **MemorySink runtime** — `parseMemorySinkHandle` (IIFE-closed brand mint), `MemorySinkRegistry` (sole resolver per ADR-004 §Resolution), `.memory-sink` sentinel mechanics in `src/adapters/delivery/obsidian-fs/sentinel.ts`, hardcoded `DEFAULT_MEMORY_V1` contract + YAML loader at `src/memory/contract/` (Phase 2 plan 02-02 / MEM-01, MEM-05, MEM-06).
- **5 net-new memory fixture docs** under `evals/fixtures/v2-test-vault/_memory/` including the A→B→C Spire-budget supersede chain (2026-04-23 → 2026-04-24 → 2026-04-26), plus net-new `type: hypothesis`, `type: decision`, and `confidence: uncertain` dimensions (Phase 2 plan 02-07 / MEM-10). Fixture grows from 15 → 20 docs.
- **`tests/fixtures/malformed-memory/`** tree with 5 deliberately-broken fixtures (`missing-observed-at`, `missing-source`, `invalid-confidence`, `supersede-no-target`, `source-agent-no-evidence`) for validator failure-mode unit tests; each carries `expected_reason` + `expected_key` frontmatter (Phase 2 plan 02-07 / MEM-10).
- **`docs/tools/audit_log.md`** documenting the new optional `is_memory_sink_write` filter on the `audit_log` tool. Documentation lives here rather than in the MCP tool description text — the description is byte-identical to Phase 1 to honor the v1 backwards-compat invariant (Phase 2 plan 02-06).
- **Section identity substrate (Phase 3 plan 03-01 / ASM-01, ASM-02, ASM-03, ASM-05, ASM-08)** — `sections` table (migration 010) materializing per-document outline trees with content-hash anchors per ADR-003 H-7 (`sha256_hex(NFC(heading_text) || "\n" || render_blocks_to_plain_text(blocks))`). Parent-pointer reconstruction; per-section `chunk_id_first` / `chunk_id_last` ranges; denormalized `notes.status` column with partial index (`notes_status`) for the SQL-level superseded filter. Backfill from existing v1 vaults runs in lockstep with the migration so user vaults gain sections + status on first upgrade without re-indexing.
- **`get_outline` MCP tool** — return a nested `OutlineNode[]` tree for a `doc_id`. Each node carries `{anchor, heading_path, heading_text, level, chunk_ids: string[], children}` per D-02. Anchors are stable across re-indexings of unchanged content. Doc-level response envelope is the 8-field citation packet shape (Phase 3 plan 03-02 / ASM-02, ASM-05).
- **`search_sections` MCP tool** — section-level retrieval that COMPOSES the v1 chunk-level hybrid pipeline (`hybridSearch`) with a chunk-to-section promotion step. Accepts `{query, limit, vaults?, recency_weight?, authority_weight?, half_life_days?, include_superseded?}`. The promotion strategy: inflate `topK = limit × 5`, run hybrid once, promote each chunk hit to its enclosing section, dedupe by `(note_id, anchor)`, score each section as `MAX(constituent chunk scores)`, sort DESC tie-broken by `chunk_id_first` ASC, slice to `limit`, hydrate into `SectionHit` packets carrying the 8-field citation floor plus `{anchor, score, chunk_ids, snippet?}`. Preamble (level-0) sections are dropped — only sections with a non-empty `heading_path` surface. (Phase 3 plan 03-03 / ASM-03, ASM-05)
- **`get_document_bundle` MCP tool** — one-call composite read for a `doc_id`: `{anchor, outline, backlinks, forward_links, recent_edits}`. The anchor is a full 8-field citation packet with optional ASM-06 extras (`status`, `superseded_by`); `outline` re-uses `buildOutlineTree` from `get_outline` (composition, not duplication); `backlinks` + `forward_links` carry citation packets plus `{property_snippet, relation}` (relation is `"wikilink"` in v2.0.0 — see Phase 4 widening note below); `recent_edits` ≤10 entries from `audit_log`, with `is_memory_sink_write` surfaced only when truthy. (Phase 3 plan 03-04 / ASM-01, ASM-05, ASM-06)
- **`search_hybrid` rescore signals (Phase 3 plan 03-05 / ASM-06, ASM-07, ASM-08, ASM-11) — additive Zod params**, all defaulting to v1-no-op so legacy callers see byte-identical responses:
  - `recency_weight: number` (default `0`) — adds `recency_weight × exp(-age_days / half_life_days)` to each candidate's RRF score.
  - `authority_weight: number` (default `0`) — adds `authority_weight × 1` for docs with `properties.authoritative === true`.
  - `half_life_days: number` (default `30`) — recency decay half-life.
  - `include_superseded: boolean` (default `false`) — when `false`, excludes `status: "superseded"` chunks at SQL level via the `notes_status` partial index. Zero per-candidate frontmatter parses on the default-hide path.
  - **9 new optional `SearchHit` fields** (D-08, ASM-06): `doc_id`, `source_handle`, `heading_path`, `mtime`, `hash`, `display_url`, `status`, `superseded_by`, `properties` — all snake_case to align with the Phase 2 `CitationPacket` shape; all optional and JSON-omitted on the v1-default path.
  - **Display-URL resolver seam** — `HybridSearchOptions.displayUrlFor` optional closure keeps the `obsidian://` literal mint site in the obsidian-fs source adapter per ADR-002 §I-5b.
  - **Clock-injection seam** — `HybridSearchOptions.clock` optional closure mirrors the recall convention; tests pass a fixed clock for deterministic age math.
- **`assemble_dossier` MCP tool** — resolve a `{type, key}` pair to an anchor `Document` and walk backlinks into a structured dossier `{anchor, linked_documents, property_rollups: {linked_count, linked_types, status_distribution}, error}` (Phase 3 plan 03-06 / ASM-04, ASM-05, ASM-10). Strict `properties.type` match (D-03); `key` matches the candidate's `title` OR any entry in `properties.aliases` (D-04). Every linked document carries an 8-field citation packet (D-01) plus the `relation` field. **v2.0.0 limitation:** `linked_documents[].relation` is always `"wikilink"` because the v1 `wikilinks` table only stores wikilink edges; Phase 4 (GRA-04 typed edges) will widen the field to the full `Edge.type` enum (mention, frontmatter-ref, hyperlink, …) as an additive change. Search for `PHASE-4-WIDEN` markers in `src/assembly/dossier.ts` for the widening sites.
- **Source-neutrality conformance suite for assembly tools (Phase 3 plan 03-07 / ASM-12)** — `src/adapters/source/conformance.test.ts` extends its `describe.each` parameterization with a new "Assembly tools — $name" section over `[obsidian-fs, stub-assembly]`. Five canonical assertions per adapter row (10 total) cover `get_outline`, `assemble_dossier`, `search_sections`, `get_document_bundle`, and citation-packet shape parity with recall's output. Backed by `src/adapters/stub/assembly-fixture.ts` — an 8-document purpose-built `Document[]` covering aliases, authoritative, superseded, all four edge types, and a multi-section doc. Per RESEARCH §7 P/R evals (ASM-10 dossier, ASM-11 recency) run against the obsidian-fs adapter only; the stub fixture is purpose-built for contract conformance.
- **Recency eval fixture** — `evals/fixtures/v2-test-vault/_queries/recency.yaml` ships ASM-11's stale-vs-fresh scenario: two near-duplicate Atlas-1 status notes (`status_updates/atlas-1-old-update.md` mtime ≈6 months back, `status_updates/atlas-1-new-update.md` mtime ≈1 day back) with neutral + recency-weighted query pair. Mtime contract is documented inline; eval harness `fs.utimesSync`-injects mtimes in a `beforeAll` block (git does not preserve mtimes on checkout).
- **Compiled brief layer (Phase 5, ADR-005)** — briefs are first-class `Document`s in `_memory/_briefs/` with chunk-level `source_hashes` provenance; compile-time wikilink emission (D-11), auto-supersede on target collision (D-12), and forward-only supersede chain. Writes route through `DeliveryAdapter` so the MEM-05 memory-namespace invariant is un-bypassable by construction. Closes the "agents rediscover 85% of context every run" failure mode that motivated the v2 program. See `docs/v2/PHASE-5-SIGN-OFF.md` + `docs/v2/adr/005-brief-compile-strategy.md`.
- **2 new MCP tools (Phase 5)** — `compile_brief`, `get_brief`. Tool count: 32 → 34 (additive only; the 32 Phase 4 entries verified byte-identical per-name in `evals/v1-baseline/tools-list.snapshot.json`; strict-equality snapshot test re-enabled in `baseline.test.ts`).
- **`vault-memory://briefs` MCP Resource (Phase 5 / BRF-09)** — pure-read discovery surface with optional `?target=<pattern>` substring filter. NOT a Tool; Resources do not count toward the REL-08 tool budget. `readListBriefs` is a closure over `MemorySinkRegistry` + `VaultManager` + `SourceConnector` and carries zero `fs` / `path` / `gray-matter` / `chokidar` imports (enforced by `scripts/lint-adapters.sh` + an explicit assertion in `src/brief/resources.test.ts` Test 10).
- **Brief staleness daemon (Phase 5 / BRF-05..08)** — `BriefStalenessDaemon` subscribes to `ChangeFeed.subscribe()`, runs a startup full scan against `brief_sources.listBriefDocIds()` (BRF-07; cursor in `daemon_state`), and preserves brief→source links across rename events via a 5-second pending-deletes grace window (BRF-08). Single-owner via `~/.vault-memory/locks/<vault>.lock` (`fs.open('wx')` + PID liveness); on lock contention emits `daemon_already_owned` and returns `{acquired: false}` without subscribing.
- **`default-brief-v1` MemoryContract (Phase 5)** — the provenance frame required by every brief `Document`. Required properties: `source: "agent"`, `confidence: "inferred"`, `evidence: parsedSourceDocIds`, `status: "active"`, `observed_at`, `superseded_by`, `type: "brief"`, `target`, `purpose`, `compiled_from`, `compiled_at`, chunk-level `source_hashes` map, and `model` audit attribution. The `_memory/_briefs/` sink binds to this contract at registration time.
- **ChunkId brand + content-stable fragment helpers (Phase 5)** — `parseChunkId`, `formatChunkId`, `decomposeChunkId`, `computeChunkHash`, `computeChunkIdFragment` in `src/chunker/chunk-id.ts`. D-04 content-derived 7-char fragments are essential for the v3 multi-user story (every user recomputes identical fragments over the same source text).
- **`OllamaClient.chat()` (Phase 5)** — `/api/chat` route alongside `/api/embed`; the first non-embedding LLM call in vault-memory history. Governed by ADR-005. No remote LLM SDK is bundled; the D-10 ladder probes MCP Sampling first (`getClientCapabilities().sampling`), then local Ollama via `[brief.ollama]` config, then falls back to `args.prepared_text` for deterministic CI / non-LLM contracts.
- **3 new eval YAMLs (Phase 5 / BRF-10, BRF-11):**
  - `evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml` — curated 20-document Atlas Robotics scenario; modifying one source flips the brief stale within one change-feed cycle.
  - `evals/fixtures/v2-test-vault/_queries/briefs-staleness-stub.yaml` — BRF-11 cross-adapter parametric run (`adapters: [obsidian-fs, stub]`) proving brief-layer source-neutrality.
  - `evals/fixtures/v2-test-vault/_queries/briefs-from-cluster.yaml` — cluster-fed compile scenario.
- **Cross-adapter conformance for brief tools (Phase 5)** — `src/adapters/source/conformance.test.ts` gains a `compile_brief + staleness daemon (BRF-11 source-neutrality)` describe block: 4 conformance test cases × 2 SourceConnector adapters = 8 test runs. Covers update flips stale, startup scan recovers missed events, delete past grace-window marks stale, and rename within grace-window preserves brief→source link.
- **Obsidian plugin (Phase 7, ADR-007)** — `plugin/` Obsidian community-plugin package (`manifest.json` v2.0.0, id=`vault-memory`, minAppVersion 1.5.0) with sideload-capable layout. `npm run build` emits a 1.9 MB `plugin/main.js`. Ships behind `[plugin] enabled = false` server-side; v1 baseline `tools/list` snapshot remains byte-identical when the flag is unset (FND-10 still passes). See `docs/v2/plugin/README.md` + `docs/v2/adr/007-contract-editor.md`.
- **Variant C three-pane contract editor (Phase 7 / CAN-01..CAN-07, CAN-10)** — palette + Svelte Flow canvas + Zod-derived inspector for editing Phase 6 task contracts. Canvas wires to `@xyflow/svelte` (MIT, license verified in ADR-007 — rescoped from the original jsoncanvas fork). `registerView('vault-memory-contract-editor')` + `registerExtensions(['contract'])` so opening a `.contract` file launches the editor.
- **`.contract` JSON envelope + lossless round-trip codec (Phase 7 / CAN-02, CAN-03, CAN-07)** — custom JSON format (`vmFormatVersion: 1`) with a pure-TS round-trip codec (`plugin/src/codec/contract-codec.ts`). Round-trip fixed-point pinned to 3rd/4th-emission byte identity across 4 fixtures (19/19 round-trip tests passing). Covers every ADR-006 field: `version`, `name`, `description`, `inputs`, `sources`, `sinks`, `assembly`, `output_shape`, `write_back`, `required`, `mcp_clients`.
- **3 reference `.contract` files (Phase 7 / CAN-06)** — `examples/contracts/meeting-prep.contract`, `project-status.contract`, `code-review-brief.contract`, each pinned to its Phase 6 YAML twin via 3 fixture round-trip tests.
- **6 new plugin-control MCP tools (Phase 7) — gated by `[plugin] enabled = true`, default OFF.** `set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats`, `trigger_reindex`, `suppress_contract_write`. Default-OFF tool count: unchanged from Phase 6 (37); when the plugin flag is enabled the surface grows to 43. The v1-baseline tools-list snapshot remains byte-identical against the default-OFF surface — verified by `evals/v1-baseline/baseline.test.ts` "matches the pinned snapshot exactly" + "preserves the 23 v1 baseline tool names byte-identical".
- **Electron safeStorage-backed secrets (Phase 7 / PLG-02)** — `plugin/src/services/safe-storage.ts` wraps `window.electron.safeStorage` (`encryptString`/`decryptString`); only ciphertext lands in `data.json`. Secrets referenced by name from `[contracts.mcp_clients]` config via `${secret:name}` placeholders (regex `\$\{secret:([a-z][a-z0-9_-]{2,63})\}`). Connector-resolver test suite has 11 passing tests pinning the placeholder grammar + resolution path.
- **Plugin chrome — settings, reindex, stats, connectors panels (Phase 7 / PLG-01, PLG-03, PLG-04, PLG-05)** — `plugin/src/chrome/settings-tab.ts` (Ollama URL, model, indexer config; persisted via `loadData`/`saveData`; hot-swap via `set_runtime_config`), `reindex-panel.svelte` + controller (manual trigger with MCP `notifications/progress` feedback; SuppressionSet-aware), `stats-panel.svelte` + controller (read-only stats via `get_runtime_stats`), and `connectors-panel.svelte` (list/add/remove peer MCP clients, secrets-by-name). 42 chrome unit tests passing (7+8+7+12+8).
- **Hash-aware `SuppressionSet.consume(path, hash)` extension (Phase 7 / CAN-08)** — the Phase 1 `SuppressionSet` widens to accept a content hash so the contracts loader can short-circuit re-validation when the watcher fires on the plugin's own write. `src/contracts/loader.ts:242` calls `consume(resource, hash)` before reloading; `src/plugin-tools/suppress-contract-write.ts:109` registers the `(path, hash)` pair from the plugin BEFORE the write. Three dedicated loader tests cover the suppression path; regression watcher tests still pass (10/10 ObsidianFsChangeFeed + 6/6 VaultWatcher).
- **`vm-install` + `vm-update` Claude Code skills (Phase 7 / CAN-09 distribution half)** — one-liner curl-pipe install / upgrade for the plugin, with SHA-256 verification of the downloaded tarball. Idempotent. `bash skills/vm-install/setup.test.sh` 9/9 pass (fresh install + idempotent no-op); `bash skills/vm-update/update.test.sh` 12/12 pass (no-op + upgrade w/ SHA-256 + re-run). `RELEASE_URL_PLACEHOLDER` resolution is bookkept for the v2.0.0 GitHub Release publish (ROADMAP Phase 8 carryover).
- **6 plugin docs under `docs/v2/plugin/` (Phase 7 / CAN-09 docs half)** — `README.md`, `INSTALL.md`, `SETTINGS.md`, `SECRETS.md`, `CONTRACT-EDITOR.md`, `CONNECTORS.md`. README plugin section at the top of the repo README explains how to enable the flag and what the editor + chrome do.

### Changed

- **Tool surface count: 30 → 32** (Phase 4, additive only). Two new graph tools added: `expand`, `cluster`. `evals/v1-baseline/tools-list.snapshot.json` regenerated; the 23 v1 entries + 7 Phase 3 entries remain content-identical (verified per-name; the strict-equality snapshot test `baseline.test.ts` "matches the pinned snapshot exactly" — which Plan 04-03 had `.skip`'d pending this regen — is re-enabled and green). The diff against the Phase 3 snapshot is purely additive: two new tool entries appended (before `assemble_dossier` to preserve insertion order at the end of `TOOLS`); one optional nested property added to `search_hybrid.inputSchema.properties` (`expand: {hops, direction?, edge_types?}`); `search_hybrid.description` widened additively to mention the new option.
- **`search_hybrid` accepts an additive nested `expand?: {hops: 1|2, direction?, edge_types?}` parameter (Phase 4 plan 04-04 / GRA-03).** Defaults to v1-no-op when omitted; legacy callers see byte-identical responses. When supplied, each `SearchHit` gains an `expansions?: CitationPacketWithVia[]` field carrying the per-hit typed-edge neighborhood; ranking is unchanged. Per-vault BFS isolation is enforced inside `expand()` (T-04-04-02 mitigation). Failures inside `expand()` are silently swallowed — same posture as the reranker fallback — so a corrupted graph traversal cannot break search.
- **Graph result rows widen from `relation: "wikilink"` to `relation: EdgeType` (Phase 4 plan 04-01).** `assemble_dossier.linked_documents[].relation`, `get_document_bundle.{backlinks,forward_links}[].relation`, and the v1 `BacklinkEntry`/`ForwardLinkEntry` `relation` fields now emit the actual edge type the indexer recorded. The Phase 3 known-limitation pinning these to `"wikilink"` is closed; the `PHASE-4-WIDEN` markers in `src/assembly/dossier.ts` + `src/assembly/bundle.ts` have been retired. This is strictly an additive widening — old callers that only checked for `"wikilink"` still receive that value when the underlying edge is a wikilink.
- **Indexer dual-writes to `wikilinks` + `edges` tables (Phase 4 plans 04-01, 04-02).** Both indexer write paths (`src/indexer/single.ts` body-hash fast path + full re-embed branch; `src/indexer/indexer.ts` full index path) call `writeAllEdges` after parsing each note, threading the `WikilinkResolver` for cross-note target resolution. The v1 `wikilinks` table is preserved for D-01 v1 invariance; v3 cleanup will drop it once no v1 tool reads from it.
- **`@modelcontextprotocol/sdk` bumped to `^1.29.0`**; tool registration migrated from the v1 low-level `Server` + `setRequestHandler` pattern to `McpServer` + `server.registerTool()` × 23. Raw JSON Schema literals flow directly from `src/tool-registry.ts` (workaround for SDK#1143 / Zod-4 description-drop, although the issue is empirically MOOT in SDK 1.29). (ADP-08)
- **`zod` bumped to `^4.4.3`**. Refinements and `errorMap` swept per the Zod 4 migration guide; Standard Schema wiring intact. (ADP-09)
- **Default `client_id` for write / update / delete** is now captured from MCP `InitializeRequest.params.clientInfo.name` via a lazy closure (`getClientId()` in `src/server.ts`), falling back to `"unknown"`. Removes the v1 hardcoded `"claude-code"` default that misidentified every non-Claude write in the audit log. (D-02)
- **`obsidian://` display-URL minting** moved from `src/server.ts:obsidianUrl()` (deleted) into `SourceConnector.formatDisplayUrl(id)` on the adapter. The `obsidian://open?vault=…&file=…` URL is now adapter-published; future adapters mint their own scheme. (D-01)
- **README rewritten** to lead with "any MCP-aware agent" framing in the first 20 lines. Equal billing for Claude Code / Claude Desktop / ChatGPT Custom Connectors / MCP Inspector / generic clients. Obsidian framed as the v2 source connector, not the sole consumer. (ADP-14)
- **`src/cli.ts` user-facing strings** swept for Claude-leak — `"Open ${path} in Claude Code"` → `"Open ${path} in your MCP-aware client"`. (D-02 follow-through)
- **`WriteConflict.reason` discriminated union extended** (additively, backwards-compatible) with 7 new codes: `missing_provenance`, `invalid_provenance`, `supersede_mismatch`, `agent_write_outside_sink`, `non_agent_write_inside_sink`, `sentinel_missing`, `sink_write_blocked`. Optional envelope fields added: `sinkName`, `key`, `observedValue`, `suggestion`. The 3 Phase 1 reason codes (`hash_mismatch`, `permission_denied`, `not_found`) are unchanged (Phase 2 plan 02-03 / MEM-05, MEM-07, MEM-11).
- **v1 `write_note`, `update_frontmatter`, `delete_note` now refuse memory-sink-resolved targets** at the tool entry-point with `sink_write_blocked` + actionable `suggestion` text (`record_observation` for writes/updates, `supersede` for deletes). Defense-in-depth on top of the centralized `DeliveryAdapter.write()` chokepoint (Phase 2 plan 02-03b / MEM-07). When the `MemorySinkRegistry` is not wired (Phase 1 fixture-test path), v1 tool behavior is byte-identical to Phase 1.
- **`audit_log` tool gains optional `is_memory_sink_write` input filter** and adds `is_memory_sink_write: boolean` to each returned row. The MCP `description` text is byte-identical to Phase 1 — the new capability is documented in CHANGELOG and `docs/tools/audit_log.md` only (Phase 2 plan 02-06 / MEM-08).
- **Server bootstrap order** is now `loadConfig → manager.openAll → registerMemorySinks (writes sentinels) → server.connect → startCatchupAndWatchers (fire-and-forget)`. Sentinels are provisioned BEFORE the catch-up indexer walks the fixture, so the registry's `findSinkContaining` enclosure check is hot for the first incoming write (Phase 2 plan 02-03b). A new exported `BootstrapPhase` type + optional `onPhase` callback on `serve(options?)` make the bootstrap order observable for testing.
- **Assembly DocId minting derives scheme from `SourceConnector.handle`** (Phase 3 plan 03-07 fix). Pre-03-07 both `assembleDossier` and `getDocumentBundle` hardcoded `formatDocId("obsidian-fs", …)` when constructing linked-document / anchor DocIds. The 03-07 ASM-12 conformance suite (parameterized over obsidian-fs + stub adapters) surfaced this as a hard test failure on the stub-assembly row. The fix introduces `schemeFromSource(SourceConnector): string` and derives the scheme dynamically; `dossier.ts`'s sort-key helper is renamed `noteDocIdString → noteSortKey` and pinned to a fixed `vault://` prefix so sort order stays adapter-identical. No user-visible change for obsidian-fs callers (their scheme has always been `obsidian-fs://`); the fix unblocks future non-Obsidian sources.
- **Tool surface count: 26 → 30** (additive only). Four Phase 3 assembly tools added: `get_outline`, `search_sections`, `get_document_bundle`, `assemble_dossier`. `evals/v1-baseline/tools-list.snapshot.json` regenerated; the 23 v1 entries at slots 0–22 remain byte-identical (pinned by the existing `baseline.test.ts` "preserves the 23 v1 baseline tool names byte-identical" assertion). The diff against the Phase 2 snapshot is purely additive: four new tool entries appended; one optional field added to `search_hybrid.inputSchema.properties` (the four rescore params).
- **Tool surface count: 32 → 34** (Phase 5, additive only). Two new brief tools added: `compile_brief`, `get_brief`. The `list_briefs` discovery surface lives on MCP Resources (`vault-memory://briefs`) and does NOT count toward the tool budget — same precedent as the Phase 2 `vault-memory://memory/*` Resources. The 32 Phase 4 entries in `evals/v1-baseline/tools-list.snapshot.json` are byte-identical (verified per-name); the diff is purely additive — two new tool entries appended.
- **Server bootstrap order extended (Phase 5)** — after `registerMemorySinks` and before `server.connect`, the bootstrap now (a) registers the `_memory/_briefs/` sink bound to the `default-brief-v1` contract and (b) starts `BriefStalenessDaemon` per vault. Daemon `start()` is fire-and-forget: a lock-contention failure does NOT block server startup — the server proceeds and `compile_brief` continues to work; only the staleness re-check is offline.
- **`SuppressionSet.consume()` accepts an optional `hash` argument (Phase 7 / CAN-08, additive).** Phase 1 callers that pass only a path see byte-identical behavior. When the plugin write path passes `(path, hash)`, the contracts loader at `src/contracts/loader.ts:242` matches both axes before short-circuiting — so a benign re-emit of the same canonical bytes is suppressed, but a divergent write still triggers reload.
- **Default-OFF plugin tool gating (Phase 7).** The 6 new plugin tools are wired through a config-time guard in `src/server.ts` so `tools/list` does NOT include them unless `[plugin] enabled = true`. The default-OFF surface keeps the v1 baseline snapshot byte-identical and keeps the REL-08 budget conversation focused on the user-facing v2 tools.

### Dependencies

- **Phase 4 (plan 04-05 / GRA-02)** — pure-JS ESM, all MIT, all manually provenance-verified per Phase 4 RESEARCH §Package Legitimacy Audit:
  - `graphology ^0.26.0` — graph data structure for the Louvain cluster wrapper.
  - `graphology-communities-louvain ^2.0.2` — Louvain modularity-maximizing community detection.
  - `seedrandom ^3.0.5` — deterministic seeded PRNG for the Louvain `rng` option.
  - `@types/seedrandom ^3.0.8` (dev) — TypeScript types.
  - No native bindings; no tsup `external` additions needed. ESM bundle grew from 376 KB to 392 KB (+13 KB).
- **Phase 7 plugin (ADR-007)** — added under `plugin/package.json` only; the server bundle is unaffected:
  - `@xyflow/svelte` — Svelte Flow canvas renderer for the Variant C editor (MIT, license verified in ADR-007).
  - `svelte`, `esbuild`, `vitest` — plugin-only build/test toolchain. None ship into the server `dist/`.

### Migration

- **MIGRATION_011 — `edges` table + chunked backfill from `wikilinks` (Phase 4 plan 04-01).** Function-style migration mirroring `runMigration008`. Creates the `edges` table with `CHECK(type IN ('wikilink', 'mention', 'frontmatter-ref', 'hyperlink'))` and a UNIQUE INDEX on `(source_note_id, target_note_id, type, anchor, line_number)` using `COALESCE(anchor, '')` + `COALESCE(line_number, 0)` for proper NULL-as-distinct dedup. Backfills wikilink rows from the v1 `wikilinks` table in 10k-row chunks via `INSERT OR IGNORE` — idempotent, re-runnable, safe to interrupt. v1-shaped DBs migrate cleanly on first server start after upgrade; the v1 `wikilinks` table is preserved alongside the new `edges` table for D-01 v1 invariance. v3 cleanup will drop `wikilinks` once no v1 tool consumes it.
- **`notes.doc_uri` dual-column staging (Strategy A — additive, plan 01-02):**
  - **MIGRATION_007** (additive) — adds nullable `doc_uri TEXT` column to `notes` + `idx_notes_doc_uri` index. Backwards-compatible; existing rows have `doc_uri IS NULL` post-migration.
  - **MIGRATION_008** (function-style backfill) — sets `doc_uri = 'obsidian-fs://<vault>/' || path` for every row where `doc_uri IS NULL`. Idempotent; safe to re-run.
  - Path stored **un-encoded** in the column; percent-encoding happens only at `formatDisplayUrl()` time (per ADR-002 §URL semantics).
  - **No user action required.** Migrations run automatically on first server start after upgrade. SQLite transaction rollback is the safety net; no pre-migration backup is performed in v2 (deferred to Phase 8 per CONCERNS §"No Pre-Migration DB Backup"). (ADP-07)
- **v1 tool surface preserved byte-for-byte.** All 23 tool names, input schemas, output envelopes, and descriptions are unchanged. `evals/v1-baseline/tools-list.snapshot.json` regenerated under SDK 1.29 with zero diff against the Phase-0 baseline (W6 human-verify checkpoint passed in plan 01-06 Task 06).
- **MIGRATION_010 — sections table + notes.status column + section backfill (Phase 3 plan 03-01).** Three ordered steps in one transaction: (a) `CREATE TABLE sections` with 3 indexes, (b) `notes.status` column added + partial index `notes_status WHERE status IS NOT NULL`, (c) backfill `notes.status` from `json_extract(frontmatter, '$.status')` AND derive section rows for every indexed note via `markdownToSectionBlocks → extractSections`. Idempotent; re-applying is a no-op. Anchor-equivalence guarantee: backfilled section anchors match a fresh re-index byte-for-byte (the indexer + backfill share `src/chunker/headings.ts:extractHeadings` as the canonical heading source). v1-shaped DBs migrate cleanly without re-indexing.
- **`write_audit` migration v9** (function-style, idempotent) adds `is_memory_sink_write INTEGER NOT NULL DEFAULT 0` + a partial index `idx_write_audit_memory_sink ON (is_memory_sink_write, at DESC) WHERE is_memory_sink_write = 1` (Phase 2 plan 02-06 / MEM-08). All Phase 1 audit rows backfill to `false`; new audit rows derive the flag from `WriteOptions.sink !== undefined` at the `ObsidianFsDelivery.write/update/delete` facade. The function-style migration runs `PRAGMA table_info` first so fixture tests that rewind `user_version` continue to pass.
- **v1 tool surface grows from 23 → 26** with the three Phase 2 memory tools (`record_observation`, `recall`, `supersede`). The 23 v1 entries in `evals/v1-baseline/tools-list.snapshot.json` are byte-identical (pinned by a new `baseline.test.ts` assertion). The only diff on v1 tools is one optional input field added to `audit_log.inputSchema` (`is_memory_sink_write`); the v1 description text is byte-identical.
- **MIGRATION_013 — `chunks.chunk_id_fragment` + `brief_sources` + `daemon_state` (Phase 5 plan 05-01).** Three additive steps in one transaction: (a) `chunks.chunk_id_fragment` TEXT column added (`noUncheckedIndexedAccess` consumers see the new column as `T | undefined` until populated by the next index run); (b) `brief_sources` table (D-06 reverse-index — `(brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash)`); (c) `daemon_state` table (per-vault change-feed cursor + `last_full_scan` timestamp). Idempotent; re-applying is a no-op. v1-shaped DBs migrate cleanly on first server start after upgrade.
- **Phase 5 brief artifacts are NOT a server schema migration.** Brief `Document`s land in `_memory/_briefs/` via the standard `DeliveryAdapter.write()` path; the `default-brief-v1` MemoryContract is registered at bootstrap (not persisted in SQLite). Users who never call `compile_brief` see zero new files on disk.
- **Phase 7 plugin is NOT a server schema migration.** No new SQLite migrations land for Phase 7. The plugin stores its own state in `data.json` (loadData/saveData) inside the Obsidian vault's plugin directory; secrets land as Electron safeStorage ciphertext only. Users who never enable the plugin flag see zero new server-side files.

### Documentation

- Relocate ADRs 001–004 from `docs/dev/` (gitignored) to public `docs/v2/adr/`; amend each with Invariants + Examples sections covering both `obsidian-fs://` and `notion-api://` worked examples (FND-01, FND-04).
- ADR-003 amended with explicit hash-semantics pseudocode (RFC 8785 JCS, NFC normalisation, LF line endings, IEEE-754 number canonicalization) + chunk-level `source_hashes` schema (FND-02).
- ADR-004 amended: folder-default `MemorySink` is the only code path; separate-vault is config-only via `[memory] sink = "@…"` (FND-03). `.memory-sink` sentinel mandated.
- ADR-004 amended: underscored PropertyBag keys, confidence enum aligned to [direct, inferred, uncertain], superseded_reason field added (Phase 2 plan 02-01).
- Publish `docs/v2/ARCHITECTURE.md` (L0–L4 layer model + responsibility map), `docs/v2/MEMORY_CONTRACT.md` (provenance property contract on `Document.properties`), `docs/v2/AGENT_AGNOSTIC.md` (MCP-canonical client stance) (FND-05/06/07).
- Eval fixture vault `evals/fixtures/v2-test-vault/` — "Atlas Robotics" narrative; 56 notes across `projects/`, `meetings/`, `people/`, `decisions/`, `references/`; 15-document `_memory/` subset; 7 hand-labeled `_queries/*.yaml` (FND-08).
- v1-baseline regression suite `evals/v1-baseline/` — `tools-list.snapshot.json` pin for `tools/list` (23 tools), 11 per-tool semantic-floor YAMLs, `baseline.test.ts` vitest runner with `.todo` placeholders for Phase 1 precision/recall (FND-09/10).
- CI gates `scripts/check-fixture-privacy.sh` + `scripts/lint-no-telemetry.sh` + `.github/workflows/ci.yml` running `npm run lint:check && npm test` on every PR and push to `main` (FND-11/12 + D-21).
- ADR index `docs/v2/adr/README.md` listing 4 Accepted ADRs + 14 Open ADR stubs for v3 / Phase 10 follow-ups, including a Deferred-v3 section for adversarial-review findings (FND-13).
- Adversarial review `docs/v2/adr/ADVERSARIAL-REVIEW.md` — 10 findings against ADRs 001–004 raised by a fresh-context advisor; 6 Amended in Phase 0 (ADR-001 I-6, ADR-002 `DocumentRef.hash` contract + `hashProtected` enum, ADR-003 H-6), 4 Deferred-v3 to Phase 10 / Notion connector (FND-04 + FND-14 sign-off).
- Sign-off artifact `docs/v2/SIGN-OFF.md` — FND-01..14 checklist with resolving commit SHAs; PR approval is the FND-14 audit trail per D-17.
- Internal: extract `TOOLS` constant from `src/server.ts` to `src/tool-registry.ts` so `evals/v1-baseline/dump-tools.mjs` can produce the pinned snapshot without spinning the full MCP server (Phase 0 Assumption A5, no external behavior change).
- Phase 5 sign-off artifact `docs/v2/PHASE-5-SIGN-OFF.md` — BRF-01..BRF-11 traceability table + the five Phase 5 ROADMAP success criteria with disposition (`✅ MET` per criterion) + REL-08 hand-off plan to Phase 8.
- ADR-005 `docs/v2/adr/005-brief-compile-strategy.md` (Accepted) — governs the D-10 LLM strategy ladder and forbids bundling any remote LLM SDK in the server.
- Phase 7 plugin docs under `docs/v2/plugin/`: `README.md`, `INSTALL.md`, `SETTINGS.md`, `SECRETS.md`, `CONTRACT-EDITOR.md`, `CONNECTORS.md`. README plugin section added to the repo root README explaining how to flip `[plugin] enabled = true` and what the editor + chrome surfaces do.
- ADR-007 `docs/v2/adr/007-contract-editor.md` (Accepted, 2026-05-19) — rescopes the visual editor from a jsoncanvas fork to `@xyflow/svelte` (MIT, license verified inline in the ADR).

### Deprecated (Phase 8 / REL-08)

The following five v1 tools are deprecated in v2.0.0 and promoted to MCP Resources. Each tool remains callable through the v2.x line for backwards compatibility; removal is scheduled for v3.0.0. The Resource URI is the canonical replacement.

- **`list_vaults`** → `vault-memory://vaults` (cross-vault discovery Resource). The tool remains callable through v2.x; removal scheduled for v3.0.0.
- **`list_models`** → `vault-memory://models/{vault}` (per-vault embedding-model inventory). The tool remains callable through v2.x; removal scheduled for v3.0.0.
- **`recent_notes`** → `vault-memory://recent/{vault}` (per-vault mtime-DESC recent notes). The tool remains callable through v2.x; removal scheduled for v3.0.0.
- **`vault_stats`** → `vault-memory://stats/{vault}` (per-vault note count + top tags + top frontmatter keys + last index run). The tool remains callable through v2.x; removal scheduled for v3.0.0.
- **`list_backlinks`** → `vault-memory://backlinks/{vault}/{+docId}` (per-document backlink listing). The URI uses RFC 6570 reserved expansion: `{+docId}` allows `/` in the variable value so multi-segment `docId`s like `obsidian-fs://my-vault/notes/sub/file.md` parse correctly. The tool remains callable through v2.x; removal scheduled for v3.0.0.

## [1.0.0] — 2026-05-12

### Stability declaration

The 0.x line is complete. All five items of the OB1 adoption plan shipped:

- v0.9.0 — Agent compatibility (`search`/`fetch`) + self-orientation (`vault_stats`/`recent_notes`)
- v0.9.1 — Body-hash short-circuit (migration 006)
- v0.9.2 — Vault-hygiene skill pack (`audit-vault-health`, `find-stale-notes`, `triage-inbox`)
- v0.10.0 — Schema inference (`suggest_frontmatter`, three-layer combiner)

From v1.0.0 onward this project follows strict SemVer:
- **MAJOR** bumps only for backwards-incompatible MCP-tool or CLI changes.
- **MINOR** bumps for new tools, new skills, additive schema fields.
- **PATCH** for bug fixes, internal refactors, doc-only updates.

### What's stable

- **23 MCP tools** with their documented input/output shapes (see README).
  - Adding new fields to existing responses is non-breaking.
  - Renaming a field or removing one requires a MAJOR bump.
- **CLI**: `vault-memory serve`, `add-vault`, `index`, `init` (no flag removals
  without MAJOR).
- **SQLite schema**: migrations are forward-only and idempotent. Existing
  `user_version` ≤ 6 DBs migrate cleanly.
- **`~/.vault-memory/config.toml` keys** — additive only.
- **5 Claude Code skills** in `skills/` — adding workflow steps is non-breaking;
  renaming a skill is.

### What's NOT under stability

Internal modules without an exported MCP-tool surface (`src/chunker/`,
`src/rerank/`, `src/indexer/single.ts`, `src/schema/combiner.ts` internals)
can refactor at any time. Only the public MCP-tool inputs/outputs and the CLI
flags carry the v1 stability contract.

### No code changes from 0.10.0

This release is a pure version bump + CHANGELOG marker. No new tools, no
behavioural changes. The dist artefact (`dist/cli.js`) regenerates from
the unchanged source.

## [0.10.0] — 2026-05-12

### Added
- **`suggest_frontmatter` MCP tool** — composes three independent inference layers into
  a structured `{existing, suggestions, conflicts}` response with calibrated
  confidence-per-source. Closes the final item of the OB1 adoption plan.
  - **folder-conventions learner** (`src/schema/folder-conventions.ts`): per-key
    prevalence across sibling notes (same path prefix). Falls back to parent folders
    when sibling count is below 3. Dominant-value extraction when >50% agree on a value.
  - **neighbor-inference learner** (`src/schema/neighbor-inference.ts`): frontmatter
    aggregate across wikilink-linked neighbors (forward + backward, deduped).
    Confidence × 0.6 damping factor — indirect signal.
  - **content-heuristics learner** (`src/schema/content-heuristics.ts`): vault-agnostic
    title/body regex matchers — Email, Meeting, Person, Clipping, Fact, date-prefix.
    Fixed confidence per rule.
  - **Combiner** (`src/schema/combiner.ts`): max-across-sources fusion, conflict
    detection both within suggestions and against existing frontmatter. Below-threshold
    candidates dropped. Stable sort order.
- 44 new unit tests across 4 files. 368/368 total (+44).

### Changed
- README: `MCP tools (23)` count bumped; new "Schema inference" section explains the
  three-layer architecture.

## [0.9.2] — 2026-05-12

### Added
- **Vault-hygiene skill pack** — three new Claude Code skills that compose existing MCP
  tools into guided maintenance workflows:
  - `audit-vault-health` — read-only overview: stats, broken wikilinks, tag drift
    (case/separator variants), frontmatter schema drift, indexing freshness.
  - `find-stale-notes` — discovers notes >6 mo old with 0 backlinks, walks through each
    with per-note actions (Archive / Update / Delete / Skip / Keep). Hash-protected
    deletes; never bulk-acts.
  - `triage-inbox` — walks through recent inbox-stage notes (sparse frontmatter, few
    tags, recent mtime). Suggests target folder, tags, frontmatter, related wikilinks
    based on semantic search. User accepts / edits / skips per note.

### Notes
- Pure-Markdown release — **no code changes** in the server. Distributed via the
  existing `install-skills.sh` one-liner.

## [0.9.1] — 2026-05-11

### Added
- **Body-hash short-circuit** (migration 006) — frontmatter-only edits no longer
  trigger chunk + embedding regeneration. Significantly reduces re-index cost for
  tag/metadata-only updates.

## [0.9.0] — 2026-05-10

### Added
- **Agent-Compatibility adapters** — OB1-compatible flat-shape `search` and `fetch`
  MCP tools for ChatGPT Custom Connectors, Claude.ai, and Deep-Research modes. Backed
  by the hybrid (semantic + BM25 + RRF) pipeline so connector users get full search
  quality through the standardized shape.
- **Agent self-orientation tools** — `vault_stats` (note count, top tags, top
  frontmatter keys, last index run) and `recent_notes` (mtime-DESC list). Use on
  first connect to brief an agent on what's in the vault and what the user has been
  working on.

## [0.8.3] — 2026-05-12

### Fixed
- **Skills** — eliminated false-positive Ollama model re-pull caused by a SIGPIPE +
  `pipefail` race in `install-vault-memory/setup.sh`.

### Changed
- Merged `setup-memory-system` skill into `install-vault-memory`; the older name is
  retired.

## [0.8.2] — 2026-05-12

### Added
- **`scripts/install-skills.sh`** — one-liner curl-pipe installer that drops the
  bundled Claude Code skills into any vault's `.claude/skills/` directory and is
  re-runnable to pull the latest skill versions from `main`.
- **CI** — automated npm publish on tag push (npm-first distribution).

### Fixed
- Packaging — corrected `bin` path and `repository.url` format in `package.json`.

## [0.8.1] — 2026-05-12

### Added
- **`vault-memory add-vault` CLI subcommand** — one-shot onboarding for a second/third
  vault: appends to `config.toml`, writes `.mcp.json` into the vault root, runs the
  initial index. Idempotent. Flags: `--name`, `--write`, `--no-index`.
- **`VAULT_MEMORY_ACTIVE_VAULT` env var** — scopes implicit `search_*` calls to a
  single vault per consumer (set in `.mcp.json`'s `env` block). Explicit `vaults: [...]`
  still overrides.
- **Mid-index skip** — vaults with an unfinished `index_runs` row are excluded from the
  implicit candidate set; skipped vaults surface on a `note` field in responses.
- **Frontmatter wikilink extraction** — wikilinks declared in YAML frontmatter are now
  picked up as forward-links.

### Fixed
- **Reranker** — `Tokenizer` constructor needs `(tokenizerJson, config)` (Hugging
  Face API); config is derived from `added_tokens`. Also added a near-empty-chunk
  pre-filter so the rerank pool isn't diluted by degenerate inputs.
- **Hybrid search** — widened reranker pool from `topK × 3` to `topK × 5`.
- **Chunker** — drops whitespace-only and tiny chunks (#25).
- **Indexer** — invalid YAML frontmatter on a single note is now logged-and-skipped,
  not fatal to the whole vault run. Count surfaces on `IndexRunResult.notesSkipped`.

## [0.8.0] — 2026-05-11

### Added
- **Real ONNX cross-encoder reranker (Phase 8)** — replaces the v0.7.x L2-norm proxy
  with a true forward pass over **BAAI/bge-reranker-v2-m3** (ONNX INT8, ≈570 MB) via
  `onnxruntime-node` + `@huggingface/tokenizers`. Sigmoid-of-logit gives a real
  `[0, 1]` relevance score per `(query, chunk)` pair.
- **`scripts/download-reranker.sh`** — one-time fetch of the ONNX model into
  `~/.vault-memory/models/bge-reranker-v2-m3/`.
- Lazy session load — users who never set `rerank: true` pay zero startup cost.
- Legacy `OllamaReranker` (L2-norm proxy) remains available via
  `reranker_backend = "ollama"` for back-compat, but is no longer recommended.

## [0.7.3] — 2026-05-11

### Added
- **`vacuum_embeddings` MCP tool** — drops orphaned embedding rows whose `chunk_id`
  no longer exists.
- **BGE-M3 as the default embedding model** — based on the v2 multilingual eval on a
  187-note German+English vault. Materially better at concept-paraphrase queries than
  `qwen3-embedding:0.6b`.

## [0.7.2] — 2026-05-11

### Fixed
- **Search** — use the active model recorded in the DB instead of the value in
  `config.toml` (which may lag a shadow-index promotion).

## [0.7.1] — 2026-05-11

### Fixed
- **Schema** — per-model `embeddings_m<id>_d<dim>` vec0 tables so multiple models with
  the same dimensionality can coexist (e.g. `bge-m3` and `qwen3-embedding:0.6b` both
  at 1024-d).

## [0.7.0] — 2026-05-11

### Added
- **Phase 7 complete:** path-exclude globs, variable embedding dimensions,
  cross-encoder reranker (Phase 7d), shadow-index for seamless model upgrades
  (Phase 7c).
- **Model management tools** — `list_models`, `start_shadow_index`,
  `switch_active_model`.

## [0.6.1] — 2026-05-11

### Fixed
- **FTS** — phrase-wrap tokens containing FTS5-meaningful punctuation so they don't
  blow up the parser.

## [0.6.0] — 2026-05-11

### Fixed
- Codex review findings MEDIUM-1, MEDIUM-2 (canonical JSON hashing for stable
  frontmatter hashes), MEDIUM-3, MEDIUM-4 (wikilink-resolution caching per index run),
  MEDIUM-5 (resolve symlinks before vault-boundary check).

### Added
- npm distribution prep — pre-built `dist/` shipped in the package so users can
  install without devDependencies.

## [0.5.x and earlier] — 2026-05-10 / 2026-05-11

Pre-0.6 development built the core stack in roughly this order:

- **Initial skeleton** — TypeScript MCP server stub.
- **Ollama client** — HTTP embeddings with retry + batching.
- **Vault reader** — scanner, markdown parser, wikilink extractor.
- **Chunker** — heading-aware markdown chunking with overlap.
- **Persistence** — SQLite + `sqlite-vec` with schema migrations.
- **FTS5 BM25** — full-text search over `chunks_fts`.
- **Graph layer** — high-level wikilink operations.
- **Hybrid search** — Reciprocal Rank Fusion over semantic + BM25.
- **Frontmatter query DSL** — `query_frontmatter` with a safe JSON-path subset.
- **Phase 2 MCP tools** — wikilink resolution, Obsidian-style aliases.
- **Audit + index_runs** — user-facing audit log API.
- **Frontmatter merge DSL** — `updateFrontmatter`.
- **Atomic writes** — `writeNote` / `deleteNote` with hash-based concurrency control.
- **Phase 3 MCP tools** — write/delete/update + audit surfaces.
- **File-watcher** — `DebouncedQueue` + `SuppressionSet` for incremental re-index.
- **Single-note indexer** — for the file-watcher path.
- **Catch-up** — reconcile DB with filesystem on server start.

---

## How releases are cut

1. Move accumulated `## [Unreleased]` entries into a new `## [X.Y.Z] — YYYY-MM-DD` block.
2. Start a fresh `## [Unreleased]` block above it with `_Nothing yet._`.
3. Bump `version` in `package.json`.
4. Commit as `chore(release): vX.Y.Z` and tag `vX.Y.Z` — CI publishes to npm on tag push.

**Every PR that ships a user-visible change MUST update `## [Unreleased]` in the same commit.**
Reviewers should block merges that change behavior but don't touch this file.
