# ADR-008 — RetrievalBackend seam + ContextFit as a second indexing/retrieval engine

**Status:** Accepted
**Date:** 2026-06-29
**Phase:** v2.x
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-002 (adapter seams), ADR-003 (Document shape / SearchHit), the
contextfit-vs-sqlite-vec spike (`.planning/quick/20260522-spike-contextfit-vs-sqlitevec/`).
External: ContextFit — https://www.context.fit/ , https://github.com/ContextFit/cf

---

## Context

vault-memory's retrieval has been hard-wired to one engine: Ollama embeddings
(`OllamaClient`) feeding sqlite-vec ANN + FTS5 BM25, RRF-fused in `hybridSearch`.
That path needs a neural embedding model resident in Ollama — practically a GPU,
or a slow CPU fallback.

A target deployment is a **resource-limited, non-GPU Synology NAS**. The spike
benchmarked **ContextFit** — a token-native, CPU-only retrieval engine (BPE
tokenization + BM25 + Semantic-IDs + MinHash/LSH + roaring bitmaps; no embeddings,
no GPU, ~41 MB deps) — against the Ollama+sqlite-vec path on a real 255-note vault:

| Metric | Ollama + sqlite-vec | ContextFit |
|---|---|---|
| Ingest wall-clock | 131 s | **5.7 s** |
| Query P50 | 113 ms | **13 ms** |
| GPU / model | 1.3 GB, 100% GPU | **none (CPU only)** |
| Retrieval quality (A/B) | competitive | competitive (wins some, loses some) |

ContextFit is a strong fit for the NAS goal. We add it as a **second, optional
engine selectable per vault**, without disturbing the default Ollama path.

## Decision

1. **Introduce a `RetrievalBackend` seam** — a TypeScript interface abstracting
   "index this vault" + "search this vault" so the engine is swappable. The
   existing Ollama+sqlite-vec path is refactored to be the default implementation
   behind it (`OllamaVecBackend`); ContextFit is a second implementation
   (`ContextFitBackend`).

2. **ContextFit integrates out-of-process via its CLI.** ContextFit is Python
   (`pip install contextfit`); vault-memory is Node/ESM. We spawn the
   `contextfit` binary (`ingest` / `query --json`) with `child_process.spawn`
   (no shell), pointing `--kb` at a per-vault index dir under `~/.vault-memory/`.
   No daemon: cold-start per call is acceptable at ContextFit's 8–13 ms query
   latency. This mirrors the existing `[contracts].mcp_clients` subprocess
   pattern (ADR-006). We do NOT embed its MCP server (avoids MCP-in-MCP nesting
   and lifecycle complexity).

3. **Full backend swap per vault, not a hybrid half.** A ContextFit vault sets
   `backend = "contextfit"` and skips Ollama / embeddings / sqlite-vec entirely —
   ContextFit owns ingest AND query. (Using it only as the BM25 half of the
   existing hybrid would still require Ollama for the semantic half, defeating
   the CPU-only goal.) Default remains `backend = "ollama"` — existing vaults are
   byte-identical.

4. **Results normalize to the canonical `SearchHit`.** The adapter maps
   ContextFit's `query --json` `chunks[]` (`metadata.source`, `preview`, `score`,
   `chunk_id`) to `SearchHit` (`notePath`, `chunkText`, `score`, …) so all
   downstream assembly/citation code is engine-agnostic.

## Consequences

### Positive
- vault-memory runs on CPU-only hardware (NAS) with no neural model.
- Default Ollama path unchanged; opt-in per vault; no eval re-baseline for Ollama vaults.
- The seam makes future engines (e.g. a pure-Rust backend) a drop-in.

### Negative / accepted
- ContextFit is a **separate runtime dependency** (Python + `contextfit`), provisioned by the install flow only when the user opts in. The `backend` probe surfaces a clear error if it's missing.
- ContextFit scores are unbounded/lexical (not cosine) — `scoreBreakdown` records a `contextfit` raw score rather than `semantic`/`text`. Cross-engine score comparison is meaningless; that's fine (search is per-vault).
- ContextFit vaults do not populate sqlite-vec/`chunks_fts`/sections-from-embeddings; graph/section features that depend on the SQLite derived layer are reduced for those vaults (documented). The note/chunk/wikilink layer is still built so links + frontmatter queries work.
- Network constraint (CLAUDE.md "localhost:11434 only") is honored: ContextFit is a local subprocess, no network.

### macOS `spawn EBADF` — diagnosed and mitigated (2026-09-05)

A live MCP reproduction identified watcher descriptor pressure, including on
hosts using only ContextFit vaults. The old watcher opened every attachment and
filtered non-Markdown events only afterwards. It also passed exclude globs as
strings to Chokidar 4, which treats them as literal paths. On the affected host
the server held approximately 23,000 file descriptors. The first query before
watcher startup could succeed; subsequent ContextFit spawns failed with `EBADF`.
[libuv issue #5204](https://github.com/libuv/libuv/issues/5204) documents the macOS
spawn file-action limit when newly allocated pipe descriptors exceed 10239.

The shared watcher options now reject non-Markdown regular files before watcher
allocation, preserve directory traversal for newly created notes, and compile
vault-relative excludes using the scanner's glob matcher. In the reproduction,
both vault watchers reached ready with 5,457 descriptor entries; five consecutive
MCP searches succeeded. Very large Markdown corpora can still need narrower
watch scopes; retrying alone cannot cure persistent descriptor pressure.

`search_semantic` now dispatches ContextFit vaults before checking for vector
models. A complete ContextFit search failure becomes an MCP error instead of an
empty successful result. Healthy vault results survive partial failures; a
semantic search that falls back to a healthy Ollama vault includes the ContextFit
failure in its response note. Existing server processes need a reconnect after
rebuilding because their loaded code does not update automatically.

### Boundaries
- ContextFit's CLI contract is pinned in `src/adapters/retrieval/contextfit/cli.ts`; a contract-probe test asserts the `--json` shape so an upstream change fails loudly.
- Adapter-seam discipline (ADR-002): the subprocess spawn + path handling live only in the contextfit adapter directory.
