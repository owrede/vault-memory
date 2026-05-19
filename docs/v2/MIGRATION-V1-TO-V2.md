# Migrating from vault-memory v1.x to v2.0.0

**Audience:** primary — downstream TypeScript library consumers (anyone
`import`-ing from `@owrede/vault-memory` or programmatically driving the
MCP server). Secondary — end users running vault-memory via Claude
Desktop / Claude Code / ChatGPT Custom Connectors / generic MCP clients
who want to know what is new at runtime.

This document covers the v1.0.0 → v2.0.0 jump. The runtime surface is
backwards-compatible: every v1 MCP tool name and input schema is
preserved byte-identical. The disruptive changes are at the
**dependency** and **TypeScript type-system** layers, both of which
affect library consumers but not end users.

---

## TL;DR

- **All 23 v1 MCP tool names and input schemas are preserved byte-identical** —
  existing agents and connectors continue to work without changes.
- **14 net-new MCP tools are added** across Phases 2–6 (memory namespace,
  document-tree retrieval, graph navigation, compiled briefs, task
  contracts) plus 6 plugin tools shipped default-OFF behind a Settings
  gate in Phase 7.
- **5 list-style tools are marked DEPRECATED in v2.0.0** and promoted to
  MCP Resources for agent discovery (REL-08). The deprecated tools
  remain fully callable in v2.x and will be removed in v3.0.
- **`tools/list` returns 37 entries in v2.0.0** (5 carry a DEPRECATED
  notice in their `description` field). The **canonical** surface
  agents are encouraged to use is **32 tools + 10 MCP Resources**.
- **TypeScript library consumers may need code changes** — major bumps
  of `@modelcontextprotocol/sdk` (1.0.4 → 1.29.x) and `zod` (3.x → 4.4.3),
  combined with `tsconfig.verbatimModuleSyntax: true`, can affect import
  statements and Zod schema authorship.

---

## 1. Major dependency bumps

Two upstream packages had major-version-shaped jumps between v1.0.0 and
v2.0.0. Both produced concrete API-level differences that downstream TS
consumers will see at compile time.

### 1.1 `@modelcontextprotocol/sdk`: `^1.0.4` → `^1.29.0`

The SDK introduced the higher-level `McpServer` wrapper, `registerTool`
and `registerResource` methods, native sampling and elicitation, and
Standard Schema integration for input/output validation. vault-memory
adopted the full new surface in Phase 1; downstream consumers driving
the SDK directly should expect:

- Construct via `new McpServer(metadata, options)` instead of the
  low-level `new Server(...)`. `McpServer` wraps the internal `Server`
  and exposes the higher-level tool/resource registration APIs.
- Register tools through `server.registerTool(name, { description, inputSchema, ... }, handler)`
  rather than `server.setRequestHandler(ListToolsRequestSchema, ...)` +
  `server.setRequestHandler(CallToolRequestSchema, ...)`. The SDK runs
  Zod-schema input validation for you and returns a structured error
  on schema violation.
- Register Resources through `server.registerResource(name, uriOrTemplate, metadata, handler)`.
  Both static URIs and `ResourceTemplate(...)` parameterised URIs are
  supported (the latter accepts RFC 6570 URI Template syntax — see §5).
- Sampling (`server.server.createMessage(...)`) and elicitation
  (`server.server.elicitInput(...)`) are now first-class. vault-memory
  does not call them today (no LLM coupling in v2.0.0), but the
  primitives exist for downstream consumers that need them.
- Input/output schemas wired through Standard Schema — Zod 4 schemas
  are accepted directly without manual JSON-Schema conversion.

Upstream changelog: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/CHANGELOG.md>.

### 1.2 `zod`: `^3.24.1` → `^4.4.3`

Zod 4 is a major rewrite with new internals and a small number of
breaking surface changes. vault-memory's existing tool input schemas
were ported in Phase 1; downstream consumers authoring their own
schemas should expect:

- `z.string().min(1)` and friends behave the same; most v3 schema
  authorship transfers verbatim.
- Some error-formatting helpers were renamed; `result.error.format()`
  output shape is unchanged but the underlying issue-object schema
  has typed `code` literals.
- `.passthrough()`, `.strict()`, `.strip()` semantics tightened —
  default object schemas now strip unknown keys; explicit
  `.passthrough()` is required to retain them.
- Recursive schemas are authored with `z.lazy(...)` as before; the
  inferred type plumbing is more reliable under
  `verbatimModuleSyntax`.

Upstream changelog: <https://zod.dev/v4/changelog>.

---

## 2. TypeScript configuration: `verbatimModuleSyntax: true`

vault-memory's [`tsconfig.json`](../../tsconfig.json) sets
`verbatimModuleSyntax: true`. This is not a new option, but it is
strictly enforced across the v2 source tree. Downstream consumers who
re-export vault-memory types must use `import type` for type-only
symbols — mixing types and values in a single `import { ... }` is a
compile error.

**Before** (Zod 3 / SDK 1.0.4 era, lax import patterns):

```typescript
import { Document, parseDocId, type DocId } from "@owrede/vault-memory";
// `Document` here is a type, but the import is value-shaped — works
// without verbatimModuleSyntax, fails with it.
```

**After** (Zod 4 / SDK 1.29 / `verbatimModuleSyntax: true`):

```typescript
import type { Document, DocId } from "@owrede/vault-memory";
import { parseDocId } from "@owrede/vault-memory";
// Types are imported with `import type`; runtime values use a plain
// `import` from the same module.
```

Most consumers will see TypeScript errors of the form `"Foo" is a type
and must be imported using a type-only import when "verbatimModuleSyntax"
is enabled.` The fix is mechanical: split the import line, prefix the
type-only side with `type`.

---

## 3. Tool API delta

**All 23 v1 MCP tool names + their input schemas are preserved
byte-identical in v2.0.0.** This is a hard contract enforced by the
`evals/v1-baseline/tools-list.snapshot.json` snapshot test —
regression of any v1 tool name or schema fails CI.

The 23 v1 tools are:

```
list_vaults              read_note                search_semantic
search_text              search_hybrid            list_backlinks
list_forward_links       find_broken_links        query_frontmatter
write_note               update_frontmatter       delete_note
audit_log                list_models              start_shadow_index
switch_active_model      vacuum_embeddings        index_runs
search                   fetch                    vault_stats
recent_notes             suggest_frontmatter
```

The 14 net-new v2 tools, grouped by phase:

- **Phase 2 — memory namespace** (3): `record_observation`, `recall`,
  `supersede`.
- **Phase 3 — document-tree retrieval** (4): `get_outline`,
  `search_sections`, `get_document_bundle`, `assemble_dossier`.
- **Phase 4 — graph-as-retrieval** (2): `expand`, `cluster`.
- **Phase 5 — compiled briefs** (2): `compile_brief`, `get_brief`.
- **Phase 6 — task contract DSL** (3): `describe_contract`,
  `instantiate_contract`, `register_contracts_as_tools`.

Plus 6 plugin tools shipped by the Phase 7 Obsidian plugin
(`vault_settings_*`, `secret_*`, `contract_editor_*`) — these are
**gated default-OFF** behind the plugin's Settings panel and only
become callable when the user explicitly opts in.

### Canonical vs raw tool count

v2.0.0 ships 37 tools (5 marked DEPRECATED in their description); the
canonical surface is 32 tools + 10 MCP Resources. The 5 deprecated
tools remain fully callable in v2.x and will be removed in v3.0.

The 10 MCP Resources break down as 5 pre-existing
(`memory-sinks`, `memory-stats`, `briefs`, `contracts`,
`contract-verbs`) plus 5 new in v2.0.0 (`vaults`, `models`, `recent`,
`stats`, `backlinks`) — see §5 below.

---

## 4. Type system (branded types + adapter interfaces)

vault-memory v2 ships a small set of nominal (branded) types and three
adapter interfaces. Downstream consumers that consume documents or
implement adapters interact with these directly.

### 4.1 Branded identifiers

Defined in [`src/types.ts`](../../src/types.ts):

- **`DocId`** ([`src/types.ts:420`](../../src/types.ts)) —
  `string & { readonly __brand: "DocId" }`. Opaque, URI-style
  (`<scheme>://<authority>/<resource>`, e.g.
  `obsidian-fs://my-vault/notes/foo.md`). Raw `string` is not
  assignable; the only validating mint point is `parseDocId` (exported
  from `src/adapters/registry.ts`).
- **`ChunkId`** ([`src/types.ts:431`](../../src/types.ts)) —
  `string & { readonly __brand: "ChunkId" }`. Form: `<DocId>#chunk-<fragment>`.
- **`SourceHandle`** ([`src/types.ts:479`](../../src/types.ts)) —
  `string & { readonly __brand: "SourceHandle" }`. Names a registered
  source adapter (e.g. `"obsidian-fs"`, `"stub"`).
- **`MemorySinkHandle`** ([`src/types.ts:490`](../../src/types.ts)) —
  `string & { readonly __brand: "MemorySinkHandle" }`. Full
  `obsidian-fs://<vault>/<path>/` URI for a labelled memory sink.

### 4.2 `Document` — the canonical content type

Defined at [`src/types.ts:682`](../../src/types.ts):

```typescript
export interface Document {
  id: DocId;
  source: SourceHandle;
  title: string;
  blocks: BlockNode[];
  properties: Record<string, unknown>;
  links: Edge[];
  mtime: number;
  hash: string;
  display_url?: string | null;
}
```

Every assembly tool, brief compiler, and citation builder downstream
consumes this shape. `properties: Record<string, unknown>` subsumes
both YAML frontmatter (today) and typed Notion properties (future,
Phase 10).

### 4.3 Adapter interfaces

Three exported interfaces define the read / write / watch seams:

- **`SourceConnector`** —
  [`src/adapters/source/types.ts:120`](../../src/adapters/source/types.ts).
  Read seam. Methods: `listDocuments`, `readDocument`, `hash`,
  `exists`, plus a `capabilities: SourceCapabilities` descriptor.
- **`DeliveryAdapter`** —
  [`src/adapters/delivery/types.ts:229`](../../src/adapters/delivery/types.ts).
  Write seam. Method: `write(id, doc, opts)` returning `WriteResult`.
  Enforces `write_enabled`, path safety, hash-based OCC, plus the
  MemorySink guard at entry (provenance required, agent-outside-sink
  rejected) per ADR-004.
- **`ChangeFeed`** —
  [`src/adapters/change-feed/types.ts:87`](../../src/adapters/change-feed/types.ts).
  Watch seam. Methods: `subscribe(handler)` returning a `Disposable`,
  `close()`, optional `drain()`. Emits the `ChangeEvent` tagged union
  (`create` / `update` / `delete` / `rename`).

Downstream consumers implementing a custom source (e.g. a Notion
adapter) implement this triple. The interface signatures are stable
in v2.x; behaviour layered on top (e.g. MemorySink guard in
`DeliveryAdapter.write`) does not change the type shape.

---

## 5. REL-08 — list-tool → MCP Resource promotion

Five v1 list-style tools are promoted to MCP Resources in v2.0.0
under the `vault-memory://` URI scheme. Each retains its v1 tool
shape (callable through v2.x); agents are encouraged to discover via
the Resource URI going forward. Removal of the deprecated tool entries
is scheduled for v3.0.

| v1 tool          | v2.0.0 MCP Resource URI                        | Status                                                    |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `list_vaults`    | `vault-memory://vaults`                        | tool callable through v2.x; removal scheduled v3.0.0      |
| `list_models`    | `vault-memory://models/{vault}`                | tool callable through v2.x; removal scheduled v3.0.0      |
| `recent_notes`   | `vault-memory://recent/{vault}`                | tool callable through v2.x; removal scheduled v3.0.0      |
| `vault_stats`    | `vault-memory://stats/{vault}`                 | tool callable through v2.x; removal scheduled v3.0.0      |
| `list_backlinks` | `vault-memory://backlinks/{vault}/{+docId}`    | tool callable through v2.x; removal scheduled v3.0.0      |

The `list_backlinks` Resource URI uses RFC 6570 reserved expansion
(the `+` prefix on `{+docId}`): the variable expands to include the
reserved character `/`, so multi-segment DocIds like
`notes/sub/file.md` round-trip without percent-encoding the path
separators. The other four templates use simple expansion (no `+`)
because their variables (`{vault}`) are single-segment names.

The 5 pre-existing Resources from Phases 2 and 6 round out the
10-Resource canonical surface:

- `vault-memory://memory/sinks` — labelled MemorySinks (Phase 2, MEM-09).
- `vault-memory://memory/stats` — memory namespace counters (Phase 2, MEM-12).
- `vault-memory://briefs/{vault}` — compiled briefs index (Phase 5).
- `vault-memory://contracts/{vault}` — task contract catalog (Phase 6, CON-04).
- `vault-memory://contracts/{vault}/verbs` — closed verb dispatcher
  surface (Phase 6, D-A2b).

---

## Appendix — what's new at runtime (Phases 2–7)

A one-paragraph orientation per phase for end users. Each link points
to the phase's canonical artifact (sign-off doc or scoped README).

**Phase 2 — Memory namespace.** Agent-authored documents now land in
labelled `MemorySink` folders (default: `_memory/`) with provenance
metadata (`source: agent`, `agent_name`, `created_at`, `superseded_by`).
The `record_observation` and `supersede` tools write through the
delivery adapter's MemorySink guard; the `recall` tool reads memory
back with authority/staleness scoring. See
[docs/v2/MEMORY_CONTRACT.md](./MEMORY_CONTRACT.md).

**Phase 3 — Document-tree retrieval.** Notes are parsed into a block
tree (`BlockNode[]`) with stable section anchors. The `get_outline`,
`search_sections`, `get_document_bundle`, and `assemble_dossier` tools
let agents fetch sub-document chunks with citations rather than whole
notes. See [docs/v2/PHASE-3-SIGN-OFF.md](./PHASE-3-SIGN-OFF.md).

**Phase 4 — Graph-as-retrieval.** Wikilinks become a typed edge
graph; the `expand` and `cluster` tools surface multi-hop neighbours
and Louvain communities so agents can navigate via topology, not just
text similarity. See [docs/v2/PHASE-4-SIGN-OFF.md](./PHASE-4-SIGN-OFF.md).

**Phase 5 — Compiled briefs.** The `compile_brief` tool runs a
retrieval + dossier pipeline once and persists the result as a
re-usable `Brief` document; `get_brief` fetches it later. Defeats the
"agents rediscover 85% of context every run" failure mode. See
[docs/v2/PHASE-5-SIGN-OFF.md](./PHASE-5-SIGN-OFF.md).

**Phase 6 — Task contract DSL.** Declarative YAML contracts under
`_contracts/<name>.yaml` are addressable by name and instantiable via
MCP. `describe_contract` returns the JSON Schema for inputs;
`instantiate_contract` runs the 7-step orchestrator; `register_contracts_as_tools`
is an always-callable escape valve for clients that surface tools
better than Resources. See [docs/v2/PHASE-6-SIGN-OFF.md](./PHASE-6-SIGN-OFF.md).

**Phase 7 — Obsidian plugin.** Optional first-party Obsidian plugin
(default-OFF) for vault configuration, secret management, and a visual
contract editor. The plugin's 6 MCP tools are gated behind the
plugin's Settings panel and only become callable when the user
explicitly enables them. See [docs/v2/plugin/README.md](./plugin/README.md).
