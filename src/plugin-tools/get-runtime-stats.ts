/**
 * get_runtime_stats — Phase 7 / Plan 07-04 / PLG-04, ADR-007 §D-CHROME-STATS.
 *
 * Read-only per-vault stats aggregation for the chrome stats panel.
 *
 * Input:  {vault?: string}
 * Output: {
 *   vault, notes, chunks, last_index_at, embedding_model, embedding_dim,
 *   audit_log_by_kind: Record<op, count>,
 *   peer_mcp_status: Array<{name, available}>,
 *   contract_count
 * }
 *
 * `vault` defaults to the single registered vault when only one exists, or
 * is required when multiple are configured (callers receive
 * {ok: false, reason: "unknown_vault", vault}). Reads via existing query
 * layers — no new DB statements.
 *
 * # Adapter-seam discipline
 *
 * Imports `zod` only. Deps are threaded via dependency injection so the
 * tool is unit-testable without booting a real VaultManager.
 */

import { z } from "zod";

const GetRuntimeStatsArgs = z.object({
  vault: z
    .string()
    .min(1)
    .optional()
    .describe("Vault name. Defaults to the only registered vault when N=1."),
});

export type GetRuntimeStatsInput = z.infer<typeof GetRuntimeStatsArgs>;

/**
 * Minimal vault facade used by the tool. Real callers pass the live
 * `Vault` struct from `src/vault/manager.ts`; tests pass a fake conforming
 * to this shape.
 */
export interface StatsVault {
  config: { name: string; embedding_model?: string };
  db: {
    notes: { countAll: () => number };
    audit: {
      listRuns: (limit: number) => Array<{
        run_id: string;
        started_at: number;
        finished_at: number | null;
      }>;
      listWrites: (filter: { limit?: number }) => Array<{ op: string }>;
    };
    models: { getActive: () => { name: string; dim: number } | null };
    handle: {
      prepare: <T>(sql: string) => { get: (...args: unknown[]) => T };
    };
  };
}

export interface GetRuntimeStatsDeps {
  listVaults: () => StatsVault[];
  peerMcpStatus: () => Array<{ name: string; available: boolean }>;
  contractCountFor: (vault: string) => number;
}

export type GetRuntimeStatsResult =
  | {
      vault: string;
      notes: number;
      chunks: number;
      last_index_at: number | null;
      embedding_model: string;
      embedding_dim: number;
      audit_log_by_kind: Record<string, number>;
      peer_mcp_status: Array<{ name: string; available: boolean }>;
      contract_count: number;
    }
  | { ok: false; reason: "unknown_vault"; vault: string }
  | { ok: false; reason: "ambiguous_vault"; available_vaults: string[] };

function resolveVault(
  arg: string | undefined,
  vaults: StatsVault[],
): StatsVault | { reason: "unknown_vault" | "ambiguous_vault"; vault?: string; available_vaults?: string[] } {
  if (arg !== undefined) {
    const v = vaults.find((vt) => vt.config.name === arg);
    if (v === undefined) return { reason: "unknown_vault", vault: arg };
    return v;
  }
  if (vaults.length === 0) return { reason: "unknown_vault", vault: "(none)" };
  if (vaults.length > 1) {
    return {
      reason: "ambiguous_vault",
      available_vaults: vaults.map((v) => v.config.name),
    };
  }
  return vaults[0]!;
}

async function handler(
  args: GetRuntimeStatsInput,
  deps: GetRuntimeStatsDeps,
): Promise<GetRuntimeStatsResult> {
  const vaults = deps.listVaults();
  const resolved = resolveVault(args.vault, vaults);
  if ("reason" in resolved) {
    if (resolved.reason === "unknown_vault") {
      return { ok: false, reason: "unknown_vault", vault: resolved.vault ?? args.vault ?? "" };
    }
    return {
      ok: false,
      reason: "ambiguous_vault",
      available_vaults: resolved.available_vaults ?? [],
    };
  }

  const vault = resolved;
  const notes = vault.db.notes.countAll();
  // No `countAll` on ChunksQueries — execute a raw COUNT via the SQLite handle.
  const chunksRow = vault.db.handle
    .prepare<{ c: number }>("SELECT COUNT(*) AS c FROM chunks")
    .get();
  const chunks = chunksRow?.c ?? 0;

  const runs = vault.db.audit.listRuns(1);
  const lastRun = runs[0];
  const last_index_at = lastRun?.finished_at ?? null;

  const activeModel = vault.db.models.getActive();
  const embedding_model = activeModel?.name ?? vault.config.embedding_model ?? "";
  const embedding_dim = activeModel?.dim ?? 0;

  // Aggregate the most recent write-audit rows by op. The 1000 cap mirrors
  // the audit_log MCP tool's default — bounded to keep this read cheap.
  const writes = vault.db.audit.listWrites({ limit: 1000 });
  const audit_log_by_kind: Record<string, number> = {};
  for (const w of writes) {
    audit_log_by_kind[w.op] = (audit_log_by_kind[w.op] ?? 0) + 1;
  }

  return {
    vault: vault.config.name,
    notes,
    chunks,
    last_index_at,
    embedding_model,
    embedding_dim,
    audit_log_by_kind,
    peer_mcp_status: deps.peerMcpStatus(),
    contract_count: deps.contractCountFor(vault.config.name),
  };
}

export const getRuntimeStatsTool = {
  name: "get_runtime_stats" as const,
  description:
    "Per-vault stats for the chrome stats panel: notes, chunks, last_index_at, " +
    "embedding model+dim, audit_log_by_kind, peer_mcp_status, contract_count. " +
    "Read-only. ADR-007 §D-CHROME-STATS.",
  inputSchema: GetRuntimeStatsArgs,
  handler,
};
