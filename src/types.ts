/**
 * Shared types for vault-memory.
 *
 * These types form the public contract between modules. Module authors:
 * do not change shapes here without coordinating with consumers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultConfig {
  name: string;
  path: string;
  embedding_model?: string;
  /** Phase 7c: optional secondary model embedded in parallel (shadow index)
   *  so a user can evaluate a new model side-by-side without destroying
   *  the active index. Promoted via `switch_active_model` when complete. */
  secondary_embedding_model?: string;
  write_enabled?: boolean;
  exclude_globs?: string[];
}

export interface ServerConfig {
  log_level?: "debug" | "info" | "warn" | "error";
  ollama_endpoint?: string;
  default_embedding_model?: string;
  /** Optional Ollama model name for cross-encoder reranking
   *  (e.g. "qllama/bge-reranker-v2-m3"). When unset, search_hybrid's
   *  `rerank` flag is silently ignored. */
  reranker_model?: string;
  /** Phase 8: which reranker backend to use. "onnx" runs a real
   *  cross-encoder via onnxruntime-node (recommended); "ollama"
   *  keeps the legacy L2-norm proxy. Default: "onnx" when
   *  `reranker_model` is set. */
  reranker_backend?: "onnx" | "ollama";
  /** Phase 8: directory holding ONNX model + tokenizer for the "onnx"
   *  backend. Default: `~/.vault-memory/models/bge-reranker-v2-m3`. */
  reranker_model_dir?: string;
}

/**
 * Phase 2: `[memory]` TOML block — server-level memory-subsystem
 * configuration. Optional; missing block means no `default_sink` is
 * configured and the registry falls back to "first registered sink".
 */
export interface MemoryConfig {
  /** Name of the `[[memory_sinks]]` entry to treat as the default. */
  default_sink?: string;
}

/**
 * Phase 2: a single `[[memory_sinks]]` TOML array entry. The `handle`
 * is parsed and brand-cast through `parseMemorySinkHandle` at registry
 * registration time (NOT at config-load time) so the config loader
 * stays free of `src/memory/*` imports.
 */
export interface MemorySinkConfigEntry {
  name: string;
  handle: string;
  contract: string;
}

export interface AppConfig {
  server: ServerConfig;
  vaults: VaultConfig[];
  /** Phase 2: optional `[memory]` block. */
  memory?: MemoryConfig;
  /** Phase 2: `[[memory_sinks]]` array; empty when unconfigured. */
  memory_sinks: MemorySinkConfigEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault Reader — parses markdown files with frontmatter and wikilinks
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedNote {
  /** Path relative to vault root, forward-slashes. */
  relativePath: string;
  /** Markdown body without YAML frontmatter. */
  content: string;
  /** Raw YAML frontmatter object (or null if none). */
  frontmatter: Record<string, unknown> | null;
  /** Title — H1 heading if present, else basename without .md. */
  title: string;
  /** SHA-256 of `content + canonicalJson(frontmatter)`. */
  hash: string;
  /** SHA-256 of `content` only — independent of frontmatter. Used by
   *  the indexer to detect frontmatter-only changes and skip re-embedding. */
  bodyHash: string;
  /** File mtime in epoch milliseconds. */
  mtime: number;
  /** Wikilinks extracted from content, in document order. */
  wikilinks: ParsedWikilink[];
  /** Word count of `content` (excluding frontmatter). */
  wordCount: number;
}

export interface ParsedWikilink {
  /** Raw target as written, e.g. "Notes/Foo" or "Foo#section". */
  rawTarget: string;
  /** Target path normalized (no .md, no anchor). */
  normalizedTarget: string;
  /** Section anchor or null. */
  anchor: string | null;
  /** Alias text after `|` or null. */
  alias: string | null;
  /** 1-based line number where the link appears. */
  line: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunker — splits parsed notes into embedding-sized pieces
// ─────────────────────────────────────────────────────────────────────────────

export interface Chunk {
  /** Chunk index within the note, 0-based. */
  idx: number;
  /** Chunk text. */
  text: string;
  /** Approximate heading path, e.g. "## 5. Empfehlung". Null if no heading. */
  headingPath: string | null;
  /** Character offsets in original note content. */
  startOffset: number;
  endOffset: number;
  /** Token count (approximate — see Chunker doc). */
  tokenCount: number;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama Client — embedding generation
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbedRequest {
  model: string;
  texts: string[];
}

export interface EmbedResponse {
  vectors: number[][];
  /** Detected embedding dimension (consistent across the batch). */
  dim: number;
  /** Model name as confirmed by Ollama. */
  model: string;
}

export interface OllamaClientOptions {
  endpoint?: string;
  /** Max texts per HTTP request — default 10. */
  batchSize?: number;
  /** Total timeout in ms per request — default 30000. */
  timeoutMs?: number;
  /** Retry attempts on transient errors — default 3. */
  retries?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Layer — SQLite + sqlite-vec + FTS5
// ─────────────────────────────────────────────────────────────────────────────

export interface NoteRow {
  id: number;
  path: string;
  content: string;
  frontmatter: string | null; // JSON-stringified
  title: string;
  hash: string;
  /** SHA-256 of content-only. NULL on legacy rows pre-migration 006;
   *  filled lazily on next upsert. */
  body_hash: string | null;
  /** v2 canonical identifier — `obsidian-fs://<vault-name>/<vault-relative-path>`.
   *  Stored UN-ENCODED (raw path with spaces / Unicode passed through; see
   *  RESEARCH §Pitfall 5). Added by migration 007 (additive nullable).
   *  Migration 008 backfills existing rows from `<vault-name> + '/' + path`.
   *  v9 (deferred to phase 3+) will assert NOT NULL and drop `path` as PK. */
  doc_uri: string | null;
  mtime: number;
  word_count: number;
  created_at: number;
  updated_at: number;
}

export interface ChunkRow {
  id: number;
  note_id: number;
  idx: number;
  text: string;
  heading_path: string | null;
  start_offset: number;
  end_offset: number;
  token_count: number;
}

export interface ModelRow {
  id: number;
  name: string;
  provider: string;
  dim: number;
  created_at: number;
  active: number;
}

export interface SearchHit {
  vault: string;
  notePath: string;
  noteTitle: string;
  chunkText: string;
  chunkIdx: number;
  headingPath: string | null;
  score: number;
  scoreBreakdown?: {
    semantic?: number;
    text?: number;
    rrf?: number;
    /** Cross-encoder rerank score (higher = more relevant). Only set
     *  when a reranker was applied. */
    rerank?: number;
  };
  // ── Phase 3 / 03-05 (ASM-06): nine optional citation-shaped fields ──
  //
  // Strictly additive (D-08). All are `?` so a v1 caller that does not
  // request the new behavior (no `recency_weight` / `authority_weight`,
  // `include_superseded = false`, no chunk that maps to a section)
  // continues to receive a `SearchHit` whose JSON output is byte-identical
  // to v1 — every new field is `undefined` and JSON-omitted.
  //
  // Field naming uses snake_case (per RESEARCH §10 "Open questions" — keep
  // the citation-packet shape consistent across `search_hybrid` and
  // `record_observation` / `supersede` / `recall`). The existing v1 fields
  // (`notePath`, `chunkText`, `headingPath`) remain camelCase; the mixed
  // case within this interface is intentional and additive-only.

  /** Opaque, branded DocId (e.g. `obsidian-fs://my-vault/notes/foo.md`). */
  doc_id?: DocId;
  /** Adapter source-handle (e.g. `obsidian-fs://my-vault`). */
  source_handle?: SourceHandle;
  /** Section heading-path when the chunk maps to a section
   *  (`SectionsQueries.findContainingChunk`); `undefined` for doc-level
   *  hits with no enclosing section. */
  heading_path?: string[];
  /** `notes.mtime` (epoch ms). Always populated when hydration succeeds. */
  mtime?: number;
  /** `notes.hash` content hash. Always populated when hydration succeeds. */
  hash?: string;
  /** Adapter-provided deep-link URL (e.g. an obsidian deep link). */
  display_url?: string;
  /** Frontmatter `status` value (e.g. "active", "superseded", "archived").
   *  Read from the denormalized `notes.status` column (migration 010 B). */
  status?: string;
  /** When `status === "superseded"`, the `supersedes` chain target if
   *  declared in frontmatter (`frontmatter.superseded_by` or similar). */
  superseded_by?: string;
  /** Shallow copy of the parsed frontmatter (`notes.frontmatter` JSON). */
  properties?: Record<string, unknown>;
  // ── Phase 4 / 04-04 / GRA-03 (D-15): additive expansions field ──
  //
  // When `search_hybrid({expand: {hops}})` is supplied, `hybridSearch`
  // attaches the 1–2 hop typed-edge neighborhood of this hit's doc_id
  // here AFTER Phase 3 rescore (D-16). The field is strictly additive:
  // when `expand` is omitted, the field stays `undefined` and is omitted
  // from the JSON response — v1 callers see byte-identical output.
  //
  // The element type is `CitationPacketWithVia` defined in
  // `src/graph/expand.ts`. We declare it structurally inline here so
  // that `types.ts` does NOT take a top-level import dependency on the
  // graph layer (the type dependency direction stays `graph → types`,
  // not the reverse). The structural shape MUST stay in sync with
  // `CitationPacketWithVia` extends `CitationPacket` (8-field shape
  // from `src/memory/citation-packet.ts`).
  expansions?: Array<{
    doc_id: DocId;
    source_handle: SourceHandle;
    title: string;
    heading_path: string[];
    mtime: number;
    hash: string;
    display_url: string;
    properties: Record<string, unknown>;
    via: {
      seed_doc_id: DocId;
      hop: 1 | 2;
      edge_type: "wikilink" | "mention" | "frontmatter-ref" | "hyperlink";
      direction: "forward" | "backward";
    };
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// v2 canonical types (Phase 1, ADR-002 / ADR-003 / ADR-004)
//
// These types form the canonical surface for the v2 adapter seams. They are
// declared here so all adapter modules (src/adapters/**) and downstream
// consumers (assembly, memory, brief layers) can import without depending on
// any concrete adapter implementation.
//
// Identity rules (ADR-001):
//   - DocId is opaque, URI-style: `<scheme>://<authority>/<resource>`.
//   - DocId is a NOMINAL (branded) type — raw string assignment is a
//     compile error. The single minting point is src/adapters/registry.ts;
//     only the validating `parseDocId(s)` function is exported.
//   - SourceHandle is the bare `<scheme>://<authority>` prefix that names
//     a registered adapter triple (SourceConnector + DeliveryAdapter +
//     ChangeFeed).
//
// Content shape (ADR-003):
//   - `Document` is the canonical content unit. Every assembly tool
//     consumes it. `properties: Record<string, unknown>` subsumes both
//     YAML frontmatter (obsidian-fs) and (future) Notion typed properties.
//   - `BlockNode` is the Phase 1 minimal block shape; Phase 3 will enrich
//     it (callouts, tables, images, embeds).
//   - `Edge` is reserved for typed link structure. Phase 1 leaves it
//     unused at runtime (D-04 defers wikilinks-as-edges to Phase 4); the
//     TYPE must still compile so 01-03..06 can reference it.
//
// Memory namespace (ADR-004):
//   - `MemorySinkHandle` is declared here so the delivery seam can name
//     a sink at the type level without circular-importing Phase 2's
//     `src/memory/`. Phase 2 (MEM-01..12) populates the runtime shape.
//
// Change-feed (ADR-002 §ChangeFeed):
//   - `ChangeEvent` is a tagged union with create / update / delete /
//     rename. The obsidian-fs change-feed (Plan 01-05) emits only
//     create+update+delete (RESEARCH A3 / Risk #3); the type permits
//     rename for future adapters.
//
// Phase 1 backwards-compat (PROJECT.md):
//   - This block is APPEND-ONLY. No existing exports above this line are
//     modified or removed. All 23 v1 tools continue to compile and behave
//     unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opaque, URI-style document identifier — `<scheme>://<authority>/<resource>`.
 *
 * NOMINAL (branded) type — raw `string` values cannot be assigned to a
 * `DocId` parameter at compile time. The only validated minting point is
 * `parseDocId` in `src/adapters/registry.ts`; the module-private
 * `mintDocId` is closed inside an IIFE there.
 *
 * Compile-time enforcement: tests/types/docid-brand.test-d.ts. See ADR-001.
 */
export type DocId = string & { readonly __brand: "DocId" };

/**
 * Opaque source-handle — `<scheme>://<authority>` — names a registered
 * adapter triple (SourceConnector + DeliveryAdapter + ChangeFeed) in
 * `AdapterRegistry`. NOMINAL (branded) for the same reason as DocId.
 *
 * Minted by `parseSourceHandle` in `src/adapters/registry.ts`.
 */
export type SourceHandle = string & { readonly __brand: "SourceHandle" };

/**
 * Opaque memory-sink-handle — `mem-sink://<authority>/<name>` (or
 * equivalent per ADR-004). NOMINAL (branded). Declared here so the
 * delivery seam (`DeliveryAdapter`) can reference it at the type level
 * without forward-importing Phase 2's `src/memory/` package.
 *
 * Phase 1 does not populate any runtime parser; Phase 2 (MEM-01..12)
 * adds the canonical parser per ADR-004 §"MemorySink handle shape".
 */
export type MemorySinkHandle = string & { readonly __brand: "MemorySinkHandle" };

/**
 * A single intra-document block. The minimal Phase 1 shape per ADR-003;
 * Phase 3 will enrich it (callouts, tables, images, embeds).
 *
 * `kind` is the discriminant. Adapters MUST emit valid `kind` values
 * even when the source has no concept of blocks (in which case a single
 * `{ kind: "paragraph", text: body }` block is the canonical fallback —
 * see `BodyShape = "flat-text"` in `src/adapters/capabilities.ts`).
 */
export type BlockNode =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | {
      /**
       * Phase 3 (ASM-01..ASM-05): a `Section` aggregates a heading and all
       * `BlockNode` descendants up to (but not including) the next
       * equal-or-shallower heading. `anchor` is the canonical chunk-level
       * `source_hash` (ADR-003 D-05 / H-7) — `sha256_hex(NFC(heading_text)
       * || "\n" || render_blocks_to_plain_text(blocks))`. `heading_path`
       * is the ordered ancestor heading texts (NFC-normalized, root → leaf,
       * inclusive of this section's heading). `level: 0` is the synthetic
       * preamble wrapping content that precedes any heading; in that case
       * `heading_path` is `[]` and `heading_text` is `""`.
       *
       * Additive per H-7. Existing `BlockNode` consumers (none today use
       * `kind === "section"`) are unaffected.
       */
      kind: "section";
      anchor: string;
      heading_path: string[];
      level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      blocks: BlockNode[];
    };

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 (ASM-01..ASM-05): Sections — in-memory + DB row shapes
//
// `SectionInfo` is the pure-in-memory shape produced by `extractSections`
// (`src/sections/extract.ts`). It carries the data the indexer needs to
// persist into the `sections` table.
//
// `SectionRow` is the canonical DB-row shape; `InsertSectionRow` is the
// statement-bound input used by `SectionsQueries.insertMany`.
//
// These types are declared here (not under `src/sections/`) so adapters,
// the indexer, the assembly layer, and the DB query class can all import
// them without crossing layer boundaries. ADR-003 H-7 defines the anchor
// algorithm.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory shape of one extracted section. Produced by
 * `extractSections(blocks)`. The indexer fills in `chunk_id_first` /
 * `chunk_id_last` after chunks have been inserted (so chunk IDs exist).
 *
 * `parent_index` is an index into the flat `SectionInfo[]` array
 * (or `null` for top-level / preamble). The DB layer translates this
 * to `parent_id` (FK to `sections.id`) once rows are inserted.
 *
 * `ord` is the section's index among its siblings under the same parent
 * (assigned post-walk in a second pass).
 */
export interface SectionInfo {
  /** Canonical content-hash anchor (ADR-003 H-7). Hex sha256. */
  anchor: string;
  /** Ancestor heading texts (root → leaf, inclusive of this section). */
  heading_path: string[];
  /** Leaf heading text. Empty string for the preamble. */
  heading_text: string;
  /** 0 = preamble; 1..6 = heading level. */
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Index into the flat `SectionInfo[]` array; `null` for top-level. */
  parent_index: number | null;
  /** Sibling order under `parent_index`. */
  ord: number;
  /** Plain-text body fed to `computeAnchor` (kept for downstream readers). */
  plain_text_body: string;
}

/**
 * DB-row shape for the `sections` table (migration 010). `parent_id` is
 * the FK pointer; `null` for top-level / preamble. `heading_path` is
 * stored as a JSON array of strings.
 */
export interface SectionRow {
  id: number;
  note_id: number;
  anchor: string;
  /** JSON array of strings — parse with `JSON.parse(heading_path)`. */
  heading_path: string;
  heading_text: string;
  level: number;
  parent_id: number | null;
  ord: number;
  chunk_id_first: number | null;
  chunk_id_last: number | null;
  created_at: number;
}

/**
 * Input shape for `SectionsQueries.insertMany`. The query class
 * assigns `id` and `created_at`. `heading_path` must already be
 * JSON-stringified by the caller (kept explicit so the storage shape
 * is visible at the call site).
 */
export interface InsertSectionRow {
  note_id: number;
  anchor: string;
  /** JSON array of strings, already stringified. */
  heading_path: string;
  heading_text: string;
  level: number;
  parent_id: number | null;
  ord: number;
  chunk_id_first: number | null;
  chunk_id_last: number | null;
}

/**
 * A typed link between documents. Reserved for Phase 4 (GRA-04: typed-edge
 * schema). Phase 1 does not populate `Document.links` at runtime — the
 * obsidian-fs source adapter surfaces wikilinks via
 * `Document.properties.wikilinks: WikilinkRef[]` (D-05), and the existing
 * wikilinks resolver continues to consume that shape until Phase 4.
 *
 * `target` is a DocId when the link has been resolved to a known
 * document; a raw `string` when unresolved (dangling wikilink, external
 * URL, or pending resolution). `rel` is an optional adapter-specific
 * sub-classifier (e.g. "is-superseded-by", "cites").
 */
export interface Edge {
  /** Link category. Cross-adapter neutral. */
  type: "wikilink" | "mention" | "frontmatter-ref" | "hyperlink";
  /** Resolved DocId or a raw string (unresolved / external). */
  target: DocId | string;
  /** Optional adapter-specific sub-classifier. */
  rel?: string;
}

/**
 * Wikilink reference — the lightweight intermediate shape used by the
 * obsidian-fs source adapter to populate `Document.properties.wikilinks`
 * (D-05). The existing `WikilinkResolver` (`src/indexer/resolver.ts`)
 * continues to consume this shape in Phase 1; Phase 4 promotes wikilinks
 * to first-class `Document.links: Edge[]` entries with `type: "wikilink"`.
 *
 * Distinct from `ParsedWikilink` above: `ParsedWikilink` carries
 * line-number + raw-target metadata used during parsing; `WikilinkRef`
 * is the trimmed shape that survives into the `Document.properties`
 * surface for downstream consumers.
 */
export interface WikilinkRef {
  /** Normalized target — basename without `.md`, no section anchor. */
  target: string;
  /** Display alias if the wikilink used `[[target|alias]]` syntax. */
  alias?: string;
  /** Section anchor if the wikilink used `[[target#section]]`. */
  section?: string;
}

/**
 * The canonical content unit. Adapters return `Document` objects from
 * `SourceConnector.readDocument(id)`; every assembly tool, brief
 * compiler, and citation builder downstream consumes this shape.
 *
 * Field semantics (ADR-003):
 *   - `id` — opaque, branded DocId; identity contract per ADR-001.
 *   - `source` — the adapter handle that produced this document.
 *   - `title` — short human-readable title. Adapters MAY derive from
 *     H1, filename, or remote metadata; the field is non-null.
 *   - `blocks` — content split into block-level nodes per ADR-003. For
 *     adapters with `BodyShape = "flat-text"` this is a single
 *     paragraph node; for `BodyShape = "blocks"` this carries the full
 *     block tree.
 *   - `properties` — untyped property bag (YAML frontmatter, Notion
 *     typed properties, headers, labels). Adapter capabilities
 *     declare `PropertiesShape = "untyped" | "typed-schema-bound"`.
 *   - `links` — typed edges (Phase 4 surface). Phase 1 leaves this
 *     empty; the type-shape exists so downstream code can be written
 *     against it now.
 *   - `mtime` — last-modified time, epoch milliseconds. Adapter-source
 *     timestamp; semantics depend on `SourceCapabilities.refHashKind`
 *     (file mtime for obsidian-fs; remote last-edited-at for Notion).
 *   - `hash` — opaque content hash. Stable iff
 *     `SourceCapabilities.contentHashStable === true`. See ADR-003 H-1..H-6.
 *   - `display_url` — adapter-provided deep-link URL (D-01). Populated
 *     by `SourceConnector.formatDisplayUrl(id)` at read time.
 */
export interface Document {
  /** Opaque, branded DocId. */
  id: DocId;
  /** The adapter handle that produced this document. */
  source: SourceHandle;
  /** Short human-readable title. Always non-null. */
  title: string;
  /** Block-level content per ADR-003. */
  blocks: BlockNode[];
  /** Untyped property bag (frontmatter, headers, labels, …). */
  properties: Record<string, unknown>;
  /** Typed edges — Phase 4 surface. Empty array in Phase 1. */
  links: Edge[];
  /** Last-modified time, epoch milliseconds. */
  mtime: number;
  /** Opaque content hash. See ADR-003 H-1..H-6. */
  hash: string;
  /** Adapter-provided deep-link URL (D-01); `null` when unsupported. */
  display_url?: string | null;
}

/**
 * Change-feed event — emitted by `ChangeFeed.subscribe(handler)`.
 *
 * Tagged union per ADR-002 §ChangeFeed. The obsidian-fs change-feed
 * (Plan 01-05) emits only create+update+delete (RESEARCH A3 / Risk #3:
 * a true rename is observed by chokidar as `unlink` + `add` — Phase 1
 * keeps that v1 behavior). The type permits `rename` so future adapters
 * with real rename semantics (e.g. notion-api) can emit it without a
 * type-shape change.
 */
export type ChangeEvent =
  | { kind: "create"; id: DocId; at: number }
  | { kind: "update"; id: DocId; at: number }
  | { kind: "delete"; id: DocId; at: number }
  | { kind: "rename"; old_id: DocId; new_id: DocId; at: number };

/**
 * `MemorySink` — runtime record for a configured agent memory sink per
 * ADR-004. Phase 2 (MEM-01..12) widens this from the Phase 1 stub to
 * the full surface consumed by `MemorySinkRegistry`, the validator,
 * and the obsidian-fs delivery seam:
 *
 *   - `name` — short user-chosen name (e.g. "default", "observations").
 *     Used as the lookup key in `resolveMemorySink(name)`.
 *   - `handle` — full `obsidian-fs://<vault>/<path>/` URI; the
 *     canonical identity of the sink. Minted by `parseMemorySinkHandle`
 *     in `src/memory/sink.ts`.
 *   - `vault` — owning vault name (resolved from the handle authority).
 *   - `resolveToRelativePath` — vault-relative path with trailing slash
 *     (e.g. "_memory/"). The SOLE legitimate path-prefix used for
 *     `findSinkContaining(docId)` and sentinel-file resolution.
 *   - `contractName` — name of the `MemoryContract` validating writes
 *     to this sink (default `"default-memory-v1"`).
 *   - `isDefault` — `true` iff this is the vault's default sink (the
 *     target of `record_observation` when no `sink:` arg is provided).
 *
 * Backwards-compat note: the Phase 1 stub had `handle` and `resolveTo:
 * DocId`. Phase 2 replaces `resolveTo` with the explicit
 * `resolveToRelativePath` because the sink resolves to a *folder*
 * (vault-relative), not to a single document — and the vault-absolute
 * path is supplied at call time by `VaultManager`, not stored on the
 * sink record. No Phase 1 consumer reads `resolveTo` at runtime
 * (Phase 1 plan 01 declared the field as a type-only stub).
 */
export interface MemorySink {
  /** Short user-chosen name; resolution key in `resolveMemorySink(name)`. */
  name: string;
  /** Full `obsidian-fs://<vault>/<path>/` handle minted by parseMemorySinkHandle. */
  handle: MemorySinkHandle;
  /** Owning vault name (resolved from the handle authority). */
  vault: string;
  /** Vault-relative folder path with trailing slash, e.g. "_memory/". */
  resolveToRelativePath: string;
  /** Name of the `MemoryContract` validating writes to this sink. */
  contractName: string;
  /** True iff this is the vault's default sink. */
  isDefault: boolean;
}
