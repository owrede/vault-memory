# Phase 5: Compiled brief layer - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Defeat the "agents rediscover 85% of context every run" failure mode by shipping compiled briefs as first-class `Document`s in `_memory/_briefs/` with **deterministic chunk-level source-hash staleness propagation**. This is vault-memory's signature v2 differentiator. Phase 5 lands six concrete surfaces:

1. **`compile_brief` MCP tool** (BRF-01, BRF-03) — `compile_brief({target, source_doc_ids, purpose, max_tokens})`. Caller-supplied sources only (D-01). Resolves LLM via the **capability-first ladder** (D-10): MCP Sampling → local Ollama (per-vault `[brief.ollama]` config) → caller-passed `prepared_text` → structured error. Writes routed through `DeliveryAdapter` (Phase 2 invariant). Returns the new brief's opaque `DocId`. On `target` collision, auto-supersedes the prior brief via Phase 2 `supersede()` (D-12) — new brief gets a timestamped slug, old brief gets `status: superseded` + `superseded_by`.

2. **`get_brief` MCP tool** (BRF-04) — `get_brief({target, max_age_days?, allow_stale?})`. **Staleness dominates; age is independent** (D-13): if `status: stale` AND NOT `allow_stale` → `{stale: true, changed_sources: [...], brief: null}`; if `compiled_at > max_age_days` ago AND NOT `allow_stale` → `{stale: false, too_old: true, brief: null}`; else → the brief. Null brief = caller must recompile.

3. **`list_briefs` MCP Resource** (BRF-09) — discovery of briefs by `target?`. Promoted from Tool to MCP Resource (Phase 3 ASM-13 + Phase 4 sign-off decision).

4. **Content-stable ChunkId identity** (ADR-003 H-5; D-04, D-05) — `ChunkId = <DocId>#chunk-<n>` where `<n>` is the **first 7 hex chars of the chunk's content hash** (sha256 of NFC-normalized chunk text). Stored on the `chunks` table as a new `chunk_id_fragment TEXT NOT NULL` column (migration 012). Editing unrelated chunks no longer churns ChunkIds → no spurious brief invalidations.

5. **Staleness daemon** (BRF-05, BRF-06, BRF-07, BRF-08) — runs **in-process at MCP server boot** (D-07) alongside the existing `VaultWatcher`. Subscribes via `ChangeFeed.subscribe()`. Single-owner enforced by `~/.vault-memory/locks/<vault>.lock`. On lock contention, second `serve` boots **without** the daemon and **logs a structured WARN** (D-08) — multi-MCP-client friendly. Replay strategy is **hybrid** (D-09): startup full scan (correctness floor) + DB-resident cursor `daemon_state(vault_name, last_seen_doc_mtime)` for steady-state efficiency. Rename events preserve brief→source links per BRF-08 (planner verifies obsidian-fs `ChangeFeed` rename-handling — today rename surfaces as unlink+add per Phase 1 D-? `ChangeFeed types.ts:18`).

6. **`brief_sources` reverse-index table** (D-06) — migration 012 ships `brief_sources(brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash)` with indexes on `(chunk_doc_id)` and `(chunk_id_fragment)`. Populated on brief write; rows removed on brief delete/supersede. Staleness check on a `ChangeEvent` is O(log N) lookup instead of O(B·S) scan of every brief's `source_hashes` property.

7. **Eval coverage** (BRF-10, BRF-11) — both (D-02): `_queries/briefs-curated.yaml` (hand-curated source_doc_ids per query; decouples brief-layer eval from graph-layer correctness) AND `_queries/briefs-from-cluster.yaml` (pipeline integration: `cluster()` → `compile_brief`). The 20-document staleness scenario also runs against the stub `ChangeFeed` to prove source-neutrality (BRF-11).

**Brief body shape** (D-11) — plain markdown body with inline `[[wikilinks]]` to each cited source. The LLM-compile prompt MUST instruct emission of `[[Note Title]]` for each `source_doc_id`; a validator at write time appends a `## Sources` footer with the missing wikilinks if any cited source is unreferenced — guaranteeing Phase 4 D-02 indexer creates the `brief → source` back-edges automatically.

**Phase 5 ADR (BRF-02)** — must be authored BEFORE implementation (Phase 0 / Phase 2 / Phase 4 pattern). Documents: capability-first ladder (D-10), prompt template constraints (wikilink emission), `source_hashes` contract (re-references ADR-003 H-5), no remote LLM SDK bundling.

Phase 5 sits at L4 (memory + compiled artifacts) per `docs/v2/ARCHITECTURE.md` — consumes Phase 3 citation packets, Phase 4 graph primitives (caller orchestrates), Phase 2 supersede + MemorySink writes, Phase 1 `DeliveryAdapter` + `ChangeFeed` seams. **No assumption Phase 4 cluster/expand are part of `compile_brief`** — they live in the agent's orchestration layer, made formal in Phase 6 contract DSL.

**Operating environment (inherited)** — few expert users collaborating on a shared Obsidian vault via Syncthing / iCloud / git-sync; multiple MCP clients (Claude Code + ChatGPT + Inspector) may attach to the same `vault-memory serve`. Implications for Phase 5: (a) content-stable ChunkIds survive sync substrate's eventual-consistency edits; (b) lock contention is the multi-client norm, not the exception (D-08); (c) brief writes are routed through `DeliveryAdapter` so collaborators see the brief through their MemorySink the same way.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-18): four gray areas were presented and all four selected. Eleven sub-decisions D-01..D-13 below are locked. The user accepted the recommended option on all but two — D-02 (eval coverage, picked "both" over "hand-curated only") and D-09 (replay cursor, picked "hybrid" over "mtime-based") — both upgrades to defense-in-depth.

### Source Discovery API

- **D-01: Caller-supplied sources only.** `compile_brief({target, source_doc_ids, purpose, max_tokens})` verbatim per BRF-03. Agents (or Phase 6 contracts) orchestrate `cluster()` / `expand()` / `search_hybrid` upstream and pass the deduped `DocId[]`. Brief layer is a pure compiler. Phase 6 contract DSL formalizes auto-discovery declaratively — Phase 5 does not bake a discovery heuristic into v2.0.0. The Phase 4 sign-off note ("brief compiler will use cluster() over _memory + expand()") describes the **calling pattern**, not the brief-layer API.
  - **Rationale (rejected alternatives):** Auto-discover (option B) bakes a discovery heuristic into v2.0.0 that's harder to override, harder to eval (BRF-10 ambiguity), and conflicts with Phase 6's intended role. Overloaded API (option C) makes BRF-10 ambiguous about which path is being tested. Named helper (option D) adds a tool to a budget already tight (REL-08 ≤32 tools with Resources promotion).

- **D-02: Eval coverage = BOTH curated AND pipeline.** Ship two YAMLs under `evals/fixtures/v2-test-vault/_queries/`:
  - `briefs-curated.yaml` — hand-curated `source_doc_ids: DocId[]` per query for the 20-document Atlas Robotics project. Decouples brief-layer correctness from Phase 4 graph-layer correctness. Primary BRF-10 gate.
  - `briefs-from-cluster.yaml` — calls `cluster({seed: target_doc_id})` first, then feeds the cluster's members to `compile_brief`. Tests the realistic agent calling pattern. Secondary integration eval.
  - **Plus** `briefs-staleness-stub.yaml` for BRF-11 (same staleness scenario against the stub `ChangeFeed` — source-neutrality proof).
  - Departure from recommended (option A "hand-curated only"). Cost: ~30% more eval curation in Phase 5; payoff: a graph regression that masquerades as a brief regression gets isolated immediately.

- **D-03: `compile_brief` input handling — Claude's discretion (planner lean).** Recommendation lean: dedupe `source_doc_ids` on input (cheap, surprising if not); soft cap at 50 sources with a structured error `{ok: false, reason: "too_many_sources", limit: 50, hint: "pass max_tokens to bound brief size"}`. Researcher/planner verify the 50 floor against Atlas Robotics; bump if BRF-10 demands ≥60. Hard cap is preferable to a silent truncation — predictable contract.

### ChunkId Identity & Staleness Substrate

- **D-04: ChunkId = `<DocId>#chunk-<n>` where `<n>` = first 7 hex chars of `sha256(NFC(chunk_text))`.** Per ADR-003 H-3 (NFC normalization) and ADR-003 H-5 (chunk-level source_hashes). Editing the top of a 50-chunk note shifts no ChunkIds for unedited chunks — only modified chunks get new IDs. Briefs citing unchanged chunks stay fresh. Collision risk at 7 hex chars (~268M combos) is acceptable at document scope (worst-case ~thousands of chunks per doc).
  - **Rationale (rejected alternatives):** Ordinal `<n>` (option B) makes a paragraph insert at top of doc invalidate every downstream brief — defeats chunk-level granularity. Section-anchor compromise (option C) doesn't help in mid-section edits. Hybrid section+hash (option D) bloats ChunkId for marginal diagnosability gain; the chunk hash alone is enough.

- **D-05: `chunks.chunk_id_fragment TEXT NOT NULL` column** added via migration 012. Populated by the chunker at insert time (`src/chunker/` — sha256 of NFC-normalized chunk text, take first 7 hex). `chunks.chunk_id` (INTEGER PRIMARY KEY) stays as the DB-internal foreign-key target. The public ChunkId surfaced in `source_hashes`, `recall` results, etc. is built as `${chunks.doc_uri}#chunk-${chunks.chunk_id_fragment}`. Backfill: migration 012 computes the fragment for every existing chunk row in a single pass (matches `runMigration008` chunked pattern at `src/db/schema.ts:638`).

- **D-06: `brief_sources` reverse-index table** in migration 012 — `brief_sources(brief_doc_id TEXT, chunk_id_fragment TEXT, chunk_doc_id TEXT, recorded_hash TEXT, UNIQUE(brief_doc_id, chunk_id_fragment))`. Indexes on `(chunk_doc_id)` and `(chunk_id_fragment)`. Populated when a brief is written via `compile_brief` (one row per chunk in the brief's `source_hashes` map). Rows deleted on brief delete or supersede (Phase 2 D-04 forward-only supersede leaves the row intact on the superseded brief — but daemon stops marking superseded briefs stale per Phase 3 D-08 default `superseded` filter). Staleness check on `ChangeEvent` for `doc_id D`: `SELECT brief_doc_id FROM brief_sources WHERE chunk_doc_id = D AND recorded_hash != (current chunk hash for chunk_id_fragment)` → O(log N) lookup.

### Daemon Lifecycle & Process Model

- **D-07: Daemon runs in-process at `vault-memory serve` boot.** Coroutine alongside the existing `VaultWatcher` (`src/watcher/watcher.ts`). One Node process per MCP session; one lifecycle to manage. Piggybacks on the `ChangeFeed.subscribe()` the watcher already runs for live indexing — daemon registers its own handler on the same feed (per `src/adapters/change-feed/types.ts` `subscribe()` semantics; multiple handlers fan out per `Disposable` contract).
  - **Rationale (rejected alternatives):** Separate `daemon` CLI (option B) breaks the default-experience story; users would have to start two processes. Opt-in via config (option C) makes staleness the brief layer's reason-for-existing default-off — bad UX for the signature differentiator.

- **D-08: Lock contention → second server starts WITHOUT daemon + logs structured WARN.** Lock at `~/.vault-memory/locks/<vault>.lock` is acquired by first server's daemon. Second `vault-memory serve` boots normally (search/read/write all work; daemon does not start); logs `WARN: brief staleness daemon already owned by PID <N> — briefs will be marked stale only by the other process`. The MCP `tools/list` envelope is identical; only behavior differs is that staleness invalidations propagate via the first server. Recommend Claude's discretion lean: **stale-lock detection** — if the recorded PID is dead (kill(0, pid) fails on POSIX) the second server may take ownership. Planner verifies POSIX kill(0) semantics on macOS / Linux and the Windows equivalent if cross-platform matters (it does — Node ≥22 cross-platform is the assumed runtime).

- **D-09: Hybrid replay strategy — startup scan + DB-resident cursor.** Migration 012 adds `daemon_state(vault_name TEXT PRIMARY KEY, last_seen_doc_mtime INTEGER NOT NULL)`. On daemon start: (1) read `daemon_state.last_seen_doc_mtime`; (2) **full scan** every brief's `source_hashes` against current chunk hashes via the `brief_sources` table — recompute current chunk hash, compare to `recorded_hash`, mark brief stale on divergence; (3) update `daemon_state.last_seen_doc_mtime` to `MAX(notes.mtime)`. At runtime: each `ChangeEvent` update bumps `daemon_state.last_seen_doc_mtime` after the staleness check completes. Cursor exists as a steady-state efficiency hint and an "is the daemon current?" diagnostic — never as the sole correctness guarantee. The startup scan is the floor.
  - **Departure from recommended** (option A "mtime-based scan only"). Cost: 8 additional schema lines for `daemon_state`. Payoff: introspection (`SELECT * FROM daemon_state` answers "is my daemon current?" without log-diving) + a hook for future ChangeFeed `since`-style replay if Phase 10 Notion adapter needs it. The startup scan stays mandatory regardless.

### LLM Strategy & ADR

- **D-10: Capability-first LLM ladder with structured error.** Resolution order, computed per `compile_brief` call:
  1. **MCP Sampling** — if the MCP client declares `sampling: {createMessage: {}}` capability (SDK 1.29 `ClientCapabilities`), call `server.createMessage({messages, maxTokens})`. Routes the brief-compile to the caller's LLM. Zero LLM coupling on the vault-memory side.
  2. **Local Ollama** — else, if `~/.vault-memory/config.toml` has `[brief.ollama] model = "..."` set, POST `http://localhost:11434/api/chat`. Reuses the existing `OllamaClient` (`src/ollama/client.ts`); never bundles a remote LLM SDK.
  3. **Caller-supplied text** — else, the caller MUST pass `prepared_text` (additive `compile_brief` param). vault-memory stitches it into the brief Document shape with provenance.
  4. **Structured error** — if none of the above is available: return `{ok: false, reason: "no_llm_strategy_available", attempted: ["sampling", "ollama", "prepared_text"], hint: "configure [brief.ollama] in config.toml, use a sampling-capable MCP client, or pass prepared_text"}`. No silent degradation.
  - **Phase 5 ADR (`docs/v2/adr/005-brief-compile-strategy.md`)** documents this ladder, the prompt-template constraints (D-11 wikilink emission), the `source_hashes` write contract, and the "never bundle remote LLM SDK" invariant. ADR authored BEFORE implementation (matches Phase 0/2/4 discipline — author ADR in plan 05-01).

### Brief Body Shape & Recompile

- **D-11: Brief body = plain markdown with inline `[[wikilinks]]` per cited source.** The LLM-compile prompt template (in the Phase 5 ADR) instructs the LLM to use `[[Note Title]]` syntax (Obsidian-native; `notion-api` adapter in v3 will resolve to its own link syntax via `formatDisplayUrl`-style helper). A `BriefBodyValidator` runs at `compile_brief` write time:
  - For every `source_doc_id` in input: check the LLM-emitted body contains `[[<Note Title>]]` (or `[[<doc_id>]]`) at least once.
  - If any source is unreferenced in body: append a `\n\n## Sources\n` footer listing the missing `[[wikilinks]]` (one per line). Brief is still committed; provenance is preserved; back-edges from brief → source are created automatically by the Phase 4 D-02 wikilink extractor on the next index pass (chokidar `add` event for the new `_briefs/*.md` file → indexer → edges table).
  - `source_hashes` property remains the staleness contract; wikilinks are graph-discovery only.
  - **Rationale (rejected alternatives):** Structured BlockNodes (option B) would require ADR-003 amendment (per-block `cited_chunks: ChunkId[]` property), a structured-output LLM prompt (harder, less reliable across MCP Sampling backends), and Phase 6/7 implications. Hybrid markdown+sections (option C) doesn't pay for itself in v2.0.0 — block-level staleness is a v3 concern.

- **D-12: Recompile-same-target → auto-supersede.** When `compile_brief({target: "atlas-q3-status", ...})` is called and a brief with that `target` property exists:
  - Resolve the existing brief via the same lookup `get_brief({target})` uses.
  - Generate the new brief's `doc_id` as a timestamped slug: `_memory/_briefs/atlas-q3-status--20260518T1430.md` (separator `--` to disambiguate slug-vs-timestamp; ISO-8601 compact form).
  - Write the new brief via `DeliveryAdapter.write(newBrief)`.
  - Call Phase 2 `supersede({doc_id: oldBriefDocId, replacement_doc_id: newBriefDocId, reason: "recompiled"})`.
  - `target` becomes the stable cross-version handle; agents call `get_brief({target})` and always get the freshest non-superseded brief. History remains accessible via Phase 3 D-08 `include_superseded: true`.
  - **Rationale (rejected alternatives):** Overwrite-in-place (option B) loses audit history AND violates Phase 2 forward-only supersede invariant for `_memory/` writes (memory writes never overwrite, they supersede). Reject-without-explicit-supersede (option C) is high friction — every common recompile becomes two tool calls.

- **D-13: `get_brief` decision tree — staleness dominates; age is independent.** Pseudocode:
  ```
  brief = lookupBriefByTarget(target)
  if (brief == null) return {brief: null, reason: "not_found"}
  if (brief.status == "superseded") brief = followSupersedeChain(brief)  // get current
  if (brief.status == "stale" && !allow_stale) return {stale: true, changed_sources: brief.changedSources, brief: null}
  if (max_age_days != null && ageDays(brief.compiled_at) > max_age_days && !allow_stale) return {stale: false, too_old: true, age_days: ageDays(brief.compiled_at), brief: null}
  return {brief, stale: brief.status == "stale", too_old: ...}
  ```
  - When `brief: null` is returned, the caller MUST call `compile_brief({target, source_doc_ids: ..., purpose, max_tokens})` to recompile. vault-memory does NOT auto-recompile — bakes-in policy is the wrong default at v2.0.0.
  - `allow_stale: true` always returns the brief (with annotated flags) — useful for "show me the last cached version, I'll deal with staleness myself" agent flows.

### Claude's Discretion

Several implementation areas were deliberately **not discussed**. Researcher + planner choose, anchored by ADRs 001–004 + the new Phase 5 ADR (D-10) + the BRF-01..BRF-11 contracts.

- **Exact wording of the LLM-compile prompt template.** Researcher drafts the prompt in the Phase 5 ADR (plan 05-01), grounded in: (a) the brief's `purpose` field as instruction, (b) source citation packets as context (Phase 3 D-05 8-field shape), (c) explicit `[[Note Title]]` emission requirement per D-11, (d) `max_tokens` bound. Recommend a markdown skeleton at minimum: `# Brief: {target}\n\n## Purpose\n{purpose}\n\n## Synthesis\n{LLM-generated body with [[wikilinks]]}\n\n## Sources\n{appended by validator if any source missing}`. Planner tunes against Atlas Robotics in BRF-10 evals.

- **`confidence: inferred` semantics.** BRF-01 specifies the brief carries `confidence: inferred`. The Phase 2 MEMORY_CONTRACT confidence enum is `{high, medium, low, inferred}`. "inferred" is the brief tier — LLM-synthesized content, not direct observation. No further refinement needed in Phase 5; agents that want stronger confidence pass authoritative `prepared_text`.

- **`max_tokens` default.** BRF-03 requires the input field; no default value specified. Recommendation lean: `max_tokens?: number = 2000` (covers a 20-doc project brief at moderate LLM compression; well under most context windows). Caller can override.

- **Brief `purpose` field validation.** Free-text per REQUIREMENTS. No length cap; planner may add a soft cap (~500 chars) to keep purposes scannable in `list_briefs` resource.

- **Daemon error reporting.** When the daemon encounters a corrupt brief or a missing source doc during staleness check: log structured WARN + skip the brief (don't crash the daemon). Recommendation lean: surface persistent failures via `audit_log` with `kind: "brief_staleness_error"`.

- **`list_briefs` resource shape.** REQUIREMENTS says "Resource not Tool" (BRF-09). Recommendation lean: resource URI shape `vault-memory://briefs/{vault}?target=<pattern>` returning JSON with `{briefs: [{doc_id, target, purpose, compiled_at, status, source_count, age_days}, ...]}`. Planner picks the MCP Resource registration shape (SDK 1.29 `setRequestHandler(ListResourcesRequestSchema, ...)` pattern).

- **Concurrent compile_brief calls for the same target.** Two agents simultaneously call `compile_brief({target: "atlas-q3-status"})`. Both succeed; both write briefs; both call `supersede()` on whatever they found. Phase 2 supersede is forward-only and atomic per MEM-04 — outcome: a chain of two superseded briefs and one active. Acceptable. Recommendation lean: document this race-resolution in the Phase 5 ADR (briefs are eventually-consistent at the target slug).

- **Rename-event handling specifics (BRF-08).** Today `obsidian-fs` ChangeFeed surfaces rename as `unlink + add` (`src/adapters/change-feed/types.ts:18`). When a source doc is renamed: (a) chunks table's `doc_uri` updates to new path on indexer's create event, (b) `brief_sources.chunk_doc_id` rows pointing to the old `doc_uri` orphan, (c) chunk hashes themselves are unchanged so staleness should NOT flip. Planner's required fix: migration 012 includes an indexer hook that updates `brief_sources.chunk_doc_id` when a `doc_uri` rename is detected (or — simpler — `brief_sources` keys off `doc_id` which per ADR-001 is the opaque stable URI, not the user-facing path; verify Phase 1 D-? `doc_uri` migration semantics). Planner picks the cleanest mechanism.

- **Cross-vault briefs.** Not supported in v2.0.0; brief and its sources live in the same vault (single `MemorySink`). Phase 10 / v3 may revisit when Notion sources land. Validate `source_doc_ids` are all in the same vault as `target` at `compile_brief` time; reject with structured error otherwise.

- **Brief snapshot test in `evals/v1-baseline/tools-list.snapshot.json`.** Two new tools (`compile_brief`, `get_brief`) + one new Resource (`list_briefs`). Tool snapshot regen once in the Phase 5 PR with the additive diff; reviewed manually.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 specs (the WHAT)
- `.planning/REQUIREMENTS.md` §"Compiled Briefs (Phase 5 — signature differentiator)" — BRF-01..BRF-11 (precise deliverable list)
- `.planning/ROADMAP.md` §"Phase 5: Compiled brief layer" — goal + 5 success criteria
- `.planning/PROJECT.md` — v2 mission; "no premature LLM coupling" (informs D-10 LLM ladder); "85%-rediscovery failure mode" framing

### ADRs (lock the type contracts and invariants)
- `docs/v2/adr/001-document-identity.md` — opaque `DocId`; URI shape; brief `doc_id` is opaque per the same contract; recompile-same-target generates a new DocId (D-12 timestamped slug)
- `docs/v2/adr/002-adapter-seams.md` — `DeliveryAdapter` interface (BRF-05 write contract); `ChangeFeed` interface (BRF-05 subscribe semantics); `SourceConnector.readDocument(id)` for chunk-hash recomputation; capability descriptors at `src/adapters/capabilities.ts`
- `docs/v2/adr/003-document-shape.md` — **§"Chunk-level source_hashes schema" + Invariants H-3 (NFC), H-4 (LF), H-5 (ChunkId = `<DocId>#chunk-<n>`), H-6 (versioned-API hash inclusion)**. The source-of-truth for D-04 ChunkId definition.
- `docs/v2/adr/004-memory-sink-handles.md` — `_memory/_briefs/` is a sub-namespace of `_memory/`; folder-default sink applies; `.memory-sink` sentinel must exist; `_memory` opacity rules apply to brief reads via Phase 4 D-08
- `docs/v2/MEMORY_CONTRACT.md` — provenance keys (`compiled_from`, `compiled_at`, `source_hashes`, `confidence: inferred`, `target`, `purpose`, `status`, `superseded_by`); brief writes satisfy MEM-05 property validator (`source: agent` allowed inside `_memory/_briefs/`)
- `docs/v2/ARCHITECTURE.md` — L4 layer placement (memory + compiled artifacts); brief layer consumes L3 assembly + L1 graph + L2 memory; `src/brief/` directory recommendation
- `docs/v2/AGENT_AGNOSTIC.md` — `list_briefs` as MCP Resource not Tool; MCP Sampling capability check (D-10 ladder tier 1); non-Claude MCP client must be able to call `compile_brief` end-to-end (BRF-11 cross-adapter proof)
- `docs/v2/adr/005-brief-compile-strategy.md` (NEW — authored by plan 05-01) — capability-first LLM ladder (D-10); prompt template (D-11 wikilink emission); no remote LLM SDK; concurrent-compile race semantics

### Prior phase outputs Phase 5 consumes directly
- `.planning/phases/04-graph-as-retrieval/04-CONTEXT.md` — D-02 indexer unified parse pass (new `_briefs/*.md` files get wikilink + frontmatter-ref edges automatically); D-07 citation packet shape with `via` field (brief inputs can come from `expand()` output); cluster determinism (D-12) for callers using cluster-then-compile pattern
- `docs/v2/PHASE-4-SIGN-OFF.md` — explicit Phase 5 hand-off: "brief compiler will use cluster() over _memory + expand() from the brief target to gather citation packets, then the LLM-strategy ladder (MCP Sampling → local Ollama → caller-passed text per the Phase 5 ADR) compiles them into a brief Document"
- `.planning/phases/03-bundles-authority-staleness/03-CONTEXT.md` — D-05 8-field citation packet (brief inputs MUST be citation packets); D-08 `superseded` filter default-hidden (brief lookup follows the same default); D-06/D-07 recency/authority weights (do NOT auto-apply to briefs; agent decides)
- `.planning/phases/02-memory-namespace-provenance-contract/02-CONTEXT.md` — D-01 citation packet origin; D-03 forward-only supersede (Phase 5 D-12 builds on this); D-04 `supersede({doc_id, replacement_doc_id, reason})` tool contract; MEM-05 property validator (brief writes must carry `source: agent`, `compiled_from`, `compiled_at`, `source_hashes`, `confidence`, `target`, `purpose`); MEM-09 `memory_stats`/`list_sinks` resource pattern (BRF-09 `list_briefs` follows)
- `.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md` — `DeliveryAdapter` + `ChangeFeed` interfaces (BRF-05/06 substrate); `doc_uri` migration (Strategy A) — brief writes must populate `doc_uri`; adapter-seam CI greps (must stay zero outside `src/adapters/` in Phase 5 — daemon lives in `src/brief/` not `src/adapters/`)
- `.planning/phases/00-foundation-decisions/00-CONTEXT.md` — eval-fixture discipline; Atlas Robotics is the Phase 5 BRF-10 / BRF-11 source
- `docs/v2/adr/ADVERSARIAL-REVIEW.md` — Phase 0 findings; check anything touching brief identity, source_hashes semantics, or daemon lifecycle

### Phase 1/2/3/4 code Phase 5 reads and extends
- `src/types.ts:298` — exported types for consumers; Phase 5 adds `Brief`, `BriefSourceHash`, `ChunkId`, `BriefStatus` (or reuses `Document` with brief-shaped properties — planner picks)
- `src/types.ts:470` — `Edge.type` union; brief → source wikilinks are extracted by Phase 4 D-02 indexer pass automatically
- `src/types.ts` — `Document.properties: PropertyBag` carries `compiled_from`, `compiled_at`, `source_hashes`, `confidence`, `target`, `purpose`, `status`, `superseded_by` for briefs; no schema change to `Document`
- `src/adapters/change-feed/types.ts` — `ChangeFeed.subscribe(handler): Disposable` contract; daemon registers handler here; `ChangeEvent` tagged union (`create | update | delete | rename` per Phase 1) — Phase 5 handles all four
- `src/adapters/change-feed/obsidian-fs/change-feed.ts` — current impl; daemon subscribes here in `obsidian-fs` mode; stub `ChangeFeed` is the source for BRF-11
- `src/adapters/delivery/index.ts` — `DeliveryAdapter.write(doc)` chokepoint; brief writes go through this (Phase 2 MEM-05 invariant); validator allows `source: agent` inside `_memory/_briefs/`
- `src/memory/sink.ts` + `src/memory/validator.ts` — Phase 2 MemorySink mechanics; brief writes must satisfy validator (planner reads to verify the property set)
- `src/memory/tools/supersede.ts` — Phase 2 D-04 contract; Phase 5 D-12 calls this directly to chain old → new brief on recompile
- `src/memory/tools/recall.ts` — Phase 2 D-? citation-packet shape; `get_brief` returns the same packet shape per Phase 3 D-05
- `src/memory/registry.ts` — MemorySinkRegistry; `_memory/_briefs/` resolution must work via this (planner verifies sub-folder resolution; if a separate `[memory.sinks.briefs]` config is needed, that's a planner discretion call)
- `src/memory/resources/` — Phase 2 MCP Resource registration pattern for `memory_stats`/`list_sinks`; BRF-09 `list_briefs` follows the same shape
- `src/db/schema.ts:86` — `chunks` table; migration 012 adds `chunk_id_fragment TEXT NOT NULL` column; backfill follows `runMigration008` chunked pattern at `src/db/schema.ts:638`
- `src/db/schema.ts` — migration 012 also adds `brief_sources` and `daemon_state` tables; register in the MIGRATIONS array
- `src/db/queries/chunks.ts` — extend with `chunk_id_fragment` field (additive)
- `src/db/queries/edges.ts` — read by the brief → source back-edge story; no write changes (Phase 4 D-02 indexer handles wikilink extraction from brief body)
- `src/db/queries/audit.ts` — Phase 2 D-? audit log; daemon writes structured warnings here
- `src/db/queries/brief_sources.ts` (NEW) — query namespace for the reverse-index table; follows `src/db/queries/wikilinks.ts:52` `INSERT OR IGNORE` shape
- `src/db/queries/daemon_state.ts` (NEW) — single-row-per-vault state table; `getCursor()` / `setCursor()` API
- `src/db/database.ts` — wire `BriefSourcesQueries` and `DaemonStateQueries` namespaces onto the `Database` class (`vault.db.briefSources.*`, `vault.db.daemonState.*`)
- `src/chunker/` — compute and persist `chunk_id_fragment` at chunk-write time
- `src/ollama/client.ts` — D-10 ladder tier 2; brief compile uses `chat` endpoint (not `embed`); planner adds a `chat()` method if absent (verify with codebase scout)
- `src/watcher/watcher.ts` — daemon coroutine runs alongside; subscribes to same `ChangeFeed` instance; `Disposable` lifecycle managed at server shutdown
- `src/server.ts` — server bootstrap; instantiate daemon after `MemorySinkRegistry`, before `ChangeFeed.subscribe()` for watcher (daemon and watcher both subscribe; order doesn't matter; both get every event)
- `src/tool-registry.ts` — register `compile_brief`, `get_brief`; register `list_briefs` as MCP Resource via SDK 1.29 `setRequestHandler(ListResourcesRequestSchema, ...)`
- `src/brief/` (NEW directory per `docs/v2/ARCHITECTURE.md` L4) — `src/brief/compile.ts`, `src/brief/get.ts`, `src/brief/daemon.ts`, `src/brief/source-hashes.ts`, `src/brief/body-validator.ts`, `src/brief/lock.ts`
- `src/adapters/source/conformance.test.ts` — Phase 5 extends with `compile_brief` + `get_brief` + staleness assertions against `obsidian-fs` and the stub `ChangeFeed` (BRF-11)
- `evals/v1-baseline/baseline.test.ts` — must stay green; no v1 tool surface change
- `evals/v1-baseline/tools-list.snapshot.json` — strictly additive: 2 new tools + 1 new resource entry; one regen in the Phase 5 PR
- `evals/fixtures/v2-test-vault/_queries/` — NEW `briefs-curated.yaml` (D-02 primary), `briefs-from-cluster.yaml` (D-02 pipeline integration), `briefs-staleness-stub.yaml` (BRF-11 source-neutrality)

### Codebase maps (read for Phase 5 mechanics)
- `.planning/codebase/ARCHITECTURE.md` — current layer model; `src/brief/` is L4 (new directory); planner verifies it's not already taken
- `.planning/codebase/STRUCTURE.md` — "Where to Add New Code" recipes; daemon module placement
- `.planning/codebase/CONVENTIONS.md` — ESM + `.js` extension, kebab-case, Zod validation, type-check-as-lint
- `.planning/codebase/TESTING.md` — vitest layout; new tests co-located in `src/brief/*.test.ts`; conformance extension lives next to `src/adapters/source/conformance.test.ts`
- `.planning/codebase/CONCERNS.md` — known v1 quirks (especially around indexer + watcher interactions that the daemon shares the ChangeFeed with)
- `.planning/codebase/INTEGRATIONS.md` — Ollama + MCP SDK touchpoints (Phase 5 adds Sampling capability use + Ollama `/api/chat` use; both are gated tiers in D-10 ladder)
- `.planning/codebase/STACK.md` — confirms SDK 1.29 has Sampling support (verified during scout: `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:534` `sampling.createMessage`)

### External references
- MCP Specification §"Sampling" — `sampling/createMessage` request shape, `ClientCapabilities.sampling` declaration; cite in the Phase 5 ADR
- MCP SDK 1.29 docs — `Server.createMessage()` API ergonomics; planner verifies the call signature pattern
- Ollama `/api/chat` REST reference — request/response shape for D-10 ladder tier 2; existing `src/ollama/client.ts` uses `/api/embed` only — planner adds `/api/chat` method
- POSIX `kill(0, pid)` semantics — D-08 stale-lock detection; works on macOS and Linux; Windows equivalent (planner verifies cross-platform if relevant)
- ADR-003 H-5 worked example (chunk-level source_hashes) — re-cite in the Phase 5 ADR

### Operating-environment context (informs design choices)
- **Few expert users, shared vault, multiple MCP clients per server** — D-08 lock contention is the norm, not the exception (Claude Code + Inspector + ChatGPT can all attach to the same `vault-memory serve`); D-04 content-stable ChunkIds survive sync substrate eventual-consistency; D-12 auto-supersede chain is collaborator-stable because `target` is the slug, not the timestamp
- **Local-first, no telemetry, no remote LLM SDK** — D-10 ladder tier 1 (MCP Sampling) routes LLM calls back to the caller's environment; tier 2 (Ollama) is `localhost:11434` only; tier 3 (caller text) is fully offline; tier 4 (structured error) preserves local-first invariant
- **Indexer is the source of brief → source back-edges** — D-11 wikilink-in-body design relies on Phase 4 D-02 unified parse pass picking up the new `_briefs/*.md` files on chokidar `add` events; if Phase 4's indexer is bypassed (e.g., direct DB writes), back-edges are lost — planner verifies Phase 5 brief writes go through the full indexer pipeline, not a shortcut

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`DeliveryAdapter.write()`** (`src/adapters/delivery/index.ts`) — Phase 2 chokepoint; brief writes route through verbatim. No new write path.
- **Phase 2 `supersede()` tool** (`src/memory/tools/supersede.ts`) — D-12 recompile path calls this directly. Forward-only supersede invariant preserved.
- **Phase 2 `MemorySinkRegistry`** (`src/memory/registry.ts`) — `_memory/_briefs/` resolution; planner verifies sub-folder resolution or whether a dedicated `[memory.sinks.briefs]` config is needed.
- **`ChangeFeed.subscribe()`** (`src/adapters/change-feed/types.ts`) — daemon registers a second handler alongside `VaultWatcher`'s. Multiple handlers per feed already supported per `Disposable` contract.
- **`OllamaClient`** (`src/ollama/client.ts`) — D-10 tier 2; planner adds a `chat()` method if not already present (today only `/api/embed` is wired per scout).
- **`runMigration008` chunked pattern** (`src/db/schema.ts:638`) — migration 012's `chunks.chunk_id_fragment` backfill follows this shape.
- **`INSERT OR IGNORE` discipline** (`src/db/queries/wikilinks.ts:52`) — `src/db/queries/brief_sources.ts` follows the same pattern; UNIQUE constraint on `(brief_doc_id, chunk_id_fragment)` makes the populate-on-brief-write idempotent.
- **Phase 4 indexer unified parse pass** (`src/indexer/resolver.ts`) — extracts `wikilink` edges from brief body automatically when a new `_briefs/*.md` lands; no Phase 5 code needed for back-edge creation.
- **MCP Resource registration pattern** (`src/memory/resources/`) — Phase 2 `memory_stats`/`list_sinks` shape; BRF-09 `list_briefs` follows.
- **Phase 4 `expand()` + `cluster()`** (`src/graph/expand.ts`, `src/graph/cluster.ts`) — agents (not the brief layer) orchestrate; brief layer receives the resulting `DocId[]` via `source_doc_ids`.
- **Phase 3 citation packet builders** (`src/assembly/`) — produce the 8-field citation packets; D-01 design means brief layer receives them as input from caller orchestration, but planner may reuse the same builders internally to hydrate `source_hashes` from `source_doc_ids`.
- **`tool-registry.ts`** (Phase 0) — central registration; 2 new tools (`compile_brief`, `get_brief`) + 1 new Resource (`list_briefs`) land here.
- **`evals/fixtures/v2-test-vault/`** — Atlas Robotics fixture; BRF-10 / BRF-11 evals live here.
- **MCP SDK 1.29 `sampling.createMessage`** (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:534`) — D-10 ladder tier 1; SDK exposes it; no client wires it today (Phase 5 is first user).

### Established Patterns
- **Adapter-seam discipline** — no `fs`, `gray-matter`, `path.join` outside `src/adapters/*/`. Daemon and brief layer live in `src/brief/`; reads via `vault.db.*` and writes via `DeliveryAdapter.write()`. CI greps enforce.
- **Strictly additive schema migrations** — migration 012 adds (`chunks.chunk_id_fragment`, `brief_sources`, `daemon_state`); no v1 column drops; backfill in same migration for `chunk_id_fragment` only.
- **Forward-only supersede** (Phase 2 D-03) — D-12 recompile chain preserves this invariant.
- **Vitest co-location** — `src/brief/compile.test.ts`, `src/brief/get.test.ts`, `src/brief/daemon.test.ts`, `src/brief/source-hashes.test.ts`, `src/brief/body-validator.test.ts`, `src/brief/lock.test.ts`.
- **Conformance suite extension** — `src/adapters/source/conformance.test.ts` extends with brief + staleness assertions against both `obsidian-fs` and stub (BRF-11). The stub `ChangeFeed` emits events; the same daemon handler processes them.
- **Snapshot pinning** — `evals/v1-baseline/tools-list.snapshot.json` regen for 2 tools + 1 resource entry; reviewed once in the Phase 5 PR.
- **Phase 2 `source: agent` allowance inside `_memory/_briefs/`** — brief writes are agent-authored; MEM-05 validator passes because `_memory/_briefs/` resolves to a configured `MemorySink`.

### Integration Points
- **`src/db/schema.ts`** — migration 012 DDL (`ALTER TABLE chunks ADD COLUMN chunk_id_fragment TEXT NOT NULL DEFAULT ''` then backfill then optional `CHECK (chunk_id_fragment != '')` in a follow-up if SQLite allows — planner verifies; or just leave the default and rely on chunker to populate); `brief_sources` + `daemon_state` tables.
- **`src/db/queries/chunks.ts`** — extend with `chunk_id_fragment` field; planner verifies whether `getChunk(chunk_id)` needs to return the fragment or build the public ChunkId.
- **`src/db/queries/brief_sources.ts` (NEW)** — query namespace; populate on brief write; delete on brief delete/supersede; reverse-lookup by `chunk_doc_id` for the daemon.
- **`src/db/queries/daemon_state.ts` (NEW)** — single-row-per-vault state; `getCursor()` / `setCursor(mtime)`.
- **`src/db/database.ts`** — wire new query namespaces (`vault.db.briefSources.*`, `vault.db.daemonState.*`).
- **`src/chunker/`** — compute `chunk_id_fragment = sha256(NFC(chunk_text)).slice(0, 7)` at chunk-creation; persist to `chunks` table.
- **`src/brief/compile.ts` (NEW)** — `compile_brief({target, source_doc_ids, purpose, max_tokens})` implementation; orchestrates LLM ladder (D-10), body validation (D-11), recompile chain (D-12), `brief_sources` population, `DeliveryAdapter.write()`.
- **`src/brief/get.ts` (NEW)** — `get_brief({target, max_age_days?, allow_stale?})` decision tree (D-13).
- **`src/brief/daemon.ts` (NEW)** — startup scan + cursor (D-09); subscribes to `ChangeFeed`; processes `ChangeEvent`s; writes structured `audit_log` warnings; runs lock acquisition (D-07/D-08).
- **`src/brief/source-hashes.ts` (NEW)** — build `source_hashes: Record<ChunkId, ChunkHash>` from `source_doc_ids` via `chunks` join; recompute current chunk hash for staleness comparison.
- **`src/brief/body-validator.ts` (NEW)** — D-11 wikilink validator; appends `## Sources` footer on missing wikilinks.
- **`src/brief/lock.ts` (NEW)** — `~/.vault-memory/locks/<vault>.lock` acquire + release + PID liveness check (D-08).
- **`src/brief/resources.ts` (NEW)** — `list_briefs` MCP Resource registration (BRF-09).
- **`src/ollama/client.ts`** — add `chat({model, messages, max_tokens})` method (D-10 tier 2).
- **`src/server.ts`** — instantiate daemon after `MemorySinkRegistry`, before `VaultWatcher`; both subscribe to same `ChangeFeed`; shutdown disposes both `Disposable`s.
- **`src/tool-registry.ts`** — register `compile_brief`, `get_brief` (tools), `list_briefs` (resource).
- **`src/adapters/source/conformance.test.ts`** — extend with brief + staleness assertions against obsidian-fs and stub (BRF-11).
- **`evals/fixtures/v2-test-vault/_queries/`** — `briefs-curated.yaml`, `briefs-from-cluster.yaml`, `briefs-staleness-stub.yaml`.
- **`evals/v1-baseline/tools-list.snapshot.json`** — one regen with the additive diff.
- **`docs/v2/adr/005-brief-compile-strategy.md`** (NEW — plan 05-01 authors).
- **`package.json`** — no new runtime deps in Phase 5 (Sampling via existing SDK; Ollama via existing client). Phase 6 adds `yaml`.

</code_context>

<specifics>
## Specific Ideas

- **The Phase 5 ADR is authored BEFORE implementation** (matches Phase 0/2/4 discipline). Plan 05-01 is "Author ADR 005 — brief compile strategy + LLM ladder + ChunkId + recompile chain"; everything else depends on it.

- **`chunk_id_fragment` is content-only, not context-sensitive.** Two chunks in different documents with byte-identical text produce the same fragment. Disambiguation comes from the `<DocId>` prefix in the public ChunkId. Worked example: `obsidian-fs://atlas/projects/Atlas-1.md#chunk-a3f5b2c` and `obsidian-fs://atlas/meetings/2026-04-12.md#chunk-a3f5b2c` are different ChunkIds even though `<n>` collides. Brief `source_hashes` maps preserve the `<DocId>` prefix, so disambiguation propagates.

- **D-12 recompile chain is the staleness reset.** When a brief is recompiled, the old brief's `brief_sources` rows remain but `status: superseded` — daemon skips superseded briefs in its scan (Phase 3 D-08 default filter). The new brief gets fresh `brief_sources` rows pointing to current chunk hashes. Net: daemon load doesn't grow unboundedly; superseded briefs become inert.

- **The lock file is per-vault, daemon is in-process.** Two `vault-memory serve` processes pointing at different vaults each have their own daemon, their own lock. The lock prevents two daemons on the same vault, not two servers globally. Documented in the Phase 5 ADR.

- **Brief recompile is the ONLY user-facing place where `supersede()` is auto-triggered.** Everywhere else (recall, manual edits), supersede is an explicit caller action per Phase 2 D-04. D-12 is a deliberate auto-supersede because the brief target slug *is* the recompile contract — the user's "give me an up-to-date brief about X" mental model doesn't include "first call supersede." Documented in the Phase 5 ADR and the `compile_brief` tool description.

- **D-11 wikilink-in-body design is what makes the brief layer "graph-native."** Briefs aren't just blobs in `_memory/_briefs/` — they're first-class graph nodes. Once a brief is indexed (Phase 4 D-02 unified parse pass), `list_backlinks` on any source doc returns `{type: "wikilink", source_doc: <brief_doc_id>}`. Agents can ask "what briefs cite this doc?" using v1 tools, no new API. This is the cleanest example of "the type system designed in Phase 0/1 paying off in Phase 5."

- **The startup full scan (D-09 floor) is intentionally O(B·S) and runs once per server boot.** For a vault with 100 briefs × 20 sources × 1 chunk-hash-recompute each, that's 2000 hash computations at boot. At ~10µs per sha256-of-NFC-text on Node 22 ARM64, that's ~20ms. Acceptable boot cost. If this becomes a problem at scale, Phase 5.x can add a "skip scan if cursor is within X seconds" optimization.

- **Two servers pointed at the same vault is a real use case.** The user's workflow: `vault-memory serve` for Claude Code MCP, second `vault-memory serve` for Claude Desktop's MCP, third for Inspector debugging. All three see search/read identically. Only one runs the daemon; the others log the WARN and continue. The daemon owner is whoever wins the lock race — typically whoever started first.

- **`chunk_id_fragment` is also useful for Phase 6 contracts.** A contract that says "always cite the most recent meeting note about Atlas" can specify chunk-level granularity via the ChunkId; without this Phase 5 substrate, contracts could only cite doc-level. Phase 6 reads this for free.

</specifics>

<deferred>
## Deferred Ideas

- **Block-level staleness (per-block `cited_chunks: ChunkId[]` property on brief BlockNodes)** — option B from area 4b. Defer to v3 with the Notion connector; requires ADR-003 amendment and a structured-output LLM prompt that's hard to validate cross-Sampling-backend. Phase 5 ships doc-level brief staleness only.

- **Auto-recompile in `get_brief`** — option C from area 4d. Bakes in policy; LLM costs become invisible to caller; surprise behavior. Caller must explicitly call `compile_brief` after seeing `null`. v2.x may add a `[brief] auto_recompile = true` config flag if user research shows the friction is real.

- **Cross-vault briefs** — brief in vault A, sources in vault B. Out of v2.0.0; revisit when Phase 10 Notion connector lands (briefs from Notion sources written to Obsidian `_memory/`).

- **Per-call LLM strategy override** — `compile_brief({..., strategy_override: ...})` (option D from area 4a). Defer; if a caller really wants to pin a strategy, set the per-vault config or use the prepared_text tier explicitly.

- **Block-level back-edges from brief body** — Phase 4 D-02 indexer creates doc-level wikilink edges from `[[Note]]` in brief body. Section-level "this section of the brief cites that section of the source" is a v3 concern; Phase 7 Canvas may help visualize.

- **Soft cap on `source_doc_ids` (above 50 sources)** — D-03 lean is a hard cap; if research shows real briefs span >50 docs, lift the cap with a documented warning instead.

- **`max_age_days` as a soft expiry (auto-recompile in background)** — defer; v2.0.0 expiry is purely informational.

- **Hybrid section+hash ChunkId** (option D from area 2 ChunkId) — diagnosability vs ID length trade-off didn't pay off. Pure content hash (D-04) is the v2.0.0 contract.

- **Separate `vault-memory daemon` CLI subcommand** (option B from area 3 daemon) — process-model alternative. Defer; if user research shows the in-process daemon is bottlenecking the main server's event loop, v2.x revisits.

- **ChangeFeed `since: cursor` parameter** (option B from area 3 replay cursor) — adapter-level enhancement that would let the runtime cursor (D-09) replace the startup scan. Cross-adapter complexity (especially Notion's polling cursor semantics in v3); out of v2 scope. D-09's hybrid model accommodates this gracefully — if a future adapter declares `replaysFromCursor: true` capability, the daemon can skip the scan.

- **LLM-generated brief descriptions in `list_briefs`** — list resource ships with `purpose` (caller-supplied) but no LLM-summary of contents. Phase 5 keeps `list_briefs` as a thin metadata resource. v2.x can add a `summary?` field if real-world UX needs it.

- **Brief diff tool** (`brief_diff({old_doc_id, new_doc_id})`) — would show what changed across a supersede chain. Useful for human review; out of v2.0.0 tool budget; an agent can compute it client-side from `get_brief({target, include_superseded: true})`.

- **Cluster-driven auto-recompile suggestion** — daemon notices a cluster (Phase 4 D-12) whose member docs have changed substantially; suggests recompile of any brief whose `source_doc_ids` overlap. Out of v2.0.0; product-feature territory, not infrastructure.

- **v3 ChunkId hash flavor switching (blake3 / xxhash)** — chunk-hash algorithm is implicit in `chunks.chunk_id_fragment`. If we switch hashing in v3, every brief's `source_hashes` becomes invalid in one migration step. Plan: future migration includes a "all briefs marked stale, recompile required" notice in `MIGRATION-V*-TO-V*.md`. Out of v2 scope.

</deferred>

---

*Phase: 05-compiled-brief-layer*
*Context gathered: 2026-05-18*
