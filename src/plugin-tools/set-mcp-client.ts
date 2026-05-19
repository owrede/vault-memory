/**
 * set_mcp_client — Phase 7 / Plan 07-04 / PLG-05, ADR-007 §D-CHROME-CONNECTORS.
 *
 * CRUD for `[contracts.mcp_clients.<name>]` blocks in
 * `~/.vault-memory/config.toml`. Discriminated-union input:
 *
 *   Variant A (add/update): {name, command, args?, env_secrets?}
 *     - mutates [contracts.mcp_clients.<name>]; idempotent
 *     - returns {ok: true, name, action: "added" | "updated"}
 *
 *   Variant B (remove): {name, remove: true}
 *     - deletes the entry; idempotent (no-op if absent)
 *     - returns {ok: true, name, action: "removed"}
 *
 *   Variant C (list): {list: true}
 *     - reads inventory; returns key-list of env_secrets (no values)
 *     - returns {ok: true, clients: Array<{name, command, args, env_secrets, status?}>}
 *
 * In the list response, `env_secrets` is a key-list ONLY (no values, no
 * ciphertext) — values stay in plugin storage; the server only knows the key
 * names that will be substituted at connect time.
 *
 * # Adapter-seam discipline
 *
 * Imports `zod`, `smol-toml`, and node:fs/promises. The config-file mutator
 * is the ONLY plugin-tool that writes to `~/.vault-memory/config.toml`;
 * justified by D-CHROME-CONNECTORS (the connector list is the user-visible
 * source of truth, hot-swap would orphan running peer-MCP clients).
 */

import { z } from "zod";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { readFile, writeFile } from "node:fs/promises";

const SetMcpClientArgs = z.union([
  // Variant A — add/update
  z.object({
    name: z
      .string()
      .min(1)
      .describe("Peer-MCP client name (used as TOML table key)."),
    command: z
      .string()
      .min(1)
      .describe("Executable path. Same trust scope as ~/.vault-memory/config.toml."),
    args: z.array(z.string()).optional().describe("Argv tail for child_process.spawn."),
    env_secrets: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Map of ENV_NAME → secret-key-name. Values are looked up via " +
          "resolve_secret at connect time; this map carries key names only.",
      ),
  }),
  // Variant B — remove
  z.object({
    name: z.string().min(1).describe("Client name to remove."),
    remove: z.literal(true).describe("Set to true to delete the entry."),
  }),
  // Variant C — list (inventory)
  z.object({
    list: z.literal(true).describe("Set to true to read [contracts.mcp_clients] inventory."),
  }),
]);

export type SetMcpClientInput = z.infer<typeof SetMcpClientArgs>;

export interface SetMcpClientDeps {
  /** Path to config.toml. Defaults to `~/.vault-memory/config.toml`. */
  configPath: string;
}

export interface McpClientInventoryEntry {
  name: string;
  command: string;
  args: string[];
  env_secrets: string[];
  status?: "connected" | "disconnected" | "untested";
}

export type SetMcpClientResult =
  | { ok: true; name: string; action: "added" | "updated" | "removed" }
  | { ok: true; clients: McpClientInventoryEntry[] };

type TomlRoot = Record<string, unknown> & {
  contracts?: { mcp_clients?: Record<string, McpClientTomlEntry> } & Record<
    string,
    unknown
  >;
};

interface McpClientTomlEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  env_secrets?: Record<string, string>;
}

async function readConfig(configPath: string): Promise<TomlRoot> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return parseToml(raw) as TomlRoot;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw err;
  }
}

async function writeConfig(configPath: string, root: TomlRoot): Promise<void> {
  // smol-toml stringify is total over JSON-serializable values; the round-trip
  // here is parse → mutate → stringify, which preserves field types (TOML
  // strings stay strings, booleans stay booleans, integers stay integers).
  // Comments and blank lines are NOT preserved — this is documented in the
  // ADR-007 threat model under "TOML round-trip side effects".
  await writeFile(configPath, stringifyToml(root), "utf-8");
}

async function handler(
  args: SetMcpClientInput,
  deps: SetMcpClientDeps,
): Promise<SetMcpClientResult> {
  // Variant C — list
  if ("list" in args) {
    const root = await readConfig(deps.configPath);
    const map = root.contracts?.mcp_clients ?? {};
    const clients: McpClientInventoryEntry[] = Object.entries(map).map(
      ([name, entry]) => ({
        name,
        command: entry.command ?? "",
        args: entry.args ?? [],
        // SECURITY: emit key-list only — values stay in plugin storage.
        env_secrets: Object.keys(entry.env_secrets ?? {}),
      }),
    );
    return { ok: true, clients };
  }

  const root = await readConfig(deps.configPath);
  if (root.contracts === undefined) root.contracts = {};
  // We control the shape; cast to a mutable record for the local mutation.
  const contracts = root.contracts as { mcp_clients?: Record<string, McpClientTomlEntry> };
  if (contracts.mcp_clients === undefined) contracts.mcp_clients = {};
  const clients = contracts.mcp_clients;

  // Variant B — remove
  if ("remove" in args) {
    if (args.name in clients) {
      delete clients[args.name];
      await writeConfig(deps.configPath, root);
    } else {
      // Idempotent — nothing to write, but still report success.
    }
    return { ok: true, name: args.name, action: "removed" };
  }

  // Variant A — add/update
  const existing = clients[args.name];
  const entry: McpClientTomlEntry = {
    command: args.command,
  };
  if (args.args !== undefined) entry.args = args.args;
  if (args.env_secrets !== undefined) entry.env_secrets = args.env_secrets;
  clients[args.name] = entry;
  await writeConfig(deps.configPath, root);
  return {
    ok: true,
    name: args.name,
    action: existing === undefined ? "added" : "updated",
  };
}

export const setMcpClientTool = {
  name: "set_mcp_client" as const,
  description:
    "Manage [contracts.mcp_clients] in ~/.vault-memory/config.toml. " +
    "Variant A: add/update (name + command [+ args, env_secrets]). " +
    "Variant B: remove (name + remove:true). " +
    "Variant C: list (list:true — inventory, env_secrets is key-list only). " +
    "ADR-007 §D-CHROME-CONNECTORS.",
  inputSchema: SetMcpClientArgs,
  handler,
};
