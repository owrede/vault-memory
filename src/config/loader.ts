/**
 * Configuration loader.
 *
 * Reads `~/.vault-memory/config.toml`. Returns sensible defaults when the
 * file does not exist (empty vault list, default Ollama endpoint). Validates
 * shape with Zod.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { AppConfig } from "../types.js";

const ServerConfigSchema = z.object({
  log_level: z.enum(["debug", "info", "warn", "error"]).optional(),
  ollama_endpoint: z.string().url().optional(),
  default_embedding_model: z.string().optional(),
  reranker_model: z.string().optional(),
  reranker_backend: z.enum(["onnx", "ollama"]).optional(),
  reranker_model_dir: z.string().optional(),
});

const VaultConfigSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  embedding_model: z.string().optional(),
  secondary_embedding_model: z.string().optional(),
  write_enabled: z.boolean().optional(),
  exclude_globs: z.array(z.string()).optional(),
});

/**
 * Phase 5 / D-10 ladder tier 2: per-vault Ollama brief-compile config.
 *
 * `[brief.ollama] model = "..."` opts the vault into Tier 2 of the
 * capability-first LLM ladder. The MCP Sampling tier (Tier 1) is
 * checked first per-call; this block is only consulted when Sampling
 * is not available. Strictly localhost (existing OllamaClient binds
 * to `http://localhost:11434`).
 *
 * Schema is OPTIONAL: backwards-compatible. Existing v1.x configs
 * without `[brief]` still parse identically; the ladder simply
 * skips Tier 2 and tries Tier 3 (`prepared_text`) → Tier 4
 * (structured error). See ADR-005 §"Capability-first LLM ladder".
 */
const BriefOllamaConfigSchema = z.object({
  model: z.string().min(1),
});
const BriefConfigSchema = z.object({
  ollama: BriefOllamaConfigSchema.optional(),
});

/**
 * Phase 6 / ADR-006 §Decision 1: `[contracts]` block (per-vault gate).
 *
 * Backwards-compatible: a config.toml with no `[contracts]` block parses
 * to the documented defaults via `.optional().default(...)` at the
 * AppConfigSchema attach site.
 *
 * Trust scope (T-06-01-04 disposition: accept): `mcp_clients.<name>.command`
 * is the same trust level as the rest of `~/.vault-memory/config.toml`
 * (user-owned). Plan 06-03 uses `child_process.spawn(command, args)` with
 * NO shell — args pass verbatim. Documented in ADR-006 §Threat Model.
 */
const ContractsMcpClientConfigSchema = z.object({
  command: z.string().min(1).describe("Peer MCP server executable path"),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const ContractsConfigSchema = z.object({
  auto_register_tools: z
    .boolean()
    .default(false)
    .describe(
      "D-A1b — per-vault gate for auto-registering contracts as MCP Tools",
    ),
  tool_prefix: z
    .string()
    .min(1)
    .regex(/^[a-z_][a-z0-9_]*$/)
    .default("vm_")
    .describe(
      "D-A1c — slug prefix for auto-registered tool names; A7 enforces non-empty",
    ),
  step_timeout_seconds: z
    .number()
    .int()
    .positive()
    .default(30)
    .describe(
      "Q-TIMEOUT — applied only to peer-MCP verbs (baseline verbs use their own discipline)",
    ),
  defaults: z
    .record(z.string(), z.string())
    .default({})
    .describe("D-A4b — default chain step 2: handle → URI fallback"),
  mcp_clients: z
    .record(z.string(), ContractsMcpClientConfigSchema)
    .default({})
    .describe("D-A2a — peer MCP clients vault-memory connects to as an MCP client"),
});

const DEFAULT_CONTRACTS_CONFIG = {
  auto_register_tools: false,
  tool_prefix: "vm_",
  step_timeout_seconds: 30,
  defaults: {},
  mcp_clients: {},
} as const;

/**
 * Phase 7 / Plan 07-04 / D-MCP-SURFACE: `[plugin]` block.
 *
 * Single field for v2.0.0: `enabled` — gates the five plugin-control MCP tools
 * (`set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats`,
 * `trigger_reindex`). Default OFF preserves v1 tools-list snapshot stability
 * (REL-08 ≤32-tool budget for non-plugin deployments).
 *
 * Backwards-compatible: configs without `[plugin]` resolve to
 * `DEFAULT_PLUGIN_CONFIG` via `.optional().default(...)` at the AppConfigSchema
 * attach site.
 */
const PluginConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(false)
    .describe(
      "D-MCP-SURFACE — gates the 5 plugin-control MCP tools (set_runtime_config, resolve_secret, set_mcp_client, get_runtime_stats, trigger_reindex). Default OFF preserves v1 tools-list snapshot stability per REL-08.",
    ),
});

const DEFAULT_PLUGIN_CONFIG = { enabled: false } as const;

// Phase 2: optional [memory] and [[memory_sinks]] blocks.
//
// The handle string is intentionally NOT validated against
// MEMORY_SINK_HANDLE_PATTERN here — the brand-cast (and resulting
// throw on malformed input) happens in `MemorySinkRegistry`. Keeping
// the config loader free of `src/memory/*` imports preserves the
// ADR-002 layering (config is infrastructure; memory is a domain
// module that depends on config, not the other way around).
const MemorySinkConfigSchema = z.object({
  name: z.string().min(1),
  handle: z.string().min(1),
  contract: z.string().min(1).default("default-memory-v1"),
});

const MemoryConfigSchema = z.object({
  default_sink: z.string().min(1).optional(),
});

const AppConfigSchema = z.object({
  server: ServerConfigSchema.optional().default({}),
  vaults: z.array(VaultConfigSchema).optional().default([]),
  memory: MemoryConfigSchema.optional(),
  memory_sinks: z.array(MemorySinkConfigSchema).optional().default([]),
  // Phase 5 / D-10 tier 2 (ADR-005). Backwards-compatible: existing
  // configs without `[brief]` parse identically.
  brief: BriefConfigSchema.optional(),
  // Phase 6 / ADR-006 §Decision 1. Backwards-compatible: configs without
  // `[contracts]` resolve to DEFAULT_CONTRACTS_CONFIG.
  contracts: ContractsConfigSchema.optional().default(DEFAULT_CONTRACTS_CONFIG),
  // Phase 7 / Plan 07-04 / D-MCP-SURFACE. Backwards-compatible: configs
  // without `[plugin]` resolve to DEFAULT_PLUGIN_CONFIG (enabled: false).
  plugin: PluginConfigSchema.optional().default(DEFAULT_PLUGIN_CONFIG),
});

const DEFAULT_CONFIG: AppConfig = {
  server: {
    log_level: "info",
    ollama_endpoint: "http://localhost:11434",
    default_embedding_model: "qwen3-embedding",
  },
  vaults: [],
  memory_sinks: [],
  contracts: { ...DEFAULT_CONTRACTS_CONFIG },
  plugin: { ...DEFAULT_PLUGIN_CONFIG },
};

export function configPath(): string {
  return join(homedir(), ".vault-memory", "config.toml");
}

export async function loadConfig(path: string = configPath()): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    throw new Error(`Failed to parse TOML at ${path}: ${(err as Error).message}`);
  }

  const validated = AppConfigSchema.parse(parsed);

  return {
    server: {
      ...DEFAULT_CONFIG.server,
      ...validated.server,
    },
    vaults: validated.vaults,
    memory: validated.memory,
    // Phase 5 / ADR-005 §"Sub-folder MemorySink ordering": sort the
    // memory_sinks array by path-specificity (longest resource first)
    // so `MemorySinkRegistry.findSinkContaining` (startsWith over
    // insertion order, src/memory/registry.ts:190-202) resolves
    // sub-folder sinks BEFORE their parents. Concretely:
    // `_memory/_briefs/` MUST be registered before `_memory/` so a
    // brief write routes into the brief-specific sink (bound to
    // `default-brief-v1`, accepts `status: "stale"`) instead of the
    // parent (bound to `default-memory-v1`, rejects `"stale"`).
    memory_sinks: sortSinksByPathSpecificity(validated.memory_sinks),
    brief: validated.brief,
    contracts: validated.contracts,
    plugin: validated.plugin,
  };
}

/**
 * Phase 5: sort `[[memory_sinks]]` so more-specific paths come first.
 *
 * The `handle` shape is `<scheme>://<authority>/<resource>` (ADR-001
 * URI form). Path-specificity is measured by the length of the
 * `<resource>` portion — longer resources are more specific and MUST
 * register first. Comparator is stable (Array.prototype.sort is
 * stable in V8 ≥ Node 12); equal-length resources preserve their
 * declaration order.
 *
 * Pitfall 1 mitigation (ADR-005): without this normalization, a TOML
 * that declares `_memory/` before `_memory/_briefs/` would route
 * brief writes through the parent sink's `default-memory-v1`
 * contract, which rejects `status: "stale"`.
 */
function sortSinksByPathSpecificity<T extends { handle: string }>(
  sinks: T[],
): T[] {
  // Compute the resource length once per sink — avoids re-parsing
  // inside the comparator (n*log(n) calls).
  type Tagged = { sink: T; resourceLength: number; order: number };
  const tagged: Tagged[] = sinks.map((s, i) => ({
    sink: s,
    resourceLength: extractResourceLength(s.handle),
    order: i,
  }));
  tagged.sort((a, b) => {
    // Primary: longer resource (more specific) first.
    if (a.resourceLength !== b.resourceLength) {
      return b.resourceLength - a.resourceLength;
    }
    // Secondary: preserve declaration order on ties (defensive — V8
    // sort is already stable but the explicit tie-breaker documents
    // the intent).
    return a.order - b.order;
  });
  return tagged.map((t) => t.sink);
}

/**
 * Extract the `<resource>` portion length from a `<scheme>://<authority>/<resource>`
 * handle. Returns 0 for malformed handles — they fall to the bottom
 * of the sorted list, which is harmless because malformed handles
 * are caught downstream by `parseMemorySinkHandle` in
 * `src/memory/sink.ts`.
 */
function extractResourceLength(handle: string): number {
  const schemeEnd = handle.indexOf("://");
  if (schemeEnd === -1) return 0;
  const afterScheme = handle.slice(schemeEnd + 3);
  const firstSlash = afterScheme.indexOf("/");
  if (firstSlash === -1) return 0;
  return afterScheme.length - (firstSlash + 1);
}
