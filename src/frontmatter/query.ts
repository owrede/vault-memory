/**
 * Frontmatter query — minimal DSL against the JSON-stored frontmatter column.
 *
 * Uses SQLite's JSON1 extension (built into modern SQLite, no extra load needed).
 *
 * Predicate shapes:
 *   { field: scalar }                 → field equals scalar
 *   { field: { $in: [a, b, ...] } }   → field is one of
 *   { field: { $exists: true } }      → field is present (not null/missing)
 *   { field: { $exists: false } }     → field absent or null
 *   { field: { $contains: scalar } }  → for arrays: array contains scalar
 *
 * Multiple top-level keys are AND-combined.
 *
 * Field path uses dot-notation: "class" or "tags" or "links.0".
 * Internally we map to JSON1 `json_extract(frontmatter, '$.path')`.
 */

import type { Vault } from "../vault/index.js";
import type { NoteRow } from "../types.js";

type Scalar = string | number | boolean | null;

export type Predicate =
  | Scalar
  | { $in: Scalar[] }
  | { $exists: boolean }
  | { $contains: Scalar };

export interface QueryFrontmatterInput {
  where: Record<string, Predicate>;
  limit?: number;
}

interface CompiledClause {
  sql: string;
  params: unknown[];
}

const MAX_FIELD_DEPTH = 5;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function buildJsonPath(field: string): string {
  // Reject anything that smells like SQL injection. We only allow
  // [A-Za-z0-9_.] plus simple array indexes.
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(field)) {
    throw new Error(
      `Invalid frontmatter field: "${field}". Use dot.notation with alphanumeric segments.`,
    );
  }
  const parts = field.split(".");
  if (parts.length > MAX_FIELD_DEPTH) {
    throw new Error(`Field depth exceeds maximum (${MAX_FIELD_DEPTH}): ${field}`);
  }
  return "$." + parts.map((p) => (/^\d+$/.test(p) ? `[${p}]` : p)).join(".");
}

function compileClause(field: string, predicate: Predicate): CompiledClause {
  const jsonPath = buildJsonPath(field);
  const extract = `json_extract(frontmatter, '${jsonPath}')`;

  // Scalar equality
  if (predicate === null || typeof predicate !== "object") {
    if (predicate === null) {
      return { sql: `${extract} IS NULL`, params: [] };
    }
    return { sql: `${extract} = ?`, params: [predicate] };
  }

  if (isPlainObject(predicate)) {
    if ("$in" in predicate) {
      const values = predicate.$in;
      if (!Array.isArray(values) || values.length === 0) {
        // empty $in → never matches
        return { sql: "0", params: [] };
      }
      const placeholders = values.map(() => "?").join(", ");
      return { sql: `${extract} IN (${placeholders})`, params: [...values] };
    }
    if ("$exists" in predicate) {
      return {
        sql: predicate.$exists ? `${extract} IS NOT NULL` : `${extract} IS NULL`,
        params: [],
      };
    }
    if ("$contains" in predicate) {
      // Array contains. Use json_each to scan.
      // Note: this requires the field to actually be a JSON array; if not
      // it just yields no rows.
      return {
        sql: `EXISTS (SELECT 1 FROM json_each(frontmatter, '${jsonPath}') WHERE value = ?)`,
        params: [predicate.$contains],
      };
    }
  }

  throw new Error(`Unsupported predicate for field "${field}": ${JSON.stringify(predicate)}`);
}

export function queryFrontmatter(
  vault: Vault,
  input: QueryFrontmatterInput,
): NoteRow[] {
  const clauses: CompiledClause[] = [];
  for (const [field, predicate] of Object.entries(input.where)) {
    clauses.push(compileClause(field, predicate));
  }

  if (clauses.length === 0) {
    // No filters → return everything (capped). Caller probably wants `listAll`.
    return vault.db.notes.listAll(input.limit ?? 100);
  }

  const where = clauses.map((c) => `(${c.sql})`).join(" AND ");
  const params = clauses.flatMap((c) => c.params);
  const limit = Math.min(Math.max(1, input.limit ?? 100), 1000);

  const stmt = vault.db.handle.prepare<unknown[], NoteRow>(
    `SELECT * FROM notes WHERE frontmatter IS NOT NULL AND ${where} ORDER BY mtime DESC LIMIT ${limit}`,
  );

  return stmt.all(...params);
}
