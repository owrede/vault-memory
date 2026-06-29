/**
 * ContextFitBackend — the CPU-only, token-native retrieval engine (ADR-008).
 *
 * A second retrieval engine selectable per vault via `backend = "contextfit"`.
 * Unlike the default Ollama+sqlite-vec path it needs NO embedding model and NO
 * GPU: ContextFit (a Python CLI) ingests the vault's markdown into a per-vault
 * knowledge-base directory and answers queries over it (BM25 + Semantic-IDs).
 *
 * Process model: out-of-process via the `contextfit` CLI (see `./cli.ts`). No
 * daemon — cold-start per call is fine at ContextFit's ~10 ms query latency.
 *
 * This adapter is engine-specific glue; it normalizes ContextFit results into
 * the canonical `SearchHit` so all downstream assembly/citation code stays
 * engine-agnostic.
 */

import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import type { VaultConfig, SearchHit } from "../../../types.js";
import {
  contextFitIngest,
  contextFitQuery,
  contextFitProbe,
  type ContextFitCliConfig,
  type ContextFitChunk,
} from "./cli.js";

const DEFAULT_COMMAND = "contextfit";

/** Per-vault ContextFit KB directory: ~/.vault-memory/contextfit/<name>/. */
export function contextFitKbDir(vaultName: string): string {
  return join(homedir(), ".vault-memory", "contextfit", vaultName);
}

/** Build the CLI config for a vault from its VaultConfig. */
export function cliConfigForVault(vault: VaultConfig): ContextFitCliConfig {
  const cfg: ContextFitCliConfig = {
    command: vault.contextfit?.command ?? DEFAULT_COMMAND,
    kbPath: contextFitKbDir(vault.name),
  };
  if (vault.contextfit?.tokenizer) cfg.tokenizer = vault.contextfit.tokenizer;
  return cfg;
}

export interface ContextFitIndexResult {
  status: "completed" | "failed";
  /** Human-readable stats line from ContextFit's ingest output. */
  stats: string;
  durationMs: number;
  error?: string;
}

/**
 * Index a vault with ContextFit: spawn `contextfit ingest <vaultPath>`. Full
 * (re)build — ContextFit owns its own incremental logic; we always pass the
 * vault root and `--rebuild-index-after-ingest` so the KB is immediately
 * queryable. Throws ContextFitError on spawn/exec failure (caller logs).
 */
export async function indexVaultWithContextFit(
  vault: VaultConfig,
  opts: { onProgress?: (msg: string) => void } = {},
): Promise<ContextFitIndexResult> {
  const log = opts.onProgress ?? (() => {});
  const cfg = cliConfigForVault(vault);
  const start = Date.now();

  log(`ContextFit: ingesting ${vault.path} → ${cfg.kbPath}`);
  const available = await contextFitProbe({ command: cfg.command });
  if (!available) {
    return {
      status: "failed",
      stats: "",
      durationMs: Date.now() - start,
      error:
        `ContextFit CLI not runnable (tried '${cfg.command}'). Install with ` +
        `\`pipx install contextfit\` or set [[vaults]].contextfit.command.`,
    };
  }

  try {
    const stats = await contextFitIngest(cfg, vault.path);
    log(stats.trim().split("\n").slice(-3).join(" · "));
    return { status: "completed", stats, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", stats: "", durationMs: Date.now() - start, error: message };
  }
}

/**
 * Map a ContextFit `metadata.source` (absolute path ContextFit ingested) back
 * to a vault-relative POSIX path matching the `notes.path` convention. Returns
 * null when the source isn't under the vault root (defensive — skip the hit).
 */
export function sourceToNotePath(source: string | undefined, vaultPath: string): string | null {
  if (!source) return null;
  const rel = isAbsolute(source) ? relative(vaultPath, source) : source;
  if (rel.startsWith("..")) return null; // outside the vault root
  return rel.split(/[\\/]/).join("/");
}

/** Map one ContextFit chunk → SearchHit. Returns null for un-addressable hits. */
function chunkToHit(chunk: ContextFitChunk, vault: VaultConfig): SearchHit | null {
  const notePath = sourceToNotePath(chunk.metadata?.source, vault.path);
  if (notePath === null) return null;
  // Derive a display title from the path basename (ContextFit doesn't return
  // a note title); downstream callers that need the real title re-read the note.
  const base = notePath.split("/").pop() ?? notePath;
  const noteTitle = base.replace(/\.md$/i, "");
  const hit: SearchHit = {
    vault: vault.name,
    notePath,
    noteTitle,
    chunkText: chunk.preview ?? "",
    chunkIdx: chunk.chunk_id,
    headingPath: null,
    score: chunk.score,
    scoreBreakdown: { contextfit: chunk.score },
  };
  return hit;
}

/**
 * Search a ContextFit-backed vault. Spawns `contextfit query`, maps the
 * returned chunks to SearchHit[] (vault-relative paths). Engine-agnostic
 * output — the caller treats these identically to Ollama-path hits.
 */
export async function searchVaultWithContextFit(
  vault: VaultConfig,
  query: string,
  opts: { topK?: number } = {},
): Promise<SearchHit[]> {
  const cfg = cliConfigForVault(vault);
  const method = vault.contextfit?.method ?? "hybrid";
  const result = await contextFitQuery(cfg, query, {
    topK: opts.topK ?? 10,
    method,
  });
  const hits: SearchHit[] = [];
  for (const chunk of result.chunks) {
    const hit = chunkToHit(chunk, vault);
    if (hit) hits.push(hit);
  }
  return hits;
}
