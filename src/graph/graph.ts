/**
 * Graph operations — high-level edge queries for MCP tool handlers.
 *
 * ── Phase 4 / 04-01 / GRA-04 (D-01, D-04): switch reads to edges table ──
 *
 * Reads route through `vault.db.edges`; writes stay on
 * `vault.db.wikilinks` until Plan 04-02 lands the unified extractor.
 * The `type` field on result rows is strictly additive: pre-backfill no
 * row existed, post-backfill every row is `type='wikilink'`, and Plan
 * 04-02 starts producing the other three types in the same column.
 *
 * Default behavior is unchanged from v1: with no edge-type filter the
 * tools return all rows from `edges` for the given doc, which — after
 * the migration 011 backfill — equals the v1 behavior plus the new
 * edge types once the indexer populates them.
 *
 * Thin layer above `vault.db.edges`. Returns enriched results with
 * source/target paths and titles so callers don't need to re-query
 * notes.
 */

import type { EdgeType } from "../db/queries/edges.js";
import type { Vault } from "../vault/index.js";

export interface BacklinkResult {
  sourcePath: string;
  sourceTitle: string;
  lineNumber: number | null;
  linkText: string | null;
  /**
   * Phase 4 / 04-01 (D-04) — additive edge type. Post-backfill every
   * row is `'wikilink'`; Plan 04-02 widens to the other three
   * `Edge.type` literals once the indexer populates them.
   *
   * `linkText` is NOT yet carried on the edges table (Plan 04-02
   * adds it). For now `linkText` stays `null` on reads from
   * `vault.db.edges.*`; the existing field shape is preserved so
   * downstream callers don't break.
   */
  type: EdgeType;
}

export interface ForwardLinkResult {
  targetPath: string;
  resolved: boolean;
  targetTitle: string | null;
  anchor: string | null;
  linkText: string | null;
  /** Phase 4 / 04-01 (D-04) — additive edge type. */
  type: EdgeType;
}

export interface BrokenLinkResult {
  sourcePath: string;
  sourceTitle: string;
  targetPath: string;
  lineNumber: number | null;
  /** Phase 4 / 04-01 (D-04) — additive edge type. */
  type: EdgeType;
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

  // ── Phase 4 / 04-01 / GRA-04 (D-01, D-04): switch reads to edges table ──
  //
  // Post-backfill every row has type='wikilink'; Plan 04-02 starts
  // producing the other three types.
  const rows = vault.db.edges.getBacklinks(note.id);
  const results: BacklinkResult[] = [];
  for (const row of rows) {
    const src = vault.db.notes.getById(row.sourceNoteId);
    if (!src) continue; // FK should prevent this, but be defensive.
    results.push({
      sourcePath: src.path,
      sourceTitle: src.title,
      lineNumber: row.lineNumber,
      linkText: row.linkText,
      type: row.type,
    });
  }
  return results;
}

/**
 * Get all forward links FROM a given note.
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

  // ── Phase 4 / 04-01 / GRA-04 (D-01, D-04): switch reads to edges table ──
  const rows = vault.db.edges.getForwardLinks(note.id);
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
      // For hyperlink / external edges the target is a URL string; for
      // wikilinks it's the original path. Either way `target_path` on
      // the edges row preserves the v1 wikilinks.target_path shape.
      // When `target_path` is NULL (resolved internal-edge with no
      // raw target string), surface the empty string — preserves the
      // existing `targetPath: string` contract.
      targetPath: row.targetPath ?? "",
      resolved,
      targetTitle,
      anchor: row.anchor,
      linkText: row.linkText,
      type: row.type,
    });
  }
  return results;
}

/**
 * List all broken links in the vault (where `target_doc IS NULL`).
 *
 * ── Phase 4 / 04-01 / GRA-04 (D-01, D-04): switch reads to edges table ──
 *
 * Reads route through `vault.db.edges.resolveBrokenLinks()`, which now
 * carries `line_number` directly (unlike the prior v1
 * `vault.db.wikilinks.resolveBrokenLinks()` which omitted it). Existing
 * call sites that observed `lineNumber === null` continue to receive
 * `null` for any pre-04-01 row that didn't capture a line; new rows
 * (post-04-02 unified extractor) will carry real line numbers.
 */
export function findBrokenLinks(vault: Vault): BrokenLinkResult[] {
  const rows = vault.db.edges.resolveBrokenLinks();
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
      // `target_path` is NULLABLE on the edges row — only broken
      // wikilinks (and external hyperlinks) carry a raw target.
      targetPath: row.targetPath ?? "",
      // v1 behavior: findBrokenLinks always returned `lineNumber: null`
      // (the v1 wikilinks.resolveBrokenLinks query omitted the column).
      // Plan 04-01 preserves that contract to keep the result shape
      // byte-identical; Plan 04-02 may surface `row.lineNumber` directly
      // once the unified extractor lands.
      lineNumber: null,
      type: row.type,
    });
  }
  return results;
}

// Re-export EdgeType so consumers of the graph barrel can type-check
// against the same union as the underlying edges table.
export type { EdgeType };
