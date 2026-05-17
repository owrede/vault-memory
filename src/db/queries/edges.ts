/**
 * EdgesQueries — Phase 4 / 04-01 / GRA-04 (D-01) typed-edge substrate.
 *
 * Mirrors `src/db/queries/wikilinks.ts` verbatim in structure. Phase 4
 * promotes the v1 wikilink-only graph to a typed-edge graph (the four
 * `Edge.type` literals in `src/types.ts:470`):
 *   `wikilink | mention | frontmatter-ref | hyperlink`.
 *
 * v2.0.0 keeps `wikilinks` in place (read-deprecated; Plan 04-02 stops
 * writing to it). All reads from this point forward go through
 * `vault.db.edges.*`; the v1 graph tools (`list_backlinks` /
 * `list_forward_links` / `findBrokenLinks`) are switched in Task 2 of
 * this plan.
 *
 * UPSERT discipline mirrors `wikilinks.ts:52` — `INSERT OR IGNORE`
 * against `UNIQUE(source_doc, target_doc, type, anchor)` makes
 * re-extraction idempotent.
 */

import type BetterSqlite3 from "better-sqlite3";

import type { Edge } from "../../types.js";

/**
 * Edge.type union re-exported as `EdgeType` for ergonomic use at the
 * query namespace + barrel layer. The canonical definition stays in
 * `src/types.ts:470` (ADR-003); this is a strict re-export so any
 * future widening propagates without touching downstream call sites.
 */
export type EdgeType = Edge["type"];

export interface EdgeInput {
  /** Resolved target note id, or `null` for unresolved targets. */
  targetNoteId: number | null;
  /**
   * Raw target string for unresolved edges (dangling wikilinks,
   * hyperlink URLs, frontmatter-ref strings that don't match a known
   * doc). Mirrors `wikilinks.target_path`. May be `null` only when
   * `targetNoteId` is set.
   */
  targetPath: string | null;
  type: EdgeType;
  /** ADR-003 `Edge.rel` — optional adapter-specific sub-classifier. */
  rel: string | null;
  /** Section anchor for wikilinks (`[[target#section]]`). */
  anchor: string | null;
  lineNumber: number | null;
  /**
   * Optional display text from the source (e.g., wikilink alias
   * `[[target|display text]]`). Carried through from the v1
   * `wikilinks.link_text` column so the graph-tool result shape is
   * preserved post-04-01 read switch.
   */
  linkText: string | null;
}

export interface EdgeBacklinkRow {
  sourceNoteId: number;
  type: EdgeType;
  anchor: string | null;
  lineNumber: number | null;
  linkText: string | null;
}

export interface EdgeForwardLinkRow {
  targetPath: string | null;
  targetNoteId: number | null;
  type: EdgeType;
  anchor: string | null;
  lineNumber: number | null;
  linkText: string | null;
}

export interface EdgeBrokenLinkRow {
  sourceNoteId: number;
  targetPath: string | null;
  type: EdgeType;
  lineNumber: number | null;
}

export class EdgesQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByNote: BetterSqlite3.Statement<[number]>;
  private readonly _backlinks: BetterSqlite3.Statement<
    [number],
    {
      source_doc: number;
      type: EdgeType;
      anchor: string | null;
      line_number: number | null;
      link_text: string | null;
    }
  >;
  private readonly _forward: BetterSqlite3.Statement<
    [number],
    {
      target_doc: number | null;
      target_path: string | null;
      type: EdgeType;
      anchor: string | null;
      line_number: number | null;
      link_text: string | null;
    }
  >;
  private readonly _broken: BetterSqlite3.Statement<
    [],
    {
      source_doc: number;
      target_path: string | null;
      type: EdgeType;
      line_number: number | null;
    }
  >;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT OR IGNORE INTO edges
        (source_doc, target_doc, target_path, type, rel, anchor, line_number, link_text)
      VALUES (@source_doc, @target_doc, @target_path, @type, @rel, @anchor, @line_number, @link_text)
    `);
    this._deleteByNote = db.prepare("DELETE FROM edges WHERE source_doc = ?");
    this._backlinks = db.prepare(
      `SELECT source_doc, type, anchor, line_number, link_text
       FROM edges
       WHERE target_doc = ?`,
    );
    this._forward = db.prepare(
      `SELECT target_doc, target_path, type, anchor, line_number, link_text
       FROM edges
       WHERE source_doc = ?`,
    );
    this._broken = db.prepare(
      `SELECT source_doc, target_path, type, line_number
       FROM edges
       WHERE target_doc IS NULL`,
    );
  }

  insertBatch(sourceNoteId: number, edges: EdgeInput[]): void {
    const tx = this.db.transaction((xs: EdgeInput[]) => {
      for (const x of xs) {
        this._insert.run({
          source_doc: sourceNoteId,
          target_doc: x.targetNoteId,
          target_path: x.targetPath,
          type: x.type,
          rel: x.rel,
          anchor: x.anchor,
          line_number: x.lineNumber,
          link_text: x.linkText,
        });
      }
    });
    tx(edges);
  }

  deleteByNote(noteId: number): number {
    return this._deleteByNote.run(noteId).changes;
  }

  /**
   * Get inbound edges where `target_doc = noteId`.
   *
   * Phase 4 / 04-03 (GRA-01 / D-08): the optional `edgeTypes` filter
   * narrows the result to rows matching one of the listed types. The
   * filter is passed through as parameterized placeholders in an
   * `IN (?, ?, …)` clause; `EdgeType` is a closed Zod-validated union
   * (4 strings), so SQL injection is not a vector. When `edgeTypes` is
   * `undefined` or empty, the unfiltered prepared statement is used (no
   * per-call prepare cost — matches the v1 behavior).
   */
  getBacklinks(noteId: number, edgeTypes?: readonly EdgeType[]): EdgeBacklinkRow[] {
    if (!edgeTypes || edgeTypes.length === 0) {
      return this._backlinks.all(noteId).map((r) => ({
        sourceNoteId: r.source_doc,
        type: r.type,
        anchor: r.anchor,
        lineNumber: r.line_number,
        linkText: r.link_text,
      }));
    }
    // Dynamic IN-clause; EdgeType is a closed union, so the placeholder
    // count is bounded and the parameters are bound — no string concat
    // of user data. T-04-03-04 mitigation.
    const placeholders = edgeTypes.map(() => "?").join(", ");
    const stmt = this.db.prepare<
      [number, ...EdgeType[]],
      {
        source_doc: number;
        type: EdgeType;
        anchor: string | null;
        line_number: number | null;
        link_text: string | null;
      }
    >(
      `SELECT source_doc, type, anchor, line_number, link_text
       FROM edges
       WHERE target_doc = ? AND type IN (${placeholders})`,
    );
    return stmt.all(noteId, ...edgeTypes).map((r) => ({
      sourceNoteId: r.source_doc,
      type: r.type,
      anchor: r.anchor,
      lineNumber: r.line_number,
      linkText: r.link_text,
    }));
  }

  /**
   * Get outbound edges where `source_doc = noteId`.
   *
   * Phase 4 / 04-03 (GRA-01 / D-08): optional `edgeTypes` filter — see
   * `getBacklinks` for the SQL injection / closed-union rationale.
   * Hyperlink rows return `target_doc=null` + raw URL in `target_path`;
   * callers iterating for BFS traversal SKIP those (Phase 4 BFS only
   * traverses resolved edges).
   */
  getForwardLinks(noteId: number, edgeTypes?: readonly EdgeType[]): EdgeForwardLinkRow[] {
    if (!edgeTypes || edgeTypes.length === 0) {
      return this._forward.all(noteId).map((r) => ({
        targetPath: r.target_path,
        targetNoteId: r.target_doc,
        type: r.type,
        anchor: r.anchor,
        lineNumber: r.line_number,
        linkText: r.link_text,
      }));
    }
    const placeholders = edgeTypes.map(() => "?").join(", ");
    const stmt = this.db.prepare<
      [number, ...EdgeType[]],
      {
        target_doc: number | null;
        target_path: string | null;
        type: EdgeType;
        anchor: string | null;
        line_number: number | null;
        link_text: string | null;
      }
    >(
      `SELECT target_doc, target_path, type, anchor, line_number, link_text
       FROM edges
       WHERE source_doc = ? AND type IN (${placeholders})`,
    );
    return stmt.all(noteId, ...edgeTypes).map((r) => ({
      targetPath: r.target_path,
      targetNoteId: r.target_doc,
      type: r.type,
      anchor: r.anchor,
      lineNumber: r.line_number,
      linkText: r.link_text,
    }));
  }

  resolveBrokenLinks(): EdgeBrokenLinkRow[] {
    return this._broken.all().map((r) => ({
      sourceNoteId: r.source_doc,
      targetPath: r.target_path,
      type: r.type,
      lineNumber: r.line_number,
    }));
  }
}
