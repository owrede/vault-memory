# Phase 1: Adapter extraction & tech-debt-up — Research

**Researched:** 2026-05-14
**Domain:** TypeScript adapter-seam refactor + MCP SDK / Zod major-version upgrade + SQLite migration + CI grep enforcement
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: `obsidian://` URL generation moves into `SourceConnector.formatDisplayUrl(id): string | null`.** Each source adapter knows how to deep-link its own documents. `obsidian-fs` returns `obsidian://open?vault=…&file=…`; a future `notion-api` adapter returns `https://notion.so/<id>` or `null` (its choice). Result lands in `Document.display_url`, computed at `readDocument()` time, not search-render time. Propagates into Phase 3's ASM-05 citation packet. Removes `obsidianUrl()` from `src/server.ts:891` entirely.

- **D-02: `DEFAULT_CLIENT_ID = "claude-code"` replaced by MCP `client_info` handshake capture.** At server bootstrap, capture client name + version from MCP `InitializeRequest`; thread captured value as default `client_id` into `write.ts`, `frontmatter/update.ts`, and `deleteNote`. Fall back to `"unknown"` when `client_info` is absent. Does not require any tool-shape change.

- **D-03: `DEFAULT_EXCLUDES` (`.obsidian/**`, `.trash/**`, …) hardcoded inside the obsidian-fs source adapter only.** Excludes live in `src/adapters/source/obsidian-fs/scanner.ts` as adapter built-in defaults. User config (`config.toml`) and `ListOptions.excludeGlobs` overlay/replace them per ADR-002 §`ListOptions`. Core code carries no exclude defaults.

- **D-04: Wikilinks abstraction deferred entirely to Phase 4 (GRA-04 typed-edge schema).** Phase 1 leaves the `wikilinks` table (`src/db/schema.ts:103`), `WikilinksQueries`, and `WikilinkResolver` in their current locations. Phase 1 CI greps do **not** flag the token `wikilink`.

- **D-05: Wikilinks extracted by the obsidian-fs source adapter surface as `Document.properties.wikilinks: WikilinkRef[]`.** When `parseNote()` moves into `src/adapters/source/obsidian-fs/parser.ts`, the `extractWikilinks()` call stays inside the adapter. The adapter populates `Document.properties.wikilinks` during `readDocument()`. Core wikilinks table + resolver consume that property. Other adapters simply don't populate the field.

### Claude's Discretion

Five implementation areas — researcher + planner choose, anchored by ADRs and Phase 0 artifacts:

1. **PR cadence and refactor sequence.** Sequence of seam extractions (source → delivery → change-feed?), SDK/Zod bump position, smoketest, conformance. Planner picks the wave/dependency graph that keeps the phase branch green at every PR boundary. ADR-002 Invariants I-1..I-7 + CI greps enforced from the moment relevant code lands in `src/adapters/`.
2. **`doc_uri` Strategy-A staging.** ADP-07 says "dual-column, staged across two migration versions" (`v7` + `v8`) with backfill. Planner picks exact column shape, whether `v7` adds nullable + writes both columns and `v8` flips read preference / backfills / asserts NOT-NULL — or any equivalent staging that preserves rollback safety. v1-baseline eval must remain green at every migration boundary.
3. **MCP SDK 1.29 + Zod 4 migration approach (`registerTool` vs `setRequestHandler`).** Planner decides whether to migrate all 23 tools to `registerTool(...)` or keep existing `setRequestHandler(CallToolRequestSchema, …)` dispatch and just bump deps + add Standard Schema wiring. Either acceptable. Researcher recommends `registerTool` to avoid future breaking-bump cycle.
4. **Stub-adapter conformance suite scope (ADP-13).** Floor: "interface-shape + capability-descriptor + invariant assertions all green for both obsidian-fs and stub." Full "stubbed second adapter passes v1-baseline eval queries" belongs to Phase 3 (ASM-12).
5. **`scripts/smoketest-non-claude.mjs` target client (ADP-10).** Planner picks `@modelcontextprotocol/inspector` (CLI mode), `@modelcontextprotocol/sdk` test client, or both. Constraint: script must run **in CI** (gates merge), not just as a one-shot README instruction.

### Deferred Ideas (OUT OF SCOPE)

**To Phase 4:** wikilinks table → edges table with `type` column; `Document.properties.wikilinks` → `Document.edges`
**To Phase 2:** memory-sink write guard inside `DeliveryAdapter.write()`
**To Phase 10 (v3):** `VAULT_MEMORY_<SCHEME>_*` env-var secrets convention; adapter-private `__adapter_<scheme>_*` SQLite tables; third-party plugin loading
**Considered, kept out of Phase 1:** `src/config/add-vault.ts` path-safety hardening; pre-migration DB backup; `src/rerank/onnx-reranker.ts` path-ops carve-out (planner's choice — either confine to adapter or treat as `src/config/`-equivalent)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADP-01 | `src/adapters/source/` with `SourceConnector` + `obsidian-fs.ts`; refactor `src/reader/` + `src/indexer/` to satisfy it | §Adapter Seam Contracts; §Code-Path → Seam Method Map |
| ADP-02 | `src/adapters/delivery/` with `DeliveryAdapter` + `obsidian-fs.ts`; `write_note`/`update_frontmatter`/`delete_note` route through | §Adapter Seam Contracts; §Write Path Refactor |
| ADP-03 | `src/adapters/change-feed/` with `ChangeFeed` + `obsidian-fs.ts` (chokidar-backed); thin async-iterator helper | §Adapter Seam Contracts; §Watcher Refactor |
| ADP-04 | `src/types.ts` gains canonical `Document`, `BlockNode`, `Edge`, `SourceHandle`, `MemorySink`, `ChangeEvent` types | §Canonical Type Surface |
| ADP-05 | Branded `DocId` nominal type — not assignable from raw `string` | §Branded DocId Type |
| ADP-06 | Runtime capability descriptors on `SourceCapabilities` / `DeliveryCapabilities` | §Capability Descriptors |
| ADP-07 | DB migration introducing `doc_uri` column (Strategy A — dual-column, staged) + backfill | §doc_uri Dual-Column Migration |
| ADP-08 | `@modelcontextprotocol/sdk` bumped to `^1.29.x`; sampling, elicitation, extensions wired through | §MCP SDK 1.29 Migration |
| ADP-09 | `zod` bumped to `^4.x`; Standard Schema integration with MCP SDK 1.29 | §Zod 4 Migration |
| ADP-10 | `scripts/smoketest-non-claude.mjs` — MCP Inspector or SDK harness verifies non-Claude client | §Non-Claude Smoketest |
| ADP-11 | `docs/v2/AGENT_AGNOSTIC_AUDIT.md` — every Claude/Obsidian assumption in `src/` outside adapters/skills audited | §Agent-Agnostic Audit |
| ADP-12 | CI greps zero-hit outside adapters — `chokidar`, `gray-matter`, `path.*`, `fs.*`, `claude`/`Claude`, `obsidian://`, `.md` literals | §CI Grep Gates |
| ADP-13 | Conformance test suite — stubbed second adapter passes same suite as `obsidian-fs` | §Stub-Adapter Conformance Suite |
| ADP-14 | README rewritten to lead with "any MCP-aware agent"; Obsidian framed as v2 source connector | §README Rewrite |
| ADP-15 | All 324 v1 tests still pass; v1-baseline eval suite still green | §Backwards-Compat & Tool-Snapshot Tests |
</phase_requirements>

## Research Summary

Phase 1 is a substantial but mechanical refactor with **no user-visible behavior change** as its central safety net. The 324-test suite plus the v1-baseline eval bank (frozen in Phase 0) detect any drift. Most of the work is `git mv` + interface extraction + import-rewrite + dependency bump; the genuine new code is the three seam interfaces, the registry, the migration, the conformance suite, and the smoketest.

The phase decomposes cleanly into **six work clusters** that the planner can sequence:

1. **Type surface + branded DocId** (ADP-04, ADP-05) — pure additions, no behavior change, lands first because everything else imports from it.
2. **doc_uri migration (Strategy A)** (ADP-07) — additive `ALTER TABLE ADD COLUMN` + backfill, follows the existing migration 006 (`body_hash`) pattern; lands early so subsequent work can read/write `doc_uri` even if it's not yet the primary key.
3. **Adapter extraction — source, delivery, change-feed** (ADP-01..03, ADP-06) — three vertical slices, each is a `git mv` + interface extraction + thin-adapter facade. The existing modules already have the right shape (CONCERNS.md: "module boundaries are already mostly adapter-shaped"); chokidar is already isolated to one file (clean), gray-matter has 3 leaks to consolidate, fs.* has 4 leaks in `src/frontmatter` + `src/config` + `src/rerank`, all of which CONTEXT.md addresses.
4. **MCP SDK 1.29 + Zod 4 bump** (ADP-08, ADP-09) — two coupled major-version bumps. SDK 1.29 ships Standard Schema integration; Zod 4 is backwards-compatible via the `zod/v4` subpath for incremental migration. Recommended: bump SDK first (it accepts Zod 3 schemas already), migrate the 23 tools to `registerTool(...)` in `tool-registry.ts` + `server.ts`, then bump Zod to v4. The `tool-registry.ts` extraction from Phase 0 plan 00-10 makes this a single-file change.
5. **CI grep enforcement** (ADP-12) — `scripts/lint-adapters.sh` runs seven greps, one per invariant I-1..I-6 (plus the `Claude` leak grep). Each grep names the violating file + line + invariant ID and exits non-zero.
6. **Conformance suite + smoketest + audit + README** (ADP-10, ADP-11, ADP-13, ADP-14) — the proof-of-architecture deliverables. Conformance is a parameterized test bank; the smoketest is `npx @modelcontextprotocol/inspector --cli` against the built `dist/cli.js`; audit is a doc; README rewrite is text-only.

**Primary recommendation:** Sequence the work as 6 plans, with the `obsidian-fs` extraction as **three independent vertical slices** (source then delivery then change-feed), each landing with its own conformance assertions enabled in CI. This keeps the phase branch green at every PR boundary and detects invariant regressions the moment they land. Avoid a horizontal "interfaces first, then implementations" cut — it stretches the green-CI window across all three seams simultaneously.

**Risk hotspots:**
- Zod 4 error-customization API breaks (resolved by a one-time sweep of `.refine()` and error-map call sites in `src/config/loader.ts` and the 23 tool schemas)
- `registerTool()` Zod-4 description propagation bug (filed upstream, [issue #1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143)) — workaround documented below
- `registerTool()` silently drops `z.discriminatedUnion()` ([issue #1643](https://github.com/modelcontextprotocol/typescript-sdk/issues/1643)) — `PredicateSchema` in `query_frontmatter` uses `z.union()` not `z.discriminatedUnion()`, so we're safe, but verify with the snapshot test
- The `tools-list.snapshot.json` (Phase 0 plan 00-10) will be re-generated under SDK 1.29 + Zod 4; any drift fails CI. Researcher recommends pinning the snapshot regeneration to **after** registerTool migration so the snapshot captures the final SDK-1.29 + Zod-4 shape.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read documents from a vault | Source adapter (`src/adapters/source/obsidian-fs/`) | Core indexer (consumes `Document`) | ADR-002 §`SourceConnector`; I-2 confines `fs.*` here |
| Parse markdown + YAML frontmatter | Source adapter (gray-matter confined here) | — | ADR-002 I-4: gray-matter only in obsidian-fs |
| Write / update / delete vault files | Delivery adapter (`src/adapters/delivery/obsidian-fs/`) | Core write handlers (route through adapter) | ADR-002 §`DeliveryAdapter`; I-6 confines `fs.writeFile/unlink/rename` here |
| Watch filesystem for changes | Change-feed adapter (`src/adapters/change-feed/obsidian-fs/`) | Core indexer (subscribes) | ADR-002 §`ChangeFeed`; I-1 confines chokidar here |
| Mint `obsidian://` display URLs | Source adapter (`formatDisplayUrl`) | — | D-01; ADR-001 I-5 |
| Compute content / body hash | Source adapter (`hash(id)`) | Core types (`computeNoteHash` helper stays as pure utility) | ADR-002 §`hash()` contract |
| Run hybrid search, FTS, rerank | Core search (`src/search/`) | Adapter (provides `Document` to index) | Search operates on chunks + embeddings — adapter-agnostic |
| Manage SQLite + sqlite-vec | Core DB (`src/db/`) | — | Adapter-private tables prefixed `__adapter_<scheme>_*` (deferred to v3) |
| MCP protocol bootstrap + tool dispatch | Core server (`src/server.ts`, `src/tool-registry.ts`) | — | MCP SDK 1.29 surface; tool handlers call adapters by handle |
| Capture client_info from handshake | Core server bootstrap | Write handlers (read default from server-captured value) | D-02 |
| Resolve handle → adapter | Adapter registry (`src/adapters/registry.ts`) | — | ADR-002 §Registry |
| Branded `DocId` minting | Adapter (only place that constructs `DocId` from raw string) | Core (consumes branded type only) | ADP-05; opaque module-export pattern |
| Path-safety for vault writes | Delivery adapter (`safeJoinInsideVault` relocates here) | — | I-3 confines `path.*` to adapter; CONCERNS.md gap on `add-vault.ts` is deferred |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server transport + Standard Schema tool registration | Official TypeScript SDK; latest as of 2026-05-14 (verified via `npm view`) |
| `zod` | `^4.4.3` | Input validation + Standard Schema source | Latest stable; SDK 1.29 imports from `zod/v4` internally |
| `better-sqlite3` | `^11.7.0` | Synchronous SQLite driver (unchanged) | Existing |
| `sqlite-vec` | `^0.1.6` | Vector extension (unchanged) | Existing |
| `chokidar` | `^4.0.1` | Filesystem watcher (unchanged, relocated to change-feed adapter) | Existing |
| `gray-matter` | `^4.0.3` | YAML frontmatter parser (unchanged, relocated to source/delivery adapters) | Existing |
| `smol-toml` | `^1.3.1` | TOML parser for config (unchanged) | Existing |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/inspector` | `^0.21.2` (latest) | CLI smoketest harness | `scripts/smoketest-non-claude.mjs` via `npx @modelcontextprotocol/inspector --cli` |
| `vitest` | `^2.1.8` | Test runner (unchanged) | Conformance suite, unit tests |

**Verification (2026-05-14, `npm view`):**
- `@modelcontextprotocol/sdk` latest: `1.29.0`
- `zod` latest: `4.4.3`
- `@modelcontextprotocol/inspector` latest: `0.21.2`
- Engines pin `"node": ">=22"` is honored by both major bumps (no Node bump required).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@modelcontextprotocol/inspector --cli` for smoketest | Direct `@modelcontextprotocol/sdk` Client class | Inspector CLI is one-line `npx`, JSON output, designed for CI. SDK Client requires hand-rolled smoketest harness. Inspector wins for ADP-10 if scriptable in CI; researcher recommends Inspector + SDK Client as a **defense-in-depth** pair (Inspector covers the JSON protocol surface; SDK Client covers the Standard-Schema typed call surface). |
| Migrate to `registerTool()` | Keep `setRequestHandler(CallToolRequestSchema, ...)` | `registerTool()` is the future-direction API in SDK 1.29 (deprecated `.tool()` / `.prompt()` / `.resource()` are already removed). `setRequestHandler` still works but is the lower-level API; mixed use is supported. Recommended: migrate to `registerTool` in this phase so we don't carry a future breaking-bump cycle. |
| Codemod `zod-v3-to-v4` | Hand-edit Zod schemas | Codemod handles 80%+ of mechanical changes (`.strict()` → `z.strictObject()`, error-customization param renames). 23 tools × ~5 schemas each = ~115 schemas; codemod saves ~80% of editing time. Hand-edit remaining `.refine()` / error-map call sites. |

**Installation:**

```bash
npm install @modelcontextprotocol/sdk@^1.29.0 zod@^4.4.3
npm install -D @modelcontextprotocol/inspector@^0.21.2
```

## Architecture Patterns

### System Architecture Diagram

```
                        MCP Client (Claude Code, Claude Desktop,
                        ChatGPT Connector, MCP Inspector, ...)
                                       │
                                       │ stdio + JSON-RPC
                                       ▼
                        ┌──────────────────────────────────────┐
                        │   src/server.ts (MCP bootstrap)      │
                        │   - capture client_info on init      │
                        │   - registerTool() × 23 (SDK 1.29)   │
                        │   - tools imported from              │
                        │     src/tool-registry.ts             │
                        └──────────────┬───────────────────────┘
                                       │
                                       │ dispatches to tool handlers
                                       ▼
                        ┌──────────────────────────────────────┐
                        │   Tool handlers (search, write,      │
                        │   read_note, query_frontmatter, ...) │
                        │   - accept DocId / vault handle      │
                        │   - call adapters via registry       │
                        └──────────────┬───────────────────────┘
                                       │
                                       │ resolves handle → adapter
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ src/adapters/registry.ts             │
                        │  - listSources()                     │
                        │  - resolveSource(handle)             │
                        │  - resolveDelivery(handle)           │
                        │  - resolveChangeFeed(handle)         │
                        └──┬──────────────┬─────────────────┬──┘
                           │              │                 │
              SourceConnector       DeliveryAdapter      ChangeFeed
                           │              │                 │
                           ▼              ▼                 ▼
        ┌─────────────────────────────────────────────────────────────┐
        │   src/adapters/source/obsidian-fs/      (fs.* + gray-matter)│
        │   src/adapters/delivery/obsidian-fs/    (atomic write + OCC)│
        │   src/adapters/change-feed/obsidian-fs/ (chokidar)          │
        │                                                              │
        │   (Phase 10 / v3): notion-api/ adds three more files —       │
        │   core code does not change.)                                │
        └─────────────────────────────────────────────────────────────┘
                                       │
                                       │ reads/writes files
                                       ▼
                        ┌──────────────────────────────────────┐
                        │   Obsidian vault on disk             │
                        │   (.md files + .obsidian/ excluded)  │
                        └──────────────────────────────────────┘

         Independent path (unchanged in Phase 1):
                                       │
        Core indexer (src/indexer/) → SQLite + sqlite-vec + FTS5
        Core search (src/search/)   ← reads chunks + embeddings + FTS
        Core graph (src/graph/)     ← reads wikilinks table
        Core frontmatter (src/frontmatter/) → reads notes.frontmatter

       Phase 1 change: indexer consumes Document (via SourceConnector.readDocument)
       instead of reading files directly; rest of the core layer keeps its
       existing tables and queries. doc_uri column added but not yet PK.
```

### Recommended Project Structure

```
src/
├── adapters/                      # NEW — Phase 1 home of all I/O
│   ├── source/
│   │   ├── obsidian-fs/
│   │   │   ├── index.ts           # ObsidianFsSource implements SourceConnector
│   │   │   ├── scanner.ts         # (relocated from src/reader/scanner.ts)
│   │   │   ├── parser.ts          # (relocated from src/reader/parser.ts)
│   │   │   ├── hash.ts            # (relocated from src/reader/hash.ts)
│   │   │   ├── wikilinks.ts       # (relocated from src/reader/wikilinks.ts)
│   │   │   └── *.test.ts
│   │   └── types.ts               # SourceConnector, SourceCapabilities, ListOptions, DocumentRef
│   ├── delivery/
│   │   ├── obsidian-fs/
│   │   │   ├── index.ts           # ObsidianFsDelivery implements DeliveryAdapter
│   │   │   ├── write.ts           # (relocated from src/write/write.ts, gray-matter import lives here)
│   │   │   ├── fs.ts              # (relocated from src/write/fs.ts — atomicWriteFile, safeJoinInsideVault)
│   │   │   └── *.test.ts
│   │   └── types.ts               # DeliveryAdapter, DeliveryCapabilities, WriteOptions, ...
│   ├── change-feed/
│   │   ├── obsidian-fs/
│   │   │   ├── index.ts           # ObsidianFsChangeFeed implements ChangeFeed
│   │   │   ├── watcher.ts         # (relocated from src/watcher/watcher.ts)
│   │   │   ├── queue.ts           # (relocated from src/watcher/queue.ts)
│   │   │   ├── suppression.ts     # (relocated from src/watcher/suppression.ts)
│   │   │   └── *.test.ts
│   │   └── types.ts               # ChangeFeed, ChangeEvent
│   ├── stub/                      # NEW — Phase 1 in-memory stub adapter
│   │   ├── source.ts              # StubSource (Map<DocId, Document>)
│   │   ├── delivery.ts            # StubDelivery (writes to the same Map)
│   │   ├── change-feed.ts         # StubChangeFeed (EventEmitter-backed)
│   │   └── *.test.ts
│   ├── registry.ts                # NEW — handle parser + adapter instantiation
│   └── capabilities.ts            # NEW — shared SourceCapabilities/DeliveryCapabilities types
├── audit/                         # unchanged
├── chunker/                       # unchanged (still consumes ParsedNote until Phase 3 brings BlockNode)
├── cli.ts                         # minor: "Claude Code" message rewritten
├── config/                        # unchanged (fs.* allowed here by I-2)
├── db/                            # unchanged + doc_uri migration (v7, v8)
├── frontmatter/                   # update.ts loses fs.readFile + gray-matter (routes via adapter)
├── graph/                         # unchanged
├── indexer/                       # consumes Document via SourceConnector (was: reads files directly)
├── ollama/                        # unchanged
├── reader/                        # OBSOLETE — moved to src/adapters/source/obsidian-fs/
├── rerank/                        # unchanged (researcher recommendation: confine path-ops inside
│                                  #  this module to a thin ModelLoader interface; planner's choice)
├── schema/                        # unchanged
├── search/                        # unchanged
├── server.ts                      # registerTool() migration; client_info capture; adapter bootstrap
├── tool-registry.ts               # extends to carry Zod schemas alongside JSON schemas (Phase 0 prep)
├── types.ts                       # ADDITIONS: Document, BlockNode, Edge, SourceHandle,
│                                  #            MemorySink, ChangeEvent, branded DocId (ADP-04, ADP-05)
├── vault/                         # unchanged (per-vault handle = Vault.config.name)
├── watcher/                       # OBSOLETE — moved to src/adapters/change-feed/obsidian-fs/
└── write/                         # OBSOLETE — moved to src/adapters/delivery/obsidian-fs/
```

### Pattern 1: Adapter Seam Extraction (mechanical `git mv` + thin facade)

**What:** Each seam (source / delivery / change-feed) extracts as `git mv` of existing modules into `src/adapters/{role}/obsidian-fs/`, then a `index.ts` facade implements the interface and delegates to the relocated implementation files.

**When to use:** Any of the three seam extractions; ensures git blame survives.

**Example sketch (source):**

```typescript
// src/adapters/source/obsidian-fs/index.ts
// Source: synthesized from ADR-002 §SourceConnector + existing src/reader/*
import type { SourceConnector, SourceCapabilities, ListOptions, DocumentRef }
  from "../types.js";
import type { DocId, Document } from "../../../types.js";
import type { VaultConfig } from "../../../types.js";
import { scanVault } from "./scanner.js";   // relocated from src/reader/scanner.ts
import { parseNote } from "./parser.js";    // relocated from src/reader/parser.ts
import { promises as fs } from "node:fs";   // ALLOWED here (I-2)

export class ObsidianFsSource implements SourceConnector {
  constructor(private readonly vault: VaultConfig) {}

  readonly handle = `obsidian-fs://${this.vault.name}` as SourceHandle;

  readonly capabilities: SourceCapabilities = {
    bodyShape: "flat-text",
    properties: "untyped",
    linkTypes: ["wikilink", "embed"] as const,
    identityStable: false,
    permissions: false,
    contentHashStable: true,
    refHashKind: "content",       // sha256(body) — content-identical
    watch: "push",                // chokidar
  };

  async *listDocuments(opts?: ListOptions): AsyncIterable<DocumentRef> {
    for await (const file of scanVault(this.vault.path, opts?.excludeGlobs)) {
      // Yield {id: DocId, mtime, hash}
    }
  }

  async readDocument(id: DocId): Promise<Document> {
    const relativePath = parseObsidianFsDocId(id, this.vault.name);
    const parsed = await parseNote(/* ... */);
    // Map ParsedNote -> Document (ADR-003 shape).
    // Wikilinks land in properties.wikilinks per D-05.
    return mapParsedNoteToDocument(parsed, id, this.handle);
  }

  async hash(id: DocId): Promise<string> { /* cheap sha256(body) */ }
  async exists(id: DocId): Promise<boolean> { /* fs.stat → boolean */ }
  formatDisplayUrl(id: DocId): string | null {
    const rel = parseObsidianFsDocId(id, this.vault.name);
    return `obsidian://open?vault=${encodeURIComponent(this.vault.name)}&file=${encodeURIComponent(rel)}`;
  }
}
```

### Pattern 2: Branded `DocId` minting (opaque module export)

**What:** Branded type lives in `src/types.ts` but the brand constructor is **only** exported from the adapter registry. Core code can read a `DocId` but cannot construct one from a raw string.

**Example:**

```typescript
// src/types.ts — branded nominal type per ADP-05
export type DocId = string & { readonly __brand: "DocId" };

// src/adapters/registry.ts — the ONLY place DocIds are minted
const { mintDocId, parseDocId } = (() => {
  const mint = (s: string): DocId => s as DocId;
  const parse = (s: string): DocId => {
    // RFC-3986-ish validation: <scheme>://<authority>/<resource>
    if (!/^[a-z][a-z0-9-]*:\/\/[^/]+\/.+$/.test(s)) {
      throw new Error(`Invalid DocId: ${s}`);
    }
    return mint(s);
  };
  return { mintDocId: mint, parseDocId: parse };
})();
export { parseDocId };  // only the parser is exported — mint stays private
```

Any callsite outside `src/adapters/` that needs to pass a `DocId` to a tool handler must go through `parseDocId(raw_string)`. The compile error surfaces on first build under SDK 1.29.

### Pattern 3: dual-column migration (Strategy A, recommended staging)

**What:** Two migrations (v7 = add nullable, v8 = backfill + flip read preference; v9 future = drop `path`). This honors ADP-07 "dual-column, staged across two migration versions" verbatim.

**Example sketch:**

```typescript
// src/db/schema.ts — Migration 007: additive
const MIGRATION_007_DOC_URI_ADD = `
ALTER TABLE notes  ADD COLUMN doc_uri TEXT;
ALTER TABLE chunks ADD COLUMN doc_uri TEXT;
-- write_audit + wikilinks: deferred to v8 (denormalized; minimal churn first)
CREATE INDEX IF NOT EXISTS idx_notes_doc_uri  ON notes(doc_uri);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_uri ON chunks(doc_uri);
`;

// Migration 008: backfill + assert NOT NULL via index uniqueness
function runMigration008(db: BetterSqlite3Database): void {
  // For every notes row: doc_uri = 'obsidian-fs://' + <vault_name> + '/' + path
  // Vault name comes from the DB filename pattern (db filename = vault name).
  // Best path: pass vault name into the migration runner via a hook.
  //
  // The runner today does NOT pass extra context — schema.ts callsite is
  // Database constructor. Researcher recommends: extract vault name from
  // the DB's parent directory (one hop up), since DB files live at
  // ~/.vault-memory/dbs/<vault_name>.db.
  //
  // Pseudo:
  //   const vault_name = derive_from_db_path(db);
  //   db.prepare('UPDATE notes SET doc_uri = ?||?||path').run(prefix, '/');
  //   ... same for chunks via JOIN notes ...
  //   CREATE UNIQUE INDEX uq_notes_doc_uri ON notes(doc_uri) WHERE doc_uri IS NOT NULL;
  //   (deferred NOT NULL until v9 — Phase 3 or later)
}
```

The planner can decide whether to add doc_uri to `wikilinks`, `write_audit`, and per-model `embeddings_m*_d*` in v7 or stage to a later migration; researcher recommends v7 adds **only** `notes` + `chunks` to keep blast radius small, and v8 backfills.

### Anti-Patterns to Avoid

- **Horizontal-cut refactor:** Don't extract all three seam interfaces in one PR before any implementation lands. The phase branch will stay red. Cut **vertical** (per seam: types + impl + tests + invariant grep enabled), so each PR lands green.
- **Re-importing `gray-matter` in core code:** Anywhere outside `src/adapters/source/obsidian-fs/` and `src/adapters/delivery/obsidian-fs/` violates I-4. `src/write/write.ts:13` and `src/frontmatter/update.ts:24` are the two existing leaks to consolidate.
- **Treating `path` as a primary key in new code:** ADR-001 I-3 forbids this. `doc_uri` is the v2 PK going forward; `path` lives only inside `src/adapters/source/obsidian-fs/` as a denormalized cache column.
- **Hand-rolling JSON canonicalization for hashes:** ADR-003 H-2 mandates RFC 8785 (JCS). Phase 1 keeps the existing `computeNoteHash`/`computeBodyHash` for backwards-compat under the v1 hash semantics; Phase 3 introduces the ADR-003 hash via `src/render/plain-text.ts` (Phase-3 work, NOT Phase 1).
- **Skipping the `.memory-sink` sentinel:** D-04 of ADR-004 — Phase 2 depends on this. Phase 1's `DeliveryAdapter` does not implement it but MUST NOT prevent its later addition (e.g., don't add a write-time check that would conflict).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP transport + tool dispatch | A custom JSON-RPC wrapper | `@modelcontextprotocol/sdk` ≥1.29 with `registerTool()` | Official SDK handles stdio framing, content-type envelopes, error wrapping, list/call/init lifecycle, sampling, elicitation, extensions |
| Zod → JSON Schema conversion | A hand-rolled converter | SDK 1.29's `registerTool()` does Standard-Schema-to-JSON-Schema automatically when given a `z.object()` | The SDK uses Standard Schema as the contract; pass a Zod 4 object and the schema is published in `tools/list` automatically |
| MCP Inspector smoketest harness | A custom Node script | `npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list` | Inspector ships a CLI mode designed exactly for non-interactive smoketests; outputs JSON; exit-code signals pass/fail |
| FilesystemPathSafety on writes | Reinvent `safeJoinInsideVault` | Use existing `src/write/fs.ts:safeJoinInsideVault` — relocate it to `src/adapters/delivery/obsidian-fs/fs.ts` | Already battle-tested (handles symlinks via `fs.realpath`, absolute-path rejection, prefix-check) |
| YAML frontmatter parsing/serialization | A hand-rolled parser | `gray-matter` (already a dependency) | Phase 1's job is **not** to replace gray-matter; it's to confine it to one adapter directory |
| Filesystem watching | A poll-loop replacement for chokidar | Keep `chokidar` — relocate to `src/adapters/change-feed/obsidian-fs/watcher.ts` | chokidar handles rename / atomic-write / OS-specific event semantics; replacing it is a multi-month rabbit hole |
| Branded type enforcement | A runtime check / class wrapper | TypeScript intersection-type brand `string & { readonly __brand: "DocId" }` | Zero runtime cost; compile-time-only check; ADP-05 explicitly calls for this pattern |
| Codemod for Zod v3 → v4 | Hand-edit 115 schemas | [`zod-v3-to-v4`](https://github.com/dvkndn/zod-v3-to-v4) unofficial codemod | Handles 80%+ of mechanical changes (`.strict()` → `z.strictObject()`, error-customization param renames, deprecated `errorMap` → `error`); maintained migration tool |
| MCP client-info capture | A bespoke handshake parser | SDK 1.29 exposes `server.client.getClientInfo()` on the connected session | The SDK already parses `InitializeRequest.params.clientInfo`; just read it during the `initialize` callback |

**Key insight:** Phase 1 is **almost entirely a `git mv` + interface-extraction exercise**, not a "build new things" exercise. The only genuine new code is: branded `DocId` type, the three seam interface declarations, the adapter registry, the stub adapter, the conformance test bank, the migration, the lint script, and the smoketest. Everything else is moves and rewrites of existing working code.

## Runtime State Inventory

> Phase 1 is a refactor + dependency-bump phase; checking each runtime-state category explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | SQLite per-vault DBs at `~/.vault-memory/dbs/<vault>.db` carry path-keyed rows in `notes` (and FKs `chunks`, `wikilinks`, `write_audit`, per-model `embeddings_m*_d*`). The migration 007 (additive `ALTER TABLE ADD COLUMN doc_uri TEXT`) and 008 (backfill `doc_uri = 'obsidian-fs://<vault>/' + path`) are mandatory. | Data migration: migration 008 backfills `doc_uri` for every existing row. **Both** a code edit (adapter mints `doc_uri` on new writes) and a data migration (backfill old rows) are required. |
| **Live service config** | None. vault-memory has no external service config; all state lives in the local SQLite DB + `~/.vault-memory/config.toml`. No n8n / Datadog / Cloudflare equivalents. | None. |
| **OS-registered state** | None. vault-memory is invoked per-MCP-session by the host (Claude Code / Desktop / Inspector). No launchd, pm2, systemd, or Task Scheduler registrations to update. | None. |
| **Secrets / env vars** | Two optional env vars: `VAULT_MEMORY_ACTIVE_VAULT` (scope filter) and `VAULT_MEMORY_RERANKER_DIR` (model location). Neither is renamed in Phase 1. The `VAULT_MEMORY_<SCHEME>_*` convention (ADR-002 Open follow-ups) is deferred to v3 Phase 10. | None — verified by grep for `VAULT_MEMORY_*` in src/. |
| **Build artifacts** | `dist/cli.js` (single ESM bundle) is rebuilt by `tsup` on every install. No stale `.egg-info`-style artifacts. The `.mcp.json` files written into vault roots by `vault-memory add-vault` carry a `command` field that points at the absolute path of the installed `vault-memory` binary; the refactor does NOT change the binary name, so these stay valid. | None — `npm run build` regenerates `dist/`. |

**Critical:** the doc_uri migration is the only runtime-state change. The backfill MUST be idempotent (running migration 008 twice on the same DB must not corrupt rows) and rollback-safe (SQLite transaction wraps the migration runner per `src/db/database.ts:99`; failure rolls back automatically). Researcher recommends adding an explicit test in `src/db/database.test.ts` that runs the migration on a sample DB, then verifies `doc_uri` is non-null for every row and matches the expected `obsidian-fs://<vault>/<path>` shape.

## Common Pitfalls

### Pitfall 1: Zod 4 `.refine()` callsites silently change behavior

**What goes wrong:** Zod 4 unified the error-customization parameter into a single `error` field. Old `.refine(predicate, { message: "..." })` and `.refine(predicate, "...")` still work, but custom `errorMap` is deprecated. The MCP SDK 1.29 publishes JSON Schema via Standard Schema; refinements with custom messages may not propagate identically.

**Why it happens:** Zod's error-customization migration is the largest single area of breaking change in v4 ([Zod migration guide](https://zod.dev/v4/changelog)).

**How to avoid:** Run the `zod-v3-to-v4` codemod first; then sweep `src/config/loader.ts` (the AppConfigSchema with custom refinements) and the 23 tool schemas in `src/server.ts` (lines 49–158). Verify the snapshot `evals/v1-baseline/tools-list.snapshot.json` is unchanged or update it intentionally as part of the bump PR.

**Warning signs:** Snapshot diff in `tools-list.snapshot.json` after the bump; runtime errors with message text differing from v3.

### Pitfall 2: `registerTool()` drops `inputSchema` descriptions when given Zod 4 schemas

**What goes wrong:** Zod 4 schemas passed to `registerTool({ inputSchema: z.object({ x: z.string().describe("...") }) })` lose the description in the published JSON Schema. ([typescript-sdk#1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143))

**Why it happens:** SDK 1.29's `normalizeObjectSchema` doesn't preserve Zod 4's metadata on `describe()` calls.

**How to avoid:**
- Option A: Keep the existing `inputSchema` JSON-Schema literal in `src/tool-registry.ts` (Phase 0 plan 00-10 already separated them); pass that JSON Schema to `registerTool({ inputSchema: <literal> })` directly. SDK 1.29 accepts raw JSON Schema via `fromJsonSchema` adapter, so descriptions are preserved verbatim.
- Option B: Migrate the descriptions into a parallel `description: ` field per-tool and set them on `registerTool()` at registration time.

Researcher recommends Option A — the JSON Schema literals in `tool-registry.ts` are already the source of truth for `tools/list`; using them directly avoids the regression. Use the Zod schema only for **input validation** at handler time, not for publishing.

**Warning signs:** Snapshot test diff where `description` fields disappear from `tools/list`.

### Pitfall 3: `registerTool()` silently drops `z.discriminatedUnion()` schemas

**What goes wrong:** SDK 1.29 sends `{"type":"object","properties":{}}` to clients when the inputSchema uses `z.discriminatedUnion()`. ([typescript-sdk#1643](https://github.com/modelcontextprotocol/typescript-sdk/issues/1643))

**How to avoid:** Our 23 tools use `z.union()` (`PredicateSchema` in `query_frontmatter`, `src/server.ts:84-92`), not `z.discriminatedUnion()`. Snapshot test catches it if anyone introduces one in a future change.

### Pitfall 4: `client_info` is missing on older clients

**What goes wrong:** MCP `InitializeRequest.params.clientInfo` is optional in the spec; older or non-conformant clients (and our existing test suite if it spins up a minimal client) may not send it. D-02 specifies fallback to `"unknown"`.

**How to avoid:** Wrap the read in a default: `const clientId = server.client?.getClientInfo()?.name ?? "unknown";`. Add a test in `src/server.test.ts` that constructs the server without an `initialize` call and asserts the default surfaces.

### Pitfall 5: `obsidian-fs://<vault>/<path>` percent-encoding ambiguity

**What goes wrong:** ADR-001 §"Open follow-ups" leaves percent-encoding of `<resource>` (paths with spaces, non-ASCII) as a Phase-1 follow-up. If migration 008 backfills `doc_uri` with **un-encoded** paths and Phase 3's `display_url` minter emits **encoded** ones (`obsidian://open?vault=…&file=…` requires encoding), the two strings diverge.

**How to avoid:** Pick one form for `doc_uri` and document it in the adapter README. Researcher recommends: `doc_uri` stores paths **un-encoded** (raw forward-slash paths with spaces and Unicode passed through). The `formatDisplayUrl()` method percent-encodes at presentation time. This matches the v1 `path` column (also un-encoded) and minimizes migration risk.

**Warning signs:** `display_url` strings in tool output containing literal `%20` while the underlying `doc_uri` has spaces; broken Obsidian deep-links.

### Pitfall 6: chokidar's `awaitWriteFinish` interacts with the watcher relocation

**What goes wrong:** `src/watcher/watcher.ts:91-94` configures `awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }`. This is critical for atomic-rename writes (`atomicWriteFile` in `src/write/fs.ts`). If the chokidar config is silently changed during the relocation, the `SuppressionSet` will race and our own writes will re-index.

**How to avoid:** Preserve the chokidar config byte-for-byte. The existing watcher test (`src/watcher/watcher.test.ts`) exercises the suppression path; running it after relocation is the safety net. Add an assertion to the conformance suite: "for `obsidian-fs` change-feed, an atomic write followed by `subscribe()` with the suppression-marker registered MUST NOT emit a ChangeEvent".

### Pitfall 7: `dist/cli.js` shebang interacts with the SDK bump

**What goes wrong:** SDK 1.29 may bump its own deps in a way that breaks the tsup `external` config. `better-sqlite3`, `sqlite-vec`, `onnxruntime-node`, `@huggingface/tokenizers` are externalized (see CLAUDE.md "Module / Bundling Strategy"). If SDK 1.29 pulls in a new native dep, it needs to be added to the externals list, or `dist/cli.js` will fail to bundle.

**How to avoid:** Run `npm run build` after the SDK bump in CI; the existing tsup config (`tsup.config.ts`) names externals. Verify `npm run start` succeeds against the built `dist/cli.js`.

## Code Examples

### Example 1: registerTool() with raw JSON Schema (preserves descriptions)

```typescript
// Source: synthesized from MCP SDK 1.29 docs + Pitfall 2 workaround
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";  // resolves to zod/v4 after Phase 1 bump
import { TOOLS } from "./tool-registry.js";

const server = new McpServer(
  { name: "vault-memory", version: VERSION },
  { capabilities: { tools: {} } },
);

// For each of the 23 tools:
for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,  // raw JSON Schema object — descriptions preserved
    },
    async (args) => {
      const validated = tool.zodSchema.parse(args);  // Zod 4 validation at handler time
      return await tool.handler(validated);
    },
  );
}

// Capture client_info per D-02 (after connect):
const transport = new StdioServerTransport();
await server.connect(transport);
const clientId = server.client?.getClientInfo()?.name ?? "unknown";
// `clientId` flows as default into write.ts / frontmatter/update.ts / deleteNote
```

### Example 2: SourceConnector implementation (Document mapping)

```typescript
// Source: synthesized from ADR-002 Example A + ADR-003 Document shape
// src/adapters/source/obsidian-fs/index.ts
import { promises as fs } from "node:fs";  // ALLOWED here (I-2)
import matter from "gray-matter";          // ALLOWED here (I-4)
import { parseDocId, mintDocId } from "../../registry.js";
import type { SourceConnector, DocumentRef, ListOptions }
  from "../types.js";
import type { Document, DocId } from "../../../types.js";

export class ObsidianFsSource implements SourceConnector {
  constructor(private readonly vault: { name: string; path: string }) {}

  async readDocument(id: DocId): Promise<Document> {
    const rel = this.docIdToPath(id);
    const abs = `${this.vault.path}/${rel}`;          // path.join confined here
    const raw = await fs.readFile(abs, "utf-8");
    const stat = await fs.stat(abs);
    const parsed = matter(raw);

    return {
      id,
      source: `obsidian-fs://${this.vault.name}` as SourceHandle,
      title: this.extractTitle(parsed.content, rel),
      blocks: [{ kind: "paragraph", text: parsed.content }],  // Phase 1 stub
      properties: {
        ...this.wrapFrontmatter(parsed.data),
        // D-05: wikilinks live on the Document as a property
        wikilinks: {
          type: "unknown",
          value: this.extractWikilinks(parsed.content, parsed.data),
        },
      },
      links: [],                                       // Phase 4 fills typed edges
      mtime: Math.floor(stat.mtimeMs),
      hash: this.computeNoteHash(parsed.content, parsed.data),
    };
  }

  formatDisplayUrl(id: DocId): string | null {
    const rel = this.docIdToPath(id);
    return `obsidian://open?vault=${encodeURIComponent(this.vault.name)}` +
           `&file=${encodeURIComponent(rel)}`;
  }

  // ... listDocuments, hash, exists, capabilities
}
```

### Example 3: ChangeFeed adapter (chokidar relocation)

```typescript
// Source: relocation of src/watcher/watcher.ts (lines 15-16 chokidar import)
// src/adapters/change-feed/obsidian-fs/index.ts
import chokidar from "chokidar";  // ALLOWED here (I-1)
import type { ChangeFeed, ChangeEvent, SourceHandle } from "../types.js";
import type { DocId } from "../../../types.js";
import { mintDocId } from "../../registry.js";

export class ObsidianFsChangeFeed implements ChangeFeed {
  constructor(
    public readonly handle: SourceHandle,
    private readonly vault: { name: string; path: string },
    private readonly suppression: SuppressionSet,
  ) {}

  subscribe(handler: (e: ChangeEvent) => void): Disposable {
    const watcher = chokidar.watch(this.vault.path, {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignored: [/(^|[\\/])\../, "**/*.tmp.*"],
      followSymlinks: false,
      ignoreInitial: true,
    });
    watcher.on("add", (abs) => this.emit("create", abs, handler));
    watcher.on("change", (abs) => this.emit("update", abs, handler));
    watcher.on("unlink", (abs) => this.emit("delete", abs, handler));
    // chokidar v4 emits `rename` as add+unlink pair — coalesce in the
    // suppression-aware path; ADR-001 I-4 forbids treating rename as delete+create.
    return { [Symbol.dispose]: () => watcher.close() };
  }

  // ... close, capability descriptor
}
```

### Example 4: Stub adapter (in-memory, for conformance suite)

```typescript
// src/adapters/stub/source.ts
import type { SourceConnector, DocumentRef } from "../source/types.js";
import type { DocId, Document } from "../../types.js";

export class StubSource implements SourceConnector {
  private readonly docs: Map<DocId, Document>;

  constructor(initial: Document[] = []) {
    this.docs = new Map(initial.map((d) => [d.id, d]));
  }

  readonly handle = "stub://memory" as SourceHandle;

  readonly capabilities = {
    bodyShape: "flat-text",
    properties: "untyped",
    linkTypes: [] as const,
    identityStable: true,   // stub IDs never rename
    permissions: false,
    contentHashStable: true,
    refHashKind: "content",
    watch: "push",
  };

  async *listDocuments(): AsyncIterable<DocumentRef> {
    for (const doc of this.docs.values()) {
      yield { id: doc.id, mtime: doc.mtime, hash: doc.hash };
    }
  }

  async readDocument(id: DocId): Promise<Document> {
    const doc = this.docs.get(id);
    if (!doc) throw new Error(`Not found: ${id}`);
    return doc;
  }

  async hash(id: DocId): Promise<string> { return this.docs.get(id)?.hash ?? ""; }
  async exists(id: DocId): Promise<boolean> { return this.docs.has(id); }
  formatDisplayUrl(): string | null { return null; }  // honest: stub has none
}
```

### Example 5: CI grep enforcement script

```bash
#!/bin/sh
# scripts/lint-adapters.sh — enforces ADR-002 invariants I-1..I-6 mechanically
# Follows the style of scripts/check-fixture-privacy.sh and scripts/lint-no-telemetry.sh.
set -eu

FAIL=0

check() {
  invariant="$1"
  pattern="$2"
  allowed_prefix="$3"
  description="$4"

  # ripgrep is preferred; fall back to grep -r for portability.
  hits=$(
    grep -rEn "$pattern" src \
      --include='*.ts' \
      --exclude='*.test.ts' 2>/dev/null \
      | grep -vE "^$allowed_prefix" \
      || true
  )
  if [ -n "$hits" ]; then
    echo "✗ Invariant $invariant violated ($description):" >&2
    echo "$hits" | sed 's/^/    /' >&2
    FAIL=1
  else
    echo "✓ $invariant green: $description"
  fi
}

# I-1: chokidar only in change-feed adapter
check "I-1" "^import .* from ['\"]chokidar['\"]" \
  "src/adapters/change-feed/" "chokidar"

# I-2: fs.* only in adapters + src/config/
check "I-2" "^import .*from ['\"](node:)?fs['\"]|^import .*from ['\"](node:)?fs/promises['\"]" \
  "src/(adapters|config)/" "raw fs imports"

# I-3: path.join / path.resolve only in adapters + src/config/
check "I-3" "from ['\"](node:)?path['\"]" \
  "src/(adapters|config)/" "raw path imports"

# I-4: gray-matter only in obsidian-fs adapter
check "I-4" "^import .* from ['\"]gray-matter['\"]" \
  "src/adapters/(source|delivery)/obsidian-fs/" "gray-matter"

# I-5: bare .md literals only in adapters
check "I-5" "['\"]\\.md['\"]|endsWith\\(['\"]\\.md['\"]" \
  "src/adapters/" "bare .md literals"

# I-6: fs.writeFile / fs.unlink / fs.rename only in delivery adapter
check "I-6" "fs\\.(writeFile|unlink|rename)|fs/promises['\"].*\\b(writeFile|unlink|rename)\\b" \
  "src/adapters/delivery/" "raw write operations"

# Bonus: Claude-specific leaks (ADP-12 + D-02)
check "C-1" "['\"]claude[^'\"]*['\"]|Claude Code|Claude\\.ai" \
  "src/cli\\.ts$|src/tool-registry\\.ts$" "Claude branding"

# 'obsidian://' literal (ADR-001 I-5: display-only, never in identity)
check "I-5b" "obsidian://" \
  "src/adapters/source/obsidian-fs/" "obsidian:// outside adapter"

if [ "$FAIL" -eq 1 ]; then
  echo "" >&2
  echo "Adapter-seam invariant violation(s) above. See docs/v2/adr/002-adapter-seams.md §Invariants." >&2
  exit 1
fi
echo "✓ All adapter-seam invariants green."
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool(...)` / `server.prompt(...)` / `server.resource(...)` | `server.registerTool(...)` / `registerPrompt` / `registerResource` | Removed in SDK 1.x earlier; SDK 1.29 is the current API | Phase 1 must use `registerTool` for any new code; existing code uses `setRequestHandler(CallToolRequestSchema)` which is still supported but lower-level |
| Zod 3 `errorMap` + `.refine({ message })` | Zod 4 unified `error` parameter | Zod 4.0 (2025-08) | Mechanical sweep; codemod handles most; description-preservation has a known MCP SDK bug ([#1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143)) |
| Path-as-primary-key (`notes.path UNIQUE`) | URI-based `doc_uri` (`notes.doc_uri UNIQUE`) | Phase 1 (ADR-001 I-3) | Migration 007 + 008 (additive, dual-column staging — Strategy A); path stays as denormalized cache column |
| `.tool()` / `.prompt()` returning JSON Schema literal | `registerTool({ inputSchema: <Zod | JSON Schema> })` using Standard Schema | SDK 1.29 | Standard Schema means Valibot / ArkType / TypeBox all work; Zod 4 is one of many; pin to Zod for now |
| Hand-rolled smoketest harness | `npx @modelcontextprotocol/inspector --cli ... --method tools/list` | Inspector 0.10+ | Inspector ships a non-interactive CLI mode for CI; exit code signals pass/fail |

**Deprecated/outdated:**
- `server.tool(...)` (low-level signature) — removed in SDK 1.x; no longer present in 1.29
- Zod 3 `.refine().errorMap` shape — deprecated in Zod 4; still works but emits a warning
- The `embeddings` (singular, dim-1024-only) table — migrated out in v4/v5 already; mentioned only for historical reference

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MCP SDK 1.29 accepts raw JSON Schema literals via `registerTool({ inputSchema: <raw JSON Schema> })` and preserves descriptions | §Pitfall 2 / §Example 1 | If JSON-Schema path also drops descriptions, `tools-list.snapshot.json` shows description drift; planner must either accept the diff (regenerate snapshot) or wire `tools/list` to bypass `registerTool` and emit the JSON Schema directly |
| A2 | The current snapshot `evals/v1-baseline/tools-list.snapshot.json` was generated under SDK ≤1.0.4 with the old JSON-Schema shape; bumping to 1.29 may produce structurally identical output (since `tool-registry.ts` already publishes raw JSON Schema) but **could** emit additional fields | §MCP SDK 1.29 Migration | Snapshot regeneration is mandatory at bump time; the PR must explicitly review the diff |
| A3 | The chokidar v4 add+unlink pair representing a file rename can be coalesced in the change-feed adapter without losing data | §Pitfall 6 / §Example 3 | If coalescing introduces a race where rename is observed as delete+create, indexer history breaks. ADR-001 I-4 mandates rename emission with `{old_id, new_id}`. Researcher recommends Phase 1 emits separate `delete` + `create` events for now (matching v1 behavior) and **defers** true rename detection to a Phase 4 follow-up where typed edges + alias resolution mature. CONTEXT.md does not commit to rename emission in Phase 1 — verify with maintainer if planner wants tighter scope |
| A4 | `doc_uri` stores un-encoded paths (Pitfall 5); `formatDisplayUrl` percent-encodes at presentation time | §Pitfall 5 | If a later adapter / Phase 3 work expects encoded `doc_uri`, the two diverge. Planner should explicitly document this in the ADP-07 plan |
| A5 | The codemod `zod-v3-to-v4` covers ≥80% of the migration mechanically | §Zod 4 Migration | If codemod coverage is lower (e.g. only error-map renames), the manual sweep grows; effort estimate +1 day |
| A6 | `@modelcontextprotocol/inspector --cli` exits non-zero on protocol failure, suitable for `set -e` CI use | §Non-Claude Smoketest | If Inspector swallows errors and exits 0, the CI gate is a false-positive. Test in a draft PR before relying on it |
| A7 | `client_info` from MCP `InitializeRequest` is reliably available on Claude Code, Claude Desktop, MCP Inspector, and any modern MCP client | §D-02 | If a popular client doesn't send `clientInfo`, audit logs default to `"unknown"` for that client — acceptable per D-02 |
| A8 | The single transactional migration runner in `src/db/database.ts:99` reliably rolls back a failed migration 008 (backfill) | §doc_uri Dual-Column Migration | If a corner-case partial commit could occur (e.g., FK violation late in the backfill), pre-migration backup becomes a hard requirement. SQLite transaction guarantees rollback for ordinary SQL failures; CONCERNS.md §"No Pre-Migration DB Backup" already notes this and defers to Phase 8 |

**Verification recommended (before plan finalization):**
- A1: write a 10-line throwaway script that registers one tool with both Zod 4 and raw JSON Schema and inspects `tools/list` output
- A2: run `npm run eval:snapshot` on a feature branch after bump and inspect the diff
- A6: run Inspector CLI against the current `dist/cli.js` with a known-bad arg and verify exit code

## Open Questions / Risks

1. **`registerTool()` vs `setRequestHandler` final choice (Claude's Discretion)** — researcher recommends `registerTool`. Open: does the planner want to migrate **all 23 tools** in Phase 1, or keep `setRequestHandler` for now and migrate later? The latter saves time but carries forward technical debt. Recommendation: migrate all 23 in Phase 1.

2. **doc_uri staging — single migration 007 or split v7+v8?** — Claude's Discretion. Researcher recommendation: split. v7 adds nullable columns + writes both (`path` + `doc_uri`) on new writes. v8 backfills + flips read preference + makes `doc_uri NOT NULL`. v9 (Phase 3 or later) drops `path`. The split keeps each migration <100 ms on the Atlas fixture and gives a natural rollback point if v8's backfill misbehaves.

3. **Rename event emission (assumption A3)** — Phase 1 may NOT need to emit `rename` events at all. The current chokidar config emits `add` + `unlink` for renames; the existing indexer treats these as delete+create (the v1 behavior). ADR-001 I-4 says treating rename as delete+create is FORBIDDEN, but Phase 4 (GRA) is where typed edges + alias resolution mature enough to make rename handling meaningful. Researcher recommendation: Phase 1 documents the gap as a Phase 4 carry-forward; the `ChangeFeed.subscribe` emits `update` + `delete` events; `rename` is deferred. The conformance suite does NOT assert rename emission for obsidian-fs in Phase 1.

4. **`scripts/lint-adapters.sh` POSIX portability** — same Alpine docker bake-test concern from STATE.md "Phase 0 follow-up". The script in Example 5 uses `grep -rEn` and `sed`; researcher believes this is portable but recommends the same Alpine smoke-test as Phase 0 plan 00-12.

5. **`src/rerank/onnx-reranker.ts` fs path-operations carve-out (Claude's Discretion)** — model files live at `~/.vault-memory/models/`, not in the vault. The cleanest option is to add a `ModelLoader` interface inside `src/rerank/` and pass the `existsSync` / path join behind it (mirrors the adapter pattern). The alternative is to treat `src/rerank/` as a third "infrastructure" carve-out (like `src/config/`). Researcher recommends the `ModelLoader` interface — minimal scope, no special-casing of the lint script.

6. **`add-vault.ts` path-safety hardening (Deferred, but planner can pick up opportunistically)** — `src/config/add-vault.ts` is touched by Phase 1 anyway (D-02 client_id changes; "Claude Code" message rewrites). If the planner is already in the file, adding a `safeJoinInsideVault`-equivalent guard is cheap.

7. **The `WikilinkResolver` reading `Document.properties.wikilinks` instead of `ParsedNote.wikilinks`** — D-05 says the wikilinks live on the Document as a property; the resolver currently consumes `ParsedNote.wikilinks` directly. Phase 1 must add a thin shim: indexer extracts `Document.properties.wikilinks` and hands it to `WikilinkResolver`. Researcher recommends keeping `WikilinkResolver`'s input shape unchanged (it's a `Phase 4` boundary anyway) — the shim does the lookup.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22 | Runtime | ✓ | v22+ assumed on dev/CI | — |
| npm | Build | ✓ | bundled with Node | — |
| `@modelcontextprotocol/sdk@1.29.0` | ADP-08 | ✓ on registry | 1.29.0 (verified `npm view`, 2026-05-14) | — |
| `zod@4.4.3` | ADP-09 | ✓ on registry | 4.4.3 (verified `npm view`, 2026-05-14) | — |
| `@modelcontextprotocol/inspector@0.21.2` | ADP-10 | ✓ on registry | 0.21.2 (verified `npm view`, 2026-05-14) | — |
| `zod-v3-to-v4` codemod | ADP-09 (optional) | ✓ on registry (unofficial) | — | Hand-edit |
| sqlite-vec platform binary | Unchanged | ✓ on registry | `sqlite-vec-darwin-arm64` etc. | — |
| ONNX reranker model | Unchanged | Conditional — `~/.vault-memory/models/bge-reranker-v2-m3/` | — | Reranker is opt-in; tests use `OllamaReranker` mock |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest ^2.1.8` (existing) |
| Config file | None (uses defaults; co-located `*.test.ts`) |
| Quick run command | `npm run lint:check && npm test -- --run` |
| Full suite command | `npm run lint:check && npm test && npm run eval:baseline && sh scripts/lint-adapters.sh && node scripts/smoketest-non-claude.mjs` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADP-01 | `SourceConnector` interface implemented by obsidian-fs; all read paths route through it | unit + integration | `npm test -- src/adapters/source` | ❌ Wave 0 |
| ADP-02 | `DeliveryAdapter` interface implemented by obsidian-fs; write paths route through | unit + integration | `npm test -- src/adapters/delivery` | ❌ Wave 0 |
| ADP-03 | `ChangeFeed` interface implemented; chokidar confined; subscribe/close lifecycle | unit | `npm test -- src/adapters/change-feed` | ❌ Wave 0 |
| ADP-04 | Canonical types (`Document`, `BlockNode`, `Edge`, ...) compile and have non-zero usage in src/ | typecheck | `npm run lint` (`tsc --noEmit`) | ✓ partial (`src/types.ts` exists; extends here) |
| ADP-05 | Branded `DocId` rejects raw `string` at compile time | typecheck negative test | `npm run lint`; `tests/types/docid-brand.test-d.ts` (compile-time assertion) | ❌ Wave 0 |
| ADP-06 | Capability descriptors are present on both source and delivery adapters; conformance suite asserts honesty | conformance | `npm test -- src/adapters/**/conformance.test.ts` | ❌ Wave 0 |
| ADP-07 | Migration 007 + 008 apply cleanly; backfill produces non-null `doc_uri` for every row; idempotent | unit (DB-level) | `npm test -- src/db` | ✓ partial (`src/db/database.test.ts` exists) |
| ADP-08 | SDK 1.29 installed; `tools/list` snapshot still matches; registerTool migration green | snapshot + unit | `npm run eval:snapshot && npm test -- src/server.test.ts` | ✓ partial (snapshot exists, will regenerate) |
| ADP-09 | Zod 4 installed; all schemas parse without runtime error; behavior parity for the v1-baseline eval set | unit + eval | `npm test && npm run eval:baseline` | ✓ |
| ADP-10 | Non-Claude smoketest passes end-to-end against MCP Inspector | smoketest (e2e) | `node scripts/smoketest-non-claude.mjs` | ❌ Wave 0 |
| ADP-11 | Audit doc enumerates Claude/Obsidian assumptions; each either fixed or labeled v3 | manual review | `cat docs/v2/AGENT_AGNOSTIC_AUDIT.md` (doc-only deliverable) | ❌ Wave 0 |
| ADP-12 | CI greps return zero hits outside adapters | shell lint | `sh scripts/lint-adapters.sh` | ❌ Wave 0 |
| ADP-13 | Stub-adapter conformance suite passes for both obsidian-fs and stub | parameterized test | `npm test -- src/adapters/**/conformance.test.ts` | ❌ Wave 0 |
| ADP-14 | README lead paragraph starts with "any MCP-aware agent" framing | manual review | `head -20 README.md` | ✓ (README exists, will rewrite) |
| ADP-15 | All 324 v1 tests + v1-baseline eval still green | full suite | `npm test && npm run eval:baseline` | ✓ |

### Sampling Rate

- **Per task commit:** `npm test -- --run <changed file globs>` (vitest auto-routes); `sh scripts/lint-adapters.sh`
- **Per wave merge:** `npm run lint:check && npm test && npm run eval:baseline && sh scripts/lint-adapters.sh`
- **Phase gate (before `/gsd-verify-work`):** add `node scripts/smoketest-non-claude.mjs` + Inspector CLI smoketest + `npm run build` (verifies dist/cli.js still bundles under SDK 1.29 / Zod 4)

### Wave 0 Gaps

- [ ] `scripts/lint-adapters.sh` — POSIX lint enforcing I-1..I-6 + Claude-leak greps (ADP-12)
- [ ] `scripts/smoketest-non-claude.mjs` — non-interactive Inspector CLI smoketest (ADP-10)
- [ ] `src/adapters/source/types.ts` — `SourceConnector`, `SourceCapabilities`, `ListOptions`, `DocumentRef` (ADP-01)
- [ ] `src/adapters/delivery/types.ts` — `DeliveryAdapter`, `DeliveryCapabilities`, `WriteOptions`, `WriteResult` (ADP-02)
- [ ] `src/adapters/change-feed/types.ts` — `ChangeFeed`, `ChangeEvent` (ADP-03)
- [ ] `src/adapters/registry.ts` — handle parser + `parseDocId`/`mintDocId` (ADP-05)
- [ ] `src/adapters/capabilities.ts` — shared types (ADP-06)
- [ ] `src/adapters/source/conformance.test.ts` (or `tests/conformance/source.test.ts`) — parameterized over obsidian-fs + stub (ADP-13)
- [ ] `src/adapters/delivery/conformance.test.ts` — same shape for delivery (ADP-13)
- [ ] `src/adapters/change-feed/conformance.test.ts` — same shape for change-feed (ADP-13)
- [ ] `src/adapters/stub/{source,delivery,change-feed}.ts` — in-memory stub adapters (ADP-13)
- [ ] `tests/types/docid-brand.test-d.ts` — compile-time `expectError<DocId, string>` (ADP-05)
- [ ] `docs/v2/AGENT_AGNOSTIC_AUDIT.md` — leak inventory + label per leak (ADP-11)
- [ ] CI step in `.github/workflows/ci.yml` invoking `scripts/lint-adapters.sh` and the smoketest (ADP-12, ADP-10)
- [ ] Migration 007 + 008 in `src/db/schema.ts` (ADP-07)
- [ ] Updated `evals/v1-baseline/tools-list.snapshot.json` (regenerated under SDK 1.29 + Zod 4) (ADP-08, ADP-09)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | MCP transport is stdio; no auth surface |
| V3 Session Management | no | Per-stdio-session; no shared sessions |
| V4 Access Control | yes — vault `write_enabled` flag + memory-sink sentinel (Phase 2) | Existing `permission_denied` reason on writes; sentinel-file pattern in ADR-004 |
| V5 Input Validation | yes | Zod 4 schemas at every tool boundary (`src/server.ts:49–158`); FTS5 query sanitizer (`src/db/queries/fts.ts:99`) |
| V6 Cryptography | yes — SHA-256 for `Document.hash` | `node:crypto` `createHash('sha256')` (existing) — Phase 1 keeps v1 hash; Phase 3 introduces ADR-003 algorithm |

### Known Threat Patterns for vault-memory

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal on writes | Tampering | `safeJoinInsideVault` (existing); relocates to `src/adapters/delivery/obsidian-fs/fs.ts` |
| Path traversal on `add-vault` config writes | Tampering | Low severity (local CLI); deferred per CONTEXT.md |
| FTS5 injection | Tampering | `FtsQueries.sanitize()` (existing); unchanged in Phase 1 |
| SQL injection via dynamic table names | Tampering | Integer-validated table-name interpolation only (existing — `embeddings_m<id>_d<dim>`); unchanged |
| Symlink escape on read | Information disclosure | `followSymlinks: false` on chokidar; `fs.realpath` check on writes |
| Memory-sink guard bypass | Tampering / Repudiation | Phase 2 territory; Phase 1 must not block its later addition |
| Telemetry / data exfil via dependency bump | Information disclosure | `scripts/lint-no-telemetry.sh` (existing, Phase 0) blocks telemetry imports; runs in CI |

**Phase 1 net security delta:** Neutral — the refactor moves files but does not change validators, sanitizers, or auth surfaces. The only meaningful new surface is the lint-adapters.sh script, which is a defense-in-depth gate (not a new attack surface).

## Backwards-Compat & Tool-Snapshot Tests

The v1.x MCP API surface is pinned by three artifacts from Phase 0:

1. **`evals/v1-baseline/tools-list.snapshot.json`** — JSON snapshot of `tools/list` for all 23 v1 tools. Any drift in tool name / inputSchema / description fails CI via `evals/v1-baseline/baseline.test.ts`.
2. **Per-tool YAML floors** (`evals/v1-baseline/{search,search_hybrid,...}.yaml`) — semantic floors per tool (the hand-labeled queries).
3. **`src/server.test.ts`** — unit-level tool-handler tests covering the 23 tool surface.

**Phase 1 backwards-compat strategy:**

- Tool **names** unchanged (all 23 stay).
- Tool **inputSchemas** unchanged (the snapshot is the contract; the migration to `registerTool({ inputSchema: <raw JSON Schema from tool-registry.ts> })` preserves the published schema byte-for-byte).
- Tool **handlers** internally route through adapters but accept identical inputs. The `read_note({vault, path})` shape stays: the handler resolves `path` → `DocId` internally via the obsidian-fs adapter's `parseObsidianFsPath()` helper.
- The deprecation note for `path`-based tools (ADR-001 §"Backwards compatibility") is documented in CHANGELOG but NOT enforced. Removal is a v3.0.0 breaking change.

**Verification:**
- After every PR: `npm run eval:baseline` (the baseline test re-asserts the snapshot)
- At phase end: re-generate snapshot under final SDK 1.29 + Zod 4, manually review the diff for `description` regressions (Pitfall 2), commit the regenerated snapshot as part of the bump PR.

## Recommended Plan Decomposition

The planner should sequence Phase 1 as **6 plans**, each landing green and unlocking the next. Each plan's "tasks" (the per-file sub-units) are left to the planner; the goals below are the unit of decomposition.

| # | Plan goal | Requirements | Roughly touches | Unlocks |
|---|-----------|--------------|-----------------|---------|
| 01-01 | **Type surface + branded DocId + adapter directory bootstrap** | ADP-04, ADP-05, partial ADP-06 | `src/types.ts` (add Document, BlockNode, Edge, ChangeEvent, branded DocId, SourceHandle, MemorySink), new `src/adapters/{source,delivery,change-feed}/types.ts`, new `src/adapters/registry.ts` with handle parser + `parseDocId`, new `src/adapters/capabilities.ts`, new `tests/types/docid-brand.test-d.ts` | Everything else (types are imported by all subsequent work) |
| 01-02 | **doc_uri dual-column migration (Strategy A — v7 + v8)** | ADP-07 | `src/db/schema.ts` (append MIGRATION_007 + MIGRATION_008), `src/db/database.ts` (vault-name hook for backfill), `src/db/queries/notes.ts` (write `doc_uri` on upsert), tests in `src/db/database.test.ts` | doc_uri queryable for subsequent adapter work; future `read_by_doc_uri` tooling |
| 01-03 | **Source adapter extraction + obsidian-fs source impl** | ADP-01, partial ADP-06, partial ADP-13 | `git mv src/reader/* src/adapters/source/obsidian-fs/`, new `src/adapters/source/obsidian-fs/index.ts` (facade with `ObsidianFsSource`), update import paths in `src/indexer/`, `src/server.ts:read_note` routes through adapter, new `src/adapters/source/conformance.test.ts` (stub + obsidian-fs), stub source impl in `src/adapters/stub/source.ts`. **CI grep for chokidar/gray-matter (I-1, I-4) flipped on for `src/reader/` ← now empty.** | Delivery adapter (which depends on source for reads-before-write) |
| 01-04 | **Delivery adapter extraction + obsidian-fs delivery impl** | ADP-02, partial ADP-06, partial ADP-13 | `git mv src/write/* src/adapters/delivery/obsidian-fs/`, new `src/adapters/delivery/obsidian-fs/index.ts` (`ObsidianFsDelivery`), update `src/frontmatter/update.ts` to remove `fs.readFile` + `gray-matter` (routes through adapter), D-02 client_info handshake captured in `src/server.ts` and threaded into delivery, D-01 `formatDisplayUrl` integrated, `src/adapters/delivery/conformance.test.ts`, stub delivery impl. **CI grep for `fs.writeFile|unlink|rename` (I-6) flipped on for src/ outside delivery adapter.** | Change-feed (needs delivery for the suppression-set contract) |
| 01-05 | **Change-feed adapter extraction + obsidian-fs change-feed impl + SDK 1.29 + Zod 4 bump** | ADP-03, ADP-08, ADP-09, partial ADP-06, partial ADP-13 | `git mv src/watcher/* src/adapters/change-feed/obsidian-fs/`, new `ObsidianFsChangeFeed`, `src/adapters/change-feed/conformance.test.ts`, stub change-feed. Then `npm install @modelcontextprotocol/sdk@^1.29.0 zod@^4.4.3`, run codemod, migrate `src/server.ts` to `registerTool()` × 23 (using JSON Schema from tool-registry.ts per Pitfall 2 workaround), regenerate `tools-list.snapshot.json`, fix any Zod 4 errors in `src/config/loader.ts`. **All CI greps I-1..I-6 + Claude-leak grep green.** D-03 excludes confined to adapter. | Final polish + audit |
| 01-06 | **CI lint-adapters.sh + smoketest + audit + README + final polish** | ADP-10, ADP-11, ADP-12, ADP-14, ADP-15 | New `scripts/lint-adapters.sh` (POSIX), new `scripts/smoketest-non-claude.mjs` (Inspector CLI), wire both into `.github/workflows/ci.yml`, new `docs/v2/AGENT_AGNOSTIC_AUDIT.md`, README rewrite (lead with "any MCP-aware agent"), CHANGELOG entry, `src/cli.ts` message rewrites, optional `src/rerank/onnx-reranker.ts` ModelLoader carve-out, optional `src/config/add-vault.ts` path-safety hardening. **Final phase-gate check: 324 tests green, v1-baseline green, all greps green, smoketest green.** | Phase 2 (memory namespace) |

**Notes for the planner:**
- Plans 01-03, 01-04, 01-05 are the three vertical seam slices, each independently lands green.
- Plans 01-01 and 01-02 are foundational (types + DB); they're prerequisites for 01-03..05 but small in surface area.
- Plan 01-05 deliberately bundles the SDK/Zod bump with the change-feed extraction because both touch `src/server.ts`; doing them together minimizes the snapshot-regeneration churn.
- Plan 01-06 ships the CI gates LAST, after the seam moves are complete, because flipping `lint-adapters.sh` to required earlier would block intermediate PRs.
- Researcher recommends each plan land as a single PR onto a `gsd/phase-1-adapter-extraction-tech-debt-up` branch (matching `phase_branch_template` in `.planning/config.json`), with merge to `main` only at phase sign-off.

## Sources

### Primary (HIGH confidence)
- `docs/v2/adr/002-adapter-seams.md` (ADR-002) — full interface specs, Invariants I-1..I-7, capability descriptors, Examples A/B/C
- `docs/v2/adr/001-document-identity.md` (ADR-001) — URI grammar, Invariants I-1..I-6, migration plan, identityStable semantics
- `docs/v2/adr/003-document-shape.md` (ADR-003) — `Document`, `BlockNode`, `Edge`, `PropertyBag`, hash algorithm H-1..H-6
- `docs/v2/adr/004-memory-sink-handles.md` (ADR-004) — MemorySink handle parser + sentinel (Phase 2 dependency)
- `docs/v2/adr/README.md` (ADR index) — confirms ADRs 001–004 Accepted, 14 Open Deferred-v3
- `.planning/REQUIREMENTS.md` (ADP-01..15 + Out-of-Scope rows)
- `.planning/ROADMAP.md` (Phase 1 entry, 5 success criteria)
- `.planning/codebase/CONCERNS.md` (seam-leak hotspot inventory)
- `.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md` (user decisions D-01..D-05)
- `src/server.ts`, `src/tool-registry.ts`, `src/db/schema.ts`, `src/write/write.ts`, `src/reader/parser.ts`, `src/watcher/watcher.ts`, `src/types.ts`, `package.json` (live code)
- `npm view @modelcontextprotocol/sdk version` → `1.29.0` (verified 2026-05-14)
- `npm view zod version` → `4.4.3` (verified 2026-05-14)
- `npm view @modelcontextprotocol/inspector version` → `0.21.2` (verified 2026-05-14)

### Secondary (MEDIUM confidence — WebSearch verified against official sources)
- [Zod v4 changelog / migration guide](https://zod.dev/v4/changelog) — error-customization unification, `.strict()` → `z.strictObject()`, `errorMap` deprecation
- [Zod v4 release notes](https://zod.dev/v4) — 14× string-parsing speedup, 7× array speedup, 10× TS compile speedup, `zod/v4` subpath
- [MCP SDK TypeScript repo (main)](https://github.com/modelcontextprotocol/typescript-sdk) — `registerTool` API surface, Standard Schema integration
- [MCP SDK server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `registerTool` usage pattern with Zod inputSchema
- [MCP Inspector docs](https://modelcontextprotocol.io/docs/tools/inspector) — `--cli` non-interactive mode, JSON output, exit codes
- [Inspector CLI guide (MCPcat)](https://mcpcat.io/guides/setting-up-mcp-inspector-server-testing/) — `npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list`

### Tertiary (KNOWN ISSUES to track)
- [typescript-sdk#1143 — Zod 4 description not propagating](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143) — Pitfall 2 source; workaround documented above
- [typescript-sdk#1643 — registerTool silently drops z.discriminatedUnion()](https://github.com/modelcontextprotocol/typescript-sdk/issues/1643) — Pitfall 3 source
- [typescript-sdk PR #816 — accept ZodType<object> for input/output](https://github.com/modelcontextprotocol/typescript-sdk/pull/816) — confirms direction of Standard Schema integration

## Metadata

**Confidence breakdown:**
- Standard stack (versions, packages): **HIGH** — verified live via `npm view`
- Adapter seam contracts (interface shapes): **HIGH** — locked by ADR-002 (Accepted)
- doc_uri migration (Strategy A): **HIGH** — pattern matches existing migration 006; CONCERNS.md sketch confirmed
- Branded DocId pattern: **HIGH** — standard TypeScript nominal-type idiom; zero runtime cost
- MCP SDK 1.29 migration (registerTool, Standard Schema): **MEDIUM-HIGH** — official docs confirm the API; two known SDK bugs (#1143, #1643) documented with workarounds
- Zod 4 migration: **MEDIUM-HIGH** — migration guide is authoritative; codemod coverage assumption (A5) is the soft spot
- CI grep enforcement: **HIGH** — pattern matches existing Phase 0 lint scripts; POSIX portability concern (Open Q4) is the one risk
- Conformance suite scope: **MEDIUM** — Claude's Discretion; researcher recommendation is a floor (interface + capability + invariant assertions), not a maximum
- Smoketest target: **MEDIUM-HIGH** — Inspector CLI is the obvious choice but assumption A6 (exit-code reliability) needs verification

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (30 days — MCP SDK is moving fast at 1.29; re-verify versions if planning starts after this)

---

## RESEARCH COMPLETE

**Phase:** 1 — Adapter extraction & tech-debt-up
**Confidence:** HIGH

### Key Findings

- MCP SDK 1.29.0 and Zod 4.4.3 are both current and compatible; SDK 1.29 ships Standard Schema integration with a known Zod 4 description-propagation bug ([#1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143)) — workaround: pass raw JSON Schema literals from `tool-registry.ts` to `registerTool({inputSchema})` instead of Zod schemas, then validate at handler time.
- The seam extraction is **structurally a `git mv` exercise**: chokidar is already isolated to one file (clean per CONCERNS.md), gray-matter has 3 leaks to consolidate (`src/reader/parser.ts`, `src/write/write.ts`, `src/frontmatter/update.ts`), and fs.* has 4 leaks (one in `src/frontmatter/update.ts`, three carve-outs in `src/config/`, `src/rerank/`). All five locked decisions D-01..D-05 fall out naturally from this layout.
- doc_uri Strategy A is best implemented as **two migrations** (v7 additive + v8 backfill); planner has discretion. Path encoding (Pitfall 5) is the one non-trivial design call — researcher recommends storing un-encoded paths and percent-encoding only at `formatDisplayUrl()` time.
- Conformance suite floor (per CONTEXT Claude's Discretion #4): interface-shape + capability-descriptor + I-1..I-7 invariant assertions, parameterized over both `obsidian-fs` and `StubSource`/`StubDelivery`/`StubChangeFeed`. Living at `src/adapters/{role}/conformance.test.ts` (vitest's auto-discovery handles parameterization).
- Smoketest target (per CONTEXT Claude's Discretion #5): `npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list && --method tools/call --tool-name list_vaults`. CI-gated via `.github/workflows/ci.yml`. Inspector's CLI mode is purpose-built for this; the SDK Client harness is the fallback if Inspector's exit-code semantics turn out flaky (assumption A6).

### File Created

`.planning/phases/01-adapter-extraction-tech-debt-up/01-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Versions verified live via `npm view`; ADRs lock interface shapes |
| Architecture | HIGH | ADR-002 §"Decision" specifies the directory layout verbatim; CONCERNS.md confirms existing module boundaries are already adapter-shaped |
| Pitfalls | MEDIUM-HIGH | Two SDK 1.29 bugs (#1143, #1643) documented with workarounds; Zod 4 codemod coverage (A5) is the soft assumption |
| Migration (doc_uri) | HIGH | Follows established pattern (migration 006); CONCERNS.md sketch confirmed; SQLite transaction rollback safety net |
| CI grep enforcement | MEDIUM-HIGH | Pattern matches existing Phase 0 scripts; Alpine docker portability is the same open follow-up STATE.md already tracks |
| Recommended decomposition (6 plans) | MEDIUM-HIGH | Vertical-slice cut per seam is the recommended pattern from ADR-002 ("Phase 1 is a substantial refactor PR"); planner has full discretion to re-cut |

### Open Questions (forwarded to planner)

1. registerTool migration in Phase 1 vs deferred (Claude's Discretion #3) — recommend in-phase
2. doc_uri migration single vs split (Claude's Discretion #2) — recommend split (v7+v8)
3. Rename event emission in Phase 1 — recommend defer to Phase 4 follow-up (Open Q3)
4. `src/rerank/` path-ops carve-out — recommend `ModelLoader` interface inside the module (Open Q5)
5. `add-vault.ts` path-safety opportunistic hardening — leave to planner judgment (Open Q6)

### Ready for Planning

Research complete. The planner can now create 6 PLAN.md files following the §Recommended Plan Decomposition table, with the §Phase Requirements → Test Map driving the per-plan acceptance criteria and the §Wave 0 Gaps list seeding the test-and-tooling additions.
