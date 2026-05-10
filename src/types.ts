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
  write_enabled?: boolean;
  exclude_globs?: string[];
}

export interface ServerConfig {
  log_level?: "debug" | "info" | "warn" | "error";
  ollama_endpoint?: string;
  default_embedding_model?: string;
}

export interface AppConfig {
  server: ServerConfig;
  vaults: VaultConfig[];
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
  /** SHA-256 of `content + JSON.stringify(frontmatter)`. */
  hash: string;
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
  };
}
