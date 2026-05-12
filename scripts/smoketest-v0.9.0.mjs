/**
 * v0.9.0 stdio smoketest driver.
 *
 * Drives the real MCP SDK client against `vault-memory serve` over stdio,
 * asserts the four new tools are registered, and exercises vault_stats +
 * recent_notes through tools/call. Exits 0 on success, 1 on any
 * assertion failure.
 *
 * The server's background catch-up loop keeps event loop work alive after
 * client.close(), so we force-exit at the end rather than let Node hang
 * on lingering timers/streams.
 *
 * Usage: node scripts/smoketest-v0.9.0.mjs <path-to-dist/cli.js>
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = process.argv[2];
if (!CLI) {
  console.error("usage: node smoketest-v0.9.0.mjs <dist/cli.js>");
  process.exit(2);
}

const EXPECTED = ["search", "fetch", "vault_stats", "recent_notes"];

const transport = new StdioClientTransport({
  command: "node",
  args: [CLI, "serve"],
});

const client = new Client(
  { name: "smoketest-v0.9.0", version: "0.9.0" },
  { capabilities: {} },
);

let exitCode = 0;
try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  const missing = EXPECTED.filter((t) => !names.has(t));
  if (missing.length > 0) {
    console.error(`✗ missing tools: ${missing.join(", ")}`);
    exitCode = 1;
  } else {
    console.log(`✓ tools registered: ${EXPECTED.join(", ")}`);
  }

  const stats = await client.callTool({ name: "vault_stats", arguments: {} });
  if (stats.isError) {
    console.error(`✗ vault_stats returned isError: ${JSON.stringify(stats)}`);
    exitCode = 1;
  } else {
    const text = stats.content?.[0]?.text;
    const payload = text ? JSON.parse(text) : null;
    if (
      !payload ||
      !(
        Array.isArray(payload.vaults) ||
        "total_notes" in payload ||
        "vault" in payload
      )
    ) {
      console.error(`✗ vault_stats bad shape: ${text?.slice(0, 200)}`);
      exitCode = 1;
    } else {
      const vaultCount = payload.vaults?.length ?? 1;
      console.log(`✓ vault_stats payload ok (${vaultCount} vault(s))`);
    }
  }

  const recent = await client.callTool({
    name: "recent_notes",
    arguments: { limit: 3 },
  });
  if (recent.isError) {
    console.error(`✗ recent_notes returned isError: ${JSON.stringify(recent)}`);
    exitCode = 1;
  } else {
    const payload = JSON.parse(recent.content[0].text);
    if (!Array.isArray(payload.notes)) {
      console.error(
        `✗ recent_notes bad shape: ${recent.content[0].text.slice(0, 200)}`,
      );
      exitCode = 1;
    } else {
      console.log(`✓ recent_notes payload ok (${payload.notes.length} note(s))`);
    }
  }
} catch (err) {
  console.error(`✗ driver threw: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
}

try {
  await client.close();
} catch {
  // ignore — we force-exit anyway
}

// Force-exit: the server's catch-up/watchers keep timers and child-process
// streams alive, so a natural exit hangs. We've already collected and
// checked the responses we need.
process.exit(exitCode);
