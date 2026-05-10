import { createHash } from "node:crypto";

/** SHA-256 hex digest of input string (utf-8). */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Canonical JSON serialization with stable, alphabetically-sorted object keys.
 *
 * Why: JavaScript preserves object-property insertion order, so
 * `JSON.stringify({a:1,b:2})` and `JSON.stringify({b:2,a:1})` produce different
 * strings even though the objects are semantically identical. When this output
 * is fed into the note `hash`, the same note re-parsed with frontmatter keys in
 * a different order would yield a different hash — causing spurious optimistic-
 * concurrency conflicts in `write_note` / `update_frontmatter`.
 *
 * Rules:
 *   - Object keys are sorted lexicographically.
 *   - Arrays preserve their insertion order (order is semantically meaningful).
 *   - Primitives (string/number/boolean) use standard JSON.stringify.
 *   - `null` and `undefined` serialize to "null".
 *   - Recursion through nested objects and arrays.
 *
 * Migration note: existing rows in the SQLite index were hashed with the
 * non-canonical `JSON.stringify`. We intentionally do NOT migrate them — the
 * next time each note is re-indexed (any mtime change or a full re-scan),
 * its hash is recomputed canonically and self-heals.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJsonStringify(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]),
    );
    return "{" + parts.join(",") + "}";
  }
  // Primitives (string, number, boolean). NaN/Infinity → "null" via JSON.stringify.
  const s = JSON.stringify(value);
  return s === undefined ? "null" : s;
}

/**
 * Canonical content-hash for a note: sha256(content + canonicalJson(frontmatter ?? {})).
 *
 * All call sites (reader/parser, write, frontmatter/update) MUST go
 * through this function to guarantee identical hashes across the codebase.
 */
export function computeNoteHash(
  content: string,
  frontmatter: Record<string, unknown> | null | undefined,
): string {
  return sha256(content + canonicalJsonStringify(frontmatter ?? {}));
}
