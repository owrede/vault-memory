/**
 * MCP server.
 *
 * Phase 1 toolset:
 *   - list_vaults, read_note, search_semantic
 *
 * Phase 2 toolset:
 *   - search_text, search_hybrid
 *   - list_backlinks, list_forward_links, find_broken_links
 *   - query_frontmatter
 *
 * Phase 3 will add: write_note, update_frontmatter, audit_log
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type BetterSqlite3 from "better-sqlite3";
import { loadConfig, configPath } from "./config/index.js";
import {
  syncPluginTools,
  RuntimeConfigStore,
} from "./plugin-tools/index.js";
import type { TriggerReindexProgress } from "./plugin-tools/trigger-reindex.js";
import { VaultManager } from "./vault/index.js";
import type { Vault } from "./vault/index.js";
import { OllamaClient } from "./ollama/index.js";
import { FtsQueries } from "./db/index.js";
import { hybridSearch, matchesAnyGlob } from "./search/index.js";
import { OllamaReranker, OnnxReranker } from "./rerank/index.js";
import type { Reranker } from "./rerank/index.js";
import { errorMessage } from "./errors/format.js";
import { ok, errorResponse, errorResponseJson } from "./server/responses.js";
import {
  countWords,
  resolveVaultTargets,
  encodeNoteId,
  decodeNoteId,
  displayUrl,
  truncateSnippet,
  aggregateTopTags,
  aggregateTopFrontmatterKeys,
  safeParseFrontmatter,
  defaultBasename,
  normalizeFolderHint,
} from "./server/utils.js";
// Re-export the five utils that `src/server.test.ts` imports from "./server.js".
export {
  encodeNoteId,
  decodeNoteId,
  truncateSnippet,
  aggregateTopTags,
  aggregateTopFrontmatterKeys,
} from "./server/utils.js";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import {
  cluster,
  expand,
  listBacklinks,
  listForwardLinks,
  findBrokenLinks,
} from "./graph/index.js";
import type {
  ClusterOptions,
  ExpandDeps,
  ExpandDirection,
  ExpandOptions,
} from "./graph/index.js";
import type { EdgeType } from "./db/queries/edges.js";
import { queryFrontmatter, updateFrontmatter } from "./frontmatter/index.js";
import { suggestFrontmatter } from "./schema/index.js";
import { ObsidianFsDelivery } from "./adapters/delivery/obsidian-fs/index.js";
import {
  provisionSink,
  sentinelExistsAt,
} from "./adapters/delivery/obsidian-fs/sentinel.js";
import {
  MemorySinkRegistry,
  readListSinks,
  readMemoryStats,
  RESOURCE_URI_LIST_SINKS,
  RESOURCE_URI_LIST_BRIEFS,
  RESOURCE_URI_MEMORY_STATS,
  RESOURCE_URI_LIST_CONTRACTS,
  RESOURCE_URI_LIST_CONTRACT_VERBS,
  RESOURCE_URI_SOURCES,
  RESOURCE_URI_VAULTS,
  RESOURCE_URI_MODELS,
  RESOURCE_URI_RECENT,
  RESOURCE_URI_STATS,
  RESOURCE_URI_BACKLINKS,
  type MemorySinkConfig,
} from "./memory/index.js";
import { RESOURCES } from "./resource-registry.js";
import {
  handleRecall,
  handleRecordObservation,
  handleSupersede,
} from "./memory/tools/index.js";
import {
  BriefStalenessDaemon,
  handleCompileBrief,
  handleGetBrief,
  readListBriefs,
} from "./brief/index.js";
import { searchSections } from "./assembly/search-sections.js";
import { DocNotFoundError, getOutline } from "./assembly/outline.js";
import { assembleDossier, getDocumentBundle } from "./assembly/index.js";
import { getAuditLog, getIndexRuns } from "./audit/index.js";
import {
  ObsidianFsChangeFeed,
  SuppressionSet,
  VaultWatcher,
} from "./adapters/change-feed/obsidian-fs/index.js";
import {
  catchupVault,
  listModels,
  startShadowIndex,
  switchActiveModel,
  vacuumEmbeddings,
} from "./indexer/index.js";
import type { Document, SearchHit, WikilinkRef } from "./types.js";
import { TOOL_SCHEMAS, TOOLS, buildToolSchema, type ToolName } from "./tool-registry.js";
import {
  AdapterRegistry,
  formatDocId,
  parseDocId,
  parseSourceHandle,
} from "./adapters/registry.js";
import { ObsidianFsSource } from "./adapters/source/obsidian-fs/index.js";
import {
  startContractRegistry,
  syncAutoRegistered,
  PeerMcpRegistry,
  instantiateContract,
  describeContract,
  readListContracts,
  readListContractVerbs,
  readListSources,
  readSourceTools,
  readSourceTool,
  type SourceConfigMeta,
  type StartedContractRegistry,
  type InstantiateDeps,
} from "./contracts/index.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Handler } from "./server/deps.js";

const VERSION = "1.0.0";

/**
 * Bootstrap phase names — surfaced via the optional `onPhase` callback on
 * `serve()`. Test-only hook used to assert the bootstrap order invariant
 * (per Plan 02-03b: `register_memory_sinks` MUST fire before
 * `start_catchup`).
 */
export type BootstrapPhase =
  | "load_config"
  | "open_vaults"
  | "register_memory_sinks"
  | "start_contract_registries"
  | "start_catchup"
  | "connect_transport";

export interface ServeOptions {
  /** Test-only hook: called as each bootstrap phase begins. */
  onPhase?: (name: BootstrapPhase) => void;
}

/**
 * Convention: when no `[[memory_sinks]]` is configured AND a vault root
 * contains `<this-folder>/.memory-sink`, `discoverMemorySinks` synthesizes
 * a default sink named `default` bound to the `default-memory-v1` contract.
 *
 * IN-05 closure: surfaced as an exported constant so the magic isn't
 * buried in a string literal. Users who want a different folder name
 * configure `[[memory_sinks]]` explicitly (which short-circuits auto-
 * discovery — see `discoverMemorySinks` body line 1).
 */
export const MEMORY_AUTO_DISCOVERY_FOLDER = "_memory";

/**
 * Auto-discover memory sinks per Plan 02-03b. When `config.memory_sinks` is
 * empty AND a vault contains `<MEMORY_AUTO_DISCOVERY_FOLDER>/.memory-sink`,
 * synthesize a default sink config
 * `{name: "default", handle: "obsidian-fs://<vault>/<MEMORY_AUTO_DISCOVERY_FOLDER>/",
 * contract: "default-memory-v1"}`. This preserves the v2 fixture's existing
 * memory docs as a "default sink" without requiring config edits.
 *
 * Returns the explicit configs unchanged when `configured` is non-empty.
 */
export async function discoverMemorySinks(
  configured: readonly MemorySinkConfig[],
  vaults: readonly { name: string; path: string }[],
): Promise<MemorySinkConfig[]> {
  if (configured.length > 0) {
    return [...configured];
  }
  const discovered: MemorySinkConfig[] = [];
  for (const v of vaults) {
    if (await sentinelExistsAt(v.path, MEMORY_AUTO_DISCOVERY_FOLDER)) {
      discovered.push({
        name: "default",
        handle: `obsidian-fs://${v.name}/${MEMORY_AUTO_DISCOVERY_FOLDER}/`,
        contract: "default-memory-v1",
      });
    }
  }
  return discovered;
}

/**
 * Construct and populate a `MemorySinkRegistry` per Plan 02-03b. Wraps
 * `discoverMemorySinks` + `registry.registerMemorySinks` with the
 * production provisioner (calls `provisionSink` from obsidian-fs/sentinel).
 *
 * Exported for use by `serve()` and by `src/server.test.ts` (MEM-11
 * integration + bootstrap-order assertion).
 */
export async function setupMemorySinks(
  config: {
    memory_sinks: MemorySinkConfig[];
    memory?: { default_sink?: string };
  },
  manager: VaultManager,
): Promise<MemorySinkRegistry> {
  const registry = new MemorySinkRegistry();
  const vaults = manager.list().map((v) => ({
    name: v.config.name,
    path: v.config.path,
  }));
  const sinksConfig = await discoverMemorySinks(config.memory_sinks, vaults);
  await registry.registerMemorySinks(sinksConfig, {
    resolveVaultAbsolutePath: (name) => manager.require(name).config.path,
    ...(config.memory?.default_sink !== undefined
      ? { defaultSinkName: config.memory.default_sink }
      : {}),
    provisioner: async (sink, vaultAbs) =>
      provisionSink(sink, vaultAbs, { version: VERSION }),
  });
  return registry;
}

// ─── Server bootstrap ────────────────────────────────────────────────────────

export async function serve(options: ServeOptions = {}): Promise<void> {
  const onPhase = options.onPhase ?? ((): void => undefined);

  onPhase("load_config");
  const config = await loadConfig();

  onPhase("open_vaults");
  const manager = new VaultManager();
  await manager.loadAll(config.vaults);

  // Plan 02-03b — wire the MemorySinkRegistry BEFORE catchup so any
  // sentinel provisioning completes before the catch-up walk touches the
  // _memory/ folder. Registration failures are fatal per ADR-004
  // §Provisioning fail-fast.
  onPhase("register_memory_sinks");
  const memorySinkRegistry = await setupMemorySinks(config, manager);

  // ─── Adapter registry (Phase 1, plans 01-03 + 01-04) ──────────────────────
  //
  // One ObsidianFsSource + one ObsidianFsDelivery per vault; registered under
  // the canonical handle `obsidian-fs://<vault-name>`. The read_note handler
  // resolves the source; the write_note / update_frontmatter / delete_note
  // handlers resolve the delivery (plan 01-04 task 06).
  //
  // D-02 (client_info capture): the delivery takes a LAZY clientId getter
  // closure that reads `server.getClientVersion()?.name` on every call. This
  // lets us construct the registry BEFORE `server.connect()` while still
  // surfacing the post-handshake client_info into the audit log.
  // Pre-handshake (or if the client never sent clientInfo per the optional
  // spec field), the fallback is "unknown" — explicitly NOT a hardcoded
  // client name (the C-1 leak removed in plan 01-04). RESEARCH Pitfall 4.
  const adapterRegistry = new AdapterRegistry();
  // `serverRef` is assigned below; the closure captures the variable so the
  // delivery can see the post-init clientInfo without a re-registration.
  let serverRef: McpServer | undefined;
  // McpServer wraps an internal low-level `Server`; `getClientVersion()` is
  // on the inner instance.
  const getClientId = (): string => serverRef?.server.getClientVersion()?.name ?? "unknown";
  // One SuppressionSet shared by all watchers + the per-vault change-feed.
  // Paths are vault-relative; the chance of a collision across vaults is
  // negligible and a false positive just means one event is dropped —
  // harmless. (Pitfall 6 cross-adapter contract: ObsidianFsDelivery marks
  // a path on this set BEFORE atomicWriteFile; the change-feed +
  // VaultWatcher consume it on the corresponding chokidar event.)
  const suppression = new SuppressionSet({ ttlMs: 2000 });
  const changeFeeds = new Map<string, ObsidianFsChangeFeed>();
  for (const vault of manager.list()) {
    const source = new ObsidianFsSource(vault.config);
    adapterRegistry.registerSource(source.handle, source);

    const delivery = new ObsidianFsDelivery(vault, getClientId, memorySinkRegistry);
    adapterRegistry.registerDelivery(delivery.handle, delivery);

    // Plan 01-05 task 02: register a ChangeFeed per vault. Coexists with
    // the v1 VaultWatcher (driven from `startCatchupAndWatchers` below)
    // so existing live-indexing behavior is unchanged; a future plan will
    // retire VaultWatcher in favor of an indexer subscribing through this
    // ChangeFeed seam.
    const changeFeed = new ObsidianFsChangeFeed({
      vault,
      suppression,
      log: (m) => process.stderr.write(`[change-feed:${vault.config.name}] ${m}\n`),
    });
    adapterRegistry.registerChangeFeed(changeFeed.handle, changeFeed);
    changeFeeds.set(vault.config.name, changeFeed);
  }

  const ollama = new OllamaClient({
    endpoint: config.server.ollama_endpoint,
  });

  const defaultModel = config.server.default_embedding_model ?? "qwen3-embedding:0.6b";

  // Default search scope. When VAULT_MEMORY_ACTIVE_VAULT is set, search_*
  // tools default to that single vault unless the caller passes an explicit
  // `vaults` array. This makes the common case ("I'm working in this vault,
  // search this vault") the default — cross-vault search is opt-in via an
  // explicit `vaults: ["a", "b"]` filter. If the env var is unset, the
  // legacy behaviour (search all configured vaults) applies.
  const activeVault = process.env.VAULT_MEMORY_ACTIVE_VAULT?.trim() || undefined;

  // Optional cross-encoder reranker (Phase 7d). Constructed once;
  // search_hybrid will pass it through only when the caller asks for it.
  // Phase 8: backend selection. Default to "onnx" when reranker_model is
  // set but no backend specified — the ONNX cross-encoder is the
  // recommended path; the Ollama L2-norm proxy is retained for
  // backward-compat only.
  const rerankerBackend =
    config.server.reranker_backend ?? (config.server.reranker_model ? "onnx" : undefined);
  const reranker: Reranker | undefined = config.server.reranker_model
    ? rerankerBackend === "ollama"
      ? new OllamaReranker({ ollama, model: config.server.reranker_model })
      : new OnnxReranker({
          modelDir:
            config.server.reranker_model_dir ??
            joinPath(homedir(), ".vault-memory", "models", "bge-reranker-v2-m3"),
        })
    : undefined;

  // ─── File watchers (Phase 4) ──────────────────────────────────────────────
  //
  // The shared `suppression` set (hoisted above with the adapter-registry
  // construction so the per-vault ChangeFeed can share it with the v1
  // VaultWatcher) is also wired into each VaultWatcher below.
  const watchers = new Map<string, VaultWatcher>();

  // ─── Brief staleness daemons (Phase 5 / BRF-05..BRF-08) ────────────────────
  //
  // One daemon per vault, started after MemorySinkRegistry + catchup. Each
  // daemon subscribes to the same per-vault `ObsidianFsChangeFeed` the
  // VaultWatcher uses; ChangeFeed fan-out is documented (snapshot-then-
  // iterate per change-feed.ts:218), so multiple handlers per feed are
  // safe by contract. Lock contention is a NORMAL multi-MCP-client
  // outcome: the second server logs a structured WARN and serves
  // search/read/write identically.
  const briefDaemons = new Map<string, BriefStalenessDaemon>();

  // Codex MEDIUM-3: catch-up reconciliation can take seconds on large vaults
  // (re-embedding modified notes). We defer it until after MCP `connect()` so
  // the tool list responds immediately and the LLM doesn't time out waiting
  // for the handshake. Watchers start per-vault as each catch-up finishes.
  const startCatchupAndWatchers = async (): Promise<void> => {
    for (const vault of manager.list()) {
      if (!vault.config.embedding_model && !vault.db.models.getActive()) continue;
      const modelName = vault.config.embedding_model ?? defaultModel;

      try {
        const result = await catchupVault({
          vault,
          embeddingModel: modelName,
          ollama,
          log: (m) => process.stderr.write(`[catchup:${vault.config.name}] ${m}\n`),
        });
        if (result.reindexed > 0 || result.removed > 0) {
          process.stderr.write(
            `[catchup:${vault.config.name}] scanned ${result.scanned}, ` +
              `reindexed ${result.reindexed}, removed ${result.removed} ` +
              `(${result.durationMs}ms)\n`,
          );
        }
      } catch (err) {
        const message = errorMessage(err);
        process.stderr.write(
          `[catchup:${vault.config.name}] failed: ${message} (watcher will still start)\n`,
        );
      }

      const watcher = new VaultWatcher({
        vault,
        embeddingModel: modelName,
        secondaryEmbeddingModel: vault.config.secondary_embedding_model,
        ollama,
        suppression,
      });
      await watcher.start();
      watchers.set(vault.config.name, watcher);

      // ── Phase 5 / D-07/D-08: brief staleness daemon ──────────────────
      //
      // Subscribes to the same ObsidianFsChangeFeed as the VaultWatcher.
      // Lock contention is logged as structured WARN to stderr; the
      // server continues to serve search/read/write — only the daemon
      // subscription is gated (D-08 multi-MCP-client norm).
      const feed = changeFeeds.get(vault.config.name);
      if (feed) {
        const daemon = new BriefStalenessDaemon();
        try {
          await daemon.start(vault, feed, {
            memorySinkRegistry,
            deliveryAdapterFor: (vaultName) =>
              adapterRegistry.resolveDelivery(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
            sourceConnectorFor: (vaultName) =>
              adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
            log: (m) =>
              process.stderr.write(
                `[brief-daemon:${vault.config.name}] ${m}\n`,
              ),
          });
          briefDaemons.set(vault.config.name, daemon);
        } catch (err) {
          const message = errorMessage(err);
          process.stderr.write(
            `[brief-daemon:${vault.config.name}] start failed: ${message}\n`,
          );
        }
      }
    }
  };

  const shutdown = async (): Promise<void> => {
    // Phase 6 (Plan 06-02): dispose ContractRegistry feed subscriptions
    // BEFORE the brief daemons + watchers so no contract reload races
    // with mid-shutdown disposal. The dispose() call is synchronous and
    // unsubscribes the per-vault ChangeFeed handler.
    for (const state of contractRegistries.values()) {
      try {
        state.started.dispose();
      } catch (err) {
        const message = errorMessage(err);
        process.stderr.write(`[contract-registry] dispose error: ${message}\n`);
      }
    }
    // Plan 06-03 (Pitfall F4) — kill peer-MCP child processes BEFORE
    // brief daemons + watchers + change-feeds drain. `shutdown()`
    // disposes each `PeerMcpClient`, which invokes `transport.close()`
    // → `child.kill()`. Idempotent; safe to call even when no clients
    // were configured.
    try {
      await peerMcpRegistry.shutdown();
    } catch (err) {
      const message = errorMessage(err);
      process.stderr.write(`[peer-mcp-registry] shutdown error: ${message}\n`);
    }
    // Phase 5 (Plan 05-03): dispose brief staleness daemons FIRST so
    // no in-flight ChangeEvents land mid-shutdown. Then drain + stop
    // watchers; finally close change-feeds (the underlying chokidar
    // watcher). Lock release happens inside daemon.shutdown() — a
    // crashed shutdown that fails here leaves the lock for the
    // PID-liveness stale-detection on next boot.
    for (const d of briefDaemons.values()) {
      try {
        await d.shutdown();
      } catch (err) {
        const message = errorMessage(err);
        process.stderr.write(`[brief-daemon] shutdown error: ${message}\n`);
      }
    }
    for (const w of watchers.values()) {
      await w.drain();
      await w.stop();
    }
    for (const cf of changeFeeds.values()) {
      await cf.close();
    }
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  // Stdin-EOF watchdog. When stdio-MCP parents (Claude, Obsidian plugin)
  // die, they don't always succeed at SIGTERM-ing this child cleanly —
  // the parent may have been killed itself (force-quit Obsidian), the
  // transport.close() may not propagate, or the SIGTERM may race with
  // sustained file-IO and get queued. In all those cases stdin closes,
  // emitting 'end' (FIN received) or 'close' (FD closed). We exit then.
  //
  // Without this watchdog, EVERY plugin reload accumulates a zombie
  // `vault-memory serve` process holding ~22k chokidar FDs. After 10–15
  // reloads the system runs out of file descriptors (`kern.maxfiles`)
  // and Obsidian itself fails to scandir its vault with ENFILE.
  // Discovered the hard way 2026-05-20.
  //
  // Brief grace period: the MCP SDK reads stdin in object-mode chunks;
  // a final `tools/call` may still be processing when stdin closes. The
  // 500 ms timer lets in-flight work complete before exit; shutdown()
  // runs through the watcher/changeFeed drain just like the signal path.
  let stdinClosing = false;
  const onStdinClose = (reason: "end" | "close") => {
    if (stdinClosing) return;
    stdinClosing = true;
    // eslint-disable-next-line no-console -- direct stderr is intentional;
    // logger may already be draining as part of shutdown.
    process.stderr.write(
      `[vault-memory] stdin ${reason} — parent process gone; shutting down.\n`,
    );
    setTimeout(() => {
      void shutdown().finally(() => process.exit(0));
    }, 500);
  };
  process.stdin.on("end", () => onStdinClose("end"));
  process.stdin.on("close", () => onStdinClose("close"));

  const server = new McpServer(
    { name: "vault-memory", version: VERSION },
    // Plan 02-06 (MEM-09): advertise `resources` capability so MCP clients
    // call `resources/list` + `resources/read` on bootstrap. Polled-only —
    // no `subscribe` / `listChanged` flags asserted.
    { capabilities: { tools: {}, resources: {} } },
  );
  // Make the McpServer visible to the lazy clientId closure (see bootstrap).
  // After `server.connect(transport)` and the MCP initialize handshake,
  // `server.server.getClientVersion()` returns the client's `Implementation`
  // object — the `name` field is what we use for audit-log attribution.
  serverRef = server;

  // ─── Phase 6 (Plan 06-02) — per-vault ContractRegistry state ─────────────
  //
  // The map is created BEFORE the TOOLS loop so the `register_contracts_as_tools`
  // handler can capture it via closure. The registries themselves are
  // populated by `startContractRegistry({...})` AFTER all v1+v2 tools are
  // registered (so `syncAutoRegistered` is invoking `server.registerTool`
  // on an already-initialized server instance — RegisteredTool handles
  // are preserved per-vault for later remove() calls).
  //
  // The contractRegistries map carries one StartedContractRegistry per
  // vault plus a mutable RegisteredTool handle map for the dynamic
  // `vm_*` auto-registered tools. The Plan 06-02 stub `instantiateHandler`
  // is replaced (Plan 06-03 Task 5) by a closure over the per-vault
  // `buildInstantiateDeps` helper below.
  const contractRegistries = new Map<
    string,
    {
      started: StartedContractRegistry;
      registered: Map<string, RegisteredTool>;
    }
  >();

  // ─── Phase 6 (Plan 06-03) — peer-MCP registry + buildInstantiateDeps ─────
  //
  // ONE PeerMcpRegistry shared across all vaults (peer-MCP servers in
  // `[contracts.mcp_clients]` are vault-independent — a `mcp://gh/list_issues`
  // verb invocation does the same thing regardless of which vault's
  // contract triggered it). The registry boots BEFORE the per-vault
  // contract registries so each `buildInstantiateDeps(vault)` closure
  // captures the same registry instance.
  //
  // Failures during `peerMcpRegistry.start(...)` are NON-FATAL (CONTEXT.md
  // Claude's Discretion + PeerMcpRegistry semantics): individual clients
  // mark themselves unavailable with a stderr WARN. The server keeps booting.
  //
  // SIGTERM/SIGINT cleanup: the existing shutdown() at line ~391 already
  // runs on those signals; we wire `peerMcpRegistry.shutdown()` into it
  // below (Pitfall F4 — kill child processes on parent exit).
  const peerMcpRegistry = new PeerMcpRegistry();

  /**
   * Build per-vault `InstantiateDeps` for `instantiate_contract`. Each
   * baseline-verb thunk re-uses the existing Phase 1-5 handler functions;
   * arguments are passed through verbatim post-template-resolution (the
   * contract author is responsible for matching each verb's signature
   * per the JSDoc block in `src/contracts/verbs/index.ts`).
   */
  const buildInstantiateDeps = (vault: Vault): InstantiateDeps => {
    const state = contractRegistries.get(vault.config.name);
    if (state === undefined) {
      throw new Error(
        `ContractRegistry not initialized for vault "${vault.config.name}"`,
      );
    }
    return {
      vault,
      registry: state.started.registry,
      memorySinks: memorySinkRegistry,
      delivery: adapterRegistry.resolveDelivery(
        parseSourceHandle(`obsidian-fs://${vault.config.name}`),
      ),
      contractAudit: vault.db.contractAudit,
      configDefaults: config.contracts.defaults,
      stepTimeoutSeconds: config.contracts.step_timeout_seconds,
      peerMcpRegistry,
      // The baseline verbs use the same args the contract YAML supplied
      // (post-template-resolution). Each thunk forwards to the existing
      // Phase 1-5 handler in the v1+v2 toolset. Contract authors match
      // each verb's signature per RESEARCH §A9.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hybridSearch: async (args: any) => {
        const p = args as {
          query: string;
          vaults?: string[];
          top_k?: number;
          rrf_k?: number;
          exclude_paths?: string[];
          recency_weight?: number;
          authority_weight?: number;
          half_life_days?: number;
          include_superseded?: boolean;
        };
        return handleSearchHybrid(
          manager,
          ollama,
          defaultModel,
          activeVault,
          p.query,
          p.vaults ?? [vault.config.name],
          p.top_k ?? 10,
          p.rrf_k ?? 60,
          p.exclude_paths,
          reranker,
          p.recency_weight ?? 0,
          p.authority_weight ?? 0,
          p.half_life_days ?? 30,
          p.include_superseded ?? false,
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleExpand: async (args: any) => {
        const p = args as {
          seed_doc_ids: string[];
          hops: 1 | 2;
          direction?: ExpandDirection;
          edge_types?: EdgeType[];
          filter_properties?: Record<string, unknown>;
          include_superseded?: boolean;
        };
        const seeds = p.seed_doc_ids.map((s) => parseDocId(s));
        return expand(
          {
            manager,
            sourceConnectorFor: (vaultName) =>
              adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
          },
          {
            seed_doc_ids: seeds,
            hops: p.hops,
            direction: p.direction ?? "both",
            ...(p.edge_types !== undefined ? { edge_types: p.edge_types } : {}),
            ...(p.filter_properties !== undefined
              ? { filter_properties: p.filter_properties }
              : {}),
            include_superseded: p.include_superseded ?? false,
          } satisfies ExpandOptions,
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleCluster: async (args: any) => {
        const p = args as {
          query?: string;
          seed_doc_ids?: string[];
          vault?: string;
          method?: "edge-community";
          query_top_k?: number;
          force?: boolean;
        };
        let opts: ClusterOptions;
        if (p.query !== undefined) {
          opts = {
            query: p.query,
            method: "edge-community",
            ...(p.vault !== undefined ? { vault: p.vault } : { vault: vault.config.name }),
            ...(p.query_top_k !== undefined ? { query_top_k: p.query_top_k } : {}),
            ...(p.force !== undefined ? { force: p.force } : {}),
          };
        } else {
          const seeds = (p.seed_doc_ids ?? []).map((s) => parseDocId(s));
          opts = {
            seed_doc_ids: seeds,
            method: "edge-community",
            ...(p.force !== undefined ? { force: p.force } : {}),
          };
        }
        return cluster(
          {
            manager,
            sourceConnectorFor: (vaultName) =>
              adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
            hybridSearch: async (v, query, limit) =>
              hybridSearch({
                query,
                embeddingModel: defaultModel,
                ollama,
                vaults: [v],
                topK: limit,
                includeBreakdown: false,
                ...(reranker ? { reranker } : {}),
                displayUrlFor: (vaultName, notePath) =>
                  displayUrl(adapterRegistry, vaultName, notePath),
              }),
          },
          opts,
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleRecall: async (args: any) => {
        const p = args as {
          query: string;
          min_confidence?: "direct" | "inferred" | "uncertain";
          types?: string[];
          max_age_days?: number;
          sink?: string;
          limit?: number;
          vaults?: string[];
        };
        const packets = await handleRecall(
          {
            memorySinkRegistry,
            manager,
            sourceConnectorFor: (vaultName) =>
              adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
            searchHybrid: async (input) =>
              hybridSearch({
                query: input.query,
                embeddingModel: defaultModel,
                ollama,
                vaults: input.vaults,
                topK: input.topK,
                rrfK: 60,
                includeBreakdown: false,
              }),
          },
          { ...p, vaults: p.vaults ?? [vault.config.name] },
        );
        return { packets, count: packets.length };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleCompileBrief: async (args: any) => {
        const p = args as {
          vault?: string;
          target: string;
          source_doc_ids: string[];
          purpose: string;
          max_tokens?: number;
          prepared_text?: string;
          sink?: string;
        };
        return handleCompileBrief(
          {
            memorySinkRegistry,
            manager,
            deliveryAdapterFor: (vaultName) =>
              adapterRegistry.resolveDelivery(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
            sourceConnectorFor: (vaultName) =>
              adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
            server,
            ollama,
            briefConfig: config.brief,
          },
          { ...p, vault: p.vault ?? vault.config.name },
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleGetBrief: async (args: any) => {
        const p = args as {
          vault?: string;
          target: string;
          max_age_days?: number;
          allow_stale?: boolean;
        };
        return handleGetBrief(
          {
            memorySinkRegistry,
            manager,
            sourceConnectorFor: (vaultName) =>
              adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
          },
          { ...p, vault: p.vault ?? vault.config.name },
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleQueryFrontmatter: async (args: any) => {
        const p = args as {
          vault?: string;
          where: Record<string, unknown>;
          limit?: number;
        };
        const v = p.vault ? manager.require(p.vault) : vault;
        return queryFrontmatter(v, {
          where: p.where as Record<string, never>,
          limit: p.limit ?? 100,
        });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleListBacklinks: async (args: any) => {
        const p = args as { vault?: string; path: string };
        const v = p.vault ? manager.require(p.vault) : vault;
        return { backlinks: listBacklinks(v, p.path) };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleGetOutline: async (args: any) => {
        const p = args as { doc_id: string; vaults?: string[] };
        return getOutline(
          {
            manager,
            sourceConnectorFor: (vaultName) =>
              adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              ),
          },
          p,
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleSearchSections: async (args: any) => {
        const p = args as {
          query: string;
          limit?: number;
          vaults?: string[];
          recency_weight?: number;
          authority_weight?: number;
          include_superseded?: boolean;
        };
        // Default scope: caller's vault (the one the contract is bound to).
        const targetVaults: Vault[] = p.vaults
          ? p.vaults.map((name) => manager.require(name))
          : [vault];
        const results = await searchSections(
          {
            searchHybrid: async (input) =>
              hybridSearch({
                query: input.query,
                embeddingModel: defaultModel,
                ollama,
                vaults: input.vaults
                  ? input.vaults.map((name) => manager.require(name))
                  : targetVaults,
                topK: input.topK,
                rrfK: 60,
                includeBreakdown: false,
              }),
            sectionForHit: (vaultName, notePath, chunkIdx) => {
              let v: Vault;
              try {
                v = manager.require(vaultName);
              } catch {
                return null;
              }
              const note = v.db.notes.getByPath(notePath);
              if (!note) return null;
              const chunks = v.db.chunks.getByNote(note.id);
              const chunk = chunks.find((c) => c.idx === chunkIdx);
              if (!chunk) return null;
              const section = v.db.sections.findContainingChunk(note.id, chunk.id);
              if (!section) return null;
              let headingPath: string[];
              try {
                const parsed = JSON.parse(section.heading_path);
                headingPath = Array.isArray(parsed) ? (parsed as string[]) : [];
              } catch {
                headingPath = [];
              }
              return {
                noteId: note.id,
                anchor: section.anchor,
                headingPath,
                chunkIdFirst: section.chunk_id_first ?? Number.MAX_SAFE_INTEGER,
              };
            },
            readDocument: async (vaultName, notePath) => {
              const docId = formatDocId("obsidian-fs", vaultName, notePath);
              return adapterRegistry
                .resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`))
                .readDocument(docId);
            },
            displayUrlFor: (docId, vaultName) => {
              const source = adapterRegistry.resolveSource(
                parseSourceHandle(`obsidian-fs://${vaultName}`),
              );
              return source.formatDisplayUrl?.(docId) ?? docId;
            },
          },
          {
            query: p.query,
            limit: p.limit ?? 10,
            ...(p.vaults !== undefined ? { vaults: p.vaults } : {}),
            ...(p.recency_weight !== undefined ? { recency_weight: p.recency_weight } : {}),
            ...(p.authority_weight !== undefined
              ? { authority_weight: p.authority_weight }
              : {}),
            ...(p.include_superseded !== undefined
              ? { include_superseded: p.include_superseded }
              : {}),
          },
        );
        return { results, count: results.length };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleReadNote: async (args: any) => {
        const p = args as { vault?: string; path: string };
        return handleReadNote(
          adapterRegistry,
          p.vault ?? vault.config.name,
          p.path,
        );
      },
    };
  };

  /**
   * Resolve the target vault for `describe_contract` / `instantiate_contract`.
   * Single-vault setups: use the only configured vault. Multi-vault setups:
   * the caller MUST pass `vault`; otherwise return the WARNING-6
   * `ambiguous_vault` envelope (12th reason in InstantiateError).
   */
  const resolveContractVault = (
    vaultArg: string | undefined,
  ):
    | { ok: true; vault: Vault }
    | { ok: false; reason: "ambiguous_vault"; available_vaults: string[] }
    | { ok: false; reason: "unknown_vault"; vault: string } => {
    const list = manager.list();
    if (vaultArg !== undefined) {
      const v = list.find((x) => x.config.name === vaultArg);
      if (v === undefined) {
        return { ok: false, reason: "unknown_vault", vault: vaultArg };
      }
      return { ok: true, vault: v };
    }
    if (list.length === 1) {
      const only = list[0];
      if (only === undefined) {
        return { ok: false, reason: "ambiguous_vault", available_vaults: [] };
      }
      return { ok: true, vault: only };
    }
    return {
      ok: false,
      reason: "ambiguous_vault",
      available_vaults: list.map((v) => v.config.name),
    };
  };

  /**
   * Bound to auto-registered `vm_*` tools. Each auto-registered tool's
   * callback (see `syncAutoRegistered` in `src/contracts/auto-register.ts`)
   * passes the contract name + the caller args through this closure. We
   * route to `instantiateContract` using the per-vault deps captured at
   * register time — single-vault deployments are the v2.0.0 norm; multi-
   * vault setups will surface `ambiguous_vault` until per-vault
   * tool-prefixing lands in a future slice.
   */
  const instantiateHandler = async (
    name: string,
    args: unknown,
  ): Promise<unknown> => {
    const resolved = resolveContractVault(undefined);
    if (!resolved.ok) return resolved;
    const inputs = ((args as { inputs?: Record<string, unknown> })?.inputs ?? {}) as Record<
      string,
      unknown
    >;
    return instantiateContract(buildInstantiateDeps(resolved.vault), {
      name,
      inputs,
    });
  };

  // ─── registerTool × 23 (SDK 1.29, plan 01-05 task 07) ─────────────────────
  //
  // Each handler receives ALREADY-VALIDATED args (the SDK runs the Zod
  // schema before invoking us). We layer a try/catch to convert thrown
  // errors into MCP error responses, preserving the v1 error shape.

  const handlers: Record<ToolName, Handler> = {
    list_vaults: async () => handleListVaults(manager),
    read_note: async (a) => {
      const p = a as { vault: string; path: string };
      return handleReadNote(adapterRegistry, p.vault, p.path);
    },
    search_semantic: async (a) => {
      const p = a as {
        query: string;
        vaults?: string[];
        top_k: number;
        exclude_paths?: string[];
      };
      return handleSearchSemantic(
        manager,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.vaults,
        p.top_k,
        p.exclude_paths,
      );
    },
    search_text: async (a) => {
      const p = a as {
        query: string;
        vaults?: string[];
        top_k: number;
        exclude_paths?: string[];
      };
      return handleSearchText(manager, activeVault, p.query, p.vaults, p.top_k, p.exclude_paths);
    },
    search_hybrid: async (a) => {
      const p = a as {
        query: string;
        vaults?: string[];
        top_k: number;
        rrf_k: number;
        exclude_paths?: string[];
        rerank: boolean;
        // Phase 3 / 03-05 additive params — Zod fills defaults so these
        // are always present after validation. v1 callers omit them and
        // get the v1-identical default behavior.
        recency_weight: number;
        authority_weight: number;
        half_life_days: number;
        include_superseded: boolean;
        // Phase 4 / 04-04 (D-15): additive optional auto-expansion.
        // When omitted, the downstream hybridSearch guard short-circuits.
        expand?: {
          hops: 1 | 2;
          direction?: ExpandDirection;
          edge_types?: EdgeType[];
        };
      };
      return handleSearchHybrid(
        manager,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.vaults,
        p.top_k,
        p.rrf_k,
        p.exclude_paths,
        p.rerank ? reranker : undefined,
        p.recency_weight,
        p.authority_weight,
        p.half_life_days,
        p.include_superseded,
        // 03-05: display-URL resolver — delegates to the obsidian-fs source
        // adapter (or whichever adapter owns the vault) so hybrid.ts never
        // mints adapter URL strings (ADR-002 §I-5b).
        (vaultName, notePath) => displayUrl(adapterRegistry, vaultName, notePath),
        // Phase 4 / 04-04 (D-15): pass the optional expand object + its
        // injected deps (manager + sourceConnectorFor) so hybridSearch
        // can compose Plan 04-03's `expand()` over the rescored top-K.
        p.expand,
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
      );
    },
    list_backlinks: async (a) => {
      const p = a as { vault: string; path: string };
      const vault = manager.require(p.vault);
      return { backlinks: listBacklinks(vault, p.path) };
    },
    list_forward_links: async (a) => {
      const p = a as { vault: string; path: string; include_broken: boolean };
      const vault = manager.require(p.vault);
      return { links: listForwardLinks(vault, p.path, p.include_broken) };
    },
    find_broken_links: async (a) => {
      const p = a as { vault: string };
      const vault = manager.require(p.vault);
      return { broken: findBrokenLinks(vault) };
    },
    query_frontmatter: async (a) => {
      const p = a as { vault: string; where: Record<string, unknown>; limit: number };
      const vault = manager.require(p.vault);
      const hits = queryFrontmatter(vault, {
        where: p.where as Record<string, never>,
        limit: p.limit,
      });
      return {
        notes: hits.map((n) => ({
          path: n.path,
          title: n.title,
          frontmatter: n.frontmatter ? JSON.parse(n.frontmatter) : null,
          mtime: n.mtime,
        })),
        count: hits.length,
      };
    },
    write_note: async (a) => {
      const p = a as {
        vault: string;
        path: string;
        content: string;
        frontmatter?: Record<string, unknown> | null;
        expected_hash?: string;
        client_id?: string;
      };
      const vault = manager.require(p.vault);
      // Suppress the watcher event triggered by our own atomic rename.
      // We call suppression BEFORE delivery.write() so the event is
      // pre-filtered. Worst case (permission_denied / hash_mismatch):
      // we suppress an event that never fires — harmless beyond the
      // ~2s TTL.
      suppression.add(p.path);
      return handleWriteNote(adapterRegistry, vault, p);
    },
    update_frontmatter: async (a) => {
      const p = a as {
        vault: string;
        path: string;
        merge: Record<string, unknown>;
        expected_hash?: string;
        client_id?: string;
      };
      const vault = manager.require(p.vault);
      return updateFrontmatter({
        vault,
        registry: adapterRegistry,
        memorySinkRegistry,
        relativePath: p.path,
        merge: p.merge,
        ...(p.expected_hash !== undefined ? { expectedHash: p.expected_hash } : {}),
        ...(p.client_id !== undefined ? { clientId: p.client_id } : {}),
        onBeforeFsWrite: () => suppression.add(p.path),
      });
    },
    delete_note: async (a) => {
      const p = a as {
        vault: string;
        path: string;
        expected_hash: string;
        client_id?: string;
      };
      const vault = manager.require(p.vault);
      suppression.add(p.path);
      return handleDeleteNote(adapterRegistry, vault, p);
    },
    audit_log: async (a) => {
      const p = a as {
        vault: string;
        note_path?: string;
        op?: "create" | "update" | "delete";
        since?: number;
        limit: number;
        is_memory_sink_write?: boolean;
      };
      const vault = manager.require(p.vault);
      // Plan 02-06 (MEM-08): the new optional filter is purely additive.
      // Omitting it preserves Phase 1 behavior (include all rows).
      const entries = getAuditLog({
        vault,
        notePath: p.note_path,
        op: p.op,
        since: p.since,
        limit: p.limit,
        ...(p.is_memory_sink_write !== undefined
          ? { is_memory_sink_write: p.is_memory_sink_write }
          : {}),
      });
      return { entries, count: entries.length };
    },
    list_models: async (a) => {
      const p = a as { vault: string };
      const vault = manager.require(p.vault);
      const models = listModels(vault);
      return { models, count: models.length };
    },
    start_shadow_index: async (a) => {
      const p = a as { vault: string; model: string; batch_size?: number };
      const vault = manager.require(p.vault);
      return startShadowIndex({
        vault,
        model: p.model,
        ollama,
        batchSize: p.batch_size,
        log: (m) => process.stderr.write(`[shadow:${vault.config.name}] ${m}\n`),
      });
    },
    switch_active_model: async (a) => {
      const p = a as { vault: string; model_name: string };
      const vault = manager.require(p.vault);
      return switchActiveModel(vault, p.model_name);
    },
    vacuum_embeddings: async (a) => {
      const p = a as { vault: string };
      const vault = manager.require(p.vault);
      return vacuumEmbeddings(vault);
    },
    index_runs: async (a) => {
      const p = a as { vault: string; limit: number };
      const vault = manager.require(p.vault);
      const runs = getIndexRuns({ vault, limit: p.limit });
      return { runs, count: runs.length };
    },
    search: async (a) => {
      const p = a as { query: string; limit: number };
      return handleSearchCompat(
        manager,
        adapterRegistry,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.limit,
        reranker,
      );
    },
    fetch: async (a) => {
      const p = a as { id: string };
      return handleFetchCompat(manager, adapterRegistry, p.id);
    },
    vault_stats: async (a) => {
      const p = a as { vault?: string };
      return handleVaultStats(manager, p.vault);
    },
    recent_notes: async (a) => {
      const p = a as { vault?: string; limit: number; since?: number };
      return handleRecentNotes(manager, p.vault, p.limit, p.since);
    },
    suggest_frontmatter: async (a) => {
      const p = a as {
        vault: string;
        path?: string;
        content?: string;
        title?: string;
        folder_hint?: string;
      };
      return handleSuggestFrontmatter(manager, p);
    },

    // ── Phase 2 memory tools (Plan 02-04) ──────────────────────────────────
    record_observation: async (a) => {
      const p = a as {
        vault: string;
        claim: string;
        evidence: string[];
        confidence: "direct" | "inferred" | "uncertain";
        type: string;
        sink?: string;
        properties?: Record<string, unknown>;
      };
      // Suppress the watcher event for the soon-to-be-written file.
      // We don't know the exact filename yet (controller mints it), so
      // suppress the observations/ folder path prefix; the watcher's
      // suppression set tolerates fuzzy matches via the TTL.
      const result = await handleRecordObservation(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) =>
            adapterRegistry.resolveDelivery(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        p,
      );
      // After the write, suppress the watcher event using the minted
      // DocId so live-indexing doesn't re-fire on our own write.
      if (result.ok) {
        const resource = result.doc_id.replace(
          `obsidian-fs://${p.vault}/`,
          "",
        );
        suppression.add(resource);
      }
      return result;
    },
    supersede: async (a) => {
      const p = a as {
        doc_id: string;
        replacement_doc_id: string;
        reason: string;
      };
      const result = await handleSupersede(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) =>
            adapterRegistry.resolveDelivery(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        p,
      );
      if (result.ok) {
        const resource = result.doc_id.replace(/^obsidian-fs:\/\/[^/]+\//, "");
        suppression.add(resource);
      }
      return result;
    },

    // ── Phase 2 memory tools (Plan 02-05) ──────────────────────────────────
    recall: async (a) => {
      const p = a as {
        query: string;
        min_confidence?: "direct" | "inferred" | "uncertain";
        types?: string[];
        max_age_days?: number;
        sink?: string;
        limit?: number;
        vaults?: string[];
      };
      const packets = await handleRecall(
        {
          memorySinkRegistry,
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
          searchHybrid: async (input) =>
            hybridSearch({
              query: input.query,
              embeddingModel: defaultModel,
              ollama,
              vaults: input.vaults,
              topK: input.topK,
              rrfK: 60,
              includeBreakdown: false,
            }),
        },
        p,
      );
      return { packets, count: packets.length };
    },

    // ── Phase 5 brief tools (Plan 05-02 / BRF-03, BRF-04) ──────────────────
    compile_brief: async (a) => {
      const p = a as {
        vault: string;
        target: string;
        source_doc_ids: string[];
        purpose: string;
        max_tokens?: number;
        prepared_text?: string;
        sink?: string;
      };
      const result = await handleCompileBrief(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) =>
            adapterRegistry.resolveDelivery(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
          server,
          ollama,
          briefConfig: config.brief,
        },
        p,
      );
      // Suppress watcher events for the soon-to-be-indexed brief +
      // (when D-12 chain fires) the just-updated prior brief.
      if (result.ok) {
        const resource = result.doc_id.replace(
          `obsidian-fs://${p.vault}/`,
          "",
        );
        suppression.add(resource);
        if (result.supersededPrior) {
          const oldResource = result.supersededPrior.replace(
            /^obsidian-fs:\/\/[^/]+\//,
            "",
          );
          suppression.add(oldResource);
        }
      }
      return result;
    },
    get_brief: async (a) => {
      const p = a as {
        vault: string;
        target: string;
        max_age_days?: number;
        allow_stale?: boolean;
      };
      return handleGetBrief(
        {
          memorySinkRegistry,
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        p,
      );
    },

    // ── Phase 3 assembly tools (Plan 03-02 / ASM-02) ───────────────────────
    get_outline: async (a) => {
      const p = a as { doc_id: string; vaults?: string[] };
      return getOutline(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        p,
      );
    },

    // ── Phase 3 assembly tools (Plan 03-03) ──────────────────────────────────
    search_sections: async (a) => {
      const p = a as {
        query: string;
        limit?: number;
        vaults?: string[];
        recency_weight?: number;
        authority_weight?: number;
        include_superseded?: boolean;
      };
      // Resolve target vaults: callers may scope to a subset; default to
      // all configured vaults (mirrors search_hybrid's behavior).
      const allVaults = manager.list();
      const targetVaults: Vault[] = p.vaults
        ? p.vaults.map((name) => manager.require(name))
        : allVaults;

      const results = await searchSections(
        {
          searchHybrid: async (input) =>
            hybridSearch({
              query: input.query,
              embeddingModel: defaultModel,
              ollama,
              vaults: input.vaults
                ? input.vaults.map((name) => manager.require(name))
                : targetVaults,
              topK: input.topK,
              rrfK: 60,
              includeBreakdown: false,
            }),
          sectionForHit: (vaultName, notePath, chunkIdx) => {
            // Look up via the originating vault's DB. The mapping is
            // (notePath → noteId) → (noteId, chunkIdx → chunkId) →
            // findContainingChunk. Returns null on any miss (stale row
            // or pre-migration-010 chunk) so the controller drops it.
            let vault: Vault;
            try {
              vault = manager.require(vaultName);
            } catch {
              return null;
            }
            const note = vault.db.notes.getByPath(notePath);
            if (!note) return null;
            const chunks = vault.db.chunks.getByNote(note.id);
            const chunk = chunks.find((c) => c.idx === chunkIdx);
            if (!chunk) return null;
            const section = vault.db.sections.findContainingChunk(note.id, chunk.id);
            if (!section) return null;
            let headingPath: string[];
            try {
              const parsed = JSON.parse(section.heading_path);
              headingPath = Array.isArray(parsed) ? (parsed as string[]) : [];
            } catch {
              headingPath = [];
            }
            return {
              noteId: note.id,
              anchor: section.anchor,
              headingPath,
              // Sections with a NULL chunk_id_first have been filtered out
              // by findContainingChunk (it requires non-NULL bounds), so
              // chunk_id_first is guaranteed non-null here. Fall back to
              // MAX_SAFE_INTEGER defensively for the tie-break sort.
              chunkIdFirst: section.chunk_id_first ?? Number.MAX_SAFE_INTEGER,
            };
          },
          readDocument: async (vaultName, notePath) => {
            const docId = formatDocId("obsidian-fs", vaultName, notePath);
            return adapterRegistry
              .resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`))
              .readDocument(docId);
          },
          displayUrlFor: (docId, vaultName) => {
            const source = adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            );
            return source.formatDisplayUrl?.(docId) ?? docId;
          },
        },
        {
          query: p.query,
          limit: p.limit ?? 10,
          ...(p.vaults !== undefined ? { vaults: p.vaults } : {}),
          ...(p.recency_weight !== undefined ? { recency_weight: p.recency_weight } : {}),
          ...(p.authority_weight !== undefined ? { authority_weight: p.authority_weight } : {}),
          ...(p.include_superseded !== undefined
            ? { include_superseded: p.include_superseded }
            : {}),
        },
      );
      return { results, count: results.length };
    },

    // ── Phase 3 assembly tools (Plan 03-06) ────────────────────────────────
    assemble_dossier: async (a) => {
      const p = a as { type: string; key: string; vaults?: string[] };
      return assembleDossier(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        p,
      );
    },

    // ── Phase 4 graph tools (Plan 04-03 / GRA-01) ─────────────────────────
    expand: async (a) => {
      const p = a as {
        seed_doc_ids: string[];
        hops: 1 | 2;
        direction: ExpandDirection;
        edge_types?: EdgeType[];
        filter_properties?: Record<string, unknown>;
        include_superseded: boolean;
      };
      // Cast incoming validated DocId strings to the branded DocId
      // type via parseDocId; Zod already enforced DOC_ID_PATTERN at
      // the boundary so this is a no-op brand cast at runtime.
      const seeds = p.seed_doc_ids.map((s) => parseDocId(s));
      return expand(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        {
          seed_doc_ids: seeds,
          hops: p.hops,
          direction: p.direction,
          ...(p.edge_types !== undefined ? { edge_types: p.edge_types } : {}),
          ...(p.filter_properties !== undefined
            ? { filter_properties: p.filter_properties }
            : {}),
          include_superseded: p.include_superseded,
        } satisfies ExpandOptions,
      );
    },

    // ── Phase 4 graph tools (Plan 04-05 / GRA-02) ─────────────────────────
    cluster: async (a) => {
      const p = a as {
        query?: string;
        seed_doc_ids?: string[];
        vault?: string;
        method: "edge-community";
        query_top_k?: number;
        force?: boolean;
      };
      // Build a ClusterOptions discriminated value. Zod's mutual-
      // exclusion refinement has already rejected both-present /
      // neither-present inputs by the time we reach this handler, but
      // the runtime cluster() function performs the same validation as
      // a defense-in-depth check for direct (non-MCP) callers.
      let opts: ClusterOptions;
      if (p.query !== undefined) {
        // CR-02: propagate `vault` so cluster()'s query path can scope
        // search_hybrid deterministically on multi-vault setups.
        opts = {
          query: p.query,
          method: "edge-community",
          ...(p.vault !== undefined ? { vault: p.vault } : {}),
          ...(p.query_top_k !== undefined ? { query_top_k: p.query_top_k } : {}),
          ...(p.force !== undefined ? { force: p.force } : {}),
        };
      } else {
        const seeds = (p.seed_doc_ids ?? []).map((s) => parseDocId(s));
        opts = {
          seed_doc_ids: seeds,
          method: "edge-community",
          ...(p.force !== undefined ? { force: p.force } : {}),
        };
      }
      return cluster(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
          // Bind hybridSearch at call time — avoids the
          // src/graph/cluster.ts → src/search/hybrid.ts circular
          // import. The injected callback returns SearchHit[]; the
          // dispatcher already has `ollama` + `defaultModel` in scope.
          hybridSearch: async (vault, query, limit) =>
            hybridSearch({
              query,
              embeddingModel: defaultModel,
              ollama,
              vaults: [vault],
              topK: limit,
              includeBreakdown: false,
              ...(reranker ? { reranker } : {}),
              displayUrlFor: (vaultName, notePath) =>
                displayUrl(adapterRegistry, vaultName, notePath),
            }),
        },
        opts,
      );
    },

    // ── Phase 3 assembly tools (Plan 03-04 / ASM-01) ───────────────────────
    get_document_bundle: async (a) => {
      const p = a as { doc_id: string; depth?: 1; vaults?: string[] };
      return getDocumentBundle(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        p,
      );
    },

    // ── Phase 6 task-contract DSL (Plan 06-02 / D-A1 escape valve) ─────────
    //
    // Scans the per-vault contract registries and forces a sync of the
    // dynamic MCP tool list — regardless of [contracts.auto_register_tools]
    // (which is what makes this the explicit-control escape valve).
    // Returns per-vault diffs so the caller can confirm what landed.
    register_contracts_as_tools: async (a) => {
      const p = a as { vault?: string };
      const targetVaults = p.vault !== undefined ? [p.vault] : manager.list().map((v) => v.config.name);
      if (p.vault !== undefined) {
        const v = manager.list().find((vault) => vault.config.name === p.vault);
        if (v === undefined) {
          return { ok: false, reason: "unknown_vault", vault: p.vault };
        }
      }
      const results: {
        vault: string;
        registered: string[];
        unregistered: string[];
      }[] = [];
      const prefix = config.contracts.tool_prefix;
      for (const vname of targetVaults) {
        const state = contractRegistries.get(vname);
        if (state === undefined) continue;
        const v = manager.list().find((vault) => vault.config.name === vname);
        if (v === undefined) continue;
        const before = new Set(state.registered.keys());
        // FORCED enabled:true — explicit-control escape valve (D-A1).
        syncAutoRegistered(
          server,
          state.started.registry,
          prefix,
          state.registered,
          { enabled: true, instantiateHandler },
        );
        const after = new Set(state.registered.keys());
        results.push({
          vault: vname,
          registered: Array.from(after).filter((n) => !before.has(n)),
          unregistered: Array.from(before).filter((n) => !after.has(n)),
        });
      }
      if (p.vault !== undefined) {
        const single = results[0] ?? {
          vault: p.vault,
          registered: [],
          unregistered: [],
        };
        return { ok: true, ...single };
      }
      return { ok: true, vaults: results };
    },

    // ── Phase 6 task-contract DSL (Plan 06-03 / CON-05, Q-DESCRIBE) ────────
    //
    // Pure function over the per-vault ContractRegistry. Returns
    // {ok:true, json_schema, summary} or one of the sealed
    // InstantiateError reasons (`unknown_contract`, `ambiguous_vault`,
    // `unknown_vault`). NO LLM, NO side effects.
    describe_contract: async (a) => {
      const p = a as { name: string; vault?: string };
      const resolved = resolveContractVault(p.vault);
      if (!resolved.ok) return resolved;
      const state = contractRegistries.get(resolved.vault.config.name);
      if (state === undefined) {
        // Defense-in-depth: a vault without a contract registry happens
        // only if `start_contract_registries` skipped it (no change-feed)
        // — surface as unknown_contract for the caller.
        return { ok: false, reason: "unknown_contract", name: p.name };
      }
      return describeContract(
        { registry: state.started.registry },
        { name: p.name },
      );
    },

    // ── Phase 6 task-contract DSL (Plan 06-03 / CON-06) ────────────────────
    //
    // Replaces the Plan 06-02 stub. Routes through the per-vault deps
    // built by `buildInstantiateDeps`. On multi-vault setups, the caller
    // MUST pass `vault` — otherwise we return the WARNING-6
    // `ambiguous_vault` envelope (12th reason in the closed
    // InstantiateError union).
    instantiate_contract: async (a) => {
      const p = a as {
        name: string;
        inputs: Record<string, unknown>;
        source_overrides?: Record<string, string>;
        sink_overrides?: Record<string, string>;
        vault?: string;
      };
      const resolved = resolveContractVault(p.vault);
      if (!resolved.ok) return resolved;
      return instantiateContract(buildInstantiateDeps(resolved.vault), {
        name: p.name,
        inputs: p.inputs,
        ...(p.source_overrides !== undefined
          ? { source_overrides: p.source_overrides }
          : {}),
        ...(p.sink_overrides !== undefined ? { sink_overrides: p.sink_overrides } : {}),
      });
    },
  };

  // Wire each TOOLS entry through registerTool. The SDK runs the Zod
  // schema (built via buildToolSchema from tool-registry.ts) against the
  // incoming arguments BEFORE invoking our handler — so each handler
  // receives args matching the declared shape. Thrown errors are caught
  // and converted to MCP error responses (isError:true) per the v1
  // error-wrapping contract.
  for (const tool of TOOLS) {
    const name = tool.name as ToolName;
    const handler = handlers[name];
    const schema = TOOL_SCHEMAS[name];
    // suggest_frontmatter layers an extra refinement on top of its raw
    // shape; the SDK only accepts a raw shape here, so we register the
    // shape directly and let the handler re-validate with the refined
    // schema (`buildToolSchema`) for the cross-field check. The same
    // pattern applies to `cluster` (D-15a mutual exclusion between
    // `query` and `seed_doc_ids`).
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
          // Phase 3 ASM-02: a `DocNotFoundError` carries a structured
          // payload (`{error: "doc_not_found", doc_id}`) per the plan's
          // error contract. Other tools that resolve documents by id
          // (forthcoming get_bundle, dossier) will throw the same shape.
          if (err instanceof DocNotFoundError) {
            return errorResponseJson({ error: "doc_not_found", doc_id: err.doc_id });
          }
          const message = errorMessage(err);
          return errorResponse(message);
        }
      },
    );
  }

  // ─── MCP Resources (Plan 02-06 / MEM-09) ─────────────────────────────────
  //
  // Polled-only — no `notifyResourceUpdated` integration in v2.0.0
  // (CONTEXT D-Q4). URIs are FLAT per RESEARCH §Q4: one resource per
  // capability, not per sink. The registry is already populated above
  // (via `setupMemorySinks(...)`); the read callbacks just project from
  // it (list_sinks) or query the per-vault SQLite DB (memory_stats).
  server.registerResource(
    "memory-sinks",
    RESOURCE_URI_LIST_SINKS,
    {
      title: "Memory sinks",
      description:
        "Configured + auto-discovered MemorySinks (name, handle, vault, contract, default). " +
        "Read to discover where memory documents (record_observation, supersede) land.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(readListSinks(memorySinkRegistry), null, 2),
        },
      ],
    }),
  );
  server.registerResource(
    "memory-stats",
    RESOURCE_URI_MEMORY_STATS,
    {
      title: "Memory sink stats",
      description:
        "Per-sink document counts, by_type / by_status breakdowns, and last memory-write timestamp. " +
        "Polled — re-read to refresh.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(readMemoryStats(memorySinkRegistry, manager), null, 2),
        },
      ],
    }),
  );

  // ─── Plan 05-04 (BRF-09) — list_briefs MCP Resource ───────────────────────
  //
  // Discovery surface for compiled briefs. Filtered by optional `?target=`
  // query parameter (substring match on `properties.target`). The read
  // handler is a pure function over `MemorySinkRegistry + VaultManager +
  // SourceConnector` — see `src/brief/resources.ts`.
  server.registerResource(
    "briefs",
    RESOURCE_URI_LIST_BRIEFS,
    {
      title: "Compiled briefs",
      description:
        "Discovery of compiled briefs by target. Supports optional `?target=<pattern>` " +
        "substring filter on `properties.target`. Includes `active`, `stale`, and " +
        "`superseded` entries so callers can build their own filter / inspect the " +
        "supersede chain. BRF-09.",
      mimeType: "application/json",
    },
    async (uri) => {
      const target = uri.searchParams.get("target") ?? undefined;
      const payload = await readListBriefs(
        {
          registry: memorySinkRegistry,
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            ),
        },
        target !== undefined ? { target } : {},
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  // ─── Phase 6 (Plan 06-04) — contract MCP Resources ───────────────────────
  //
  // Two Resources expose contract metadata for discovery (CON-04) and
  // verb-usage promotion signals (D-A2b). Both use the SDK 1.29
  // `ResourceTemplate` pattern with a `{vault}` URI variable so each
  // per-vault contract registry surfaces as its own readable URI.
  //
  // Resources do NOT count toward the REL-08 tool budget per Phase 5
  // BRF-09 precedent. They are listed under `resources/list` in the
  // MCP protocol, not `tools/list`.
  server.registerResource(
    "contracts",
    new ResourceTemplate(`${RESOURCE_URI_LIST_CONTRACTS}/{vault}`, {
      list: undefined,
    }),
    {
      title: "Task contracts",
      description:
        "Discovery of task contracts available in a vault (CON-04). Each entry " +
        "carries name, description, source/sink counts, and write_back boolean. " +
        "Optional `?source=<prefix>` filters to contracts declaring a source " +
        "whose handle starts with the given prefix.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const vault = String(variables.vault ?? "");
      const state = contractRegistries.get(vault);
      if (state === undefined) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: `unknown vault: ${vault}` }),
            },
          ],
        };
      }
      const source = uri.searchParams.get("source") ?? undefined;
      const payload = readListContracts(
        { registry: state.started.registry, vaultName: vault },
        source !== undefined ? { source } : {},
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "contract-verbs",
    new ResourceTemplate(`${RESOURCE_URI_LIST_CONTRACT_VERBS}/{vault}`, {
      list: undefined,
    }),
    {
      title: "Contract verbs",
      description:
        "List baseline assembly verbs + custom (mcp://) verbs in use, with " +
        "invocation_count + last_seen aggregated from contract_audit (D-A2b). " +
        "Baseline verbs are constant per ADR-006 §Decision 3.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const vault = String(variables.vault ?? "");
      // Look up the per-vault contractAudit directly through the manager
      // rather than via the contractRegistries map — the audit table is
      // populated regardless of whether the registry boot scan succeeded.
      const vaultRef = manager.list().find((vt) => vt.config.name === vault);
      if (vaultRef === undefined) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: `unknown vault: ${vault}` }),
            },
          ],
        };
      }
      const payload = readListContractVerbs({
        contractAudit: vaultRef.db.contractAudit,
        vaultName: vault,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  // ─── SOURCES-REGISTRY.md §5 (Stage 2) — peer-MCP source discovery ────────
  //
  // Three vault-independent resources over the live PeerMcpRegistry. The
  // command/args come from `config.contracts.mcp_clients`; runtime-added
  // sources (set_mcp_client without restart) appear with empty meta until
  // the next boot, which is acceptable for discovery.
  const sourceConfigMeta = (): Record<string, SourceConfigMeta> => {
    const out: Record<string, SourceConfigMeta> = {};
    for (const [name, cfg] of Object.entries(config.contracts.mcp_clients)) {
      out[name] = { command: cfg.command, args: cfg.args ?? [] };
    }
    return out;
  };

  server.registerResource(
    "sources",
    RESOURCE_URI_SOURCES,
    {
      title: "Peer MCP sources",
      description:
        "List peer MCP servers vault-memory connects to, with per-source " +
        "status (connected/unavailable/unreachable), tool_count, and " +
        "last_refreshed. vault-memory itself is not included. SOURCES-REGISTRY §5.1.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            readListSources(peerMcpRegistry, sourceConfigMeta()),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "source-tools",
    new ResourceTemplate(`${RESOURCE_URI_SOURCES}/{name}/tools`, {
      list: undefined,
    }),
    {
      title: "Peer MCP source tools",
      description:
        "List the cached tools/list for one peer MCP source. Empty when the " +
        "source is not connected. SOURCES-REGISTRY §5.2.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const name = String(variables.name ?? "");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(readSourceTools(peerMcpRegistry, name), null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "source-tool",
    new ResourceTemplate(`${RESOURCE_URI_SOURCES}/{name}/tools/{tool}`, {
      list: undefined,
    }),
    {
      title: "Peer MCP source tool",
      description:
        "Read a single tool's schema from one peer MCP source, inlined from " +
        "the cached tools/list (no extra peer call). SOURCES-REGISTRY §5.3.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const name = String(variables.name ?? "");
      const tool = String(variables.tool ?? "");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              readSourceTool(peerMcpRegistry, name, tool),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── Phase 8 (Plan 08-05 / REL-08) — promote 5 list-style v1 tools ───────
  //
  // Each Resource delegates to the existing internal tool handler (GAT-01
  // seam preservation: no logic duplication). The v1 tool handlers remain
  // wired in `tools/call` — only their descriptions get a DEPRECATED notice
  // (see src/tool-registry.ts).
  //
  // `vault-memory://vaults` is static (no per-vault variable). The other
  // four use ResourceTemplate with a `{vault}` variable; `backlinks`
  // additionally uses RFC 6570 reserved expansion `{+docId}` so multi-segment
  // paths (e.g. `notes/sub/file.md`) parse as a single value.
  const rel08Vaults = RESOURCES.find((r) => r.name === "vaults");
  const rel08Models = RESOURCES.find((r) => r.name === "models");
  const rel08Recent = RESOURCES.find((r) => r.name === "recent");
  const rel08Stats = RESOURCES.find((r) => r.name === "stats");
  const rel08Backlinks = RESOURCES.find((r) => r.name === "backlinks");
  if (
    rel08Vaults === undefined ||
    rel08Models === undefined ||
    rel08Recent === undefined ||
    rel08Stats === undefined ||
    rel08Backlinks === undefined
  ) {
    throw new Error(
      "REL-08 Resources missing from RESOURCES registry — check src/resource-registry.ts",
    );
  }

  server.registerResource(
    rel08Vaults.name,
    RESOURCE_URI_VAULTS,
    {
      title: "Vaults",
      description: rel08Vaults.description,
      mimeType: rel08Vaults.mimeType,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(handleListVaults(manager), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    rel08Models.name,
    new ResourceTemplate(`${RESOURCE_URI_MODELS}/{vault}`, { list: undefined }),
    {
      title: "Embedding models",
      description: rel08Models.description,
      mimeType: rel08Models.mimeType,
    },
    async (uri, variables) => {
      const vaultName = String(variables.vault ?? "");
      try {
        const vault = manager.require(vaultName);
        const models = listModels(vault);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ models, count: models.length }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = errorMessage(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );

  server.registerResource(
    rel08Recent.name,
    new ResourceTemplate(`${RESOURCE_URI_RECENT}/{vault}`, { list: undefined }),
    {
      title: "Recent notes",
      description: rel08Recent.description,
      mimeType: rel08Recent.mimeType,
    },
    async (uri, variables) => {
      const vaultName = String(variables.vault ?? "");
      try {
        manager.require(vaultName);
        // Default limit matches the recent_notes tool's schema default (20).
        const limitParam = uri.searchParams.get("limit");
        const sinceParam = uri.searchParams.get("since");
        const limit = limitParam !== null ? Number(limitParam) : 20;
        const since = sinceParam !== null ? Number(sinceParam) : undefined;
        const payload = handleRecentNotes(manager, vaultName, limit, since);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = errorMessage(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );

  server.registerResource(
    rel08Stats.name,
    new ResourceTemplate(`${RESOURCE_URI_STATS}/{vault}`, { list: undefined }),
    {
      title: "Vault stats",
      description: rel08Stats.description,
      mimeType: rel08Stats.mimeType,
    },
    async (uri, variables) => {
      const vaultName = String(variables.vault ?? "");
      try {
        manager.require(vaultName);
        const payload = handleVaultStats(manager, vaultName);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = errorMessage(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );

  server.registerResource(
    rel08Backlinks.name,
    new ResourceTemplate(`${RESOURCE_URI_BACKLINKS}/{vault}/{+docId}`, {
      list: undefined,
    }),
    {
      title: "Backlinks",
      description: rel08Backlinks.description,
      mimeType: rel08Backlinks.mimeType,
    },
    async (uri, variables) => {
      const vaultName = String(variables.vault ?? "");
      const rawDocId = variables.docId;
      // RFC 6570 reserved expansion: when the URI contains percent-encoded
      // characters (e.g. spaces or unicode in path segments), the SDK
      // already decodes them. The variable arrives as the raw path string.
      const docId = Array.isArray(rawDocId)
        ? rawDocId.join("/")
        : String(rawDocId ?? "");
      try {
        const vault = manager.require(vaultName);
        const backlinks = listBacklinks(vault, docId);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ backlinks }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = errorMessage(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );

  // ─── Phase 6 (Plan 06-02) — start per-vault ContractRegistry ─────────────
  //
  // Boot scan + ChangeFeed hot-reload subscriber per vault. The boot scan
  // is light (yaml@2.9 parse over a handful of contract YAMLs) and runs
  // synchronously here so the registry is populated before any client
  // request lands. The ChangeFeed subscription is the third concurrent
  // subscriber on the per-vault ObsidianFsChangeFeed (alongside the
  // VaultWatcher from Phase 1 and the BriefStalenessDaemon from Phase 5).
  // Lock contention is N/A — the ContractRegistry holds no lockfile.
  //
  // When [contracts.auto_register_tools] is true, an initial sync runs
  // after the boot scan completes, registering one MCP tool per parsed
  // contract (prefix from `config.contracts.tool_prefix`). Subsequent
  // ChangeFeed events trigger another sync via the onRegistryChange hook.
  onPhase("start_contract_registries");
  // Plan 06-03 — boot the peer-MCP registry BEFORE per-vault contract
  // registries so each vault's instantiate deps share the same registry.
  // Failures inside `start()` are non-fatal — individual clients mark
  // themselves unavailable + log to stderr (Pitfall F4 mitigation).
  try {
    await peerMcpRegistry.start(config.contracts.mcp_clients);
  } catch (err) {
    const message = errorMessage(err);
    process.stderr.write(`[peer-mcp-registry] start failed: ${message}\n`);
  }
  for (const vault of manager.list()) {
    const feed = changeFeeds.get(vault.config.name);
    if (feed === undefined) continue;
    const source = adapterRegistry.resolveSource(
      parseSourceHandle(`obsidian-fs://${vault.config.name}`),
    );
    const registeredHandles = new Map<string, RegisteredTool>();
    let started: StartedContractRegistry;
    try {
      // eslint-disable-next-line prefer-const
      started = await startContractRegistry({
        vault,
        feed,
        source,
        auditDeps: { contractAudit: vault.db.contractAudit },
        // Phase 7 / Plan 07-07 / CAN-08 — hash-keyed echo suppression
        // for the plugin's `.yaml` companion writes. Shared with the
        // change-feed watcher above so a single set sees both write
        // pathways (writer, indexer, plugin).
        suppression,
        // CAN-08 D-WATCH-SERVER-NOTIFY — emit the external-edit MCP
        // Resource notification when (and only when) the gate is on.
        // The plugin's `ReloadNotifier` (plan 07-07 task 3) subscribes
        // via `notifications/resources/updated` for this URI and
        // prompts the user with a Modal.
        onExternalReload: config.plugin.enabled
          ? (file) => {
              try {
                server.server.notification({
                  method: "notifications/resources/updated",
                  params: {
                    uri: "vault-memory://contracts/reloaded",
                    // Body is non-standard for resources/updated but
                    // MCP clients ignore unknown params. Carrying the
                    // file path here saves the plugin a follow-up
                    // resource read in the common case.
                    _meta: { path: file, reason: "external_edit" },
                  },
                });
              } catch (err) {
                const msg = errorMessage(err);
                process.stderr.write(
                  `[contracts-reloaded-notify] ${vault.config.name}: ${msg}\n`,
                );
              }
            }
          : undefined,
        onRegistryChange: () => {
          if (config.contracts.auto_register_tools) {
            syncAutoRegistered(
              server,
              started.registry,
              config.contracts.tool_prefix,
              registeredHandles,
              { enabled: true, instantiateHandler },
            );
          }
        },
      });
    } catch (err) {
      const message = errorMessage(err);
      process.stderr.write(
        `[contract-registry:${vault.config.name}] start failed: ${message}\n`,
      );
      continue;
    }
    if (config.contracts.auto_register_tools) {
      syncAutoRegistered(
        server,
        started.registry,
        config.contracts.tool_prefix,
        registeredHandles,
        { enabled: true, instantiateHandler },
      );
    }
    contractRegistries.set(vault.config.name, {
      started,
      registered: registeredHandles,
    });
  }

  // ─── Phase 7 (Plan 07-04) — plugin-control MCP tools ─────────────────────
  //
  // Gated by `config.plugin.enabled` (default OFF). When false, zero plugin
  // tools register and `tools/list` is byte-equivalent to the v1-baseline
  // snapshot for non-plugin deployments (REL-08 ≤32-tool budget).
  //
  // The runtime-config store is owned at the serve() lifetime and threaded
  // into the `set_runtime_config` handler. Hot-swap mutations are NOT
  // persisted — `~/.vault-memory/config.toml` remains authoritative across
  // restarts (PLG-01 §"Hot-swap semantics").
  const runtimeConfigStore = new RuntimeConfigStore({});
  const pluginToolsRegistered = new Map<string, RegisteredTool>();
  // `reindexVault` shim — wraps the existing `indexVault` entry point so the
  // trigger_reindex tool is decoupled from the full indexer surface.
  const reindexVault = async (
    vaultName: string,
    onProgress?: (p: TriggerReindexProgress) => void,
  ): Promise<void> => {
    const v = manager.list().find((vt) => vt.config.name === vaultName);
    if (v === undefined) throw new Error(`unknown vault: ${vaultName}`);
    const embeddingModel = v.config.embedding_model ?? config.server.default_embedding_model ?? "qwen3-embedding";
    // Use a dynamic import to keep the indexer module out of the startup
    // critical path when the plugin gate is OFF.
    const { indexVault } = await import("./indexer/index.js");
    let lastReported = 0;
    await indexVault(v, {
      mode: "full",
      embeddingModel,
      ollama,
      onProgress: (_msg: string) => {
        // The current indexer onProgress signal is a free-text status line;
        // we increment a per-call counter as a coarse progress proxy. The
        // chrome can render that as "reindex in progress" until the call
        // resolves. A future indexer enhancement (out of scope for 07-04)
        // can replace this with structured progress events.
        lastReported += 1;
        onProgress?.({ progress: lastReported });
      },
    });
  };
  // Snapshot peer-MCP availability for get_runtime_stats.
  const peerMcpStatus = (): Array<{ name: string; available: boolean }> => {
    const out: Array<{ name: string; available: boolean }> = [];
    for (const name of Object.keys(config.contracts.mcp_clients)) {
      const client = peerMcpRegistry.get(name);
      out.push({ name, available: client?.available ?? false });
    }
    return out;
  };
  // Contract count per vault — reads from the live registry map populated above.
  const contractCountFor = (vaultName: string): number => {
    const state = contractRegistries.get(vaultName);
    if (state === undefined) return 0;
    let count = 0;
    for (const _ of state.started.registry.entries()) count += 1;
    return count;
  };
  syncPluginTools(server, pluginToolsRegistered, {
    enabled: config.plugin.enabled,
    runtimeConfig: runtimeConfigStore,
    configPath: configPath(),
    listVaults: () => manager.list() as never,
    peerMcpStatus,
    contractCountFor,
    reindexVault,
    // Plan 07-07 / CAN-08 — same shared instance the contract loader
    // sees, so the plugin's `suppress_contract_write` call and the
    // change-feed handler observe the same entries.
    suppression,
    // SOURCES-REGISTRY.md §6 (Stage 2) — live registry for refresh_source
    // + unset_mcp_client. The singleton booted above.
    sourceRegistry: peerMcpRegistry,
    notifier: (notification) => {
      // Forward to the underlying MCP server transport. The McpServer
      // wraps a low-level Server with `server.server`; the notification
      // method is exposed there.
      server.server.notification(notification);
    },
  });

  onPhase("connect_transport");
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Fire-and-forget — the MCP handshake is complete, tools are usable, and
  // catch-up runs in the background. Errors are already logged inside the
  // function; we still catch here to satisfy the linter and surface anything
  // unexpected on stderr.
  //
  // Plan 02-03b: `start_catchup` fires AFTER `register_memory_sinks` (the
  // sentinel-provisioning step above has already completed). The phase
  // hook fires synchronously so the bootstrap-order assertion in tests
  // can observe the invariant `register_memory_sinks` < `start_catchup`.
  onPhase("start_catchup");
  startCatchupAndWatchers().catch((err) => {
    const message = errorMessage(err);
    process.stderr.write(`[catchup] unexpected failure: ${message}\n`);
  });
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

function handleListVaults(manager: VaultManager): object {
  const vaults = manager.list().map((v) => {
    const noteCount = v.db.notes.countAll();
    const runs = v.db.audit.listRuns(1);
    const lastRun = runs[0];
    return {
      name: v.config.name,
      path: v.config.path,
      embedding_model: v.config.embedding_model ?? null,
      note_count: noteCount,
      write_enabled: v.config.write_enabled ?? false,
      last_run: lastRun
        ? {
            run_id: lastRun.run_id,
            started_at: lastRun.started_at,
            finished_at: lastRun.finished_at,
            error: lastRun.error,
          }
        : null,
    };
  });
  return { vaults, count: vaults.length };
}

/**
 * Read a note via the v2 SourceConnector seam (Plan 01-03 Task 06).
 *
 * The v1 wire shape `{path, title, content, frontmatter, hash, mtime,
 * word_count}` is preserved byte-for-byte; only the INTERNAL data path
 * changed: the handler now resolves the source by handle, mints a DocId,
 * and reads a Document via `source.readDocument(id)`. The mapping back
 * to the v1 shape happens at this boundary.
 *
 * Side effect: reads the file fresh from disk on every call (where v1
 * served the DB-cached row). In a normally-running server the catch-up
 * scan + watcher keep DB ≈ disk, so behavior is observationally
 * identical; the path goes through the seam either way.
 */
async function handleReadNote(
  registry: AdapterRegistry,
  vaultName: string,
  path: string,
): Promise<object> {
  const handle = parseSourceHandle(`obsidian-fs://${vaultName}`);
  let source;
  try {
    source = registry.resolveSource(handle);
  } catch {
    // Preserve the v1 error message shape for unknown-vault cases.
    throw new Error(`Note not found: ${vaultName}/${path}`);
  }
  const id = formatDocId("obsidian-fs", vaultName, path);
  let doc: Document;
  try {
    doc = await source.readDocument(id);
  } catch {
    throw new Error(`Note not found: ${vaultName}/${path}`);
  }

  // Map Document → v1 read_note response shape.
  // - `frontmatter` is `doc.properties` minus the adapter-injected
  //   `wikilinks: WikilinkRef[]` (D-05). The v1 shape never carried the
  //   wikilinks key; preserve that.
  const { wikilinks: _wikilinks, ...frontmatterOnly } = doc.properties as Record<
    string,
    unknown
  > & {
    wikilinks?: WikilinkRef[];
  };
  const hasFrontmatter = Object.keys(frontmatterOnly).length > 0;
  // Single-paragraph BodyShape="flat-text" — body lives in blocks[0].text.
  const content = doc.blocks[0]?.kind === "paragraph" ? doc.blocks[0].text : "";

  return {
    path,
    title: doc.title,
    content,
    frontmatter: hasFrontmatter ? frontmatterOnly : null,
    hash: doc.hash,
    mtime: doc.mtime,
    word_count: countWords(content),
  };
}

/**
 * write_note handler. Routes through `registry.resolveDelivery(handle).write`
 * (plan 01-04 task 06) while preserving the v1 wire shape: caller sees
 * `{ok, noteId, newHash, created, reason?, ...}`. The DocId mapping happens
 * at the seam — v2 returns doc_id: DocId; we derive v1 noteId from the DB
 * row after a successful write.
 *
 * The v1 `client_id` arg, when supplied, overrides the constructor-injected
 * default per D-02. When omitted, the delivery's lazy clientId getter reads
 * `server.getClientVersion()?.name` at call time.
 */
async function handleWriteNote(
  registry: AdapterRegistry,
  vault: Vault,
  parsed: {
    vault: string;
    path: string;
    content: string;
    frontmatter?: Record<string, unknown> | null;
    expected_hash?: string;
    client_id?: string;
  },
): Promise<object> {
  const handle = parseSourceHandle(`obsidian-fs://${parsed.vault}`);
  const delivery = registry.resolveDelivery(handle);
  const docId = formatDocId("obsidian-fs", parsed.vault, parsed.path);

  const partial: Partial<Document> = {
    blocks: [{ kind: "paragraph", text: parsed.content }],
    properties: parsed.frontmatter ?? {},
  };
  const opts: { expectedHash?: string; clientId?: string } = {};
  if (parsed.expected_hash !== undefined) opts.expectedHash = parsed.expected_hash;
  if (parsed.client_id !== undefined) opts.clientId = parsed.client_id;

  const res = await delivery.write(docId, partial, opts);
  if (!res.ok) {
    // Preserve v1 conflict shape — handlers used to forward writeNote's
    // v1 WriteConflict directly; reshape to match. Phase 2 envelope fields
    // (sinkName / suggestion) are propagated unchanged when present so
    // callers receive actionable diagnostics on `sink_write_blocked` and
    // the other Phase 2 refusal codes.
    const out: Record<string, unknown> = {
      ok: false,
      reason: res.reason === "not_found" ? "hash_mismatch" : res.reason,
    };
    if (res.currentHash !== undefined) out.currentHash = res.currentHash;
    if (res.message !== undefined) out.message = res.message;
    if (res.sinkName !== undefined) out.sinkName = res.sinkName;
    if (res.suggestion !== undefined) out.suggestion = res.suggestion;
    if (res.key !== undefined) out.key = res.key;
    if (res.observedValue !== undefined) out.observedValue = res.observedValue;
    return out;
  }

  // Derive v1 noteId from the DB. The write went through writeNote
  // internally which upserts the note; getByPath returns the row.
  const noteRow = vault.db.notes.getByPath(parsed.path);
  return {
    ok: true,
    newHash: res.newHash,
    noteId: noteRow?.id ?? 0,
    created: res.created,
  };
}

/**
 * delete_note handler. Routes through `registry.resolveDelivery(handle).delete`
 * (plan 01-04 task 06). Preserves the v1 wire shape `{ok, newHash, noteId,
 * created}` (created=false for delete; newHash echoes the now-gone file's
 * pre-delete hash, matching v1 deleteNote semantics).
 */
async function handleDeleteNote(
  registry: AdapterRegistry,
  vault: Vault,
  parsed: {
    vault: string;
    path: string;
    expected_hash: string;
    client_id?: string;
  },
): Promise<object> {
  // Capture the v1 noteId + existing hash BEFORE we ask the delivery to
  // delete (after success, getByPath returns null).
  const noteRow = vault.db.notes.getByPath(parsed.path);
  const preDeleteHash = noteRow?.hash ?? parsed.expected_hash;

  const handle = parseSourceHandle(`obsidian-fs://${parsed.vault}`);
  const delivery = registry.resolveDelivery(handle);
  const docId = formatDocId("obsidian-fs", parsed.vault, parsed.path);

  const opts: { expectedHash?: string; clientId?: string } = {
    expectedHash: parsed.expected_hash,
  };
  if (parsed.client_id !== undefined) opts.clientId = parsed.client_id;

  const res = await delivery.delete(docId, opts);
  if (!res.ok) {
    const out: Record<string, unknown> = {
      ok: false,
      reason: res.reason === "not_found" ? "hash_mismatch" : res.reason,
    };
    if (res.currentHash !== undefined) out.currentHash = res.currentHash;
    if (res.message !== undefined) out.message = res.message;
    if (res.sinkName !== undefined) out.sinkName = res.sinkName;
    if (res.suggestion !== undefined) out.suggestion = res.suggestion;
    return out;
  }
  return {
    ok: true,
    newHash: preDeleteHash,
    noteId: noteRow?.id ?? 0,
    created: false,
  };
}

/**
 * Mirror of the parser's countWords helper (currently
 * src/adapters/source/obsidian-fs/parser.ts) — duplicated here as a
 * single-call inline helper rather than widening that module's public API.
 */
async function handleSearchSemantic(
  manager: VaultManager,
  ollama: OllamaClient,
  defaultModel: string,
  activeVault: string | undefined,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  excludePaths: string[] | undefined,
): Promise<object> {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);

  if (targets.length === 0) {
    return {
      hits: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  // When excluding paths, fan out wider so the filtered topK is well-stocked.
  const hasExclude = excludePaths !== undefined && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;

  // Cache query embedding by model name across vaults.
  const embedCache = new Map<string, number[]>();
  const allHits: SearchHit[] = [];

  for (const vault of targets) {
    // Phase 7c follow-up (v0.7.2): the active model in the DB is the source
    // of truth — switch_active_model may have promoted a shadow model
    // that doesn't match config.embedding_model. Fall back to the config
    // only when no active model is registered yet.
    const model = vault.db.models.getActive();
    if (!model) continue;
    const modelName = model.name;

    let queryVec = embedCache.get(modelName);
    if (!queryVec) {
      const embedResp = await ollama.embed({ model: modelName, texts: [query] });
      queryVec = embedResp.vectors[0];
      if (!queryVec) continue;
      embedCache.set(modelName, queryVec);
    }

    const semanticHits = vault.db.embeddings.searchSemantic(model.id, queryVec, fanK);

    for (const hit of semanticHits) {
      const chunk = vault.db.chunks.getById(hit.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;
      if (hasExclude && matchesAnyGlob(note.path, excludePaths!)) continue;
      const score = 1 / (1 + hit.distance);

      allHits.push({
        vault: vault.config.name,
        notePath: note.path,
        noteTitle: note.title,
        chunkText: chunk.text,
        chunkIdx: chunk.idx,
        headingPath: chunk.heading_path,
        score,
        scoreBreakdown: { semantic: score },
      });
    }
  }

  allHits.sort((a, b) => b.score - a.score);
  const out: Record<string, unknown> = {
    hits: allHits.slice(0, topK),
    count: allHits.length,
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

function handleSearchText(
  manager: VaultManager,
  activeVault: string | undefined,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  excludePaths: string[] | undefined,
): object {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);

  if (targets.length === 0) {
    return {
      hits: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  const hasExclude = excludePaths !== undefined && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;

  const sanitized = FtsQueries.sanitize(query);
  const allHits: SearchHit[] = [];

  for (const vault of targets) {
    const ftsHits = vault.db.fts.search(sanitized, fanK, true);
    for (const hit of ftsHits) {
      const chunk = vault.db.chunks.getById(hit.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;
      if (hasExclude && matchesAnyGlob(note.path, excludePaths!)) continue;

      allHits.push({
        vault: vault.config.name,
        notePath: note.path,
        noteTitle: note.title,
        chunkText: hit.snippet ?? chunk.text,
        chunkIdx: chunk.idx,
        headingPath: chunk.heading_path,
        score: hit.score,
        scoreBreakdown: { text: hit.score },
      });
    }
  }

  allHits.sort((a, b) => b.score - a.score);
  const out: Record<string, unknown> = {
    hits: allHits.slice(0, topK),
    count: allHits.length,
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

async function handleSearchHybrid(
  manager: VaultManager,
  ollama: OllamaClient,
  defaultModel: string,
  activeVault: string | undefined,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  rrfK: number,
  excludePaths: string[] | undefined,
  reranker: Reranker | undefined,
  // Phase 3 / 03-05 additive params — D-07/D-08/ASM-07/ASM-08.
  recencyWeight: number = 0,
  authorityWeight: number = 0,
  halfLifeDays: number = 30,
  includeSuperseded: boolean = false,
  // Phase 3 / 03-05: optional display-URL resolver (ADR-002 §I-5b
  // seam-preserving — the URL literal lives in the adapter, not here).
  displayUrlFor?: (vaultName: string, notePath: string) => string,
  // Phase 4 / 04-04 (D-15): optional auto-expansion + its injected deps.
  // When `expand` is undefined, hybridSearch's guard short-circuits;
  // `expandDeps` is forwarded unconditionally so future per-call wiring
  // stays trivial.
  expandOpts?: {
    hops: 1 | 2;
    direction?: ExpandDirection;
    edge_types?: EdgeType[];
  },
  expandDeps?: ExpandDeps,
): Promise<object> {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);

  if (targets.length === 0) {
    return {
      hits: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  const hasExclude = excludePaths !== undefined && excludePaths.length > 0;
  // Request 3× the final topK when filtering so the post-filter list is
  // well-stocked. hybridSearch internally fans 3× again per ranking, so
  // semantic/BM25 each retrieve ~9×topK chunks — plenty of headroom.
  const innerTopK = hasExclude ? topK * 3 : topK;

  const hits = await hybridSearch({
    query,
    embeddingModel: defaultModel,
    ollama,
    vaults: targets,
    topK: innerTopK,
    rrfK,
    includeBreakdown: true,
    reranker,
    recencyWeight,
    authorityWeight,
    halfLifeDays,
    includeSuperseded,
    ...(displayUrlFor ? { displayUrlFor } : {}),
    // Phase 4 / 04-04 (D-15): forward optional expand + deps. When
    // `expandOpts` is undefined, hybridSearch short-circuits the
    // expand block (zero new DB reads — v1-baseline byte-identical).
    ...(expandOpts ? { expand: expandOpts } : {}),
    ...(expandDeps ? { expandDeps } : {}),
  });

  const filtered = hasExclude
    ? hits.filter((h) => !matchesAnyGlob(h.notePath, excludePaths!))
    : hits;

  const out: Record<string, unknown> = {
    hits: filtered.slice(0, topK),
    count: filtered.length,
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

// ─── v0.9.0 handlers — Agent-Compatibility & Self-Orientation ───────────────

/**
 * Encode an opaque id for the OB1-compatible `search`/`fetch` API.
 *
 * Format: `<vault>:<vault-relative-path>`
 *
 * Vault names cannot contain `:` per config schema, and Obsidian paths use
 * forward slashes — so the first `:` is an unambiguous separator. We pick
 * this over a base64-encoded blob because the id stays human-readable in
 * connector UIs (ChatGPT shows search results inline) and trivially
 * round-trips through copy/paste.
 */
async function handleSearchCompat(
  manager: VaultManager,
  registry: AdapterRegistry,
  ollama: OllamaClient,
  defaultModel: string,
  activeVault: string | undefined,
  query: string,
  limit: number,
  reranker: Reranker | undefined,
): Promise<object> {
  const { targets, skipped } = resolveVaultTargets(manager, undefined, activeVault);

  if (targets.length === 0) {
    return {
      results: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  // We delegate to the hybrid pipeline so OB1-style search benefits from
  // both BM25 and vector retrieval — this is the differentiator vs. OB1's
  // pure-embedding implementation.
  const hits = await hybridSearch({
    query,
    embeddingModel: defaultModel,
    ollama,
    vaults: targets,
    topK: limit,
    rrfK: 60,
    includeBreakdown: false,
    reranker,
  });

  // De-duplicate to one result per note (OB1 spec: one entry per
  // document). Chunks of the same note collapse to the first/best chunk
  // and contribute their snippet.
  const seen = new Set<string>();
  const results: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
  }> = [];
  for (const h of hits) {
    const noteKey = `${h.vault}:${h.notePath}`;
    if (seen.has(noteKey)) continue;
    seen.add(noteKey);
    results.push({
      id: encodeNoteId(h.vault, h.notePath),
      title: h.noteTitle ?? h.notePath,
      url: displayUrl(registry, h.vault, h.notePath),
      snippet: truncateSnippet(h.chunkText, 280),
    });
    if (results.length >= limit) break;
  }

  const out: Record<string, unknown> = { results };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

function handleFetchCompat(manager: VaultManager, registry: AdapterRegistry, id: string): object {
  const { vault: vaultName, path } = decodeNoteId(id);
  const vault = manager.require(vaultName);
  const note = vault.db.notes.getByPath(path);
  if (!note) {
    throw new Error(`Note not found: ${vaultName}/${path}`);
  }
  const metadata: Record<string, unknown> = {
    vault: vaultName,
    path: note.path,
    mtime: note.mtime,
    hash: note.hash,
    word_count: note.word_count,
  };
  if (note.frontmatter) {
    try {
      metadata.frontmatter = JSON.parse(note.frontmatter);
    } catch {
      // Stored frontmatter should always be valid JSON; if it isn't, treat
      // as missing rather than failing the fetch.
    }
  }
  return {
    id,
    title: note.title ?? note.path,
    text: note.content,
    url: displayUrl(registry, vaultName, note.path),
    metadata,
  };
}

interface VaultStatsRow {
  vault: string;
  vault_path: string;
  total_notes: number;
  total_words: number;
  embedding_model: string | null;
  indexed_at: number | null;
  top_tags: Array<{ tag: string; count: number }>;
  top_frontmatter_keys: Array<{ key: string; count: number }>;
}

function handleVaultStats(manager: VaultManager, vaultFilter: string | undefined): object {
  const targets = vaultFilter ? [manager.require(vaultFilter)] : manager.list();

  const stats: VaultStatsRow[] = targets.map((v) => {
    const total_notes = v.db.notes.countAll();
    const wordRow = v.db.handle
      .prepare<[], { total: number | null }>("SELECT SUM(word_count) AS total FROM notes")
      .get();
    const lastRun = v.db.audit.listRuns(1)[0];
    const activeModel = v.db.models.getActive();

    return {
      vault: v.config.name,
      vault_path: v.config.path,
      total_notes,
      total_words: wordRow?.total ?? 0,
      embedding_model: activeModel?.name ?? v.config.embedding_model ?? null,
      indexed_at: lastRun?.finished_at ?? null,
      top_tags: aggregateTopTags(v.db.handle, 10),
      top_frontmatter_keys: aggregateTopFrontmatterKeys(v.db.handle, 10),
    };
  });

  if (vaultFilter) {
    // `targets` is non-empty when vaultFilter is set, because manager.require
    // throws on miss — so stats[0] is guaranteed. The assertion narrows the
    // type for the caller.
    return stats[0] as VaultStatsRow;
  }
  return { vaults: stats, count: stats.length };
}

interface RecentNoteRow {
  vault: string;
  path: string;
  title: string | null;
  mtime: number;
  word_count: number | null;
  tags: string[] | null;
}

function handleRecentNotes(
  manager: VaultManager,
  vaultFilter: string | undefined,
  limit: number,
  since: number | undefined,
): object {
  const targets = vaultFilter ? [manager.require(vaultFilter)] : manager.list();

  const all: RecentNoteRow[] = [];
  for (const v of targets) {
    const rows =
      since !== undefined
        ? v.db.handle
            .prepare<
              [number, number],
              {
                path: string;
                title: string | null;
                mtime: number;
                word_count: number | null;
                frontmatter: string | null;
              }
            >(
              "SELECT path, title, mtime, word_count, frontmatter FROM notes WHERE mtime > ? ORDER BY mtime DESC LIMIT ?",
            )
            .all(since, limit)
        : v.db.handle
            .prepare<
              [number],
              {
                path: string;
                title: string | null;
                mtime: number;
                word_count: number | null;
                frontmatter: string | null;
              }
            >(
              "SELECT path, title, mtime, word_count, frontmatter FROM notes ORDER BY mtime DESC LIMIT ?",
            )
            .all(limit);

    for (const r of rows) {
      let tags: string[] | null = null;
      if (r.frontmatter) {
        try {
          const fm = JSON.parse(r.frontmatter) as { tags?: unknown };
          if (Array.isArray(fm.tags)) {
            tags = fm.tags.filter((t): t is string => typeof t === "string");
          }
        } catch {
          // ignore
        }
      }
      all.push({
        vault: v.config.name,
        path: r.path,
        title: r.title,
        mtime: r.mtime,
        word_count: r.word_count,
        tags,
      });
    }
  }

  // Cross-vault merge: re-sort by mtime and trim.
  all.sort((a, b) => b.mtime - a.mtime);
  return { notes: all.slice(0, limit), count: Math.min(all.length, limit) };
}

/**
 * Handler for the v0.10.0 `suggest_frontmatter` tool.
 *
 * Two-mode dispatch:
 *   - `path` provided → existing-note inference. Reads stored content +
 *     frontmatter + wikilinks from DB. Folder-conventions use the note's
 *     own folder.
 *   - `content` provided (no path) → draft inference. Folder-conventions
 *     use `folder_hint` (or vault root). No backlinks. Forward-link
 *     extraction would require a lightweight markdown parse — for v0.10.0
 *     we skip it to keep the tool dependency-free and document the
 *     limitation in the response.
 */
function handleSuggestFrontmatter(
  manager: VaultManager,
  parsed: {
    vault: string;
    path?: string;
    content?: string;
    title?: string;
    folder_hint?: string;
  },
): object {
  const vault = manager.require(parsed.vault);

  // Mode 1: existing-note path.
  if (parsed.path) {
    const note = vault.db.notes.getByPath(parsed.path);
    if (!note) {
      throw new Error(
        `Note not found: ${parsed.vault}/${parsed.path}. ` +
          `Use draft mode ({content, folder_hint}) for unindexed notes.`,
      );
    }
    const existingFm: Record<string, unknown> | null = note.frontmatter
      ? safeParseFrontmatter(note.frontmatter)
      : null;
    const result = suggestFrontmatter({
      vault,
      path: note.path,
      existingFrontmatter: existingFm,
      content: parsed.content ?? note.content,
      title: parsed.title ?? note.title ?? defaultBasename(note.path),
      excludePath: note.path,
    });
    return {
      mode: "existing",
      path: note.path,
      ...result,
    };
  }

  // Mode 2: draft.
  const folderHint = normalizeFolderHint(parsed.folder_hint);
  // Synthesize a path under the folder hint so folder-conventions can
  // resolve. The path itself never gets written; it's a probe.
  const probePath = `${folderHint}__draft__${Date.now()}.md`;
  const result = suggestFrontmatter({
    vault,
    path: probePath,
    existingFrontmatter: null,
    content: parsed.content!,
    title: parsed.title ?? "Draft",
    // Exclude the synthetic path explicitly — though it won't match any
    // existing note, this future-proofs against collisions.
    excludePath: probePath,
  });
  return {
    mode: "draft",
    folder_hint: folderHint,
    note: "Draft mode: no backlinks contributed. Provide `path` (and index the note first) for richer neighbor-inference.",
    ...result,
  };
}


