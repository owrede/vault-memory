# Technology Stack

**Analysis Date:** 2026-05-14

## Languages

**Primary:**
- TypeScript 5.7+ (`^5.7.0`) — all source code under `src/`

**Secondary:**
- Bash — utility scripts under `scripts/` (`download-reranker.sh`, `install-skills.sh`, smoke tests)

## Runtime

**Environment:**
- Node.js >= 22 (pinned via `"engines": { "node": ">=22" }` in `package.json`)
- ESM-only module format (`"type": "module"`)

**Package Manager:**
- npm (lockfile: `package-lock.json` present)

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk ^1.0.4` — MCP server transport, schema types, request handler wiring (`src/server.ts`)

**Testing:**
- `vitest ^2.1.8` — test runner, no config file detected (uses defaults / package.json implicit config)
- Tests are co-located with implementation files as `*.test.ts` (e.g. `src/db/database.test.ts`, `src/ollama/client.test.ts`)

**Build:**
- `tsup ^8.3.5` — bundles `src/cli.ts` → `dist/cli.js` as ESM only; config at `tsup.config.ts`
- `tsx ^4.19.2` — TypeScript execution for `dev` watch mode (`tsx watch src/cli.ts`)

**Formatting:**
- `prettier ^3.4.0` — formatting target `"src/**/*.ts"`

**Type checking (lint):**
- `tsc --noEmit` (no ESLint; TypeScript strict mode is the linter)

## Key Dependencies

**Critical:**
- `better-sqlite3 ^11.7.0` — synchronous SQLite driver; kept external in tsup bundle (`.node` native binding)
- `sqlite-vec ^0.1.6` — SQLite vector extension (ANN search via `vec0` virtual tables); kept external (platform-specific prebuilt)
- `onnxruntime-node ^1.26.0` — ONNX inference runtime for BAAI/bge-reranker-v2-m3 cross-encoder; kept external (570 MB model glue); lazy-loaded on first `score()` call (`src/rerank/onnx-reranker.ts`)
- `@huggingface/tokenizers ^0.1.3` — XLM-RoBERTa tokenizer for ONNX reranker; kept external; lazy-loaded alongside `onnxruntime-node`
- `chokidar ^4.0.1` — filesystem watcher for live vault re-indexing (`src/watcher/watcher.ts`)
- `zod ^3.24.1` — input validation for all 23 MCP tool input schemas (`src/server.ts`, `src/config/loader.ts`)

**Infrastructure:**
- `smol-toml ^1.3.1` — TOML parser for `~/.vault-memory/config.toml` (`src/config/loader.ts`)
- `gray-matter ^4.0.3` — YAML frontmatter extraction from Obsidian markdown notes (`src/reader/`)

## Configuration

**Environment:**
- Primary config: `~/.vault-memory/config.toml` — TOML file parsed by `src/config/loader.ts`; validated via Zod (`AppConfigSchema`)
- Optional env var: `VAULT_MEMORY_ACTIVE_VAULT` — scopes default search to a single vault when set
- Optional env var: `VAULT_MEMORY_RERANKER_DIR` — overrides ONNX model directory in `scripts/download-reranker.sh`
- No `.env` files; no cloud credentials; fully local configuration

**Build:**
- `tsup.config.ts` — single entry point `src/cli.ts`; output `dist/`; format ESM; target `node22`; sourcemaps enabled; shims enabled; `banner: "#!/usr/bin/env node"` prepended to `dist/cli.js`
- `tsconfig.json` — `target: ES2023`, `module: ESNext`, `moduleResolution: Bundler`, strict mode + `noUncheckedIndexedAccess` + `noImplicitOverride`, `verbatimModuleSyntax: true`, excludes `**/*.test.ts`
- Four packages are marked `external` in tsup to prevent bundling `.node` binaries or large optional runtimes: `better-sqlite3`, `sqlite-vec`, `onnxruntime-node`, `@huggingface/tokenizers`

## CLI Entry Point and Bin Shape

**Binary:**
- `"bin": { "vault-memory": "dist/cli.js" }` — single CLI binary
- Entry source: `src/cli.ts`
- Built output: `dist/cli.js` (ESM, shebang `#!/usr/bin/env node`)

**Subcommands:**
- `vault-memory serve` (default) — starts MCP server on stdio
- `vault-memory index [VAULT] [--full] [--vault NAME]` — build/refresh index
- `vault-memory add-vault <path> [--name NAME] [--write] [--no-index]` — register vault, write `.mcp.json`, run initial index

## Module / Bundling Strategy

- All imports use `.js` extension (Node ESM resolution) even in TypeScript source
- No path aliases defined (`moduleResolution: Bundler` handles bare imports)
- Native bindings and large optional runtimes are `external` — they must be installed as `node_modules` alongside the built `dist/`
- The `files` field in `package.json` publishes only `dist/`, `README.md`, and `LICENSE` — no source maps or test files shipped

## Platform Requirements

**Development:**
- Node.js >= 22
- npm
- For vector search: platform-specific `sqlite-vec` prebuilt (e.g. `sqlite-vec-darwin-arm64` on Apple Silicon)
- For ONNX reranker (optional): `~/.vault-memory/models/bge-reranker-v2-m3/model_quantized.onnx` + `tokenizer.json` — downloaded via `scripts/download-reranker.sh`

**Production:**
- Local machine (not a cloud service — explicitly local-first)
- Node.js >= 22 at runtime
- Ollama running locally (default `http://localhost:11434`)

---

*Stack analysis: 2026-05-14*
