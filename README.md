# vault-memory

Local-first semantic memory MCP server for Obsidian vaults.

Reads one or more Obsidian vaults, indexes them with local embeddings (Qwen3-Embedding via Ollama), and exposes them to Claude Code through the Model Context Protocol — with semantic + BM25 hybrid search, wikilink graph navigation, frontmatter queries, and atomic writes with concurrency protection.

## Status

Phase 1 (MVP) — under active development. See `_research/vault-memory-spec.md` in the consuming vault for the full design contract.

## Architecture in one paragraph

One SQLite database per vault under `~/.vault-memory/vaults/<name>.db`. Three storage layers: **raw** (notes, chunks — permanent, model-agnostic), **derived** (embeddings via sqlite-vec, FTS5, wikilinks — regenerable from raw), **audit** (index runs, write history). Embeddings via Ollama HTTP, default model `qwen3-embedding` (multilingual). Cross-vault search via Reciprocal Rank Fusion in the query layer.

## Install (recommended)

```bash
cd ~/Documents/GitHub
gh repo clone owrede/vault-memory
cd vault-memory
npm install
npm run build
npm link              # creates the global `vault-memory` binary
```

The MCP-host config (`.mcp.json` in the consuming vault) calls the
`vault-memory` binary, so any shell that has it in `$PATH` will work.

## Development

```bash
npm install
npm run dev          # MCP server on stdio with hot reload
npm test
npm run build
```

After a code change: `npm run build && git add dist/` — the bundle is
tracked in git so users can `git pull && npm link` without needing
devDependencies on every machine.

## License

MIT (planned).
