/**
 * Atomic filesystem helpers for the write module.
 *
 * Atomicity strategy: write to a sibling tmp file in the same directory as
 * the target, then `rename` it on top. On POSIX file systems, rename within
 * the same directory is atomic — this prevents readers (including Obsidian)
 * from ever observing a partially-written file.
 */

import { promises as fs } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

export class OutsideVaultError extends Error {
  constructor(relativePath: string, vaultRoot: string) {
    super(
      `Refused to operate on path outside vault: "${relativePath}" (vault root: "${vaultRoot}")`,
    );
    this.name = "OutsideVaultError";
  }
}

/**
 * Write `content` to `absPath` atomically. Creates parent directories if needed.
 *
 * The tmp file lives in the SAME directory as the target so the final rename
 * stays on the same filesystem (and therefore atomic).
 */
export async function atomicWriteFile(
  absPath: string,
  content: string,
): Promise<void> {
  if (!isAbsolute(absPath)) {
    throw new Error(`atomicWriteFile requires an absolute path: ${absPath}`);
  }
  const parent = dirname(absPath);
  await fs.mkdir(parent, { recursive: true });

  const suffix = randomBytes(8).toString("hex");
  const tmpPath = `${absPath}.tmp.${suffix}`;
  try {
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, absPath);
  } catch (err) {
    // Best-effort cleanup of the tmp file. Ignore failure of cleanup itself.
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* swallow */
    }
    throw err;
  }
}

/**
 * Resolve `relativePath` against `vaultRoot` and verify the result stays
 * within the vault. Throws `OutsideVaultError` on any escape attempt
 * (e.g. `../../etc/passwd`, absolute paths, symlink-style traversal in
 * the input string).
 *
 * Note: this is a path-string check; it does not follow symlinks. The
 * write module operates on vault-relative inputs only and does not chase
 * links.
 */
export function safeJoinInsideVault(
  vaultRoot: string,
  relativePath: string,
): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  // Disallow absolute inputs outright — caller must pass vault-relative.
  if (isAbsolute(relativePath)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  const root = resolve(vaultRoot);
  const target = resolve(root, relativePath);
  // Ensure target is `root` itself (never valid for a file) or a descendant.
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  if (target === root) {
    // The vault root itself is not a writable note path.
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  return target;
}
