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
import { computeNoteHash } from "../reader/index.js";
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
  /**
   * Called exactly once, immediately before the filesystem write. Used by
   * the MCP server to mark the path on the watcher's SuppressionSet so the
   * watcher ignores the fs event triggered by our own atomic rename.
   *
   * If the operation aborts (hash conflict, permission denied) this hook
   * is NOT called — so a failed write cannot accidentally suppress a real
   * external edit that happens shortly after.
   */
  onBeforeFsWrite?: () => void;
}

export interface DeleteNoteInput {
  vault: Vault;
  relativePath: string;
  /** Required for delete — caller must prove they read the current state. */
  expectedHash: string;
  clientId?: string;
  /** See WriteNoteInput.onBeforeFsWrite. Called just before fs.unlink. */
  onBeforeFsWrite?: () => void;
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
 * Compute the canonical content-hash the way the reader does. Delegates to
 * `computeNoteHash` from reader/hash.ts (canonical, key-sorted JSON).
 */
function computeHash(
  content: string,
  frontmatter: Record<string, unknown> | null,
): string {
  return computeNoteHash(content, frontmatter);
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
  const absPath = await safeJoinInsideVault(vault.config.path, relativePath);

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

  input.onBeforeFsWrite?.();
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

  // Codex MEDIUM-1: wrap the three DB writes in a single transaction so they
  // either all land or none do. If the transaction throws, roll back the FS
  // write to the pre-write state — either by unlinking a freshly created
  // file, or restoring the previous on-disk content.
  let upsertId: number;
  try {
    upsertId = vault.db.transaction(() => {
      const up = vault.db.notes.upsertByPath({
        path: relativePath,
        content: written.content,
        frontmatter: written.frontmatter ? JSON.stringify(written.frontmatter) : null,
        title,
        hash: written.hash,
        mtime: Math.floor(stat.mtimeMs),
        wordCount: countWords(written.content),
      });
      vault.db.aliases.setForNote(up.id, extractAliases(written.frontmatter));
      vault.db.audit.recordWrite({
        noteId: up.id,
        op: created ? "create" : "update",
        previousHash,
        newHash: written.hash,
        expectedHash: input.expectedHash ?? null,
        clientId,
        diffSummary: null,
      });
      return up.id;
    });
  } catch (dbErr) {
    // Suppress the next watcher event from our rollback write/unlink too —
    // the watcher would otherwise re-index the rolled-back state and undo
    // the rollback's intent.
    input.onBeforeFsWrite?.();
    try {
      if (created) {
        await fs.unlink(absPath);
      } else if (existing !== null) {
        await atomicWriteFile(absPath, existing.raw);
      }
    } catch {
      // Rollback failed — leave the divergence visible by re-throwing the
      // original DB error. Catch-up reconciliation will eventually heal it.
    }
    throw dbErr;
  }

  return {
    ok: true,
    newHash: written.hash,
    noteId: upsertId,
    created,
  };
}

export async function deleteNote(input: DeleteNoteInput): Promise<WriteResult> {
  const { vault, relativePath, expectedHash } = input;
  const clientId = input.clientId ?? DEFAULT_CLIENT_ID;

  if (vault.config.write_enabled !== true) {
    return permissionDenied(vault.config.name);
  }

  const absPath = await safeJoinInsideVault(vault.config.path, relativePath);

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

  input.onBeforeFsWrite?.();
  await fs.unlink(absPath);

  // Remove from DB. If the note was never indexed (e.g. file appeared and
  // was deleted between indexer runs) we still record a synthetic audit
  // entry — but only when we have a noteId. Without one, the audit row
  // can't be tied to a (now-gone) note.
  if (previousNote !== null) {
    // Since migration 003 the FKs do the right thing:
    //   - chunks.note_id, note_aliases.note_id → ON DELETE CASCADE (auto-clear)
    //   - wikilinks.source_note → ON DELETE CASCADE (outgoing links gone)
    //   - wikilinks.target_note → ON DELETE SET NULL (incoming links become
    //     broken; find_broken_links surfaces them correctly)
    //   - write_audit.note_id → ON DELETE SET NULL (the audit row survives;
    //     getAuditLog already resolves notePath=null for a vanished note)
    //
    // Wrap delete + audit insert in one transaction so a crash leaves
    // either both or neither.
    vault.db.transaction(() => {
      vault.db.audit.recordWrite({
        noteId: previousNote.id,
        op: "delete",
        previousHash,
        newHash: null,
        expectedHash,
        clientId,
        diffSummary: null,
      });
      vault.db.notes.deleteByPath(relativePath);
    });
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
