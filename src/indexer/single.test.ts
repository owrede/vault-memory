import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import type { EmbedRequest, EmbedResponse } from "../types.js";
import { indexNote, removeNote } from "./single.js";

const MODEL = "test-embed";
const DIM = 1024;

function makeVault(vaultRoot: string): Vault {
  const db = new Database(":memory:");
  // Pre-register the embedding model so single-indexer can find it.
  db.models.upsert({ name: MODEL, provider: "ollama", dim: DIM });
  return {
    config: { name: "test", path: vaultRoot },
    db,
    dbPath: ":memory:",
  };
}

function makeOllama(): {
  client: OllamaClient;
  embed: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn(async (req: EmbedRequest): Promise<EmbedResponse> => ({
    vectors: req.texts.map((_, i) => unitVector(DIM, i)),
    dim: DIM,
    model: req.model,
  }));
  // We only use `.embed`; cast through unknown to satisfy the structural
  // OllamaClient contract without instantiating the real HTTP client.
  const client = { embed } as unknown as OllamaClient;
  return { client, embed };
}

function unitVector(dim: number, seed: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[seed % dim] = 1;
  return v;
}

describe("single-indexer: indexNote", () => {
  let tmpDir: string;
  let vault: Vault;
  let ollama: { client: OllamaClient; embed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-single-"));
    vault = makeVault(tmpDir);
    ollama = makeOllama();
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeNote(rel: string, body: string): Promise<string> {
    const abs = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, "utf-8");
    return abs;
  }

  it("indexes a brand-new note", async () => {
    const abs = await writeNote(
      "Foo.md",
      "# Foo\n\nHello world. This is body text.",
    );
    const result = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(result.status).toBe("indexed");
    expect(result.isNew).toBe(true);
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.notePath).toBe("Foo.md");
    expect(ollama.embed).toHaveBeenCalledTimes(1);
  });

  it("returns 'unchanged' when hash is identical (no re-embed)", async () => {
    const abs = await writeNote("Bar.md", "# Bar\n\nBody.");
    await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(ollama.embed).toHaveBeenCalledTimes(1);

    const second = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(second.status).toBe("unchanged");
    expect(second.chunksCreated).toBe(0);
    expect(second.isNew).toBe(false);
    // Critical: no second embed call.
    expect(ollama.embed).toHaveBeenCalledTimes(1);
  });

  it("re-indexes when content changes", async () => {
    const abs = await writeNote("Baz.md", "# Baz\n\nFirst version.");
    const first = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(first.isNew).toBe(true);

    // Wait 5ms to ensure mtime differs (although hash is what matters).
    await new Promise((r) => setTimeout(r, 5));
    await fs.writeFile(abs, "# Baz\n\nCompletely different body now.", "utf-8");

    const second = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(second.status).toBe("indexed");
    expect(second.isNew).toBe(false);
    expect(second.chunksCreated).toBeGreaterThan(0);
    expect(ollama.embed).toHaveBeenCalledTimes(2);
  });

  it("returns 'outside_vault' for paths outside the vault root", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-out-"));
    try {
      const abs = path.join(outside, "Stray.md");
      await fs.writeFile(abs, "# Stray\n", "utf-8");
      const result = await indexNote({
        vault,
        absolutePath: abs,
        embeddingModel: MODEL,
        ollama: ollama.client,
      });
      expect(result.status).toBe("outside_vault");
      expect(result.notePath).toBeNull();
      expect(result.noteId).toBeNull();
      expect(ollama.embed).not.toHaveBeenCalled();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("returns 'missing' for a non-existent file inside the vault", async () => {
    const abs = path.join(tmpDir, "Ghost.md");
    const result = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(result.status).toBe("missing");
    expect(ollama.embed).not.toHaveBeenCalled();
  });

  it("persists frontmatter aliases for resolution", async () => {
    const abs = await writeNote(
      "People/Oliver.md",
      ["---", "aliases:", "  - OWR", "  - Oliver W.", "---", "", "Body."].join(
        "\n",
      ),
    );
    await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    const hit = vault.db.aliases.resolve("OWR");
    expect(hit?.path).toBe("People/Oliver.md");
    const hit2 = vault.db.aliases.resolve("oliver w.");
    expect(hit2?.path).toBe("People/Oliver.md");
  });
});

describe("single-indexer: removeNote", () => {
  let tmpDir: string;
  let vault: Vault;
  let ollama: { client: OllamaClient; embed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-single-rm-"));
    vault = makeVault(tmpDir);
    ollama = makeOllama();
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes an indexed note from the DB", async () => {
    const abs = path.join(tmpDir, "Doomed.md");
    await fs.writeFile(abs, "# Doomed\n\nWill be deleted.", "utf-8");
    await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(vault.db.notes.getByPath("Doomed.md")).not.toBeNull();

    const result = removeNote(vault, abs);
    expect(result.removed).toBe(true);
    expect(result.notePath).toBe("Doomed.md");
    expect(vault.db.notes.getByPath("Doomed.md")).toBeNull();
  });

  it("returns removed=false for a path not in the DB", async () => {
    const abs = path.join(tmpDir, "NeverIndexed.md");
    const result = removeNote(vault, abs);
    expect(result.removed).toBe(false);
    expect(result.notePath).toBeNull();
  });

  it("returns removed=false for a path outside the vault", async () => {
    const outside = path.join(os.tmpdir(), "definitely-not-in-vault.md");
    const result = removeNote(vault, outside);
    expect(result.removed).toBe(false);
    expect(result.notePath).toBeNull();
  });
});
