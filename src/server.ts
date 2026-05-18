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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type BetterSqlite3 from "better-sqlite3";
import { loadConfig } from "./config/index.js";
import { VaultManager } from "./vault/index.js";
import type { Vault } from "./vault/index.js";
import { OllamaClient } from "./ollama/index.js";
import { FtsQueries } from "./db/index.js";
import { hybridSearch, matchesAnyGlob } from "./search/index.js";
import { OllamaReranker, OnnxReranker } from "./rerank/index.js";
import type { Reranker } from "./rerank/index.js";
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
  type MemorySinkConfig,
} from "./memory/index.js";
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
        const message = err instanceof Error ? err.message : String(err);
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
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[brief-daemon:${vault.config.name}] start failed: ${message}\n`,
          );
        }
      }
    }
  };

  const shutdown = async (): Promise<void> => {
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
        const message = err instanceof Error ? err.message : String(err);
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

  // ─── registerTool × 23 (SDK 1.29, plan 01-05 task 07) ─────────────────────
  //
  // Each handler receives ALREADY-VALIDATED args (the SDK runs the Zod
  // schema before invoking us). We layer a try/catch to convert thrown
  // errors into MCP error responses, preserving the v1 error shape.

  type Handler = (args: unknown) => Promise<object>;

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
          const message = err instanceof Error ? err.message : String(err);
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
    const message = err instanceof Error ? err.message : String(err);
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
function countWords(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}

/**
 * Resolve which vaults a search should hit.
 *
 * Scope resolution (priority highest first):
 *   1. Explicit `vaultFilter` from the request → exactly those vaults.
 *   2. `activeVault` from VAULT_MEMORY_ACTIVE_VAULT env var → just that one.
 *   3. Neither set → all configured vaults (legacy behaviour).
 *
 * Indexing-status filter:
 *   - Vaults whose audit log shows an unfinished index run are excluded
 *     ONLY when the caller didn't ask for them explicitly. Idea: implicit
 *     cross-vault search shouldn't surface chunks whose embeddings aren't
 *     ready yet. Explicit single-vault requests pass through unchanged
 *     (caller takes responsibility, gets a `note` field in the response).
 *
 * Returns the resolved targets plus the names of any skipped vaults, so the
 * caller can include a transparency note in the response.
 */
function resolveVaultTargets(
  manager: VaultManager,
  vaultFilter: string[] | undefined,
  activeVault: string | undefined,
): { targets: ReturnType<VaultManager["list"]>; skipped: string[] } {
  // Explicit request → honour even if mid-index (caller's choice).
  if (vaultFilter) {
    return { targets: vaultFilter.map((n) => manager.require(n)), skipped: [] };
  }
  const candidates = activeVault ? [manager.require(activeVault)] : manager.list();
  const targets: typeof candidates = [];
  const skipped: string[] = [];
  for (const v of candidates) {
    if (v.db.audit.isIndexing()) {
      skipped.push(v.config.name);
    } else {
      targets.push(v);
    }
  }
  return { targets, skipped };
}

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
export function encodeNoteId(vault: string, path: string): string {
  return `${vault}:${path}`;
}

export function decodeNoteId(id: string): { vault: string; path: string } {
  const idx = id.indexOf(":");
  if (idx <= 0 || idx === id.length - 1) {
    throw new Error(`Invalid id: ${id}. Expected format <vault>:<vault-relative-path>.`);
  }
  return { vault: id.slice(0, idx), path: id.slice(idx + 1) };
}

/**
 * D-01 (plan 01-04 task 06): the v1 `obsidianUrl(vault, path)` helper was
 * deleted. Display URLs now flow through `SourceConnector.formatDisplayUrl`
 * — the obsidian-fs source mints the same `obsidian://open?vault=X&file=Y`
 * URL string byte-for-byte (verified: same `encodeURIComponent`-per-segment
 * encoding scheme; documented in `.planning/phases/01-…/01-04-SUMMARY.md`
 * §"URL encoding parity"). Future adapters (notion-api etc.) can publish
 * their own display URLs without changing core code.
 *
 * The internal helper `displayUrl(registry, vault, path)` below is the
 * routing shim; it resolves the source and delegates.
 */
function displayUrl(registry: AdapterRegistry, vaultName: string, notePath: string): string {
  const source = registry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`));
  const docId = formatDocId("obsidian-fs", vaultName, notePath);
  // `formatDisplayUrl` is optional on the SourceConnector interface; for
  // future adapters that don't expose one, fall back to the raw doc_uri.
  return source.formatDisplayUrl?.(docId) ?? `obsidian-fs://${vaultName}/${notePath}`;
}

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

export function truncateSnippet(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
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

/**
 * Aggregate the top-N tags across all notes in a vault.
 *
 * Tags can live in two places in our schema: a top-level `tags` array in
 * frontmatter (Obsidian convention) or inline `#tag` hashtags in the body.
 * For v0.9.0 we read the frontmatter form only — it is what the user
 * curates explicitly and what other tools (Datacore queries, dataview)
 * already aggregate. Inline hashtags would need a separate pass through
 * note bodies and are deferred until users ask for it.
 *
 * Implementation uses SQLite's json_each over the stored frontmatter blob.
 * `frontmatter` is TEXT containing a JSON object; we look up the `tags` key
 * and iterate. Notes without frontmatter or without a tags array are
 * silently skipped.
 */
export function aggregateTopTags(
  db: BetterSqlite3.Database,
  limit: number,
): Array<{ tag: string; count: number }> {
  // Real vaults accumulate frontmatter drift: `tags` may be an array,
  // a single string, a nested object, or missing entirely. SQLite's
  // json_each() throws on non-array/object inputs and aborts the whole
  // query — so we pre-filter to rows where `tags` is actually an array.
  // The CROSS JOIN with the JSON table then only sees well-formed inputs.
  const rows = db
    .prepare<[number], { tag: string; count: number }>(
      `
      SELECT je.value AS tag, COUNT(*) AS count
      FROM notes
      JOIN json_each(json_extract(notes.frontmatter, '$.tags')) AS je
      WHERE notes.frontmatter IS NOT NULL
        AND json_type(notes.frontmatter, '$.tags') = 'array'
        AND typeof(je.value) = 'text'
      GROUP BY je.value
      ORDER BY count DESC, tag ASC
      LIMIT ?
    `,
    )
    .all(limit);
  return rows;
}

/**
 * Aggregate the top-N most common frontmatter keys across all notes.
 * Surfaces the user's schema conventions to an agent on first connect.
 */
export function aggregateTopFrontmatterKeys(
  db: BetterSqlite3.Database,
  limit: number,
): Array<{ key: string; count: number }> {
  // Same filter rationale as aggregateTopTags: a single note with a
  // non-object frontmatter blob (rare, but happens after manual edits)
  // would abort the whole aggregate.
  const rows = db
    .prepare<[number], { key: string; count: number }>(
      `
      SELECT je.key AS key, COUNT(*) AS count
      FROM notes
      JOIN json_each(notes.frontmatter) AS je
      WHERE notes.frontmatter IS NOT NULL
        AND json_type(notes.frontmatter) = 'object'
      GROUP BY je.key
      ORDER BY count DESC, key ASC
      LIMIT ?
    `,
    )
    .all(limit);
  return rows;
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

function safeParseFrontmatter(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function defaultBasename(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

function normalizeFolderHint(hint: string | undefined): string {
  if (!hint) return "";
  let h = hint.trim();
  // Strip leading slash; ensure trailing slash if non-empty.
  if (h.startsWith("/")) h = h.slice(1);
  if (h.length > 0 && !h.endsWith("/")) h = `${h}/`;
  return h;
}

// ─── Response helpers ────────────────────────────────────────────────────────

function ok(data: object): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResponse(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/**
 * Structured `isError: true` response — the JSON payload is stringified
 * into the single `text` content block. Used by Phase 3 assembly tools
 * for the `{error: "doc_not_found", doc_id}` contract (plan 03-02).
 * Distinct from `errorResponse` (free-text) so callers can pattern-match
 * `JSON.parse(content[0].text).error === "doc_not_found"`.
 */
function errorResponseJson(payload: object): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}
