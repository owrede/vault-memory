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
    description:
      "List configured vaults with their status (note count, last indexed run). " +
      "DEPRECATED since v2.0.0 — prefer MCP Resource `vault-memory://vaults` for agent discovery. " +
      "The tool remains callable through v2.x; removal scheduled for v3.0.0.",
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
      "Hybrid search: combines semantic (embedding) and BM25 (full-text) results via Reciprocal Rank Fusion. Best general-purpose query. Pass `expand: {hops: 1}` to auto-attach 1–2 hop typed-edge neighbors as `expansions[]` per hit (preserves ranking; runs after recency/authority rescore).",
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
        recency_weight: {
          type: "number",
          default: 0,
          description:
            "Phase 3 (D-07, ASM-07): additive recency term coefficient. final_score = rrf + recency_weight * exp(-age_days / half_life_days). Default 0 (no recency pressure — v1 behavior).",
        },
        authority_weight: {
          type: "number",
          default: 0,
          description:
            "Phase 3 (D-07, ASM-07): additive authority term coefficient. Adds `authority_weight * 1` for docs whose frontmatter has `authoritative: true`. Default 0.",
        },
        half_life_days: {
          type: "number",
          minimum: 0,
          default: 30,
          description:
            "Phase 3 (D-07): half-life for the recency exponential decay, in days. Default 30. Only meaningful when recency_weight > 0.",
        },
        include_superseded: {
          type: "boolean",
          default: false,
          description:
            "Phase 3 (D-08, ASM-08): when false (default), docs whose frontmatter has `status: superseded` are excluded at SQL level via the notes_status partial index. Set true to reveal them.",
        },
        // ── Phase 4 / 04-04 / GRA-03 (D-15): additive auto-expansion ──
        // When omitted, search_hybrid behavior is byte-identical to v1.
        expand: {
          type: "object",
          required: ["hops"],
          description:
            "Phase 4 (D-15, D-16): auto-attach 1–2 hop typed-edge neighbors as `expansions[]` per hit. Runs AFTER recency/authority rescore (D-16); never participates in score computation; top-K ranking unchanged.",
          properties: {
            hops: { type: "number", enum: [1, 2] },
            direction: {
              type: "string",
              enum: ["forward", "backward", "both"],
              default: "both",
            },
            edge_types: {
              type: "array",
              items: {
                type: "string",
                enum: ["wikilink", "mention", "frontmatter-ref", "hyperlink"],
              },
            },
          },
        },
      },
    },
  },
  {
    name: "list_backlinks",
    description:
      "Find all notes that link TO a given note. " +
      "DEPRECATED since v2.0.0 — prefer MCP Resource `vault-memory://backlinks/{vault}/{+docId}` " +
      "for agent discovery. The tool remains callable through v2.x; removal scheduled for v3.0.0.",
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
      "Use before start_shadow_index / switch_active_model. " +
      "DEPRECATED since v2.0.0 — prefer MCP Resource `vault-memory://models/{vault}` for agent " +
      "discovery. The tool remains callable through v2.x; removal scheduled for v3.0.0.",
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
      "Vault overview for agent self-orientation: note/word counts, top tags, top frontmatter keys, embedding model, last index run. Omit `vault` to get all configured vaults. " +
      "DEPRECATED since v2.0.0 — prefer MCP Resource `vault-memory://stats/{vault}` for agent " +
      "discovery. The tool remains callable through v2.x; removal scheduled for v3.0.0.",
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
      "List recently modified notes (mtime DESC). Use for agent self-orientation: 'what has the user been working on lately?'. No vector search, just SQL. " +
      "DEPRECATED since v2.0.0 — prefer MCP Resource `vault-memory://recent/{vault}` for agent " +
      "discovery. The tool remains callable through v2.x; removal scheduled for v3.0.0.",
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
  // ── Phase 5 brief tools (Plan 05-02 / BRF-03) ────────────────────────────
  {
    name: "compile_brief",
    description:
      "Compile a brief from caller-supplied source documents and write it to the briefs sink. " +
      "Resolves the LLM via the D-10 capability-first ladder (MCP Sampling → local Ollama → " +
      "caller `prepared_text` → structured error). Enforces D-11 wikilink emission per source " +
      "(appends a `## Sources` footer when the LLM omits them) and writes through DeliveryAdapter. " +
      "On target collision, auto-supersedes the prior brief via the Phase 2 supersede chain (D-12).",
    inputSchema: {
      type: "object",
      required: ["vault", "target", "source_doc_ids", "purpose"],
      properties: {
        vault: { type: "string", description: "Vault name (registered in [vaults] config)" },
        target: {
          type: "string",
          description: "Stable cross-version handle for the brief (e.g. 'atlas-q3').",
        },
        source_doc_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "DocIds the brief is compiled from; deduped, capped at 50 (D-03).",
        },
        purpose: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "Free-form purpose; bounded so list_briefs stays scannable.",
        },
        max_tokens: {
          type: "integer",
          minimum: 1,
          default: 2000,
          description: "Hint for the LLM ladder; default 2000.",
        },
        prepared_text: {
          type: "string",
          description:
            "D-10 tier 3 fallback when no LLM is reachable — verbatim body to stitch in.",
        },
        sink: {
          type: "string",
          description: "Override the default `_memory/_briefs` sink.",
        },
      },
    },
  },
  {
    name: "get_brief",
    description:
      "Look up a brief by target slug. D-13 decision tree: staleness dominates; age is " +
      "independent; follow the supersede chain to the terminal brief. Returns null when the " +
      "caller MUST recompile (stale + !allow_stale OR too_old + !allow_stale).",
    inputSchema: {
      type: "object",
      required: ["vault", "target"],
      properties: {
        vault: { type: "string", description: "Vault name (registered in [vaults] config)" },
        target: { type: "string", description: "Stable cross-version handle for the brief." },
        max_age_days: {
          type: "integer",
          minimum: 0,
          description: "Reject briefs older than this many days unless allow_stale=true.",
        },
        allow_stale: {
          type: "boolean",
          default: false,
          description:
            "When true, return briefs flagged stale or too_old with annotation rather than null.",
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
  // ── Phase 3 assembly tools (Plan 03-03) ──────────────────────────────────
  {
    name: "search_sections",
    description:
      "Section-level retrieval. Composes the v1 hybrid (semantic + BM25 + RRF) pipeline with " +
      "a chunk-to-section promotion step: runs hybrid with an inflated top_k = limit × 5, " +
      "promotes each chunk hit to its enclosing section, dedupes by (note, section anchor), " +
      "scores each section as the MAX of its constituent chunks, tie-breaks by " +
      "chunk_id_first ASC, and returns the top `limit` sections. Each hit carries an 8-field " +
      "citation packet (D-01) with a non-empty section heading_path PLUS the section anchor, " +
      "score, contributing chunk_ids, and an optional snippet from the best-scoring chunk. " +
      "Use when you want WHOLE-SECTION context, not a chunk window.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
        },
        vaults: { type: "array", items: { type: "string" } },
        recency_weight: {
          type: "number",
          minimum: 0,
          default: 0,
          description:
            "Forward-compat with slice 03-05's authority/staleness rescore. " +
            "Accepted today; ignored until 03-05 lands.",
        },
        authority_weight: {
          type: "number",
          minimum: 0,
          default: 0,
          description:
            "Forward-compat with slice 03-05's authority/staleness rescore. " +
            "Accepted today; ignored until 03-05 lands.",
        },
        include_superseded: {
          type: "boolean",
          default: false,
          description:
            "Forward-compat with slice 03-05. When false (default), superseded docs are " +
            "filtered out at the chunk level inside hybrid; accepted today, ignored until 03-05.",
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
  // ── Phase 3 assembly tools (Plan 03-04 / ASM-01) ─────────────────────────
  {
    name: "get_document_bundle",
    description:
      "Document-tree retrieval. Returns a structured bundle for a single document: " +
      "{ anchor (citation packet + optional status/superseded_by), outline (section tree " +
      "via buildOutlineTree — same shape as get_outline.root), backlinks (citation packets " +
      "+ property_snippet + relation:\"wikilink\"), forward_links (same shape; broken links " +
      "omitted), recent_edits (≤10 most recent audit_log rows mapped to {at, op, client_id, " +
      "is_memory_sink_write?}) }. Every citation packet is the full 8-field D-01 shape from " +
      "src/memory/citation-packet.ts. v2.0.0 accepts only depth:1 (one-hop links); the field " +
      "is zod-pinned to z.literal(1) for forward compatibility. recent_edits is keyed by the " +
      "anchor's CURRENT note path — pre-rename history is preserved in audit_log but not " +
      "surfaced here (Phase 4 widens). Unknown doc_id returns " +
      "{ isError: true, error: \"doc_not_found\", doc_id }.",
    inputSchema: {
      type: "object",
      required: ["doc_id"],
      properties: {
        doc_id: {
          type: "string",
          description: "Opaque DocId (obsidian-fs://<vault>/<path>) of the anchor document.",
        },
        depth: {
          type: "integer",
          enum: [1],
          default: 1,
          description:
            "Depth of the link walk. v2.0.0 accepts only depth:1 (one-hop). Phase 4 may widen.",
        },
        vaults: {
          type: "array",
          items: { type: "string" },
          description: "Optional vault filter; usually omitted (the DocId names a vault).",
        },
      },
    },
  },
  // ── Phase 4 graph tools (Plan 04-03 / GRA-01) ───────────────────────────
  {
    name: "expand",
    description:
      "Typed-edge BFS retrieval. Returns the typed-edge neighborhood of one or more " +
      "seed documents as a flat array of citation packets, each carrying " +
      "`via: {seed_doc_id, hop, edge_type, direction}` provenance. Hops hard-capped " +
      "at 2 (v2.0.0). Default direction = 'both'. Filterable by edge_type and by " +
      "document properties (strict equality, no operators). Memory-sink documents " +
      "(`_memory/...`) surface only when they are already linked from a user note in " +
      "the result set (per ADR-004 memory-namespace opacity rule). Frontmatter-ref " +
      "edges are extracted heuristically: `[[...]]` syntax in any property value OR " +
      "allowlisted property names (`assignee`, `owner`, `project`, `related`, " +
      "`parent`, `child`, `attendees`, `superseded_by`) matched against " +
      "`note_aliases`. `include_superseded` defaults to false (Phase 2 D-03 forward-" +
      "only supersede). Unknown seed_doc_ids do not throw — they are returned in a " +
      "`warnings: [{seed_doc_id, reason: 'unknown_doc'}]` array. Shortest path wins " +
      "on dedup; ties broken by (seed_doc_id, edge_type, direction).",
    inputSchema: {
      type: "object",
      required: ["seed_doc_ids", "hops"],
      properties: {
        seed_doc_ids: {
          type: "array",
          minItems: 1,
          items: {
            type: "string",
            description: "Opaque DocId (e.g. obsidian-fs://<vault>/<path>).",
          },
        },
        hops: {
          type: "number",
          enum: [1, 2],
          description: "Hop cap (1 or 2). v2.0.0 hard-caps at 2.",
        },
        direction: {
          type: "string",
          enum: ["forward", "backward", "both"],
          default: "both",
          description: "Edge traversal direction; default 'both'.",
        },
        edge_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["wikilink", "mention", "frontmatter-ref", "hyperlink"],
          },
          description:
            "Optional filter on edge types; default = all four types.",
        },
        filter_properties: {
          type: "object",
          additionalProperties: true,
          description:
            "Strict-equality predicate on document properties (e.g. {type: 'Project'}).",
        },
        include_superseded: {
          type: "boolean",
          default: false,
          description:
            "When false (default), docs whose properties.status === 'superseded' are dropped.",
        },
      },
    },
  },
  // ── Phase 4 graph tools (Plan 04-05 / GRA-02) ───────────────────────────
  {
    name: "cluster",
    description:
      "Community detection over the typed-edge graph via Louvain " +
      "modularity (Blondel et al. 2008) using `graphology` + " +
      "`graphology-communities-louvain`. Deterministic: same input " +
      "produces byte-identical cluster_id assignment via DocId-sorted " +
      "node insertion + seeded RNG (`vault-memory-cluster-v1`). " +
      "cluster_id = smallest member DocId per community. Hard-capped at " +
      "5000 nodes; pass `force: true` to override. Either `query` " +
      "(composes search_hybrid + expand 1-hop) OR `seed_doc_ids` (uses " +
      "provided seeds + induced 1-hop neighborhood); not both — passing " +
      "both returns {ok:false, reason:'both_seeds_and_query'}. On the " +
      "`query` path with multiple vaults configured, the `vault` field " +
      "is required so search scope is deterministic; single-vault setups " +
      "may omit it (returns {ok:false, reason:'vault_required'} otherwise). " +
      "Returns per-cluster {cluster_id, size, members[], summary: {top_types, " +
      "top_titles, edge_density}}. No LLM enrichment — summary fields " +
      "are pure-deterministic computations (LLM enrichment is Phase 5 " +
      "brief layer's job). _memory opacity inherited from expand() " +
      "(Plan 04-03).",
    inputSchema: {
      type: "object",
      required: ["method"],
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language query. When set, composes search_hybrid + expand(hops=1, both). Mutually exclusive with seed_doc_ids.",
        },
        seed_doc_ids: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
          description:
            "1+ opaque DocIds. When set, cluster() uses these seeds + their induced 1-hop neighborhood. Mutually exclusive with query.",
        },
        vault: {
          type: "string",
          description:
            "Vault name to scope the `query` search against (CR-02). Required on the `query` path when multiple vaults are configured; optional on single-vault setups. Ignored on the `seed_doc_ids` path (the vault is inferred from each DocId).",
        },
        method: {
          type: "string",
          enum: ["edge-community"],
          description:
            "Clustering algorithm. v2.0.0 supports only 'edge-community' (Louvain).",
        },
        query_top_k: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 50,
          description:
            "Only used in the query path: how many top hits to retrieve before expansion. Default 50.",
        },
        force: {
          type: "boolean",
          default: false,
          description:
            "Bypass the 5000-node hard cap. When false (default), oversized inputs return {ok:false, reason:'node_count_exceeded'}.",
        },
      },
    },
  },
  // ── Phase 3 assembly tools (Plan 03-06) ──────────────────────────────────
  {
    name: "assemble_dossier",
    description:
      "Resolve a {type, key} pair to an anchor document and walk its backlinks " +
      "into a structured dossier: { anchor (citation packet), linked_documents " +
      "(citation packets + relation), property_rollups (linked_count, linked_types, " +
      "status_distribution) }. Strict properties.type match (D-03). The key matches " +
      "the candidate's title OR any entry in properties.aliases (D-04). " +
      "v2.0.0 returns relation:\"wikilink\" on every linked_documents entry (the v1 " +
      "wikilinks table is the only edge source); Phase 4 (GRA-04) widens to typed edges. " +
      "Superseded backlinks are NOT filtered — dossiers show the whole picture (CONTEXT D-04).",
    inputSchema: {
      type: "object",
      required: ["type", "key"],
      properties: {
        type: {
          type: "string",
          description:
            "Exact-match value for properties.type on the anchor document " +
            "(e.g. 'Person', 'Project', 'Meeting'). No fuzzy / synonym matching.",
        },
        key: {
          type: "string",
          description:
            "Candidate key. Matches the document's title OR any entry in " +
            "properties.aliases (a string[] from frontmatter). Exact-string match.",
        },
        vaults: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these vault names; defaults to all configured.",
        },
      },
    },
  },
  // ── Phase 6 task-contract DSL (Plan 06-02 / D-A1 escape valve) ───────────
  {
    name: "register_contracts_as_tools",
    description:
      "Explicit-control escape valve (D-A1) — scans the per-vault contract " +
      "registry and updates the dynamic MCP tool list (registers new contracts " +
      "as vm_<name> tools, unregisters removed ones) regardless of the " +
      "[contracts.auto_register_tools] config gate. Always callable. " +
      "Returns a per-vault diff of {registered, unregistered}. Omit `vault` " +
      "to apply to every configured vault.",
    inputSchema: {
      type: "object",
      properties: {
        vault: {
          type: "string",
          description: "Vault name; omit to apply to all vaults.",
        },
      },
    },
  },
  // ── Phase 6 task-contract DSL (Plan 06-03 / CON-05, Q-DESCRIBE) ──────────
  {
    name: "describe_contract",
    description:
      "Return the input JSON Schema + an auto-generated markdown summary for a " +
      "contract (Q-DESCRIBE). Pure function — does not execute the contract. " +
      "Summary lists Inputs / Sources / Sinks / Assembly (numbered) / write_back / " +
      "Output Shape. Omit `vault` on single-vault setups; on multi-vault setups, " +
      "pass `vault` to disambiguate (returns `{ok:false, reason:'ambiguous_vault'}` " +
      "otherwise).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "Registered contract name (see register_contracts_as_tools).",
        },
        vault: {
          type: "string",
          description: "Vault name; omit on single-vault setups.",
        },
      },
    },
  },
  // ── Phase 6 task-contract DSL (Plan 06-03 / CON-06) ──────────────────────
  {
    name: "instantiate_contract",
    description:
      "Execute a registered contract end-to-end. Zod-validates inputs against the " +
      "contract's inputZodSchema (additionalProperties:false rejects typos). " +
      "Resolves source/sink overrides per D-A4b default chain (explicit → config → " +
      "contract literal → error if required); sinks are MemorySink-only per D-A4c " +
      "(MEM-05 invariant un-bypassable). Runs each assembly step through verbDispatcher " +
      "with template resolution + named-binding accumulation. write_back routes through " +
      "DeliveryAdapter.write() (MEM-05 chokepoint). Returns the Q-OUTPUT bundle " +
      "{steps, write_back} on success OR a structured InstantiateError envelope " +
      "(12 sealed reasons per ADR-006 §Decision 7). Omit `vault` on single-vault " +
      "setups; multi-vault setups require it (returns `ambiguous_vault` otherwise).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "Registered contract name.",
        },
        inputs: {
          type: "object",
          additionalProperties: true,
          description: "Contract inputs; validated against the contract's inputZodSchema.",
        },
        source_overrides: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Override declared source handles by handle name (e.g. {default_source: 'obsidian-fs://x'}).",
        },
        sink_overrides: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Override declared sink handles by handle name. Targets MUST resolve through MemorySinkRegistry (D-A4c).",
        },
        vault: {
          type: "string",
          description: "Vault name; omit on single-vault setups.",
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
    // Phase 3 / 03-05 additive params — D-07, D-08, ASM-07, ASM-08.
    // All `.optional()` with defaults that vanish when unset, so v1
    // callers see no behavior change.
    recency_weight: z.number().optional().default(0),
    authority_weight: z.number().optional().default(0),
    half_life_days: z.number().positive().optional().default(30),
    include_superseded: z.boolean().optional().default(false),
    // ── Phase 4 / 04-04 / GRA-03 (D-15): additive auto-expansion ──
    // Nested under a single optional `expand` object per D-15. When
    // omitted, hybridSearch behavior is byte-identical to v1 (the
    // guard `if (opts.expand && opts.expandDeps && ...)` at the end of
    // `src/search/hybrid.ts` short-circuits entirely). The literal-
    // union for `hops` enforces the D-05 hop cap at the boundary.
    expand: z
      .object({
        hops: z.union([z.literal(1), z.literal(2)]),
        direction: z.enum(["forward", "backward", "both"]).optional(),
        edge_types: z
          .array(z.enum(["wikilink", "mention", "frontmatter-ref", "hyperlink"]))
          .optional(),
      })
      .optional(),
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

  // ── Phase 5 brief tools (Plan 05-02 / BRF-03, BRF-04) ───────────────────
  compile_brief: {
    vault: z.string().min(1).describe("Vault name (registered in [vaults] config block)"),
    target: z
      .string()
      .min(1)
      .describe("Stable cross-version handle for the brief (e.g. 'atlas-q3')"),
    source_doc_ids: z
      .array(z.string().regex(DOC_ID_PATTERN))
      .min(1)
      .max(50)
      .describe("DocIds the brief is compiled from; deduped, capped at 50 (D-03)"),
    purpose: z
      .string()
      .min(1)
      .max(500)
      .describe("Free-form purpose; bounded so list_briefs stays scannable"),
    max_tokens: z
      .number()
      .int()
      .positive()
      .optional()
      .default(2000)
      .describe("Hint for the LLM ladder; default 2000"),
    prepared_text: z
      .string()
      .min(1)
      .optional()
      .describe("D-10 tier 3 fallback when no LLM is reachable — verbatim body to stitch in"),
    sink: z
      .string()
      .min(1)
      .optional()
      .describe("Override the default `_memory/_briefs` sink"),
  },

  get_brief: {
    vault: z.string().min(1).describe("Vault name (registered in [vaults] config block)"),
    target: z.string().min(1).describe("Stable cross-version handle for the brief"),
    max_age_days: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Reject briefs older than this many days unless allow_stale=true"),
    allow_stale: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, return briefs flagged stale or too_old with annotation rather than null",
      ),
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

  // ── Phase 3 assembly tools (Plan 03-03) ─────────────────────────────────
  search_sections: {
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional().default(10),
    vaults: z.array(z.string().min(1)).optional(),
    // Forward-compat with slice 03-05's authority/staleness rescore.
    // Accepted today; ignored by the controller until 03-05 wires the
    // forwarding inside hybridSearch. See 03-03-DEVIATIONS.md.
    recency_weight: z.number().min(0).optional().default(0),
    authority_weight: z.number().min(0).optional().default(0),
    include_superseded: z.boolean().optional().default(false),
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

  // ── Phase 3 assembly tools (Plan 03-04 / ASM-01) ────────────────────────
  get_document_bundle: {
    doc_id: z
      .string()
      .regex(DOC_ID_PATTERN)
      .describe("Opaque DocId (obsidian-fs://<vault>/<path>) of the anchor document"),
    // v2.0.0 accepts only depth:1. The literal pin guarantees Zod
    // rejects any other value at the boundary so the controller does
    // not need to clamp. Phase 4 may widen additively (z.union of
    // literals, or `z.number().int().min(1).max(2)`).
    depth: z
      .literal(1)
      .optional()
      .default(1)
      .describe("Link-walk depth. v2.0.0: only 1 (one-hop). Phase 4 may widen."),
    vaults: z
      .array(z.string().min(1))
      .optional()
      .describe("Optional vault filter; usually omitted (the DocId names a vault)"),
  },

  // ── Phase 4 graph tools (Plan 04-03 / GRA-01) ───────────────────────────
  expand: {
    seed_doc_ids: z
      .array(z.string().regex(DOC_ID_PATTERN))
      .min(1)
      .describe(
        "1+ opaque DocIds (e.g. obsidian-fs://<vault>/<path>) — seeds of the BFS.",
      ),
    // Hops hard-capped at 2 (D-05) via Zod literal union — `hops: 3`
    // is rejected at the boundary; the controller does not clamp.
    hops: z
      .union([z.literal(1), z.literal(2)])
      .describe("Hop cap (1 or 2). v2.0.0 hard-caps at 2."),
    direction: z
      .enum(["forward", "backward", "both"])
      .optional()
      .default("both")
      .describe("Edge traversal direction; default 'both'."),
    edge_types: z
      .array(z.enum(["wikilink", "mention", "frontmatter-ref", "hyperlink"]))
      .optional()
      .describe("Optional filter on edge types; default = all four types."),
    filter_properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Strict-equality predicate on document properties (e.g. {type: 'Project'}).",
      ),
    include_superseded: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When false (default), docs whose properties.status === 'superseded' are dropped.",
      ),
  },

  // ── Phase 4 graph tools (Plan 04-05 / GRA-02) ───────────────────────────
  //
  // The cluster tool's schema is unusual: it requires EXACTLY ONE of
  // `query` or `seed_doc_ids` (mutual exclusion per D-15a). Zod can't
  // model "exactly one" in a raw shape directly — we declare the union
  // of both shapes in `SCHEMA_BUILDERS` below; here we publish the raw
  // shape so the MCP SDK's `tools/list` JSON Schema projection still
  // works. The runtime path goes through `buildToolSchema("cluster")`
  // which calls the SCHEMA_BUILDERS entry.
  cluster: {
    query: z.string().min(1).optional(),
    seed_doc_ids: z.array(z.string().regex(DOC_ID_PATTERN)).min(1).optional(),
    // CR-02: `vault` scopes the `query` path on multi-vault setups so
    // search_hybrid is not silently restricted to whichever vault
    // sorts first in VaultManager insertion order. Optional at the
    // schema layer; the runtime cluster() entry enforces the
    // multi-vault-without-vault error.
    vault: z.string().min(1).optional(),
    method: z.literal("edge-community"),
    query_top_k: z.number().int().positive().max(200).optional().default(50),
    force: z.boolean().optional().default(false),
  },

  // ── Phase 3 assembly tools (Plan 03-06) ─────────────────────────────────
  assemble_dossier: {
    type: z
      .string()
      .min(1)
      .describe(
        "Exact-match value for properties.type on the anchor document (D-03 — no fuzzy match)",
      ),
    key: z
      .string()
      .min(1)
      .describe(
        "Candidate key — matches the document's title OR any entry in properties.aliases (D-04)",
      ),
    vaults: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to these vault names; defaults to all configured"),
  },

  // ── Phase 6 task-contract DSL (Plan 06-02 / D-A1 escape valve) ─────────
  register_contracts_as_tools: {
    vault: z
      .string()
      .min(1)
      .optional()
      .describe("Vault name; omit to apply to all vaults"),
  },

  // ── Phase 6 task-contract DSL (Plan 06-03 / CON-05, Q-DESCRIBE) ────────
  describe_contract: {
    name: z
      .string()
      .min(1)
      .describe("Registered contract name (see register_contracts_as_tools)"),
    vault: z
      .string()
      .min(1)
      .optional()
      .describe("Vault name; omit on single-vault setups"),
  },

  // ── Phase 6 task-contract DSL (Plan 06-03 / CON-06) ────────────────────
  instantiate_contract: {
    name: z.string().min(1).describe("Registered contract name"),
    inputs: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .describe("Contract inputs; validated against the contract's inputZodSchema"),
    source_overrides: z
      .record(z.string(), z.string())
      .optional()
      .describe("Override declared source handles by handle name"),
    sink_overrides: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Override declared sink handles by handle name. Targets MUST resolve through MemorySinkRegistry (D-A4c).",
      ),
    vault: z
      .string()
      .min(1)
      .optional()
      .describe("Vault name; omit on single-vault setups"),
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
  // Plan 04-05 / D-15a — EXACTLY ONE of `query` or `seed_doc_ids` must
  // be present. The runtime path also returns a structured
  // {ok:false, reason:'both_seeds_and_query'} error when both are set,
  // so this Zod refinement is the early-rejection gate at the MCP
  // boundary (cluster's internal validator handles the same case for
  // direct callers that bypass Zod).
  cluster: () =>
    z
      .object(TOOL_SCHEMAS.cluster)
      .refine(
        (v) =>
          (v.query !== undefined && v.seed_doc_ids === undefined) ||
          (v.query === undefined && v.seed_doc_ids !== undefined),
        {
          message:
            "cluster requires EXACTLY ONE of `query` or `seed_doc_ids` (D-15a mutual exclusion)",
        },
      ),
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
