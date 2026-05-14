---
phase: 01
plan: 01
plan_id: 01-01
subsystem: adapters
tags: [adapters, types, branded-types, registry, type-surface]
status: complete
dependency_graph:
  requires: []
  provides:
    - "src/types.ts: DocId, SourceHandle, MemorySinkHandle (branded), Document, BlockNode, Edge, WikilinkRef, ChangeEvent, MemorySink"
    - "src/adapters/capabilities.ts: BodyShape, PropertiesShape, EdgeType, RefHashKind, WatchKind, HashProtected, NamingMode"
    - "src/adapters/source/{types,index}.ts: SourceConnector, SourceCapabilities, ListOptions, DocumentRef"
    - "src/adapters/delivery/{types,index}.ts: DeliveryAdapter, DeliveryCapabilities, WriteOptions, WriteResult, UpdateResult, DeleteResult"
    - "src/adapters/change-feed/{types,index}.ts: ChangeFeed, ChangeFeedCapabilities, Disposable"
    - "src/adapters/registry.ts: parseDocId, formatDocId, parseSourceHandle, AdapterRegistry"
    - "tests/types/docid-brand.test-d.ts: compile-time DocId-brand assertion (tsc --noEmit)"
  affects:
    - "tsconfig.json: include extended to tests/types/**/*.test-d.ts; rootDir removed (was emit-only)"
tech_stack:
  added: []
  patterns:
    - "IIFE-closed brand minting (RESEARCH §Pattern 2): unsafe `as DocId` cast lives only inside an IIFE in src/adapters/registry.ts; only the validating `parseDocId` is exported."
    - "Nominal (branded) string types: `string & { readonly __brand: '...' }` for DocId / SourceHandle / MemorySinkHandle."
    - "Compile-time negative tests via @ts-expect-error directives under tsc --noEmit (no new devDep)."
    - "Discriminated-union result types: WriteResult / UpdateResult / DeleteResult with WriteSuccess | WriteConflict — reuses v1 src/write/write.ts shape with v1 `noteId: number` replaced by `doc_id: DocId`."
    - "VaultManager-mirror handle resolver: triad of register/resolve/list per adapter role (sources, deliveries, change-feeds)."
key_files:
  created:
    - src/adapters/capabilities.ts
    - src/adapters/source/types.ts
    - src/adapters/source/index.ts
    - src/adapters/delivery/types.ts
    - src/adapters/delivery/index.ts
    - src/adapters/change-feed/types.ts
    - src/adapters/change-feed/index.ts
    - src/adapters/registry.ts
    - src/adapters/registry.test.ts
    - tests/types/docid-brand.test-d.ts
  modified:
    - src/types.ts (append-only — 9 new exports under v2 canonical types section)
    - tsconfig.json (extended include for tests/types/**/*.test-d.ts; removed unused rootDir)
decisions:
  - "DocId regex: /^[a-z][a-z0-9-]*:\\/\\/[^/]+\\/.+$/ — lowercase ASCII scheme (alnum + dashes, letter-leading), non-slash authority, non-empty resource."
  - "Compile-time brand test: option (A) from PATTERNS — @ts-expect-error directives inside a .test-d.ts file, picked up by tsc --noEmit (already in npm run lint:check). No new devDep. Smoke-checked: removing any one directive makes tsc fail with 'Type string is not assignable to type DocId'."
  - "tsconfig.json extension required: `include` previously only covered `src/**/*`. Added `tests/types/**/*.test-d.ts`. Removed `rootDir: './src'` — it was emit-only; this project's `tsc --noEmit` doesn't need it (tsup bundles via its own config)."
  - "IIFE returns only { parseDocId: parse } — `mint` is closure-private and never escapes. This avoids the type-inference issue where destructuring `const { parseDocId } = (() => ... return { mintDocId, parseDocId })()` confuses TS into rejecting `mintDocId` on the return-object literal."
  - "Phase-2 hook on DeliveryAdapter.write(): TSDoc note signals that Phase 2 layers Guards A (provenance required) and B (source:agent outside sink rejected) on top of write() WITHOUT signature change. The `WriteOptions.sink?: MemorySinkHandle` field is published now so 01-04 can wire it; Phase 1 implementations may ignore it."
  - "ChangeEvent re-exported from src/types.ts inside src/adapters/change-feed/types.ts for adapter-facing import convenience. Canonical home stays src/types.ts per ADR-002."
metrics:
  duration_minutes: 6
  completed_date: "2026-05-15"
  tasks_completed: 7
  files_changed: 12
  commits: 7
---

# Phase 1 Plan 01: Type Surface + Branded DocId + Adapter Directory Bootstrap — Summary

**One-liner:** Established the v2 canonical type surface (Document/BlockNode/Edge/ChangeEvent/MemorySink), branded-DocId nominal type enforced at compile time via IIFE-closed minting, and the three adapter seam interfaces (SourceConnector/DeliveryAdapter/ChangeFeed) under `src/adapters/`, unblocking all downstream Phase 1 plans (01-02..06).

## Outcome

- 7 tasks executed atomically, 7 commits on `worktree-agent-ab5a98afeaa9b17d2`.
- 10 new files created; 2 files modified (src/types.ts append-only; tsconfig.json include extended).
- `npm run lint:check` exits 0 (shell lints + `tsc --noEmit` + prettier `src/**/*.ts`).
- `npm test` runs 430 tests + 11 todos across 41 files; ALL PASS. Includes 33 new tests in `src/adapters/registry.test.ts`.
- `npm run eval:baseline` runs 29 baseline tests + 11 todos; ALL PASS — v1-baseline eval suite unchanged (no regression).
- DocId branding verified by `tests/types/docid-brand.test-d.ts` under tsc --noEmit. Smoke-checked: removing any single `@ts-expect-error` directive produces a compile error (`Type 'string' is not assignable to type 'DocId'`), proving the brand is real and not vestigial.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 01-01-01 | `98bc992` | feat(01-01): add v2 canonical types + branded DocId to src/types.ts |
| 01-01-02 | `a83d3fb` | feat(01-01): add src/adapters/capabilities.ts (shared capability sub-types) |
| 01-01-03 | `5c1c11c` | feat(01-01): add SourceConnector interface (src/adapters/source/) |
| 01-01-04 | `9e9f4b9` | feat(01-01): add DeliveryAdapter interface (src/adapters/delivery/) |
| 01-01-05 | `51adb71` | feat(01-01): add ChangeFeed interface (src/adapters/change-feed/) |
| 01-01-06 | `72faa12` | feat(01-01): add AdapterRegistry + branded-DocId minting (src/adapters/registry.ts) |
| 01-01-07 | `bed138a` | test(01-01): add compile-time negative test for branded DocId |

## Files Created / Modified

### Created

- `src/adapters/capabilities.ts` (51 lines, < 60-line cap) — seven `type` aliases: BodyShape, PropertiesShape, EdgeType, RefHashKind, WatchKind, HashProtected, NamingMode.
- `src/adapters/source/types.ts` (~170 lines) — SourceConnector + SourceCapabilities + DocumentRef + ListOptions. Header block documents Invariants I-1..I-7 and failure semantics.
- `src/adapters/source/index.ts` — barrel re-export.
- `src/adapters/delivery/types.ts` (~200 lines) — DeliveryAdapter + DeliveryCapabilities + WriteOptions + WriteResult/UpdateResult/DeleteResult (discriminated unions). Phase-2 hook documented on `write()`.
- `src/adapters/delivery/index.ts` — barrel re-export.
- `src/adapters/change-feed/types.ts` (~115 lines) — ChangeFeed + ChangeFeedCapabilities + Disposable. Re-exports ChangeEvent from src/types.ts. Optional `drain?()` permits v1 VaultWatcher.drain mapping in 01-05.
- `src/adapters/change-feed/index.ts` — barrel re-export.
- `src/adapters/registry.ts` (~190 lines) — IIFE-closed `mint` (module-private), exported `parseDocId` / `formatDocId` / `parseSourceHandle` / `AdapterRegistry`. Mirrors `VaultManager` shape with three independent maps (sources, deliveries, change-feeds).
- `src/adapters/registry.test.ts` (~220 lines, 33 tests) — covers parseDocId (2 positive + 11 negative cases), formatDocId, parseSourceHandle (1 positive + 6 negative), AdapterRegistry triad round-trips, error messages, triad independence.
- `tests/types/docid-brand.test-d.ts` (~55 lines) — 3 negative cases + 1 positive case for the DocId brand at compile time.

### Modified

- `src/types.ts` — APPEND-ONLY: added 9 new exports under a `// ──── v2 canonical types (Phase 1, ADR-002 / ADR-003 / ADR-004) ────` section divider. No existing exports modified or removed. v1 backwards-compat preserved.
- `tsconfig.json` — added `"tests/types/**/*.test-d.ts"` to `include`; removed unused `"rootDir": "./src"` (was emit-only; current build runs `tsc --noEmit` and `tsup` for bundling).

## Branded-DocId Implementation Detail (ADP-05)

The exact regex used in `parseDocId`:

```typescript
const DOC_ID_PATTERN = /^[a-z][a-z0-9-]*:\/\/[^/]+\/.+$/;
```

Per RESEARCH §Pattern 2 (lines 336–352), the brand-cast is closed inside an IIFE so the unsafe minter cannot escape:

```typescript
const { parseDocId } = (() => {
  const mint = (s: string): DocId => s as DocId;     // <-- the SOLE `as DocId` cast in the codebase
  const parse = (s: string): DocId => {
    if (!DOC_ID_PATTERN.test(s)) {
      throw new Error(`Invalid DocId: ${JSON.stringify(s)}. ...`);
    }
    return mint(s);
  };
  return { parseDocId: parse };       // <-- only `parse` is returned; `mint` is closure-private
})();

export { parseDocId };
```

Greps that prove the invariant:

```bash
$ grep -c "export.*mintDocId" src/adapters/registry.ts
0

$ grep -nE "as DocId" src/adapters/registry.ts
80:  const mint = (s: string): DocId => s as DocId;
# (header-comment mentions removed during implementation to avoid grep false positives)
```

## Decision on `tests/types/docid-brand.test-d.ts` approach

**Option (A) confirmed** — `@ts-expect-error` directives inside a `.test-d.ts` file, picked up by `tsc --noEmit` (already in `npm run lint:check`). No new devDep added. Choice rationale per PATTERNS row "tests/types/docid-brand.test-d.ts" and CLAUDE.md / CONVENTIONS principle "type-checking is the linter."

## tsconfig.json change

The original `include: ["src/**/*"]` did not cover `tests/types/**`. Extended to:

```json
"include": ["src/**/*", "tests/types/**/*.test-d.ts"]
```

Also dropped `"rootDir": "./src"` — it's emit-only (`tsc --noEmit` and `tsup` both work without it; tsup uses its own config to bundle from `src/cli.ts`). The unused-locals `exclude: ["**/*.test.ts"]` does NOT exclude `.test-d.ts` files (different glob suffix), so the negative test file is picked up cleanly.

## Smoke check evidence (brand is real)

Removing any one `@ts-expect-error` directive in `tests/types/docid-brand.test-d.ts` produces:

```
tests/types/docid-brand.test-d.ts(31,7): error TS2322:
  Type 'string' is not assignable to type 'DocId'.
  Type 'string' is not assignable to type '{ readonly __brand: "DocId"; }'.
```

The directive is restored; `tsc --noEmit` is clean.

## Note for plans 01-02..06

The canonical Phase 1 type surface is now importable from:

| Symbol | Import path |
|---|---|
| `DocId`, `SourceHandle`, `MemorySinkHandle`, `Document`, `BlockNode`, `Edge`, `WikilinkRef`, `ChangeEvent`, `MemorySink` | `from "../../types.js"` (path depth depends on the importer) |
| `BodyShape`, `PropertiesShape`, `EdgeType`, `RefHashKind`, `WatchKind`, `HashProtected`, `NamingMode` | `from "../capabilities.js"` |
| `SourceConnector`, `SourceCapabilities`, `DocumentRef`, `ListOptions` | `from "../source/index.js"` or `"../source/types.js"` |
| `DeliveryAdapter`, `DeliveryCapabilities`, `WriteOptions`, `WriteResult`, `UpdateResult`, `DeleteResult` | `from "../delivery/index.js"` or `"../delivery/types.js"` |
| `ChangeFeed`, `ChangeFeedCapabilities`, `Disposable`, `ChangeEvent` (re-export) | `from "../change-feed/index.js"` or `"../change-feed/types.js"` |
| `parseDocId`, `formatDocId`, `parseSourceHandle`, `AdapterRegistry` | `from "../registry.js"` (or `"./registry.js"` from within `src/adapters/`) |

Per `verbatimModuleSyntax: true` in tsconfig.json, type imports MUST use `import type` (see `src/adapters/registry.test.ts` for the exemplar).

## Deviations from Plan

### Minor adjustments (none required user permission)

**1. [Rule 3 - Blocking issue] IIFE return-shape narrowed to avoid TS inference error**
- **Found during:** Task 01-01-06.
- **Issue:** RESEARCH §Pattern 2 template returns `{ mintDocId: mint, parseDocId: parse }` but only `parseDocId` is destructured at the call site. TS contextual typing from `const { parseDocId } = (...)` then rejects `mintDocId` on the returned-object literal with TS2353 "Object literal may only specify known properties."
- **Fix:** Return only `{ parseDocId: parse }` — the `mint` closure stays inside the IIFE and never escapes, which is the safer outcome. The export shape is unchanged (`export { parseDocId }`).
- **Files modified:** `src/adapters/registry.ts`.
- **Commit:** included in `72faa12`.

**2. [Rule 3 - Blocking issue] tsconfig.json `rootDir` removed**
- **Found during:** Task 01-01-07.
- **Issue:** Original `"rootDir": "./src"` would have caused `tsc --noEmit` to refuse files under `tests/types/**` with TS6059 ("File is not under rootDir").
- **Fix:** Removed the `rootDir` setting entirely. It is emit-only (`outDir` still works; `tsup` bundles via its own config). `tsc --noEmit` (the only invocation in this project) doesn't need it.
- **Files modified:** `tsconfig.json`.
- **Commit:** `bed138a`.

**3. [Cosmetic] DocId comment in registry.ts rephrased**
- **Found during:** Task 01-01-06.
- **Issue:** The file header comment originally said "The brand cast (`s as DocId`) is the SOLE escape hatch..." — this matched the substring `as DocId` and inflated the `grep -c "as DocId"` count to 2 (one comment + one real cast). The plan's done-criterion expects exactly 1.
- **Fix:** Rephrased the comment to "The brand-cast escape hatch lives ONLY inside the IIFE below..." — no semantic change, removes the grep false-positive.
- **Files modified:** `src/adapters/registry.ts`.
- **Commit:** included in `72faa12`.

### Spec inconsistency noted (not a deviation; for transparency)

**Done-criterion for Task 01-01-01: "grep returns 10 matches" but only 9 distinct identifiers listed.**

The plan's done criterion for Task 01-01-01 says:

```
grep -E '^export (type|interface) (DocId|SourceHandle|MemorySinkHandle|Document|BlockNode|Edge|WikilinkRef|ChangeEvent|MemorySink)' src/types.ts returns 10 matches.
```

But the regex lists only 9 distinct identifiers (DocId, SourceHandle, MemorySinkHandle, Document, BlockNode, Edge, WikilinkRef, ChangeEvent, MemorySink). Each is exported exactly once, so grep returns 9. The implementation matches the spec's intent (all 9 names exported); the "10" is plan-spec drift. Confirmed by running the literal grep:

```bash
$ grep -cE '^export (type|interface) (DocId|SourceHandle|MemorySinkHandle|Document|BlockNode|Edge|WikilinkRef|ChangeEvent|MemorySink)' src/types.ts
9
```

## Threat Flags

None. This plan is type-only — no new runtime code paths or surface that crosses a trust boundary. The branded-DocId IIFE is a new compile-time guard, not a new attack surface.

## Self-Check: PASSED

- `src/types.ts` — FOUND (modified, 9 new exports under v2 section).
- `src/adapters/capabilities.ts` — FOUND.
- `src/adapters/source/types.ts` — FOUND.
- `src/adapters/source/index.ts` — FOUND.
- `src/adapters/delivery/types.ts` — FOUND.
- `src/adapters/delivery/index.ts` — FOUND.
- `src/adapters/change-feed/types.ts` — FOUND.
- `src/adapters/change-feed/index.ts` — FOUND.
- `src/adapters/registry.ts` — FOUND.
- `src/adapters/registry.test.ts` — FOUND (33 tests pass).
- `tests/types/docid-brand.test-d.ts` — FOUND.
- `tsconfig.json` — FOUND (modified).
- Commits 98bc992, a83d3fb, 5c1c11c, 9e9f4b9, 51adb71, 72faa12, bed138a — ALL FOUND in `git log`.
- `npm run lint:check` — PASS.
- `npm test` — PASS (430 tests, 0 failures, 11 todo).
- `npm run eval:baseline` — PASS (29 tests, 0 failures, 11 todo).
- `grep -c "export.*mintDocId" src/adapters/registry.ts` — returns 0 (mintDocId is module-private).
- `grep -nE "as DocId" src/adapters/registry.ts` — returns exactly 1 code-level match (line 80: the IIFE's `mint` cast).
