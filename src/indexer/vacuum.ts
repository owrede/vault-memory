/**
 * vacuum_embeddings — drop orphaned embedding rows.
 *
 * Over time, a vault DB can accumulate embedding rows whose `chunk_id` no
 * longer exists in the `chunks` table. Sources of orphans:
 *   - Pre-v0.7.0 schemas where note-deletion did not always cascade through
 *     the derived layer (since fixed by Migration 003 + 7c plumbing).
 *   - Manual SQL repair, partial migrations, interrupted shadow runs.
 *   - The v0.6.x → v0.7.x migration kept legacy `embeddings` rows in
 *     `embeddings_<dim>` even when the chunks had been deleted upstream.
 *
 * The vault we used for the v0.7.2 eval still carried 1541 such orphans
 * (qwen3 had 3088 embeddings, only 1547 live chunks → ~50% orphaned).
 *
 * Behavior:
 *   - Walks every per-model embeddings table (`embeddings_m<id>_d<dim>`).
 *   - Deletes rows whose `chunk_id` is not present in `chunks`.
 *   - Returns a per-model count of (kept, removed, table) for the audit log.
 *   - Never deletes rows in `chunks` itself; the raw layer is untouched.
 */

import type { Vault } from "../vault/index.js";

export interface VacuumPerModel {
  model_id: number;
  model_name: string;
  dim: number;
  table: string;
  removed: number;
  kept: number;
}

export interface VacuumResult {
  total_removed: number;
  per_model: VacuumPerModel[];
  duration_ms: number;
}

export function vacuumEmbeddings(vault: Vault): VacuumResult {
  const startedAt = Date.now();
  const models = vault.db.models.listAll();
  const per_model: VacuumPerModel[] = [];
  let total_removed = 0;

  // One transaction across all per-model tables so the result is all-or-nothing.
  vault.db.transaction(() => {
    for (const m of models) {
      // Materialise the table if it does not exist yet — `models` can list a
      // model that has not yet been embedded (e.g. a freshly registered
      // shadow model). In that case we'd skip cleanly with kept=0/removed=0.
      vault.db.embeddings.ensureTableForModel(m.id, m.dim);
      const table = `embeddings_m${m.id}_d${m.dim}`;

      const beforeRow = vault.db.handle
        .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)
        .get();
      const before = beforeRow?.c ?? 0;

      // Two-step delete because sqlite-vec virtual tables do not support
      // `DELETE ... WHERE chunk_id NOT IN (subquery)` cleanly across all
      // builds. Collect the orphan IDs first, then delete by primary key.
      const orphans = vault.db.handle
        .prepare<[], { chunk_id: number }>(
          `SELECT chunk_id FROM ${table}
           WHERE chunk_id NOT IN (SELECT id FROM chunks)`,
        )
        .all();

      if (orphans.length > 0) {
        const stmt = vault.db.handle.prepare(
          `DELETE FROM ${table} WHERE chunk_id = ?`,
        );
        for (const o of orphans) {
          stmt.run(BigInt(o.chunk_id));
        }
      }

      const removed = orphans.length;
      const kept = before - removed;
      total_removed += removed;
      per_model.push({
        model_id: m.id,
        model_name: m.name,
        dim: m.dim,
        table,
        removed,
        kept,
      });
    }
  });

  return {
    total_removed,
    per_model,
    duration_ms: Date.now() - startedAt,
  };
}
