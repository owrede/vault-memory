/**
 * Non-Claude smoketest driver — ADP-10 CI gate.
 *
 * Drives the vault-memory MCP server (built artifact at `dist/cli.js`)
 * via the real MCP SDK client over stdio, mirroring the role an
 * arbitrary non-Claude MCP client (ChatGPT Custom Connector,
 * MCP Inspector, third-party agent) would play. This proves the
 * server's "any MCP-aware agent" framing mechanically.
 *
 * Asserts at protocol level:
 *   - `tools/list` returns all 23 v1 tools.
 *   - Every tool has a non-empty `description` (defeats SDK#1143
 *     Pitfall 2 regression).
 *   - `tools/call list_vaults` returns a structured envelope, not
 *     `isError: true`.
 *   - `tools/call <bogus>` returns `isError: true` — confirms
 *     server error semantics.
 *
 * On any assertion failure: exitCode = 1 and process.exit(1).
 * On full success: exit 0.
 *
 * Design note (Assumption A6): the plan calls for the @mcp/inspector
 * --cli driver. We chose the SDK Client harness instead because:
 *   (a) exit-code reliability is fully under our control (no
 *       subprocess-of-subprocess relay);
 *   (b) it mirrors the existing scripts/smoketest-v0.9.0.mjs pattern
 *       that is known-good for this server's lifecycle (the
 *       catch-up indexer keeps the event loop alive — well-handled
 *       by the existing force-exit pattern at the bottom of this
 *       file);
 *   (c) the failure-mode assertion (`isError: true` for a bogus
 *       tool name) explicitly tests A6 inline: if the server
 *       silently exits 0 on protocol failure, the assertion catches
 *       it. CI fails accordingly.
 *
 * Usage:
 *   node scripts/smoketest-non-claude.mjs
 *   node scripts/smoketest-non-claude.mjs path/to/dist/cli.js
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = process.argv[2] ?? "dist/cli.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "usage: node scripts/smoketest-non-claude.mjs [path/to/dist/cli.js]",
  );
  process.exit(0);
}

const EXPECTED_V1_TOOLS = [
  "list_vaults",
  "read_note",
  "search_semantic",
  "search_text",
  "search_hybrid",
  "list_backlinks",
  "list_forward_links",
  "find_broken_links",
  "query_frontmatter",
  "write_note",
  "update_frontmatter",
  "delete_note",
  "audit_log",
  "list_models",
  "start_shadow_index",
  "switch_active_model",
  "vacuum_embeddings",
  "index_runs",
  "search",
  "fetch",
  "vault_stats",
  "recent_notes",
  "suggest_frontmatter",
];

// Phase 2 (plans 02-04 / 02-05): three net-new memory tools.
const EXPECTED_V2_MEMORY_TOOLS = ["record_observation", "recall", "supersede"];

const EXPECTED_TOOLS = [...EXPECTED_V1_TOOLS, ...EXPECTED_V2_MEMORY_TOOLS];

// Phase 2 (plan 02-06): two MCP Resources promoted from tools.
const EXPECTED_RESOURCES = [
  "vault-memory://memory/sinks",
  "vault-memory://memory/stats",
];

const transport = new StdioClientTransport({
  command: "node",
  args: [CLI, "serve"],
});

// Client identifies as "non-claude-smoketest" — this is the mechanical
// proof that the server does NOT depend on a Claude-branded client.
// The captured client_info.name flows through to the audit log if any
// write_* tool runs (none in this smoketest, but the seam is exercised
// at connect time).
const client = new Client(
  { name: "non-claude-smoketest", version: "1.0.0" },
  { capabilities: {} },
);

let exitCode = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  exitCode = 1;
};
const pass = (msg) => {
  console.log(`✓ ${msg}`);
};

try {
  await client.connect(transport);
  pass(`connected to ${CLI} (transport: stdio)`);

  // ─── Assertion 1: tools/list returns 23 v1 tools ────────────────────
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  const expectedSorted = [...EXPECTED_TOOLS].sort();
  const missing = expectedSorted.filter((t) => !toolNames.includes(t));
  const extra = toolNames.filter((t) => !expectedSorted.includes(t));

  if (missing.length > 0) fail(`missing tools: ${missing.join(", ")}`);
  if (extra.length > 0) fail(`unexpected tools: ${extra.join(", ")}`);
  if (tools.length !== EXPECTED_TOOLS.length) {
    fail(`tool count: expected ${EXPECTED_TOOLS.length}, got ${tools.length}`);
  } else if (missing.length === 0 && extra.length === 0) {
    pass(
      `tools/list returned all ${EXPECTED_V1_TOOLS.length} v1 tools + ${EXPECTED_V2_MEMORY_TOOLS.length} Phase 2 memory tools`,
    );
  }

  // ─── Assertion 2: every tool has a non-empty description ────────────
  // Defeats SDK#1143 Pitfall 2 regression (description drop when
  // input schema is migrated). Plan 01-05 Task 07's automated parity
  // check ships the same assertion at the eval level; this is the
  // belt-and-suspenders runtime check.
  const emptyDescs = tools.filter(
    (t) => typeof t.description !== "string" || t.description.length === 0,
  );
  if (emptyDescs.length > 0) {
    fail(
      `${emptyDescs.length} tool(s) have empty description: ` +
        emptyDescs.map((t) => t.name).join(", "),
    );
  } else {
    pass(`all ${tools.length} tools have non-empty description`);
  }

  // ─── Assertion 3: tools/call list_vaults succeeds ───────────────────
  // list_vaults is the lowest-side-effect tool (read-only, returns
  // configured vaults). The envelope must be `content: [...]` with no
  // isError flag.
  const listVaultsResp = await client.callTool({
    name: "list_vaults",
    arguments: {},
  });
  if (listVaultsResp.isError === true) {
    fail(`list_vaults returned isError: true — ${JSON.stringify(listVaultsResp).slice(0, 200)}`);
  } else if (!Array.isArray(listVaultsResp.content)) {
    fail(`list_vaults response missing content[] — ${JSON.stringify(listVaultsResp).slice(0, 200)}`);
  } else {
    pass(`tools/call list_vaults returned valid envelope`);
  }

  // ─── Assertion 4: Phase 2 memory tools surface in tools/list ──────
  // Plan 02-08 Task 4 — confirm record_observation / recall / supersede
  // are discoverable from a non-Claude MCP client (agent-agnosticism
  // preserved end-to-end through Phase 2).
  const recordObs = tools.find((t) => t.name === "record_observation");
  if (!recordObs) {
    fail("record_observation tool missing from tools/list");
  } else if (
    typeof recordObs.description !== "string" ||
    recordObs.description.length === 0
  ) {
    fail("record_observation has empty description");
  } else {
    pass(
      `record_observation tool discoverable from non-Claude client (Phase 2 plan 02-04 / MEM-02)`,
    );
  }

  // ─── Assertion 5: Phase 2 MCP Resources are listed + readable ────────
  // Plan 02-08 Task 4 — confirm memory/sinks + memory/stats Resources
  // are listed AND readable. Resources are the MEM-09 surface; Phase 2
  // requires they work for non-Claude clients (AGENT_AGNOSTIC.md).
  try {
    const { resources } = await client.listResources();
    const uris = (resources ?? []).map((r) => r.uri).sort();
    const missingResources = EXPECTED_RESOURCES.filter(
      (u) => !uris.includes(u),
    );
    if (missingResources.length > 0) {
      fail(`missing resources: ${missingResources.join(", ")}`);
    } else {
      pass(
        `resources/list returned the 2 Phase 2 memory Resources (Phase 2 plan 02-06 / MEM-09)`,
      );
    }

    const statsResp = await client.readResource({
      uri: "vault-memory://memory/stats",
    });
    if (!Array.isArray(statsResp.contents) || statsResp.contents.length === 0) {
      fail(
        `resources/read memory/stats missing contents[] — ${JSON.stringify(statsResp).slice(0, 200)}`,
      );
    } else {
      // Parse the stats payload — it MUST be valid JSON with total_docs.
      const firstText = statsResp.contents[0]?.text;
      if (typeof firstText !== "string") {
        fail(`memory/stats resource content is not text`);
      } else {
        const parsed = JSON.parse(firstText);
        if (typeof parsed.total_docs !== "number") {
          fail(
            `memory/stats response missing total_docs — ${firstText.slice(0, 200)}`,
          );
        } else {
          pass(
            `resources/read memory/stats returned valid JSON with total_docs=${parsed.total_docs} (Phase 2 plan 02-06 / MEM-09)`,
          );
        }
      }
    }
  } catch (err) {
    fail(
      `resources/list or resources/read threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ─── Assertion 6: tools/call with a bogus tool name returns isError ──
  // Inline A6 check: if the SDK swallows the unknown-tool error and
  // returns a non-error envelope, this assertion catches it. The MCP
  // SDK Client wraps protocol errors as thrown exceptions (or
  // structured isError envelopes, depending on the implementation);
  // we accept either path.
  let unknownToolErrored = false;
  try {
    const bogus = await client.callTool({
      name: "this_tool_does_not_exist",
      arguments: {},
    });
    if (bogus && bogus.isError === true) {
      unknownToolErrored = true;
    }
  } catch (err) {
    // SDK throws on unknown-tool / protocol error — expected path.
    unknownToolErrored = true;
    void err;
  }
  if (unknownToolErrored) {
    pass(`tools/call with bogus tool name surfaced as error (A6 confirmed)`);
  } else {
    fail(`tools/call with bogus tool name did NOT surface as error — A6 violated`);
  }
} catch (err) {
  fail(`driver threw: ${err instanceof Error ? err.message : String(err)}`);
}

try {
  await client.close();
} catch {
  // ignore — we force-exit anyway
}

if (exitCode === 0) {
  console.log("");
  console.log(
    "✓ Non-Claude smoketest PASSED (Phase 1 baseline + Phase 2 memory surface).",
  );
} else {
  console.error("");
  console.error("✗ Non-Claude smoketest FAILED — see assertions above.");
}

// Force-exit: the server's catch-up indexer + watcher event handlers
// keep timers/child-process streams alive after client.close(). Without
// process.exit() the smoketest hangs at end-of-script. This mirrors the
// pattern in scripts/smoketest-v0.9.0.mjs (lines 103-106).
process.exit(exitCode);
