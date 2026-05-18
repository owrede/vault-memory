# Phase 5: Compiled brief layer — Research

**Researched:** 2026-05-18
**Domain:** Compiled briefs over Obsidian vaults — MCP tools + Resource + staleness daemon + content-stable ChunkIds
**Confidence:** HIGH (every load-bearing claim verified against codebase or @modelcontextprotocol/sdk@^1.29 type definitions)

## Summary

Phase 5 ships vault-memory's signature differentiator: compiled briefs as first-class `Document`s in `_memory/_briefs/` with **deterministic chunk-level source-hash staleness propagation**. Six surfaces — two new MCP tools (`compile_brief`, `get_brief`), one MCP Resource (`list_briefs`), an in-process staleness daemon, a `ChunkId` substrate (migration 013), and a `brief_sources` reverse-index — all wired through the Phase 1 adapter seams (DeliveryAdapter + ChangeFeed) and the Phase 2 MemorySink invariant.

The CONTEXT.md decisions are tight: 13 of them locked, 2 upgraded to defense-in-depth (D-02 eval coverage = both curated AND from-cluster; D-09 replay = hybrid scan-plus-cursor). The eight Claude-discretion items are documented but defer to the researcher/planner to resolve. Research surfaced one **critical contract conflict** the planner must address in plan 05-01 (the ADR plan) before any implementation: the `status: stale` value used throughout D-13 / BRF-04 / BRF-05 is **not** a member of the closed enum in `default-memory-v1` (`active | superseded | archived`). The recommended resolution is a new `default-brief-v1` contract bound to a dedicated `_memory/_briefs/` MemorySink — covered in detail under Sub-Folder Resolution.

**Primary recommendation:** Ship four MVP vertical slices. **Slice 1** = ADR-005 + content-stable ChunkId migration (013) + brief contract (`default-brief-v1`) + `_memory/_briefs/` sink registration. **Slice 2** = `compile_brief` + `get_brief` end-to-end against MCP Sampling tier ONLY + hand-curated `briefs-curated.yaml` (no daemon, no Ollama, no prepared_text). **Slice 3** = staleness daemon + `brief_sources` table + lock + rename-handling + the BRF-10 20-doc eval. **Slice 4** = `list_briefs` Resource + Ollama+prepared_text ladder tiers + `briefs-from-cluster.yaml` + cross-adapter stub conformance (BRF-11) + snapshot regen + phase gate. This sequencing ships the agent-visible value (compile and retrieve a brief) at the end of slice 2 and the signature staleness behavior at the end of slice 3 — every later slice hardens an already-working surface.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Caller-supplied sources only.** `compile_brief({target, source_doc_ids, purpose, max_tokens})` verbatim per BRF-03. Agents (or Phase 6 contracts) orchestrate `cluster()` / `expand()` / `search_hybrid` upstream and pass the deduped `DocId[]`. Brief layer is a pure compiler. No `cluster()` baked in.
- **D-02: Eval coverage = BOTH curated AND pipeline.** `briefs-curated.yaml` (hand-curated `source_doc_ids` per query, BRF-10 primary), `briefs-from-cluster.yaml` (`cluster({seed})` → `compile_brief`, integration secondary), `briefs-staleness-stub.yaml` (BRF-11 stub source-neutrality).
- **D-03: Claude's discretion (planner lean).** Dedupe `source_doc_ids` on input; soft cap at 50 with structured error `{ok: false, reason: "too_many_sources", limit: 50, hint: ...}`. Hard cap preferable to silent truncation.
- **D-04: ChunkId = `<DocId>#chunk-<n>`, `<n>` = first 7 hex chars of `sha256(NFC(chunk_text))`.** Content-only. Disambiguation comes from the `<DocId>` prefix.
- **D-05: `chunks.chunk_id_fragment TEXT NOT NULL` column** added via migration 013 (CONTEXT.md said "012" but migration 012 is already taken by Phase 4 CR-01 — see Section "Migration Numbering"). Populated by `src/chunker/` at chunk insert. Public ChunkId = `${chunks.doc_uri}#chunk-${chunks.chunk_id_fragment}`.
- **D-06: `brief_sources` reverse-index** — `brief_sources(brief_doc_id TEXT, chunk_id_fragment TEXT, chunk_doc_id TEXT, recorded_hash TEXT, UNIQUE(brief_doc_id, chunk_id_fragment))`. Indexes on `(chunk_doc_id)` and `(chunk_id_fragment)`. Populated on brief write, deleted on supersede.
- **D-07: Daemon runs in-process at `vault-memory serve` boot.** Co-subscribes to the SAME `ChangeFeed` instance as `VaultWatcher`. One Node process per MCP session.
- **D-08: Lock contention → second server starts WITHOUT daemon + structured WARN.** `~/.vault-memory/locks/<vault>.lock`. Stale-lock detection via `process.kill(pid, 0)` (POSIX `ESRCH` ⇒ dead).
- **D-09: Hybrid replay = startup scan (correctness floor) + DB cursor `daemon_state(vault_name, last_seen_doc_mtime)` (efficiency).** Migration 013 adds `daemon_state` table.
- **D-10: Capability-first LLM ladder.** MCP Sampling → local Ollama (`[brief.ollama] model` in config.toml) → caller-passed `prepared_text` → structured error `{ok: false, reason: "no_llm_strategy_available", attempted: [...], hint: ...}`.
- **D-11: Brief body = plain markdown with inline `[[wikilinks]]` per cited source.** `BriefBodyValidator` appends `## Sources` footer with missing wikilinks at write time. Phase 4 D-02 indexer creates back-edges from the body automatically.
- **D-12: Recompile-same-target → auto-supersede.** New brief gets timestamped slug `_memory/_briefs/<target>--YYYYMMDDTHHMM.md` (separator `--`). Phase 2 `supersede(old, new, "recompiled")` chains the old. `target` is the stable cross-version handle.
- **D-13: `get_brief` decision tree — staleness dominates; age is independent.** When `brief: null`, caller MUST call `compile_brief` to recompile. No auto-recompile in v2.0.0.

### Claude's Discretion

- Exact wording of LLM-compile prompt template — researcher drafts in plan 05-01 ADR, grounded in `purpose` field, Phase 3 D-05 8-field citation packets, explicit `[[Note Title]]` emission per D-11, `max_tokens` bound. Recommended skeleton in `<specifics>` section below.
- `confidence: inferred` semantics — BRF-01 sets `confidence: inferred`; no further refinement in v2.0.0.
- `max_tokens` default — recommended lean `max_tokens?: number = 2000`.
- Brief `purpose` field validation — free-text per REQUIREMENTS; recommended soft cap ~500 chars.
- Daemon error reporting — log structured WARN + skip the brief, never crash daemon; persistent failures surface via `audit_log` with `kind: "brief_staleness_error"`.
- `list_briefs` resource shape — recommended `vault-memory://briefs/{vault}?target=<pattern>` returning `{briefs: [{doc_id, target, purpose, compiled_at, status, source_count, age_days}, ...]}`.
- Concurrent `compile_brief` calls for same target — both succeed; both call `supersede()`; outcome is a chain (Phase 2 supersede is forward-only and atomic). Documented in ADR-005.
- Rename-event handling specifics (BRF-08) — see "Runtime State Inventory" and "Architecture Patterns §Pattern: Rename Survival" below.
- Cross-vault briefs — not supported in v2.0.0; brief + sources must share a vault.
- Tool-snapshot regen — additive diff in Phase 5 PR; reviewed manually.

### Deferred Ideas (OUT OF SCOPE)

- Block-level staleness (per-block `cited_chunks` on BlockNodes) — v3 with Notion connector.
- Auto-recompile in `get_brief` — v2.x config flag if user friction is real.
- Cross-vault briefs — v3 / Phase 10.
- Per-call LLM strategy override (`compile_brief({..., strategy_override})`).
- Block-level back-edges from brief body — v3.
- Soft cap on `source_doc_ids` above 50 — lift only if research shows real need.
- `max_age_days` as a soft expiry (auto-recompile in background).
- Hybrid section+hash ChunkId — pure content hash is the v2.0.0 contract.
- Separate `vault-memory daemon` CLI subcommand.
- ChangeFeed `since: cursor` parameter — v3 adapter-level enhancement.
- LLM-generated summaries in `list_briefs`.
- `brief_diff` tool — caller can compute client-side via `include_superseded: true`.
- Cluster-driven auto-recompile suggestions.
- v3 ChunkId hash-flavor switching (blake3 / xxhash).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **BRF-01** | Brief format + storage shape: `Document` in `_memory/_briefs/` with `compiled_from`, `compiled_at`, `source_hashes`, `confidence: inferred`, `target`, `purpose` | §Property Bag Shape + new `default-brief-v1` contract — solves the closed-enum conflict for `status: stale`; §Standard Stack `gray-matter` handles nested-object frontmatter round-trip (verified — see §Common Pitfalls Pitfall 4) |
| **BRF-02** | Phase 5 ADR resolves LLM strategy (MCP Sampling → local Ollama → caller-passed text; never bundle remote LLM SDK) | §Architecture Patterns §Pattern: LLM Ladder; ADR-005 outline in §Specific Ideas; ADR authored BEFORE implementation (matches Phase 0/2/4 discipline — plan 05-01) |
| **BRF-03** | `compile_brief({target, source_doc_ids, purpose, max_tokens})` MCP tool — returns `doc_id`; routes through `DeliveryAdapter` | §Standard Stack `@modelcontextprotocol/sdk@^1.29` `registerTool` pattern; D-12 auto-supersede chain wired through `handleSupersede` (existing) |
| **BRF-04** | `get_brief({target, max_age_days?, allow_stale?})` MCP tool — returns brief, `{stale: true, changed_sources}`, or `null` | §Architecture Patterns §Pattern: get_brief Decision Tree; reuses Phase 3 citation packet shape from `src/memory/tools/recall.ts:128` |
| **BRF-05** | Staleness daemon subscribes to `ChangeFeed.subscribe()` — hash-protected, atomic, marks stale on divergence | §Architecture Patterns §Pattern: Daemon Hash Loop; `ChangeFeed.subscribe()` fan-out semantics verified at `src/adapters/change-feed/obsidian-fs/change-feed.ts:216` (snapshot-then-iterate, errors caught per-handler) |
| **BRF-06** | Single-owner via `~/.vault-memory/locks/<vault>.lock` | §Standard Stack §Lockfile Mechanics; `fs.open(path, 'wx')` is POSIX-portable; `fs.mkdir` is the more portable backup for NFS — recommendation in §Architecture Patterns §Pattern: Lock Acquire |
| **BRF-07** | Daemon-startup replay handles missed events | §Architecture Patterns §Pattern: Hybrid Replay (startup full scan = correctness floor; cursor = steady-state hint) — D-09 |
| **BRF-08** | Rename-event handling preserves brief→source links | §Common Pitfalls Pitfall 5 + §Architecture Patterns §Pattern: Rename Survival — verified rename surfaces as `unlink+add` at `change-feed.ts:177`; recommendation: key `brief_sources.chunk_doc_id` off `chunks.doc_uri` (the opaque DocId per ADR-001) so a rename's delete-then-create cycle keeps the linkage stable AT THE DOC_URI LEVEL but loses it at the FK level — see §Runtime State Inventory |
| **BRF-09** | `list_briefs({target?})` as MCP Resource (not Tool) | §Architecture Patterns §Pattern: Resource Registration; `server.registerResource(name, uri, metadata, async (uri) => ...)` shape verified at `src/server.ts:1022` |
| **BRF-10** | 20-document brief eval — modify one source, brief flips `stale: true` within one change-feed cycle | §Validation Architecture; `_queries/briefs-curated.yaml` per D-02 (Atlas Robotics — ~75 notes existing, 20 already in `_memory/`) |
| **BRF-11** | Same staleness scenario passes against the stub `ChangeFeed` — source-neutrality | §Validation Architecture; extend `src/adapters/source/conformance.test.ts:141` parametric over `obsidian-fs` + stub; planner adds brief assertions to existing conformance table |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `compile_brief` MCP tool | API / MCP server | — | Phase 1 invariant: tools live in `src/server.ts` handler dispatch, delegating to domain modules |
| `get_brief` MCP tool | API / MCP server | Database (SQLite) | Tool handler reads brief Document + queries `brief_sources` for changed-source list |
| `list_briefs` MCP Resource | API / MCP server | Filesystem (read-only frontmatter scan) | Resource handler enumerates `_memory/_briefs/*.md` via `SourceConnector.listDocuments` — no FS or `gray-matter` in `src/brief/` |
| Brief body LLM compile | API → MCP client (Sampling) OR localhost:11434 (Ollama) OR pure-stitching (caller text) | — | D-10 ladder; no remote LLM SDK; vault-memory never embeds an LLM client beyond Ollama |
| Brief Document write | Domain (`src/brief/compile.ts`) → DeliveryAdapter chokepoint | Filesystem (atomic rename via `atomicWriteFile`) | Phase 2 invariant: ALL writes route through `DeliveryAdapter.write()` for validator + audit |
| `chunk_id_fragment` computation | Domain (`src/chunker/`) | Database (write at chunk insert) | Chunker is pure NFC + sha256; DB layer persists |
| Staleness daemon | Domain (`src/brief/daemon.ts`) | Database (audit_log writes), Filesystem (lock file at `~/.vault-memory/locks/`) | Daemon subscribes to a Phase 1 adapter (`ChangeFeed`); writes audit_log via `vault.db.audit`; lockfile via `os.homedir()` + raw `fs.open('wx')` (lock file is process-state, NOT vault content — adapter-seam discipline does NOT prohibit `fs` for lockfiles) |
| `brief_sources` reverse-index | Database | — | Pure SQLite table + query namespace; populated by domain layer |
| Lock acquire / release / liveness | Domain (`src/brief/lock.ts`) | OS (process.kill(pid, 0) for liveness) | Pure Node; no platform-specific package |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29` (already installed; verified at node_modules) | `registerTool` + `registerResource` + `server.createMessage()` for D-10 tier 1 | Already pinned by Phase 1 ADP-08; SDK 1.29 ships Sampling (`sampling/createMessage` JSON-RPC method); `Server.createMessage()` is the typed wrapper — three overloads at `server/index.d.ts:140-150` for backwards-compat (without tools), with-tools, and union |
| `better-sqlite3` | `^11.7` (installed) | Migration 013 + new query namespaces (`BriefSourcesQueries`, `DaemonStateQueries`) | Phase 0–4 substrate; synchronous = simpler transaction semantics inside daemon loop |
| `zod` | `^4` (already bumped Phase 1 ADP-09) | Input schemas for `compile_brief` + `get_brief`; brief-contract `propertiesSchema` Zod build | Phase 1 invariant; Standard Schema integration with MCP SDK 1.29 |
| `gray-matter` | `^4.0.3` (installed) | YAML frontmatter parse+serialize for brief writes (USED ONLY INSIDE `src/adapters/delivery/obsidian-fs/`) | Adapter-seam invariant — `gray-matter` import grep zero outside the obsidian-fs delivery adapter (CI-enforced by `scripts/lint-adapters.sh`); brief layer at `src/brief/` builds the `Document` and routes through `DeliveryAdapter.write()` which serializes via existing `matter.stringify(content, frontmatter)` at `src/adapters/delivery/obsidian-fs/write.ts:265` |
| Node 22 native `crypto.createHash('sha256')` | n/a (built-in) | `chunk_id_fragment = sha256(NFC(text)).slice(0,7)` | Already used in `src/sections/anchor.ts:39` and other paths; pure stdlib |
| Node 22 native `fs.promises.open` | n/a (built-in) | Lockfile atomic create via `'wx'` flag | No external dep needed; `'wx'` = `O_WRONLY | O_CREAT | O_EXCL`; works on POSIX + Windows for local filesystems (NOT NFS — operating env is local-vault per Roadmap §"Deployment model") |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `js-yaml` (transitive via gray-matter) | — | YAML schema for nested-object frontmatter (the `source_hashes` map) | Indirectly — `gray-matter.stringify` uses `js-yaml`'s `safeDump`; verified `Record<ChunkId, ChunkHash>` shape round-trips through it (see §Common Pitfalls Pitfall 4) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `fs.open('wx')` lockfile | `proper-lockfile` npm package | `proper-lockfile` uses `fs.mkdir()` for atomic create (slightly more portable on exotic filesystems); cost: external dep, larger surface. Not justified for local-vault deployment per CONTEXT operating environment. Sticking with `fs.open('wx')` keeps zero-dep. |
| `process.kill(pid, 0)` for PID liveness | Reading `/proc/<pid>` on Linux | `process.kill(pid, 0)` is cross-platform Node stdlib (verified on darwin via `node -e` returns `ESRCH` for dead PIDs); `/proc` is Linux-only. Stdlib wins. |
| Single-row `daemon_state` table | Per-vault state in `notes.frontmatter` or `audit_log` summary | `daemon_state` is introspectable (`SELECT * FROM daemon_state` answers "is my daemon current?"); audit_log scan to derive cursor is O(N) per boot. Justified per D-09 departure from recommendation. |
| MCP Sampling first | Ollama first | D-10 locked: capability-first lets the caller's environment (Claude Code, ChatGPT, generic MCP client) supply the LLM, preserving the "no premature LLM coupling" invariant. Ollama is tier 2 because it's vault-memory-side. |
| New `OllamaClient.chat()` method | Adopt `node-fetch` directly in `src/brief/compile.ts` | Adapter-seam discipline: `src/brief/` should call `vault.ollama.chat(...)` not raw `fetch`. Adding `chat()` to existing `OllamaClient` keeps the seam clean and matches the existing `embed()` retry/timeout/AbortController pattern at `src/ollama/client.ts:179`. |
| Branded `ChunkId` type | Plain `string` | Existing `DocId` is branded (`src/types.ts:347`); `ChunkId` SHOULD follow per ADR-001 opacity rule. Minting point: `src/brief/chunk-id.ts` exporting `parseChunkId` + `formatChunkId(docId, fragment)`. Sketch in §Code Examples below. |

**Installation:**

```bash
# No new runtime deps in Phase 5. Everything is already in package.json (post-Phase-4):
#   @modelcontextprotocol/sdk@^1.29  (verified — has CreateMessageRequestParamsSchema)
#   better-sqlite3@^11.7
#   zod@^4
#   gray-matter@^4.0.3
#   chokidar@^4.0.1
```

**Version verification:**

```bash
node -e "console.log(require('@modelcontextprotocol/sdk/package.json').version)"
# Confirmed by source: node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:4317
# exports CreateMessageResultSchema with stopReason ∈ {maxTokens, endTurn, stopSequence},
# verifying SDK is on the 1.29.x line that ships Sampling.
node -e "console.log(require('better-sqlite3/package.json').version)"
node -e "console.log(require('zod/package.json').version)"
# Post-Phase-1 lesson (STATE.md): MUST re-run `npm install` if SDK/Zod were
# bumped on a branch — npm dedupes to transitive versions otherwise.
```

## Package Legitimacy Audit

> **Not applicable to Phase 5.** No new external packages are installed (CONTEXT §Integration Points: "no new runtime deps in Phase 5"). All packages referenced above were vetted in earlier phases (Phase 1 SDK/Zod bumps, Phase 4 graphology deps). slopcheck not run — no install action to audit.

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MCP client (Claude Code / Claude Desktop / Inspector / ChatGPT connector)│
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ MCP JSON-RPC (stdio)
                                 │
┌────────────────────────────────▼─────────────────────────────────────────┐
│                    vault-memory serve  (one Node process)                │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ MCP server  (src/server.ts)                                     │   │
│   │   tools: …23 v1… 4 Phase 3… 3 Phase 4… +compile_brief +get_brief│   │
│   │   resources: list_sinks / memory_stats / +list_briefs           │   │
│   │   capabilities advertised: {tools, resources, sampling? (n/a)}  │   │
│   │   server.createMessage()  ←──── D-10 tier 1 (Sampling)          │   │
│   │   server.getClientCapabilities() ←── runtime D-10 dispatch      │   │
│   └────────┬────────────────────────────┬──────────────────────────┘   │
│            │                            │                                │
│            │  compile_brief / get_brief │  list_briefs (Resource)       │
│            ▼                            ▼                                │
│   ┌────────────────────────┐   ┌──────────────────────────────────┐    │
│   │ src/brief/compile.ts   │   │ src/brief/resources.ts            │    │
│   │   1. dedupe sources    │   │   read frontmatter via             │    │
│   │   2. citation packets  │   │   SourceConnector.listDocuments    │    │
│   │      (Phase 3 builder) │   │   (no `fs` in src/brief/)         │    │
│   │   3. LLM ladder:       │   └──────────────────────────────────┘    │
│   │      a. Sampling       │                                            │
│   │      b. ollama.chat()  │   ┌──────────────────────────────────┐    │
│   │      c. prepared_text  │   │ src/brief/daemon.ts               │    │
│   │      d. structured err │   │                                    │    │
│   │   4. BodyValidator     │   │  start(vault) {                    │    │
│   │      (D-11 wikilinks)  │   │    1. acquire lock (lock.ts)       │    │
│   │   5. DeliveryAdapter   │   │       on contention → log WARN     │    │
│   │      .write()  ◄───────┼─┐ │       + return (no daemon)         │    │
│   │   6. brief_sources     │ │ │    2. startup full scan            │    │
│   │      populate          │ │ │    3. changeFeed.subscribe(ev =>   │    │
│   │   7. D-12 supersede    │ │ │       checkStaleness(ev.id))       │    │
│   │      old brief if any  │ │ │    4. on shutdown: dispose         │    │
│   └────────────────────────┘ │ └──────────────────────────────────┘    │
│            │                  │           │                             │
│            ▼                  │           │  ChangeFeed shared with     │
│   ┌────────────────────────┐  │           │  VaultWatcher (Plan 01-05)  │
│   │ DeliveryAdapter        │  │           ▼                             │
│   │   (obsidian-fs)        │  │   ┌────────────────────────┐            │
│   │   validateAgentWrite() │  │   │ ObsidianFsChangeFeed   │            │
│   │   atomicWriteFile()    │  │   │ (chokidar-backed)      │            │
│   │   notes.upsertByPath() │  │   │ subscribe() fan-out    │            │
│   │   audit.recordWrite()  │◄─┘   │ to multiple handlers   │            │
│   └────────────────────────┘      └────────────────────────┘            │
│            │                                                             │
│            ▼                                                             │
│   ┌────────────────────────────────────────────────────────────┐        │
│   │  Database (per-vault SQLite at ~/.vault-memory/dbs/...)    │        │
│   │    notes, chunks (+chunk_id_fragment), edges, sections,    │        │
│   │    brief_sources [NEW], daemon_state [NEW], audit_log      │        │
│   └────────────────────────────────────────────────────────────┘        │
│            ▲                                                             │
│            │                                                             │
│   ┌────────┴───────────────────┐                                         │
│   │ Obsidian vault (file tree) │   `_memory/_briefs/*.md` ← new sink    │
│   │   /atlas/                  │   shared via Syncthing / iCloud / git  │
│   │   ├── projects/...         │                                         │
│   │   ├── meetings/...         │                                         │
│   │   ├── _memory/             │                                         │
│   │   │   ├── .memory-sink     │                                         │
│   │   │   ├── observations/    │                                         │
│   │   │   └── _briefs/  [NEW]  │                                         │
│   │   │       └── .memory-sink │                                         │
│   └────────────────────────────┘                                         │
└──────────────────────────────────────────────────────────────────────────┘

LLM tier 1 (MCP Sampling) — request flows ←── back to MCP client
LLM tier 2 (Ollama)        — POST localhost:11434/api/chat
LLM tier 3 (prepared_text) — bytes inside the compile_brief tool input
LLM tier 4 (structured error) — no LLM call; returned to caller
```

### Recommended Project Structure

```
src/brief/                          # NEW directory; ARCHITECTURE.md L4
├── index.ts                        # barrel re-export
├── compile.ts                      # `handleCompileBrief` — D-10/D-11/D-12
├── compile.test.ts
├── get.ts                          # `handleGetBrief` — D-13 decision tree
├── get.test.ts
├── daemon.ts                       # `BriefStalenessDaemon` class
├── daemon.test.ts
├── source-hashes.ts                # build & compare `Record<ChunkId, ChunkHash>`
├── source-hashes.test.ts
├── body-validator.ts               # D-11 `[[wikilink]]` check + Sources footer
├── body-validator.test.ts
├── lock.ts                         # acquire / release / isAlive
├── lock.test.ts
├── chunk-id.ts                     # parseChunkId / formatChunkId + brand
├── chunk-id.test.ts
├── llm-ladder.ts                   # resolveLlmStrategy(server, vault, args)
├── llm-ladder.test.ts
└── resources.ts                    # readListBriefs(registry, manager)
    resources.test.ts

src/db/queries/
├── brief_sources.ts                # NEW — INSERT/SELECT/DELETE namespace
├── brief_sources.test.ts
├── daemon_state.ts                 # NEW — getCursor / setCursor / vacuum
├── daemon_state.test.ts
└── chunks.ts                       # EXTEND — chunk_id_fragment field

src/ollama/
└── client.ts                       # EXTEND — add chat() method

src/memory/contract/
└── default-brief-v1.ts             # NEW — brief contract (see §Domain Discoveries)

src/server.ts                       # EXTEND — registerTool x2 + registerResource x1
src/tool-registry.ts                # EXTEND — compile_brief + get_brief
src/types.ts                        # EXTEND — Brief, ChunkId, BriefStatus, BriefSourceHash

docs/v2/adr/005-brief-compile-strategy.md   # NEW — D-10 + D-11 + D-12 ADR

evals/v1-baseline/tools-list.snapshot.json  # REGEN — additive
evals/fixtures/v2-test-vault/_queries/
├── briefs-curated.yaml             # NEW (D-02 primary)
├── briefs-from-cluster.yaml        # NEW (D-02 integration)
└── briefs-staleness-stub.yaml      # NEW (BRF-11 source-neutrality)
```

### Pattern: LLM Ladder (D-10)

**What:** Capability-first resolution per `compile_brief` call.
**When to use:** Every call to `compile_brief`.

```typescript
// src/brief/llm-ladder.ts (sketch)
// Source: SDK type signatures verified at
//   node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:121
//                                                              :140
//                                                              :150
import type { McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
import type { OllamaClient } from "../ollama/client.js";
import type { VaultConfig } from "../config/loader.js";

export type LlmStrategy =
  | { kind: "sampling" }
  | { kind: "ollama"; model: string }
  | { kind: "prepared_text" }
  | { kind: "unavailable"; attempted: string[] };

export function resolveLlmStrategy(
  server: McpServer,
  vault: { config: VaultConfig },
  preparedText: string | undefined,
): LlmStrategy {
  const attempted: string[] = [];

  // Tier 1: MCP Sampling capability check
  // — `getClientCapabilities()` returns the populated ClientCapabilities
  //   object AFTER the initialize handshake completes. The bootstrap
  //   ordering (server.connect → onPhase("start_catchup")) means
  //   compile_brief handlers ALWAYS run post-handshake, so this is safe.
  const caps = server.server.getClientCapabilities();
  if (caps?.sampling) {
    return { kind: "sampling" };
  }
  attempted.push("sampling");

  // Tier 2: per-vault Ollama config
  const ollamaModel = vault.config.brief?.ollama?.model;
  if (typeof ollamaModel === "string" && ollamaModel.length > 0) {
    return { kind: "ollama", model: ollamaModel };
  }
  attempted.push("ollama");

  // Tier 3: caller-supplied prepared_text
  if (typeof preparedText === "string" && preparedText.length > 0) {
    return { kind: "prepared_text" };
  }
  attempted.push("prepared_text");

  // Tier 4: structured error — caller's responsibility
  return { kind: "unavailable", attempted };
}

// LLM tier dispatch:
async function compileWithLlm(
  strategy: LlmStrategy,
  server: McpServer,
  ollama: OllamaClient,
  prompt: { systemText: string; userText: string },
  maxTokens: number,
): Promise<{ body: string; model: string }> {
  switch (strategy.kind) {
    case "sampling": {
      // Source: node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:140
      // createMessage(params: CreateMessageRequestParamsBase, options?: RequestOptions)
      //   → Promise<CreateMessageResult>
      // CreateMessageResult content is a SINGLE discriminated union block
      //   (text | image | audio) — for brief-compile we expect type === "text"
      const result: CreateMessageResult = await server.server.createMessage({
        messages: [
          { role: "user", content: { type: "text", text: prompt.userText } },
        ],
        maxTokens,
        systemPrompt: prompt.systemText,
      });
      if (result.content.type !== "text") {
        throw new Error(
          `MCP Sampling returned non-text content (type=${result.content.type}); brief compile expects text.`,
        );
      }
      return { body: result.content.text, model: result.model };
    }
    case "ollama": {
      // Tier 2 — new OllamaClient.chat() method (D-10; add in plan 05-02)
      const res = await ollama.chat({
        model: strategy.model,
        messages: [
          { role: "system", content: prompt.systemText },
          { role: "user", content: prompt.userText },
        ],
        options: { num_predict: maxTokens },
      });
      return { body: res.message.content, model: strategy.model };
    }
    case "prepared_text": {
      // tier 3 — caller provided the text; vault-memory only stitches.
      // Caller's prepared_text becomes the brief body verbatim.
      return { body: "<filled in by caller>", model: "prepared_text" };
    }
    case "unavailable": {
      throw new BriefLlmUnavailableError(strategy.attempted);
    }
  }
}
```

**Key SDK fact:** `Server.createMessage` has THREE overloads (`server/index.d.ts:137-150`):

```typescript
createMessage(params: CreateMessageRequestParamsBase, options?: RequestOptions): Promise<CreateMessageResult>;
createMessage(params: CreateMessageRequestParamsWithTools, options?: RequestOptions): Promise<CreateMessageResultWithTools>;
createMessage(params: CreateMessageRequest['params'], options?: RequestOptions): Promise<CreateMessageResult | CreateMessageResultWithTools>;
```

For brief compile, the **first overload** applies — we don't pass `tools`, so the result is the simpler `CreateMessageResult` shape with `content: { type: "text"|"image"|"audio", ... }` (single block, NOT array).

**Capability detection:** `server.server.getClientCapabilities()` returns `ClientCapabilities | undefined`. The Phase 5 Sampling check is **structural presence**: if `caps?.sampling` is truthy (any object), the client declared sampling support. Per SDK types (`types.d.ts:572`), `ClientCapabilities.sampling` is an OPTIONAL object — its mere presence (even empty) signals capability.

**Error semantics on client refusal:** If the client rejected the Sampling request (e.g., user denied in an interactive UI), the SDK throws a JSON-RPC error response. Plan 05-02 should catch and re-throw as a structured `BriefLlmSamplingRefusedError` so the tool returns a clear `{ok: false, reason: "sampling_refused"}` rather than an opaque MCP error.

### Pattern: ChangeFeed Multi-Handler Fan-Out (D-07)

**What:** Daemon co-subscribes alongside `VaultWatcher` to the same `ObsidianFsChangeFeed` instance.
**When to use:** Server bootstrap; one daemon per vault, one watcher per vault, both `subscribe()` the shared feed.

**Verified behavior** (`src/adapters/change-feed/obsidian-fs/change-feed.ts`):

| Property | Verified at | Behavior |
|----------|-------------|----------|
| Multiple handlers per feed | `:112` `private readonly handlers = new Set<...>` | Yes — `subscribe()` adds to a Set; multiple handlers each get every event |
| Handler ordering | `:216-218` `for (const handler of [...this.handlers])` | Iteration order = Set insertion order (Node 12+ guarantee). **Daemon's order vs Watcher's depends on which `subscribe()` call runs first.** Recommendation: daemon subscribes AFTER watcher start so any sync init the watcher needs runs first. Order DOES NOT affect correctness — both handlers are idempotent. |
| Sync vs async dispatch | `:218-227` | **Sync dispatch.** Handler is invoked synchronously inside `fanout()`; if the handler returns a Promise, `fanout` attaches a `.catch()` for log-and-swallow but doesn't await. Daemon handler can be async — its async work runs without blocking the watcher's handler. |
| Error isolation | `:220` `try { ... } catch { log message }` | **Each handler is try/wrapped.** A throw in one handler does NOT break delivery to the other. Async-rejection variant is also caught (`:223 .catch()`). |
| Disposable lifecycle | `:138-141` `[Symbol.dispose]: () => { this.handlers.delete(handler); }` | TS 5.2+ `using`-aware. Plan 05-02 daemon should hold the `Disposable` and dispose in `shutdown()`. |
| Suppression set sharing | `:198 this.suppression.consume(relativePath)` | Suppression filters BEFORE fanout — both handlers (watcher + daemon) skip own-writes uniformly. This means a brief write through `DeliveryAdapter` will NOT trigger a phantom daemon staleness check (Pitfall 3 in §Common Pitfalls). |

**Concrete recommendation for plan 05-02:** Server bootstrap subscribes daemon AFTER each vault's watcher in the `startCatchupAndWatchers` loop (around `src/server.ts:329`). Daemon's handler is async and returns a `Promise<void>`; per the verified fan-out semantics, this is safe.

### Pattern: Lock Acquire (D-08)

**What:** Atomic `~/.vault-memory/locks/<vault>.lock` ownership with stale-detection.
**When to use:** Daemon start; once per vault per server boot.

```typescript
// src/brief/lock.ts (sketch — copy at slice 3 planning time)
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, unlink, mkdir } from "node:fs/promises";

export interface LockResult {
  acquired: boolean;
  /** PID of the current owner (us if acquired:true, the other process if false). */
  ownerPid: number;
  /** True iff we replaced a stale lock owned by a dead PID. */
  reclaimedStale?: boolean;
}

/**
 * Atomic exclusive create + write own PID. POSIX 'wx' = O_WRONLY|O_CREAT|O_EXCL.
 * On contention, read existing PID and probe liveness via process.kill(pid, 0).
 * Returns {acquired: true, ownerPid: process.pid} on success.
 *
 * Cross-platform: works on macOS, Linux, Windows for LOCAL filesystems.
 * NFS / SMB exclusive-create is unreliable — operating environment is
 * local-vault-on-local-disk per Roadmap §"Deployment model", so this is fine.
 */
export async function tryAcquireLock(vaultName: string): Promise<LockResult> {
  const lockDir = join(homedir(), ".vault-memory", "locks");
  await mkdir(lockDir, { recursive: true });
  const lockPath = join(lockDir, `${vaultName}.lock`);

  try {
    const fh = await open(lockPath, "wx");
    await fh.writeFile(String(process.pid));
    await fh.close();
    return { acquired: true, ownerPid: process.pid };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

    // Lock exists — read owner PID and probe liveness
    const ownerPidStr = await readFile(lockPath, "utf8").catch(() => "");
    const ownerPid = Number.parseInt(ownerPidStr.trim(), 10);

    if (Number.isFinite(ownerPid) && isProcessAlive(ownerPid)) {
      return { acquired: false, ownerPid };
    }

    // Stale lock — race to reclaim. Best-effort delete + retry.
    try {
      await unlink(lockPath);
      const fh = await open(lockPath, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      return { acquired: true, ownerPid: process.pid, reclaimedStale: true };
    } catch {
      // Another contender beat us. Re-read the (now non-stale) PID.
      const newPid = Number.parseInt(
        (await readFile(lockPath, "utf8").catch(() => "")).trim(),
        10,
      );
      return { acquired: false, ownerPid: Number.isFinite(newPid) ? newPid : 0 };
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // process.kill(pid, 0) is a liveness probe: no signal sent, just permission check.
    // Throws ESRCH if pid does not exist; EPERM if exists but we lack permission
    // (treat EPERM as "alive — different user owns it").
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false; // dead
    if (code === "EPERM") return true; // alive but ours-not-to-touch
    return false; // treat unknown as dead — conservative
  }
}

export async function releaseLock(vaultName: string): Promise<void> {
  const lockPath = join(homedir(), ".vault-memory", "locks", `${vaultName}.lock`);
  await unlink(lockPath).catch(() => {
    /* idempotent; race-safe */
  });
}
```

**Verified behavior (`node -e "process.kill(99999, 0)"` on darwin 25.4.0):**

```
kill(99999,0) error code: ESRCH
```

✅ Confirms `process.kill(pid, 0)` is a viable liveness probe on macOS. Node docs confirm same behavior on Linux + Windows (Windows uses `OpenProcess(pid)` internally with the same ESRCH-equivalent error semantics).

**Adapter-seam-discipline note:** This file uses raw `node:fs/promises`. **That's allowed for lockfiles** — the lockfile is process-state at `~/.vault-memory/`, NOT vault content. `scripts/lint-adapters.sh` enforces "no `fs.*` outside `src/adapters/*/`" against VAULT CONTENT access; check the script's allow-list before slice-3 lands to confirm `src/brief/lock.ts` is excluded (it should pattern-match the existing exclusion for `src/audit/` and `src/db/` which also legitimately touch `~/.vault-memory/`). Slice 1 ADR should document this carve-out explicitly so the CI lint doesn't fight us.

### Pattern: Hybrid Replay (D-09)

**What:** Startup full scan (correctness floor) + DB cursor `daemon_state(vault_name, last_seen_doc_mtime)` (efficiency hint).
**When to use:** Daemon startup; on every change-feed event.

```typescript
// src/brief/daemon.ts (sketch)
export class BriefStalenessDaemon {
  private disposable: Disposable | null = null;

  async start(vault: Vault, feed: ChangeFeed): Promise<void> {
    const lock = await tryAcquireLock(vault.config.name);
    if (!lock.acquired) {
      process.stderr.write(
        `WARN: brief staleness daemon already owned by PID ${lock.ownerPid} ` +
          `for vault "${vault.config.name}" — briefs will be marked stale only ` +
          `by the other process.\n`,
      );
      return;
    }

    // Step 1: Read cursor for diagnostics; cursor is NOT a skip-scan optimization
    //         in v2.0.0 — the startup scan is mandatory for correctness floor.
    const cursor = vault.db.daemonState.getCursor(vault.config.name) ?? 0;
    const startWallTime = Date.now();

    // Step 2: Full scan — every brief in `_memory/_briefs/` × every chunk in
    //         that brief's `source_hashes` × recompute current chunk hash.
    //         Reverse-lookup goes through brief_sources: walk every brief,
    //         join brief_sources → chunks (current state) on (chunk_doc_id,
    //         chunk_id_fragment), compare recorded_hash vs current hash.
    const briefs = vault.db.briefSources.listBriefDocIds(); // SELECT DISTINCT brief_doc_id
    for (const briefId of briefs) {
      await this.evaluateBrief(vault, briefId); // marks stale if any hash diverges
    }
    vault.db.daemonState.setCursor(vault.config.name, this.maxNoteMtime(vault));

    process.stderr.write(
      `[daemon:${vault.config.name}] startup scan: ${briefs.length} briefs, ` +
        `cursor was ${cursor}, took ${Date.now() - startWallTime}ms\n`,
    );

    // Step 3: Live — subscribe to change feed. On every event, look up
    //         affected briefs in O(log N) via brief_sources(chunk_doc_id).
    this.disposable = feed.subscribe(async (event) => {
      if (event.kind === "delete") {
        // Affected briefs become stale (source disappeared); per BRF-05 mark them
        await this.markStaleByDocId(vault, event.id, "source_deleted");
        return;
      }
      // create/update — recompute chunks, compare against recorded_hash
      await this.evaluateChangedDocId(vault, event.id);
      vault.db.daemonState.setCursor(vault.config.name, Date.now());
    });
  }

  async shutdown(): Promise<void> {
    if (this.disposable) this.disposable[Symbol.dispose]();
    // Release lock LAST so a crash mid-shutdown leaves the lock for stale-detection
    await releaseLock(vault.config.name);
  }

  // … evaluateBrief, evaluateChangedDocId, markStaleByDocId …
}
```

### Pattern: Migration 013 Backfill (D-05)

**What:** Add `chunks.chunk_id_fragment TEXT NOT NULL` + populate for existing rows.
**When to use:** Plan 05-01 (slice 1) — sole structural migration of Phase 5.

**Verified template** — `runMigration008` at `src/db/schema.ts:443-464` is the canonical pattern for a one-pass UPDATE backfill. For Phase 5 the backfill is CPU-only (no I/O — pure sha256 of NFC-normalized text already stored in `chunks.text`). Steps:

```typescript
// src/db/schema.ts — appended to MIGRATIONS array as version 13
function runMigration013(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  // Step A: idempotent DDL
  const cols = db.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "chunk_id_fragment")) {
    // NOT NULL with empty-string default — backfill populates in Step C
    // (an empty fragment is impossible after backfill because sha256 always
    //  produces 7 hex chars; a "" value at runtime signals a chunker bug)
    db.exec(`
      ALTER TABLE chunks ADD COLUMN chunk_id_fragment TEXT NOT NULL DEFAULT ''
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_fragment ON chunks(chunk_id_fragment)
  `);

  // Step B: NEW tables (combined with this migration because they're co-introduced
  //         and the planner reviews them as a unit)
  db.exec(`
    CREATE TABLE IF NOT EXISTS brief_sources (
      brief_doc_id      TEXT NOT NULL,
      chunk_id_fragment TEXT NOT NULL,
      chunk_doc_id      TEXT NOT NULL,
      recorded_hash     TEXT NOT NULL,
      UNIQUE(brief_doc_id, chunk_id_fragment)
    );
    CREATE INDEX IF NOT EXISTS idx_brief_sources_chunk_doc
      ON brief_sources(chunk_doc_id);
    CREATE INDEX IF NOT EXISTS idx_brief_sources_fragment
      ON brief_sources(chunk_id_fragment);

    CREATE TABLE IF NOT EXISTS daemon_state (
      vault_name             TEXT PRIMARY KEY,
      last_seen_doc_mtime    INTEGER NOT NULL
    );
  `);

  // Step C: zero-row short-circuit (matches runMigration008:447)
  const pending = db
    .prepare<[], { c: number }>(
      "SELECT COUNT(*) AS c FROM chunks WHERE chunk_id_fragment = ''",
    )
    .get();
  if (!pending || pending.c === 0) return;

  // Step D: chunked backfill — 10k rows per batch (matches runMigration011 pattern)
  //         Per CONTEXT specifics: ~10µs per sha256 on Node 22 ARM64; a 100k-chunk
  //         vault completes in ~1 second. Chunking still recommended to keep the
  //         transaction small if a much larger vault appears.
  const CHUNK = 10_000;
  const selectBatch = db.prepare<[number, number], { id: number; text: string }>(`
    SELECT id, text FROM chunks
     WHERE chunk_id_fragment = ''
       AND id > ?
     ORDER BY id ASC
     LIMIT ?
  `);
  const updateOne = db.prepare(
    "UPDATE chunks SET chunk_id_fragment = @fragment WHERE id = @id",
  );

  let lastId = 0;
  while (true) {
    const batch = selectBatch.all(lastId, CHUNK);
    if (batch.length === 0) break;
    for (const row of batch) {
      const fragment = computeChunkIdFragment(row.text);
      updateOne.run({ id: row.id, fragment });
    }
    lastId = batch[batch.length - 1]!.id;
    if (batch.length < CHUNK) break;
  }
}

function computeChunkIdFragment(text: string): string {
  // Per D-04 + ADR-003 H-3 (NFC) + H-5 (chunk-level source_hashes)
  // Reuses the same NFC + sha256 idiom from src/sections/anchor.ts:39
  const canonical = text.normalize("NFC");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 7);
}
```

**Migration numbering note:** CONTEXT.md says "migration 012" three times but **migration 012 is already taken by Phase 4 CR-01** (`src/db/schema.ts:768` widens `idx_edges_unique`). Phase 5 must use **migration 013**. This is a small CONTEXT.md error to flag to the planner — not a substantive issue.

### Pattern: Rename Survival (BRF-08)

**What:** Brief→source links survive when a source `.md` is renamed by the user.
**When to use:** Always; the daemon must not mass-mark briefs stale when a user renames an unrelated note.

**Verified behavior** — chokidar surfaces rename as `unlink + add` (`change-feed.ts:177-178`). The `obsidian-fs` indexer (`src/indexer/single.ts:283-292`) handles `delete` by `vault.db.notes.deleteByPath(relativePath)`, which cascades `chunks` (FK `ON DELETE CASCADE`). Then `indexNote` on the `add` event INSERTs a fresh `notes` row with a new `notes.id` and re-chunks. The chunks have the SAME `text` so the new `chunk_id_fragment` values equal the old ones; the `doc_uri` is rebuilt as `obsidian-fs://<vault>/<new-path>`.

**Implications for `brief_sources`:**

| Approach | What Happens on Rename | Verdict |
|----------|------------------------|---------|
| Key `brief_sources.chunk_doc_id` off `chunks.id` (FK) | Old chunks.id deleted by CASCADE → orphaned brief_sources rows → daemon scan misses changed source → brief stays "fresh" but actually stale | ❌ BROKEN |
| Key `brief_sources.chunk_doc_id` off `notes.path` (string) | Old path string deleted on rename → daemon lookup `WHERE chunk_doc_id = '<old_path>'` finds nothing on the source's update event → BRIEF NEVER FLIPS STALE on a content edit after rename | ❌ BROKEN (BRF-08 failure) |
| Key `brief_sources.chunk_doc_id` off `notes.doc_uri` (the opaque DocId per ADR-001) | Same string-broken-by-rename problem as path — `doc_uri` is `<scheme>://<vault>/<path>` and the path changes on rename | ❌ Surface-level wrong, BUT see fix below |
| Key `brief_sources.chunk_doc_id` off `notes.doc_uri` + **add an indexer hook that UPDATEs orphaned brief_sources rows on rename** | When `indexNote` detects an existing brief_sources row pointing at the OLD doc_uri after a rename, it updates the row to the NEW doc_uri. Daemon then re-evaluates fresh on the next change event. | ✅ Recommended — minimal complexity |

**Recommended fix for plan 05-03 (the daemon slice):** Detect rename as a TWO-step pattern in the daemon's handler:

1. On `kind: delete`, do NOT immediately delete `brief_sources` rows. Instead, defer for a short grace period (e.g., 5 seconds) and check if a matching `create` event with the same `chunks.text` set arrives.
2. If a matching create lands within the window, treat it as a rename — UPDATE all `brief_sources` rows where `chunk_doc_id = <old_doc_uri>` SET `chunk_doc_id = <new_doc_uri>`, then re-evaluate the affected briefs against the new chunks (hashes should match, briefs stay fresh).
3. If no matching create within the window, fully delete the rows and mark all referencing briefs `stale` with reason `source_deleted`.

**Alternative simpler fix** (recommended over the rename-detection grace window): make `brief_sources.chunk_doc_id` reference the **source note's stable identifier** rather than its mutable `doc_uri`. Today, `notes.id` is the only stable identifier post-rename — and it ISN'T stable across rename because the delete-then-insert cycle gets a fresh AUTOINCREMENT id (`notes.upsertByPath` at `src/db/queries/notes.ts:123` only re-uses the existing id if the row matched on `path`). Since the path is what changed during a rename, the new row gets a new `id`.

**Verdict: rename in Obsidian-FS is genuinely lossy of identity** — there is no stable identifier today other than the path. The grace-window approach is the only viable fix. Planner should:

- Document this in ADR-005 §"Rename handling" explicitly.
- Add a slice-3 task: extend the daemon's event handler with the grace-window pattern.
- Add an eval scenario: `briefs-rename.yaml` — compile a brief, rename a source, verify the brief stays fresh.

**Phase 10 / v3 forward-compatibility note:** A future Notion adapter declares `ChangeFeedCapabilities.emitsRename: true` (`src/adapters/change-feed/types.ts:64`). The daemon's handler should switch on `event.kind === "rename"` directly when available, sidestepping the grace-window heuristic. This is already in the type union (`ChangeEvent.kind: "create" | "update" | "delete" | "rename"`) — Phase 5 just doesn't see that variant from `obsidian-fs`.

### Pattern: Resource Registration (BRF-09)

**What:** Register `list_briefs` as an MCP Resource, not a Tool.
**When to use:** Once at server bootstrap; matches Phase 2 `list_sinks` shape verbatim.

```typescript
// src/server.ts — extend after existing memory-stats registration (line :1042)
// Source pattern: src/server.ts:1022-1041 (Phase 2 memory-sinks)
server.registerResource(
  "briefs",
  RESOURCE_URI_LIST_BRIEFS, // = "vault-memory://briefs"
  {
    title: "Compiled briefs",
    description:
      "Compiled briefs by target. Read to discover what briefs exist and whether they're stale. " +
      "URI format: vault-memory://briefs (no query string yet — Phase 5 lists all briefs).",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(readListBriefs(memorySinkRegistry, manager), null, 2),
      },
    ],
  }),
);
```

**Verified pattern facts:**

- `server.registerResource(name, uriString, metadata, handler)` — 4-arg form used in Phase 2 (`src/server.ts:1022`, `:1042`).
- Handler returns `{contents: [{uri, mimeType, text}]}` — inline content in the list response (no separate `resources/read` round-trip).
- The MCP client reads via `resources/list` then `resources/read` — both routed through the same registered handler. The current `src/server.ts:353` advertises `resources: {}` capability so polling is supported.
- Multi-vault fan-out is handled at the **handler level** (the resource builder reads from the `manager` which holds all vaults). No special URI scheme work needed — `vault-memory://briefs` is global and the JSON payload includes `vault` per entry.
- URI matching: SDK 1.29's `registerResource` accepts either a literal URI string or a `ResourceTemplate` for parameterized URIs. The CONTEXT lean of `vault-memory://briefs/{vault}?target=<pattern>` uses a query string, which `registerResource` supports via the literal URI (the handler can parse `uri.searchParams.get('target')` from the passed `URL` object). Slice 4 planner: keep it literal — query-string filter is optional for v2.0.0; if any pattern logic is needed, parse `target` from `uri.searchParams`.

### Anti-Patterns to Avoid

- **Daemon writes brief frontmatter directly to disk.** ❌ Must route through `DeliveryAdapter.update(briefId, {properties: {status: "stale", changed_sources: [...]}}, {expectedHash, sink})` to satisfy MEM-05 validator + audit_log + suppression-set. Mirror the `handleSupersede` pattern at `src/memory/tools/supersede.ts:117`.
- **`src/brief/` imports `gray-matter` or `chokidar` or raw `fs`.** ❌ All read/watch goes through `SourceConnector` + `ChangeFeed`; all writes through `DeliveryAdapter`. The ONLY `fs` allowed in `src/brief/` is `src/brief/lock.ts` (process state at `~/.vault-memory/locks/`, not vault content) — slice 1 ADR documents this carve-out.
- **`compile_brief` baking in `cluster()` or `expand()` calls.** ❌ D-01 explicit — source discovery is the agent's responsibility; Phase 5 is a pure compiler.
- **Storing `chunk_id` (the AUTOINCREMENT integer FK) inside `brief_sources`.** ❌ Per BRF-08, FK breaks on rename CASCADE. Use the public `chunk_id_fragment` (content-stable per D-04) + `chunk_doc_id` (the source `doc_uri`).
- **Computing `chunk_id_fragment` outside `src/chunker/`.** ❌ Chunker is the source of truth; centralize the NFC + sha256 + slice(0,7) idiom in `src/chunker/chunk-id.ts` and re-export from the chunker barrel.
- **Using the v1 `defaultMemorySink` (handled by Phase 2 default `_memory/`) for briefs.** ❌ See "Sub-Folder Resolution" — closed-enum on `status` rejects `status: stale`. Register `_memory/_briefs/` as a separate sink with the new `default-brief-v1` contract.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lockfile contention with PID liveness | Custom timeout-based lease renewal | `fs.open(path, 'wx')` + `process.kill(pid, 0)` | Node stdlib already handles atomic exclusive create; PID liveness via `kill(pid, 0)` works cross-platform. No `proper-lockfile` dep needed for local vaults. |
| YAML frontmatter serialization | DIY YAML writer for `source_hashes` nested map | Existing `matter.stringify(content, frontmatter)` at `src/adapters/delivery/obsidian-fs/write.ts:265` | `gray-matter` + `js-yaml` round-trip nested `Record<string, string>` (verified: keys containing `#` like `obsidian-fs://...#chunk-a3f5b2c` are quoted automatically). Adapter-seam disallows touching `gray-matter` from `src/brief/`. |
| MCP Resource handler / Tool handler dispatch | Custom JSON-RPC handler | `server.registerResource()` + `server.registerTool()` | SDK 1.29 ships both; Phase 2 already uses both. |
| Sampling capability detection | Custom "ask the client" round-trip | `server.server.getClientCapabilities()` | Returns `ClientCapabilities | undefined` AFTER the SDK initialize handshake — vault-memory's bootstrap completes the handshake before tool handlers are reachable. |
| Concurrent-write OCC | Custom version-vector or vector-clock | Existing `expectedHash: oldDoc.hash` pattern at `src/memory/tools/supersede.ts:117` | The hash-protected `DeliveryAdapter.update()` already implements optimistic concurrency control. Daemon's "mark stale" write is one OCC update per brief; conflicts return `hash_mismatch` which the daemon logs and retries on next event. |
| Chunked SQL backfill | One giant UPDATE | `runMigration008` chunked pattern (verified at `schema.ts:443`) | Synchronous SQLite + sha256 of 100k chunks ≈ 1 second total, but transaction size matters for any user with a larger vault — chunk at 10k rows. |
| Brief → source back-edge population | Custom edges.insert calls from `compile.ts` | Phase 4 D-02 unified indexer parse pass | When the new `_memory/_briefs/*.md` lands on disk, chokidar fires `add`, the indexer parses the body's `[[wikilinks]]`, and writes edges automatically. **CRITICAL VERIFY in slice 4:** confirm no path-prefix filter exempts `_memory/` from indexing — see §Common Pitfalls Pitfall 6. |

**Key insight:** Every problem listed above has an established pattern in the codebase or stdlib. Phase 5 is **integration heavy, invention light** — the surfaces are new, but every mechanism is already in the toolkit.

## Runtime State Inventory

> Phase 5 is greenfield additions, NOT a rename/refactor/migration phase. **Section partially applies** — there is real runtime state (lockfiles, daemon cursor, brief_sources reverse-index) that needs lifecycle thinking, and the BRF-08 rename concern is genuinely runtime-state-shaped.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `chunks.chunk_id_fragment` (new column, ALL rows backfilled in migration 013); `brief_sources` (new table, populated on first brief compile); `daemon_state` (new table, single row per vault, lazy-create on first daemon boot); `_memory/_briefs/*.md` (new on-disk documents via DeliveryAdapter) | Migration 013 backfills chunk_id_fragment one-shot; brief_sources + daemon_state are append-on-use; no historical data migration needed |
| Live service config | Per-vault `[brief.ollama] model` in `config.toml` (NEW key) — optional, gates D-10 ladder tier 2 | Plan 05-01 extends `src/config/loader.ts` Zod schema with optional `brief?: { ollama?: { model: string } }` |
| OS-registered state | `~/.vault-memory/locks/<vault>.lock` PID file — created at daemon start, released at shutdown, stale on crash (handled by D-08 stale-lock detection); macOS/Linux only paths (`os.homedir()` resolves correctly on Windows but `~/.vault-memory` directory layout is the same) | Plan 05-03 manages lifecycle in `src/brief/lock.ts` + server shutdown handler at `src/server.ts:332` |
| Secrets/env vars | None — Phase 5 adds no env vars; `VAULT_MEMORY_ACTIVE_VAULT` unchanged | None |
| Build artifacts | None — Phase 5 is source-only; tsup bundle picks up new modules automatically (no `tsup.config.ts` change); `dist/cli.js` rebuilds normally; no new package needs `external` declaration | None |

**Renamed source file from a brief perspective:** Genuinely a runtime-state migration. The brief's `source_hashes` map keys off `ChunkId = <doc_uri>#chunk-<fragment>`. When the user renames `meetings/2026-04-12.md` → `archive/2026-04-12.md`, every brief citing that doc loses its source-doc identity at the `<doc_uri>` level (the path component changed). The Phase 4 indexer doesn't update `chunks.doc_uri` in place — it deletes the old `notes` row (CASCADE drops chunks) and inserts a fresh `notes` row + new chunks. So the OLD brief_sources rows are orphaned. **The fix is mechanical, NOT a data migration:** the daemon detects rename via the grace-window pattern (§Pattern: Rename Survival) and updates `brief_sources.chunk_doc_id` in place. No backfill needed because rename is rare and the grace window catches it live.

## Common Pitfalls

### Pitfall 1: `status: stale` violates the closed `default-memory-v1` enum

**What goes wrong:** Brief writes carry `status: stale` per D-13 / BRF-04, but `src/memory/contract/default-v1.ts:40` defines `status: z.enum(["active", "superseded", "archived"])`. Any brief write under the existing `_memory/` sink (which uses `default-memory-v1`) fails validation with `invalid_provenance, key: "status"`.

**Why it happens:** Phase 2 closed the status enum to enable cross-field invariants (`status === "superseded"` ⇒ `superseded_by` non-null). Phase 5 introduces a fourth lifecycle state that Phase 2 didn't anticipate.

**How to avoid:**
1. Plan 05-01 (slice 1) authors `src/memory/contract/default-brief-v1.ts` modeled on `default-v1.ts` but with status enum widened to `{active, stale, superseded, archived}` + `source_hashes: z.record(z.string()).optional()` + `target: z.string().min(1)` + `purpose: z.string().min(1)` + `compiled_from: z.array(z.string()).min(1)` + `compiled_at: z.string().datetime({offset: true})`.
2. Plan 05-01 also extends config to register `_memory/_briefs/` as a separate `[[memory_sinks]]` entry with `contract = "default-brief-v1"`, so the registry `findSinkContaining` (which uses `startsWith` ordered by insertion order at `src/memory/registry.ts:189-202`) resolves `_memory/_briefs/foo.md` to the brief sink BEFORE falling through to the broader `_memory/` sink. **Insertion order matters** — register the more specific `_memory/_briefs/` first.
3. Phase 5 ADR-005 documents the new contract as a "specialized memory contract" with rationale: briefs are observations like any other, but their lifecycle includes a derived state (stale) that observations don't have.

**Warning signs:** Slice-2 integration test that writes a brief with `status: active` to `_memory/_briefs/` succeeds, but the moment the daemon flips it to `stale` (slice 3), the validator rejects the update with `invalid_provenance`. Catching this in slice 1 ADR is much cheaper.

### Pitfall 2: `cluster()` orchestration baked into `compile_brief`

**What goes wrong:** Phase 4 sign-off note says "brief compiler will use cluster() over _memory + expand()" — the planner reads this as "compile_brief calls cluster() internally." But D-01 locks the contract as caller-supplied sources.

**Why it happens:** Phase 4 sign-off describes the AGENT'S calling pattern, not the brief layer's API. D-01 makes the brief a pure compiler.

**How to avoid:** Plan 05-02 reviewer (`/gsd:plan-check`) explicitly asserts that `src/brief/compile.ts` imports NOTHING from `src/graph/` (no `cluster` or `expand`). The eval `briefs-from-cluster.yaml` (D-02) tests the integration AT THE EVAL LEVEL — the runner calls `cluster({seed})` then passes results to `compile_brief`. The brief tool itself stays pure.

### Pitfall 3: Daemon writes to a brief trigger phantom staleness re-checks

**What goes wrong:** Daemon updates a brief's `status: stale`. The DeliveryAdapter performs atomic-rename, chokidar fires `change`, the daemon's own handler receives the event, looks up the brief in `brief_sources`, recomputes hashes, no source diverged, re-marks as `active`. Infinite loop possible if any of those steps has a logic bug.

**Why it happens:** Daemon and DeliveryAdapter share the same chokidar feed; the suppression-set mechanism (`change-feed.ts:198`) protects against ALL own-writes including the daemon's.

**How to avoid:** Verified: the DeliveryAdapter's `atomicWriteFile` already calls `suppression.add(relativePath)` before the rename (`src/adapters/delivery/obsidian-fs/write.ts:268 onBeforeFsWrite?.()`). The change-feed `consume()`s on the next event and DROPS it before any handler runs (`change-feed.ts:198-201`). So the daemon's own writes do NOT trigger phantom checks. **Slice 3 test gate:** integration test "daemon writes brief.status=stale → no second change-feed event observed by the daemon's handler."

### Pitfall 4: `Record<ChunkId, ChunkHash>` round-trip through YAML

**What goes wrong:** Brief writes `source_hashes: {"obsidian-fs://atlas/Atlas-1.md#chunk-a3f5b2c": "sha256:f0a1b2..."}` to frontmatter. YAML serializers may quote, escape, or reorder keys; on read-back, the parsed object may not equal the original.

**Why it happens:** `gray-matter` uses `js-yaml`'s default `safeDump` for serialization. js-yaml DOES quote keys containing special characters (`:`, `#`, `/`) — verified by inspection of `node_modules/gray-matter/lib/engines.js` and the YAML spec. Key ordering: js-yaml preserves insertion order by default since v3.0.

**How to avoid:**
1. Plan 05-02 ships a round-trip test in `src/brief/compile.test.ts`: write a brief with `source_hashes: {<10 entries>}` → read via `SourceConnector.readDocument` → assert `JSON.stringify(roundtripped) === JSON.stringify(original)`. If this test fails, the key shape needs adjustment (e.g., replace `#` with `__` in the serialized form, decode on read — recommended only as a fallback).
2. Real-world risk is LOW because the keys are URL-encoded-shape strings without spaces, multi-byte characters, or control chars. The `#chunk-` separator is the only suspect, but `#` is not a YAML special char inside a quoted string (which js-yaml uses for any key with `:`).
3. Additional safety: write the `source_hashes` as a **stringified JSON value** rather than a nested YAML object — e.g., `source_hashes: '{"obsidian-fs://atlas/Atlas-1.md#chunk-a3f5b2c":"sha256:f0a1b2..."}'`. Loses YAML readability but eliminates the round-trip risk entirely. **Recommendation:** start with nested YAML, fall back to JSON-string IF the round-trip test fails.

### Pitfall 5: Rename ⇒ chunks lose FK identity, brief_sources orphaned

**What goes wrong:** See §Pattern: Rename Survival. Briefly: chokidar surfaces rename as `unlink+add`; the indexer DELETEs the old `notes` row (cascading `chunks`) and INSERTs a fresh one. `brief_sources` rows pointing at the old `chunks.id` are orphaned; rows pointing at the old `doc_uri` are stale.

**Why it happens:** No first-class rename event in chokidar; ADP-03 explicitly preserves this v1 behavior in Phase 1.

**How to avoid:** Grace-window heuristic in daemon (5-second buffer); update `brief_sources.chunk_doc_id` on detected rename; ADR-005 §"Rename handling" documents the limitation. Phase 10 / v3 Notion connector emits first-class `rename` events — the daemon switches on `event.kind === "rename"` directly when available.

### Pitfall 6: Indexer skips `_memory/` paths

**What goes wrong:** Phase 4 D-02 indexer relies on `add` events for the new `_memory/_briefs/*.md` files to extract wikilinks and create back-edges. If any path filter exempts `_memory/` from indexing, brief → source back-edges never form, and BRF-09 + Phase 4 GRA-05 expand-from-brief queries quietly miss results.

**Why it happens:** It's tempting to filter `_memory/` out of v1 search results, and a misplaced filter at the indexer (rather than at search-time) would break this invariantly.

**How to avoid:** Verified at `src/adapters/change-feed/obsidian-fs/change-feed.ts:191` and `:186-191` (`watcher.ts:117`): the only filter is `.md` extension. No path-prefix exclusion of `_memory/`. The `_memory/` opacity is enforced at QUERY TIME (Phase 4 D-16: `expand()` skips `_memory/` docs in BFS unless transitively reachable from a user-note seed). **Slice 4 verifier**: a smoke test that writes a brief, waits one debounce cycle, then queries `expand({seed_doc_ids: [<source_doc_id>], hops: 1})` and asserts the brief appears in the expansion as `relation: "wikilink"` (back-edge from source to brief).

### Pitfall 7: Two `compile_brief` calls with same target race the supersede chain

**What goes wrong:** Two agents concurrently call `compile_brief({target: "atlas-q3"})`. Both look up the prior brief; both write a new brief (different timestamped slugs); both call `supersede(prior, new1, "recompiled")` and `supersede(prior, new2, "recompiled")`. Phase 2 supersede is forward-only and atomic per MEM-04 — but two callers writing the SAME `superseded_by` field on the SAME prior brief is a hash-OCC conflict on the second one.

**Why it happens:** Both reads happen before either write commits; both think the prior brief is the canonical one to supersede.

**How to avoid:** The Phase 2 `handleSupersede` (`src/memory/tools/supersede.ts:117`) passes `expectedHash: oldDoc.hash`. The second caller's update fails with `hash_mismatch`. The caller should retry: re-fetch the (now-superseded) brief, find its forward `superseded_by`, and supersede the NEW current brief instead. Two consecutive supersedes is acceptable per CONTEXT discretion ("a chain of two superseded briefs and one active. Acceptable."). **Slice 2 test gate:** integration test "two concurrent `compile_brief` calls with same target produce a chain of length 2." Eventually-consistent at `target` — `get_brief({target})` always returns the most recent non-superseded.

### Pitfall 8: `chunks.text` may include trailing newlines that the hash includes

**What goes wrong:** Chunker preserves trailing whitespace and newlines (`src/chunker/chunker.ts:96 const text = content.slice(start, end)`). Two visually identical chunks may differ by a trailing `\n`, producing different fragments. A user fixes a trailing whitespace in their markdown editor → every chunk in the affected note re-hashes → every brief citing that note marks stale → mass-invalidation cascade.

**Why it happens:** sha256 is byte-exact; the chunker doesn't normalize beyond NFC.

**How to avoid:** D-04 says "NFC normalization." Plan 05-01 ADR should add **explicit normalization spec**: `canonical = chunk.text.replace(/\r\n/g, "\n").trimEnd().normalize("NFC")` (CR/LF → LF per ADR-003 H-4 + trim trailing whitespace + NFC per H-3). This makes `chunk_id_fragment` invariant to editor-induced whitespace noise. **Slice 1 ADR test:** chunk with text `"# Hello\n\n"` and `"# Hello"` produce the SAME fragment.

## Code Examples

### Brief Document property bag (D-04, D-05, D-11)

```typescript
// What a brief's Document looks like in memory before write.
// Source: ADR-003 + MEMORY_CONTRACT.md + CONTEXT §Domain — verified against
// src/memory/tools/record-observation.ts (Phase 2 pattern) at a Document level.
const brief: Document = {
  id: parseDocId(
    "obsidian-fs://atlas/_memory/_briefs/atlas-q3-status--20260518T1430.md",
  ),
  source: parseSourceHandle("obsidian-fs://atlas"),
  blocks: [
    { kind: "heading", level: 1, text: "Brief: atlas-q3-status" },
    { kind: "paragraph", text: "Atlas-1 is positioned for two-shift uptime by EOQ3 …" },
    { kind: "paragraph", text: "Per [[Atlas-1]] (project doc) and [[2026-04-15 Q2 OKR Review]] (meeting)…" },
    // D-11: at least one [[wikilink]] per source_doc_id; BodyValidator
    //       appends a `## Sources` heading + missing links if any source is unreferenced
  ],
  hash: "sha256:…", // computed by DeliveryAdapter post-write
  mtime: 1716000000000,
  title: "atlas-q3-status",
  display_url: "obsidian://open?vault=atlas&file=_memory%2F_briefs%2Fatlas-q3-status--20260518T1430.md",
  properties: {
    // Phase 2 contract keys (required by default-brief-v1)
    source: "agent",
    confidence: "inferred",
    evidence: [
      "obsidian-fs://atlas/projects/Atlas-1.md",
      "obsidian-fs://atlas/meetings/2026-04-15-q2-okr-review.md",
    ],
    status: "active",           // valid in `default-brief-v1` (widened enum)
    observed_at: "2026-05-18T14:30:00Z",
    superseded_by: null,
    type: "brief",
    // Phase 5 brief-specific keys (D-04, D-05)
    target: "atlas-q3-status",
    purpose: "Synthesize current state of Atlas-1 for the Q3 OKR review prep",
    compiled_from: [
      "obsidian-fs://atlas/projects/Atlas-1.md",
      "obsidian-fs://atlas/meetings/2026-04-15-q2-okr-review.md",
    ],
    compiled_at: "2026-05-18T14:30:00Z",
    source_hashes: {
      "obsidian-fs://atlas/projects/Atlas-1.md#chunk-a3f5b2c": "sha256:f0a1b2c…",
      "obsidian-fs://atlas/projects/Atlas-1.md#chunk-d8e9f01": "sha256:7c8d9e0…",
      "obsidian-fs://atlas/meetings/2026-04-15-q2-okr-review.md#chunk-12abc34": "sha256:1234567…",
    },
  },
};
```

### `ChunkId` brand + minting (D-04)

```typescript
// src/brief/chunk-id.ts — sketch
import type { DocId } from "../types.js";

// Branded type; matches DocId/SourceHandle pattern in src/types.ts:347
export type ChunkId = string & { readonly __brand: "ChunkId" };

const FRAGMENT_REGEX = /^[0-9a-f]{7}$/;

export function formatChunkId(docId: DocId, fragment: string): ChunkId {
  if (!FRAGMENT_REGEX.test(fragment)) {
    throw new Error(
      `Invalid chunk_id_fragment "${fragment}" — must be 7 lowercase hex chars (sha256 prefix).`,
    );
  }
  return `${docId}#chunk-${fragment}` as ChunkId;
}

export function parseChunkId(s: string): ChunkId {
  const hashIdx = s.indexOf("#chunk-");
  if (hashIdx < 0) {
    throw new Error(`ChunkId missing "#chunk-" separator: ${s}`);
  }
  const fragment = s.slice(hashIdx + "#chunk-".length);
  if (!FRAGMENT_REGEX.test(fragment)) {
    throw new Error(
      `ChunkId fragment "${fragment}" is not 7 lowercase hex chars: ${s}`,
    );
  }
  // The DocId portion is validated for shape by parseDocId at the call site;
  // we don't re-parse here to avoid circular ChunkId ↔ DocId imports.
  return s as ChunkId;
}

export function decomposeChunkId(id: ChunkId): { docId: string; fragment: string } {
  const hashIdx = id.indexOf("#chunk-");
  return {
    docId: id.slice(0, hashIdx),
    fragment: id.slice(hashIdx + "#chunk-".length),
  };
}
```

### Adding `chat()` to `OllamaClient` (D-10 tier 2)

```typescript
// src/ollama/client.ts — extend the existing class
// Source pattern: mirrors `embed()` at :81 (batching, retry, timeout)
// Verified: existing client only wires /api/embed and /api/tags; no chat endpoint yet.

const ChatResponseSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  model: z.string().optional(),
  done_reason: z.string().optional(),
});

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  options?: {
    num_predict?: number; // analogous to max_tokens
    temperature?: number;
  };
}

export interface ChatResponse {
  message: { role: string; content: string };
  model: string;
}

// inside class OllamaClient {…}:
async chat(request: ChatRequest): Promise<ChatResponse> {
  return withRetry(
    async () => {
      const body = JSON.stringify({
        model: request.model,
        messages: request.messages,
        options: request.options ?? {},
        stream: false, // brief compile is a single-shot completion
      });
      const response = await this.fetchWithTimeout(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new OllamaHttpError(
          response.status,
          `Ollama /api/chat returned ${response.status}: ${text}`,
        );
      }

      const json: unknown = await response.json();
      const parsed = ChatResponseSchema.parse(json);
      return {
        message: { role: parsed.message.role, content: parsed.message.content },
        model: parsed.model ?? request.model,
      };
    },
    { retries: this.retries, shouldRetry: isRetryable },
  );
}
```

**Verified facts about `OllamaClient`:**

- Only `/api/embed` (`client.ts:118`) and `/api/tags` (`:145`) are wired today; **no `/api/chat`** — confirmed by exhaustive grep of `src/ollama/`.
- Existing retry policy (`isRetryable` at `:46`) covers `OllamaHttpError` 5xx + `AbortError` + `TypeError` (fetch network errors). Re-used for `chat()` without change.
- `fetchWithTimeout` (`:179`) uses `AbortController` with `DEFAULT_TIMEOUT_MS = 30_000` — appropriate for chat (Ollama can take a few seconds on a long prompt; if a real-world brief compile needs more, the daemon's `chat()` invocation can pass a longer override via a new `timeoutMs` parameter, but slice 2 defaults are fine).
- `OllamaHttpError` (`:37`) is the only error class — no new error class needed.

### Multi-handler ChangeFeed subscribe (slice 3 bootstrap)

```typescript
// src/server.ts — extend after watcher.start() at :327
// Source: server.ts:330 (the current code); :337 (shutdown disposes change-feeds);
// :249 (changeFeed registered per-vault).

const briefDaemons = new Map<string, BriefStalenessDaemon>();
for (const vault of manager.list()) {
  // Skip vaults without an embedding model (already done above for watchers)
  if (!vault.config.embedding_model && !vault.db.models.getActive()) continue;

  const feed = changeFeeds.get(vault.config.name);
  if (!feed) continue; // should never happen; defensive

  const daemon = new BriefStalenessDaemon();
  await daemon.start(vault, feed); // subscribes via feed.subscribe(handler) inside
  briefDaemons.set(vault.config.name, daemon);
}

// Extend shutdown handler at :332
const shutdown = async (): Promise<void> => {
  for (const d of briefDaemons.values()) {
    await d.shutdown();
  }
  for (const w of watchers.values()) {
    await w.drain();
    await w.stop();
  }
  for (const cf of changeFeeds.values()) {
    await cf.close();
  }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-build Markdown briefs in `_memory/` via `record_observation` | `compile_brief` with chunk-level source-hash staleness | Phase 5 (this phase) | Defeats 85%-rediscovery; signature differentiator |
| Briefs as static blobs (no staleness) | Briefs with `source_hashes` + daemon | Phase 5 | Bridges retrieval and authority/staleness (Phase 3 ASM-07 was static); briefs now first-class graph nodes |
| Ordinal chunk index (`<DocId>#chunk-3`) | Content-stable hash fragment (`<DocId>#chunk-a3f5b2c`) | Phase 5 D-04 | Unedited chunks don't invalidate briefs when neighbors change; cross-user-runtime collaboration via Syncthing stays coherent |
| Tool-only memory ops | Tool + Resource mix (`list_briefs` Resource) | Phase 5 BRF-09 | REL-08 tool budget ≤32 with Resource promotion preserved (32→34 tools is over; `list_briefs` as Resource keeps 34 tools = REL-08 +2 over the ≤32 target, **planner verifies** — counted below) |
| LLM tightly coupled to vault-memory | MCP Sampling first, Ollama second, prepared_text third, structured error fallback | Phase 5 D-10 | Preserves "no premature LLM coupling" + "no bundled remote LLM SDK" v2 invariants |

**Deprecated/outdated:**
- v1 `wikilinks` table is still present (Phase 4 D-01 preserved it for invariance); Phase 5 reads from the new `edges` table only — no `wikilinks` reads.

## Tool Budget Headroom (REL-08)

**Current state (verified):** `evals/v1-baseline/tools-list.snapshot.json` contains exactly **32 tools** (Phase 4 sign-off).

**Phase 5 delta:** +2 tools (`compile_brief`, `get_brief`); +1 Resource (`list_briefs` is NEW, never a Tool).

**Net:** 32 → **34 tools** + 1 new Resource. This is **2 over** the REL-08 ≤32-with-Resources-promotion target.

**Recommendation to planner:** Acknowledge in plan 05-01 ADR. Options:
1. Accept temporary breach with a Phase 8 (REL-08) clean-up commitment to promote 2 existing v1 tools to Resources (candidates: `list_vaults`, `list_models` are read-only enumerations). The CONTEXT.md "REL-08 ≤32 tools" is a **release-gate target**, not a per-phase invariant — Phase 5 can breach if Phase 8 closes the gap.
2. (NOT RECOMMENDED) Defer one of `compile_brief` / `get_brief` to Phase 6 — both are core to BRF-01..BRF-04 so this just moves the breach.

Pick option 1. Phase 8 plan 08-XX can include the additional promotion.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Migration 013 is the next free version (CONTEXT.md said "012" but Phase 4 already shipped 012) | Pattern: Migration 013 Backfill | Low — verified at `src/db/schema.ts:899` (last entry is v12); planner just needs to use 013 |
| A2 | `default-memory-v1.passthrough()` allows brief-specific extra keys to coexist | Pitfall 1 | Verified at `default-v1.ts:47` — `.passthrough()` is explicit. Brief-specific keys (`target`, `purpose`, `compiled_from`, `compiled_at`, `source_hashes`) will NOT be rejected by `default-memory-v1`; the ONLY blocker is `status: stale`. A more pragmatic fix than a new contract is to **widen the existing `default-memory-v1.status` enum to include `"stale"`** — but that requires a Phase 2 ADR amendment, which is more invasive than a new brief-specific contract. RECOMMENDATION: new contract. |
| A3 | `gray-matter` + `js-yaml` round-trip `Record<ChunkId, ChunkHash>` keys containing `#` and `:` correctly | Pitfall 4 | Medium — must be empirically validated by slice-2 test. Mitigation path documented (fallback to stringified JSON value) |
| A4 | `process.kill(pid, 0)` works the same on Windows as macOS/Linux | Pattern: Lock Acquire | Low — operating environment is local-disk-only per Roadmap §"Deployment model"; verified on darwin. Windows would surface different error code semantics for EPERM (vs Linux) but for THIS daemon we only need to know "alive vs dead," not "is it ours" — both platforms throw ESRCH for "dead." |
| A5 | `src/brief/lock.ts` is exempt from the `lint-adapters.sh` `fs.*` invariant (process state, not vault content) | Pattern: Lock Acquire + Anti-Patterns | Medium — must verify by running the script BEFORE slice 3 lands; the existing exclusions for `src/audit/` and `src/db/` suggest this carve-out is acceptable, but it needs to be explicitly added to the script (or `// vault-memory:lockfile-ok` escape comment, mirroring the `// vault-memory:claude-ok` pattern at `scripts/lint-adapters.sh:39`). Plan 05-01 verifier should confirm. |
| A6 | The Phase 4 unified indexer (`src/indexer/resolver.ts`) correctly extracts `[[wikilinks]]` from a brief's body on chokidar `add` events for `_memory/_briefs/*.md` | Pitfall 6 + Don't Hand-Roll | Verified at `change-feed.ts:191` and `watcher.ts:117` (no path-prefix filter); slice-4 verifier should confirm the back-edge actually appears in `expand()` results |
| A7 | The `daemon_state.last_seen_doc_mtime` is BIGINT-sized in SQLite to avoid Year-2038 overflow | Pattern: Migration 013 Backfill | Low — SQLite INTEGER is 64-bit; `Date.now()` returns ms-since-epoch and fits comfortably |
| A8 | The MCP client's Sampling capability is **structurally** present (any object on `caps.sampling`) — not a feature-flag boolean | Pattern: LLM Ladder | Verified at `types.d.ts:572` — `sampling: z.ZodOptional<z.ZodObject<{...}>>` means presence ⇒ declared. **No further capability negotiation needed.** |
| A9 | The MCP SDK `Server.createMessage()` ASYNCHRONOUSLY round-trips to the client and throws on user denial / client refusal | Pattern: LLM Ladder | Cited by SDK docs and inferred from JSON-RPC nature; **plan 05-02 should add a try/catch around `createMessage` to translate any throw into a `BriefLlmSamplingRefusedError`** |

## Open Questions (RESOLVED)

> All four open questions resolved by plan-checker review before execution. Each question carries an inline `**RESOLVED:**` marker pointing to the plan task that implements it.

1. **Slice 2 vs Slice 3 boundary for the staleness ladder.** The MVP slice recommendation in §Summary puts the full ladder (Sampling + Ollama + prepared_text + structured error) in slice 2. But if slice 2 wants to be even thinner, it could ship **only** Sampling (the recommended default for Claude Code) and defer Ollama + prepared_text to slice 4. Tradeoff: slice 2 demos end-to-end against any Sampling-capable MCP client (Claude Code, Inspector); slice 4 widens compatibility.
   - **What we know:** Sampling alone is enough to prove the architecture.
   - **What's unclear:** Whether the planner wants a working Ollama path in slice 2 for offline/dev iteration.
   - **RESOLVED:** Full ladder ships in slice 2 — 05-02 Task 5-02-01 implements Sampling + Ollama + prepared_text + structured error tiers together. Structured-error path tested at slice-2 sign-off ("no LLM configured" returns `{ok: false, reason: "no_llm_strategy_available"}` cleanly).

2. **`max_age_days` units and semantics in `get_brief`.** CONTEXT D-13 specifies the decision tree but not the unit precision. Days as integer? Fractional days? Seconds?
   - **RESOLVED:** Integer days, computed as `Math.floor((Date.now() - Date.parse(compiled_at)) / 86_400_000)` — implemented in 05-02 Task 5-02-03 (`get_brief` decision tree). Test boundary: a brief compiled exactly 24 hours ago is age 1, not age 0.

3. **`compile_brief` input validation for `source_doc_ids` membership.** D-01 says "validate they're all in the same vault as target" — but `target` is a slug, not a DocId.
   - **RESOLVED:** Vault taken from call-site's `vault_name` context (per existing tool dispatch); all `source_doc_ids` validated via `decomposeDocId(id).authority === vault.config.name`. Reject with `{ok: false, reason: "cross_vault_sources", offending: [...]}` otherwise. Implemented in 05-02 Task 5-02-02 behavior 6 + action step 3.

4. **Whether the daemon's startup full scan blocks the MCP server's `tools/list` response.** Today, `startCatchupAndWatchers()` is fire-and-forget (`src/server.ts:1077`) AFTER `server.connect(transport)`.
   - **RESOLVED:** Daemon start plugs into the same post-connect fire-and-forget callback — startup scan runs in the background; agent-visible tools are usable immediately. **Plan 05-03 Task 5-03-03 step 2** places `startBriefDaemons` after `startCatchupAndWatchers` in the same fire-and-forget chain.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All of Phase 5 | ✓ | ≥22 (CLAUDE.md pinned; runtime confirmed by `package.json engines`) | — |
| `@modelcontextprotocol/sdk` | Sampling tier + Resource registration | ✓ | `^1.29` (Phase 1 ADP-08; verified at `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts`) | — |
| Ollama (`localhost:11434`) | D-10 tier 2 only | Optional | Whatever the user has running; vault-memory checks via `OllamaClient.healthCheck()` | If absent, ladder falls through to tier 3 (prepared_text) then tier 4 (structured error) |
| `better-sqlite3` | Migration 013, new query namespaces | ✓ | `^11.7` (existing) | — |
| `gray-matter` | Used ONLY in `src/adapters/delivery/obsidian-fs/` for frontmatter serialization (Brief writes use it transitively) | ✓ | `^4.0.3` | — |
| `chokidar` | ChangeFeed (Phase 1); daemon subscribes to it | ✓ | `^4.0.1` | — |
| MCP client with Sampling capability | D-10 tier 1 default | Optional | — | Ladder tiers 2-3-4 cover absence |

**No new dependencies required.** All capabilities derive from packages installed in Phase 0-4.

## Validation Architecture

> Phase 5 is `workflow.nyquist_validation: true` (default). The phase is heavy on integration tests against the live ChangeFeed + DeliveryAdapter, plus 3 new eval YAMLs.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^2.1.8` (existing) |
| Config file | `package.json` (defaults used; no `vitest.config.ts`) |
| Quick run command | `npm test -- src/brief/` (Phase 5 unit + integration tests) |
| Full suite command | `npm test` (1211 tests + Phase 5 additions; expected +100-150 net) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| BRF-01 | Brief Document property shape | unit | `npm test -- src/brief/compile.test.ts -t 'writes Document with required properties'` | ❌ Slice 2 |
| BRF-02 | ADR-005 ships before implementation | manual | (commit gate: `git log docs/v2/adr/005-brief-compile-strategy.md` predates `git log src/brief/compile.ts`) | ❌ Slice 1 |
| BRF-03 | `compile_brief` MCP tool returns doc_id | integration | `npm test -- src/brief/compile.test.ts -t 'returns new brief DocId on success'` | ❌ Slice 2 |
| BRF-04 | `get_brief` decision tree (stale/too_old/null/fresh) | unit | `npm test -- src/brief/get.test.ts` (5 sub-tests for decision tree branches) | ❌ Slice 2 |
| BRF-05 | Daemon flips `status: stale` on source-chunk hash divergence | integration | `npm test -- src/brief/daemon.test.ts -t 'marks brief stale within one change-feed cycle'` | ❌ Slice 3 |
| BRF-06 | Lockfile contention → second server logs WARN | integration | `npm test -- src/brief/lock.test.ts -t 'second acquire returns acquired:false with ownerPid'` | ❌ Slice 3 |
| BRF-07 | Startup full scan finds briefs missed while daemon was offline | integration | `npm test -- src/brief/daemon.test.ts -t 'startup scan reconciles state without runtime events'` | ❌ Slice 3 |
| BRF-08 | Rename event preserves brief→source links | integration | `npm test -- src/brief/daemon.test.ts -t 'rename grace-window updates brief_sources'` | ❌ Slice 3 |
| BRF-09 | `list_briefs` is a Resource, not a Tool | snapshot | `npm test -- evals/v1-baseline/baseline.test.ts -t 'tool list contains compile_brief and get_brief but NOT list_briefs'` + check `tools-list.snapshot.json` | ❌ Slice 4 |
| BRF-10 | 20-doc brief, modify one source, brief flips stale within 1 cycle | eval | `npm test -- evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml` | ❌ Slice 3 |
| BRF-11 | Same scenario passes against stub `ChangeFeed` | conformance | `npm test -- src/adapters/source/conformance.test.ts -t 'staleness over stub change-feed'` + `briefs-staleness-stub.yaml` | ❌ Slice 4 |

### Sampling Rate

- **Per task commit:** `npm test -- src/brief/<changed-area>` (quick — affected slice only; <30s typical)
- **Per wave merge:** `npm test` (full Phase 5 suite + v1-baseline regression; <90s on M1; <2min on CI)
- **Phase gate:** Full `npm test` green + `npm run eval:baseline` + `bash scripts/lint-adapters.sh` + `npm run lint:check` + 3 eval YAMLs (`briefs-curated.yaml`, `briefs-from-cluster.yaml`, `briefs-staleness-stub.yaml`) green; then `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `src/brief/` directory + barrel `index.ts` — new module space; slice 1 creates
- [ ] `src/db/queries/brief_sources.ts` — new query namespace; slice 1
- [ ] `src/db/queries/daemon_state.ts` — new query namespace; slice 1
- [ ] `src/memory/contract/default-brief-v1.ts` — new contract; slice 1
- [ ] Test fixtures for the daemon (stub `ChangeFeed` with hand-crafted events; reuse `src/adapters/stub/` infrastructure from Phase 1) — slice 3
- [ ] `evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml` (extension of existing `brief.yaml`)
- [ ] `evals/fixtures/v2-test-vault/_queries/briefs-from-cluster.yaml`
- [ ] `evals/fixtures/v2-test-vault/_queries/briefs-staleness-stub.yaml`
- [ ] `docs/v2/adr/005-brief-compile-strategy.md` — slice 1

## Security Domain

> `security_enforcement` is not explicitly set in `.planning/config.json`. Default = enabled. Phase 5 is local-only by invariant (no network beyond `localhost:11434`); ASVS surface is narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | vault-memory is single-user-runtime; no auth surface in v2 |
| V3 Session Management | no | MCP session = stdio transport; no session tokens |
| V4 Access Control | partial | MemorySink `findSinkContaining` + brief sink (slice 1) — access control on brief writes is "writer must be `source: agent`"; enforced at `DeliveryAdapter.write()` via validator; verified at `src/memory/validator.ts:115` |
| V5 Input Validation | yes | Zod 4 schemas on `compile_brief` + `get_brief` inputs; `source_doc_ids` length cap (D-03 lean 50); `purpose` text-length sanity (planner discretion); `DocId` brand validates URI shape; `ChunkId` brand validates fragment shape |
| V6 Cryptography | yes (passive use) | sha256 of NFC-normalized chunk text for `chunk_id_fragment`; sha256 of canonical content for `Document.hash` (existing). Never hand-roll. Uses Node stdlib `crypto.createHash('sha256')`. |
| V7 Error Handling | yes | Structured errors per CONTEXT (`{ok: false, reason: ..., hint: ...}`) — no stack-trace leakage to MCP responses. Daemon errors logged to stderr + `audit_log`, not surfaced over MCP. |
| V8 Data Protection | no | No PII handling beyond what's already in the user's vault notes; vault contents stay local |
| V9 Communications | partial | Network only to `localhost:11434` (Ollama); Sampling routes through MCP transport (stdio) — no outbound HTTP/S |
| V10 Malicious Code | yes | No remote LLM SDK bundled; no telemetry (lint-no-telemetry.sh in Phase 0); MCP Sampling content is treated as untrusted markdown (the brief body validator's `[[wikilink]]` extraction sanitizes for `[[name]]` shape only, no eval / no innerHTML) |

### Known Threat Patterns for the Phase 5 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Sampling-injected malicious brief body (e.g., crafted Markdown attempting path injection in `[[link]]` targets) | Tampering | `BriefBodyValidator` only EXTRACTS `[[wikilinks]]` for back-edge purposes (consumed by Phase 4 D-02 indexer); the body content itself is plain markdown stored as-is. No execution context exists in v2 reads. Phase 7 Canvas editor will need additional sanitization but is out of scope. |
| Daemon overwrites a user note's frontmatter (silently corrupting `_memory/_briefs/foo.md`) | Tampering / Repudiation | MEM-05 validator + `expectedHash` OCC; daemon's `update()` carries `expectedHash` and fails-fast on `hash_mismatch` |
| Two daemons racing the same lock file leading to interleaved staleness updates | Tampering | `fs.open('wx')` atomic create + PID-stamped lock + `kill(pid, 0)` liveness; only one daemon ever writes at a time |
| TOCTOU on chunk hash recompute (file changes between `readDocument` and hash compare) | Tampering | Daemon re-reads via `SourceConnector.readDocument(id)` which returns `Document.hash` computed at read time; this hash is what the staleness check compares against `recorded_hash` |
| Information disclosure via `audit_log` entries containing brief content | Information Disclosure | Audit entries contain only metadata (op, doc_id, hashes, timestamps) — never brief body text; verified at `src/db/queries/audit.ts` (single-line summary only) |
| Sampling-induced infinite loop (LLM keeps requesting more tokens) | DoS | `max_tokens` hard cap on every `compile_brief` call (D-10 ladder threads `maxTokens` through to `createMessage` / Ollama `num_predict`); SDK 1.29 enforces the cap at the JSON-RPC layer |

## Sources

### Primary (HIGH confidence)

- `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:534, :572, :3578-3680, :4317-4378, :8104-8116` — Sampling capability declaration + `CreateMessageRequest` / `Result` shapes
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:121, :140-150` — `getClientCapabilities()` + `createMessage()` overloads
- `src/adapters/change-feed/types.ts:79-109` — `ChangeFeed.subscribe` / `Disposable` contract; rename semantics
- `src/adapters/change-feed/obsidian-fs/change-feed.ts:96-234` — fan-out semantics (`handlers: Set`), suppression integration, sync dispatch with async-error catch
- `src/adapters/change-feed/obsidian-fs/watcher.ts:78-179` — `VaultWatcher` shape; the rename = unlink+add mapping
- `src/db/schema.ts:443-464, :641-726, :768-835, :837-902` — migration runners 008/011/012 + MIGRATIONS array (confirms 013 is next free)
- `src/db/queries/notes.ts:44-136` — `upsertByPath` semantics on rename (delete + fresh INSERT → new AUTOINCREMENT id)
- `src/memory/validator.ts:55-199` — `validateAgentWrite` full Phase 2 chokepoint behavior
- `src/memory/contract/default-v1.ts:35-83` — DEFAULT_MEMORY_V1 closed status enum (the Pitfall 1 source-of-truth)
- `src/memory/registry.ts:189-202` — `findSinkContaining` `startsWith` matcher + insertion-order traversal
- `src/memory/tools/supersede.ts:53-121` — Phase 2 forward-only supersede contract; OCC via `expectedHash`
- `src/memory/resources/list-sinks.ts` + `src/server.ts:1022-1061` — MCP Resource registration template (`server.registerResource(name, uri, metadata, async (uri) => ({contents: [...]}))`)
- `src/ollama/client.ts:62-188` — existing OllamaClient pattern for `chat()` extension
- `docs/v2/MEMORY_CONTRACT.md:127-146` — `status` enum (`active | superseded | archived`) — the canonical spec
- `docs/v2/adr/003-document-shape.md` (read via CONTEXT canonical_refs; Invariants H-3 NFC, H-4 LF, H-5 ChunkId schema)
- Node 22 stdlib `process.kill(pid, 0)` semantics — verified directly on darwin via `node -e`

### Secondary (MEDIUM confidence)

- WebSearch on `proper-lockfile` vs `fs.open('wx')` patterns — confirms `wx` is POSIX-portable for local filesystems; `proper-lockfile` is an alternative not justified for local-vault use
- `evals/v1-baseline/tools-list.snapshot.json` — 32 v2-Phase-4 tools count via Python check

### Tertiary (LOW confidence)

- Sampling client-refusal error semantics — inferred from SDK shape + JSON-RPC standard, not directly observed. Plan 05-02 should add an empirical test against MCP Inspector to confirm the error shape.
- `gray-matter` + `js-yaml` round-trip for keys containing `#` and `:` — likely correct per YAML 1.2 spec, but Pitfall 4 mitigation path documents a fallback if the slice-2 round-trip test fails.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every package version verified at `node_modules/` or `package.json`; SDK type signatures inspected directly
- Architecture patterns: HIGH — all patterns rooted in either ADR-002 / ADR-004 (canonical) or existing code (verified by line number)
- Pitfalls: HIGH for #1, #2, #3, #5, #6, #7, #8 (verified against code); MEDIUM for #4 (mitigation path exists but empirical verification deferred to slice 2)
- LLM ladder ergonomics: HIGH (SDK overloads inspected) for tier 1 + 2; MEDIUM for tier 1 client-refusal semantics
- Lockfile mechanics: HIGH on POSIX/macOS; MEDIUM on Windows (test recommended but operating env is local-mac/linux-disk per Roadmap deployment model)

**Research date:** 2026-05-18
**Valid until:** Roughly 30 days — every load-bearing fact is anchored to a code line or ADR section. The only non-version-stable claim is the SDK Sampling shape, which is unlikely to change in a 1.29.x patch.
