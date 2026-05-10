/**
 * Shadow indexer (Phase 7c) — backfills embeddings for a secondary model
 * over chunks that already exist in the vault DB.
 *
 * Use case: a user runs vault-memory v0.6.x with model A. They want to test
 * model B's retrieval quality. Instead of destructively re-indexing (which
 * would break search while it runs), they kick off a shadow index:
 *
 *   1. Every chunk in the `chunks` table is embedded with model B.
 *   2. Vectors land in `embeddings_<dim_B>` next to the existing `embeddings_<dim_A>`.
 *   3. While running, model A stays active — search is uninterrupted.
 *   4. Once complete, `switch_active_model` flips the active flag atomically.
 *
 * Idempotent: a LEFT JOIN against the secondary dim's embeddings table
 * skips chunks that are already embedded. Safe to interrupt and resume.
 */

import { randomUUID } from "node:crypto";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";

export interface ShadowIndexOptions {
  vault: Vault;
  /** Secondary model name. Registered on demand if not yet in the DB. */
  model: string;
  ollama: OllamaClient;
  /** Embed batch size — capped at Ollama batch size in practice. Default 16. */
  batchSize?: number;
  log?: (msg: string) => void;
}

export interface ShadowIndexResult {
  runId: string;
  modelId: number;
  modelName: string;
  dim: number;
  chunksTotal: number;
  chunksEmbedded: number;
  chunksSkipped: number;
  durationMs: number;
}

interface PendingChunkRow {
  id: number;
  text: string;
}

/**
 * Backfill secondary embeddings for every chunk currently in the vault.
 * Skips chunks already embedded with this model (idempotent resume).
 *
 * Does NOT switch the active model. Use `switch_active_model` once the
 * caller has independently verified the shadow index is complete.
 */
export async function startShadowIndex(
  options: ShadowIndexOptions,
): Promise<ShadowIndexResult> {
  const { vault, model, ollama } = options;
  const log = options.log ?? (() => {});
  const batchSize = options.batchSize ?? 16;
  const runId = randomUUID();
  const started = Date.now();

  // 1. Probe Ollama for dim + existence. Fail fast if the model isn't pulled.
  if (!(await ollama.modelExists(model))) {
    throw new Error(
      `Shadow model "${model}" not found in Ollama. ` +
        `Run: ollama pull ${model}`,
    );
  }
  const probe = await ollama.embed({ model, texts: ["probe"] });
  const dim = probe.dim;

  // 2. Register the model (active=false — primary stays active).
  const modelRow = vault.db.models.upsert({
    name: model,
    provider: "ollama",
    dim,
    active: false,
  });

  // The embeddings table for this dim is created lazily by ensureTableForDim.
  vault.db.embeddings.ensureTableForDim(dim);

  // 3. Audit run.
  vault.db.audit.startRun({
    runId,
    vaultName: vault.config.name,
    modelId: modelRow.id,
    trigger: "shadow",
  });

  // 4. Find chunks missing the shadow embedding.
  //
  // The dim-specific table name is interpolated from a validated integer
  // dim — same pattern as EmbeddingsQueries.ensureTableForDim. Safe.
  const pendingSql = `
    SELECT c.id AS id, c.text AS text
    FROM chunks c
    LEFT JOIN embeddings_${dim} e
      ON e.chunk_id = c.id AND e.model_id = ?
    WHERE e.chunk_id IS NULL
    ORDER BY c.id
  `;
  const totalSql = `SELECT COUNT(*) AS c FROM chunks`;

  const pending = vault.db.handle
    .prepare<[number], PendingChunkRow>(pendingSql)
    .all(modelRow.id);
  const totalRow = vault.db.handle
    .prepare<[], { c: number }>(totalSql)
    .get();
  const chunksTotal = totalRow?.c ?? 0;
  const chunksSkipped = chunksTotal - pending.length;

  log(
    `shadow-index "${model}" (dim=${dim}): ${pending.length} pending, ` +
      `${chunksSkipped} already embedded`,
  );

  let chunksEmbedded = 0;
  try {
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const embedResp = await ollama.embed({
        model,
        texts: batch.map((c) => c.text),
      });
      if (embedResp.dim !== dim) {
        throw new Error(
          `Shadow embedding dim mismatch mid-run: expected ${dim}, ` +
            `got ${embedResp.dim} on batch starting chunk_id ${batch[0]?.id}`,
        );
      }
      vault.db.embeddings.insertBatch(
        batch.map((row, j) => ({
          chunkId: row.id,
          modelId: modelRow.id,
          vector: embedResp.vectors[j]!,
        })),
      );
      chunksEmbedded += batch.length;
      if (i % (batchSize * 8) === 0) {
        log(`  ${chunksEmbedded}/${pending.length}…`);
      }
    }

    vault.db.audit.finishRun(runId, {
      notesIndexed: 0,
      chunksCreated: chunksEmbedded,
      notesUpdated: 0,
      notesDeleted: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vault.db.audit.finishRun(runId, {
      notesIndexed: 0,
      chunksCreated: chunksEmbedded,
      notesUpdated: 0,
      notesDeleted: 0,
      error: message,
    });
    throw err;
  }

  return {
    runId,
    modelId: modelRow.id,
    modelName: model,
    dim,
    chunksTotal,
    chunksEmbedded,
    chunksSkipped,
    durationMs: Date.now() - started,
  };
}

/**
 * Inventory of all registered models in a vault with per-model
 * shadow-completeness data.
 */
export interface ModelInventoryEntry {
  id: number;
  name: string;
  provider: string;
  dim: number;
  active: boolean;
  embedded_chunk_count: number;
}

export function listModels(vault: Vault): ModelInventoryEntry[] {
  const rows = vault.db.models.listAll();
  return rows.map((m) => {
    // Each dim has its own table; the chunk count is per-(model_id, dim).
    let count = 0;
    try {
      vault.db.embeddings.ensureTableForDim(m.dim);
      const row = vault.db.handle
        .prepare<[number], { c: number }>(
          `SELECT COUNT(*) AS c FROM embeddings_${m.dim} WHERE model_id = ?`,
        )
        .get(m.id);
      count = row?.c ?? 0;
    } catch {
      // Defensive: if the dim table somehow can't be queried (e.g. corrupt
      // schema), surface 0 rather than crashing the listing call.
      count = 0;
    }
    return {
      id: m.id,
      name: m.name,
      provider: m.provider,
      dim: m.dim,
      active: m.active === 1,
      embedded_chunk_count: count,
    };
  });
}

export interface SwitchResult {
  ok: boolean;
  reason?: "unknown_model" | "incomplete" | "already_active";
  missing_chunks?: number;
  switched_from?: string;
  switched_to?: string;
}

/**
 * Atomically switch the active embedding model for a vault. Refuses to
 * switch if any chunk in the vault is missing an embedding for the target
 * model — partial switches would leave the new active model unable to
 * answer queries for those chunks.
 */
export function switchActiveModel(
  vault: Vault,
  targetModelName: string,
): SwitchResult {
  const target = vault.db.models.getByName(targetModelName);
  if (!target) {
    return { ok: false, reason: "unknown_model" };
  }

  const current = vault.db.models.getActive();
  if (current && current.id === target.id) {
    return {
      ok: false,
      reason: "already_active",
      switched_from: current.name,
      switched_to: target.name,
    };
  }

  // Completeness check: every chunk must have an embedding under (target.id, target.dim).
  vault.db.embeddings.ensureTableForDim(target.dim);
  const missingRow = vault.db.handle
    .prepare<[number], { c: number }>(
      `SELECT COUNT(*) AS c
       FROM chunks c
       LEFT JOIN embeddings_${target.dim} e
         ON e.chunk_id = c.id AND e.model_id = ?
       WHERE e.chunk_id IS NULL`,
    )
    .get(target.id);
  const missing = missingRow?.c ?? 0;

  if (missing > 0) {
    return {
      ok: false,
      reason: "incomplete",
      missing_chunks: missing,
      switched_from: current?.name,
      switched_to: target.name,
    };
  }

  vault.db.models.setActive(target.id);
  return {
    ok: true,
    switched_from: current?.name,
    switched_to: target.name,
  };
}
