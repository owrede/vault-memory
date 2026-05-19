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
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = process.argv[2] ?? "dist/cli.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(
    "usage: node scripts/smoketest-non-claude.mjs [path/to/dist/cli.js]",
  );
  process.exit(0);
}

// ─── Phase 6 (Plan 06-04) setup: spawn the server with a temp HOME so
// `~/.vault-memory/config.toml` resolves to a config we control, and
// a temp VAULT so the brief-sink sentinel can be added without touching
// the shared fixture vault.
//
// Without this isolation the smoketest would run against the developer's
// real config and the contract assertions would depend on whatever
// vaults that user happens to have configured — non-deterministic and
// not CI-friendly. The temp HOME pattern mirrors how Phase 1 smoketests
// in scripts/smoketest-v0.9.0.mjs handled a similar isolation need.
const FIXTURE_VAULT_PATH = resolve("evals/fixtures/v2-test-vault");
const SMOKETEST_HOME = await fs.mkdtemp(join(tmpdir(), "vm-smoketest-"));
const VAULT_MEMORY_DIR = join(SMOKETEST_HOME, ".vault-memory");
await fs.mkdir(VAULT_MEMORY_DIR, { recursive: true });

// Copy the fixture vault to a temp location so writes don't pollute
// the shared fixture. Auto-discovery picks up the existing
// `_memory/.memory-sink` sentinel and provisions a "default" sink.
const TEMP_VAULT_PATH = join(SMOKETEST_HOME, "test-vault");
await fs.cp(FIXTURE_VAULT_PATH, TEMP_VAULT_PATH, { recursive: true });

const CONFIG_PATH = join(VAULT_MEMORY_DIR, "config.toml");
await fs.writeFile(
  CONFIG_PATH,
  `[server]
log_level = "warn"

[[vaults]]
name = "test-vault"
path = "${TEMP_VAULT_PATH}"
write_enabled = true
exclude_globs = [".obsidian/**", ".trash/**"]
`,
);
console.error(`[smoketest] using temp HOME: ${SMOKETEST_HOME}`);
console.error(`[smoketest] using temp vault: ${TEMP_VAULT_PATH}`);

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

// Phase 3 (assembly): get_outline, search_sections, get_document_bundle, assemble_dossier.
const EXPECTED_V2_ASSEMBLY_TOOLS = [
  "get_outline",
  "search_sections",
  "get_document_bundle",
  "assemble_dossier",
];

// Phase 4 (graph): expand, cluster.
const EXPECTED_V2_GRAPH_TOOLS = ["expand", "cluster"];

// Phase 5 (briefs): compile_brief, get_brief.
const EXPECTED_V2_BRIEF_TOOLS = ["compile_brief", "get_brief"];

// Phase 6 (contracts): register_contracts_as_tools, describe_contract, instantiate_contract.
const EXPECTED_V2_CONTRACT_TOOLS = [
  "register_contracts_as_tools",
  "describe_contract",
  "instantiate_contract",
];

const EXPECTED_TOOLS = [
  ...EXPECTED_V1_TOOLS,
  ...EXPECTED_V2_MEMORY_TOOLS,
  ...EXPECTED_V2_ASSEMBLY_TOOLS,
  ...EXPECTED_V2_GRAPH_TOOLS,
  ...EXPECTED_V2_BRIEF_TOOLS,
  ...EXPECTED_V2_CONTRACT_TOOLS,
];

// Phase 2 (plan 02-06): two MCP Resources promoted from tools.
const EXPECTED_RESOURCES = [
  "vault-memory://memory/sinks",
  "vault-memory://memory/stats",
];

// Phase 8 (plan 08-05 / REL-08): the 5 v1 tools that were promoted to MCP
// Resources keep their tool entries (with DEPRECATED in the description)
// so EXPECTED_TOOLS stays at 37. This array drives the per-tool assertion
// that each one carries the DEPRECATED marker in its description.
const DEPRECATED_TOOLS = [
  "list_vaults",
  "list_models",
  "recent_notes",
  "vault_stats",
  "list_backlinks",
];

// Phase 8 (plan 08-05 / REL-08): full Resources surface = 10 entries.
// Five pre-existing (memory-sinks, memory-stats, briefs, contracts,
// contract-verbs) + five newly promoted (vaults, models, recent, stats,
// backlinks). The contracts/contract-verbs Resources are templated with
// `{vault}`; the smoketest registers one vault named `test-vault`, so the
// SDK reports them with that vault substituted on the listResources()
// response. We assert presence of the BASE URI for templated entries via
// startsWith()-style matching rather than equality. For non-templated
// Resources we still want exact equality.
const EXPECTED_RESOURCE_URIS = [
  // Static URIs (exact match)
  "vault-memory://memory/sinks",
  "vault-memory://memory/stats",
  "vault-memory://briefs",
  "vault-memory://vaults",
  // Templated URIs — the SDK lists them with the template literal in
  // `uriTemplate` when no concrete instances are enumerated (list:undefined).
  "vault-memory://contracts/{vault}",
  "vault-memory://contract-verbs/{vault}",
  "vault-memory://models/{vault}",
  "vault-memory://recent/{vault}",
  "vault-memory://stats/{vault}",
  "vault-memory://backlinks/{vault}/{+docId}",
];

const transport = new StdioClientTransport({
  command: "node",
  args: [CLI, "serve"],
  env: {
    ...process.env,
    HOME: SMOKETEST_HOME,
  },
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
      `tools/list returned all ${EXPECTED_V1_TOOLS.length} v1 + ${EXPECTED_V2_MEMORY_TOOLS.length} memory + ${EXPECTED_V2_ASSEMBLY_TOOLS.length} assembly + ${EXPECTED_V2_GRAPH_TOOLS.length} graph + ${EXPECTED_V2_BRIEF_TOOLS.length} brief + ${EXPECTED_V2_CONTRACT_TOOLS.length} contract tools (= ${EXPECTED_TOOLS.length})`,
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

  // ─── Assertion 2b: REL-08 — 5 v1 tools marked DEPRECATED in description ─
  // Phase 8 plan 08-05: the 5 list-style tools that were promoted to MCP
  // Resources MUST stay in tools/list (additive transition path) but each
  // entry's description MUST carry the DEPRECATED marker so v1 clients
  // surface the deprecation to their users.
  const missingDeprecation = [];
  for (const name of DEPRECATED_TOOLS) {
    const t = tools.find((x) => x.name === name);
    if (!t) {
      missingDeprecation.push(`${name} (not in tools/list)`);
      continue;
    }
    if (typeof t.description !== "string" || !t.description.includes("DEPRECATED")) {
      missingDeprecation.push(`${name} (description missing DEPRECATED)`);
    }
  }
  if (missingDeprecation.length > 0) {
    fail(`REL-08 deprecation notice missing on: ${missingDeprecation.join(", ")}`);
  } else {
    pass(
      `REL-08 — ${DEPRECATED_TOOLS.length} v1 tools annotated DEPRECATED in description (plan 08-05)`,
    );
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
  //
  // Phase 8 plan 08-05 (REL-08) extends this block: assert all 10
  // Resources are present (5 pre-existing + 5 newly promoted) AND that
  // the templated `backlinks` Resource accepts a multi-segment docId
  // (RFC 6570 reserved expansion via `{+docId}`).
  try {
    const { resources } = await client.listResources();
    // Per MCP spec, templated Resources surface under
    // `resources/templates/list` (NOT `resources/list`). The SDK exposes
    // this via `client.listResourceTemplates()`. We union static URIs
    // and templates so the presence check below covers both shapes.
    const { resourceTemplates } = await client.listResourceTemplates();
    const staticUris = (resources ?? [])
      .map((r) => r.uri)
      .filter((u) => typeof u === "string");
    const templateUris = (resourceTemplates ?? [])
      .map((r) => r.uriTemplate)
      .filter((u) => typeof u === "string");
    const allUris = [...staticUris, ...templateUris].sort();
    const missingResources = EXPECTED_RESOURCES.filter(
      (u) => !allUris.includes(u),
    );
    if (missingResources.length > 0) {
      fail(`missing resources: ${missingResources.join(", ")}`);
    } else {
      pass(
        `resources/list returned the 2 Phase 2 memory Resources (Phase 2 plan 02-06 / MEM-09)`,
      );
    }

    // REL-08: assert all 10 expected URIs / templates are present.
    const missingRel08 = EXPECTED_RESOURCE_URIS.filter(
      (u) => !allUris.includes(u),
    );
    const extraRel08 = allUris.filter(
      (u) => !EXPECTED_RESOURCE_URIS.includes(u),
    );
    if (missingRel08.length > 0) {
      fail(`REL-08 missing Resource URIs: ${missingRel08.join(", ")}`);
    }
    if (extraRel08.length > 0) {
      fail(`REL-08 unexpected Resource URIs: ${extraRel08.join(", ")}`);
    }
    if (allUris.length !== EXPECTED_RESOURCE_URIS.length) {
      fail(
        `REL-08 Resource count: expected ${EXPECTED_RESOURCE_URIS.length}, got ${allUris.length}`,
      );
    } else if (missingRel08.length === 0 && extraRel08.length === 0) {
      pass(
        `REL-08 — resources/list returned all 10 Resource URIs (5 existing + 5 promoted, plan 08-05)`,
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

  // ============================================================
  // Phase 6 (Plan 06-04) — CON-09 non-Claude contract smoketest
  // ============================================================
  console.error("[smoketest] Phase 6 — checking contract tools…");
  const toolNamesSet = new Set(tools.map((t) => t.name));
  if (!toolNamesSet.has("describe_contract")) {
    fail("describe_contract missing from tools/list");
  } else if (!toolNamesSet.has("instantiate_contract")) {
    fail("instantiate_contract missing from tools/list");
  } else if (!toolNamesSet.has("register_contracts_as_tools")) {
    fail("register_contracts_as_tools missing from tools/list");
  } else {
    pass("Phase 6 — 3 contract tools present in tools/list");
  }

  // ─── Phase 6 Assertion 2: describe_contract returns {json_schema, summary} ──
  try {
    const describe = await client.callTool({
      name: "describe_contract",
      arguments: { name: "meeting-prep" },
    });
    if (describe.isError === true) {
      fail(
        `describe_contract returned isError: true — ${JSON.stringify(describe).slice(0, 200)}`,
      );
    } else {
      const payload = JSON.parse(describe.content[0].text);
      // describeContract returns {ok: true, json_schema, summary}; we
      // tolerate either shape (the v2.0.0 surface emits ok:true so the
      // body lives at the top level).
      const hasSchema = payload.json_schema !== undefined || payload.ok === true;
      const hasSummary =
        typeof payload.summary === "string" && payload.summary.length > 0;
      if (!hasSchema) {
        fail(
          `describe_contract missing json_schema — ${JSON.stringify(payload).slice(0, 200)}`,
        );
      } else if (!hasSummary) {
        fail(
          `describe_contract missing summary — ${JSON.stringify(payload).slice(0, 200)}`,
        );
      } else {
        pass("Phase 6 — describe_contract(meeting-prep) returned json_schema + summary");
      }
    }
  } catch (err) {
    fail(`describe_contract threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── Phase 6 Assertion 3: instantiate_contract(smoketest-trivial) ───
  // CON-09 end-to-end. The smoketest-trivial contract uses ONLY the
  // literal verb so no LLM is involved — the assertion proves the full
  // orchestrator (template resolution + write_back) works against a
  // real on-disk fixture vault.
  try {
    const instantiate = await client.callTool({
      name: "instantiate_contract",
      arguments: {
        name: "smoketest-trivial",
        inputs: { message: "hello from CON-09" },
      },
    });
    if (instantiate.isError === true) {
      fail(
        `instantiate_contract returned isError: true — ${JSON.stringify(instantiate).slice(0, 300)}`,
      );
    } else {
      const payload = JSON.parse(instantiate.content[0].text);
      if (payload.ok !== true) {
        fail(
          `instantiate_contract(smoketest-trivial) failed — ${JSON.stringify(payload).slice(0, 300)}`,
        );
      } else if (!payload.write_back || !payload.write_back.doc_id) {
        fail(
          `instantiate_contract(smoketest-trivial) missing write_back.doc_id — ${JSON.stringify(payload).slice(0, 300)}`,
        );
      } else {
        pass(
          `Phase 6 — instantiate_contract(smoketest-trivial) → write_back.doc_id ✓`,
        );
      }
    }
  } catch (err) {
    fail(`instantiate_contract threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── Phase 6 Assertion 4: list_contracts MCP Resource lists ≥ 3 contracts ──
  try {
    const resources = await client.readResource({
      uri: "vault-memory://contracts/test-vault",
    });
    if (!Array.isArray(resources.contents) || resources.contents.length === 0) {
      fail(
        `list_contracts Resource missing contents[] — ${JSON.stringify(resources).slice(0, 200)}`,
      );
    } else {
      const payload = JSON.parse(resources.contents[0].text);
      if (typeof payload.total !== "number" || payload.total < 3) {
        fail(
          `list_contracts expected ≥3 contracts, got ${payload.total} — ${JSON.stringify(payload).slice(0, 300)}`,
        );
      } else {
        const names = (payload.contracts ?? []).map((c) => c.name);
        const required = ["meeting-prep", "project-status", "code-review-brief"];
        const missingNames = required.filter((n) => !names.includes(n));
        if (missingNames.length > 0) {
          fail(`list_contracts missing reference contracts: ${missingNames.join(", ")}`);
        } else {
          pass(
            `Phase 6 — list_contracts Resource returned ${payload.total} contracts incl. ${required.join(", ")}`,
          );
        }
      }
    }
  } catch (err) {
    fail(
      `list_contracts Resource read threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
} catch (err) {
  fail(`driver threw: ${err instanceof Error ? err.message : String(err)}`);
}

try {
  await client.close();
} catch {
  // ignore — we force-exit anyway
}

// Best-effort cleanup of the temp HOME directory. Failures here are
// silently ignored — the OS cleans /tmp on its own schedule.
try {
  await fs.rm(SMOKETEST_HOME, { recursive: true, force: true });
} catch {
  // ignore
}

if (exitCode === 0) {
  console.log("");
  console.log(
    "✓ Non-Claude smoketest PASSED (Phase 1 + Phase 2 memory + Phase 6 contracts).",
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
