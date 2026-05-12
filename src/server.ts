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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { loadConfig } from "./config/index.js";
import { VaultManager } from "./vault/index.js";
import { OllamaClient } from "./ollama/index.js";
import { FtsQueries } from "./db/index.js";
import { hybridSearch, matchesAnyGlob } from "./search/index.js";
import { OllamaReranker, OnnxReranker } from "./rerank/index.js";
import type { Reranker } from "./rerank/index.js";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import {
  listBacklinks,
  listForwardLinks,
  findBrokenLinks,
} from "./graph/index.js";
import { queryFrontmatter, updateFrontmatter } from "./frontmatter/index.js";
import { suggestFrontmatter } from "./schema/index.js";
import { writeNote, deleteNote } from "./write/index.js";
import { getAuditLog, getIndexRuns } from "./audit/index.js";
import { SuppressionSet, VaultWatcher } from "./watcher/index.js";
import {
  catchupVault,
  listModels,
  startShadowIndex,
  switchActiveModel,
  vacuumEmbeddings,
} from "./indexer/index.js";
import type { SearchHit } from "./types.js";

const VERSION = "0.10.0";

// ─── Tool Input Schemas ──────────────────────────────────────────────────────

const ReadNoteArgs = z.object({
  vault: z.string(),
  path: z.string(),
});

const SearchArgs = z.object({
  query: z.string().min(1),
  vaults: z.array(z.string()).optional(),
  top_k: z.number().int().positive().max(100).optional().default(10),
  /** Glob patterns of vault-relative paths to exclude from results. Useful
   *  for filtering self-referential notes (e.g. an eval note that lists
   *  the same keywords it's testing) or auxiliary indices. */
  exclude_paths: z.array(z.string()).optional(),
});

const HybridSearchArgs = SearchArgs.extend({
  rrf_k: z.number().int().positive().max(1000).optional().default(60),
  /** When true AND a `reranker_model` is configured, runs a cross-encoder
   *  rerank pass over the top candidates. Silently ignored otherwise. */
  rerank: z.boolean().optional().default(false),
});

const VaultPathArgs = z.object({
  vault: z.string(),
  path: z.string(),
});

const ForwardLinksArgs = VaultPathArgs.extend({
  include_broken: z.boolean().optional().default(true),
});

const FindBrokenLinksArgs = z.object({
  vault: z.string(),
});

const PredicateSchema: z.ZodType<unknown> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ $in: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])) }),
  z.object({ $exists: z.boolean() }),
  z.object({ $contains: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
]);

const QueryFrontmatterArgs = z.object({
  vault: z.string(),
  where: z.record(z.string(), PredicateSchema),
  limit: z.number().int().positive().max(1000).optional().default(100),
});

// ─── Phase 3 input schemas ──────────────────────────────────────────────────

const WriteNoteArgs = z.object({
  vault: z.string(),
  path: z.string(),
  content: z.string(),
  frontmatter: z.record(z.string(), z.unknown()).nullable().optional(),
  expected_hash: z.string().optional(),
  client_id: z.string().optional(),
});

const UpdateFrontmatterArgs = z.object({
  vault: z.string(),
  path: z.string(),
  merge: z.record(z.string(), z.unknown()),
  expected_hash: z.string().optional(),
  client_id: z.string().optional(),
});

const DeleteNoteArgs = z.object({
  vault: z.string(),
  path: z.string(),
  expected_hash: z.string(),
  client_id: z.string().optional(),
});

const AuditLogArgs = z.object({
  vault: z.string(),
  note_path: z.string().optional(),
  op: z.enum(["create", "update", "delete"]).optional(),
  since: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(1000).optional().default(50),
});

const IndexRunsArgs = z.object({
  vault: z.string(),
  limit: z.number().int().positive().max(200).optional().default(20),
});

// ─── Phase 7c — shadow-indexing / model switch ──────────────────────────────

const ListModelsArgs = z.object({
  vault: z.string(),
});

const StartShadowIndexArgs = z.object({
  vault: z.string(),
  model: z.string().min(1),
  batch_size: z.number().int().positive().max(256).optional(),
});

const SwitchActiveModelArgs = z.object({
  vault: z.string(),
  model_name: z.string().min(1),
});

const VacuumEmbeddingsArgs = z.object({
  vault: z.string(),
});

// ─── v0.9.0 — Agent-Compatibility & Self-Orientation ────────────────────────
//
// `search` / `fetch` follow the OB1 / ChatGPT-Connector / Claude.ai
// Deep-Research tool spec: a flat shape with opaque `id`s. The `id` here
// encodes `<vault>:<notePath>` so `fetch(id)` can deterministically resolve
// back to the underlying note without round-tripping a separate vault arg.

const SearchCompatArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional().default(10),
});

const FetchCompatArgs = z.object({
  id: z.string().min(1),
});

const VaultStatsArgs = z.object({
  vault: z.string().optional(),
});

const RecentNotesArgs = z.object({
  vault: z.string().optional(),
  limit: z.number().int().positive().max(200).optional().default(20),
  since: z.number().int().nonnegative().optional(),
});

// ─── v0.10.0 — suggest_frontmatter ───────────────────────────────────────────
//
// Two input modes:
//   1. Existing note: {vault, path} — tool reads the note from DB, runs
//      folder + neighbor + (optional) content inference.
//   2. Draft note: {vault, content, folder_hint?} — tool uses folder_hint
//      (or extracts from title) for folder-inference and the parsed
//      content for heuristics. Useful for /import-person, /log-fact-style
//      flows where the note isn't written yet.
//
// At least one of `path` or `content` must be present.

const SuggestFrontmatterArgs = z
  .object({
    vault: z.string(),
    path: z.string().optional(),
    content: z.string().optional(),
    title: z.string().optional(),
    folder_hint: z.string().optional(),
  })
  .refine((v) => v.path !== undefined || v.content !== undefined, {
    message: "suggest_frontmatter requires either `path` or `content`",
  });

// ─── Server bootstrap ────────────────────────────────────────────────────────

export async function serve(): Promise<void> {
  const config = await loadConfig();
  const manager = new VaultManager();
  await manager.loadAll(config.vaults);

  const ollama = new OllamaClient({
    endpoint: config.server.ollama_endpoint,
  });

  const defaultModel =
    config.server.default_embedding_model ?? "qwen3-embedding:0.6b";

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
    config.server.reranker_backend ??
    (config.server.reranker_model ? "onnx" : undefined);
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
  // One SuppressionSet shared by all vaults (paths are vault-relative; the
  // chance of a collision across vaults is negligible and a false positive
  // just means one event is dropped — harmless).
  const suppression = new SuppressionSet({ ttlMs: 2000 });
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
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  const server = new Server(
    { name: "vault-memory", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_vaults",
        description:
          "List configured vaults with their status (note count, last indexed run).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "read_note",
        description:
          "Read the full content + frontmatter of a note by its vault-relative path.",
        inputSchema: {
          type: "object",
          required: ["vault", "path"],
          properties: {
            vault: { type: "string", description: "Configured vault name" },
            path: {
              type: "string",
              description:
                "Vault-relative path with forward slashes, ending in .md",
            },
          },
        },
      },
      {
        name: "search_semantic",
        description:
          "Semantic search via embedding cosine similarity. Searches all vaults by default.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            vaults: { type: "array", items: { type: "string" } },
            top_k: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 10,
            },
            exclude_paths: {
              type: "array",
              items: { type: "string" },
              description:
                "Glob patterns (e.g. '_research/eval.md', '**/index.md') of paths to exclude.",
            },
          },
        },
      },
      {
        name: "search_text",
        description:
          "Full-text BM25 search via SQLite FTS5. Best for exact-word and phrase matches.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description:
                "FTS5 query — whitespace-separated tokens are AND'd; use OR explicitly.",
            },
            vaults: { type: "array", items: { type: "string" } },
            top_k: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 10,
            },
            exclude_paths: {
              type: "array",
              items: { type: "string" },
              description: "Glob patterns of paths to exclude.",
            },
          },
        },
      },
      {
        name: "search_hybrid",
        description:
          "Hybrid search: combines semantic (embedding) and BM25 (full-text) results via Reciprocal Rank Fusion. Best general-purpose query.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            vaults: { type: "array", items: { type: "string" } },
            top_k: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 10,
            },
            rrf_k: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
              default: 60,
              description:
                "RRF constant — higher dampens emphasis on top ranks.",
            },
            exclude_paths: {
              type: "array",
              items: { type: "string" },
              description: "Glob patterns of paths to exclude.",
            },
            rerank: {
              type: "boolean",
              default: false,
              description:
                "Apply a cross-encoder rerank over the top candidates. Requires `reranker_model` in server config; silently ignored otherwise.",
            },
          },
        },
      },
      {
        name: "list_backlinks",
        description: "Find all notes that link TO a given note.",
        inputSchema: {
          type: "object",
          required: ["vault", "path"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" },
          },
        },
      },
      {
        name: "list_forward_links",
        description:
          "List all wikilinks FROM a given note. Optionally include broken links.",
        inputSchema: {
          type: "object",
          required: ["vault", "path"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" },
            include_broken: { type: "boolean", default: true },
          },
        },
      },
      {
        name: "find_broken_links",
        description: "List all wikilinks in a vault that point to non-existent notes.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: { vault: { type: "string" } },
        },
      },
      {
        name: "query_frontmatter",
        description:
          "Filter notes by their YAML frontmatter. Supports equality, $in, $exists, $contains predicates. Multiple keys are AND-combined.",
        inputSchema: {
          type: "object",
          required: ["vault", "where"],
          properties: {
            vault: { type: "string" },
            where: {
              type: "object",
              description:
                "Field-name → predicate map. Predicate is a scalar (equality) or { $in: [...] } | { $exists: bool } | { $contains: scalar }.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
              default: 100,
            },
          },
        },
      },
      {
        name: "write_note",
        description:
          "Atomically create or overwrite a note. Requires write_enabled=true. Use expected_hash for safe overwrites (read the note first, pass its hash). Omit expected_hash only when creating a new note.",
        inputSchema: {
          type: "object",
          required: ["vault", "path", "content"],
          properties: {
            vault: { type: "string" },
            path: {
              type: "string",
              description: "Vault-relative .md path, forward slashes.",
            },
            content: {
              type: "string",
              description: "Markdown body WITHOUT --- frontmatter delimiters.",
            },
            frontmatter: {
              type: ["object", "null"],
              description: "Optional frontmatter object. Set null to write no frontmatter block.",
            },
            expected_hash: {
              type: "string",
              description: "Required for overwrites — get it from read_note.",
            },
            client_id: { type: "string" },
          },
        },
      },
      {
        name: "update_frontmatter",
        description:
          "Modify a note's frontmatter only. The body is preserved bytegenau. Merge DSL: scalar=set, {$unset:true}=delete, {$push:x}=array append, {$pull:x}=array remove.",
        inputSchema: {
          type: "object",
          required: ["vault", "path", "merge"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" },
            merge: {
              type: "object",
              description:
                "Field → value | {$unset:bool} | {$push:scalar} | {$pull:scalar}",
            },
            expected_hash: { type: "string" },
            client_id: { type: "string" },
          },
        },
      },
      {
        name: "delete_note",
        description:
          "Delete a note. Requires write_enabled=true AND expected_hash (no blind deletes).",
        inputSchema: {
          type: "object",
          required: ["vault", "path", "expected_hash"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" },
            expected_hash: { type: "string" },
            client_id: { type: "string" },
          },
        },
      },
      {
        name: "audit_log",
        description:
          "Query the write audit trail for a vault. Filterable by note path, operation type, or time. Default limit 50.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: {
            vault: { type: "string" },
            note_path: { type: "string" },
            op: { type: "string", enum: ["create", "update", "delete"] },
            since: {
              type: "integer",
              description: "Epoch ms — entries at or after this timestamp.",
            },
            limit: { type: "integer", minimum: 1, maximum: 1000, default: 50 },
          },
        },
      },
      {
        name: "list_models",
        description:
          "List all embedding models registered for a vault, with dim, " +
          "active flag, and how many chunks have been embedded under each. " +
          "Use before start_shadow_index / switch_active_model.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: { vault: { type: "string" } },
        },
      },
      {
        name: "start_shadow_index",
        description:
          "Backfill embeddings for a secondary (shadow) model over every " +
          "chunk in the vault. The active model is untouched — search keeps " +
          "working during the run. Idempotent (resumable). Run " +
          "switch_active_model once complete to promote the shadow.",
        inputSchema: {
          type: "object",
          required: ["vault", "model"],
          properties: {
            vault: { type: "string" },
            model: {
              type: "string",
              description: "Ollama model name, e.g. 'bge-m3' or 'embeddinggemma'.",
            },
            batch_size: {
              type: "integer",
              minimum: 1,
              maximum: 256,
              description: "Embed batch size — default 16.",
            },
          },
        },
      },
      {
        name: "switch_active_model",
        description:
          "Atomically promote a registered model to active. Fails with " +
          "ok:false / reason:'incomplete' if any chunk is missing a shadow " +
          "embedding for the target model.",
        inputSchema: {
          type: "object",
          required: ["vault", "model_name"],
          properties: {
            vault: { type: "string" },
            model_name: { type: "string" },
          },
        },
      },
      {
        name: "vacuum_embeddings",
        description:
          "Drop orphaned embedding rows whose chunk_id no longer exists in " +
          "the chunks table. Safe and idempotent; does not touch live data. " +
          "Useful after migrations from pre-v0.7.0 schemas where chunk " +
          "deletion did not always cascade to the derived layer.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: { vault: { type: "string" } },
        },
      },
      {
        name: "index_runs",
        description:
          "List recent index runs for a vault — what was scanned, when, how long, errors.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: {
            vault: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
          },
        },
      },
      {
        name: "search",
        description:
          "OB1-compatible search adapter. Returns a flat list of {id, title, url, snippet} for connector ecosystems (ChatGPT Custom Connectors, Claude.ai, Deep-Research). Backed by hybrid (semantic+BM25+RRF) search. For richer output use search_hybrid.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
      {
        name: "fetch",
        description:
          "OB1-compatible fetch adapter. Resolves an opaque id (from `search`) to {id, title, text, url, metadata}. Backed by read_note.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string",
              description: "Opaque id from `search` results, format: <vault>:<vault-relative-path>",
            },
          },
        },
      },
      {
        name: "vault_stats",
        description:
          "Vault overview for agent self-orientation: note/word counts, top tags, top frontmatter keys, embedding model, last index run. Omit `vault` to get all configured vaults.",
        inputSchema: {
          type: "object",
          properties: {
            vault: { type: "string", description: "Optional. Omit for all vaults." },
          },
        },
      },
      {
        name: "recent_notes",
        description:
          "List recently modified notes (mtime DESC). Use for agent self-orientation: 'what has the user been working on lately?'. No vector search, just SQL.",
        inputSchema: {
          type: "object",
          properties: {
            vault: { type: "string", description: "Optional. Omit for all vaults." },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
            since: {
              type: "integer",
              description: "Optional unix-ms threshold. Only notes with mtime > since.",
            },
          },
        },
      },
      {
        name: "suggest_frontmatter",
        description:
          "Suggest frontmatter fields for a note based on folder-conventions, wikilink-neighborhood, and title/body content-heuristics. Returns {existing, suggestions, conflicts}. Two input modes: (1) existing note via {path}; (2) draft via {content, folder_hint, title}. At least one of path/content required. Suggestions sorted by confidence DESC; conflicts list disagreements between sources.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: {
            vault: { type: "string" },
            path: {
              type: "string",
              description:
                "Vault-relative path. Required for existing-note mode; for drafts, pass content instead (folder_hint controls folder-inference).",
            },
            content: {
              type: "string",
              description:
                "Draft markdown body. When set, content-heuristics layer runs. If path is set AND content is omitted, the existing note's stored content is used.",
            },
            title: {
              type: "string",
              description:
                "Title for content-heuristics. Falls back to path basename or first heading.",
            },
            folder_hint: {
              type: "string",
              description:
                "For draft mode: the target folder (e.g. 'Personen/'). Ignored when `path` is set.",
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "list_vaults":
          return ok(handleListVaults(manager));

        case "read_note": {
          const parsed = ReadNoteArgs.parse(args ?? {});
          return ok(handleReadNote(manager, parsed.vault, parsed.path));
        }

        case "search_semantic": {
          const parsed = SearchArgs.parse(args ?? {});
          return ok(
            await handleSearchSemantic(
              manager,
              ollama,
              defaultModel,
              activeVault,
              parsed.query,
              parsed.vaults,
              parsed.top_k,
              parsed.exclude_paths,
            ),
          );
        }

        case "search_text": {
          const parsed = SearchArgs.parse(args ?? {});
          return ok(
            handleSearchText(
              manager,
              activeVault,
              parsed.query,
              parsed.vaults,
              parsed.top_k,
              parsed.exclude_paths,
            ),
          );
        }

        case "search_hybrid": {
          const parsed = HybridSearchArgs.parse(args ?? {});
          return ok(
            await handleSearchHybrid(
              manager,
              ollama,
              defaultModel,
              activeVault,
              parsed.query,
              parsed.vaults,
              parsed.top_k,
              parsed.rrf_k,
              parsed.exclude_paths,
              parsed.rerank ? reranker : undefined,
            ),
          );
        }

        case "list_backlinks": {
          const parsed = VaultPathArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          return ok({ backlinks: listBacklinks(vault, parsed.path) });
        }

        case "list_forward_links": {
          const parsed = ForwardLinksArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          return ok({
            links: listForwardLinks(vault, parsed.path, parsed.include_broken),
          });
        }

        case "find_broken_links": {
          const parsed = FindBrokenLinksArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          return ok({ broken: findBrokenLinks(vault) });
        }

        case "query_frontmatter": {
          const parsed = QueryFrontmatterArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const hits = queryFrontmatter(vault, {
            where: parsed.where as Record<string, never>,
            limit: parsed.limit,
          });
          return ok({
            notes: hits.map((n) => ({
              path: n.path,
              title: n.title,
              frontmatter: n.frontmatter ? JSON.parse(n.frontmatter) : null,
              mtime: n.mtime,
            })),
            count: hits.length,
          });
        }

        case "write_note": {
          const parsed = WriteNoteArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          // Suppress the watcher event triggered by our own atomic rename.
          // The hook fires inside writeNote() ONLY if the write actually
          // happens (no permission/hash conflict), so a failed write never
          // accidentally masks a real external edit shortly after.
          const result = await writeNote({
            vault,
            relativePath: parsed.path,
            content: parsed.content,
            frontmatter: parsed.frontmatter ?? null,
            expectedHash: parsed.expected_hash,
            clientId: parsed.client_id,
            onBeforeFsWrite: () => suppression.add(parsed.path),
          });
          return ok(result);
        }

        case "update_frontmatter": {
          const parsed = UpdateFrontmatterArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const result = await updateFrontmatter({
            vault,
            relativePath: parsed.path,
            merge: parsed.merge,
            expectedHash: parsed.expected_hash,
            clientId: parsed.client_id,
            onBeforeFsWrite: () => suppression.add(parsed.path),
          });
          return ok(result);
        }

        case "delete_note": {
          const parsed = DeleteNoteArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const result = await deleteNote({
            vault,
            relativePath: parsed.path,
            expectedHash: parsed.expected_hash,
            clientId: parsed.client_id,
            onBeforeFsWrite: () => suppression.add(parsed.path),
          });
          return ok(result);
        }

        case "audit_log": {
          const parsed = AuditLogArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const entries = getAuditLog({
            vault,
            notePath: parsed.note_path,
            op: parsed.op,
            since: parsed.since,
            limit: parsed.limit,
          });
          return ok({ entries, count: entries.length });
        }

        case "list_models": {
          const parsed = ListModelsArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const models = listModels(vault);
          return ok({ models, count: models.length });
        }

        case "start_shadow_index": {
          const parsed = StartShadowIndexArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const result = await startShadowIndex({
            vault,
            model: parsed.model,
            ollama,
            batchSize: parsed.batch_size,
            log: (m) =>
              process.stderr.write(`[shadow:${vault.config.name}] ${m}\n`),
          });
          return ok(result);
        }

        case "switch_active_model": {
          const parsed = SwitchActiveModelArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const result = switchActiveModel(vault, parsed.model_name);
          return ok(result);
        }

        case "vacuum_embeddings": {
          const parsed = VacuumEmbeddingsArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const result = vacuumEmbeddings(vault);
          return ok(result);
        }

        case "index_runs": {
          const parsed = IndexRunsArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const runs = getIndexRuns({ vault, limit: parsed.limit });
          return ok({ runs, count: runs.length });
        }

        case "search": {
          const parsed = SearchCompatArgs.parse(args ?? {});
          return ok(
            await handleSearchCompat(
              manager,
              ollama,
              defaultModel,
              activeVault,
              parsed.query,
              parsed.limit,
              reranker,
            ),
          );
        }

        case "fetch": {
          const parsed = FetchCompatArgs.parse(args ?? {});
          return ok(handleFetchCompat(manager, parsed.id));
        }

        case "vault_stats": {
          const parsed = VaultStatsArgs.parse(args ?? {});
          return ok(handleVaultStats(manager, parsed.vault));
        }

        case "recent_notes": {
          const parsed = RecentNotesArgs.parse(args ?? {});
          return ok(
            handleRecentNotes(
              manager,
              parsed.vault,
              parsed.limit,
              parsed.since,
            ),
          );
        }

        case "suggest_frontmatter": {
          const parsed = SuggestFrontmatterArgs.parse(args ?? {});
          return ok(handleSuggestFrontmatter(manager, parsed));
        }

        default:
          return errorResponse(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message);
    }
  });

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

function handleReadNote(
  manager: VaultManager,
  vaultName: string,
  path: string,
): object {
  const vault = manager.require(vaultName);
  const note = vault.db.notes.getByPath(path);
  if (!note) {
    throw new Error(`Note not found: ${vaultName}/${path}`);
  }
  return {
    path: note.path,
    title: note.title,
    content: note.content,
    frontmatter: note.frontmatter ? JSON.parse(note.frontmatter) : null,
    hash: note.hash,
    mtime: note.mtime,
    word_count: note.word_count,
  };
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

    const semanticHits = vault.db.embeddings.searchSemantic(
      model.id,
      queryVec,
      fanK,
    );

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
    throw new Error(
      `Invalid id: ${id}. Expected format <vault>:<vault-relative-path>.`,
    );
  }
  return { vault: id.slice(0, idx), path: id.slice(idx + 1) };
}

/**
 * Build an `obsidian://` URL pointing at a note in the vault. Mirrors the
 * pattern documented in our Linear-backlink convention (memory:
 * feedback_linear_obsidian_backlinks): clickable from any connector UI,
 * opens the actual note locally.
 */
export function obsidianUrl(vaultName: string, notePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(notePath)}`;
}

async function handleSearchCompat(
  manager: VaultManager,
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
      url: obsidianUrl(h.vault, h.notePath),
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

function handleFetchCompat(manager: VaultManager, id: string): object {
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
    url: obsidianUrl(vaultName, note.path),
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

function handleVaultStats(
  manager: VaultManager,
  vaultFilter: string | undefined,
): object {
  const targets = vaultFilter
    ? [manager.require(vaultFilter)]
    : manager.list();

  const stats: VaultStatsRow[] = targets.map((v) => {
    const total_notes = v.db.notes.countAll();
    const wordRow = v.db.handle
      .prepare<[], { total: number | null }>(
        "SELECT SUM(word_count) AS total FROM notes",
      )
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
  const targets = vaultFilter
    ? [manager.require(vaultFilter)]
    : manager.list();

  const all: RecentNoteRow[] = [];
  for (const v of targets) {
    const rows = since !== undefined
      ? v.db.handle
          .prepare<
            [number, number],
            { path: string; title: string | null; mtime: number; word_count: number | null; frontmatter: string | null }
          >(
            "SELECT path, title, mtime, word_count, frontmatter FROM notes WHERE mtime > ? ORDER BY mtime DESC LIMIT ?",
          )
          .all(since, limit)
      : v.db.handle
          .prepare<
            [number],
            { path: string; title: string | null; mtime: number; word_count: number | null; frontmatter: string | null }
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
    note:
      "Draft mode: no backlinks contributed. Provide `path` (and index the note first) for richer neighbor-inference.",
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
