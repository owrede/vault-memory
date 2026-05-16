// Single literal source of truth for v1 tools/list. Imported by src/server.ts (runtime) and evals/v1-baseline/dump-tools.mjs (snapshot generator).
//
// Two exports:
//
//   - `TOOLS`: ReadonlyArray of `{name, description, inputSchema}` — the
//     JSON Schema literal source of truth. Drives `dump-tools.mjs` and the
//     pinned `evals/v1-baseline/tools-list.snapshot.json`. MUST stay
//     JSON-serializable / snapshot-stable. Do not add non-serializable
//     fields here.
//
//   - `TOOL_SCHEMAS`: Record<ToolName, ZodRawShape> — the Zod 4 raw
//     shapes paired with each tool. Passed to `McpServer.registerTool`
//     (SDK 1.29) for type-safe argument parsing + auto-derived
//     `tools/list` publication. The shapes carry per-field `.describe()`
//     calls so the SDK-published JSON Schema retains rich descriptions.
//
// Plan 01-05 design note (deviation from plan literal): the plan asked
// for a single `TOOLS` entry carrying both `inputSchema` and `zodSchema`,
// and for `registerTool` to receive `inputSchema: tool.inputSchema` (raw
// JSON Schema literal). Both proved blocking under SDK 1.29:
//
//   1. Adding a Zod schema field onto each `TOOLS` entry breaks the
//      snapshot generator (Zod objects are not JSON-serializable; the
//      pinned snapshot would change shape).
//   2. SDK 1.29 `registerTool` validates that `inputSchema` is either a
//      Zod schema instance or a Zod raw shape (see
//      node_modules/@modelcontextprotocol/sdk/.../mcp.js:861-872 —
//      `getZodSchemaObject` throws on plain JSON Schema). Passing the
//      raw JSON Schema literal is not supported by the API.
//
// The two-export design preserves the plan's INTENT:
//   - Snapshot stability (TOOLS literal unchanged).
//   - Single source of truth for v1 tools/list shape (TOOLS).
//   - Zod 4 at handler time + Zod-driven publication via the SDK's
//     own `toJsonSchemaCompat` (TOOL_SCHEMAS).
//   - End-to-end description propagation verified empirically — the
//     Pitfall 2 / SDK#1143 workaround is moot in SDK 1.29 (descriptions
//     pass through both the top-level `description` and per-field
//     `.describe()` chains).

export const TOOLS = [
  {
    name: "list_vaults",
    description: "List configured vaults with their status (note count, last indexed run).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_note",
    description: "Read the full content + frontmatter of a note by its vault-relative path.",
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
    description: "Semantic search via embedding cosine similarity. Searches all vaults by default.",
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
    description: "Full-text BM25 search via SQLite FTS5. Best for exact-word and phrase matches.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "FTS5 query — whitespace-separated tokens are AND'd; use OR explicitly.",
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
          description: "RRF constant — higher dampens emphasis on top ranks.",
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
    description: "List all wikilinks FROM a given note. Optionally include broken links.",
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
          description: "Field → value | {$unset:bool} | {$push:scalar} | {$pull:scalar}",
        },
        expected_hash: { type: "string" },
        client_id: { type: "string" },
      },
    },
  },
  {
    name: "delete_note",
    description: "Delete a note. Requires write_enabled=true AND expected_hash (no blind deletes).",
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
        is_memory_sink_write: {
          type: "boolean",
          description:
            "Filter rows to memory-sink writes only (true) or non-memory writes only (false). Omit to include all. See docs/tools/audit_log.md.",
        },
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
    description: "List recent index runs for a vault — what was scanned, when, how long, errors.",
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
    // Tool description names "Claude.ai" + "Deep-Research" as the // vault-memory:claude-ok
    // real OB1-connector-ecosystem product names; not a Claude-only coupling.
    description:
      "OB1-compatible search adapter. Returns a flat list of {id, title, url, snippet} for connector ecosystems (ChatGPT Custom Connectors, Claude.ai, Deep-Research). Backed by hybrid (semantic+BM25+RRF) search. For richer output use search_hybrid.", // vault-memory:claude-ok
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
  // ── Phase 2 memory tools (Plan 02-04 + 02-05) ─────────────────────────────
  {
    name: "record_observation",
    description:
      "Record a new memory observation under the labeled MemorySink for a vault. " +
      "Required provenance properties (source, confidence, evidence, status, observed_at, type, superseded_by) " +
      "are auto-filled from arguments; `properties` is an escape hatch for contract-allowed extras " +
      "and overrides any sugar default (D-02 — caller-last merge). " +
      "Writes route through DeliveryAdapter.write() and pass through the centralized provenance validator.",
    inputSchema: {
      type: "object",
      required: ["vault", "claim", "evidence", "confidence", "type"],
      properties: {
        vault: { type: "string", description: "Vault name (registered in [vaults] config)" },
        claim: {
          type: "string",
          description:
            "Short natural-language statement of the observation (becomes title + body).",
        },
        evidence: {
          type: "array",
          items: { type: "string" },
          description: "DocIds or quoted source spans supporting the claim; empty array allowed.",
        },
        confidence: {
          type: "string",
          enum: ["direct", "inferred", "uncertain"],
          description: "How the agent arrived at this claim.",
        },
        type: {
          type: "string",
          description:
            "Observation type per the sink contract (e.g. 'observation', 'hypothesis', 'decision').",
        },
        sink: {
          type: "string",
          description:
            "Memory sink name OR full obsidian-fs://… handle. Defaults to the vault's default sink.",
        },
        properties: {
          type: "object",
          additionalProperties: true,
          description:
            "Escape-hatch: contract-allowed extra properties; merged AFTER sugar args (caller wins).",
        },
      },
    },
  },
  {
    name: "supersede",
    description:
      "Mark an existing memory document as superseded by a replacement document. " +
      "Forward-only — the replacement doc is NOT touched; back-links are derived by the Phase 4 " +
      "graph layer at query time. Atomic single OCC update on the OLD doc; sets status=\"superseded\", " +
      "superseded_by, and superseded_reason.",
    inputSchema: {
      type: "object",
      required: ["doc_id", "replacement_doc_id", "reason"],
      properties: {
        doc_id: {
          type: "string",
          description: "DocId of the document being superseded.",
        },
        replacement_doc_id: {
          type: "string",
          description: "DocId of the replacement document.",
        },
        reason: {
          type: "string",
          description: "Why the old document is being retired; written to superseded_reason.",
        },
      },
    },
  },
  // ── Phase 3 assembly tools (Plan 03-02 / ASM-02) ─────────────────────────
  {
    name: "get_outline",
    description:
      "Return the navigable section tree for a document. Each OutlineNode " +
      "carries an `anchor` (the section's citation token), `heading_path` " +
      "(root → leaf), `heading_text`, `level`, and `chunk_ids` (v1 chunk-table " +
      "IDs in that section). Consume `anchor` + `heading_path` as the section-" +
      "level half of the citation packet. Unknown doc_id returns an error " +
      "response with {error:'doc_not_found', doc_id}.",
    inputSchema: {
      type: "object",
      required: ["doc_id"],
      properties: {
        doc_id: {
          type: "string",
          description: "Opaque DocId (obsidian-fs://<vault>/<path>) of the document",
        },
        vaults: {
          type: "array",
          items: { type: "string" },
          description: "Optional vault filter; usually omitted (the DocId names a vault).",
        },
      },
    },
  },
  // ── Phase 2 memory tools (Plan 02-05) ────────────────────────────────────
  {
    name: "recall",
    description:
      "Retrieve memory documents from one or more labeled MemorySinks, filtered by " +
      "provenance (min_confidence, types, max_age_days) and ranked by recency (observed_at " +
      "DESC). Returns citation packets (doc_id, source_handle, title, heading_path, mtime, " +
      "hash, display_url, properties) — the same 8-field shape Phase 3 assembly tools use. " +
      "Superseded documents are hidden by default.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language query; routes through hybrid (semantic + BM25) search.",
        },
        min_confidence: {
          type: "string",
          enum: ["direct", "inferred", "uncertain"],
          description:
            "Exclude docs whose confidence ordinal is lower than this (direct=3, inferred=2, uncertain=1).",
        },
        types: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to docs whose `type` property is in this set.",
        },
        max_age_days: {
          type: "integer",
          minimum: 1,
          description: "Exclude docs whose `observed_at` is older than this many days.",
        },
        sink: {
          type: "string",
          description:
            "Memory sink name OR full obsidian-fs://… handle. Defaults to all configured sinks.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 20,
          description: "Max results AFTER filter+sort.",
        },
        vaults: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these vault names; defaults to all configured.",
        },
      },
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

// ─────────────────────────────────────────────────────────────────────────────
// TOOL_SCHEMAS — Zod 4 raw shapes per tool (passed to McpServer.registerTool)
// ─────────────────────────────────────────────────────────────────────────────

import { z, type ZodRawShape } from "zod";

/**
 * Canonical DocId pattern (mirrors `DOC_ID_PATTERN` in
 * `src/adapters/registry.ts`). Inlined here so the snapshot generator
 * (`evals/v1-baseline/dump-tools.mjs`) — which is a plain Node ESM
 * script that imports `.ts` via Node's native type-stripping — does not
 * need to traverse into `./adapters/`; Node cannot resolve the `.js`
 * extension of a sibling `.ts` file at runtime when only one of the
 * pair exists.
 *
 * Single-source-of-truth invariant: any change to the canonical regex
 * in `src/adapters/registry.ts` MUST be mirrored here (and vice
 * versa). The `tool-registry.test.ts > supersede schema` cases pin the
 * expected reject/accept behavior and will fail if the two patterns
 * drift.
 */
const DOC_ID_PATTERN = /^[a-z][a-z0-9-]*:\/\/[^/]+\/.+$/;

/** Reusable predicate shape for `query_frontmatter.where` values. */
const PredicateSchema: z.ZodType<unknown> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ $in: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])) }),
  z.object({ $exists: z.boolean() }),
  z.object({ $contains: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
]);

/**
 * Per-tool Zod 4 raw shapes. Keys mirror TOOLS[].name; the shape is the
 * argument-object schema passed to `z.object({...})` (and to
 * `McpServer.registerTool({ inputSchema: shape })` per SDK 1.29).
 *
 * Tools with no input arguments declare `{}` (an empty raw shape — valid
 * per the SDK's `isZodRawShapeCompat` check).
 */
export const TOOL_SCHEMAS = {
  list_vaults: {},

  read_note: {
    vault: z.string(),
    path: z.string(),
  },

  search_semantic: {
    query: z.string().min(1),
    vaults: z.array(z.string()).optional(),
    top_k: z.number().int().positive().max(100).optional().default(10),
    exclude_paths: z.array(z.string()).optional(),
  },

  search_text: {
    query: z.string().min(1),
    vaults: z.array(z.string()).optional(),
    top_k: z.number().int().positive().max(100).optional().default(10),
    exclude_paths: z.array(z.string()).optional(),
  },

  search_hybrid: {
    query: z.string().min(1),
    vaults: z.array(z.string()).optional(),
    top_k: z.number().int().positive().max(100).optional().default(10),
    rrf_k: z.number().int().positive().max(1000).optional().default(60),
    exclude_paths: z.array(z.string()).optional(),
    rerank: z.boolean().optional().default(false),
  },

  list_backlinks: {
    vault: z.string(),
    path: z.string(),
  },

  list_forward_links: {
    vault: z.string(),
    path: z.string(),
    include_broken: z.boolean().optional().default(true),
  },

  find_broken_links: {
    vault: z.string(),
  },

  query_frontmatter: {
    vault: z.string(),
    where: z.record(z.string(), PredicateSchema),
    limit: z.number().int().positive().max(1000).optional().default(100),
  },

  write_note: {
    vault: z.string(),
    path: z.string(),
    content: z.string(),
    frontmatter: z.record(z.string(), z.unknown()).nullable().optional(),
    expected_hash: z.string().optional(),
    client_id: z.string().optional(),
  },

  update_frontmatter: {
    vault: z.string(),
    path: z.string(),
    merge: z.record(z.string(), z.unknown()),
    expected_hash: z.string().optional(),
    client_id: z.string().optional(),
  },

  delete_note: {
    vault: z.string(),
    path: z.string(),
    expected_hash: z.string(),
    client_id: z.string().optional(),
  },

  audit_log: {
    vault: z.string(),
    note_path: z.string().optional(),
    op: z.enum(["create", "update", "delete"]).optional(),
    since: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(1000).optional().default(50),
    // Plan 02-06 (MEM-08): additive optional filter. The MCP tool's
    // `description` string is INTENTIONALLY unchanged — Phase 1 byte-identity
    // is preserved. New capability is documented in docs/tools/audit_log.md.
    is_memory_sink_write: z.boolean().optional(),
  },

  list_models: {
    vault: z.string(),
  },

  start_shadow_index: {
    vault: z.string(),
    model: z.string().min(1),
    batch_size: z.number().int().positive().max(256).optional(),
  },

  switch_active_model: {
    vault: z.string(),
    model_name: z.string().min(1),
  },

  vacuum_embeddings: {
    vault: z.string(),
  },

  index_runs: {
    vault: z.string(),
    limit: z.number().int().positive().max(200).optional().default(20),
  },

  search: {
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional().default(10),
  },

  fetch: {
    id: z.string().min(1),
  },

  vault_stats: {
    vault: z.string().optional(),
  },

  recent_notes: {
    vault: z.string().optional(),
    limit: z.number().int().positive().max(200).optional().default(20),
    since: z.number().int().nonnegative().optional(),
  },

  suggest_frontmatter: {
    vault: z.string(),
    path: z.string().optional(),
    content: z.string().optional(),
    title: z.string().optional(),
    folder_hint: z.string().optional(),
  },

  // ── Phase 2 memory tools (Plan 02-04) ───────────────────────────────────
  record_observation: {
    vault: z.string().min(1).describe("Vault name (registered in [vaults] config block)"),
    claim: z
      .string()
      .min(1)
      .describe("Short natural-language statement of the observation (becomes title + body)"),
    evidence: z
      .array(z.string())
      .describe("DocIds or quoted source spans supporting the claim; empty array allowed"),
    confidence: z
      .enum(["direct", "inferred", "uncertain"])
      .describe("How the agent arrived at this claim"),
    type: z
      .string()
      .min(1)
      .describe(
        "Observation type per the sink contract (e.g. 'observation', 'hypothesis', 'decision')",
      ),
    sink: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Memory sink name OR full obsidian-fs://… handle. Defaults to the vault's default sink.",
      ),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Escape-hatch: contract-allowed extra properties; merged AFTER sugar args (caller wins)",
      ),
  },

  supersede: {
    doc_id: z
      .string()
      .regex(DOC_ID_PATTERN)
      .describe("DocId of the document being superseded"),
    replacement_doc_id: z
      .string()
      .regex(DOC_ID_PATTERN)
      .describe("DocId of the replacement document"),
    reason: z
      .string()
      .min(1)
      .describe("Why the old document is being retired; written to superseded_reason"),
  },

  // ── Phase 3 assembly tools (Plan 03-02 / ASM-02) ────────────────────────
  get_outline: {
    doc_id: z
      .string()
      .regex(DOC_ID_PATTERN)
      .describe("Opaque DocId (obsidian-fs://<vault>/<path>) of the document"),
    vaults: z
      .array(z.string().min(1))
      .optional()
      .describe("Optional vault filter; usually omitted (the DocId names a vault)"),
  },

  // ── Phase 2 memory tools (Plan 02-05) ───────────────────────────────────
  recall: {
    query: z
      .string()
      .min(1)
      .describe("Natural-language query; routes through hybrid (semantic + BM25) search"),
    min_confidence: z
      .enum(["direct", "inferred", "uncertain"])
      .optional()
      .describe(
        "Exclude docs whose confidence ordinal is lower than this (direct=3, inferred=2, uncertain=1)",
      ),
    types: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to docs whose `type` property is in this set"),
    max_age_days: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Exclude docs whose `observed_at` is older than this many days"),
    sink: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Memory sink name OR full obsidian-fs://… handle. Defaults to all configured sinks.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .optional()
      .describe("Maximum results AFTER filter+sort; default 20"),
    vaults: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to these vault names; defaults to all configured"),
  },
} as const satisfies Record<string, ZodRawShape>;

/**
 * Build a `z.object({...})` from a tool's raw shape. The
 * `suggest_frontmatter` tool layers an additional cross-field refinement
 * (path OR content required) — handled by the schema-builder map below.
 */
const SCHEMA_BUILDERS: Partial<Record<ToolName, () => z.ZodTypeAny>> = {
  suggest_frontmatter: () =>
    z
      .object(TOOL_SCHEMAS.suggest_frontmatter)
      .refine((v) => v.path !== undefined || v.content !== undefined, {
        message: "suggest_frontmatter requires either `path` or `content`",
      }),
};

/**
 * Materialize the full Zod schema for a tool — wraps the raw shape in
 * `z.object({...})` and layers any tool-specific refinements. Called at
 * handler time inside `server.registerTool` for input validation.
 */
export function buildToolSchema(name: ToolName): z.ZodTypeAny {
  const builder = SCHEMA_BUILDERS[name];
  if (builder) return builder();
  return z.object(TOOL_SCHEMAS[name] as ZodRawShape);
}
