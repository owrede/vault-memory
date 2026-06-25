/**
 * ObsidianFsChangeFeed unit tests. The cross-adapter conformance suite
 * (../conformance.test.ts) covers the floor; this file holds adapter-
 * specific assertions (suppression integration; chokidar config
 * preservation; rename-as-delete+create behavior).
 */

import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, unlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../../db/index.js";
import type { Vault } from "../../../vault/index.js";
import type { ChangeEvent } from "../../../types.js";
import { SuppressionSet } from "./suppression.js";
import { ObsidianFsChangeFeed } from "./change-feed.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll `predicate` until it returns true or `timeoutMs` elapses. Returns
 * whether it became true. Replaces the brittle `sleep(fixed); assert`
 * pattern for positive-assertion event tests: chokidar's event delivery
 * latency balloons under full-suite concurrent load (137 files), so a
 * fixed window races. Polling returns as soon as the event arrives (fast
 * in isolation) but tolerates delivery delay under load — eliminating the
 * documented timing flake (STATE.md) without inflating the happy path.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

interface Fixture {
  feed: ObsidianFsChangeFeed;
  vaultDir: string;
  events: ChangeEvent[];
  suppression: SuppressionSet;
  cleanup: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-cf-"));
  const db = new Database(":memory:", "cf-test");
  const vault: Vault = {
    config: { name: "cf-vault", path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };
  const suppression = new SuppressionSet({ ttlMs: 2000 });
  const feed = new ObsidianFsChangeFeed({ vault, suppression });
  const events: ChangeEvent[] = [];
  feed.subscribe((e) => {
    events.push(e);
  });
  await feed.ready();
  return {
    feed,
    vaultDir,
    events,
    suppression,
    cleanup: async () => {
      await feed.close();
      db.close();
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

describe("ObsidianFsChangeFeed", () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
      fixture = undefined;
    }
  });

  it("publishes capabilities { watch: 'push', emitsRename: false }", async () => {
    fixture = await makeFixture();
    expect(fixture.feed.capabilities.watch).toBe("push");
    expect(fixture.feed.capabilities.emitsRename).toBe(false);
  });

  // retry: 2 — defense-in-depth over the poll helper + single-fork isolation.
  // chokidar can drop/stall an FS event past any window under extreme load.
  it("emits create on a newly written .md file", { retry: 2 }, async () => {
    fixture = await makeFixture();
    const f = fixture;
    await writeFile(join(f.vaultDir, "new.md"), "# new note\n");
    await waitFor(() => f.events.some((e) => e.kind === "create"));
    const created = f.events.filter((e) => e.kind === "create");
    expect(created.length).toBeGreaterThanOrEqual(1);
    const last = created[created.length - 1]!;
    expect(last.id).toMatch(/^obsidian-fs:\/\/cf-vault\/new\.md$/);
  });

  it("emits update on a modified .md file", { retry: 2 }, async () => {
    fixture = await makeFixture();
    const f = fixture;
    const p = join(f.vaultDir, "edit.md");
    await writeFile(p, "# v1\n");
    await waitFor(() => f.events.some((e) => e.kind === "create"));
    f.events.length = 0;
    await writeFile(p, "# v2\n");
    await waitFor(() => f.events.some((e) => e.kind === "update"));
    const updates = f.events.filter((e) => e.kind === "update");
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it("emits delete on an unlinked .md file", { retry: 2 }, async () => {
    fixture = await makeFixture();
    const f = fixture;
    const p = join(f.vaultDir, "rm.md");
    await writeFile(p, "# bye\n");
    await waitFor(() => f.events.some((e) => e.kind === "create"));
    f.events.length = 0;
    await unlink(p);
    await waitFor(() => f.events.some((e) => e.kind === "delete"));
    const deletes = f.events.filter((e) => e.kind === "delete");
    expect(deletes.length).toBeGreaterThanOrEqual(1);
  });

  it("Pitfall 6: respects the suppression set — own writes do not fire events", async () => {
    fixture = await makeFixture();
    fixture.suppression.add("suppressed.md");
    await writeFile(join(fixture.vaultDir, "suppressed.md"), "# silent\n");
    await sleep(700);
    expect(fixture.events.find((e) => e.id.endsWith("/suppressed.md"))).toBeUndefined();
  });

  it("ignores non-.md files (e.g. .obsidian artifacts)", async () => {
    fixture = await makeFixture();
    // .obsidian itself is filtered by chokidar's `ignored` regex (dotfile),
    // but the post-event .md suffix check also fires for any other ext.
    await writeFile(join(fixture.vaultDir, "image.png"), "fakebytes");
    await sleep(500);
    expect(fixture.events).toHaveLength(0);
  });

  it("rename surfaces as delete + create (Phase 1 — emitsRename=false)", { retry: 2 }, async () => {
    fixture = await makeFixture();
    const f = fixture;
    const oldP = join(f.vaultDir, "old.md");
    const newP = join(f.vaultDir, "renamed.md");
    await writeFile(oldP, "# x\n");
    await waitFor(() => f.events.some((e) => e.kind === "create"));
    f.events.length = 0;
    await rename(oldP, newP);
    // A rename surfaces as both a delete (old path) and a create (new path);
    // wait for BOTH before asserting, since they can arrive separately.
    await waitFor(
      () => f.events.some((e) => e.kind === "delete") && f.events.some((e) => e.kind === "create"),
    );
    const deletes = f.events.filter((e) => e.kind === "delete");
    const creates = f.events.filter((e) => e.kind === "create");
    const renames = f.events.filter((e) => e.kind === "rename");
    expect(deletes.length).toBeGreaterThanOrEqual(1);
    expect(creates.length).toBeGreaterThanOrEqual(1);
    expect(renames).toHaveLength(0); // emitsRename:false honored
  });

  it("close() is idempotent and detaches handlers", async () => {
    fixture = await makeFixture();
    await fixture.feed.close();
    await fixture.feed.close(); // second close is a no-op
    fixture.events.length = 0;
    await writeFile(join(fixture.vaultDir, "post-close.md"), "# nope\n");
    await sleep(400);
    expect(fixture.events).toHaveLength(0);
  });

  it("subscribe returns a Disposable; disposing unregisters the handler", async () => {
    fixture = await makeFixture();
    const ours: ChangeEvent[] = [];
    const sub = fixture.feed.subscribe((e) => {
      ours.push(e);
    });
    await writeFile(join(fixture.vaultDir, "d1.md"), "# one\n");
    // Confirm the subscription is live before disposing (otherwise an empty
    // `ours` after dispose proves nothing). Robust to delivery delay.
    await waitFor(() => ours.length > 0);
    sub[Symbol.dispose]();
    ours.length = 0;
    await writeFile(join(fixture.vaultDir, "d2.md"), "# two\n");
    await sleep(500);
    expect(ours).toHaveLength(0);
  });

  it("handle has the obsidian-fs://<vault> shape", async () => {
    fixture = await makeFixture();
    expect(fixture.feed.handle).toBe("obsidian-fs://cf-vault");
  });
});
