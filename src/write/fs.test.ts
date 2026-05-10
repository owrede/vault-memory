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
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vm-vault-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("accepts a normal relative path", () => {
    const out = safeJoinInsideVault(root, "notes/foo.md");
    expect(out.startsWith(root)).toBe(true);
    expect(out.endsWith("foo.md")).toBe(true);
  });

  it("accepts deeply nested relative paths", () => {
    const out = safeJoinInsideVault(root, "a/b/c/d.md");
    expect(out.startsWith(root)).toBe(true);
  });

  it("rejects ../ traversal", () => {
    expect(() => safeJoinInsideVault(root, "../etc/passwd")).toThrow(
      OutsideVaultError,
    );
  });

  it("rejects deeper ../../ traversal", () => {
    expect(() => safeJoinInsideVault(root, "a/../../escape.md")).toThrow(
      OutsideVaultError,
    );
  });

  it("rejects absolute paths", () => {
    expect(() => safeJoinInsideVault(root, "/etc/passwd")).toThrow(
      OutsideVaultError,
    );
  });

  it("rejects empty input", () => {
    expect(() => safeJoinInsideVault(root, "")).toThrow(OutsideVaultError);
  });

  it("rejects targeting the vault root itself", () => {
    expect(() => safeJoinInsideVault(root, ".")).toThrow(OutsideVaultError);
  });
});
