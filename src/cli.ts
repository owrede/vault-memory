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

  const targets = vaultName
    ? [manager.require(vaultName)]
    : manager.list();

  for (const vault of targets) {
    const model =
      vault.config.embedding_model ??
      config.server.default_embedding_model ??
      "qwen3-embedding";

    console.error(`\n→ Indexing "${vault.config.name}" (${mode}) with ${model}`);
    const result = await indexVault(vault, {
      mode,
      embeddingModel: model,
      ollama,
      onProgress: (msg) => console.error(`  ${msg}`),
    });

    if (result.status === "completed") {
      const skipSuffix =
        result.notesSkipped > 0 ? `, ${result.notesSkipped} skipped` : "";
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

function printHelp(): void {
  console.error(`vault-memory — local-first semantic memory MCP server

USAGE:
  vault-memory [COMMAND] [OPTIONS]

COMMANDS:
  serve                  Start MCP server on stdio (default)
  index [VAULT]          Build/refresh index for a vault (or all if omitted)
    --full                 Wipe derived layer and re-embed everything
    --vault NAME           Alternative flag form
  init                   Interactive config wizard (Phase 5 — not yet)
  help, --help           Show this message

CONFIG:
  ~/.vault-memory/config.toml`);
}
