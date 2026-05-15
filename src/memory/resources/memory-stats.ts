/**
 * `vault-memory://memory/stats` — MCP Resource exposing per-sink document
 * counts and last-write timestamps (Plan 02-06, MEM-09).
 *
 * Resource, not tool. Polled-only. Build cost is a small handful of SQL
 * queries per registered sink — bounded by the number of sinks (tens at
 * most in v2.0.0), so the resource is cheap to re-read.
 *
 * Aggregation strategy:
 *   - `doc_count`     ← `NotesQueries.countByPathPrefix(sink.resolveToRelativePath)`
 *   - `by_type`       ← scan `frontmatter.type` over rows returned by
 *                       `NotesQueries.listByPathPrefix(...)`
 *   - `by_status`     ← scan `frontmatter.status` over the same rows
 *   - `last_write_at` ← `AuditQueries.lastMemoryWriteAtForPathPrefix(...)`
 *                       (uses the v9 partial index)
 *
 * The resource is filesystem-ignorant — it pulls everything from the per-
 * vault SQLite DB via the existing Queries classes. ADR-002 I-2/I-3/I-4
 * remain satisfied (no fs / path / gray-matter imports here).
 */

import type { MemorySinkRegistry } from "../registry.js";
import type { VaultManager } from "../../vault/manager.js";

export interface MemoryStatsResource {
  /** Aggregate document count across all sinks. */
  total_docs: number;
  sinks: MemoryStatsEntry[]; // vault-memory:no-telemetry-ok
}

export interface MemoryStatsEntry { // vault-memory:no-telemetry-ok
  name: string;
  vault: string;
  handle: string;
  doc_count: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  /** Epoch ms of the most recent memory-sink write into this sink, or null. */
  last_write_at: number | null;
}

/**
 * Build the resource payload. Returns an empty resource (`total_docs: 0`,
 * `sinks: []`) when no sinks are registered — the empty case is a valid
 * response, not an error.
 */
export function readMemoryStats(
  registry: MemorySinkRegistry,
  manager: VaultManager,
): MemoryStatsResource {
  const sinks = registry.listMemorySinks();
  let totalDocs = 0;
  const entries: MemoryStatsEntry[] = []; // vault-memory:no-telemetry-ok

  for (const sink of sinks) {
    // Sink may reference a vault that is no longer mounted (e.g. config
    // edited at runtime). Surface zero counts in that case rather than
    // throwing — keeps the resource readable for diagnostic purposes.
    let vault;
    try {
      vault = manager.require(sink.vault);
    } catch {
      entries.push({
        name: sink.name,
        vault: sink.vault,
        handle: sink.handle,
        doc_count: 0,
        by_type: {},
        by_status: {},
        last_write_at: null,
      });
      continue;
    }

    const prefix = sink.resolveToRelativePath;
    const doc_count = vault.db.notes.countByPathPrefix(prefix);
    totalDocs += doc_count;

    const by_type: Record<string, number> = {};
    const by_status: Record<string, number> = {};
    // Bounded scan — see TSDoc on listByPathPrefix; sinks in v2.0.0 hold
    // tens of documents, not thousands.
    for (const row of vault.db.notes.listByPathPrefix(prefix)) {
      const fm = parseFrontmatter(row.frontmatter);
      const type = stringField(fm, "type");
      const status = stringField(fm, "status");
      if (type !== null) by_type[type] = (by_type[type] ?? 0) + 1;
      if (status !== null) by_status[status] = (by_status[status] ?? 0) + 1;
    }

    const last_write_at = vault.db.audit.lastMemoryWriteAtForPathPrefix(prefix);

    entries.push({
      name: sink.name,
      vault: sink.vault,
      handle: sink.handle,
      doc_count,
      by_type,
      by_status,
      last_write_at,
    });
  }

  return {
    total_docs: totalDocs,
    sinks: entries,
  };
}

function parseFrontmatter(raw: string | null): Record<string, unknown> {
  if (raw === null || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // Stored frontmatter that fails to JSON-parse is silently treated as
    // empty for stats purposes. The indexer writes well-formed JSON; a
    // corrupted row should not crash the Resource.
    return {};
  }
}

function stringField(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
