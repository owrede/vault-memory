# Codebase Structure

**Analysis Date:** 2026-05-14

## Directory Layout

```
vault-memory/
├── src/                    # All TypeScript source
│   ├── server.ts           # MCP server entry point — all 23 tools registered here
│   ├── cli.ts              # CLI entry point — dispatches serve/index/add-vault
│   ├── types.ts            # Shared cross-module types (VaultConfig, SearchHit, ParsedNote, etc.)
│   ├── server.test.ts      # Integration tests for server-level utilities
│   │
│   ├── audit/              # Audit log read-side (index_runs + write_audit queries)
│   │   ├── index.ts
│   │   ├── audit.ts
│   │   └── audit.test.ts
│   │
│   ├── chunker/            # Heading-aware Markdown chunking for embedding
│   │   ├── index.ts
│   │   ├── chunker.ts
│   │   ├── headings.ts
│   │   ├── tokens.ts
│   │   └── *.test.ts
│   │
│   ├── config/             # TOML config loader (smol-toml + Zod) + add-vault helper
│   │   ├── index.ts
│   │   ├── loader.ts       # ~/.vault-memory/config.toml → AppConfig
│   │   ├── add-vault.ts
│   │   └── *.test.ts
│   │
│   ├── db/                 # SQLite layer: Database class, migrations, query namespaces
│   │   ├── database.ts     # Database class; loads sqlite-vec, applies migrations, exposes db.*
│   │   ├── schema.ts       # INITIAL_SCHEMA + MIGRATIONS[] (inlined SQL / run() functions)
│   │   ├── types.ts        # IndexRunRow, WriteAuditRow
│   │   ├── index.ts
│   │   └── queries/        # One query class per table
│   │       ├── notes.ts
│   │       ├── chunks.ts
│   │       ├── embeddings.ts   # Per-model vec0 tables (embeddings_m<id>_d<dim>)
│   │       ├── fts.ts          # FTS5 BM25 search + FtsQueries.sanitize()
│   │       ├── wikilinks.ts
│   │       ├── models.ts
│   │       ├── audit.ts
│   │       ├── aliases.ts
│   │       └── *.test.ts
│   │
│   ├── frontmatter/        # Frontmatter query + update operations
│   │   ├── index.ts
│   │   ├── query.ts        # queryFrontmatter() — SQL predicate filter
│   │   ├── update.ts       # updateFrontmatter() — merge DSL ($set/$unset/$push/$pull)
│   │   └── *.test.ts
│   │
│   ├── graph/              # Wikilink graph: backlinks, forward links, broken links
│   │   ├── index.ts
│   │   ├── graph.ts
│   │   └── graph.test.ts
│   │
│   ├── indexer/            # Index orchestration: full/incremental, single-note, shadow, catchup, vacuum
│   │   ├── index.ts
│   │   ├── indexer.ts      # indexVault() — batch Reader→Chunker→Ollama→DB
│   │   ├── single.ts       # indexNote() / removeNote() — per-file ops used by watcher
│   │   ├── catchup.ts      # catchupVault() — hash-scan at server start
│   │   ├── shadow.ts       # startShadowIndex() / switchActiveModel() / listModels()
│   │   ├── vacuum.ts       # vacuumEmbeddings()
│   │   ├── resolver.ts     # WikilinkResolver — target-path normalization
│   │   └── *.test.ts
│   │
│   ├── ollama/             # Ollama HTTP client: embed batching, health check, retry
│   │   ├── index.ts
│   │   ├── client.ts       # OllamaClient, OllamaHttpError
│   │   ├── retry.ts        # withRetry() utility
│   │   └── *.test.ts
│   │
│   ├── reader/             # Markdown parser: scanVault, parseNote, wikilink extraction, hashing
│   │   ├── index.ts
│   │   ├── scanner.ts      # scanVault() — fs.glob over .md files
│   │   ├── parser.ts       # parseNote() — gray-matter + H1/basename title extraction
│   │   ├── wikilinks.ts    # extractWikilinks()
│   │   ├── hash.ts         # sha256, computeNoteHash, computeBodyHash
│   │   └── *.test.ts
│   │
│   ├── rerank/             # Cross-encoder reranker: Reranker interface + two backends
│   │   ├── index.ts
│   │   ├── reranker.ts     # Reranker interface; OllamaReranker (legacy L2-norm proxy)
│   │   ├── onnx-reranker.ts # OnnxReranker — real cross-encoder via onnxruntime-node (default)
│   │   └── *.test.ts
│   │
│   ├── schema/             # suggest_frontmatter inference pipeline (three-layer)
│   │   ├── index.ts
│   │   ├── combiner.ts     # suggestFrontmatter() — merges all three layers, emits conflicts
│   │   ├── folder-conventions.ts # inferFromFolder() — prevalence in same folder
│   │   ├── neighbor-inference.ts # inferFromNeighbors() — wikilink neighborhood prevalence
│   │   ├── content-heuristics.ts # inferFromContent() — deterministic title/body pattern rules
│   │   └── *.test.ts
│   │
│   ├── search/             # Hybrid search: RRF fusion + glob exclusion
│   │   ├── index.ts
│   │   ├── hybrid.ts       # hybridSearch() + rrfMerge() + searchOneVault()
│   │   ├── glob.ts         # matchesAnyGlob() — path exclusion patterns
│   │   └── *.test.ts
│   │
│   ├── vault/              # Vault abstraction: VaultManager + Vault interface
│   │   ├── index.ts
│   │   └── manager.ts      # VaultManager — opens DBs, stores name→Vault map
│   │
│   ├── watcher/            # Live indexing: chokidar watcher + debounce queue + suppression
│   │   ├── index.ts
│   │   ├── watcher.ts      # VaultWatcher — chokidar → DebouncedQueue → indexNote
│   │   ├── queue.ts        # DebouncedQueue — coalesces rapid events (default 500ms window)
│   │   ├── suppression.ts  # SuppressionSet — TTL set for own-write event suppression
│   │   └── *.test.ts
│   │
│   └── write/              # Atomic vault writes: note create/overwrite/delete + FS utilities
│       ├── index.ts
│       ├── write.ts        # writeNote() + deleteNote() — OCC hash lock + DB sync
│       ├── fs.ts           # atomicWriteFile() + safeJoinInsideVault() + OutsideVaultError
│       └── *.test.ts
│
├── dist/                   # tsup build output (ESM, single bundle + .js.map)
│   └── cli.js              # Shebang binary, registered as `vault-memory` bin
│
├── scripts/                # Dev/setup scripts (bash + TS)
│   ├── download-reranker.sh    # Download bge-reranker-v2-m3 ONNX files from HuggingFace
│   ├── install-skills.sh
│   ├── smoke.ts
│   └── smoketest-v0.9.0.*
│
├── skills/                 # Five Claude Code skill packages (each has SKILL.md)
│   ├── add-vault/
│   ├── audit-vault-health/
│   ├── find-stale-notes/
│   ├── install-vault-memory/
│   └── triage-inbox/
│
├── lib/                    # Vendored / compiled native modules (node_modules for native deps)
│
├── docs/                   # Development notes and optimization todos (not committed to main)
│
├── .planning/              # GSD planning artifacts
│   └── codebase/           # Codebase map documents (ARCHITECTURE.md, STRUCTURE.md, etc.)
│
├── package.json
├── tsconfig.json           # strict, ESNext modules, Bundler resolution, rootDir src/
├── tsup.config.ts          # Single ESM entry: src/cli.ts → dist/cli.js
└── CHANGELOG.md
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source. One subdirectory per domain capability.
- Key files: `server.ts` (tool registry), `cli.ts` (entry), `types.ts` (shared contracts)

**`src/db/`:**
- Purpose: SQLite persistence layer for a single vault DB
- Contains: `Database` class (wraps `BetterSqlite3`), migration runner, one query class per table
- Key files: `database.ts`, `schema.ts`, `queries/embeddings.ts`

**`src/indexer/`:**
- Purpose: All index orchestration: batch runs, single-note ops, catch-up, shadow, vacuum
- Contains: Five distinct operations exported from `index.ts`

**`src/schema/`:**
- Purpose: `suggest_frontmatter` three-layer inference pipeline
- Contains: Three inference modules + `combiner.ts` that merges them; each module is independently testable

**`skills/`:**
- Purpose: Claude Code skill packages (`.claude/skills/` pattern); each has a `SKILL.md` and optional `rules/`
- Not compiled; consumed directly by Claude agents
- Key skills: `add-vault` (onboarding new vaults), `triage-inbox`, `audit-vault-health`, `find-stale-notes`, `install-vault-memory`

**`scripts/`:**
- Purpose: Operational setup scripts not part of the built package
- `download-reranker.sh`: downloads ONNX model files to `~/.vault-memory/models/bge-reranker-v2-m3/`

**`lib/`:**
- Purpose: Vendored native module support; contains node_modules for native binaries
- Generated: Yes (populated by install)
- Committed: No (gitignored)

**`dist/`:**
- Purpose: tsup build output
- Generated: Yes
- Committed: No
- Entry: `dist/cli.js` (shebang binary)

## Naming Conventions

**Files:**
- Kebab-case: `onnx-reranker.ts`, `folder-conventions.ts`, `add-vault.ts`
- One file per class/concept (no catch-all `utils.ts`)
- Test files co-located: `<module>.test.ts` next to `<module>.ts`
- Barrel files always named `index.ts`

**Directories:**
- Lowercase, single-word or hyphenated: `chunker/`, `rerank/`, `watcher/`, `db/`
- Subdirectories only inside `db/queries/` (one level deep max)

**TypeScript exports:**
- Classes and interfaces: PascalCase (`VaultManager`, `OllamaClient`, `SearchHit`)
- Functions: camelCase (`hybridSearch`, `rrfMerge`, `indexVault`)
- Types/interfaces exported alongside their implementation file; re-exported via `index.ts` barrel

**Zod schemas in server.ts:**
- Named `<ToolName>Args`, e.g. `SearchArgs`, `WriteNoteArgs`, `SuggestFrontmatterArgs`

## Where to Add New Code

**New MCP tool:**
1. Add Zod input schema constant in `src/server.ts` (near top, section `// ─── Tool Input Schemas`)
2. Add tool descriptor object to the `ListToolsRequestSchema` handler array
3. Add `case "<tool_name>":` to the `CallToolRequestSchema` switch; call a new handler function
4. Implement handler as a standalone function in the bottom half of `src/server.ts` (after `// ─── Tool handlers`)
5. If the tool requires new domain logic, create `src/<domain>/` with `index.ts` + implementation + tests

**New domain module:**
- Implementation: `src/<domain>/<module>.ts`
- Barrel: `src/<domain>/index.ts` (re-export public API)
- Tests: `src/<domain>/<module>.test.ts` (co-located)
- Import from `server.ts`: `import { myFunc } from "./<domain>/index.js"` (`.js` extension required for ESM)

**New database table or migration:**
- Add `const MIGRATION_XXX = ...` SQL or `run()` function in `src/db/schema.ts`
- Append `{ version: N+1, description: "...", sql: MIGRATION_XXX }` to `MIGRATIONS` array
- Add corresponding query class in `src/db/queries/<table>.ts`
- Export query class from `src/db/index.ts`
- Add property to `Database` class in `src/db/database.ts`

**New query class method:**
- Add method to the relevant `*Queries` class in `src/db/queries/<table>.ts`
- Prepare the statement in the constructor (synchronous, `better-sqlite3` pattern)
- Export the type from `src/db/index.ts` if input/output types are new

**New reranker backend:**
- Implement `Reranker` interface from `src/rerank/reranker.ts`
- Add class file `src/rerank/<name>-reranker.ts`
- Export from `src/rerank/index.ts`
- Add backend selection case in `src/server.ts` reranker bootstrap block (`src/server.ts:244`)

**Utility / shared helpers:**
- If specific to a domain: add to that domain's module (no separate utils file)
- If used by `server.ts` handlers only: add as a standalone function at the bottom of `src/server.ts`
- There is no `src/utils.ts` — avoid creating one

## Special Directories

**`~/.vault-memory/` (runtime, not in repo):**
- `config.toml` — user configuration (vaults, server settings)
- `vaults/<name>.db` — per-vault SQLite database
- `models/bge-reranker-v2-m3/` — ONNX reranker model files (downloaded separately)

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents, read by `/gsd-plan-phase` and `/gsd-execute-phase`
- Generated: Yes (by `/gsd-map-codebase`)
- Committed: Yes

## ESM Module Boundaries

The project is pure ESM (`"type": "module"` in `package.json`). Key rules:

- All internal imports must use `.js` extension: `import { X } from "./module.js"` (TypeScript resolves `.ts` at compile time; runtime resolves `.js`)
- No CommonJS `require()` anywhere
- `tsconfig.json` uses `"moduleResolution": "Bundler"` + `"verbatimModuleSyntax": true`
- Native binaries (`better-sqlite3`, `sqlite-vec`, `onnxruntime-node`, `@huggingface/tokenizers`) are kept `external` in `tsup.config.ts` — not bundled
- `OnnxReranker` lazy-imports `onnxruntime-node` and `@huggingface/tokenizers` on first `score()` call to avoid load cost when reranking is disabled

---

*Structure analysis: 2026-05-14*
