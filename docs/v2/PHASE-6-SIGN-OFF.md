# Phase 6 Sign-Off — Task Contract DSL

**Phase:** 6 — Task contract DSL
**Sign-off date:** 2026-05-18
**Branch:** `phase-6-task-contract-dsl`
**Maintainer:** _to be recorded at PR approval time_
**Final tool count:** 37 tools + 5 MCP Resources (`list_sinks`, `memory_stats`, `list_briefs`, `contracts`, `contract-verbs`)

This document is the canonical artifact for the CON-01..CON-12
requirements + the five Phase 6 success criteria from
`.planning/ROADMAP.md` §"Phase 6". Maintainer approval on the final
Phase 6 PR carrying this file (plus the three contract tools, the two
Resources, the four reference contracts, ADR-006, migration 014, and
the `[contracts]` config block) IS the audit-trail event — there is
no separate signed-commit ceremony.

## Phase Summary

Phase 6 ships the **task contract DSL** layer: declarative YAML
contracts under `_contracts/*.yaml`, addressable by name, instantiable
via MCP, with handle-based source/sink portability that sets the v3
multi-source template.

The substrate (Plan 06-01) lands the migration, config block, type
catalog, Zod schema, registry, and audit writers. The loader layer
(Plan 06-02) wires the boot scan + ChangeFeed hot-reload through the
SourceConnector seam and adds the always-callable
`register_contracts_as_tools` escape valve. The orchestration layer
(Plan 06-03) ships `resolveTemplate`, `PeerMcpRegistry`, the closed
verb dispatcher (11 baseline + `literal` + `mcp://` peer extension
with Q-TIMEOUT), the 7-step `instantiateContract` orchestrator
(CON-06), and the pure `describeContract` Q-DESCRIBE renderer
(CON-05). The phase-gate slice (Plan 06-04) ships the three reference
contracts (meeting-prep, project-status, code-review-brief) +
`smoketest-trivial`, four eval scenarios (CON-08 + CON-10), the
`list_contracts` + `list_contract_verbs` MCP Resources (CON-04 +
D-A2b), the CON-09 non-Claude smoketest extension, and a targeted
widening of `ObsidianFsSource` so `_contracts/*.yaml` files are
discoverable end-to-end.

**Not in scope** (CONTEXT `<deferred>`): macros, in-process TS
plugins, MCP Prompts, cross-vault contracts, per-step retries, audit
retention, per-vault snapshot variants, LLM-generated `list_contracts`
summaries, contract versioning beyond 1, GraphQL query language,
contract composition.

## Requirements Coverage

| ID     | Description                                                                          | Status     | Plan         | Anchor commit |
|--------|--------------------------------------------------------------------------------------|------------|--------------|---------------|
| CON-01 | Contract schema YAML + Zod-4 validation; comments preserved on round-trip            | Complete   | 06-01, 06-02 | `bdb3978` schema, `667814f` round-trip, `fc884f2` ref-contracts test |
| CON-02 | Documents under `_contracts/<name>.yaml`; boot scan + ChangeFeed hot reload          | Complete   | 06-02        | `667814f` loader, `7068a7a` adapter widening |
| CON-03 | Three reference contracts (meeting-prep, project-status, code-review-brief) ship     | Complete   | 06-04        | `fc884f2`     |
| CON-04 | `list_contracts` MCP Resource at `vault-memory://contracts/{vault}`                  | Complete   | 06-04        | `9aaf325`     |
| CON-05 | `describe_contract({name, vault?})` returns `{json_schema, summary}` (Q-DESCRIBE)    | Complete   | 06-03        | `03d759a`, `9b45c0f` |
| CON-06 | `instantiate_contract({name, inputs, source_overrides?, sink_overrides?, vault?})`   | Complete   | 06-03        | `823ac7b`, `9b45c0f` |
| CON-07 | Three reference contracts ship under `evals/fixtures/v2-test-vault/_contracts/`      | Complete   | 06-04        | `fc884f2`     |
| CON-08 | Eval scenarios per contract under `_queries/contracts-*.yaml`                        | Complete   | 06-04        | `dc103f7`     |
| CON-09 | Non-Claude MCP client lists + instantiates contracts (smoketest)                     | Complete   | 06-04        | `7068a7a`     |
| CON-10 | Handle-based portability: same output shape for obsidian-fs + stub sources           | Complete   | 06-04        | `dc103f7`     |
| CON-11 | ADR-006 documents Tools vs Prompts decision + all key decisions                      | Complete   | 06-01        | `eac3cc4`     |
| CON-12 | `yaml ^2.6` is the only net-new runtime dependency                                   | Complete   | 06-01 (pre-installed in Phase 0) | n/a — verified by `package.json` diff |

## ROADMAP Success Criteria Coverage

The five ROADMAP criteria from `.planning/ROADMAP.md` §"Phase 6":

### Criterion 1 — Non-Claude MCP client lists + describes + instantiates contracts

> A non-Claude MCP client can list contracts via `list_contracts`
> (MCP Resource), describe one via `describe_contract`, and
> successfully run `instantiate_contract` against the fixture vault.

**Status: MET.**

- `scripts/smoketest-non-claude.mjs` extends the Phase 1 ADP-10 driver
  with Phase 6 assertions: lists the 3 contract tools, calls
  `describe_contract(meeting-prep)` and validates `{json_schema,
  summary}`, calls `instantiate_contract(smoketest-trivial)` and
  validates `{ok: true, write_back: {doc_id}}`, reads
  `vault-memory://contracts/test-vault` and validates ≥3 reference
  contracts are listed. Exits 0 (verified locally; CI gate via
  `npm run eval:smoketest`).
- Anchor commit: `7068a7a`.

### Criterion 2 — Three reference contracts ship and pass eval scenarios

> Three reference contracts ship and pass eval scenarios with
> expected output shape: `meeting-prep`, `project-status`,
> `code-review-brief`.

**Status: MET.**

- `evals/fixtures/v2-test-vault/_contracts/{meeting-prep,
  project-status, code-review-brief}.yaml` shipped, each anchored to
  specific Atlas Robotics fixture documents.
- `src/contracts/reference-contracts.test.ts` validates each contract
  against `ContractFileSchema` + asserts `buildInputSchema` produces a
  `ZodObject` with `additionalProperties: false` (Pitfall F1/F2).
- `src/contracts/eval-runner.test.ts` loads each scenario YAML, runs
  `instantiateContract` with a deterministically-mocked
  `handleCompileBrief` (Q-CI-LLM option b), and asserts the bundle
  matches the scenario's `expected_output_shape` + MEM-05 keys.
- Anchor commits: `fc884f2` (contracts + reference-contracts test),
  `dc103f7` (eval scenarios + harness).

### Criterion 3 — Override mechanism + handle-based portability

> Override mechanism is proven — pointing a contract at the stub
> connector via `source_overrides` yields the same shaped output as
> `obsidian-fs`, demonstrating handle-based portability.

**Status: MET.**

- `src/adapters/source/conformance.test.ts` gains a `contracts
  stub-parity (CON-10)` describe block. Two runs of the same
  `parity-probe` contract (one without overrides, one with
  `source_overrides`) produce structurally identical bundles — same
  step keys, same `write_back.sink`, same MEM-05 properties.
  Q-CI-LLM mock keeps the comparison structural.
- Anchor commit: `dc103f7`.

### Criterion 4 — Contract schema Zod-validated + variable handles + comment round-trip

> Contract schema (`version`, `name`, `inputs`, `sources`,
> `assembly`, `output_shape`, `write_back`) is Zod-4 validated;
> variable handle pattern (`{{default_source}}`) works in all
> reference contracts; comments are preserved on round-trip.

**Status: MET.**

- `src/contracts/schema.ts` ships `ContractFileSchema` with Zod-4
  (`superRefine` for duplicate-alias check; closed verb enum +
  `literal` + `mcp://` regex; required `version: 1` literal).
- All four shipped reference contracts use the `{{default_source}}` /
  `{{default_sink}}` template pattern in their `assembly:` + `write_back:`
  blocks; resolved at instantiation time by `resolveTemplate`
  (Plan 06-03 `templates.ts`).
- `reference-contracts.test.ts` asserts comments survive a
  `parseDocument` → `toString` round-trip on the most comment-heavy
  contract (`meeting-prep.yaml`). Per Plan 06-02 Deviation #3, CON-01
  is interpreted as comment-retention (not byte-equality) — yaml@2.9
  inline comments normalize whitespace.
- Anchor commits: `bdb3978` (schema), `4665274` (templates), `fc884f2`
  (reference contracts + test).

### Criterion 5 — ADR-006 + yaml is the only net-new runtime dep

> Phase 6 ADR documents the Tools vs Prompts decision; `yaml ^2.6`
> is the only net-new runtime dependency.

**Status: MET.**

- `docs/v2/adr/006-task-contract-dsl.md` ships in Plan 06-01 with 13
  numbered decision sections, eight invariants, a STRIDE Threat Model,
  a Rejected-Alternatives table, and a Forward-Compatibility note.
  §Decision 1 covers the Tools vs Prompts decision verbatim.
- Zero net-new runtime deps in Phase 6: `yaml`, `zod`, the MCP SDK,
  `better-sqlite3` — all pre-installed. Confirmed by `git diff
  package.json` showing zero new entries under `dependencies` since
  Phase 5 close.
- Anchor commit: `eac3cc4`.

## ADR-006 Decision Traceability

Mapping the 13 key decisions from `docs/v2/adr/006-task-contract-dsl.md`
to the commits that materialize them:

| Decision | Description                                              | Anchor commit(s)     |
|----------|----------------------------------------------------------|----------------------|
| D-A1     | Dual MCP surface (generic + per-vault auto-register)     | `cd59d7d`, `b71c5d0` |
| D-A1b    | `auto_register_tools` default OFF                        | `cd59d7d`            |
| D-A1c    | First-wins registry collision                            | `bdb3978`            |
| D-A2a    | Closed verb enum + `literal` + `mcp://` extension        | `bdb3978`, `9c66820` |
| D-A2b    | `aggregateVerbUsage` promotion signal + `list_contract_verbs` Resource | `e2c3461`, `9aaf325` |
| D-A2c    | Step composition via `as:` aliases + `{{...}}` templates | `4665274`            |
| D-A3a/b  | JSON-Schema-with-`$ref` input shape + type catalog       | `ed51845`            |
| D-A4a/b  | Override semantics (handle name, default chain)          | `823ac7b`            |
| D-A4c    | MemorySink-only sink invariant (un-bypassable)           | `823ac7b`            |
| D-LOAD   | ChangeFeed hot reload                                    | `667814f`            |
| Q-OUTPUT | Bundle = `{steps, write_back}`; `write_back.doc_id` is ground truth | `823ac7b` |
| Q-TIMEOUT| Step-level timeouts only on peer-MCP verbs               | `9c66820`            |
| Q-DESCRIBE| `describe_contract` returns `{json_schema, summary}`    | `03d759a`            |

## Tool Surface Inventory

**Pre-Phase-6:** 34 tools (Phase 5 close).
**Post-Phase-6:** 37 tools — additive only:

- `register_contracts_as_tools` (Plan 06-02)
- `describe_contract` (Plan 06-03)
- `instantiate_contract` (Plan 06-03)

Plus **2 new MCP Resources** (do not count toward tool budget per
Phase 5 BRF-09 precedent):

- `vault-memory://contracts/{vault}` (Plan 06-04)
- `vault-memory://contract-verbs/{vault}` (Plan 06-04)

The `evals/v1-baseline/tools-list.snapshot.json` is byte-identical to
its post-Plan-06-03 state (37 entries). Plan 06-04 added zero new
tools — Resources surface on the separate `resources/list` protocol
channel.

**REL-08 budget reconciliation:** Deferred to Phase 8 per
RESEARCH §F7. Phase 8 (cleanup / consolidation) will rebalance the
tool list against the v3 multi-source story; Phase 6's `vm_*`
auto-registered tools (default OFF) preserve the budget at the
default config.

## Test Floor

**Pre-Phase-6:** 1395 (Phase 5 close baseline).
**Post-Phase-6:** **1558 passed | 11 skipped (1569 total)**.

Net gain: ~163 tests across the four plans (50 from 06-01 substrate,
24 from 06-02 loader/auto-register, 67 from 06-03 verbs/orchestrator,
~22 from 06-04 reference + eval-runner + stub-parity + resources).

`npm test` + `npx tsc --noEmit` + `bash scripts/lint-adapters.sh` +
`npm run eval:baseline` + `node scripts/smoketest-non-claude.mjs` all
green at sign-off.

(One pre-existing flaky test —
`src/adapters/change-feed/obsidian-fs/watcher.test.ts > drain() forces
pending events to flush` — intermittently fails under high concurrent
load; passes in isolation. Tracked as a Phase 1 timing-sensitive
fixture, not a Phase 6 regression.)

## Known Limitations / Out-of-Scope

Per `.planning/phases/06-task-contract-dsl/06-CONTEXT.md` `<deferred>`
section, the following are explicitly out-of-scope for Phase 6 and
will be revisited in later phases:

- **Macros** — composable sub-contracts; deferred to v2.x once usage
  data accumulates via `aggregateVerbUsage`.
- **In-process TypeScript plugins** — Plan 06-03 lands the `mcp://`
  peer-MCP extension instead; in-process plugin loading is rejected
  per ADR-006 §Threat Model T-06-03-08.
- **MCP Prompts surface** — ADR-006 §Decision 1 chooses Tools + MCP
  Resources; Prompts is deferred.
- **Cross-vault contracts** — every contract is single-vault in
  v2.0.0; cross-vault assembly is a v3 multi-source feature.
- **Per-step retries** — `step_timeout_seconds` is the only failure
  control; retry policies are deferred.
- **`contract_audit` retention policy** — append-only in v2.0.0;
  retention is a v2.x add.
- **Per-vault snapshot variants** — Phase 8 will rebalance the tool
  snapshot against the v3 multi-source story.
- **LLM-generated `list_contracts` summaries** — Plan 06-04 ships
  static projections; LLM-driven summaries are deferred.
- **Contract versioning beyond 1** — `version: 1` is the only
  supported version in v2.0.0; v2.x evolves via additive Zod union.
- **GraphQL query language** — REJECTED per ADR-006 §Rejected
  Alternatives; the closed verb enum is the only surface.
- **Contract composition** — sub-contract invocation is a v3 feature.

Plan 06-04 also documents one targeted **ObsidianFsSource widening**
done specifically for this phase gate: the source connector now also
enumerates `_contracts/*.yaml` files (read-only; non-recursive). The
indexer's `.md`-only contract is preserved by keeping the existing
`scanVault` helper unchanged and exposing a new `scanContractFiles`
helper used only by `listDocuments`. This unblocks the CON-09
smoketest while honoring the lint-adapters seam.

## Maintainer Sign-Off

| Field      | Value         |
|------------|---------------|
| Signed by  | _<pending>_   |
| Date       | _<pending>_   |
| PR         | _<pending>_   |
| Commit     | _<pending>_   |
