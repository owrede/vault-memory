import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../db/index.js";
import { catchupVault } from "./catchup.js";
import { indexNote } from "./single.js";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";

function mockOllama(): OllamaClient {
  const v = (i: number): number[] => {
    const a = new Array<number>(1024).fill(0);
    a[i % 1024] = 1;
    return a;
  };
  return {
    embed: vi.fn(async ({ texts }: { model: string; texts: string[] }) => ({
      vectors: texts.map((_, i) => v(i)),
      dim: 1024,
      model: "test",
    })),
    healthCheck: vi.fn(async () => ({ ok: true, models: ["test"] })),
    modelExists: vi.fn(async () => true),
  } as unknown as OllamaClient;
}

describe("catchupVault", () => {
  let dir: string;
  let db: Database;
  let vault: Vault;
  let ollama: OllamaClient;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vm-catchup-"));
    db = new Database(":memory:", "test-vault");
    db.migrate();
    db.models.upsert({ name: "test", provider: "ollama", dim: 1024 });
    vault = {
      config: { name: "t", path: dir, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    ollama = mockOllama();
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function seedDbAndDisk(name: string, body: string): Promise<void> {
    const abs = join(dir, name);
    await writeFile(abs, body, "utf-8");
    await indexNote({ vault, absolutePath: abs, embeddingModel: "test", ollama });
  }

  it("no-op when DB and disk are already in sync", async () => {
    await seedDbAndDisk("a.md", "# A");
    const result = await catchupVault({ vault, embeddingModel: "test", ollama });
    expect(result.scanned).toBe(1);
    expect(result.reindexed).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("re-indexes a file that changed on disk while server was offline", async () => {
    await seedDbAndDisk("b.md", "# B\noriginal");
    // External edit — directly on disk, not via the indexer
    await writeFile(join(dir, "b.md"), "# B\nedited externally", "utf-8");

    const result = await catchupVault({ vault, embeddingModel: "test", ollama });
    expect(result.reindexed).toBe(1);

    const note = vault.db.notes.getByPath("b.md");
    expect(note?.content).toContain("edited externally");
  });

  it("indexes a brand-new file added while offline", async () => {
    await writeFile(join(dir, "new.md"), "# Brand new", "utf-8");
    const result = await catchupVault({ vault, embeddingModel: "test", ollama });
    expect(result.reindexed).toBe(1);
    expect(vault.db.notes.getByPath("new.md")).not.toBeNull();
  });

  it("removes a note whose file vanished while offline", async () => {
    await seedDbAndDisk("gone.md", "# Gone");
    await unlink(join(dir, "gone.md"));

    const result = await catchupVault({ vault, embeddingModel: "test", ollama });
    expect(result.removed).toBe(1);
    expect(vault.db.notes.getByPath("gone.md")).toBeNull();
  });

  it("handles mixed change set in one pass", async () => {
    await seedDbAndDisk("keep.md", "# K");
    await seedDbAndDisk("change.md", "# C original");
    await seedDbAndDisk("rm.md", "# R");

    await writeFile(join(dir, "change.md"), "# C edited", "utf-8");
    await unlink(join(dir, "rm.md"));
    await writeFile(join(dir, "added.md"), "# A", "utf-8");

    const result = await catchupVault({ vault, embeddingModel: "test", ollama });
    expect(result.scanned).toBe(3); // keep, change, added
    expect(result.reindexed).toBe(2); // change + added
    expect(result.removed).toBe(1); // rm
  });
});
