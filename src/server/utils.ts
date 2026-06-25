/**
 * Pure utility helpers extracted from `src/server.ts` (the bootstrap
 * god-file). None of these close over `serve()` state — they take their
 * inputs as explicit parameters.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. The string
 * `.split("/")` operations in `decodeNoteId` / `defaultBasename` /
 * `normalizeFolderHint` are plain string manipulation, NOT `node:path`.
 * Display-URL routing delegates to the adapter registry seam
 * (`parseSourceHandle` / `formatDocId` / `SourceConnector.formatDisplayUrl`).
 */

import type BetterSqlite3 from "better-sqlite3";
import type { VaultManager } from "../vault/index.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";

export function countWords(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}

/**
 * Resolve which vaults a search should hit.
 *
 * Scope resolution (priority highest first):
 *   1. Explicit `vaultFilter` from the request → exactly those vaults.
 *   2. `activeVault` from VAULT_MEMORY_ACTIVE_VAULT env var → just that one.
 *   3. Neither set → all configured vaults (legacy behaviour).
 *
 * Indexing-status filter:
 *   - Vaults whose audit log shows an unfinished index run are excluded
 *     ONLY when the caller didn't ask for them explicitly. Idea: implicit
 *     cross-vault search shouldn't surface chunks whose embeddings aren't
 *     ready yet. Explicit single-vault requests pass through unchanged
 *     (caller takes responsibility, gets a `note` field in the response).
 *
 * Returns the resolved targets plus the names of any skipped vaults, so the
 * caller can include a transparency note in the response.
 */
export function resolveVaultTargets(
  manager: VaultManager,
  vaultFilter: string[] | undefined,
  activeVault: string | undefined,
): { targets: ReturnType<VaultManager["list"]>; skipped: string[] } {
  // Explicit request → honour even if mid-index (caller's choice).
  if (vaultFilter) {
    return { targets: vaultFilter.map((n) => manager.require(n)), skipped: [] };
  }
  const candidates = activeVault ? [manager.require(activeVault)] : manager.list();
  const targets: typeof candidates = [];
  const skipped: string[] = [];
  for (const v of candidates) {
    if (v.db.audit.isIndexing()) {
      skipped.push(v.config.name);
    } else {
      targets.push(v);
    }
  }
  return { targets, skipped };
}

export function encodeNoteId(vault: string, path: string): string {
  return `${vault}:${path}`;
}

export function decodeNoteId(id: string): { vault: string; path: string } {
  const idx = id.indexOf(":");
  if (idx <= 0 || idx === id.length - 1) {
    throw new Error(`Invalid id: ${id}. Expected format <vault>:<vault-relative-path>.`);
  }
  return { vault: id.slice(0, idx), path: id.slice(idx + 1) };
}

/**
 * D-01 (plan 01-04 task 06): the v1 `obsidianUrl(vault, path)` helper was
 * deleted. Display URLs now flow through `SourceConnector.formatDisplayUrl`
 * — the obsidian-fs source mints the same deep-link URL string byte-for-byte
 * (the Obsidian `open` URL scheme; verified same `encodeURIComponent`-per-
 * segment encoding scheme; documented in
 * `.planning/phases/01-…/01-04-SUMMARY.md` §"URL encoding parity"). Future
 * adapters (notion-api etc.) can publish their own display URLs without
 * changing core code.
 *
 * The internal helper `displayUrl(registry, vault, path)` below is the
 * routing shim; it resolves the source and delegates.
 */
export function displayUrl(registry: AdapterRegistry, vaultName: string, notePath: string): string {
  const source = registry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`));
  const docId = formatDocId("obsidian-fs", vaultName, notePath);
  // `formatDisplayUrl` is optional on the SourceConnector interface; for
  // future adapters that don't expose one, fall back to the raw doc_uri.
  return source.formatDisplayUrl?.(docId) ?? `obsidian-fs://${vaultName}/${notePath}`;
}

export function truncateSnippet(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Aggregate the top-N tags across all notes in a vault.
 *
 * Tags can live in two places in our schema: a top-level `tags` array in
 * frontmatter (Obsidian convention) or inline `#tag` hashtags in the body.
 * For v0.9.0 we read the frontmatter form only — it is what the user
 * curates explicitly and what other tools (Datacore queries, dataview)
 * already aggregate. Inline hashtags would need a separate pass through
 * note bodies and are deferred until users ask for it.
 *
 * Implementation uses SQLite's json_each over the stored frontmatter blob.
 * `frontmatter` is TEXT containing a JSON object; we look up the `tags` key
 * and iterate. Notes without frontmatter or without a tags array are
 * silently skipped.
 */
export function aggregateTopTags(
  db: BetterSqlite3.Database,
  limit: number,
): Array<{ tag: string; count: number }> {
  // Real vaults accumulate frontmatter drift: `tags` may be an array,
  // a single string, a nested object, or missing entirely. SQLite's
  // json_each() throws on non-array/object inputs and aborts the whole
  // query — so we pre-filter to rows where `tags` is actually an array.
  // The CROSS JOIN with the JSON table then only sees well-formed inputs.
  const rows = db
    .prepare<[number], { tag: string; count: number }>(
      `
      SELECT je.value AS tag, COUNT(*) AS count
      FROM notes
      JOIN json_each(json_extract(notes.frontmatter, '$.tags')) AS je
      WHERE notes.frontmatter IS NOT NULL
        AND json_type(notes.frontmatter, '$.tags') = 'array'
        AND typeof(je.value) = 'text'
      GROUP BY je.value
      ORDER BY count DESC, tag ASC
      LIMIT ?
    `,
    )
    .all(limit);
  return rows;
}

/**
 * Aggregate the top-N most common frontmatter keys across all notes.
 * Surfaces the user's schema conventions to an agent on first connect.
 */
export function aggregateTopFrontmatterKeys(
  db: BetterSqlite3.Database,
  limit: number,
): Array<{ key: string; count: number }> {
  // Same filter rationale as aggregateTopTags: a single note with a
  // non-object frontmatter blob (rare, but happens after manual edits)
  // would abort the whole aggregate.
  const rows = db
    .prepare<[number], { key: string; count: number }>(
      `
      SELECT je.key AS key, COUNT(*) AS count
      FROM notes
      JOIN json_each(notes.frontmatter) AS je
      WHERE notes.frontmatter IS NOT NULL
        AND json_type(notes.frontmatter) = 'object'
      GROUP BY je.key
      ORDER BY count DESC, key ASC
      LIMIT ?
    `,
    )
    .all(limit);
  return rows;
}

export function safeParseFrontmatter(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function defaultBasename(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

export function normalizeFolderHint(hint: string | undefined): string {
  if (!hint) return "";
  let h = hint.trim();
  // Strip leading slash; ensure trailing slash if non-empty.
  if (h.startsWith("/")) h = h.slice(1);
  if (h.length > 0 && !h.endsWith("/")) h = `${h}/`;
  return h;
}
