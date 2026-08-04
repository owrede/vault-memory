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
import { rm, mkdir, link, copyFile } from "node:fs/promises";
import { join, relative, isAbsolute, dirname, resolve } from "node:path";
import type { VaultConfig, SearchHit } from "../../../types.js";
import { scanVault } from "../../source/obsidian-fs/scanner.js";
import {
  contextFitIngest,
  contextFitQuery,
  contextFitProbe,
  type ContextFitCliConfig,
  type ContextFitChunk,
} from "./cli.js";
import {
  tryAcquireIngestLock,
  releaseIngestLock,
  markIngestDirty,
  isIngestDirty,
  clearIngestDirty,
} from "./ingest-lock.js";

const DEFAULT_COMMAND = "contextfit";

/** Per-vault ContextFit KB directory: ~/.vault-memory/contextfit/<name>/. */
export function contextFitKbDir(vaultName: string): string {
  return join(homedir(), ".vault-memory", "contextfit", vaultName);
}

/**
 * Per-vault ingest staging directory: ~/.vault-memory/contextfit/<name>.staging/.
 * Deterministic (not mkdtemp) so `sourceToNotePath` can map `metadata.source`
 * paths from an existing KB back to vault-relative paths at query time.
 */
export function contextFitStagingDir(vaultName: string): string {
  return join(homedir(), ".vault-memory", "contextfit", `${vaultName}.staging`);
}

/**
 * Build a staging tree containing exactly the files the SQLite content layer
 * indexes: `.md` files with the vault's `exclude_globs` applied (same scanner,
 * same defaults). `contextfit ingest` has no exclude option (ContextFit/cf,
 * checked 0.1.x), so pointing it at the vault root would ingest `.obsidian/`,
 * `.cognee/`, plugin sources, etc. — breaking the invariant that excludes
 * apply identically across backends, and leaking private session data into
 * the KB. Hardlinks where possible (same-volume, zero copy), copy as fallback.
 */
export async function buildIngestStaging(
  vault: VaultConfig,
  opts: {
    /** Test-only: staging dir override (defaults to contextFitStagingDir). */
    stagingDirOverride?: string;
  } = {},
): Promise<{ stagingDir: string; fileCount: number }> {
  const stagingDir = opts.stagingDirOverride ?? contextFitStagingDir(vault.name);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  const files = await scanVault(vault.path, { excludeGlobs: vault.exclude_globs });
  const root = resolve(vault.path);
  for (const abs of files) {
    const dest = join(stagingDir, relative(root, abs));
    await mkdir(dirname(dest), { recursive: true });
    try {
      await link(abs, dest);
    } catch {
      await copyFile(abs, dest); // cross-device or FS without hardlinks
    }
  }
  return { stagingDir, fileCount: files.length };
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
  /**
   * "skipped" (Issue #17): another ingest for this vault was already in flight,
   * so this call marked the vault dirty and returned WITHOUT ingesting. The
   * in-flight holder does a trailing re-ingest, so the change is not lost.
   * Callers treat "skipped" as success (no error), not failure.
   */
  status: "completed" | "failed" | "skipped";
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
  opts: {
    onProgress?: (msg: string) => void;
    /** Test-only: `~/.vault-memory` root override for the ingest lock. */
    lockRootOverride?: string;
    /**
     * Test-only dependency injection. Production omits these and the real
     * probe/ingest (which spawn the `contextfit` CLI) are used. Tests pass
     * fakes to exercise the lock/dirty/trailing-pass orchestration without the
     * binary.
     */
    _deps?: {
      probe?: (cfg: ContextFitCliConfig) => Promise<boolean>;
      ingest?: (cfg: ContextFitCliConfig, source: string) => Promise<string>;
      clearKb?: (kbPath: string) => Promise<void>;
      stage?: (vault: VaultConfig) => Promise<{ stagingDir: string; fileCount: number }>;
    };
  } = {},
): Promise<ContextFitIndexResult> {
  const log = opts.onProgress ?? (() => {});
  const cfg = cliConfigForVault(vault);
  const start = Date.now();
  const lockOpts =
    opts.lockRootOverride !== undefined ? { rootOverride: opts.lockRootOverride } : {};
  const probe =
    opts._deps?.probe ?? ((c: ContextFitCliConfig) => contextFitProbe({ command: c.command }));
  const ingest = opts._deps?.ingest ?? contextFitIngest;
  const clearKb = opts._deps?.clearKb ?? ((p: string) => rm(p, { recursive: true, force: true }));
  const stage = opts._deps?.stage ?? buildIngestStaging;

  log(`ContextFit: ingesting ${vault.path} → ${cfg.kbPath}`);
  const available = await probe(cfg);
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

  // Issue #17: serialize ingests cross-process. Second-comer marks the vault
  // dirty and skips (no wait, no wasted double-rebuild); the in-flight holder
  // does a trailing re-ingest so the latest change is captured.
  const lock = await tryAcquireIngestLock(vault.name, lockOpts);
  if (!lock.acquired) {
    await markIngestDirty(vault.name, lockOpts);
    log(`ContextFit: re-ingest already in progress (pid ${lock.ownerPid}); flagged for retry`);
    return { status: "skipped", stats: "", durationMs: Date.now() - start };
  }

  try {
    // Loop so a change that lands DURING our ingest triggers exactly one more
    // pass. Bounded to avoid an unbounded churn loop under constant writes; the
    // watcher's debounce already coalesces bursts, so 1 trailing pass suffices
    // in practice and MAX_PASSES is a safety backstop.
    const MAX_PASSES = 8;
    let stats = "";
    let passes = 0;
    do {
      // Clear the flag BEFORE ingesting: any write that arrives after this
      // point re-sets it and earns another pass; writes before it are already
      // captured by the rebuild we are about to do.
      await clearIngestDirty(vault.name, lockOpts);
      // ContextFit refuses to ingest into an existing KB (it finds the manifest
      // and exits non-zero, demanding --resume or a clean dir). Our index
      // semantics are always a FULL rebuild, so clear the KB dir first — this
      // makes re-index / live-reindex / write-refresh / catchup idempotent.
      await clearKb(cfg.kbPath);
      // Re-stage every pass so a trailing pass captures the writes that
      // earned it. Staging is hardlinks over the scan set — cheap.
      const { stagingDir, fileCount } = await stage(vault);
      try {
        log(`ContextFit: staged ${fileCount} notes (excludes applied)`);
        stats = await ingest(cfg, stagingDir);
      } finally {
        await rm(stagingDir, { recursive: true, force: true });
      }
      passes += 1;
    } while (passes < MAX_PASSES && (await isIngestDirty(vault.name, lockOpts)));
    log(stats.trim().split("\n").slice(-3).join(" · "));
    return { status: "completed", stats, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", stats: "", durationMs: Date.now() - start, error: message };
  } finally {
    await releaseIngestLock(vault.name, lockOpts);
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
  // KBs built via the staging tree carry staging-absolute sources; KBs built
  // before the staging fix carry vault-absolute sources. Try both roots.
  const notePath =
    sourceToNotePath(chunk.metadata?.source, contextFitStagingDir(vault.name)) ??
    sourceToNotePath(chunk.metadata?.source, vault.path);
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
