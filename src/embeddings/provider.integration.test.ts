import { afterEach, expect, it } from "vitest";
import { loadOnnxProvider } from "../adapters/embeddings/onnx-runtime.js";
import { embeddingNamespace } from "./types.js";
import { indexVault } from "../indexer/indexer.js";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";
const modelPath = new URL("../../tests/fixtures/tiny-embedding/", import.meta.url).pathname;
it("uses local native ONNX inference with deterministic order, shape and prefix", async () => {
  const provider = await loadOnnxProvider(modelPath);
  try {
    expect(await provider.embed([])).toEqual([]);
    const result = await provider.embed(["Alpha", "Beta"]);
    expect(result).toHaveLength(2);
    for (const v of result) {
      expect(v).toHaveLength(2);
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    }
    expect(result[0]![0]).toBeLessThan(result[1]![0]);
    expect(await provider.embed(["Alpha"])).toEqual([result[0]]);
    expect((await provider.embed(["Alpha"], "query"))[0]).not.toEqual(result[0]);
    expect(await provider.embed(["Alpha ".repeat(50)])).toEqual(
      await provider.embed(["Alpha ".repeat(100)]),
    );
    expect(embeddingNamespace(provider.identity)).toContain("onnx");
  } finally {
    await provider.close();
    await provider.close();
  }
  await expect(provider.embed(["Alpha"])).rejects.toThrow("closed");
});
it("never downloads missing assets or accepts unpinned models", async () => {
  await expect(loadOnnxProvider("/missing-local-model-fixture")).rejects.toThrow();
});

it("indexes and searches a native local provider in its own model namespace", async () => {
  const { ProviderEmbeddingClient } = await import("./client.js");
  const { hybridSearch } = await import("../search/hybrid.js");
  const f = await createVaultFixture();
  const provider = await loadOnnxProvider(modelPath);
  const client = new ProviderEmbeddingClient(provider);
  const name = embeddingNamespace(provider.identity);
  try {
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha");
    await fs.writeFile(join(f.root, "Beta.md"), "# Beta\nBeta");
    const indexed = await indexVault(f.vault, {
      mode: "full",
      embeddingModel: name,
      ollama: client,
    });
    expect(indexed.status).toBe("completed");
    expect(f.vault.db.models.getActive()).toMatchObject({ name, provider: "onnx", dim: 2 });
    const result = await hybridSearch({
      vaults: [f.vault],
      query: "Alpha",
      embeddingModel: name,
      ollama: client,
      topK: 2,
    });
    expect(result[0]!.notePath).toBe("Alpha.md");
    expect(result[0]!.scoreBreakdown?.semantic).toBeDefined();
  } finally {
    await client.close();
    await f.cleanup();
  }
});
it("preserves an existing vector namespace and builds ONNX as a shadow before switching", async () => {
  const { ProviderEmbeddingClient } = await import("./client.js");
  const { startShadowIndex } = await import("../indexer/shadow.js");
  const f = await createVaultFixture();
  const provider = await loadOnnxProvider(modelPath);
  const client = new ProviderEmbeddingClient(provider);
  const name = embeddingNamespace(provider.identity);
  try {
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha");
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
    const old = f.vault.db.models.upsert({ name: "legacy", provider: "ollama", dim: 2 });
    const note = f.vault.db.notes.getByPath("Alpha.md")!;
    const chunk = f.vault.db.chunks.getByNote(note.id)[0]!;
    f.vault.db.embeddings.insertBatch([{ chunkId: chunk.id, modelId: old.id, vector: [1, 0] }]);
    await expect(
      indexVault(f.vault, { mode: "full", embeddingModel: name, ollama: client }),
    ).rejects.toThrow("shadow");
    expect(f.vault.db.embeddings.searchSemantic(old.id, [1, 0], 1)).toMatchObject([
      { chunkId: chunk.id, distance: 0 },
    ]);
    const shadow = await startShadowIndex({ vault: f.vault, model: name, ollama: client });
    expect(shadow.chunksEmbedded).toBe(1);
    expect(f.vault.db.models.getActive()!.id).toBe(old.id);
    expect(f.vault.db.models.getByName(name)).toMatchObject({ provider: "onnx", dim: 2 });
    expect(f.vault.db.embeddings.searchSemantic(old.id, [1, 0], 1)).toMatchObject([
      { chunkId: chunk.id, distance: 0 },
    ]);
  } finally {
    await client.close();
    await f.cleanup();
  }
});
it("rejects modified assets and separates manifests with different tokenization settings", async () => {
  const { mkdtemp, cp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "vm-onnx-pin-"));
  try {
    await cp(modelPath, dir, { recursive: true });
    const original = await loadOnnxProvider(dir);
    const identity = embeddingNamespace(original.identity);
    await original.close();
    const manifest = JSON.parse(await fs.readFile(join(dir, "manifest.json"), "utf8"));
    manifest.query_prefix = "different: ";
    await fs.writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    const changed = await loadOnnxProvider(dir);
    expect(embeddingNamespace(changed.identity)).not.toBe(identity);
    await changed.close();
    await fs.appendFile(join(dir, "tokenizer.json"), " ");
    await expect(loadOnnxProvider(dir)).rejects.toThrow("checksum mismatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
