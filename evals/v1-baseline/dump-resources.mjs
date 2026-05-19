#!/usr/bin/env node
/**
 * Snapshot generator for the v2 `resources/list` JSON-RPC surface (REL-08).
 *
 * Imports the literal RESOURCES array from src/resource-registry.ts (the
 * single source of truth, also used by src/server.ts) and emits a canonical
 * `{ "resources": [...] }` JSON object to stdout.
 *
 * Usage (via npm script):
 *   npm run eval:snapshot
 * Which expands to (chained):
 *   node evals/v1-baseline/dump-tools.mjs     > evals/v1-baseline/tools-list.snapshot.json
 *   node evals/v1-baseline/dump-resources.mjs > evals/v1-baseline/resources-list.snapshot.json
 *
 * Re-running this script MUST be byte-deterministic against the pinned
 * resources-list.snapshot.json — drift fails CI (mirrors the dump-tools
 * pattern from Plan 00-10 / FND-10).
 */

import { RESOURCES } from "../../src/resource-registry.ts";

const payload = { resources: RESOURCES };
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
