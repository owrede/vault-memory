import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Database } from "../../db/index.js";
import { VaultManager, type Vault } from "../../vault/index.js";
import { OllamaClient } from "../../ollama/index.js";
import { AdapterRegistry } from "../../adapters/registry.js";
import * as contextFitCli from "../../adapters/retrieval/contextfit/cli.js";
import { searchVaults } from "../../search/dispatch.js";
import type { HandlerDeps } from "../deps.js";
import type { SearchHit } from "../../types.js";
import { makeSearchHandlers } from "./search.js";

describe("ContextFit MCP search routing", () => {
  let manager: VaultManager;
  let vault: Vault;
  let ollama: OllamaClient;
  let handlers: ReturnType<typeof makeSearchHandlers>;

  beforeEach(() => {
    const db = new Database(":memory:", "cf-test");
    db.migrate();
    vault = {
      config: {
        name: "cf-test",
        path: "/fixture/vault",
        backend: "contextfit",
        contextfit: { method: "bm25" },
      },
      db,
      dbPath: ":memory:",
    };
    manager = new VaultManager();
    // Use the real manager and DB without creating a persistent user vault.
    (manager as unknown as { vaults: Map<string, Vault> }).vaults.set("cf-test", vault);
    ollama = new OllamaClient();
    handlers = makeSearchHandlers({
      manager,
      ollama,
      defaultModel: "unused",
      activeVault: "cf-test",
      adapterRegistry: new AdapterRegistry(),
    } as HandlerDeps);

    // Only the external CLI query is replaced. Routing, source-path mapping,
    // note deduplication, exclusion and result assembly all remain real.
    vi.spyOn(contextFitCli, "contextFitQuery").mockImplementation(async (_cfg, query, opts) => {
      if (query !== "Rechnung" || opts?.method !== "bm25") {
        throw new Error("Unexpected query or retrieval method");
      }
      return {
        query: "Rechnung",
        method: "bm25",
        retrieved_chunks: 3,
        chunks: [
          {
            rank: 1,
            chunk_id: 1,
            score: 0.9,
            level: 0,
            parent_id: null,
            token_count: 4,
            metadata: { source: "/fixture/vault/archiv/Rechnung.md" },
            preview: "Alte Rechnung",
          },
          {
            rank: 2,
            chunk_id: 2,
            score: 0.8,
            level: 0,
            parent_id: null,
            token_count: 4,
            metadata: { source: "/fixture/vault/Rechnung.md" },
            preview: "Aktuelle Rechnung",
          },
          {
            rank: 3,
            chunk_id: 3,
            score: 0.7,
            level: 0,
            parent_id: null,
            token_count: 4,
            metadata: { source: "/fixture/vault/Rechnung.md" },
            preview: "Zweite Passage",
          },
        ],
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    manager.closeAll();
  });

  it("search_semantic returns ContextFit notes when no embedding model exists", async () => {
    expect(vault.db.models.getActive()).toBeNull();
    const result = await handlers.search_semantic!({ query: "Rechnung", top_k: 3 });
    expect(result).toMatchObject({
      count: 2,
      hits: [
        { vault: "cf-test", notePath: "archiv/Rechnung.md", chunkText: "Alte Rechnung" },
        { vault: "cf-test", notePath: "Rechnung.md", chunkText: "Aktuelle Rechnung" },
      ],
    });
  });

  it("search_semantic applies exclude_paths before limiting ContextFit hits", async () => {
    const result = await handlers.search_semantic!({
      query: "Rechnung",
      top_k: 1,
      exclude_paths: ["archiv/**"],
    });
    expect(result).toMatchObject({ count: 1, hits: [{ notePath: "Rechnung.md" }] });
  });

  it.each(["search_semantic", "search_hybrid"] as const)(
    "%s reports a failed ContextFit backend instead of an empty successful search",
    async (tool) => {
      vi.mocked(contextFitCli.contextFitQuery).mockRejectedValue(
        new contextFitCli.ContextFitError("CLI unavailable", "ENOENT"),
      );
      await expect(handlers[tool]!({ query: "Rechnung", top_k: 3, rrf_k: 60 })).rejects.toThrow(
        /cf-test.*CLI unavailable/,
      );
    },
  );

  it("keeps healthy vault results when another ContextFit vault fails", async () => {
    vi.mocked(contextFitCli.contextFitQuery).mockRejectedValueOnce(
      new contextFitCli.ContextFitError("CLI unavailable", "ENOENT"),
    );
    const brokenVault: Vault = { ...vault, config: { ...vault.config, name: "broken" } };
    const hits: SearchHit[] = await searchVaults({
      query: "Rechnung",
      embeddingModel: "unused",
      ollama,
      vaults: [brokenVault, vault],
      topK: 3,
    });
    expect(hits.map((hit) => [hit.vault, hit.notePath])).toEqual([
      ["cf-test", "archiv/Rechnung.md"],
      ["cf-test", "Rechnung.md"],
    ]);
  });

  it.each([true, false])(
    "preserves a healthy Ollama semantic search when ContextFit fails (has hits: %s)",
    async (hasHits) => {
      const db = new Database(":memory:", "vector-test");
      db.migrate();
      const vectorVault: Vault = {
        config: { name: "vector-test", path: "/fixture/vector", backend: "ollama" },
        db,
        dbPath: ":memory:",
      };
      (manager as unknown as { vaults: Map<string, Vault> }).vaults.set("vector-test", vectorVault);
      const model = db.models.upsert({ name: "fixture-model", provider: "ollama", dim: 2 });
      if (hasHits) {
        const note = db.notes.upsertByPath({
          path: "vector.md",
          title: "Vector note",
          content: "Invoice",
          frontmatter: null,
          hash: "h",
          bodyHash: "h",
          mtime: 1,
          wordCount: 1,
        });
        const [chunkId] = db.chunks.insertBatch(note.id, [
          {
            idx: 0,
            text: "Invoice",
            headingPath: null,
            startOffset: 0,
            endOffset: 7,
            tokenCount: 1,
          },
        ]);
        db.embeddings.insertBatch([{ chunkId: chunkId!, modelId: model.id, vector: [1, 0] }]);
      }
      vi.spyOn(ollama, "embed").mockResolvedValue({ model: "fixture-model", vectors: [[1, 0]] });
      vi.mocked(contextFitCli.contextFitQuery).mockRejectedValue(
        new contextFitCli.ContextFitError("CLI unavailable", "ENOENT"),
      );
      const result = await handlers.search_semantic!({
        query: "Rechnung",
        top_k: 3,
        vaults: ["cf-test", "vector-test"],
      });
      expect(result).toMatchObject({
        count: hasHits ? 1 : 0,
        hits: hasHits ? [{ vault: "vector-test", notePath: "vector.md" }] : [],
        note: expect.stringContaining("cf-test"),
      });
    },
  );

  it("preserves a successful empty result when ContextFit finds no matches", async () => {
    vi.mocked(contextFitCli.contextFitQuery).mockResolvedValue({
      query: "Rechnung",
      method: "bm25",
      retrieved_chunks: 0,
      chunks: [],
    });
    await expect(
      handlers.search_hybrid!({ query: "Rechnung", top_k: 3, rrf_k: 60 }),
    ).resolves.toMatchObject({ count: 0, hits: [] });
  });
});
