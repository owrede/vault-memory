# Phase 01: adapter-extraction-tech-debt-up — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 54 (28 new + 23 moved + 3 modified)
**Analogs found:** 50 / 54
**Source of truth:** CONTEXT.md §Decisions + RESEARCH.md §Recommended Project Structure + §Recommended Plan Decomposition + ADR-002 §Decision

---

## File Classification (global)

| File | Plan | New / Moved / Modified | Role | Data Flow |
|------|------|------------------------|------|-----------|
| `src/types.ts` | 01-01 | modified (append) | type surface | compile-time only |
| `src/adapters/source/types.ts` | 01-01 | new | interface decl | compile-time only |
| `src/adapters/delivery/types.ts` | 01-01 | new | interface decl | compile-time only |
| `src/adapters/change-feed/types.ts` | 01-01 | new | interface decl | compile-time only |
| `src/adapters/capabilities.ts` | 01-01 | new | shared types | compile-time only |
| `src/adapters/registry.ts` | 01-01 | new | factory / handle parser | runtime (bootstrap) |
| `tests/types/docid-brand.test-d.ts` | 01-01 | new | compile-time negative test | typecheck only |
| `src/db/schema.ts` | 01-02 | modified (append) | DB DDL + migration list | DB migration |
| `src/db/database.ts` | 01-02 | modified | DB constructor + migrate hook | DB migration |
| `src/db/queries/notes.ts` | 01-02 | modified | DB write namespace | runtime write |
| `src/db/database.test.ts` | 01-02 | modified | unit test | test |
| `src/adapters/source/obsidian-fs/index.ts` | 01-03 | new (facade) | adapter impl | runtime read |
| `src/adapters/source/obsidian-fs/scanner.ts` | 01-03 | moved from `src/reader/scanner.ts` | FS walker | runtime read |
| `src/adapters/source/obsidian-fs/parser.ts` | 01-03 | moved from `src/reader/parser.ts` | content parser (gray-matter) | runtime read |
| `src/adapters/source/obsidian-fs/hash.ts` | 01-03 | moved from `src/reader/hash.ts` | content hasher | pure |
| `src/adapters/source/obsidian-fs/wikilinks.ts` | 01-03 | moved from `src/reader/wikilinks.ts` | link extractor | pure |
| `src/adapters/source/obsidian-fs/*.test.ts` | 01-03 | moved (4 files) | unit tests | test |
| `src/adapters/source/conformance.test.ts` | 01-03 | new | parameterized conformance | test |
| `src/adapters/stub/source.ts` | 01-03 | new | in-memory stub | runtime read |
| `src/indexer/*.ts` (touched files) | 01-03 | modified | import-path rewrite | refactor |
| `src/server.ts` (read_note) | 01-03 | modified | route reads through adapter | runtime read |
| `src/adapters/delivery/obsidian-fs/index.ts` | 01-04 | new (facade) | adapter impl | runtime write |
| `src/adapters/delivery/obsidian-fs/write.ts` | 01-04 | moved from `src/write/write.ts` | atomic write + OCC | runtime write |
| `src/adapters/delivery/obsidian-fs/fs.ts` | 01-04 | moved from `src/write/fs.ts` | `atomicWriteFile`, `safeJoinInsideVault` | runtime write |
| `src/adapters/delivery/obsidian-fs/*.test.ts` | 01-04 | moved (2 files) | unit tests | test |
| `src/adapters/delivery/conformance.test.ts` | 01-04 | new | parameterized conformance | test |
| `src/adapters/stub/delivery.ts` | 01-04 | new | in-memory stub | runtime write |
| `src/frontmatter/update.ts` | 01-04 | modified | remove fs + gray-matter; route via adapter | refactor |
| `src/server.ts` (D-01 + D-02) | 01-04 | modified | `formatDisplayUrl` + `client_info` capture | runtime |
| `src/adapters/change-feed/obsidian-fs/index.ts` | 01-05 | new (facade) | adapter impl | event-driven |
| `src/adapters/change-feed/obsidian-fs/watcher.ts` | 01-05 | moved from `src/watcher/watcher.ts` | chokidar wrapper | event-driven |
| `src/adapters/change-feed/obsidian-fs/queue.ts` | 01-05 | moved from `src/watcher/queue.ts` | debounced queue | event-driven |
| `src/adapters/change-feed/obsidian-fs/suppression.ts` | 01-05 | moved from `src/watcher/suppression.ts` | TTL set | event-driven |
| `src/adapters/change-feed/obsidian-fs/*.test.ts` | 01-05 | moved (3 files) | unit tests | test |
| `src/adapters/change-feed/conformance.test.ts` | 01-05 | new | parameterized conformance | test |
| `src/adapters/stub/change-feed.ts` | 01-05 | new | EventEmitter-backed stub | event-driven |
| `src/server.ts` (registerTool × 23) | 01-05 | modified | SDK 1.29 + Zod 4 migration | bootstrap |
| `src/tool-registry.ts` | 01-05 | modified | source of truth for `inputSchema` | compile-time |
| `src/config/loader.ts` | 01-05 | modified | Zod 4 refinement sweep | runtime |
| `evals/v1-baseline/tools-list.snapshot.json` | 01-05 | regenerated | baseline snapshot | test fixture |
| `package.json` | 01-05 | modified | SDK + Zod bump + new scripts | config |
| `scripts/lint-adapters.sh` | 01-06 | new | POSIX shell CI gate | CI gate |
| `scripts/smoketest-non-claude.mjs` | 01-06 | new | non-interactive Node smoketest | CI gate / e2e |
| `docs/v2/AGENT_AGNOSTIC_AUDIT.md` | 01-06 | new | audit doc | docs |
| `README.md` | 01-06 | rewritten | doc | docs |
| `CHANGELOG.md` | 01-06 | append `[Unreleased]` | doc | docs |
| `src/cli.ts` | 01-06 | modified | message rewrites (D-02 client-id default) | runtime |
| `src/rerank/onnx-reranker.ts` | 01-06 (optional) | modified | `ModelLoader` carve-out | runtime |
| `.github/workflows/ci.yml` | 01-06 | modified | wire lint + smoketest | CI |

---

## Plan 01-01 — Type surface + branded DocId + adapter directory bootstrap

### `src/types.ts` (modified — append canonical types)

**Analog:** itself (`src/types.ts` lines 47–84 `ParsedNote`, 90–107 `Chunk`, 176–192 `SearchHit`).

**Pattern to follow:**
- Append a new section divider comment block (`// ────`) per ADR (Document, BlockNode, Edge, ChangeEvent, MemorySink, SourceHandle, branded DocId), mirroring the existing block-comment style.
- Use `interface` for record types; `type` only for aliases / discriminated unions (matches v1 style: `ParsedNote`/`Chunk` are interfaces, `WriteResult` is a discriminated `type`).
- Keep TSDoc on every field (`/** … */` above each member, as in `ParsedNote` lines 51–71).

**New pattern (no analog in codebase):**
- **Branded `DocId`** — `type DocId = string & { readonly __brand: "DocId" }`. This is the first nominal-typed alias in the project. Per RESEARCH §Pattern 2, the brand constructor `mintDocId` is private to `src/adapters/registry.ts`; only the validating `parseDocId(s: string): DocId` is exported. Compile error on any raw-string assignment is the enforcement.

---

### `src/adapters/source/types.ts` (new — interface declarations)

**Analog:** `src/rerank/reranker.ts:39–48` (the canonical "interface + multiple impls" pattern in this codebase).

**Pattern to follow:**

```typescript
// src/rerank/reranker.ts:39
export interface Reranker {
  /** Score each chunk… Returns one score per chunk… Higher = more relevant. */
  score(query: string, chunks: readonly string[]): Promise<number[]>;
}
```

— Brief, single-purpose interface with TSDoc on each method, no class concerns. `OllamaReranker` and `OnnxReranker` implement the same interface from sibling files. Copy exactly: file header block explaining the contract (lines 1–35 of `reranker.ts`), then `export interface SourceConnector { … }`, then `export interface DocumentRef { … }`, then `export interface ListOptions { … }`. Verbatim shapes from ADR-002 lines 56–77.

**Deviation:** `SourceConnector` has 5 methods (vs `Reranker`'s 1); group related methods with a short comment.

---

### `src/adapters/delivery/types.ts` (new — interface declarations)

**Analog:** `src/rerank/reranker.ts:39` (same template as source) PLUS `src/write/write.ts:19–35` (discriminated `WriteResult` pattern).

**Pattern to follow:**
- `WriteResult` already lives in `src/write/write.ts:19–35` as `WriteSuccess | WriteConflict` discriminated by `ok: true|false`. Re-use the same shape verbatim in the new adapter types so the obsidian-fs delivery impl can return existing-style values unchanged.
- Optional-field convention: `expectedHash?: string` (matches existing `WriteNoteInput.expectedHash` style at `write.ts:51`).

```typescript
// src/write/write.ts:19-35 — pattern to copy
export interface WriteSuccess { ok: true; newHash: string; noteId: number; created: boolean }
export interface WriteConflict { ok: false; reason: "hash_mismatch" | "permission_denied"; … }
export type WriteResult = WriteSuccess | WriteConflict
```

— `DeliveryCapabilities` (incl. `hashProtected: 'strong' | 'best-effort' | 'none'`) takes verbatim shape from ADR-002 lines 202–209.

---

### `src/adapters/change-feed/types.ts` (new — interface declarations)

**Analog:** `src/rerank/reranker.ts:39` (interface) + ADR-002 lines 164–176 (verbatim type shape) + the existing `QueueEvent` discriminated union in `src/watcher/queue.ts` (similar `kind`-tagged event shape).

**Pattern to follow:**

```typescript
// ADR-002 lines 171-176 (verbatim)
type ChangeEvent =
  | { kind: 'create'; id: DocId; at: number }
  | { kind: 'update'; id: DocId; at: number }
  | { kind: 'delete'; id: DocId; at: number }
  | { kind: 'rename'; old_id: DocId; new_id: DocId; at: number };
```

- Tagged-union pattern matches `QueueEvent` from `src/watcher/queue.ts` already in use by `VaultWatcher` (see `src/watcher/watcher.ts:22`).
- **A3 / Risk #3 from RESEARCH §Open Questions:** Phase 1 may NOT emit `rename`; emit `delete` + `create` instead (matches current v1 behavior). The type permits `rename`; the impl defers it.

---

### `src/adapters/capabilities.ts` (new — shared types)

**Analog:** none directly; closest is `src/db/types.ts` (small type-only barrel re-exporting shared shapes). 

**Pattern to follow:** small file containing only `export type EdgeType = …` and any shared capability sub-types referenced from both source and delivery types. Keep it < 60 lines. No runtime code.

---

### `src/adapters/registry.ts` (new — handle parser, factory map, `parseDocId`/`mintDocId`)

**Analog:** `src/vault/manager.ts` (the existing per-handle resolver — `VaultManager.vaults: Map<string, Vault>`; `manager.require(name)` for lookup).

**Pattern to follow:**
- `VaultManager`'s `register / resolve / list` triad maps 1:1 to `Registry.registerSource / resolveSource / listSources` (ADR-002 lines 256–267).
- Throwing-with-helpful-message convention: `manager.require()` throws when a vault isn't found; mirror this for `resolveSource(handle)`.
- **`mintDocId` closure idiom from RESEARCH §Pattern 2** is the only mechanism in the file that creates a branded `DocId`; export only the validating `parseDocId`. See RESEARCH lines 336–352 for the IIFE template.

```typescript
// RESEARCH §Pattern 2 template (verbatim)
const { mintDocId, parseDocId } = (() => {
  const mint = (s: string): DocId => s as DocId;
  const parse = (s: string): DocId => {
    if (!/^[a-z][a-z0-9-]*:\/\/[^/]+\/.+$/.test(s)) throw new Error(`Invalid DocId: ${s}`);
    return mint(s);
  };
  return { mintDocId: mint, parseDocId: parse };
})();
export { parseDocId };
```

---

### `tests/types/docid-brand.test-d.ts` (new — compile-time negative test)

**Analog:** **none in the codebase.** No existing `*.test-d.ts` file; `tsd` / `expect-type` is not currently a dep.

**Pattern to follow (new):** RESEARCH does not pin a library. Two viable idioms:
- **(A) Custom `@ts-expect-error` block** — single TS file under `tests/types/` with directive lines: `// @ts-expect-error — raw string is not assignable to DocId\nconst x: DocId = "not-a-doc-id";`. Runs as part of `tsc --noEmit` (already in `npm run lint:check`). **Recommended** because zero new deps.
- **(B) Add `expect-type` or `tsd`** — explicit `expectError<…>()` helpers; adds one devDep.

**Project convention says "type-checking is the linter" (CLAUDE.md / CONVENTIONS).** Recommend option (A); planner decides.

---

## Plan 01-02 — `doc_uri` dual-column migration (Strategy A: v7 + v8)

### `src/db/schema.ts` (modified — append MIGRATION_007 + MIGRATION_008)

**Analog:** `src/db/schema.ts:383–386` (MIGRATION_006, the most recent `ALTER TABLE ADD COLUMN` migration) AND `src/db/schema.ts:298–361` (`runMigration005` function-style migration template).

**Pattern to follow:**

```typescript
// src/db/schema.ts:383-386 — MIGRATION_006 verbatim (static-SQL additive)
const MIGRATION_006_BODY_HASH = `
ALTER TABLE notes ADD COLUMN body_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_body_hash ON notes(body_hash);
`;
```

— Copy this shape for `MIGRATION_007_DOC_URI_ADD` (additive nullable column + index per RESEARCH §Pattern 3 lines 365–371). Append a JSDoc block above the constant matching the existing comment style at `schema.ts:365–382` (one-paragraph "Why" + indexer behavior).

For `MIGRATION_008_DOC_URI_BACKFILL`, follow the function-style migration pattern at `schema.ts:298–361`:

```typescript
// src/db/schema.ts:298 — function-style migration (runMigration005)
function runMigration005(db: BetterSqlite3Database): void { … }

// ... at MIGRATIONS array (schema.ts:412):
{ version: 5, description: "...", run: runMigration005 }
```

Append both rows to the `MIGRATIONS` const at `schema.ts:388–419`. **Key requirement from CONTEXT.md / RESEARCH A8:** the function-style migration must be idempotent (re-running on already-backfilled DB is a no-op) — see `runMigration005:316–323` for the "match only legacy shape, skip new shape" idiom.

**Deviation from MIGRATION_005's loop:** MIGRATION_008 must derive the vault name from the DB path (see RESEARCH §Pattern 3 lines 376–390). MIGRATION_005 has no such context dependency. The planner picks the mechanism (constructor-passed hook vs. parse `db.name`).

---

### `src/db/database.ts` (modified — vault-name context hook for MIGRATION_008)

**Analog:** itself (`src/db/database.ts:34–60` constructor — already accepts `dbPath`).

**Pattern to follow:**
- The migration runner at `database.ts:85–128` is purely version-driven and stateless. Per RESEARCH A8 and §Pattern 3, MIGRATION_008 needs the vault name; the cleanest pattern matching the existing constructor is to expose a `vaultName?: string` argument to `new Database(dbPath, vaultName?)` and stash it as a field; the function-style migration reads it via `(db as BetterSqlite3.Database & { __vaultName?: string }).__vaultName` OR (preferred) pass a context object to function-style migrations.
- **CONTEXT.md "Claude's Discretion".** Planner picks the mechanism; preserve the read-only intent that `migrateInternal` already enforces (lines 85–128).

---

### `src/db/queries/notes.ts` (modified — write `doc_uri` on upsert)

**Analog:** itself (`src/db/queries/notes.ts:1–80`, particularly the existing `upsertByPath` at lines 52–85 with `_insert`/`_update` prepared statements).

**Pattern to follow:**
- Extend `UpsertNoteInput` with `docUri?: string` (optional during the dual-column window, NOT NULL by v9).
- Mirror the `body_hash` column addition (added in MIGRATION_006) — see `notes.ts:30–32` for the prepared statement template:

```typescript
this._insert = db.prepare(`
  INSERT INTO notes (path, content, …, body_hash, mtime, word_count, doc_uri, created_at, updated_at)
  VALUES           (@path, @content, …, @body_hash, @mtime, @word_count, @doc_uri, @now, @now)
`);
```

— Same pattern for `_update`. Existing `bodyHash` field in `UpsertNoteInput:12` is the exact template; copy verbatim.

---

### `src/db/database.test.ts` (modified — DB migration unit tests)

**Analog:** `src/db/database.test.ts:1–80` (existing roundtrip tests).

**Pattern to follow:**

```typescript
// src/db/database.test.ts:7-14
describe("Database roundtrips", () => {
  let db: Database;
  beforeEach(() => { db = new Database(":memory:"); db.migrate(); });
  afterEach(() => { db.close(); });
  …
});
```

Add a new `describe("MIGRATION_007 + 008 (doc_uri)", …)` block. Per RESEARCH line 431, assert: (1) `doc_uri` non-null for every row after migration, (2) value shape `obsidian-fs://<vault>/<path>`, (3) idempotent under re-run.

---

## Plan 01-03 — Source adapter extraction + obsidian-fs source impl

### `src/adapters/source/obsidian-fs/index.ts` (new — `ObsidianFsSource` facade)

**Analog:** `src/rerank/onnx-reranker.ts` (the canonical "class implementing an interface, lazy-loading heavy deps" file in the codebase) AND `src/vault/manager.ts` (the `Vault`-struct-consuming class pattern).

**Pattern to follow:**
- File header block (10–35 lines of TSDoc explaining the contract + strategy + failure semantics — see `src/rerank/reranker.ts:1–35` for the canonical template).
- Class shape: `export class ObsidianFsSource implements SourceConnector { readonly capabilities = { … }; constructor(private readonly vault: VaultConfig) {} … }`.
- Imports use `.js` extension (ESM); type imports use `import type` (`verbatimModuleSyntax: true` is enforced). See `src/server.ts:14–43` for the import-block convention.
- D-01 (`formatDisplayUrl`) is an optional method on `SourceConnector`; obsidian-fs returns `obsidian://open?vault=…&file=…`. Stub returns `null`.

```typescript
// Template (synthesized from RESEARCH §Example 2 lines 530-578 + ADR-002 Example A)
import { promises as fs } from "node:fs";        // ALLOWED here by I-2
import matter from "gray-matter";                // ALLOWED here by I-4
import { scanVault } from "./scanner.js";        // relocated
import { parseNote } from "./parser.js";         // relocated
import { parseDocId, mintDocId } from "../../registry.js";
import type { SourceConnector, DocumentRef, ListOptions } from "../types.js";
import type { Document, DocId } from "../../../types.js";

export class ObsidianFsSource implements SourceConnector { … }
```

**Critical:** ALL `gray-matter`, `node:fs`, and `node:path` imports for source-side reads must consolidate here. Today gray-matter is imported in `src/reader/parser.ts:3` AND `src/write/write.ts:13` AND `src/frontmatter/update.ts:24` — the write/update leaks are 01-04's job; this plan only consolidates the read-side leak inside the new directory.

---

### `src/adapters/source/obsidian-fs/{scanner,parser,hash,wikilinks}.ts` (moved via `git mv`)

**From / to (4 files + 4 colocated `*.test.ts`):**

| From | To |
|------|----|
| `src/reader/scanner.ts` | `src/adapters/source/obsidian-fs/scanner.ts` |
| `src/reader/parser.ts` | `src/adapters/source/obsidian-fs/parser.ts` |
| `src/reader/hash.ts` | `src/adapters/source/obsidian-fs/hash.ts` |
| `src/reader/wikilinks.ts` | `src/adapters/source/obsidian-fs/wikilinks.ts` |
| same `*.test.ts` siblings | same target dir |

**Analog:** the files themselves — no code change beyond import paths.

**Pattern to follow:**
- `git mv` to preserve blame (CONTEXT.md "git mv + interface extraction" theme).
- Rewrite `import … from "../types.js"` → `import … from "../../../types.js"` (path depth increases by 2).
- D-03 (CONTEXT.md): `DEFAULT_EXCLUDES = [".obsidian/**", …]` at `scanner.ts:8` stays inside the obsidian-fs adapter — do NOT relocate.
- **I-5 (bare `.md` literal at `scanner.ts:47`):** stays — `src/adapters/source/obsidian-fs/` is the licensed home for `.md` literals.
- D-05 (CONTEXT.md): wikilinks extracted by `parser.ts:41–46` continue to populate `ParsedNote.wikilinks`; the new facade's `readDocument()` maps these to `Document.properties.wikilinks` per RESEARCH §Example 2 lines 555–563.

---

### `src/adapters/source/conformance.test.ts` (new — parameterized over obsidian-fs + stub)

**Analog:** `src/search/hybrid.test.ts:7` (existing `describe()` block pattern) PLUS the broader vitest convention. **No existing parameterized-suite analog (no `describe.each` use in repo).**

**Pattern to follow (new pattern; closest existing template):**

```typescript
// Template (synthesized from §RESEARCH Example 4 stub + existing vitest style)
import { describe, it, expect, beforeEach } from "vitest";
import { ObsidianFsSource } from "./obsidian-fs/index.js";
import { StubSource } from "../stub/source.js";
import type { SourceConnector } from "./types.js";

const adapters: Array<[name: string, factory: () => SourceConnector]> = [
  ["obsidian-fs", () => new ObsidianFsSource(testVaultConfig)],
  ["stub",        () => new StubSource(fixtureDocuments)],
];

describe.each(adapters)("SourceConnector conformance (%s)", (_name, makeAdapter) => {
  it("publishes honest SourceCapabilities (I-7)", () => { … });
  it("listDocuments yields a DocumentRef per doc", async () => { … });
  it("readDocument round-trips Document.hash with DocumentRef.hash when refHashKind=content", async () => { … });
  it("exists(unknownId) returns false, never throws", async () => { … });
});
```

— **New pattern note:** introduces `describe.each` to the codebase. Same vitest version `^2.1.8` supports it natively. Conformance assertions list comes from ADR-002 Invariants I-7 and `SourceCapabilities` shape (lines 191–200).

---

### `src/adapters/stub/source.ts` (new — `StubSource`)

**Analog:** RESEARCH §Example 4 (lines 619–660) is the verbatim sketch.

**Pattern to follow:**
- `Map<DocId, Document>`-backed; `handle = "stub://memory"`; `capabilities` published honestly (e.g. `identityStable: true`, `refHashKind: "content"`, `watch: "push"` — stub can emit synthetic events trivially).
- ~40 lines. Co-located test stays minimal — the heavy lifting is in `conformance.test.ts` (above).

---

### `src/indexer/*.ts` (modified — route reads through `SourceConnector`)

**Analog:** `src/indexer/indexer.ts` (existing `indexNote` consuming `parseNote` directly).

**Pattern to follow:**
- Replace `await parseNote(absolutePath, vaultRoot)` calls with `await source.readDocument(docId)` where `source = registry.resolveSource(vault.config.source ?? defaultHandle(vault))`.
- **D-05 shim from RESEARCH Risk #7:** `WikilinkResolver` continues to consume the existing `ParsedNote.wikilinks` shape. The indexer extracts `Document.properties.wikilinks` and feeds it in — keep `WikilinkResolver`'s input unchanged (Phase 4 boundary).

---

### `src/server.ts` (modified — `read_note` handler routes through adapter)

**Analog:** existing `read_note` handler at `src/server.ts:~830` (the v1 entry that reads a file path).

**Pattern to follow:**
- Handler receives `{vault, path}` (the v1 shape — unchanged per CONTEXT.md backwards-compat constraint).
- Internally: `const docId = parseDocId(\`obsidian-fs://${vault}/${path}\`); const source = registry.resolveSource(\`obsidian-fs://${vault}\`); return await source.readDocument(docId);`
- Public response shape unchanged — backwards-compat is enforced by `evals/v1-baseline/tools-list.snapshot.json`.

---

## Plan 01-04 — Delivery adapter extraction + obsidian-fs delivery impl

### `src/adapters/delivery/obsidian-fs/index.ts` (new — `ObsidianFsDelivery` facade)

**Analog:** same as 01-03 (`src/rerank/onnx-reranker.ts` for class-with-lazy-deps shape + ADR-002 §`DeliveryAdapter` lines 128–153 for method signatures).

**Pattern to follow:**
- Implements `DeliveryAdapter` (`write`, `update`, `delete`).
- `capabilities`: `{ atomic: true, hashProtected: "strong", enforcedSchema: false, naming: "caller-provided" }` per ADR-002 line 498 (the obsidian-fs row in the capability-deltas table).
- **D-02 client-id default flows in as a constructor arg** (`clientId: string`), bound at server bootstrap from MCP `client_info`. Removes the hardcoded `"claude-code"` default at `src/write/write.ts:76`.

---

### `src/adapters/delivery/obsidian-fs/write.ts` + `fs.ts` (moved + adapted)

**From / to:**

| From | To |
|------|----|
| `src/write/write.ts` | `src/adapters/delivery/obsidian-fs/write.ts` |
| `src/write/fs.ts` | `src/adapters/delivery/obsidian-fs/fs.ts` |
| `src/write/{write,fs}.test.ts` | same target dir |

**Analog:** the files themselves.

**Pattern to follow:**
- `git mv` preserves blame.
- **Existing `safeJoinInsideVault` at `src/write/fs.ts:69–113` stays as-is** — battle-tested (symlink-resolution loop at lines 120–146 is non-trivial; do NOT rewrite).
- **`DEFAULT_CLIENT_ID` at `src/write/write.ts:76` deletes** — replaced by constructor-injected `clientId` per D-02. Search/replace `clientId ?? DEFAULT_CLIENT_ID` → `clientId ?? this.clientId`.
- **`gray-matter` import at `write.ts:13` stays** — the relocation keeps it inside `src/adapters/delivery/obsidian-fs/` (allowed by I-4). Note: this is the SECOND legitimate home of gray-matter (the first being the source adapter's `parser.ts`).
- **`fs.readFile`/`fs.writeFile`/`fs.unlink`/`fs.rename` calls stay** — all licensed by I-2/I-6 in this directory.

---

### `src/frontmatter/update.ts` (modified — drop fs + gray-matter; route via adapter)

**Analog:** existing `src/frontmatter/update.ts:1–60`.

**Pattern to follow:**
- Remove imports at lines 23–24: `import { promises as fs } from "node:fs"` AND `import matter from "gray-matter"`.
- Replace `await fs.readFile(absPath, "utf-8")` (line 237 per CONTEXT.md) + `matter(raw)` with `await source.readDocument(docId)` (returns the parsed `Document` with `properties` already populated).
- Replace the atomic write at the bottom of the function with `await delivery.update(docId, patch, opts)`.
- This is the most invasive 01-04 change — the function shrinks substantially. Preserve the merge DSL semantics; the diff-emission logic in `update.ts:47–60` stays.

---

### `src/server.ts` (modified — D-01 `formatDisplayUrl`, D-02 `client_info` capture, adapter wiring)

**Analog:** `src/server.ts:891` (current `obsidianUrl()` per CONTEXT.md D-01) AND `src/server.ts:1313` (`encodeNoteId`/`decodeNoteId` helpers).

**Pattern to follow:**
- **D-01:** delete `obsidianUrl(vault, path)` at `server.ts:891`. Replace call sites in `search`/`fetch` flat-shape adapter (search.ts: search hits' `url` field at `server.ts:1313`) with `source.formatDisplayUrl(docId) ?? <fallback>`.
- **D-02:** after `await server.connect(transport)` (current location is at the bottom of `serve()` near `server.ts:~1100`), read `server.client?.getClientInfo()?.name ?? "unknown"` and thread it as the default `clientId` into the `ObsidianFsDelivery` constructor. RESEARCH Pitfall 4 covers the fallback semantics.

---

### `src/adapters/delivery/conformance.test.ts` + `src/adapters/stub/delivery.ts` (new)

**Analog:** same templates as 01-03 conformance + stub. Substitute `DeliveryAdapter`/`StubDelivery` (writes to same `Map` as StubSource).

**Pattern to follow:**
- Stub delivery `capabilities`: `{ atomic: true, hashProtected: "none", enforcedSchema: false, naming: "caller-provided" }` (honest — in-memory writes are atomic by JS event loop but have NO OCC).
- Conformance: write→readDocument round-trip; `expectedHash` mismatch returns `{ok:false, reason:'hash_mismatch'}` for adapters that publish `hashProtected ≠ "none"`.

---

## Plan 01-05 — Change-feed adapter extraction + SDK 1.29 + Zod 4 bump

### `src/adapters/change-feed/obsidian-fs/index.ts` (new — `ObsidianFsChangeFeed` facade)

**Analog:** `src/watcher/watcher.ts:40–127` (existing `VaultWatcher` class).

**Pattern to follow:**
- Class with `start()`/`stop()`/`drain()` lifecycle (already on `VaultWatcher` lines 74, 119, 115) maps to the new interface's `subscribe(handler): Disposable` + `close(): Promise<void>`.
- **Pitfall 6 (RESEARCH lines 479–483):** preserve the chokidar config byte-for-byte from `watcher.ts:79–96` — `awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }`, `ignored: […]`, `followSymlinks: false`, `ignoreInitial: true`. **Do not edit during the move.**
- **A3 / Risk #3:** Phase 1 emits `delete` + `create` for renames (matching v1 watcher behavior at `watcher.ts:98–100`). Do NOT attempt true rename coalescing.

---

### `src/adapters/change-feed/obsidian-fs/{watcher,queue,suppression}.ts` (moved)

**From / to:**

| From | To |
|------|----|
| `src/watcher/watcher.ts` | `src/adapters/change-feed/obsidian-fs/watcher.ts` |
| `src/watcher/queue.ts` | `src/adapters/change-feed/obsidian-fs/queue.ts` |
| `src/watcher/suppression.ts` | `src/adapters/change-feed/obsidian-fs/suppression.ts` |
| 3 colocated `*.test.ts` | same target dir |

**Analog:** the files themselves (`src/watcher/watcher.ts:15-16` confirms chokidar is already cleanly imported — CONCERNS.md "Finding: clean").

**Pattern to follow:** `git mv` only; rewrite import paths.
- **I-1 enforcement flips on after this move:** the lint script (plan 01-06) greps for `chokidar` imports outside `src/adapters/change-feed/`. Zero hits expected.

---

### `src/adapters/change-feed/conformance.test.ts` + `src/adapters/stub/change-feed.ts` (new)

**Analog:** same conformance pattern as 01-03/01-04. Stub backed by `EventEmitter` — RESEARCH §Example 4 implies the pattern. Note: stub's `subscribe()` returns a `Disposable` (TS 5.2+ `Symbol.dispose`); current TS target is ES2023, so available natively.

**Pattern to follow:**
- Pitfall 6 conformance addition: assert "atomic write through delivery + suppression-marker registered → NO change event emitted" (RESEARCH lines 482–483). This is the suppression-set integration test, lifted from the existing `src/watcher/watcher.test.ts`.

---

### `src/server.ts` (modified — `registerTool` × 23, SDK 1.29 + Zod 4 migration)

**Analog:** `src/server.ts:1–80` (current import block + `Server` instantiation) PLUS `src/tool-registry.ts:1–25` (JSON-Schema literals for all 23 tools).

**Pattern to follow (RESEARCH Pitfall 2 — Option A):**

```typescript
// src/server.ts (synthesized from RESEARCH Example 1, lines 493-528)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";  // NEW (was Server)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";   // resolves to zod/v4 after the bump
import { TOOLS } from "./tool-registry.js";

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },  // raw JSON Schema — descriptions preserved
    async (args) => {
      const validated = tool.zodSchema.parse(args);  // Zod 4 at handler time
      return await tool.handler(validated);
    },
  );
}
```

— **Critical:** Use `tool.inputSchema` (the JSON Schema literal from `tool-registry.ts`) for publishing; use the Zod schema **only** for handler-time validation. This dodges Pitfall 2 (Zod-4-to-Standard-Schema description-drop bug, [SDK#1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143)).

---

### `src/tool-registry.ts` (modified — carry Zod schema alongside JSON Schema)

**Analog:** itself (`src/tool-registry.ts:1–60`).

**Pattern to follow:**
- Current shape: `{ name, description, inputSchema }` (JSON Schema literal).
- Extend each row to `{ name, description, inputSchema, zodSchema, handler }` (the planner decides whether to import the handlers here or keep them in `server.ts` and reference by name).
- The 23 Zod schemas live in `src/server.ts:49–158` today — relocate them to `tool-registry.ts` so the registry is the single source of truth (matches the Phase 0 plan-00-10 intent referenced in CONTEXT.md "Reusable Assets").

---

### `src/config/loader.ts` (modified — Zod 4 refinement sweep)

**Analog:** itself.

**Pattern to follow:**
- Per RESEARCH Pitfall 1: sweep `.refine(predicate, { message: "..." })` callsites — the `AppConfigSchema` (CLAUDE.md mentions custom refinements). Codemod `zod-v3-to-v4` handles ~80%; manual fixup for the remainder.

---

### `evals/v1-baseline/tools-list.snapshot.json` (regenerated)

**Analog:** itself.

**Pattern to follow:** run `npm run eval:snapshot` (per RESEARCH §Validation Architecture Table, Wave 0 list). Inspect diff manually for Pitfall 2 regressions before committing (RESEARCH §Manual-Only Verifications row 3 — VALIDATION.md too).

---

### `package.json` (modified — SDK + Zod bump; new scripts)

**Analog:** itself.

**Pattern to follow:**
- Bump `@modelcontextprotocol/sdk` `^1.0.4` → `^1.29.0`, `zod` `^3.24.1` → `^4.4.3` (versions verified by RESEARCH §Environment Availability).
- Add `lint:adapters` script (chains into `lint:check`) and `eval:smoketest` script. Wire-in placement matches existing `lint:check` / `eval:baseline` (CONTEXT.md "Integration Points").

---

## Plan 01-06 — CI lint + smoketest + audit + README + final polish

### `scripts/lint-adapters.sh` (new — POSIX shell CI gate enforcing I-1..I-6 + Claude-leak grep)

**Analog:** `scripts/lint-no-telemetry.sh` (full file: 37 lines) AND `scripts/check-fixture-privacy.sh` (full file: 34 lines).

**Pattern to follow:**

```bash
#!/bin/sh
# scripts/lint-adapters.sh
# (full template lives in RESEARCH §Example 5, lines 662-733)
set -eu

# Per-invariant grep, fail-loud on hit, escape-marker pattern for legitimate exceptions
violations=$(
  find src -name '*.ts' -not -name '*.test.ts' -type f \
    | xargs grep -inE "<PATTERN>" 2>/dev/null \
    | grep -v "<ALLOWED_PREFIX>" \
    || true
)
if [ -n "$violations" ]; then
  echo "✗ Invariant I-X violated:" >&2
  echo "$violations" >&2
  exit 1
fi
echo "✓ Invariant I-X clean"
```

**Conventions to copy exactly:**
- POSIX `#!/bin/sh` shebang (NOT bash) — `lint-no-telemetry.sh:1` matches.
- `set -eu` (no `pipefail` — not POSIX). See `lint-no-telemetry.sh:9`.
- Output: `✓` prefix on success, `✗` prefix on failure. See `check-fixture-privacy.sh:24,34`.
- File count on success line (e.g. `($(find src … | wc -l) files scanned)`) — see `lint-no-telemetry.sh:37`.
- **Alpine/BusyBox compatibility** (RESEARCH Risk #4) — `lint-no-telemetry.sh` already comments "POSIX-portable: tested on macOS … Alpine"; mirror that.
- One invariant per `check()` function or per block. RESEARCH §Example 5 gives the full 7-block template (I-1 through I-6 plus C-1 Claude-leak plus I-5b `obsidian://` literal).

---

### `scripts/smoketest-non-claude.mjs` (new — non-interactive Inspector CLI driver)

**Analog:** `scripts/smoketest-v0.9.0.mjs` (full file: 106 lines).

**Pattern to follow:**
- ESM `.mjs` extension (per project ESM-only convention).
- File-header TSDoc block (lines 1–14 of `smoketest-v0.9.0.mjs`) — describe what it asserts, exit-code semantics, usage.
- Argv parse: `const CLI = process.argv[2]` with usage-print fallback (lines 19–23).
- **Exit-code discipline:** track `exitCode` variable; `process.exit(exitCode)` at the end (lines 37, 106). Per RESEARCH §Assumption A6, verify Inspector CLI exits non-zero on protocol failure before relying on it.
- **Force-exit comment block** at the bottom (lines 103–106) — the v0.9.0 smoketest already documents why `process.exit` is required (server's catch-up keeps the event loop alive). Same applies.

**Inspector-CLI integration (RESEARCH "Don't Hand-Roll" row 3 + ADP-10):**

```javascript
// Invoke pattern (per RESEARCH §Don't Hand-Roll line 409):
//   npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list
// — assert exit code 0 AND JSON contains the 23 expected tool names.
```

**Deviation from `smoketest-v0.9.0.mjs`:** that script speaks MCP directly via `@modelcontextprotocol/sdk/client`. The new script can either (a) shell out to `npx @modelcontextprotocol/inspector --cli` (cleaner per RESEARCH "Don't Hand-Roll"), or (b) extend the v0.9.0 pattern by importing `Client` directly and asserting all 23 tools. **CONTEXT.md Claude's Discretion** — researcher recommends (a).

---

### `docs/v2/AGENT_AGNOSTIC_AUDIT.md` (new — leak inventory + v2/v3 labels)

**Analog:** `docs/v2/adr/ADVERSARIAL-REVIEW.md` (Phase-0 audit doc, mentioned in CONTEXT.md "Phase 0 outputs to consume directly").

**Pattern to follow (loose — audit doc, not ADR):**
- MADR-style YAML frontmatter only if `docs/v2/adr/` convention is borrowed. Audit docs are MORE free-form per the broader `docs/v2/` directory (see `docs/v2/AGENT_AGNOSTIC.md`, `docs/v2/ARCHITECTURE.md` — none have ADR frontmatter).
- Structure: H1 title + Status line + per-leak inventory table with columns `Leak / Location / Severity / Status (fixed-v2 | deferred-v3) / Rationale`.
- VALIDATION.md (lines 91): each row MUST have explicit Status column with `fixed-v2` or `deferred-v3` plus one-line rationale; maintainer signs off in PR description.

---

### `README.md` (rewritten — lead with "any MCP-aware agent")

**Analog:** itself (current first ~30 lines).

**Pattern to follow:**
- Current `README.md:1` is `**Local-first semantic memory for Obsidian vaults, exposed to AI agents over MCP.**` — preserve the tone but pivot the opening clause to "any MCP-aware agent" (ADP-14 / CONTEXT.md). Per RESEARCH §Manual-Only Verifications row 2: first sentence of first 20 lines MUST contain "any MCP-aware agent".
- Keep the existing structure (What is, What it provides, Quickstart, etc.) intact — this is a tone/framing rewrite, not a full restructure (CONTEXT.md "no user-visible behavior change").

---

### `CHANGELOG.md` (append `[Unreleased]`)

**Analog:** itself.

**Pattern to follow:** CONTEXT.md "Integration Points" specifies three subsections under `[Unreleased]`:
- `### Added` — adapter seams, conformance suite, smoketest.
- `### Changed` — SDK 1.29, Zod 4, README rewrite, default `client_id` derivation.
- `### Migration` — doc_uri Strategy A migration notes.

---

### `src/cli.ts` (modified — D-02 message rewrites)

**Analog:** itself.

**Pattern to follow:**
- Sweep for hardcoded "Claude Code" / "claude-code" strings (CONCERNS.md per CONTEXT.md). Most likely appears as user-facing log messages; replace with neutral framing ("MCP client" or `client_info.name`).

---

### `src/rerank/onnx-reranker.ts` (optional — `ModelLoader` carve-out per Risk #5)

**Analog:** `src/rerank/reranker.ts:39` (the `Reranker` interface pattern — same file is the template).

**Pattern to follow (if planner picks this):**
- Introduce `interface ModelLoader { existsSync(p: string): boolean; resolve(rel: string): string; }` colocated in `src/rerank/` (matches the `Reranker` interface placement at `reranker.ts:39`).
- `OnnxReranker` constructor takes a `ModelLoader`; production loader uses `node:fs.existsSync` + `node:path.join`; tests pass a stub.
- This carves out the I-2/I-3 grep allow-list — no longer need to special-case `src/rerank/` in `lint-adapters.sh`. **Per CONTEXT.md "Deferred / Claude's Discretion"** — planner may skip this and add `src/rerank/` to the I-2/I-3 allow-list instead.

---

### `.github/workflows/ci.yml` (modified — wire lint-adapters + smoketest)

**Analog:** itself (`.github/workflows/ci.yml:1–35` — Lint+test job).

**Pattern to follow:**

```yaml
# Current step (ci.yml:31-32):
- name: Lint (shell + tsc + prettier)
  run: npm run lint:check
```

— `npm run lint:check` already chains the existing shell lints. Extend `package.json:scripts.lint:check` to invoke `sh scripts/lint-adapters.sh`. Add a new top-level step for the smoketest:

```yaml
- name: Smoketest (non-Claude MCP Inspector)
  run: npm run build && node scripts/smoketest-non-claude.mjs
```

— place after the existing `Test` step. Plan 01-06 also confirms `dist/cli.js` still bundles under SDK 1.29 / Zod 4 (RESEARCH Pitfall 7).

---

## Shared Patterns (cross-cutting)

### S-1: File header TSDoc block

**Source:** `src/rerank/reranker.ts:1–35`, `src/write/write.ts:1–10`, `src/watcher/watcher.ts:1–13`, `src/db/schema.ts:1–11`.

**Apply to:** every new `.ts` file in `src/adapters/**`.

**Pattern:** 10–35 line block-comment with (a) one-paragraph "what this file does", (b) "Strategy" or "Lifecycle" subheading, (c) "Failure semantics" or "Concurrency" subheading. See `reranker.ts:1–35` for the longest exemplar in the codebase.

---

### S-2: ESM `.js` extension on relative imports + `import type` for type-only

**Source:** universal — `src/server.ts:14–43`, `src/db/database.ts:1–12`, every file.

**Apply to:** every new `.ts` file.

**Pattern:** `import { foo } from "./bar.js";` even though source is `bar.ts`. `verbatimModuleSyntax: true` in `tsconfig.json` enforces — type imports MUST use `import type`. Example: `src/db/queries/notes.ts:2 — import type { NoteRow } from "../../types.js";`.

---

### S-3: Discriminated-union result types via `ok: true|false`

**Source:** `src/write/write.ts:19–35` (`WriteResult = WriteSuccess | WriteConflict`).

**Apply to:** new `DeliveryAdapter.write` / `update` / `delete` return shapes (01-04).

**Pattern:** `interface XxxSuccess { ok: true; … }` + `interface XxxConflict { ok: false; reason: "…"; … }` + `type Result = Success | Conflict`. Callers discriminate by `.ok`.

---

### S-4: Co-located `*.test.ts` (vitest, no config file)

**Source:** every test in `src/` — e.g. `src/db/database.test.ts`, `src/rerank/reranker.test.ts`, `src/search/hybrid.test.ts`.

**Apply to:** every new adapter file's tests.

**Pattern:**

```typescript
// src/rerank/reranker.test.ts:1-9 (template)
import { describe, it, expect, vi } from "vitest";
import { ObsidianFsSource } from "./obsidian-fs/index.js";

describe("ObsidianFsSource", () => {
  it("…", async () => { expect(…).toBe(…); });
});
```

**Exception:** conformance tests (cross-adapter, parameterized) live colocated at `src/adapters/{source,delivery,change-feed}/conformance.test.ts` per CONTEXT.md "Established Patterns" (TESTING.md says co-located is default; conformance is the planner's-choice exception).

---

### S-5: `Vault` struct as the unit of access

**Source:** `src/vault/manager.ts:17` — `interface Vault { config: VaultConfig; db: Database; dbPath: string }`.

**Apply to:** adapter constructors (`ObsidianFsSource`, `ObsidianFsDelivery`, `ObsidianFsChangeFeed`) — accept `Vault` (or a narrower projection like `{name, path}`) as the only parameter beyond inputs the interface contract requires.

**Pattern:** `constructor(private readonly vault: VaultConfig) {}` per RESEARCH §Pattern 1 line 292.

---

### S-6: SQLite migration shape (append-only, version-keyed)

**Source:** `src/db/schema.ts:388–419` (`MIGRATIONS: readonly Migration[]`).

**Apply to:** MIGRATION_007 + MIGRATION_008 in plan 01-02.

**Pattern:**
- Static-SQL migration: `const MIGRATION_NNN_NAME = \`…SQL…\`;` + `{ version: N, description: "...", sql: MIGRATION_NNN_NAME }`.
- Function-style migration: `function runMigrationNNN(db: BetterSqlite3Database): void { … }` + `{ version: N, description: "...", run: runMigrationNNN }`.
- TSDoc above each constant explaining "Why" + indexer behavior (see `MIGRATION_006_BODY_HASH` JSDoc at `schema.ts:365–382` for the gold-standard template).

---

### S-7: POSIX shell lint script style

**Source:** `scripts/lint-no-telemetry.sh` + `scripts/check-fixture-privacy.sh`.

**Apply to:** `scripts/lint-adapters.sh` in plan 01-06.

**Pattern:**
- `#!/bin/sh` shebang (NOT `#!/bin/bash`).
- `set -eu` (no `pipefail`).
- One-paragraph header comment per `lint-no-telemetry.sh:1–7`.
- `find src -name '*.ts' -not -name '*.test.ts' -type f` traversal.
- Exit 1 with `✗` prefix + violation list on failure; `✓` prefix on success.
- POSIX-portable; Alpine-compatible note in header per `check-fixture-privacy.sh:7`.

---

## No Analog Found

| File | Plan | Reason | Mitigation |
|------|------|--------|------------|
| `tests/types/docid-brand.test-d.ts` | 01-01 | No existing `*.test-d.ts` / `tsd` / `expect-type` use in codebase | Use `@ts-expect-error` directive lines inside a plain `.test-d.ts`; rely on `tsc --noEmit` (already in `lint:check`). Alternative: add `expect-type` devDep. Planner picks. |
| `src/adapters/source/conformance.test.ts` (and delivery + change-feed siblings) | 01-03–05 | No existing parameterized (`describe.each`) test in repo | Vitest `^2.1.8` supports `describe.each` natively; introduce it as a new pattern. Template sketched above. |
| `src/adapters/stub/change-feed.ts` | 01-05 | No EventEmitter-based test fixture exists in the repo (chokidar is the only event source today) | Standard `EventEmitter` from `node:events`; `subscribe()` registers a handler, `emit("create", …)` from test code drives events synchronously. |
| `docs/v2/AGENT_AGNOSTIC_AUDIT.md` | 01-06 | Audit docs (vs ADR / decision docs) don't have a strict precedent in the repo | Loosely model on `docs/v2/adr/ADVERSARIAL-REVIEW.md`'s "10 findings" table format (CONTEXT.md "Phase 0 outputs to consume directly"). No frontmatter required. |

---

## Metadata

**Analog search scope:** `src/`, `scripts/`, `docs/v2/`, `evals/v1-baseline/`, `.github/workflows/`, top-level config files.
**Files scanned for analogs:** ~30 source files + 5 scripts + 4 ADRs + 1 README + 1 CI workflow.
**Pattern extraction date:** 2026-05-14.
**Phase boundary:** zero user-visible behavior change; ESM-only; Node ≥22; SDK ≥1.29; Zod ≥4; backwards-compat enforced by `evals/v1-baseline/tools-list.snapshot.json` + 324 vitest tests.

---

## PATTERN MAPPING COMPLETE
