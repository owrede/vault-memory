---
phase: 06-task-contract-dsl
plan: 04
type: execute
wave: 4
depends_on:
  - 06-01
  - 06-02
  - 06-03
files_modified:
  - evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml
  - evals/fixtures/v2-test-vault/_contracts/project-status.yaml
  - evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-code-review-brief.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml
  - src/contracts/reference-contracts.test.ts
  - src/contracts/resources.ts
  - src/contracts/resources.test.ts
  - src/server.ts
  - src/contracts/eval-runner.test.ts
  - src/adapters/source/conformance.test.ts
  - scripts/smoketest-non-claude.mjs
  - docs/v2/PHASE-6-SIGN-OFF.md
  - CHANGELOG.md
  - .planning/ROADMAP.md
autonomous: false
requirements:
  - CON-07
  - CON-08
  - CON-09
  - CON-10
  - CON-04
  - CON-11
user_setup: []

must_haves:
  truths:
    - "Three reference contracts ship under `evals/fixtures/v2-test-vault/_contracts/` (CON-07): `meeting-prep.yaml`, `project-status.yaml`, `code-review-brief.yaml`. Each is authored from the RESEARCH Examples 1/6/7 sketches, anchored to SPECIFIC Atlas Robotics fixture files verified to exist (`meetings/2026-04-15-q2-okr-review.md` etc.; planner-verified at `ls evals/fixtures/v2-test-vault/meetings/`). Each contract has `version: 1`, kebab-case name, ≥1 input, declared sources + sinks (with required: true on `default_source` + `default_sink`), an `assembly:` step list using baseline verbs only (no `mcp://` — keeps CON-09 client-agnostic), an `output_shape:`, and a `write_back:` block pointing at `_memory/_briefs` MemorySink."
    - "Four eval scenario YAMLs ship under `evals/fixtures/v2-test-vault/_queries/` (CON-08 + CON-10): `contracts-meeting-prep.yaml`, `contracts-project-status.yaml`, `contracts-code-review-brief.yaml`, `contracts-stub-parity.yaml`. Each has at least one scenario with concrete `inputs:` referencing real fixture docs and `expected_output_shape:` (JSON Schema fragment) per RESEARCH Examples 8-9."
    - "`src/contracts/reference-contracts.test.ts` (filling the Plan 06-01 Wave-0 stub) loads each of the three reference contracts via `parseDocument` + `ContractFileSchema.safeParse` and asserts validation success. Round-trip preservation (CON-01): `parseDocument(text).toString() === text` is asserted for at least one contract (the most comment-heavy — meeting-prep)."
    - "CON-09 — `scripts/smoketest-non-claude.mjs` extended (NOT replaced; preserve Phase 1 ADP-10 behavior) to: (1) list_tools via SDK Client; (2) ASSERT `describe_contract`, `instantiate_contract`, `register_contracts_as_tools` are present; (3) call `describe_contract({name: 'meeting-prep'})` and assert `{json_schema, summary}` are returned; (4) call `instantiate_contract({name: 'meeting-prep', inputs: {meeting_doc_id: 'obsidian-fs://test-vault/meetings/2026-04-15-q2-okr-review.md', context_hops: 1}})` and assert `{ok: true, ...}` is returned. The smoketest runs as a real subprocess of the running server — `node` is the MCP client, `vault-memory serve` is the MCP server. This satisfies CON-09 unambiguously: 'a non-Claude MCP client lists and instantiates contracts.'"
    - "CON-10 — `src/adapters/source/conformance.test.ts` extended with a `describe('contracts stub-parity (CON-10)')` block that runs `instantiate_contract({name: 'meeting-prep', source_overrides: {default_source: 'stub://test-fixture'}})` against a stub SourceConnector populated with the same fixture documents and asserts `output_shape` matches the obsidian-fs run. The conformance suite is parametric over `obsidian-fs` AND `stub` per Phase 3 ASM-12 (already established pattern in this file)."
    - "`list_contracts({source?})` MCP Resource ships at `vault-memory://contracts/{vault}` (CON-04) per RESEARCH §M (Pattern 5). Reads the ContractRegistry directly; projects to `{total, contracts: [{name, description, vault, source_count, sink_count, write_back: boolean}]}`. Implementation in `src/contracts/resources.ts`."
    - "`list_contract_verbs` MCP Resource ships at `vault-memory://contract-verbs/{vault}` (D-A2b) returning `{baseline: [<verb>...], custom: [{verb, declared_in, used_by_contracts, invocation_count, last_seen}]}`. The `custom` entries are computed from: (a) the 11-baseline-verb set as constants; (b) declared `mcp://` verbs from `[contracts.mcp_clients]` config; (c) invocation_count + last_seen from `vault.db.contractAudit.aggregateVerbUsage(vault.config.name)` (Plan 06-01 aggregator)."
    - "Both MCP Resources registered in `src/server.ts` via `server.registerResource(...)` (the SDK 1.29 pattern Phase 5 used for `list_briefs` and Phase 2 used for `list_sinks`). MCP Resources do NOT count toward REL-08 tool budget per CONTEXT.md / RESEARCH §F7."
    - "`evals/v1-baseline/tools-list.snapshot.json` unchanged from Plan 06-03 (37 entries) — Resources are tracked separately. Verified by `diff` showing zero changes in this slice."
    - "`docs/v2/PHASE-6-SIGN-OFF.md` documents: all 12 CON-* requirements green; tool count 34 → 37 (REL-08 reconciliation deferred to Phase 8 per RESEARCH §F7); all 5 ROADMAP success criteria met; the 4 ADR-006 key decisions (D-A1/A2/A3/A4 + D-LOAD) traced to commit SHAs."
    - "`CHANGELOG.md` `[Unreleased]` section gains Phase 6 entries — new tools (describe_contract, instantiate_contract, register_contracts_as_tools), new MCP Resources (list_contracts, list_contract_verbs), three reference contracts, new ADR-006."
    - "`.planning/ROADMAP.md` Phase 6 checkbox marked complete with a sign-off summary line referencing PHASE-6-SIGN-OFF.md."
    - "All 1346+ existing tests + Plans 06-01/02/03 tests stay green; new tests for resources, reference-contracts, conformance-extension green. Smoketest exits 0."
    - "Marked `autonomous: false` because the snapshot validation + sign-off doc require human-reviewed diffs (matches Phase 5 PHASE-5-SIGN-OFF gate discipline)."
  artifacts:
    - path: "evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml"
      provides: "Reference contract — meeting-prep (RESEARCH Example 1, anchored to 2026-04-15-q2-okr-review.md fixture); 4-step assembly read_note → expand → cluster → compile_brief; write_back to _memory/_briefs"
      contains: "name: meeting-prep"
    - path: "evals/fixtures/v2-test-vault/_contracts/project-status.yaml"
      provides: "Reference contract — project-status (RESEARCH Example 6, anchored to atlas-1.md project); 3-step assembly query_frontmatter → cluster → compile_brief; write_back to _memory/_briefs"
      contains: "name: project-status"
    - path: "evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml"
      provides: "Reference contract — code-review-brief (RESEARCH Example 7, anchored to a chosen fixture PR-style doc); 3-step assembly read_note → search_hybrid → compile_brief; write_back to _memory/_briefs"
      contains: "name: code-review-brief"
    - path: "evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml"
      provides: "CON-08 eval scenario for meeting-prep with expected output shape (RESEARCH Example 8)"
      contains: "contract: meeting-prep"
    - path: "evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml"
      provides: "CON-10 eval — same contract, source_overrides between obsidian-fs and stub, assert same output shape (RESEARCH Example 9)"
      contains: "source_overrides"
    - path: "src/contracts/resources.ts"
      provides: "readListContracts(deps, opts) + readListContractVerbs(deps, opts) — pure read-only Resource handlers (CON-04 + D-A2b)"
      contains: "readListContracts"
    - path: "scripts/smoketest-non-claude.mjs"
      provides: "Extended smoketest exercising describe_contract + instantiate_contract via SDK Client (CON-09)"
      contains: "describe_contract"
    - path: "src/adapters/source/conformance.test.ts"
      provides: "Extended conformance suite — describe block 'contracts stub-parity (CON-10)' parametric over obsidian-fs + stub SourceConnector"
      contains: "contracts stub-parity"
    - path: "docs/v2/PHASE-6-SIGN-OFF.md"
      provides: "Phase 6 sign-off — all 12 CON-* green; tool count delta; ADR-006 decision-to-commit-SHA traceability; 5 ROADMAP success criteria met"
      contains: "Phase 6 Sign-Off"
  key_links:
    - from: "src/server.ts"
      to: "src/contracts/resources.ts"
      via: "server.registerResource('contracts', 'vault-memory://contracts/{vault}', handler) + 'contract-verbs'"
      pattern: "registerResource"
    - from: "src/contracts/resources.ts"
      to: "src/contracts/registry.ts"
      via: "Iterate registry.entries() for list_contracts"
      pattern: "registry\\.entries"
    - from: "src/contracts/resources.ts"
      to: "src/db/queries/contract-audit.ts"
      via: "aggregateVerbUsage for list_contract_verbs invocation_count + last_seen"
      pattern: "aggregateVerbUsage"
    - from: "src/adapters/source/conformance.test.ts"
      to: "src/contracts/instantiate.ts"
      via: "instantiateContract(deps, args) parametric over obsidian-fs + stub SourceConnector"
      pattern: "instantiateContract"
    - from: "scripts/smoketest-non-claude.mjs"
      to: "@modelcontextprotocol/sdk/client"
      via: "Client + StdioClientTransport spawning `node dist/cli.js serve` as subprocess; calls describe_contract + instantiate_contract"
      pattern: "describe_contract"
    - from: "docs/v2/PHASE-6-SIGN-OFF.md"
      to: ".planning/ROADMAP.md"
      via: "ROADMAP Phase 6 checkbox + summary line update on sign-off"
      pattern: "Phase 6"
---

<objective>
Phase gate slice. Ship the three reference contracts (CON-07) anchored to specific Atlas Robotics fixture documents; populate eval scenarios with expected output shapes (CON-08); prove non-Claude client compatibility (CON-09) via smoketest extension; prove handle-based source portability (CON-10) via stub-parity conformance test; register `list_contracts` (CON-04) and `list_contract_verbs` (D-A2b) MCP Resources; author the Phase 6 sign-off + CHANGELOG + ROADMAP updates. After this slice, all 12 CON-* requirements are green, all 5 ROADMAP success criteria are met, ADR-006's 4 key decisions are traced to commit SHAs, and Phase 6 is signed off.

Purpose: CON-07 (3 reference contracts ship) + CON-08 (eval scenarios per contract) + CON-09 (non-Claude proof) + CON-10 (stub-parity proof) + CON-04 (list_contracts Resource) + CON-11 (ADR-006 sign-off-stamped) + the phase gate. Marked `autonomous: false` because the snapshot validation (no diff allowed in this slice — Plan 06-03 was the last regen) + sign-off doc require human-reviewed diffs.

Output: 3 reference contract YAMLs + 4 eval scenario YAMLs in `evals/fixtures/v2-test-vault/`, `src/contracts/resources.ts` shipped + tested, MCP Resources registered in `src/server.ts`, `scripts/smoketest-non-claude.mjs` extended, `src/adapters/source/conformance.test.ts` extended with CON-10 block, `docs/v2/PHASE-6-SIGN-OFF.md` authored, `CHANGELOG.md` + `.planning/ROADMAP.md` updated, all 12 CON requirements green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/06-task-contract-dsl/06-CONTEXT.md
@.planning/phases/06-task-contract-dsl/06-RESEARCH.md
@.planning/phases/06-task-contract-dsl/06-VALIDATION.md
@.planning/phases/06-task-contract-dsl/06-01-foundations-PLAN.md
@.planning/phases/06-task-contract-dsl/06-02-loader-registry-hot-reload-PLAN.md
@.planning/phases/06-task-contract-dsl/06-03-instantiate-describe-verbs-PLAN.md
@docs/v2/adr/006-task-contract-dsl.md
@docs/v2/PHASE-5-SIGN-OFF.md
@docs/v2/adr/004-memory-sink-handles.md
@docs/v2/MEMORY_CONTRACT.md
@evals/fixtures/v2-test-vault/meetings
@evals/fixtures/v2-test-vault/projects
@evals/fixtures/v2-test-vault/_queries/brief.yaml
@evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml
@evals/fixtures/v2-test-vault/_queries/briefs-staleness-stub.yaml
@scripts/smoketest-non-claude.mjs
@src/adapters/source/conformance.test.ts
@src/brief/resources.ts
@src/memory/resources/index.ts
@src/contracts/index.ts
@src/contracts/registry.ts
@src/contracts/instantiate.ts
@src/contracts/describe.ts
@src/contracts/schema.ts
@src/server.ts
@src/db/queries/contract-audit.ts

<interfaces>
<!-- Canonical contracts the executor must follow. Do not explore the codebase beyond these. -->

From `evals/fixtures/v2-test-vault/` (planner-verified at planning time):
- `meetings/` contains: `2026-04-13-weekly-engineering-sync.md`, `2026-04-15-q2-okr-review.md`, `2026-04-17-atlas-1-build-review.md`, `2026-04-23-pilot-onboarding-kickoff.md`, etc. (11 files total).
- `projects/` contains: `atlas-1.md`, `atlas-1-perception-stack.md`, `atlas-1-reliability-program.md`, `atlas-1-warehouse-task-library.md`, `beacon.md`, `beacon-r-and-d-archive.md`, `spire.md`, `spire-fleet-orchestrator.md`, `spire-pallet-identification.md` (9 files).
- These are HIGH-confidence anchors per RESEARCH §A1 / Confidence breakdown (MEDIUM on the contract YAMLs because the assembly skeletons were drafted against the listing but not yet verified — Plan 06-04 finalizes by picking real docs).

For the code-review-brief contract, no PR/diff-style doc exists in the fixture per the listing. Plan 06-04 either: (a) authors a new fixture doc `pull-requests/2026-04-30-atlas-1-perception-pr-12.md` to anchor the contract, OR (b) uses an existing meeting doc with `pr_doc_id` semantically loose (the contract takes any DocId; the eval scenario can use any of the meeting docs). Plan 06-04 chooses (b) for v2.0.0 simplicity (no new fixture authoring); a future Phase 7+ may add PR-style fixtures.

From `src/brief/resources.ts` (Phase 5) — established MCP Resource handler shape. The `readListBriefs(deps, opts?)` pattern is the structural analog for `readListContracts(deps, opts?)`. Pure function over registry + audit aggregator; no I/O beyond DB reads.

From `src/memory/resources/index.ts` — RESOURCE_URI_* constants pattern. Plan 06-04 adds:
```typescript
export const RESOURCE_URI_LIST_CONTRACTS = "vault-memory://contracts";
export const RESOURCE_URI_LIST_CONTRACT_VERBS = "vault-memory://contract-verbs";
```
The `{vault}` suffix is appended at request time per the SDK 1.29 Resource handler pattern (mirror `list_briefs` from Phase 5).

From `src/server.ts` (post-Plan-06-03) — `server.registerResource(name, uri, opts, handler)` is the SDK call. Two new calls land here, after Phase 5's `list_briefs` registration.

From `scripts/smoketest-non-claude.mjs` (Phase 1 ADP-10) — existing structure: spawns `node dist/cli.js serve` as a child process via `StdioClientTransport`, instantiates `Client`, calls `tools/list` + a few read tools, exits 0 on success. Plan 06-04 adds 3 new assertion blocks at the end: list_tools contains new entries, describe_contract works, instantiate_contract works.

From `src/adapters/source/conformance.test.ts` (Phase 3 ASM-12 + Phase 5 BRF-11) — established `describe.each([obsidianFs, stub])(... 'parametric over %s', (sourceFactory) => {...})` pattern. Plan 06-04 appends a new `describe` block: `describe('contracts stub-parity (CON-10)', () => { ... })` that runs against `stub` only (the comparison is two parametric runs — one obsidian-fs, one stub — assert same output_shape).

From RESEARCH Examples 1, 6, 7 — assembly skeletons for the three contracts. Plan 06-04 finalizes them by picking specific fixture documents and adjusting verb args to match real fixture content.

From RESEARCH Examples 8-9 — eval scenario YAML shape (`scenarios: - {name, contract, inputs, expected_output_shape, expected_write_back: {sink, properties_required}}`).

From RESEARCH §F7 — final tool count 37 (no change from Plan 06-03); MCP Resources NOT in the tools snapshot per Phase 5 BRF-09 precedent. Plan 06-04 validates this by `diff` showing zero changes to `evals/v1-baseline/tools-list.snapshot.json`.

From `docs/v2/PHASE-5-SIGN-OFF.md` — sign-off document template Plan 06-04 mirrors. Sections: Phase Summary, Requirements Coverage (CON-01..CON-12 table), ROADMAP Success Criteria Coverage, ADR-006 Decision Traceability (D-A1 → commit SHA, etc.), Tool Surface Inventory, Test Floor, Known Limitations / Out-of-Scope (peer-MCP latency, macros deferred, etc.), Sign-off.

From `CHANGELOG.md` — existing format. Plan 06-04 appends to `[Unreleased]`:
- Added: 3 new MCP tools (describe_contract, instantiate_contract, register_contracts_as_tools)
- Added: 2 new MCP Resources (list_contracts, list_contract_verbs)
- Added: 3 reference contracts in evals fixture
- Added: ADR-006 task contract DSL
- Added: contract_audit table (migration 014)
- Added: [contracts] config block

From `.planning/ROADMAP.md` — Phase 6 entry. Plan 06-04 flips the checkbox `[ ]` → `[x]` and appends a one-line completion timestamp + sign-off doc reference matching the Phase 5 pattern.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 6-04-01: Author three reference contracts + reference-contracts.test.ts (CON-07, CON-01 round-trip)</name>
  <files>evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml, evals/fixtures/v2-test-vault/_contracts/project-status.yaml, evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml, src/contracts/reference-contracts.test.ts</files>
  <action>
    Author the three reference contracts as YAML files. Anchor each to SPECIFIC fixture documents verified at planning time:

    **`evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml`** (per RESEARCH Example 1, anchored to `meetings/2026-04-15-q2-okr-review.md`):
    ```yaml
    # Compile a meeting prep brief from the meeting note + linked context.
    # Output is a brief written into the _memory/_briefs/ sink.
    # Reference: ADR-006 §Decision 12, RESEARCH Example 1.
    version: 1
    name: meeting-prep
    description: |
      Compile a meeting prep brief from the meeting note + 1-hop linked context.
      Output is a brief written into the briefs sink. Useful for Q2-OKR-style
      review meetings where context across linked projects matters.
    inputs:
      meeting_doc_id:
        $ref: '#/types/DocId'
        description: DocId of the meeting note (e.g. obsidian-fs://test-vault/meetings/...).
      context_hops:
        type: integer
        minimum: 1
        maximum: 2
        default: 1
        description: How many wikilink hops to expand from the meeting note.
    required: [meeting_doc_id]
    sources:
      default_source:
        handle: 'obsidian-fs://test-vault'
        required: true
    sinks:
      default_sink:
        handle: '_memory/_briefs'  # MemorySink resolved via MemorySinkRegistry (D-A4c)
        required: true
    assembly:
      - as: meeting
        verb: read_note
        args:
          doc_id: '{{inputs.meeting_doc_id}}'
      - as: linked
        verb: expand
        args:
          seed_doc_ids: ['{{inputs.meeting_doc_id}}']
          hops: '{{inputs.context_hops}}'
          direction: both
      - as: clustered
        verb: cluster
        args:
          seed_doc_ids: '{{linked.doc_ids}}'
          method: edge-community
      - as: compiled
        verb: compile_brief
        args:
          vault: test-vault
          target: '{{inputs.meeting_doc_id}}--prep'
          source_doc_ids: '{{linked.doc_ids}}'
          purpose: 'Meeting prep brief for {{meeting.title}}'
          max_tokens: 2000
    output_shape:
      type: object
      properties:
        steps:
          type: object
        write_back:
          type: object
          properties:
            doc_id: { $ref: '#/types/DocId' }
          required: [doc_id]
      required: [write_back]
    write_back:
      sink: '{{default_sink}}'
      document_kind: brief
      properties:
        target: '{{inputs.meeting_doc_id}}--prep'
        source: agent
        purpose: 'Meeting prep brief'
      body_from: '{{compiled.body}}'
    ```

    **`evals/fixtures/v2-test-vault/_contracts/project-status.yaml`** (per RESEARCH Example 6, anchored to `projects/atlas-1.md`):
    Author similarly. Use `project_key` input (string, no $ref since it's a frontmatter key, not a DocId). `query_frontmatter` step uses `where: {project: '{{inputs.project_key}}'}`. Three-step assembly per Example 6.

    **`evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml`** (per RESEARCH Example 7, anchored to any meeting doc as `pr_doc_id` since no PR fixture exists — semantic flexibility intentional). Three-step assembly per Example 7.

    Each contract MUST:
    - Have a top-of-file comment block (3-5 lines) explaining purpose + ADR-006 reference.
    - Use ONLY baseline verbs (no `mcp://*` — CON-09 must work without peer-MCP setup).
    - Declare both `sources.default_source` (required) and `sinks.default_sink` (required, MemorySink target).
    - Have an `output_shape` matching Q-OUTPUT bundle shape (`{steps, write_back: {doc_id}}` at minimum).
    - Have a `write_back` block with `sink: '{{default_sink}}'`, `document_kind: brief`, `properties: {target, source: agent, purpose}`, `body_from: '{{compiled.body}}'`.

    Create `src/contracts/reference-contracts.test.ts` (fills the Plan 06-01 Wave-0 stub):

    ```typescript
    import { describe, it, expect } from "vitest";
    import { readFile } from "node:fs/promises";  // OK in tests
    import { parseDocument } from "yaml";
    import { ContractFileSchema } from "./schema.js";
    import { buildInputSchema } from "./input-schema.js";

    const FIXTURES = [
      "evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml",
      "evals/fixtures/v2-test-vault/_contracts/project-status.yaml",
      "evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml",
    ];

    describe("reference contracts (CON-07)", () => {
      for (const path of FIXTURES) {
        it(`validates: ${path}`, async () => {
          const text = await readFile(path, "utf8");
          const doc = parseDocument(text);
          const raw = doc.toJS();
          const validated = ContractFileSchema.safeParse(raw);
          expect(validated.success).toBe(true);
        });

        it(`builds inputZodSchema for: ${path}`, async () => {
          const text = await readFile(path, "utf8");
          const validated = ContractFileSchema.parse(parseDocument(text).toJS());
          const { zodSchema, jsonSchema } = buildInputSchema(validated.inputs, validated.required);
          expect(jsonSchema).toHaveProperty("additionalProperties", false);  // Pitfall F2
          expect(zodSchema._def.typeName).toBe("ZodObject");                  // Pitfall F1
        });
      }

      it(`CON-01 round-trip: meeting-prep comments preserved`, async () => {
        const text = await readFile("evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml", "utf8");
        const doc = parseDocument(text);
        const roundTripped = doc.toString();
        expect(roundTripped).toBe(text);
      });
    });
    ```

    Note: this test uses `node:fs/promises` for reading fixture files. That's allowed in `.test.ts` files via the lint-adapters filename-based exclusion (`--exclude='*.test.ts'` in `scripts/lint-adapters.sh` ~line 54 — confirmed by 06-01 Task 5 discovery). No escape marker needed. Phase 5's `src/brief/lock.ts` uses the `// vault-memory:claude-ok` ESCAPE_MARK because it's a non-test production file; that pattern does NOT apply to test files.
  </action>
  <verify>
    <automated>test -f evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml && test -f evals/fixtures/v2-test-vault/_contracts/project-status.yaml && test -f evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml && npx vitest run src/contracts/reference-contracts.test.ts && bash scripts/lint-adapters.sh</automated>
  </verify>
  <done>Three reference contracts authored + validated by ContractFileSchema; buildInputSchema produces ZodObject with additionalProperties:false for each; CON-01 round-trip verified on meeting-prep; lint-adapters zero hits.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-04-02: Eval scenarios (CON-08) + stub-parity proof (CON-10)</name>
  <files>evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml, evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml, evals/fixtures/v2-test-vault/_queries/contracts-code-review-brief.yaml, evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml, src/adapters/source/conformance.test.ts</files>
  <behavior>
    - Test 1 (CON-08): Each of the 4 eval scenario YAMLs parses cleanly as YAML with the documented shape `{description, scenarios: [{name, contract, inputs, expected_output_shape, expected_write_back?}]}`.
    - Test 2 (CON-08 meeting-prep eval runs): Loading `_queries/contracts-meeting-prep.yaml` and running its first scenario via `instantiateContract(deps, {name, inputs})` against the obsidian-fs SourceConnector + a populated `_contracts/` + a populated `meetings/` produces a result whose `bundle.write_back.doc_id` matches `^obsidian-fs://test-vault/_memory/_briefs/.*` (the expected_output_shape pattern).
    - Test 3 (CON-08 expected_write_back assertions): The eval scenario `expected_write_back: {sink, properties_required: [target, source, compiled_from, compiled_at]}` validates that after instantiation, the written brief's properties include those keys (MEM-05 compliance per Phase 2). The eval harness reads the written brief back via `SourceConnector.readDocument(bundle.write_back.doc_id)` and asserts `properties` contains the required keys.
    - Test 4 (CON-10 stub-parity): `src/adapters/source/conformance.test.ts` gains a `describe('contracts stub-parity (CON-10)')` block that:
        a. Parametric on `[obsidianFsSource, stubSource]` (same shape as Phase 3 ASM-12).
        b. For each, instantiates `meeting-prep` with the appropriate `source_overrides` (`stub://test-fixture` for the stub run; default for the obsidian-fs run).
        c. Captures `result.write_back` shape from both runs.
        d. Asserts: both runs produce a `write_back.doc_id` matching the configured sink prefix (`_memory/_briefs/`); both runs' `result.steps` keys are identical (`meeting, linked, clustered, compiled`); both runs' `result.write_back.properties` contain the required MEM-05 keys.
        e. Does NOT compare the brief BODY (LLM variance + stub uses different source content) — only the SHAPE.
    - Test 5: All 1346+ tests + Plans 06-01/02/03 tests + Task 6-04-01 stay green.
  </behavior>
  <action>
    Author the four eval scenario YAMLs per RESEARCH Examples 8 + 9 + 06-CONTEXT.md `<specifics>`:

    **`evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml`** (per RESEARCH Example 8):
    ```yaml
    # CON-08 eval — meeting-prep contract against Atlas Robotics fixture.
    description: meeting-prep contract against Atlas Robotics fixture
    scenarios:
      - name: q2-okr-review
        contract: meeting-prep
        inputs:
          meeting_doc_id: 'obsidian-fs://test-vault/meetings/2026-04-15-q2-okr-review.md'
          context_hops: 1
        expected_output_shape:
          steps:
            type: object
          write_back:
            type: object
            properties:
              doc_id:
                type: string
                pattern: '^obsidian-fs://test-vault/_memory/_briefs/'
            required: [doc_id]
        expected_write_back:
          sink: '_memory/_briefs'
          properties_required: [target, source, compiled_from, compiled_at]
    ```

    **`evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml`**:
    ```yaml
    description: project-status contract against Atlas Robotics fixture
    scenarios:
      - name: atlas-1-status
        contract: project-status
        inputs:
          project_key: 'atlas-1'
          freshness_days: 30
        expected_output_shape:
          steps: { type: object }
          write_back:
            type: object
            properties:
              doc_id: { type: string, pattern: '^obsidian-fs://test-vault/_memory/_briefs/' }
            required: [doc_id]
        expected_write_back:
          sink: '_memory/_briefs'
          properties_required: [target, source, compiled_from, compiled_at]
    ```

    **`evals/fixtures/v2-test-vault/_queries/contracts-code-review-brief.yaml`** — same shape, anchored to whichever fixture doc was used in Task 6-04-01 for `code-review-brief.yaml`.

    **`evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml`** (per RESEARCH Example 9):
    ```yaml
    # CON-10 stub-parity — same contract, two source handles, same output shape.
    description: CON-10 stub-parity — same contract, two source handles, same output shape
    scenarios:
      - name: meeting-prep-stub-vs-obsidian-fs
        contract: meeting-prep
        inputs:
          meeting_doc_id: 'stub://test-fixture/meeting-1'
          context_hops: 1
        source_overrides:
          default_source: 'stub://test-fixture'
        expected_output_shape_matches:
          reference: q2-okr-review  # named scenario in contracts-meeting-prep.yaml
    ```

    Extend `src/adapters/source/conformance.test.ts` with a new top-level describe block. Locate the existing parametric `describe.each([['obsidian-fs', () => makeObsidianFsSource(...)], ['stub', () => makeStubSource(...)]])` invocation (Phase 3 ASM-12 / Phase 5 BRF-11 established pattern). Append the new block alongside the existing ones.

    **Q-CI-LLM resolution — mock `compile_brief` in CI evals (option b).** Per ADR-006 §Q-CI-LLM (added in WARNING 4 patch), the CON-08 + CON-10 eval scenarios MUST NOT invoke a real LLM in CI. The deps object passed to `instantiateContract` overrides `handleCompileBrief` with a deterministic stub: `(args) => ({ok: true, doc_id: 'obsidian-fs://test-vault/_memory/_briefs/<deterministic-slug>.md', body: '# Stub brief for ' + args.target + '\n## Sources\n' + args.source_doc_ids.map(d => '- [[' + d + ']]').join('\n')})`. This proves the orchestrator (steps 1-3 + write_back path) without coupling CI to Ollama version drift or MCP Sampling client availability. Phase 5's own tests already prove the LLM ladder.

    ```typescript
    describe.each([
      ['obsidian-fs', () => makeObsidianFsSource(testVaultPath)],
      ['stub', () => makeStubSource(stubFixtureDocs)],
    ])('contracts stub-parity (CON-10) parametric over %s', (sourceFactoryName, sourceFactory) => {
      // ... existing shared setup ...

      it('meeting-prep produces same output_shape against this source', async () => {
        const source = sourceFactory();
        // Bootstrap registry by manually loading meeting-prep.yaml into the registry (Plan 06-01 schema + Plan 06-03 instantiate)
        const registry = new ContractRegistry();
        const text = await readFile(MEETING_PREP_YAML, 'utf8');
        const parsed = ContractFileSchema.parse(parseDocument(text).toJS());
        const { zodSchema, jsonSchema } = buildInputSchema(parsed.inputs, parsed.required);
        registry.set(parsed.name, { ...parsed, inputZodSchema: zodSchema, inputJsonSchema: jsonSchema });

        // Q-CI-LLM: mock compile_brief so CI eval is deterministic + LLM-free.
        const mockCompileBrief = vi.fn(async (args: any) => ({
          ok: true,
          doc_id: 'obsidian-fs://test-vault/_memory/_briefs/' + args.target.replace(/[^a-z0-9-]/gi, '_') + '.md',
          body: '# Stub brief for ' + args.target + '\n## Sources\n' + (args.source_doc_ids ?? []).map((d: string) => '- [[' + d + ']]').join('\n'),
        }));

        const result = await instantiateContract(
          buildTestInstantiateDeps({
            registry, source,
            ...stubDeliveryAdapter, ...stubMemorySinks,
            handleCompileBrief: mockCompileBrief,
          }),
          {
            name: 'meeting-prep',
            inputs: { meeting_doc_id: ..., context_hops: 1 },
            source_overrides: sourceFactoryName === 'stub' ? { default_source: 'stub://test-fixture' } : undefined,
          },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.write_back).not.toBeNull();
        expect(result.write_back?.doc_id).toMatch(/_memory\/_briefs\//);
        expect(Object.keys(result.steps).sort()).toEqual(['clustered', 'compiled', 'linked', 'meeting']);
        // CON-10 shape parity: assert mockCompileBrief was called with the same source_doc_ids shape regardless of source connector.
        expect(mockCompileBrief).toHaveBeenCalledWith(expect.objectContaining({
          target: expect.any(String),
          source_doc_ids: expect.any(Array),
          purpose: expect.any(String),
        }));
      });
    });
    ```

    The stub-parity assertion is: the SHAPE of the result is identical between the obsidian-fs and stub runs. Body content from the mock is also identical-shape because we control the mock. CON-10 is now a CLEAN structural proof — no LLM noise, no Ollama dependency.

    **Eval-runner location — locked: inline vitest at `src/contracts/eval-runner.test.ts`** (WARNING 2 resolution). Discovery confirmed `evals/scripts/` does not exist; no eval-harness convention to extend. Create a self-contained vitest file that:
    1. Reads each `evals/fixtures/v2-test-vault/_queries/contracts-*.yaml` via `node:fs/promises` (test-file carve-out per lint-adapters `--exclude='*.test.ts'`).
    2. Parses with `parseDocument` + `.toJS()`.
    3. For each scenario in each file: loads the contract from `_contracts/<name>.yaml`, builds a `TestInstantiateDeps` (with the same `mockCompileBrief` from above), runs `instantiateContract(deps, {name, inputs, source_overrides})`, asserts:
       - `result.ok === true`
       - the bundle satisfies the scenario's `expected_output_shape` via `z.fromJSONSchema(expected_output_shape).safeParse(result).success === true`
       - (when present) the resolved `write_back` properties contain every key in `expected_write_back.properties_required`
    4. For `contracts-stub-parity.yaml`: also asserts the bundle shape matches the referenced obsidian-fs scenario from `contracts-meeting-prep.yaml` (run both, compare `Object.keys(result.steps).sort()` + `result.write_back?.sink`).

    Skeleton (inline so the executor has the exact wiring):
    ```typescript
    // src/contracts/eval-runner.test.ts
    import { describe, it, expect, vi } from "vitest";
    import { readFile } from "node:fs/promises";
    import { parseDocument } from "yaml";
    import { z } from "zod";
    import { ContractFileSchema } from "./schema.js";
    import { buildInputSchema } from "./input-schema.js";
    import { ContractRegistry } from "./registry.js";
    import { instantiateContract } from "./instantiate.js";
    // ... import test helpers (stubDeliveryAdapter, stubMemorySinks, buildTestInstantiateDeps) ...

    const SCENARIO_FILES = [
      "evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml",
      "evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml",
      "evals/fixtures/v2-test-vault/_queries/contracts-code-review-brief.yaml",
      "evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml",
    ];

    describe("contract eval scenarios (CON-08 + CON-10)", () => {
      for (const file of SCENARIO_FILES) {
        it("runs every scenario in " + file, async () => {
          const yamlText = await readFile(file, "utf8");
          const scenarioDoc = parseDocument(yamlText).toJS() as { scenarios: any[] };
          for (const scenario of scenarioDoc.scenarios) {
            // Load contract from _contracts/<name>.yaml
            const contractText = await readFile("evals/fixtures/v2-test-vault/_contracts/" + scenario.contract + ".yaml", "utf8");
            const parsed = ContractFileSchema.parse(parseDocument(contractText).toJS());
            const { zodSchema, jsonSchema } = buildInputSchema(parsed.inputs, parsed.required);
            const registry = new ContractRegistry();
            registry.set(parsed.name, { ...parsed, inputZodSchema: zodSchema, inputJsonSchema: jsonSchema });

            const mockCompileBrief = vi.fn(async (args: any) => ({
              ok: true,
              doc_id: "obsidian-fs://test-vault/_memory/_briefs/" + String(args.target).replace(/[^a-z0-9-]/gi, "_") + ".md",
              body: "# Stub brief for " + args.target,
            }));

            const result = await instantiateContract(
              buildTestInstantiateDeps({ registry, handleCompileBrief: mockCompileBrief }),
              {
                name: scenario.contract,
                inputs: scenario.inputs,
                source_overrides: scenario.source_overrides,
              },
            );
            expect(result.ok, JSON.stringify(result)).toBe(true);
            if (!result.ok) return;
            if (scenario.expected_output_shape) {
              const outSchema = z.fromJSONSchema(scenario.expected_output_shape);
              expect(outSchema.safeParse(result).success).toBe(true);
            }
            // Stub-parity scenario: also assert reference run produces same shape.
            if (scenario.expected_output_shape_matches?.reference) {
              // Re-run the reference scenario (from contracts-meeting-prep.yaml) and compare step keys + write_back.sink.
              // ... (executor fills in the lookup of the named reference scenario) ...
            }
          }
        });
      }
    });
    ```

    Adapter-seam: tests use `node:fs/promises` + `yaml`; lint-adapters EXCLUDES `*.test.ts` via `--exclude='*.test.ts'` (verified by reading scripts/lint-adapters.sh:54). No escape marker needed for test files; the carve-out is filename-based.
  </action>
  <verify>
    <automated>test -f evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml && test -f evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml && test -f evals/fixtures/v2-test-vault/_queries/contracts-code-review-brief.yaml && test -f evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml && npx vitest run src/contracts/eval-runner.test.ts src/adapters/source/conformance.test.ts && bash scripts/lint-adapters.sh && npm test</automated>
  </verify>
  <done>4 eval YAMLs ship with documented shape; src/contracts/eval-runner.test.ts (inline vitest, no harness coupling) runs every scenario against instantiateContract with mocked compile_brief (Q-CI-LLM option b); conformance suite extended with `contracts stub-parity (CON-10)` block parametric over obsidian-fs + stub; CON-08 + CON-10 green deterministically (zero Ollama dependency); 1346+ tests + Plans 06-01/02/03 + Task 6-04-01 stay green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-04-03: list_contracts + list_contract_verbs MCP Resources (CON-04, D-A2b)</name>
  <files>src/contracts/resources.ts, src/contracts/resources.test.ts, src/contracts/index.ts, src/memory/resources/index.ts, src/server.ts</files>
  <behavior>
    - Test 1 (list_contracts shape): `readListContracts(deps, {vault: 'my-vault'})` returns `{total: N, contracts: [{name, description, vault, source_count, sink_count, write_back: boolean}]}` for each contract in the named vault's registry.
    - Test 2 (list_contracts source filter): With `opts.source` provided, only contracts whose `sources.default_source.handle.startsWith(opts.source)` (or contracts whose ANY source matches the prefix) are returned. CON-04 spec says `list_contracts({source?})` — interpret as: filter to contracts that declare a source matching the given handle prefix.
    - Test 3 (list_contracts no vault arg): When `opts.vault` is omitted, the Resource handler aggregates across all vaults (matches Phase 5 `list_briefs` behavior).
    - Test 4 (list_contract_verbs baseline section): `readListContractVerbs(deps, {vault: 'my-vault'})` returns `{baseline: [<11 verbs>], custom: [...]}`. The 11 baseline verbs are constant (per ADR-006 §Decision 3): `['search_hybrid', 'expand', 'cluster', 'recall', 'compile_brief', 'get_brief', 'query_frontmatter', 'list_backlinks', 'get_outline', 'search_sections', 'read_note']`. The `literal` verb is intentionally NOT in this list (it's an escape-hatch, not a callable verb).
    - Test 5 (list_contract_verbs custom section — declared): Each entry from `[contracts.mcp_clients.<name>]` config produces a "declared" custom verb entry per server (lists the tools the peer-MCP server EXPOSES — but we can't enumerate those without calling `client.listTools()`; for v2.0.0, list the SERVER names and note that specific tools surface only after a contract references them). Simpler implementation: only show verbs that have been EXERCISED (invocation_count > 0) — `aggregateVerbUsage` returns those. Plan 06-04 chooses: show `custom: aggregateVerbUsage(vault) filtered to verbs starting with 'mcp://'`. The `declared_in: '[contracts.mcp_clients]'` field is set to a constant for clarity.
    - Test 6 (list_contract_verbs custom section — usage): With seed data of 3 `contract_audit` rows for `mcp://gh/list_issues` + 2 rows for `search_hybrid`, the response's `custom` array contains `[{verb: 'mcp://gh/list_issues', declared_in: '[contracts.mcp_clients.gh]', used_by_contracts: [<contract names from audit>], invocation_count: 3, last_seen: <ts>}]`. The `search_hybrid` rows are NOT in `custom` (it's baseline) but contribute to potential future baseline-usage metrics (not in v2.0.0 scope per CONTEXT.md Deferred).
    - Test 7 (list_contract_verbs used_by_contracts): The `used_by_contracts` field is computed by querying `contract_audit` for distinct `contract` values where `verb = <verb>` AND `vault = <vault>`. Add a new query method `contractAudit.contractsUsingVerb(verb, vault)` if needed; alternative: extend `aggregateVerbUsage` to include this field.
    - Test 8 (Resources registered in server.ts): `server.registerResource('contracts', 'vault-memory://contracts/{vault}', {...}, handler)` and `server.registerResource('contract-verbs', 'vault-memory://contract-verbs/{vault}', {...}, handler)` are both registered at server boot.
    - Test 9 (snapshot unchanged): `evals/v1-baseline/tools-list.snapshot.json` is BYTE-IDENTICAL to its post-Plan-06-03 state (37 entries). MCP Resources do NOT appear in the tools snapshot per Phase 5 BRF-09 precedent.
    - Test 10: All 1346+ tests + Plans 06-01/02/03 tests + Tasks 6-04-01/02 stay green.
  </behavior>
  <action>
    Implement `src/contracts/resources.ts` per RESEARCH §M (Pattern: MCP Resource handler, mirrors `src/brief/resources.ts`):

    ```typescript
    import type { ContractRegistry } from "./registry.js";
    import type { ContractAuditQueries } from "../db/queries/contract-audit.js";
    import type { PeerMcpRegistry } from "./mcp-clients.js";

    export interface ListContractsDeps {
      registry: ContractRegistry;
      vaultName: string;
    }

    export interface ListContractsEntry {
      name: string;
      description: string;
      vault: string;
      source_count: number;
      sink_count: number;
      write_back: boolean;
    }

    export interface ListContractsResource {
      total: number;
      contracts: ListContractsEntry[];
    }

    export function readListContracts(deps: ListContractsDeps, opts: { source?: string } = {}): ListContractsResource {
      const contracts: ListContractsEntry[] = [];
      for (const [name, parsed] of deps.registry.entries()) {
        if (opts.source) {
          const anyMatch = Object.values(parsed.sources).some(s => s.handle.startsWith(opts.source!));
          if (!anyMatch) continue;
        }
        contracts.push({
          name,
          description: parsed.description,
          vault: deps.vaultName,
          source_count: Object.keys(parsed.sources).length,
          sink_count: Object.keys(parsed.sinks).length,
          write_back: !!parsed.write_back,
        });
      }
      return { total: contracts.length, contracts };
    }

    const BASELINE_VERBS = [
      "search_hybrid", "expand", "cluster", "recall",
      "compile_brief", "get_brief", "query_frontmatter",
      "list_backlinks", "get_outline", "search_sections", "read_note",
    ] as const;

    export interface ListContractVerbsDeps {
      registry: ContractRegistry;
      contractAudit: ContractAuditQueries;
      vaultName: string;
    }

    export interface ListContractVerbsEntry {
      verb: string;
      declared_in: string;
      used_by_contracts: string[];
      invocation_count: number;
      last_seen: number;
    }

    export interface ListContractVerbsResource {
      baseline: readonly string[];
      custom: ListContractVerbsEntry[];
    }

    export function readListContractVerbs(deps: ListContractVerbsDeps): ListContractVerbsResource {
      const usage = deps.contractAudit.aggregateVerbUsage(deps.vaultName);
      const custom = usage
        .filter(u => u.verb.startsWith("mcp://"))
        .map(u => ({
          verb: u.verb,
          declared_in: extractServerName(u.verb),
          used_by_contracts: contractsUsingVerb(deps.contractAudit, u.verb, deps.vaultName),
          invocation_count: u.invocation_count,
          last_seen: u.last_seen,
        }));
      return { baseline: BASELINE_VERBS, custom };
    }

    function extractServerName(verb: string): string {
      const m = verb.match(/^mcp:\/\/([a-z][a-z0-9_-]*)\//);
      return m ? `[contracts.mcp_clients.${m[1]}]` : "[contracts.mcp_clients]";
    }

    function contractsUsingVerb(audit: ContractAuditQueries, verb: string, vault: string): string[] {
      // Helper that lists DISTINCT contract values from contract_audit where verb = ? AND vault = ?.
      // If contractAudit doesn't already expose this, add a method in this same task (mirror aggregateVerbUsage pattern).
      const rows = audit.listByKind("contract_step", { vault });
      const names = new Set<string>();
      for (const r of rows) {
        if (r.verb === verb && r.contract) names.add(r.contract);
      }
      return Array.from(names).sort();
    }
    ```

    Export from `src/contracts/index.ts` barrel: `export { readListContracts, readListContractVerbs, type ListContractsResource, type ListContractVerbsResource } from "./resources.js";`.

    Add to `src/memory/resources/index.ts`:
    ```typescript
    export const RESOURCE_URI_LIST_CONTRACTS = "vault-memory://contracts";
    export const RESOURCE_URI_LIST_CONTRACT_VERBS = "vault-memory://contract-verbs";
    ```

    Register in `src/server.ts` after the existing Phase 5 `list_briefs` registration:
    ```typescript
    server.registerResource(
      "contracts",
      RESOURCE_URI_LIST_CONTRACTS + "/{vault}",
      { description: "List task contracts available in a vault (CON-04)." },
      async (uri) => {
        const vault = extractVaultFromUri(uri);
        const reg = contractRegistries.get(vault)?.registry;
        if (!reg) return errorResource(`unknown vault: ${vault}`);
        return okResource(readListContracts({ registry: reg, vaultName: vault }));
      },
    );
    server.registerResource(
      "contract-verbs",
      RESOURCE_URI_LIST_CONTRACT_VERBS + "/{vault}",
      { description: "List baseline + custom (mcp://) verbs in use, with invocation_count (D-A2b)." },
      async (uri) => {
        const vault = extractVaultFromUri(uri);
        const reg = contractRegistries.get(vault)?.registry;
        const v = vaultManager.vaults.get(vault);
        if (!reg || !v) return errorResource(`unknown vault: ${vault}`);
        return okResource(readListContractVerbs({
          registry: reg,
          contractAudit: v.db.contractAudit,
          vaultName: vault,
        }));
      },
    );
    ```

    Mirror the existing Phase 5 `list_briefs` envelope shape — `okResource(payload)` returns `{contents: [{uri, mimeType: 'application/json', text: JSON.stringify(payload)}]}`.

    Co-locate `resources.test.ts` with the 10 Behavior cases.

    Verify `evals/v1-baseline/tools-list.snapshot.json` is unchanged after this slice: `diff` against the post-Plan-06-03 version shows zero changes. MCP Resources DO NOT appear in the tools snapshot.

    Adapter-seam: `src/contracts/resources.ts` is pure (registry + DB reads). `src/server.ts` wires (allowed).
  </action>
  <verify>
    <automated>npx vitest run src/contracts/resources.test.ts && npm test && bash scripts/lint-adapters.sh && diff <(jq -S '.' evals/v1-baseline/tools-list.snapshot.json) <(jq -S '.' evals/v1-baseline/tools-list.snapshot.json) >/dev/null</automated>
  </verify>
  <done>readListContracts + readListContractVerbs ship; both Resources registered at boot; CON-04 + D-A2b materialized; tools snapshot UNCHANGED (Resources don't count toward REL-08 budget); 1346+ tests + Plans 06-01/02/03 + Tasks 6-04-01/02 stay green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-04-04: CON-09 non-Claude smoketest extension</name>
  <files>scripts/smoketest-non-claude.mjs</files>
  <behavior>
    - Test 1 (smoketest exits 0): `node scripts/smoketest-non-claude.mjs` against a fixture vault containing `evals/fixtures/v2-test-vault/_contracts/*.yaml` exits with status 0.
    - Test 2 (tools/list assertion): The smoketest verifies `tools/list` response contains the entries `describe_contract`, `instantiate_contract`, `register_contracts_as_tools`. Missing any → smoketest exits with non-zero status + structured error.
    - Test 3 (describe_contract call): The smoketest calls `client.callTool({name: 'describe_contract', arguments: {name: 'meeting-prep'}})` and asserts the response contains both `json_schema` and `summary` keys after parsing the MCP envelope.
    - Test 4 (instantiate_contract call): The smoketest calls `client.callTool({name: 'instantiate_contract', arguments: {name: 'meeting-prep', inputs: {meeting_doc_id: 'obsidian-fs://test-vault/meetings/2026-04-15-q2-okr-review.md', context_hops: 1}}})` and asserts the response's parsed JSON is `{ok: true, steps: ..., write_back: {doc_id: ..., sink: ...}}`.
    - Test 5 (list_contracts MCP Resource): The smoketest calls `client.readResource({uri: 'vault-memory://contracts/<vault-name>'})` and asserts the response includes the three reference contracts.
    - Test 6 (Phase 1 ADP-10 regression): All existing smoketest assertions (tools/list contains v1 tools, search_hybrid works, etc.) continue to pass — the extension is additive.
  </behavior>
  <action>
    Read the existing `scripts/smoketest-non-claude.mjs` to understand its structure (likely a single Node ESM script that spawns `vault-memory serve` via `StdioClientTransport`, connects an SDK `Client`, runs assertions, exits with the result).

    Extend the script at the END (after existing assertions) with a Phase 6 block:

    ```javascript
    // ============================================================
    // Phase 6 — CON-09 non-Claude contract smoketest
    // ============================================================
    console.error("[smoketest] Phase 6 — listing tools…");
    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map(t => t.name));
    assert(toolNames.has("describe_contract"), "describe_contract missing from tools/list");
    assert(toolNames.has("instantiate_contract"), "instantiate_contract missing from tools/list");
    assert(toolNames.has("register_contracts_as_tools"), "register_contracts_as_tools missing from tools/list");
    console.error("[smoketest] Phase 6 — 3 contract tools present ✓");

    console.error("[smoketest] Phase 6 — describe_contract…");
    const describe = await client.callTool({ name: "describe_contract", arguments: { name: "meeting-prep" } });
    const describePayload = JSON.parse(describe.content[0].text);
    assert(describePayload.json_schema, "describe_contract missing json_schema");
    assert(describePayload.summary && describePayload.summary.includes("## Inputs"), "describe_contract summary missing or malformed");
    console.error("[smoketest] Phase 6 — describe_contract ✓");

    console.error("[smoketest] Phase 6 — instantiate_contract (meeting-prep)…");
    const instantiate = await client.callTool({
      name: "instantiate_contract",
      arguments: {
        name: "meeting-prep",
        inputs: {
          meeting_doc_id: "obsidian-fs://test-vault/meetings/2026-04-15-q2-okr-review.md",
          context_hops: 1,
        },
      },
    });
    const instantiatePayload = JSON.parse(instantiate.content[0].text);
    assert(instantiatePayload.ok === true, `instantiate_contract failed: ${JSON.stringify(instantiatePayload)}`);
    assert(instantiatePayload.steps, "instantiate_contract missing steps");
    assert(instantiatePayload.write_back, "instantiate_contract missing write_back");
    assert(instantiatePayload.write_back.doc_id, "instantiate_contract write_back.doc_id missing");
    console.error("[smoketest] Phase 6 — instantiate_contract ✓");

    console.error("[smoketest] Phase 6 — list_contracts MCP Resource…");
    const resources = await client.readResource({ uri: "vault-memory://contracts/test-vault" });
    const resPayload = JSON.parse(resources.contents[0].text);
    assert(resPayload.total >= 3, `list_contracts expected ≥3 contracts, got ${resPayload.total}`);
    const names = resPayload.contracts.map(c => c.name);
    assert(names.includes("meeting-prep"), "list_contracts missing meeting-prep");
    assert(names.includes("project-status"), "list_contracts missing project-status");
    assert(names.includes("code-review-brief"), "list_contracts missing code-review-brief");
    console.error("[smoketest] Phase 6 — list_contracts Resource ✓");
    ```

    Pre-requisite for the smoketest: the spawned `vault-memory serve` process must be configured to point at the `evals/fixtures/v2-test-vault/` directory (or a temp copy) so the `_contracts/*.yaml` files are discovered. Inspect the existing smoketest's vault setup to confirm or extend.

    For the instantiate_contract call to succeed end-to-end, the compile_brief verb needs an LLM strategy resolved (Phase 5 D-10 ladder). The smoketest environment likely lacks both MCP Sampling and Ollama, so use the `prepared_text` Tier-3 escape: modify the smoketest to either (a) pre-set `[brief.ollama]` config in the fixture, or (b) extend the test to pass `prepared_text` via override — BUT the meeting-prep contract doesn't expose `prepared_text` as an input.

    Pragmatic alternative for CON-09: author a `_contracts/smoketest-trivial.yaml` reference contract that uses ONLY the `literal` verb (no LLM required) and a `write_back` block that writes a stub brief body. Use THIS contract for the smoketest's `instantiate_contract` call. The three "real" reference contracts still validate via `describe_contract` (which doesn't run assembly).

    Choice for Plan 06-04: ship the `smoketest-trivial.yaml` companion contract in `evals/fixtures/v2-test-vault/_contracts/` and use it for the instantiate_contract smoketest assertion. This decouples CON-09 from Phase 5's LLM ladder availability in CI.

    ```yaml
    # _contracts/smoketest-trivial.yaml — CON-09 anchor contract; uses literal-only for LLM-free smoketest.
    version: 1
    name: smoketest-trivial
    description: |
      Trivial contract for the CON-09 non-Claude smoketest. Uses literal-only
      assembly to avoid requiring an LLM in CI environments. Real reference
      contracts (meeting-prep, project-status, code-review-brief) ship for
      describe_contract validation; this one exists for end-to-end instantiation.
    inputs:
      message:
        type: string
        description: Message to embed in the trivial brief body.
    required: [message]
    sources:
      default_source:
        handle: 'obsidian-fs://test-vault'
        required: false
    sinks:
      default_sink:
        handle: '_memory/_briefs'
        required: true
    assembly:
      - as: payload
        verb: literal
        value: '{{inputs.message}}'
    output_shape:
      type: object
      properties:
        steps: { type: object }
        write_back:
          type: object
          properties:
            doc_id: { $ref: '#/types/DocId' }
          required: [doc_id]
    write_back:
      sink: '{{default_sink}}'
      document_kind: custom
      properties:
        target: 'smoketest-trivial'
        source: agent
        purpose: 'CON-09 smoketest output'
      body_from: '{{payload}}'
    ```

    Adjust the smoketest to use `name: 'smoketest-trivial', inputs: {message: 'hello from CON-09'}` for the `instantiate_contract` call. The `describe_contract` call still targets `meeting-prep` to exercise the full Q-DESCRIBE rendering path.
  </action>
  <verify>
    <automated>node scripts/smoketest-non-claude.mjs</automated>
  </verify>
  <done>Smoketest extended; tools/list assertions for the 3 new tools pass; describe_contract returns {json_schema, summary}; instantiate_contract on smoketest-trivial returns {ok: true, write_back: {doc_id}}; list_contracts Resource returns ≥3 contracts; Phase 1 ADP-10 regression assertions remain green; smoketest exits 0.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-04-05: PHASE-6-SIGN-OFF doc + CHANGELOG + ROADMAP checkbox flip</name>
  <files>docs/v2/PHASE-6-SIGN-OFF.md, CHANGELOG.md, .planning/ROADMAP.md</files>
  <behavior>
    - Test 1: `docs/v2/PHASE-6-SIGN-OFF.md` exists with the documented sections (Phase Summary, Requirements Coverage, ROADMAP Success Criteria Coverage, ADR-006 Decision Traceability, Tool Surface Inventory, Test Floor, Known Limitations / Out-of-Scope, Sign-off).
    - Test 2: Sign-off doc has a "Requirements Coverage" table with all 12 CON-* requirements + their status (all "Complete" with commit SHA references where applicable) and their plan-of-record (06-01 / 06-02 / 06-03 / 06-04).
    - Test 3: Sign-off doc has a "ROADMAP Success Criteria Coverage" section mapping all 5 ROADMAP criteria to specific tests/evals: (1) CON-09 smoketest; (2) Tasks 6-04-01 + 6-04-02 reference-contracts.test.ts + eval scenarios green; (3) CON-10 conformance.test.ts block green; (4) reference-contracts.test.ts validates schema + buildInputSchema + round-trip; (5) ADR-006 exists with Decision 1 (Tools vs Prompts) + Decision 9 (yaml@2.9 rationale).
    - Test 4: Sign-off doc has an "ADR-006 Decision Traceability" table mapping D-A1 → commit SHA(s), D-A2a → SHA, D-A3a/b → SHA, D-A4c → SHA, D-LOAD → SHA. Use `git log --oneline` output to fill these in at sign-off time.
    - Test 5: Sign-off doc has a "Tool Surface Inventory" section: 34 → 37 tools (additive); 2 new MCP Resources (don't count toward budget); REL-08 reconciliation explicitly deferred to Phase 8 per RESEARCH §F7.
    - Test 6: Sign-off doc has a "Known Limitations / Out-of-Scope" section listing the CONTEXT.md `<deferred>` items (macros, in-process TS plugins, MCP Prompts, cross-vault contracts, per-step retries, audit retention, per-vault snapshot variants, LLM-generated list_contracts summaries, contract versioning beyond 1, GraphQL query language, contract composition).
    - Test 7: `CHANGELOG.md` `[Unreleased]` section gains the documented Added entries.
    - Test 8: `.planning/ROADMAP.md` Phase 6 checkbox is `[x]` with a one-line completion summary referencing `docs/v2/PHASE-6-SIGN-OFF.md`.
    - Test 9: All 1346+ existing tests + Plans 06-01/02/03 + Tasks 6-04-01/02/03/04 tests stay green.
  </behavior>
  <action>
    Author `docs/v2/PHASE-6-SIGN-OFF.md` per the analog `docs/v2/PHASE-5-SIGN-OFF.md`. Sections:

    1. `# Phase 6 Sign-Off — Task Contract DSL` header + completion date.
    2. `## Phase Summary` — 1 paragraph: what shipped, what surface area expanded, what's NOT in scope (per CONTEXT.md `<deferred>`).
    3. `## Requirements Coverage` — table:

       | ID | Description | Status | Plan | Commit |
       |----|-------------|--------|------|--------|
       | CON-01 | Contract schema YAML + Zod | Complete | 06-01 + 06-02 | <sha> |
       | CON-02 | Documents in `_contracts/` | Complete | 06-02 | <sha> |
       | ... (all 12 CON-*) ...
    4. `## ROADMAP Success Criteria Coverage` — list all 5 ROADMAP criteria with their evidence (test files + commit SHAs).
    5. `## ADR-006 Decision Traceability` — table mapping the 12 key decisions to commit SHAs.
    6. `## Tool Surface Inventory` — pre-Phase-6: 34; post: 37 (+ 2 MCP Resources). REL-08 reconciliation deferred to Phase 8.
    7. `## Test Floor` — 1346+ pre-Phase-6; XXXX+ post (count actual at sign-off time via `npm test 2>&1 | tail`).
    8. `## Known Limitations / Out-of-Scope` — bullet list of all `<deferred>` items from CONTEXT.md.
    9. `## Maintainer Sign-Off` — empty signature line for human review.

    For the commit SHAs (Sections 3 + 5 + 6), use the actual SHAs from `git log --oneline` for Plans 06-01/02/03/04 — capture at sign-off time.

    Append to `CHANGELOG.md` `[Unreleased]` section:
    ```markdown
    ### Added
    - **Task Contract DSL (Phase 6)** — declarative YAML contracts in `_contracts/*.yaml`, addressable by name, instantiable via MCP, with handle-based source/sink portability.
    - 3 new MCP tools: `describe_contract`, `instantiate_contract`, `register_contracts_as_tools`. Tool count: 34 → 37.
    - 2 new MCP Resources: `list_contracts` (`vault-memory://contracts/{vault}`) and `list_contract_verbs` (`vault-memory://contract-verbs/{vault}`).
    - 3 reference contracts in `evals/fixtures/v2-test-vault/_contracts/`: `meeting-prep`, `project-status`, `code-review-brief`.
    - ADR-006 — task contract DSL: dual MCP surface, closed verb enum + literal + mcp:// extension, JSON-Schema-with-$ref input shape, MemorySink-only sink invariant, ChangeFeed hot reload.
    - Migration 014: `contract_audit` table (orchestration events; baseline-verb-promotion signal per D-A2b).
    - Per-vault `[contracts]` config block: `auto_register_tools` (default false), `tool_prefix` (default `vm_`), `step_timeout_seconds` (default 30), `defaults`, `mcp_clients`.
    - `instantiate_contract` write_back routes through `DeliveryAdapter.write()` (MEM-05 chokepoint preserved; sink_overrides MUST resolve to a registered MemorySink — Phase 2 invariant un-bypassable by construction).
    ```

    Flip `.planning/ROADMAP.md` Phase 6 checkbox `[ ]` → `[x]` with a one-line completion summary at the end of the Phase 6 entry:
    ```markdown
    - [x] **Phase 6: Task contract DSL** - YAML+Zod contracts; list/describe/instantiate via MCP (Complete 2026-XX-XX — see `docs/v2/PHASE-6-SIGN-OFF.md`)
    ```

    Adapter-seam: doc files; no code changes. No lint-adapters concern.
  </action>
  <verify>
    <automated>test -f docs/v2/PHASE-6-SIGN-OFF.md && grep -q "Phase 6 Sign-Off" docs/v2/PHASE-6-SIGN-OFF.md && grep -q "## Requirements Coverage" docs/v2/PHASE-6-SIGN-OFF.md && grep -q "CON-01" docs/v2/PHASE-6-SIGN-OFF.md && grep -q "CON-12" docs/v2/PHASE-6-SIGN-OFF.md && grep -q "## ADR-006 Decision Traceability" docs/v2/PHASE-6-SIGN-OFF.md && grep -q "Task Contract DSL" CHANGELOG.md && grep -q "\[x\] \*\*Phase 6: Task contract DSL" .planning/ROADMAP.md</automated>
  </verify>
  <done>PHASE-6-SIGN-OFF.md authored with all 9 sections; all 12 CON-* requirements traced to plans + commits; all 5 ROADMAP criteria traced to tests; ADR-006 decision traceability table populated; CHANGELOG.md updated; ROADMAP Phase 6 checkbox flipped to `[x]`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Reference contracts → ContractFileSchema | Zod-validated at load time; cross-field invariants (alias uniqueness) enforced; Plan 06-04 contracts are the canonical validation corpus. |
| Eval scenarios → CON-08 / CON-10 harness | Scenario YAMLs are read-only test fixtures; their `expected_output_shape` is JSON Schema validated against actual instantiation output. |
| Non-Claude smoketest → MCP server | Real subprocess of `vault-memory serve` via `StdioClientTransport`; exercises the full server boot path including ContractRegistry + auto-register stub off + describe + instantiate. |
| Sign-off doc → human reviewer | This is the human-review gate per `autonomous: false` declaration in frontmatter. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-04-01 | Tampering | Reference contract YAML files in fixture are accidentally pushed with sensitive data | mitigate | `scripts/check-fixture-privacy.sh` (Phase 0 FND-11) lints fixture content for non-test data. Plan 06-04 contracts contain only fictional Atlas Robotics names — already in fixture set. |
| T-06-04-02 | Information Disclosure | CON-09 smoketest leaves a stale `_memory/_briefs/` artifact on disk after running | accept | Smoketest runs in CI ephemeral filesystem; outside CI, the user explicitly invoked the test on their machine. Document cleanup is a future polish. |
| T-06-04-03 | Tampering | The `smoketest-trivial.yaml` contract is callable in production deployments via auto-register | accept | Default-OFF `auto_register_tools`; the trivial contract is only present in `evals/fixtures/v2-test-vault/_contracts/` (a TEST fixture path), not in user vaults. If a user copies the fixture to their vault, they accept the contract's behavior. Documented in PHASE-6-SIGN-OFF.md Known Limitations. |
| T-06-04-SC | Tampering | npm install of new dependencies | N/A | Zero net-new runtime deps in Plan 06-04 (`yaml`, `zod`, MCP SDK all pre-installed). No supply-chain checkpoint. |
</threat_model>

<verification>
**Acceptance:**
- `npm test` — 1346+ existing tests + Plans 06-01/02/03 + Plan 06-04 tests all green. Final test count documented in PHASE-6-SIGN-OFF.md.
- `npx tsc --noEmit` — clean.
- `bash scripts/lint-adapters.sh` — zero hits inside `src/contracts/` (no `fs`/`path.join`/`gray-matter`/`chokidar` outside `src/server.ts`).
- `npm run eval:baseline` — v1-baseline byte-identical for the 23 v1 tools.
- `evals/v1-baseline/tools-list.snapshot.json` — UNCHANGED from Plan 06-03 (37 entries). Diff against post-06-03 shows zero changes.
- `node scripts/smoketest-non-claude.mjs` — exits 0 (CON-09 proof).

**Manual verification (autonomous: false gate):**
1. Read `docs/v2/PHASE-6-SIGN-OFF.md` end-to-end. Verify every CON-* requirement has a checkmark + commit SHA. Verify every ROADMAP success criterion has a verifiable test/eval reference.
2. Read each of the three reference contracts. Verify the assembly steps make sense against the fixture documents.
3. Run the smoketest in a clean checkout: `npm install && npm run build && node scripts/smoketest-non-claude.mjs`. Verify it exits 0 and prints the Phase 6 progress messages.
4. Run `vault-memory serve` interactively + open MCP Inspector. Verify `list_contracts` MCP Resource returns the three reference contracts + the smoketest-trivial. Verify `list_contract_verbs` Resource returns the 11 baseline verbs.
5. Spot-check `audit_log` (via SQL CLI) post-smoketest for `contract_step` rows referencing `smoketest-trivial`.
6. Confirm CHANGELOG + ROADMAP updates are accurate.
</verification>

<success_criteria>
1. Three reference contracts ship in `evals/fixtures/v2-test-vault/_contracts/` (CON-07): `meeting-prep`, `project-status`, `code-review-brief`. Each Zod-validates + buildInputSchema produces a ZodObject + round-trip preserves comments.
2. A `smoketest-trivial.yaml` companion contract ships for CON-09 LLM-free smoketest path (literal-only assembly).
3. Four eval scenario YAMLs ship in `evals/fixtures/v2-test-vault/_queries/` (CON-08 + CON-10): `contracts-meeting-prep`, `contracts-project-status`, `contracts-code-review-brief`, `contracts-stub-parity`. Each has documented `scenarios:` shape with concrete inputs + expected_output_shape.
4. `src/adapters/source/conformance.test.ts` gains a `contracts stub-parity (CON-10)` describe block parametric over obsidian-fs + stub; same output_shape proven (body content not compared — LLM variance is acceptable).
5. `scripts/smoketest-non-claude.mjs` extended (CON-09): lists tools and confirms `describe_contract`, `instantiate_contract`, `register_contracts_as_tools` are present; calls `describe_contract({name: 'meeting-prep'})` and validates `{json_schema, summary}`; calls `instantiate_contract({name: 'smoketest-trivial', inputs: {message}})` and validates `{ok: true, write_back: {doc_id}}`; calls `readResource('vault-memory://contracts/<vault>')` and validates the 3 reference contracts are listed. Exits 0.
6. `list_contracts` + `list_contract_verbs` MCP Resources ship (CON-04 + D-A2b); registered in `src/server.ts`; Resources do NOT count toward REL-08 tool budget.
7. `evals/v1-baseline/tools-list.snapshot.json` UNCHANGED from Plan 06-03 (37 entries).
8. `docs/v2/PHASE-6-SIGN-OFF.md` authored with all 9 sections; CON-01..CON-12 traceability table populated; ADR-006 decision-to-commit-SHA table populated; 5 ROADMAP success criteria traced to tests; Known Limitations enumerates CONTEXT.md `<deferred>` items.
9. `CHANGELOG.md` `[Unreleased]` section updated with Phase 6 entries.
10. `.planning/ROADMAP.md` Phase 6 checkbox `[ ]` → `[x]` with completion summary line referencing PHASE-6-SIGN-OFF.md.
11. `npm test` + `npx tsc --noEmit` + `bash scripts/lint-adapters.sh` + `npm run eval:baseline` + `node scripts/smoketest-non-claude.mjs` all green.

**After this slice, agents can:** discover (`list_contracts`) → describe (`describe_contract`) → run (`instantiate_contract`) any contract end-to-end across both obsidian-fs and stub source connectors with identical output shapes. **Phase 6 is signed off.**
</success_criteria>

<commit>
Atomic commit messages (one per task, or one batch commit at slice end):

```
feat(06-04): three reference contracts + reference-contracts.test.ts (CON-07)

- evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml
- evals/fixtures/v2-test-vault/_contracts/project-status.yaml
- evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml
- evals/fixtures/v2-test-vault/_contracts/smoketest-trivial.yaml (CON-09 anchor)
- src/contracts/reference-contracts.test.ts — validates schema + builds
  inputZodSchema + asserts CON-01 comment round-trip on meeting-prep.

Refs: CON-07, CON-01 (round-trip half)
```

```
feat(06-04): eval scenarios + CON-10 stub-parity conformance (CON-08, CON-10)

- evals/fixtures/v2-test-vault/_queries/contracts-{meeting-prep,project-status,
  code-review-brief,stub-parity}.yaml — concrete inputs + expected_output_shape.
- src/adapters/source/conformance.test.ts gains `contracts stub-parity (CON-10)`
  block parametric over obsidian-fs + stub SourceConnector; same output_shape
  proven (body content not compared — LLM variance acceptable).

Refs: CON-08, CON-10, Phase 3 ASM-12 / Phase 5 BRF-11 parametric pattern
```

```
feat(06-04): list_contracts + list_contract_verbs MCP Resources (CON-04, D-A2b)

- src/contracts/resources.ts — readListContracts + readListContractVerbs
  (pure functions over registry + contract_audit aggregator).
- src/memory/resources/index.ts — RESOURCE_URI_LIST_CONTRACTS +
  RESOURCE_URI_LIST_CONTRACT_VERBS constants.
- src/server.ts — server.registerResource() for both URIs.
- Tool snapshot UNCHANGED — Resources don't count toward REL-08 budget
  per Phase 5 BRF-09 precedent.

Refs: CON-04, D-A2b
```

```
test(06-04): non-Claude smoketest extension (CON-09)

- scripts/smoketest-non-claude.mjs — extended with Phase 6 assertions:
  tools/list contains describe_contract + instantiate_contract +
  register_contracts_as_tools; describe_contract returns {json_schema,
  summary}; instantiate_contract on smoketest-trivial returns {ok: true,
  write_back: {doc_id}}; list_contracts Resource returns ≥3 contracts.
- Uses literal-only smoketest-trivial.yaml to avoid LLM dependency in CI.

Refs: CON-09
```

```
docs(06-04): PHASE-6-SIGN-OFF + CHANGELOG + ROADMAP checkbox (sign-off)

- docs/v2/PHASE-6-SIGN-OFF.md — Phase summary; CON-01..CON-12 requirements
  table with commit SHAs; ROADMAP 5 success criteria coverage; ADR-006
  decision traceability; tool surface inventory (34 → 37; +2 Resources);
  test floor; known limitations (deferred items from CONTEXT.md).
- CHANGELOG.md [Unreleased] — Phase 6 added entries (tools, Resources,
  reference contracts, ADR-006, migration 014, [contracts] config block).
- .planning/ROADMAP.md — Phase 6 checkbox [ ] → [x] with sign-off
  reference.

Refs: CON-11, all Phase 6 requirements signed off
```
</commit>

<output>
Create `.planning/phases/06-task-contract-dsl/06-04-SUMMARY.md` when done. Then mark Phase 6 complete in `.planning/STATE.md`.
</output>
