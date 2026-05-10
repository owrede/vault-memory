/**
 * MCP server.
 *
 * Phase 1 toolset:
 *   - list_vaults
 *   - read_note
 *   - search_semantic
 *
 * Later phases add: search_text, search_hybrid, write_note, graph tools, etc.
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
import type { SearchHit } from "./types.js";

const VERSION = "0.1.0";

// ─── Tool Input Schemas ──────────────────────────────────────────────────────

const ReadNoteArgs = z.object({
  vault: z.string(),
  path: z.string(),
});

const SearchSemanticArgs = z.object({
  query: z.string().min(1),
  vaults: z.array(z.string()).optional(),
  top_k: z.number().int().positive().max(100).optional().default(10),
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
    config.server.default_embedding_model ?? "qwen3-embedding";

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
              description: "Vault-relative path with forward slashes, ending in .md",
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
            vaults: {
              type: "array",
              items: { type: "string" },
              description: "Restrict to specific vault names (default: all)",
            },
            top_k: { type: "integer", minimum: 1, maximum: 100, default: 10 },
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
          const parsed = SearchSemanticArgs.parse(args ?? {});
          const result = await handleSearchSemantic(
            manager,
            ollama,
            defaultModel,
            parsed.query,
            parsed.vaults,
            parsed.top_k,
          );
          return ok(result);
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
): Promise<object> {
  const targets = vaultFilter
    ? vaultFilter.map((n) => manager.require(n))
    : manager.list();

  if (targets.length === 0) {
    return { hits: [], note: "No vaults configured." };
  }

  // Embed the query once; per-vault we use that vault's model. For mixed
  // models across vaults we'd embed multiple times. For Phase 1 we assume
  // a shared default unless overridden per vault.
  const allHits: SearchHit[] = [];

  for (const vault of targets) {
    const modelName = vault.config.embedding_model ?? defaultModel;
    const model = vault.db.models.getActive();

    if (!model || model.name !== modelName) {
      // Vault has not been indexed yet or with a different model
      continue;
    }

    const embedResp = await ollama.embed({ model: modelName, texts: [query] });
    const queryVec = embedResp.vectors[0];
    if (!queryVec) continue;

    const semanticHits = vault.db.embeddings.searchSemantic(
      model.id,
      queryVec,
      topK,
    );

    for (const hit of semanticHits) {
      const chunk = vault.db.chunks.getById(hit.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;

      // sqlite-vec L2 distance → similarity = 1 / (1 + distance) for ranking
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

  // Sort by score desc, take top_k
  allHits.sort((a, b) => b.score - a.score);
  return { hits: allHits.slice(0, topK), count: allHits.length };
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
