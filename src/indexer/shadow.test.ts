/**
 * Phase 7c — shadow indexing + active model switch tests.
 *
 * Covers:
 *   - indexVault with secondaryEmbeddingModel embeds every chunk under both
 *     models, in their respective embeddings_<dim> tables.
 *   - listModels reports per-model embedded_chunk_count + active flag.
 *   - switchActiveModel refuses incomplete switches (missing_chunks > 0).
 *   - switchActiveModel succeeds when the shadow is complete and flips
 *     the active flag.
 *   - startShadowIndex is idempotent: a second call is a no-op.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import type { EmbedRequest, EmbedResponse } from "../types.js";
import { indexVault } from "./indexer.js";
import {
  listModels,
  startShadowIndex,
  switchActiveModel,
} from "./shadow.js";

const PRIMARY = "primary-embed";
const PRIMARY_DIM = 1024;
const SECONDARY = "secondary-embed";
const SECONDARY_DIM = 768;

function makeVault(vaultRoot: string): Vault {
  const db = new Database(":memory:");
  return {
    config: { name: "test", path: vaultRoot },
    db,
    dbPath: ":memory:",
  };
}

function unitVec(dim: number, seed: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[seed % dim] = 1;
  return v;
}

function makeOllama(): {
  client: OllamaClient;
  embed: ReturnType<typeof vi.fn>;
} {
  // Maps known model names → output dim. Unknown models fail modelExists.
  const dims: Record<string, number> = {
    [PRIMARY]: PRIMARY_DIM,
    [SECONDARY]: SECONDARY_DIM,
  };
  const embed = vi.fn(async (req: EmbedRequest): Promise<EmbedResponse> => {
    const dim = dims[req.model];
    if (dim == null) {
      throw new Error(`mock ollama: unknown model ${req.model}`);
    }
    return {
      vectors: req.texts.map((_, i) => unitVec(dim, i)),
      dim,
      model: req.model,
    };
  });
  const modelExists = vi.fn(async (name: string) => name in dims);
  const healthCheck = vi.fn(async () => ({ ok: true, models: Object.keys(dims) }));
  const client = {
    embed,
    modelExists,
    healthCheck,
  } as unknown as OllamaClient;
  return { client, embed };
}

async function seedVault(vaultRoot: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await fs.writeFile(
      path.join(vaultRoot, `note-${i}.md`),
      `# Note ${i}\n\nBody text for note number ${i}. Some content here.\n`,
      "utf-8",
    );
  }
}

describe("Phase 7c — shadow indexing via indexVault", () => {
  let tmpDir: string;
  let vault: Vault;
  let ollama: { client: OllamaClient; embed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-shadow-"));
    vault = makeVault(tmpDir);
    ollama = makeOllama();
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("indexVault with secondaryEmbeddingModel embeds each chunk under both models", async () => {
    await seedVault(tmpDir, 3);

    const result = await indexVault(vault, {
      mode: "full",
      embeddingModel: PRIMARY,
      secondaryEmbeddingModel: SECONDARY,
      ollama: ollama.client,
    });
    expect(result.status).toBe("completed");
    expect(result.chunksCreated).toBeGreaterThan(0);

    // Both models registered.
    const models = listModels(vault);
    expect(models).toHaveLength(2);
    const primaryRow = models.find((m) => m.name === PRIMARY)!;
    const secondaryRow = models.find((m) => m.name === SECONDARY)!;
    expect(primaryRow.active).toBe(true);
    expect(secondaryRow.active).toBe(false);
    expect(primaryRow.dim).toBe(PRIMARY_DIM);
    expect(secondaryRow.dim).toBe(SECONDARY_DIM);

    // Every chunk embedded under each model.
    const totalChunks = vault.db.handle
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM chunks")
      .get()!.c;
    expect(primaryRow.embedded_chunk_count).toBe(totalChunks);
    expect(secondaryRow.embedded_chunk_count).toBe(totalChunks);
    // Sanity: vectors landed in their per-model tables (Phase 7e layout).
    const primaryTable = `embeddings_m${primaryRow.id}_d${PRIMARY_DIM}`;
    const secondaryTable = `embeddings_m${secondaryRow.id}_d${SECONDARY_DIM}`;
    const cPrimary = vault.db.handle
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${primaryTable}`)
      .get();
    const cSecondary = vault.db.handle
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${secondaryTable}`)
      .get();
    expect(cPrimary?.c).toBe(totalChunks);
    expect(cSecondary?.c).toBe(totalChunks);
  });
});

describe("Phase 7c — startShadowIndex + switchActiveModel", () => {
  let tmpDir: string;
  let vault: Vault;
  let ollama: { client: OllamaClient; embed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-shadow2-"));
    vault = makeVault(tmpDir);
    ollama = makeOllama();
    await seedVault(tmpDir, 4);
    // Index with primary only first.
    await indexVault(vault, {
      mode: "full",
      embeddingModel: PRIMARY,
      ollama: ollama.client,
    });
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("startShadowIndex backfills the secondary model and is idempotent", async () => {
    const totalChunks = vault.db.handle
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM chunks")
      .get()!.c;
    expect(totalChunks).toBeGreaterThan(0);

    const first = await startShadowIndex({
      vault,
      model: SECONDARY,
      ollama: ollama.client,
    });
    expect(first.chunksTotal).toBe(totalChunks);
    expect(first.chunksEmbedded).toBe(totalChunks);
    expect(first.chunksSkipped).toBe(0);

    // Second call: nothing to do.
    const second = await startShadowIndex({
      vault,
      model: SECONDARY,
      ollama: ollama.client,
    });
    expect(second.chunksEmbedded).toBe(0);
    expect(second.chunksSkipped).toBe(totalChunks);

    // Primary stays active throughout.
    expect(vault.db.models.getActive()?.name).toBe(PRIMARY);
  });

  it("switchActiveModel refuses when the shadow is incomplete", () => {
    // Register secondary but don't embed any chunks.
    vault.db.models.upsert({
      name: SECONDARY,
      provider: "ollama",
      dim: SECONDARY_DIM,
      active: false,
    });
    const result = switchActiveModel(vault, SECONDARY);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("incomplete");
    expect(result.missing_chunks).toBeGreaterThan(0);
    expect(vault.db.models.getActive()?.name).toBe(PRIMARY);
  });

  it("switchActiveModel promotes the shadow once complete", async () => {
    await startShadowIndex({
      vault,
      model: SECONDARY,
      ollama: ollama.client,
    });

    const result = switchActiveModel(vault, SECONDARY);
    expect(result.ok).toBe(true);
    expect(result.switched_from).toBe(PRIMARY);
    expect(result.switched_to).toBe(SECONDARY);
    expect(vault.db.models.getActive()?.name).toBe(SECONDARY);

    // Exactly one active row.
    const active = vault.db.models
      .listAll()
      .filter((m) => m.active === 1);
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe(SECONDARY);
  });

  it("switchActiveModel reports unknown_model cleanly", () => {
    const result = switchActiveModel(vault, "never-registered");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_model");
  });
});
