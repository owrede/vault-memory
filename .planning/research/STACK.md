# Stack Research — vault-memory v2 (Agentic Knowledge Layer)

**Domain:** agentic knowledge layer / RAG-for-agents over Obsidian via MCP
**Researched:** 2026-05-14
**Overall confidence:** HIGH for MCP/Zod/Ollama/JSON-Canvas/Notion (verified against official sources). MEDIUM for migration tooling (multiple viable choices, no winner). MEDIUM for eval harness (landscape shifted in 2026 — Promptfoo joined OpenAI March 2026, still MIT-licensed).

> **v1 carry-over scope.** The brief locks Node ≥22, TypeScript 5.7+, ESM-only, `better-sqlite3`, `sqlite-vec`, `onnxruntime-node`, `@huggingface/tokenizers`, `chokidar`, `zod`, `smol-toml`, `gray-matter`, `vitest`, `tsup`, `prettier`. This document does **not** re-litigate those. It addresses the *new* surface area Phases 0–10 introduce, and flags the v1 dependencies whose minor/major bumps v2 should adopt or defer.

---

## Section 1 — MCP SDK & Client Interoperability

### Recommendation

**Upgrade `@modelcontextprotocol/sdk` to `^1.29.x` during Phase 1.** Stay on the 1.x line through v2.0.0; v2.0.0 of the SDK is anticipated Q1 2026 (likely already arrived as Phase 10 approaches) and should be deferred to a v3.x vault-memory minor bump.

| Decision | Choice | Confidence |
|----------|--------|------------|
| SDK upgrade target for v2 | `@modelcontextprotocol/sdk ^1.29.0` | HIGH |
| Schema interop strategy | Adopt Standard Schema; keep Zod as the implementation | HIGH |
| Sampling capability use | NO for v2 core; tag as Phase 6 ADR option | HIGH |
| Elicitation capability use | YES, opt-in for Phase 7 contract `instantiate_contract` | MEDIUM |
| Spec target | 2025-11-25 spec ("the largest set of changes since launch") | HIGH |

### Why upgrade from `^1.0.4`

1. **Standard Schema landed.** Since ~1.20, `RegisteredTool.inputSchema/outputSchema` and `RegisteredPrompt.argsSchema` accept `StandardSchemaWithJSON` instead of Zod's `AnySchema`. Zod v4 implements the interface natively; vault-memory's existing Zod schemas continue to work unchanged. **This is the unlock for Phase 7's contract DSL** — contracts can declare input shapes once and have them validated everywhere.
2. **2025-11-25 spec features.** Async tasks, enhanced sampling, elicitation, server-side agent loops, Client ID Metadata Documents, client security requirements, and an extensions system. The spec's *extensions system* is the right home for vault-memory's capability descriptors (per ADR-002) rather than re-inventing one.
3. **Tool/Prompt method signature cleanup.** Deprecated `.tool` / `.prompt` / `.resource` overloads removed. v1.0.4-era code needs touchups but the migrations are mechanical (`server.tool(name, schema, handler)` → `server.registerTool(name, {inputSchema}, handler)`).
4. **Removed schema helpers.** `SchemaInput`, `schemaToJson`, `parseSchemaAsync`, `getSchemaShape`, `getSchemaDescription`, `isOptionalSchema`, `unwrapOptionalSchema` are gone. Replace with `standardSchemaToJsonSchema` and `validateStandardSchema`. None of these are currently imported by vault-memory v1 (verified: grep `src/` for these symbols returns zero hits in `STACK.md` snapshot).

### Sampling and elicitation — where to use them

**Sampling** (server asks the client to do an LLM call on the server's behalf) is the right answer to the **Phase 6 `compile_brief` LLM strategy** ADR. Caller-passed text vs. local Ollama call has a third option that beats both: use MCP **sampling** to ask the *connected agent* (Claude Code, ChatGPT, etc.) to do the summarization. Pros: no LLM coupling in vault-memory core; works with whatever model the user already configured; preserves the local-first invariant. Cons: depends on the client implementing sampling (Claude Code does; others vary). Recommend: **sampling first, fall back to local Ollama**, never bundle an LLM dependency.

**Elicitation** (server pauses to ask the user for input mid-tool-execution) is the right surface for **Phase 7 `instantiate_contract`** when a contract has required inputs the caller didn't pass. Without elicitation the tool errors with a structured "missing input" message; with elicitation the user gets a prompt. Make it opt-in via a tool parameter (`interactive: true`) so non-interactive callers (CI, batch scripts) still get the error path.

### Tool schema evolution

The spec's **extensions system** lets vault-memory annotate tool schemas with custom capability metadata without breaking older clients. Two concrete uses:

- **Contract bindings.** A tool can carry an extension `vault-memory/contract` pointing at the contract it instantiates, so MCP clients with a contract-aware UI can render a richer form.
- **Adapter capability hints.** `vault-memory/requires-capabilities: [atomic-write]` lets clients warn before invocation when the configured sink doesn't support the capability (per ADR-002's `DeliveryCapabilities`).

Both are additive; older clients see them as unknown fields and ignore them (per the MCP spec's forward-compatibility contract).

### What this means for the codebase

- `src/server.ts` migrates from `.tool(...)` to `.registerTool(...)` per current SDK conventions. Mechanical refactor; touches every tool registration.
- `src/server.ts` gains a sampling client probe at startup and caches the result; `compile_brief` branches on it.
- New helper `src/mcp/elicitation.ts` wraps the elicitation request/response pattern for use by Phase 7.

---

## Section 2 — Task Contract DSL

### Recommendation

| Decision | Choice | Confidence |
|----------|--------|------------|
| Contract storage format | **YAML** (`.yaml` files in `_contracts/`) | HIGH |
| Validation library | **Zod 4** schemas validated through Standard Schema | HIGH |
| Versioning | Embed `version: "1"` field; tolerate-with-warning for unknown versions | HIGH |
| External standard to align with | **None winning yet** — design own DSL; expose via MCP extensions for forward-compat | MEDIUM |
| YAML parser | **`yaml` ^2.6.0** (eemeli/yaml) — comments preserved, round-trippable | HIGH |

### Why YAML, not JSON or TOML

- **YAML in 2026 is the de facto declarative agent DSL.** CrewAI ships YAML configs for agents and tasks; Pydantic AI introduced AgentSpec (YAML/JSON loader); k8s/CI/Terraform-adjacent tooling all use YAML; comments survive round-trip. Users authoring contracts will write them by hand.
- **JSON loses comments.** Contracts will accumulate "why is this filter here" rationale next to the rules. JSON-with-comments (JSON5/JSONC) is a fragmentation choice; YAML is the lingua franca.
- **TOML is wrong shape for nested graphs.** vault-memory's `config.toml` is flat-key-friendly; contracts have nested `assembly` arrays of step objects. TOML's array-of-tables syntax becomes hard to read at depth 3+.
- **Phase 8's Canvas decompiler emits YAML.** Round-trip: YAML → canvas → YAML byte-equal. YAML's comment preservation is the only realistic way to keep node positions and authoring notes through the round-trip without introducing a separate sidecar file.

### Why Zod 4 (not Valibot, not ArkType)

- vault-memory v1 already uses `zod ^3.24.1` everywhere. Upgrading to Zod 4 is in-place; switching libraries is a rewrite for zero gain.
- **Zod 4 performance.** 14× faster string parsing, 7× faster array parsing, 6.5× faster object parsing vs v3. 57% smaller core bundle. 100× reduction in TS instantiations — measurable improvement in vault-memory's already-slow type-check pass.
- **JSON Schema generation is first-class in Zod 4.** Use `z.toJSONSchema(schema)` to emit the contract input schema for MCP tool registration and for the Canvas editor palette.
- **Standard Schema compliance.** Zod v4 implements `~standard.validate` and `~standard.jsonSchema` natively — so MCP SDK 1.29's `StandardSchemaWithJSON` requirement is satisfied without adapter code.
- **`zod/v4-mini` for shipped runtime.** Tree-shakeable variant; use in the tsup bundle if bundle size matters at install time.

### Existing contract standards to align with — assessment

| Standard | Verdict | Why |
|----------|---------|-----|
| Anthropic Skills (skill.md format) | **Don't align** | Skills are *one client's* authoring UX. Contracts are an MCP server's tool surface. Different layer per AGENT_AGNOSTIC.md. |
| OpenAI Assistants tool schema | **Don't align** | OpenAI's "Assistants" API is being deprecated in favor of Responses API + MCP. Aligning would be picking a sinking ship. |
| MCP RFCs for tool definitions | **Align via MCP SDK only** | The MCP spec is the canonical contract per AGENT_AGNOSTIC. Contracts go through `instantiate_contract` MCP tool; the contract DSL itself is vault-memory's. |
| CrewAI YAML configs | **Mimic shape, don't import** | Reasonable starting reference. But CrewAI's DSL is task-execution-oriented; vault-memory's is assembly-oriented (no "agent" concept). |
| Pydantic AI AgentSpec | **Mimic the load-from-file pattern, don't import** | Pydantic AI is Python; we get nothing from coupling. |
| LangGraph state schema | **Don't align** | LangGraph is graph-execution. Vault-memory contracts are step lists; we're not building a workflow engine. |

**Verdict:** No external standard is winning hard enough in May 2026 to align with. Design our own DSL, keep it simple (per ADR-003's "smaller is better" pattern), validate with Zod 4, and document version `"1"` clearly so future versions can coexist.

### Contract DSL shape (Zod schema sketch)

```typescript
const ContractSchema = z.object({
  version: z.literal("1"),
  name: z.string().min(1).max(64),
  description: z.string().optional(),
  inputs: z.record(z.string(), InputDef),     // {name: {type, required, default?}}
  sources: z.record(z.string(), z.object({    // named source handles
    handle: SourceHandleSchema,
    requires: z.array(z.string()).optional(), // capability requirements
  })),
  assembly: z.array(AssemblyStep),            // ordered list of tool calls
  output_shape: z.record(z.string(), z.string()), // jq-like accessor paths
  write_back: WriteBackBlock.optional(),
});
```

`AssemblyStep` is a discriminated union over the assembly tools (`assemble_dossier`, `recall`, `search_hybrid`, `search_sections`, `expand`, etc.) per the brief's Phase 7 deliverable. Each variant carries the tool's existing Zod input schema, so the same validator runs at contract-write time and tool-call time.

---

## Section 3 — Visual Contract Editor (Obsidian Canvas)

### Recommendation

| Decision | Choice | Confidence |
|----------|--------|------------|
| Canvas file format | **JSON Canvas 1.0** (official spec, 2024-03-11, no 1.1 published) | HIGH |
| Canvas parser/writer | **Custom TypeScript types + `zod` schema** (NOT `@trbn/jsoncanvas`) | MEDIUM |
| Plugin vs file-watcher | **File-watcher first** (per brief's Phase 8 spike decision); plugin only if friction demands | HIGH |
| Plugin tooling (if built) | Standard obsidian-sample-plugin scaffold, `obsidian` types, esbuild | HIGH |

### Why custom Zod types over `@trbn/jsoncanvas` or `JSON Canvas Viewer`

- The two existing TS libraries are *viewers*. Vault-memory needs **compiler** semantics (canvas → YAML contract round-trip with byte-equal preservation modulo whitespace). Their parsing is fine; their writing strategies don't preserve unknown fields, which breaks the brief's round-trip acceptance criterion.
- JSON Canvas spec is ~60 lines of types. The marginal cost of importing a library is greater than the cost of typing it ourselves.
- The spec is *extensible by design* ("Add your own fields to nodes and edges — other apps will simply ignore unknown fields"). Vault-memory will add fields (e.g. `vault-memory/step-config` on text nodes representing assembly steps). Custom types let us encode these without forking.

### File-watcher strategy (recommended)

Per the brief's Phase 8 risk note, default to: user edits `.canvas` in Obsidian as a normal file, the existing `ChangeFeed` adapter sees the change, vault-memory's contract compiler re-parses and regenerates the YAML. No plugin required. This keeps the editor adapter-aligned (everything still flows through `obsidian-fs` `ChangeFeed`) and avoids Obsidian community plugin store distribution overhead.

A small Obsidian plugin becomes worthwhile **only if** users complain that Canvas's default node palette is unhelpful — at which point ship a plugin that adds a "vault-memory step" node template menu. Defer that to a v2.1 spike.

### Obsidian Plugin API (if needed in Phase 8)

- **Package:** `obsidian` (the type-definition package; runtime is provided by Obsidian)
- **Scaffold:** Fork `obsidianmd/obsidian-sample-plugin` — current minimum app version 1.5+, esbuild-based, watch-mode rebuild.
- **`manifest.json` requirements:** `id` (no "obsidian-" prefix per forum guidance), `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly: true` (vault-memory is desktop only).
- **Key APIs:** `Vault` (file access — but vault-memory already does file access via `obsidian-fs` adapter), `Workspace` (panel registration if a custom Canvas-aware view is added), `MetadataCache` (frontmatter — but defer to gray-matter for parity with adapter).
- **Distribution:** Bundled with the repo (`obsidian-plugin/` subdir), NOT submitted to community plugin store this milestone (per "Out of Scope" in PROJECT.md).

---

## Section 4 — Brief Compilation / Summarization

### Recommendation

| Decision | Choice | Confidence |
|----------|--------|------------|
| Primary LLM strategy | **MCP Sampling** (defer to connected agent's LLM) | HIGH |
| Fallback strategy | **Local Ollama via `ollama ^0.5.x`** with `format: {type: "object", ...}` JSON-schema output | HIGH |
| Hard rule | **Never bundle a remote LLM API client** in v2 (no OpenAI/Anthropic SDK) | HIGH |
| Default Ollama chat model | `qwen2.5:7b-instruct` (best structured-output reliability for size); fallback `llama3.2:3b-instruct` | MEDIUM |
| Token budgeting | Caller passes `max_tokens`; vault-memory truncates source bundle to budget − reserve | HIGH |
| Streaming | Yes for Ollama path; MCP sampling supports streaming too | HIGH |

### Three options compared

| Option | Pro | Con | When |
|--------|-----|-----|------|
| (a) Caller passes pre-summarized text | Zero LLM coupling. Purest. | Useless out-of-box. Every caller reimplements. | Fallback for advanced users. |
| (b) Local Ollama chat call | Works offline. Local-first invariant intact. | Slow on small models. Quality dependent on user's model choice. | When sampling unavailable. |
| (c) **MCP sampling** (recommended primary) | Uses caller's already-configured high-quality LLM. No vault-memory LLM coupling. | Depends on client implementing sampling (some don't yet). | Default path. |

Implementation: `compile_brief` probes the connected client's capabilities. If `sampling: true`, route through the SDK's `createMessage` sampling request. If not, attempt local Ollama. If neither works, return a structured error pointing the caller at option (a) — pass `pre_summarized_text`.

### Ollama details (the fallback path)

- **npm package:** `ollama ^0.5.x` (official, actively maintained, supports both `chat()` streaming and `format` parameter).
- **JSON-mode strategy:** Use the **JSON Schema variant** (`format: {type: "object", properties: {...}}`), not the legacy `format: "json"` flag. JSON Schema constrains the model to a structure; bare `"json"` only constrains it to *some* JSON.
- **Model requirements.** `qwen2.5` family auto-uses TOOLS mode; structured output reliability is best in the 7B+ range. Document a `[brief_compilation]` section in `config.toml` letting users pick: `model = "qwen2.5:7b-instruct"`.
- **Streaming.** Use `chat({stream: true})`; pipe chunks back through the MCP tool's progress notifications. The SDK supports progress per the 2025-11-25 spec; this is a Phase 6 nice-to-have.
- **No agentic loop in vault-memory.** Briefs are single-shot summarization. If `compile_brief` becomes a multi-turn refinement, do it at the *caller's* layer, not in vault-memory.

### Token budgeting

Reuse the `truncate_to_token_budget(text, max_tokens)` helper that the ONNX reranker pipeline already has (or extract it from `src/rerank/onnx-reranker.ts`). Use a coarse `~4 chars/token` heuristic for budgeting source-bundle inputs; precise tokenization isn't worth the dependency on a tokenizer library for the chat path.

---

## Section 5 — Adapter / Connector Pattern

### Recommendation

| Decision | Choice | Confidence |
|----------|--------|------------|
| Capability descriptor approach | **Plain TS interfaces with const `as const` arrays** (per ADR-002) | HIGH |
| ChangeFeed iteration model | **Callback-based `subscribe(handler): Disposable`** per ADR-002 | HIGH |
| Adapter registry pattern | **Factory functions registered at startup**, NOT plugin-loader (per ADR-002) | HIGH |
| Prior art to consult | **Drizzle adapters + Prisma data sources** for shape; **lowdb** for simplicity reference | MEDIUM |
| Async iterator usage | YES for `listDocuments()` (per ADR-002), NOT for ChangeFeed | HIGH |

### Why callback-based `subscribe`, not AsyncIterator, for ChangeFeed

- Per ADR-002, `subscribe(handler): Disposable` matches chokidar's existing model — minimum-friction refactor.
- AsyncIterator is appealing for cancellation semantics, but Node's `chokidar` (and Notion webhooks in Phase 10) are both push-model. Wrapping push into pull-iteration is bug-prone (backpressure, dropped events on slow consumers).
- The `Disposable` return aligns with the TC39 `Symbol.dispose` / `using` proposal which is stable in TypeScript 5.2+. v2 can opt into `using subscription = feed.subscribe(...)` semantics natively.

### Why AsyncIterator for `listDocuments`

- Bulk enumeration is naturally pull-model. The indexer wants "next document please" with backpressure.
- ADR-002's `listDocuments(opts?): AsyncIterable<DocumentRef>` is correct.
- Notion's pagination (cursor + page-size) maps cleanly: each `await iterator.next()` may trigger an API call.

### Prior art assessment

| Library | Take | Use |
|---------|------|-----|
| **Drizzle dialects** | Strong shape: `Dialect` interface with `escape()`, `prepare()`, etc. Capabilities advertised as boolean flags on the dialect. | Mirror the boolean-flag approach for our `SourceCapabilities` / `DeliveryCapabilities`. |
| **Prisma data sources** | Heavy code-gen, schema-language. Too much. | **Don't import.** Inspiration only — capability flags exist (e.g., `previewFeatures`). |
| **Kysely dialects** | Similar to Drizzle but smaller surface. Plain TS, no codegen. | Closer match to our needs than Drizzle. Look at `Dialect` and `Driver` interfaces. |
| **lowdb adapters** | Tiny adapter pattern (`Adapter<T>` with `read()/write()`). | Reference for absolute minimum. ADR-002's interfaces are richer because reads are non-trivial. |
| **Sequelize dialects** | Old, heavy, class hierarchies. | **Avoid.** Anti-pattern reference. |

### Capability descriptors — keep them honest

A real risk per ADR-002: an adapter that declares `atomic: true` and silently loses writes erodes trust. Ship a **capability-contract test suite** in Phase 1 (deferred to Phase 10's real test): a set of vitest tests every adapter runs against, parameterized on the capability descriptors. If you declare `atomic: true`, you pass the atomic-write test. Treat capability descriptors as load-bearing typed promises, not advisory metadata.

---

## Section 6 — DB Migration Tooling

### Recommendation

| Decision | Choice | Confidence |
|----------|--------|------------|
| Migration approach | **Plain SQL files + tiny custom runner** (`src/db/migrations/`) | HIGH |
| Versioning mechanism | SQLite's `user_version` PRAGMA | HIGH |
| What NOT to adopt | `db-migrate`, `umzug`, `drizzle-kit`, `kysely-migrator`, `node:sqlite` core module | MEDIUM |
| Rationale | vault-memory's schema is small, owned, embedded — external tooling adds dependencies for no payoff | HIGH |

### Why plain SQL files

- vault-memory's current schema lives in `src/db/schema.sql` / programmatic creates. Migrations are rare (per the brief: Phase 1 adds `doc_uri`; Phase 5 adds `edge_type`; Phase 1 adds `source_handle`). Maybe 5–10 migrations in the v2 lifetime.
- External migration libraries solve problems vault-memory doesn't have: multi-database support (Postgres + SQLite + MySQL), team-of-developers concurrent migration creation (single maintainer), CI/CD migration drift detection (single-binary install).
- `user_version` PRAGMA is built into SQLite — `PRAGMA user_version` returns an int, set after each successful migration. ~30 lines of TS to iterate `001_doc_uri.sql`, `002_edge_type.sql`, etc.

### What the runner looks like

```typescript
// src/db/migrate.ts (sketch)
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export function runMigrations(db: Database, migrationsDir: string): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  const files = readdirSync(migrationsDir)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10);
    if (version <= currentVersion) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
```

Add a corresponding `down_NNN.sql` convention if rollback is ever required; the brief doesn't currently require rollback (forward-only is fine for the v1→v2 migration).

### What NOT to use

| Tool | Why not |
|------|---------|
| **`umzug`** | Excellent library, but designed for migration-heavy projects. Adds a dependency, a sub-API, and a meta-table for ~5 migrations. Overkill. |
| **`@blackglory/better-sqlite3-migrations`** | Minor maintenance footprint, sparse docs, niche author. Use the pattern (`user_version` tracking), skip the package. |
| **`db-migrate`** + `db-migrate-sqlite3` | Old (last release multiple years ago for sqlite driver). Doesn't fit ESM-only. |
| **`drizzle-kit`** | Requires adopting Drizzle ORM. Vault-memory uses raw `better-sqlite3` and should keep doing so — Drizzle would be a substantial rewrite for zero benefit at the current query complexity. |
| **`kysely-migrator`** | Same — requires Kysely. |
| **`node:sqlite`** core module (Node 22.5+) | Still experimental, requires `--experimental-sqlite` flag. `better-sqlite3` is faster, mature, and supports `sqlite-vec` extension loading. Defer until at least Node 24 LTS. |

### Migration plan for v2

Phase 1 migrations to ship:
1. `001_doc_uri.sql` — `ALTER TABLE notes ADD COLUMN doc_uri TEXT`; backfill `obsidian-fs://<vault>/<path>`; add UNIQUE index; keep `path` as denormalized cache (per ADR-001).
2. `002_edge_type.sql` — `ALTER TABLE wikilinks ADD COLUMN edge_type TEXT NOT NULL DEFAULT 'wikilink'` (per ADR-003).
3. `003_source_handle.sql` — `ALTER TABLE notes ADD COLUMN source_handle TEXT` (per ADR-002).

Each migration runs in a single `BEGIN ... COMMIT` transaction (`db.transaction(...)` in better-sqlite3). On failure, the transaction rolls back, `user_version` stays at the previous value, and the next startup retries.

---

## Section 7 — Eval Harness

### Recommendation

| Decision | Choice | Confidence |
|----------|--------|------------|
| Primary eval framework | **Roll-our-own with vitest** (`evals/*.eval.test.ts`) | HIGH |
| Why | Retrieval evals against a fixed local fixture vault are domain-specific. Generic LLM eval frameworks fit poorly. | HIGH |
| Snapshot-based regression | Yes — vitest's `toMatchSnapshot` / `toMatchInlineSnapshot` for retrieval result sets | HIGH |
| LLM-as-judge eval (optional) | **Promptfoo** for any future natural-language quality eval (briefs, dossiers) | MEDIUM |
| Promptfoo licensing concern | March 2026: joined OpenAI, still MIT-licensed; OK to use, monitor for license shift | MEDIUM |

### Why roll-our-own with vitest

The brief's eval scope is highly specific:
- Hand-labeled queries against a 50–100 note fixture vault.
- Expected behavior is a *set of `doc_id`s* (precision/recall ≥ 0.8 per Phase 3 criterion), not a free-text comparison.
- Determinism matters: same fixture, same query, same model — same result, every time.
- Eval consumes `Document` objects from Phase 3 onward, so the harness must run *inside* the vault-memory runtime, not as a separate CLI.

This is exactly what vitest is good at. The "eval suite" is a `*.eval.test.ts` glob the CI runs; failures block merge. No new dependency.

```typescript
// evals/dossier.eval.test.ts (sketch)
import { describe, expect, test } from "vitest";
import { loadFixtureVault } from "./harness";
import { labeledQueries } from "./fixtures/dossier-queries.yaml";

const vault = await loadFixtureVault();
test.each(labeledQueries)("$name returns expected docs", async ({ query, expected_doc_ids }) => {
  const result = await vault.assembleDossier(query);
  const precision = computePrecision(result.doc_ids, expected_doc_ids);
  const recall = computeRecall(result.doc_ids, expected_doc_ids);
  expect(precision).toBeGreaterThanOrEqual(0.8);
  expect(recall).toBeGreaterThanOrEqual(0.8);
});
```

### When to reach for Promptfoo

If/when vault-memory needs to evaluate **brief quality** (natural-language output from `compile_brief`) — that's where LLM-as-judge becomes useful. Promptfoo's YAML config + matrix testing + LLM-judge graders fit. Defer until Phase 6's brief layer is shipping and quality regressions become a real concern.

### What NOT to use

| Framework | Why not |
|-----------|---------|
| **DeepEval** | Python-first. Excellent RAG metrics (faithfulness, contextual precision/recall) but vault-memory is TypeScript. Adopting would require a Python sidecar. |
| **Inspect AI** | Research-grade, Python-only, designed for agent capability assessment — not vault-memory's retrieval eval shape. |
| **RAGAS** | Same — Python, RAG-specific metrics, requires LLM-as-judge for every metric. Overkill. |
| **LangSmith** | Cloud-coupled. Local-first principle violated. |
| **Braintrust / Arize Phoenix** | SaaS-oriented. Local-first violation. |

### Fixture vault structure

Per Phase 0 deliverable `evals/fixtures/v2-test-vault/`:
- 50–100 markdown notes with realistic YAML frontmatter (`type:`, `status:`, `tags:`, `aliases:`, etc.)
- A `queries/` subdirectory with YAML files per tool category (`search.yaml`, `bundle.yaml`, `dossier.yaml`, `recall.yaml`, `contracts.yaml`)
- Each query file lists `{name, input, expected_doc_ids, min_precision, min_recall, notes}`.
- A `_memory/` subset with 20+ provenance-labeled observations (per Phase 2 criterion).
- A stub second-source adapter (`evals/fixtures/stub-source/`) returning hand-coded `Document` objects — per ADR-002, this is the source-neutrality proof.

---

## Section 8 — Notion API Client (Phase 10 Prep Only)

### Recommendation

| Decision | Choice | Confidence |
|----------|--------|------------|
| Client library | **`@notionhq/client ^2.4.x`** (official; webhook validation built-in v2.4+) | HIGH |
| Auth model | Integration tokens; secrets via env var (NOT in `config.toml`) per ADR-002 follow-up | HIGH |
| Rate-limit strategy | Token bucket: 3 req/sec sustained, burst to 10 req/sec; retry on 429 with `Retry-After` header | HIGH |
| Change-feed model | **Webhooks** primary (added 2025; mature in 2026), **polling** fallback | HIGH |
| MCP-through-MCP option | Defer decision; native `@notionhq/client` is simpler for read-side | MEDIUM |
| When to research deeply | **NOT in v2.** Phase 10 starts with planning sub-phase (per brief). | HIGH |

### Notion API state as of 2026

- **`@notionhq/client` v2.4+** ships webhook signature validation helpers. Active maintenance. TypeScript-first. No Node version issues with ≥22.
- **Rate limits.** 3 req/sec sustained, burst 10 req/sec, 429 + `Retry-After` standard. Free plan has a 1,000-block-per-page hard cap (will affect chunking strategy for large pages).
- **Webhooks (2025-2026).** Subscribe to `page.updated`, `database.updated`, `comment.created`, etc. Eliminate polling for change detection. Validation via HMAC signature in v2.4+. **Crucial for `ChangeFeed`.**
- **Blocks API maturity.** Stable. Block model maps cleanly to ADR-003's `BlockNode` discriminated union — that mapping was a deliberate design choice in ADR-003.

### What this implies for v2 (planning only)

vault-memory v2 ships **zero Notion code** but Phase 10's premise check (per brief) demands the architecture stay Notion-ready. Concrete v2 deliverables that pay forward to Notion:

1. **ADR-002's capability descriptors must distinguish `watch: 'push' | 'poll'`.** Already done.
2. **`DeliveryCapabilities.hashProtected` must be a real flag.** Notion's API lacks ETag-style OCC for page updates; the Notion delivery adapter will declare `hashProtected: false`, and `compile_brief`'s atomic-update logic must branch on it.
3. **Rate-limit-aware retry primitives** belong in `src/adapters/util/rate-limit.ts`, introduced when Phase 10 starts — NOT speculatively in v2.
4. **Secrets handling.** ADR-002 follow-up notes "Notion needs an API token. Phase 10 defines how secrets are passed." For v2 just document: no secrets in v2, env vars in v3.

### MCP-through-MCP option

ADR-002 mentions Notion already publishes an MCP server. Decision deferred: in Phase 10, evaluate whether vault-memory's `notion-api` source connector is best implemented as (a) direct `@notionhq/client` calls, or (b) a thin shim that wraps an MCP client of Notion's MCP server.

**My take (MEDIUM confidence — defer to Phase 10 ADR):** Direct `@notionhq/client` for v3.0.0 because we need fine-grained control over pagination, webhooks, and rate-limit recovery. Reconsider for v3.1+ if Notion's MCP server matures into a clearly-better integration surface than the raw API.

---

## Section 9 — V1 Choices That Still Hold (No Change for v2)

These are explicitly NOT re-researched per the milestone context. Listed for completeness so reviewers know they were considered.

| Dependency | v1 Pin | v2 Status | Note |
|------------|--------|-----------|------|
| Node.js | ≥22 | **Keep** | Constraint per brief |
| TypeScript | ^5.7.0 | **Keep / bump to latest 5.x** | Routine bump per Phase 1 |
| `@modelcontextprotocol/sdk` | ^1.0.4 | **Upgrade to ^1.29.x** | See Section 1 |
| `better-sqlite3` | ^11.7.0 | **Keep, bump patches** | Mature; no migration needed |
| `sqlite-vec` | ^0.1.6 | **Keep, monitor for breaking changes** | Still under development per maintainer note. Phase 5/6 should run the v1 eval set before/after any bump. |
| `onnxruntime-node` | ^1.26.0 | **Keep** | Lazy-loaded; ONNX reranker opt-in. |
| `@huggingface/tokenizers` | ^0.1.3 | **Keep** | Paired with onnxruntime-node. |
| `chokidar` | ^4.0.1 | **Keep, contain to one adapter module** | Per ADR-002 + CI grep enforcement |
| `zod` | ^3.24.1 | **Upgrade to ^4.x** | Standard Schema compliance + perf. Migration is per-module mechanical work. |
| `smol-toml` | ^1.3.1 | **Keep** | Config file format unchanged |
| `gray-matter` | ^4.0.3 | **Keep, contain to `obsidian-fs` adapter** | Per ADR-002 + CI grep enforcement |
| `vitest` | ^2.1.8 | **Upgrade to ^3.x** if available; otherwise keep | Vitest 3 is widely shipped in 2026 |
| `tsup` | ^8.3.5 | **Keep** | Build stable |
| `prettier` | ^3.4.0 | **Keep** | Cosmetic |

---

## Section 10 — New Additions v2 Needs

Concrete `npm install` deltas for v2 (additive to v1's `package.json`):

```bash
# Phase 1 (adapter extraction; no new deps if Zod 4 covers all schema work)
# (none required — refactor only)

# Phase 6 (brief compilation) — only if MCP sampling path is not the default
# (ollama is already a v1 dep via the embeddings client, so this is verifying not adding)

# Phase 7 (contract DSL)
npm install yaml@^2.6.0     # YAML parser/writer with comment preservation

# Phase 8 (Canvas editor) — only if the plugin route is chosen
npm install --save-dev obsidian@latest   # TypeScript types for plugin API (devDep only)

# v2-wide upgrades
npm install zod@^4
npm install @modelcontextprotocol/sdk@^1.29
npm install --save-dev vitest@^3  # if stable
```

**Net new runtime deps:** `yaml` only. Everything else is an in-place version bump or "use what's already there." This is by design — the brief is explicit about avoiding LLM SDK bloat and the seam-preservation constraints rule out heavy frameworks.

---

## Stack Patterns by Variant

**If a user runs vault-memory in a pure-MCP host that supports sampling (e.g. Claude Code):**
- `compile_brief` uses MCP sampling → no Ollama chat model needed
- User never has to choose a chat model
- Best out-of-box experience

**If a user runs vault-memory in an MCP host without sampling support (some custom connectors):**
- `compile_brief` falls back to local Ollama chat (`qwen2.5:7b-instruct` recommended)
- User sets `[brief_compilation] model = "..."` in `config.toml`
- Local-first invariant preserved

**If a user prefers to pre-summarize via their own pipeline:**
- `compile_brief({pre_summarized_text: "..."})` skips both paths
- Vault-memory just stores the brief Document with provenance properties
- Pure storage layer — original v1.x architecture preserved

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@modelcontextprotocol/sdk@^1.29` | `zod@^3 \|\| ^4` | Standard Schema works with either; Zod 4 implements it natively, Zod 3 needs no adapter for SDK 1.29's loose typing. |
| `zod@^4` | `@modelcontextprotocol/sdk@^1.20+` | Older SDKs use Zod-specific `AnySchema` and won't accept Zod 4 schemas without bridging code. |
| `better-sqlite3@^11` | `sqlite-vec@^0.1.x` | sqlite-vec is platform-specific; ensure prebuilt for darwin-arm64, darwin-x64, linux-x64, linux-arm64. v0.2.x may break — pin to ^0.1.x. |
| `onnxruntime-node@^1.26` | `@huggingface/tokenizers@^0.1` | Both pinned together; lazy-loaded; do not upgrade independently. |
| `ollama@^0.5` | Ollama server 0.5+ | Older server versions lack `format: {type: "object", ...}` JSON-schema support. Document in README. |
| `yaml@^2.6` | Node ≥22 | ESM-only since 2.x; safe. |
| `vitest@^3` | Node ≥20 | Vitest 3 dropped Node 18 in early 2026; vault-memory's Node ≥22 satisfies. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Anthropic SDK (`@anthropic-ai/sdk`) in vault-memory core | Couples to one vendor; violates local-first when used for compile_brief; brief explicitly forbids "LLM calls from vault-memory core" except Ollama | MCP sampling → Ollama fallback |
| OpenAI SDK (`openai`) | Same | Same |
| LangChain / LangGraph | Heavy framework; opinionated graph runtime; conflicts with contract DSL we're building; not local-first; not MCP-canonical | Direct MCP SDK + custom contract DSL |
| CrewAI | Python; agent-execution shape, not knowledge-layer shape | Reference YAML config style only |
| Pinecone / Weaviate / Qdrant client | Cloud vector DB; violates local-first; sqlite-vec already in stack | Stay on `sqlite-vec` |
| `node:sqlite` core module | Experimental, requires flag, slower than better-sqlite3, no extension loading for sqlite-vec | `better-sqlite3` |
| `db-migrate` / `umzug` for migrations | Overkill for ~10 lifetime migrations on owned schema | Plain SQL + `user_version` PRAGMA |
| `@trbn/jsoncanvas` / `JSON Canvas Viewer` | Viewers, not round-trip-preserving compilers | Custom Zod types over JSON Canvas 1.0 spec |
| `DeepEval` / `RAGAS` / `Inspect AI` | Python; not retrieval-eval-shape; require LLM-as-judge for every metric | vitest + hand-labeled fixture vault |
| `Promptfoo` for retrieval eval (only) | Right tool for LLM output evals, wrong tool for "does this query return these doc_ids" | Defer to Phase 6 (briefs) for LLM output eval; retrieval eval stays in vitest |
| Anthropic Skills format for contract storage | Skills are a *client* concept (Claude Code); contracts are a *server* concept (vault-memory MCP) — per AGENT_AGNOSTIC.md the client axis and the contract DSL are different things | YAML in `_contracts/` per Phase 7 |
| `@notionhq/client` in v2 | Phase 10 territory; v2 ships zero Notion code | Defer to Phase 10 |
| Plugin auto-loading from npm packages (third-party connectors) | Sandboxing, trust, supply-chain concerns; rejected in ADR-002 follow-up for v2 | Hardcoded factory registration in registry |
| LangSmith / Braintrust / Arize for eval | Cloud-coupled; violates local-first | vitest + Promptfoo (local) |

---

## Sources

### HIGH confidence (verified against official sources)

- [MCP TypeScript SDK on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — current version 1.29.x, Standard Schema interface
- [MCP TypeScript SDK GitHub Releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — breaking changes since 1.0.4 verified
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — sampling, elicitation, extensions system
- [MCP 2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog) — Standard Schema, async tasks, capability descriptors
- [Zod v4 release notes](https://zod.dev/v4) — performance numbers, Standard Schema support, JSON Schema generation
- [Standard Schema spec](https://github.com/standard-schema/standard-schema) — interop contract
- [JSON Canvas 1.0 spec](https://jsoncanvas.org/spec/1.0/) — node/edge schema
- [JSON Canvas GitHub](https://github.com/obsidianmd/jsoncanvas) — official obsidian-md repo
- [Ollama JS official library on GitHub](https://github.com/ollama/ollama-js) — format=json-schema, streaming, chat API
- [Ollama structured outputs docs](https://docs.ollama.com/capabilities/structured-outputs) — JSON Schema constraint mode
- [Obsidian sample plugin GitHub](https://github.com/obsidianmd/obsidian-sample-plugin) — current plugin scaffold
- [Obsidian developer docs - Plugin API](https://docs.obsidian.md/Reference/TypeScript+API/Plugin) — manifest format
- [better-sqlite3 Node 22 compatibility](https://github.com/WiseLibs/better-sqlite3/issues/1442) — confirmed support
- [Notion API rate limits](https://developers.notion.com/reference/request-limits) — 3 req/sec sustained, burst 10
- [Notion API rate limits 2026 guide](https://fazm.ai/blog/notion-api-rate-limits-2026) — current limits + webhook availability

### MEDIUM confidence (multiple sources, not direct verification)

- [Promptfoo licensing post-OpenAI acquisition](https://github.com/promptfoo/promptfoo) — March 2026, MIT-licensed (monitor for shift)
- [Notion @notionhq/client v2.4+ webhook helpers](https://www.unbanai.org/blog/notion-api-rate-limits-explained-2026) — third-party confirmation, not first-party release notes
- [Drizzle vs Kysely vs Prisma in 2026](https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026) — adapter pattern reference
- [LangGraph vs CrewAI 2026 landscape](https://dev.to/suifeng023/crewai-vs-langgraph-which-llm-agent-framework-should-you-use-in-2026-3h4n) — DSL style references
- [DeepEval alternatives 2026](https://www.braintrust.dev/articles/deepeval-alternatives-2026) — eval framework comparison

### LOW confidence (training data + single source — flagged for validation)

- Best-fit local chat model for structured output (`qwen2.5:7b-instruct`) — community consensus, not benchmark-verified. **Validate when Phase 6 starts** by running a small bake-off on the fixture vault.
- Specific `@notionhq/client` v2.4+ webhook helper signatures — not directly verified against the official changelog. **Validate when Phase 10 starts.**

---

## Implications for Roadmap

1. **Phase 1 should bundle the SDK upgrade and the Zod 4 upgrade.** Both are mechanical; doing them together once is cheaper than twice. Schedule a "tech-debt-up" sub-deliverable inside the adapter extraction PR.
2. **Phase 6's ADR should pick MCP sampling first.** Document the three options (sampling / Ollama / pre-summarized). This is a Section-1 + Section-4 cross-cutting decision.
3. **Phase 7's DSL is the right place to lock in the `yaml` dep.** Don't sneak it in earlier.
4. **Phase 8's spike should default to file-watcher, not plugin.** Section 3's reasoning aligns with the brief's risk note.
5. **Add to Phase 9 (release polish): a `MIGRATION-V1-TO-V2.md`** noting the SDK and Zod major-version bumps for downstream users who depend on vault-memory as a library (rare but possible).
6. **Phase 10 premise check should verify the capability-descriptor test suite exists** before any Notion code is written. Section 5's "keep capability descriptors honest" rule is the trip-wire.

---

*Stack research for: vault-memory v2 — agentic knowledge layer over Obsidian via MCP*
*Researched: 2026-05-14*
