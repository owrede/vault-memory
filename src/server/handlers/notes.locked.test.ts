import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/index.js";
import { VaultManager, type Vault } from "../../vault/index.js";
import { AdapterRegistry } from "../../adapters/registry.js";
import { ObsidianFsSource } from "../../adapters/source/obsidian-fs/index.js";
import { ObsidianFsDelivery } from "../../adapters/delivery/obsidian-fs/index.js";
import { writeNote } from "../../adapters/delivery/obsidian-fs/write.js";
import { SuppressionSet } from "../../adapters/change-feed/obsidian-fs/suppression.js";
import { MemorySinkRegistry } from "../../memory/index.js";
import { makeNotesHandlers } from "./notes.js";

describe("note handlers preserve document locks and watcher events", () => {
  let vaultDir: string;
  let vault: Vault;
  let suppression: SuppressionSet;
  let handlers: ReturnType<typeof makeNotesHandlers>;

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-locked-handler-"));
    vault = {
      config: { name: "locks", path: vaultDir, write_enabled: true },
      db: new Database(":memory:", "locks"),
      dbPath: ":memory:",
    };
    const manager = new VaultManager();
    // Inject the in-memory vault without opening the user's global databases.
    (manager as unknown as { vaults: Map<string, Vault> }).vaults.set("locks", vault);
    const adapterRegistry = new AdapterRegistry();
    const source = new ObsidianFsSource(vault.config);
    const delivery = new ObsidianFsDelivery(vault, "test-client");
    adapterRegistry.registerSource(source.handle, source);
    adapterRegistry.registerDelivery(delivery.handle, delivery);
    suppression = new SuppressionSet();
    handlers = makeNotesHandlers({
      manager,
      adapterRegistry,
      suppression,
      memorySinkRegistry: new MemorySinkRegistry(),
    });
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(vaultDir, { recursive: true, force: true });
  });

  async function seed(locked = true) {
    const result = await writeNote({
      vault,
      relativePath: "approved.md",
      content: "Approved decision.",
      frontmatter: { locked },
    });
    if (!result.ok) throw new Error("fixture creation failed");
    return result.newHash;
  }

  async function snapshot() {
    return {
      bytes: await fs.readFile(join(vaultDir, "approved.md"), "utf8"),
      row: vault.db.notes.getByPath("approved.md"),
      audit: vault.db.audit.listWrites({}),
    };
  }

  function args(expected_hash: string) {
    return {
      vault: "locks",
      path: "approved.md",
      content: "Changed",
      frontmatter: { locked: false },
      merge: { locked: { $unset: true } },
      expected_hash,
    };
  }

  it.each(["write_note", "update_frontmatter", "delete_note"] as const)(
    "%s returns document_locked with no file/index/audit/suppression changes",
    async (operation) => {
      const hash = await seed();
      const before = await snapshot();
      const result = await handlers[operation]!(args(hash));
      expect(result).toMatchObject({ ok: false, reason: "document_locked" });
      expect(await snapshot()).toEqual(before);
      expect(suppression.has("approved.md")).toBe(false);
    },
  );

  it("still reads a locked document", async () => {
    await seed();
    const result = await handlers.read_note!({ vault: "locks", path: "approved.md" });
    expect(result).toMatchObject({
      content: "Approved decision.\n",
      frontmatter: { locked: true },
    });
    expect(suppression.size()).toBe(0);
  });

  it.each(["write_note", "update_frontmatter", "delete_note"] as const)(
    "%s suppresses exactly the successful mutation",
    async (operation) => {
      const hash = await seed(false);
      const result = await handlers[operation]!(args(hash));
      expect(result).toMatchObject({ ok: true });
      expect(suppression.consume("approved.md")).toBe(true);
      expect(suppression.consume("approved.md")).toBe(false);
    },
  );

  it.each(["write_note", "update_frontmatter", "delete_note"] as const)(
    "%s with a stale hash does not hide the next external edit",
    async (operation) => {
      await seed(false);
      const before = await snapshot();
      expect(await handlers[operation]!(args("stale-hash"))).toMatchObject({
        ok: false,
        reason: "hash_mismatch",
      });
      expect(suppression.has("approved.md")).toBe(false);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["write_note", "update_frontmatter", "delete_note"] as const)(
    "%s on a read-only vault does not suppress an external edit",
    async (operation) => {
      const hash = await seed(false);
      vault.config.write_enabled = false;
      const before = await snapshot();
      expect(await handlers[operation]!(args(hash))).toMatchObject({
        ok: false,
        reason: "permission_denied",
      });
      expect(suppression.has("approved.md")).toBe(false);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("does not suppress a no-op frontmatter update", async () => {
    await seed(false);
    const before = await snapshot();
    expect(
      await handlers.update_frontmatter!({ vault: "locks", path: "approved.md", merge: {} }),
    ).toMatchObject({ ok: true, diff: [] });
    expect(suppression.has("approved.md")).toBe(false);
    expect(await snapshot()).toEqual(before);
  });
});
