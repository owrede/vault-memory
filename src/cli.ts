/**
 * vault-memory CLI entrypoint.
 *
 * Subcommands:
 *   serve          Start MCP server on stdio (default)
 *   init           Interactive config wizard (TODO Phase 5)
 *   index [vault]  Build or refresh the index (TODO)
 *   --help         Show usage
 */

export {};

const args = process.argv.slice(2);
const command = args[0] ?? "serve";

switch (command) {
  case "serve":
    await import("./server.js").then((m) => m.serve());
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

function printHelp(): void {
  console.error(`vault-memory — local-first semantic memory MCP server

USAGE:
  vault-memory [COMMAND]

COMMANDS:
  serve          Start MCP server on stdio (default)
  init           Interactive config wizard (Phase 5 — not yet)
  index [vault]  Build or refresh index (TODO)
  help, --help   Show this message

CONFIG:
  ~/.vault-memory/config.toml`);
}
