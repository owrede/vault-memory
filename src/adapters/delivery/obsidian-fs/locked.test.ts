import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../../db/index.js";
import type { Vault } from "../../../vault/index.js";
import { formatDocId } from "../../registry.js";
import { ObsidianFsSource } from "../../source/obsidian-fs/index.js";
import { ObsidianFsDelivery } from "./index.js";
import { deleteNote, writeNote } from "./write.js";

describe("stored document locks", () => {
  let vaultDir: string;
  let vault: Vault;

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(join(tmpdir(), "vm-locks-"));
    vault = {
      config: { name: "locks", path: vaultDir, write_enabled: true },
      db: new Database(":memory:", "locks"),
      dbPath: ":memory:",
    };
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(vaultDir, { recursive: true, force: true });
  });

  async function seed(frontmatter: Record<string, unknown> = { locked: true }) {
    const result = await writeNote({
      vault,
      relativePath: "approved.md",
      content: "# Approved\n\nKeep this decision.\n",
      frontmatter,
    });
    if (!result.ok) throw new Error("fixture creation failed");
    return result;
  }

  async function snapshot() {
    return {
      bytes: await fs.readFile(join(vaultDir, "approved.md"), "utf8"),
      row: vault.db.notes.getByPath("approved.md"),
      audit: vault.db.audit.listWrites({}),
    };
  }

  it.each([
    ["removes the lock", undefined],
    ["sets locked false", { locked: false }],
    ["retains the lock", { locked: true }],
  ])("rejects an overwrite that %s and preserves file, index and audit", async (_, frontmatter) => {
    const first = await seed();
    const before = await snapshot();
    const beforeWrite = vi.fn();
    const result = await writeNote({
      vault,
      relativePath: "approved.md",
      content: "Changed",
      frontmatter,
      expectedHash: first.newHash,
      onBeforeFsWrite: beforeWrite,
    });
    expect(result).toMatchObject({ ok: false, reason: "document_locked" });
    expect(await snapshot()).toEqual(before);
    expect(beforeWrite).not.toHaveBeenCalled();
  });

  it("refuses deletion with the correct hash without any mutation or callback", async () => {
    const first = await seed();
    const before = await snapshot();
    const beforeWrite = vi.fn();
    const result = await deleteNote({
      vault,
      relativePath: "approved.md",
      expectedHash: first.newHash,
      onBeforeFsWrite: beforeWrite,
    });
    expect(result).toMatchObject({ ok: false, reason: "document_locked" });
    expect(await snapshot()).toEqual(before);
    expect(beforeWrite).not.toHaveBeenCalled();
  });

  it.each([undefined, "stale-hash"])(
    "reports the lock before OCC for hash %s",
    async (expectedHash) => {
      await seed();
      const before = await snapshot();
      const result = await writeNote({
        vault,
        relativePath: "approved.md",
        content: "Changed",
        expectedHash,
      });
      expect(result).toMatchObject({ ok: false, reason: "document_locked" });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["write", "delete"])(
    "%s reads a manually added lock instead of the stale index",
    async (operation) => {
      const first = await seed({ status: "approved" });
      await fs.writeFile(
        join(vaultDir, "approved.md"),
        "---\nlocked: true\n---\nApproved externally.\n",
      );
      const source = new ObsidianFsSource(vault.config);
      const doc = await source.readDocument(formatDocId("obsidian-fs", "locks", "approved.md"));
      expect(vault.db.notes.getByPath("approved.md")?.hash).toBe(first.newHash);
      const before = await snapshot();
      const input = { vault, relativePath: "approved.md", expectedHash: doc.hash };
      const result =
        operation === "delete"
          ? await deleteNote(input)
          : await writeNote({ ...input, content: "Changed" });
      expect(result).toMatchObject({ ok: false, reason: "document_locked" });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([false, null, "true", undefined])("does not lock stored value %s", async (locked) => {
    const first = await seed(locked === undefined ? {} : { locked });
    const result = await writeNote({
      vault,
      relativePath: "approved.md",
      content: "Changed",
      expectedHash: first.newHash,
    });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(join(vaultDir, "approved.md"), "utf8")).toBe("Changed");
  });

  it("allows creating a locked document and locking an editable document", async () => {
    const first = await seed({});
    const result = await writeNote({
      vault,
      relativePath: "approved.md",
      content: "Approved",
      frontmatter: { locked: true },
      expectedHash: first.newHash,
    });
    expect(result.ok).toBe(true);
    const source = new ObsidianFsSource(vault.config);
    expect(
      (await source.readDocument(formatDocId("obsidian-fs", "locks", "approved.md"))).properties
        .locked,
    ).toBe(true);
  });

  it("permits an update after the editor unlocks and the caller re-reads", async () => {
    await seed();
    await fs.writeFile(
      join(vaultDir, "approved.md"),
      "---\nlocked: false\n---\nUnlocked by editor.\n",
    );
    const id = formatDocId("obsidian-fs", "locks", "approved.md");
    const doc = await new ObsidianFsSource(vault.config).readDocument(id);
    const result = await new ObsidianFsDelivery(vault, "test").update(
      id,
      { blocks: [{ kind: "paragraph", text: "Updated after unlock." }] },
      { expectedHash: doc.hash },
    );
    expect(result.ok).toBe(true);
    expect(await fs.readFile(join(vaultDir, "approved.md"), "utf8")).toContain(
      "Updated after unlock.",
    );
  });

  it("preserves read-only refusal ahead of the lock", async () => {
    const first = await seed();
    const readonlyVault = { ...vault, config: { ...vault.config, write_enabled: false } };
    const before = await snapshot();
    const write = await writeNote({
      vault: readonlyVault,
      relativePath: "approved.md",
      content: "Changed",
      expectedHash: first.newHash,
    });
    const deletion = await deleteNote({
      vault: readonlyVault,
      relativePath: "approved.md",
      expectedHash: first.newHash,
    });
    expect(write).toMatchObject({ ok: false, reason: "permission_denied" });
    expect(deletion).toMatchObject({ ok: false, reason: "permission_denied" });
    expect(await snapshot()).toEqual(before);
  });
});
