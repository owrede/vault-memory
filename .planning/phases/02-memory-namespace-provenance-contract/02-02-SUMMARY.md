---
phase: 02-memory-namespace-provenance-contract
plan: 02
subsystem: memory
tags:
  [
    memory-sink,
    handle-parser,
    sentinel,
    memory-contract,
    yaml-loader,
    config-extension,
    mem-01,
    mem-05,
    mem-06,
  ]
dependency_graph:
  requires:
    - docs/v2/adr/004-memory-sink-handles.md (Wave 0 amendment locked the contract)
    - docs/v2/MEMORY_CONTRACT.md (normative validator spec)
    - src/adapters/registry.ts (DocId brand-mint pattern, DOC_ID_PATTERN)
    - src/types.ts (Phase 1 MemorySinkHandle brand declaration)
    - src/config/loader.ts (Phase 1 TOML+Zod pattern)
  provides:
    - parseMemorySinkHandle, formatMemorySinkHandle, MEMORY_SINK_HANDLE_PATTERN,
      SENTINEL_FILENAME (canonical declarations)
    - MemorySinkRegistry — sole resolver per ADR-004 §Resolution
    - decomposeDocId — DocId parts-splitter for downstream Phase 2 plans
    - pathInSink + joinVaultPath — sole licensed path.join site for sink/vault
      resolution under ADR-002 I-3
    - provisionSink, assertSentinelExists, SinkProvisioningError — sentinel
      mechanics confined to obsidian-fs adapter dir per ADR-002 I-2
    - DEFAULT_MEMORY_V1 + getContract + loadContractFromDisk + MemoryContract
      type + MemoryContractInvalidError + MemoryContractNotFoundError
    - _contracts/memory/default-memory-v1.yaml — shipped baseline contract YAML
    - AppConfigSchema extended with optional [memory] + [[memory_sinks]] blocks
    - Widened `MemorySink` interface in src/types.ts (name, handle, vault,
      resolveToRelativePath, contractName, isDefault)
  affects:
    - Phase 2 Plan 02-03 (validator at DeliveryAdapter.write) — consumes
      `MemorySinkRegistry.findSinkContaining` and `getContract(...).propertiesSchema`
    - Phase 2 Plan 02-03b (server bootstrap wiring) — wires
      registerMemorySinks into `serve()` before catchupVault
    - Phase 2 Plans 02-04..02-08 (MCP tools, resources, audit, fixture)
      all depend on this substrate
tech_stack:
  added:
    - yaml@2.9.0 (already installed; first runtime consumer is the contract loader)
  patterns:
    - IIFE-closed brand-mint (re-used from src/adapters/registry.ts:76–94)
    - Pure split via existing pattern (decomposeDocId re-uses DOC_ID_PATTERN
      via defensive parseDocId call — single source of truth)
    - Provisioner-callback seam (registry stays free of node:fs; production
      callback wraps obsidian-fs/sentinel.provisionSink)
    - YAML→Zod-validated→built-Zod-propertiesSchema pipeline for contracts
    - Module-level Map cache keyed by contract name (process lifetime)
    - Zod `.superRefine` for cross-field invariants (status=superseded ⇒
      superseded_by non-null AND superseded_reason non-empty)
    - `.passthrough()` on contract schemas for D-02 contract-extras escape hatch
key_files:
  created:
    - src/memory/sink.ts
    - src/memory/sink.test.ts
    - src/memory/registry.ts
    - src/memory/registry.test.ts
    - src/memory/index.ts
    - src/memory/contract/index.ts
    - src/memory/contract/types.ts
    - src/memory/contract/default-v1.ts
    - src/memory/contract/default-v1.test.ts
    - src/memory/contract/schema.ts
    - src/memory/contract/loader.ts
    - src/memory/contract/loader.test.ts
    - src/adapters/delivery/obsidian-fs/sentinel.ts
    - src/adapters/delivery/obsidian-fs/sentinel.test.ts
    - src/adapters/delivery/obsidian-fs/path.ts
    - src/adapters/delivery/obsidian-fs/path.test.ts
    - src/adapters/delivery/obsidian-fs/contract-yaml-read.ts
    - src/config/loader.test.ts
    - _contracts/memory/default-memory-v1.yaml
    - .planning/phases/02-memory-namespace-provenance-contract/02-02-SUMMARY.md
  modified:
    - src/adapters/registry.ts (additive — `decomposeDocId` only)
    - src/adapters/registry.test.ts (additive — `describe("decomposeDocId")`)
    - src/types.ts (widened `MemorySink` interface; added `MemoryConfig` and
      `MemorySinkConfigEntry`; extended `AppConfig` with optional memory blocks)
    - src/config/loader.ts (extend AppConfigSchema with optional [memory] and
      [[memory_sinks]]; pass through `memory` and `memory_sinks` in return value)
decisions:
  - "MemorySinkHandle requires a trailing slash on the resource component
    (canonical per ADR-001 §I-6) — the parser rejects bare `_memory` (no
    slash) so a sink handle is unambiguously a folder address, distinct
    from a file-pointing DocId"
  - "MemorySink interface widened from the Phase 1 stub ({handle, resolveTo:
    DocId}) to the Phase 2 runtime shape ({name, handle, vault,
    resolveToRelativePath, contractName, isDefault}); the prior `resolveTo`
    field had no runtime consumer (Phase 1 type-only stub) so the swap is
    type-only — no v1 behavior change"
  - "Provisioner is injected as a callback into MemorySinkRegistry rather
    than imported directly — keeps src/memory/ free of node:fs per
    ADR-002 I-2; production callback wraps `provisionSink` from
    obsidian-fs/sentinel.ts; tests inject spies"
  - "Contract YAML loader's `superseded_by` rule was extended with an
    optional `nullable: true` field to support the MEMORY_CONTRACT.md
    'required-but-defaults-to-null' semantic; the hardcoded
    DEFAULT_MEMORY_V1 schema uses `z.string().nullable().default(null)`
    directly. Both paths accept the same canonical observation"
  - "`status` and `superseded_by` are required keys (in `requiredKeys`) but
    are NOT in the missing-key rejection test matrix because both have
    defaults applied by the contract schema (`status: 'active'`,
    `superseded_by: null`). The cross-field rule still catches
    `status=superseded` with a null/missing `superseded_by`"
  - "Contract YAML cross-field-rules grammar accepts the form
    `<key> == '<value>'` for `when` and `<k1> && <k2>` (or single key) for
    `require`. The shipped default-memory-v1.yaml uses this form;
    other forms are parsed but no-op (forward compatible — Phase 5+ may
    extend the grammar)"
metrics:
  duration: "~75 min"
  completed: 2026-05-15
  tasks_completed: 4
  commits: 4
  files_created: 20
  files_modified: 4
  tests_added: 81
  baseline_tests_before: 578
  total_tests_after: 659
---

# Phase 2 Plan 02-02: MemorySink Runtime Substrate Summary

**One-liner:** Foundation slice for Phase 2 — MemorySinkHandle parser (IIFE-closed brand mint), MemorySinkRegistry (sole resolver per ADR-004 §Resolution), MemoryContract subsystem (hardcoded DEFAULT_MEMORY_V1 + YAML loader + Zod schema with cross-field invariants), `.memory-sink` sentinel mechanics in obsidian-fs adapter, and optional `[memory]` / `[[memory_sinks]]` blocks in AppConfigSchema — everything every downstream Phase 2 plan needs before validator, MCP tool, audit, or resources code can be written.

## What Was Built

Four atomic commits landed the substrate layer:

### Task 0 — `decomposeDocId` + obsidian-fs path helpers (commit `8a23d91`)

- **`decomposeDocId(docId): {scheme, authority, resource}`** appended to
  `src/adapters/registry.ts`. Pure split using `indexOf("://")` + `indexOf("/")`;
  re-uses `DOC_ID_PATTERN` via a defensive `parseDocId` validation (single source
  of truth — no second regex). Additive export; `parseDocId` / `formatDocId` /
  `parseSourceHandle` unchanged.
- **`joinVaultPath(vaultRoot, relPath)` + `pathInSink(vaultAbs, sink, sub?)`**
  in new `src/adapters/delivery/obsidian-fs/path.ts`. SOLE licensed `path.join`
  site for sink/vault path resolution in Phase 2 per ADR-002 I-3.
- `pathInSink` uses a local structural shape `{ resolveToRelativePath: string }`
  rather than `Pick<MemorySink, ...>` so Task 0 lands independently of the
  MemorySink widening in Task 1.
- 9 co-located vitest cases pin round-trip, multi-segment resources, and
  invalid-DocId rejection.

### Task 1 — MemorySinkHandle parser + sentinel filename + widened MemorySink (commit `1567a06`)

- **`parseMemorySinkHandle(s): MemorySinkHandle`** in new `src/memory/sink.ts`,
  IIFE-closed brand-mint mirroring `parseDocId` at `src/adapters/registry.ts:76–94`.
- **`MEMORY_SINK_HANDLE_PATTERN = /^obsidian-fs:\/\/[a-z0-9][a-z0-9-]*\/[^\s]+\/$/`** —
  trailing slash required (per ADR-001 §I-6 canonical serialization); lowercase
  obsidian-fs scheme only (Phase 2 scope); non-empty authority + resource.
- **`formatMemorySinkHandle(scheme, authority, resource)`** convenience composer.
- **`SENTINEL_FILENAME = ".memory-sink"`** — canonical declaration.
- **Widened `MemorySink` interface** in `src/types.ts` from the Phase 1 stub
  (`{handle, resolveTo: DocId}`) to the Phase 2 runtime shape:
  `{name, handle, vault, resolveToRelativePath, contractName, isDefault}`.
- 17 co-located vitest cases: positive parse, format round-trip, six
  malformed-input rejections (uppercase scheme, missing slash, no trailing
  slash, empty authority/resource/string, non-obsidian-fs scheme), error
  message includes the input value + expected shape.
- No `node:fs` / `node:path` / `chokidar` / `gray-matter` imports in `sink.ts`
  (pure parser; grep verified).

### Task 2 — MemoryContract subsystem (commit `116ab33`)

Five new modules under `src/memory/contract/`:

- **`types.ts`** — public `MemoryContract` interface
  (`{name, version, propertiesSchema, requiredKeys, naming}`) in its own
  module to avoid circular imports through the barrel.
- **`schema.ts`** — `MemoryContractYamlSchema`, `PropertyRuleSchema`,
  `CrossFieldRuleSchema`. `PropertyRuleSchema` accepts `type` (one of
  `string|datetime|array|doc_id|number|boolean|reference|date`), optional
  `allowed`, `default`, `items`, `min_length`, `nullable`.
- **`default-v1.ts`** — `DEFAULT_MEMORY_V1` hardcoded baseline matching
  MEMORY_CONTRACT.md spec verbatim:
  - Seven required keys (`source`, `confidence`, `evidence`, `status`,
    `observed_at`, `superseded_by`, `type`) with their canonical enums
    (`source: agent|user|imported`, `confidence: direct|inferred|uncertain`,
    `status: active|superseded|archived`).
  - `status` defaults to `"active"`; `superseded_by` defaults to `null`.
  - `superseded_reason: z.string().optional()` (D-02 contract-extra; spec
    cross-field rule).
  - `.passthrough()` for D-02 contract-extras (`expires_at`, `tags`, etc.).
  - `.superRefine` enforces the cross-field invariant:
    `status === "superseded"` ⇒ `superseded_by` non-null AND
    `superseded_reason` non-empty.
- **`loader.ts`** — `loadContractFromDisk(name, vaultPath)` async loader:
  1. Cache check by name (returns cached on hit).
  2. Disk read via `readContractYaml` helper in
     `src/adapters/delivery/obsidian-fs/contract-yaml-read.ts` (the licensed
     `node:fs` home; uses `joinVaultPath` from Task 0).
  3. `parseYaml(text)` via `yaml@^2.9.x`.
  4. `MemoryContractYamlSchema.parse(parsed)` (Zod validation).
  5. `buildPropertiesSchema(yaml)` walks `required_properties` +
     `optional_properties` + `cross_field_rules` into a `z.object(...)`.
  6. Caches result by both the requested name and the contract's
     self-declared `name` field.
  - `MemoryContractNotFoundError` (ENOENT) + `MemoryContractInvalidError`
     (YAML parse fail OR Zod validation fail; file path in message)
     exported as named classes.
- **`index.ts`** — public barrel: `getContract(name)` (synchronous in-cache
  lookup with helpful unknown-name diagnostic), `loadContractFromDisk`,
  `DEFAULT_MEMORY_V1`, `MemoryContract` type, error classes. Pre-seeds the
  cache with `DEFAULT_MEMORY_V1` at module load so `getContract("default-memory-v1")`
  works without an explicit `loadContractFromDisk`.

Shipped contract YAML:

- **`_contracts/memory/default-memory-v1.yaml`** — matches the amended
  ADR-004 example block: seven required keys with canonical enums,
  `superseded_by` marked `nullable: true`, optional `superseded_reason`
  and `expires_at`, cross-field rule
  `when: "status == 'superseded'" / require: "superseded_by && superseded_reason"`,
  naming strategy `date-slug` with pattern `{observed_at:YYYY-MM-DD}-{slug}.md`.

30 co-located vitest cases:

- `default-v1.test.ts` (20) — identity, positive parse of active + superseded
  observations, contract-extras passthrough, missing-required-key rejection
  for the five strictly-required keys, invalid enum rejection,
  cross-field-rule violations (missing reason / empty reason / null
  superseded_by), invalid-type rejection (non-array evidence, non-ISO date,
  empty type string).
- `loader.test.ts` (10) — `getContract("default-memory-v1")` returns the
  pre-seeded baseline; `getContract("unknown")` throws with diagnostic;
  YAML load + parse + Zod-validate + buildPropertiesSchema; missing-file →
  `MemoryContractNotFoundError`; malformed-YAML → `MemoryContractInvalidError`
  with file path in message; cache hit on second call; cached contract
  accessible via `getContract` after disk load; shipped
  `_contracts/memory/default-memory-v1.yaml` round-trips through
  `loadContractFromDisk`; `yaml@2.9.x` + `zod@4.x` runtime imports work
  (Pitfall 6 mitigation).

### Task 3 — Sentinel + MemorySinkRegistry + config extension + memory barrel (commit `28d070c`)

- **`src/adapters/delivery/obsidian-fs/sentinel.ts`** — SOLE licensed home
  for `.memory-sink` file mechanics per ADR-002 I-2:
  - `provisionSink(sink, vaultAbs, opts)` — writes sentinel for empty
    folders, folders containing only sink-shaped content (`observations/`,
    `_briefs/`, `status-updates/`, `.memory-sink`, `*.md` files); throws
    `SinkProvisioningError` (with `code = "SINK_PROVISION_UNSAFE"`) for
    folders containing foreign user content; idempotent on repeat calls.
  - `assertSentinelExists(sink, vaultAbs)` — cheap `fs.access` check;
    safe to call on every write.
  - `SinkProvisioningError` class with `sinkName` / `absoluteFolderPath` /
    `offendingEntries` fields for actionable error messages.
  - All path joins routed through `pathInSink` from Task 0; no direct
    `node:path` import.
  - Sentinel content is informational (`created_at: ISO`, `sink_name: …`,
    `vault_memory_version: …`); the *presence* is the gate per
    ADR-004 §289.
- **`src/memory/registry.ts`** — `MemorySinkRegistry` class:
  - `registerMemorySinks(configs, opts)` — for each TOML
    `[[memory_sinks]]` entry: parse handle via `parseMemorySinkHandle`,
    split via private `decomposeMemorySinkHandle`, look up the named
    contract via `opts.contractGetter ?? getContract`, await
    `opts.provisioner(sink, vaultAbs)` (the seam: production callback
    wraps obsidian-fs/sentinel.provisionSink), store the resolved
    `MemorySink` record.
  - `listMemorySinks()` — insertion-order array.
  - `resolveMemorySink(nameOrHandle)` — name lookup first, then handle
    lookup; throws with the registered-sink list in the diagnostic
    message (mirrors `AdapterRegistry.resolveSource`).
  - `getDefaultMemorySink()` — returns the configured default
    (`[memory].default_sink`) OR the first-registered sink as fallback;
    throws when no sinks are registered.
  - `findSinkContaining(docId)` — uses `decomposeDocId` (Task 0) to split
    the DocId, matches by authority equality + `resource.startsWith(sink.resolveToRelativePath)`,
    returns `null` for cross-vault DocIds and non-obsidian-fs schemes.
- **`src/memory/index.ts`** — barrel re-exporting `parseMemorySinkHandle`,
  `formatMemorySinkHandle`, `MEMORY_SINK_HANDLE_PATTERN`, `SENTINEL_FILENAME`,
  `MemorySinkRegistry`, `MemorySinkConfig`, `RegisterMemorySinksOptions`,
  `DEFAULT_MEMORY_V1`, `getContract`, `loadContractFromDisk`,
  `MemoryContract`, `MemoryContractInvalidError`,
  `MemoryContractNotFoundError`.
- **`src/config/loader.ts`** — extend `AppConfigSchema`:
  - `MemorySinkConfigSchema` — `{name: string, handle: string, contract: string}`
    with `contract` defaulting to `"default-memory-v1"`.
  - `MemoryConfigSchema` — `{default_sink?: string}`.
  - `memory_sinks: z.array(...).optional().default([])` makes the block
    optional and backwards-compat with v1 configs.
  - The handle string is intentionally NOT validated via the
    `MEMORY_SINK_HANDLE_PATTERN` at config-load time (the brand-cast
    happens inside the registry); keeps `src/config/` free of
    `src/memory/*` imports.
  - Updated `AppConfig` interface in `src/types.ts` adds `memory?` and
    `memory_sinks: MemorySinkConfigEntry[]`.

25 co-located vitest cases:

- `sentinel.test.ts` (8) — provisioning across four scenarios (empty,
  expected-content, foreign-content, idempotent-repeat), folder-creation
  with `recursive: true`, `assertSentinelExists` returns false for
  missing-folder and missing-sentinel cases, SENTINEL_FILENAME re-export
  consistency.
- `registry.test.ts` (13) — single-sink register + provisioner call,
  multi-sink order preservation, malformed-handle rejection at register
  time, resolve-by-name + resolve-by-handle equivalence, unknown-name
  diagnostic with registered-list, explicit `defaultSinkName` override,
  first-registered fallback, `getDefaultMemorySink` throws on empty
  registry, `findSinkContaining` enclosure match, miss outside any sink,
  miss across vault authorities, miss across schemes.
- `loader.test.ts` (4) — v1-style TOML still parses (no memory blocks),
  v2-style TOML with `[memory]` + `[[memory_sinks]]` parses to the
  expected struct, `contract` defaults to `"default-memory-v1"` when
  omitted from a `[[memory_sinks]]` entry, `[memory]` is optional when
  only `[[memory_sinks]]` is provided.

## Verification Performed

```bash
# Per-task automated checks (plan <verify> blocks)
npx vitest run --no-coverage src/adapters/registry.test.ts \
  src/adapters/delivery/obsidian-fs/path.test.ts                # Task 0: 42 ✓
npx vitest run --no-coverage src/memory/sink.test.ts            # Task 1: 17 ✓
npx vitest run --no-coverage src/memory/contract/               # Task 2: 30 ✓
npx vitest run --no-coverage src/adapters/delivery/obsidian-fs/sentinel.test.ts \
  src/memory/registry.test.ts src/config/loader.test.ts         # Task 3: 25 ✓

# Plan <verification> block
npx vitest run --no-coverage                                    # 659 / 670 (11 todo) ✓
npx tsc --noEmit                                                # clean ✓
bash scripts/lint-adapters.sh                                   # all I-* green ✓
node -e "console.log(require('zod/package.json').version)"      # 4.4.3 ✓

# Magic-string-folder-matching audit
grep -rE "_memory/|\.memory-sink" src/memory/ src/adapters/registry.ts src/server.ts \
  | grep -v "\.test\.ts"
# Only hit: src/memory/sink.ts:export const SENTINEL_FILENAME = ".memory-sink";
# (the SOLE canonical declaration — sentinel.ts re-exports the constant,
# does not redefine the literal). ✓

# fs/path imports outside the licensed adapter dir
grep -rE "from \"node:(fs|path)\"" src/memory/ | grep -v "\.test\.ts"
# (empty) — only loader.test.ts imports node:path for fixture seeding ✓
```

## Deviations from Plan

Three minor structural decisions inside documented latitude — all explicitly
called out in the plan as "planner picks":

- **Task 1 trailing-slash semantic — planner-pick pinned to REQUIRED.**
  The plan said `"obsidian-fs://atlas/_memory"` (no trailing slash) "throws OR
  is accepted with auto-trailing-slash — planner picks; test must pin the
  chosen semantic." Pinned to REQUIRED for symmetry with ADR-001 §I-6
  canonical-serialization and to keep `MemorySinkHandle` unambiguously a
  folder address (a file-pointing DocId never has a trailing slash). Test
  `rejects "obsidian-fs://atlas/_memory" (no trailing slash)` enforces this
  in `sink.test.ts`. Error message includes the substring `trailing slash
  required` for actionability.

- **Task 2 `superseded_by` left out of missing-required-key matrix.** The
  plan listed seven required keys and the `<behavior>` block read "rejects
  each variant with a single missing/invalid required key." However, the
  hardcoded `DEFAULT_MEMORY_V1` schema (per MEMORY_CONTRACT.md spec) applies
  `.default(null)` to `superseded_by` and `.default("active")` to `status`,
  so both ARE allowed to be absent at the schema level. The
  `default-v1.test.ts` matrix excludes these two keys; the cross-field rule
  still catches a `status: superseded` payload that omits / nulls
  `superseded_by`. This matches the normative MEMORY_CONTRACT.md spec
  ("Validator behavior on missing: treat as null"); no spec drift.

- **Task 2 contract YAML extended with optional `nullable: true` rule.**
  The plan's YAML schema sketch had no `nullable` field, but
  MEMORY_CONTRACT.md requires `superseded_by` to accept `null` as a sentinel
  value. Added `nullable: z.boolean().optional()` to `PropertyRuleSchema`
  and `if (rule.nullable) schema = schema.nullable();` in the
  `ruleToZod` helper. The shipped `_contracts/memory/default-memory-v1.yaml`
  declares `superseded_by: { type: reference, nullable: true }`. Zero behavior
  drift versus the hardcoded baseline.

- **Task 2 inserted `__clearContractCache` test-only export.** The plan
  did not explicitly authorize a cache-clear test seam, but co-located
  loader tests need a `beforeEach` reset to start each test from a known
  cache state. Two flavors are exported: the `__clearContractCache` from
  `index.ts` re-seeds `DEFAULT_MEMORY_V1` (matches startup state); the
  bare `__clearContractCache` from `loader.ts` clears WITHOUT re-seed so
  the shipped-YAML round-trip test actually exercises the disk path
  rather than returning the pre-seeded baseline. Both are prefix-`__`
  to signal test-only.

None of these affect public surface. None affect runtime behavior of the
hardcoded baseline. None require ADR amendments.

## Authentication Gates

None. This plan is greenfield substrate code; no external services touched.

## Truths Verified (from plan `must_haves.truths`)

- ✓ `parseMemorySinkHandle("obsidian-fs://<vault>/_memory/")` returns a
  branded `MemorySinkHandle`; malformed input throws with the input value
  in the message (see sink.test.ts "includes the input value in the error
  message" + the seven-item rejection table).
- ✓ The branded mint is closed inside an IIFE — no module export leaks an
  unsafe cast (sink.ts L51–67; the IIFE returns only `parseMemorySinkHandle`).
- ✓ `decomposeDocId(docId): { scheme, authority, resource }` is exported
  from `src/adapters/registry.ts`; re-uses `DOC_ID_PATTERN` via the
  defensive `parseDocId` call (no second regex). `parseDocId` is
  unchanged.
- ✓ `pathInSink(sink: MemorySink, relativeSubpath: string): string` —
  actually exposed as `pathInSink(vaultAbsolutePath, sink, relativeSubpath?)`
  per the planner's interface latitude (the planner picked the
  vault-absolute-path-by-parameter shape; see `<behavior>` Task 0 step 1) —
  is exported from `src/adapters/delivery/obsidian-fs/path.ts` and is the
  SOLE licensed `path.join` site for sink-relative resolution in Phase 2.
- ✓ `MemorySinkRegistry.resolveMemorySink(name|handle)` returns the
  registered sink; unknown name throws with the list of registered sinks
  (registry.test.ts "throws on an unknown name with the registered-sink
  list in the message"); `findSinkContaining(docId)` returns the enclosing
  sink or null.
- ✓ `getContract("default-memory-v1")` returns a `MemoryContract` whose
  `propertiesSchema` is a Zod object validating the seven required keys
  (default-v1.test.ts "DEFAULT_MEMORY_V1 — propertiesSchema (positive) —
  accepts a fully-populated active observation");
  `loadContractFromDisk(name, vaultPath)` reads
  `_contracts/memory/<name>.yaml` and converts it to the same shape
  (loader.test.ts "reads a YAML contract" + "shipped … round-trips").
- ✓ `config.toml` with a `[memory]` and `[[memory_sinks]]` block parses
  through the extended `AppConfigSchema`; backward-compat: configs without
  these blocks still parse (loader.test.ts all four cases).
- ✓ `provisionSink(sink, vaultAbsolutePath, {version})` writes a
  `.memory-sink` sentinel into a newly-resolved sink folder; refuses to
  provision a non-empty folder containing unrelated user content; uses
  `pathInSink` for the join (sentinel.test.ts four scenarios).
- ✓ `yaml@2.9.x` and `zod@4.x` are confirmed available at module init
  (loader.test.ts "yaml@2.9.x and zod@4.x runtime availability" + the
  shell `node -e require('zod/package.json').version` reports 4.4.3).

## Known Stubs

None. This plan is the foundation slice — every module ships its tests in
the same PR. No `// TODO` markers for in-scope behavior; no placeholder
data; no incomplete functions.

The plan deliberately defers two seams to Plan 02-03b (wiring into `serve()`
bootstrap), which the plan itself documents: the substrate is in place but
not yet called from `src/server.ts` — Plan 02-03b will add the bootstrap
sequence `loadConfig → manager.openAll → registry.registerMemorySinks →
catchupVault → server.connect`. This is a known deferral, not a stub.

## Threat Flags

None. The added surface is pure substrate code:

- The new TOML config blocks (`[memory]`, `[[memory_sinks]]`) are
  config-only; they do not introduce any new network endpoints, auth
  paths, or schema changes at trust boundaries.
- The new `node:fs` calls (sentinel write/access) are confined to the
  obsidian-fs adapter dir per ADR-002 I-2 and write only to
  vault-scoped paths (`<vault>/<sink-relative>/.memory-sink`) that the
  registry pre-validates against the `MEMORY_SINK_HANDLE_PATTERN`.
- The new YAML loader reads only from `<vaultPath>/_contracts/memory/<name>.yaml`
  via the helper `readContractYaml`; the path is constructed via
  `joinVaultPath` from a vetted vault root + a Zod-validated contract
  name string.
- The `MemoryContract` validator surface (built but not yet wired into
  `DeliveryAdapter.write()` — that's Plan 02-03) is the mitigation for
  the entire Phase 2 threat model around silent agent writes; this plan
  delivers the substrate, the validator wiring lands next.

## Commits

| Task | Commit  | Description                                                  |
| ---- | ------- | ------------------------------------------------------------ |
| 0    | 8a23d91 | feat(02-02): add decomposeDocId + obsidian-fs path helpers   |
| 1    | 1567a06 | feat(02-02): add MemorySinkHandle parser + widen MemorySink  |
| 2    | 116ab33 | feat(02-02): MemoryContract subsystem — default-v1 + loader  |
| 3    | 28d070c | feat(02-02): MemorySinkRegistry + sentinel + config extension |

## Requirements Touched (substrate level)

- **MEM-01** — `MemorySink` handle parser landed; registry is the only
  resolver (`resolveMemorySink`, `findSinkContaining`); folder-path
  matching outside the parser is zero per the magic-string audit grep.
  Sentinel mechanics in `sentinel.ts`. **Fully delivered at the substrate
  level; full close-out lands with Plan 02-03 (validator) + 02-03b
  (server bootstrap wiring).**
- **MEM-05** — `default-memory-v1` MemoryContract loaded; validator
  function (Guard A + Guard B at `DeliveryAdapter.write()`) ships in
  Plan 02-03. This plan delivers the **schema half** of MEM-05; the
  validator-call-site half is Plan 02-03's surface.
- **MEM-06** — `[memory]` + `[[memory_sinks]]` config blocks land in
  `AppConfigSchema`; backwards-compat preserved (existing v1 configs
  still parse). **Fully delivered.**

## Self-Check

- File `src/memory/sink.ts` exists ✓
- File `src/memory/registry.ts` exists ✓
- File `src/memory/index.ts` exists ✓
- File `src/memory/contract/index.ts` exists ✓
- File `src/memory/contract/default-v1.ts` exists ✓
- File `src/memory/contract/loader.ts` exists ✓
- File `src/memory/contract/schema.ts` exists ✓
- File `src/memory/contract/types.ts` exists ✓
- File `src/adapters/delivery/obsidian-fs/sentinel.ts` exists ✓
- File `src/adapters/delivery/obsidian-fs/path.ts` exists ✓
- File `src/adapters/delivery/obsidian-fs/contract-yaml-read.ts` exists ✓
- File `_contracts/memory/default-memory-v1.yaml` exists ✓
- File `.planning/phases/02-memory-namespace-provenance-contract/02-02-SUMMARY.md` exists ✓
- Commit `8a23d91` exists on branch ✓
- Commit `1567a06` exists on branch ✓
- Commit `116ab33` exists on branch ✓
- Commit `28d070c` exists on branch ✓
- Plan <verification> block passes: `npx vitest run` 659/670 (11 todo), `npx tsc --noEmit` clean, `bash scripts/lint-adapters.sh` all green ✓

## Self-Check: PASSED
