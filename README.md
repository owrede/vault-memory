# vault-memory

Local-first semantic memory MCP server for Obsidian vaults.

Reads one or more Obsidian vaults, indexes them with local embeddings (Qwen3-Embedding via Ollama), and exposes them to Claude Code through the Model Context Protocol — with semantic + BM25 hybrid search, wikilink graph navigation, frontmatter queries, and atomic writes with concurrency protection.

## Status

Phase 1 (MVP) — under active development. See `_research/vault-memory-spec.md` in the consuming vault for the full design contract.

## Architecture in one paragraph

One SQLite database per vault under `~/.vault-memory/vaults/<name>.db`. Three storage layers: **raw** (notes, chunks — permanent, model-agnostic), **derived** (embeddings via sqlite-vec, FTS5, wikilinks — regenerable from raw), **audit** (index runs, write history). Embeddings via Ollama HTTP, default model `qwen3-embedding` (multilingual). Cross-vault search via Reciprocal Rank Fusion in the query layer.

## Development

```bash
npm install
npm run dev          # MCP server on stdio with hot reload
npm test
npm run build
```

## License

MIT (planned).
