/**
 * WikilinkResolver — per-index-run resolver with prepared-statement reuse
 * and a target-path → noteId cache.
 *
 * Why this exists:
 *   resolveWikilinkTarget() is called once per wikilink during indexVault.
 *   Each call did up to three SQL operations and prepared the filename-match
 *   statement on the fly. On large vaults (5k notes / 20k links) that's
 *   measurable. This class:
 *     - prepares the filename-match statement once,
 *     - memoises results by normalised target path inside a single run.
 *
 * Cache scope:
 *   One instance per indexVault run. Notes inserted during the run can
 *   change resolution results (transient broken links), which is why the
 *   second pass uses a fresh resolver — see indexer.ts. Do NOT reuse an
 *   instance across runs.
 *
 * Key choice:
 *   Obsidian's heuristic in this codebase ignores the source note's folder,
 *   so the cache key is just the normalised target path. If same-folder
 *   priority is added later, switch to `${sourcePath}::${targetPath}`.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { Vault } from "../vault/index.js";

export interface ResolveHit {
  id: number;
  path: string;
}

export class WikilinkResolver {
  private readonly vault: Vault;
  private readonly filenameStmt: BetterSqlite3.Statement<
    [string, string],
    { id: number; path: string }
  >;
  private readonly cache = new Map<string, ResolveHit | null>();

  constructor(vault: Vault) {
    this.vault = vault;
    this.filenameStmt = vault.db.handle.prepare(
      `SELECT id, path FROM notes
       WHERE path = ?
          OR path LIKE ?
       ORDER BY length(path) ASC
       LIMIT 1`,
    );
  }

  /**
   * Resolve a wikilink target the way Obsidian does, in priority order:
   *   1) exact relative path match (with or without .md)
   *   2) filename-only match anywhere in the vault — shortest path wins
   *   3) alias match — looks up note_aliases (case-insensitive)
   *
   * Returns null if no candidate exists.
   */
  resolve(normalizedTarget: string): ResolveHit | null {
    const cached = this.cache.get(normalizedTarget);
    if (cached !== undefined) return cached;

    const hit = this.resolveUncached(normalizedTarget);
    this.cache.set(normalizedTarget, hit);
    return hit;
  }

  private resolveUncached(normalizedTarget: string): ResolveHit | null {
    // 1. Exact relative path (with .md, then without)
    const exact =
      this.vault.db.notes.getByPath(`${normalizedTarget}.md`) ??
      this.vault.db.notes.getByPath(normalizedTarget);
    if (exact) return { id: exact.id, path: exact.path };

    // 2 + 3 only apply to slash-less targets (filename-only references).
    if (!normalizedTarget.includes("/")) {
      const filename = `${normalizedTarget}.md`;
      const suffix = `%/${filename}`;
      const hit = this.filenameStmt.get(filename, suffix);
      if (hit) return hit;

      const aliasHit = this.vault.db.aliases.resolve(normalizedTarget);
      if (aliasHit) {
        return { id: aliasHit.note_id, path: aliasHit.path };
      }
    }

    return null;
  }

  /** Test/diagnostics: cache size after a run. */
  get cacheSize(): number {
    return this.cache.size;
  }
}
