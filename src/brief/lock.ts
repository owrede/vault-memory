// vault-memory:claude-ok — process state (~/.vault-memory/locks/) not vault content.
// See ADR-005 §"Lockfile carve-out" for the rationale.
//
// This file is the ONLY exemption to scripts/lint-adapters.sh in Phase 5.
// Adapter-seam discipline (no fs/path.join outside src/adapters/*/) does NOT
// apply: lockfiles are process state managed by ~/.vault-memory/, not user
// vault content. Per D-08 + ADR-005.

/**
 * Phase 5 / D-08 — `~/.vault-memory/locks/<vault>.lock` single-owner
 * primitive for the staleness daemon.
 *
 * Atomic exclusive create via `fs.open(path, 'wx')` (POSIX `O_WRONLY |
 * O_CREAT | O_EXCL`). On EEXIST, read the recorded PID; if dead
 * (POSIX `kill(pid, 0)` throws ESRCH), steal the lock — otherwise
 * return contended.
 *
 * Multi-MCP-client friendly per CONTEXT D-08: second `vault-memory
 * serve` against the same vault boots normally; only the daemon
 * subscription is gated.
 *
 * No `node:fs` imports outside this file in `src/brief/`.
 */

import { open, readFile, unlink, mkdir } from "node:fs/promises"; // vault-memory:claude-ok
import { homedir } from "node:os";
import { join } from "node:path"; // vault-memory:claude-ok

export interface LockAcquired {
  acquired: true;
  pid: number;
  path: string;
  stolenFromPid?: number;
}

export interface LockContended {
  acquired: false;
  ownerPid: number;
  path: string;
}

export type LockResult = LockAcquired | LockContended;

/**
 * Override the lock directory for tests so the real
 * `~/.vault-memory/locks/` is never touched during the test suite.
 * Test-only — production call sites omit the argument.
 */
function lockDir(rootOverride?: string): string {
  if (rootOverride !== undefined) return join(rootOverride, "locks");
  return join(homedir(), ".vault-memory", "locks");
}

function lockPath(vaultName: string, rootOverride?: string): string {
  return join(lockDir(rootOverride), `${vaultName}.lock`);
}

/** POSIX `kill(pid, 0)`: returns true if pid is alive, false on ESRCH. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH means no such process. EPERM means alive but inaccessible.
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    // Defensive: any other error treated as alive (we won't steal).
    return true;
  }
}

async function readOwnerPid(path: string): Promise<number | null> {
  try {
    const buf = await readFile(path, "utf8");
    const pid = parseInt(buf.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export interface AcquireLockOptions {
  /**
   * Test-only override for the `~/.vault-memory/` root. Production
   * call sites omit. When set, the lock lives at
   * `<root>/locks/<vault>.lock`.
   */
  rootOverride?: string;
}

/**
 * Try to acquire the lock for a vault.
 * Atomic create via `fs.open(path, 'wx')` (`O_WRONLY | O_CREAT | O_EXCL`).
 * On EEXIST: read current owner PID; if dead (ESRCH) or malformed,
 * steal the lock; else return contended.
 */
export async function tryAcquireLock(
  vaultName: string,
  options: AcquireLockOptions = {},
): Promise<LockResult> {
  const dir = lockDir(options.rootOverride);
  await mkdir(dir, { recursive: true });
  const path = lockPath(vaultName, options.rootOverride);

  // Defensive: bound recursion so a hostile / racing peer can't loop
  // us. Two retries is plenty (steal once, then acquire on the next).
  const MAX_ATTEMPTS = 3;

  const attempt = async (
    n: number,
    stolenFromPid?: number,
  ): Promise<LockResult> => {
    if (n > MAX_ATTEMPTS) {
      // Treat as contended with an unknown owner; caller logs WARN.
      return { acquired: false, ownerPid: stolenFromPid ?? -1, path };
    }
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${process.pid}\n`);
      } finally {
        await handle.close();
      }
      const result: LockAcquired = { acquired: true, pid: process.pid, path };
      if (stolenFromPid !== undefined) result.stolenFromPid = stolenFromPid;
      return result;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const ownerPid = await readOwnerPid(path);
      if (ownerPid === null || !isProcessAlive(ownerPid)) {
        // Stale lock (or malformed contents): unlink and retry.
        await unlink(path).catch(() => undefined);
        return attempt(n + 1, ownerPid ?? -1);
      }
      return { acquired: false, ownerPid, path };
    }
  };

  return attempt(1);
}

/** Release the lock. Safe to call even if we don't hold it. */
export async function releaseLock(
  vaultName: string,
  options: AcquireLockOptions = {},
): Promise<void> {
  await unlink(lockPath(vaultName, options.rootOverride)).catch(
    () => undefined,
  );
}
