# Phase 7: vault-memory Obsidian plugin (contract editor + chrome) — Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** ~28 NEW files (grouped) + 4 MODIFIED
**Analogs found:** 18 internal-analog matches, 10 greenfield (external/no-internal-analog)

> Phase 7 is unique: it introduces a NEW top-level `plugin/` package tree that sits outside `src/`. Many plugin-internal files (Svelte components, esbuild config, Obsidian-view classes) have **no internal analog**. For those, this map cites the **external reference pattern** (Obsidian sample plugin / `@xyflow/svelte` upstream) and flags the file as greenfield. Internal analogs are used everywhere they exist — especially for server-side additions (new MCP tools, config extension, suppression hash gate, Zod schema for `.contract`).

---

## File Classification

### New files — server-side (have strong internal analogs)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/contracts/contract-file-schema.ts` (or extend `schema.ts`) — Zod for `.contract` JSON wrapper | Zod schema | data-validation / pure | `src/contracts/schema.ts` (`ContractFileSchema`) | exact |
| `src/plugin-tools/set-runtime-config.ts` (or inline in `server.ts`) | MCP tool handler | request-response | `src/server.ts` `registerTool` loop @ 1701–1742 + `src/contracts/auto-register.ts` gating | exact |
| `src/plugin-tools/resolve-secret.ts` | MCP tool handler | request-response | same as above | exact |
| `src/plugin-tools/set-mcp-client.ts` | MCP tool handler (mutates `~/.vault-memory/config.toml`) | request-response + config write | `src/server.ts` `registerTool` loop; config write pattern is greenfield (no current tool mutates config.toml) | partial |
| `src/plugin-tools/get-runtime-stats.ts` | MCP tool handler OR MCP Resource | request-response (read-only) | `src/server.ts` `registerResource("memory-stats", ...)` @ 1771–1789 | exact |
| `src/plugin-tools/trigger-reindex.ts` | MCP tool handler with progress notifications | streaming / pub-sub | `src/server.ts` `registerTool` + new SDK 1.29 `progressToken` (greenfield for this codebase) | role-match |
| `src/plugin-tools/index.ts` (gate + register) | tool-registry-shim | request-response | `src/contracts/auto-register.ts` (`syncAutoRegistered` — diff-based, gated, idempotent registration) | exact |
| `src/adapters/change-feed/obsidian-fs/suppression.ts` (MODIFY — add hash-keyed overload) | utility | request-response | itself (existing `add(path, ttlMs?)`, `consume(path)`) | self (extend) |
| `src/contracts/loader.ts` (MODIFY — call `suppression.consume(path)` before re-validating) | service | event-driven | itself (`handleChangeEvent` @ 151–200) | self (extend) |
| `src/config/loader.ts` (MODIFY — add `[plugin] enabled` block) | config / Zod | data-validation | itself (existing `ContractsConfigSchema` + `[contracts]` block @ 73–104) | self (extend) |

### New files — plugin/ tree (NO internal analog — greenfield)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `plugin/manifest.json` | Obsidian plugin manifest | config | obsidian-sample-plugin `manifest.json` (external) | **greenfield** |
| `plugin/versions.json` | version → minAppVersion map | config | obsidian-sample-plugin `versions.json` (external) | **greenfield** |
| `plugin/package.json` | npm manifest for plugin sub-package | config | root `package.json` (structural reference) | partial |
| `plugin/tsconfig.json` | TS config extends root | config | root `tsconfig.json` (extends-from target) | role-match |
| `plugin/esbuild.config.mjs` | esbuild bundler config | build-tool | `tsup.config.ts` (different tool, similar shape) | partial |
| `plugin/main.ts` | Obsidian `Plugin` subclass entry point | event-driven (Obsidian lifecycle) | `src/server.ts` `serve()` bootstrap (different framework, similar lifecycle shape) | role-match |
| `plugin/styles.css` | CSS using Obsidian variables | static | none (greenfield CSS) | **greenfield** |
| `plugin/src/views/contract-editor/view.ts` (extends `TextFileView`) | Obsidian view host | event-driven (file lifecycle) | none (Obsidian-specific API) | **greenfield** |
| `plugin/src/views/contract-editor/editor.svelte` + `palette/*`, `canvas/*`, `inspector/*` (Svelte components) | UI components | event-driven (DOM) | none in repo (no prior Svelte code) | **greenfield (cite @xyflow/svelte docs)** |
| `plugin/src/codec/contract-codec.ts` (`.contract` ↔ `.yaml` round-trip) | service | transform | `src/contracts/loader.ts` (uses `parseDocument(yaml)`) — analog for the YAML half only | partial |
| `plugin/src/codec/canonicalize.ts` (D-CANON ordering rules) | utility | transform | none (greenfield — but ADR-006 §Decision 2 prescribes the schema order) | **greenfield (cite ADR-006)** |
| `plugin/src/codec/editor-state-comment.ts` (base64 `# vm-editor-state:` header) | utility | transform | none | **greenfield** |
| `plugin/src/codec/codec.test.ts` (CAN-07 round-trip test) | test | data-validation | `src/contracts/reference-contracts.test.ts` (round-trip YAML validation test) | exact |
| `plugin/src/services/mcp-client.ts` (plugin → server MCP client over stdio) | adapter | request-response | `src/contracts/mcp-clients.ts` (`PeerMcpRegistry` — same SDK Client pattern on the OPPOSITE end of stdio) | exact |
| `plugin/src/chrome/settings-tab.ts` (extends `PluginSettingTab`) | UI / Obsidian-native | request-response | none | **greenfield** |
| `plugin/src/chrome/secrets/*` (safeStorage adapter + UI) | adapter + UI | request-response | none (Electron `safeStorage` is a new external dep) | **greenfield** |
| `plugin/src/chrome/panels/{stats,reindex,connectors}.svelte` | UI panels | request-response | none | **greenfield** |
| `plugin/tests/*` (vitest + minimal Playwright) | test | data-validation | `src/**/*.test.ts` (vitest co-location pattern) | exact |

### New files — examples / docs / skills

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `examples/contracts/meeting-prep.contract` | example data | static | `evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml` (YAML twin — the round-trip baseline) | exact |
| `examples/contracts/project-status.contract` | example data | static | `evals/fixtures/v2-test-vault/_contracts/project-status.yaml` | exact |
| `examples/contracts/code-review-brief.contract` | example data | static | `evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml` | exact |
| `examples/contracts/round-trip.test.ts` | test | data-validation | `src/contracts/reference-contracts.test.ts` | exact |
| `docs/v2/plugin/{INSTALL,SETTINGS,SECRETS,CONTRACT-EDITOR,CONNECTORS}.md` | docs | static | `docs/v2/AGENT_AGNOSTIC.md`, `docs/v2/MEMORY_CONTRACT.md`, `docs/v2/ARCHITECTURE.md` (project doc tone + structure) | partial (tone) |
| `docs/v2/adr/007-contract-editor.md` (NEW ADR — written by spike) | ADR | static | `docs/v2/adr/006-task-contract-dsl.md` (most recent ADR, established sections) | exact |
| `skills/vm-install/SKILL.md` | skill manifest | static | `skills/install-vault-memory/SKILL.md` | exact |
| `skills/vm-update/SKILL.md` | skill manifest | static | `skills/install-vault-memory/SKILL.md` | role-match (no update-skill precedent) |

---

## Pattern Assignments

### `src/contracts/contract-file-schema.ts` — Zod for the `.contract` JSON wrapper

**Analog:** `src/contracts/schema.ts` (Phase 6 `ContractFileSchema`)

**Imports + module-doc pattern** (lines 1-23):
```typescript
/**
 * ContractFileSchema — Phase 6 / CON-01, ADR-006 §Decision 2.
 *
 * Zod schema for the YAML contract file shape. ...
 *
 * Invariants enforced structurally:
 *   - C-1: closed `assembly[].verb` set ...
 *   - Step aliases are unique across the assembly array (superRefine).
 *   - `version: 1` is the only supported version in v2.0.0 ...
 *
 * Adapter-seam discipline: only `zod`. Zero `fs`/`path.join`/`gray-matter`/
 * `chokidar`/`yaml`.
 */

import { z } from "zod";
```

**Closed-enum + regex-extension pattern** (lines 25-48):
```typescript
const BASELINE_VERBS = [...] as const;
const MCP_VERB_RE = /^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/;
const VerbSchema = z.union([
  z.enum([...BASELINE_VERBS, "literal"]),
  z.string().regex(MCP_VERB_RE),
]);
```

**`.describe()` on every public field + `superRefine` for cross-field invariants** (lines 89-121):
```typescript
export const ContractFileSchema = z
  .object({
    version: z.literal(1).describe("v2.0.0 supports version 1 only; v2.x may extend additively"),
    name: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, "name must be kebab-case")...,
    ...
  })
  .superRefine((data, ctx) => {
    const aliases = new Set<string>();
    for (const step of data.assembly) {
      if (aliases.has(step.as)) {
        ctx.addIssue({ code: "custom", path: ["assembly"], message: `duplicate step alias '${step.as}'` });
      }
      aliases.add(step.as);
    }
  });

export type ContractFileShape = z.infer<typeof ContractFileSchema>;
```

**Copy for `.contract`:** wrap the existing `ContractFileSchema` inside a `ContractDocumentSchema`:

```typescript
export const ContractDocumentSchema = z.object({
  $schema: z.literal("https://vault-memory.dev/schemas/contract-v1.json").optional(),
  vmFormatVersion: z.literal(1),
  contract: ContractFileSchema,           // ← reused verbatim
  editor: EditorStateSchema,
});
```

Reuse `ContractFileSchema` BYREF — do not re-declare. The plugin imports from `src/contracts/schema.ts`.

---

### Plugin-control MCP tools (`set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats`, `trigger_reindex`)

**Analog 1 — gating pattern:** `src/contracts/auto-register.ts` (lines 67-117)

The `[plugin] enabled` gate follows the exact shape as Phase 6's `auto_register_tools` gate:

```typescript
export function syncAutoRegistered(
  server: McpServer,
  registry: ContractRegistry,
  prefix: string,
  registered: Map<string, RegisteredTool>,
  opts: SyncAutoRegisteredOpts,
): void {
  if (!opts.enabled) return;       // ← DEFAULT-OFF GATE

  // Build the desired set, diff against registered, add/remove,
  // and fire sendToolListChanged() exactly ONCE if any mutation happened.
  ...
  if (mutated) server.sendToolListChanged();
}
```

Phase 7 should expose a `syncPluginTools(server, opts)` that takes `opts.enabled = config.plugin?.enabled ?? false` and registers/removes the 3-5 plugin tools. Same idempotent diff shape so the call site can re-run on config reload.

**Analog 2 — tool handler shape:** `src/server.ts` lines 1701-1742 (the `for (const tool of TOOLS)` loop)

```typescript
for (const tool of TOOLS) {
  const name = tool.name as ToolName;
  const handler = handlers[name];
  const schema = TOOL_SCHEMAS[name];
  const needsRefinementCheck = name === "suggest_frontmatter" || name === "cluster";
  server.registerTool(
    name,
    { description: tool.description, inputSchema: schema },
    async (args: unknown) => {
      try {
        let validated: unknown = args;
        if (needsRefinementCheck) {
          validated = buildToolSchema(name).parse(args);
        }
        const data = await handler(validated);
        return ok(data);
      } catch (err) {
        if (err instanceof DocNotFoundError) {
          return errorResponseJson({ error: "doc_not_found", doc_id: err.doc_id });
        }
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(message);
      }
    },
  );
}
```

Each new tool gets a `description`, a Zod `inputSchema` declared as a raw-shape object (SDK 1.29 requirement — Pitfall F1 of Phase 6), and an async handler. Wrap with `ok(data)` / `errorResponse(message)` for consistent response shape.

**Analog 3 — Resource handler (for `get_runtime_stats` if planner picks Resource over Tool):** `src/server.ts` lines 1771-1789

```typescript
server.registerResource(
  "memory-stats",
  RESOURCE_URI_MEMORY_STATS,
  {
    title: "Memory sink stats",
    description: "Per-sink document counts, ...",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify(readMemoryStats(memorySinkRegistry, manager), null, 2),
    }],
  }),
);
```

Phase 7 stats Resource URI would be `vault-memory://stats/{vault}` per CONTEXT §"MCP Resources for read-only enumeration". Same registration shape.

---

### `src/config/loader.ts` (MODIFY — add `[plugin]` block)

**Analog:** itself — the existing `[contracts]` block @ lines 73-112 is the template.

**Existing `[contracts]` block** (lines 73-112):
```typescript
const ContractsConfigSchema = z.object({
  auto_register_tools: z
    .boolean()
    .default(false)
    .describe("D-A1b — per-vault gate for auto-registering contracts as MCP Tools"),
  tool_prefix: z.string().min(1).regex(/^[a-z_][a-z0-9_]*$/).default("vm_")...,
  ...
});

const DEFAULT_CONTRACTS_CONFIG = {
  auto_register_tools: false,
  tool_prefix: "vm_",
  ...
} as const;

const AppConfigSchema = z.object({
  ...
  contracts: ContractsConfigSchema.optional().default(DEFAULT_CONTRACTS_CONFIG),
});
```

**Apply for `[plugin]`:**
```typescript
const PluginConfigSchema = z.object({
  enabled: z.boolean().default(false).describe(
    "D-MCP-SURFACE — gates the 3-5 plugin-control MCP tools (set_runtime_config, resolve_secret, set_mcp_client, get_runtime_stats, trigger_reindex). Default OFF preserves v1 tools-list snapshot stability."
  ),
});

const DEFAULT_PLUGIN_CONFIG = { enabled: false } as const;

// Append to AppConfigSchema:
plugin: PluginConfigSchema.optional().default(DEFAULT_PLUGIN_CONFIG),
```

Backwards-compat invariant: configs without `[plugin]` parse identically (defaults apply).

---

### `src/adapters/change-feed/obsidian-fs/suppression.ts` (MODIFY — add hash-keyed overload)

**Analog:** itself.

**Existing API** (lines 32-52):
```typescript
add(path: string, ttlMs?: number): void {
  this.prune();
  const ttl = ttlMs ?? this.defaultTtlMs;
  this.entries.set(path, { expiresAt: this.now() + ttl });
}

consume(path: string): boolean {
  this.prune();
  const entry = this.entries.get(path);
  if (!entry) return false;
  if (entry.expiresAt <= this.now()) {
    this.entries.delete(path);
    return false;
  }
  this.entries.delete(path);
  return true;
}
```

**RESEARCH §6 prescribes** extending `Entry` with optional `hash?: string` and overloading `add`/`consume` to accept hash; existing call sites stay path-only. CONTEXT names the new APIs `suppress(path, hash)` / `matches(path, hash)` — planner picks names but the construction is additive (optional second argument, keeps old call sites working).

Minimal change shape:
```typescript
interface Entry {
  expiresAt: number;
  hash?: string;     // NEW
}

add(path: string, opts?: { ttlMs?: number; hash?: string }): void {
  ...
  this.entries.set(path, { expiresAt: this.now() + ttl, hash: opts?.hash });
}

consume(path: string, hash?: string): boolean {
  ...
  if (hash !== undefined && entry.hash !== undefined && entry.hash !== hash) {
    return false;   // hash mismatch = legitimate second edit, do not suppress
  }
  ...
}
```

---

### `src/contracts/loader.ts` (MODIFY — wire `suppression.consume` into ChangeFeed handler)

**Analog:** itself — `handleChangeEvent` at lines 151-200.

**Current shape** (lines 184-199):
```typescript
case "create":
case "update": {
  if (event.kind === "update") {
    deleteByFile(resource, registry, fileToName, opts);
  }
  const ok = await loadFromFeed(
    event.id,
    resource,
    opts,
    registry,
    fileToName,
  );
  if (ok) opts.onRegistryChange?.(event.kind);
  return;
}
```

**Phase 7 amendment** — RESEARCH "Finding 3": Phase 6 does NOT currently call `suppression.consume()`. Add a `suppression: SuppressionSet` to `StartContractRegistryOpts` and check it BEFORE reloading:

```typescript
case "create":
case "update": {
  // CAN-08 — skip events the plugin produced (hash matches).
  // hash for the YAML body is computed by the plugin BEFORE writing.
  if (opts.suppression?.consume(resource, eventHash)) {
    return;   // echo suppressed, skip reload
  }
  if (event.kind === "update") deleteByFile(...);
  ...
}
```

The `eventHash` extraction step is greenfield — the loader needs to read the YAML body and hash it (or read the plugin's pre-write hash from suppression entry semantics). RESEARCH §6 documents both approaches.

---

### `plugin/main.ts` — Obsidian `Plugin` entry point

**Analog:** `src/server.ts` `serve()` bootstrap (different framework, similar lifecycle).

**`serve()` lifecycle pattern** (excerpts from `src/server.ts` lines 391-466):
```typescript
// Signal handlers wired to shutdown
process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });

// Build server with capability declaration
const server = new McpServer(
  { name: "vault-memory", version: VERSION },
  { capabilities: { tools: {}, resources: {} } },
);

// Open vaults, build registries, register tools/resources
const contractRegistries = new Map<...>();
const peerMcpRegistry = new PeerMcpRegistry();
...
// Wire tools through `server.registerTool(...)` in a loop
// Wire resources through `server.registerResource(...)`
// Connect transport last
```

**Map to Obsidian plugin shape:**

```typescript
import { Plugin } from "obsidian";

export default class VaultMemoryPlugin extends Plugin {
  async onload() {
    // 1. Load settings (analog: loadConfig)
    await this.loadSettings();

    // 2. Construct services (analog: PeerMcpRegistry, ContractRegistry)
    this.mcpClient = new VaultMemoryMcpClient(...);
    await this.mcpClient.connect();

    // 3. Register view + extension (analog: registerTool loop)
    this.registerView(VIEW_TYPE_CONTRACT_EDITOR, (leaf) => new ContractEditorView(leaf, this));
    this.registerExtensions(["contract"], VIEW_TYPE_CONTRACT_EDITOR);

    // 4. Register settings tab (analog: registerResource)
    this.addSettingTab(new VaultMemorySettingsTab(this.app, this));
  }

  async onunload() {
    // Shutdown handler (analog: SIGTERM handler)
    await this.mcpClient?.[Symbol.dispose]();
  }
}
```

**Greenfield notes:** `Plugin`, `registerView`, `registerExtensions`, `addSettingTab` are Obsidian-only APIs — no internal analog. Cite obsidian-sample-plugin (`github.com/obsidianmd/obsidian-sample-plugin`) as the external reference.

---

### `plugin/src/services/mcp-client.ts` — Plugin's MCP client over stdio

**Analog:** `src/contracts/mcp-clients.ts` (`PeerMcpRegistry`) — the SAME `@modelcontextprotocol/sdk` Client class, used on the opposite end of stdio.

**Pattern from `mcp-clients.ts` lines 48-82**:
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface PeerMcpClient {
  callTool(name: string, args: unknown): Promise<unknown>;
  available: boolean;
  [Symbol.dispose](): void;
}

export type ClientFactory = (
  cfg: PeerMcpClientConfig,
) => Promise<{ client: Pick<Client, "callTool">; transport: { close(): void } }>;

export class PeerMcpRegistry {
  private clients = new Map<string, PeerMcpClient>();
  ...
  async start(configs: Record<string, PeerMcpClientConfig>): Promise<void> {
    for (const [name, cfg] of Object.entries(configs)) {
      try {
        const { client, transport } = this.clientFactory
          ? await this.clientFactory(cfg)
          : await this.defaultConnect(cfg);
        this.clients.set(name, wrapAvailable(client, transport));
      } catch (err) { ... }
    }
  }
}
```

**Copy for plugin:** single Client (not a registry) connecting to ONE local `vault-memory serve` over stdio:
```typescript
const transport = new StdioClientTransport({
  command: "vault-memory",
  args: ["serve"],
});
const client = new Client({ name: "vault-memory-plugin", version: "..." }, { capabilities: {} });
await client.connect(transport);

// Plugin uses `client.callTool({ name: "set_runtime_config", arguments: {...} })`
// and subscribes to `notifications/contracts/reloaded` for D-WATCH-SERVER-NOTIFY.
```

**Greenfield aspect:** the envelope-peeling helper in `mcp-clients.ts` (lines ~95-130, not shown) is reusable — copy that pattern to unwrap `{content: [{type:"text", text: "{...json...}"}]}` → parsed object.

---

### `plugin/src/codec/codec.test.ts` and `examples/contracts/round-trip.test.ts` — CAN-07 round-trip

**Analog:** `src/contracts/reference-contracts.test.ts`

**Existing round-trip test pattern** (lines 22-50):
```typescript
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { ContractFileSchema } from "./schema.js";

const FIXTURES = [
  "evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml",
  "evals/fixtures/v2-test-vault/_contracts/project-status.yaml",
  "evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml",
  "evals/fixtures/v2-test-vault/_contracts/smoketest-trivial.yaml",
];

describe("reference contracts (CON-07)", () => {
  for (const path of FIXTURES) {
    it(`validates: ${path}`, async () => {
      const text = await readFile(path, "utf8");
      const doc = parseDocument(text);
      const raw = doc.toJS() as unknown;
      const validated = ContractFileSchema.safeParse(raw);
      if (!validated.success) {
        throw new Error(
          `ContractFileSchema rejected ${path}: ${JSON.stringify(validated.error.format(), null, 2)}`,
        );
      }
      expect(validated.success).toBe(true);
    });
  }
});
```

**Copy for CAN-07 round-trip:**
- Iterate the same 3 (or 4) reference contracts.
- For each: `readFile yaml` → `parseDocument` → emit `.contract` JSON → emit YAML via the new codec → `parseDocument(emitted)` → assert `deepEqual` against original parse, AND assert the editor-state comment block survives.
- The `readFile` + `parseDocument` boilerplate is identical. The added assertions are the new layer.

**Lint carve-out:** `node:fs/promises` IS permitted in `*.test.ts` files per the comment at lines 19-23 of the analog file.

---

### `examples/contracts/{meeting-prep,project-status,code-review-brief}.contract`

**Analog:** `evals/fixtures/v2-test-vault/_contracts/{meeting-prep,project-status,code-review-brief}.yaml`

Direct twins. The `.contract` JSON wraps the same Phase 6 ContractFileSchema-validated content with the `vmFormatVersion: 1` + `editor` block per D-FORMAT-SCHEMA. Use the YAML fixtures as the round-trip baseline — the test scaffold above proves they survive the cycle.

---

### `docs/v2/adr/007-contract-editor.md` (NEW ADR)

**Analog:** `docs/v2/adr/006-task-contract-dsl.md`

**Top-of-file metadata pattern** (ADR-006 lines 1-9):
```markdown
# ADR-007 — Contract Editor (Obsidian plugin + `.contract` JSON format)

**Status:** Accepted
**Phase:** 7 — vault-memory Obsidian plugin
**Supersedes:** none
**Superseded by:** none
**Related:** ADR-001 (document identity), ADR-002 (adapter seams), ADR-003 (document shape), ADR-006 (task contract DSL).
```

**Section structure to mirror** (from ADR-006):
1. `## Context` — link back to PROJECT.md + Phase 7 brief.
2. `## Decision: <name>` — one section per CONTEXT.md D-* decision (D-UI, D-SURFACE, D-FORMAT, D-FORMAT-SCHEMA, D-FORMAT2, D-AUTH, D-CANON, D-WATCH-PLUGIN-OUT, D-WATCH-SERVER-NOTIFY, D-MCP-SURFACE).
3. `## Threat Model` — including the per-device `safeStorage` posture rationale and the `[plugin] enabled` default-OFF gate.
4. `## Pitfalls` — including the jsoncanvas-fork rescope (RESEARCH §3) and the suppression API extension (RESEARCH §6).

---

### `docs/v2/plugin/{INSTALL,SETTINGS,SECRETS,CONTRACT-EDITOR,CONNECTORS}.md`

**Analog:** `docs/v2/AGENT_AGNOSTIC.md` (project doc tone — terse, technical, second-person).

These five docs share the same target reader (a vault-memory user setting up the plugin) and tone. Cite the AGENT_AGNOSTIC.md voice register — no marketing language, no "easily" / "simply" / "just". Match the existing project doc structure: a one-paragraph What/Why opener, a feature-by-feature table or list, then specific gotchas/known-limitations sections.

---

### `skills/vm-install/SKILL.md`, `skills/vm-update/SKILL.md`

**Analog:** `skills/install-vault-memory/SKILL.md` (in-repo skill that already exists)

**Front-matter pattern** (existing skill lines 1-4):
```markdown
---
name: install-vault-memory
description: One-call installer for vault-memory in an Obsidian vault. ... Use when the user says "/install-vault-memory", "install vault-memory", "set up memory", "Memory aktivieren", or when the mcp__vault-memory__* tools are missing in the current session.
---
```

**Body structure** (skill lines 5-80):
- `## When to invoke` — list trigger phrases.
- `## What this skill does` — table of idempotent checkpoints.
- `## Autonomous mode (default)` — when to ask vs auto-apply.
- `## How to execute` — single `bash` invocation of `setup.sh`.
- `## Implementation files` — list the scripts the skill ships.
- `## Idempotency contract` — running twice must be safe.

**Copy for `vm-install`:** apply the same 7-checkpoint shape. Checkpoints differ (download from GitHub Releases → extract to `.obsidian/plugins/vault-memory/` → write `manifest.json` enabled-state → prompt user to enable in Obsidian) but the skill SKILL.md shape is identical. The shipped `setup.sh` is greenfield (no analog for the GitHub Releases tarball flow), but the SKILL.md front-matter + section structure is exact-match.

**Naming note:** the analog skill is `install-vault-memory`. Phase 7 D-SKILL-NAMING locks the new convention as `vm-install` / `vm-update`. The OLD skill stays at its current name (no rename — that would break existing user invocations). The new skills sit alongside it under the new prefix.

---

### Plugin tree (Svelte/canvas/inspector components) — GREENFIELD

| File group | Status | External reference |
|------------|--------|-------------------|
| `plugin/src/views/contract-editor/editor.svelte` (three-pane root) | greenfield | obsidian-sample-plugin + @xyflow/svelte tutorial |
| `plugin/src/views/contract-editor/canvas/*` (Svelte Flow wrapper + custom `StepNode.svelte`) | greenfield | `@xyflow/svelte` docs at svelteflow.dev; the "custom node" tutorial |
| `plugin/src/views/contract-editor/palette/*` (5 sections) | greenfield | none |
| `plugin/src/views/contract-editor/inspector/*` (`ZodForm.svelte`, `AliasPicker.svelte`, etc.) | greenfield | Zod 4 `.toJSONSchema()` + hand-rolled Svelte form generator (~150 LOC per RESEARCH §5) |
| `plugin/esbuild.config.mjs` | greenfield | obsidian-sample-plugin `esbuild.config.mjs` (external) |
| `plugin/styles.css` | greenfield | Obsidian CSS variables (`--background-primary`, `--interactive-accent`, ...) per UI-SPEC |

**No internal analog exists for Svelte components, Obsidian plugin scaffolding, or the canvas renderer.** Spike (plan 07-spike, CAN-10) authors the first one (`canvas/canvas-pane.svelte` + `StepNode.svelte`) end-to-end against `meeting-prep.contract`, and subsequent component plans copy from that spike-deliverable.

---

## Shared Patterns (cross-cutting)

### Pattern A — Adapter-seam discipline

**Source:** `src/contracts/schema.ts` doc-block lines 18-21, `src/contracts/auto-register.ts` doc-block lines 30-34

**Apply to:** every NEW server-side file in `src/plugin-tools/*` and the modified `src/contracts/loader.ts`.

```typescript
/**
 * # Adapter-seam discipline
 *
 * Imports only `@modelcontextprotocol/sdk` types + Plan 06-01 modules.
 * Zero `fs` / `path` / `yaml` / `chokidar`.
 */
```

**Plugin caveat:** `plugin/**` is OUTSIDE `src/` and therefore NOT bound by the adapter-seam lint rule (`scripts/lint-adapters.sh`). But the plugin SHOULD NOT touch the vault's `_contracts/` directory via Node `fs` — it MUST go through `app.vault.adapter.write(...)` (Obsidian's own adapter — that IS the plugin's adapter seam). RESEARCH §"Architectural Responsibility Map" line "Plugin↔Server transport" confirms.

### Pattern B — Default-OFF config gating for new MCP surface

**Source:** `src/contracts/auto-register.ts` lines 67-74

```typescript
export function syncAutoRegistered(...) {
  if (!opts.enabled) return;
  ...
  if (mutated) server.sendToolListChanged();
}
```

**Apply to:** the new plugin-control tool registration in `src/plugin-tools/index.ts`. Same shape: read `config.plugin?.enabled ?? false`, no-op when false, emit `sendToolListChanged()` once if the gate flips on/off mid-session.

This is the structural mechanism that keeps `evals/v1-baseline/tools-list.snapshot.json` byte-stable for non-plugin deployments (Phase 8 REL-08 ≤32-tool budget).

### Pattern C — Zod schema documentation

**Source:** `src/contracts/schema.ts` lines 50-87 (every field uses `.describe(...)`)

**Apply to:** the new `[plugin]` config block in `src/config/loader.ts`, the `ContractDocumentSchema` in `src/contracts/contract-file-schema.ts`, and every plugin-control tool's `inputSchema`.

```typescript
z.boolean()
  .default(false)
  .describe(
    "D-MCP-SURFACE — gates the 3-5 plugin-control MCP tools..."
  )
```

**Rationale:** the `.describe()` strings flow through into MCP `tools/list` output as field documentation, so they double as user-facing docs for the plugin-control tools.

### Pattern D — MCP tool error wrapping (`ok()` / `errorResponse()`)

**Source:** `src/server.ts` lines 1721-1740

```typescript
async (args: unknown) => {
  try {
    const data = await handler(validated);
    return ok(data);
  } catch (err) {
    if (err instanceof DocNotFoundError) {
      return errorResponseJson({ error: "doc_not_found", doc_id: err.doc_id });
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message);
  }
}
```

**Apply to:** every plugin-control tool handler. Plus new structured error classes (e.g., `SecretNotFoundError` → `errorResponseJson({error: "secret_not_found", name: secret.name})`) — analog: `DocNotFoundError` shape.

### Pattern E — Vitest co-location

**Source:** repository-wide convention — every `*.ts` under `src/` has a co-located `*.test.ts` (e.g., `schema.ts` + `schema.test.ts`).

**Apply to:** every NEW file in `src/plugin-tools/*` and every NEW file under `plugin/src/codec/*` and `plugin/src/services/*`. Component tests for Svelte files (`plugin/src/views/contract-editor/canvas/StepNode.test.ts`) follow the same pattern but require a Svelte test setup (greenfield — RESEARCH §11 references Playwright for the editor view).

### Pattern F — File-header module doc-block

**Source:** every existing module in `src/contracts/*` opens with a `/** Name — Phase N / Reference, ADR-NNN. ... # section. ... */` block (e.g., `auto-register.ts` lines 1-34, `schema.ts` lines 1-21, `loader.ts` lines 1-38, `mcp-clients.ts` lines 1-46).

**Apply to:** every NEW server-side file in Phase 7. The pattern is:
1. One-line summary referencing the CONTEXT decision ID (`D-MCP-SURFACE`, `D-WATCH-PLUGIN-OUT`, etc.) and the ADR (ADR-007).
2. A `# Adapter-seam discipline` section near the end declaring what the file does NOT import.
3. Optional inline `# Q-*` / `# Pitfall F*` references when the file relates to a documented Q-* or Pitfall.

---

## No Internal Analog — Greenfield Files (cite external references in plans)

Files with no close internal match. Planner uses RESEARCH.md patterns + named external sources:

| File | Role | External reference (cite in plan) |
|------|------|-----------------------------------|
| `plugin/manifest.json`, `plugin/versions.json` | Obsidian metadata | obsidian-sample-plugin |
| `plugin/main.ts` (Plugin lifecycle) | greenfield | obsidian-sample-plugin `main.ts`; Obsidian Plugin API docs |
| `plugin/esbuild.config.mjs` | greenfield | obsidian-sample-plugin `esbuild.config.mjs` |
| `plugin/src/views/contract-editor/view.ts` (TextFileView) | greenfield | Obsidian `TextFileView` lifecycle docs (`getViewData` / `setViewData` / `requestSave`) |
| `plugin/src/views/contract-editor/canvas/canvas-pane.svelte` | greenfield | `@xyflow/svelte` 1.5.2 docs + "custom node" tutorial at svelteflow.dev |
| `plugin/src/views/contract-editor/canvas/StepNode.svelte` | greenfield | same |
| `plugin/src/views/contract-editor/inspector/zod-to-form.ts` | greenfield | Zod 4 `.toJSONSchema()` API; ~150 LOC hand-rolled walker per RESEARCH §5 |
| `plugin/src/views/contract-editor/inspector/AliasPicker.svelte` | greenfield | Phase 6 `list_contract_verbs` Resource (CONTEXT integration point); typeahead UX is custom |
| `plugin/src/chrome/secrets/safe-storage.ts` | greenfield | Electron `safeStorage` API (`encryptString` / `decryptString`); RESEARCH §12 documents the per-device semantics |
| `plugin/src/codec/canonicalize.ts` (D-CANON ordering) | greenfield | ADR-006 §Decision 2 schema field-order spec |
| `plugin/src/codec/editor-state-comment.ts` | greenfield | D-FORMAT2 base64 spec in CONTEXT.md |
| `plugin/styles.css` | greenfield | UI-SPEC §"Design System" (Obsidian CSS variable list) |
| `skills/vm-install/setup.sh` (the actual installer script) | partial | `skills/install-vault-memory/setup.sh` (existing 8-checkpoint shell installer); the GitHub-Releases tarball flow is the new bit |
| `skills/vm-update/setup.sh` | partial | Same — no precedent for plugin update; but the checkpoint discipline mirrors existing skill |
| `docs/v2/plugin/*.md` (5 files) | partial | `docs/v2/AGENT_AGNOSTIC.md` for tone; structure is per-document |

---

## Metadata

**Analog search scope:**
- `src/contracts/**` — Phase 6 outputs (8 files read; 4 cited as primary analogs)
- `src/config/loader.ts` — config extension pattern
- `src/adapters/change-feed/obsidian-fs/suppression.ts` — CAN-08 reuse target
- `src/server.ts` — tool/resource registration (lines 450-466, 1700-1789)
- `skills/install-vault-memory/SKILL.md` — skill manifest analog
- `evals/fixtures/v2-test-vault/_contracts/*.yaml` — round-trip baseline
- `docs/v2/adr/006-task-contract-dsl.md` — ADR-007 structural template
- `docs/v2/AGENT_AGNOSTIC.md` — plugin doc tone reference

**Files scanned:** ~25 (read or grepped)
**Analogs cited:** 14 internal files (with line ranges), 6 external references
**Pattern extraction date:** 2026-05-19

---

## PATTERN MAPPING COMPLETE
