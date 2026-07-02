/**
 * Ingest-lock tests (Issue #17). Exercise the cross-process mutex + dirty-flag
 * primitive directly against a temp `~/.vault-memory` root (rootOverride), so
 * they run without the contextfit binary. Concurrent-ingest serialization at
 * the `indexVaultWithContextFit` level is covered by the live index test
 * (gated on contextfit being installed) in ./index.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tryAcquireIngestLock,
  releaseIngestLock,
  markIngestDirty,
  isIngestDirty,
  clearIngestDirty,
} from "./ingest-lock.js";
import { indexVaultWithContextFit } from "./index.js";
import type { VaultConfig } from "../../../types.js";

describe("ContextFit ingest lock (Issue #17)", () => {
  let root = "";
  const V = "vaultA";

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "vm-ingest-lock-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("acquires an uncontended lock and writes our pid", async () => {
    const r = await tryAcquireIngestLock(V, { rootOverride: root });
    expect(r.acquired).toBe(true);
    if (r.acquired) {
      const pid = parseInt(await fs.readFile(r.path, "utf8"), 10);
      expect(pid).toBe(process.pid);
    }
  });

  it("second acquire is contended while the first is held", async () => {
    const first = await tryAcquireIngestLock(V, { rootOverride: root });
    expect(first.acquired).toBe(true);
    const second = await tryAcquireIngestLock(V, { rootOverride: root });
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.ownerPid).toBe(process.pid);
  });

  it("re-acquires after release", async () => {
    await tryAcquireIngestLock(V, { rootOverride: root });
    await releaseIngestLock(V, { rootOverride: root });
    const again = await tryAcquireIngestLock(V, { rootOverride: root });
    expect(again.acquired).toBe(true);
  });

  it("steals a lock whose recorded pid is dead", async () => {
    // Hand-write a lock file owned by a pid that cannot be alive. POSIX pids
    // are positive; a huge value is guaranteed dead (ESRCH), so it is stolen.
    const dir = join(root, "locks");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, `${V}.ingest.lock`), "2147483646\n");
    const r = await tryAcquireIngestLock(V, { rootOverride: root });
    expect(r.acquired).toBe(true);
  });

  it("steals a lock with malformed (non-numeric) contents", async () => {
    const dir = join(root, "locks");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, `${V}.ingest.lock`), "not-a-pid\n");
    const r = await tryAcquireIngestLock(V, { rootOverride: root });
    expect(r.acquired).toBe(true);
  });

  it("release is safe when we do not hold the lock", async () => {
    await expect(releaseIngestLock(V, { rootOverride: root })).resolves.toBeUndefined();
  });

  it("dirty flag round-trips: mark → is → clear", async () => {
    expect(await isIngestDirty(V, { rootOverride: root })).toBe(false);
    await markIngestDirty(V, { rootOverride: root });
    expect(await isIngestDirty(V, { rootOverride: root })).toBe(true);
    await clearIngestDirty(V, { rootOverride: root });
    expect(await isIngestDirty(V, { rootOverride: root })).toBe(false);
  });

  it("clear is idempotent when no flag exists", async () => {
    await expect(clearIngestDirty(V, { rootOverride: root })).resolves.toBeUndefined();
    expect(await isIngestDirty(V, { rootOverride: root })).toBe(false);
  });

  it("lock and dirty flag are independent per vault", async () => {
    await tryAcquireIngestLock("vaultA", { rootOverride: root });
    await markIngestDirty("vaultA", { rootOverride: root });
    // A different vault is unaffected.
    const b = await tryAcquireIngestLock("vaultB", { rootOverride: root });
    expect(b.acquired).toBe(true);
    expect(await isIngestDirty("vaultB", { rootOverride: root })).toBe(false);
  });
});

describe("indexVaultWithContextFit lock orchestration (Issue #17)", () => {
  let root = "";
  const vault: VaultConfig = { name: "orch", path: "/tmp/orch-vault", backend: "contextfit" };

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "vm-ingest-orch-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const okDeps = (ingest: (c: unknown, s: string) => Promise<string>) => ({
    probe: async () => true,
    ingest: ingest as never,
    clearKb: async () => {},
  });

  it("skips (and flags dirty) when the lock is already held by another process", async () => {
    // Simulate an in-flight ingest in another process: hand-hold the lock with
    // a live pid (our own — isProcessAlive(process.pid) is true, so not stolen).
    await tryAcquireIngestLock(vault.name, { rootOverride: root });

    let ingestCalls = 0;
    const r = await indexVaultWithContextFit(vault, {
      lockRootOverride: root,
      _deps: okDeps(async () => {
        ingestCalls += 1;
        return "stats";
      }),
    });

    expect(r.status).toBe("skipped");
    expect(ingestCalls).toBe(0); // did not ingest
    expect(await isIngestDirty(vault.name, { rootOverride: root })).toBe(true); // flagged
  });

  it("ingests once, clears the dirty flag, and releases the lock", async () => {
    let ingestCalls = 0;
    const r = await indexVaultWithContextFit(vault, {
      lockRootOverride: root,
      _deps: okDeps(async () => {
        ingestCalls += 1;
        return "stats";
      }),
    });

    expect(r.status).toBe("completed");
    expect(ingestCalls).toBe(1);
    expect(await isIngestDirty(vault.name, { rootOverride: root })).toBe(false);
    // Lock released → a subsequent acquire succeeds.
    const again = await tryAcquireIngestLock(vault.name, { rootOverride: root });
    expect(again.acquired).toBe(true);
  });

  it("does a trailing re-ingest when a change lands DURING the ingest", async () => {
    // First ingest sets the flag mid-run (simulating a write arriving during
    // the rebuild); the holder must loop exactly once more, then stop.
    let ingestCalls = 0;
    const r = await indexVaultWithContextFit(vault, {
      lockRootOverride: root,
      _deps: okDeps(async () => {
        ingestCalls += 1;
        if (ingestCalls === 1) {
          // A concurrent write arrives while pass 1 is running.
          await markIngestDirty(vault.name, { rootOverride: root });
        }
        return "stats";
      }),
    });

    expect(r.status).toBe("completed");
    expect(ingestCalls).toBe(2); // one trailing pass captured the mid-run change
    expect(await isIngestDirty(vault.name, { rootOverride: root })).toBe(false);
  });

  it("releases the lock even when the ingest throws", async () => {
    const r = await indexVaultWithContextFit(vault, {
      lockRootOverride: root,
      _deps: okDeps(async () => {
        throw new Error("boom");
      }),
    });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/boom/);
    // finally released the lock despite the throw.
    const again = await tryAcquireIngestLock(vault.name, { rootOverride: root });
    expect(again.acquired).toBe(true);
  });

  it("bounds trailing passes so constant writes cannot loop forever", async () => {
    // The flag is re-set on every pass → the loop must stop at MAX_PASSES (8),
    // not spin indefinitely.
    let ingestCalls = 0;
    const r = await indexVaultWithContextFit(vault, {
      lockRootOverride: root,
      _deps: okDeps(async () => {
        ingestCalls += 1;
        await markIngestDirty(vault.name, { rootOverride: root });
        return "stats";
      }),
    });
    expect(r.status).toBe("completed");
    expect(ingestCalls).toBe(8); // MAX_PASSES backstop
  });
});
