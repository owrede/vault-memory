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

### Changed

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

### Migration

- **`notes.doc_uri` dual-column staging (Strategy A — additive, plan 01-02):**
  - **MIGRATION_007** (additive) — adds nullable `doc_uri TEXT` column to `notes` + `idx_notes_doc_uri` index. Backwards-compatible; existing rows have `doc_uri IS NULL` post-migration.
  - **MIGRATION_008** (function-style backfill) — sets `doc_uri = 'obsidian-fs://<vault>/' || path` for every row where `doc_uri IS NULL`. Idempotent; safe to re-run.
  - Path stored **un-encoded** in the column; percent-encoding happens only at `formatDisplayUrl()` time (per ADR-002 §URL semantics).
  - **No user action required.** Migrations run automatically on first server start after upgrade. SQLite transaction rollback is the safety net; no pre-migration backup is performed in v2 (deferred to Phase 8 per CONCERNS §"No Pre-Migration DB Backup"). (ADP-07)
- **v1 tool surface preserved byte-for-byte.** All 23 tool names, input schemas, output envelopes, and descriptions are unchanged. `evals/v1-baseline/tools-list.snapshot.json` regenerated under SDK 1.29 with zero diff against the Phase-0 baseline (W6 human-verify checkpoint passed in plan 01-06 Task 06).
- **MIGRATION_010 — sections table + notes.status column + section backfill (Phase 3 plan 03-01).** Three ordered steps in one transaction: (a) `CREATE TABLE sections` with 3 indexes, (b) `notes.status` column added + partial index `notes_status WHERE status IS NOT NULL`, (c) backfill `notes.status` from `json_extract(frontmatter, '$.status')` AND derive section rows for every indexed note via `markdownToSectionBlocks → extractSections`. Idempotent; re-applying is a no-op. Anchor-equivalence guarantee: backfilled section anchors match a fresh re-index byte-for-byte (the indexer + backfill share `src/chunker/headings.ts:extractHeadings` as the canonical heading source). v1-shaped DBs migrate cleanly without re-indexing.
- **`write_audit` migration v9** (function-style, idempotent) adds `is_memory_sink_write INTEGER NOT NULL DEFAULT 0` + a partial index `idx_write_audit_memory_sink ON (is_memory_sink_write, at DESC) WHERE is_memory_sink_write = 1` (Phase 2 plan 02-06 / MEM-08). All Phase 1 audit rows backfill to `false`; new audit rows derive the flag from `WriteOptions.sink !== undefined` at the `ObsidianFsDelivery.write/update/delete` facade. The function-style migration runs `PRAGMA table_info` first so fixture tests that rewind `user_version` continue to pass.
- **v1 tool surface grows from 23 → 26** with the three Phase 2 memory tools (`record_observation`, `recall`, `supersede`). The 23 v1 entries in `evals/v1-baseline/tools-list.snapshot.json` are byte-identical (pinned by a new `baseline.test.ts` assertion). The only diff on v1 tools is one optional input field added to `audit_log.inputSchema` (`is_memory_sink_write`); the v1 description text is byte-identical.

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
