/**
 * Graph operations — high-level wikilink queries for MCP tool handlers.
 *
 * Thin layer above `vault.db.wikilinks`. Returns enriched results with
 * source/target paths and titles so callers don't need to re-query notes.
 */

import type { Vault } from "../vault/index.js";

export interface BacklinkResult {
  sourcePath: string;
  sourceTitle: string;
  lineNumber: number | null;
  linkText: string | null;
}

export interface ForwardLinkResult {
  targetPath: string;
  resolved: boolean;
  targetTitle: string | null;
  anchor: string | null;
  linkText: string | null;
}

export interface BrokenLinkResult {
  sourcePath: string;
  sourceTitle: string;
  targetPath: string;
  lineNumber: number | null;
}

/**
 * Get all notes that link TO a given note.
 *
 * @throws if `notePath` does not resolve to a known note.
 */
export function listBacklinks(vault: Vault, notePath: string): BacklinkResult[] {
  const note = vault.db.notes.getByPath(notePath);
  if (!note) {
    throw new Error(`Note not found: ${notePath}`);
  }

  const rows = vault.db.wikilinks.getBacklinks(note.id);
  const results: BacklinkResult[] = [];
  for (const row of rows) {
    const src = vault.db.notes.getById(row.sourceNoteId);
    if (!src) continue; // FK should prevent this, but be defensive.
    results.push({
      sourcePath: src.path,
      sourceTitle: src.title,
      lineNumber: row.lineNumber,
      linkText: row.linkText,
    });
  }
  return results;
}

/**
 * Get all wikilinks FROM a given note.
 *
 * @param includeBroken include unresolved links (default: true)
 * @throws if `notePath` does not resolve to a known note.
 */
export function listForwardLinks(
  vault: Vault,
  notePath: string,
  includeBroken: boolean = true,
): ForwardLinkResult[] {
  const note = vault.db.notes.getByPath(notePath);
  if (!note) {
    throw new Error(`Note not found: ${notePath}`);
  }

  const rows = vault.db.wikilinks.getForwardLinks(note.id);
  const results: ForwardLinkResult[] = [];
  for (const row of rows) {
    const resolved = row.targetNoteId !== null;
    if (!resolved && !includeBroken) continue;

    let targetTitle: string | null = null;
    if (resolved && row.targetNoteId !== null) {
      const target = vault.db.notes.getById(row.targetNoteId);
      targetTitle = target?.title ?? null;
    }

    results.push({
      targetPath: row.targetPath,
      resolved,
      targetTitle,
      anchor: row.anchor,
      linkText: row.linkText,
    });
  }
  return results;
}

/**
 * List all broken wikilinks in the vault (where target_note IS NULL).
 *
 * Note: `lineNumber` is currently always `null` — the DB-layer
 * `resolveBrokenLinks()` query doesn't return it, and `getForwardLinks()`
 * doesn't expose `lineNumber` in its row type. Enriching here would require
 * either changing the DB layer (out of scope for this module) or a separate
 * raw query. Acceptable per spec; documented for future enhancement.
 */
export function findBrokenLinks(vault: Vault): BrokenLinkResult[] {
  const rows = vault.db.wikilinks.resolveBrokenLinks();
  if (rows.length === 0) return [];

  const noteCache = new Map<number, { path: string; title: string }>();

  const results: BrokenLinkResult[] = [];
  for (const row of rows) {
    let src = noteCache.get(row.sourceNoteId);
    if (!src) {
      const n = vault.db.notes.getById(row.sourceNoteId);
      if (!n) continue;
      src = { path: n.path, title: n.title };
      noteCache.set(row.sourceNoteId, src);
    }

    results.push({
      sourcePath: src.path,
      sourceTitle: src.title,
      targetPath: row.targetPath,
      lineNumber: null,
    });
  }
  return results;
}
