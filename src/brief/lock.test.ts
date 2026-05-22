import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isProcessAlive, releaseLock, tryAcquireLock } from "./lock.js";

/**
 * Phase 5 / D-08 — lockfile primitive tests.
 *
 * All filesystem traffic stays inside a `mkdtemp` directory via the
 * test-only `rootOverride`. The real `~/.vault-memory/locks/` is never
 * touched.
 */
describe("brief lockfile (D-08)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vm-lock-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates the locks directory and acquires the lock on a fresh root", async () => {
    const res = await tryAcquireLock("v1", { rootOverride: root });
    expect(res.acquired).toBe(true);
    if (!res.acquired) throw new Error("type narrowing");
    expect(res.pid).toBe(process.pid);
    expect(res.path).toBe(join(root, "locks", "v1.lock"));
    expect(res.stolenFromPid).toBeUndefined();

    // locks/ directory exists.
    await expect(access(join(root, "locks"))).resolves.toBeUndefined();
  });

  it("writes exactly `${process.pid}\\n` (newline-terminated ASCII PID) into the lockfile", async () => {
    const res = await tryAcquireLock("v1", { rootOverride: root });
    expect(res.acquired).toBe(true);
    const contents = await readFile(join(root, "locks", "v1.lock"), "utf8");
    expect(contents).toBe(`${process.pid}\n`);
  });

  it("returns contended (not throw) when the lockfile is held by a live PID", async () => {
    // Seed: write a lockfile holding the current process.pid (which IS
    // alive — POSIX kill(pid, 0) returns 0).
    await mkdir(join(root, "locks"), { recursive: true });
    await writeFile(join(root, "locks", "v1.lock"), `${process.pid}\n`, "utf8");
    const res = await tryAcquireLock("v1", { rootOverride: root });
    expect(res.acquired).toBe(false);
    if (res.acquired) throw new Error("type narrowing");
    expect(res.ownerPid).toBe(process.pid);
    expect(res.path).toBe(join(root, "locks", "v1.lock"));
  });

  it("steals the lock from a dead PID (ESRCH) and reports stolenFromPid", async () => {
    // PID 999999 is effectively never alive on a test runner — kill(pid, 0)
    // throws ESRCH. (We don't pick 1 because that's init / launchd and EPERM.)
    await mkdir(join(root, "locks"), { recursive: true });
    await writeFile(join(root, "locks", "v1.lock"), `999999\n`, "utf8");

    const res = await tryAcquireLock("v1", { rootOverride: root });
    expect(res.acquired).toBe(true);
    if (!res.acquired) throw new Error("type narrowing");
    expect(res.pid).toBe(process.pid);
    expect(res.stolenFromPid).toBe(999999);

    const contents = await readFile(join(root, "locks", "v1.lock"), "utf8");
    expect(contents).toBe(`${process.pid}\n`);
  });

  it("releaseLock removes the lockfile; a subsequent acquire succeeds normally", async () => {
    const a = await tryAcquireLock("v1", { rootOverride: root });
    expect(a.acquired).toBe(true);

    await releaseLock("v1", { rootOverride: root });

    // File is gone.
    await expect(readFile(join(root, "locks", "v1.lock"), "utf8")).rejects.toThrow();

    // Re-acquire is a clean acquire (no stolenFromPid).
    const b = await tryAcquireLock("v1", { rootOverride: root });
    expect(b.acquired).toBe(true);
    if (!b.acquired) throw new Error("type narrowing");
    expect(b.stolenFromPid).toBeUndefined();
  });

  it("isProcessAlive returns true for self, false for a definitely-dead pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999)).toBe(false);
  });

  it("treats a malformed (non-numeric) lockfile as orphaned and acquires", async () => {
    await mkdir(join(root, "locks"), { recursive: true });
    await writeFile(join(root, "locks", "v1.lock"), "not-a-pid\n", "utf8");

    const res = await tryAcquireLock("v1", { rootOverride: root });
    expect(res.acquired).toBe(true);
    if (!res.acquired) throw new Error("type narrowing");
    // stolenFromPid is set to -1 sentinel because we couldn't read a PID.
    expect(res.stolenFromPid).toBe(-1);

    const contents = await readFile(join(root, "locks", "v1.lock"), "utf8");
    expect(contents).toBe(`${process.pid}\n`);
  });

  it("releaseLock is safe to call when the lock isn't held (no-throw)", async () => {
    await expect(releaseLock("never-locked", { rootOverride: root })).resolves.toBeUndefined();
  });
});
