/**
 * Neighbor-based frontmatter inference.
 *
 * For a given note path, gather frontmatter conventions from the notes
 * directly linked to it — forward (notes this one points TO) and
 * backward (notes that link TO this one).
 *
 * Why this works: in a curated vault, a note's wikilink-neighborhood
 * carries semantic context that the folder may not. Example: a meeting
 * note `2026-05-12 Sondierung.md` links to `[[Jörg]]` (Person) and
 * `[[INIM-BDEV]]` (Project) — the link-cluster of typical "meeting"
 * notes will look the same.
 *
 * The neighbor learner is weaker than folder-conventions (more indirect)
 * but rescues cases where folder structure is shallow or unconvention'd.
 */

import type { Vault } from "../vault/index.js";

export interface NeighborInferenceEntry {
  /** Frontmatter key seen in neighbors. */
  key: string;
  /** Number of neighbors that have the key. */
  neighborCount: number;
  /** Total neighbors considered (denominator). */
  totalNeighbors: number;
  /** Presence ratio. */
  prevalence: number;
  /** Dominant value across neighbors-with-this-key, if any. */
  dominantValue: unknown | null;
  /** Coverage of the dominant value. */
  dominantValueRatio: number;
}

export interface NeighborInferenceResult {
  /** Number of forward links resolved to existing notes. */
  forwardCount: number;
  /** Number of backlinks. */
  backwardCount: number;
  /** Combined unique neighbor count (denominator for prevalence). */
  totalNeighbors: number;
  entries: NeighborInferenceEntry[];
}

interface NeighborRow {
  path: string;
  frontmatter: string | null;
}

/**
 * Gather all neighbor notes (forward + backward links), deduplicated by
 * note id.
 *
 * For a note that does not yet exist in the DB (brand-new), backlinks
 * cannot be computed (nothing links to it yet). Only forward-links from
 * the parsed content can contribute — but parsing happens upstream.
 * In that case the caller passes the parsed wikilinks directly via
 * `additionalForwardTargets`.
 */
function gatherNeighbors(
  vault: Vault,
  notePath: string,
  additionalForwardTargets: string[] = [],
): NeighborRow[] {
  const seenIds = new Set<number>();
  const out: NeighborRow[] = [];

  const note = vault.db.notes.getByPath(notePath);

  // Backward: who links to this note's path (only meaningful if the note
  // exists in DB; backlinks reference target_note id OR a target_path
  // for unresolved links).
  if (note) {
    const back = vault.db.wikilinks.getBacklinks(note.id);
    for (const row of back) {
      if (seenIds.has(row.sourceNoteId)) continue;
      const src = vault.db.notes.getById(row.sourceNoteId);
      if (!src) continue;
      seenIds.add(src.id);
      out.push({ path: src.path, frontmatter: src.frontmatter });
    }

    // Forward: links this note has (already in DB).
    const forward = vault.db.wikilinks.getForwardLinks(note.id);
    for (const row of forward) {
      if (row.targetNoteId === null) continue;
      if (seenIds.has(row.targetNoteId)) continue;
      const target = vault.db.notes.getById(row.targetNoteId);
      if (!target) continue;
      seenIds.add(target.id);
      out.push({ path: target.path, frontmatter: target.frontmatter });
    }
  }

  // Fallback / new-note path: caller-supplied wikilink targets resolved
  // via path lookup. These are unresolved-link strings from parser
  // (e.g. "Personen/Jörg" — no .md).
  for (const target of additionalForwardTargets) {
    const candidate = vault.db.notes.getByPath(`${target}.md`) ?? vault.db.notes.getByPath(target);
    if (!candidate) continue;
    if (seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);
    out.push({ path: candidate.path, frontmatter: candidate.frontmatter });
  }

  return out;
}

function aggregateEntries(neighbors: NeighborRow[]): NeighborInferenceEntry[] {
  const total = neighbors.length;
  if (total === 0) return [];

  const keyPresence = new Map<string, number>();
  const keyValues = new Map<string, Map<string, number>>();

  for (const row of neighbors) {
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
      const valKey = JSON.stringify(value, Object.keys((value as object) ?? {}).sort());
      if (!keyValues.has(key)) keyValues.set(key, new Map());
      const bucket = keyValues.get(key)!;
      bucket.set(valKey, (bucket.get(valKey) ?? 0) + 1);
    }
  }

  const entries: NeighborInferenceEntry[] = [];
  for (const [key, presenceCount] of keyPresence) {
    const valueBucket = keyValues.get(key)!;
    let bestKey = "";
    let bestCount = 0;
    for (const [k, c] of valueBucket) {
      if (c > bestCount) {
        bestKey = k;
        bestCount = c;
      }
    }
    const dominantValue = bestCount / presenceCount > 0.5 ? safeParse(bestKey) : null;
    entries.push({
      key,
      neighborCount: presenceCount,
      totalNeighbors: total,
      prevalence: presenceCount / total,
      dominantValue,
      dominantValueRatio: bestCount / presenceCount,
    });
  }

  entries.sort((a, b) => {
    if (b.prevalence !== a.prevalence) return b.prevalence - a.prevalence;
    return a.key.localeCompare(b.key);
  });
  return entries;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Primary entry point. For a note path, returns the frontmatter
 * conventions visible across its linked neighbors.
 *
 * `additionalForwardTargets`: vault-relative paths (without `.md`) for
 * wikilinks that haven't been indexed yet — typically passed by the
 * tool handler when the input is a draft content blob rather than an
 * indexed note.
 */
export function inferFromNeighbors(
  vault: Vault,
  notePath: string,
  additionalForwardTargets: string[] = [],
): NeighborInferenceResult {
  const neighbors = gatherNeighbors(vault, notePath, additionalForwardTargets);

  // Approximate forward/backward split — not strictly needed for the
  // aggregate, but useful in the tool response so the agent can see
  // where the signal came from.
  const note = vault.db.notes.getByPath(notePath);
  let forwardCount = 0;
  let backwardCount = 0;
  if (note) {
    forwardCount = vault.db.wikilinks
      .getForwardLinks(note.id)
      .filter((r) => r.targetNoteId !== null).length;
    backwardCount = vault.db.wikilinks.getBacklinks(note.id).length;
  }

  return {
    forwardCount,
    backwardCount,
    totalNeighbors: neighbors.length,
    entries: aggregateEntries(neighbors),
  };
}
