# Pitfalls Research — vault-memory v2 (Agentic Knowledge Layer)

**Domain:** Agentic memory layer over Obsidian via MCP, with adapter seams prepared for v3 multi-source (Notion)
**Researched:** 2026-05-14
**Confidence:** HIGH (the 12 pitfalls below are derived directly from the v2 brief's risks, the v1 codebase's known concerns audit, ADRs 001–004, and 2026 ecosystem evidence on MCP tool bloat and leaky adapter patterns)

Pitfalls are ordered by severity. Each carries: failure mode → root cause → prevention → warning signs (CI grep, eval scenario, manual review) → phase mapping → severity.

---

## Critical Pitfalls

These block v2.0.0 release if uncaught.

---

### Pitfall 1: Adapter Seam Erosion (the #1 brief risk)

**What goes wrong**

Phase 1 introduces `SourceConnector`, `DeliveryAdapter`, `ChangeFeed` interfaces with a single `obsidian-fs` implementation. Phases 2–8 then quietly bake source-specific assumptions back into core code:

- `Document.id` is treated as a file path somewhere in `src/search/` or `src/server.ts` — e.g. `doc.id.endsWith('.md')`, `path.basename(doc.id)`, `doc.id.replace('obsidian-fs://my-vault/', '')`.
- A new assembly tool reaches for `gray-matter` (YAML parser) directly rather than going through `Document.properties`.
- `chokidar` is imported in a "staleness daemon" file outside `src/adapters/change-feed/`.
- A new tool minted in Phase 3 generates `obsidian://open?vault=...` URLs in core logic rather than via an adapter method.
- A "convenience" function `getNoteByPath(path)` is added to `src/server.ts` and bypasses the registry entirely.

When Phase 10 starts, every such leak is a Notion connector blocker. The "interface with one implementation" looks like an interface but is in fact `obsidian-fs` with a pass-through wrapper.

**Why it happens**

1. **The fastest path is the path that exists.** A sub-agent given "add `search_sections`" sees the existing chunker that takes markdown text and replicates the call site — not the new `Document.blocks` consumer.
2. **TypeScript doesn't enforce the seam.** A `DocId` is a `string`. Nothing at the type level prevents `doc.id.split('/')`.
3. **Display-time helpers leak into core.** `obsidianUrl()` was introduced in v1 as a "render helper" and now lives in `src/server.ts:1333` (see CONCERNS.md) — exactly the migration path the v2 leaks will follow.
4. **Sub-agents don't read each other's PRs.** A Phase 3 sub-agent introduces `getDocByPath()`; the Phase 5 sub-agent reuses it; the Phase 6 sub-agent reuses it again. Three PRs, one leak.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **CI grep: `chokidar` import outside `src/adapters/change-feed/`** | `scripts/lint-adapters.sh` blocking merge | Phase 1 |
| **CI grep: `gray-matter` import outside `src/adapters/source/obsidian-fs.ts` and `src/adapters/delivery/obsidian-fs.ts`** | Same script | Phase 1 |
| **CI grep: `path.join`, `path.resolve`, `fs.readFile`, `fs.writeFile`, `existsSync` outside `src/adapters/*`, `src/config/`, `src/cli.ts`** | Same script | Phase 1 |
| **CI grep: literal `'obsidian://'`, `'obsidian-fs://'`, `'.md'`, `'.canvas'` outside `src/adapters/*`** | Same script | Phase 1 |
| **CI grep: `.endsWith(`, `.split('/')`, `.basename(` applied to anything typed `DocId`** | Use a custom ESLint rule that flags string ops on `DocId`-typed values | Phase 1 |
| **Brand `DocId` so it's not assignable from raw `string`** | `type DocId = string & { __brand: 'DocId' }`; adapter factory mints them; core code cannot construct one | Phase 1 |
| **Stub adapter test** (Phase 3) — every assembly tool runs against a hard-coded `Document[]` connector returning fake URIs (`stub-fs://test/`); if a tool calls `path.basename(doc.id)`, the URI parse fails and the test crashes | `evals/stub-connector.test.ts` | Phase 3 |
| **Sub-agent prompt clause** (mandatory) — every sub-agent gets the one-line reminder: "If you reach for a file path, a chokidar import, YAML parsing, or `obsidian://` outside an adapter module, stop and ask." | Per dispatch prompt | Phases 1–8 |
| **Pre-Phase-10 premise check** — before Phase 10 opens, re-run all CI greps on `main`. Zero hits, or Phase 10.0 cleanup before any Notion code. | Phase 9 → 10 gate | Phase 9 |

**Warning signs**

- New PR in Phases 2–8 imports `path` but is not under `src/adapters/`.
- A new tool's signature accepts `path: string` instead of `doc_id: DocId`.
- A new test fixture uses real file paths instead of opaque URIs.
- `git grep '\.md["\x27]' src/` returns hits outside adapters and test fixtures.
- A sub-agent's completion summary skips the "did I touch any file outside `src/adapters/` that uses file paths, chokidar, or YAML-specific parsing?" check (the brief mandates this in every sub-agent's summary).

**Severity:** Critical — directly blocks v3 and was named the #1 risk in the brief.

**Phase to address:** Phase 1 (install all guardrails). Verify continuously through Phases 2–9. Pre-Phase-10 audit is a gate.

**2026 ecosystem evidence:** The leaky-abstraction anti-pattern is well-documented in adapter literature; multi-source ETL frameworks (Airbyte, Singer) routinely show core code branching on `source_type` despite formally having a connector interface. The vault-memory v1 codebase already has six concrete leaks today (per CONCERNS.md): `obsidianUrl()` in server.ts, hardcoded `.obsidian/**` in scanner, `gray-matter` in `src/write/`, `DEFAULT_CLIENT_ID = "claude-code"`, `.claude/**` in default excludes, `path.* / fs.*` operations in `src/config/add-vault.ts` and `src/rerank/onnx-reranker.ts`. These prove the pattern — the v2 refactor's job is to close them and prevent the next six.

---

### Pitfall 2: Memory Namespace Contamination

**What goes wrong**

An agent writes to a user note despite the "memory namespace is sacrosanct" invariant. Concrete failure modes:

1. **Agent ignores `record_observation` and calls `write_note` directly** with `source: agent` in the frontmatter. If `write_note`'s Guard B isn't checked, the agent's note lands in the user's vault.
2. **Agent calls `record_observation` with a sink handle that resolves to a path inside the user's content** (e.g. `obsidian-fs://my-vault/projects/Atlas.md` — a real user note). If the sink-handle parser accepts any handle the user configured, and the user mis-configured a sink, the contamination is silent.
3. **`update_frontmatter` is called on a user note with `source: agent` snuck into the property bag.** Guard B refuses this in ADR-004 — but only if Guard B is *centralized at the DeliveryAdapter* and not duplicated across `write_note`, `update_frontmatter`, `delete_note`, and any v2 tool that mutates properties.
4. **`compile_brief` writes to a memory sink that no longer exists** (user removed the sink from config). The brief falls back to a "best available sink" — which happens to be a regular vault folder.
5. **A v2 tool added in Phase 3 (e.g. `assemble_dossier`) accidentally has a write path** because its sub-agent confused "return a packet" with "save a packet." The packet writes through the *non-memory* delivery path.
6. **Guard A says "refuse memory-sink writes through `write_note`"** but the agent passes a path that, after `safeJoinInsideVault` normalization, happens to point inside `_memory/`. If the guard checks the input string and not the resolved DocId, a path-traversal bypass exists (`../_memory/foo.md` from a sibling folder).

**Why it happens**

1. **Two layers, two places guards can live.** Validators in the tool layer (`record_observation`) are easy to add; bypassing them by calling `write_note` directly is also easy. The brief explicitly notes "Validator at the `DeliveryAdapter` layer" — that's the only place that catches all paths because every write must go through it.
2. **Prompt-layer "agent should use the labeled tool" is not a guarantee.** Models drift, prompts mutate, and other agents (non-Claude) won't have the same prompt conditioning.
3. **Sink-handle parsing is split between config load and tool dispatch.** If both parsers exist and they disagree on edge cases (trailing slash, capitalization, percent-encoding), the agent and the guard see different sinks.
4. **The brief surfaces an open risk: "namespace boundary may need to be a *separate vault* in v2 rather than a folder, for hard isolation."** Folder-as-namespace is leakier than vault-as-namespace by construction — every guard must work for paths-that-look-like-memory-but-aren't and paths-that-look-like-content-but-are-actually-memory.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **Centralize Guards A and B at `DeliveryAdapter.write()` / `update()` / `delete()`** — not in tool handlers | `src/adapters/delivery/obsidian-fs.ts` | Phase 2 |
| **The DeliveryAdapter resolves the target DocId first, then consults `registry.listMemorySinks()` to determine which guard applies. The DocId is the source of truth, not the input path.** | Same | Phase 2 |
| **`source: agent` in `properties` is *only* settable through the memory-sink path. Non-memory writes that include `source: agent` are rejected at the adapter, returning a structured error** | Same | Phase 2 |
| **Eval scenario: "naive `write_note` to a memory-sink-resolved path is rejected with a clear error"** — the brief mandates this in Phase 2 acceptance | `evals/scenarios/memory-namespace-isolation.test.ts` | Phase 2 |
| **Eval scenario: agent calls `write_note` with `source: agent` to a non-memory path → rejected** | Same | Phase 2 |
| **Eval scenario: agent calls `record_observation` with a `sink` handle that resolves outside any configured memory sink → rejected at handle-parser** | Same | Phase 2 |
| **Eval scenario: traversal path `../_memory/foo.md` from a sibling — sink-detection must operate on the resolved DocId, not the user-supplied string** | Same | Phase 2 |
| **`audit_log` distinguishes memory-sink writes with a dedicated column** — easy detection post-hoc if contamination happened | Phase 2 deliverable already in the brief | Phase 2 |
| **Decide the folder-vs-vault question with an explicit ADR amendment before Phase 2 coding starts.** Recommended: ship folder as default, document vault as "production deployment recommendation," provide an `add-vault --memory-vault` flag (already sketched in ADR-004). | `docs/v2/adr/004-memory-sink-handles.md` amendment | Phase 0/2 transition |
| **Memory-sink path must include a sentinel property the user cannot create by accident** — e.g. the sink folder has a `.memory-sink` marker file with the sink's name and contract version. If absent, the sink is "uninitialized" and refuses writes until `initialize_sink` runs. Prevents misconfiguration where a sink handle points at a user folder. | `record_observation` → DeliveryAdapter | Phase 2 |
| **Sub-agent prompt clause for any phase that adds a write tool: "List every write path you introduce. Confirm each goes through `DeliveryAdapter.write()` not direct `fs.writeFile`. Confirm Guards A and B both apply."** | Per dispatch | Phases 2, 6, 7 |

**Warning signs**

- A new MCP tool's handler imports `fs.writeFile` or calls `writeNote` directly without going through the adapter.
- Guard logic appears in more than one file. (It should appear once, in the delivery adapter; if it's also in `record_observation`, that's defense-in-depth, OK; if it's also in `write_note`, that's drift.)
- A test marked `.skip()` or `.todo()` with a name like "memory-sink edge case" — that test is the one that fails.
- An agent's audit-log entries show `source: agent` writes to paths outside `_memory/`.
- The eval suite passes but doesn't cover the "agent ignores the labeled tool" scenario.

**Severity:** Critical — the brief calls this "the single non-negotiable safety invariant."

**Phase to address:** Phase 2 primarily. The "centralize at adapter" decision must be made in Phase 2's design; once a single tool bypasses, the invariant is broken in production.

---

### Pitfall 3: Backwards-Compatibility Regression on v1's 23-Tool Surface

**What goes wrong**

v1 has 23 tools that external agents and skills depend on. Common v2 failure modes:

1. **Default-behavior drift.** Phase 4 adds `recency_weight` and `authority_weight` to `search_hybrid`. Sub-agent picks a non-zero default for one of them "because freshness usually matters." Every v1 client's queries now rank differently. The brief calls this out explicitly: "v1 default behavior unchanged when weights are absent."
2. **Return-shape drift.** Phase 3 adds the citation packet (`{doc_id, source_handle, title, heading_path, mtime, hash, display_url}`) to result objects. Sub-agent adds the packet to *existing* tools' results too, breaking clients that parsed the v1 shape positionally or with strict schemas. Or worse: changes a field name (`path` → `obsidian_url`) because "it's more accurate."
3. **Tool description drift.** Tool descriptions are visible to agents and influence tool selection. If `search_hybrid`'s description changes ("now with authority weighting!"), any agent prompt that ships tool descriptions verbatim sees a different prompt — and may select differently. Some MCP clients cache descriptions; others fetch live.
4. **Silent schema deprecation.** Phase 2 adds `source` validation. An old `write_note` call without `source` now fails. The migration note says "deprecated"; the runtime says "rejected."
5. **`DEFAULT_CLIENT_ID = "claude-code"` is changed to `"unknown"` per CONCERNS.md's fix.** That's a *behavior* change to audit log entries — every downstream tool that filters by `client_id = "claude-code"` now misses writes.
6. **DocId migration breaks the flat-shape `search`/`fetch` adapter.** ADR-001 says external IDs `vault:path` are preserved for that adapter. If the adapter is refactored to use `DocId` internally and the bidirectional translation regresses, ChatGPT Custom Connectors and OB1 clients break.
7. **Tool *ordering* in the MCP `tools/list` response changes.** Some agents key off ordering as a stability proxy. Unlikely but real.
8. **Net-new tools get names that overlap with v1.** "New tools get new names" is the brief's rule — easy to violate. `search_hybrid` v2 with new args is OK; `search` (a new name colliding with the flat-shape adapter) is not.

**Why it happens**

1. **Sub-agents see a tool's implementation, not its contract.** Without an explicit "this is the v1 contract, do not change" reference, they refactor freely.
2. **TypeScript types catch shape changes within `src/`; they don't catch agent-visible changes.** The contract surface is the `inputSchema`/`outputSchema` JSON exposed via MCP — not the TS types.
3. **No contract-test suite for the 23 v1 tools.** v1's 360-test suite is comprehensive on internal correctness; the brief notes "All 324 existing tests still pass" as Phase 1 acceptance — but tool-surface stability requires a separate, narrower check.
4. **The v1 eval set isn't run in CI yet.** Phase 4's acceptance is "default behavior unchanged when weights are absent (verified by re-running v1 eval set)." If the v1 eval set is reconstructed from scratch each time, drift is invisible.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **Pin v1's `tools/list` response as a snapshot test** — JSON schema for each tool, full description string, full input/output schemas. Test fails on *any* delta to existing tools; new tools are an additive PR with a separate snapshot. | `src/server.test.ts` or `src/server/tool-snapshots.test.ts` | Phase 1 |
| **Pin v1 eval queries with expected top-K result IDs** (frozen `v1-eval.json`); run on every PR in Phases 2–9. Regressions block. | `evals/v1-baseline/` | Phase 0 or 1 |
| **A new tool gets a new name, period.** No "extended" or "v2" suffix — it's a fresh name. (`search_hybrid` keeps its name and accepts optional new args; `search_sections` is a separate name; `assemble_dossier` is separate.) | Convention enforced via PR review checklist | Phases 2–9 |
| **All new arguments on existing tools default to "off"** — `recency_weight` defaults to 0, not 0.1. Confirmed via the snapshot test plus an explicit "v1 behavior preserved" test per tool. | Code review + unit tests | Phases 2–9 |
| **Citation packet only on *new* tools' results** in Phase 3 — existing tools' shapes stay frozen unless the user opts in via a `include_citation: true` arg. | Phase 3 design decision | Phase 3 |
| **Don't change `DEFAULT_CLIENT_ID` in a v2.x release.** It's a v3.0.0 change with a migration note. (CONCERNS.md lists this as a fix; the fix waits.) | Per-PR review | Phases 1–9 |
| **Migration guide (Phase 9 deliverable) explicitly enumerates "nothing breaks" and "what changed."** Every entry maps to a specific snapshot-test row. | `docs/v2/MIGRATION.md` | Phase 9 |
| **Treat the flat-shape `search`/`fetch` adapter as a separate snapshot suite** since its external ID format is different from the internal `DocId` (per ADR-001). | `src/server/flat-shape-adapter.test.ts` | Phase 1 |

**Warning signs**

- A PR diff modifies any existing tool's `inputSchema` or `outputSchema` without a snapshot-test update — fails CI.
- A v1 eval query's top-K result IDs change between PRs.
- A sub-agent's PR description says "improved `X`" rather than "added new tool `Y` that does improved X."
- The CHANGELOG `[Unreleased]` section grows without a corresponding snapshot diff.

**Severity:** Critical for v2.0.0 release. The brief lists "backwards-compatible v1.x API" as a non-negotiable constraint. A regression discovered post-release requires a v2.0.1 fix and erodes trust.

**Phase to address:** Phase 1 installs the snapshot tests and v1 eval baseline. Phases 2–9 maintain them.

---

### Pitfall 4: Staleness False Negatives in Compiled Briefs

**What goes wrong**

A brief in `_memory/_briefs/` has `source_hashes: {doc_id: hash}` and `compiled_at: <ts>`. The staleness daemon subscribes to `ChangeFeed`. When a source changes, the brief should flip to `status: stale`. Failure modes:

1. **Frontmatter-only changes don't change the body hash** — depending on what `hash` means. v1's `body_hash` (migration 006) is content-only; `hash` per ADR-003 is "content hash, opaque to consumers." If the brief stored the body hash but the change was a frontmatter edit (which *does* affect retrieval — properties feed authority, status, etc.), the brief stays "fresh" but its source's authority has changed.
2. **Conversely, frontmatter-only changes that don't affect retrieval re-trigger staleness** — every save flips the brief stale, agents constantly recompile. Performance regression and trust erosion ("the system says everything is stale, ignore it").
3. **Race during indexing.** Source A changes; ChangeFeed emits `update`; staleness daemon marks brief X stale; *simultaneously*, the brief itself is being recompiled (which writes to the same memory sink); the recompile's write completes; the staleness daemon's stale-mark lands on the *new* brief. Now the freshly-compiled brief is marked stale on arrival.
4. **`rename` events miss staleness updates.** When a source doc is renamed (Obsidian path change → new DocId per ADR-001's `identityStable: false`), the indexer updates the DocId. The brief's `source_hashes` keys by old DocId. The brief never flips stale, even when content changes, because the daemon looks up the new DocId and finds no brief referencing it.
5. **Hash collisions.** SQLite has no hash function guarantee; if the chunker uses SHA-1 or a 64-bit hash, collisions are astronomical but possible. More realistically: hash computed on *normalized* text (trim, lowercase headings, …) drops information; two different bodies normalize to the same string.
6. **Notion's lack of fine-grained changefeed (Phase 10).** Notion API offers `last_edited_time` per page but no block-level diff. A polling-based `ChangeFeed.notion-api` either over-fires (any page touch = every brief touching that page stales) or under-fires (relies on the page-level timestamp and misses block edits within the same second).
7. **Daemon crash / restart misses changes.** If the daemon is down for 30 seconds and 5 source docs change, then comes back up and resubscribes, the missed events are gone (chokidar is push-only, no replay). Briefs that should be stale remain fresh.
8. **Hash storage is per-doc, not per-chunk.** A brief that summarized 3 chunks out of a 50-chunk document needs to know "did the chunks I summarized change?", not "did the doc change?" The latter over-fires.

**Why it happens**

1. **"Hash" is overloaded.** v1's `notes.hash` (full content), `chunks.hash` (per chunk), and `body_hash` (post-frontmatter) all exist. The brief schema in the brief just says `source_hashes: {doc_id: hash}` — under-specified.
2. **Push-only change feeds have no replay.** chokidar fires once. If the consumer was busy, that fire is lost.
3. **Cross-process: the staleness daemon may run as a separate process** if it's structured that way. Same MCP server process: simpler, but blocks indexing during stale-marking.
4. **The brief's compile-then-mark-stale window is real.** Two writes to the same sink in rapid succession with no transactional fence allow read-after-write inconsistency.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **ADR amendment to ADR-003 specifying what `Document.hash` means** — recommend: `hash` = stable hash over `(blocks rendered to plain text) + (PropertyBag serialized canonically)`. Body-only hashing is insufficient because property changes affect retrieval. | `docs/v2/adr/003-document-shape.md` | Phase 0 (amendment), or Phase 6 if deferred |
| **Per-chunk hash storage** for briefs: `source_hashes: {doc_id: {chunk_ids: [...], chunk_hashes: [...]}}` or similar. A brief flips stale only when one of its *cited* chunks changes. | Phase 6 schema | Phase 6 |
| **Staleness daemon uses transactional fencing** — before marking brief X stale, compare brief X's `compiled_at` with the change event's `at`. If `compiled_at >= at`, the brief was compiled *after* this change and the change is already incorporated. | `src/briefs/staleness.ts` | Phase 6 |
| **Rename events update brief `source_hashes` keys atomically.** The staleness daemon must subscribe to `rename` events specifically and rewrite brief property values. (ADR-001's `rename` event is the right primitive; daemon must consume it.) | Same | Phase 6 |
| **Daemon restart recovery: on startup, the daemon re-checks every brief against current source hashes.** Briefs whose sources have changed since `compiled_at` get marked stale. This is the only safe path for push-only change feeds. | Same | Phase 6 |
| **`ChangeFeed` capability descriptor includes `replayable: boolean`** — Notion polling can replay (it timestamps every poll); chokidar cannot. Briefs over non-replayable feeds run the startup re-check; briefs over replayable feeds can skip it. | `src/adapters/change-feed/types.ts` capability addition | Phase 6 or 10 |
| **Eval scenario per the brief's Phase 6 acceptance: compile a brief over 20 docs, modify one source, verify brief flips stale within one change-feed cycle.** Additionally: modify only the frontmatter, verify it flips stale (since hash covers properties). Additionally: rename a source, verify staleness keys update. Additionally: compile-then-modify in the same 100ms window, verify the final state is "stale" not "fresh." | `evals/scenarios/brief-staleness.test.ts` | Phase 6 |
| **The same eval runs against the stub connector** (per Phase 3's source-neutrality acceptance) — proves the change-feed semantics aren't chokidar-specific. | Same | Phase 6 |

**Warning signs**

- Eval scenario "modify a frontmatter property" doesn't appear in the brief-staleness suite.
- `source_hashes` is keyed by doc_id only (not chunk_id) — over-fires.
- Daemon code subscribes to `update` and `delete` but not `rename`.
- No startup-replay logic in the daemon.
- Property changes (e.g. flipping `status: superseded`) don't bump the hash that briefs store.

**Severity:** Critical for Phase 6 acceptance; downgrades to High if Phase 6 ships with naive hashing and a follow-up ADR fixes it before v2.0.0. The brief flags this with "Atomic, hash-protected" — under-specified language that's a known source of bugs in change-feed systems.

**Phase to address:** Phase 6 primarily. Amendment to ADR-003 in Phase 0 if the hash semantics aren't pinned down then. Phase 10 revisit for Notion's polling model.

---

## High-Severity Pitfalls

These catch up painfully if not addressed but are recoverable mid-roadmap.

---

### Pitfall 5: Task-Contract Portability Leaks (Phase 7 → v3)

**What goes wrong**

Phase 7 ships user-authored task contracts. Per the brief: "Contracts reference sources and sinks by *handle*, not by file path. A `meeting-prep` contract authored against `obsidian-fs://my-vault` can be re-pointed to `notion-api://my-workspace` in v3 by changing one handle."

Failure modes that break this in practice:

1. **Contracts hardcode vault names.** A `meeting-prep` contract has `sources: { primary: { handle: "obsidian-fs://my-vault" } }`. The user named their vault `my-vault`. The contract is now non-portable to another user.
2. **Contracts hardcode property values that only exist in YAML.** A filter like `where: { class: "Person" }` works in YAML (untyped property bag) but fails or behaves differently in Notion's typed schema (where "class" may not exist as a property at all, or be a multi-select).
3. **Contracts depend on Obsidian-specific edge types.** `expand({edge_types: ['wikilink']})` works in v2; in Notion there's no wikilink, only `mention` and `hyperlink`. Contracts must declare edge types abstractly or expect the registry to remap.
4. **`{{slug}}` interpolation injects characters that are illegal in some adapters.** `meeting-prep --person "Alice / Bob"` becomes a path with `/` in obsidian-fs (potentially a directory traversal); becomes a Notion property value with no issue. The contract is the same; the adapters differ.
5. **`source_overrides`/`sink_overrides` work but the assembly steps inside the contract call adapter-specific tools.** Step 1 calls `assemble_dossier` (source-neutral); step 2 calls a hypothetical `read_canvas_yaml` (Obsidian-only). Override the source — step 2 still fails.
6. **Contracts are stored as `Document`s in `_contracts/`.** A user-authored contract has a stale `compiled_from` property pointing at the vault path the user used to write it. The contract works on the original machine; on a fresh install, the property is dangling.

**Why it happens**

1. **Visual authoring (Canvas in Phase 8) makes it easy to drag-drop a specific vault as a source** rather than parameterize it. Users author against what they have.
2. **The "handle vs path" confusion is real.** Even careful users will type `~/Documents/MyVault/_memory` instead of `obsidian-fs://my-vault/_memory` if both are accepted.
3. **Reference contracts ship with concrete handles to be runnable as-is** — those handles become the template every user copies.
4. **No "portability lint" exists.** A contract that uses `{{vault.name}}` is portable; one that hardcodes `my-vault` is not. Without a linter, the difference is invisible.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **Reference contracts (Phase 7's `meeting-prep`, `project-status`, `code-review-brief`) use variable handles** — e.g. `sources: { primary: { handle: "{{default_source}}" } }` resolved from the user's config at instantiate-time. | `examples/contracts/` | Phase 7 |
| **Contract linter: any concrete handle in a contract triggers a warning at `list_contracts`.** Allowed forms: `{{default_source}}`, `{{default_sink}}`, `{{source.<name>}}`, `{{sink.<name>}}`. Hardcoded handles are still permitted (advanced users) but flagged. | `src/contracts/lint.ts` | Phase 7 |
| **Contract capabilities declaration.** Every contract declares which capability descriptors its assembly steps require (e.g. `requires: { source: { bodyShape: 'blocks' }, sink: { atomic: true } }`). At `describe_contract` time, the registry compares the configured source/sink against the contract's requirements and surfaces incompatibility. (This is already in ADR-002's capability section — Phase 7 must consume it.) | `describe_contract` handler | Phase 7 |
| **No adapter-specific tool calls inside contract assembly steps.** The contract DSL has a fixed vocabulary of generic tools (`assemble_dossier`, `recall`, `expand`, `compile_brief`). Adapter-specific tools are not callable from contracts. | Contract schema (Zod) | Phase 7 |
| **`{{slug}}` and other interpolation values are sanitized per-adapter** — the obsidian-fs adapter strips `/` and `\`; the notion-api adapter strips control chars. The DeliveryAdapter's `write()` is responsible. | Per-adapter sanitization | Phase 1 (delivery adapter contract) |
| **Phase 7 acceptance includes the brief's clause: "contract pointed at stub connector yields same shaped output."** This is the portability proof. Run it for all three reference contracts. | `evals/scenarios/contract-portability.test.ts` | Phase 7 |
| **Phase 8 Canvas-to-contract compiler emits portable handles by default** — drag-drop of a source node produces `{{source.<name>}}`, not the literal handle. Advanced users can edit the YAML manually. | Canvas compiler | Phase 8 |

**Warning signs**

- Reference contracts contain literal `obsidian-fs://...` handles.
- A contract's YAML contains a path with `/` characters in the resource part that don't look like adapter-resolved URIs.
- The portability test (Phase 7 acceptance) is `skip()` or `todo()`.
- Contracts use `where: { <property>: <value> }` syntax that assumes the property is a string (works in YAML, breaks in Notion's typed system).

**Severity:** High — recoverable mid-roadmap (Phase 10 can introduce a migration tool that rewrites hardcoded handles to variables), but undermines Phase 10's whole premise of "additive, no rewrites."

**Phase to address:** Phase 7 (lint + reference contracts portable from day one). Phase 8 (Canvas compiler emits portable output).

---

### Pitfall 6: Canvas Round-Trip Loss (Phase 8)

**What goes wrong**

The Phase 8 acceptance says: "YAML → canvas → save unchanged → recompile → byte-equal (modulo whitespace) to original." This is hard. Failure modes:

1. **Layout state isn't preserved.** Obsidian's `.canvas` JSON stores `x`, `y`, `width`, `height` per node. The YAML doesn't. Recompiling produces an identical YAML but the user's hand-arranged graph is now auto-laid-out and looks different.
2. **Node ordering in `.canvas` files is preserved by Obsidian but not by the JSON parser.** JSON object key order is implementation-defined. A round-trip through `JSON.parse → JSON.stringify` rearranges keys; Obsidian sees a "different" file and prompts conflict resolution.
3. **Comments in YAML are lost.** Users add `# this is the slow path` comments. Canvas → YAML doesn't preserve them; YAML → Canvas doesn't have a place to store them.
4. **Optional fields default differently.** A contract step without `as: <name>` defaults to a name in YAML; in Canvas it shows as a labeled output. Round-trip introduces the explicit `as: <generated-name>` field; the YAML is no longer byte-equal.
5. **Float formatting.** `x: 100` vs `x: 100.0` vs `x: 1.0e2`. Obsidian writes one; the compiler writes another.
6. **Newline handling.** Canvas JSON is unix-newlines; YAML on Windows is CRLF. Both compilers must normalize.
7. **User adds a "sticky note" canvas card (not a contract node).** The decompiler must round-trip it as a `# comment` in YAML, or preserve it as a non-semantic Canvas-only annotation that survives YAML→Canvas. Common approach: a `meta:` section in YAML; if absent, sticky notes are dropped.
8. **Phase 8 plugin's watcher recompiles on every save** — the user opens Canvas, doesn't change anything, saves, watcher recompiles, the YAML changes by one whitespace character, the YAML's mtime updates, the Canvas's mtime gets bumped by the YAML's watcher in a different module — infinite loop.

**Why it happens**

1. **Visual programming tools have decades of literature on this** — n8n, Node-RED, Scratch, LabVIEW all wrestle with "the textual representation is canonical" vs "the visual layout is canonical." Most pick "visual canonical + textual export" or "textual canonical + auto-layout on import." vault-memory has chosen "textual canonical, Canvas is a view" per Phase 7's design — which means Canvas layout is a *non-semantic* concern. Document this explicitly or the user will expect layout preservation.
2. **`.canvas` JSON is technically a documented Obsidian format but it's not stable across plugin updates.** New keys appear; the decompiler must tolerate unknown keys.
3. **The brief's acceptance criterion is too strict.** "Byte-equal (modulo whitespace)" is hard to define. Better: "semantically equivalent — same contract YAML produced after one canvas round-trip."

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **Restate the acceptance criterion in the Phase 8 design note.** Pick one of: (a) YAML is canonical, layout is regenerated on Canvas open; (b) Canvas is canonical, YAML is regenerated on Canvas save; (c) Both round-trip with `meta: { canvas-layout: ... }` block in YAML preserving layout. Recommended: (c). | Phase 8 design note | Phase 8 |
| **Define "semantically equivalent" explicitly** — same Zod-validated AST after canonicalization (sorted keys, normalized whitespace, default values omitted). The byte-equal target applies to the canonicalized form. | Phase 8 design note | Phase 8 |
| **Watcher avoids infinite loops with a content-hash gate.** Canvas → YAML recompile only writes the YAML file if the new YAML's content hash differs from the existing file's content hash. Same for YAML → Canvas. (vault-memory v1 already has `SuppressionSet` for this — reuse the pattern.) | `src/canvas-watcher/` | Phase 8 |
| **Sticky notes and other Canvas-only annotations get a defined home** in YAML — `meta.canvas-annotations: [...]` — or are explicitly dropped with a warning at compile time. | Phase 8 design note | Phase 8 |
| **The compiler tolerates unknown keys in Canvas JSON** (Obsidian plugin extension surface) and passes them through `meta.canvas-extra`. | Canvas compiler | Phase 8 |
| **Spike the round-trip early** — per the brief: "Spike first. If green, three sub-agents." The spike must prove the round-trip with at least three sample canvases, including one with hand-arranged layout, one with comments, one with sticky notes. | Phase 8 spike sub-agent | Phase 8 |
| **Phase 8 deliverable is opt-in.** If the round-trip can't be made cleanly, ship Canvas as a *view* (read-only render of YAML contracts as a Canvas), not a bidirectional editor. The user still authors in YAML; Canvas is a visualization. Document this fallback in the design note. | Phase 8 risk mitigation | Phase 8 |

**Warning signs**

- The byte-equal test passes for the trivial case (no layout, no comments) but fails for any real-world canvas.
- The Canvas watcher fires more than once after a single save.
- The plugin produces "conflict" prompts in Obsidian on every save.
- Users report "my layout was wiped" after a YAML edit.

**Severity:** High for Phase 8 acceptance. Medium for the v2.0.0 release (Phase 8 is the last new-feature phase before Polish; if it's not ready, ship it as a v2.1.0 with a CLI/YAML-only authoring path).

**Phase to address:** Phase 8. Spike result determines whether Phase 8 ships as planned or is descoped.

---

### Pitfall 7: MCP Tool Surface Bloat (23 → 35+ tools)

**What goes wrong**

v1 has 23 tools. Counting from the brief:
- Phase 2 adds 4: `record_observation`, `recall`, `supersede`, `memory_stats`, plus `list_sinks` → 5.
- Phase 3 adds 4: `get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier`.
- Phase 5 adds 2: `expand`, `cluster`.
- Phase 6 adds 3: `compile_brief`, `get_brief`, `list_briefs`.
- Phase 7 adds 3: `list_contracts`, `describe_contract`, `instantiate_contract`.

That's **40 tools** at v2.0.0, before Phase 10 doubles the surface for connector mgmt.

Failure modes documented in 2026 MCP literature (see Sources):
1. **Tool descriptions consume 72% of agent context windows** before work begins. With 40 tools at ~200 tokens each in descriptions and schemas, every agent call starts with 8K tokens of vault-memory tool definitions.
2. **Tool selection accuracy collapses** — Atlassian's MCP-compression research shows accuracy dropping from 43% to under 14% as tool count grows past ~20. Agents pick the wrong tool when too many overlapping options exist.
3. **Overlapping tools confuse selection.** `search_hybrid` vs `search_sections` vs `recall` vs `assemble_dossier` — which one does the agent pick for "find Alice's notes from last week"? All four are plausible. Without explicit decision rules in the tool description, the agent picks based on description token weight.
4. **`list_contracts` + `describe_contract` + `instantiate_contract` is three tools to do one thing.** Many MCP servers consolidate to `contracts(action: list|describe|instantiate, ...)`.
5. **`memory_stats`, `recall`, `record_observation`, `supersede`, `list_sinks`** — five tools for memory. Agents pick the wrong one (e.g. `recall` for "give me all memories" when `list_sinks` + `memory_stats` is what they need).
6. **Capability descriptors are visible to agents but not in tool descriptions** — so an agent calls `compile_brief` without checking whether the configured sink supports `atomic: true`, fails, and doesn't know why.

**Why it happens**

1. **Each phase ships its own tools.** No phase has the cross-phase incentive to consolidate.
2. **Sub-agents in Phase N don't see Phase N-1's tools** (per the brief: "Never hand a sub-agent the whole roadmap"). They cannot consolidate naturally.
3. **MCP tool descriptions are write-once: agents see them, but server authors rarely revisit them.**

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **Decision-rule sentence in every tool description.** Example: `record_observation` — "Use when: agent has formed a claim and wants to persist it with provenance. Do NOT use for: storing user content (use `write_note`); pure retrieval (use `recall`)." Atlassian's MCP-compression research finds this is the single highest-leverage change. | Every tool's `description` field | Phases 2–7 |
| **Tool-budget convention: cap each phase at ≤4 new tools.** Phases 2–7 individually respect this. The 40-tool total stands. Consolidate within a phase if exceeded. | Phase planning constraint | Phases 2–7 |
| **`list_briefs`, `list_contracts`, `list_sinks`, `memory_stats` are MCP `resources`, not `tools`.** ADR-004 already raises this for sinks ("Considered. … Partially adopted"). Promote it: list-style introspection is a `resources` concern; mutation and assembly are `tools`. Halves the tool count. | Server config | Phase 2 |
| **Tool-description-token budget**: each tool's description + input schema ≤ 300 tokens. CI test measures actual token counts. | `scripts/measure-tool-tokens.mjs` | Phase 1 |
| **Capability descriptors surface in tool errors, not descriptions.** When `compile_brief` fails because the configured sink isn't atomic, the error message names the missing capability — the agent learns at call time, not by reading all descriptions up front. | Tool error handling | Phases 1, 6 |
| **One eval scenario per pair of "easily confused" tools**: agent must pick correctly between `search_hybrid` and `search_sections`; between `recall` and `assemble_dossier`; between `get_document_bundle` and `get_outline`. The eval measures selection accuracy. If <80%, tool descriptions need a rewrite. | `evals/scenarios/tool-selection.test.ts` | Phase 3 onward |
| **Document the canonical "agent recipe" in `docs/v2/AGENT_GUIDE.md`**: for common tasks, here is the recommended tool sequence. Reduces the agent's burden of selection. | Phase 9 | Phase 9 |

**Warning signs**

- New tool's description is identical in shape to an existing tool's, with just a different verb.
- An agent in dev testing repeatedly picks the wrong tool for a task.
- Tool descriptions average >300 tokens.
- More than 4 new tools land in one phase.
- A new tool's description doesn't include "Use when / Do NOT use for" lines.

**Severity:** High. Causes ongoing agent-quality regression (Atlassian observed 3× drop in selection accuracy) and doubles agent costs (token bloat). Recoverable post-v2.0.0 with a v2.1.0 tool-consolidation pass, but the v2.0.0 launch reviews will mention it.

**Phase to address:** Phase 1 (install token-budget CI). Phase 2 (decide tools-vs-resources for list-style ops). Phases 3, 5, 6, 7 (enforce per-phase cap). Phase 9 (agent-guide doc).

**2026 ecosystem evidence:** Atlassian's MCP-compression work, Lunar.dev's tool-overload patterns, and the New Stack's "10 strategies to reduce MCP token bloat" all converge on the same diagnostic: too-many-tools + overlapping-descriptions = selection failure. Anthropic's deferred-tool-loading pattern (Claude SDK) is the 2026 default for servers with >20 tools.

---

### Pitfall 8: Eval Drift — "Passing Tests, Wrong Product"

**What goes wrong**

The eval fixture in `evals/fixtures/v2-test-vault/` is hand-labeled. Failure modes:

1. **Brittle exact-match assertions.** An eval expects "top-5 contains `Atlas.md`." A scoring refinement promotes a more relevant doc; `Atlas.md` drops to position 6; eval fails despite an objectively better result.
2. **The eval suite is slow** (full vault index + cross-encoder rerank per query). Sub-agents are tempted to skip it ("I only changed the chunker, eval doesn't apply"). Drift accumulates.
3. **Fixture rot.** The fixture vault was hand-labeled in Phase 0. Phase 4 adds authority/staleness signals — the fixture has no `status: superseded` notes, so authority weighting is untested.
4. **"Passing tests but wrong product."** Eval queries are unrealistic. Real users ask "what did Alice say about Atlas?" The eval asks "find notes containing 'Alice' and 'Atlas'." The system passes the eval and fails the user.
5. **Sub-agents add eval scenarios that confirm their implementation.** Phase 6 sub-agent writes "compile a brief, verify it has X" — but X is exactly what their implementation produces, not what a brief *should* contain.
6. **Eval consumes raw markdown** in early phases and `Document` objects from Phase 3 onward (per the brief's discipline). If the migration of evals from one shape to the other is incomplete, some evals run against stale formats.
7. **Eval fixture grows without curation.** Each phase adds 5–10 notes for its own scenarios; by Phase 9 the fixture is 150 notes of incoherent shape, no narrative, no real authoring patterns. The fixture is too synthetic to catch real bugs.
8. **Eval results are not tracked over time.** Phase 4 ships, evals pass. Phase 7 ships, evals pass. Are precision/recall actually trending up or down? Without time-series tracking, regressions hide in flat pass/fail.

**Why it happens**

1. **Hand-labeling is expensive.** Maintainer or sub-agents do it once and forget to revisit.
2. **Sub-agents are scored on "make the eval pass," not "is the eval right."** Their incentive is the test, not the product.
3. **Eval suites that take 5+ minutes don't run on every PR.** They run on the phase merge. By then the regression is buried under 10 PRs.
4. **No "champion-challenger" framing.** Most eval suites are pass/fail. A challenger framing ("did this PR improve precision over `main`?") surfaces drift directly.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **Eval scoring is relevance-based, not exact-match.** Use NDCG@K or MRR for retrieval; for assembly tools, score against a set of "must include" + "must not include" doc IDs with partial credit. | `evals/scoring.ts` | Phase 0 |
| **Fast eval subset runs on every PR.** A ≤30-second subset (10 representative queries) blocks merge on regression. Full suite runs on phase merge. | CI config | Phase 0 |
| **Fixture vault narrative**: the 50–100 notes form a coherent fake project (a fictional company with people, projects, meetings, decisions). Notes reference each other realistically. Hand-labeled scenarios are realistic ("find what we decided about X"), not synthetic. | `evals/fixtures/v2-test-vault/README.md` | Phase 0 |
| **Each phase's eval additions are reviewed by the maintainer**, not approved by the sub-agent. The phase-transition gate includes "eval additions reflect user-realistic scenarios, not implementation confirmations." | Phase transition checklist | Every phase |
| **Eval results are logged with timestamp + commit + score per query.** A simple `evals/history.jsonl` append-only log. Phase 9's polish includes a precision/recall trend chart over the v2 timeline. | `evals/report.ts` | Phase 9 |
| **Fixture includes deliberate "trap" notes** — duplicates with different freshness, superseded notes, broken wikilinks, frontmatter typos, notes with no body, notes with property values that look like DocIds but aren't. Phase 4 adds the staleness traps; Phase 5 adds the broken-edge traps. | `evals/fixtures/v2-test-vault/` | Phases 0, 4, 5 |
| **Eval against the stub connector** (per Phase 3) — proves the eval consumes `Document` objects, not raw markdown. From Phase 3 onward, every eval scenario runs once against obsidian-fs and once against stub. | `evals/scenarios/*.test.ts` | Phase 3+ |
| **"Champion vs challenger" CI report**: PRs that modify retrieval get an automatic comment with "precision@5 changed by Δ" against `main`. Sub-agents see this before merge. | GitHub Actions workflow | Phase 4 |

**Warning signs**

- Eval pass-rate is consistently 100% across all phases — likely the evals are loose, not the product is perfect.
- A sub-agent adds an eval in the same PR as the feature, with no maintainer review of the eval itself.
- Eval runtime grows phase over phase without subset partitioning.
- An eval scenario name contains "verifies the X behavior" (implementation-confirmation) rather than "user wants Y" (product-spec).
- The fixture vault has no notes representing real-world failure modes (broken links, stale frontmatter, etc.).

**Severity:** High — eval drift is invisible until a real user complains. By v2.0.0 a drifted eval suite means "we don't actually know if the product works."

**Phase to address:** Phase 0 (foundation + fixture + scoring strategy). Phase 3 (stub-connector eval parity). Phase 9 (trend chart, full polish). Every phase enforces eval review at transition.

---

### Pitfall 9: Local-First Promise Erosion (Phase 10 and creeping)

**What goes wrong**

The brief is explicit: "Local-first. No cloud. No telemetry. No network calls beyond Ollama on `localhost:11434` for v2. Phase 10 will introduce *optional* outbound calls (Notion API), gated per connector, never by default."

Failure modes:
1. **A v2 dependency update pulls in a transitive that phones home.** Many npm packages have analytics opt-out flags that are opt-out, not opt-in. `next-telemetry` is the canonical example.
2. **An error log includes a stack trace with a full path, vault name, and user home directory.** If that log is ever shipped to a crash-reporter (Sentry, etc.), it leaks PII. The brief says no telemetry — but a future maintainer might add "opt-in crash reporting."
3. **The `compile_brief` LLM ADR (deferred to Phase 6) decides "call Ollama."** Fine. But the same code path is later extended to "call OpenAI if Ollama is down" — without the ADR amendment.
4. **The Notion connector (Phase 10) is on by default** if a Notion token is found in the environment. Slippery slope to "we always check NOTION_TOKEN."
5. **Error messages from the Notion connector leak the workspace ID, page ID, or token.** "Failed to fetch page abc-123 from workspace acme-secret-name." A user reporting a bug pastes the error; the workspace name is now public.
6. **Fallback-to-cloud when local fails.** Ollama crashes; vault-memory falls back to "no embeddings, FTS-only" silently — fine. Or it falls back to a remote embedding API — not fine.
7. **The Skills pack downloads templates from the internet** without a configurable local mode.
8. **DNS lookups for Ollama at startup time leak to the network even if Ollama is at `127.0.0.1`** — this is real; some DNS resolvers query upstream for `localhost`. Mitigation: hardcode `127.0.0.1` not `localhost`.

**Why it happens**

1. **"Local-first" is a brand commitment, not a build-time check.** Without lint, it erodes.
2. **Phase 10 is exploratory and ships v3.0.0.** The brief's local-first promise applies to v2. Phase 10 explicitly opens the door — and the door, once open, is hard to close.
3. **Crash reporting feels innocuous** ("just stack traces"). It's not.
4. **Future maintainers don't read the brief.** Cross-cutting principles need code-level enforcement.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **CI test: outbound network calls are mocked at the test layer; tests that try to make real outbound calls fail.** Vitest + msw or nock at the boundary. | Test setup | Phase 0/1 |
| **Runtime: the MCP server prints its allowed outbound destinations at startup.** v2: `Outbound: localhost:11434 (Ollama)`. v3 with a Notion connector configured: `Outbound: localhost:11434 (Ollama), api.notion.com (notion-api connector "acme")`. User can audit. | `src/server.ts` startup | Phase 1 |
| **No telemetry. No analytics. No crash reporting.** Codified in `CONTRIBUTING.md`; CI grep for `Sentry`, `analytics`, `posthog`, `mixpanel`, `segment` in any new dep. | `scripts/lint-no-telemetry.sh` | Phase 0 |
| **Error messages strip secrets.** Notion token, full file paths (replace `$HOME` with `~`), workspace IDs > 8 chars are elided. Connector contract requires this. | Adapter capability + helpers | Phase 10 (with retroactive helpers in Phase 1) |
| **Phase 10 connectors are *off by default*.** Even if `NOTION_TOKEN` is in env, the connector is not registered unless `config.toml` explicitly enables it. | Connector registry | Phase 10 |
| **No silent fallback to non-local services.** Ollama unavailable → FTS-only mode with a clear warning. Never a remote-embedding fallback. | `src/ollama/client.ts` already supports this; codify with a test. | Phase 1 |
| **Phase 6 ADR on `compile_brief` LLM strategy includes a "no remote LLM" clause** — Ollama only, or caller-passes-text only. Future change requires a new ADR. | `docs/v2/adr/00X-brief-llm-strategy.md` | Phase 6 |
| **Use `127.0.0.1` not `localhost` for Ollama** to avoid DNS leakage on misconfigured resolvers. | `src/ollama/client.ts` config | Phase 1 |
| **README states the local-first guarantee prominently** with the list of allowed outbound destinations. Any future violation is a documented breach. | `README.md` rewrite (Phase 9) | Phase 9 |

**Warning signs**

- A new dep includes a `_telemetry` or `_analytics` directory.
- A new file imports `fetch` and points anywhere other than `127.0.0.1` (or, in Phase 10, the explicitly-configured connector endpoint).
- Error messages include full file paths or workspace IDs.
- A Phase 10 connector is enabled "automatically when token is present."
- A maintainer suggests "let's add opt-in crash reporting."

**Severity:** High — local-first is a brand differentiator and a stated promise. A breach (telemetry slipping in, error leaking PII) damages trust. Recoverable but costly.

**Phase to address:** Phase 0/1 (lint + test infrastructure). Phase 6 (brief-LLM ADR). Phase 10 (connector-off-by-default).

---

## Medium-Severity Pitfalls

Annoying but recoverable.

---

### Pitfall 10: Sub-Agent Context Bloat & Decision Invention

**What goes wrong**

The brief explicitly warns: "When a sub-agent crosses ~60% of its window, tell it to checkpoint." But the deeper failure modes:

1. **Sub-agent re-reads the whole roadmap.** Given a Phase 3 task, the sub-agent reads `docs/dev/gsd-agent-knowledg-layer.md` (the whole brief). Context fills 30% before any code is touched.
2. **Sub-agent invents decisions instead of following ADRs.** ADR-001 says "document IDs are opaque URIs"; sub-agent doesn't read ADR-001 (it wasn't in the brief), invents a different identity scheme, ships it. PR review may or may not catch.
3. **Scope creep within a phase.** Phase 3 sub-agent for `get_outline` notices that `get_document_bundle` has a bug, "fixes it on the way." Now the PR is two features, two test surfaces, two times the review time.
4. **Inconsistent style across sub-agents.** Phase 3a uses `Result<T, E>` discriminated unions; Phase 3b uses `throw new Error()`. Both ship. Phase 4 has to harmonize.
5. **Sub-agent skips the seam-preservation note** because it's at the top of the prompt and they're "just implementing the deliverable."
6. **Sub-agent writes summaries that hide problems.** "Tests pass" doesn't say "I disabled one flaky test." The brief's mandatory completion check ("did I touch any file outside `src/adapters/` that uses file paths…?") catches the structural cases but not behavioral ones.

**Why it happens**

1. **The brief is too long** (~400 lines). A sub-agent given "read the brief, focus on Phase 3" has 400 lines to wade through.
2. **ADRs are gitignored at `docs/dev/`** (per CONCERNS.md — commit `cbed220`). Sub-agents may not find them. Phase 0 explicitly fixes this (relocate to `docs/v2/adr/`).
3. **Sub-agents are stateless across invocations.** They cannot remember "we decided X yesterday."
4. **GSD's dispatch instructions vs sub-agent execution have a gap.** GSD tells the sub-agent "follow ADR-001"; the sub-agent receives the prompt, has not read ADR-001, makes an educated guess.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **Phase 0 priority: relocate ADRs from `docs/dev/` to `docs/v2/adr/`** (gitignored → public). Without this, sub-agents cannot read them. | First Phase 0 PR | Phase 0 |
| **Sub-agent dispatch prompt includes ADR references by path**, not by mention. "Read `docs/v2/adr/001-document-identity.md` before proposing types." Required reading. | GSD dispatch template | Every phase |
| **Sub-agent dispatch prompts include exactly the phase section, not the whole brief.** ~50 lines, not ~400. | GSD dispatch template | Every phase |
| **One-line "you may not invent decisions in these areas" clause per phase** — lists the ADRs whose scope applies. | GSD dispatch template | Every phase |
| **Sub-agent completion summary template is structured** (mandated by brief): `[branch, commit SHA, test pass count, the seam-preservation self-check, any ADR drift, any scope creep, any flaky tests skipped]`. Each field is required. | GSD dispatch template | Every phase |
| **PR review checklist includes "does this PR cross phase boundaries?"** — if Phase 3 PR touches Phase 6 code, that's scope creep, separate PR. | `.github/pull_request_template.md` | Phase 0 |
| **Style harmonization pass at phase transitions** — last PR of each phase is "format and harmonize." Sub-agent given the diff between phase start and phase end, asked to normalize. | Phase transition ritual | Every phase |
| **Cross-phase "what's been decided" doc** updated at phase transition — a short summary of decisions that matter for future phases. Lives at `docs/v2/DECISIONS.md`. | Phase transition deliverable | Every phase |

**Warning signs**

- A sub-agent's PR includes a "type rename" or "refactor" not in the deliverable list.
- Two sub-agents in the same phase have implemented the same helper differently.
- A sub-agent's completion summary skips fields or says "N/A" on the seam check.
- A PR's commit message mentions an ADR that doesn't exist or has a wrong number.

**Severity:** Medium — drift catches up but is recoverable in the next harmonization pass. The cost is review time and minor inconsistencies; severity rises if a sub-agent invents an identity scheme contradicting ADR-001 (then it's Critical).

**Phase to address:** Phase 0 (ADR relocation, dispatch template). Continuous through all phases.

---

### Pitfall 11: ADR Ambiguity — Phase 10 Sub-Agent Cannot Implement Notion from ADRs Alone

**What goes wrong**

The brief's Phase 0 acceptance: "The four ADRs above are explicit enough that a Phase 10 sub-agent — given only those ADRs and Phase 10's brief — could implement a Notion connector without reading any other phase's code."

ADRs 001–004 are written. Failure modes that break this test:

1. **Happy-path examples only.** ADR-001 gives `obsidian-fs://my-vault/projects/Atlas.md` and `notion-api://acme/page/abc-123` as examples. What about: vault names with spaces (`obsidian-fs://My Vault/Note.md`)? Resource paths with `#` or `?` chars (clash with URL semantics)? Unicode? Sub-agent has to guess.
2. **Missing invariants.** ADR-002 says "Phase 1's grep check enforces this" but doesn't enumerate every grep. Sub-agent in Phase 10 may add a new grep ("notion-specific lib outside `src/adapters/source/notion-api.ts`") and have nothing to validate against.
3. **Capability descriptors are typed but not normatively required.** ADR-002 lists `bodyShape: 'blocks' | 'flat-text'` — but doesn't say what `flat-text` means semantically. An RSS connector is `flat-text`? A web-archive is `blocks`? Sub-agent invents.
4. **The hard-isolation question in ADR-004 is open.** "The Phase 2 implementer can choose either default." Phase 10's Notion sink-as-database — must it be a separate workspace, a database within a workspace, what? ADR-004 doesn't say.
5. **The `RawNode` escape hatch (ADR-003) is open-ended.** What does the chunker do with `RawNode.text`? Index it? Ignore it? Different adapters will disagree.
6. **The `EmbedNode.target_id` "DocId or string" ambiguity.** When does it become a DocId? At parse time? At resolution time post-index? ADR-003 says "DocId if resolvable, raw string if not" — but resolution is async.
7. **The DocId migration's `path` column lifecycle.** ADR-001 says "removed in v3.0.0." Phase 10 (v3.0.0) — does the sub-agent run the column-drop migration? Where's that migration's spec?
8. **Capability descriptors lie.** ADR-002 notes "An adapter that lies about `atomic: true` and then loses writes will erode trust quickly." Phase 10 mandates "a capability-contract test suite each adapter must pass." What does that suite check? Spec missing.

**Why it happens**

1. **ADRs are written by one author with a coherent model in their head.** A second reader misses what the author considered obvious.
2. **"Locked-in audit" is the explicit Phase 0 acceptance criterion** but in practice means "I read them and they seem fine." Real test: a sub-agent attempts implementation from ADRs alone.
3. **Open follow-ups are noted but not closed.** ADR-004 has "Sink contracts as code vs as YAML" (open). Phase 10 needs this resolved or the Notion sink contract is up to the implementer.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **"Adversarial ADR review" sub-agent**: at end of Phase 0, dispatch a sub-agent with *only* the four ADRs and Phase 10's brief. Task: "Produce a Notion connector implementation plan. Flag every ambiguity." The flagged ambiguities go back to ADR amendments. | Phase 0 final deliverable | Phase 0 |
| **Each ADR has an explicit "Invariants" section** listing every property core code can rely on. Not just decisions, but invariants. E.g. ADR-001: "Every DocId begins with `<lowercase-scheme>://`." | ADR template | Phase 0 |
| **Each ADR has an "Examples" section with edge cases** — names with spaces, names with Unicode, URLs with query params, empty resources, paths longer than 255 chars, identity-stable vs unstable, … | ADR template | Phase 0 |
| **Open follow-ups are closed before Phase 10 starts** (or explicitly marked "Phase 10 must resolve as ADR-N before any implementation"). | Pre-Phase-10 audit | Phase 9/10 gate |
| **Capability descriptor semantics are normative**: for each capability value, a one-paragraph definition + an example of an adapter that has and doesn't have it. | `docs/v2/adr/002-source-and-delivery-seams.md` | Phase 0 amendment |
| **Adapter conformance test suite** spec-out in Phase 1: any adapter must pass these N tests (DocId round-trips, hash determinism, change event order, capability honesty). Suite exists from Phase 1 with one impl (obsidian-fs); Phase 10's Notion adapter must pass without modification. | `src/adapters/conformance.test.ts` | Phase 1 |

**Warning signs**

- An ADR's "Open follow-ups" section grows over time without entries getting closed.
- An ADR's examples are all happy-path.
- A Phase 10 implementer asks "what does X mean?" — that's an ADR gap.
- The "adversarial review" sub-agent flags >5 ambiguities — ADRs need a revision pass.

**Severity:** Medium for v2.0.0 (the ADRs don't have to be perfect for v2 itself, which ships only obsidian-fs). High for v3.0.0 launch — ambiguous ADRs cause Phase 10 to spend half its budget closing them, which the brief explicitly tries to avoid.

**Phase to address:** Phase 0 primarily (ADR amendments and adversarial review). Phase 1 (conformance suite). Phase 9/10 gate (final audit before Phase 10 opens).

---

### Pitfall 12: Eval Fixture Privacy & Realism Tension

**What goes wrong**

The fixture vault is 50–100 notes per Phase 0. Failure modes:

1. **Maintainer accidentally commits a personal note.** Easy: `evals/fixtures/v2-test-vault/2024-Q4-Strategy.md` looks innocuous but contains real internal info.
2. **Fixture is too synthetic to catch real bugs.** All notes have identical structure, perfect frontmatter, no broken links. The system passes evals; real Obsidian vaults are messy; users hit bugs the fixture couldn't trigger.
3. **Fixture is too small.** 50 notes does not exercise: per-model embedding tables at scale, large frontmatter-property cardinality, deeply nested folders, notes with 100+ wikilinks, notes with no content.
4. **Fixture is not realistic for the assembly use cases**: no "people" notes that look like real CRM-style person pages; no project notes with status updates over time; no decisions log with `superseded-by` references.
5. **Fixture has only Markdown** — no Canvas files (Phase 8 untested in eval); no images; no attachments; no Datacore code blocks (per CONCERNS.md's `001-datacore-sidecar-indexing`).
6. **Fixture has no `_memory/` subset until Phase 2 adds one.** Phase 2's eval requires diverse provenance — but the brief says "20-document `_memory/` subset with diverse provenance labels." Risk: 20 docs in a 50-doc fixture is 40% memory — unrealistic; users have <5% memory by volume in real vaults.
7. **Hand-labeled queries are skewed to "things that work."** Maintainer labels what's easy to verify, skipping ambiguous queries that are the real failure mode.
8. **Fixture isn't versioned coherently.** Phase 3 adds 10 notes; Phase 5 adds 10 more; Phase 7 adds 10 more. By Phase 9 the fixture is incoherent — different naming conventions, different frontmatter styles, no narrative.

**Why it happens**

1. **Privacy and realism are in tension.** Real-looking notes require fiction. Fiction takes time to write.
2. **Hand-labeling is expensive — maintainer labels what's quick.**
3. **No "fixture review" is in the phase checklist.**
4. **The fixture lives in git** so any commit can leak private content.

**How to avoid — concrete prevention**

| Guardrail | Where it lives | Phase |
|-----------|----------------|-------|
| **The fixture is a single coherent narrative** — a fictional small company "Atlas Robotics" with named people, projects, meetings, decisions. Notes reference each other. The README explains the world. | `evals/fixtures/v2-test-vault/README.md` | Phase 0 |
| **A "private-content-detector" CI check**: greps the fixture for patterns that look private (email addresses other than `@atlas-example.com`, real names from a known list, paths to home directories, etc.). Blocks merge on hit. | `scripts/check-fixture-privacy.sh` | Phase 0 |
| **Fixture grows by addition, not edit-in-place** — each phase's additions live in a phase-named subfolder (`evals/fixtures/v2-test-vault/phase-3/`) if they don't fit the existing narrative. Or, phase additions extend the narrative (new project, new person) in coherent ways. | Phase transition deliverable | Phases 3, 5, 6, 7 |
| **Fixture explicitly includes "trap" notes** (per Pitfall 8): broken links, frontmatter typos, empty notes, notes with 100+ wikilinks, notes with Unicode/spaces/special chars in titles, notes with property values that look like DocIds but aren't. Documented in fixture README. | Phase 0, additions per phase | Phases 0, 4, 5 |
| **A second fixture pulled from an open, MIT-licensed real-world vault** (e.g. a public Obsidian publish vault from a researcher who's published their notes). Tests realism against the synthetic Atlas vault. | `evals/fixtures/real-world-sample/` | Phase 6 or 9 |
| **Eval scenarios reference the narrative**: "Alice asked Bob about the Atlas project in last week's standup — find what Alice said about the failing servo." This forces realism in both query design and fixture content. | `evals/scenarios/` | Phase 3 onward |
| **Phase 9 polish includes a fixture audit**: read every note in order, check coherence, fix drift. | Phase 9 deliverable | Phase 9 |

**Warning signs**

- Fixture commit logs include the maintainer's email or hostname in metadata.
- Fixture note has `(actually replace this with my real X note)` placeholder text.
- Fixture's frontmatter has different styles across notes (some `tags:`, some `tags-list:`, etc.).
- Eval queries are abstract ("find documents containing X") rather than narrative ("find what we decided about X").

**Severity:** Medium. A leaked private note is embarrassing but recoverable (rotate the fixture, git-filter-branch). A too-synthetic fixture is the eval-drift root cause and merges with Pitfall 8.

**Phase to address:** Phase 0 (narrative, privacy detector). Phase 6/9 (real-world sample, audit).

---

## Technical Debt Patterns

Shortcuts that may seem reasonable mid-roadmap but create long-term cost.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Pass `path` through new tools alongside `doc_id` "for convenience" | Saves a translation in caller code | Every new tool has a leaky `path` parameter; Phase 10 cannot satisfy it | Never in Phase 1+; v1 tools keep `path` for compat per ADR-001 |
| Skip the stub-connector eval test "because we only have obsidian-fs" | Saves 2 hours in Phase 3 | Adapter seams unverified; Phase 10 starts from "let's see if it works" | Never; the brief mandates it as Phase 3 acceptance |
| Inline a feature flag rather than configure | Faster ship | Flag becomes permanent; config grows organically | Acceptable for spike code (Phase 5 cluster opt-in is OK); not for shipping features |
| Skip migration backup before adding `doc_uri` column | Faster Phase 1 | A bad migration in production corrupts a user's vault | Never for schema migrations affecting existing data |
| Use `localhost` instead of `127.0.0.1` | One fewer concern | DNS leakage on some resolvers; potential privacy violation | Never; trivial fix |
| Defer the Phase 0 "ADRs locked-in audit" | Faster Phase 0 wrap-up | Phase 10 sub-agent invents decisions; v3 ships with contradictions | Never; this is the gate the brief mandates |
| Hardcode tool defaults in Phase 4 (`recency_weight = 0.1`) | "Feels right" out of box | v1 default behavior breaks; backwards-compat regression | Never; defaults must be inert |
| `compile_brief` calls Ollama without an ADR | Faster Phase 6 | Local-first principle eroded without explicit decision | Never; ADR is mandated by the brief |
| Skip the per-tool "Use when / Do NOT use for" line in descriptions | 30 minutes saved | Agent tool-selection accuracy degrades 3× per 2026 MCP research | Never for new tools |
| Let the fixture grow without curation | No phase-transition overhead | Fixture incoherent by Phase 9, evals untrustworthy | Never; curate at every phase transition |

## Integration Gotchas

Common mistakes connecting to external services that vault-memory touches.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Ollama (`localhost:11434`) | DNS lookup for `localhost` leaks to network on some resolvers | Use `127.0.0.1` literal; document in `src/ollama/client.ts` |
| Ollama | Block forever if Ollama is down | Timeout + clear error + FTS-only fallback (already in v1); no remote fallback |
| chokidar | Watch the full vault path including hidden directories | Honor `path_exclude_glob`; explicitly exclude `.git`, `.obsidian`, `.trash`, `_memory` from re-index events; respect the Phase 1 adapter boundary |
| sqlite-vec | Pass `Float32Array` directly instead of `JSON.stringify(v)` | The latter is current; CONCERNS.md flags it; switch to binary in a perf pass |
| Obsidian Canvas (Phase 8) | Treat `.canvas` JSON as a stable format | It's not; tolerate unknown keys; pass them through `meta.canvas-extra` |
| Notion API (Phase 10) | Page-level timestamps as the only change signal | Use them as a coarse trigger; verify with block-level reads; document the granularity in the connector capability |
| Notion API | Rate-limit mid-index, lose progress | `IndexRunResult` must express partial progress; resume from checkpoint |
| Notion API | Treat `relation` properties as opaque strings | Map to `PropertyValue { type: 'reference' }` per ADR-003; resolve to DocId where possible |
| MCP clients (non-Claude) | Assume Claude-specific behavior (default `client_id`, tool ordering) | `DEFAULT_CLIENT_ID = "claude-code"` already a known issue; tool surface must be agent-agnostic |
| MCP `tools/list` | Tool descriptions ballooning to >300 tokens | Token-budget CI test; "Use when / Do NOT use for" lines mandatory |

## Performance Traps

Patterns that work at small scale but fail with real vaults.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Brief staleness daemon scans all briefs on every change | High CPU on busy vaults | Index briefs by source DocId; daemon does targeted lookups | >50 briefs in a single sink |
| `assemble_dossier` walks the entire graph for every call | Slow first-call latency | Cache dossier shape per `(type, key)` with hash-invalidation on source change | >1000 nodes touched per call |
| Tool surface bloat doubles agent context | Slow agent loops, high costs | Tool-token budget CI; deferred tool loading via MCP `resources`; consolidate list-style ops | 30+ tools |
| Per-PR full eval suite (5+ min) skipped under pressure | Drift accumulates | Fast subset (≤30s) blocking; full suite on phase merge | Eval suite runtime >2 min |
| Fixture vault grows past 100 notes without index optimization | Slow eval runs | Memory-vault tests use `:memory:` SQLite; eval indexes are pre-built | Fixture >200 notes |
| Per-model embedding tables accumulate after `switch_active_model` | DB file bloat (CONCERNS.md) | `vacuum_embeddings` cleanup phase drops empty tables | After 3+ model switches |
| Notion polling for change detection (Phase 10) hammers the API | Rate limit | `ChangeFeed.notion-api` enforces a poll interval; capability descriptor exposes `pollIntervalMs` | Continuous polling at <60s intervals |
| Brief `compiled_from` walks transitively through edges | Brief compile slow, OOM possible | Cap depth; document the cap in `compile_brief` description | >100 docs in source set |

## Security Considerations

Domain-specific issues beyond OWASP basics.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Sink-handle parser accepts arbitrary URIs | Memory writes go to a user content folder | Sink handles must resolve to a configured sink in registry; reject unknown handles; sentinel `.memory-sink` file |
| Path-traversal in sink handle's resource part (`../../../etc`) | Write outside vault | `safeJoinInsideVault` already in v1 — ensure all delivery paths use it; covers traversal inside vault content too |
| Error messages echo full file paths | Discloses user home dir + vault structure | Replace `$HOME` with `~`; truncate workspace IDs (>8 chars elided); avoid embedding tokens in errors |
| `config.toml` writes (`src/config/add-vault.ts`) lack boundary check | Config file written outside expected location | CONCERNS.md flags this; add a boundary check equivalent to `safeJoinInsideVault` for config writes |
| ONNX reranker model path unchecked (CONCERNS.md) | `existsSync` probes arbitrary paths | Validate model path is inside a known cache directory before probing |
| Notion API token in environment (Phase 10) leaked to error logs | Token in a bug report | Token redaction in all log/error paths; CI test that asserts no env-var values appear in error messages |
| Memory-sink contract validation skipped on `update` (only on `write`) | Property mutation bypasses contract | `DeliveryAdapter.update()` runs contract validation on the merged result, not just the patch |
| Audit log can be tampered with by `delete_note` | Loss of forensic trail | Audit log is append-only; deletes record a tombstone, never remove the row |
| Cross-source references (`evidence: [notion-api://...]` in obsidian memory) point at non-existent docs | Dangling reference | Optional resolver at write-time (warn if unresolvable); always resolve at read-time |

## UX Pitfalls

Common UX mistakes in agentic-knowledge-layer products.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Memory namespace invisible — user doesn't know agents wrote anything | Trust erosion when notes "appear" | `_memory/` folder visible by default in Obsidian; `memory_stats` tool surfaces counts; CHANGELOG entries when memory grows |
| Briefs stale-by-default looks like a bug | Users assume the system is broken | `get_brief` returns stale briefs with `stale: true` tag and a list of changed sources — not just `null`; user (or agent) chooses to recompile |
| Citation packets too verbose | UI clutter | Compact form by default (`title + short-doc-id`); full form on request |
| Tool description marketing-speak ("blazingly fast search") | Agent confusion + maintainer credibility | Plain technical descriptions per `RULES.md` Professional Honesty rule |
| Sink-handle URIs in user-facing errors | "What's `obsidian-fs://my-vault/_memory`?" | Translate to sink `name` in errors; full handle on `--verbose` |
| `_memory/` folder syncs to user's mobile Obsidian via Obsidian Sync | Battery drain, sync conflicts | Document "exclude `_memory/` from Obsidian Sync" in setup guide |
| Contract authoring requires editing YAML | Not all users author YAML | Phase 8 Canvas editor; CLI scaffolder (Phase 8 deliverable) for non-Canvas users |
| Setup requires both Ollama install and SQLite-vec ext | Friction | `vault-memory install` skill checks both, prints clear fixes |
| User edits a memory document by hand; agent doesn't notice | Memory contract violation discovered later | DeliveryAdapter watches the memory sink too; emits a warning when human edits a memory doc without going through `supersede` |

## "Looks Done But Isn't" Checklist

Verify each before declaring a phase complete.

- [ ] **Phase 1 adapter extraction:** All grep checks (`chokidar`, `gray-matter`, `path.*`, `obsidian://`) pass — verify on `main` not just the PR branch; CI runs continuously
- [ ] **Phase 1 adapter extraction:** Non-Claude MCP client smoke test runs successfully — verify against MCP Inspector specifically
- [ ] **Phase 2 memory namespace:** Guards A and B live at the `DeliveryAdapter` layer, not just in the tool handlers — verify by reading the adapter code
- [ ] **Phase 2 memory namespace:** Eval scenario "agent ignores `record_observation`, calls `write_note` directly with `source: agent`" — verify the eval exists and passes
- [ ] **Phase 3 bundles:** Stub-connector eval passes — verify the stub adapter is not a re-export of obsidian-fs
- [ ] **Phase 3 bundles:** Citation packet on every result includes both `doc_id` *and* `display_url` — verify both are present, not one or the other
- [ ] **Phase 4 authority/staleness:** v1 default behavior unchanged when weights are absent — verify by running v1 eval set with no `recency_weight` parameter
- [ ] **Phase 5 graph-as-retrieval:** Edge types stored, queryable, and `expand({edge_types: [...]})` actually filters — verify the SQL query touches the `type` column
- [ ] **Phase 6 briefs:** Staleness daemon survives restart — verify the startup-replay logic exists
- [ ] **Phase 6 briefs:** Brief flips stale on a frontmatter-only change — verify the hash covers properties, not just body
- [ ] **Phase 7 contracts:** Reference contracts use variable handles (`{{default_source}}`), not concrete handles
- [ ] **Phase 7 contracts:** Override mechanism is exercised by a test that points a contract at the stub connector
- [ ] **Phase 8 Canvas:** Round-trip works on a canvas with non-trivial layout (hand-arranged nodes) — verify on at least three sample canvases
- [ ] **Phase 8 Canvas:** Canvas-watcher does not infinite-loop on no-change save
- [ ] **Phase 9 release:** v1 eval suite passes — verify the *frozen* v1 eval set, not a re-derivation
- [ ] **Phase 9 release:** Migration guide documents every backwards-compat-relevant change; snapshot tests align
- [ ] **Phase 9 release:** No telemetry — grep for `analytics`, `Sentry`, `posthog`, etc. in `package.json` deps and lockfile
- [ ] **Phase 9 release:** Outbound destinations enumerated at server startup — verify only `127.0.0.1:11434`
- [ ] **ADR audit (Phase 0/9 gate):** Adversarial review sub-agent produces zero blocking ambiguities — verify the review ran and findings closed
- [ ] **Cross-cutting:** Every new tool has "Use when / Do NOT use for" lines — verify token-budget CI passes

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Adapter seam erosion discovered in Phase 6 | MEDIUM | Pause new features. Phase 6.5 cleanup PR: re-run all greps, identify all leaks, fix each. Cost: 1–2 weeks. |
| Adapter seam erosion discovered at Phase 10 entry | HIGH | Phase 10.0 cleanup phase (per the brief's premise check). 2–4 weeks before any Notion code. |
| Memory namespace contamination in production | HIGH | Identify all agent writes outside `_memory/` via `audit_log`; offer migration tool that moves them to the sink with retroactive provenance; ship a v2.0.1 with hardened guards; communicate publicly. |
| Backwards-compat regression in shipped v2.0.0 | MEDIUM | Hotfix v2.0.1 reverting the offending default change; document in CHANGELOG; tighten snapshot-test coverage to prevent recurrence. |
| Brief staleness over-fires | LOW | Tune hash inputs; ship as v2.x.y. |
| Brief staleness under-fires | MEDIUM | Add chunk-level hashing; migration to update existing brief property shapes; ship as v2.x. |
| Contract portability leak (concrete handles in reference contracts) | LOW | Rewrite reference contracts to variables; migration note. |
| Canvas round-trip fails after release | LOW | Document workaround ("edit YAML directly for now"); add tests; fix in v2.x. |
| Tool surface bloat / agent confusion | MEDIUM | v2.1.0 consolidation: promote list-style ops to MCP `resources`; rewrite descriptions; deprecate (don't remove) redundant tools. |
| Eval drift discovered post-release | MEDIUM | Re-label fixture; re-run; identify regressions; backport fixes. |
| Local-first violation (telemetry slips in) | HIGH | Immediate revert; root-cause analysis; CI gate added; public communication. |
| Sub-agent invented decision contradicting an ADR | LOW–MEDIUM | Revert PR; ADR amendment if the invention had merit; re-dispatch with explicit ADR reference. |
| ADR ambiguity blocks Phase 10 implementation | MEDIUM | ADR amendment + adversarial-review-sub-agent run on amendments; Phase 10 unblocks once review is clean. |
| Eval fixture leaks private content | HIGH | `git filter-repo` to scrub history; rotate any exposed secrets; fixture audit; public communication. |

## Pitfall-to-Phase Mapping

How the roadmap phases should address each pitfall.

| Pitfall | Prevention Phase(s) | Verification |
|---------|---------------------|--------------|
| 1. Adapter seam erosion | Phase 1 (install CI greps, brand DocId, stub adapter); continuous through Phases 2–9; pre-Phase-10 gate | CI grep zero hits on `main`; stub-adapter eval green every PR |
| 2. Memory namespace contamination | Phase 0 (folder-vs-vault ADR amendment), Phase 2 (centralize guards at adapter; eval scenarios) | Eval suite includes 4 contamination scenarios; all green |
| 3. Backwards-compat regression | Phase 0/1 (snapshot tests, v1 eval baseline), Phases 2–9 (maintain) | Snapshot tests run every PR; v1 eval set passes every PR |
| 4. Staleness false negatives | Phase 0 (hash semantics ADR amendment), Phase 6 (chunk-level hashing, daemon restart-replay) | Phase 6 acceptance + 4 eval scenarios (frontmatter change, rename, race, restart) |
| 5. Task-contract portability | Phase 7 (lint, variable handles in reference contracts), Phase 8 (Canvas emits portable) | Phase 7 stub-connector override test green |
| 6. Canvas round-trip loss | Phase 8 (semantic-equivalence definition, hash-gated watcher, spike-first) | Phase 8 spike acceptance + three sample canvases byte-equal after canonicalization |
| 7. MCP tool surface bloat | Phase 1 (token-budget CI), Phase 2 (tools-vs-resources decision for list ops), every phase ≤4 new tools, Phase 9 (agent guide) | Token-budget CI green; tool-selection eval scenarios ≥80% accuracy |
| 8. Eval drift | Phase 0 (foundation, narrative fixture, scoring), Phase 3 (stub-connector parity), Phase 9 (trend chart, audit) | Fast subset blocks every PR; full suite on phase merge; trend chart in v2.0.0 release notes |
| 9. Local-first promise erosion | Phase 0/1 (telemetry lint, outbound destination print), Phase 6 (brief-LLM ADR), Phase 10 (off-by-default connectors) | Startup banner enumerates `127.0.0.1:11434` only; no `Sentry`/`analytics` deps |
| 10. Sub-agent context bloat | Phase 0 (ADR relocation, dispatch template); continuous | Dispatch template used every spawn; ADRs readable from `docs/v2/adr/` |
| 11. ADR ambiguity | Phase 0 (adversarial review, Invariants + Examples sections), Phase 1 (conformance suite), Phase 9/10 gate | Adversarial-review sub-agent flags zero blocking ambiguities pre-Phase-10 |
| 12. Eval fixture privacy & realism | Phase 0 (narrative, privacy CI), Phase 6/9 (real-world sample, audit) | Fixture-privacy CI green; narrative README; phase additions reviewed at transition |

## Sources

- [v2 brief — `docs/dev/gsd-agent-knowledg-layer.md`](docs/dev/gsd-agent-knowledg-layer.md) — explicit Risk and Decision sections per phase; cross-cutting principles
- [ADR-001 Document Identity — `docs/dev/001-document-identity.md`](docs/dev/001-document-identity.md) — identity-stability cap descriptors; migration strategy; alternatives considered
- [ADR-002 Source & Delivery Seams — `docs/dev/002-source-and-delivery-seams.md`](docs/dev/002-source-and-delivery-seams.md) — interface specs; capability descriptors; CI grep enforcement
- [ADR-003 Document Shape — `docs/dev/003-document-shape.md`](docs/dev/003-document-shape.md) — `Document`/`BlockNode`/`Edge`/`PropertyBag`; `RawNode` escape hatch
- [ADR-004 Memory Sink Handles — `docs/dev/004-memory-sink-handles.md`](docs/dev/004-memory-sink-handles.md) — sink handles; MemoryContract; folder-vs-vault open question
- [v1 codebase concerns — `.planning/codebase/CONCERNS.md`](.planning/codebase/CONCERNS.md) — existing leaks (`obsidianUrl()`, `DEFAULT_CLIENT_ID`, `gray-matter` in write, `.obsidian/**` hardcode, `.claude/**` exclude); concrete examples of how seams erode
- [v1 testing posture — `.planning/codebase/TESTING.md`](.planning/codebase/TESTING.md) — vitest, 360 tests, co-located, no fixture files yet; informs how the eval fixture and snapshot tests should be structured
- [MCP Compression: Preventing tool bloat in AI agents (Atlassian, 2026)](https://www.atlassian.com/blog/development/mcp-compression-preventing-tool-bloat-in-ai-agents) — tool-selection accuracy collapse 43% → <14% with bloat; mcp-compressor 70–97% description reduction
- [How to Prevent MCP Tool Overload (Lunar.dev, 2026)](https://www.lunar.dev/post/why-is-there-mcp-tool-overload-and-how-to-solve-it-for-your-ai-agents) — tool groups, scoped access, deferred loading patterns
- [The MCP Context Window Problem (Junia.ai, 2026)](https://www.junia.ai/blog/mcp-context-window-problem) — 72% context consumed by tool definitions before work begins
- [10 strategies to reduce MCP token bloat (The New Stack, 2026)](https://thenewstack.io/how-to-reduce-mcp-token-bloat/) — practical token-budget patterns
- [The Leaky Abstraction Anti-Pattern (masarbi.com)](https://masarbi.com/post/what-is-the-leaky-abstraction-anti-pattern-in-software/) — adapter exposing implementation details; refactoring strategies
- [Building an Optimal MCP Server: Consolidation Over API Bloat (DevJournal, 2026)](https://earezki.com/ai-news/2026-04-04-building-an-optimal-mcp-server-why-you-only-need-five-core-endpoints/) — consolidation principle; design-first heuristic

---
*Pitfalls research for: vault-memory v2 agentic knowledge layer over Obsidian via MCP*
*Researched: 2026-05-14*
