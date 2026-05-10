/**
 * updateFrontmatter — merge-style frontmatter editor.
 *
 * Modifies only the YAML frontmatter of a markdown note. The body is
 * preserved bytegenau. Writes are atomic and audited.
 *
 * Merge DSL (top-level keys of `merge`):
 *   <key>: <value>             → set / overwrite
 *   <key>: { $unset: true }    → delete the key
 *   <key>: { $push: x }        → push x onto array (create if absent)
 *   <key>: { $pull: x }        → remove x from array (no-op if absent)
 *   <key>: { ...plainObj }     → shallow-merge into existing object (or set)
 *
 * Concurrency: optional `expectedHash` is checked against the current
 * note hash (sha256 of `content + JSON.stringify(frontmatter ?? {})`).
 * Mismatch → conflict, no write.
 *
 * NOTE: gray-matter's stringify preserves the existing serialization
 * style for fields it knows about, but YAML key order for *new* keys is
 * insertion order. We do not guarantee a stable global key order.
 */

import { promises as fs } from "node:fs";
import matter from "gray-matter";
import type { Vault } from "../vault/index.js";
import { sha256 } from "../reader/hash.js";
import { extractAliases } from "../indexer/indexer.js";
import { atomicWriteFile, safeJoinInsideVault } from "../write/fs.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateFrontmatterInput {
  vault: Vault;
  relativePath: string;
  merge: Record<string, unknown>;
  expectedHash?: string;
  clientId?: string;
  /** Called once, immediately before the filesystem write. See
   *  `WriteNoteInput.onBeforeFsWrite`. Not called when the update is a
   *  no-op (empty merge or no effective change) since no fs event will
   *  occur. */
  onBeforeFsWrite?: () => void;
}

export type DiffOp = "set" | "unset" | "push" | "pull";

export interface DiffEntry {
  key: string;
  op: DiffOp;
  before?: unknown;
  after?: unknown;
}

export interface UpdateSuccess {
  ok: true;
  newHash: string;
  noteId: number;
  diff: DiffEntry[];
}

export interface UpdateConflict {
  ok: false;
  reason: "hash_mismatch" | "permission_denied" | "note_not_found";
  currentHash?: string;
  message: string;
}

export type UpdateResult = UpdateSuccess | UpdateConflict;

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUnsetDirective(v: unknown): v is { $unset: true } {
  return isPlainObject(v) && v["$unset"] === true;
}

function isPushDirective(v: unknown): v is { $push: unknown } {
  return isPlainObject(v) && "$push" in v;
}

function isPullDirective(v: unknown): v is { $pull: unknown } {
  return isPlainObject(v) && "$pull" in v;
}

function hasDirective(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return Object.keys(v).some((k) => k.startsWith("$"));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function applyMerge(
  data: Record<string, unknown>,
  merge: Record<string, unknown>,
): { next: Record<string, unknown>; diff: DiffEntry[] } {
  const next: Record<string, unknown> = { ...data };
  const diff: DiffEntry[] = [];

  for (const [key, instr] of Object.entries(merge)) {
    const before = next[key];

    if (isUnsetDirective(instr)) {
      if (key in next) {
        delete next[key];
        diff.push({ key, op: "unset", before });
      }
      continue;
    }

    if (isPushDirective(instr)) {
      const value = (instr as { $push: unknown }).$push;
      if (Array.isArray(before)) {
        const arr = [...before, value];
        next[key] = arr;
        diff.push({ key, op: "push", before, after: arr });
      } else if (before === undefined) {
        next[key] = [value];
        diff.push({ key, op: "push", before: undefined, after: [value] });
      } else {
        // Treat non-array existing scalar as wrapping into a new array
        next[key] = [value];
        diff.push({ key, op: "push", before, after: [value] });
      }
      continue;
    }

    if (isPullDirective(instr)) {
      const value = (instr as { $pull: unknown }).$pull;
      if (Array.isArray(before)) {
        const filtered = before.filter((v) => !deepEqual(v, value));
        if (filtered.length !== before.length) {
          next[key] = filtered;
          diff.push({ key, op: "pull", before, after: filtered });
        }
      }
      // else: no-op
      continue;
    }

    // Plain set or shallow-merge nested object
    if (isPlainObject(instr) && !hasDirective(instr) && isPlainObject(before)) {
      const merged = { ...before, ...instr };
      if (!deepEqual(before, merged)) {
        next[key] = merged;
        diff.push({ key, op: "set", before, after: merged });
      }
    } else {
      if (!deepEqual(before, instr)) {
        next[key] = instr;
        diff.push({ key, op: "set", before, after: instr });
      }
    }
  }

  return { next, diff };
}

function computeHash(content: string, data: Record<string, unknown>): string {
  // Mirror reader/parser: empty frontmatter → JSON.stringify({}).
  const fmForHash = Object.keys(data).length > 0 ? data : {};
  return sha256(content + JSON.stringify(fmForHash));
}

function countWords(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}

function extractTitle(content: string, fallback: string): string {
  for (const line of content.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== undefined) return m[1].trim();
  }
  return fallback;
}

function basenameNoMd(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? relativePath;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export async function updateFrontmatter(
  input: UpdateFrontmatterInput,
): Promise<UpdateResult> {
  const { vault, relativePath, merge, expectedHash, clientId } = input;

  if (vault.config.write_enabled !== true) {
    return {
      ok: false,
      reason: "permission_denied",
      message: "Vault is not write-enabled. Set write_enabled=true in config.",
    };
  }

  const noteRow = vault.db.notes.getByPath(relativePath);
  if (noteRow === null) {
    return {
      ok: false,
      reason: "note_not_found",
      message: `No indexed note at path: ${relativePath}`,
    };
  }

  const absPath = await safeJoinInsideVault(vault.config.path, relativePath);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "note_not_found",
      message: `Failed to read file: ${msg}`,
    };
  }

  const parsed = matter(raw);
  const content = parsed.content;
  const data = (parsed.data ?? {}) as Record<string, unknown>;

  const currentHash = computeHash(content, data);
  if (expectedHash !== undefined && expectedHash !== currentHash) {
    return {
      ok: false,
      reason: "hash_mismatch",
      currentHash,
      message: `Expected hash ${expectedHash} but current is ${currentHash}.`,
    };
  }

  // Empty merge → no-op
  if (Object.keys(merge).length === 0) {
    return {
      ok: true,
      newHash: currentHash,
      noteId: noteRow.id,
      diff: [],
    };
  }

  const { next, diff } = applyMerge(data, merge);

  if (diff.length === 0) {
    // Nothing actually changed (e.g. $pull on absent value)
    return {
      ok: true,
      newHash: currentHash,
      noteId: noteRow.id,
      diff: [],
    };
  }

  // Build the new file. gray-matter.stringify writes frontmatter even when
  // empty — we explicitly handle the all-deleted case by emitting just body.
  const fullText =
    Object.keys(next).length === 0 ? content : matter.stringify(content, next);

  input.onBeforeFsWrite?.();
  await atomicWriteFile(absPath, fullText);

  const stat = await fs.stat(absPath);
  const newHash = computeHash(content, next);
  const title = extractTitle(content, basenameNoMd(relativePath));
  const wordCount = countWords(content);
  const fmJson = Object.keys(next).length > 0 ? JSON.stringify(next) : null;

  const upsert = vault.db.notes.upsertByPath({
    path: relativePath,
    content,
    frontmatter: fmJson,
    title,
    hash: newHash,
    mtime: Math.floor(stat.mtimeMs),
    wordCount,
  });

  // Aliases: re-derive from the new frontmatter and replace in DB.
  const aliasKeyTouched = "aliases" in merge || "alias" in merge;
  if (aliasKeyTouched) {
    vault.db.aliases.setForNote(upsert.id, extractAliases(next));
  }

  vault.db.audit.recordWrite({
    noteId: upsert.id,
    op: "update",
    previousHash: currentHash,
    newHash,
    expectedHash: expectedHash ?? null,
    clientId: clientId ?? null,
    diffSummary: JSON.stringify(diff),
  });

  return {
    ok: true,
    newHash,
    noteId: upsert.id,
    diff,
  };
}
