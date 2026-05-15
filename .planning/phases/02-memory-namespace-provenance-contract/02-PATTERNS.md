# Phase 2: Memory namespace & provenance contract — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 16 (13 new modules + 3 extensions of Phase 1 files)
**Analogs found:** 16 / 16 (every Phase 2 file has a strong existing analog)

This map tells the planner: for each new/modified file in Phase 2, **which existing file in the codebase is the closest pattern to copy from**, what concretely to lift (imports, naming, error shape, test layout), and any seam-preservation constraints that override the analog's choices.

The four anchor files Phase 2 must keep in mind throughout:

| Anchor | Path | Role |
|---|---|---|
| A1 | `src/adapters/registry.ts` (lines 11–20, 50–94, 129–193) | Branded-handle IIFE minting + triad register/resolve/list |
| A2 | `src/adapters/delivery/types.ts` (lines 23–53, 77–87, 120–134) | Discriminated `WriteResult`, `WriteOptions.sink?`, Phase-2-guard header |
| A3 | `src/adapters/delivery/obsidian-fs/index.ts` (entire file) | The DeliveryAdapter facade; sentinel-check + Guards A/B insert here |
| A4 | `src/tool-registry.ts` (lines 41, 461–478, 461 + 534–556) | Tool list + Zod raw shapes + `McpServer.registerTool` loop |

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/memory/sink.ts` | utility (handle parser) | request-response | `src/adapters/registry.ts` §IIFE (lines 50–94) | exact |
| `src/memory/registry.ts` (or extend `src/adapters/registry.ts`) | registry / resolver | request-response | `src/adapters/registry.ts` §AdapterRegistry (lines 129–193) | exact |
| `src/memory/contract.ts` | validator / middleware | request-response | `src/adapters/delivery/obsidian-fs/write.ts` `permissionDenied()` (lines 94–100) + `src/config/loader.ts` `AppConfigSchema` (lines 16–37) | role-match (no validator-at-write-seam yet) |
| `src/memory/tools/record-observation.ts` | controller (MCP tool handler) | request-response | `src/server.ts` `write_note` handler (lines 311–328) + `handleWriteNote` | exact |
| `src/memory/tools/recall.ts` | controller (MCP tool handler) | request-response | `src/server.ts` `search_hybrid` handler (lines 257–278) + `handleSearchHybrid` | exact |
| `src/memory/tools/supersede.ts` | controller (MCP tool handler) | request-response | `src/server.ts` `update_frontmatter` handler (lines 329–344) | exact |
| `src/memory/resources/memory-stats.ts` | controller (MCP Resource handler) | request-response | `src/server.ts` `handleListVaults` (lines 496–518) — closest read-only handler; **no Resource analog exists** (MEM-09 is the first Resource) | role-match |
| `src/memory/resources/list-sinks.ts` | controller (MCP Resource handler) | request-response | same as above (no Resource analog) | role-match |
| ext. `src/adapters/delivery/types.ts` | type declarations | n/a | itself (lines 77–87) — extend existing discriminated union | exact |
| ext. `src/adapters/delivery/obsidian-fs/write.ts` | service | file-I/O | itself (lines 94–100 + 155–157) — add sentinel-check at same shape as `write_enabled` check | exact |
| ext. `src/adapters/delivery/conformance.test.ts` | test | n/a | itself (lines 77–261) — describe.each parametric pattern | exact |
| ext. `src/write/write.ts` + `src/frontmatter/update.ts` | service (Guard A entry-point refusal) | file-I/O | `src/adapters/delivery/obsidian-fs/write.ts` `permissionDenied()` (lines 94–100, 155–157, 274–276) | exact |
| ext. `src/audit/audit.ts` + `src/db/queries/audit.ts` + `src/db/schema.ts` | model / migration | event-driven (audit row) | `src/db/schema.ts` MIGRATION_003 (lines 200–247) — table-rebuild migration pattern | exact |
| `evals/fixtures/v2-test-vault/_memory/*.md` | test fixture | file-I/O | existing `evals/fixtures/v2-test-vault/{decisions,meetings,people,projects}/` | exact |
| `src/memory/contracts/loader.ts` (if shipped) | utility (YAML loader) | file-I/O | `src/config/loader.ts` (lines 16–80) | role-match (TOML→YAML, otherwise identical) |
| `_contracts/memory/default-memory-v1.yaml` | config | n/a | `~/.vault-memory/config.toml` shape pattern | partial (new file type) |
| co-located `*.test.ts` for each module | test | n/a | `src/adapters/delivery/obsidian-fs/write.test.ts` (lines 1–60) + `src/audit/audit.test.ts` (lines 1–60) | exact |

---

## Pattern Assignments

### 1. `src/memory/sink.ts` — MemorySink handle parser

**Path:** `src/memory/sink.ts`
**Closest analog:** `src/adapters/registry.ts` lines 50–94 (the IIFE-closed brand mint for `DocId`)
**Pattern to lift:**
- Use the IIFE-closed-mint pattern identically. `MemorySinkHandle` is already declared as a brand in `src/types.ts:274` (no parser yet). Phase 2 adds `parseMemorySinkHandle(s: string): MemorySinkHandle` with `mint` closed inside an IIFE so the unsafe cast cannot leak.
- Pattern regex constant at module-top (like `DOC_ID_PATTERN`, `SOURCE_HANDLE_PATTERN`); ADR-004 §"MemorySink handle shape" defines the regex shape.
- Error message: include the input via `JSON.stringify(s)` + the expected shape — copy the message style at `registry.ts:83–87`.
- Also expose a `formatMemorySinkHandle(scheme, authority, name)` convenience, mirroring `formatDocId` (lines 100–102).
- Add a `.memory-sink` sentinel constant + `readSentinel(absDir)` helper — but **no `fs` import in this file**. Sentinel-FS lives in the obsidian-fs adapter (see §10 below); this file declares the sentinel filename constant and the Zod schema for sentinel content only.

**Tests (co-located):** `src/memory/sink.test.ts`
- Test pattern: copy `src/adapters/registry.test.ts` lines 21–80 — `describe("parseMemorySinkHandle")` with positive case, then a single `it.each([...])` table of malformed inputs each asserting `toThrow(/Invalid MemorySinkHandle/)`. Include "uppercase scheme", "missing slash", "empty authority", "trailing slash", "no name", "empty string".

**Constraints:**
- No `fs`, no `path`, no `gray-matter` — this is a pure parser. Seam-preservation CI grep enforces this outside `src/adapters/delivery/obsidian-fs/`.
- `verbatimModuleSyntax: true` — `import type { MemorySinkHandle } from "../types.js";` (not value import).
- `.js` extension on the import even though the source is `.ts`.

---

### 2. `src/memory/registry.ts` (OR extension of `src/adapters/registry.ts`)

**Path:** prefer `src/memory/registry.ts` (separate module — keeps Phase 2 surface scoped); if planner picks extension, edits land in `src/adapters/registry.ts:129–193`. ADR-004 §Resolution says **registry is the sole resolver**.

**Closest analog:** `src/adapters/registry.ts` lines 129–193 (`AdapterRegistry` triad maps: sources, deliveries, change-feeds)
**Pattern to lift:**
- One private `Map<MemorySinkHandle, MemorySink>` field + a `defaultHandle: MemorySinkHandle | null` field.
- Three public methods per ADR-004 §Resolution: `listMemorySinks(): MemorySink[]`, `resolveMemorySink(nameOrHandle: string): MemorySink`, `getDefaultMemorySink(): MemorySink`.
- `register` step also (called at server bootstrap from the TOML loader): mirror `registerSource(handle, adapter)` shape (line 137).
- **Resolve throws with helpful message on miss** — copy the diagnostic style at `registry.ts:144–147`:
  ```ts
  const known = [...this.sinks.keys()].join(", ") || "(none)";
  throw new Error(`Unknown memory sink: "${nameOrHandle}". Registered sinks: ${known}`);
  ```
- `resolveMemorySink` accepts EITHER a bare name (`"observations"`) OR a full handle string — same dual-input shape as ADR-004 §Resolution; planner picks lookup-by-name-first-then-by-handle ordering.

**Tests (co-located):** `src/memory/registry.test.ts`
- Pattern: copy `src/adapters/registry.test.ts:80+` (the `AdapterRegistry` triad tests — register, resolve, list, throw-on-miss).
- Add a `getDefaultMemorySink()` throws-when-none test.
- Add a `resolveMemorySink(name)` vs `resolveMemorySink(handle)` equivalence test.

**Constraints:**
- ADR-002 single-resolver rule: **no folder-path matching anywhere**. The registry's `resolveMemorySink` is the only place a string → `MemorySink` lookup may happen. CI grep should flag any other module that does `_memory/`-prefix matching.
- The registry constructor takes the validated `[memory]` + `[[memory_sinks]]` shape from the TOML loader (see §15 if YAML loader ships); zero `fs` calls inside.

---

### 3. `src/memory/contract.ts` — Provenance validator (Guard A + Guard B)

**Path:** `src/memory/contract.ts`
**Closest analog:**
- **Validator shape:** `src/config/loader.ts` lines 16–37 (`AppConfigSchema` with `z.object`/`.parse` discipline). The validator's input is `Document.properties: Record<string, unknown>`; the contract's required keys (`source`, `confidence`, `status`, `observed-at`, `evidence`) become a `MemoryContractSchema = z.object({...})`.
- **Failure-shape:** `src/adapters/delivery/obsidian-fs/write.ts` lines 94–100 — the `permissionDenied()` helper returning a typed `WriteConflict`. Phase 2 adds `provenanceMissing(missingKeys: string[], sinkHandle: MemorySinkHandle)` returning the (extended) `WriteConflict` shape.
- **Where the validator is invoked:** `src/adapters/delivery/types.ts` lines 23–53 + 170–176 — the Phase 2 hook is documented at the entry of `DeliveryAdapter.write()`. Concretely the call site lives inside `src/adapters/delivery/obsidian-fs/index.ts:write()` (currently A3 lines 121–134); Phase 2 inserts `validateProvenance(doc.properties, opts?.sink, registry)` before `writeNoteInternal`.

**Pattern to lift:**
- Export pure functions: `checkGuardA(props, contract): GuardResult`, `checkGuardB(props, sink, registry): GuardResult` (no `Vault`, no `fs` parameters — pure inputs).
- `GuardResult = { ok: true } | { ok: false; reason: ...; missingKeys?: string[]; sinkName?: string; suggestion?: string }` — matches the **extended** `WriteConflict` shape (see §9 below).
- Use Zod for the contract schema (per Phase 1 zod discipline at `loader.ts:16–37` and `tool-registry.ts:482–616`).
- `default-memory-v1` contract hardcoded in this file initially (per Claude's Discretion in CONTEXT.md — defer YAML loader unless trivially small).

**Tests (co-located):** `src/memory/contract.test.ts`
- Pattern: copy `src/audit/audit.test.ts` lines 1–60 — `beforeEach`/`afterEach` setup, fixture seeding, `describe`/`it` per guard.
- Test matrix: Guard A — missing each required key one-at-a-time; Guard B — `source: agent` outside any sink rejected, `source: user` inside sink allowed, `source: imported` outside any sink allowed.

**Constraints:**
- Pure functions only. No `Vault`, no DB, no `fs`. The validator receives the resolved `MemorySink` (or `undefined`) and the `Document.properties` bag.
- **Reads `Document.properties`, not raw YAML.** ADR-004 explicitly requires this — provenance lives on the canonical `Document` shape (ADR-003), not on frontmatter strings.
- `import type` for `Document`, `MemorySink`, `MemorySinkHandle` (`verbatimModuleSyntax: true`).

---

### 4. `src/memory/tools/record-observation.ts` — MCP tool handler

**Path:** `src/memory/tools/record-observation.ts`
**Closest analog:**
- **Entry shape:** `src/server.ts` lines 311–328 (`write_note` handler) — the wiring pattern from the SDK-validated args → `handleWriteNote(adapterRegistry, vault, p)`.
- **Service-function shape:** `src/adapters/delivery/obsidian-fs/index.ts:write()` (A3 lines 121–134) — `DeliveryAdapter.write(id, partial, opts)`. `record_observation` MUST route through this same call (so Guard A + Guard B fire centrally). It is **not** allowed to call `writeNoteInternal` directly.

**Pattern to lift:**
- Two exports: a Zod raw shape in `tool-registry.ts` (see §below for tool-registry edits) AND a handler function in this file.
- Handler signature: `handleRecordObservation(registry: AdapterRegistry, vault: Vault, args: RecordObservationArgs): Promise<RecordObservationResult>`.
- Argument shape: `{ vault, claim, evidence, confidence, type, sink?, properties? }` per CONTEXT.md D-02.
- Body: build `Partial<Document>` with `blocks: [{kind:"paragraph", text: claim}]` and `properties: { source: "agent", "observed-at": new Date().toISOString(), status: "active", confidence, evidence, type, ...properties }` (caller-supplied `properties` **last** so contract-allowed extras win over sugar defaults).
- DocId minting: caller mints via `formatDocId(scheme, authority, sink-resolved-resource-path)` — per ADR-002 single-resolver rule, the relative path is derived from `registry.resolveMemorySink(sink).resolveTo`, NOT by string concatenation in this handler.
- Result wrapping: identical to `handleWriteNote` — return the discriminated `WriteResult`; the `server.registerTool` wrapper at `src/server.ts:462–478` handles `ok(data)` vs `errorResponse(message)`.

**Tests (co-located):** `src/memory/tools/record-observation.test.ts`
- Pattern: copy `src/adapters/delivery/obsidian-fs/write.test.ts` lines 1–60 (vault fixture via `mkdtemp`, in-memory `Database`, `beforeEach`/`afterEach`).
- Cases: happy path (writes under default sink); explicit-sink path; missing required-arg → tool-schema rejection (Zod, in `tool-registry.test.ts`); contract-violation passthrough (validator rejection bubbles through identical to permission-denied).

**Constraints:**
- **No `fs`, no `path`, no `gray-matter`** — those imports are licensed only under `src/adapters/delivery/obsidian-fs/`. This handler talks only to the registry + the `DeliveryAdapter` interface.
- The tool **does NOT pre-validate** beyond required-arg presence (CONTEXT.md D-02): contract enforcement is the validator's job.

---

### 5. `src/memory/tools/recall.ts` — MCP tool handler

**Path:** `src/memory/tools/recall.ts`
**Closest analog:** `src/server.ts` lines 257–278 (`search_hybrid` handler) + `src/search/hybrid.ts` (the service). Recall is a scoped hybrid search that ONLY hits the memory sink, then post-filters by `min_confidence` / `types` / `max_age_days`, then sorts by `observed-at`-DESC (with `mtime` tiebreak), then truncates.

**Pattern to lift:**
- Handler signature: `handleRecall(registry, manager, args): Promise<RecallResult[]>` — argument shape `{ query, min_confidence?, types?, max_age_days?, sink? }` per CONTEXT.md D-01.
- Build a hybrid-search call against the resolved sink's vault, then apply a post-filter that reads `Document.properties` (NOT raw YAML — same as the validator).
- **Return the Phase-3 citation-packet shape from day one** (CONTEXT.md D-01): `{ doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties }[]`. Define this packet type in `src/types.ts` or `src/memory/packet.ts` so Phase 3 (ASM-05) can re-import it without a churn-rename.

**Tests (co-located):** `src/memory/tools/recall.test.ts`
- Pattern: same fixture-based test scaffold as `write.test.ts`; seed the in-memory vault with ~5 docs spanning `confidence`/`status`/`observed-at` dimensions, then assert filter + sort + truncation order.
- Add one cross-Phase-3 packet-shape conformance assertion: every result has all eight packet keys, even when optional ones are null/undefined.

**Constraints:**
- Same no-`fs` rule as §4. Routes through `registry.resolveSource(handle).readDocument(id)` for the property read after hybrid-search returns chunks.
- Sort tiebreak: `mtime` DESC — same chronological semantic as `recent_notes` (`src/server.ts:406–420`).

---

### 6. `src/memory/tools/supersede.ts` — MCP tool handler

**Path:** `src/memory/tools/supersede.ts`
**Closest analog:** `src/server.ts` lines 329–344 (`update_frontmatter` handler) → routes to `handleUpdateFrontmatter` → `src/frontmatter/update.ts`. Supersede is a single OCC frontmatter mutation on the OLD document.

**Pattern to lift:**
- Handler signature: `handleSupersede(registry, vault, args): Promise<UpdateResult>` — arg shape `{ doc_id, replacement_doc_id, reason }` per CONTEXT.md D-03.
- Forward-only: only the OLD doc is touched. Patch shape: `{ properties: { status: "superseded", "superseded-by": replacement_doc_id, "superseded-reason": reason } }`.
- Read-then-OCC: `registry.resolveSource(handle).readDocument(old_id)` → grab current `hash` → call `registry.resolveDelivery(handle).update(old_id, patch, { expectedHash })`.
- Wikilink-edge derivation (back-link) is **deferred to Phase 4** (CONTEXT.md D-03 + Deferred Ideas) — do NOT add link materialization here.

**Tests (co-located):** `src/memory/tools/supersede.test.ts`
- Pattern: copy `src/adapters/delivery/obsidian-fs/write.test.ts` style.
- Cases: happy-path supersede; OCC conflict (concurrent edit between read and update); supersede the same doc twice (status already `superseded` → planner picks: idempotent vs. error; analog `update_frontmatter` is idempotent for no-op merges, so default to idempotent).

**Constraints:**
- `superseded-reason` is **not yet in ADR-004's `default-memory-v1` contract** (CONTEXT.md Decisions §D-03 Note + Specifics). Phase 2 must EITHER extend the contract OR store the reason in the audit log only. Researcher proposes; planner picks. Default: extend the contract — it keeps the reason close to the doc and is a one-line addition.
- No `fs` / `path` imports. Routes through the `DeliveryAdapter`.

---

### 7. `src/memory/resources/memory-stats.ts` — MCP Resource handler

**Path:** `src/memory/resources/memory-stats.ts`
**Closest analog:**
- **No existing Resource handler in the codebase** — MEM-09 is the first. Phase 2 sets the convention.
- **Read-only-handler shape:** `src/server.ts` `handleListVaults` (lines 496–518) is the closest read-only aggregator — pulls per-vault stats by iterating `manager.list()`, returns a shaped object. `memory_stats` follows the same shape: iterate `registry.listMemorySinks()`, count docs per sink, return `{ sinks: [{ name, handle, doc_count, last_write_at, ... }], total }`.

**Pattern to lift:**
- Function signature: `readMemoryStatsResource(registry, manager): Promise<ResourceContents>` — the MCP SDK 1.29 `registerResource` API returns `{ uri, mimeType, text }`.
- URI scheme: **flat per CONTEXT.md Discretion** — `vault-memory://memory/stats` for the global stats; if planner picks nested-per-sink, `vault-memory://memory/sinks/<name>/stats`. Default: flat.
- MIME type: `application/json`.
- **Polled-only in v2.0.0** (CONTEXT.md Discretion + Deferred) — do NOT add `notifyResourceUpdated` plumbing.

**Tests (co-located):** `src/memory/resources/memory-stats.test.ts`
- Pattern: same vault fixture + in-memory DB setup as `write.test.ts`; seed N docs in `_memory/`; assert the stats roll-up matches.
- Snapshot the JSON output shape so the MEM-09 surface is pinned (snapshot pattern: `evals/v1-baseline/tools-list.snapshot.json` is the precedent for snapshotting MCP-surface shapes).

**Constraints:**
- The Resource registration happens in `src/server.ts` (extension); the handler logic lives here. Mirror the tool-handler / tool-registration split that already exists in Phase 1 (`handleListVaults` lives in `server.ts`, BUT Phase 2 should prefer the cleaner pattern: handler in its own module, register in `server.ts`).
- New SDK API: `server.registerResource(...)` per MCP SDK 1.29. Planner checks `node_modules/@modelcontextprotocol/sdk/.../mcp.js` for the exact signature; the `registerTool` pattern at `src/server.ts:462–478` is the closest precedent for SDK 1.29 idiom.

---

### 8. `src/memory/resources/list-sinks.ts` — MCP Resource handler

**Path:** `src/memory/resources/list-sinks.ts`
**Closest analog:** same as §7 — `handleListVaults` is the read-only-aggregator analog; no Resource precedent.

**Pattern to lift:**
- Function: `readListSinksResource(registry): Promise<ResourceContents>`. Body iterates `registry.listMemorySinks()`, returns `{ sinks: [{ name, handle, resolves_to, contract_id, is_default }], total }`.
- URI scheme: `vault-memory://memory/sinks` (flat, matches §7 choice).

**Tests (co-located):** `src/memory/resources/list-sinks.test.ts` — same shape as §7.

**Constraints:** same as §7. Pure read; no `Vault`, no DB — operates entirely on the in-memory registry.

---

### 9. EXT. `src/adapters/delivery/types.ts` — Extend `WriteConflict` for Phase 2 reason codes

**Path:** `src/adapters/delivery/types.ts` (edits to lines 77–87, plus header §"Memory-sink guard (Phase 2 hook)" lines 23–53 — promote it from a Phase-2-stub note into the live contract).

**Closest analog:** itself. The discriminated-union pattern at lines 77–87 is already established; Phase 2 extends the `reason` literal union and adds optional envelope fields.

**Pattern to lift:**
- Extend `WriteConflict.reason` from `"hash_mismatch" | "permission_denied" | "not_found"` to ALSO include: `"memory_sink_write_blocked" | "provenance_missing" | "agent_write_outside_sink" | "sentinel_missing" | "contract_violation"` (the planner picks the final set per CONTEXT.md Discretion — these are the canonical candidates).
- Add optional envelope fields: `sinkName?: string`, `missingKeys?: string[]`, `suggestion?: string` (e.g. `"use record_observation for _memory/"`).
- MEM-11 bar: each new reason MUST come with an actionable `message` that names the sink and (where applicable) the missing keys and the suggested tool.

**Tests:** assertions land in `src/adapters/delivery/conformance.test.ts` (§11 below) and in `src/memory/contract.test.ts` (§3).

**Constraints:**
- **Backwards-compatible.** v1 callers branching on `reason === "permission_denied"` must continue to work — keep the old reasons in the union, add new ones (no replacement, no rename).
- `verbatimModuleSyntax: true` — `import type { MemorySinkHandle }` is already in place at line 55; just keep it.

---

### 10. EXT. `src/adapters/delivery/obsidian-fs/write.ts` — sentinel-check on resolve + Guards invocation

**Path:** `src/adapters/delivery/obsidian-fs/write.ts` (and a small edit to `src/adapters/delivery/obsidian-fs/index.ts:write()`)

**Closest analog:** itself. The existing `write_enabled` check at lines 155–157 + the `permissionDenied()` factory at lines 94–100 are the shape Phase 2 mirrors for sentinel-missing failures.

**Pattern to lift:**
- Add `sentinelMissing(sinkName, absSinkDir)` factory next to `permissionDenied()` (lines 94–100). Returns the extended `WriteConflict` with `reason: "sentinel_missing"` + actionable `message: "MemorySink '${sinkName}' refuses to resolve: '.memory-sink' sentinel file is missing from ${path}. Create it (or recreate the sink) before retrying."`.
- The sentinel-check is **synchronous before any FS write**, ordered identically to the `write_enabled` check at line 155: refuse early, no rollback needed.
- **Where Guards A/B fire:** inside `src/adapters/delivery/obsidian-fs/index.ts:write()` (A3 lines 121–134), AT THE TOP, BEFORE the body/frontmatter extraction:
  ```ts
  // Phase 2: MemorySink guard
  const guardResult = checkProvenance(doc.properties ?? {}, opts?.sink, this.registry);
  if (!guardResult.ok) return guardResult; // {ok:false, reason, ...}
  // Phase 2: sentinel check (only when opts.sink is set)
  if (opts?.sink) {
    const ok = await assertSentinelExists(this.vault, opts.sink, this.registry);
    if (!ok) return sentinelMissing(...);
  }
  ```
- The sentinel-FS helper lives in **this file** (under `src/adapters/delivery/obsidian-fs/`) — that is the only directory where `fs` is licensed (per ADR-002 I-2/I-3 and the comment at `obsidian-fs/index.ts:7–9`).

**Tests (co-located):** extension of `src/adapters/delivery/obsidian-fs/write.test.ts`
- Add `describe("sentinel guard")` block. Cases: (a) sink with valid sentinel writes OK; (b) sink whose directory exists but lacks `.memory-sink` → `{ ok:false, reason:"sentinel_missing", message: /\.memory-sink/ }`; (c) sink whose directory does not exist at all → same `sentinel_missing` (the sentinel is the proof of intent).

**Constraints:**
- This file is the **only** legitimate home for `fs.access(".memory-sink")` / sentinel writes — CI grep verifies no other file imports `node:fs` to read `.memory-sink`.
- Sentinel write (when a new sink is created) is a separate function (`createMemorySink`) — Phase 2 ships it but the trigger is the TOML-loader → registry registration path at server bootstrap, not user-facing.

---

### 11. EXT. `src/adapters/delivery/conformance.test.ts` — Guards A/B + sentinel conformance assertions

**Path:** `src/adapters/delivery/conformance.test.ts` (append cases 11+, follow the existing numbered convention at lines 78–260)

**Closest analog:** itself. The `describe.each(adapters)` parametric pattern at line 77 is the floor; new cases plug into it.

**Pattern to lift:**
- Add cases 11–14 inside the `describe.each` block:
  - **Case 11:** Guard A — write with `properties.source = "agent"` but missing required keys → `{ ok: false, reason: "provenance_missing", missingKeys: [...] }`.
  - **Case 12:** Guard B — write with `properties.source = "agent"` and NO `opts.sink` (or sink unconfigured) → `{ ok: false, reason: "agent_write_outside_sink" }`.
  - **Case 13:** Guards bypass — write with `properties.source = "user"` succeeds regardless of sink configuration (Guard B only triggers on `source: "agent"` per CONTEXT.md Specifics).
  - **Case 14:** Capability-gated — the StubDelivery may publish a new `enforcesMemoryGuards: true` capability bit (planner's call) and the conformance suite gates assertions on it.
- For sentinel-missing: that's filesystem-specific, **stays in the adapter-specific block at lines 267–294** (the "ObsidianFsDelivery — filesystem invariants" describe).

**Constraints:**
- Stub must implement Guards A/B identically so the parameterized suite passes for both adapters — this proves Guards live in the **interface contract**, not the obsidian-fs implementation. Planner adds the Guards call to `src/adapters/stub/delivery.ts:62–80` (the `StubDelivery.write` method).

---

### 12. EXT. `src/write/write.ts` + `src/frontmatter/update.ts` — Guard A entry-point refusals (MEM-07)

**Paths:**
- `src/adapters/delivery/obsidian-fs/write.ts` (the legacy v1 `writeNote` / `deleteNote` are re-exported from `obsidian-fs/index.ts:50–58`; that file is at `src/adapters/delivery/obsidian-fs/write.ts` — see lines 150–157 for the `write_enabled` check, the model for the Guard A entry refusal).
- `src/frontmatter/update.ts` (lines 39–57 declare `UpdateFrontmatterInput`; lines further down do the merge).

**Closest analog:** the `write_enabled` check pattern at `obsidian-fs/write.ts:155–157` (and similarly at `:274–276` for delete).

**Pattern to lift:**
- At the top of `writeNote()` / `deleteNote()` / `updateFrontmatter()`, **before the existing `write_enabled` guard**, add a check: if the resolved relative-path lands under any configured `MemorySink` (looked up via the registry — single-resolver rule), refuse with `{ ok: false, reason: "memory_sink_write_blocked", suggestion: "use record_observation/supersede for sink '<name>'" }`.
- This Guard A entry-point check exists IN ADDITION to the centralized validator at `DeliveryAdapter.write()` — belt-and-suspenders. The centralized validator is the single source of truth; the entry-point check exists to give the v1 tools a clean, structured error before they touch any state.
- **Single-resolver rule reminder:** the entry-point check MUST call `registry.findSinkContaining(relativePath)` (a new method — add to §2 above). It must NOT do its own folder-prefix matching.

**Tests:** assertions land in `src/adapters/delivery/obsidian-fs/write.test.ts` (extension) and a new test file `src/frontmatter/update.test.ts` (or extension of existing). The MEM-11 targeted test ("naive `write_note` to memory-sink-resolved path is rejected with a clear, structured error") lives in `src/adapters/delivery/obsidian-fs/write.test.ts` — pattern is the existing "write_enabled=false → permission_denied" case (already present in the file around line 60+).

**Constraints:**
- v1 tools take an optional `registry?: AdapterRegistry` param (already the case in `frontmatter/update.ts:39–47`) — the Guard A check is **skipped** when no registry is provided (preserving v1 standalone test paths). The MCP server always supplies the registry, so production paths are always guarded.
- v1 `write_note` against a regular non-sink note continues to behave identically (per CONTEXT.md `canonical_refs` §"Phase 1 outputs to consume directly" line 102).

---

### 13. EXT. `src/audit/audit.ts` + `src/db/queries/audit.ts` + `src/db/schema.ts` — MEM-08 memory-sink discriminator

**Paths:**
- `src/db/schema.ts` — add `MIGRATION_005` (or next index) that adds a `kind TEXT` column to `write_audit` (NULL for v1 rows, `"memory-sink-write"` for new ones).
- `src/db/queries/audit.ts` — extend `RecordWriteInput` (lines 19–27) and `ListWritesFilter` (lines 29–34) with the new `kind` field.
- `src/audit/audit.ts` — extend `AuditLogEntry` (lines 19–35) and `GetAuditLogInput` (lines 52–59) and the row→entry mapper (lines 89–104) to propagate `kind`.

**Closest analog:** `src/db/schema.ts:200–247` — the MIGRATION_003 table-rebuild pattern (`CREATE TABLE write_audit_new` → `INSERT INTO ... SELECT ...` → `DROP TABLE write_audit` → `RENAME`). However, since this is a pure column-add (no FK changes), the planner can pick the simpler `ALTER TABLE write_audit ADD COLUMN kind TEXT` migration — SQLite supports that since 3.35.

**Pattern to lift:**
- Migration: prefer `ALTER TABLE write_audit ADD COLUMN kind TEXT DEFAULT NULL; CREATE INDEX IF NOT EXISTS idx_write_audit_kind ON write_audit(kind) WHERE kind IS NOT NULL;` (partial index — only the memory-sink rows are indexed; v1 rows are cheap to ignore).
- Queries: add `kind` to the prepared `INSERT` at `audit.ts:67–70` and to the `where` builder at `:118+`.
- `getAuditLog` filter: `kind: "memory-sink-write" | "user-write" | undefined` — undefined = include all (default).

**Tests:** co-located extension of `src/audit/audit.test.ts`. Pattern at lines 1–60 of that file. Seed audit rows with both `kind` values, assert filtering.

**Constraints:**
- Backwards-compat: existing v1 audit_log tool still returns identical shape when no `kind` filter is set. Snapshot test (`evals/v1-baseline/`) must remain green — `kind: null` is the new field on the returned row; v1 baseline assertions either ignore extra keys or the planner snapshots a v2 baseline.

---

### 14. `evals/fixtures/v2-test-vault/_memory/` — ~20-doc fixture (MEM-10)

**Path:** `evals/fixtures/v2-test-vault/_memory/` (subdirectories per recommended structure: `observations/`, `briefs/`, …) + `.memory-sink` sentinel files.

**Closest analog:** the sibling `evals/fixtures/v2-test-vault/{decisions,meetings,people,projects}/` directories — same authoring style (markdown + YAML frontmatter), same Atlas Robotics fictional universe.

**Pattern to lift:**
- 20 docs spanning the provenance dimensions (CONTEXT.md Claude's Discretion §MEM-10 fixture scope):
  - `source`: `agent` (majority) + `user` (a few for Guard B testing — these are user-authored memory notes, allowed)
  - `confidence`: spread across `0.3` / `0.6` / `0.8` / `0.95`
  - `status`: mostly `active`, at least one `superseded` + its replacement
  - `observed-at`: spread across last 90 days
  - `type` enum: cover all values in the contract
- **One A → B → C supersede chain** (CONTEXT.md Recommendation) — so Phase 4 graph layer has real data.
- **Fixture vault stays clean** — malformed docs go in a separate `tests/fixtures/malformed-memory/` tree (CONTEXT.md Recommendation).
- Include `.memory-sink` sentinel files in each sink subdir.

**Tests:** the eval suite (`evals/v1-baseline/` and any new `evals/v2/memory.*`) consumes this fixture. Per CONTEXT.md `<constraints>` — eval harness consumes `Document` objects from Phase 3 onward, but Phase 2's targeted-rejection test (MEM-11) can be a direct vitest at `src/adapters/delivery/obsidian-fs/write.test.ts`.

**Constraints:**
- v1 baseline must remain green when this fixture lands — `_memory/` may need to be excluded from the v1 evaluation scope, or v1 evals need to tolerate the new tree. Planner picks.

---

### 15. (OPTIONAL) `src/memory/contracts/loader.ts` + `_contracts/memory/default-memory-v1.yaml`

**Decision:** CONTEXT.md Claude's Discretion — ship YAML loader OR hardcode the `default-memory-v1` contract in `src/memory/contract.ts` and defer YAML to Phase 5/6. **Recommended default: defer.** Phase 2 has enough surface; deferring is a one-day option later.

**If shipped, path:** `src/memory/contracts/loader.ts`
**Closest analog:** `src/config/loader.ts` (entire file, especially lines 16–80) — Zod validation discipline, `ENOENT` fallback to a default, TOML-parse-then-validate flow. The only swap is `smol-toml.parseToml` → a YAML parser (the planner picks; `yaml` package is the default for Node.js ESM and zero new heavy deps).

**Pattern to lift, if shipped:**
- Same shape as `loadConfig`: `loadMemoryContract(path): Promise<MemoryContract>` with `ENOENT → DEFAULT_CONTRACT` fallback, Zod schema validation, parse error wrapped in a `Failed to parse YAML at ${path}` error message (lines 67–69 of `config/loader.ts`).
- Cache strategy: revalidate every write is too expensive at scale; cache with mtime/inode check is the right call but adds chokidar coupling. **If shipping the loader, pick cache-with-mtime-check** and add a single-line dependency on the existing watcher's filesystem-event seam — but no new chokidar instance.

**Constraints:** if shipped, add to ADR-004 §"Hard-isolation question" sequel + amend the MEMORY_CONTRACT.md doc.

---

### 16. Co-located `*.test.ts` for every new module

All Phase 2 modules ship their `*.test.ts` sibling in the same PR (per CONTEXT.md `<constraints>` — "324 tests, do not regress; every new tool ships unit tests in the same PR").

**Pattern:** Vitest co-location — `module.ts` + `module.test.ts` in the same directory. The framework imports at the top of `module.test.ts` are always:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
```
Reference test files for each pattern:

| Pattern | Reference test file |
|---|---|
| Pure-function unit tests (parser, validator) | `src/adapters/registry.test.ts` (lines 21–80) |
| Vault-fixture tests (DB + fs) | `src/adapters/delivery/obsidian-fs/write.test.ts` (lines 1–60) |
| Audit / DB integration tests | `src/audit/audit.test.ts` (lines 1–60) |
| Cross-adapter conformance | `src/adapters/delivery/conformance.test.ts` (lines 77–261) |
| Tool-registry shape tests | `src/tool-registry.test.ts` |

---

## Cross-cutting (every Phase 2 file MUST follow these)

These conventions are non-negotiable per the project CLAUDE.md, `.planning/codebase/CONVENTIONS.md`, and `tsconfig.json`. The pattern map above presumes them silently for every file; gather them here so they are uniformly enforceable in PR review.

| Convention | Concrete rule | Enforcement |
|---|---|---|
| **ESM-only** | `"type": "module"` in `package.json`. Every relative import uses the `.js` extension in source — even when the file is `.ts`. Example: `import { parseDocId } from "../adapters/registry.js";` | `tsconfig.json` `moduleResolution: "Bundler"` |
| **kebab-case filenames** | `record-observation.ts`, `record-observation.test.ts`, `memory-stats.ts`. Never `recordObservation.ts`. | CLAUDE.md `## Conventions §Naming Patterns` |
| **camelCase functions** | `parseMemorySinkHandle`, `checkGuardA`, `handleRecordObservation`. | Same |
| **PascalCase types** | `MemorySink`, `MemoryContract`, `RecordObservationArgs`, `GuardResult`. Zod schemas: `MemoryContractSchema`, `RecordObservationArgsSchema`. | Same |
| **`verbatimModuleSyntax: true`** | Type-only imports MUST use `import type`. Mixed value+type imports use a separate `import type {...}` line. | `tsconfig.json` |
| **`noUncheckedIndexedAccess: true`** | `Map.get(handle)`, `array[0]`, `obj[key]` return `T \| undefined`. Always check before destructuring (the `if (!a) throw` pattern at `registry.ts:144–149` is the canonical shape). | `tsconfig.json` |
| **Vitest co-location** | `module.ts` + `module.test.ts` in the same directory. No `tests/` parallel tree. | `.planning/codebase/TESTING.md` |
| **Seam preservation (CI greps)** | `chokidar`, `node:fs`, `node:path`, `gray-matter`, the literal string `obsidian://` are licensed ONLY inside `src/adapters/`. New Phase 2 modules MUST NOT introduce any of these imports outside `src/adapters/delivery/obsidian-fs/`. | CI grep; ADR-002 I-1..I-7; CLAUDE.md `## Constraints` |
| **Single-resolver rule** | The registry (`src/adapters/registry.ts` for handles; `src/memory/registry.ts` for sinks) is the SOLE resolver. No folder-path matching anywhere else, no string-prefix matching outside the handle parser. | ADR-002 §Registry; ADR-004 §Resolution; CLAUDE.md `## Constraints` |
| **Discriminated unions for write results** | Every write/update operation returns `{ ok: true; ... } \| { ok: false; reason: ...; message?: string; ... }`. Branch on `.ok` before destructuring. (Pattern from `src/adapters/delivery/types.ts:62–104`.) | Same |
| **Zod for input validation** | All MCP tool args + all config loaders + all contract loaders go through Zod. Pattern: `src/config/loader.ts:16–37` (config) + `src/tool-registry.ts:482–616` (tool args). | Same |
| **`Document.properties`, not raw YAML** | Provenance validators, sink checks, recall filters read `Document.properties: Record<string, unknown>`. They do NOT call `gray-matter`. | ADR-003 + ADR-004 |
| **No partial features** | Every Phase 2 module ships its test in the same PR. No `// TODO:` comments for in-scope behavior. | CLAUDE.md `## Implementation Completeness` |
| **Backwards-compat with v1.x API** | Existing 23 tools keep their shape. New tools get new names. Extended unions (e.g. `WriteConflict.reason`) ADD literals; they do not remove or rename existing ones. | CLAUDE.md `## Constraints` |
| **Sacrosanct memory namespace** | The validator at `DeliveryAdapter.write()` is the single source of truth. Entry-point Guards on v1 tools (§12) are a defense-in-depth layer, NOT a replacement. | ADR-004; CLAUDE.md `## Constraints` |
| **Eval discipline** | Any retrieval/assembly change runs the eval suite. Phase 2's `recall` tool is the first new retrieval surface — add at least one eval-style behavior test that consumes the `_memory/` fixture. | CLAUDE.md `## Constraints` |
| **Branch hygiene** | Phase 2 work lands on `phase-2-<slug>` off main; per-deliverable PRs onto the phase branch; main merge only at phase sign-off. | CLAUDE.md `## Constraints` |
