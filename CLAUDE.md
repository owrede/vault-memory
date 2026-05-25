<!-- GSD:project-start source:PROJECT.md -->
## Project

**vault-memory — Agentic Knowledge Layer (v2)**

vault-memory is an MIT-licensed, local-first MCP server that exposes Obsidian vaults
to MCP-aware agents (Claude Code, Claude desktop, ChatGPT Custom Connectors, generic
MCP clients) as a set of tools for search, graph navigation, frontmatter queries, and
atomic writes. Today (v1.0.0) it is a strong **retrieval substrate** — hybrid search
(semantic + BM25 + RRF, optional cross-encoder rerank), 23 MCP tools, live indexing,
multi-vault, hash-protected writes. The v2 project evolves it from "Layer 0 retrieval"
into a full **agentic knowledge layer**: memory namespace with provenance, document-tree
retrieval, authority/staleness signals, graph-as-retrieval, a compiled-brief layer that
beats the "agents rediscover 85% of context every run" failure mode, and user-defined
**task contracts** that any MCP-aware agent can discover and instantiate.

**Core Value:** **Local-first, source-agnostic-ready, agentic knowledge layer over your Obsidian notes
— with the memory namespace as a non-negotiable safety invariant.** Agents never write
silently into user notes; every agent-authored document carries provenance properties
and lives in a labeled `MemorySink`.

### Using vault-memory as an agent (task contracts)

> This block guides an agent that *operates* vault-memory as an MCP server for a
> user — not an agent editing this codebase. It is the discoverability bridge for
> the contract tools, mirrored by the `use-contracts` skill (`skills/use-contracts/`).

When a user asks for an outcome that a **task contract** already produces —
a meeting-prep brief, a project status, a code-review brief, or any
"compile / pull together / summarize X from my notes" request — **prefer
running the matching contract over assembling the answer ad hoc.** Contracts
are the user's saved, repeatable recipes; they gather the right notes and
compile a brief into the memory sink with provenance.

The flow (the `use-contracts` skill spells it out step by step):

1. Read `vault-memory://contracts/{vault}` to see what contracts exist. Do this
   before claiming none fit — don't guess.
2. `describe_contract({name})` → read its Inputs.
3. Collect + **confirm** the required inputs (resolve any DocId by search and
   verify the match with the user).
4. `instantiate_contract({name, inputs, vault?})` → reports `write_back.doc_id`
   in the memory sink.

If no contract matches, fall back to plain `search_hybrid`. Contracts write
**only** to the labeled `MemorySink` (enforced at the `DeliveryAdapter`
chokepoint) — never into user notes.

### Constraints

- **Tech stack — TypeScript 5.7+, Node ≥22, ESM-only, MCP SDK ≥1.0.4.** Locked by
  existing v1.0.0 surface. No language/runtime changes during v2.
- **Local-only network — `localhost:11434` (Ollama) only in v2.** Phase 10 may add
  per-connector outbound calls, gated.
- **Backwards-compatible v1.x API.** Existing 23 tools must keep their shape and
  behavior through v2. New tools get new names. v2.0.0 may add behavior; it must
  not break.
- **Seam preservation — every read/write/watch goes through an interface from Phase
  1 onward.** chokidar, file paths, YAML-frontmatter-specific logic confined to the
  obsidian-fs adapter modules. Enforced by CI greps. Non-negotiable: Phase 10
  depends on this.
- **Memory namespace is sacrosanct.** Agent writes only to a labeled `MemorySink`;
  never silently into user notes. Single non-negotiable safety invariant. Validator
  at the `DeliveryAdapter` layer.
- **Document identity is opaque (URI-style).** `obsidian://<vault-name>/<vault-relative-path>`.
  File paths are presentation; they live only in the obsidian-fs adapter and the
  existing flat-shape `search`/`fetch` adapter contract.
- **`Document` is the canonical content type.** Every assembly tool consumes it.
  `properties: Record<string, unknown>` subsumes both YAML frontmatter and (future)
  Notion typed properties.
- **Test discipline — 324 tests, do not regress.** Every new tool ships unit tests
  in the same PR. Eval-style behavior tests for any retrieval/assembly change.
- **Branch hygiene — `phase-N-<slug>` off main; deliverable PRs onto the phase
  branch; merge to main only at phase sign-off.** Configured per the brief's
  Operating Rule 8.
- **Eval discipline — fixture vault in `evals/fixtures/` from Phase 0; every
  assembly PR runs the eval suite; regressions block merge.** Eval harness consumes
  `Document` objects (not raw markdown) from Phase 3 onward, so it can later run
  against a fixture Notion workspace.
- **No premature LLM coupling.** vault-memory has not historically called any LLM
  beyond embeddings. Phase 6 (briefs) is the first place this could change and
  requires an ADR.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.7+ (`^5.7.0`) — all source code under `src/`
- Bash — utility scripts under `scripts/` (`download-reranker.sh`, `install-skills.sh`, smoke tests)
## Runtime
- Node.js >= 22 (pinned via `"engines": { "node": ">=22" }` in `package.json`)
- ESM-only module format (`"type": "module"`)
- npm (lockfile: `package-lock.json` present)
## Frameworks
- `@modelcontextprotocol/sdk ^1.0.4` — MCP server transport, schema types, request handler wiring (`src/server.ts`)
- `vitest ^2.1.8` — test runner, no config file detected (uses defaults / package.json implicit config)
- Tests are co-located with implementation files as `*.test.ts` (e.g. `src/db/database.test.ts`, `src/ollama/client.test.ts`)
- `tsup ^8.3.5` — bundles `src/cli.ts` → `dist/cli.js` as ESM only; config at `tsup.config.ts`
- `tsx ^4.19.2` — TypeScript execution for `dev` watch mode (`tsx watch src/cli.ts`)
- `prettier ^3.4.0` — formatting target `"src/**/*.ts"`
- `tsc --noEmit` (no ESLint; TypeScript strict mode is the linter)
## Key Dependencies
- `better-sqlite3 ^11.7.0` — synchronous SQLite driver; kept external in tsup bundle (`.node` native binding)
- `sqlite-vec ^0.1.6` — SQLite vector extension (ANN search via `vec0` virtual tables); kept external (platform-specific prebuilt)
- `onnxruntime-node ^1.26.0` — ONNX inference runtime for BAAI/bge-reranker-v2-m3 cross-encoder; kept external (570 MB model glue); lazy-loaded on first `score()` call (`src/rerank/onnx-reranker.ts`)
- `@huggingface/tokenizers ^0.1.3` — XLM-RoBERTa tokenizer for ONNX reranker; kept external; lazy-loaded alongside `onnxruntime-node`
- `chokidar ^4.0.1` — filesystem watcher for live vault re-indexing (`src/watcher/watcher.ts`)
- `zod ^3.24.1` — input validation for all 23 MCP tool input schemas (`src/server.ts`, `src/config/loader.ts`)
- `smol-toml ^1.3.1` — TOML parser for `~/.vault-memory/config.toml` (`src/config/loader.ts`)
- `gray-matter ^4.0.3` — YAML frontmatter extraction from Obsidian markdown notes (`src/reader/`)
## Configuration
- Primary config: `~/.vault-memory/config.toml` — TOML file parsed by `src/config/loader.ts`; validated via Zod (`AppConfigSchema`)
- Optional env var: `VAULT_MEMORY_ACTIVE_VAULT` — scopes default search to a single vault when set
- Optional env var: `VAULT_MEMORY_RERANKER_DIR` — overrides ONNX model directory in `scripts/download-reranker.sh`
- No `.env` files; no cloud credentials; fully local configuration
- `tsup.config.ts` — single entry point `src/cli.ts`; output `dist/`; format ESM; target `node22`; sourcemaps enabled; shims enabled; `banner: "#!/usr/bin/env node"` prepended to `dist/cli.js`
- `tsconfig.json` — `target: ES2023`, `module: ESNext`, `moduleResolution: Bundler`, strict mode + `noUncheckedIndexedAccess` + `noImplicitOverride`, `verbatimModuleSyntax: true`, excludes `**/*.test.ts`
- Four packages are marked `external` in tsup to prevent bundling `.node` binaries or large optional runtimes: `better-sqlite3`, `sqlite-vec`, `onnxruntime-node`, `@huggingface/tokenizers`
## CLI Entry Point and Bin Shape
- `"bin": { "vault-memory": "dist/cli.js" }` — single CLI binary
- Entry source: `src/cli.ts`
- Built output: `dist/cli.js` (ESM, shebang `#!/usr/bin/env node`)
- `vault-memory serve` (default) — starts MCP server on stdio
- `vault-memory index [VAULT] [--full] [--vault NAME]` — build/refresh index
- `vault-memory add-vault <path> [--name NAME] [--write] [--no-index]` — register vault, write `.mcp.json`, run initial index
## Module / Bundling Strategy
- All imports use `.js` extension (Node ESM resolution) even in TypeScript source
- No path aliases defined (`moduleResolution: Bundler` handles bare imports)
- Native bindings and large optional runtimes are `external` — they must be installed as `node_modules` alongside the built `dist/`
- The `files` field in `package.json` publishes only `dist/`, `README.md`, and `LICENSE` — no source maps or test files shipped
## Platform Requirements
- Node.js >= 22
- npm
- For vector search: platform-specific `sqlite-vec` prebuilt (e.g. `sqlite-vec-darwin-arm64` on Apple Silicon)
- For ONNX reranker (optional): `~/.vault-memory/models/bge-reranker-v2-m3/model_quantized.onnx` + `tokenizer.json` — downloaded via `scripts/download-reranker.sh`
- Local machine (not a cloud service — explicitly local-first)
- Node.js >= 22 at runtime
- Ollama running locally (default `http://localhost:11434`)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Language & Module System
- `strict: true`
- `noUncheckedIndexedAccess: true` (array/object index access returns `T | undefined`)
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `verbatimModuleSyntax: true` (type imports must use `import type`)
- `isolatedModules: true`
## Naming Patterns
- `kebab-case` for all files: `hybrid.ts`, `add-vault.ts`, `onnx-reranker.ts`, `content-heuristics.ts`
- Test files mirror source: `hybrid.test.ts`, `onnx-reranker.test.ts`
- Index files re-export from sibling modules: `index.ts` in every subdirectory
- `camelCase` for all functions: `parseNote`, `chunkNote`, `hybridSearch`, `loadConfig`
- `camelCase` for async functions: `catchupVault`, `writeNote`, `atomicWriteFile`
- Exported pure helpers use descriptive verbs: `extractWikilinks`, `matchesAnyGlob`, `slugifyVaultName`
- `camelCase` throughout: `queryVec`, `embedCache`, `fanK`, `activeVault`
- Local constants follow the same rule (no SCREAMING_SNAKE_CASE for non-module-level consts)
- `PascalCase` for all: `ParsedNote`, `SearchHit`, `WriteResult`, `VaultConfig`
- Zod schemas also `PascalCase` with `Args` suffix for MCP input schemas: `SearchArgs`, `WriteNoteArgs`, `SuggestFrontmatterArgs`
- DB row types suffixed `Row`: `NoteRow`, `ChunkRow`, `ModelRow`, `WriteAuditRow`
- Input structs suffixed `Input`: `UpsertNoteInput`, `WriteNoteInput`, `DeleteNoteInput`
- `PascalCase`: `VaultManager`, `OllamaClient`, `NotesQueries`, `DebouncedQueue`
- Query classes suffixed `Queries`: `NotesQueries`, `ChunksQueries`, `FtsQueries`
## Import Organization
## Code Style (Prettier)
- Double quotes for strings
- Trailing commas everywhere (parameters, arrays, objects)
- 100-char line width
- 2-space indentation
- Arrow functions always parenthesized: `(x) => x`
## Section Dividers
## Error Handling
- Named `err` for cases that need the message: `catch (err) { const message = err instanceof Error ? err.message : String(err); }`
- Empty `catch {}` or `catch { // ignore }` for deliberate swallowing (JSON parse fallbacks, optional cleanup)
- `err: unknown` in some places for explicit unknown narrowing
## Null and Undefined Handling
## Async Patterns
## Logging
## Comments
## Module Design
## Function Design
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | Key Files |
|-----------|----------------|-----------|
| `serve()` | MCP bootstrap, tool registration, shutdown hooks | `src/server.ts` |
| `VaultManager` | Vault lifecycle: open DB, apply migrations, name→Vault map | `src/vault/manager.ts` |
| `Database` | SQLite wrapper: one handle + all query namespaces per vault | `src/db/database.ts` |
| `hybridSearch` | RRF fusion of semantic + BM25, optional rerank | `src/search/hybrid.ts` |
| `indexVault` | Full/incremental batch index: Reader→Chunker→Ollama→DB | `src/indexer/indexer.ts` |
| `catchupVault` | Hash-scan at server start to reconcile FS with DB | `src/indexer/catchup.ts` |
| `VaultWatcher` | chokidar file watcher → DebouncedQueue → indexNote | `src/watcher/watcher.ts` |
| `OllamaClient` | HTTP client for Ollama embed API with retry + batching | `src/ollama/client.ts` |
| `OnnxReranker` | True cross-encoder forward pass via onnxruntime-node | `src/rerank/onnx-reranker.ts` |
| `OllamaReranker` | L2-norm proxy reranker via Ollama /api/embed (legacy) | `src/rerank/reranker.ts` |
| `writeNote / deleteNote` | Atomic FS write + DB upsert with hash-based OCC | `src/write/write.ts` |
| `updateFrontmatter` | Merge-DSL frontmatter mutation preserving body bytes | `src/frontmatter/update.ts` |
| `suggestFrontmatter` | Three-layer schema inference pipeline | `src/schema/combiner.ts` |
| `queryFrontmatter` | SQL predicate filter over stored frontmatter JSON | `src/frontmatter/query.ts` |
| `startShadowIndex` | Background embedding backfill for a second model | `src/indexer/shadow.ts` |
| `SuppressionSet` | TTL set preventing own-write re-indexing loops | `src/watcher/suppression.ts` |
## Pattern Overview
- Each `src/<domain>/` directory exposes a clean `index.ts` barrel; `server.ts` imports only from those barrels (not internal files)
- No shared global mutable state — each `Vault` struct carries its own `Database` instance; `SuppressionSet` is the only cross-vault shared object
- All persistence is SQLite via `better-sqlite3` (synchronous); async surfaces only at the Ollama HTTP boundary and FS operations
- The `Reranker` interface (`src/rerank/reranker.ts`) is the single adapter boundary where two concrete backends plug in: `OnnxReranker` (default) and `OllamaReranker` (legacy)
## Layers
- Purpose: Parse + validate tool inputs (Zod schemas), dispatch to handler functions, serialize responses as `{ content: [{type:"text", text: JSON}] }`
- Location: `src/server.ts`
- Contains: All Zod input schemas, `CallToolRequestSchema` switch, `ListToolsRequestSchema` registry, bootstrap/shutdown
- Depends on: all domain modules
- Used by: MCP SDK transport (stdio)
- Purpose: Business logic per capability area, each module independently testable
- Location: `src/search/`, `src/indexer/`, `src/write/`, `src/frontmatter/`, `src/graph/`, `src/schema/`, `src/audit/`
- Contains: Pure functions and lightweight classes operating on `Vault` structs
- Depends on: `src/vault/`, `src/db/`, `src/ollama/`, `src/reader/`, `src/chunker/`, `src/rerank/`
- Used by: `src/server.ts` tool handlers
- Purpose: Provide a single `Vault` struct (`{config, db, dbPath}`) as the unit of access for all domain code
- Location: `src/vault/manager.ts`
- Contains: `VaultManager` (name → Vault map), DB directory management
- Depends on: `src/db/`
- Used by: `src/server.ts`, `src/indexer/`, `src/watcher/`
- Purpose: Type-safe query namespaces for each table; schema migrations; sqlite-vec extension loading
- Location: `src/db/`
- Contains: `Database` class, `NotesQueries`, `ChunksQueries`, `EmbeddingsQueries`, `FtsQueries`, `WikilinksQueries`, `ModelsQueries`, `AuditQueries`, `AliasesQueries`, `MIGRATIONS`
- Depends on: `better-sqlite3`, `sqlite-vec`
- Used by: `VaultManager`, all domain modules via `vault.db.*`
- Purpose: Parse markdown files from disk into `ParsedNote`, split into `Chunk[]` for embedding
- Location: `src/reader/`, `src/chunker/`
- Contains: `scanVault`, `parseNote`, `extractWikilinks`, `sha256/computeNoteHash/computeBodyHash`; `chunkNote`, `countTokens`, heading extraction
- Depends on: `gray-matter` (frontmatter parse), Node.js `fs`
- Used by: `src/indexer/`
- Purpose: Ollama HTTP client, config loader, watcher queue mechanics, FS utilities
- Location: `src/ollama/`, `src/config/`, `src/watcher/` (queue + suppression), `src/write/fs.ts`
- Contains: `OllamaClient` (batching, retry), `loadConfig` (TOML → AppConfig), `DebouncedQueue`, `SuppressionSet`, `atomicWriteFile`, `safeJoinInsideVault`
- Depends on: `smol-toml`, `chokidar`, Node.js `fs`, `zod`
- Used by: server bootstrap and domain modules
## Data Flow
### Primary Search Request (search_hybrid)
### Live Indexing Path
### Write Path
### Schema Inference (suggest_frontmatter)
- No in-process state beyond the `VaultManager` map (loaded at startup) and `suppression` TTL set; all other state lives in SQLite
## Key Abstractions
- Purpose: Unit of access for all per-vault operations; groups config + DB handle
- Definition: `src/vault/manager.ts:17` — `interface Vault { config: VaultConfig; db: Database; dbPath: string }`
- All domain functions accept `Vault` as parameter; never `Database` directly
- Purpose: Swap point between ONNX cross-encoder and legacy Ollama L2-norm proxy
- Definition: `src/rerank/reranker.ts:39` — `interface Reranker { score(query, chunks): Promise<number[]> }`
- Constructed once at server bootstrap; `undefined` when unconfigured (all rerank calls skip)
- Purpose: Common output shape for all search paths (semantic, text, hybrid)
- Definition: `src/types.ts:176`
- Includes `scoreBreakdown` with per-method scores for transparency
- Purpose: Isolate embedding vectors by (modelId, dim) so multiple models coexist without interference; enables shadow-indexing and zero-downtime model promotion
- Management: `EmbeddingsQueries.ensureTableForModel()` creates on demand; `vacuumEmbeddings()` drops orphans
- Schema evolution: v1 used single `embeddings(FLOAT[1024])` → v4 per-dim → v5 per-model-per-dim (`src/db/queries/embeddings.ts:36`)
- Purpose: Flat `{id, title, url, snippet}` shape for ChatGPT Custom Connectors, Claude.ai Deep-Research, and similar connector ecosystems
- `id` format: `<vault>:<vault-relative-path>` (human-readable, `:` is unambiguous separator)
- Backed by the full hybrid pipeline; de-duplicates to one entry per note
- Helpers: `encodeNoteId()`, `decodeNoteId()`, `obsidianUrl()` at `src/server.ts:1313`
## Entry Points
- Location: `src/server.ts:218`, called from `src/cli.ts:12`
- Triggers: `npx vault-memory serve` / Claude Desktop MCP config
- Responsibilities: load config, open all vault DBs, construct Ollama + Reranker, register all 23 tools, connect stdio transport, fire-and-forget catch-up + watchers
- Location: `src/cli.ts`
- Commands: `serve` (default), `index [--vault <n>] [--full]`, `add-vault`
- Dynamically imports domain modules to avoid eager-loading on every subcommand
- Location: `dist/cli.js` (tsup bundle, single ESM file, shebang `#!/usr/bin/env node`)
- Registered as `bin.vault-memory` in `package.json`
## Architectural Constraints
- **Threading:** Single-threaded Node.js event loop. All SQLite calls are synchronous (`better-sqlite3`). Async concurrency only at Ollama HTTP and FS boundaries. Shadow indexing runs on the same event loop — large vaults block during embed batches.
- **Global state:** `SuppressionSet` instance in `server.ts` is shared across all vault watchers. `VaultManager.vaults` Map is module-level but wrapped in the class.
- **Circular imports:** None detected. Domain modules import only from `../vault/`, `../db/`, `../ollama/`, `../reader/`, `../chunker/`, `../rerank/`, `../types.js` — never from peer domain modules or upward from `server.ts`.
- **ESM-only:** `"type": "module"` in `package.json`; all imports use `.js` extensions (ESM resolution); `tsconfig.json` `moduleResolution: "Bundler"`.
- **sqlite-vec extension:** Must be loaded before any `vec0` virtual table DDL. `Database` constructor calls `loadSqliteVec()` before `migrateInternal()` (`src/db/database.ts:43–46`). Platform-specific prebuilt binary required.
- **Mid-index vault skip:** `resolveVaultTargets()` checks `audit.isIndexing()` and excludes vaults from implicit fan-out; explicit `vaults:` filter bypasses this (`src/server.ts:1079`).
- **Write guard:** `write_enabled` flag per vault config; `writeNote`/`deleteNote`/`updateFrontmatter` check it and return `{ok:false, reason:"permission_denied"}` (`src/write/write.ts`).
## Anti-Patterns
### Calling DB query objects from outside the `db.*` namespace
### Using `OllamaReranker` as default backend
## Error Handling
- Write operations return discriminated unions: `WriteResult = WriteSuccess | WriteConflict`, `UpdateResult = UpdateSuccess | UpdateConflict` — callers check `.ok` before destructuring
- Search / read paths throw on unknown vault (`manager.require()` throws with helpful message); caught by the outer `try/catch` in `CallToolRequestSchema` handler → `errorResponse(message)`
- Ollama calls: `OllamaClient` retries 3× on transient errors; throws `OllamaHttpError` on 4xx/5xx after exhausting retries
- Reranker failures are silently swallowed in `hybridSearch` — falls back to RRF order and clears any partial `rerankScore`
- MCP response wrapping: `ok(data)` serializes to `{content:[{type:"text", text: JSON}]}`; `errorResponse(msg)` sets `isError: true`
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
