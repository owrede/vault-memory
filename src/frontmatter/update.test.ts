import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { updateFrontmatter } from "./update.js";
import { sha256 } from "../reader/hash.js";

interface TestCtx {
  vault: Vault;
  vaultRoot: string;
  cleanup: () => Promise<void>;
}

async function makeCtx(opts?: { writeEnabled?: boolean }): Promise<TestCtx> {
  const vaultRoot = await fs.mkdtemp(join(tmpdir(), "vm-fm-update-"));
  const db = new Database(":memory:");
  db.migrate();
  const vault: Vault = {
    config: {
      name: "test",
      path: vaultRoot,
      write_enabled: opts?.writeEnabled ?? true,
    },
    db,
    dbPath: ":memory:",
  };
  return {
    vault,
    vaultRoot,
    cleanup: async () => {
      db.close();
      await fs.rm(vaultRoot, { recursive: true, force: true });
    },
  };
}

async function writeNote(
  ctx: TestCtx,
  relPath: string,
  frontmatter: Record<string, unknown> | null,
  body: string,
): Promise<{ hash: string; absPath: string }> {
  const absPath = join(ctx.vaultRoot, relPath);
  await fs.mkdir(join(absPath, ".."), { recursive: true });
  const text = frontmatter === null ? body : matter.stringify(body, frontmatter);
  await fs.writeFile(absPath, text, "utf8");

  // Round-trip through matter so the hash matches what update sees.
  const parsed = matter(text);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const fmForHash = Object.keys(data).length > 0 ? data : {};
  const hash = sha256(parsed.content + JSON.stringify(fmForHash));

  const stat = await fs.stat(absPath);
  ctx.vault.db.notes.upsertByPath({
    path: relPath,
    content: parsed.content,
    frontmatter: Object.keys(data).length > 0 ? JSON.stringify(data) : null,
    title: relPath.replace(/\.md$/, ""),
    hash,
    mtime: Math.floor(stat.mtimeMs),
    wordCount: parsed.content.split(/\s+/).filter(Boolean).length,
  });
  return { hash, absPath };
}

async function readFm(absPath: string): Promise<{
  data: Record<string, unknown>;
  content: string;
}> {
  const raw = await fs.readFile(absPath, "utf8");
  const parsed = matter(raw);
  return {
    data: (parsed.data ?? {}) as Record<string, unknown>,
    content: parsed.content,
  };
}

describe("updateFrontmatter", () => {
  let ctx: TestCtx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("plain set adds a key", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { class: "Person" }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { status: "active" },
    });
    expect(res.ok).toBe(true);
    const { data } = await readFm(absPath);
    expect(data.status).toBe("active");
    expect(data.class).toBe("Person");
  });

  it("set overwrites existing value", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { class: "Person" }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { class: "Org" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.diff).toEqual([{ key: "class", op: "set", before: "Person", after: "Org" }]);
    }
    const { data } = await readFm(absPath);
    expect(data.class).toBe("Org");
  });

  it("$unset deletes a key", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(
      ctx,
      "n.md",
      { class: "Person", status: "active" },
      "Body\n",
    );
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { status: { $unset: true } },
    });
    expect(res.ok).toBe(true);
    const { data } = await readFm(absPath);
    expect("status" in data).toBe(false);
    expect(data.class).toBe("Person");
  });

  it("$push appends to existing array", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { tags: ["a"] }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { tags: { $push: "b" } },
    });
    expect(res.ok).toBe(true);
    const { data } = await readFm(absPath);
    expect(data.tags).toEqual(["a", "b"]);
  });

  it("$push creates array when key absent", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { class: "X" }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { tags: { $push: "x" } },
    });
    expect(res.ok).toBe(true);
    const { data } = await readFm(absPath);
    expect(data.tags).toEqual(["x"]);
  });

  it("$pull removes element from array", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { tags: ["a", "b", "c"] }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { tags: { $pull: "b" } },
    });
    expect(res.ok).toBe(true);
    const { data } = await readFm(absPath);
    expect(data.tags).toEqual(["a", "c"]);
  });

  it("shallow nested merge keeps unrelated keys", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { meta: { foo: 1 } }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { meta: { bar: 2 } },
    });
    expect(res.ok).toBe(true);
    const { data } = await readFm(absPath);
    expect(data.meta).toEqual({ foo: 1, bar: 2 });
  });

  it("returns hash_mismatch when expectedHash wrong", async () => {
    ctx = await makeCtx();
    await writeNote(ctx, "n.md", { class: "Person" }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { status: "active" },
      expectedHash: "deadbeef",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("hash_mismatch");
      expect(res.currentHash).toBeDefined();
    }
  });

  it("returns note_not_found for missing path", async () => {
    ctx = await makeCtx();
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "no/such.md",
      merge: { x: 1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("note_not_found");
    }
  });

  it("returns permission_denied when write_enabled=false", async () => {
    ctx = await makeCtx({ writeEnabled: false });
    await writeNote(ctx, "n.md", { class: "Person" }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { status: "active" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("permission_denied");
    }
  });

  it("aliases update reflects in DB", async () => {
    ctx = await makeCtx();
    await writeNote(ctx, "n.md", { class: "Person" }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { aliases: ["NEW", "OTHER"] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const aliases = ctx.vault.db.aliases.listForNote(res.noteId);
      expect(aliases.sort()).toEqual(["NEW", "OTHER"]);
      const resolved = ctx.vault.db.aliases.resolve("new");
      expect(resolved?.path).toBe("n.md");
    }
  });

  it("empty merge is a no-op (no audit, no file change)", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { class: "Person" }, "Body\n");
    const before = await fs.readFile(absPath, "utf8");
    const beforeMtime = (await fs.stat(absPath)).mtimeMs;

    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: {},
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.diff).toEqual([]);

    const after = await fs.readFile(absPath, "utf8");
    expect(after).toBe(before);
    const audits = ctx.vault.db.audit.listWrites({});
    expect(audits.length).toBe(0);
    // mtime untouched
    expect((await fs.stat(absPath)).mtimeMs).toBe(beforeMtime);
  });

  it("body is preserved bytegenau", async () => {
    ctx = await makeCtx();
    const body = "# Heading\n\nA paragraph with  weird   spacing.\n\n- list\n- items\n";
    const { absPath } = await writeNote(ctx, "n.md", { class: "Person" }, body);
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { extra: "x" },
    });
    expect(res.ok).toBe(true);
    const { content } = await readFm(absPath);
    expect(content).toBe(body);
  });

  it("$pull on missing element is a no-op", async () => {
    ctx = await makeCtx();
    const { absPath } = await writeNote(ctx, "n.md", { tags: ["a"] }, "Body\n");
    const before = await fs.readFile(absPath, "utf8");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { tags: { $pull: "z" } },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.diff).toEqual([]);
    expect(await fs.readFile(absPath, "utf8")).toBe(before);
  });

  it("records audit entry on successful update", async () => {
    ctx = await makeCtx();
    await writeNote(ctx, "n.md", { class: "Person" }, "Body\n");
    const res = await updateFrontmatter({
      vault: ctx.vault,
      relativePath: "n.md",
      merge: { status: "active" },
      clientId: "client-7",
    });
    expect(res.ok).toBe(true);
    const audits = ctx.vault.db.audit.listWrites({});
    expect(audits.length).toBe(1);
    expect(audits[0]?.op).toBe("update");
    expect(audits[0]?.client_id).toBe("client-7");
  });
});
