# Phase 6: Task Contract DSL — Research

**Researched:** 2026-05-18
**Domain:** Declarative YAML task contracts; MCP Tool/Resource surface; peer-MCP client lifecycle; hot-reload registry; handle-based source/sink portability
**Confidence:** HIGH (every tool/library claim verified in `node_modules/` against the installed runtime — Zod 4.4.3, MCP SDK 1.29, yaml 2.9.0)

## Summary

Phase 6 is mechanically small but architecturally load-bearing. CONTEXT.md locks 12 design decisions (D-A1 … D-LOAD); the WHAT is closed, the HOW is open. The good news: every runtime dependency Phase 6 needs is already installed (`yaml@^2.9.0` from Phase 0; `zod@^4.4.3` and MCP SDK `^1.29.0` from Phase 1). No net-new runtime deps are required at all — **CON-12 is already satisfied** by the Phase 0 bootstrap (which installed `yaml@^2.9.0` ahead of need).

Three mechanical findings dominate the planning surface:

1. **Zod 4 ships `z.fromJSONSchema()` and it returns a real `ZodObject`** (verified `instanceof z.ZodObject === true` against the installed v4.4.3 build, see Pitfall F1). This makes the JSON Schema → MCP `inputSchema` round-trip trivial: parse the YAML contract's `inputs:` JSON Schema fragment, call `z.fromJSONSchema()`, hand the resulting ZodObject to `McpServer.registerTool({inputSchema: <zodObject>})`. The SDK's `AnySchema` type accepts a Zod 4 schema instance directly (verified in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.d.ts`).

2. **SDK 1.29 exposes `McpServer.sendToolListChanged()`** as a sync `void` method (verified in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:206`). This is the API for D-LOAD's `tools/list_changed` emission — **not** the lower-level `server.notification('notifications/tools/list_changed')` the CONTEXT.md mentions. The plan must use the high-level API.

3. **A namespace collision exists between Phase 2 and Phase 6.** Phase 2 already uses `_contracts/memory/<name>.yaml` for `MemoryContract` files (verified: `src/memory/contract/loader.ts:236`, `src/adapters/delivery/obsidian-fs/contract-yaml-read.ts:40`, and the shipped `_contracts/memory/default-memory-v1.yaml`). Phase 6's CONTEXT.md says task contracts live at `_contracts/*.yaml`. The Phase 6 loader **must** scan only the top-level `_contracts/*.yaml` (not recurse into `memory/`) or use a dedicated subfolder. Recommendation: **scan only top-level `_contracts/*.yaml`** (non-recursive `listDocuments` filter). Adding a `_contracts/tasks/` subfolder would force a CONTEXT.md change; non-recursion is invisible to users and keeps the user-facing path simple.

**Primary recommendation:** Build the Phase 6 stack in this order — (1) ADR 006 (plan 06-01); (2) `src/contracts/types-catalog.ts` + `json-schema-ref.ts` + `schema.ts` (Zod for the YAML shape itself) + `templates.ts` (mustache resolver); (3) `loader.ts` + `registry.ts` (ChangeFeed-driven hot reload); (4) `verbs/index.ts` (baseline-verb dispatcher) + `verbs/mcp-extension.ts` + `mcp-clients.ts` (peer-MCP); (5) `instantiate.ts` + `describe.ts` (orchestration); (6) `auto-register.ts` + `resources.ts` (MCP surface); (7) three reference contracts + eval scenarios + CON-09 + CON-10 proofs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| YAML parse + comment round-trip | Domain (`src/contracts/`) | — | `yaml@2.9` consumed at the domain layer; no `fs` here. Reads route through `SourceConnector.readDocument()` (adapter seam). |
| Hot reload watch | Adapter seam (`ChangeFeed`) | Domain (`loader.ts`) | `ChangeFeed.subscribe(handler)` is the only filesystem-watching API the domain layer touches (per ADR-002 I-1). |
| Tool registration / `tools/list_changed` | MCP surface (`src/server.ts` + `tool-registry.ts`) | Domain (`auto-register.ts`) | `McpServer.registerTool` and `sendToolListChanged()` live at the SDK boundary. Domain layer **calls** them via injected callbacks; does not import the SDK directly outside `auto-register.ts`. |
| Peer-MCP client sessions | Adapter-style boundary (`src/contracts/mcp-clients.ts`) | Domain (`verbs/mcp-extension.ts`) | New adapter-style boundary mirroring the `OllamaClient` shape; lifecycle bound to `vault-memory serve`. |
| `write_back` chokepoint | Adapter seam (`DeliveryAdapter.write()`) | Domain (`instantiate.ts`) | Sacrosanct: every contract write routes through `DeliveryAdapter.write()` which runs the Phase 2 MEM-05 validator. No new write path. |
| Sink validation | Domain (`MemorySinkRegistry.resolveMemorySink`) | — | D-A4c — single chokepoint already exists in `src/memory/registry.ts:142`. |
| Audit rows | DB (`src/db/queries/audit.ts`) | Domain (`instantiate.ts`) | New `kind` values land in the existing `write_audit` table — but see Open Question Q-AUD below. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-A1: Both MCP surfaces ship.** Generic `instantiate_contract` always available; per-contract auto-registration gated by per-vault `[contracts] auto_register_tools = false`. Manual `register_contracts_as_tools({vault?})` always available regardless. ChangeFeed events emit `tools/list_changed` when auto-register is ON.

**D-A1b: Per-vault config `[contracts] auto_register_tools` (default `false`).** Lives in `~/.vault-memory/config.toml`; extends Phase 1 `loadConfig`. Per-vault not global.

**D-A1c: Tool name prefix `[contracts] tool_prefix` (default `"vm_"`).** Contract `name: meeting-prep` → tool `vm_meeting_prep`. Same-name-collision within a vault is a load error; second contract rejects with structured error, first registers normally.

**D-A2a: Closed verb enum + `literal` escape + `mcp://` extension.** Baseline (11): `search_hybrid`, `expand`, `cluster`, `recall`, `compile_brief`, `get_brief`, `query_frontmatter`, `list_backlinks`, `get_outline`, `search_sections`, `read_note`. `literal` injects pre-computed values. `mcp://<server>/<tool>` resolves against `[contracts.mcp_clients]`. No write verbs in the assembly enum; `write_back:` is the only legal write path.

**D-A2b: `list_contract_verbs` MCP Resource + `audit_log` integration.** Resource at `vault-memory://contract-verbs/{vault}`. Each step writes `kind: "contract_step"` row; aggregated for `invocation_count` + `last_seen`. Promotion-path signal for v2.x baseline.

**D-A2c: `{{alias.field}}` mustache resolver (~50 LOC).** Every step has required `as:` alias. `{{inputs.<name>}}` references contract inputs. Resolves after Zod input validation, before verb dispatch. Field-path + array shorthand support. Undefined → `{ok:false, reason:"unresolved_template", expression}`.

**D-A3a: JSON Schema subset in YAML; Zod 4 parses at load.** `inputs:` is JSON Schema (flat field form, wrapped as `{type:'object', properties, required}` internally). Pass-through to MCP `inputSchema` byte-equivalent. Keywords: `type`, `description`, `pattern`, `enum`, `format`, `default`, `required`.

**D-A3b: `$ref: '#/types/<TypeName>'` resolves to a vault-memory catalog.** Catalog: `DocId`, `Handle`, `ChunkId`, `MemorySink`. `MemorySink` carries `x-validator: 'memory-sink'` extension triggering runtime `MemorySinkRegistry.resolveMemorySink()`. Resolver (~20 LOC) at `src/contracts/json-schema-ref.ts`. Additive evolution only.

**D-A4a: Override target = handle name.** `source_overrides: { default_source: 'stub://test-fixture' }`. Not by URI scheme.

**D-A4b: Strict override validation.** No silent ignore. `unknown_override_handle` / `missing_required_source` / optional-source-with-no-default returns `null`. Default chain: explicit override → config `[contracts.defaults.<handle>]` → contract YAML literal → error if required.

**D-A4c: `sink_overrides` MUST resolve to a registered MemorySink** via `MemorySinkRegistry.resolveMemorySink(target)`. `sink_override_not_a_memory_sink` on failure. **Memory-namespace invariant enforced at the contract surface by construction.**

**D-LOAD: Hot reload via `ChangeFeed`.** Boot scan + runtime subscribe to `_contracts/`. Create/update/delete/rename → re-validate + mutate registry + emit `tools/list_changed` if auto-register is ON. Failed parse → keep prior version + write `audit_log` `kind: "contract_load_error"`.

### Claude's Discretion

- Exact YAML schema of `output_shape:` (lean: same JSON Schema subset as `inputs:`)
- Where peer-MCP client sessions live in process tree (lean: `src/contracts/mcp-clients.ts`)
- `yaml ^2.6` round-trip specifics (lean: `parseDocument` + `Document.toString()`; YAML is **read-only** in Phase 6 — round-trip is for Phase 7 Canvas)
- Error envelope enum (closed list deferred to plan 06-01 ADR)
- `describe_contract` Zod-to-human-readable summary (lean: `{json_schema, summary}` with auto-generated markdown)
- Concurrent `instantiate_contract` calls (lean: no mutex; Phase 5 D-12 auto-supersede chain handles same-target collisions)
- Per-step timeouts (lean: `[contracts] step_timeout_seconds = 30`)
- The three reference contracts' exact step lists (researcher drafts below)
- CON-09 canonical client (lean: extend existing `scripts/smoketest-non-claude.mjs` — SDK Client + StdioClientTransport pattern already proven)
- `audit_log` retention for `contract_step` rows (same as existing Phase 2 default; out of v2.0.0 scope)
- `tools-list.snapshot.json` regen (additive: +3 tools; default-OFF keeps snapshot stable)

### Deferred Ideas (OUT OF SCOPE)

- Macros / sub-contracts (`_contracts/_macros/<name>.yaml`)
- In-process TypeScript plugins (`_contracts/_tools/<name>.ts`)
- Per-call LLM strategy override on `compile_brief`
- MCP Prompts surface (rejected for CON-09)
- Cross-vault contracts
- Per-step retries / circuit breakers
- `audit_log` retention policy for `contract_step`
- Per-vault `tools-list.snapshot.json` variants
- LLM-generated `list_contracts` summaries
- Contract versioning beyond `version: 1`
- GraphQL-style assembly query language
- Contract composition (`verb: contract:<name>`)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CON-01 | YAML contract schema, Zod-4 validated, comments preserved | §A (yaml@2.9 verified) + §B (Zod 4 fromJSONSchema verified) + §F (schema layout) |
| CON-02 | Contracts live as `Document`s in `_contracts/` | §F + §P (namespace collision warning) |
| CON-03 | Sources/sinks by handle, `{{default_source}}` variable | §D (template resolver) + §G (config defaults chain) |
| CON-04 | `list_contracts` MCP Resource | §M (resource registration pattern) |
| CON-05 | `describe_contract` MCP tool | §L (output shape spec) |
| CON-06 | `instantiate_contract` MCP tool | §D + §G + §M + §N + §O (orchestration) |
| CON-07 | 3 reference contracts ship | §I (Atlas Robotics assembly skeletons) |
| CON-08 | Eval scenarios with expected `output_shape` | §I + §J (per-contract `_queries/contracts-*.yaml`) |
| CON-09 | Non-Claude MCP client proof | §K (extend `smoketest-non-claude.mjs`) |
| CON-10 | Stub-parity override mechanism proof | §J (stub:// source override eval) |
| CON-11 | Phase 6 ADR (Tools vs Prompts decision) | Plan 06-01 authors ADR 006 from CONTEXT.md decisions |
| CON-12 | `yaml ^2.6` dep + rationale doc | **Already satisfied** — `yaml@^2.9.0` installed in Phase 0 (no new dep needed); rationale doc lands in ADR 006 |

## Standard Stack

### Core (already installed — verified against `package.json` + `node_modules/`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yaml` | `^2.9.0` (installed) | `parseDocument` round-trip + `Document.toJS()` for Zod | Only YAML lib that preserves comments byte-equivalent on round-trip via `parseDocument` + `Document.toString()` `[VERIFIED]` |
| `zod` | `^4.4.3` (installed) | `z.fromJSONSchema()` → `ZodObject` for input validation + contract schema validation | Zod 4 is the only Zod major with native JSON Schema parsing `[VERIFIED]` |
| `@modelcontextprotocol/sdk` | `^1.29.0` (installed) | `McpServer.registerTool`, `registerResource`, `sendToolListChanged()`, `Client` for peer MCP | Locked stack `[VERIFIED]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Native `Symbol.dispose` | ES2023 | `Disposable` returned by `ChangeFeed.subscribe()` (and the new `McpClientSession.dispose()`) | Already used by Phase 1 ChangeFeed; consistent contract |
| `better-sqlite3` queries (`src/db/queries/audit.ts` extensions) | (installed) | New audit row support for `contract_step` + `contract_load_error` | See §N |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `z.fromJSONSchema` | Hand-roll JSON-Schema → Zod converter | More code, more bugs, no benefit — Zod 4 already ships this `[VERIFIED]` |
| `McpServer.registerTool` accepting JSON Schema directly | None — SDK 1.29 rejects raw JSON Schema literals | The `tool-registry.ts` plan 01-05 design note documents this: `getZodSchemaObject` throws on plain JSON Schema. Must use `z.fromJSONSchema()` → ZodObject → `registerTool({inputSchema: zodObject})` `[VERIFIED: node_modules source]` |
| Hand-rolled YAML parser | `yaml@2.9` | Comment preservation is non-trivial; YAML's quirks (anchors, multi-line, complex types) are best left to a maintained lib |
| Hand-rolled mustache | `handlebars`, `mustache` | Phase 6 only needs `{{alias.field}}` substitution + array shorthand. ~50 LOC handroll is cheaper than a 50 KB dep with templating features we don't want (conditionals, loops). |
| Separate `contract_audit` table | Extend `write_audit` | `write_audit` is keyed on `note_id INTEGER` and the brief daemon already learned that orchestration events without a note_id need stderr-only logging (see `src/brief/daemon.ts:121` `daemon_already_owned` comment). **Recommendation: ADD a new `contract_audit` table via migration 014.** See Open Question Q-AUD. |

**No `npm install` required.** All dependencies are present.

**Version verification:**

```bash
$ node -e "console.log(require('yaml/package.json').version)"     # → 2.9.0 (verified)
$ node -e "console.log(require('zod/package.json').version)"      # → 4.4.3 (verified)
$ node -e "console.log(require('@modelcontextprotocol/sdk/package.json').version)"  # → 1.29.x (verified)
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `yaml` | npm | 11+ yrs | 50M+/wk | github.com/eemeli/yaml | n/a (slopcheck unavailable in research env) — but installed by Phase 0 ADP-08 (already vetted) | Approved (pre-vetted) |
| `zod` | npm | 5 yrs | 30M+/wk | github.com/colinhacks/zod | n/a — installed by Phase 1 ADP-09 (already vetted) | Approved (pre-vetted) |
| `@modelcontextprotocol/sdk` | npm | <2 yrs | high (official Anthropic) | github.com/modelcontextprotocol/typescript-sdk | n/a — installed by Phase 1 ADP-08 (already vetted) | Approved (pre-vetted) |

**Packages removed due to slopcheck [SLOP] verdict:** none — no net-new packages
**Packages flagged as suspicious [SUS]:** none — no net-new packages

slopcheck was not run because Phase 6 introduces **zero net-new runtime dependencies**. All three libraries are pre-installed by earlier phases and have been vetted at install time.

## Architecture Patterns

### System Architecture Diagram

```text
                            ┌─────────────────────────┐
                            │  MCP client (Claude /   │
                            │  ChatGPT Connector /    │
                            │  MCP Inspector / peer)  │
                            └────────────┬────────────┘
                                         │ tools/call
                                         ▼
                ┌────────────────────────────────────────────┐
                │             src/server.ts                  │
                │  registerTool('instantiate_contract', …)   │
                │  registerTool('describe_contract', …)      │
                │  registerTool('register_contracts_as_tools')│
                │  registerResource('contracts', URI, …)     │
                │  registerResource('contract-verbs', URI, …)│
                │  + N auto-registered vm_<name> tools       │
                └────────────────────┬───────────────────────┘
                                     │
                                     ▼
                ┌─────────────────────────────────────────────┐
                │       src/contracts/instantiate.ts          │
                │  (1) Zod-validate inputs (z.fromJSONSchema) │
                │  (2) Resolve overrides (handle chain)       │
                │  (3) Validate sinks via                     │
                │      MemorySinkRegistry.resolveMemorySink   │
                │  (4) Build template binding table           │
                │  (5) For each assembly step:                │
                │      a. resolve {{templates}} (templates.ts)│
                │      b. dispatch verb (verbs/index.ts or    │
                │         verbs/mcp-extension.ts)             │
                │      c. write contract_step audit row       │
                │      d. bind output to {{as}}               │
                │  (6) Run write_back via DeliveryAdapter     │
                │  (7) Validate output against output_shape   │
                └────────────────┬────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┬─────────────────┐
              ▼                  ▼                  ▼                 ▼
   ┌──────────────────┐ ┌────────────────┐ ┌─────────────────┐ ┌──────────────┐
   │ Baseline verbs   │ │ literal verb   │ │ mcp:// verb     │ │ DeliveryAdpt │
   │ (11 closed enum) │ │ (inject value) │ │ → mcp-clients.ts│ │ .write()     │
   │ search_hybrid,   │ │                │ │ → SDK Client    │ │ → MEM-05     │
   │ compile_brief,   │ │                │ │ .callTool(…)    │ │   validator  │
   │ recall, …        │ │                │ │ → peer MCP svr  │ │ → MemorySink │
   └──────────────────┘ └────────────────┘ └─────────────────┘ └──────────────┘
              │
              │ (verb backing functions already exist —
              │  no new code paths inside them)
              ▼
   ┌──────────────────────────────────────────────┐
   │ src/search/, src/graph/, src/brief/,         │
   │ src/frontmatter/, src/assembly/, src/memory/ │
   └──────────────────────────────────────────────┘


      ┌─────────────────────────────────────────────────────────┐
      │            Boot + hot-reload lifecycle                  │
      │                                                         │
      │   src/server.ts bootstrap                               │
      │       │                                                 │
      │       ├─► MemorySinkRegistry registered (Phase 2)       │
      │       ├─► ChangeFeed per vault (Phase 1)                │
      │       ├─► VaultWatcher subscribes (Phase 1)             │
      │       ├─► BriefStalenessDaemon subscribes (Phase 5)     │
      │       └─► ContractRegistry subscribes (Phase 6 — NEW)   │
      │             │                                           │
      │             ├─► boot scan _contracts/*.yaml             │
      │             │   (via SourceConnector.listDocuments)     │
      │             ├─► parse + Zod-validate each               │
      │             ├─► fromJSONSchema for inputs               │
      │             ├─► populate Map<name, ParsedContract>      │
      │             └─► if auto_register: dynamic registerTool  │
      │                                                         │
      │   On ChangeEvent for path matching _contracts/*.yaml:   │
      │       ├─► re-parse + re-validate                        │
      │       ├─► success: mutate registry + sendToolListChanged│
      │       │   (if auto_register is ON)                      │
      │       └─► failure: keep prior + write contract_load_error│
      └─────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/contracts/
├── index.ts                    # Barrel export
├── types.ts                    # ParsedContract, ContractRegistry, OverrideMap, ContractStepRow
├── schema.ts                   # Zod schema for the YAML shape itself (ContractFileSchema)
├── types-catalog.ts            # $ref: '#/types/<name>' catalog (D-A3b)
├── json-schema-ref.ts          # ~20 LOC $ref resolver (D-A3b)
├── input-schema.ts             # JSON-Schema-to-Zod (wraps z.fromJSONSchema + x-validator hook)
├── templates.ts                # ~50 LOC mustache resolver (D-A2c)
├── loader.ts                   # Boot scan + ChangeFeed subscriber (D-LOAD)
├── registry.ts                 # ContractRegistry class (Map<name, ParsedContract>)
├── mcp-clients.ts              # Peer-MCP client lifecycle (D-A2a mcp:// extension)
├── verbs/
│   ├── index.ts                # Closed baseline verb dispatcher + literal handler
│   └── mcp-extension.ts        # mcp://<server>/<tool> resolver
├── instantiate.ts              # instantiate_contract orchestrator
├── describe.ts                 # describe_contract output builder
├── auto-register.ts            # Dynamic registerTool when auto_register_tools=true
├── resources.ts                # list_contracts + list_contract_verbs MCP Resources
├── slug.ts                     # name → tool name slugifier (kebab → snake + prefix)
├── audit-extensions.ts         # contract_step + contract_load_error row writers
└── tests/                      # co-located *.test.ts files
```

### Pattern 1: Loader + ChangeFeed Subscription (mirrors Phase 5 daemon)

**What:** `ContractRegistry.subscribe(feed, vault)` subscribes a handler that re-parses on change. Mirrors `BriefStalenessDaemon.start()` shape (`src/brief/daemon.ts`).

**When to use:** D-LOAD requires the same in-process boot-time-subscribe lifecycle Phase 5 uses.

**Example:**
```typescript
// src/contracts/loader.ts
export async function startContractRegistry(opts: {
  vault: Vault;
  feed: ChangeFeed;
  source: SourceConnector;
  config: ContractsConfig;
  onRegistryChange?: () => void;  // Triggers auto-register re-run
}): Promise<Disposable> {
  const registry = new ContractRegistry();
  await bootScan(opts.source, opts.vault, registry);  // initial population
  const sub = opts.feed.subscribe(async (event) => {
    if (!matchesContractsPath(event.id)) return;
    await reloadOne(event, opts.source, registry, opts.vault);
    opts.onRegistryChange?.();
  });
  return sub;
}
```

`matchesContractsPath` filters for `_contracts/<single-segment>.yaml` (NOT `_contracts/memory/...` — see §P collision warning).

### Pattern 2: Input Schema = JSON Schema → ZodObject → MCP

**What:** Parse the YAML contract's `inputs:` JSON Schema fragment, wrap as `{type:'object', properties, required}`, hand to `z.fromJSONSchema()`. The returned `ZodObject` goes to both `McpServer.registerTool({inputSchema: <zodObject>})` and `instantiate_contract`'s runtime validation.

**When to use:** D-A3a passes-through to `tools/list` byte-equivalent JSON Schema. The wrap-as-object happens at load time and is cached on the `ParsedContract`.

**Example:**
```typescript
// src/contracts/input-schema.ts
import { z } from "zod";
import { resolveRefs } from "./json-schema-ref.js";

export function buildInputSchema(yamlInputs: Record<string, unknown>, required: string[]): {
  zodSchema: z.ZodObject<any>;
  jsonSchema: object;  // For MCP inputSchema pass-through
} {
  const resolvedProperties = resolveRefs(yamlInputs);  // Walk + replace $ref
  const jsonSchema = {
    type: "object",
    properties: resolvedProperties,
    required,
    additionalProperties: false,
  };
  const zodSchema = z.fromJSONSchema(jsonSchema) as z.ZodObject<any>;
  return { zodSchema, jsonSchema };
}
```

`[VERIFIED]` against installed `zod@4.4.3` — `z.fromJSONSchema({type:'object', properties:{foo:{type:'string'}}, required:['foo']})` returns `instanceof z.ZodObject === true`.

### Pattern 3: Peer-MCP Client Lifecycle (Symbol.dispose)

**What:** `mcp-clients.ts` instantiates one `Client` + `StdioClientTransport` per `[contracts.mcp_clients.<name>]` config entry at server boot. Each client gets `await client.connect(transport)`; failures log structured WARN + mark the client unavailable.

**When to use:** D-A2a `mcp://` extension.

**Example:**
```typescript
// src/contracts/mcp-clients.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface PeerMcpClientConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface PeerMcpClient {
  callTool(name: string, args: unknown): Promise<unknown>;
  available: boolean;
  [Symbol.dispose](): void;
}

export class PeerMcpRegistry {
  private clients = new Map<string, PeerMcpClient>();

  async start(configs: Record<string, PeerMcpClientConfig>): Promise<void> {
    for (const [name, cfg] of Object.entries(configs)) {
      const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env });
      const client = new Client({ name: `vault-memory-peer-${name}`, version: VERSION });
      try {
        await client.connect(transport);
        this.clients.set(name, makePeerClient(client, transport));
      } catch (err) {
        process.stderr.write(`[contracts] peer-MCP client '${name}' failed to start: ${(err as Error).message}\n`);
        this.clients.set(name, makeUnavailableClient(name));  // available: false
      }
    }
  }

  get(name: string): PeerMcpClient | undefined { return this.clients.get(name); }

  async shutdown(): Promise<void> {
    for (const c of this.clients.values()) c[Symbol.dispose]();
  }
}
```

`[VERIFIED]` — `Client` and `StdioClientTransport` exports confirmed in `node_modules/@modelcontextprotocol/sdk/dist/esm/client/{index,stdio}.d.ts`. Existing usage pattern in `scripts/smoketest-non-claude.mjs:41-42`.

### Pattern 4: Dynamic Auto-Registration with `tools/list_changed`

**What:** When `auto_register_tools: true`, on every registry mutation: (a) compute the new set of `vm_*` tool names; (b) diff against currently-registered; (c) call `server.registerTool(...)` for adds / `RegisteredTool.remove()` for deletes; (d) call `server.sendToolListChanged()` exactly once.

**Example:**
```typescript
// src/contracts/auto-register.ts
const registered = new Map<string, RegisteredTool>();

export function syncAutoRegistered(server: McpServer, registry: ContractRegistry, prefix: string): void {
  const desired = new Map(
    Array.from(registry.entries()).map(([name, parsed]) => [slugify(name, prefix), parsed])
  );
  // Remove gone
  for (const [toolName, regd] of registered) {
    if (!desired.has(toolName)) { regd.remove(); registered.delete(toolName); }
  }
  // Add new
  for (const [toolName, parsed] of desired) {
    if (registered.has(toolName)) continue;
    const regd = server.registerTool(toolName, {
      description: parsed.description,
      inputSchema: parsed.inputZodSchema,  // already a ZodObject from buildInputSchema
    }, async (args) => instantiateContractHandler(parsed.name, args, deps));
    registered.set(toolName, regd);
  }
  server.sendToolListChanged();  // Sync notification per SDK 1.29
}
```

`[VERIFIED]` — `McpServer.sendToolListChanged(): void` at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:206`. `RegisteredTool.remove()` is the documented dynamic removal API in SDK 1.29.

### Anti-Patterns to Avoid

- **Don't import `fs`, `path`, `chokidar`, or `gray-matter` inside `src/contracts/`.** Adapter-seam discipline (ADR-002 I-1). Routes go through `SourceConnector.readDocument` / `listDocuments` and `ChangeFeed.subscribe`. CI greps (`scripts/lint-adapters.sh`) enforce.
- **Don't recurse into `_contracts/memory/`** during the boot scan or ChangeEvent dispatch. That subtree belongs to Phase 2's `MemoryContract` loader. See §P.
- **Don't bypass `DeliveryAdapter.write()` for `write_back`.** The MEM-05 validator must run; direct DB writes break the Phase 2 invariant.
- **Don't add write verbs to the assembly enum.** Even if a peer-MCP server exposes a write tool via `mcp://`, the assembly path can't bypass the `write_back:` chokepoint because the `mcp://` verb result lands as a step output binding — it cannot mutate the user vault. **However, a peer MCP server that exposes a tool causing side effects on its OWN backing store is outside our control.** Document this in ADR 006: peer-MCP verbs are responsible for their own destination's invariants; vault-memory only guarantees its OWN MemorySink invariants.
- **Don't slugify with `lodash.snakecase` or similar.** Plain string replace (`name.replace(/-/g, "_")`) is correct for kebab → snake; no dep needed.
- **Don't store peer-MCP client output verbatim in audit_log.** Risk of leaking sensitive data into the SQLite. Audit row stores `{contract, verb, step_alias, ts, vault}` — NOT the result payload.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parse + comment round-trip | Custom YAML lib | `yaml@2.9` `parseDocument` + `toJS()` / `toString()` | Edge cases (anchors, multiline, complex types). Already installed. |
| JSON Schema → Zod | Custom converter | `z.fromJSONSchema()` (Zod 4) | Already shipped by Zod; supports all the keywords we need (`type`, `pattern`, `enum`, `format`, `default`, `required`, `additionalProperties`). |
| MCP peer client | Custom stdio JSON-RPC | SDK `Client` + `StdioClientTransport` | Same SDK we're a server in; consistent envelopes; auth-extensions API available |
| `tools/list_changed` notification | `server.notification(...)` | `McpServer.sendToolListChanged()` | High-level API; SDK handles JSON-RPC envelope shape |
| File watching for `_contracts/` | New chokidar instance | Reuse the existing per-vault `ObsidianFsChangeFeed` | Phase 1 ADP-03 ChangeFeed already supports fan-out (multiple handlers per feed); see `src/brief/daemon.ts` for the established pattern |
| Path validation / slug uniqueness | Manual loops | `Map<string, ParsedContract>` + first-wins on collision | Built-in collision semantics with clear D-A1c behavior |

**Key insight:** Phase 6 is glue code. Every primitive — YAML parsing, schema conversion, MCP client/server, file watching, write chokepoint, sink validation, audit logging — is already shipped. The complexity is in the orchestration: ordering steps, resolving templates, dispatching verbs, formatting errors. ~50 LOC mustache resolver + ~20 LOC `$ref` resolver + ~200 LOC orchestrator are the entire NEW logic budget.

## Runtime State Inventory

Not applicable — Phase 6 is greenfield (new `src/contracts/` directory, new tools, no rename of existing code or stored data). The only "state" introduced is:

- **New SQLite table** via migration 014 (if Q-AUD recommends a separate `contract_audit` table) — see §N.
- **New peer-MCP child processes** spawned per `[contracts.mcp_clients]` entry — lifecycle bound to `vault-memory serve`, cleaned up on `Symbol.dispose`. No persistent state outside the parent process.
- **New per-vault `[contracts]` config block** — backwards-compatible (all fields optional with defaults).

## Common Pitfalls

### Pitfall F1: SDK `inputSchema` rejects plain JSON Schema literals

**What goes wrong:** Naively passing the YAML `inputs:` JSON Schema object directly to `McpServer.registerTool({inputSchema: jsonSchemaObject})` throws at registration time (SDK 1.29 `getZodSchemaObject` rejects).

**Why it happens:** SDK 1.29's `inputSchema` accepts `AnySchema | ZodRawShapeCompat` where `AnySchema = z3.ZodTypeAny | z4.$ZodType`. Plain JSON Schema is neither. Documented at `src/tool-registry.ts:16-29` (the Phase 1 plan literal hit this same trap).

**How to avoid:** Always run JSON Schema through `z.fromJSONSchema()` → ZodObject **before** handing to `registerTool`. The conversion happens once at contract load time (cached on `ParsedContract.inputZodSchema`).

**Warning signs:** Error message `Tool input schema must be a Zod schema` at server boot when auto-register is ON.

### Pitfall F2: `z.fromJSONSchema` `additionalProperties` default

**What goes wrong:** If the YAML `inputs:` block omits `additionalProperties`, Zod 4's `fromJSONSchema` may default to allowing extras — which then breaks strict input validation when callers pass a typo'd key (the typo is silently ignored).

**Why it happens:** JSON Schema defaults to `additionalProperties: true`; Zod 4 `z.toJSONSchema` emits `additionalProperties: false` by default, but `fromJSONSchema` honors what's in the schema.

**How to avoid:** **The wrapper in `buildInputSchema` sets `additionalProperties: false` explicitly** before calling `fromJSONSchema`. Documented in §Pattern 2 above.

**Warning signs:** A test passes `{meeting_doc_id: "...", typo_field: 42}` and the typo is silently dropped instead of rejected.

### Pitfall F3: Collision between Phase 2 `_contracts/memory/` and Phase 6 `_contracts/`

**What goes wrong:** Phase 6 boot scan picks up `_contracts/memory/default-memory-v1.yaml`, tries to parse it as a task contract, fails Zod validation, writes a spurious `contract_load_error` audit row per `MemoryContract` file. Worse: a future Phase 6 user adds a task contract at `_contracts/memory/my-contract.yaml` and it's silently invisible.

**Why it happens:** CONTEXT.md says "contracts live as `Document`s in `_contracts/` namespace." Phase 2 already established `_contracts/memory/` as a sub-namespace for `MemoryContract` files.

**How to avoid:** Loader filters to `^_contracts/[^/]+\.yaml$` (single-segment YAML files only, NO recursion). Task contracts MUST be at top-level. Document in ADR 006 and the README; existing `_contracts/memory/*.yaml` files are invisible to the task-contract loader by design.

**Warning signs:** `audit_log` populated with `contract_load_error` rows referencing `_contracts/memory/*.yaml` paths at boot.

### Pitfall F4: Peer-MCP child-process zombie on parent crash

**What goes wrong:** `vault-memory serve` crashes; the `StdioClientTransport` child processes (peer MCP servers) survive as orphans, leaking memory and holding file locks.

**Why it happens:** Node child_process inherits behavior depends on shell and OS. Without a `kill_signal` or `unref()` strategy, parent death doesn't guarantee child death.

**How to avoid:** The `Symbol.dispose` on `PeerMcpClient` MUST `transport.close()` (which invokes `child.kill()`). Also register a `process.on('SIGTERM')` / `process.on('SIGINT')` handler at server boot to dispose the `PeerMcpRegistry`. Same pattern as `VaultWatcher.stop()` cleanup.

**Warning signs:** `ps aux | grep <peer-mcp-binary>` shows orphan processes after `vault-memory serve` exits.

### Pitfall F5: ChangeFeed handler runs before catchup

**What goes wrong:** A `_contracts/foo.yaml` is in the vault on boot, ChangeFeed fires `create` for it during the initial scan, contract gets parsed twice (once via boot scan, once via change event).

**Why it happens:** ChangeFeed semantics vary — `chokidar` emits `add` for every existing file on initial scan unless `ignoreInitial: true`. Phase 5 daemon documented this in BRF-07 ("daemon-startup replay handles missed events while daemon was down").

**How to avoid:** ContractRegistry's mutation is idempotent — `Map.set(name, parsed)` doesn't care if it's already there. Just ensure the parse + validate path is pure (no side effects beyond registry mutation + audit row). The audit row dedup is desirable behavior, not a bug — a `contract_load_error` SHOULD be re-written on every retry so the latest error is visible.

**Warning signs:** N/A — by design.

### Pitfall F6: `instantiate_contract` runs MEM-05 only on `write_back`, not on intermediate steps

**What goes wrong:** A peer-MCP verb returns content that pretends to be a written document (e.g., a fake `DocId`); a downstream verb consumes it as if real; the contract's `output_shape` validation passes; the caller acts on bogus data.

**Why it happens:** MEM-05 only fires at `DeliveryAdapter.write()`. Step outputs aren't validated unless they pass through Delivery.

**How to avoid:** Document in ADR 006: **step outputs are advisory, not authoritative**. Only `write_back` produces a real `DocId`. Recommend: `output_shape` validation runs in `instantiate.ts` AFTER `write_back` completes, and the returned bundle's `written_doc_id` field comes from `DeliveryAdapter.write()`'s actual response (not from any step output template). The shape of the bundle is `{steps: {[alias]: <step_output>}, write_back: {doc_id: <real-DocId>}}`.

**Warning signs:** A contract whose `write_back.body_from` references a peer-MCP output produces a `write_back.doc_id` that doesn't match any audit row.

### Pitfall F7: Tool count breach — REL-08 budget already exceeded

**What goes wrong:** Phase 5 already shipped 34 tools (per STATE.md and `evals/v1-baseline/tools-list.snapshot.json` verified at 34 entries). REL-08 budget is ≤32 (with Resources promotion) or ≤40 (without). Adding 3 net-new Phase 6 tools → **37 tools**, still over the ≤32 promotion target.

**Why it happens:** REL-08 retirement of v1 tools (likely `search_semantic`, `search_text`, `list_models`, etc.) was deferred to Phase 8.

**How to avoid:** Document in plan 06-09 (or 06-final): the count goes 34 → 37 (with the 3 net-new contract tools); REL-08 reconciliation is **explicitly out of Phase 6 scope** and continues to be Phase 8's responsibility. The snapshot regen is additive only. The 2 net-new Resources (`list_contracts`, `list_contract_verbs`) don't count against the budget. **Recommendation: do NOT trigger early REL-08 retirements in Phase 6.** Keeping scope narrow.

**Warning signs:** Tool count reported in Phase 6 verification ≠ 37; or snapshot drift on irrelevant tools.

## Code Examples

### Example 1: Contract YAML round-trip (`meeting-prep`)

```yaml
# _contracts/meeting-prep.yaml
version: 1
name: meeting-prep
description: |
  Compile a meeting prep brief from the meeting note + linked context.
  Output is a brief written into the briefs sink.
inputs:
  meeting_doc_id:
    $ref: '#/types/DocId'
    description: DocId of the meeting note.
  context_hops:
    type: integer
    minimum: 1
    maximum: 2
    default: 1
    description: How many wikilink hops to expand from the meeting note.
required: [meeting_doc_id]
sources:
  default_source:
    handle: 'obsidian-fs://my-vault'
    required: true
sinks:
  default_sink:
    handle: '_memory/_briefs'      # by sink NAME — resolved via MemorySinkRegistry
    required: true
assembly:
  - as: meeting
    verb: read_note
    args:
      doc_id: '{{inputs.meeting_doc_id}}'
  - as: linked
    verb: expand
    args:
      seed_doc_ids: ['{{inputs.meeting_doc_id}}']
      hops: '{{inputs.context_hops}}'
      direction: both
  - as: clustered
    verb: cluster
    args:
      seed_doc_ids: '{{linked.doc_ids}}'
      method: edge-community
  - as: compiled
    verb: compile_brief
    args:
      vault: my-vault
      target: '{{inputs.meeting_doc_id}}--prep'
      source_doc_ids: '{{linked.doc_ids}}'
      purpose: 'Meeting prep brief for {{meeting.title}}'
      max_tokens: 2000
output_shape:
  type: object
  properties:
    brief_doc_id:
      $ref: '#/types/DocId'
    cluster_count:
      type: integer
  required: [brief_doc_id]
write_back:
  sink: '{{default_sink}}'
  document_kind: brief
  properties:
    target: '{{inputs.meeting_doc_id}}--prep'
    source: agent
  body_from: '{{compiled.body}}'
```

**Round-trip verification** (`yaml@2.9` `parseDocument` + `toString()` preserves all comments — verified):
```javascript
import { parseDocument } from "yaml";
const doc = parseDocument(yamlText);
const obj = doc.toJS();          // For Zod validation
const roundTripped = doc.toString();  // Byte-equivalent comments
```

### Example 2: Template resolver implementation sketch

```typescript
// src/contracts/templates.ts (~50 LOC target)
export interface TemplateBindings {
  inputs: Record<string, unknown>;
  steps: Record<string, unknown>;  // alias → step output
}

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g;

export type TemplateResolveResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "unresolved_template"; expression: string };

export function resolveTemplate(
  value: unknown,
  bindings: TemplateBindings,
): TemplateResolveResult {
  if (typeof value === "string") {
    return resolveString(value, bindings);
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const r = resolveTemplate(item, bindings);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = resolveTemplate(v, bindings);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}

function resolveString(s: string, bindings: TemplateBindings): TemplateResolveResult {
  // Special-case: entire string is one expression → return raw typed value
  const whole = s.match(/^\{\{([^}]+)\}\}$/);
  if (whole) {
    const path = whole[1].trim();
    const v = lookup(path, bindings);
    if (v === undefined) return { ok: false, reason: "unresolved_template", expression: s };
    return { ok: true, value: v };
  }
  // Otherwise: substitute embedded {{…}} as string concat
  let failed: string | null = null;
  const out = s.replace(TEMPLATE_RE, (_match, p1: string) => {
    const v = lookup(p1.trim(), bindings);
    if (v === undefined) { failed = `{{${p1.trim()}}}`; return ""; }
    return typeof v === "string" ? v : JSON.stringify(v);
  });
  if (failed) return { ok: false, reason: "unresolved_template", expression: failed };
  return { ok: true, value: out };
}

function lookup(path: string, bindings: TemplateBindings): unknown {
  // path: "inputs.foo.bar" or "stepAlias.field[0].sub"
  const parts = path.split(/[.[\]]/).filter(Boolean);
  const root = parts[0] === "inputs" ? bindings.inputs : bindings.steps[parts[0]];
  let current: unknown = root;
  for (const part of parts.slice(1)) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
```

### Example 3: `$ref` resolver

```typescript
// src/contracts/json-schema-ref.ts (~20 LOC target)
import { TYPES_CATALOG } from "./types-catalog.js";

export function resolveRefs(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(resolveRefs);
  if (schema && typeof schema === "object") {
    const obj = schema as Record<string, unknown>;
    if (typeof obj["$ref"] === "string") {
      const ref = obj["$ref"];
      const match = ref.match(/^#\/types\/(\w+)$/);
      if (!match) throw new Error(`Unknown $ref form: ${ref}`);
      const catalogEntry = TYPES_CATALOG[match[1]];
      if (!catalogEntry) throw new Error(`Unknown $ref target: ${ref}`);
      return { ...catalogEntry, ...stripRef(obj) };  // YAML-author additions win
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, resolveRefs(v)]),
    );
  }
  return schema;
}

function stripRef(obj: Record<string, unknown>): Record<string, unknown> {
  const { $ref, ...rest } = obj;
  return rest;
}
```

### Example 4: Types catalog

```typescript
// src/contracts/types-catalog.ts
export const TYPES_CATALOG: Record<string, object> = {
  DocId: {
    type: "string",
    pattern: "^[a-z][a-z0-9-]*://",
    description: "Opaque document identifier per ADR-001",
  },
  Handle: {
    type: "string",
    pattern: "^[a-z][a-z0-9-]*://",
    description: "Source or sink handle (currently identical to DocId; future-proof for divergence)",
  },
  ChunkId: {
    type: "string",
    pattern: "^[a-z][a-z0-9-]*://.+#chunk-[0-9a-f]{7}$",
    description: "Content-stable chunk identifier per Phase 5 ADR-005 H-5",
  },
  MemorySink: {
    type: "string",
    description: "Registered MemorySink handle (see list_sinks)",
    "x-validator": "memory-sink",  // Triggers MemorySinkRegistry.resolveMemorySink at instantiation
  },
};
```

The `x-validator: 'memory-sink'` is a JSON-Schema extension keyword that vault-memory respects; `z.fromJSONSchema` ignores unknown extensions safely (verified — extension keywords pass through without error).

### Example 5: Per-vault config extension

```toml
# ~/.vault-memory/config.toml additions
[contracts]
auto_register_tools = false      # D-A1b default
tool_prefix = "vm_"              # D-A1c default
step_timeout_seconds = 30        # Claude's discretion lean

[contracts.defaults]
# Default handle resolution chain step 2 (between explicit override and contract YAML literal)
default_source = "obsidian-fs://my-vault"

[contracts.mcp_clients.gh]
command = "gh-mcp-server"
args = ["--config", "/path/to/config.json"]
```

Zod schema extension to `AppConfigSchema` in `src/config/loader.ts`:

```typescript
const McpClientConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const ContractsConfigSchema = z.object({
  auto_register_tools: z.boolean().default(false),
  tool_prefix: z.string().regex(/^[a-z_][a-z0-9_]*$/).default("vm_"),
  step_timeout_seconds: z.number().int().positive().default(30),
  defaults: z.record(z.string(), z.string()).default({}),
  mcp_clients: z.record(z.string(), McpClientConfigSchema).default({}),
});

// In AppConfigSchema:
contracts: ContractsConfigSchema.optional().default({
  auto_register_tools: false,
  tool_prefix: "vm_",
  step_timeout_seconds: 30,
  defaults: {},
  mcp_clients: {},
}),
```

**Backwards compatibility:** existing config.toml files without `[contracts]` parse identically (all fields have defaults via `.default(...)`).

### Example 6: Reference contract — `project-status`

```yaml
# _contracts/project-status.yaml
version: 1
name: project-status
description: Compile a status brief for a project tracked in the vault.
inputs:
  project_key:
    type: string
    description: 'Project key (matches frontmatter.aliases or title), e.g. "atlas-1"'
  freshness_days:
    type: integer
    default: 30
    description: Include only notes updated within this many days.
required: [project_key]
sources:
  default_source:
    handle: 'obsidian-fs://my-vault'
    required: true
sinks:
  default_sink:
    handle: '_memory/_briefs'
    required: true
assembly:
  - as: project_notes
    verb: query_frontmatter
    args:
      vault: my-vault
      where:
        project: '{{inputs.project_key}}'
      limit: 100
  - as: grouped
    verb: cluster
    args:
      seed_doc_ids: '{{project_notes.doc_ids}}'
      method: edge-community
  - as: compiled
    verb: compile_brief
    args:
      vault: my-vault
      target: '{{inputs.project_key}}--status'
      source_doc_ids: '{{project_notes.doc_ids}}'
      purpose: 'Project status for {{inputs.project_key}}'
output_shape:
  type: object
  properties:
    brief_doc_id: { $ref: '#/types/DocId' }
    note_count: { type: integer }
  required: [brief_doc_id]
write_back:
  sink: '{{default_sink}}'
  document_kind: brief
  properties:
    target: '{{inputs.project_key}}--status'
    source: agent
  body_from: '{{compiled.body}}'
```

### Example 7: Reference contract — `code-review-brief`

```yaml
# _contracts/code-review-brief.yaml
version: 1
name: code-review-brief
description: Compile a code-review-context brief for a PR or diff note.
inputs:
  pr_doc_id:
    $ref: '#/types/DocId'
    description: DocId of the PR / diff note in the vault.
  search_query:
    type: string
    description: Free-text query to find related code/notes.
required: [pr_doc_id, search_query]
sources:
  default_source:
    handle: 'obsidian-fs://my-vault'
    required: true
sinks:
  default_sink:
    handle: '_memory/_briefs'
    required: true
assembly:
  - as: pr
    verb: read_note
    args:
      doc_id: '{{inputs.pr_doc_id}}'
  - as: related
    verb: search_hybrid
    args:
      query: '{{inputs.search_query}}'
      top_k: 20
  - as: compiled
    verb: compile_brief
    args:
      vault: my-vault
      target: '{{inputs.pr_doc_id}}--review'
      source_doc_ids: '{{related.doc_ids}}'
      purpose: 'Code review context for {{pr.title}}'
output_shape:
  type: object
  properties:
    brief_doc_id: { $ref: '#/types/DocId' }
  required: [brief_doc_id]
write_back:
  sink: '{{default_sink}}'
  document_kind: brief
  properties:
    target: '{{inputs.pr_doc_id}}--review'
    source: agent
  body_from: '{{compiled.body}}'
```

### Example 8: Eval scenario shape — `_queries/contracts-meeting-prep.yaml`

```yaml
# evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml
description: meeting-prep contract against Atlas Robotics fixture
scenarios:
  - name: q2-okr-review
    contract: meeting-prep
    inputs:
      meeting_doc_id: 'obsidian-fs://test-vault/meetings/2026-04-15-q2-okr-review.md'
      context_hops: 1
    expected_output_shape:
      brief_doc_id: { type: string, pattern: '^obsidian-fs://test-vault/_memory/_briefs/' }
      cluster_count: { type: integer, minimum: 1 }
    expected_write_back:
      sink: '_memory/_briefs'
      properties_required: [target, source, compiled_from, compiled_at]
```

### Example 9: Stub-parity eval — `_queries/contracts-stub-parity.yaml`

```yaml
# evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml
description: CON-10 stub-parity — same contract, two source handles, same output shape
scenarios:
  - name: meeting-prep-stub-vs-obsidian-fs
    contract: meeting-prep
    inputs:
      meeting_doc_id: 'stub://test-fixture/meeting-1'
      context_hops: 1
    source_overrides:
      default_source: 'stub://test-fixture'
    expected_output_shape_matches:
      reference: meeting-prep-obsidian-fs   # named scenario in contracts-meeting-prep.yaml
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-write Zod from JSON Schema | `z.fromJSONSchema()` | Zod 4 (2025) | Phase 6 input-schema layer is ~10 LOC instead of ~100 |
| `Server.setRequestHandler(ListToolsRequestSchema, ...)` | `McpServer.registerTool(name, config, cb)` | SDK 1.13+ (well before 1.29) | Already adopted in Phase 1 ADP-08; Phase 6 follows |
| Manual `server.notification('notifications/tools/list_changed')` | `McpServer.sendToolListChanged()` | SDK 1.13+ | High-level API; Phase 6 uses this (CONTEXT.md's reference to the low-level API is outdated — both work, but the high-level is preferred) |
| YAML libs that strip comments on parse | `yaml@2.9` `parseDocument` | yaml 2.x (years ago) | Phase 7 Canvas round-trip is feasible because the YAML→JS→YAML cycle preserves comments. Phase 6 only READS contracts; Phase 7 will read-write. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `yaml@2.9` `parseDocument` + `toString()` is byte-equivalent for the three reference contracts | §A / Example 1 | Phase 7 Canvas round-trip is harder; doesn't affect Phase 6 directly (Phase 6 only reads). Mitigated: empirically verified in a one-shot Node REPL — `# top comment`, inline `# comment`, list-item comments all preserved. |
| A2 | `z.fromJSONSchema` honors `additionalProperties: false` when present in the input | Pitfall F2 | Strict validation may not work; typo'd input keys silently pass. Mitigated: the wrapper in `buildInputSchema` sets `additionalProperties: false` explicitly. |
| A3 | `z.fromJSONSchema` silently ignores unknown extension keywords like `x-validator` | §D-A3b / Example 4 | If Zod 4 throws on unknown keywords, the catalog must strip extensions before conversion. Mitigated: testable in one line; if it throws, add a `stripExtensions(jsonSchema)` step in `buildInputSchema`. **VERIFY in plan 06-02.** |
| A4 | `StdioClientTransport.close()` reliably terminates the child process on `Symbol.dispose` | Pitfall F4 | Peer-MCP child zombies on parent crash. Mitigation: register a `SIGTERM` / `SIGINT` handler at server boot to call `peerMcpRegistry.shutdown()` — same pattern as `VaultWatcher.stop()`. |
| A5 | Phase 5's `ChangeFeed` supports a third concurrent subscriber (indexer + Phase 5 daemon + Phase 6 contracts) without contention | Pattern 1 | Fan-out documented in `src/adapters/change-feed/types.ts` and verified in Phase 5 daemon implementation. Low risk. |
| A6 | Adding a new `contract_audit` table via migration 014 is preferable to extending `write_audit` | Open Question Q-AUD | If wrong: schema bloat. If skipped: `write_audit.note_id` foreign key constraint blocks orchestration rows. The CONTEXT.md says "Phase 2 audit_log already exists; this is additive" — but doesn't specify whether to extend or new-table. **PLANNER DECIDE in plan 06-01 ADR.** |
| A7 | The `<vm_prefix><snake_case_name>` slug rule never collides with an existing v1 tool name | §H | Verified by inspection: no v1 tool starts with `vm_`. But user could set `tool_prefix = ""` — at which point a contract named `read-note` would slugify to `read_note` and collide with the v1 `read_note` tool. **Recommendation: validate `tool_prefix` non-empty at config-load time (Zod `.min(1)`)** OR document the collision and rely on D-A1c first-wins. |
| A8 | The `write_back.body_from` resolved value is a string (markdown body) suitable for `DeliveryAdapter.write({body, properties})` | §O / Pitfall F6 | If `compile_brief` returns a structured object instead of a body string, the template resolver needs to handle the object case. Mitigated: `compile_brief` already returns `{body, doc_id, ...}` per Phase 5 — template `{{compiled.body}}` resolves to a string. |
| A9 | The 11-baseline-verb enum dispatcher just calls existing functions (no per-verb adaptation layer needed) | §Architecture | Most verbs have a clean signature already (`search_hybrid(query, opts)`, `compile_brief({vault, target, ...})`). The dispatcher is a `switch` statement with per-verb argument-shape adaptation. Risk: verb signatures may not all use `{vault, ...}` consistently — some take positional `(handle, opts)`. **VERIFY each verb signature in plan 06-04.** |
| A10 | Auto-register `tools/list_changed` works correctly with MCP clients that cache `tools/list` (Claude desktop, Inspector) | §Pattern 4 | If clients don't honor the notification, dynamic registration appears broken from the client side. Spec-compliant per MCP §Tools — but real-client behavior varies. Mitigated: D-A1 default-OFF means most deployments never exercise this path; CON-09 smoketest can manually call `tools/list` after a contract reload to verify server-side correctness. |
| A11 | Migration 014 is the next available migration version (current head is 13) | §N | Verified — `src/db/schema.ts:1022` shows `version: 13`. Phase 6 migration is 14 (if Q-AUD recommends a new table). |

## Open Questions

### Q-AUD: New `contract_audit` table OR extend `write_audit`?

**What we know:**
- `write_audit` is keyed on `note_id INTEGER` (FK to `notes.id`). Orchestration events (`contract_step`, `contract_load_error`) have no `note_id`.
- Phase 5 brief daemon hit this same wall (`daemon_already_owned` event) and chose stderr-only logging because the table shape didn't fit.
- CONTEXT.md says the audit_log extension is "additive: a new `kind: "contract_step"` row and a new query namespace extension."

**What's unclear:** Whether the implementation is (a) add a `kind TEXT` column to `write_audit` + relax `note_id` to nullable, OR (b) add a new `contract_audit` table.

**Recommendation:** **(b) New table.** Reasons: keeps `write_audit` semantics clean (write_audit = note writes, contract_audit = orchestration events). Migration 014 ships `CREATE TABLE contract_audit (id INTEGER PK, kind TEXT, contract TEXT, verb TEXT, step_alias TEXT, vault TEXT, ts INTEGER, error_message TEXT NULL)`. The `list_contract_verbs` Resource aggregates: `SELECT verb, COUNT(*) AS invocation_count, MAX(ts) AS last_seen FROM contract_audit WHERE kind = 'contract_step' GROUP BY verb`.

**Cost if wrong:** ~50 LOC migration written that needs to be rolled back / replaced. Cheap.

### Q-TIMEOUT: Step timeout enforcement mechanism

**What we know:** D-A2a + Claude's discretion lean: `[contracts] step_timeout_seconds = 30`. On timeout: `{ok:false, reason:"assembly_step_failed", step_alias, cause:"timeout"}`. Mostly relevant for peer-MCP verbs (which can hang on slow peer servers).

**What's unclear:** Whether to wrap every step in `Promise.race([fn, timeout])` or just peer-MCP verbs (baseline verbs are local and usually <1s).

**Recommendation:** Wrap **only peer-MCP verbs** in v2.0.0. Baseline verbs are local SQLite/Ollama calls with their own timeout discipline. Wrapping baseline verbs in an extra timeout layer adds latency overhead for no real benefit and creates a flaky-test surface area.

### Q-OUTPUT: `output_shape` validation timing

**What we know:** D-A3a says `output_shape:` is a JSON Schema subset. CON-06 says `instantiate_contract` returns the shaped bundle.

**What's unclear:** Does `output_shape` validate (a) the bundle returned to the caller, or (b) only the `write_back` document, or (c) both? Pitfall F6 argues for (a) + a clear note that intermediate step outputs are advisory.

**Recommendation:** Validate **the bundle returned to the caller**, where bundle = `{steps: {<alias>: <output>}, write_back: {doc_id, sink} | null}`. The YAML author writes `output_shape:` matching the bundle. The `write_back.doc_id` is the ground-truth identifier (from `DeliveryAdapter.write()` response).

### Q-DESCRIBE: `describe_contract` markdown summary template

**What we know:** Recommendation lean: return both `{json_schema, summary}`. Summary is auto-generated markdown.

**What's unclear:** Exact markdown layout.

**Recommendation:** Lean and discoverable:
```markdown
# {name}

{description}

## Inputs
- **meeting_doc_id** (`#/types/DocId`, required): DocId of the meeting note.
- **context_hops** (integer, default 1): How many wikilink hops to expand.

## Sources
- **default_source** → `obsidian-fs://my-vault` (required)

## Sinks
- **default_sink** → `_memory/_briefs` (required MemorySink)

## Assembly
1. **meeting** ← `read_note(doc_id: {{inputs.meeting_doc_id}})`
2. **linked** ← `expand(seed_doc_ids: [{{inputs.meeting_doc_id}}], hops: {{inputs.context_hops}})`
3. **clustered** ← `cluster(seed_doc_ids: {{linked.doc_ids}}, method: edge-community)`
4. **compiled** ← `compile_brief(...)`

## write_back
Writes a brief document to `{{default_sink}}` with body from `{{compiled.body}}`.

## Output Shape
`{brief_doc_id: DocId, cluster_count: integer}`
```

Generated by `src/contracts/describe.ts` from the parsed contract structure. Pure function over `ParsedContract`. No LLM.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `yaml` npm package | Phase 6 contract loader | ✓ | 2.9.0 (verified) | — |
| `zod` (v4) | Input schema validation | ✓ | 4.4.3 (verified) | — |
| `@modelcontextprotocol/sdk` (Client + Server) | Peer-MCP + dynamic tool registration | ✓ | 1.29.x (verified) | — |
| Node `Symbol.dispose` (ES2023) | Disposable lifecycle | ✓ | Node ≥22 | — (target Node ≥22 per `engines.node`) |
| Ollama (`localhost:11434`) | `compile_brief` verb (Phase 5 ladder Tier 2) | (varies) | — | Phase 5 MCP Sampling Tier 1 / `prepared_text` Tier 3 already handle |
| Peer MCP servers (e.g., `gh-mcp-server`) | `mcp://gh/list_issues` style verbs | (user-specific) | — | Contracts that reference unavailable peer verbs fail at instantiation with `verb_not_available` / `mcp_client_unavailable` |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Peer-MCP servers — user-provided per `[contracts.mcp_clients]`, optional. Contracts that don't reference `mcp://` verbs work without any peer-MCP setup.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^2.1.8` (already installed) |
| Config file | none — uses vitest defaults |
| Quick run command | `npx vitest run src/contracts/` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CON-01 | YAML round-trip preserves comments | unit | `npx vitest run src/contracts/schema.test.ts` | ❌ Wave 0 |
| CON-01 | Zod 4 validates parsed contract shape | unit | `npx vitest run src/contracts/schema.test.ts` | ❌ Wave 0 |
| CON-02 | Contracts addressed by `name` (collision is load error) | unit | `npx vitest run src/contracts/registry.test.ts` | ❌ Wave 0 |
| CON-03 | `{{default_source}}` variable handle works | unit | `npx vitest run src/contracts/templates.test.ts` | ❌ Wave 0 |
| CON-04 | `list_contracts` MCP Resource | integration | `npx vitest run src/contracts/resources.test.ts` | ❌ Wave 0 |
| CON-05 | `describe_contract` output shape | unit | `npx vitest run src/contracts/describe.test.ts` | ❌ Wave 0 |
| CON-06 | `instantiate_contract` orchestration | integration | `npx vitest run src/contracts/instantiate.test.ts` | ❌ Wave 0 |
| CON-07 | Three reference contracts validate | integration | `npx vitest run src/contracts/reference-contracts.test.ts` | ❌ Wave 0 |
| CON-08 | Eval scenarios per contract | eval | `npm run eval:baseline` + new `eval:contracts` script | ❌ Wave 0 (new `_queries/contracts-*.yaml`) |
| CON-09 | Non-Claude MCP client proof | smoketest | `node scripts/smoketest-non-claude.mjs` (extended) | ✓ existing file, extend |
| CON-10 | Stub-parity proof | integration | `npx vitest run src/adapters/source/conformance.test.ts` (extended) | ✓ existing file, extend |
| CON-11 | ADR exists | manual | `ls docs/v2/adr/006-task-contract-dsl.md` | ❌ Wave 0 (plan 06-01) |
| CON-12 | `yaml ^2.6` in deps + ADR rationale | manual | `grep '"yaml":' package.json` + `ls docs/v2/adr/006-*` | ✓ `package.json` already has it; ADR rationale lands in 06-01 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/contracts/`
- **Per wave merge:** `npm test && bash scripts/lint-adapters.sh`
- **Phase gate:** `npm run lint:check && npm test && npm run eval:baseline && npm run eval:smoketest`

### Wave 0 Gaps

- [ ] `src/contracts/schema.test.ts` — covers CON-01 (round-trip + Zod schema)
- [ ] `src/contracts/registry.test.ts` — covers CON-02 (name collision)
- [ ] `src/contracts/templates.test.ts` — covers CON-03 + D-A2c (mustache resolver)
- [ ] `src/contracts/json-schema-ref.test.ts` — covers D-A3b ($ref resolver)
- [ ] `src/contracts/input-schema.test.ts` — covers D-A3a (fromJSONSchema + x-validator)
- [ ] `src/contracts/loader.test.ts` — covers D-LOAD (boot scan + ChangeFeed)
- [ ] `src/contracts/mcp-clients.test.ts` — covers D-A2a peer-MCP lifecycle (unit; integration is the smoketest)
- [ ] `src/contracts/verbs/index.test.ts` — covers D-A2a baseline dispatcher
- [ ] `src/contracts/instantiate.test.ts` — covers CON-06 end-to-end orchestration
- [ ] `src/contracts/describe.test.ts` — covers CON-05
- [ ] `src/contracts/resources.test.ts` — covers CON-04 + D-A2b `list_contract_verbs`
- [ ] `src/contracts/auto-register.test.ts` — covers D-A1 dynamic registration + `tools/list_changed`
- [ ] `src/contracts/reference-contracts.test.ts` — covers CON-07
- [ ] `evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml` + tests — covers CON-08
- [ ] `evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml` + tests
- [ ] `evals/fixtures/v2-test-vault/_queries/contracts-code-review-brief.yaml` + tests
- [ ] `evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml` + tests — covers CON-10
- [ ] `evals/fixtures/v2-test-vault/_contracts/` — three reference contracts as YAML
- [ ] Extension to `src/adapters/source/conformance.test.ts` — CON-10 stub-parity assertions
- [ ] Extension to `scripts/smoketest-non-claude.mjs` — covers CON-09

## Security Domain

Phase 6 introduces three new surface areas with security implications. `security_enforcement` config setting is absent (default = enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | MCP is single-user-runtime; no auth in v2 |
| V3 Session Management | no | Stdio transport; per-process session |
| V4 Access Control | partial | MemorySink-only sink invariant (D-A4c) is the ONLY ACL — enforced at `DeliveryAdapter.write()` chokepoint |
| V5 Input Validation | yes | Zod 4 via `z.fromJSONSchema()` validates every `instantiate_contract` input; template resolver rejects unresolved references; override validation strict |
| V6 Cryptography | no | No new crypto in Phase 6 |
| V11 Configuration | yes | Per-vault `[contracts]` block validated by Zod at boot; `[contracts.mcp_clients]` exposes a `command + args` surface that user explicitly authorizes |

### Known Threat Patterns for vault-memory + Phase 6

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| YAML deserialization attack (e.g., billion laughs) | Denial of Service | `yaml@2.9` has built-in depth + alias-count limits; Zod validates parsed structure shape |
| Template injection (user-supplied `{{...}}` in inputs) | Tampering | Template resolver only operates on contract YAML (read at boot, never user-supplied at call time). Inputs are pure values, never re-evaluated as templates. **Document this invariant in ADR 006.** |
| Peer-MCP command injection | Tampering / EoP | `[contracts.mcp_clients.X.command]` is a user-config string, not derived from contract or call inputs. Same trust level as `~/.vault-memory/config.toml` (user-owned). No shell escape needed — `spawn(command, args)` passes args verbatim, no shell. |
| Peer-MCP arbitrary code execution via untrusted contract | EoP | A contract YAML cannot influence WHICH peer MCP server runs — it only references peer-MCP servers by name (`mcp://gh/list_issues`). The name → command mapping lives in user-controlled config. A user must explicitly add `[contracts.mcp_clients.gh]` before any contract can invoke `mcp://gh/*`. |
| Memory-sink bypass via contract | Tampering | THREE structural mechanisms (per CONTEXT specifics): (1) no write verbs in assembly enum; (2) `write_back:` structurally separate; (3) sink validation via MemorySinkRegistry. Same enforcement as direct `record_observation` calls. |
| Audit-log leakage of sensitive verb outputs | Info Disclosure | `contract_audit` row stores `{contract, verb, step_alias, ts, vault}` only — NOT step output payloads. Document in ADR 006. |
| `$ref` to unknown / external URI | Tampering | `json-schema-ref.ts` resolver only accepts `^#/types/(\w+)$` pattern — all other `$ref` forms throw at contract load (cached as `contract_load_error`). No HTTP fetches; no filesystem reads outside the contract YAML itself. |
| Auto-register a malicious `vm_*` tool by editing `_contracts/*.yaml` | EoP | Contract author has filesystem write access to `_contracts/` → they have full vault access already → no privilege escalation possible. Document threat model in ADR 006: contracts are user-authored and trusted at the same level as user notes. |

## Sources

### Primary (HIGH confidence)

- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` (lines 102, 153, 206, 269) — `registerTool`, `registerResource`, `sendToolListChanged`, `inputSchema: AnySchema` accepts Zod 4 schema
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.d.ts` — confirms `AnySchema = z3.ZodTypeAny | z4.$ZodType` (Zod 4 schemas welcome)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts` (lines 155, 431, 539) — `Client.connect`, `callTool`, `listTools`
- `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.d.ts` — `StdioClientTransport({command, args, env})`
- `node_modules/zod/v4/index.d.ts` — `fromJSONSchema`, `toJSONSchema` first-class APIs
- Empirical Node REPL verification (this research session):
  - `yaml@2.9.0` `parseDocument` + `toString()` preserves comments byte-equivalent
  - `z.fromJSONSchema({type:'object', properties:{foo:{type:'string'}}, required:['foo']})` returns `instanceof z.ZodObject === true`
  - `z.fromJSONSchema` correctly rejects type-mismatched inputs
- `src/tool-registry.ts:16-29` — Phase 1 plan literal documented the SDK `inputSchema` constraint (cannot accept raw JSON Schema)
- `src/brief/daemon.ts` — established ChangeFeed handler + Disposable + lock pattern (Phase 6 mirrors)
- `src/brief/resources.ts` — established MCP Resource registration pattern (Phase 6 mirrors for `list_contracts` / `list_contract_verbs`)
- `src/memory/registry.ts:142,190` — `resolveMemorySink` / `findSinkContaining` APIs (D-A4c sink validation)
- `src/adapters/change-feed/types.ts` — `ChangeFeed.subscribe` + `Disposable` contract
- `src/db/schema.ts:1022` — current migration head is version 13 (Phase 6 migration is 14)
- `src/db/queries/audit.ts:83` — current `write_audit` schema is keyed on `note_id INTEGER` (motivates separate `contract_audit` table per Q-AUD)
- `src/memory/contract/loader.ts:236`, `src/adapters/delivery/obsidian-fs/contract-yaml-read.ts:40` — Phase 2 already uses `_contracts/memory/` (motivates Pitfall F3 + Phase 6 top-level scan)
- `scripts/smoketest-non-claude.mjs` — established SDK Client + StdioClientTransport smoketest pattern (CON-09 extends)

### Secondary (MEDIUM confidence)

- `.planning/phases/05-compiled-brief-layer/05-CONTEXT.md` — D-07 daemon lifecycle pattern (Phase 6 mirrors)
- `docs/v2/adr/002-adapter-seams.md` — adapter-seam discipline (CI greps enforce; Phase 6 honors)
- `docs/v2/adr/004-memory-sink-handles.md` — MemorySinkRegistry resolution semantics
- CONTEXT.md §"decisions" — locked design choices

### Tertiary (LOW confidence)

None — every claim in this research is verified against installed source or cited from a HIGH-confidence project doc.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every library verified via `node_modules/` source inspection + REPL execution
- Architecture: HIGH — mirrors established Phase 5 daemon + Phase 2 sink-registry patterns; no novel components
- Pitfalls: HIGH — F1 is documented in Phase 1's code comments; F3 verified by direct grep against existing `_contracts/memory/` usage; F4 is standard child-process hygiene; F7 verified by counting `tools-list.snapshot.json` entries (34)
- Reference contracts (§I / Examples 1, 6, 7): MEDIUM — assembly skeletons drafted against the Atlas Robotics fixture file listing but not verified against actual fixture content. Planner should pick specific fixture documents (e.g., `meetings/2026-04-15-q2-okr-review.md` is real per `ls evals/fixtures/v2-test-vault/meetings/`) and verify the expected `cluster` output before locking the eval scenarios.

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (30 days — Zod, yaml, MCP SDK versions are stable; the only volatility is potential SDK 1.30+ release, which is additive and shouldn't break this plan)
