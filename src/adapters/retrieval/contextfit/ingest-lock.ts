/**
 * Cross-process ingest mutex for the ContextFit KB (Issue #17).
 *
 * A ContextFit ingest is a FULL KB rebuild: it `rm`s the per-vault KB dir and
 * re-runs `contextfit ingest`. Two ingests against the same vault dir race —
 * the loser's temp files get clobbered mid-write and it crashes
 * (`FileNotFoundError: .../chunks/index.json.tmp`), potentially leaving a
 * half-written KB. The four ingest call sites (CLI `index`, serve note-write
 * refresh, serve file-watcher re-ingest, serve startup catch-up) live in
 * different processes and share no in-memory state, so an in-process guard
 * (the watcher's `cfReingestInFlight` boolean) cannot serialize them.
 *
 * This module provides a dedicated per-vault file lock —
 * `~/.vault-memory/locks/<vault>.ingest.lock` — held for the duration of one
 * ingest. It is DELIBERATELY SEPARATE from `src/brief/lock.ts`'s
 * `<vault>.lock`, which the staleness daemon holds for its whole lifetime;
 * reusing that lock would make every ingest on a serve process see it "held"
 * and skip forever.
 *
 * Contention policy is SKIP + a persisted dirty flag
 * (`<vault>.ingest.dirty`): a second-comer does not wait — it marks the vault
 * dirty and returns. When the lock holder finishes it checks the flag and does
 * exactly one trailing re-ingest, so the last change is never silently lost
 * even across processes. A dirty flag left behind by a crash is honored on the
 * next ingest or server startup.
 *
 * Lock lifetime is bounded by the ingest itself: ~1–1.5 min typically, and a
 * hard ceiling of the ingest spawn timeout (600 s, after which contextfit is
 * force-killed and the `finally` releases the lock). A crashed holder never
 * strands the lock: it records its PID and the next acquirer steals it when
 * that PID is dead (POSIX `kill(pid, 0)` → ESRCH), mirroring brief/lock.ts.
 */

// vault-memory:claude-ok — process state (~/.vault-memory/locks/), not vault
// content. Same lockfile carve-out as src/brief/lock.ts (ADR-005).

import { open, readFile, unlink, mkdir, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Test-only override for the ~/.vault-memory root. Production omits it. */
export interface IngestLockOptions {
  rootOverride?: string;
}

function lockDir(rootOverride?: string): string {
  if (rootOverride !== undefined) return join(rootOverride, "locks");
  return join(homedir(), ".vault-memory", "locks");
}

function lockPath(vaultName: string, rootOverride?: string): string {
  return join(lockDir(rootOverride), `${vaultName}.ingest.lock`);
}

function dirtyPath(vaultName: string, rootOverride?: string): string {
  return join(lockDir(rootOverride), `${vaultName}.ingest.dirty`);
}

/** POSIX `kill(pid, 0)`: true if the pid is alive, false on ESRCH. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    // EPERM (alive but inaccessible) or anything else → treat as alive so we
    // never steal a lock from a live peer.
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

export type IngestLockResult =
  { acquired: true; path: string } | { acquired: false; ownerPid: number; path: string };

/**
 * Try to acquire the ingest lock for a vault. Atomic exclusive create via
 * `open(path, 'wx')`. On EEXIST: steal if the recorded PID is dead or the file
 * is malformed; otherwise return contended. Bounded retries so a racing peer
 * cannot loop us forever.
 */
export async function tryAcquireIngestLock(
  vaultName: string,
  options: IngestLockOptions = {},
): Promise<IngestLockResult> {
  const dir = lockDir(options.rootOverride);
  await mkdir(dir, { recursive: true });
  const path = lockPath(vaultName, options.rootOverride);
  const MAX_ATTEMPTS = 3;

  const attempt = async (n: number): Promise<IngestLockResult> => {
    if (n > MAX_ATTEMPTS) return { acquired: false, ownerPid: -1, path };
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${process.pid}\n`);
      } finally {
        await handle.close();
      }
      return { acquired: true, path };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const ownerPid = await readOwnerPid(path);
      if (ownerPid === null || !isProcessAlive(ownerPid)) {
        // Stale (dead owner) or malformed: unlink and retry.
        await unlink(path).catch(() => undefined);
        return attempt(n + 1);
      }
      return { acquired: false, ownerPid, path };
    }
  };

  return attempt(1);
}

/** Release the ingest lock. Safe to call even if we don't hold it. */
export async function releaseIngestLock(
  vaultName: string,
  options: IngestLockOptions = {},
): Promise<void> {
  await unlink(lockPath(vaultName, options.rootOverride)).catch(() => undefined);
}

/** Mark a vault as needing a (re-)ingest — set by a skipped second-comer. */
export async function markIngestDirty(
  vaultName: string,
  options: IngestLockOptions = {},
): Promise<void> {
  const dir = lockDir(options.rootOverride);
  await mkdir(dir, { recursive: true });
  await writeFile(dirtyPath(vaultName, options.rootOverride), `${process.pid}\n`).catch(
    () => undefined,
  );
}

/** True if a dirty flag is present for the vault. */
export async function isIngestDirty(
  vaultName: string,
  options: IngestLockOptions = {},
): Promise<boolean> {
  try {
    await stat(dirtyPath(vaultName, options.rootOverride));
    return true;
  } catch {
    return false;
  }
}

/** Clear the dirty flag — called by the lock holder before it ingests. */
export async function clearIngestDirty(
  vaultName: string,
  options: IngestLockOptions = {},
): Promise<void> {
  await unlink(dirtyPath(vaultName, options.rootOverride)).catch(() => undefined);
}
