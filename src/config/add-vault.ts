/**
 * Atomically add a new vault to vault-memory:
 *   1. Validate the path is a directory and not already registered.
 *   2. Append a [[vaults]] block to ~/.vault-memory/config.toml.
 *   3. Write/merge .mcp.json in the vault root so Claude Code can spawn
 *      the MCP server when the user opens the vault.
 *
 * This is the source of truth for "onboard a new vault" — invoked by both
 * the CLI `add-vault` subcommand and the `/add-vault` Claude Code skill.
 *
 * Idempotent: re-running with the same path is a no-op for config.toml
 * and a merge for .mcp.json (vault-memory entry under mcpServers gets
 * its env updated if the active-vault flag changed, other servers stay
 * untouched).
 */

import { promises as fs } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig, configPath } from "./loader.js";

export interface AddVaultOptions {
  /** Absolute path to the Obsidian vault root. */
  path: string;
  /** Optional explicit name. Defaults to slugified basename(path). */
  name?: string;
  /** Whether the MCP server may write to this vault. Default false (safer). */
  writeEnabled?: boolean;
  /** Custom exclude_globs. Default = sensible Obsidian-system folders. */
  excludeGlobs?: string[];
  /** Custom config.toml path (testing). */
  configFile?: string;
  /** Custom binary command for .mcp.json (default "vault-memory"). */
  binary?: string;
}

export type AddVaultStep =
  | { kind: "config-added"; name: string; path: string }
  | { kind: "config-already-registered"; name: string; existingPath: string }
  | { kind: "mcp-json-created"; mcpPath: string }
  | { kind: "mcp-json-merged"; mcpPath: string }
  | { kind: "mcp-json-unchanged"; mcpPath: string };

export interface AddVaultResult {
  /** Resolved vault name as it appears in config.toml. */
  name: string;
  /** Absolute, normalised vault path. */
  resolvedPath: string;
  /** Where in config.toml the vault is registered. */
  configFile: string;
  /** Where the .mcp.json was written. */
  mcpJsonPath: string;
  /** Per-step transcript so callers can render a status report. */
  steps: AddVaultStep[];
}

const DEFAULT_EXCLUDE_GLOBS = [
  ".obsidian/**",
  ".trash/**",
  "Trash/**",
  ".claude/**",
  ".smart-connections/**",
  ".smart-env/**",
  ".systemsculpt/**",
  ".makemd/**",
];

/**
 * Slugify a vault basename for use as a vault `name`:
 *   - lowercase
 *   - non-alnum (except dash) → dash
 *   - collapse repeats, trim leading/trailing dashes
 *
 * Names must satisfy: ^[a-z0-9][a-z0-9-]*$ (becomes the SQLite DB filename).
 */
export function slugifyVaultName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned.length === 0) return "vault";
  if (/^[0-9]/.test(cleaned)) return `v-${cleaned}`;
  return cleaned;
}

export async function addVault(opts: AddVaultOptions): Promise<AddVaultResult> {
  const resolvedPath = resolve(opts.path);
  const cfgFile = opts.configFile ?? configPath();
  const binary = opts.binary ?? "vault-memory";
  const steps: AddVaultStep[] = [];

  // 1. Validate the vault path exists and is a directory.
  const stat = await fs.stat(resolvedPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Vault path does not exist: ${resolvedPath}`);
    }
    throw err;
  });
  if (!stat.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${resolvedPath}`);
  }

  // 2. Determine the canonical name.
  const proposedName = opts.name ?? slugifyVaultName(basename(resolvedPath));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(proposedName)) {
    throw new Error(
      `Vault name "${proposedName}" must match /^[a-z0-9][a-z0-9-]*$/ ` +
        `(lowercase alphanumeric + dashes, starting with a letter or digit).`,
    );
  }

  // 3. Read existing config to check for duplicates.
  const existing = await loadConfig(cfgFile);
  const sameName = existing.vaults.find((v) => v.name === proposedName);
  const samePath = existing.vaults.find((v) => resolve(v.path) === resolvedPath);

  if (samePath) {
    steps.push({
      kind: "config-already-registered",
      name: samePath.name,
      existingPath: samePath.path,
    });
  } else if (sameName) {
    throw new Error(
      `A different vault is already registered under name "${proposedName}" ` +
        `(path: ${sameName.path}). Pass --name <other> to choose a different one.`,
    );
  } else {
    // Append a new [[vaults]] block. We do not re-stringify the whole
    // config — that would discard user comments. Append-only is safer.
    const block = renderVaultBlock({
      name: proposedName,
      path: resolvedPath,
      writeEnabled: opts.writeEnabled ?? false,
      excludeGlobs: opts.excludeGlobs ?? DEFAULT_EXCLUDE_GLOBS,
    });
    await ensureFileExists(cfgFile);
    await appendToFile(cfgFile, block);
    steps.push({ kind: "config-added", name: proposedName, path: resolvedPath });
  }

  const finalName = samePath?.name ?? proposedName;

  // 4. Write/merge .mcp.json in the vault.
  const mcpPath = join(resolvedPath, ".mcp.json");
  const step = await writeOrMergeMcpJson(mcpPath, finalName, binary);
  steps.push(step);

  return {
    name: finalName,
    resolvedPath,
    configFile: cfgFile,
    mcpJsonPath: mcpPath,
    steps,
  };
}

interface VaultBlockInput {
  name: string;
  path: string;
  writeEnabled: boolean;
  excludeGlobs: string[];
}

function renderVaultBlock(input: VaultBlockInput): string {
  // Hand-rolled TOML so we control formatting + comments.
  const lines: string[] = [
    "",
    `# Added by vault-memory add-vault on ${new Date().toISOString()}`,
    "[[vaults]]",
    `name = ${JSON.stringify(input.name)}`,
    `path = ${JSON.stringify(input.path)}`,
    `write_enabled = ${input.writeEnabled}`,
    `exclude_globs = [`,
    ...input.excludeGlobs.map((g) => `  ${JSON.stringify(g)},`),
    `]`,
    "",
  ];
  return lines.join("\n");
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await fs.access(path);
  } catch {
    await fs.mkdir(join(homedir(), ".vault-memory"), { recursive: true });
    await fs.writeFile(path, "# vault-memory configuration\n", "utf-8");
  }
}

async function appendToFile(path: string, content: string): Promise<void> {
  await fs.appendFile(path, content, "utf-8");
}

interface McpServerEntry {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}
interface McpJsonShape {
  mcpServers?: Record<string, McpServerEntry>;
}

async function writeOrMergeMcpJson(
  mcpPath: string,
  vaultName: string,
  binary: string,
): Promise<AddVaultStep> {
  const desiredEntry: McpServerEntry = {
    type: "stdio",
    command: binary,
    args: ["serve"],
    env: { VAULT_MEMORY_ACTIVE_VAULT: vaultName },
  };

  let existing: McpJsonShape | null = null;
  try {
    const raw = await fs.readFile(mcpPath, "utf-8");
    existing = JSON.parse(raw) as McpJsonShape;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new Error(`Failed to read existing .mcp.json at ${mcpPath}: ${(err as Error).message}`);
    }
  }

  if (existing === null) {
    const fresh: McpJsonShape = { mcpServers: { "vault-memory": desiredEntry } };
    await fs.writeFile(mcpPath, JSON.stringify(fresh, null, 2) + "\n", "utf-8");
    return { kind: "mcp-json-created", mcpPath };
  }

  // Merge: keep other servers untouched, replace/insert vault-memory.
  const before = existing.mcpServers?.["vault-memory"];
  const beforeJson = before ? JSON.stringify(before) : null;
  const merged: McpJsonShape = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      "vault-memory": desiredEntry,
    },
  };
  const afterJson = JSON.stringify(merged.mcpServers?.["vault-memory"]);
  if (beforeJson === afterJson) {
    return { kind: "mcp-json-unchanged", mcpPath };
  }
  await fs.writeFile(mcpPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return { kind: "mcp-json-merged", mcpPath };
}
