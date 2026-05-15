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

### Changed

- **`@modelcontextprotocol/sdk` bumped to `^1.29.0`**; tool registration migrated from the v1 low-level `Server` + `setRequestHandler` pattern to `McpServer` + `server.registerTool()` × 23. Raw JSON Schema literals flow directly from `src/tool-registry.ts` (workaround for SDK#1143 / Zod-4 description-drop, although the issue is empirically MOOT in SDK 1.29). (ADP-08)
- **`zod` bumped to `^4.4.3`**. Refinements and `errorMap` swept per the Zod 4 migration guide; Standard Schema wiring intact. (ADP-09)
- **Default `client_id` for write / update / delete** is now captured from MCP `InitializeRequest.params.clientInfo.name` via a lazy closure (`getClientId()` in `src/server.ts`), falling back to `"unknown"`. Removes the v1 hardcoded `"claude-code"` default that misidentified every non-Claude write in the audit log. (D-02)
- **`obsidian://` display-URL minting** moved from `src/server.ts:obsidianUrl()` (deleted) into `SourceConnector.formatDisplayUrl(id)` on the adapter. The `obsidian://open?vault=…&file=…` URL is now adapter-published; future adapters mint their own scheme. (D-01)
- **README rewritten** to lead with "any MCP-aware agent" framing in the first 20 lines. Equal billing for Claude Code / Claude Desktop / ChatGPT Custom Connectors / MCP Inspector / generic clients. Obsidian framed as the v2 source connector, not the sole consumer. (ADP-14)
- **`src/cli.ts` user-facing strings** swept for Claude-leak — `"Open ${path} in Claude Code"` → `"Open ${path} in your MCP-aware client"`. (D-02 follow-through)

### Migration

- **`notes.doc_uri` dual-column staging (Strategy A — additive, plan 01-02):**
  - **MIGRATION_007** (additive) — adds nullable `doc_uri TEXT` column to `notes` + `idx_notes_doc_uri` index. Backwards-compatible; existing rows have `doc_uri IS NULL` post-migration.
  - **MIGRATION_008** (function-style backfill) — sets `doc_uri = 'obsidian-fs://<vault>/' || path` for every row where `doc_uri IS NULL`. Idempotent; safe to re-run.
  - Path stored **un-encoded** in the column; percent-encoding happens only at `formatDisplayUrl()` time (per ADR-002 §URL semantics).
  - **No user action required.** Migrations run automatically on first server start after upgrade. SQLite transaction rollback is the safety net; no pre-migration backup is performed in v2 (deferred to Phase 8 per CONCERNS §"No Pre-Migration DB Backup"). (ADP-07)
- **v1 tool surface preserved byte-for-byte.** All 23 tool names, input schemas, output envelopes, and descriptions are unchanged. `evals/v1-baseline/tools-list.snapshot.json` regenerated under SDK 1.29 with zero diff against the Phase-0 baseline (W6 human-verify checkpoint passed in plan 01-06 Task 06).

### Documentation

- Relocate ADRs 001–004 from `docs/dev/` (gitignored) to public `docs/v2/adr/`; amend each with Invariants + Examples sections covering both `obsidian-fs://` and `notion-api://` worked examples (FND-01, FND-04).
- ADR-003 amended with explicit hash-semantics pseudocode (RFC 8785 JCS, NFC normalisation, LF line endings, IEEE-754 number canonicalization) + chunk-level `source_hashes` schema (FND-02).
- ADR-004 amended: folder-default `MemorySink` is the only code path; separate-vault is config-only via `[memory] sink = "@…"` (FND-03). `.memory-sink` sentinel mandated.
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
