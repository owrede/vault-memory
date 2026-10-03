import { afterEach, expect, it, vi } from "vitest";
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
it("never resolves an existing Ollama model as ONNX merely because its bare name matches", async () => {
  const { ProviderEmbeddingClient } = await import("./client.js");
  const { embedQuery } = await import("./client.js");
  const provider = await loadOnnxProvider(modelPath);
  const client = new ProviderEmbeddingClient(provider, {
    endpoint: "http://127.0.0.1:1",
    retries: 0,
    timeoutMs: 100,
  });
  try {
    await expect(
      embedQuery(client, { model: provider.identity.model, texts: ["Alpha"] }),
    ).rejects.toThrow();
  } finally {
    await client.close();
  }
});
it("keeps a canonically named ONNX shadow live during single-note refresh", async () => {
  const { ProviderEmbeddingClient } = await import("./client.js");
  const { startShadowIndex } = await import("../indexer/shadow.js");
  const { indexNote } = await import("../indexer/single.js");
  const f = await createVaultFixture();
  const provider = await loadOnnxProvider(modelPath);
  const client = new ProviderEmbeddingClient(provider);
  const { OllamaClient } = await import("../ollama/index.js");
  const remote = vi.spyOn(OllamaClient.prototype, "embed").mockImplementation(async (request) => {
    if (request.model !== "legacy") throw new Error("Unexpected remote model");
    return { vectors: request.texts.map(() => [1, 0]), dim: 2, model: "legacy" };
  });
  try {
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha");
    await indexVault(f.vault, { embeddingModel: "unused", embeddings: "none" });
    f.vault.db.models.upsert({ name: "legacy", provider: "ollama", dim: 2 });
    const shadow = await startShadowIndex({
      vault: f.vault,
      model: provider.identity.model,
      ollama: client,
    });
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha changed");
    const result = await indexNote({
      vault: f.vault,
      absolutePath: join(f.root, "Alpha.md"),
      embeddingModel: "legacy",
      secondaryEmbeddingModel: provider.identity.model,
      ollama: client,
    });
    expect(result.status).toBe("indexed");
    const note = f.vault.db.notes.getByPath("Alpha.md")!;
    const chunk = f.vault.db.chunks.getByNote(note.id)[0]!;
    expect(
      f.vault.db.embeddings.searchSemantic(shadow.modelId, [1, 0], 10).map((v) => v.chunkId),
    ).toContain(chunk.id);
  } finally {
    remote.mockRestore();
    await client.close();
    await f.cleanup();
  }
});
it("refreshes with the newly active provider after a shadow switch in catchup and watcher", async () => {
  const { ProviderEmbeddingClient } = await import("./client.js");
  const { startShadowIndex, switchActiveModel } = await import("../indexer/shadow.js");
  const { catchupVault } = await import("../indexer/catchup.js");
  const { VaultWatcher } = await import("../adapters/change-feed/obsidian-fs/watcher.js");
  const f = await createVaultFixture();
  const provider = await loadOnnxProvider(modelPath);
  const client = new ProviderEmbeddingClient(provider);
  try {
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha");
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
    f.vault.db.models.upsert({ name: "legacy", provider: "ollama", dim: 2 });
    const watcher = new VaultWatcher({
      vault: f.vault,
      embeddingModel: "legacy",
      ollama: client,
      suppression: f.suppression,
    });
    const shadow = await startShadowIndex({
      vault: f.vault,
      model: provider.identity.model,
      ollama: client,
    });
    expect(switchActiveModel(f.vault, shadow.modelName).ok).toBe(true);
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha catchup");
    expect(
      (await catchupVault({ vault: f.vault, embeddingModel: "legacy", ollama: client })).reindexed,
    ).toBe(1);
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha watcher");
    await (
      watcher as unknown as {
        handleFlush: (event: { kind: "change"; path: string }) => Promise<void>;
      }
    ).handleFlush({ kind: "change", path: join(f.root, "Alpha.md") });
    const note = f.vault.db.notes.getByPath("Alpha.md")!;
    expect(note.content).toContain("watcher");
    const chunk = f.vault.db.chunks.getByNote(note.id)[0]!;
    expect(
      f.vault.db.embeddings.searchSemantic(shadow.modelId, [1, 0], 10).map((v) => v.chunkId),
    ).toContain(chunk.id);
  } finally {
    await client.close();
    await f.cleanup();
  }
});
it("routes a bare ONNX secondary name to native inference during a full legacy index", async () => {
  const { createServer } = await import("node:http");
  const { ProviderEmbeddingClient } = await import("./client.js");
  const provider = await loadOnnxProvider(modelPath),
    f = await createVaultFixture();
  const remoteModels: string[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags")
        res.end(
          JSON.stringify({ models: [{ name: "legacy" }, { name: provider.identity.model }] }),
        );
      else {
        const body = JSON.parse(data);
        remoteModels.push(body.model);
        res.end(JSON.stringify({ embeddings: body.input.map(() => [1, 0]) }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const client = new ProviderEmbeddingClient(provider, {
    endpoint: `http://127.0.0.1:${address.port}`,
    retries: 0,
  });
  try {
    await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha");
    expect(
      (
        await indexVault(f.vault, {
          mode: "full",
          embeddingModel: "legacy",
          secondaryEmbeddingModel: provider.identity.model,
          ollama: client,
        })
      ).status,
    ).toBe("completed");
    const shadow = f.vault.db.models.getByName(embeddingNamespace(provider.identity))!;
    const expected = (await provider.embed(["# Alpha\nAlpha"]))[0]!;
    expect(f.vault.db.embeddings.searchSemantic(shadow.id, expected, 1)[0]!.distance).toBeCloseTo(
      0,
      5,
    );
    expect(remoteModels.every((model) => model === "legacy")).toBe(true);
  } finally {
    await client.close();
    await f.cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
