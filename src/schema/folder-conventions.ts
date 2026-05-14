/**
 * Folder-convention learner.
 *
 * For a given vault-relative path, gather frontmatter conventions from
 * sibling notes (same folder prefix). The learner emits per-key:
 *   - presence prevalence (how many sibling notes have the key)
 *   - dominant value (if any single value covers >50% of populated notes)
 *
 * SQL-only — no embeddings, no LLM. Fast.
 *
 * Fallback: when the immediate folder has <3 sibling notes, the learner
 * walks UP one path segment (e.g. `Intelligence Impact/INIM-BDEV/Meetings/`
 * falls back to `Intelligence Impact/INIM-BDEV/`) until it finds enough
 * siblings OR reaches the vault root. This prevents the "single note in a
 * new folder gets no suggestions" failure mode.
 */

import type { Vault } from "../vault/index.js";

/**
 * A single per-key inference result from the folder layer.
 */
export interface FolderConventionEntry {
  /** Frontmatter key name (e.g. "class", "status", "tags"). */
  key: string;
  /** Number of sibling notes (in the resolved folder) that have this key. */
  presenceCount: number;
  /** Total sibling notes in the resolved folder (denominator). */
  siblingCount: number;
  /** Presence ratio: presenceCount / siblingCount. */
  prevalence: number;
  /**
   * If a single value covers >50% of notes-with-this-key, the dominant
   * value. Otherwise null (split inference — no value, just the key).
   * Stored as JSON-typed: string, number, boolean, or array of strings
   * for the `tags` case.
   */
  dominantValue: unknown | null;
  /** Coverage of the dominant value among notes-with-this-key. */
  dominantValueRatio: number;
}

/**
 * The resolved folder used for the inference, plus the entries.
 * `resolvedFolder` may not be the original note's immediate folder —
 * see fallback rules above.
 */
export interface FolderConventionResult {
  resolvedFolder: string;
  siblingCount: number;
  fellBackFrom: string | null;
  entries: FolderConventionEntry[];
}

/** Minimum sibling notes required before we trust folder inference. */
const MIN_SIBLINGS = 3;

/** Maximum levels to walk up before giving up. */
const MAX_FALLBACK_LEVELS = 4;

/**
 * Resolve the folder for a given vault-relative note path.
 *
 * - `Personen/Joerg.md` → `Personen/`
 * - `Intelligence Impact/INIM-BDEV/Meetings/2026-05-12.md`
 *     → `Intelligence Impact/INIM-BDEV/Meetings/`
 * - `note-at-root.md` → `""` (the vault root)
 */
export function folderOf(notePath: string): string {
  const idx = notePath.lastIndexOf("/");
  return idx === -1 ? "" : notePath.slice(0, idx + 1);
}

/**
 * Walk up one folder level. `Foo/Bar/` → `Foo/`. `Foo/` → `""`. `""` → null.
 */
function parentFolder(folder: string): string | null {
  if (folder === "") return null;
  const trimmed = folder.endsWith("/") ? folder.slice(0, -1) : folder;
  const idx = trimmed.lastIndexOf("/");
  if (idx === -1) return "";
  return trimmed.slice(0, idx + 1);
}

interface SiblingRow {
  path: string;
  frontmatter: string | null;
}

/**
 * Count sibling notes (any path starting with `folder`, excluding the
 * input note itself when applicable). Empty folder string means vault root.
 */
function countSiblings(vault: Vault, folder: string, excludePath: string | null): number {
  const handle = vault.db.handle;
  if (folder === "") {
    // Vault root: notes with no `/` in path. The simplest reliable filter.
    const row = handle
      .prepare<
        [string | null],
        { c: number }
      >("SELECT COUNT(*) AS c FROM notes WHERE instr(path, '/') = 0 AND path != COALESCE(?, '')")
      .get(excludePath);
    return row?.c ?? 0;
  }
  const row = handle
    .prepare<
      [string, string | null],
      { c: number }
    >("SELECT COUNT(*) AS c FROM notes WHERE path LIKE ? || '%' AND path != COALESCE(?, '')")
    .get(folder, excludePath);
  return row?.c ?? 0;
}

function fetchSiblings(vault: Vault, folder: string, excludePath: string | null): SiblingRow[] {
  const handle = vault.db.handle;
  if (folder === "") {
    return handle
      .prepare<
        [string | null],
        SiblingRow
      >("SELECT path, frontmatter FROM notes WHERE instr(path, '/') = 0 AND path != COALESCE(?, '')")
      .all(excludePath);
  }
  return handle
    .prepare<
      [string, string | null],
      SiblingRow
    >("SELECT path, frontmatter FROM notes WHERE path LIKE ? || '%' AND path != COALESCE(?, '')")
    .all(folder, excludePath);
}

/**
 * Resolve the folder for inference, walking up if too few siblings.
 * Returns the chosen folder and the original folder (if different).
 */
export function resolveInferenceFolder(
  vault: Vault,
  notePath: string,
  excludePath: string | null = notePath,
): { folder: string; fellBackFrom: string | null; siblingCount: number } {
  const start = folderOf(notePath);
  let current: string | null = start;
  let levels = 0;
  while (current !== null && levels < MAX_FALLBACK_LEVELS) {
    const count = countSiblings(vault, current, excludePath);
    if (count >= MIN_SIBLINGS || current === "") {
      return {
        folder: current,
        fellBackFrom: current === start ? null : start,
        siblingCount: count,
      };
    }
    current = parentFolder(current);
    levels++;
  }
  return { folder: "", fellBackFrom: start, siblingCount: 0 };
}

/**
 * Aggregate frontmatter keys + dominant values across a set of sibling rows.
 *
 * We tolerate dirty frontmatter (parse failures, primitives, nulls) without
 * crashing — same defensive posture as the v0.9.0 vault_stats aggregates.
 */
function aggregateEntries(siblings: SiblingRow[]): FolderConventionEntry[] {
  const total = siblings.length;
  if (total === 0) return [];

  // For each key: count occurrences + collect values seen.
  const keyPresence = new Map<string, number>();
  const keyValues = new Map<string, Map<string, number>>();

  for (const row of siblings) {
    if (!row.frontmatter) continue;
    let fm: unknown;
    try {
      fm = JSON.parse(row.frontmatter);
    } catch {
      continue;
    }
    if (!fm || typeof fm !== "object" || Array.isArray(fm)) continue;

    const obj = fm as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      keyPresence.set(key, (keyPresence.get(key) ?? 0) + 1);
      // Normalize the value to a comparable string for the dominant-value
      // bucket. Arrays and objects get a deterministic JSON form so e.g.
      // `tags: ["a","b"]` collides only with itself.
      const valKey = stableStringify(value);
      if (!keyValues.has(key)) keyValues.set(key, new Map());
      const bucket = keyValues.get(key)!;
      bucket.set(valKey, (bucket.get(valKey) ?? 0) + 1);
    }
  }

  const entries: FolderConventionEntry[] = [];
  for (const [key, presenceCount] of keyPresence) {
    const valueBucket = keyValues.get(key)!;
    const [domValStr, domCount] = pickDominant(valueBucket);
    const dominantValue = domCount / presenceCount > 0.5 ? safeParse(domValStr) : null;
    entries.push({
      key,
      presenceCount,
      siblingCount: total,
      prevalence: presenceCount / total,
      dominantValue,
      dominantValueRatio: domCount / presenceCount,
    });
  }

  // Sort by prevalence DESC, then key ASC for stable output.
  entries.sort((a, b) => {
    if (b.prevalence !== a.prevalence) return b.prevalence - a.prevalence;
    return a.key.localeCompare(b.key);
  });
  return entries;
}

function pickDominant(bucket: Map<string, number>): [string, number] {
  let bestKey = "";
  let bestCount = 0;
  for (const [k, c] of bucket) {
    if (c > bestCount) {
      bestKey = k;
      bestCount = c;
    }
  }
  return [bestKey, bestCount];
}

function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  return JSON.stringify(v, Object.keys((v as object) ?? {}).sort());
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Primary entry point. Returns folder-based frontmatter convention for
 * the input note (which may or may not yet exist in the DB — the path is
 * what matters).
 *
 * Pass `excludePath: null` when inferring for a brand-new note that isn't
 * indexed yet (so no sibling is wrongly skipped).
 */
export function inferFromFolder(
  vault: Vault,
  notePath: string,
  options: { excludePath?: string | null } = {},
): FolderConventionResult {
  const excludePath = options.excludePath ?? notePath;
  const { folder, fellBackFrom, siblingCount } = resolveInferenceFolder(
    vault,
    notePath,
    excludePath,
  );
  const siblings = fetchSiblings(vault, folder, excludePath);
  return {
    resolvedFolder: folder,
    siblingCount,
    fellBackFrom,
    entries: aggregateEntries(siblings),
  };
}
