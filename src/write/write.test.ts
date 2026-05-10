import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { writeNote, deleteNote } from "./write.js";
import { OutsideVaultError } from "./fs.js";

function makeVault(path: string, writeEnabled = true): Vault {
  const db = new Database(":memory:");
  return {
    config: {
      name: "test",
      path,
      write_enabled: writeEnabled,
    },
    db,
    dbPath: ":memory:",
  };
}

describe("writeNote", () => {
  let vaultDir: string;
  let vault: Vault;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-write-"));
    vault = makeVault(vaultDir);
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("creates a new note (file + DB row + audit op=create)", async () => {
    const res = await writeNote({
      vault,
      relativePath: "hello.md",
      content: "# Hello\n\nWorld.",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(true);

    const onDisk = await fs.readFile(join(vaultDir, "hello.md"), "utf-8");
    expect(onDisk).toBe("# Hello\n\nWorld.");

    const row = vault.db.notes.getByPath("hello.md");
    expect(row).not.toBeNull();
    expect(row?.title).toBe("Hello");
    expect(row?.hash).toBe(res.newHash);

    const audits = vault.db.audit.listWrites({ noteId: res.noteId });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.op).toBe("create");
    expect(audits[0]?.previous_hash).toBeNull();
    expect(audits[0]?.new_hash).toBe(res.newHash);
  });

  it("conflict when writing to an existing file WITHOUT expectedHash", async () => {
    await writeNote({ vault, relativePath: "x.md", content: "v1" });
    const res = await writeNote({ vault, relativePath: "x.md", content: "v2" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
    expect(res.currentHash).toBeDefined();
    expect(res.currentContent).toBe("v1");
  });

  it("conflict when expectedHash is wrong", async () => {
    await writeNote({ vault, relativePath: "y.md", content: "v1" });
    const res = await writeNote({
      vault,
      relativePath: "y.md",
      content: "v2",
      expectedHash: "deadbeef",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
    expect(res.currentHash).toBeDefined();
    expect(res.currentContent).toBe("v1");
    // file unchanged on disk
    expect(await fs.readFile(join(vaultDir, "y.md"), "utf-8")).toBe("v1");
  });

  it("succeeds when expectedHash matches; audit records op=update", async () => {
    const first = await writeNote({
      vault,
      relativePath: "z.md",
      content: "v1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await writeNote({
      vault,
      relativePath: "z.md",
      content: "v2",
      expectedHash: first.newHash,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.newHash).not.toBe(first.newHash);

    expect(await fs.readFile(join(vaultDir, "z.md"), "utf-8")).toBe("v2");

    const audits = vault.db.audit.listWrites({ noteId: second.noteId });
    expect(audits).toHaveLength(2);
    // listWrites is DESC by id — newest first
    expect(audits[0]?.op).toBe("update");
    expect(audits[0]?.previous_hash).toBe(first.newHash);
    expect(audits[1]?.op).toBe("create");
  });

  it("permission denied when write_enabled=false (even for new files)", async () => {
    const ro = makeVault(vaultDir, false);
    try {
      const res = await writeNote({
        vault: ro,
        relativePath: "blocked.md",
        content: "x",
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("permission_denied");
      // No file created
      await expect(fs.access(join(vaultDir, "blocked.md"))).rejects.toThrow();
    } finally {
      ro.db.close();
    }
  });

  it("throws on path traversal", async () => {
    await expect(
      writeNote({
        vault,
        relativePath: "../etc/passwd",
        content: "boom",
      }),
    ).rejects.toBeInstanceOf(OutsideVaultError);
  });

  it("persists aliases from frontmatter", async () => {
    const res = await writeNote({
      vault,
      relativePath: "people/jh.md",
      content: "Notes about JH.",
      frontmatter: { aliases: ["JH", "Jörg"] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const stored = vault.db.aliases.listForNote(res.noteId).sort();
    expect(stored).toEqual(["JH", "Jörg"].sort());
    // Resolve works case-insensitively
    expect(vault.db.aliases.resolve("jh")?.note_id).toBe(res.noteId);

    // File on disk has the YAML block
    const raw = await fs.readFile(join(vaultDir, "people/jh.md"), "utf-8");
    expect(raw.startsWith("---")).toBe(true);
    expect(raw).toContain("JH");
  });
});

describe("deleteNote", () => {
  let vaultDir: string;
  let vault: Vault;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-delete-"));
    vault = makeVault(vaultDir);
  });
  afterEach(async () => {
    vault.db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("deletes file + DB row + records audit op=delete", async () => {
    const w = await writeNote({
      vault,
      relativePath: "doomed.md",
      content: "bye",
    });
    expect(w.ok).toBe(true);
    if (!w.ok) return;

    const d = await deleteNote({
      vault,
      relativePath: "doomed.md",
      expectedHash: w.newHash,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.created).toBe(false);

    await expect(fs.access(join(vaultDir, "doomed.md"))).rejects.toThrow();
    expect(vault.db.notes.getByPath("doomed.md")).toBeNull();

    // After delete, the audit row's note_id was set to NULL by the FK
    // (migration 003: ON DELETE SET NULL on write_audit.note_id).
    // The audit history survives — we just have to look it up unfiltered.
    const audits = vault.db.audit.listWrites({});
    const deleteEntry = audits.find((a) => a.op === "delete");
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry?.note_id).toBeNull();
    expect(deleteEntry?.new_hash).toBeNull();
    expect(deleteEntry?.previous_hash).toBe(w.newHash);
  });

  it("conflict when expectedHash does not match", async () => {
    const w = await writeNote({
      vault,
      relativePath: "k.md",
      content: "v1",
    });
    expect(w.ok).toBe(true);

    const d = await deleteNote({
      vault,
      relativePath: "k.md",
      expectedHash: "wrong",
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("hash_mismatch");
    // file still present
    await fs.access(join(vaultDir, "k.md"));
    expect(vault.db.notes.getByPath("k.md")).not.toBeNull();
  });

  it("conflict when file does not exist", async () => {
    const d = await deleteNote({
      vault,
      relativePath: "ghost.md",
      expectedHash: "anything",
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("hash_mismatch");
  });
});
