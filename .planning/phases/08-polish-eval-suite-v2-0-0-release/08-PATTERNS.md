# Phase 8: Polish, eval suite, v2.0.0 release — Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 19 files to create or modify (5 source edits + 7 docs/sign-off + 2 CI/workflow + 2 snapshot data + 1 release-script + 1 contributing doc + 1 thumbnail asset)
**Analogs found:** 17 / 19 (2 greenfield — `scripts/release.mjs` and `CONTRIBUTING.md` have no in-repo precedent)

> **Critical CONTEXT-vs-RESEARCH correction (carry through):** RESEARCH §"CHANGELOG Audit (actual state)" reverses CONTEXT D-08 — the CHANGELOG `[Unreleased]` block already contains Phase 2 + Phase 3 + Phase 4 + Phase 6 entries. **Only Phase 5 (briefs) and Phase 7 (plugin) are missing.** Planner must not double-write Phase 2/3.
> **REL-08 closed set (RESEARCH §"Tool Surface Today" recommendation):** `list_vaults`, `list_models`, `recent_notes`, `vault_stats`, `list_backlinks` → exactly 5 promotions → 37 − 5 = 32 default tools. CONTEXT D-02's `list_aliases` is a phantom — no such tool exists.

## File Classification

| File (new or modified) | Role | Data Flow | Closest Analog | Match Quality |
|------------------------|------|-----------|----------------|---------------|
| `src/server.ts` (5 new `registerResource` calls) | source-edit (server) | request-response (MCP Resource read) | `src/server.ts:1850-1893` (`contracts` Resource, Phase 6 CON-04) | **exact** — same SDK API, same file, 5 prior examples |
| `src/tool-registry.ts` (5 description-only edits) | source-edit (tool registry) | static data | `src/tool-registry.ts:43-46` (`list_vaults` TOOLS entry) | exact (same array) — first-of-kind deprecation note |
| `scripts/release.mjs` | release-script | one-shot CLI (no MCP) | `scripts/smoketest-non-claude.mjs` (ESM Node script, 345 LOC, stdio + child-process patterns) | role-match (different purpose, same conventions) |
| `evals/v1-baseline/resources-list.snapshot.json` | snapshot-data | pinned JSON | `evals/v1-baseline/tools-list.snapshot.json` (1148 lines, sibling pattern) | exact (sibling) |
| `evals/v1-baseline/dump-resources.mjs` (or extend `dump-tools.mjs`) | snapshot generator | one-shot ESM script | `evals/v1-baseline/dump-tools.mjs` (22 lines, sibling) | exact (sibling) |
| `evals/v1-baseline/baseline.test.ts` (Resources snapshot assertion add) | source-edit (test) | snapshot equality | `evals/v1-baseline/baseline.test.ts:69-79` (existing tools-list snapshot block) | exact |
| `scripts/smoketest-non-claude.mjs` (extend to assert Resources surface) | source-edit (smoketest) | stdio MCP client | itself (`:190-256` assertion blocks) | exact (self-extension) |
| `.github/workflows/publish.yml` (add tarball + sha256 + mp4 attach step) | CI-workflow | release-asset upload | `.github/workflows/publish.yml:94-103` (existing softprops/action-gh-release step) | exact (same file, extend) |
| `CHANGELOG.md` (backfill Phase 5 + Phase 7; rename `[Unreleased]` at release time) | doc-rewrite | structured markdown | `CHANGELOG.md:13-128` (existing `[Unreleased]` block + Phase 2/3/4/6 entries) | exact (in-file precedent) |
| `README.md` (full rewrite — 6 sections per D-11) | doc-rewrite | reader-facing markdown | `README.md:1-100` (v1.0.0 README, "any MCP-aware agent" framing in lines 1-21) | partial — current shape is v1-centric; preserve §1-21 voice |
| `docs/v2/MIGRATION-V1-TO-V2.md` | doc-create | reader-facing markdown | `docs/v2/PHASE-6-SIGN-OFF.md` (v2 docs voice + structure) | role-match — no migration-doc precedent; voice from sibling |
| `docs/v2/PHASE-8-SIGN-OFF.md` | sign-off | structured markdown | `docs/v2/PHASE-6-SIGN-OFF.md` (most recent sign-off, 275 lines) | **exact** — same template family |
| `CONTRIBUTING.md` | doc-create | reader-facing markdown | _(no in-repo analog)_ — fallback: voice from `docs/v2/PHASE-6-SIGN-OFF.md` + format from existing `CHANGELOG.md` footer | greenfield |
| `docs/v2/plugin/screencast-thumbnail.png` | asset | binary | _(no in-repo analog)_ | greenfield (image asset) |
| `package.json` (add `"release": "node scripts/release.mjs"` + bump version) | config | JSON | `package.json:25-38` (existing `"scripts"` block) | exact (in-file additive) |
| `skills/vm-install/setup.sh` (verify literal URL works; no edit if pinned) | source-edit (skill, conditional) | shell script | `skills/vm-install/setup.sh:20-29` (existing `RELEASE_URL_PLACEHOLDER` block) | exact (self-pattern) |
| `skills/vm-update/update.sh` (verify `v__VERSION__` template) | source-edit (skill, conditional) | shell script | `skills/vm-update/update.sh:23` (templated URL) | exact (self-pattern) |
| `docs/v2/plugin/INSTALL.md` (replace deferral note with resolved URL) | doc-edit | reader-facing markdown | (existing deferral text in file) | exact (self-edit) |
| `docs/v2/plugin/CONTRACT-EDITOR.md` (replace deferral note) | doc-edit | reader-facing markdown | (existing deferral text in file) | exact (self-edit) |

---

## Pattern Assignments

### Group A — MCP Resources promotion (5 sites in `src/server.ts`)

The pattern is identical across all 5 promotions. Each follows the **static-URI form** (`list_vaults` only — no vault variable) or the **`ResourceTemplate` form** (the other 4, parameterized on `{vault}`).

**Per RESEARCH §"Tool Surface Today" recommendation** — the closed set is exactly:

| # | Tool → Resource URI | Form |
|---|---------------------|------|
| 1 | `list_vaults` → `vault-memory://vaults` | static (no template — vaults are global) |
| 2 | `list_models` → `vault-memory://models/{vault}` | `ResourceTemplate` |
| 3 | `recent_notes` → `vault-memory://recent/{vault}` | `ResourceTemplate` |
| 4 | `vault_stats` → `vault-memory://stats/{vault}` | `ResourceTemplate` |
| 5 | `list_backlinks` → `vault-memory://backlinks/{vault}/{docId}` | `ResourceTemplate` (two variables; per Phase 5 sign-off explicit recommendation) |

#### A.1 — Static-URI Resource analog (for `list_vaults`)

**Analog:** `src/server.ts:1756-1775` (`memory-sinks` Resource, Phase 2 plan 02-06 / MEM-09).

```typescript
// src/server.ts:1756-1775 — STATIC URI PATTERN (no template variables)
server.registerResource(
  "memory-sinks",
  RESOURCE_URI_LIST_SINKS,                       // === "vault-memory://memory/sinks"
  {
    title: "Memory sinks",
    description:
      "Configured + auto-discovered MemorySinks (name, handle, vault, contract, default). " +
      "Read to discover where memory documents (record_observation, supersede) land.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(readListSinks(memorySinkRegistry), null, 2),
      },
    ],
  }),
);
```

**Companion URI constant pattern** (where to add the new constant — `RESOURCE_URI_VAULTS = "vault-memory://vaults"`):

```typescript
// src/memory/resources/index.ts:18-34 (barrel where ALL existing URI constants live)
/** Canonical resource URIs. */
export const RESOURCE_URI_LIST_SINKS = "vault-memory://memory/sinks";
export const RESOURCE_URI_MEMORY_STATS = "vault-memory://memory/stats";
export const RESOURCE_URI_LIST_BRIEFS = "vault-memory://briefs";
export const RESOURCE_URI_LIST_CONTRACTS = "vault-memory://contracts";
export const RESOURCE_URI_LIST_CONTRACT_VERBS = "vault-memory://contract-verbs";
```

**Planner decision point:** Either extend `src/memory/resources/index.ts` (since the existing 5 constants all live here despite some being non-memory), or create a parallel `src/resources/uris.ts`. Recommendation: extend the existing barrel — it's already the de-facto resource-URI registry.

#### A.2 — Templated Resource analog (for `list_models`, `recent_notes`, `vault_stats`, `list_backlinks`)

**Analog:** `src/server.ts:1850-1893` (`contracts` Resource, Phase 6 CON-04).

```typescript
// src/server.ts:1850-1893 — TEMPLATED URI PATTERN ({vault} variable)
server.registerResource(
  "contracts",
  new ResourceTemplate(`${RESOURCE_URI_LIST_CONTRACTS}/{vault}`, {
    list: undefined,                              // SDK 1.29: opt out of auto-list of all expansions
  }),
  {
    title: "Task contracts",
    description:
      "Discovery of task contracts available in a vault (CON-04). Each entry " +
      "carries name, description, source/sink counts, and write_back boolean. " +
      "Optional `?source=<prefix>` filters to contracts declaring a source " +
      "whose handle starts with the given prefix.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const vault = String(variables.vault ?? "");
    const state = contractRegistries.get(vault);
    if (state === undefined) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: `unknown vault: ${vault}` }),
          },
        ],
      };
    }
    const source = uri.searchParams.get("source") ?? undefined;       // ← optional ?query= pattern
    const payload = readListContracts(
      { registry: state.started.registry, vaultName: vault },
      source !== undefined ? { source } : {},
    );
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  },
);
```

**For `list_backlinks` → `vault-memory://backlinks/{vault}/{docId}`** — the two-variable template form. SDK 1.29 `ResourceTemplate` supports multi-variable expansion natively; the read handler unpacks both from `variables`.

#### A.3 — Existing tool handler that the new Resource read handlers MUST call (DO NOT duplicate logic)

**Per RESEARCH §Phase 9 Compatibility GAT-01:** Resource handlers must route through the existing internal layers — no new `path.*` access, no chokidar, no new DocId mint sites. Reuse the existing tool handler.

**Analog for `list_vaults` Resource read body:**

```typescript
// src/server.ts:2146-2168 — handleListVaults (already exists; the Resource read handler reuses this)
function handleListVaults(manager: VaultManager): object {
  const vaults = manager.list().map((v) => {
    const noteCount = v.db.notes.countAll();
    const runs = v.db.audit.listRuns(1);
    const lastRun = runs[0];
    return {
      name: v.config.name,
      path: v.config.path,
      embedding_model: v.config.embedding_model ?? null,
      note_count: noteCount,
      write_enabled: v.config.write_enabled ?? false,
      last_run: lastRun
        ? { run_id: lastRun.run_id, started_at: lastRun.started_at, finished_at: lastRun.finished_at, error: lastRun.error }
        : null,
    };
  });
  return { vaults, count: vaults.length };
}
```

**Tool→Resource wire-up template** (the new Resource read callback simply calls the same handler):

```typescript
// src/server.ts (NEW, near line 1775 — paired with the existing list_vaults TOOL at line 934)
server.registerResource(
  "vaults",
  RESOURCE_URI_VAULTS,                            // "vault-memory://vaults"
  {
    title: "Configured vaults",
    description:
      "List configured vaults with status (note count, last index run). " +
      "Promoted from the `list_vaults` MCP tool in v2.0.0; the tool remains " +
      "callable through v2.x.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(handleListVaults(manager), null, 2),
      },
    ],
  }),
);
```

---

### Group B — Tool deprecation notes (`src/tool-registry.ts`)

**Per D-03/D-04:** the tool stays callable; only the `description` string changes to mark it deprecated.

**Analog (the unchanged shape — the entry that gets edited):**

```typescript
// src/tool-registry.ts:42-46 — list_vaults BEFORE
{
  name: "list_vaults",
  description: "List configured vaults with their status (note count, last indexed run).",
  inputSchema: { type: "object", properties: {} },
},
```

**Edit pattern (planner ships AFTER):**

```typescript
// src/tool-registry.ts:42-46 — list_vaults AFTER (description-only delta)
{
  name: "list_vaults",
  description:
    "List configured vaults with their status (note count, last indexed run). " +
    "DEPRECATED since v2.0.0 — prefer MCP Resource `vault-memory://vaults` for " +
    "agent discovery. The tool remains callable through v2.x; removal scheduled " +
    "for v3.0.0.",
  inputSchema: { type: "object", properties: {} },
},
```

**Same edit shape applies to:** `list_models` (line 341), `vault_stats` (line 448), `recent_notes` (line 459), `list_backlinks` (line 198). The `inputSchema` and `name` MUST stay byte-identical (per backwards-compat invariant). Only the `description` text grows.

**Test impact:** `evals/v1-baseline/baseline.test.ts:69` snapshot equality test catches these as expected drift. Planner regenerates `tools-list.snapshot.json` via `npm run eval:snapshot` and commits both changes in one PR — drift is intentional + reviewed.

---

### Group C — Snapshot infrastructure (Resources surface)

#### C.1 — Snapshot generator script

**Analog:** `evals/v1-baseline/dump-tools.mjs` (22 lines).

```javascript
// evals/v1-baseline/dump-tools.mjs — VERBATIM (existing)
#!/usr/bin/env node
/**
 * Snapshot generator for the v1 `tools/list` JSON-RPC surface (FND-10).
 *
 * Imports the literal TOOLS array from src/tool-registry.ts (the single source
 * of truth, also used by src/server.ts) and emits a canonical
 * `{ "tools": [...] }` JSON object to stdout.
 *
 * Re-running this script MUST be byte-deterministic against the pinned
 * tools-list.snapshot.json — drift fails CI.
 */

import { TOOLS } from "../../src/tool-registry.ts";

const payload = { tools: TOOLS };
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
```

**Pattern to clone for Resources** (planner picks: extend `dump-tools.mjs` to also emit a `resources-list.snapshot.json`, OR create `dump-resources.mjs` parallel). Resources do NOT live in a TOOLS-style literal array — they're spread across `server.registerResource()` call sites in `src/server.ts`. The Resources snapshot generator must either:
- spin up the server and call `client.listResources()` (heavier; matches `smoketest-non-claude.mjs` model), OR
- export a parallel `RESOURCES` literal from a new `src/resource-registry.ts` (cleaner; matches `TOOLS` precedent).

**Recommendation:** Mirror `TOOLS` — create `src/resource-registry.ts` with a `RESOURCES` literal, register from that in `src/server.ts` (Group A handlers stay in `server.ts`, but the metadata moves), then `evals/v1-baseline/dump-resources.mjs` imports `RESOURCES` same shape.

#### C.2 — Snapshot data file pinned shape

**Analog:** `evals/v1-baseline/tools-list.snapshot.json` (1148 lines; sibling file).

Structure: `{ "tools": [ { "name": "...", "description": "...", "inputSchema": {...} }, ... ] }`. Phase 8 Resources file follows the analogous shape: `{ "resources": [ { "name": "vaults", "uriTemplate": "vault-memory://vaults", "description": "...", "mimeType": "application/json" }, ... ] }`. Exact field names should mirror what `client.listResources()` returns on the wire — planner verifies against SDK 1.29 `resources/list` JSON-RPC response shape during implementation.

#### C.3 — Snapshot equality assertion block

**Analog:** `evals/v1-baseline/baseline.test.ts:69-79`.

```typescript
// evals/v1-baseline/baseline.test.ts:69-79 — existing tools-list snapshot block
describe("v1 tools/list surface (FND-10)", () => {
  it("matches the pinned snapshot exactly", () => {
    const actual = { tools: TOOLS };
    const pinned = JSON.parse(
      readFileSync(join(__dirname, "tools-list.snapshot.json"), "utf-8"),
    );
    expect(actual).toEqual(pinned);
  });

  it("has exactly 37 tools (34 prior + 06-02 register_contracts_as_tools + 06-03 describe_contract + instantiate_contract)", () => {
    expect(TOOLS).toHaveLength(37);
  });
```

**Phase 8 adds two parallel assertions** in the same `describe` block (or a sibling `describe("v2 resources/list surface (REL-08)")`):

```typescript
// NEW — pattern to clone
it("matches the pinned Resources snapshot exactly", () => {
  const actual = { resources: RESOURCES };
  const pinned = JSON.parse(
    readFileSync(join(__dirname, "resources-list.snapshot.json"), "utf-8"),
  );
  expect(actual).toEqual(pinned);
});

it("has exactly 32 default tools after REL-08 promotion", () => {
  expect(TOOLS).toHaveLength(32);   // 37 − 5 promotions
});
```

**Also update the existing 37→32 numeric expectation** at line 78 (already shown above). The descriptive test name should be edited to reflect the new count.

---

### Group D — Smoketest extension

**Analog:** `scripts/smoketest-non-claude.mjs:190-256` (existing assertion-1..5 blocks, including the existing Phase 2 Resources assertion at `:258+`).

```javascript
// scripts/smoketest-non-claude.mjs:190-205 — existing tool-count assertion
const { tools } = await client.listTools();
const toolNames = tools.map((t) => t.name).sort();
const expectedSorted = [...EXPECTED_TOOLS].sort();
const missing = expectedSorted.filter((t) => !toolNames.includes(t));
const extra = toolNames.filter((t) => !expectedSorted.includes(t));

if (missing.length > 0) fail(`missing tools: ${missing.join(", ")}`);
if (extra.length > 0) fail(`unexpected tools: ${extra.join(", ")}`);
if (tools.length !== EXPECTED_TOOLS.length) {
  fail(`tool count: expected ${EXPECTED_TOOLS.length}, got ${tools.length}`);
}
```

**Phase 8 deltas:**
- `EXPECTED_TOOLS` literal stays at 37 entries (per D-03, deprecated tools remain callable). **The expected count does NOT change.** If planner picks the additive-only path correctly, the smoketest is byte-identical.
- ADD a parallel `resources/list` assertion block after assertion 5 (Phase 2 Resources). Expected Resources count after Phase 8: 5 existing + 5 new = 10.

**Pattern for the new block (analog from `:258+`):**

```javascript
// scripts/smoketest-non-claude.mjs:258-300 — existing Phase 2 Resources assertion
const { resources } = await client.listResources();
const resourceUris = resources.map((r) => r.uri).sort();
const expectedResourceUris = [
  "vault-memory://memory/sinks",
  "vault-memory://memory/stats",
  // ... existing 5 ...
  "vault-memory://vaults",                  // ← NEW Phase 8
  // ... 4 more NEW Phase 8 ...
];
// expected.length === 10 (5 existing + 5 new)
```

---

### Group E — Release script (`scripts/release.mjs`)

**Greenfield — no exact analog.** Closest patterns in repo:

- `scripts/smoketest-non-claude.mjs` (345 LOC ESM Node, child_process via SDK transport)
- `scripts/dump-tools.mjs` (`evals/v1-baseline/dump-tools.mjs`, 22 LOC ESM, stdout emit)

**Style anchors from existing scripts:**

```javascript
// scripts/smoketest-non-claude.mjs:1-46 — header/banner + import + arg-parse style
/**
 * Non-Claude smoketest driver — ADP-10 CI gate.
 *
 * [...big JSDoc explaining the WHY, the design choices, and a usage line...]
 *
 * Usage:
 *   node scripts/smoketest-non-claude.mjs
 *   node scripts/smoketest-non-claude.mjs path/to/dist/cli.js
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = process.argv[2] ?? "dist/cli.js";
```

**For `release.mjs`** — apply the same convention: top JSDoc block explaining the release ritual + an `import { execSync } from "node:child_process"` + `import { readFile, writeFile } from "node:fs/promises"`. Argument parsing via `process.argv`. Use `process.exit(N)` for failure paths (matches `smoketest-non-claude.mjs:180-184` fail/pass helpers).

**CHANGELOG rename pattern (RESEARCH §Code Examples):**

```javascript
// scripts/release.mjs (sketch — anchor for planner)
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const VERSION = "2.0.0";
const TODAY = new Date().toISOString().slice(0, 10);

const changelog = await readFile("CHANGELOG.md", "utf8");
const lines = changelog.split("\n");
const unreleasedIdx = lines.findIndex((l) => l === "## [Unreleased]");
if (unreleasedIdx === -1) throw new Error("No `## [Unreleased]` heading found.");

lines.splice(
  unreleasedIdx, 1,
  "## [Unreleased]", "", "_Nothing yet._", "",
  `## [${VERSION}] — ${TODAY}`,
);
await writeFile("CHANGELOG.md", lines.join("\n"));
```

**Per RESEARCH Pitfall 2:** the heading format MUST be `## [X.Y.Z]` to match the awk extractor at `publish.yml:76`. Verify literally with `## [2.0.0]` (square-bracketed; no trailing dot before `]`).

**Git push atomicity** (Pitfall 2): use `git push --follow-tags origin main` OR `git push origin main vX.Y.Z` (single command). NEVER push tag before commit.

```javascript
// release.mjs — atomic push pattern
execSync("git push --follow-tags origin main", { stdio: "inherit" });
```

---

### Group F — `publish.yml` extension (release-asset attach)

**Analog:** `.github/workflows/publish.yml:94-103` (existing `softprops/action-gh-release@v2` step).

```yaml
# .github/workflows/publish.yml:94-103 — existing release-create step
- name: Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    body_path: /tmp/release-notes.md
    make_latest: legacy
```

**Phase 8 extension** — add NEW steps BEFORE the `softprops` step that build the plugin tarball + checksum, and pass them via `files:` to softprops:

```yaml
# NEW (planner adds between :89 and :94)
- name: Build plugin tarball
  run: |
    cd plugin
    npm ci
    node esbuild.config.mjs                    # produces plugin/main.js
    cd ..
    TARBALL="vault-memory-plugin-v${GITHUB_REF_NAME#v}.tar.gz"
    tar -czf "$TARBALL" -C plugin .            # archive plugin/ contents
    shasum -a 256 "$TARBALL" > manifest.sha256
    echo "TARBALL=$TARBALL" >> "$GITHUB_ENV"

- name: Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    body_path: /tmp/release-notes.md
    make_latest: legacy
    files: |                                    # ← NEW lines
      ${{ env.TARBALL }}
      manifest.sha256
```

**MP4 handling (RESEARCH Open Question 2):** the screencast MP4 is uploaded manually via the GitHub Release UI post-workflow (the workflow leaves the Release in a state where the maintainer attaches the MP4 + clicks Publish). Do NOT commit the MP4 to the repo.

**`shasum -a 256` choice (RESEARCH Don't Hand-Roll):** verified available on `ubuntu-latest`; matches existing `skills/vm-install/setup.sh:62-69` shasum fallback chain.

---

### Group G — `CHANGELOG.md` backfill (Phases 5 + 7 only)

**Analog (per-phase entry voice):** Existing Phase 4 entries in `CHANGELOG.md:27-38` and Phase 6 entries in `CHANGELOG.md:17-26`.

```markdown
# CHANGELOG.md:17-26 — Phase 6 entries (analog for Phase 5 + Phase 7 backfill voice)
### Added

- **Task Contract DSL (Phase 6, ADR-006)** — declarative YAML contracts under `_contracts/<name>.yaml`, addressable by name, instantiable via MCP, with handle-based source/sink portability. Contracts use a closed assembly verb enum (11 baseline + `literal` + `mcp://<server>/<tool>` peer extension), `{{template}}` step composition, JSON-Schema-with-`$ref` inputs, MemorySink-only sinks (un-bypassable per D-A4c), and ChangeFeed hot reload (D-LOAD). See `docs/v2/PHASE-6-SIGN-OFF.md` + `docs/v2/adr/006-task-contract-dsl.md`.
- **3 new MCP tools (Phase 6)** — `describe_contract`, `instantiate_contract`, `register_contracts_as_tools`. Tool count: 34 → 37 (additive only; v1-baseline preserved byte-identical).
- **2 new MCP Resources (Phase 6)** — `vault-memory://contracts/{vault}` (CON-04) lists contracts available in a vault; `vault-memory://contract-verbs/{vault}` (D-A2b) lists baseline + custom `mcp://` verbs with invocation counts.
- **3 reference contracts (Phase 6)** under `evals/fixtures/v2-test-vault/_contracts/`: `meeting-prep`, `project-status`, `code-review-brief`. Plus `smoketest-trivial` for the CON-09 non-Claude smoketest path.
```

**Voice rules (from existing Phase 4/6 entries):**
- One bullet per major-capability group; bullet starts with **bold short name** (matches headline-noun pattern).
- Tool count delta stated explicitly (`Tool count: X → Y; additive only`).
- Cross-references to `docs/v2/PHASE-N-SIGN-OFF.md` + ADRs.
- No marketing superlatives. No emojis. No "blazingly fast". No "magnificent".
- Group entries by Keep-a-Changelog category: `### Added` / `### Changed` / `### Deprecated` / `### Dependencies` / `### Migration` / `### Documentation`.

**Source documents for Phase 5 + Phase 7 backfill** (per RESEARCH §CHANGELOG Audit):
- Phase 5: `docs/v2/PHASE-5-SIGN-OFF.md` (especially §"What shipped" — the table mapping tools to slices is the spine for `### Added`)
- Phase 7: `.planning/phases/07-visual-contract-editor-canvas/VERIFICATION.md` + per-plan `07-NN-SUMMARY.md` files (no `docs/v2/PHASE-7-SIGN-OFF.md` exists — VERIFICATION.md is the equivalent)

**NEW for Phase 8 — REL-08 deprecation entries** (one per promoted tool):

```markdown
### Deprecated (Phase 8 / REL-08)

- **`list_vaults` MCP tool deprecated** — prefer `vault-memory://vaults` Resource. The tool remains callable through v2.x; removal in v3.0.0.
- **`list_models` MCP tool deprecated** — prefer `vault-memory://models/{vault}` Resource. [same caveat]
- **`recent_notes` MCP tool deprecated** — prefer `vault-memory://recent/{vault}` Resource. [same caveat]
- **`vault_stats` MCP tool deprecated** — prefer `vault-memory://stats/{vault}` Resource. [same caveat]
- **`list_backlinks` MCP tool deprecated** — prefer `vault-memory://backlinks/{vault}/{docId}` Resource. [same caveat]
```

---

### Group H — `README.md` rewrite

**Analog:** Current `README.md:1-21` is the v2 pitch already (preserve voice). Current `README.md:22-100` is v1-shaped (replace).

```markdown
# README.md:1-21 — PRESERVE THIS VOICE
# vault-memory

**Local-first, source-agnostic-ready knowledge layer for Obsidian vaults, exposed to
any MCP-aware agent.**

vault-memory turns one or more Obsidian vaults into a queryable, agent-native knowledge
base — running entirely on your machine. It indexes your notes with local embeddings
(via Ollama), keeps the index live as you edit, and exposes the result to
**any MCP-aware agent** — Claude Code, Claude Desktop, ChatGPT Custom Connectors,
the MCP Inspector, or any other client speaking the
[Model Context Protocol](https://modelcontextprotocol.io) — as a set of well-defined
tools for search, graph navigation, frontmatter queries, and atomic writes.

Obsidian is the v2 source connector; the same MCP tool surface backs any future
adapter (Notion, Logseq, …) via the `SourceConnector` / `DeliveryAdapter` / `ChangeFeed`
seams introduced in Phase 1.

Nothing leaves your machine. No cloud sync, no API keys, no telemetry.
```

**Six-section target (per D-11):**

| § | Title | Content source |
|---|-------|----------------|
| 1 | 30-second example | NEW; show `npm install -g @owrede/vault-memory`, `vault-memory add-vault ~/Notes`, `vault-memory serve`, claude_desktop config snippet, 1-paragraph "ask the agent for a meeting-prep brief" |
| 2 | What this is | Reuse existing `:1-21` pitch text |
| 3 | Architecture (ASCII) | New ASCII diagram derived from `docs/v2/ARCHITECTURE.md` L0–L5 layer model |
| 4 | What's new in v2 | Bullet list pulled from backfilled `CHANGELOG.md [Unreleased]` |
| 5 | Roadmap | NEW — names Phase 9 (hard gate) + v3.0.0 (Phase 10 / Notion connector) per `.planning/ROADMAP.md:270-286` |
| 6 | Install & docs | Links to `docs/v2/plugin/INSTALL.md`, `docs/v2/plugin/README.md`, `docs/v2/MIGRATION-V1-TO-V2.md`, `docs/v2/ARCHITECTURE.md`, `docs/v2/adr/README.md` |

**Pitfall 7 mitigation:** Preserve a SemVer-stability link in §6 — `> See [CHANGELOG.md](./CHANGELOG.md) for release history. Latest: **v2.0.0**. SemVer-locked tool API per v1.0.0 declaration.` (text mirrors current `:20` line).

---

### Group I — `docs/v2/MIGRATION-V1-TO-V2.md`

**No exact analog.** Closest voice/structure: any of `docs/v2/PHASE-N-SIGN-OFF.md` for technical-doc-under-`docs/v2/` voice.

**Structure (per D-12):**

```markdown
# Migrating from vault-memory v1.x to v2.0.0

**For downstream library consumers — primary audience.**
**For end users — short appendix at bottom.**

## TL;DR

- All 23 v1 MCP tool names + input schemas preserved byte-identical.
- 14 net-new tools and 5 net-new Resources added (additive only).
- 5 list-style tools deprecated (still callable through v2.x).
- TypeScript consumers: `verbatimModuleSyntax: true` + branded `DocId` may need code changes.

## 1. Major dependency bumps

### `@modelcontextprotocol/sdk`: `^1.0.4` → `^1.29.0`
[...low-level Server → McpServer migration notes per SDK 1.29 release notes...]

### `zod`: `^3.x` → `^4.4.3`
[...refinements + errorMap sweep per Zod 4 migration guide...]

## 2. TypeScript config changes
[...verbatimModuleSyntax: true; import type { Foo } requirement...]

## 3. Tool API delta (no breaking changes)
[...byte-identical preservation; net-new tool names per Backwards-compat invariant...]

## 4. Type system changes
[...branded DocId, Document.properties, adapter interfaces...]

## 5. REL-08 Resources promotion (additive surface)
[...table of 5 promoted tools + their canonical Resource URIs; tool remains callable through v2.x...]

## Appendix — What's new at runtime (end users)

One paragraph per phase, each linking to the phase's SIGN-OFF + README section.

- Phase 2 — memory namespace; see `docs/v2/MEMORY_CONTRACT.md`
- Phase 3 — assembly tools; see `docs/v2/PHASE-3-SIGN-OFF.md`
- Phase 4 — graph tools; see `docs/v2/PHASE-4-SIGN-OFF.md`
- Phase 5 — briefs; see `docs/v2/PHASE-5-SIGN-OFF.md`
- Phase 6 — contracts; see `docs/v2/PHASE-6-SIGN-OFF.md`
- Phase 7 — Obsidian plugin; see `docs/v2/plugin/README.md`
```

**Repo-root stub (optional, planner decides):** 2-line `MIGRATION-V1-TO-V2.md` at root pointing to `docs/v2/MIGRATION-V1-TO-V2.md`.

---

### Group J — `docs/v2/PHASE-8-SIGN-OFF.md`

**Analog:** `docs/v2/PHASE-6-SIGN-OFF.md` (most recent sign-off, exact template family). Sections to mirror:

```markdown
# Phase 6 Sign-Off — Task Contract DSL

**Phase:** 6 — Task contract DSL
**Sign-off date:** 2026-05-18
**Branch:** `phase-6-task-contract-dsl`
**Maintainer:** _to be recorded at PR approval time_
**Final tool count:** 37 tools + 5 MCP Resources (`list_sinks`, `memory_stats`, `list_briefs`, `contracts`, `contract-verbs`)

## Phase Summary
[...one paragraph framing the phase's goal + what shipped...]

## Requirements Coverage
| ID | Description | Status | Plan | Anchor commit |
|----|-------------|--------|------|---------------|
| CON-01 | ... | Complete | 06-01 | `sha` |
[...one row per requirement...]

## ROADMAP Success Criteria Coverage
### Criterion 1 — [name]
> [verbatim criterion text]
**Status: MET.**
[evidence paragraphs]
[...repeat for 5 criteria...]

## Tool Surface Inventory
[before/after counts + bullet list of additions/changes]

## Test Floor
[before count → after count; quick CI status]

## Known Limitations / Out-of-Scope
[bulleted list from CONTEXT <deferred>]

## Maintainer Sign-Off
| Field | Value |
|-------|-------|
| Signed by | _<pending>_ |
| Date | _<pending>_ |
| PR | _<pending>_ |
| Commit | _<pending>_ |
```

**Phase 8 deltas to this template (per D-18):**
- Add a **Phase 7 carryovers** section between "Tool Surface Inventory" and "Test Floor" (screencast + GitHub Release assets, both resolved + linked).
- Requirements coverage maps REL-01..REL-09 (not CON-NN).
- Tool count line: `**Final tool count:** 32 tools + 10 MCP Resources` (post REL-08 promotion).

---

### Group K — `CONTRIBUTING.md`

**Greenfield — no in-repo analog.** Voice comes from `docs/v2/PHASE-6-SIGN-OFF.md` (terse, technical). Structure derived from RESEARCH §Code Examples + D-06/D-17.

**Minimum scope (D-06 + D-17 only):**

```markdown
# Contributing to vault-memory

## Cut a release

To publish a new version:

```bash
npm run release
```

This runs `scripts/release.mjs`, which:
1. Validates the working tree is clean and you are on `main`.
2. Runs `npm test` locally (fail-fast).
3. Bumps `package.json` + `package-lock.json` to the requested version.
4. Renames `## [Unreleased]` → `## [X.Y.Z] — YYYY-MM-DD` in `CHANGELOG.md`.
5. Commits, tags `vX.Y.Z`, and pushes both atomically with `git push --follow-tags`.

The tag push triggers `.github/workflows/publish.yml`, which publishes to npm (with
provenance) and creates the GitHub Release using the matching CHANGELOG section as the
body. The plugin tarball + `manifest.sha256` are attached as Release assets.

## Eval suite is a merge gate

Pull requests targeting `main` cannot merge unless the GitHub Actions check
`lint-and-test` is green. This check runs the full eval suite:

- `npm run lint:check` — fixture-privacy + no-telemetry + adapter-seam + tsc + prettier
- `npm test` — vitest (includes evals/v2-fixtures + stub-adapter conformance)
- `npm run eval:baseline` — v1 tools-list snapshot + per-tool semantic floors
- `npm run build` + `node scripts/smoketest-non-claude.mjs` — non-Claude MCP SDK smoketest

If the check is red, fix the failure and push a new commit. **There is no `[skip eval]`
override.**

Branch protection is configured via GitHub Settings → Branches → `main` →
"Require status checks to pass before merging" with `lint-and-test` selected.
```

**Source for content:** RESEARCH §Code Examples ("Branch protection note for CONTRIBUTING.md") — already drafted there.

---

### Group L — Phase 7 carryover edits

**L.1 — `skills/vm-install/setup.sh`** (RESEARCH Pitfall 5 + D-16): already has the literal URL `https://github.com/owrede/vault-memory/releases/download/v2.0.0/...` at `:26`. **No edit required** at v2.0.0 ship — the URL resolves once the GitHub Release is published. Planner verifies with a live `vm-install` dry-run.

**L.2 — `skills/vm-update/update.sh`** (Pitfall 5): uses `v__VERSION__` template at `:23`, resolved at runtime by the script itself. **No edit required.**

**L.3 — `docs/v2/plugin/INSTALL.md`** and **`docs/v2/plugin/CONTRACT-EDITOR.md`**: replace any "Screencast TBD" / "Release URL TBD" deferral text with the resolved URL pattern (`https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4`). Planner greps for deferral markers before editing.

---

## Shared Patterns

### Authentication / Authorization

**N/A.** Phase 8 introduces no auth surfaces. Resource read handlers run in the same trust domain as the MCP server (caller is already trusted by virtue of the stdio transport).

### Error Handling

**Pattern source:** `src/server.ts:1734-1744` (existing tool-handler error envelope).

```typescript
// src/server.ts:1734-1744 — error envelope for tools (REUSE for Resource handlers)
try {
  const data = await handler(validated);
  return ok(data);
} catch (err) {
  if (err instanceof DocNotFoundError) {
    return errorResponseJson({ error: "doc_not_found", doc_id: err.doc_id });
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorResponse(message);
}
```

**For Resources:** the analog `contracts` Resource at `:1864-1878` shows the in-band error pattern (return error as JSON in `contents[0].text`, since Resources don't have `isError`):

```typescript
// src/server.ts:1864-1878 — Resource read-handler error pattern
const state = contractRegistries.get(vault);
if (state === undefined) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ error: `unknown vault: ${vault}` }),
      },
    ],
  };
}
```

Apply to: `list_models`, `recent_notes`, `vault_stats`, `list_backlinks` Resources when `{vault}` template variable doesn't resolve to a registered vault.

### Validation

**Pattern source:** `src/tool-registry.ts` (Zod schemas via `buildToolSchema`) and `src/server.ts:1729-1731` (refinement check).

**For Resources:** validation of URL `searchParams` is ad-hoc per Resource (see `:1816` `target = uri.searchParams.get("target") ?? undefined`). No Zod parse for query params today. Phase 8 Resources follow the same pattern — light defensive parsing, JSON error in `contents[0]` on failure.

### Logging

**Pattern source:** `process.stderr.write(...)` direct calls throughout (e.g., `src/server.ts:1140`). NO structured logger. Phase 8 follows existing convention — `release.mjs` writes progress to stderr; success/failure to exit code.

### Testing (snapshot + smoketest pattern)

**Pattern source:** `evals/v1-baseline/baseline.test.ts:69-79` (snapshot equality) + `scripts/smoketest-non-claude.mjs:190-256` (runtime assertions).

**Apply to:**
- New `resources-list.snapshot.json` snapshot equality test
- `EXPECTED_TOOLS` literal in `smoketest-non-claude.mjs` (stays at 37 per D-03 additive-only)
- New `EXPECTED_RESOURCE_URIS` constant (analog to `EXPECTED_TOOLS`) in `smoketest-non-claude.mjs`

---

## Files With No Analog

| File | Role | Data Flow | Reason | Fallback Pattern Source |
|------|------|-----------|--------|-------------------------|
| `scripts/release.mjs` | release-script | one-shot CLI | No prior release script — `publish.yml` was the entry point until now | `scripts/smoketest-non-claude.mjs` (ESM Node script header/import/exit-code conventions) + RESEARCH §Code Examples (CHANGELOG rename core logic) |
| `CONTRIBUTING.md` | doc | reader-facing | First-of-kind for the repo | Voice from `docs/v2/PHASE-6-SIGN-OFF.md`; content from RESEARCH §Code Examples |
| `docs/v2/plugin/screencast-thumbnail.png` | asset | binary image | No image assets exist in `docs/v2/` today | N/A — produced by D-14 storyboard; planner defers production to maintainer |

---

## Metadata

**Analog search scope:**
- `src/server.ts:1700-2170` — Resource registrations + tool handlers
- `src/tool-registry.ts` — TOOLS literal (37 entries)
- `src/memory/resources/index.ts` — URI constants barrel
- `scripts/` — release-adjacent scripts (smoketest, dump-tools)
- `evals/v1-baseline/` — snapshot file + dump script + test
- `docs/v2/PHASE-{3,4,5,6}-SIGN-OFF.md` — sign-off template
- `.github/workflows/{ci,publish}.yml` — CI + release workflows
- `CHANGELOG.md` — existing entries (voice + structure)
- `README.md:1-100` — current v1 README (preserve §1-21)
- `skills/vm-install/setup.sh`, `skills/vm-update/update.sh` — URL placeholder patterns
- `package.json:25-38` — scripts block

**Files scanned:** ~22

**Pattern extraction date:** 2026-05-19

**Cross-references for the planner:**
- `08-CONTEXT.md` `<decisions>` — locked decisions D-01..D-18
- `08-RESEARCH.md` §"Wave 0 Gaps" — explicit creation checklist
- `08-RESEARCH.md` §"Tool Surface Today" — REL-08 closed-set recommendation (5 promotions, hits 32)
- `08-RESEARCH.md` §"CHANGELOG Audit" — corrected backfill scope (Phases 5 + 7 only)
- `08-RESEARCH.md` §"Common Pitfalls" — 8 explicit pitfall callouts (re-read before each plan)
