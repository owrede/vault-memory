---
phase: 07-visual-contract-editor-canvas
plan: 02
subsystem: contract-editor / codec
tags: [zod, yaml, codec, contract-editor, ADR-007, D-FORMAT-SCHEMA, D-FORMAT2, D-CANON, D-AUTH]
dependency_graph:
  requires:
    - "src/contracts/schema.ts (Phase 6 ContractFileSchema — wrapped BYREF)"
    - "yaml ^2.9.0 parseDocument / stringify (existing dep)"
    - "evals/fixtures/v2-test-vault/_contracts/{meeting-prep,smoketest-trivial}.yaml"
  provides:
    - "ContractDocumentSchema — Zod for the `.contract` JSON envelope"
    - "ContractDocumentShape — inferred TS type"
    - "EditorStateShape — inferred TS type"
    - "canonicalizeContract + CANONICAL_KEY_ORDER (D-CANON)"
    - "encodeEditorComment + extractEditorComment + EDITOR_COMMENT_PREFIX (D-FORMAT2)"
    - "emitYaml + parseYaml — pure round-trip codec"
  affects:
    - "plugin/src/views/contract-editor/view.ts (next plan: wire codec into Obsidian view)"
    - "plan 07-05 (editor view) — consumes ContractDocumentShape directly"
    - "plan 07-06 (round-trip acceptance test) — calls into emitYaml/parseYaml across the three reference fixtures"
tech-stack:
  added: []
  patterns:
    - "Zod schema BYREF (wrap, do not redeclare) — server-side schema reused inside plugin envelope"
    - "Cross-package shared-types facade — plugin/src/shared-types.ts re-exports server-side Zod types so the codec consumes a single import surface"
    - "yaml ^2.9.0 parseDocument on the parse path (comment preservation chokepoint); yaml.stringify on the emit path (no comments to round-trip — editor-state is prepended as raw text)"
    - "Default-layout fallback: deterministic LTR grid (220x120 px stride) when the editor-state header is absent — no data loss, only spatial layout regenerates"
key-files:
  created:
    - "src/contracts/contract-file-schema.ts"
    - "src/contracts/contract-file-schema.test.ts"
    - "plugin/src/codec/canonicalize.ts"
    - "plugin/src/codec/canonicalize.test.ts"
    - "plugin/src/codec/editor-state-comment.ts"
    - "plugin/src/codec/editor-state-comment.test.ts"
    - "plugin/src/codec/contract-codec.ts"
    - "plugin/src/codec/contract-codec.test.ts"
    - "plugin/src/shared-types.ts"
  modified:
    - "plugin/tsconfig.json (added include entries for ../src/contracts/{schema,contract-file-schema}.ts so the cross-package re-export pattern compiles)"
decisions:
  - "Removed plugin/tsconfig.json `rootDir: \".\"` and added explicit `include` entries for the two server-side files the shared-types facade re-exports. The plan prescribed the cross-package import pattern; rootDir blocked it. Documented as Rule 3 (blocking-issue) deviation."
  - "Used `yaml.stringify` on the emit path rather than `parseDocument`+`createNode`. Reason: the canonicalized contract has no source comments to preserve on emission — comments are preserved on the parse path. `stringify` produces stable, type-clean output with `lineWidth: 0` disabling auto-wrap."
  - "Default-omission rules kept tight per the plan: only `required: true` on handle declarations (the documented Phase 6 Zod default). Did not extend to top-level `required: []` because Phase 6 distinguishes empty-array from absent."
  - "EditorStateSchema uses Zod `.passthrough()` so unknown editor keys round-trip unchanged (ADR-007 C-7-6 forward compatibility)."
metrics:
  duration: "~25 minutes (autonomous, no checkpoints)"
  completed: "2026-05-19T06:54:55Z"
  tasks: "3/3"
  tests_added: "11 (server) + 27 (plugin) = 38 unit tests"
---

# Phase 7 Plan 02: Codec + Schema Summary

JSON envelope schema (`ContractDocumentSchema`) and pure-TS codec (`emitYaml` / `parseYaml`) that round-trips between the `.contract` editor source and Phase 6 `_contracts/*.yaml` build artifact, with editor spatial state preserved via a base64 YAML comment header.

## What Shipped

### ContractDocumentSchema fields (D-FORMAT-SCHEMA)

| Field             | Type                                     | Notes                                                                                          |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `$schema`         | `z.literal(URI).optional()`              | Optional JSON Schema metadata, preserved by codec                                              |
| `vmFormatVersion` | `z.literal(1)`                           | Hard gate — rejects all values ≠ 1                                                             |
| `contract`        | `ContractFileSchema` (Phase 6 verbatim)  | Wrapped BYREF; errors propagate with field path intact                                         |
| `editor`          | `EditorStateSchema` (`.passthrough()`)   | `nodes[]` + `selection` + `viewport` + `yamlComments`; unknown keys pass through (ADR-007 C-7-6) |

### CANONICAL_KEY_ORDER tuple

Frozen `readonly` tuple, exact value:

```typescript
["version", "name", "description", "inputs", "sources", "sinks",
 "assembly", "output_shape", "write_back", "required"]
```

Mirrors ADR-006 §Decision 2 schema field order. Used by `canonicalizeContract` to stabilize top-level YAML field order on emission. Additional canonical orderings applied internally:

- `assembly[].*`: `as, verb, args, value`
- `sources[].* / sinks[].*`: `handle, required`

Default-omission: `required: true` on handle declarations is dropped (Phase 6 Zod default). All other defaults preserved.

### Editor-state header

Format: `# vm-editor-state: <base64-encoded JSON>\n` on YAML line 1 only. `EDITOR_COMMENT_PREFIX = "# vm-editor-state: "` exported for grep-style assertions. Round-trip is lossless; malformed payloads degrade gracefully (header line stripped, `editor: null` returned, body preserved).

## Test Counts

| Suite                                         | Tests | Status |
| --------------------------------------------- | ----- | ------ |
| `src/contracts/contract-file-schema.test.ts`  | 11    | pass   |
| `plugin/src/codec/canonicalize.test.ts`       | 9     | pass   |
| `plugin/src/codec/editor-state-comment.test.ts` | 10  | pass   |
| `plugin/src/codec/contract-codec.test.ts`     | 8     | pass   |
| **Total new tests**                           | **38** | pass  |

Regression check: full `src/contracts/` suite (19 files, 172 tests) still passes.

## Round-trip fixtures covered (unit-test scope)

- `evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml` — full 4-step assembly with `read_note`, `expand`, `cluster`, `compile_brief`
- `evals/fixtures/v2-test-vault/_contracts/smoketest-trivial.yaml` — literal-only 2-step assembly

The CAN-07 reference-contract acceptance test (over `meeting-prep`, `project-status`, `code-review-brief` — all three) is **deferred to plan 07-06** per the plan's `<output>` clause and per ADR-007 §D-CANON-TEST (test fixture at `examples/contracts/round-trip.test.ts`).

## must_haves.truths verification

- **vmFormatVersion gate**: `ContractDocumentSchema` rejects `vmFormatVersion: 2` and missing field — Test 2 + Test 3 in `contract-file-schema.test.ts` (commit `1b5cfeb`).
- **Round-trip parsed JS deepEqual**: `parseDocument(round1).toJS()` deep-equals `parseDocument(round2).toJS()` on the meeting-prep fixture — Test 2 in `contract-codec.test.ts` (commit `11dbe0c`).
- **Editor-state header survives**: every emitted YAML starts with `# vm-editor-state: ` — Test 3 in `contract-codec.test.ts`. Explicit editor block round-trips byte-equivalent — Test 8.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed plugin/tsconfig.json `rootDir: "."`**

- **Found during:** Task 2 typecheck
- **Issue:** The plan's prescribed cross-package re-export pattern (plugin/src/shared-types.ts imports from `../../src/contracts/`) collides with TypeScript's `rootDir` containment check.
- **Fix:** Removed `rootDir` from plugin/tsconfig.json and added two explicit `include` entries: `"../src/contracts/schema.ts"` and `"../src/contracts/contract-file-schema.ts"`. This is the standard workspace-monorepo TS pattern (composite-less) and matches how the parent tsconfig structures includes.
- **Files modified:** `plugin/tsconfig.json`
- **Commit:** `f21ce64`

**2. [Rule 3 - Blocking] Switched emit path from `parseDocument`+`createNode` to `yaml.stringify`**

- **Found during:** Task 3 typecheck
- **Issue:** Assigning a `YAMLMap` from `createNode(...)` to `Document.contents` failed TS strict type-checking (the `parseDocument("")` baseline produces a `Document.Parsed`, not the writable `Document`).
- **Fix:** Used `yaml.stringify(canonical, { lineWidth: 0 })` directly. `parseDocument` is still imported and used on the parse path — the round-trip comment-preservation chokepoint is preserved exactly where it matters (loading existing YAML). On emission, the canonicalized contract carries no comments to round-trip, so `stringify` is sufficient and type-clean. The codec retains the literal `parseDocument` identifier (verified by Test 7).
- **Files modified:** `plugin/src/codec/contract-codec.ts`
- **Commit:** `11dbe0c`

### Pre-existing out-of-scope failures

`plugin/main.ts` and `plugin/src/views/contract-editor/view.ts` have typecheck errors because `obsidian` and `svelte` are not installed in the worktree (`plugin/node_modules` does not exist). These are pre-existing in the spike scaffold from plan 07-01 and are out of scope for plan 07-02. Logged but not modified.

## Threat Flags

None — the codec is pure data transform. No new endpoints, no new trust boundaries beyond what ADR-007 already names. The plan's `<threat_model>` (T-07-02-01 / -02 / -03) is honored as written:

- T-07-02-01 (Tampering / parseYaml): all parsed input flows through `ContractFileSchema.safeParse` then `ContractDocumentSchema.safeParse`; errors throw with Zod path intact.
- T-07-02-02 (DoS / adversarial YAML): `yaml ^2.9` default parser limits apply.
- T-07-02-03 (Information Disclosure / editor comment): base64 carries only layout coordinates; no secrets.

## Commits

| Commit    | Task                                            | Files                                                                                                                                    |
| --------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `1b5cfeb` | Task 1: ContractDocumentSchema                  | `src/contracts/contract-file-schema.ts`, `.test.ts`                                                                                      |
| `f21ce64` | Task 2: canonicalize + editor-state-comment    | `plugin/src/codec/{canonicalize,editor-state-comment}.{ts,test.ts}`, `plugin/src/shared-types.ts`, `plugin/tsconfig.json` (Rule 3 fix) |
| `11dbe0c` | Task 3: contract-codec                          | `plugin/src/codec/contract-codec.{ts,test.ts}`                                                                                           |

## Self-Check: PASSED

- All 9 created files exist on disk and committed.
- All 3 task commits present in `git log --oneline`.
- 38 new tests pass; 0 regressions in 172 pre-existing `src/contracts/` tests.
- `grep -n "from \"obsidian\"" plugin/src/codec/` returns no matches (codec purity).
- `npx tsc --noEmit` (server) exits 0.
- Plugin tsc errors remain confined to pre-existing `main.ts` / `view.ts` (missing obsidian/svelte node_modules — pre-spike scope).
