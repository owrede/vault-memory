import type BetterSqlite3 from "better-sqlite3";

export interface BM25Hit {
  chunkId: number;
  /**
   * Positive relevance score (higher = better). SQLite FTS5 `bm25()` returns a
   * negative number — we flip the sign for downstream consumers so the score
   * is monotonically increasing in "goodness of match".
   */
  score: number;
  /** Optional snippet of the chunk with the query terms highlighted. */
  snippet?: string;
}

interface BM25Row {
  chunkId: number;
  score: number;
}

interface BM25RowWithSnippet extends BM25Row {
  snippet: string;
}

/**
 * Full-text BM25 search over `chunks_fts` (the FTS5 virtual table mirroring
 * `chunks.text` — see `INITIAL_SCHEMA`). The triggers on `chunks` keep the
 * index in sync automatically, so consumers only need to insert chunks the
 * usual way and can search here.
 */
export class FtsQueries {
  private readonly _search: BetterSqlite3.Statement<[string, number], BM25Row>;
  private readonly _searchWithSnippet: BetterSqlite3.Statement<
    [string, number],
    BM25RowWithSnippet
  >;
  /**
   * Phase 3 / 03-05 (M4 fix): same FTS5 BM25 search but JOINed against
   * `chunks → notes` so the candidate list excludes any chunk whose
   * owning note has `notes.status = 'superseded'`.
   *
   * Filter runs at the SQL level so the v1-default path (which passes
   * `excludeSuperseded = false` from `searchOneVault`) is byte-identical
   * to v1, and the new default-hide path performs zero per-candidate
   * frontmatter parses. The `notes_status` partial index from migration
   * 010 keeps the JOIN cheap (only rows with a non-null status are
   * indexed).
   */
  private readonly _searchExclSup: BetterSqlite3.Statement<[string, number], BM25Row>;

  constructor(db: BetterSqlite3.Database) {
    this._search = db.prepare<[string, number], BM25Row>(
      `SELECT rowid AS chunkId, bm25(chunks_fts) AS score
       FROM chunks_fts
       WHERE chunks_fts MATCH ?
       ORDER BY bm25(chunks_fts) ASC
       LIMIT ?`,
    );
    this._searchWithSnippet = db.prepare<[string, number], BM25RowWithSnippet>(
      `SELECT
         rowid AS chunkId,
         bm25(chunks_fts) AS score,
         snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 64) AS snippet
       FROM chunks_fts
       WHERE chunks_fts MATCH ?
       ORDER BY bm25(chunks_fts) ASC
       LIMIT ?`,
    );
    // 03-05 M4: SQL-level superseded filter. The JOIN against
    // `chunks → notes` references the denormalized `notes.status` column
    // (migration 010 part B) so we never re-parse the JSON frontmatter
    // blob for filtering. `notes.status IS NULL` covers notes with no
    // frontmatter status (the common case) — those are NOT superseded.
    this._searchExclSup = db.prepare<[string, number], BM25Row>(
      `SELECT chunks_fts.rowid AS chunkId, bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks ON chunks.id = chunks_fts.rowid
       JOIN notes  ON notes.id  = chunks.note_id
       WHERE chunks_fts MATCH ?
         AND (notes.status IS NULL OR notes.status != 'superseded')
       ORDER BY bm25(chunks_fts) ASC
       LIMIT ?`,
    );
  }

  /**
   * Run BM25 over `chunks_fts`.
   *
   * @param query                user query (sanitized internally)
   * @param topK                 max rows to return
   * @param withSnippet          when true, include FTS5 `snippet(...)` output
   *                             (mutually exclusive with excludeSuperseded —
   *                             snippets are debug/UI only, not the search path)
   * @param excludeSuperseded    when true (03-05 M4), JOIN-and-filter against
   *                             `notes.status` so candidates from superseded
   *                             docs never reach the caller. v1-default path
   *                             passes `false` and stays byte-identical.
   */
  search(
    query: string,
    topK: number,
    withSnippet = false,
    excludeSuperseded = false,
  ): BM25Hit[] {
    const sanitized = FtsQueries.sanitize(query);
    if (sanitized.length === 0) return [];

    if (withSnippet) {
      // Snippet path is debug/UI only — keep it on the v1 statement so
      // 03-05 doesn't need to prepare a third statement just for the
      // rarely-used branch. If a future caller needs `snippet + exclude
      // superseded`, prepare a fourth statement here.
      const rows = this._searchWithSnippet.all(sanitized, topK);
      return rows.map((r) => ({
        chunkId: r.chunkId,
        score: -r.score,
        snippet: r.snippet,
      }));
    }
    const stmt = excludeSuperseded ? this._searchExclSup : this._search;
    const rows = stmt.all(sanitized, topK);
    return rows.map((r) => ({ chunkId: r.chunkId, score: -r.score }));
  }

  /**
   * Conservative sanitizer for FTS5 MATCH input.
   *
   * Strategy: strip characters that have special FTS5 meaning when the user
   * likely didn't intend them, while preserving advanced syntax for users
   * who know what they're doing (AND/OR/NOT, NEAR, trailing `*` prefix).
   *
   * - Double quotes are removed unless balanced (unbalanced quote → phrase
   *   parse error). We strip them all unconditionally to keep this simple
   *   and predictable — phrase queries can be re-introduced by callers that
   *   construct queries programmatically.
   * - Parentheses are kept only when balanced; otherwise stripped.
   * - Colons (column filters) are stripped — `chunks_fts` only has one
   *   column, so column filters are never useful and cause errors.
   * - Tokens containing FTS5-reserved punctuation that doesn't have a sane
   *   meaning here (`-`, `/`, `?`, `.`, `!`) are wrapped in double quotes so
   *   FTS5 treats them as literal phrases. This is what makes natural
   *   queries like "LAG-EPIX", "Netzwerk/Personen", or "Wer ist X?" work.
   *   See the v0.6.0 retrieval eval (vault note `_research/vault-memory-eval.md`)
   *   for the discovered crash triggers.
   * - Leading operator tokens at fragment boundaries are dropped (FTS5
   *   errors on a trailing `AND`/`OR`).
   * - Whitespace is normalized.
   *
   * If the cleaned result is empty, returns "".
   */
  static sanitize(userQuery: string): string {
    let s = userQuery.replace(/"/g, " ").replace(/:/g, " ");

    // Balance parens — if mismatched, strip all parens.
    let depth = 0;
    let balanced = true;
    for (const ch of s) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth < 0) {
          balanced = false;
          break;
        }
      }
    }
    if (!balanced || depth !== 0) {
      s = s.replace(/[()]/g, " ");
    }

    // Normalize whitespace.
    s = s.replace(/\s+/g, " ").trim();
    if (s.length === 0) return "";

    // Drop trailing operator tokens that would error.
    const trailingOpRe = /\s+(AND|OR|NOT|NEAR)$/;
    while (trailingOpRe.test(s)) {
      s = s.replace(trailingOpRe, "");
    }
    // Drop leading operator tokens.
    s = s.replace(/^(AND|OR|NOT|NEAR)\s+/, "");
    s = s.trim();
    if (s.length === 0) return "";

    // Phrase-wrap any token that contains FTS5-meaningful punctuation. Keep
    // operator keywords (AND/OR/NOT/NEAR) and lone wildcards (*) untouched
    // so power-user syntax still works. Tokens that *contain* a wildcard
    // alongside other content (e.g. "foo*bar") are phrase-wrapped — the
    // prefix-match semantics only fire on a token-trailing star anyway.
    //
    // The character class matches: hyphen, slash, dot, question mark,
    // exclamation, backslash. Asterisks are handled separately below.
    const needsPhrase = /[-/.?!\\]/;
    const isOperator = /^(AND|OR|NOT|NEAR)$/;
    const isPrefixStar = /^[^*\s]+\*$/; // "word*" — leave alone.

    const tokens = s.split(/\s+/).map((t) => {
      if (t.length === 0) return t;
      if (isOperator.test(t)) return t;
      if (isPrefixStar.test(t)) return t;
      if (needsPhrase.test(t)) return `"${t}"`;
      return t;
    });

    return tokens.filter((t) => t.length > 0).join(" ");
  }
}
