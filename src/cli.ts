/**
 * vault-memory CLI entrypoint.
 */

export {};

const args = process.argv.slice(2);
const command = args[0] ?? "serve";

switch (command) {
  case "serve":
    await import("./server.js").then((m) => m.serve());
    break;

  case "index":
    await runIndex(args.slice(1));
    break;

  case "add-vault":
    await runAddVault(args.slice(1));
    break;

  case "--help":
  case "-h":
  case "help":
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(2);
}

async function runIndex(rest: string[]): Promise<void> {
  const { loadConfig } = await import("./config/index.js");
  const { VaultManager } = await import("./vault/index.js");
  const { OllamaClient } = await import("./ollama/index.js");
  const { indexVault } = await import("./indexer/index.js");

  // Parse flags
  let vaultName: string | null = null;
  let mode: "full" | "incremental" = "incremental";

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--full") mode = "full";
    else if (arg === "--vault") {
      vaultName = rest[i + 1] ?? null;
      i++;
    } else if (arg && !arg.startsWith("--") && vaultName === null) {
      vaultName = arg;
    }
  }

  const config = await loadConfig();
  if (config.vaults.length === 0) {
    console.error("No vaults configured. Edit ~/.vault-memory/config.toml.");
    process.exit(2);
  }

  const manager = new VaultManager();
  await manager.loadAll(config.vaults);

  const ollama = new OllamaClient({
    endpoint: config.server.ollama_endpoint,
  });

  const targets = vaultName ? [manager.require(vaultName)] : manager.list();

  for (const vault of targets) {
    // ADR-008: ContextFit-backed vaults use the CPU-only token-native engine.
    // Two-part index: (1) build the full SQLite content layer WITHOUT embeddings
    // (powers graph/sections/frontmatter/stats tools, the watcher, catchup, and
    // write re-index) and (2) build the ContextFit search KB. No Ollama, no GPU.
    if (vault.config.backend === "contextfit") {
      const { indexVaultWithContextFit } = await import("./adapters/retrieval/contextfit/index.js");
      console.error(
        `\n→ Indexing "${vault.config.name}" with ContextFit (CPU-only, no embeddings)`,
      );
      // (1) SQLite content layer — embeddings:"none" skips Ollama entirely.
      const sqlite = await indexVault(vault, {
        mode,
        embeddingModel: "contextfit",
        embeddings: "none",
        onProgress: (msg) => console.error(`  ${msg}`),
      });
      if (sqlite.status !== "completed") {
        console.error(`✗ ${vault.config.name}: SQLite layer failed — ${sqlite.error}`);
        process.exitCode = 1;
        continue;
      }
      // (2) ContextFit search KB.
      const cfResult = await indexVaultWithContextFit(vault.config, {
        onProgress: (msg) => console.error(`  ${msg}`),
      });
      if (cfResult.status === "completed") {
        console.error(
          `✓ ${vault.config.name}: ${sqlite.notesIndexed} notes (SQLite) + ContextFit KB · ${sqlite.durationMs + cfResult.durationMs}ms`,
        );
      } else {
        console.error(`✗ ${vault.config.name}: ContextFit KB failed — ${cfResult.error}`);
        process.exitCode = 1;
      }
      continue;
    }

    const model =
      vault.config.embedding_model ?? config.server.default_embedding_model ?? "qwen3-embedding";

    console.error(`\n→ Indexing "${vault.config.name}" (${mode}) with ${model}`);
    const result = await indexVault(vault, {
      mode,
      embeddingModel: model,
      ollama,
      onProgress: (msg) => console.error(`  ${msg}`),
    });

    if (result.status === "completed") {
      const skipSuffix = result.notesSkipped > 0 ? `, ${result.notesSkipped} skipped` : "";
      console.error(
        `✓ ${vault.config.name}: ${result.notesIndexed} new, ` +
          `${result.notesUpdated} updated, ${result.notesDeleted} deleted${skipSuffix}, ` +
          `${result.chunksCreated} chunks · ${result.durationMs}ms`,
      );
    } else {
      console.error(`✗ ${vault.config.name}: ${result.error}`);
      process.exitCode = 1;
    }
  }

  manager.closeAll();
}

/**
 * add-vault: onboard a new Obsidian vault end-to-end.
 *   1. append a [[vaults]] block to ~/.vault-memory/config.toml
 *   2. write/merge .mcp.json in the vault root (so an MCP-aware client
 *      can auto-spawn the MCP server when that vault is opened)
 *   3. build an initial index (unless --no-index is passed)
 *
 * Idempotent: re-running with a known path skips config mutation
 * and only refreshes the .mcp.json + delta-indexes.
 */
async function runAddVault(rest: string[]): Promise<void> {
  const { addVault } = await import("./config/index.js");

  // Parse positional path + flags.
  let path: string | null = null;
  let name: string | undefined;
  let writeEnabled = false;
  let skipIndex = false;
  let backend: "ollama" | "contextfit" | undefined;

  const USAGE =
    "Usage: vault-memory add-vault <path> [--name <name>] [--write] " +
    "[--backend ollama|contextfit] [--no-index]";

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--name") {
      name = rest[i + 1];
      i++;
    } else if (arg === "--write" || arg === "--write-enabled") {
      writeEnabled = true;
    } else if (arg === "--backend") {
      const v = rest[i + 1];
      i++;
      if (v !== "ollama" && v !== "contextfit") {
        console.error(`--backend must be "ollama" or "contextfit" (got: ${v ?? "<missing>"})`);
        process.exit(2);
      }
      backend = v;
    } else if (arg === "--no-index") {
      skipIndex = true;
    } else if (arg === "--help" || arg === "-h") {
      console.error(`${USAGE}

Registers a vault in ~/.vault-memory/config.toml, writes a .mcp.json
into the vault root, and runs an initial index. Idempotent.

--backend contextfit  Use the CPU-only, token-native ContextFit engine
                      (no Ollama / embeddings / GPU). Requires the
                      \`contextfit\` CLI (pipx install contextfit). Ideal for
                      resource-limited / non-GPU hosts (e.g. a Synology NAS).`);
      return;
    } else if (arg && !arg.startsWith("--") && path === null) {
      path = arg;
    }
  }

  if (path === null) {
    console.error(USAGE);
    process.exit(2);
  }

  console.error(`→ Registering vault: ${path}${backend ? ` (backend: ${backend})` : ""}`);
  const result = await addVault({ path, name, writeEnabled, ...(backend ? { backend } : {}) });

  // Render the per-step transcript so users see exactly what changed.
  for (const step of result.steps) {
    switch (step.kind) {
      case "config-added":
        console.error(`  ✓ config.toml: added [[vaults]] "${step.name}"`);
        break;
      case "config-already-registered":
        console.error(
          `  • config.toml: already registered as "${step.name}" (${step.existingPath})`,
        );
        break;
      case "mcp-json-created":
        console.error(`  ✓ ${step.mcpPath}: created`);
        break;
      case "mcp-json-merged":
        console.error(`  ✓ ${step.mcpPath}: merged vault-memory entry`);
        break;
      case "mcp-json-unchanged":
        console.error(`  • ${step.mcpPath}: already up to date`);
        break;
    }
  }

  if (skipIndex) {
    console.error(`\nSkipped indexing (--no-index). Run later:`);
    console.error(`  vault-memory index ${result.name}`);
  } else {
    console.error(`\n→ Building initial index for "${result.name}"…`);
    // Reuse the existing index flow. Pass the vault name as positional arg.
    await runIndex([result.name]);
  }

  console.error(
    `\nDone. Open ${result.resolvedPath} in your MCP-aware client — the vault-memory MCP server will be available.`,
  );
}

function printHelp(): void {
  console.error(`vault-memory — local-first semantic memory MCP server

USAGE:
  vault-memory [COMMAND] [OPTIONS]

COMMANDS:
  serve                  Start MCP server on stdio (default)
  index [VAULT]          Build/refresh index for a vault (or all if omitted)
    --full                 Wipe derived layer and re-embed everything
    --vault NAME           Alternative flag form
  add-vault <path>       Register a new vault end-to-end (config + .mcp.json + index)
    --name NAME            Override the auto-slugified name
    --write                Allow MCP write operations (default: read-only)
    --no-index             Skip the initial index (you can run it later)
  init                   Interactive config wizard (Phase 5 — not yet)
  help, --help           Show this message

CONFIG:
  ~/.vault-memory/config.toml`);
}
