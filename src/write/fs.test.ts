import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  atomicWriteFile,
  safeJoinInsideVault,
  OutsideVaultError,
} from "./fs.js";

describe("atomicWriteFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vm-fs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a file with the exact content", async () => {
    const target = join(dir, "a.md");
    await atomicWriteFile(target, "hello world");
    expect(await fs.readFile(target, "utf-8")).toBe("hello world");
  });

  it("overwrites an existing file", async () => {
    const target = join(dir, "b.md");
    await fs.writeFile(target, "old", "utf-8");
    await atomicWriteFile(target, "new");
    expect(await fs.readFile(target, "utf-8")).toBe("new");
  });

  it("creates parent directories as needed", async () => {
    const target = join(dir, "deep", "nested", "x.md");
    await atomicWriteFile(target, "ok");
    expect(await fs.readFile(target, "utf-8")).toBe("ok");
  });

  it("leaves no .tmp.* sibling on success", async () => {
    const target = join(dir, "c.md");
    await atomicWriteFile(target, "data");
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.includes(".tmp."))).toHaveLength(0);
  });
});

describe("safeJoinInsideVault", () => {
  let root: string;
  let outsideDir: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vm-vault-"));
    outsideDir = await mkdtemp(join(tmpdir(), "vm-outside-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("accepts a normal relative path", async () => {
    const out = await safeJoinInsideVault(root, "notes/foo.md");
    expect(out.endsWith("foo.md")).toBe(true);
  });

  it("accepts deeply nested relative paths", async () => {
    const out = await safeJoinInsideVault(root, "a/b/c/d.md");
    expect(out.endsWith("d.md")).toBe(true);
  });

  it("rejects ../ traversal", async () => {
    await expect(
      safeJoinInsideVault(root, "../etc/passwd"),
    ).rejects.toBeInstanceOf(OutsideVaultError);
  });

  it("rejects deeper ../../ traversal", async () => {
    await expect(
      safeJoinInsideVault(root, "a/../../escape.md"),
    ).rejects.toBeInstanceOf(OutsideVaultError);
  });

  it("rejects absolute paths", async () => {
    await expect(
      safeJoinInsideVault(root, "/etc/passwd"),
    ).rejects.toBeInstanceOf(OutsideVaultError);
  });

  it("rejects empty input", async () => {
    await expect(safeJoinInsideVault(root, "")).rejects.toBeInstanceOf(
      OutsideVaultError,
    );
  });

  it("rejects targeting the vault root itself", async () => {
    await expect(safeJoinInsideVault(root, ".")).rejects.toBeInstanceOf(
      OutsideVaultError,
    );
  });

  it("rejects a path beneath a symlink that escapes the vault", async () => {
    // Create symlink inside vault pointing to a directory outside the vault.
    const linkPath = join(root, "escape");
    await fs.symlink(outsideDir, linkPath, "dir");
    await expect(
      safeJoinInsideVault(root, "escape/passwd"),
    ).rejects.toBeInstanceOf(OutsideVaultError);
  });

  it("rejects a symlinked file that points outside the vault", async () => {
    const outsideFile = join(outsideDir, "secret.txt");
    await fs.writeFile(outsideFile, "secret", "utf-8");
    const linkPath = join(root, "leak.txt");
    await fs.symlink(outsideFile, linkPath, "file");
    await expect(
      safeJoinInsideVault(root, "leak.txt"),
    ).rejects.toBeInstanceOf(OutsideVaultError);
  });

  it("accepts a symlink that points to a location INSIDE the vault", async () => {
    const realDir = join(root, "real");
    await fs.mkdir(realDir, { recursive: true });
    const linkPath = join(root, "alias");
    await fs.symlink(realDir, linkPath, "dir");
    // Writing a new file under the symlinked alias should still be allowed.
    const out = await safeJoinInsideVault(root, "alias/note.md");
    expect(out.includes("alias")).toBe(true);
  });
});
