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
export async function atomicWriteFile(absPath: string, content: string): Promise<void> {
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
 * (e.g. `../../etc/passwd`, absolute paths, string-level traversal).
 *
 * This function ALSO follows symlinks via `fs.realpath` to defeat
 * symlink-escape attacks: if a directory inside the vault is a symlink
 * pointing outside (e.g. `Netzwerk/escape -> /etc`), any path beneath
 * it is rejected even though the joined string looks vault-internal.
 *
 * Realpath is applied to:
 *   - the vault root, and
 *   - the deepest existing ancestor of the target (since the target
 *     itself may not exist yet for a create/write).
 *
 * Async because it touches the filesystem.
 */
export async function safeJoinInsideVault(
  vaultRoot: string,
  relativePath: string,
): Promise<string> {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  // Disallow absolute inputs outright — caller must pass vault-relative.
  if (isAbsolute(relativePath)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  const root = resolve(vaultRoot);
  const target = resolve(root, relativePath);

  // String-level prefix check first — catches `../` traversal cheaply.
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  if (target === root) {
    // The vault root itself is not a writable note path.
    throw new OutsideVaultError(relativePath, vaultRoot);
  }

  // Realpath both sides to defeat symlink-escape. The target may not exist
  // yet (creating a new note), so walk up to the deepest existing ancestor
  // and realpath that. Anything not yet on disk is by definition a fresh
  // path that cannot itself be a symlink.
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    // If the vault root itself cannot be resolved, refuse — we cannot
    // guarantee any boundary check is meaningful.
    throw new OutsideVaultError(relativePath, vaultRoot);
  }

  const realTarget = await resolveExistingAncestor(target);
  const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(realRootWithSep)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }

  return target;
}

/**
 * Resolve the deepest existing ancestor of `absPath` via realpath, then
 * re-attach any non-existent trailing segments. This handles the common
 * case of writing a brand-new file whose parent (or grandparent) exists.
 */
async function resolveExistingAncestor(absPath: string): Promise<string> {
  let current = absPath;
  const trailing: string[] = [];
  // Walk up until realpath succeeds or we hit the filesystem root.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const real = await fs.realpath(current);
      return trailing.length === 0 ? real : resolve(real, ...trailing.reverse());
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err;
      }
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root without ever resolving — fall back to
        // the original string. The caller's prefix check has already
        // verified string-level containment.
        return absPath;
      }
      // Track the non-existent leaf to re-attach after realpath.
      trailing.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}
