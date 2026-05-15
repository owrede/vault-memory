import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scanVault, compileGlob } from "./scanner.js";

describe("scanVault", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-scan-"));
    // 5 markdown files at various depths
    await fs.writeFile(path.join(root, "a.md"), "# A");
    await fs.writeFile(path.join(root, "b.md"), "# B");
    await fs.mkdir(path.join(root, "sub"));
    await fs.writeFile(path.join(root, "sub", "c.md"), "# C");
    await fs.mkdir(path.join(root, "sub", "deep"));
    await fs.writeFile(path.join(root, "sub", "deep", "d.md"), "# D");
    await fs.writeFile(path.join(root, "e.md"), "# E");
    // .obsidian directory (should be excluded by default)
    await fs.mkdir(path.join(root, ".obsidian"));
    await fs.writeFile(path.join(root, ".obsidian", "workspace.json"), "{}");
    await fs.writeFile(path.join(root, ".obsidian", "notes.md"), "# hidden");
    // a non-md file
    await fs.writeFile(path.join(root, "ignore.txt"), "nope");
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns exactly the 5 markdown files and excludes .obsidian", async () => {
    const files = await scanVault(root);
    expect(files).toHaveLength(5);
    for (const f of files) {
      expect(path.isAbsolute(f)).toBe(true);
      expect(f.endsWith(".md")).toBe(true);
      expect(f.includes(".obsidian")).toBe(false);
    }
  });

  it("honors custom excludeGlobs", async () => {
    const files = await scanVault(root, { excludeGlobs: ["sub/**"] });
    const rels = files.map((f) => path.relative(root, f));
    expect(rels).toContain("a.md");
    expect(rels).toContain("b.md");
    expect(rels).toContain("e.md");
    expect(rels.some((r) => r.startsWith("sub"))).toBe(false);
  });
});

describe("compileGlob", () => {
  it("matches .obsidian/** for both the dir and its descendants", () => {
    const re = compileGlob(".obsidian/**");
    expect(re.test(".obsidian")).toBe(true);
    expect(re.test(".obsidian/foo.json")).toBe(true);
    expect(re.test(".obsidian/sub/deep.json")).toBe(true);
    expect(re.test("other/file.md")).toBe(false);
  });

  it("single * does not cross slashes", () => {
    const re = compileGlob("*.md");
    expect(re.test("a.md")).toBe(true);
    expect(re.test("sub/a.md")).toBe(false);
  });
});
