---
phase: 07-visual-contract-editor-canvas
plan: 06
subsystem: visual-contract-editor
tags: [contract, codec, round-trip, acceptance-test, CAN-06, CAN-07]
requires:
  - "plugin/src/codec/contract-codec.ts (07-02)"
  - "plugin/src/codec/canonicalize.ts (07-02)"
  - "plugin/src/codec/editor-state-comment.ts (07-02)"
  - "src/contracts/contract-file-schema.ts (07-02)"
  - "evals/fixtures/v2-test-vault/_contracts/*.yaml (Phase 6)"
provides:
  - "examples/contracts/meeting-prep.contract"
  - "examples/contracts/project-status.contract"
  - "examples/contracts/code-review-brief.contract"
  - "examples/contracts/round-trip.test.ts (CAN-06 + CAN-07 anchor)"
affects:
  - "Future Phase 7 plans that touch the codec — round-trip is now a regression-pinned invariant in the root npm test run"
tech-stack:
  added: []
  patterns:
    - "Generator script (`_generate.mjs`) kept as one-shot regeneration tool; canonical regression check is the test"
    - "Plugin → root cross-package imports for tests: import `../../plugin/src/codec/...` from `examples/**/*.test.ts` resolved by root vitest"
key-files:
  created:
    - "examples/contracts/_generate.mjs"
    - "examples/contracts/project-status.contract"
    - "examples/contracts/code-review-brief.contract"
    - "examples/contracts/round-trip.test.ts"
  modified:
    - "examples/contracts/meeting-prep.contract (regenerated from 07-01 spike to match LTR convention)"
decisions:
  - "Use the codec's deterministic default layout (x = i*220, y = 0) for the three reference `.contract` files so a fresh import preserves the same coordinates that the codec would synthesize from the YAML twin"
  - "Keep `_generate.mjs` committed as a one-shot regenerator (not deleted) so future contract-fixture changes can re-run it; the round-trip test is still the canonical regression"
  - "Test file lives at `examples/contracts/round-trip.test.ts` (not under plugin/) so root vitest discovers it; plugin/** stays excluded from root discovery"
  - "CAN-06 deepEqual compares against `parseYaml(yaml).contract` (which applies Phase 6 Zod defaults) rather than raw `yaml.parse()` output, so both sides have defaults populated identically"
metrics:
  duration: ~10m
  completed: 2026-05-19
---

# Phase 07 Plan 06: Reference Contracts + Round-Trip Acceptance Summary

Ports the three Phase 6 reference contracts (meeting-prep, project-status, code-review-brief) into `.contract` JSON wrappers under `examples/contracts/` and lands the CAN-06 + CAN-07 acceptance test that pins the round-trip as a regression-protected invariant.

## What changed

- **Three reference `.contract` files** under `examples/contracts/`, each:
  - `$schema: https://vault-memory.dev/schemas/contract-v1.json`
  - `vmFormatVersion: 1`
  - `contract: <verbatim Phase 6 YAML>` (parsed via `yaml.parse`)
  - `editor.nodes: [{id: "step:<as>", x: i*220, y: 0}, ...]` matching the codec's deterministic default layout
  - `editor.viewport: {x:0, y:0, zoom:1.0}`, `selection: null`, `yamlComments: {}`
- **Round-trip acceptance test** at `examples/contracts/round-trip.test.ts` covering four fixtures with four invariants each plus three CAN-06 anchors: 19 test cases total.
- **One-shot generator** `examples/contracts/_generate.mjs` (committed, idempotent — re-running produces byte-identical output).

`meeting-prep.contract` was regenerated from the Wave-1 (07-01) spike because the old version used a 2x2 grid (x=300, y=160) — the LTR convention (x=i*220) keeps all three fixtures uniform and aligns with the codec's `buildDefaultEditorState` fallback so an editor-less round-trip preserves coordinates.

## CAN-06 — three reference contracts pin to Phase 6 YAML twins

Each `.contract` validates against `ContractDocumentSchema` and the `contract` block deepEqual's `parseYaml(<yaml>).contract`. Asserts both sides have Zod defaults applied identically (the YAML side via the codec's parser, the JSON side via the schema's validator).

## CAN-07 — round-trip is a fixed-point

Four invariants per fixture (4 fixtures × 4 invariants = 16 cases), plus three CAN-06 cases = 19 total:

| Invariant | Assertion |
|-----------|-----------|
| Fixed-point | `emit(parse(emit(parse(yaml))))` byte-equals `emit(parse(yaml))` |
| deepEqual JS | `parseDocument(stripHeader(yaml1)).toJS()` `.toEqual()` `parseDocument(stripHeader(yaml2)).toJS()` |
| Header present | both emitted YAMLs start with `# vm-editor-state: ` |
| Editor survives | base64-decoded payload from yaml1 `.toEqual()` base64-decoded payload from yaml2 |

Fixtures: `meeting-prep.yaml`, `project-status.yaml`, `code-review-brief.yaml`, `smoketest-trivial.yaml`.

## Vitest glob

No glob update was required. The root `vitest.config.ts` excludes `plugin/**` and `.claude/worktrees/**` but does NOT exclude `examples/**`. The default include glob (vitest's built-in `**/*.{test,spec}.?(c|m)[jt]s?(x)`) picks up `examples/contracts/round-trip.test.ts` automatically — verified by `npm test --silent 2>&1 | grep examples/contracts/round-trip` returning the 19-test pass line.

The test imports the codec via `../../plugin/src/codec/contract-codec.js`. That path resolves through root vitest's TypeScript transformer; plugin's `@xyflow/svelte` and `obsidian` imports are NOT in the codec's transitive closure, so root discovery is safe.

## Deviations from Plan

None — plan executed exactly as written. The two design choices that the plan flagged for the executor were both resolved in favor of lower friction:

- **Layout helper:** plan suggested `x = column * 260, y = row * 160`. Used the codec's `(i * 220, 0)` default instead so a fresh codec parse synthesizes the same nodes the `.contract` ships with. Round-trip is the regression check; this minimizes drift between authored and synthesized layouts.
- **Generator retention:** plan offered "delete OR keep as one-shot" — kept. The script is 80 lines and survives as documentation of how the fixtures were derived.

## Test discipline

- 19 test cases in `examples/contracts/round-trip.test.ts` (4 fixtures × 4 invariants + 3 CAN-06 anchors).
- 1640 tests total pass in `npm test`; no existing test regressed.
- Lint carve-out for `node:fs/promises` in `*.test.ts` files documented in `src/contracts/reference-contracts.test.ts`.

## Threat surface

No new threat surface. Fixture content is verbatim from the public Phase 6 reference YAML; no secrets introduced.

## Commits

| Hash | Type | Subject |
|------|------|---------|
| 2125e3f | feat | port three Phase 6 reference contracts to .contract wrappers |
| 38216cb | test | add CAN-06 + CAN-07 round-trip acceptance test |

## Self-Check: PASSED

- examples/contracts/meeting-prep.contract — FOUND
- examples/contracts/project-status.contract — FOUND
- examples/contracts/code-review-brief.contract — FOUND
- examples/contracts/round-trip.test.ts — FOUND
- examples/contracts/_generate.mjs — FOUND
- commit 2125e3f — FOUND
- commit 38216cb — FOUND
- `npx vitest run examples/contracts/round-trip.test.ts` — 19/19 PASS
- `npm test` full suite — 1640/1640 PASS, no regressions
