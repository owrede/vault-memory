/**
 * Catch-up scan: reconcile DB state with the vault's filesystem on demand.
 *
 * Used at server start before activating the file watcher. The watcher only
 * sees events from its `start()` onward — so anything edited while the server
 * was offline would silently drift. Catch-up does a cheap hash-based scan:
 *
 *   - For every .md on disk: parse + hash → compare to DB.
 *     - Hash unchanged → skip (no embeddings work).
 *     - Hash changed or note absent → indexNote (full re-embed for this note).
 *   - For every DB note whose path is no longer on disk → removeNote.
 *
 * Embeddings are only generated for the notes that actually changed.
 */

import { scanVault } from "../adapters/source/obsidian-fs/scanner.js";
import { parseNote } from "../adapters/source/obsidian-fs/parser.js";
import { indexNote, removeNote } from "./single.js";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";

export interface CatchupOptions {
  vault: Vault;
  embeddingModel: string;
  /** Required for Ollama vaults; omitted for ContextFit vaults (ADR-008). */
  ollama?: OllamaClient;
  log?: (msg: string) => void;
}

export interface CatchupResult {
  scanned: number;
  reindexed: number;
  removed: number;
  durationMs: number;
}

export async function catchupVault(options: CatchupOptions): Promise<CatchupResult> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const { vault } = options;

  const files = await scanVault(vault.config.path, {
    excludeGlobs: vault.config.exclude_globs,
  });

  let reindexed = 0;
  const knownPaths = new Set<string>();
  // ADR-008: ContextFit vaults reconcile the SQLite layer without embeddings.
  const isContextFit = vault.config.backend === "contextfit";

  for (const file of files) {
    // Cheap path-relative computation — duplicates the reader's logic but
    // avoids a second filesystem hit.
    const parsed = await parseNote(file, vault.config.path).catch(() => null);
    if (!parsed) continue;
    knownPaths.add(parsed.relativePath);

    const dbRow = vault.db.notes.getByPath(parsed.relativePath);
    if (dbRow && dbRow.hash === parsed.hash) {
      continue;
    }

    const result = await indexNote({
      vault,
      absolutePath: file,
      embeddingModel: options.embeddingModel,
      ...(isContextFit ? { embeddings: "none" as const } : { ollama: options.ollama }),
    });
    if (result.status === "indexed") {
      reindexed++;
      log(`catch-up indexed ${parsed.relativePath} (${result.isNew ? "new" : "updated"})`);
    }
  }

  let removed = 0;
  for (const row of vault.db.notes.listAll()) {
    if (!knownPaths.has(row.path)) {
      const result = removeNote(vault, joinAbs(vault.config.path, row.path));
      if (result.removed) {
        removed++;
        log(`catch-up removed ${row.path}`);
      }
    }
  }

  // ADR-008: if a ContextFit vault changed during catch-up, rebuild its search
  // KB once so retrieval matches the reconciled SQLite layer.
  if (isContextFit && (reindexed > 0 || removed > 0)) {
    const { indexVaultWithContextFit } = await import("../adapters/retrieval/contextfit/index.js");
    const r = await indexVaultWithContextFit(vault.config, { onProgress: log });
    log(
      r.status === "completed"
        ? `catch-up: ContextFit KB rebuilt (${r.durationMs}ms)`
        : `catch-up: ContextFit KB rebuild failed: ${r.error}`,
    );
  }

  return {
    scanned: files.length,
    reindexed,
    removed,
    durationMs: Date.now() - started,
  };
}

function joinAbs(root: string, relative: string): string {
  // removeNote expects absolute. The simple join here mirrors scanVault's
  // output convention (POSIX slashes) and works on macOS/Linux; on Windows
  // single.ts's safeJoinInsideVault normalizes either way.
  if (root.endsWith("/")) return `${root}${relative}`;
  return `${root}/${relative}`;
}
