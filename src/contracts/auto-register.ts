/**
 * syncAutoRegistered — Phase 6 / D-A1, ADR-006 §Decision 1 (Pattern 4).
 *
 * Diff-based dynamic MCP Tool registration. Maintains a per-loader
 * `registered: Map<toolName, RegisteredTool>` that survives across calls;
 * each invocation:
 *   1. computes the desired set from the registry (`<prefix><name>` per
 *      `slugify`);
 *   2. removes tools no longer desired via `RegisteredTool.remove()`;
 *   3. adds new tools via `server.registerTool(name, config, callback)`;
 *   4. calls `server.sendToolListChanged()` exactly ONCE per mutation
 *      cycle (only when at least one add/remove occurred — idempotent
 *      no-op when the diff is empty).
 *
 * No-op when `opts.enabled === false` (D-A1b default OFF). The
 * `register_contracts_as_tools` MCP Tool (Plan 06-02 Task 3) forces
 * `enabled: true` regardless of the per-vault config — that is the
 * explicit-control escape valve (D-A1).
 *
 * # Callback shim
 *
 * Each auto-registered tool's callback is a thin wrapper around
 * `opts.instantiateHandler(contractName, args)` (Plan 06-03 supplies the
 * real handler). The wrapper serializes the handler's return as a single
 * `text` content block — matching the v1 `ok()` shape used by
 * `src/server.ts`. Tool argument validation happens in the MCP SDK layer
 * BEFORE the wrapper fires, using the `parsed.inputZodSchema` (Pitfall
 * F1 — SDK 1.29 requires a Zod schema, not raw JSON Schema).
 *
 * # Adapter-seam discipline
 *
 * Imports only `@modelcontextprotocol/sdk` types + Plan 06-01 modules.
 * Zero `fs` / `path` / `yaml` / `chokidar`.
 */

import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContractRegistry } from "./registry.js";
import type { ParsedContract } from "./types.js";
import { slugify } from "./slug.js";

export interface SyncAutoRegisteredOpts {
  /** D-A1b — per-vault gate. No-op when false. */
  enabled: boolean;
  /**
   * Plan 06-03 supplies the real handler; Plan 06-02 wires a stub
   * (`not_yet_implemented`) so auto-registration is observable today.
   * Invoked only when a registered `vm_<name>` tool is CALLED — never
   * during registration itself.
   */
  instantiateHandler: (contractName: string, args: unknown) => Promise<unknown>;
}

/**
 * Diff the registry against `registered`; perform adds/removes via the
 * SDK; fire `sendToolListChanged()` exactly once when at least one
 * change occurred.
 *
 * The `registered` map is OWNED by the caller (one per `startContractRegistry`
 * instance) — this function mutates it in place. That keeps each vault's
 * tool surface independently disposable: a server with two vaults has
 * two `registered` maps; removing vault A's tools does not touch B's
 * handles.
 */
export function syncAutoRegistered(
  server: McpServer,
  registry: ContractRegistry,
  prefix: string,
  registered: Map<string, RegisteredTool>,
  opts: SyncAutoRegisteredOpts,
): void {
  if (!opts.enabled) return;

  // Build the desired set: <slug> → ParsedContract.
  const desired = new Map<string, ParsedContract>();
  for (const [name, parsed] of registry.entries()) {
    desired.set(slugify(name, prefix), parsed);
  }

  let mutated = false;

  // Remove gone — snapshot first since we mutate `registered`.
  for (const [toolName, regd] of Array.from(registered)) {
    if (!desired.has(toolName)) {
      regd.remove();
      registered.delete(toolName);
      mutated = true;
    }
  }

  // Add new.
  for (const [toolName, parsed] of desired) {
    if (registered.has(toolName)) continue;
    const contractName = parsed.name;
    const regd = server.registerTool(
      toolName,
      {
        description: parsed.description,
        inputSchema: parsed.inputZodSchema,
      },
      // The callback runs AFTER the SDK validates args against the Zod
      // schema, so `args` is typed-narrowed to the contract's inputs.
      async (args: unknown) => {
        const result = await opts.instantiateHandler(contractName, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    ) as RegisteredTool;
    registered.set(toolName, regd);
    mutated = true;
  }

  if (mutated) server.sendToolListChanged();
}
