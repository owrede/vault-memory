# Phase 2: Memory namespace & provenance contract — Research

**Researched:** 2026-05-15
**Domain:** Memory namespace runtime, provenance validator, MCP write/read tool wiring, MCP Resources promotion
**Confidence:** HIGH

## Summary

Phase 2 is mechanically well-scoped: ADR-004 + MEMORY_CONTRACT.md + Phase 1's reserved `DeliveryAdapter.write()` guard hook nail down the interface surface, and the Phase 1 conformance suite is already shaped to receive Guard A/B assertions parameterized across `ObsidianFsDelivery` and `StubDelivery`. The biggest decisions for the planner are (a) how aggressively to evolve the Phase-1 `WriteConflict` reason union vs. emit a richer envelope, (b) ship a YAML contract loader now or defer, (c) fixture scope, and (d) the URI shape for MCP Resources.

Primary recommendation: **ship the YAML loader on day one** (the cost is ~50 LoC + the yaml@^2.9.0 already installed in Phase 0 plan 00-01), **extend `WriteConflict.reason` additively with three new codes** + **add optional envelope fields** (`sinkName?`, `missingKey?`, `invalidKey?`, `suggestion?`) — preserving the existing 3-reason union and Phase 1 contract test compatibility, **scope MEM-10 fixture to 20 docs reusing the existing 15** + **5 net-new (covering missing provenance dimensions and one A→B→C chain)**, **use the flat MCP Resource URI scheme `vault-memory://memory/sinks` + `vault-memory://memory/stats`** registered via SDK 1.29 `McpServer.registerResource()`, polled-only.

The single biggest watch-item is the **`observed_at` vs `observed-at` and `superseded_by` vs `superseded-by` naming discrepancy** between ADR-004 §MemoryContract (hyphenated) and MEMORY_CONTRACT.md + the existing fixture (underscored). Adopt the underscored form — it is the canonical PropertyBag form already in the fixture, the existing brief example, and MEMORY_CONTRACT.md normative text. Flag the ADR-004 example for amendment to match.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Provenance validation (Guards A & B) | **L1 (adapter) — DeliveryAdapter.write()** | — | ADR-002 I-6 single chokepoint; ADR-004 M-4; MEMORY_CONTRACT.md normative |
| MemorySink handle resolution | **L1 (adapter registry)** | — | ADR-004 M-1: registry is the ONLY resolver; ADR-002 §Registry shape |
| `.memory-sink` sentinel write + check | **L1 (obsidian-fs delivery adapter)** | — | Sentinel is filesystem-specific; ADR-002 I-2 confines `fs.*` |
| `record_observation` / `recall` / `supersede` tool handlers | **L2 (`src/memory/`)** | L1 (registry/delivery) | ADR-004 §Decision; ARCHITECTURE.md §L2 |
| MemoryContract loader (YAML → Zod-validated record) | **L2 (`src/memory/contract/`)** | — | Per-vault static config; not adapter-specific |
| `memory_stats` + `list_sinks` MCP Resources | **MCP protocol surface (`src/server.ts` + registry)** | L2 (queries) | SDK 1.29 `registerResource`; MEM-09 cuts tool count |
| Audit-log memory-sink discriminator | **L0 (DB schema + audit queries)** | L1 (delivery write path emits flag) | Existing `write_audit` table; MEM-08 |
| Guard A check at v1 `write_note` / `update_frontmatter` entries | **MCP handler (server.ts)** | L1 (delivery) | Defense-in-depth — early refusal w/ specific tool suggestion; final guard still in delivery |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: `recall` returns the Phase-3 citation-packet shape from day one.** Spec: `recall({query, min_confidence, types, max_age_days, sink?})` → `{ doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties }[]`. `properties` includes contract-required keys (`source`, `confidence`, `status`, `observed_at`, `evidence`, plus contract-allowed extras). Sort: recency-descending by `observed_at`, `mtime` tiebreak. Filters applied before result limit.
- **D-02: `record_observation` accepts a freeform `properties: Record<string, unknown>` escape hatch.** Spec: `record_observation({claim, evidence, confidence, type, sink?, properties?})`. Canonical args prefill required keys (`source: "agent"`, `observed_at: <now>`, `status: "active"`). `properties` merges last. MemoryContract validator at `DeliveryAdapter.write()` is the single source of truth.
- **D-03: `supersede` is forward-only — no back-link.** Spec: `supersede({doc_id, replacement_doc_id, reason})`. Marks OLD with `status: superseded` + `superseded_by: <replacement_doc_id>` + `superseded_reason: <reason>`. NEW is not touched. Phase 4 (GRA-04) derives back-edges at query time. Atomically a single OCC write.
- **D-04: `record_observation` + `supersede` stay separate primitives. No composite tool.** MEM-09 cuts surface; composites move in the wrong direction.

### Claude's Discretion

- Error-shape contract for guard rejections (researched in Q1 below).
- MemoryContract loading + caching strategy (researched in Q2 below).
- MEM-10 fixture scope, provenance dimensions, edge cases (researched in Q3 below).
- MCP Resources URI scheme for `memory_stats` + `list_sinks` (researched in Q4 below).

### Deferred Ideas (OUT OF SCOPE)

- Subscribable MCP Resources (`notifyResourceUpdated`) — Phase 5/6.
- `record_and_supersede` composite tool — explicitly rejected.
- Back-link materialization on supersede — Phase 4 derives at query time.
- Per-sink stats subscription — same as first item.
- Notion adapter memory-sink support — v3.0.0.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-01 | Per-vault config; handle parser is only sink-as-path resolver | Q6 module layout; ADR-004 M-1 |
| MEM-02 | `record_observation` MCP tool — writes via DeliveryAdapter | Q6 tool wiring; D-02 |
| MEM-03 | `recall` MCP tool — reads with filters | Q7 implementation strategy |
| MEM-04 | `supersede` MCP tool — sets status + forward link | Q5 supersede-reason contract field |
| MEM-05 | Validator at DeliveryAdapter.write() with Guards A & B | Q1 error shape; validator location confirmed by MEMORY_CONTRACT.md §Validator behavior |
| MEM-06 | `.memory-sink` sentinel | Q10 sentinel mechanics |
| MEM-07 | Guards on v1 `write_note` / `update_frontmatter` | Q1 error envelope; defense-in-depth pattern |
| MEM-08 | `audit_log` memory-sink flag | Q8 audit discriminator |
| MEM-09 | `memory_stats` + `list_sinks` as MCP Resources | Q4 URI scheme |
| MEM-10 | 20-doc `_memory/` fixture | Q3 fixture scope (15 existing + 5 net-new) |
| MEM-11 | Targeted rejection test | Q9 conformance suite extension |
| MEM-12 | ADR-004 amendment ratification | Already landed in Phase 0 plan 00-05 |

## Standard Stack

### Core (already installed — Phase 0 / Phase 1)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` [VERIFIED: package.json + node_modules] | MCP server + `McpServer.registerResource()` API | Existing Phase 1 dep; `mcp.d.ts:102-103` exposes registerResource |
| `zod` | `^4.x` [VERIFIED: STATE.md note line 85] | Schema validation for tool inputs + contract YAML | Phase 1 ADP-09 bumped; existing convention |
| `yaml` | `^2.9.0` [VERIFIED: package.json line 45] | Parse `_contracts/memory/<name>.yaml` | Phase 0 plan 00-01 already added; `gray-matter` is YAML 1.2-incompatible for this use |
| `smol-toml` | `^1.3.1` [VERIFIED: package.json] | Parse `[[memory_sinks]]` config blocks | Existing config loader pattern |
| `better-sqlite3` | `^11.7.0` [VERIFIED: package.json] | Audit-log discriminator column | Existing DB layer |

### Supporting (existing in-repo)

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/adapters/registry.ts` | Add `MemorySink` map + 3 methods | Phase 2 wave-1 |
| `src/adapters/delivery/types.ts` | Extend `WriteConflict` reason union (additive) | Phase 2 wave-1 |
| `src/adapters/delivery/obsidian-fs/index.ts` | Inject Guards A/B; sentinel write/check | Phase 2 wave-2 |
| `src/adapters/delivery/stub/delivery.ts` | Must also satisfy Guards A/B per conformance | Phase 2 wave-2 |
| `src/adapters/delivery/conformance.test.ts` | Add memory-sink test cases (11–18) | Phase 2 wave-2 |
| `src/db/queries/audit.ts` + `src/db/schema.ts` | Migration v9 adds `is_memory_sink_write` column | Phase 2 wave-1 |

**No net-new external dependencies needed.** `yaml@^2.9.0` was pre-installed in Phase 0; ADR-002 forbids YAML-frontmatter parsing outside adapter modules, but `_contracts/memory/<name>.yaml` is not frontmatter — it's a separate config file under L2's purview, so the I-4 grep (`gray-matter` confinement) does not apply. The `yaml` package is the correct tool. [CITED: docs/v2/adr/002-adapter-seams.md I-4 lines 309–313 — I-4 names `gray-matter` specifically, not all YAML parsers]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extend `WriteConflict.reason` union | Emit MCP `isError: true` for tool layer | Tool errors are useful for hard failures but the discriminated union shape lets callers branch; user-tooling already inspects `.ok` |
| YAML loader now | Hardcoded `default-memory-v1` only | Hardcoded is ~30 LoC less, but Phase 5 (briefs) needs `brief-memory-v1` — deferring just punts the work |
| New audit column `kind` (TEXT) | JSON property in existing `diff_summary` | Indexed column is queryable; JSON-in-text is fragile and breaks `audit_log` tool's existing filter pattern |
| Nested resource URI `vault-memory://memory/sinks/<name>/stats` | Flat `vault-memory://memory/stats` | Nested forces template handler + per-sink fetch on a list view; flat returns all stats in one read |

**Installation:** No `npm install` needed.

**Version verification:**
- `@modelcontextprotocol/sdk@1.29.0`: confirmed via `node_modules/@modelcontextprotocol/sdk/package.json` line 3 [VERIFIED: filesystem read]
- `yaml@^2.9.0`: confirmed via `package.json` line 45 [VERIFIED: filesystem read]
- `zod@^4.x`: confirmed live on `main` per STATE.md blocker note line 85 (post-`npm install`) [VERIFIED: STATE.md]

## Package Legitimacy Audit

> All packages used in Phase 2 are already installed and verified through prior phases. No net-new packages.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@modelcontextprotocol/sdk` | npm | ~1 yr | 100k+/wk | github.com/modelcontextprotocol/typescript-sdk | n/a (pre-installed Phase 1) | Approved |
| `yaml` | npm | 9+ yrs | 50M+/wk | github.com/eemeli/yaml | n/a (pre-installed Phase 0) | Approved |
| `zod` | npm | 5+ yrs | 30M+/wk | github.com/colinhacks/zod | n/a (pre-installed Phase 1) | Approved |
| `smol-toml` | npm | 2+ yrs | 1M+/wk | github.com/squirrelchat/smol-toml | n/a (pre-installed v1) | Approved |

slopcheck not re-run because Phase 2 adds zero new packages. The four packages above were vetted in Phase 0/1 and pass `npm view <pkg>` verification.

## Architecture Patterns

### System Architecture Diagram

```text
                 ┌────────────────────────────────────────────────────────┐
                 │ MCP Client (Claude Code / Inspector / non-Claude)      │
                 └────────────────────────────────────────────────────────┘
                                             │
                              tools/call · resources/read
                                             ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │ MCP Layer — src/server.ts + src/tool-registry.ts                │
        │   v1 tools (23) — write_note / update_frontmatter / delete_note │
        │       ▼ DEFENSE-IN-DEPTH Guard A early-refusal                  │
        │   v2 memory tools (3) — record_observation / recall / supersede │
        │   v2 resources (2) — vm://memory/sinks · vm://memory/stats      │
        └─────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │ L2 — src/memory/                                                │
        │   sink.ts     — MemorySinkHandle parser; canonical handle shape │
        │   registry.ts — listMemorySinks / resolveMemorySink / default   │
        │   contract.ts — MemoryContract loader (YAML or hardcoded)       │
        │   validator.ts— Guard A/B (pure fn; called from delivery)       │
        │   tools/      — record-observation.ts / recall.ts / supersede.ts│
        │   resources/  — stats.ts / sinks.ts                             │
        └─────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │ L1 — Adapter seam: src/adapters/delivery/                       │
        │   ObsidianFsDelivery.write() ─┬─ Guard B (source:agent in sink?)│
        │                                ├─ Guard A (provenance keys ok?) │
        │                                ├─ Sentinel check (.memory-sink) │
        │                                ├─ atomic writeNote (FS + DB tx) │
        │                                └─ audit.recordWrite(…flag)      │
        │   StubDelivery.write() — same guard chain (conformance)         │
        └─────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │ L0 — src/db/  (write_audit + is_memory_sink_write column)       │
        │      Filesystem  (.memory-sink sentinel + obsidian-fs files)    │
        └─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/memory/                       # L2 — new in Phase 2
├── index.ts                      # Barrel re-export (tool handlers, resource readers)
├── sink.ts                       # MemorySinkHandle parser, sentinel mechanics
├── registry.ts                   # Registry extension methods (listMemorySinks / resolve / default)
├── contract/
│   ├── index.ts                  # Public: getContract(name) → MemoryContract
│   ├── default-v1.ts             # Hardcoded baseline (always available, never disk-read)
│   ├── loader.ts                 # YAML loader for _contracts/memory/<name>.yaml
│   └── schema.ts                 # Zod schema for the contract YAML
├── validator.ts                  # validateAgentWrite(doc, sink, contract) → null | GuardFailure
├── tools/
│   ├── record-observation.ts     # MEM-02 handler
│   ├── recall.ts                 # MEM-03 handler
│   └── supersede.ts              # MEM-04 handler
└── resources/
    ├── sinks.ts                  # MEM-09 list_sinks resource reader
    └── stats.ts                  # MEM-09 memory_stats resource reader

src/adapters/delivery/
├── types.ts                      # EXTEND WriteConflict union (additive)
├── obsidian-fs/
│   ├── index.ts                  # INJECT Guards A/B + sentinel check inside write()
│   └── sentinel.ts               # NEW — sentinel write/read helper
├── stub/delivery.ts              # INJECT same guard chain for conformance
└── conformance.test.ts           # EXTEND with cases 11–18 for memory-sink contract

src/db/
├── schema.ts                     # Migration v9 — write_audit.is_memory_sink_write
└── queries/audit.ts              # listWrites: add filter.isMemorySinkWrite?

src/types.ts                      # EXTEND MemorySink interface (add contract field, name)

src/config/loader.ts              # EXTEND AppConfigSchema with [[memory_sinks]] + [memory]

evals/fixtures/v2-test-vault/_memory/
└── (15 existing + 5 net-new = 20 docs per MEM-10)

tests/fixtures/malformed-memory/  # NEW — separate tree per CONTEXT recommendation
├── missing-observed-at.md
├── missing-source.md
├── invalid-confidence.md
├── superseded-no-target.md
└── source-agent-outside-sink.md
```

### Pattern 1: Discriminated WriteResult — extend, don't replace

**What:** Phase 1 established `{ ok: true, …} | { ok: false, reason: "hash_mismatch" | "permission_denied" | "not_found", …}`. Phase 2 extends `reason` additively + adds optional envelope fields.

**When to use:** All Guard A/B rejections from `DeliveryAdapter.write()` / `update()` / `delete()`.

**Example:**

```typescript
// src/adapters/delivery/types.ts — EXTENDED in Phase 2
export interface WriteConflict {
  ok: false;
  reason:
    | "hash_mismatch"
    | "permission_denied"
    | "not_found"
    // NEW in Phase 2:
    | "missing_provenance"            // Guard A — required key absent
    | "invalid_provenance"            // Guard A — value fails enum / type check
    | "supersede_mismatch"            // Guard A — status/superseded_by cross-field
    | "agent_write_outside_sink"      // Guard B — source:agent + non-sink target
    | "non_agent_write_inside_sink"   // Guard B inverse — user write into sink
    | "sentinel_missing"              // .memory-sink absent on sink-resolved folder
    | "sink_write_blocked";           // v1 tools (write_note etc.) refusing sink target
  currentHash?: string;
  message?: string;
  // NEW in Phase 2 (all optional — additive only):
  /** Which sink the operation tried to write to (set by all sink-related rejections). */
  sinkName?: string;
  /** Which provenance key failed (missing_provenance | invalid_provenance | supersede_mismatch). */
  key?: string;
  /** Observed value when invalid_provenance / supersede_mismatch. JSON.stringifiable. */
  observedValue?: unknown;
  /** Actionable next-step hint — e.g. "Use record_observation for _memory/ targets". */
  suggestion?: string;
}
```

Rationale: every Phase 1 test that destructures `{ ok: false, reason }` continues to compile because the union is widened, not narrowed. The 324 v1 tests inspecting `reason === "permission_denied"` keep working. New code can branch on the new reason codes; old branches that hit a new reason via the default arm get the existing `message` field (always populated for memory-sink rejections — see Q1 below for the exact strings).

### Pattern 2: Validator as pure function injected at delivery boundary

**What:** Guards A/B live in `src/memory/validator.ts` as a pure function. Each `DeliveryAdapter` calls it at `write()` / `update()` entry, BEFORE any FS operation.

**When to use:** Every `DeliveryAdapter` implementation (obsidian-fs and stub both, per conformance suite).

**Example:**

```typescript
// src/memory/validator.ts
import type { Document, DocId } from "../types.js";
import type { MemorySink } from "./sink.js";
import type { MemoryContract } from "./contract/index.js";
import type { WriteConflict } from "../adapters/delivery/types.js";

export type GuardFailure = Extract<WriteConflict, { reason:
  | "missing_provenance" | "invalid_provenance" | "supersede_mismatch"
  | "agent_write_outside_sink" | "non_agent_write_inside_sink"
}>;

/**
 * Returns null on pass, a structured GuardFailure on reject.
 * Pure — no I/O, no DB access, no FS access.
 *
 * @param id     The target DocId of the write
 * @param doc    The Document payload being written (properties checked)
 * @param sink   The MemorySink the id resolves into, or null if not inside any configured sink
 * @param contract The MemoryContract attached to that sink (used iff sink !== null)
 */
export function validateAgentWrite(
  id: DocId,
  doc: Partial<Document>,
  sink: MemorySink | null,
  contract: MemoryContract | null,
): GuardFailure | null {
  const source = doc.properties?.source;

  // Guard B (cheap — runs first per MEMORY_CONTRACT.md §"Both guards short-circuit")
  if (source === "agent" && sink === null) {
    return {
      ok: false, reason: "agent_write_outside_sink",
      message: `source:"agent" writes are only permitted under a configured MemorySink. ` +
               `Target ${id} does not resolve into any sink.`,
      suggestion: "Use record_observation for memory writes; or change source to 'user' / 'imported'.",
    };
  }
  if (source && source !== "agent" && sink !== null) {
    return {
      ok: false, reason: "non_agent_write_inside_sink",
      message: `source:"${source}" writes are not permitted into MemorySink "${sink.name}".`,
      sinkName: sink.name,
      suggestion: "Memory sinks accept source:'agent' writes only. " +
                  "User notes belong in the surrounding vault.",
    };
  }

  // Guard A — only when target lands in a sink
  if (sink !== null && contract !== null) {
    return validateContract(id, doc, sink, contract);  // → GuardFailure | null
  }

  return null;
}
```

### Anti-Patterns to Avoid

- **Scattering guards across tool handlers.** ADR-004 M-4 + ADR-002 I-6 require a single chokepoint. The validator MUST be called from `DeliveryAdapter.write()`. v1 handlers (`write_note`) call it as defense-in-depth but the authoritative check is at delivery.
- **Resolving a sink by string-matching `/_memory/` in a path.** ADR-004 M-1: handle parser only. Even the validator only receives a resolved `MemorySink | null` from the adapter; it never inspects path strings.
- **Storing `superseded_by` as a vault-relative path (the v1 fixture form).** Phase 2 normalizes to the full `DocId` per MEMORY_CONTRACT.md. Fixture content must be migrated as part of MEM-10 work.
- **Creating the sentinel implicitly when a sink folder contains user content.** ADR-004 §Sentinel "Provisioning" — startup MUST abort with structured error if the folder has unrelated user notes. The fixture is empty of non-memory files inside `_memory/`, so provisioning succeeds.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom parser | `yaml@^2.9.0` (already installed) | YAML 1.2 corner cases (anchors, !!int casting) are real |
| Contract schema validation | Manual type guards | `zod@^4.x` `.parse()` with `safeParse` | Pattern matches `src/config/loader.ts:71`; readable errors |
| Property bag walk for Guard A | Loops + ifs | Zod schema parse on `doc.properties` against contract-derived schema | A contract IS a Zod schema after one-time `buildContractSchema()` — see Q2 |
| MCP Resource registration | `setRequestHandler(ListResourcesRequestSchema, …)` (low-level) | `server.registerResource(name, uri, metadata, callback)` (SDK 1.29 high-level API at `mcp.d.ts:102`) | The deprecated `resource()` overload is removed; SDK 1.29 expects `registerResource` |
| ISO 8601 timestamp validation | Regex | `z.string().datetime({ offset: true })` | Zod 4 has first-class datetime validation |
| `DocId` resolution to a sink | Custom path-prefix matcher | A registry method `registry.resolveMemorySink(idOrName)` plus a `findSinkForDocId(id)` helper inside `src/memory/registry.ts` | Single resolver per ADR-004 M-1 |

**Key insight:** The Memory Contract is structurally a Zod schema. The YAML on disk describes which keys are required, their enum, and their type; converting that into a `z.object({...})` at contract-load time means Guard A is a single `schema.safeParse(doc.properties)` call returning either a typed object or a `ZodError` with `.issues[]` that map directly to our `missing_provenance` / `invalid_provenance` error codes. This is ~20 LoC of logic, not ~200. [CITED: src/config/loader.ts:71 for the equivalent TOML-then-Zod pattern]

## Runtime State Inventory

> N/A — Phase 2 is greenfield within the v2 architecture. No rename/refactor/migration of existing runtime state.

Existing runtime state that Phase 2 touches but does not migrate:
- **DB**: `write_audit` gets one new column via migration v9 (`is_memory_sink_write` INTEGER NOT NULL DEFAULT 0). Existing rows backfill to 0 (none were memory-sink writes). No data migration.
- **Fixture vault**: `evals/fixtures/v2-test-vault/_memory/` already has 15 docs from Phase 0; Phase 2 adds 5 to reach MEM-10's 20-doc bar AND normalizes `superseded_by` field shape from vault-relative path to full `DocId` (data fix-up, not a migration).
- **Config schema**: `~/.vault-memory/config.toml` gains optional `[[memory_sinks]]` + `[memory]` blocks. Backwards-compatible — vaults without these blocks get a synthetic default sink at `obsidian-fs://<vault>/_memory` if the folder + sentinel exist (see Q2 boot-time semantics).

## Common Pitfalls

### Pitfall 1: PropertyBag key naming — underscore vs hyphen

**What goes wrong:** ADR-004's `default-memory-v1` YAML example (lines 130–148) lists `observed-at`, `superseded-by` (hyphenated). MEMORY_CONTRACT.md normative spec uses `observed_at`, `superseded_by` (underscored), as does the existing fixture (`2026-04-16-alice-prefers-async-standups.md`) and the brief examples in ADR-003 §Chunk-level `source_hashes` example (line 426: `confidence: inferred`, line 416: `target:`, etc. — all underscored or single-word).

**Why it happens:** YAML idiomatically uses hyphens; PropertyBag/JSON idiomatically uses underscores. ADR-004's draft example slipped into hyphenated form; the operational spec (MEMORY_CONTRACT.md) and the fixture caught it.

**How to avoid:** **Adopt underscored form (`observed_at`, `superseded_by`, `superseded_reason`) as canonical.** This matches:
- MEMORY_CONTRACT.md §Required properties (authoritative validator spec)
- Existing fixture content (`evals/fixtures/v2-test-vault/_memory/`)
- ADR-003 PropertyBag key examples
- JSON convention (snake_case)

Plan a wave-0 task to file an ADR-004 amendment proposal changing the YAML example block (ADR-004 lines 130–148) to underscored keys. This is a doc-only change and does not affect the operational validator.

**Warning signs:** Any task that reads `properties["observed-at"]` or writes `superseded-by:` in YAML.

### Pitfall 2: ADR-004 confidence enum vs MEMORY_CONTRACT.md confidence enum

**What goes wrong:** ADR-004 line 134 lists `confidence: { allowed: [observed, inferred, user-confirmed] }`. MEMORY_CONTRACT.md line 76 lists `direct`, `inferred`, `uncertain`. The fixture (`2026-04-16-alice-prefers-async-standups.md` line 4) uses `direct`. These are three different enum sets.

**Why it happens:** ADR-004 was drafted before MEMORY_CONTRACT.md normalized the enum.

**How to avoid:** **Use MEMORY_CONTRACT.md enum: `direct`, `inferred`, `uncertain`.** This matches the existing fixture and is the authoritative spec per MEMORY_CONTRACT.md status (Accepted — Phase 0 foundation). File the same ADR-004 amendment ticket as Pitfall 1.

### Pitfall 3: Sink resolution race against catch-up indexer

**What goes wrong:** Phase 1's `catchupVault` runs at server startup; if it scans `_memory/` before the memory-sink registry has resolved (and written the sentinel if missing), it indexes the folder as ordinary user content and Guard A logic later treats those rows as memory docs. Worse: a user-authored file inside `_memory/` (rare but possible) gets a memory-sink-write audit flag retroactively.

**Why it happens:** Server bootstrap order matters. Phase 1 plan 01-05 wired catchupVault as fire-and-forget after manager open.

**How to avoid:** **Resolve memory sinks and write missing sentinels BEFORE catch-up indexer starts.** The bootstrap sequence becomes:
1. `loadConfig()`
2. `manager.openAll()` (opens DBs)
3. `registry.registerMemorySinks(config.memory_sinks)` — resolve handles, validate folders exist, write missing `.memory-sink` sentinels OR abort with error per ADR-004 §Provisioning
4. `catchupVault(...)` (fire-and-forget, now safe)
5. `server.connect(transport)`

**Warning signs:** Test fixtures that fail because a memory-sink folder is empty at startup and the test expects the sentinel.

### Pitfall 4: Stub delivery does not have a filesystem — sentinel mechanics differ

**What goes wrong:** `.memory-sink` is a filesystem concept. `StubDelivery` (in-memory `Map<DocId, Document>`) has no folders. If the conformance suite checks "sentinel must exist", the stub fails.

**Why it happens:** The conformance suite is parameterized across both adapters.

**How to avoid:** **Sentinel checking is adapter-specific behavior; the conformance contract is "writes that fail Guard A/B return the correct structured error".** The stub adapter implements the same `validateAgentWrite()` call but stubs sentinel-check as always-pass (configurable in the constructor). The new conformance cases (11–18 — see Q9) target the validator contract, not the sentinel mechanics. A separate `obsidian-fs/sentinel.test.ts` covers sentinel filesystem mechanics.

**Warning signs:** Conformance suite assertions that reference `.memory-sink` file paths.

### Pitfall 5: `delete_note` against a memory sink — accidental hard-delete of agent memory

**What goes wrong:** MEM-07 says `delete_note` refuses memory-sink targets. But supersede uses `update` on the OLD doc, not delete. What if a future tool or human intervention calls `delete` on a memory-sink path? ADR-004 §Open follow-ups (lines 411–415) notes that deletion semantics are unresolved.

**Why it happens:** Phase 2 introduces sinks; full deletion semantics defer to Phase 5 brief work.

**How to avoid:** **Guard A also applies to `delete()`.** A `delete_note` MCP call against any path resolving into a configured sink returns `{ok: false, reason: "sink_write_blocked", sinkName, suggestion: "Use supersede to retire memory documents. Hard deletion is not yet supported in v2.0.0."}`. Phase 5/6 may add an explicit `forget()` tool; out of v2 Phase 2 scope.

### Pitfall 6: Mid-flight `npm install` zod drift (Phase 1 carry-forward)

**What goes wrong:** Per STATE.md line 85, the post-merge npm install deduplicated to a transitive zod 3.x hoist. Phase 2 plan execution must `npm install` on main and verify `require('zod/package.json').version` reports `4.x` before validator code runs.

**How to avoid:** Wave-0 micro-task — `node -e "console.log(require('zod/package.json').version)"` asserts `4.x` start; CI re-asserts in `lint:check`.

## Code Examples

Verified patterns from in-repo sources.

### Example: Register a new MCP Resource (SDK 1.29 high-level API)

```typescript
// src/server.ts — Phase 2 inserts after registerTool × 23 block
// Source: node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:102
server.registerResource(
  "memory-sinks",
  "vault-memory://memory/sinks",
  {
    title: "Configured memory sinks",
    description: "List of configured MemorySink handles for this server.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          { sinks: registry.listMemorySinks().map(sinkSummary) },
          null,
          2,
        ),
      },
    ],
  }),
);
```

### Example: Existing TOML+Zod pattern to mirror for YAML+Zod

```typescript
// src/config/loader.ts:71 — pattern for the YAML contract loader to mirror
const validated = AppConfigSchema.parse(parsed);
```

### Example: Discriminated-union extension in v1 code

```typescript
// src/frontmatter/update.ts:75-80 — existing extended union (precedent for our extension)
export interface UpdateConflict {
  ok: false;
  reason: "hash_mismatch" | "permission_denied" | "note_not_found";  // already extended past types.ts
  currentHash?: string;
  message: string;
}
```

This already establishes the precedent — Phase 1 itself extended the reason union in `update.ts` beyond what `types.ts` declares. Phase 2 propagates the additional codes back into `types.ts` as the canonical surface.

### Example: Audit-log row write (existing pattern to extend with flag)

```typescript
// src/db/queries/audit.ts:67-70 — existing recordWrite signature
this._recordWrite = db.prepare(`
  INSERT INTO write_audit (note_id, op, previous_hash, new_hash, expected_hash, client_id, diff_summary, at)
  VALUES (@note_id, @op, @previous_hash, @new_hash, @expected_hash, @client_id, @diff_summary, @at)
`);
// Phase 2: migration v9 adds `is_memory_sink_write INTEGER NOT NULL DEFAULT 0`
// + RecordWriteInput gains `isMemorySinkWrite: boolean`
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-tool guards | Single chokepoint at `DeliveryAdapter.write()` | ADR-002 I-6 | Phase 2 inserts validator at one location; CI grep enforces |
| `path`-as-primary-key | Branded `DocId` URI | Phase 1 ADP-04 | Sink resolution uses `DocId` not vault-relative path |
| `server.setRequestHandler(...)` low-level | `server.registerResource(...)` high-level (SDK 1.29) | SDK 1.29 (Phase 1 ADP-08) | `resource()` method deprecated in `mcp.d.ts:80-95` |
| `WriteResult` with `noteId: number` (v1) | `WriteResult` with `doc_id: DocId` (v2) | Phase 1 ADP-04 | Validator returns the new shape; v1 path translates |

**Deprecated/outdated:**
- `server.resource(name, …)` SDK overload — replaced by `registerResource` per `mcp.d.ts:80-95`.
- Vault-relative `superseded_by` paths in fixtures — Phase 2 normalizes to `obsidian-fs://…` DocId form.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 15 existing memory fixture docs satisfy MEMORY_CONTRACT.md's seven required-key shape (after `superseded_by` normalization) | Q3 fixture scope | If a fixture file is missing a required key, v1-baseline eval breaks on Phase 2 wave-1. Mitigation: wave-0 micro-task lints all 15 docs against the contract validator. |
| A2 | The MCP SDK 1.29 `registerResource` API is stable; no breaking change between 1.29.0 and 1.29.x | Q4 resource registration | Low risk — SDK is on a 1.x line. Mitigation: pin to `^1.29.0` (already pinned). |
| A3 | `yaml@^2.9.0` parses `_contracts/memory/<name>.yaml` per YAML 1.2 — sufficient for the contract schema | Q2 YAML loader | Very low risk — `yaml` is the canonical Node YAML parser; gray-matter uses an older variant inappropriate here. |
| A4 | No production users have `~/.vault-memory/config.toml` with reserved `[memory]` / `[[memory_sinks]]` keys today | Config schema extension | Very low — Phase 2 is pre-release v2 work; the only consumers are dev fixtures. |
| A5 | A `delete()` against a memory-sink path should be refused entirely in v2.0.0 (no `forget()` tool yet) | Q6 module layout, Pitfall 5 | If Phase 5 needs hard-delete sooner than expected, Q5 + Pitfall 5 logic must relax. Tracked as a deferred item. |

**Confirm before locking these decisions in /gsd:discuss-phase.** A1 in particular gates plan ordering — if normalization is more than `sed`-level, MEM-10 becomes a wave-1 task instead of wave-0.

## Open Questions

### Q1 — Error-shape contract for guard rejections

**Recommendation:** Extend `WriteConflict.reason` union additively (5 new codes) + add 4 optional envelope fields (`sinkName?`, `key?`, `observedValue?`, `suggestion?`). Tool layer continues to return the discriminated union as the `tools/call` content; do NOT emit MCP `isError: true` for guard failures — guard rejections are domain errors, not protocol errors.

**Why:**
- Phase 1 already established the discriminated-union pattern; 324 v1 tests assume it.
- `src/frontmatter/update.ts:75` already extends the union locally — Phase 2 just propagates additional codes to the canonical `types.ts` declaration.
- Optional envelope fields preserve backwards-compatible serialization: a client that only reads `reason` + `message` keeps working; a v2-aware client gets `suggestion` and `sinkName` for richer UX.
- MCP `isError: true` is reserved for protocol-level failures (unknown tool, bad args). A semantically valid call that the server refuses by policy is a content-error, not a protocol error.

**Concrete reason codes (5):**
| Reason | When | Tool layer that exposes it |
|--------|------|---------------------------|
| `missing_provenance` | Guard A — required key absent | `record_observation`, `update` |
| `invalid_provenance` | Guard A — value fails enum/type | `record_observation`, `update` |
| `supersede_mismatch` | Guard A — `status`/`superseded_by` cross-field invariant violated | `supersede` |
| `agent_write_outside_sink` | Guard B — `source:"agent"` and target not in any sink | `write_note` (defense-in-depth), `record_observation` w/ corrupt sink param |
| `sink_write_blocked` | v1 tool target lands in a sink | `write_note`, `update_frontmatter`, `delete_note` |

**Concrete envelope fields (4 — all optional):**
| Field | Type | When populated | Example |
|-------|------|---------------|---------|
| `sinkName?` | string | All sink-related rejections | `"default"` |
| `key?` | string | `missing_provenance` / `invalid_provenance` / `supersede_mismatch` | `"observed_at"` |
| `observedValue?` | unknown | `invalid_provenance`, `supersede_mismatch` | `"yesterday"` (when an ISO date was expected) |
| `suggestion?` | string | All Guard A/B rejections | `"Use record_observation for _memory/ targets"` |

**Defense-in-depth at v1 tool handlers (MEM-07):**

v1 `write_note` / `update_frontmatter` / `delete_note` MCP handlers gain a pre-flight check: if the target `DocId` resolves into a configured sink, return `sink_write_blocked` BEFORE calling the delivery adapter. The delivery adapter still enforces the guard (per ADR-002 I-6), but the early refusal gives the agent the exact `suggestion` text without paying for the FS read. Rationale: the redundancy is licensed by MEMORY_CONTRACT.md §Validator behavior line 234 ("Per-tool handlers MUST route through the adapter and MUST NOT replicate or bypass the guards") — the v1 handler's early check is a REPLICATION for UX, not a BYPASS. Both checks return the same structured error.

### Q2 — MemoryContract loading + caching strategy

**Recommendation:** **Ship the YAML loader on day one.** Module location: `src/memory/contract/`. Hardcoded `default-memory-v1` lives in `src/memory/contract/default-v1.ts` (always-available baseline); YAML loader reads `_contracts/memory/<name>.yaml` only if the config references a non-default name. Cache strategy: **load-once-at-startup**, no mtime watch in v2.

**Why ship the loader:**
- Phase 5 (briefs) needs `brief-memory-v1` — a contract that adds `compiled_from`, `compiled_at`, `source_hashes` as required keys. Building this in Phase 5 means re-touching the validator surface; building the loader in Phase 2 means Phase 5 just adds a YAML file.
- The cost is ~70 LoC + 4 unit tests vs ~30 LoC for hardcoded-only.
- `yaml@^2.9.0` is already installed (Phase 0 plan 00-01).

**Why no live mtime watch:**
- Contracts change on `npm publish`, not on agent calls. A server restart picks up new contracts.
- ADR-002 I-1 confines chokidar to `src/adapters/change-feed/`. A contract watcher would either duplicate chokidar wiring (forbidden) or require pulling `_contracts/` into the obsidian-fs change feed (out of scope; `_contracts/` is L4's territory per Phase 6).
- Per-write revalidation is too expensive (one YAML parse per record_observation call).

**Concrete module shapes:**

```typescript
// src/memory/contract/schema.ts — Zod schema for the contract YAML file
import { z } from "zod";

const PropertyRule = z.object({
  type: z.enum(["string", "datetime", "array", "doc_id", "number", "boolean"]),
  allowed: z.array(z.string()).optional(),     // enum constraint
  default: z.unknown().optional(),              // default value
  items: z.object({ type: z.string() }).optional(),  // for arrays
  min_length: z.number().optional(),
});

export const MemoryContractYamlSchema = z.object({
  name: z.string(),
  version: z.string().optional().default("1.0"),
  required_properties: z.record(z.string(), PropertyRule),
  optional_properties: z.record(z.string(), PropertyRule).optional().default({}),
  naming: z.object({
    strategy: z.enum(["caller-provided", "date-slug", "adapter-assigned"]),
    pattern: z.string().optional(),
  }),
});

export type MemoryContractYaml = z.infer<typeof MemoryContractYamlSchema>;
```

```typescript
// src/memory/contract/index.ts
export interface MemoryContract {
  name: string;
  version: string;
  /** Built-once Zod schema for validating Document.properties */
  propertiesSchema: z.ZodTypeAny;
  /** Required key names in iteration order (for diagnostic messages) */
  requiredKeys: readonly string[];
  /** Naming strategy for the sink */
  naming: { strategy: "caller-provided" | "date-slug" | "adapter-assigned"; pattern?: string };
}

/** Returns the named contract or throws if not found. */
export function getContract(name: string): MemoryContract { ... }
```

```typescript
// src/memory/contract/default-v1.ts — the hardcoded baseline, matches MEMORY_CONTRACT.md spec
export const DEFAULT_MEMORY_V1: MemoryContract = {
  name: "default-memory-v1",
  version: "1.0",
  propertiesSchema: z.object({
    source: z.enum(["agent", "user", "imported"]),
    confidence: z.enum(["direct", "inferred", "uncertain"]),
    evidence: z.array(z.string()),
    status: z.enum(["active", "superseded", "archived"]).default("active"),
    observed_at: z.string().datetime({ offset: true }),
    superseded_by: z.string().nullable().default(null),
    type: z.string().min(1),
    // Allow contract-extra keys without rejection (D-02 escape hatch)
    superseded_reason: z.string().optional(),
  }).passthrough(),
  requiredKeys: ["source", "confidence", "evidence", "status", "observed_at", "superseded_by", "type"],
  naming: { strategy: "date-slug", pattern: "{observed_at:YYYY-MM-DD}-{slug}.md" },
};
```

**Loader scope for Phase 2:**
- Always returns `DEFAULT_MEMORY_V1` for the name `"default-memory-v1"` (hardcoded — never disk-read).
- For other names, looks up `<vault.path>/_contracts/memory/<name>.yaml`. Loads at server-startup time (during `registry.registerMemorySinks(...)`); cached for process lifetime.
- Validates with `MemoryContractYamlSchema.parse(parsed)`; converts the `required_properties` map into a Zod schema via a `buildContractSchema(yaml)` helper.
- Server-startup failure on contract parse error — fail-fast per ADR-004 §Resolution.

### Q3 — MEM-10 fixture scope

**Recommendation:** Keep the existing 15 docs (8 observations + 3 briefs + 4 status-updates) and add **5 net-new docs** to reach 20. The 5 net-new docs cover the missing provenance dimensions and add one A→B→C supersede chain. Malformed inputs live in a separate `tests/fixtures/malformed-memory/` tree (per CONTEXT recommendation).

**Existing 15 docs (already in `evals/fixtures/v2-test-vault/_memory/`):**
- 8 observations covering `confidence: direct` (most), one `inferred`, one with `status: superseded`
- 3 briefs (`type: brief`)
- 4 status-updates (`type: status-update`)

**Provenance dimensions to add (5 net-new docs):**

| # | New doc | Path | Purpose |
|---|---------|------|---------|
| 1 | `2026-04-23-spire-budget-uncertain.md` | observations/ | `confidence: uncertain` (currently absent from fixture) |
| 2 | `2026-04-23-hypothesis-warehouse-roi.md` | observations/ | `type: hypothesis`, `confidence: inferred`, evidence with 2 DocIds |
| 3 | `2026-04-24-spire-budget-revised.md` | observations/ | `status: active`, supersedes doc #1 (chain link B) |
| 4 | `2026-04-26-spire-budget-final.md` | observations/ | `status: active`, supersedes doc #3 (chain link C — completes A→B→C) |
| 5 | `2026-04-28-q2-okr-decision.md` | observations/ | `type: decision`, empty `evidence: []` array (boundary case — MEMORY_CONTRACT.md line 102 explicitly permits) |

After insertion: docs #1, #3 carry `status: superseded` with `superseded_by` pointing to #3, #4 respectively. #4 is the live tip. This gives Phase 4 graph traversal a real multi-step chain.

**Fixture-vault `superseded_by` form fix-up (data fix-up, MUST land with fixture work):**

The existing `2026-04-20-atlas-1-pilot-target-was-12.md` line 9 uses `_memory/observations/2026-04-16-atlas-1-pilot-count-reduced.md` — a vault-relative path. Phase 2 normalizes to `obsidian-fs://atlas-fixture/_memory/observations/2026-04-16-atlas-1-pilot-count-reduced.md` (full DocId per MEMORY_CONTRACT.md line 198). Apply this fix-up to ALL existing fixture files with a non-null `superseded_by`.

**Malformed inputs (separate tree, 5 files):**

```
tests/fixtures/malformed-memory/
├── missing-observed-at.md           # Tests missing_provenance reason
├── missing-source.md                # Tests Guard A first-key iteration
├── invalid-confidence.md            # Tests invalid_provenance with observedValue
├── supersede-no-target.md           # status: superseded + superseded_by: null (supersede_mismatch)
└── source-agent-no-evidence.md      # source:agent at non-sink path (agent_write_outside_sink)
```

These are NOT inside the fixture vault — they live under `tests/fixtures/` so the v1-baseline eval suite (which walks `evals/fixtures/v2-test-vault/`) does not encounter them. The Phase 2 validator-unit-tests consume them directly.

### Q4 — MCP Resources URI scheme

**Recommendation:** Flat scheme — `vault-memory://memory/sinks` and `vault-memory://memory/stats`. Polled-only in v2.0.0 (no `notifyResourceUpdated` subscriptions). Use `server.registerResource(name, uri, metadata, callback)` SDK 1.29 high-level API.

**Why flat over nested:**
- Nested `vault-memory://memory/sinks/<name>/stats` requires a `ResourceTemplate` (per `mcp.d.ts:222`) and forces a callback that takes `(uri, variables, extra)` — strictly more complex.
- A read of nested `sinks/<name>/stats` requires the client to first call `listResources` to discover sink names — adds a roundtrip. Flat returns all sinks (or all stats) in one read.
- Stats payload is small (counts per sink, recent-write timestamp, contract name) — sending all at once is cheap.

**Concrete URIs:**
| URI | Returns |
|-----|---------|
| `vault-memory://memory/sinks` | `{ sinks: [{ name, handle, contract, default, vault }] }` — per ADR-004 §Resolution |
| `vault-memory://memory/stats` | `{ sinks: [{ name, doc_count, by_type: {observation: N, brief: M, ...}, by_status: {...}, last_write_at }] }` |

**Why polled-only:**
- CONTEXT default: "polled-only unless subscriptions are trivially small given Phase 1's MCP SDK 1.29 wiring." Subscriptions require `notifyResourceUpdated` on every sink-content change — non-trivial because it must hook the `ChangeFeed.subscribe()` callback path (which currently emits chokidar `add`/`change`/`unlink` events for ANY file, not just memory-sink writes). Filtering to sink paths + per-resource subscription tracking is ~100 LoC + a new test surface. Deferred to Phase 5/6.

**MCP SDK 1.29 registration pattern:** see Code Example above. Both resources are static URIs (no `ResourceTemplate`), use `mimeType: "application/json"`, and return `{ contents: [{uri, mimeType, text: JSON.stringify(...)}] }`.

### Q5 — `superseded_reason` property

**Recommendation: store on the document (option a — extend the contract), NOT audit-log only.**

The `superseded_reason` value belongs with the supersession because it explains WHY this specific superseded → replacement edge exists, which is a property of the edge/observation pair, not an act-of-administration. Burying it in the audit log loses it for:
- `recall()` showing the chain of historical observations + their retirement reasons
- Phase 4 graph traversal annotating back-edges
- Future "explain why this is no longer current" agent UX

**Concrete contract extension:**

```yaml
# default-memory-v1 — proposed amendment to ADR-004's contract YAML
optional_properties:
  superseded_by: { type: doc_id }
  superseded_reason: { type: string }      # NEW — non-empty when status=superseded
  expires_at: { type: date }
```

The Zod schema in `DEFAULT_MEMORY_V1` already lists `superseded_reason: z.string().optional()` per the Q2 code example above.

**Cross-field constraint:** `superseded_reason` MUST be present (non-empty string) when `status === "superseded"`. Add to Guard A's supersede_mismatch check: violated → `{reason: "supersede_mismatch", key: "superseded_reason"}`. Validator code handles all three forms (status/by/reason mutual-presence) in one block.

**ADR amendment scope:** small — append the new property to ADR-004's `default-memory-v1` YAML example (~5 lines). Same amendment ticket as Pitfalls 1+2 (the underscored-key + confidence-enum fixes).

### Q6 — `src/memory/` runtime module layout

**Recommendation:** See the "Recommended Project Structure" diagram above. Concretely:

```
src/memory/
├── index.ts                       # Public surface: { recordObservation, recall, supersede,
│                                  #   getListSinksResource, getMemoryStatsResource,
│                                  #   registerMemorySinks, MemorySink type }
├── sink.ts                        # MemorySinkHandle parser + sentinel mechanics
├── registry.ts                    # AdapterRegistry extension methods (or composition?)
├── validator.ts                   # validateAgentWrite() pure function
├── contract/
│   ├── index.ts                   # getContract(name) / loadContractFromDisk(name, vaultPath)
│   ├── default-v1.ts              # DEFAULT_MEMORY_V1 hardcoded baseline
│   ├── loader.ts                  # YAML loader (uses yaml@^2.9.0 + Zod)
│   └── schema.ts                  # MemoryContractYamlSchema
├── tools/
│   ├── record-observation.ts      # Tool handler — composes properties, calls delivery.write
│   ├── recall.ts                  # Tool handler — queries memory-sink-scoped indices
│   └── supersede.ts               # Tool handler — single OCC update on OLD doc
└── resources/
    ├── sinks.ts                   # Resource reader for vault-memory://memory/sinks
    └── stats.ts                   # Resource reader for vault-memory://memory/stats
```

**On `AdapterRegistry` extension:** the current `src/adapters/registry.ts` is purely the adapter-handle resolver. Adding `listMemorySinks` / `resolveMemorySink` / `getDefaultMemorySink` to the same class works structurally but mixes two concerns. **Recommend a composition**: keep `AdapterRegistry` adapter-only; add a new `MemorySinkRegistry` class in `src/memory/registry.ts` that takes an `AdapterRegistry` and the parsed `memory_sinks` config block. The MCP server holds both. This honors ADR-004 §Resolution literal text ("`src/adapters/registry.ts` resolves a `MemorySink` handle…") only loosely — the resolver function logically belongs in `src/adapters/registry.ts`, but mechanically lives in `src/memory/registry.ts` and is the only resolver. Document this in the ADR-004 amendment ticket if needed.

**Single-resolver rule honored:** the only code that interprets a sink handle as a folder path lives inside `src/memory/sink.ts:parseMemorySinkHandle()` + `src/memory/registry.ts:resolveMemorySink()`. No other module looks at `_memory/` strings, sink folders, or `.memory-sink` paths.

### Q7 — `recall` implementation strategy

**Recommendation:** Route `recall()` through `search_hybrid` filtered to memory-sink paths, then post-filter by provenance properties + sort by `observed_at`. Reuse the existing search infrastructure rather than scanning memory-sink folders directly.

**Why:**
- Memory documents are ordinary `Document`s indexed by L0 (per ARCHITECTURE.md line 187: "Memory is stored as ordinary Documents, indexed by L0, searchable by L1's graph"). Building a parallel scan-and-rank means duplicating the hybrid pipeline.
- `search_hybrid` already accepts `exclude_paths?: string[]`. The inverse — `include_paths?: string[]` — does not exist today, so we either (a) add an `include_paths` parameter or (b) call `search_hybrid` against all vaults and post-filter the hits to those whose `notePath` starts with a sink-resolved prefix.

**Pick (b) for Phase 2** — zero changes to `search_hybrid`'s API signature; the filter is one `.filter(hit => sinkPaths.some(p => hit.notePath.startsWith(p)))`. Cost: slightly larger `top_k * fan-out` from search, then trim. For 20 memory docs + 50 user notes in the fixture this is irrelevant. Phase 3 ASM-07 introduces `recency_weight` properly; `recall` can adopt it then.

**Filter pipeline (post-hybrid):**

```typescript
export async function recall(input: RecallInput): Promise<MemoryHit[]> {
  // 1. Resolve sink(s) — single or all configured
  const sinks = input.sink ? [memorySinks.resolve(input.sink)] : memorySinks.list();
  const sinkPathPrefixes = sinks.map((s) => s.resolveToPath);  // adapter-helper

  // 2. Hybrid search across configured vaults — generous top_k to survive filters
  const candidates = await searchHybrid({ query: input.query, top_k: 200, ... });

  // 3. Filter to sink-scoped hits
  const inSink = candidates.filter((h) =>
    sinkPathPrefixes.some((prefix) => h.notePath.startsWith(prefix))
  );

  // 4. Load full Document for each — needed for properties access
  const docs = await Promise.all(inSink.map((h) => readDocument(h.doc_id)));

  // 5. Apply provenance filters
  const filtered = docs.filter((doc) =>
    confidenceRank(doc.properties.confidence) >= confidenceRank(input.min_confidence) &&
    (!input.types || input.types.includes(doc.properties.type)) &&
    (!input.max_age_days || withinMaxAge(doc.properties.observed_at, input.max_age_days)) &&
    doc.properties.status !== "superseded"   // hide superseded by default per ASM-08 precedent
  );

  // 6. Sort by observed_at desc (mtime tiebreak)
  filtered.sort(byObservedAtThenMtime);

  // 7. Return citation packet
  return filtered.slice(0, input.limit ?? 20).map(toCitationPacket);
}
```

`confidenceRank` is a simple ordinal: `direct=3, inferred=2, uncertain=1, undefined=0`.

### Q8 — Audit-log discriminator (MEM-08)

**Recommendation:** Add a new column `is_memory_sink_write INTEGER NOT NULL DEFAULT 0` to `write_audit` via migration v9. Extend `RecordWriteInput` with `isMemorySinkWrite: boolean`. Extend `ListWritesFilter` with `isMemorySinkWrite?: boolean`. Extend `getAuditLog` input + `AuditLogEntry` output likewise.

**Why a new column (not a JSON property in `diff_summary`):**
- Indexable. Future "show me only memory-sink writes" needs a fast filter; SQLite indexes don't span JSON-in-TEXT columns.
- The existing `audit_log` tool already exposes a filter pattern (`notePath`, `op`, `since`) at `src/audit/audit.ts:73`. Adding `isMemorySinkWrite` follows that pattern exactly.
- Backwards-compatible: existing audit-log consumers pass no filter and get all rows; migration default of `0` makes pre-Phase-2 rows correctly classified as non-memory writes.

**Migration v9 sketch:**

```sql
-- migration 009 — add memory-sink discriminator
ALTER TABLE write_audit ADD COLUMN is_memory_sink_write INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_write_audit_memory ON write_audit(is_memory_sink_write, at DESC)
  WHERE is_memory_sink_write = 1;
```

The partial index keeps the existing `idx_write_audit_note` index untouched and gives "list recent memory writes" a tight scan path.

**`ObsidianFsDelivery.write()` writes the flag:** after Guards A/B pass and the FS write succeeds, the `audit.recordWrite()` call passes `isMemorySinkWrite: sink !== null`. Stub delivery does the equivalent in-memory for its conformance fixture.

### Q9 — Conformance suite extension

**Recommendation:** Extend `src/adapters/delivery/conformance.test.ts` with **8 new parameterized cases (11–18)**. All are capability-gated to skip the stub when filesystem semantics are irrelevant.

| # | Case | Both adapters? | Asserts |
|---|------|----------------|---------|
| 11 | write w/o `properties.source` to a non-sink target → ok (no provenance required outside sinks) | yes | Guard B does not falsely fire |
| 12 | write w/ `source:"agent"` to a non-sink target → `{ok:false, reason:"agent_write_outside_sink"}` | yes (sink param=null) | Guard B fires; envelope has `suggestion` |
| 13 | write w/ all 7 keys to a sink target → ok | yes | Guard A passes; sentinel-check pre-passed |
| 14 | write missing `observed_at` to sink → `{ok:false, reason:"missing_provenance", key:"observed_at"}` | yes | Guard A iterates required keys in order |
| 15 | write `confidence:"unknown-enum"` to sink → `{ok:false, reason:"invalid_provenance", key:"confidence", observedValue:"unknown-enum"}` | yes | Zod enum failure mapped correctly |
| 16 | write `status:"superseded"` + `superseded_by:null` → `{ok:false, reason:"supersede_mismatch"}` | yes | Cross-field rule |
| 17 | write `source:"user"` into sink → `{ok:false, reason:"non_agent_write_inside_sink"}` | yes | Guard B inverse |
| 18 | delete of a sink-resolved doc → `{ok:false, reason:"sink_write_blocked"}` | yes | MEM-07 hard-delete refusal |

**Adapter-specific (NOT parameterized):**

| # | Case | Adapter | File |
|---|------|---------|------|
| 19 | write to a folder lacking `.memory-sink` sentinel → `{ok:false, reason:"sentinel_missing"}` | obsidian-fs only | `src/adapters/delivery/obsidian-fs/sentinel.test.ts` |
| 20 | sentinel file created at first successful sink resolution | obsidian-fs only | same |
| 21 | startup aborts with structured error when sink folder contains unrelated user notes + no sentinel | obsidian-fs only | `src/memory/registry.test.ts` |

The MEM-11 "naive `write_note` to memory-sink-resolved path is rejected with clear error" test lives in `src/server.test.ts` (top-level integration); the conformance cases 11–18 above cover the delivery-layer invariants; the integration test verifies the MCP tool wiring forwards the error correctly.

### Q10 — Sentinel file mechanics

**Recommendation:** Sentinel is a plain text file with YAML-style key:value content (`created_at`, `sink_name`, optional `vault_memory_version`). The HANDLE PARSER inside `src/memory/sink.ts` is the only resolver that checks for it. Fail-closed on missing sentinel. Watcher integration: register sink-folder paths with the suppression set so own-writes don't reindex the sentinel file as a memory doc.

**Content (informational only — presence is the gate):**

```
created_at: 2026-05-15T10:00:00Z
sink_name: default
vault_memory_version: 2.0.0
```

The parser does not validate sentinel contents (per ADR-004 line 289). Content exists for human readability when grepping a vault.

**Provisioning logic (at `registry.registerMemorySinks(...)` boot time):**

```typescript
async function provisionSink(sink: MemorySinkResolution, fs: FsCapable): Promise<void> {
  const sentinelPath = join(sink.absoluteFolderPath, ".memory-sink");
  const folderExists = await fs.exists(sink.absoluteFolderPath);
  const sentinelExists = folderExists && (await fs.exists(sentinelPath));

  if (sentinelExists) return;  // already provisioned — no-op

  if (!folderExists) {
    await fs.mkdir(sink.absoluteFolderPath, { recursive: true });
    await fs.writeFile(sentinelPath, formatSentinelContent(sink));
    return;
  }

  // Folder exists but no sentinel — check it's safe to provision
  const entries = await fs.readdir(sink.absoluteFolderPath);
  const hasOnlyExpectedContent = entries.every(isExpectedSinkContent);  // observations/, _briefs/, etc.

  if (!hasOnlyExpectedContent) {
    throw new SinkProvisioningError(
      `Memory sink "${sink.name}" target folder ${sink.absoluteFolderPath} ` +
      `contains unrelated user content. Refusing to label as a sink. ` +
      `Move user content out, or change the [[memory_sinks]] handle.`,
    );
  }

  await fs.writeFile(sentinelPath, formatSentinelContent(sink));
}
```

**Runtime check on every write:**

The sentinel check is cheap (one `fs.stat`). Run it inside `ObsidianFsDelivery.write()` AFTER the validator guards pass but BEFORE the atomic write — if a user manually deletes `.memory-sink` between boot and a write call, fail-closed with `{reason: "sentinel_missing", sinkName, suggestion: "The sink sentinel was deleted. Restart the server (it will re-provision automatically) or restore .memory-sink manually."}`. This is rare but real (user `rm -rf _memory/` then `mkdir _memory/` would land here).

**Watcher integration:**

The change-feed (`src/adapters/change-feed/obsidian-fs/`) MUST NOT re-index the `.memory-sink` file itself as a memory document. Two paths:
1. **Suppression**: register `.memory-sink` paths on the suppression set at provisioning time.
2. **Exclusion glob**: add `_memory/.memory-sink` to the default exclude globs.

Pick (2) — simpler, no runtime coupling. The `.memory-sink` filename pattern matches `node_modules/`-style exclusions that scanner already handles per `src/adapters/source/obsidian-fs/scanner.ts:5`.

**Sentinel file format choice (plain k:v vs JSON vs YAML):** plain k:v (YAML 1.2 compatible if we ever parse it) keeps grep-readable and avoids importing yaml@ for a 3-line file. The parser explicitly does not parse the contents — only presence matters.

## Environment Availability

> No external dependencies beyond what Phase 0/1 already established.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | ≥22 | — |
| MCP SDK | resource registration | ✓ | 1.29.0 | — |
| Ollama | embeddings (recall path) | ✓ assumed (Phase 1 baseline) | — | If absent, recall returns empty; not Phase-2-blocking |
| `yaml@^2.9.0` | contract loader | ✓ | 2.9.x | — (pre-installed) |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none.

## Validation Architecture

> nyquist_validation is enabled (default — no `workflow.nyquist_validation: false` in `.planning/config.json` examined).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.8 (Phase 1 baseline) |
| Config file | none — uses vitest defaults; co-located `*.test.ts` |
| Quick run command | `npx vitest run --no-coverage src/memory/ src/adapters/delivery/` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | Handle parser is only sink resolver | unit | `npx vitest run src/memory/sink.test.ts` | ❌ Wave 1 |
| MEM-02 | record_observation writes via delivery | integration | `npx vitest run src/memory/tools/record-observation.test.ts` | ❌ Wave 2 |
| MEM-03 | recall filters by sink + provenance | integration | `npx vitest run src/memory/tools/recall.test.ts` | ❌ Wave 2 |
| MEM-04 | supersede sets status + forward link | unit | `npx vitest run src/memory/tools/supersede.test.ts` | ❌ Wave 2 |
| MEM-05 | Validator at delivery; Guards A & B | parameterized | `npx vitest run src/adapters/delivery/conformance.test.ts` | ✅ (extend) |
| MEM-06 | Sentinel write/check | unit | `npx vitest run src/adapters/delivery/obsidian-fs/sentinel.test.ts` | ❌ Wave 2 |
| MEM-07 | v1 tools refuse sink targets | integration | `npx vitest run src/server.test.ts` (extend) | ✅ (extend) |
| MEM-08 | audit_log filters memory-sink writes | unit | `npx vitest run src/audit/audit.test.ts` (extend) | ✅ (extend) |
| MEM-09 | Resources registered + readable | integration | `npx vitest run src/server.test.ts` (extend) | ✅ (extend) |
| MEM-10 | Fixture has 20 docs with diverse provenance | snapshot | `npx vitest run evals/v2-fixtures.test.ts` | ❌ Wave 0 |
| MEM-11 | Naive write_note to sink → clear error | integration | `npx vitest run src/server.test.ts` (specific case) | ✅ (extend) |
| MEM-12 | (ratification — no test) | — | — | — |

### Sampling Rate

- **Per task commit:** `npx vitest run --no-coverage <changed paths>`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` + `npm run lint:check` + `npm run eval:baseline` all green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `evals/v2-fixtures.test.ts` — snapshot 20-doc memory fixture against contract validator
- [ ] `tests/fixtures/malformed-memory/` — author the 5 malformed test fixtures
- [ ] Fix-up: normalize existing `superseded_by` fields in fixture vault to full DocId form
- [ ] Lint pre-existing 15 fixture docs against the (Phase 2) validator — catch any property-key drift before guards land

## Security Domain

> security_enforcement is not explicitly disabled — applying STRIDE-aware review to the new write surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | MCP transport is stdio-local; no auth in scope for v2 |
| V3 Session Management | no | per-process server |
| V4 Access Control | yes | `write_enabled` flag + memory-sink Guard A/B — already at delivery |
| V5 Input Validation | yes | Zod schemas on tool inputs + contract validator on `Document.properties` |
| V6 Cryptography | no | no crypto introduced; sha256 hash use is content-fingerprint, not security |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in DocId resource (`../escape.md`) | Tampering | `safeJoinInsideVault` already enforces; conformance case at `conformance.test.ts:284-294` |
| Agent silently mutates user notes | Tampering | Guard B at delivery (ADR-004 M-5); CI grep enforces single chokepoint |
| Sentinel deletion + folder repurpose attack | Tampering | Fail-closed on missing sentinel + provisioning refuses non-empty user folders |
| Memory-sink path-prefix matching outside handle parser | Tampering | ADR-004 M-1 single-resolver rule; CI grep for `_memory/` literal outside `src/memory/` |
| Provenance injection (agent sets `source: user` to bypass Guard B) | Spoofing | Guard B's `non_agent_write_inside_sink` rejects any non-`agent` source into sink |
| Cross-vault DocId forgery in supersede | Tampering | `docIdToPath()` asserts authority matches adapter vault — already enforced at `obsidian-fs/index.ts:283-288` |
| YAML deserialization of contract file (CVE-style yaml parse) | Tampering | `yaml@^2.9.0` is YAML 1.2 strict; no `!!js/function` tags |

## Sources

### Primary (HIGH confidence)
- `docs/v2/adr/004-memory-sink-handles.md` — MemorySink handle shape, `.memory-sink` sentinel, Guards A/B, M-1..M-5 invariants
- `docs/v2/adr/001-document-identity.md` — DocId URI syntax, I-1..I-6
- `docs/v2/adr/002-adapter-seams.md` — DeliveryAdapter.write() single chokepoint (I-6), registry shape, capability descriptors
- `docs/v2/adr/003-document-shape.md` — PropertyBag, hash semantics H-1..H-6
- `docs/v2/MEMORY_CONTRACT.md` — authoritative validator behavior, structured error JSON shapes, Guard A/B short-circuit ordering
- `docs/v2/ARCHITECTURE.md` — L2 memory layer placement (lines 164–194)
- `src/adapters/delivery/types.ts` — Phase 1 reserved Memory-sink guard hook (`§Memory-sink guard (Phase 2 hook)` lines 23–41)
- `src/adapters/registry.ts` — Branded-DocId minting IIFE pattern (lines 76–92); existing resolver methods
- `src/adapters/delivery/obsidian-fs/index.ts` — Phase 1 facade structure, write() entry point
- `src/adapters/delivery/conformance.test.ts` — parameterized cases 1–10 (Phase 1 baseline)
- `src/adapters/delivery/obsidian-fs/write.ts` — atomic writeNote + FS+DB transaction (existing pattern)
- `src/db/queries/audit.ts` — RecordWriteInput shape, listWrites filter pattern
- `src/db/schema.ts` — write_audit table definition (lines 146–246)
- `src/config/loader.ts` — TOML+Zod loading pattern
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:102-103` — `registerResource` API signature (SDK 1.29)
- `package.json` line 38, 45 — MCP SDK 1.29.0, yaml ^2.9.0
- `evals/fixtures/v2-test-vault/_memory/` — existing 15 memory fixture docs
- `evals/fixtures/v2-test-vault/_queries/memory.yaml` — existing eval queries (provenance-filtered retrieval scenarios)

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONVENTIONS.md` — kebab-case files, vitest co-location (referenced from CLAUDE.md project conventions)
- ADR-004 §Hard-isolation question lines 189–210 — folder-default already ratified by Phase 0 plan 00-05

### Tertiary (LOW confidence)
- None — all major claims trace to in-repo authoritative sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed, all APIs verified in node_modules type definitions
- Architecture: HIGH — ADR-004 + MEMORY_CONTRACT.md + Phase 1 outputs leave little ambiguity for Phase 2 module placement
- Pitfalls: HIGH — discrepancies (underscore vs hyphen; confidence enum mismatch) discovered by direct cross-reference of ADR-004 vs MEMORY_CONTRACT.md vs the fixture; bootstrap race surfaced from server.ts inspection

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (stable substrate — ADRs are Accepted; Phase 1 outputs are committed on `main`)

## RESEARCH COMPLETE

**Phase:** 2 — Memory namespace & provenance contract
**Confidence:** HIGH

### Key Findings

- **`WriteConflict` extension is purely additive** — 5 new reason codes + 4 optional envelope fields preserve all 324 v1 tests; pattern already established in `src/frontmatter/update.ts:75`.
- **Ship the YAML contract loader on day one** — `yaml@^2.9.0` is pre-installed; the contract is structurally a Zod schema; Phase 5 needs the loader anyway.
- **15 fixture docs already in place** — add 5 net-new (including A→B→C supersede chain), normalize all `superseded_by` to full DocId form, and place malformed fixtures in `tests/fixtures/malformed-memory/` (separate tree).
- **Flat MCP Resource URI scheme** — `vault-memory://memory/sinks` + `vault-memory://memory/stats`, polled-only, via SDK 1.29 `server.registerResource()`.
- **`observed_at` / `superseded_by` / `superseded_reason` are underscored** — fixture + MEMORY_CONTRACT.md are authoritative; ADR-004's hyphenated YAML example needs a doc-only amendment.
- **Add `superseded_reason` to the contract** (option a) — it belongs with the document, not the audit log; one-line addition to the Zod schema + Guard A cross-field rule.
- **Audit-log discriminator is a new DB column** (`is_memory_sink_write`) via migration v9 — indexable, partial-index optimization, backwards-compatible.
- **Sentinel mechanics: fail-closed; provisioning refuses non-empty user folders; exclude `.memory-sink` from change-feed scanning via default exclude glob.**

### File Created
`/Users/wrede/Documents/GitHub/vault-memory/.planning/phases/02-memory-namespace-provenance-contract/02-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All deps already installed and version-verified in node_modules |
| Architecture | HIGH | ADRs Accepted; Phase 1 hooks live in code; layer placement explicit in ARCHITECTURE.md L2 |
| Pitfalls | HIGH | Discrepancies found by direct ADR↔MEMORY_CONTRACT.md↔fixture diff; bootstrap race from server.ts inspection |

### Open Questions

Two items the planner should flag for `/gsd:discuss-phase` user confirmation:

1. **ADR-004 doc amendment scope.** Pitfalls 1+2 + Q5 propose three related amendments to ADR-004 (underscored keys, confidence enum, `superseded_reason` field). User should confirm: amend ADR-004 inline in Phase 2 wave-0 (small doc change) OR file a follow-up ADR amendment ticket and proceed with the underscored form as de facto canonical. Recommend: inline amendment in wave-0 — keeps the ADR truthful and removes any chance of an implementer following the hyphenated example.

2. **`recall` Phase 3 coupling.** D-01 commits to the Phase-3 citation-packet shape now. Q7 routes through `search_hybrid` for filtering. If the planner later finds the post-hybrid filter to be too slow on a larger memory-sink corpus, the cleanest fix is adding `include_paths` to `search_hybrid` — but that touches a v1 tool's signature. User should confirm: the additive `include_paths` parameter is acceptable as an MEM-07 follow-up (it's strictly additive, defaults preserve v1 behavior), OR Phase 2 must build a parallel scan path to keep `search_hybrid` untouched. Recommend: additive parameter is fine — it's a parameter addition with a default, exactly the same evolution rule that produced ADR-002's `refHashKind` capability descriptor.

### Ready for Planning

Research complete. Planner can now create PLAN.md files. The 10 implementation-area answers above (Q1–Q10) give the planner concrete decisions for every Claude's Discretion area in CONTEXT.md plus the additional questions surfaced in the prompt.
