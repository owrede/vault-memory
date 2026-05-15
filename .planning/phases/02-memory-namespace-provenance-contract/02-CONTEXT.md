# Phase 2: Memory namespace & provenance contract - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the single non-negotiable safety invariant of v2: **agent writes go only to a labeled `MemorySink` with mandatory provenance properties, centralized at the `DeliveryAdapter.write()` chokepoint.**

Concretely, Phase 2 lands:
1. **MemorySink runtime** — per-vault `[memory]` + `[[memory_sinks]]` config; `MemorySink` handle parser (`obsidian-fs://<vault>/<path>`); `.memory-sink` sentinel file written at sink creation; refuse to resolve against a folder lacking the sentinel.
2. **Registry methods** — `listMemorySinks()`, `resolveMemorySink(nameOrHandle)`, `getDefaultMemorySink()` per ADR-004 §Resolution.
3. **Three new MCP write/read tools** — `record_observation`, `recall`, `supersede` (MEM-02 / MEM-03 / MEM-04).
4. **Centralized provenance validator** at `DeliveryAdapter.write()` — Guard A (memory-sink writes need contract-required provenance keys) + Guard B (`source: agent` writes outside any configured sink rejected). Validator operates on `Document.properties`, never on raw YAML.
5. **Guards on existing v1 tools** — `write_note` / `update_frontmatter` / `delete_note` refuse memory-sink targets and refuse `source: agent` outside any sink (MEM-07).
6. **`audit_log` distinct flag** for memory-sink writes (MEM-08, filterable).
7. **MCP Resources** — `memory_stats` and `list_sinks` promoted from MCP tools to MCP Resources (MEM-09), cutting v2.0.0 tool surface.
8. **Eval fixture** — ~20-document `_memory/` subset in Atlas Robotics fixture with diverse provenance labels (MEM-10).
9. **Targeted rejection test** — naive `write_note` to a memory-sink-resolved path is rejected with a clear, structured error (MEM-11).
10. **ADR-004 amendment** — folder-default sink as the only code path; separate-vault is a config-only choice (MEM-12; the recommended-default has already been adopted by ADR-004 in Phase 0).

Phase 2 is the safety floor every subsequent v2 phase rests on. Phases 3 (bundles), 4 (graph), 5 (briefs), 6 (contracts) all assume an agent cannot silently mutate user notes.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-15): exactly **one** gray area was discussed — *tool surface & ergonomics* — with four decisions below. Everything else falls under **Claude's Discretion**, anchored by ADR-004, MEM-01..12, and the centralized-validator architecture already wired into `src/adapters/delivery/types.ts` (Phase 1 §"Memory-sink guard (Phase 2 hook)"). Maintainer retains veto in PR review.

### Tool Surface & Ergonomics

- **D-01: `recall` returns the Phase-3 citation-packet shape from day one.**
  MEM-03 spec is `recall({query, min_confidence, types, max_age_days, sink?})`. The return shape is `{ doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties }[]` — the same packet Phase 3 (ASM-05) will use on every assembly result. Rationale: avoids a breaking shape-change between v2.0.0 minor versions; agents can pin/cite memory entries identically to bundles. `properties` includes the contract-required keys (`source`, `confidence`, `status`, `observed-at`, `evidence`, plus any contract-allowed extras the doc carries). Sorting is recency-descending by `observed-at` (then `mtime` as tiebreak); filtering by `min_confidence`, `types`, `max_age_days` is applied before the result limit.

- **D-02: `record_observation` accepts a freeform `properties: Record<string, unknown>` escape hatch.**
  Spec becomes `record_observation({claim, evidence, confidence, type, sink?, properties?: Record<string, unknown>})`. The canonical args are sugar — they prefill the contract-required keys (`source` defaults to `"agent"`, `observed-at` to now, `status` to `"active"`). `properties` merges in last and lets callers populate any contract-allowed field (e.g., `expires-at`, `tags`, future contract additions) without bumping the tool shape. The **MemoryContract validator at `DeliveryAdapter.write()` is the single source of truth** for what's allowed — record_observation does NOT pre-validate beyond required-args presence. Unknown properties that the contract rejects produce the same structured error as any other guard failure.

- **D-03: `supersede` is forward-only — no back-link written on the replacement.**
  MEM-04 spec is `supersede({doc_id, replacement_doc_id, reason})`. The implementation marks the OLD document with `status: superseded` + `superseded-by: <replacement_doc_id>` + a `superseded-reason: <reason>` property (chosen by us to preserve the reason without polluting the contract — see Note below). The NEW document is **not touched**. Phase 4 (graph-as-retrieval, GRA-04) will compute back-edges from forward edges at query time — no need to materialize back-links in document properties. Atomically a single OCC write; no race with a freshly-written replacement.
  - **Note on `superseded-reason`:** ADR-004's `default-memory-v1` contract does not currently list `superseded-reason`. Researcher should propose extending the contract spec (or storing the reason in the audit log only). Planner picks the resolution; maintainer reviews.

- **D-04: `record_observation` + `supersede` stay as separate primitives. No composite tool.**
  Common workflow ("record new contradicting observation, mark old as superseded") is done by the caller as two MCP calls: `new_id = record_observation(...); supersede(old_id, new_id, reason)`. Rationale: MEM-09 is explicitly trying to **cut** the v2.0.0 tool surface (promoting list-style ops to Resources); adding a `record_and_supersede` composite would move in the opposite direction. Two roundtrips are cheap, semantics are unambiguous, and failure mode is clean (if the supersede call fails, the new observation still exists and can be supersede'd later by a manual call). Phase 6 (briefs) or Phase 5 may revisit if real-world agent usage proves the chaining is too painful.

### Claude's Discretion

Four implementation areas were deliberately **not discussed**. Researcher + planner choose, anchored by ADR-004 + MEM-01..12 + Phase 1 outputs. Maintainer reviews in PR.

- **Error-shape contract for guard rejections (Guard A / Guard B / sentinel-missing / contract-violation).** Phase 1 returns `{ ok: false, reason: "permission_denied" }` (string union) for write failures. Phase 2 must satisfy MEM-11's "clear error message" bar for naive writes hitting a memory-sink-resolved path. The planner picks whether to:
  - extend the existing discriminated union with new `reason` codes (`memory_sink_write_blocked`, `provenance_missing`, `agent_write_outside_sink`, `sentinel_missing`) and richer envelope fields (`sink_name?`, `missing_keys?`, `suggestion?`), or
  - emit a structured MCP error (isError:true with code), or
  - both (tool-result shape for v1 tools, MCP error for new tools).
  Constraint: error messages must be **actionable** — an agent reading the error should know exactly which sink it tried to write to, what property keys are missing, and what tool to call instead (e.g., "use `record_observation` for `_memory/`"). The Phase 1 `WriteResult` discriminated union (`src/adapters/delivery/types.ts`) is the surface to evolve.

- **MemoryContract loading + caching strategy.** ADR-004 §MemoryContract says contracts live in code or in `_contracts/memory/<name>.yaml` (Phase 2 deliverable). The planner decides:
  - Ship Phase 2 with only the hardcoded `default-memory-v1` contract (defer YAML loader to Phase 5 or 6 when contracts proliferate), or
  - Implement the YAML loader now with a single shipped `_contracts/memory/default-memory-v1.yaml` file.
  Module location is also discretionary (`src/memory/contracts/`, `src/adapters/contracts/`, or extension of `src/adapters/registry.ts`). If YAML loading ships, define the cache strategy: revalidate every write (expensive but safe) vs cache with mtime/inode check (faster, requires watcher integration). Researcher should consult the existing `src/config/loader.ts` for the TOML loading pattern and apply the same `zod` validation discipline.

- **MEM-10 fixture scope, provenance dimensions, and edge cases.** Need ~20-doc `_memory/` subset in Atlas Robotics fixture with diverse provenance labels. Planner decides:
  - Which provenance dimensions to cover (source × confidence × status × age, observation `type` enum coverage, or both).
  - Whether to include deliberately malformed docs (missing provenance keys, wrong-type values) inside the fixture vault — or keep the fixture clean and put malformed inputs in a separate `tests/fixtures/malformed-memory/` tree (cleaner separation, but loses the "what should the eval suite tolerate?" signal). **Recommendation:** keep fixture vault clean; put malformed inputs in a separate test fixture.
  - Whether to include a multi-step supersede chain (A → B → C) so Phase 4's graph layer has real data to traverse later. **Recommendation:** yes, at least one A → B → C chain.

- **MCP Resources URI scheme for `memory_stats` + `list_sinks`.** MEM-09 promotes both from MCP tools to MCP Resources. Planner picks:
  - URI scheme — `vault-memory://memory/sinks` + `vault-memory://memory/stats` (flat, one resource per concern) vs `vault-memory://memory/sinks/<name>/stats` (nested, per-sink stats). The flat scheme is simpler; the nested scheme avoids forcing clients to fetch all stats when they care about one sink.
  - Whether resources are subscribable (`notifyResourceUpdated` when sink contents change) for v2.0.0 — or polled-only as a Phase-5/6 follow-up. Subscriptions are a new feature axis; the planner should default to **polled-only** in v2.0.0 unless adding subscriptions is trivially small given Phase 1's MCP SDK 1.29 wiring.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 2 specs (lock the interfaces + invariants)
- `docs/v2/adr/004-memory-sink-handles.md` — full `MemorySink` handle shape; `.memory-sink` sentinel file rule; `MemoryContract` schema (`default-memory-v1`); Guards A & B logic; folder-default vs separate-vault; resolver semantics (registry is the only resolver). **Read in full before planning.**
- `docs/v2/adr/001-document-identity.md` — opaque URI-style `DocId`; `obsidian-fs://<vault>/<path>` examples; canonical-serialization rule I-6 (relevant for sink-handle parsing)
- `docs/v2/adr/002-adapter-seams.md` — `DeliveryAdapter.write()` interface and capability types (`hashProtected` enum, `DeliveryCapabilities`); Invariants I-1..I-7 (memory-sink writes still must satisfy I-2/I-3 — no fs/path imports outside adapter dir); registry shape including `listMemorySinks` / `resolveMemorySink` / `getDefaultMemorySink` methods to add (additive per ADR-004 §Resolution)
- `docs/v2/adr/003-document-shape.md` — `Document.properties: PropertyBag` (where provenance keys live); H-1..H-6 hash semantics (a memory-sink write produces a new hash like any other write — no special hash path); `source_hashes` chunk-level schema (referenced for any compiled-brief consumer in Phase 5)
- `docs/v2/MEMORY_CONTRACT.md` — `PropertyBag` provenance contract (`source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`); the human-readable companion to ADR-004's contract schema
- `docs/v2/ARCHITECTURE.md` — L2 (memory) layer placement; informs where new modules land (`src/memory/`, `src/adapters/registry.ts` extensions)
- `docs/v2/AGENT_AGNOSTIC.md` — MCP-as-canonical-interface stance; constrains MEM-09 Resources design (must work for non-Claude clients too)

### Requirements / roadmap / state
- `.planning/REQUIREMENTS.md` lines 47–59 — MEM-01..MEM-12 (precise deliverable list for Phase 2)
- `.planning/REQUIREMENTS.md` §"Out of Scope" lines 172–193 — especially "Silent agent writes anywhere in the user's notes" (the safety invariant Phase 2 enforces), "Memory sinks resolved by path matching" (handle parser is the only resolver — MEM-01), and the Notion deferral (Phase 10 / v3.0.0)
- `.planning/ROADMAP.md` lines 78–87 — Phase 2 goal + 5 success criteria (the WHAT this phase must achieve)
- `.planning/STATE.md` — current position post-Phase-1; adapter seams live; `MemorySinkHandle` type exists; `DeliveryAdapter.write()` guard hook reserved; non-blocking chokidar flake resolved by `test.retry(1)` (do NOT regress)
- `.planning/PROJECT.md` — full v2 mission; the memory-namespace-as-sacrosanct line is the single non-negotiable safety invariant

### Phase 1 outputs to consume directly
- `src/adapters/delivery/types.ts` — Phase 1 reserved the Memory-sink guard slot inside `DeliveryAdapter.write()`; Guards A & B insert here. Header comment (§"Memory-sink guard (Phase 2 hook)") is the contract Phase 2 honors.
- `src/adapters/registry.ts` — Phase 1 registry; Phase 2 adds `listMemorySinks` / `resolveMemorySink` / `getDefaultMemorySink` methods + `MemorySink[]` map. Branded-DocId minting pattern at lines 11–20 is the model for `MemorySinkHandle` minting (no escape-hatch leaks).
- `src/adapters/delivery/obsidian-fs/` — Phase 1 obsidian-fs delivery; Phase 2 adds sentinel-write on sink creation, sentinel-check on every `write()` against a sink-resolved path.
- `src/adapters/delivery/conformance.test.ts` — Phase 1 conformance suite; Phase 2 extends it with memory-sink-write conformance assertions (every DeliveryAdapter must enforce Guards A & B; StubDelivery satisfies the same contract).
- `src/audit/audit.ts` — Phase 1 audit log; MEM-08 adds a `kind: "memory-sink-write"` discriminator (or equivalent) so audit consumers can filter.
- `evals/fixtures/v2-test-vault/_memory/` — Phase 0 placeholder; Phase 2 fills with 20-doc subset per MEM-10.
- `evals/v1-baseline/` — Phase 2 must keep green; the new memory tools and the v1 write tools (with new Guards A/B) must NOT regress any baseline assertion. Specifically: existing v1 `write_note` against a regular note (no `source: agent`) is still allowed and must produce identical results.

### Phase 0 outputs to consume directly
- `docs/v2/adr/README.md` — MADR-style index; ADR-004 is Accepted; cross-referenced from REQUIREMENTS.md
- `docs/v2/adr/ADVERSARIAL-REVIEW.md` — 10 findings; especially Finding 9 (`__adapter_<scheme>_*` private tables — if Phase 2 needs an adapter-private memory-sink lookup table, this is the licensed shape)
- `docs/v2/SIGN-OFF.md` — Phase 0 maintainer sign-off; everything below the line is Phase 2's licensed substrate

### Codebase maps (read for Phase 2 mechanics)
- `.planning/codebase/ARCHITECTURE.md` — current layer model + module responsibilities; new `src/memory/` (or equivalent) sits at L2 per ARCHITECTURE.md
- `.planning/codebase/STRUCTURE.md` — directory layout + naming conventions + "Where to Add New Code" recipes
- `.planning/codebase/CONVENTIONS.md` — ESM + `.js` extension, kebab-case, TOML for config, `zod` validation, type-checking-is-the-linter
- `.planning/codebase/TESTING.md` — vitest layout; memory-tool unit tests co-located; conformance suite extension lives in `src/adapters/delivery/conformance.test.ts`
- `.planning/codebase/INTEGRATIONS.md` — Ollama/ONNX/chokidar; no new integrations for Phase 2
- `src/config/loader.ts` — TOML + Zod loading pattern; reference implementation if a YAML loader for `_contracts/memory/<name>.yaml` is added (Claude's Discretion area)
- `src/server.ts` tool registry — Phase 1 extracted `src/tool-registry.ts`; Phase 2's 3 new tools register there; the 2 promoted Resources (`memory_stats`, `list_sinks`) register via the SDK 1.29 Resource API
- `src/write/write.ts` + `src/frontmatter/update.ts` — Phase 1 existing v1 tool implementations; Phase 2 adds Guard A/B refusal at their entry (MEM-07); they delegate to `DeliveryAdapter.write()` where the centralized validator lives

### External references
- MCP SDK 1.29 Resource API — needed for MEM-09 (`memory_stats`, `list_sinks` as Resources); planner consults the official MCP SDK docs for `setRequestHandler(ListResourcesRequestSchema, ...)` / `setRequestHandler(ReadResourceRequestSchema, ...)` patterns OR the newer `registerResource(...)` API if 1.29 exposes it
- ADR-004 §"Hard-isolation question" (lines 187–210) — recommendation defaults to folder-with-config-option; MEM-12 ratifies this in Phase 2; folder-default is the only code path

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`DeliveryAdapter.write()` guard hook** (`src/adapters/delivery/types.ts` header comment §"Memory-sink guard (Phase 2 hook)") — Phase 1 explicitly reserved this entry point for Phase 2's Guards A & B. The signature is stable; Phase 2 inserts logic, not interface.
- **`MemorySinkHandle` type** (referenced in `src/adapters/delivery/types.ts` import) — Phase 1 stub-declared the type; Phase 2 wires it to the registry.
- **Branded-DocId minting pattern** (`src/adapters/registry.ts` lines 11–20) — IIFE-encapsulated brand-cast with no escape-hatch leak. `MemorySinkHandle` follows the same pattern.
- **`zod` validation discipline** (used everywhere — `src/config/loader.ts`, `src/server.ts` tool input schemas) — the MemoryContract YAML (if loaded) is validated through the same pattern.
- **`src/audit/audit.ts`** — existing audit log infrastructure; MEM-08 extends the row shape with a memory-sink discriminator.

### Established Patterns
- **Single-resolver rule per handle type** (Phase 1, ADR-002 §Registry) — the registry is the ONLY resolver. Phase 2's `MemorySink` resolution must follow this: no folder-path matching anywhere outside the handle parser.
- **Discriminated-union write results** (`{ ok: true, doc_id, hash }` vs `{ ok: false, reason }`) — Phase 1 established this in `src/adapters/delivery/types.ts`. Phase 2 extends the union, does not replace it.
- **`MEMORY_CONTRACT.md` provenance keys live in `Document.properties`, not raw YAML** — Phase 1 established the `PropertyBag` shape (ADR-003); Phase 2 validates against properties.
- **Conformance suite as the cross-adapter contract surface** (`src/adapters/delivery/conformance.test.ts`) — every DeliveryAdapter (obsidian-fs + StubDelivery + future notion-api) must pass the same memory-sink guard tests.
- **Vitest co-location** — `*.test.ts` next to source files; new modules follow this.

### Integration Points
- **`DeliveryAdapter.write()` entry** (`src/adapters/delivery/obsidian-fs/write.ts` + `src/adapters/delivery/stub/`) — Guards A & B insert here; validator is invoked once, centrally.
- **`src/server.ts` tool registry / `src/tool-registry.ts`** — three new MCP tools (`record_observation`, `recall`, `supersede`) register here; two new MCP Resources (`memory_stats`, `list_sinks`) register through the SDK 1.29 Resource API.
- **`src/write/write.ts:writeNote()` + `src/frontmatter/update.ts:updateFrontmatter()` entries** — MEM-07 inserts the Guard A check at these entry points (before delegation to `DeliveryAdapter.write()`).
- **`src/audit/audit.ts:appendWrite()`** — MEM-08 adds a `kind: "memory-sink-write"` (or equivalent discriminator) for filtering.
- **`evals/fixtures/v2-test-vault/_memory/`** — MEM-10 fills this directory.
- **`evals/v1-baseline/baseline.test.ts`** — must continue to pass; v1 `write_note` against a regular note still works after Guards A & B land.

</code_context>

<specifics>
## Specific Ideas

- **Citation-packet shape is shared with Phase 3.** The exact field list `{ doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties }` is the same one ASM-05 will require. If Phase 3 introduces additional packet fields, `recall` SHOULD adopt them in the same minor version — but for v2.0.0 these eight are the floor.
- **`source: agent` is the trigger for Guard B.** The validator looks for `properties.source === "agent"` specifically. Other source values (`user`, `imported`) bypass Guard B (a user-authored memory note has no business in `_memory/` by Guard A's logic, but Guard B does not apply). Researcher should validate this matches ADR-004's intent.
- **`supersede` writes `superseded-reason` alongside `superseded-by`.** Not in ADR-004's current `default-memory-v1` contract. Researcher should propose either: (a) extend the contract with `superseded-reason: string`, or (b) store the reason in the audit log only and keep `Document.properties` clean. Planner picks; maintainer reviews.

</specifics>

<deferred>
## Deferred Ideas

- **Subscribable MCP Resources (`notifyResourceUpdated`)** for `memory_stats` / `list_sinks` — Phase 2 defaults to polled-only unless trivially small. Subscription support tracked as a Phase-5/6 polish item.
- **`record_and_supersede` composite tool** — explicitly rejected for Phase 2 (cuts against MEM-09's tool-surface reduction). Revisit in Phase 5 (briefs) or Phase 6 (contracts) if real agent usage proves chaining painful.
- **MemoryContract YAML loader** — may ship in Phase 2 (Claude's Discretion) OR defer to Phase 5/6 when more contracts exist. Tracked here so it isn't lost.
- **Back-link materialization on supersede** — Phase 2 is forward-only. Phase 4 (graph-as-retrieval, GRA-04) derives back-edges from forward links at query time. If query-time derivation proves too slow, Phase 4 may revisit; do not retrofit in Phase 2.
- **Per-sink stats subscription** — same as first item, scoped per-sink rather than global.
- **Notion adapter memory-sink support** — out of v2 scope. Tracked in `docs/v2/adr/NOTION-ADAPTER-PLAN.md` for v3.0.0. The interface shape (MemorySink handle, contract validator) already accommodates it; v3 just adds the notion-api DeliveryAdapter implementation.

</deferred>

---

*Phase: 02-memory-namespace-provenance-contract*
*Context gathered: 2026-05-15*
