---
title: Source & Delivery Seams
status: Accepted
phase: 0
tags: adapters, seams, source-connector, delivery-adapter, change-feed, capability-descriptors
---

# ADR-002: Source & Delivery Seams

**Status:** Accepted — Phase 0 foundation
**Date:** 2026-05-14
**Scope:** Phase 1 refactor; all read/write/watch paths from Phase 1 onward
**Depends on:** ADR-001 (Document Identity), ADR-003 (Document Shape)
**Supersedes:** —
**Superseded by:** —

## Context

v2 is Obsidian-only by ship scope. v3 (Phase 10) opens the system to Notion
and beyond. Today, vault-memory reads markdown directly from disk
(`src/reader/`), writes via filesystem operations (`src/server.ts` write
tools), and watches via chokidar (`src/indexer/`). If we add a new source
type without abstraction, every assembly tool will accumulate source-specific
branches.

The goal of this ADR is to **lock in interface seams in Phase 1** with one
implementation per interface, so v3 adds *new implementations* rather than
modifying existing core code. The interfaces are real code, not aspirational
documentation, from Phase 1 onward.

## Decision

Three interfaces are introduced in Phase 1, with one implementation each
(`obsidian-fs`) extracted from existing code:

```
src/adapters/
  source/
    obsidian-fs.ts
    types.ts             # SourceConnector, SourceCapabilities, ListOptions, DocumentRef
  delivery/
    obsidian-fs.ts
    types.ts             # DeliveryAdapter, DeliveryCapabilities, WriteOptions, …
  change-feed/
    obsidian-fs.ts
    types.ts             # ChangeFeed, ChangeEvent
  registry.ts            # handle parser; instantiates adapters from config
  capabilities.ts        # shared capability descriptor types
```

### `SourceConnector`

Read-side. Knows how to enumerate, fetch, and hash documents from a source.

```typescript
interface SourceConnector {
  readonly handle: SourceHandle;            // e.g. "obsidian-fs://my-vault"
  readonly capabilities: SourceCapabilities;

  listDocuments(opts?: ListOptions): AsyncIterable<DocumentRef>;
  readDocument(id: DocId): Promise<Document>;
  hash(id: DocId): Promise<string>;          // content hash; cheap relative to read
  exists(id: DocId): Promise<boolean>;
}

interface DocumentRef {
  id: DocId;
  mtime: number;
  hash: string;                              // cheap pre-flight hash; may be coarse
}

interface ListOptions {
  excludeGlobs?: string[];                   // semantically interpreted by adapter
  modifiedSince?: number;                    // unix ms
}
```

The connector returns normalized `Document` objects per ADR-003. The connector
is responsible for translating its native representation (markdown text + YAML
frontmatter for `obsidian-fs`; block API responses for `notion-api`) into the
canonical shape. Core code never sees the native format.

### `DeliveryAdapter`

Write-side. Knows how to persist a `Document` (or a patch) to a sink.

```typescript
interface DeliveryAdapter {
  readonly handle: SinkHandle;               // e.g. "obsidian-fs://my-vault/_memory"
  readonly capabilities: DeliveryCapabilities;

  write(doc: Document, opts: WriteOptions): Promise<WriteResult>;
  update(id: DocId, patch: DocumentPatch, opts: UpdateOptions): Promise<WriteResult>;
  delete(id: DocId, opts: DeleteOptions): Promise<DeleteResult>;
}

interface WriteOptions {
  expectedHash?: string;                     // optimistic concurrency
  ifNotExists?: boolean;
}

interface DocumentPatch {
  properties?: Partial<PropertyBag>;
  blocks?: BlockNode[];                      // full replacement; granular block edits deferred
  title?: string;
}

interface WriteResult {
  id: DocId;                                  // may differ from input id for create-with-naming
  hash: string;
  mtime: number;
}
```

The delivery adapter is the **only** place that performs writes. Phase 2's
write-guard logic — "refuse to write to a memory sink without provenance
properties" — sits inside the adapter for that sink, not scattered across
tools.

### `ChangeFeed`

Watch-side. Streams change events for an index to consume.

```typescript
interface ChangeFeed {
  readonly handle: SourceHandle;
  subscribe(handler: (e: ChangeEvent) => void): Disposable;
  close(): Promise<void>;
}

type ChangeEvent =
  | { kind: 'create';  id: DocId; at: number }
  | { kind: 'update';  id: DocId; at: number }
  | { kind: 'delete';  id: DocId; at: number }
  | { kind: 'rename';  old_id: DocId; new_id: DocId; at: number };
```

The `rename` event is critical for `identityStable: false` adapters
(obsidian-fs). Without it, the indexer would treat a rename as
delete-plus-create and lose history. Notion does not need `rename` events —
the page ID is stable and a title change is just an `update`.

chokidar imports live exclusively in `src/adapters/change-feed/obsidian-fs.ts`.
Phase 1's grep check enforces this.

### Capability descriptors

Capabilities are introspectable so the assembly layer can branch:

```typescript
interface SourceCapabilities {
  readonly bodyShape: 'blocks' | 'flat-text';     // does it support BlockNode body?
  readonly properties: 'typed' | 'untyped';       // notion: typed; obsidian: untyped
  readonly linkTypes: readonly EdgeType[];        // which Edge.types it emits
  readonly identityStable: boolean;
  readonly permissions: boolean;                  // does it enforce per-document permissions?
  readonly contentHashStable: boolean;            // is hash() cheap & deterministic?
  readonly watch: 'push' | 'poll' | 'none';       // change-feed model
}

interface DeliveryCapabilities {
  readonly atomic: boolean;                       // write is atomic
  readonly hashProtected: boolean;                // supports expectedHash for OCC
  readonly enforcedSchema: boolean;               // properties must match a registered schema (notion DBs)
  readonly naming: 'caller-provided' | 'adapter-assigned' | 'either';
}
```

When a contract (Phase 7) references a tool that depends on a capability the
configured adapter doesn't provide, `describe_contract` surfaces the
incompatibility. Example: a contract specifies `write_back: {atomic: true}`,
configured sink is a non-atomic adapter — `describe_contract` warns; the user
chooses to override or repoint the sink.

### Registry

`src/adapters/registry.ts` parses handles, instantiates adapters from config,
and resolves a handle to a `{source?, delivery?, changeFeed?}` triple.

```typescript
interface Registry {
  registerSource(scheme: string, factory: SourceFactory): void;
  registerDelivery(scheme: string, factory: DeliveryFactory): void;
  registerChangeFeed(scheme: string, factory: ChangeFeedFactory): void;

  resolveSource(handle: SourceHandle): SourceConnector;
  resolveDelivery(handle: SinkHandle): DeliveryAdapter;
  resolveChangeFeed(handle: SourceHandle): ChangeFeed;

  listSources(): SourceHandle[];
  listSinks(): SinkHandle[];
}
```

At server startup, `obsidian-fs` registers itself for all three roles. v3 adds
`notion-api` to the same registry. Built-in vs third-party is not a meaningful
distinction at the interface level (though we don't enable third-party
plugins in v2 — see "Alternatives" below).

### Co-location & enforcement

Phase 1 ends with grep checks enforced in CI:

- `chokidar` is imported **only** by files under `src/adapters/change-feed/`.
- `path.join` / `path.resolve` / `fs.*` are imported **only** by files under
  `src/adapters/{source,delivery,change-feed}/` and `src/config/`.
- `gray-matter` (YAML frontmatter parser) is imported **only** by
  `src/adapters/source/obsidian-fs.ts` and `src/adapters/delivery/obsidian-fs.ts`.
- The strings `obsidian://`, `wikilink` (in retrieval code outside the
  adapters), and other Obsidian vocabulary are flagged in PR review.

These checks live as a small custom lint rule or a script in `scripts/lint-adapters.sh`
run by CI and by the pre-commit hook.

## Invariants

Normative MUST/MUST-NOT statements. Phase 9's adversarial review (and any
future ADR-conformance audit) greps for these. Phase 1's CI lint script
(`scripts/lint-adapters.sh`) enforces I-1 through I-6 mechanically.

- **I-1**: `chokidar` MUST NOT be imported from any file outside
  `src/adapters/change-feed/`. The filesystem watcher is a `ChangeFeed`
  implementation detail and MUST stay confined to the adapter that emits
  `ChangeEvent`s.
- **I-2**: Raw `fs.*` calls (`fs.readFile`, `fs.writeFile`, `fs.stat`,
  `fs.readdir`, and their sync/promises variants) MUST NOT appear in any
  file outside `src/adapters/source/obsidian-fs/`,
  `src/adapters/delivery/obsidian-fs/`, and `src/config/`. Core code reads
  and writes through `SourceConnector` and `DeliveryAdapter` only.
- **I-3**: `path.join`, `path.resolve`, and related `node:path` calls MUST
  NOT appear outside adapter modules and `src/config/`. Core code accepts
  `DocId` (per ADR-001) and MUST delegate filesystem-path joining to the
  adapter behind the handle.
- **I-4**: `gray-matter` (and any other YAML-frontmatter parser) MUST NOT
  be imported outside `src/adapters/source/obsidian-fs/` and
  `src/adapters/delivery/obsidian-fs/`. Frontmatter is the Obsidian native
  representation; the canonical `Document.properties` shape (per ADR-003)
  is what core code consumes.
- **I-5**: Bare `.md` literals — `endsWith('.md')`, `.replace(/\.md$/, …)`,
  `*.md` glob strings — MUST NOT appear outside adapter modules. The
  canonical document type carries no file-extension assumption; file
  extensions are an `obsidian-fs` presentation concern.
- **I-6**: All writes MUST route through `DeliveryAdapter.write`,
  `DeliveryAdapter.update`, or `DeliveryAdapter.delete`. Direct filesystem
  write calls (`fs.writeFile`, `fs.writeFileSync`, `fs.promises.writeFile`,
  `fs.rename`, `fs.unlink`) outside the obsidian-fs delivery adapter are
  FORBIDDEN. The memory-namespace write-guard (per CLAUDE.md and Phase 2)
  lives inside the `DeliveryAdapter` for that sink — it is unreachable if
  this invariant is violated.
- **I-7**: Every registered adapter MUST publish honest capability
  descriptors (`SourceCapabilities` / `DeliveryCapabilities`). An adapter
  that advertises `atomic: true` but loses writes under concurrent access,
  or `identityStable: true` but emits `rename` events, is in violation.
  Phase 10's capability-contract test suite (per "Open follow-ups") is the
  enforcement mechanism.

## Consequences

### Positive

- Phase 10 (Notion connector) is **additive**: a new file under
  `src/adapters/source/notion-api.ts` and a few registry registrations. Zero
  changes to assembly tools, search, indexer core.
- Tests in Phase 3+ can substitute a stub adapter to prove source-neutrality
  of the assembly layer *before* a real second adapter exists.
- The MCP tool surface becomes uniform: tools take handles and document IDs;
  the adapter behind the handle is hidden.
- Capability descriptors give contracts (Phase 7) a way to fail fast when
  configured against an incompatible sink, rather than crashing mid-run.

### Negative / costs

- Phase 1 is a substantial refactor PR. ~Half the existing modules touch one
  of the three I/O paths. Tests must remain green throughout.
- Adapters introduce one extra layer between the SQL layer and the file
  system. For Obsidian the overhead is negligible; benchmarks confirm in
  Phase 1.
- Capability descriptors must stay honest. An adapter that lies about
  `atomic: true` and then loses writes will erode trust quickly. Phase 10
  defines a capability-contract test suite each adapter must pass.

### Open follow-ups

- **Third-party adapters.** v2 does not enable third-party connector plugins.
  Registry registrations happen in-process at startup from a hardcoded list.
  Revisit in Phase 10 — extending to a plugin-loader is a real ADR of its own,
  with sandboxing and trust considerations.
- **Adapter configuration secrets.** Notion needs an API token. Obsidian-fs
  needs none. Phase 10 defines how secrets are passed (env vars, OS keychain,
  …). v2 needs no secrets; `config.toml` is sufficient.
- **Performance characterization.** The Obsidian-fs adapter abstracts file
  reads behind an async interface. Phase 1 includes a micro-benchmark
  comparing v1.x indexer throughput to the post-refactor indexer; regression
  >5% is a blocker.

## Examples

Worked sketches for the two currently-anticipated adapters and one
cross-cutting `ChangeFeed` event. Both `obsidian-fs://` and `notion-api://`
appear here deliberately (D-04): source-neutrality must be greppable in the
ADR text from day 0. Phase 9's adversarial reviewer can confirm by grepping
`obsidian-fs://` AND `notion-api://` in this same file.

### Example A — `obsidian-fs://my-vault` (`SourceConnector` impl sketch)

A filesystem-backed Obsidian vault. Identity is NOT stable (the user is
allowed to rename files); watch is push-based (chokidar).

```typescript
// src/adapters/source/obsidian-fs/index.ts (sketch — Phase 1 owns the real impl)
export class ObsidianFsSource implements SourceConnector {
  readonly handle: SourceHandle = "obsidian-fs://my-vault";
  readonly capabilities: SourceCapabilities = {
    bodyShape: "flat-text",
    properties: "untyped",
    linkTypes: ["wikilink", "embed"] as const,
    identityStable: false,        // paths can change → rename events
    permissions: false,
    contentHashStable: true,      // sha256 of file body
    watch: "push",                // chokidar
  };

  async *listDocuments(opts?: ListOptions): AsyncIterable<DocumentRef> {
    // walks the vault root, applies opts.excludeGlobs, yields {id, mtime, hash}
  }

  async readDocument(id: DocId): Promise<Document> {
    // parses markdown + frontmatter via gray-matter (allowed: I-4 confines it here),
    // returns the canonical Document shape per ADR-003.
  }

  async hash(id: DocId): Promise<string> {
    // returns sha256(body) — cheap; matches the stored note hash.
  }

  async exists(id: DocId): Promise<boolean> {
    // fs.stat (allowed: I-2 confines fs.* here)
  }
}
```

### Example B — `notion-api://acme` (`SourceConnector` impl sketch)

A Notion workspace. Identity IS stable (the page ID survives rename);
watch is poll-based (Notion has no push API for arbitrary workspaces).

```typescript
// src/adapters/source/notion-api/index.ts (Phase 10 — sketch only here)
export class NotionApiSource implements SourceConnector {
  readonly handle: SourceHandle = "notion-api://acme";
  readonly capabilities: SourceCapabilities = {
    bodyShape: "blocks",
    properties: "typed",          // Notion DBs have schemas
    linkTypes: ["mention", "child-page", "relation"] as const,
    identityStable: true,         // page IDs survive rename → no rename events
    permissions: true,            // Notion enforces per-page ACLs
    contentHashStable: true,      // hash of normalized block tree
    watch: "poll",                // polling change feed; pollOnly: true
  };

  async *listDocuments(opts?: ListOptions): AsyncIterable<DocumentRef> {
    // pages through the workspace via the Notion search API
  }

  async readDocument(id: DocId): Promise<Document> {
    // fetches blocks, normalizes to the canonical Document shape per ADR-003
  }

  async hash(id: DocId): Promise<string> {
    // canonical hash over normalized block tree + typed properties
  }

  async exists(id: DocId): Promise<boolean> {
    // GET page; 404 → false
  }
}
```

**Capability deltas worth noting:**

| Capability | `obsidian-fs` | `notion-api` |
|---|---|---|
| `identityStable` | `false` | `true` |
| `properties` | `untyped` | `typed` |
| `bodyShape` | `flat-text` | `blocks` |
| `watch` | `push` (chokidar) | `poll` |
| `permissions` | `false` | `true` |

The assembly layer (search, brief compiler, contracts) never branches on
the source scheme. It branches on capabilities when behavior must differ
(e.g., a contract that requires `permissions: true` rejects the obsidian-fs
sink at `describe_contract` time).

### Example C — `ChangeFeed` rename event from `obsidian-fs`

The user moves `projects/Atlas.md` → `archive/2026/Atlas.md` in the `my-vault`
vault. chokidar (confined to `src/adapters/change-feed/obsidian-fs/` per I-1)
detects the move and the adapter emits a single `rename` event per ADR-001
Invariant I-4:

```json
{
  "kind": "rename",
  "old_id": "obsidian-fs://my-vault/projects/Atlas.md",
  "new_id": "obsidian-fs://my-vault/archive/2026/Atlas.md",
  "at": 1747224180000
}
```

The indexer translates this to `UPDATE notes SET doc_uri = new_id WHERE
doc_uri = old_id`. Wikilinks, backlinks, citations, and audit-log entries
continue to resolve. Treating this as `delete` + `create` is FORBIDDEN by
ADR-001 I-4 — and `notion-api` will never emit a `rename` event at all,
because its `identityStable: true` capability means a title change is just
an `update`.

## Alternatives considered

### (a) Subprocess-based connectors

Connectors run as separate processes, communicate via a JSON-RPC or
MCP-over-pipes protocol. Rejected for v2: complexity, latency, debugging
overhead, no clear benefit while everything is local.

Reconsider in v3 if there's pressure for third-party (npm-installable)
connectors — the trust boundary then becomes meaningful.

### (b) MCP-as-the-connector-boundary

A Notion connector is itself an MCP server (Notion already publishes one).
vault-memory becomes an MCP client of that MCP server. Considered seriously.

Rejected as the v2 default boundary, but adopted **inside the Notion connector
implementation in Phase 10**: the `notion-api` source connector adapter
will likely be a thin shim wrapping calls to Notion's existing MCP server,
translating responses into `Document` objects. So we get both — the in-process
adapter interface for clean integration with the rest of vault-memory, and
MCP-chained access to Notion to avoid reimplementing their API client.

### (c) Skip the abstraction, write the second adapter "when we get there"

Rejected. This is the path that produces v3 = rewrite. The seams cost ~one
phase of refactor work now and save 3+ phases of unwinding later. The Phase 0
foresight is the cheap insurance premium.

### (d) Use an existing data-mesh / connector framework (Airbyte, Singer, …)

Considered. Those frameworks aim at ETL (batch sync, schema mapping) and bring
heavy infrastructure. vault-memory needs live, lightweight, embedded
connectors. Adopting a framework would dwarf the v3 connector surface itself.
Rejected for v2 and v3. Revisit if the user demand turns into "I want to sync
20 sources into one searchable corpus" — that's a different product.
