# ADR-002: Source & Delivery Seams

**Status:** Proposed — Phase 0 foundation
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
