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
import { z } from "zod";
import { loadConfig } from "./config/index.js";
import { VaultManager } from "./vault/index.js";
import { OllamaClient } from "./ollama/index.js";
import { FtsQueries } from "./db/index.js";
import { hybridSearch, matchesAnyGlob } from "./search/index.js";
import { OllamaReranker } from "./rerank/index.js";
import type { Reranker } from "./rerank/index.js";
import {
  listBacklinks,
  listForwardLinks,
  findBrokenLinks,
} from "./graph/index.js";
import { queryFrontmatter, updateFrontmatter } from "./frontmatter/index.js";
import { writeNote, deleteNote } from "./write/index.js";
import { getAuditLog, getIndexRuns } from "./audit/index.js";
import { SuppressionSet, VaultWatcher } from "./watcher/index.js";
import { catchupVault } from "./indexer/index.js";
import type { SearchHit } from "./types.js";

const VERSION = "0.6.1";

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

  // Optional cross-encoder reranker (Phase 7d). Constructed once;
  // search_hybrid will pass it through only when the caller asks for it.
  const reranker: Reranker | undefined = config.server.reranker_model
    ? new OllamaReranker({ ollama, model: config.server.reranker_model })
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

        case "index_runs": {
          const parsed = IndexRunsArgs.parse(args ?? {});
          const vault = manager.require(parsed.vault);
          const runs = getIndexRuns({ vault, limit: parsed.limit });
          return ok({ runs, count: runs.length });
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

async function handleSearchSemantic(
  manager: VaultManager,
  ollama: OllamaClient,
  defaultModel: string,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  excludePaths: string[] | undefined,
): Promise<object> {
  const targets = vaultFilter
    ? vaultFilter.map((n) => manager.require(n))
    : manager.list();

  if (targets.length === 0) {
    return { hits: [], note: "No vaults configured." };
  }

  // When excluding paths, fan out wider so the filtered topK is well-stocked.
  const hasExclude = excludePaths !== undefined && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;

  // Cache query embedding by model name across vaults.
  const embedCache = new Map<string, number[]>();
  const allHits: SearchHit[] = [];

  for (const vault of targets) {
    const modelName = vault.config.embedding_model ?? defaultModel;
    const model = vault.db.models.getActive();
    if (!model || model.name !== modelName) continue;

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
  return { hits: allHits.slice(0, topK), count: allHits.length };
}

function handleSearchText(
  manager: VaultManager,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  excludePaths: string[] | undefined,
): object {
  const targets = vaultFilter
    ? vaultFilter.map((n) => manager.require(n))
    : manager.list();

  if (targets.length === 0) {
    return { hits: [], note: "No vaults configured." };
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
  return { hits: allHits.slice(0, topK), count: allHits.length };
}

async function handleSearchHybrid(
  manager: VaultManager,
  ollama: OllamaClient,
  defaultModel: string,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  rrfK: number,
  excludePaths: string[] | undefined,
  reranker: Reranker | undefined,
): Promise<object> {
  const targets = vaultFilter
    ? vaultFilter.map((n) => manager.require(n))
    : manager.list();

  if (targets.length === 0) {
    return { hits: [], note: "No vaults configured." };
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

  return { hits: filtered.slice(0, topK), count: filtered.length };
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
