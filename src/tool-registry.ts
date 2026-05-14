// Single literal source of truth for v1 tools/list. Imported by src/server.ts (runtime) and evals/v1-baseline/dump-tools.mjs (snapshot generator).

export const TOOLS = [
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
] as const;
