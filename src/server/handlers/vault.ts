/**
 * Vault-domain MCP handler factory.
 *
 * Tools: list_vaults, vault_stats, recent_notes, audit_log, list_models,
 * start_shadow_index, switch_active_model, vacuum_embeddings, index_runs.
 *
 * Extracted verbatim from the inline `handlers` literal + standalone
 * `handle*` functions in `src/server.ts`. Behavior-neutral: each arrow
 * maps the same args to the same domain call, now closing over `deps.*`
 * instead of `serve()` locals.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. SQLite access
 * is via the `vault.db` query namespaces (L0 substrate), not raw fs.
 */

import type { VaultManager } from "../../vault/index.js";
import { aggregateTopTags, aggregateTopFrontmatterKeys } from "../utils.js";
import { listModels, startShadowIndex, switchActiveModel, vacuumEmbeddings } from "../../indexer/index.js";
import { getAuditLog, getIndexRuns } from "../../audit/index.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

export function handleListVaults(manager: VaultManager): object {
  const vaults = manager.list().map((v) => {
    const noteCount = v.db.notes.countAll();
    const runs = v.db.audit.listRuns(1);
    const lastRun = runs[0];
    return {
      name: v.config.name,
      path: v.config.path,
      embedding_model: v.config.embedding_model ?? null,
      note_count: noteCount,
      write_enabled: v.config.write_enabled ?? false,
      last_run: lastRun
        ? {
            run_id: lastRun.run_id,
            started_at: lastRun.started_at,
            finished_at: lastRun.finished_at,
            error: lastRun.error,
          }
        : null,
    };
  });
  return { vaults, count: vaults.length };
}

interface VaultStatsRow {
  vault: string;
  vault_path: string;
  total_notes: number;
  total_words: number;
  embedding_model: string | null;
  indexed_at: number | null;
  top_tags: Array<{ tag: string; count: number }>;
  top_frontmatter_keys: Array<{ key: string; count: number }>;
}

export function handleVaultStats(manager: VaultManager, vaultFilter: string | undefined): object {
  const targets = vaultFilter ? [manager.require(vaultFilter)] : manager.list();

  const stats: VaultStatsRow[] = targets.map((v) => {
    const total_notes = v.db.notes.countAll();
    const wordRow = v.db.handle
      .prepare<[], { total: number | null }>("SELECT SUM(word_count) AS total FROM notes")
      .get();
    const lastRun = v.db.audit.listRuns(1)[0];
    const activeModel = v.db.models.getActive();

    return {
      vault: v.config.name,
      vault_path: v.config.path,
      total_notes,
      total_words: wordRow?.total ?? 0,
      embedding_model: activeModel?.name ?? v.config.embedding_model ?? null,
      indexed_at: lastRun?.finished_at ?? null,
      top_tags: aggregateTopTags(v.db.handle, 10),
      top_frontmatter_keys: aggregateTopFrontmatterKeys(v.db.handle, 10),
    };
  });

  if (vaultFilter) {
    // `targets` is non-empty when vaultFilter is set, because manager.require
    // throws on miss — so stats[0] is guaranteed. The assertion narrows the
    // type for the caller.
    return stats[0] as VaultStatsRow;
  }
  return { vaults: stats, count: stats.length };
}

interface RecentNoteRow {
  vault: string;
  path: string;
  title: string | null;
  mtime: number;
  word_count: number | null;
  tags: string[] | null;
}

export function handleRecentNotes(
  manager: VaultManager,
  vaultFilter: string | undefined,
  limit: number,
  since: number | undefined,
): object {
  const targets = vaultFilter ? [manager.require(vaultFilter)] : manager.list();

  const all: RecentNoteRow[] = [];
  for (const v of targets) {
    const rows =
      since !== undefined
        ? v.db.handle
            .prepare<
              [number, number],
              {
                path: string;
                title: string | null;
                mtime: number;
                word_count: number | null;
                frontmatter: string | null;
              }
            >(
              "SELECT path, title, mtime, word_count, frontmatter FROM notes WHERE mtime > ? ORDER BY mtime DESC LIMIT ?",
            )
            .all(since, limit)
        : v.db.handle
            .prepare<
              [number],
              {
                path: string;
                title: string | null;
                mtime: number;
                word_count: number | null;
                frontmatter: string | null;
              }
            >(
              "SELECT path, title, mtime, word_count, frontmatter FROM notes ORDER BY mtime DESC LIMIT ?",
            )
            .all(limit);

    for (const r of rows) {
      let tags: string[] | null = null;
      if (r.frontmatter) {
        try {
          const fm = JSON.parse(r.frontmatter) as { tags?: unknown };
          if (Array.isArray(fm.tags)) {
            tags = fm.tags.filter((t): t is string => typeof t === "string");
          }
        } catch {
          // ignore
        }
      }
      all.push({
        vault: v.config.name,
        path: r.path,
        title: r.title,
        mtime: r.mtime,
        word_count: r.word_count,
        tags,
      });
    }
  }

  // Cross-vault merge: re-sort by mtime and trim.
  all.sort((a, b) => b.mtime - a.mtime);
  return { notes: all.slice(0, limit), count: Math.min(all.length, limit) };
}

export function makeVaultHandlers(deps: HandlerDeps): Partial<Record<ToolName, Handler>> {
  const { manager, ollama } = deps;
  return {
    list_vaults: async () => handleListVaults(manager),
    vault_stats: async (a) => {
      const p = a as { vault?: string };
      return handleVaultStats(manager, p.vault);
    },
    recent_notes: async (a) => {
      const p = a as { vault?: string; limit: number; since?: number };
      return handleRecentNotes(manager, p.vault, p.limit, p.since);
    },
    audit_log: async (a) => {
      const p = a as {
        vault: string;
        note_path?: string;
        op?: "create" | "update" | "delete";
        since?: number;
        limit: number;
        is_memory_sink_write?: boolean;
      };
      const vault = manager.require(p.vault);
      // Plan 02-06 (MEM-08): the new optional filter is purely additive.
      // Omitting it preserves Phase 1 behavior (include all rows).
      const entries = getAuditLog({
        vault,
        notePath: p.note_path,
        op: p.op,
        since: p.since,
        limit: p.limit,
        ...(p.is_memory_sink_write !== undefined
          ? { is_memory_sink_write: p.is_memory_sink_write }
          : {}),
      });
      return { entries, count: entries.length };
    },
    list_models: async (a) => {
      const p = a as { vault: string };
      const vault = manager.require(p.vault);
      const models = listModels(vault);
      return { models, count: models.length };
    },
    start_shadow_index: async (a) => {
      const p = a as { vault: string; model: string; batch_size?: number };
      const vault = manager.require(p.vault);
      return startShadowIndex({
        vault,
        model: p.model,
        ollama,
        batchSize: p.batch_size,
        log: (m) => process.stderr.write(`[shadow:${vault.config.name}] ${m}\n`),
      });
    },
    switch_active_model: async (a) => {
      const p = a as { vault: string; model_name: string };
      const vault = manager.require(p.vault);
      return switchActiveModel(vault, p.model_name);
    },
    vacuum_embeddings: async (a) => {
      const p = a as { vault: string };
      const vault = manager.require(p.vault);
      return vacuumEmbeddings(vault);
    },
    index_runs: async (a) => {
      const p = a as { vault: string; limit: number };
      const vault = manager.require(p.vault);
      const runs = getIndexRuns({ vault, limit: p.limit });
      return { runs, count: runs.length };
    },
  };
}
