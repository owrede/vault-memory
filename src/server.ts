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
import { listBacklinks, listForwardLinks, findBrokenLinks } from "./graph/index.js";
import { queryFrontmatter, updateFrontmatter } from "./frontmatter/index.js";
import { suggestFrontmatter } from "./schema/index.js";
import { ObsidianFsDelivery } from "./adapters/delivery/obsidian-fs/index.js";
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
import { AdapterRegistry, formatDocId, parseSourceHandle } from "./adapters/registry.js";
import { ObsidianFsSource } from "./adapters/source/obsidian-fs/index.js";

const VERSION = "1.0.0";

// ─── Server bootstrap ────────────────────────────────────────────────────────

export async function serve(): Promise<void> {
  const config = await loadConfig();
  const manager = new VaultManager();
  await manager.loadAll(config.vaults);

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
  // spec field), the fallback is "unknown" — explicitly NOT "claude-code"
  // (the C-1 Claude-leak removed in task 02). RESEARCH Pitfall 4.
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

    const delivery = new ObsidianFsDelivery(vault, getClientId);
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
    }
  };

  const shutdown = async (): Promise<void> => {
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
    { capabilities: { tools: {} } },
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
      };
      const vault = manager.require(p.vault);
      const entries = getAuditLog({
        vault,
        notePath: p.note_path,
        op: p.op,
        since: p.since,
        limit: p.limit,
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
    // schema (`buildToolSchema`) for the cross-field check.
    const needsRefinementCheck = name === "suggest_frontmatter";
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
          const message = err instanceof Error ? err.message : String(err);
          return errorResponse(message);
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Fire-and-forget — the MCP handshake is complete, tools are usable, and
  // catch-up runs in the background. Errors are already logged inside the
  // function; we still catch here to satisfy the linter and surface anything
  // unexpected on stderr.
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
    // v1 WriteConflict directly; reshape to match.
    const out: Record<string, unknown> = {
      ok: false,
      reason: res.reason === "not_found" ? "hash_mismatch" : res.reason,
    };
    if (res.currentHash !== undefined) out.currentHash = res.currentHash;
    if (res.message !== undefined) out.message = res.message;
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
