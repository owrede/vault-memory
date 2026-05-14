# Coding Conventions

**Analysis Date:** 2026-05-14

## Language & Module System

**TypeScript strict mode** — `tsconfig.json` enables:
- `strict: true`
- `noUncheckedIndexedAccess: true` (array/object index access returns `T | undefined`)
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `verbatimModuleSyntax: true` (type imports must use `import type`)
- `isolatedModules: true`

**ESM only.** `package.json` sets `"type": "module"`. All local imports use explicit `.js` extensions (compiled output). No CJS patterns anywhere.

```typescript
// Correct import style throughout codebase
import { Database } from "./database.js";
import type { Vault } from "../vault/manager.js";
```

## Naming Patterns

**Files:**
- `kebab-case` for all files: `hybrid.ts`, `add-vault.ts`, `onnx-reranker.ts`, `content-heuristics.ts`
- Test files mirror source: `hybrid.test.ts`, `onnx-reranker.test.ts`
- Index files re-export from sibling modules: `index.ts` in every subdirectory

**Functions:**
- `camelCase` for all functions: `parseNote`, `chunkNote`, `hybridSearch`, `loadConfig`
- `camelCase` for async functions: `catchupVault`, `writeNote`, `atomicWriteFile`
- Exported pure helpers use descriptive verbs: `extractWikilinks`, `matchesAnyGlob`, `slugifyVaultName`

**Variables:**
- `camelCase` throughout: `queryVec`, `embedCache`, `fanK`, `activeVault`
- Local constants follow the same rule (no SCREAMING_SNAKE_CASE for non-module-level consts)

**Types and Interfaces:**
- `PascalCase` for all: `ParsedNote`, `SearchHit`, `WriteResult`, `VaultConfig`
- Zod schemas also `PascalCase` with `Args` suffix for MCP input schemas: `SearchArgs`, `WriteNoteArgs`, `SuggestFrontmatterArgs`
- DB row types suffixed `Row`: `NoteRow`, `ChunkRow`, `ModelRow`, `WriteAuditRow`
- Input structs suffixed `Input`: `UpsertNoteInput`, `WriteNoteInput`, `DeleteNoteInput`

**Classes:**
- `PascalCase`: `VaultManager`, `OllamaClient`, `NotesQueries`, `DebouncedQueue`
- Query classes suffixed `Queries`: `NotesQueries`, `ChunksQueries`, `FtsQueries`

## Import Organization

**Order observed in source files:**
1. Node built-ins with `node:` protocol prefix: `import { promises as fs } from "node:fs"`, `import * as path from "node:path"`
2. Third-party packages: `import matter from "gray-matter"`, `import { z } from "zod"`
3. Local modules with `./` or `../`: `import { Database } from "./database.js"`
4. Type-only imports last or interleaved with value imports, using `import type`: `import type { Vault } from "../vault/index.js"`

**Path Aliases:** None. All imports use relative paths with `.js` extensions.

**`verbatimModuleSyntax` enforcement:** Every type-only import uses `import type`. Mixed value+type from the same module is allowed (`import { Class } from "./x.js"` then `import type { Interface } from "./x.js"` as separate statements).

## Code Style (Prettier)

Config: `.prettierrc.json`

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

Key settings:
- Double quotes for strings
- Trailing commas everywhere (parameters, arrays, objects)
- 100-char line width
- 2-space indentation
- Arrow functions always parenthesized: `(x) => x`

**Linting:** TypeScript compiler only (`"lint": "tsc --noEmit"`). No ESLint or Biome. Type errors are the lint gate.

## Section Dividers

Long files use ASCII box-drawing section headers:

```typescript
// ─── Tool Input Schemas ──────────────────────────────────────────────────────
// ─── Server bootstrap ────────────────────────────────────────────────────────
// ─── Response helpers ────────────────────────────────────────────────────────
```

This pattern appears in `src/server.ts`, `src/db/queries/notes.ts`, and other larger files.

## Error Handling

**No Result types.** Errors fall into three categories:

1. **Structured discriminated unions** for expected failure states (write operations):
   ```typescript
   // src/write/write.ts
   export interface WriteSuccess { ok: true; newHash: string; noteId: number; created: boolean; }
   export interface WriteConflict { ok: false; reason: "hash_mismatch" | "permission_denied"; message: string; }
   export type WriteResult = WriteSuccess | WriteConflict;
   ```

2. **`throw new Error(message)`** for programming errors and precondition failures:
   ```typescript
   // src/server.ts
   throw new Error(`Note not found: ${vaultName}/${path}`);
   // src/vault/manager.ts — require() throws on unknown vault name
   ```

3. **Top-level `try/catch` boundary** in MCP tool dispatch (`src/server.ts:995`): catches all errors from handlers, converts to MCP error responses:
   ```typescript
   } catch (err) {
     const message = err instanceof Error ? err.message : String(err);
     return errorResponse(message);
   }
   ```

**`catch` clause patterns:**
- Named `err` for cases that need the message: `catch (err) { const message = err instanceof Error ? err.message : String(err); }`
- Empty `catch {}` or `catch { // ignore }` for deliberate swallowing (JSON parse fallbacks, optional cleanup)
- `err: unknown` in some places for explicit unknown narrowing

## Null and Undefined Handling

**`noUncheckedIndexedAccess` means array elements are `T | undefined`.** All array index accesses require a null check or optional chaining:
```typescript
const v = arr[0];  // type is T | undefined
v[0] = 1;          // TS error without guard
```

**`null` over `undefined` for explicit absence:** Optional DB fields are `string | null`, return values from queries use `?? null`:
```typescript
return this._selectById.get(id) ?? null;
```

**Optional parameters** use `?` (resolves to `undefined`), while nullable fields in types use `| null`. The codebase does not conflate the two.

**Nullish coalescing** (`??`) is used throughout for defaults:
```typescript
const activeVault = process.env.VAULT_MEMORY_ACTIVE_VAULT?.trim() || undefined;
const model = vault.config.embedding_model ?? defaultModel;
```

## Async Patterns

**`async`/`await` everywhere.** No raw `.then()` chains in production code.

All async functions declare explicit return types:
```typescript
export async function serve(): Promise<void>
export async function writeNote(input: WriteNoteInput): Promise<WriteResult>
async function handleSearchSemantic(...): Promise<object>
```

**Fire-and-forget** with explicit `.catch()`:
```typescript
startCatchupAndWatchers().catch((err) => {
  process.stderr.write(`[catchup] unexpected failure: ${message}\n`);
});
```

**`void` operator** for intentionally ignored promises in event handlers:
```typescript
process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
```

## Logging

**No logging framework.** All logs go to `process.stderr` directly:
```typescript
process.stderr.write(`[catchup:${vault.config.name}] ${message}\n`);
```

stdout is reserved for MCP wire protocol (JSON). stderr is for operational logs. Pattern: `[component:context] message\n`.

## Comments

**Density:** High. Files contain substantial inline documentation.

**JSDoc:** Used on exported public-API functions and types. Example:
```typescript
/**
 * Parse a single markdown file into a ParsedNote.
 *
 * `relativePath` is always posix (forward slashes), relative to `vaultRoot`.
 */
export async function parseNote(...): Promise<ParsedNote>
```

**Inline rationale comments:** Extensive. Explains _why_ choices were made, not just _what_:
```typescript
// Real vaults accumulate frontmatter drift: `tags` may be an array,
// a single string, a nested object, or missing entirely. SQLite's
// json_each() throws on non-array/object inputs and aborts the whole
// query — so we pre-filter to rows where `tags` is actually an array.
```

**Phase/version annotations:** Code additions reference the phase they belong to:
```typescript
// ─── Phase 7c — shadow-indexing / model switch ──────────────────────────────
// Phase 8: backend selection.
```

**Codex reference tags:** Issue/decision references appear in comments:
```typescript
// Codex MEDIUM-3: catch-up reconciliation can take seconds on large vaults
```

## Module Design

**Barrel re-exports:** Every subdirectory has an `index.ts` that re-exports the public API. Consumers import from the barrel, not deep paths:
```typescript
// src/vault/index.ts
export { VaultManager } from "./manager.js";
export type { Vault } from "./manager.js";

// src/db/index.ts — re-exports all query classes and types
```

**Separation of value and type exports:** `export type` used for interfaces and type aliases from index files. `export` for classes and functions.

**Single responsibility per file:** Each file contains one primary export (class or function group). `types.ts` is the one shared-types exception.

## Function Design

**Size:** Handlers in `server.ts` can be long (they manage the switch-case dispatch). Module functions are compact (10–60 lines typical).

**Parameters:** Functions accept input structs/interfaces for >3 parameters rather than positional args:
```typescript
export async function writeNote(input: WriteNoteInput): Promise<WriteResult>
export async function indexNote(opts: { vault, absolutePath, embeddingModel, ollama }): Promise<...>
```

**Return values:** Explicit `Promise<T>` types on all async functions. Discriminated unions for fallible operations (see WriteResult). Never `any`.

---

*Convention analysis: 2026-05-14*
