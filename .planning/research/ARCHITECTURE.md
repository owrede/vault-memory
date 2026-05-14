# Architecture Patterns — v2 Agentic Knowledge Layer

**Domain:** Multi-source local-first agentic knowledge layer over Obsidian, layered on the existing vault-memory v1.0.0 retrieval substrate.
**Researched:** 2026-05-14
**Mode:** Ecosystem (architecture dimension of project research)
**Overall confidence:** MEDIUM-HIGH

This document answers nine architectural questions raised by the v2 brief and ADRs 001–004. It does **not** re-derive v1 architecture (see `.planning/codebase/ARCHITECTURE.md`). It maps how comparable 2026 systems are structured so the roadmap can pick a build order.

---

## 0. Layer Model (recommended)

The brief and Phase 0's ADRs already imply this stack; making it explicit anchors the rest of the document:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  L4 — Task Contracts (Phase 7–8)                                           │
│       YAML DSL · canvas authoring · instantiate_contract                   │
├───────────────────────────────────────────────────────────────────────────┤
│  L3 — Assembly (Phase 3–6)                                                 │
│       get_document_bundle · get_outline · search_sections ·                │
│       assemble_dossier · compile_brief · staleness daemon                  │
├───────────────────────────────────────────────────────────────────────────┤
│  L2 — Memory Typology & Provenance (Phase 2)                               │
│       record_observation · recall · supersede · MemorySink registry        │
├───────────────────────────────────────────────────────────────────────────┤
│  L1 — Graph & Structure (Phase 4–5)                                        │
│       typed Edges · authority/staleness signals · expand · cluster         │
├───────────────────────────────────────────────────────────────────────────┤
│  L0 — Retrieval substrate (v1, unchanged)                                  │
│       hybrid search (semantic + BM25 + RRF + rerank) · chunker · embeds    │
├───────────────────────────────────────────────────────────────────────────┤
│  Adapter seam (Phase 1)                                                    │
│       SourceConnector · DeliveryAdapter · ChangeFeed · capability descriptors │
│       Registry (handle parser, factory map)                                │
├───────────────────────────────────────────────────────────────────────────┤
│  Implementations                                                           │
│       obsidian-fs (v2)            │ notion-api (v3, Phase 10)              │
└───────────────────────────────────────────────────────────────────────────┘
```

The seam is the only horizontal interface; every L1+ component talks to data exclusively through it. **L0 keeps direct DB access** (it's substrate, not a consumer of `Document` objects per ADR-003: "Search continues to operate on chunks"). The adapter seam feeds the indexer that builds L0's tables; L0 itself is never reimplemented per source.

---

## 1. Adapter Pattern with Capability Descriptors

**Question:** Compile-time types, runtime descriptors, or both?

### What 2026 systems do

| System | Capability model |
|---|---|
| **Drizzle ORM** | Dialect-specific *types* per backend (`PostgresSession`, `MySqlSession`, `SQLiteSession`); features that don't exist on a dialect simply don't compile. No runtime capability handshake — the type system is the contract. |
| **Prisma** | Generated client per data source; capabilities baked into the generated TypeScript surface. Some runtime "preview features" flag is layered on top. |
| **Airbyte CDK / LangChain `AirbyteLoader`** | Pure runtime: a connector publishes a `spec` (JSON Schema of config) and a `catalog` (per-stream schema + sync modes — `full_refresh`, `incremental`). Calling code reads the catalog and branches. |
| **dbt adapters** | Runtime capability dispatch via `adapter.behavior()` and macro dispatch — features like `Capability.TableLastModifiedMetadata` are queried at runtime so cross-adapter code can degrade gracefully. |
| **Backstage entity providers** | Each provider implements the same `EntityProvider` interface (no static capability typing); behavioral differences are runtime — provider can emit `full` or `delta` mutations through the same channel. |
| **VS Code extensions** | Static manifest (`package.json` `activationEvents`, `contributes.*`) declared up-front; the host reads the manifest before loading. |

**Pattern that dominates** when adapters can come from heterogeneous sources: **runtime descriptors**. Compile-time-only typing works for Drizzle because all dialects are first-party; it does not work when one adapter is "user installs an npm package" (Phase 10).

### Recommendation

**Both, but with runtime descriptors as the authoritative source.** This matches ADR-002's `SourceCapabilities` / `DeliveryCapabilities` shape exactly:

1. **Runtime descriptors** are the contract. `SourceCapabilities.watch: 'push' | 'poll' | 'none'`, `DeliveryCapabilities.hashProtected: boolean`, etc. The assembly layer branches on these at runtime. `describe_contract` surfaces capability mismatches to users.
2. **TypeScript interface union types** narrow once a descriptor is checked:
   ```ts
   if (source.capabilities.watch === 'push') {
     // source is now typed as PushChangeFeedSource
   }
   ```
   This is the discriminated-union pattern, applied to capability fields rather than to a `kind` field.
3. **No static dialect generic** (`SourceConnector<'obsidian-fs'>`). It buys nothing — calling code never knows the concrete adapter at compile time; the registry resolves a handle string at runtime.

### Capability set (refinement of ADR-002)

ADR-002 specifies a strong starting set. Add three for completeness based on what comparable connectors learn the hard way:

- `SourceCapabilities.streaming: boolean` — does `listDocuments()` produce results incrementally (file glob) vs. requires a full page-fetch first (Notion paginated API)? Affects whether the indexer can start work before enumeration finishes.
- `SourceCapabilities.maxBatchSize?: number` — Notion API caps batch requests; Obsidian-fs has no equivalent. Lets the indexer throttle without per-adapter knowledge.
- `DeliveryCapabilities.idempotent: boolean` — can the adapter safely re-execute the same write on retry? Notion writes need this flag to distinguish "create page" (not idempotent without a client-side dedupe key) from "update page" (idempotent).

**Confidence:** HIGH for the both-but-runtime-authoritative recommendation (dbt and Airbyte are large-scale validations). MEDIUM on the three extra fields (informed extrapolation from connector-framework experience).

---

## 2. Change-Feed Abstraction

**Question:** Async iterators, RxJS, EventEmitter, or custom subscription?

### Three sources have to unify behind one contract

| Source | Native model |
|---|---|
| `obsidian-fs` | chokidar events (push, callback-based) |
| Notion API (poll-driven Phase 10) | timer + diff against last-known state (pull) |
| Notion webhooks (Phase 10+) | inbound HTTP (push, but external) |

### What 2026 Node ecosystems do

- **Async iterators** are the recommended primitive for *pull-style* consumption (one event at a time, backpressure built in). They map cleanly to `for await...of` and to Repeater-style libraries that bridge callbacks. They are clumsy for *multi-subscriber broadcast*.
- **EventEmitter** is the established Node idiom for multi-subscriber broadcast and is what chokidar exposes. Zero ceremony.
- **RxJS observables** are overkill: vault-memory does not compose change streams with operators (debounce, mergeMap, etc.) outside the existing DebouncedQueue, which lives at a different layer.
- **Custom subscription with `Disposable` return** (ADR-002's choice) is the pattern most adapter frameworks land on: it's an EventEmitter under the skin with explicit cleanup.

### Recommendation

**Keep ADR-002's `subscribe(handler) → Disposable` callback contract** (it's a thin EventEmitter wrapper). It works equally well for chokidar (callback-on-callback), polling (timer fires handler), and webhooks (HTTP handler invokes the callback). It is the smallest contract that satisfies all three.

**Add one auxiliary primitive** the brief doesn't yet specify: an internal `events()` async iterator helper for the staleness daemon (Phase 6), built on top of `subscribe`:

```ts
// Helper layered on subscribe — not part of the adapter contract
async function* events(feed: ChangeFeed): AsyncIterable<ChangeEvent> {
  const queue: ChangeEvent[] = [];
  let resolve: (() => void) | null = null;
  const dispose = feed.subscribe(e => {
    queue.push(e);
    resolve?.(); resolve = null;
  });
  try {
    while (true) {
      while (queue.length) yield queue.shift()!;
      await new Promise<void>(r => { resolve = r; });
    }
  } finally { dispose.dispose(); }
}
```

The staleness daemon then writes `for await (const e of events(feed)) { ... }` — readable, backpressure-safe, no RxJS dependency. The `subscribe` contract stays primitive; the iterator is a 20-line helper.

**One detail ADR-002 should pin down before Phase 1:** ordering and at-least-once guarantees. chokidar can drop events under load; the existing `catchupVault()` exists *because* of this. State the guarantee as "best-effort delivery; `catchup()` on resume reconciles" so notion-api's polling implementation has the same latitude.

**Confidence:** HIGH (the contract is small and well-precedented; the polling and webhook variants are both straightforward translations).

---

## 3. Opaque-ID Migration Strategy

**Question:** Dual-column with view, full replacement with backfill, virtual generated column, or deferred FK fixes?

### SQLite-specific constraints

- **Generated columns cannot be PRIMARY KEY** ([SQLite docs](https://sqlite.org/gencol.html)). So `doc_uri` as a STORED/VIRTUAL generated column off `path` doesn't satisfy "URI is the canonical identity."
- **SQLite supports `ALTER TABLE … RENAME COLUMN`** since 3.25, and `DROP COLUMN` since 3.35 — but not without locking implications on multi-GB DBs (most user vaults stay well below this).
- The current schema (v1.0.0) uses `path` as the natural key for `notes`; `chunks.note_path`, `wikilinks.{source_path,target_path}`, `embeddings_*` join on it.

### The three viable strategies

| Strategy | Pros | Cons |
|---|---|---|
| **A. Dual-column, doc_uri NULL-allowed initially, backfill, then NOT NULL + UNIQUE** | Reversible mid-migration. Old code reading `path` still works during backfill. | Two paths-of-truth temporarily; risk of drift if a write goes through a code path not yet doc_uri-aware. |
| **B. Full replacement: add doc_uri, backfill, swap to PK, drop path** | Single source of truth at end. Cleanest schema post-migration. | One-shot; rollback is a restore. Phase 1 PR is large. |
| **C. Generated column** | Computed automatically. | **Not allowed for PK** (constraint above). Useful only as an *index target*, not as identity. |
| **D. Keep path as PK, store doc_uri as derived column** | Smallest delta to existing schema. | Defeats ADR-001's purpose: any code path that joins on `path` keeps Obsidian assumptions; Notion ingestion has to fake a `path`. |

### Recommendation

**Strategy A (dual-column with staged migration), executed across two migration versions:**

1. **Migration N (Phase 1, ships with adapter extraction):**
   - Add `notes.doc_uri TEXT UNIQUE` (NULL allowed).
   - Add `chunks.doc_uri TEXT`, `wikilinks.{source_doc_uri, target_doc_uri} TEXT`.
   - Backfill from `path` using the obsidian-fs URI minter: `obsidian://<vault-name>/<path>`.
   - **All new code reads/writes through `doc_uri`.** v1 query classes (`NotesQueries`, etc.) gain `*ByUri` variants alongside the existing `*ByPath` ones.
   - `path` remains the PK and is still written by the obsidian-fs adapter (it knows about paths).

2. **Migration N+1 (Phase 9 or held until Phase 10):**
   - `doc_uri NOT NULL`.
   - Add unique index, then swap PK if desired. Many code paths just need `doc_uri` as the join column; PK status is cosmetic in SQLite when `UNIQUE NOT NULL` exists.
   - `path` becomes a secondary column owned by `obsidian-fs.ts` (the only adapter that has paths).

This matches ADR-001's "alongside or replacing" language and lets Phase 1 ship without forcing every dependent system to migrate at once.

**Why not strategy B (full replacement):** Phase 1's "no behavior change" acceptance criterion (324 tests still pass) is much easier to hold with strategy A. B forces a single mega-PR.

**Indexes:** add a `CREATE INDEX idx_notes_doc_uri ON notes(doc_uri)` immediately so joins on doc_uri aren't full scans during the dual-column period.

**Confidence:** HIGH on strategy A; MEDIUM on the specific two-migration split (could be one migration if Phase 1's tests prove tight enough).

---

## 4. Block-Tree Document Model

**Question:** What document model survives mapping Obsidian markdown AND Notion blocks? ADR-003 already specifies a custom shape; this section validates against 2026 alternatives.

### Industry reference points

| Model | Fit for vault-memory v2 |
|---|---|
| **mdast (unified.js)** | Excellent for markdown parsing inside obsidian-fs adapter. Wrong as canonical shape: encodes inline emphasis (vault-memory doesn't index it), no chunk_id slot, no anchor concept. **Use mdast as parsing intermediate; translate to BlockNode.** Matches ADR-003 alternative (b). |
| **ProseMirror schema** | Designed for *editing*. Inline mark model is heavyweight. Schema enforces validity invariants that hurt at retrieval time (a `RawNode` escape hatch is fine for us, painful in PM). |
| **Slate.js Editor** | Similar issues to ProseMirror. Plus a transform-based mutation API vault-memory doesn't need. |
| **Lexical (Meta)** | Same family. Designed for editor performance, not data interchange. |
| **BlockNote / Notion-native block array** | Flat array with `parent` references. `get_outline` becomes a tree-reconstruction problem at query time. ADR-003 rejects this. |
| **Docling DoclingDocument** | Hierarchical with chunk-aware tooling. Closest in spirit. Heavyweight (PDF/Office focus). Useful reference, not a dependency. |
| **Martian (markdown ↔ Notion via unified)** | Confirms the practical pattern: parse markdown to mdast, walk mdast to emit Notion blocks. Works in both directions. |

### What survives lossy round-trips?

Empirically:

- **Heading hierarchy** — survives both directions perfectly.
- **Paragraphs, lists, code, tables, callouts** — survive structurally; styling within them is lossy.
- **Links** — survive when extracted as edges (ADR-003's choice) rather than embedded inline.
- **Inline emphasis (bold/italic)** — lossy from markdown → BlockNode → Notion block (the inline span model is gone). ADR-003 accepts this loss as the price of simplicity. **This is the right call for a retrieval system**; it would be wrong for an editing system.
- **Notion-specific blocks** (database views, child databases, synced blocks) — survive only via `RawNode`. They cannot round-trip semantically; vault-memory cannot rewrite a Notion database. Tag them read-only at the `Document.capabilities` level.

### Recommendation

**Adopt ADR-003 as written.** Implement the obsidian-fs parser as a mdast → BlockNode translation (so we don't roll our own markdown parser); the existing `gray-matter` covers frontmatter, the remark/mdast ecosystem covers body. Reserve mdast as an internal detail of the adapter — never expose mdast outside `src/adapters/source/obsidian-fs.ts`.

**One architectural addition for Phase 1:** ship a **conformance test suite** for adapters (referenced in ADR-003 "Negative / costs"):

- A reusable test module under `src/adapters/conformance/` that takes a `SourceConnector` instance and runs ~30 invariant checks (heading hierarchy preserved, edges enumerable, `hash()` stable across calls, `readDocument()` idempotent, `RawNode` round-trips text exactly).
- Phase 1 runs it against `obsidian-fs`. Phase 3's stub adapter runs it. Phase 10's `notion-api` runs it as its first test.
- This is the source-neutrality guarantee made testable.

**Confidence:** HIGH on adopting ADR-003; HIGH on the mdast-as-parsing-intermediate pattern; HIGH on the conformance test suite (it's how dbt, Airbyte, and Backstage validate new adapters).

---

## 5. Memory Namespace Isolation

**Question:** Folder, separate database, or separate schema? ADR-004 is "neutral on the default"; surface what comparable systems chose.

### What comparable systems do

| System | Isolation model |
|---|---|
| **Mem0** | Per-user namespace via `user_id` scope; data stored in the same backing store with row-level filtering. Isolation is logical, not physical. |
| **Letta (MemGPT)** | Per-agent memory with three tiers (core / recall / archival). Core lives in context, recall + archival are separate stores. Tier-level isolation is physical; per-agent isolation is logical. |
| **Anthropic agent memory patterns** | Generally application-level namespacing keyed on user/session identity, not OS-level isolation. |
| **Zep / Memori** | Schema-as-isolation: explicit memory schema with constraints. Same database, schema-level guards. |

**Convergence:** the industry chose **logical isolation with strong write guards** over physical isolation (separate DB / vault). The reasoning: cross-namespace reads (evidence chains, brief sources) are common; cross-namespace writes (which is what users fear) are the actual risk surface, and write guards solve that without splitting the data store.

### Recommendation for vault-memory

**Default: folder inside the vault** (`obsidian-fs://my-vault/_memory/`). Match ADR-004's recommendation. Add three concrete safety mechanisms not yet locked in:

1. **DeliveryAdapter-level write guards** (per ADR-002, refined in ADR-004): the memory-sink delivery adapter is a *different instance* of `obsidian-fs.DeliveryAdapter` with a `MemoryContract` attached. Writes through it apply the contract. Writes through the regular adapter to the memory folder are rejected at the registry — the registry routes any DocId resolving inside `_memory/` to the memory adapter.

2. **Filesystem-level guard** (cheap belt-and-braces): the obsidian-fs adapter scans the memory-folder path on startup; if the user's own `write_note` tool targets a path under it, the registry routes it to the labeled adapter, which fails validation (no `source: agent` etc.).

3. **Document the "separate vault" option clearly** as the recommended deployment for users with strict isolation needs. Provide the `add-vault --memory-vault` skill option ADR-004 sketches. The handle abstraction means this is config-only.

**Why not separate database per memory sink:** would force cross-database joins for `recall` queries that pull evidence from user notes. SQLite cross-database joins are possible (`ATTACH DATABASE`) but slow and operationally fragile. The existing per-vault DB model already gives physical isolation at the *vault* level; physical isolation at the *sink-within-vault* level is overkill.

**Disagreement with brief:** the brief says "the namespace boundary may need to be a separate vault in v2 rather than a folder, for hard isolation. Surface this as an ADR amendment before implementing." Recommendation: **fold this into ADR-004 as a config-driven choice (default folder, separate-vault as a documented opt-in)** rather than as a fork in the implementation. No code branches; one handle, two configurations.

**Confidence:** HIGH on logical-isolation + write guards (Mem0, Letta both validate); MEDIUM on declining a separate-DB default (an argument exists for the safety property of "even if write guards fail, you can't physically reach user notes"; the cost-benefit argues against).

---

## 6. MCP Server Scaling

**Question:** Stay per-session, or move to long-running daemon?

### Current state

vault-memory v1 spawns one server per Claude Code session via stdio transport. Multiple Claude Code windows running against the same machine means N processes, each opening the same SQLite databases.

### What 2026 MCP ecosystem does

- **Default (per-session stdio)** dominates because it's the only mode MCP clients reliably support today. Claude Code, Claude Desktop, and most third-party clients all default to stdio + spawn.
- **Production concerns are surfacing**: the `claude-context` issue documents real CPU/memory churn when N sessions each spawn an indexer. The MCP `streamable-http` transport (added in spec revision 2025-03-26 and broadly available by mid-2026) is the upstream answer: a long-running server that multiple clients connect to over HTTP.
- **Shared-daemon architectures** (à la `ollama serve`) are emerging in production deployments but require the server to handle session lifecycle, concurrent access serialization, and authentication — a real undertaking.

### Concrete pain for vault-memory if we stay per-session

- **chokidar watchers multiply.** Each session opens its own chokidar across the same vault. For a 10K-note vault that's nontrivial fs handles per session.
- **Briefs (Phase 6) have a staleness daemon.** N sessions = N daemons recomputing brief staleness on the same source change.
- **Per-model embedding generation can run twice** if two sessions both index after a config change.
- **better-sqlite3 is single-writer-per-process.** Two processes writing to the same vault DB requires WAL mode and serializes anyway — but with race risk on the `audit` table.

### Recommendation

**Stay per-session for v2.0.0; design Phase 6's staleness daemon as if it will move out-of-process; add a `--daemon` mode in v2.x or v3.0.0.**

Concrete steps:

1. **Document the contract** for "which session owns the watcher": today it's implicit (whichever process is first); make it explicit via a `~/.vault-memory/locks/<vault>.lock` file. Non-owning sessions skip starting their own watcher and rely on the owning session's writes to land in the DB. (Sessions read from SQLite directly, which is concurrent-safe.)

2. **Phase 6 staleness daemon** must be designed as a *single-owner* process so it doesn't multiply across sessions. Same lock-file pattern.

3. **Phase 9 evaluates** moving to a daemon model. The MCP `streamable-http` transport is ready by then; vault-memory becomes a long-running server, sessions are clients. This is **scope for v2.1.x or v3.0.0**, not v2.0.0 — the cost is real (session auth, lifecycle, transport changes) and the value lands incrementally.

4. **Single-vault, single-user, single-machine** stays the product. A daemon doesn't change that — it just centralizes the process.

**Confidence:** MEDIUM-HIGH. The per-session pain is real; the daemon migration is well-understood (MCP spec supports it); the right time is "after v2.0.0 ships and users hit the pain." Deferring is the conservative architecturally-sound choice.

---

## 7. Plugin / Connector Loading (Phase 10)

**Question:** in-process `import` from `node_modules`, subprocess, manifest-based discovery?

### What comparable systems do

| System | Loading model |
|---|---|
| **VS Code extensions** | Manifest in `package.json` (`activationEvents`, `contributes`, `engines.vscode`). Loaded into a separate **Extension Host process** (not main UI). Sandboxed per-extension. |
| **Backstage entity providers** | In-process npm package. Wired in `packages/backend/src/plugins/catalog.ts`. No manifest, no sandbox — Backstage extensions are first-party-coded. |
| **esbuild plugins** | In-process JS function returning `{name, setup}`. Trivial loading, no manifest, no sandbox — plugins run with full Node permissions. |
| **Vite plugins** | Same as esbuild: in-process function, Rollup-compatible API. Plugin registry (`registry.vite.dev`) indexes npm packages by convention, not by manifest. |
| **ADR-002's stated choice** | In-process, hardcoded registrations at startup. Third-party plugins explicitly deferred to a future ADR. |

### Recommendation for Phase 10

ADR-002 already calls this correctly: **in-process, registry-driven, no third-party plugins in v2/v3.0.0**.

Refinement for Phase 10's actual implementation:

1. **Each connector is its own npm-style package** under `src/adapters/source/notion-api/`, etc. Built into the same `dist/cli.js` bundle by tsup. No dynamic `import()`. Connectors register themselves in `src/adapters/index.ts` (the central registry initializer).

2. **Manifest is the capability descriptor** (already specified in ADR-002). It's a static export from the connector module:
   ```ts
   export const manifest: ConnectorManifest = {
     scheme: 'notion-api',
     version: '1.0.0',
     capabilities: { ... },
     factory: createNotionConnector,
   };
   ```
   Registry reads `manifest`, calls `factory(config)` when a handle with the scheme is encountered.

3. **No subprocess in v2/v3** (ADR-002 alternative (a)). Reconsider when there's pressure for *user-installable* third-party plugins — the trust boundary then matters. v3.0.0 ships only first-party Notion.

4. **Conformance test suite (from §4) is the plugin contract.** A connector that passes conformance can be registered. This is the practical bar; manifest + factory + passing tests is the plugin protocol.

5. **Phase 10 introduces `src/adapters/registry.ts` as the single mutable registry**. It's already specified in ADR-002 with `registerSource`/`registerDelivery`/`registerChangeFeed` methods. Implementation is a Map keyed by scheme. Plus `listSources`/`listSinks` for `describe_contract` and MCP tool discovery.

**Confidence:** HIGH. Backstage and esbuild are strong precedents for "in-process, first-party plugins, no sandbox needed when the trust boundary is the npm package." VS Code's extension host model is overkill for vault-memory.

---

## 8. Eval Harness Architecture

**Question:** How to structure evals so the same harness runs against Obsidian fixtures today and Notion fixtures in Phase 10?

### What 2026 LLM-eval systems look like

- **Assertion-based + LLM-as-judge hybrid** is the dominant pattern. Code asserts deterministic invariants (right doc count, correct DocIds in the bundle); LLM-as-judge scores quality (is the brief actually useful?).
- **Fixture + expected-behavior labeling format** (the EleutherAI `lm-evaluation-harness` and similar) standardize on YAML/JSON test specs alongside fixture data.
- **Snapshot vs. assertion:** snapshot testing is brittle for LLM output (small wording changes break snapshots); deterministic-shape assertions paired with snapshot for IDs and counts is the practical compromise.

### Recommendation: a typed-document eval harness

```
evals/
├── fixtures/
│   ├── v2-test-vault/                  # Phase 0: obsidian-fs fixture
│   │   ├── notes/
│   │   ├── _memory/                    # Phase 2 memory fixture
│   │   └── _contracts/                 # Phase 7 contracts fixture
│   ├── stub-source/                    # Phase 3: stub adapter, hard-coded Documents
│   │   └── documents.json              # Document[] serialized
│   └── notion-fixture/                 # Phase 10: Notion workspace snapshot
│       └── pages.json                  # serialized via notion-api adapter dump
├── specs/                              # Test cases — YAML
│   ├── search/
│   │   ├── recency-weighted.yaml       # 5 queries, expected DocId sets
│   │   └── ...
│   ├── bundle/
│   ├── dossier/
│   └── brief/
├── harness/
│   ├── runner.ts                       # Loads fixture via SourceConnector adapter
│   ├── assertions.ts                   # DocId set match, ranking precision/recall
│   ├── judges.ts                       # Optional LLM-as-judge for brief quality
│   └── ...
└── README.md
```

**Test spec schema:**
```yaml
name: "Find Alice's recent meetings"
fixture: v2-test-vault
adapter: obsidian-fs
tool: search_hybrid
inputs:
  query: "meetings with Alice"
  recency_weight: 0.4
expected:
  contains_doc_ids: [obsidian://test/Alice.md, obsidian://test/2026-04-10.md]
  min_precision_at_5: 0.8
  ranking:
    - "2026-04-10 ranks above 2025-08-15 (recency_weight active)"
```

### Key architectural choices

1. **Harness consumes `Document` objects, not raw markdown** (per brief). The runner takes an adapter handle, loads the fixture through it, and feeds the assembly tools as production would. The same spec file runs against `obsidian-fs` (real markdown), `stub-source` (hard-coded `Document[]`), and eventually `notion-api` (recorded snapshot). This is the *source-neutrality test*.

2. **Assertions over snapshots.** Spec files declare *invariants* (DocId sets, count bounds, ranking constraints), not full output snapshots. Reason: a small change in chunker behavior changes snapshot bytes without changing correctness. Invariants survive refactors.

3. **LLM-as-judge is opt-in.** Phase 6 briefs benefit from LLM grading ("does the brief actually summarize the sources?"), but the LLM judge:
   - runs only on PRs touching brief code (via a label or CI matrix axis),
   - uses a fixed model/prompt to keep results comparable,
   - is the *only* place vault-memory's CI calls an LLM. Aligns with "no premature LLM coupling."

4. **CI integration:** every assembly-touching PR runs `npm run evals` against `obsidian-fs` and `stub-source`. Phase 10 adds `notion-fixture`. Regressions block merge.

5. **Fixture stability matters more than fixture realism.** A 50–100 note vault with hand-labeled queries beats a snapshot of someone's real vault. Phase 0 ships the obsidian-fs fixture; Phase 3 ships the stub fixture; Phase 10 builds the notion fixture as a one-time recorded snapshot.

**Confidence:** HIGH. The pattern is well-validated (Anthropic's "Demystifying evals" guidance; Pragmatic Engineer's LLM evals piece; HAL's standardized harnesses).

---

## 9. Brief Compilation Pipeline (Phase 6)

**Question:** Incremental indexing à la Turbopack, watch-mode à la swc, dependency tracking à la Bazel — what model fits?

### What incremental-build systems do

- **Turbopack** uses fine-grained "value cells" — each cached intermediate result records which other cells it depends on; changing a cell invalidates only its dependents.
- **Salsa (rust-analyzer's engine)** uses demand-driven queries: every computation is a memoized query with explicit input dependencies; invalidation propagates through the query graph.
- **Bazel** uses static action graphs hashed by inputs: an action re-runs iff any input hash changes.
- **Make** is the original: file mtime → "out of date" → rebuild. Coarse but understood by everyone.

### Brief compilation is structurally simple

A brief's input set is `compiled_from: [doc_id, ...]`. Each input has a `hash`. The brief's stored `source_hashes` is `{doc_id: hash}`. Staleness = "any input's current hash ≠ stored hash."

This is **Make-level dependency tracking**: explicit input list, hash comparison. We do not need Salsa's query graph (briefs aren't computed from each other transitively — the LLM output is the leaf), and we do not need Turbopack's fine-grained cells (the brief is the unit of recomputation; partial recompilation isn't a thing for a 1000-token summary).

### Recommendation

**Adopt the Make model, implemented via the change-feed subscription that ADR-002 already provides.**

```
┌──────────────────────────────────────────────────────────────┐
│  Staleness daemon (single-owner, lock-file gated per §6)     │
│                                                              │
│   subscribe(ChangeFeed) ──► onChange(doc_id):                │
│       1. lookup briefs WHERE compiled_from CONTAINS doc_id   │
│       2. for each brief:                                     │
│           - re-hash doc_id                                   │
│           - if hash ≠ brief.source_hashes[doc_id]:           │
│               set status: stale                              │
│               write through DeliveryAdapter (memory sink)    │
│       3. emit staleness_log audit row                        │
└──────────────────────────────────────────────────────────────┘
```

**Architecture choices:**

1. **Storage:** an index on `briefs.compiled_from` (JSON array column or normalized side-table). The side-table is cleaner — `brief_sources(brief_doc_id, source_doc_id)` — and enables the `WHERE compiled_from CONTAINS` lookup as a simple join. Add in Phase 6's migration.

2. **No Bazel-style action graph.** Briefs don't depend on other briefs. If they ever do (Phase 7 contracts that compose briefs), revisit; for v2.0.0 the input set is flat.

3. **Recompilation is caller-driven** (matching ADR-002's neutrality on LLM calls). The daemon marks a brief stale; a future call to `get_brief({allow_stale: false})` returns null, forcing the caller to call `compile_brief` again with the same target. **vault-memory does not silently regenerate briefs** — this preserves the "no premature LLM coupling" invariant.

4. **Race handling:** if a source changes mid-compilation, the new brief's `source_hashes` snapshot the post-change hash, and the daemon picks up the change in the next event. Hash-based optimistic concurrency on the brief write (matches v1's existing `expectedHash` pattern) prevents two compilers from both writing.

5. **Phase 6's ADR on LLM strategy:** the brief recommends "caller passes summarized text" as the purity-preserving option. **Endorse this for v2.0.0.** Option (b) "vault-memory calls Ollama" adds an LLM dependency to a system that has been embeddings-only; it can be added in v2.1.x without breaking anything because the existing tool surface already accepts the summarized text. Start minimal.

**Confidence:** HIGH. The Make-model fit is clean; the alternatives (Salsa, Turbopack) are over-engineered for a leaf-node compilation graph.

---

## Component Boundaries — concrete layering

```
Where things live (Phase 1 onward)
───────────────────────────────────────────────────────────────────
src/server.ts                  MCP dispatcher (unchanged role)
src/cli.ts                     CLI (unchanged role)
src/types.ts                   + Document, BlockNode, Edge,
                                 SourceHandle, MemorySink, ChangeEvent

src/adapters/                  NEW — the seam
  registry.ts                  handle parser, scheme→factory map
  capabilities.ts              shared descriptor types
  conformance/                 reusable test harness for adapters
  source/
    types.ts                   SourceConnector interface
    obsidian-fs/               (the v2 implementation, ~former src/reader/)
    stub/                      (Phase 3 — for source-neutrality evals)
  delivery/
    types.ts                   DeliveryAdapter interface
    obsidian-fs/               (~former src/write/)
  change-feed/
    types.ts                   ChangeFeed interface
    obsidian-fs/               (~former chokidar bits of src/watcher/)

src/properties/                NEW — PropertyBag accessors per ADR-003

src/indexer/                   Stays. Now drives the SourceConnector
                               rather than reading FS directly.
                               Chunker still consumes BlockNode[].

src/search/, src/graph/        Stay. Operate on chunks + edges (post-Phase-1
                               edges are typed per ADR-003).

src/memory/                    NEW (Phase 2) — record_observation, recall,
                               supersede, MemoryContract validator. Calls
                               DeliveryAdapter via registry.

src/bundles/                   NEW (Phase 3) — assembly tools. Consumes
                               Document via SourceConnector. Never reads FS.

src/briefs/                    NEW (Phase 6) — compile + get + staleness
                               daemon. Subscribes to ChangeFeed.

src/contracts/                 NEW (Phase 7) — YAML/Zod schema + executor.
                               Sources & sinks by handle only.

evals/                         NEW (Phase 0) — fixtures + specs + harness.

skills/                        Existing. Phase 8's Canvas tooling lives here
                               or in a separate plugins/ directory.
```

**No-leakage rule** (per Phase 1 acceptance criteria): grep `chokidar` outside `src/adapters/change-feed/` → 0 hits. Grep `path.join`/`fs.*` outside `src/adapters/{source,delivery,change-feed}/`, `src/config/`, `src/cli.ts` → 0 hits. Grep `gray-matter` outside `src/adapters/{source,delivery}/obsidian-fs/` → 0 hits. ADR-002 already specifies the CI script (`scripts/lint-adapters.sh`).

---

## Data Flow — `Document` lifecycle

```
                        ┌──────────────────────────────┐
                        │  obsidian-fs.SourceConnector │
                        │  - listDocuments()           │
                        │  - readDocument() returns    │
                        │    Document (BlockNode tree) │
                        └──────────┬───────────────────┘
                                   │ Document
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Indexer (src/indexer)                                            │
│  Chunker walks Document.blocks → Chunk[] with chunk_id            │
│  Writes notes (doc_uri), chunks, embeddings, edges (typed)        │
└──────────┬───────────────────────────────────────────────────────┘
           │                                  ▲
           ▼ stores                           │ ChangeEvent
┌──────────────────────┐         ┌────────────┴──────────────────┐
│  SQLite (per vault)  │         │  ChangeFeed                    │
│  - notes (doc_uri)   │         │  obsidian-fs: chokidar         │
│  - chunks            │         │  notion-api (v3): poll/webhook │
│  - edges (typed)     │         └────────────┬───────────────────┘
│  - embeddings        │                      │
└──────────┬───────────┘                      ▼
           │                       ┌──────────────────────────┐
           │                       │  Staleness daemon (P6)   │
           │                       │  flags brief Documents   │
           │                       └──────────┬───────────────┘
           │ chunks/edges/notes               │ marks stale via
           ▼                                  ▼ DeliveryAdapter
┌──────────────────────────────────────────────────────────────────┐
│  Search (L0)        Bundles (L3)        Briefs (L3)               │
│  hybridSearch       get_document_bundle compile_brief             │
│                     get_outline         get_brief                 │
│                     search_sections     list_briefs               │
│                     assemble_dossier                              │
│                     ↑ all consume Document via SourceConnector    │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ▼ Document (assembled)
┌──────────────────────────────────────────────────────────────────┐
│  Contracts (L4)                                                   │
│  instantiate_contract: drives assembly tools by handle,          │
│  emits write-back through DeliveryAdapter to a MemorySink         │
└──────────┬───────────────────────────────────────────────────────┘
           │ Document (with provenance properties)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  DeliveryAdapter                                                  │
│  - obsidian-fs.DeliveryAdapter (general)                          │
│  - obsidian-fs.DeliveryAdapter + MemoryContract (memory sink)    │
│  - notion-api.DeliveryAdapter (v3)                                │
└──────────────────────────────────────────────────────────────────┘
```

**Direction is enforced by the registry.** Calling code asks the registry to resolve a handle to an adapter; it cannot import a concrete adapter directly. This is what makes Phase 10's Notion adapter "additive": new adapter, new registry entry, existing call sites untouched.

---

## Suggested Build Order

The brief's Phase 0–10 ordering is largely correct. Concrete observations on dependency strength:

### Strong dependencies (cannot reorder)

- **Phase 0 → Phase 1**: ADRs lock interfaces before code moves.
- **Phase 1 → Phase 2**: MemorySink resolution needs the registry; write guards need the DeliveryAdapter.
- **Phase 2 → Phase 6**: briefs are memory-sink documents.
- **Phase 3 → Phase 6**: brief compilation consumes bundle/dossier outputs.
- **Phase 3 → Phase 7**: contracts compose assembly tools.
- **Phase 7 → Phase 8**: Canvas compiler emits the contract DSL Phase 7 defines.
- **Phase 1's seams → Phase 10**: every later phase depending on seams must respect them, else Phase 10 becomes a rewrite.

### Independent (can run parallel within a sprint)

- **Phase 4 (authority/staleness signals)** is independent of Phases 5/6/7. Tiny surface; could ship alongside Phase 3 or Phase 5.
- **Phase 5 (graph-as-retrieval)** depends only on Phase 3's bundle surface (and ADR-003's typed edges, which arrive in Phase 1). Could ship before Phase 6 — and arguably should, because Phase 6 briefs benefit from `expand`-driven source enumeration.

### Recommended adjustments to the brief's ordering

1. **Land the conformance test suite in Phase 1** (not deferred to Phase 10). It's the only way to prove the stub adapter in Phase 3 is faithful, and it's the only way Phase 10's Notion adapter can be reviewed objectively. Cost: ~one extra sub-agent in Phase 1.

2. **Pull authority/staleness signals (Phase 4) into Phase 3** as a single deliverable. They share result-shape concerns (mtime, status, superseded_by all live on `Document.properties` and need to propagate through bundles). Splitting them costs more in plumbing than it saves in scope.

3. **Phase 5's `expand` is a Phase 6 prerequisite, not an independent track.** `compile_brief` for "all docs related to Project X" wants graph expansion. Don't gate Phase 6 on Phase 5; do build them in adjacent sprints so Phase 6 can use `expand` for source discovery.

4. **Add a "premise-check checkpoint" between Phase 9 and Phase 10.** Phase 10 already states this — make it a hard gate, with a CI job that runs the stub-adapter eval on `main` and the seam-leakage grep checks. If either fails, no Phase 10 ADR writing until fixed.

5. **Phase 8 (Canvas editor) ordering is correct but should be flagged as "potentially deferable to v2.1.x"** — it's the largest exploratory effort and its absence doesn't block v2.0.0 (YAML contract authoring works without it). The brief already calls this a spike-first decision; treat the spike as a separate phase if it stalls.

### Where v3 Notion plugs in (zero modifications to Phase 1–8 code)

| File added | What it does |
|---|---|
| `src/adapters/source/notion-api/index.ts` | implements `SourceConnector` — `listDocuments()` paginates Notion API; `readDocument()` translates blocks→`BlockNode` tree |
| `src/adapters/delivery/notion-api/index.ts` | implements `DeliveryAdapter` — `write()` creates pages, `update()` patches blocks |
| `src/adapters/change-feed/notion-api/index.ts` | implements `ChangeFeed` — polling first, webhooks later |
| `src/adapters/index.ts` (modified) | adds `registry.registerSource('notion-api', ...)` calls |
| `config.toml` (user-facing) | gains `[[connectors]]` section for `scheme = "notion-api"` |
| Migrations N+2 (v3) | rows in `notes` with `doc_uri = "notion-api://..."`. No new columns — `doc_uri` is opaque. |

Crucially: **no change to `src/search/`, `src/graph/`, `src/memory/`, `src/bundles/`, `src/briefs/`, `src/contracts/`.** The registry resolves the handle; the calling code never knows it's Notion. ADR-002 calls this out as the success criterion for the seam.

---

## Mapping to ADRs

| Architectural recommendation | ADR / source |
|---|---|
| Layer model L0–L4 | Brief, Phase 0 deliverable `docs/v2/ARCHITECTURE.md` |
| Adapter interfaces + capability descriptors | ADR-002 |
| Document/BlockNode/Edge/PropertyBag | ADR-003 |
| Opaque URI identity | ADR-001 |
| MemorySink + MemoryContract | ADR-004 |
| Both compile-time + runtime capability typing | dbt, Airbyte CDK (industry) |
| Subscribe-with-Disposable change feed | ADR-002 (validated against Node ecosystem) |
| Dual-column migration for doc_uri | ADR-001 (alongside-or-replacing language) |
| mdast-as-parsing-intermediate | ADR-003 alternative (b), endorsed |
| Conformance test suite | ADR-003 negative-consequences section, promoted to Phase 1 |
| Folder-default memory sink | ADR-004 recommendation, validated against Mem0/Letta |
| Per-session MCP for v2.0.0, daemon later | MCP ecosystem convergence; Phase 6 staleness daemon constraint |
| In-process plugin loading | ADR-002 alternative (a) rejection |
| Make-model brief compilation | Phase 6 deliverables, validated against incremental-build research |

---

## Outstanding Architectural Risks

1. **Better-sqlite3 + multi-process writes.** If a user runs two Claude Code sessions against the same vault, both processes open the same DB. WAL mode allows concurrent readers + single writer with retry. Phase 1 should formally adopt WAL and document the implication. *Severity: low. Detection: write tests under two-process scenarios.*

2. **Notion blocks containing child pages introduce non-tree topology.** A Notion page can embed another page; the embedded page is itself a Document. ADR-003's `EmbedNode.target_id` handles the link, but treating embedded pages as *part of the parent's body* (Notion's default rendering) is harder. Recommend treating Notion sub-pages as separate Documents with `EmbedNode` references — same model as Obsidian transclusions. Decide in Phase 10 ADR on granularity. *Severity: medium for v3 only.*

3. **MemoryContract drift.** Sink contracts can evolve; existing memory documents may not match the new contract. Need a contract-version field (`memory-contract-version: "default-memory-v1"`) on each memory document and a migration story for contract changes. *Severity: medium. Address in Phase 2.*

4. **Conformance test fidelity.** A passing conformance test does not prove a connector is *complete* — only that it satisfies invariants. The Notion connector may pass conformance and still mis-handle a Notion-specific block type. Mitigate with adapter-specific tests in addition to conformance. *Severity: low-medium. Standard adapter-pattern caveat.*

5. **Phase 6 staleness daemon single-ownership.** If the lock-file mechanism fails (stale lock, crash), brief staleness goes silent. Need health-check + auto-recovery. *Severity: medium. Address in Phase 6 implementation.*

---

## Sources

- ADR-001: Document Identity — `docs/dev/001-document-identity.md` (HIGH)
- ADR-002: Source & Delivery Seams — `docs/dev/002-source-and-delivery-seams.md` (HIGH)
- ADR-003: Normalized Document Shape — `docs/dev/003-document-shape.md` (HIGH)
- ADR-004: Memory Sink Handles — `docs/dev/004-memory-sink-handles.md` (HIGH)
- v2 brief: `docs/dev/gsd-agent-knowledg-layer.md` (HIGH)
- v1 architecture: `.planning/codebase/ARCHITECTURE.md` (HIGH)
- [Drizzle ORM Prisma adapter docs](https://orm.drizzle.team/docs/prisma) — dialect-specific session types (HIGH)
- [Airbyte + LangChain integration](https://blog.langchain.com/introducing-airbyte-sources-within-langchain/) — runtime catalog-based capability discovery (HIGH)
- [SQLite Generated Columns](https://sqlite.org/gencol.html) — confirms generated columns cannot be PRIMARY KEY (HIGH)
- [SQLite forum: generated columns](https://sqlite.org/forum/forumpost/b8e266cf3e) — generated-column restrictions (HIGH)
- [Mem0 vs Letta vs MemGPT (2026)](https://tokenmix.ai/blog/ai-agent-memory-mem0-vs-letta-vs-memgpt-2026) — namespace isolation patterns in production memory layers (MEDIUM)
- [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) — multi-level scope as standard pattern (MEDIUM)
- [AI agent memory systems in 2026](https://hermesos.cloud/blog/ai-agent-memory-systems) — Zep/Mem0/Letta dual-layer architectures (MEDIUM)
- [Configure MCP servers for multiple connections](https://mcpcat.io/guides/configuring-mcp-servers-multiple-simultaneous-connections/) — per-session vs daemon trade-off (MEDIUM)
- [claude-context issue #285](https://github.com/zilliztech/claude-context/issues/285) — documented per-session CPU/memory churn (HIGH; primary source on the pain point)
- [Docker MCP Architecture 2026](https://markaicode.com/architecture/docker-mcp-architecture/) — shared daemon multiplexing pattern (LOW-MEDIUM)
- [VS Code Extension Host architecture](https://code.visualstudio.com/api/advanced-topics/extension-host) — separate-process plugin model reference (HIGH)
- [Backstage EntityProvider](https://backstage.io/docs/reference/plugin-catalog-node.entityprovider/) — first-party in-process plugin pattern (HIGH)
- [Backstage external integrations](https://backstage.io/docs/features/software-catalog/external-integrations/) — provider-as-connector pattern (HIGH)
- [Vite plugin registry](https://vite.dev/blog/announcing-vite8) — npm-package-as-plugin convention (MEDIUM)
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — assertion + LLM-judge hybrid eval architecture (HIGH)
- [Pragmatic Engineer: LLM evals for devs](https://newsletter.pragmaticengineer.com/p/evals) — code-based assertion strategy (MEDIUM)
- [EleutherAI lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) — YAML-spec eval pattern (HIGH)
- [MongoDB: The Agent Harness](https://www.mongodb.com/company/blog/technical/agent-harness-why-llm-is-smallest-part-of-your-agent-system) — harness architecture (MEDIUM)
- [Inside Turbopack: incremental computation](https://nextjs.org/blog/turbopack-incremental-computation) — fine-grained value-cell tracking (HIGH; rejected as overkill for vault-memory)
- [Salsa / rust-analyzer query-based incremental](https://www.mathematik.uni-marburg.de/~seba/publications/pluto-incremental-build.pdf) — demand-driven query model (MEDIUM; reference)
- [Bazel docs](https://bazel.build/) — static action graph + hash-based invalidation (HIGH)
- [Martian: markdown → Notion via mdast](https://github.com/tryfabric/martian) — confirms mdast-as-intermediate pattern (HIGH)
- [BlockNote (ProseMirror block editor)](https://github.com/TypeCellOS/BlockNote) — ADR-003's "rejected" alternative (b/d) validated (MEDIUM)
- [Notion working with Markdown](https://developers.notion.com/guides/data-apis/working-with-markdown-content) — Notion's official block↔markdown story (HIGH)
- [Docling Hybrid Chunking](https://docling-project.github.io/docling/concepts/chunking/) — hierarchy-aware chunking with chunk-id stability (MEDIUM)
- [Repeater.js rationale](https://repeater.js.org/docs/rationale/) — async iterators from callbacks (HIGH)
- [events-to-async](https://github.com/azu/events-to-async) — EventEmitter → async iterator bridge (MEDIUM)
- [Async iterators vs Observables (HN)](https://news.ycombinator.com/item?id=16310254) — orthogonality argument (MEDIUM)
