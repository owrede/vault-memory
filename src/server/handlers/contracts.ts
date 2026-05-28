/**
 * Contracts-domain MCP handler factory.
 *
 * Tools: register_contracts_as_tools, describe_contract, instantiate_contract.
 *
 * Extracted verbatim from the inline `handlers` literal in `src/server.ts`.
 * Behavior-neutral. Unlike the other domains, these handlers depend on three
 * serve()-local closures (`resolveContractVault`, `instantiateHandler`,
 * `buildInstantiateDeps`) that capture bootstrap state not present on
 * `HandlerDeps`. Those are passed in via the `ContractHelpers` parameter so
 * the closures stay defined in `serve()` and the call shapes are identical.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports.
 */

import {
  describeContract,
  instantiateContract,
  syncAutoRegistered,
} from "../../contracts/index.js";
import type { InstantiateDeps } from "../../contracts/index.js";
import type { Vault } from "../../vault/index.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

/**
 * Result of resolving the target vault for describe/instantiate. Verbatim
 * from `serve()`'s local `resolveContractVault`.
 */
export type ResolveContractVaultResult =
  | { ok: true; vault: Vault }
  | { ok: false; reason: "ambiguous_vault"; available_vaults: string[] }
  | { ok: false; reason: "unknown_vault"; vault: string };

/**
 * The three serve()-local closures the contract handlers depend on. They
 * capture bootstrap state (`manager`, `adapterRegistry`, `peerMcpRegistry`,
 * per-vault deps, baseline-verb thunks) that is not on `HandlerDeps`, so
 * they are injected rather than reconstructed.
 */
export interface ContractHelpers {
  resolveContractVault: (vaultArg: string | undefined) => ResolveContractVaultResult;
  instantiateHandler: (name: string, args: unknown) => Promise<unknown>;
  buildInstantiateDeps: (vault: Vault) => InstantiateDeps;
}

export function makeContractsHandlers(
  deps: HandlerDeps,
  helpers: ContractHelpers,
): Partial<Record<ToolName, Handler>> {
  const { manager, server, config, contractRegistries } = deps;
  const { resolveContractVault, instantiateHandler, buildInstantiateDeps } = helpers;
  return {
    // ── Phase 6 task-contract DSL (Plan 06-02 / D-A1 escape valve) ─────────
    //
    // Scans the per-vault contract registries and forces a sync of the
    // dynamic MCP tool list — regardless of [contracts.auto_register_tools]
    // (which is what makes this the explicit-control escape valve).
    // Returns per-vault diffs so the caller can confirm what landed.
    register_contracts_as_tools: async (a) => {
      const p = a as { vault?: string };
      const targetVaults =
        p.vault !== undefined ? [p.vault] : manager.list().map((v) => v.config.name);
      if (p.vault !== undefined) {
        const v = manager.list().find((vault) => vault.config.name === p.vault);
        if (v === undefined) {
          return { ok: false, reason: "unknown_vault", vault: p.vault };
        }
      }
      const results: {
        vault: string;
        registered: string[];
        unregistered: string[];
      }[] = [];
      const prefix = config.contracts.tool_prefix;
      for (const vname of targetVaults) {
        const state = contractRegistries.get(vname);
        if (state === undefined) continue;
        const v = manager.list().find((vault) => vault.config.name === vname);
        if (v === undefined) continue;
        const before = new Set(state.registered.keys());
        // FORCED enabled:true — explicit-control escape valve (D-A1).
        syncAutoRegistered(server, state.started.registry, prefix, state.registered, {
          enabled: true,
          instantiateHandler,
        });
        const after = new Set(state.registered.keys());
        results.push({
          vault: vname,
          registered: Array.from(after).filter((n) => !before.has(n)),
          unregistered: Array.from(before).filter((n) => !after.has(n)),
        });
      }
      if (p.vault !== undefined) {
        const single = results[0] ?? {
          vault: p.vault,
          registered: [],
          unregistered: [],
        };
        return { ok: true, ...single };
      }
      return { ok: true, vaults: results };
    },

    // ── Phase 6 task-contract DSL (Plan 06-03 / CON-05, Q-DESCRIBE) ────────
    //
    // Pure function over the per-vault ContractRegistry. Returns
    // {ok:true, json_schema, summary} or one of the sealed
    // InstantiateError reasons (`unknown_contract`, `ambiguous_vault`,
    // `unknown_vault`). NO LLM, NO side effects.
    describe_contract: async (a) => {
      const p = a as { name: string; vault?: string };
      const resolved = resolveContractVault(p.vault);
      if (!resolved.ok) return resolved;
      const state = contractRegistries.get(resolved.vault.config.name);
      if (state === undefined) {
        // Defense-in-depth: a vault without a contract registry happens
        // only if `start_contract_registries` skipped it (no change-feed)
        // — surface as unknown_contract for the caller.
        return { ok: false, reason: "unknown_contract", name: p.name };
      }
      return describeContract({ registry: state.started.registry }, { name: p.name });
    },

    // ── Phase 6 task-contract DSL (Plan 06-03 / CON-06) ────────────────────
    //
    // Replaces the Plan 06-02 stub. Routes through the per-vault deps
    // built by `buildInstantiateDeps`. On multi-vault setups, the caller
    // MUST pass `vault` — otherwise we return the WARNING-6
    // `ambiguous_vault` envelope (12th reason in the closed
    // InstantiateError union).
    instantiate_contract: async (a) => {
      const p = a as {
        name: string;
        inputs: Record<string, unknown>;
        source_overrides?: Record<string, string>;
        sink_overrides?: Record<string, string>;
        vault?: string;
      };
      const resolved = resolveContractVault(p.vault);
      if (!resolved.ok) return resolved;
      return instantiateContract(buildInstantiateDeps(resolved.vault), {
        name: p.name,
        inputs: p.inputs,
        ...(p.source_overrides !== undefined ? { source_overrides: p.source_overrides } : {}),
        ...(p.sink_overrides !== undefined ? { sink_overrides: p.sink_overrides } : {}),
      });
    },
  };
}
