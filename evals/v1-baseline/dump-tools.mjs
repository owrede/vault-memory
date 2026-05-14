#!/usr/bin/env node
/**
 * Snapshot generator for the v1 `tools/list` JSON-RPC surface (FND-10).
 *
 * Imports the literal TOOLS array from src/tool-registry.ts (the single source
 * of truth, also used by src/server.ts) and emits a canonical
 * `{ "tools": [...] }` JSON object to stdout.
 *
 * Usage (via npm script):
 *   npm run eval:snapshot
 * Which expands to:
 *   node evals/v1-baseline/dump-tools.mjs > evals/v1-baseline/tools-list.snapshot.json
 *
 * Re-running this script MUST be byte-deterministic against the pinned
 * tools-list.snapshot.json — drift fails CI (D-11 / RESEARCH Pattern 2).
 */

import { TOOLS } from "../../src/tool-registry.ts";

const payload = { tools: TOOLS };
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
