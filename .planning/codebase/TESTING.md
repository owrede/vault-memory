# Testing Patterns

**Analysis Date:** 2026-05-14

## Test Framework

**Runner:**
- Vitest 2.1.x
- Config: none — Vitest runs with defaults (`vitest.config.*` not present; `package.json` scripts only)
- No `setupFiles`, no `globalSetup`, no coverage thresholds configured

**Assertion Library:**
- Vitest built-in (`expect`, matchers)

**Run Commands:**
```bash
npm test               # vitest run (single pass, CI mode)
npm run test:watch     # vitest (watch mode)
# Coverage: not configured — no npm script for it
```

## Test File Organization

**Co-located.** Every test file lives next to its source file in the same directory:
```
src/
├── server.ts
├── server.test.ts
├── chunker/
│   ├── chunker.ts
│   ├── chunker.test.ts
│   ├── headings.ts
│   ├── headings.test.ts
│   ├── tokens.ts
│   └── tokens.test.ts
├── db/
│   ├── database.ts
│   ├── database.test.ts
│   ├── schema.test.ts
│   └── queries/
│       ├── notes.ts
│       ├── embeddings.test.ts
│       ├── fts.test.ts
│       ├── ...
```

No `tests/` or `__tests__/` top-level directories. Tests are excluded from the TypeScript build via `tsconfig.json`:
```json
"exclude": ["node_modules", "dist", "**/*.test.ts"]
```

## Test Counts (verified)

- **39 test files** (`find . -name "*.test.ts" -not -path "*/node_modules/*"`)
- **360 test cases** (`grep -rh "^\s*\(it\|test\)(" src --include="*.test.ts" | wc -l`)

The brief's claim of 324 tests across 35 files is lower than current state; the codebase has grown.

## Test Structure

**Suite Organization (consistent across all files):**
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("ComponentName (scope)", () => {
  // shared state
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  describe("nested sub-feature", () => {
    it("does the expected thing", () => {
      // arrange, act, assert — no labels
      const result = someFunction(input);
      expect(result).toEqual(expected);
    });
  });
});
```

**`beforeAll`/`afterAll`** used only when shared setup is expensive and safe to share across tests (e.g., `src/reader/parser.test.ts`, `src/reader/scanner.test.ts` — create a single tmpdir for all tests in the suite):
```typescript
// src/reader/parser.test.ts
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-parse-"));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
```

## Mocking

**Framework:** Vitest's `vi` object (`vi.fn`, `vi.mock`, `vi.spyOn`, `vi.useFakeTimers`)

**What is mocked:**

1. **HTTP/fetch** — `globalThis.fetch` is replaced for `OllamaClient` tests (`src/ollama/client.test.ts`):
   ```typescript
   // Save and restore pattern
   let originalFetch: typeof globalThis.fetch;
   beforeEach(() => { originalFetch = globalThis.fetch; });
   afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

   const fetchMock: FetchMock = vi.fn(async () => jsonResponse({ embeddings: [...] }));
   globalThis.fetch = fetchMock as unknown as typeof fetch;
   ```

2. **OllamaClient** — Mocked as a structural duck-type, not a full mock:
   ```typescript
   // src/indexer/single.test.ts
   const embed = vi.fn(async (req: EmbedRequest): Promise<EmbedResponse> => ({
     vectors: req.texts.map((_, i) => unitVector(DIM, i)),
     ...
   }));
   const client = { embed } as unknown as OllamaClient;
   ```

3. **Reranker** — Mocked as a plain object with a `score` function:
   ```typescript
   // src/search/hybrid.test.ts
   score: vi.fn(async (_q: string, chunks: readonly string[]) =>
     chunks.map(() => 0.5),
   ),
   ```

4. **Timers** — `vi.useFakeTimers()` / `vi.useRealTimers()` for debounce/queue tests (`src/watcher/queue.test.ts`):
   ```typescript
   beforeEach(() => { vi.useFakeTimers(); });
   afterEach(() => { vi.useRealTimers(); });
   await vi.advanceTimersByTimeAsync(500);
   ```

**What is NOT mocked (always real):**

- **SQLite / Database** — Every DB test uses a real `better-sqlite3` + `sqlite-vec` database at `:memory:`. Migration is run in `beforeEach`. This provides full integration fidelity at near-unit-test speed.
- **File system** — Tests that exercise `writeNote`, `parseNote`, `scanVault`, or the watcher use real `os.tmpdir()` temporary directories created in `beforeEach` and removed in `afterEach`.
- **Chokidar FSWatcher** — `src/watcher/watcher.test.ts` uses a real chokidar watcher on a tmpdir vault (documented in the test file header).

## Fixtures and Factories

**No fixture files.** Test data is constructed inline using factory helper functions defined at the top of each test file. Common patterns:

```typescript
// Vault factory (used across many test files)
function makeVault(vaultRoot: string): Vault {
  const db = new Database(":memory:");
  db.models.upsert({ name: MODEL, provider: "ollama", dim: DIM });
  return { config: { name: "test", path: vaultRoot }, db, dbPath: ":memory:" };
}

// Note insertion helper
function insertNote(path: string, frontmatter: Record<string, unknown> | null): void {
  db.notes.upsertByPath({
    path, content: "body", frontmatter: frontmatter ? JSON.stringify(frontmatter) : null,
    title: path, hash: `h-${path}`, mtime: Date.now(), wordCount: 1,
  });
}

// Synthetic vault seeder (schema/combiner.test.ts)
function seedSyntheticVault(vault: Vault): { persons: number; meetings: number } {
  for (let i = 0; i < 6; i++) {
    seedNote(vault, `Personen/p${i}.md`, { class: "Person", type: "person" });
  }
  // ...
}
```

**One-hot vector helpers** are used extensively in embedding/hybrid search tests to create deterministic, mathematically-precise test vectors:
```typescript
const DIM = 1024;
const oneHot = (i: number): number[] => {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
};
```

## Skip-if-Missing Pattern

For tests that require out-of-band downloaded assets (ONNX model, ~570 MB), the suite skips gracefully rather than failing:
```typescript
// src/rerank/onnx-reranker.test.ts
const hasModel = existsSync(join(modelDir, "model_quantized.onnx")) &&
                 existsSync(join(modelDir, "tokenizer.json"));
const maybe = hasModel ? describe : describe.skip;

maybe("OnnxReranker", () => { ... });
```

This keeps `npm test` green in CI and on fresh contributor machines.

## Coverage

**Requirements:** None enforced. No coverage thresholds in vitest config or CI.

**Coverage command:** Not configured as an npm script. To run manually:
```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests (pure functions):**
- Scope: single exported function, no I/O dependencies
- Examples: `src/chunker/chunker.test.ts`, `src/reader/wikilinks.test.ts`, `src/search/glob.test.ts`, `src/server.test.ts` (encodeNoteId, truncateSnippet)
- No setup required; inline data only

**Integration Tests (DB + FS):**
- Scope: multi-layer operations with real SQLite in `:memory:` and real tmpdir
- Examples: `src/db/database.test.ts`, `src/indexer/single.test.ts`, `src/write/write.test.ts`, `src/watcher/watcher.test.ts`
- Pattern: `beforeEach` creates fresh resources, `afterEach` tears them down

**Regression Tests:**
- Named inline as regression cases with version references:
  ```typescript
  // ── Regression tests for crash triggers found in v0.6.0 eval ────────────
  it("eval-note-bias case from v0.6.0 eval report", () => { ... });
  ```

**E2E / Smoke Tests:**
- NOT part of vitest — separate scripts: `scripts/smoketest-v0.9.0.mjs`, `scripts/smoketest-v0.9.0.sh`, `scripts/smoke.ts`
- These require a running Ollama instance and a real vault; excluded from `npm test`

## Async Testing

**All async tests use `async`/`await`:**
```typescript
it("indexes a brand-new note", async () => {
  const abs = await writeNote("Foo.md", "# Foo\n\nHello world.");
  const result = await indexNote({ vault, absolutePath: abs, ... });
  expect(result.status).toBe("indexed");
});
```

## Error Testing

**Discriminated union checks with type narrowing guard:**
```typescript
// Pattern used in write.test.ts, fs.test.ts
it("conflict when expectedHash is wrong", async () => {
  const res = await writeNote({ ..., expectedHash: "deadbeef" });
  expect(res.ok).toBe(false);
  if (res.ok) return;  // TypeScript type guard
  expect(res.reason).toBe("hash_mismatch");
});
```

**Exception testing:**
```typescript
it("rejects malformed ids", () => {
  expect(() => decodeNoteId("no-separator")).toThrow();
  expect(() => decodeNoteId(":leading-empty-vault")).toThrow();
});
```

---

*Testing analysis: 2026-05-14*
