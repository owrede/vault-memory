/**
 * write/write.ts — atomic vault writes with hash-based concurrency control.
 *
 * Both `writeNote` and `deleteNote` keep the file system and the vault DB
 * in sync: the file is written/removed first, then the DB is updated and
 * an audit row is inserted. If the on-disk hash does not match the
 * caller-provided `expectedHash`, the operation aborts BEFORE touching
 * either FS or DB and returns a structured conflict.
 */

import { promises as fs } from "node:fs";
import { basename } from "node:path";
import matter from "gray-matter";
import type { Vault } from "../vault/index.js";
import { sha256 } from "../reader/index.js";
import { extractAliases } from "../indexer/index.js";
import { atomicWriteFile, safeJoinInsideVault } from "./fs.js";

export interface WriteSuccess {
  ok: true;
  newHash: string;
  noteId: number;
  /** True if a brand-new file/note was created. */
  created: boolean;
}

export interface WriteConflict {
  ok: false;
  reason: "hash_mismatch" | "permission_denied";
  currentHash?: string;
  currentContent?: string;
  message: string;
}

export type WriteResult = WriteSuccess | WriteConflict;

export interface WriteNoteInput {
  vault: Vault;
  /** Vault-relative path with forward slashes, ending in .md */
  relativePath: string;
  /** Markdown body WITHOUT frontmatter delimiters. */
  content: string;
  /** Optional frontmatter object — will be serialized to YAML by the function. */
  frontmatter?: Record<string, unknown> | null;
  /**
   * Concurrency token. If the file's current hash on disk differs from
   * this, return a conflict instead of writing. If omitted: write
   * unconditionally only when the file does NOT exist yet; otherwise
   * return a conflict.
   */
  expectedHash?: string;
  /** For audit_log entry. Defaults to "claude-code". */
  clientId?: string;
}

export interface DeleteNoteInput {
  vault: Vault;
  relativePath: string;
  /** Required for delete — caller must prove they read the current state. */
  expectedHash: string;
  clientId?: string;
}

const DEFAULT_CLIENT_ID = "claude-code";

function permissionDenied(vaultName: string): WriteConflict {
  return {
    ok: false,
    reason: "permission_denied",
    message: `Vault "${vaultName}" is read-only (write_enabled=false in config.toml)`,
  };
}

/**
 * Compute the canonical content-hash the way the reader does:
 *   sha256(content + JSON.stringify(frontmatter ?? {}))
 *
 * Frontmatter is normalized to `{}` when empty/missing so a freshly written
 * file with no frontmatter hashes the same way as one parsed by the reader.
 */
function computeHash(
  content: string,
  frontmatter: Record<string, unknown> | null,
): string {
  return sha256(content + JSON.stringify(frontmatter ?? {}));
}

function extractTitle(content: string, relativePath: string): string {
  for (const line of content.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== undefined) return m[1].trim();
  }
  return basename(relativePath, ".md");
}

function countWords(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}

async function readExistingFile(
  absPath: string,
): Promise<{ raw: string; content: string; frontmatter: Record<string, unknown> | null; hash: string } | null> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf-8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
  const parsed = matter(raw);
  const fmData = parsed.data as Record<string, unknown> | undefined;
  const frontmatter: Record<string, unknown> | null =
    fmData !== undefined && Object.keys(fmData).length > 0 ? fmData : null;
  const hash = computeHash(parsed.content, frontmatter);
  return { raw, content: parsed.content, frontmatter, hash };
}

export async function writeNote(input: WriteNoteInput): Promise<WriteResult> {
  const { vault, relativePath, content } = input;
  const frontmatter = input.frontmatter ?? null;
  const clientId = input.clientId ?? DEFAULT_CLIENT_ID;

  if (vault.config.write_enabled !== true) {
    return permissionDenied(vault.config.name);
  }

  // Throws OutsideVaultError on traversal — intentional: callers should not
  // be able to construct invalid paths and silently get a "conflict".
  const absPath = safeJoinInsideVault(vault.config.path, relativePath);

  const existing = await readExistingFile(absPath);
  const created = existing === null;

  if (existing !== null) {
    if (input.expectedHash === undefined) {
      return {
        ok: false,
        reason: "hash_mismatch",
        currentHash: existing.hash,
        currentContent: existing.raw,
        message:
          `File "${relativePath}" already exists. ` +
          `Pass expectedHash="${existing.hash}" to overwrite intentionally.`,
      };
    }
    if (input.expectedHash !== existing.hash) {
      return {
        ok: false,
        reason: "hash_mismatch",
        currentHash: existing.hash,
        currentContent: existing.raw,
        message:
          `Hash mismatch for "${relativePath}": ` +
          `expected ${input.expectedHash}, got ${existing.hash}. ` +
          `The file was modified externally — re-read and retry.`,
      };
    }
  }

  // Serialize new content. gray-matter.stringify writes a `---` block only
  // when the data object is non-empty; we mirror that behavior explicitly.
  const fileText =
    frontmatter !== null && Object.keys(frontmatter).length > 0
      ? matter.stringify(content, frontmatter)
      : content;

  await atomicWriteFile(absPath, fileText);

  // Re-parse from disk to compute the canonical post-write hash. This also
  // protects us against any normalization gray-matter may apply on stringify.
  const written = await readExistingFile(absPath);
  if (written === null) {
    // Should never happen — we just wrote it.
    throw new Error(
      `Internal error: file disappeared after write: ${relativePath}`,
    );
  }
  const stat = await fs.stat(absPath);

  const previousNote = vault.db.notes.getByPath(relativePath);
  const previousHash = previousNote?.hash ?? null;
  const title = extractTitle(written.content, relativePath);

  const upsert = vault.db.notes.upsertByPath({
    path: relativePath,
    content: written.content,
    frontmatter: written.frontmatter ? JSON.stringify(written.frontmatter) : null,
    title,
    hash: written.hash,
    mtime: Math.floor(stat.mtimeMs),
    wordCount: countWords(written.content),
  });

  // Persist aliases — same logic as the indexer so write+reindex agree.
  vault.db.aliases.setForNote(upsert.id, extractAliases(written.frontmatter));

  vault.db.audit.recordWrite({
    noteId: upsert.id,
    op: created ? "create" : "update",
    previousHash,
    newHash: written.hash,
    expectedHash: input.expectedHash ?? null,
    clientId,
    diffSummary: null,
  });

  return {
    ok: true,
    newHash: written.hash,
    noteId: upsert.id,
    created,
  };
}

export async function deleteNote(input: DeleteNoteInput): Promise<WriteResult> {
  const { vault, relativePath, expectedHash } = input;
  const clientId = input.clientId ?? DEFAULT_CLIENT_ID;

  if (vault.config.write_enabled !== true) {
    return permissionDenied(vault.config.name);
  }

  const absPath = safeJoinInsideVault(vault.config.path, relativePath);

  const existing = await readExistingFile(absPath);
  if (existing === null) {
    return {
      ok: false,
      reason: "hash_mismatch",
      message: `File "${relativePath}" does not exist — nothing to delete.`,
    };
  }
  if (existing.hash !== expectedHash) {
    return {
      ok: false,
      reason: "hash_mismatch",
      currentHash: existing.hash,
      currentContent: existing.raw,
      message:
        `Hash mismatch for "${relativePath}": ` +
        `expected ${expectedHash}, got ${existing.hash}. ` +
        `The file was modified externally — re-read and retry.`,
    };
  }

  const previousNote = vault.db.notes.getByPath(relativePath);
  const previousHash = previousNote?.hash ?? existing.hash;

  await fs.unlink(absPath);

  // Remove from DB. If the note was never indexed (e.g. file appeared and
  // was deleted between indexer runs) we still record a synthetic audit
  // entry — but only when we have a noteId. Without one, the audit row
  // can't be tied to a (now-gone) note.
  if (previousNote !== null) {
    // The current schema's write_audit.note_id REFERENCES notes(id) without
    // ON DELETE CASCADE / SET NULL. That means once we delete a note, no
    // audit row can legally reference its id — including the freshly
    // recorded "delete" entry. To preserve audit semantics without
    // changing the schema, we briefly disable foreign-key enforcement for
    // the delete transaction. The audit row is intentionally left as a
    // dangling reference (note_id of a no-longer-existing note); audit
    // queries treat note_id as opaque history, not as a live FK.
    // SQLite forbids changing `foreign_keys` inside a transaction, so we
    // toggle it outside and run the multi-statement delete as a manual
    // sequence. With FKs off we must clear cascade dependents ourselves.
    vault.db.handle.pragma("foreign_keys = OFF");
    try {
      vault.db.transaction(() => {
        vault.db.chunks.deleteByNote(previousNote.id);
        vault.db.wikilinks.deleteByNote(previousNote.id);
        vault.db.aliases.setForNote(previousNote.id, []);
        vault.db.notes.deleteByPath(relativePath);
        vault.db.audit.recordWrite({
          noteId: previousNote.id,
          op: "delete",
          previousHash,
          newHash: null,
          expectedHash,
          clientId,
          diffSummary: null,
        });
      });
    } finally {
      vault.db.handle.pragma("foreign_keys = ON");
    }
    return {
      ok: true,
      newHash: existing.hash,
      noteId: previousNote.id,
      created: false,
    };
  }

  return {
    ok: true,
    newHash: existing.hash,
    noteId: 0,
    created: false,
  };
}
