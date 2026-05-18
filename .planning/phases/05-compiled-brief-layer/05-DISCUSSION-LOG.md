# Phase 5: Compiled brief layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 05-compiled-brief-layer
**Areas discussed:** Source discovery API, ChunkId identity & stability, Daemon lifecycle & process model, LLM strategy + brief body + recompile policy

---

## Area 1 — Source Discovery API

### Q1.1 — How should `compile_brief` discover its sources?

| Option | Description | Selected |
|--------|-------------|----------|
| Caller-supplied only (Recommended) | BRF-03 verbatim; agent runs cluster/expand/search first, passes deduped DocId[]. Brief layer stays a pure compiler. Phase 6 contract DSL handles auto-discovery declaratively. | ✓ |
| Auto-discover (target only) | `compile_brief({target, purpose, max_tokens})` runs expand+cluster internally. Easier for naive callers; bakes discovery heuristic into v2.0.0. | |
| Both (overloaded API) | Accept either explicit source_doc_ids or auto-discover when omitted. Flexible but BRF-10 eval becomes ambiguous. | |
| Caller-supplied + named discovery helper | Separate `suggest_brief_sources({target})` tool. Composable, but adds tool budget pressure. | |

**User's choice:** Caller-supplied only (Recommended) → D-01.
**Notes:** Agent orchestrates upstream; brief layer stays a pure compiler. Phase 6 contract DSL formalizes auto-discovery declaratively. The Phase 4 sign-off note about "brief compiler will use cluster()..." describes the calling pattern, not the brief-layer API.

### Q1.2 — How should the BRF-10 eval scenario assemble source_doc_ids?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-curated in YAML (Recommended) | `_queries/briefs.yaml` lists 20 explicit source_doc_ids per query. Matches Phase 3/4 manual gold-set discipline. Decouples brief-layer eval from cluster/expand correctness. | |
| Programmatic in test setup | Eval calls cluster() first to build source list, then compile_brief. Tests whole pipeline. Couples brief evals to graph-layer behavior. | |
| Both, tagged separately | Two eval files: briefs-curated.yaml (hand) + briefs-from-cluster.yaml (pipeline). Full coverage at higher curation cost. | ✓ |

**User's choice:** Both, tagged separately → D-02.
**Notes:** Defense in depth — a graph regression masquerading as a brief regression gets isolated immediately.

### Q1.3 — `compile_brief` input handling (dedupe + cap) — lock or leave to planner?

| Option | Description | Selected |
|--------|-------------|----------|
| Leave to planner (Recommended) | Lean: dedupe input + soft cap 50; researcher/planner verify on Atlas Robotics. | ✓ |
| Lock dedupe + hard cap 50 | Predictable contract; reject >50 with structured error. | |
| Lock dedupe; no cap | Trust caller; brief bounded by max_tokens not source count. | |

**User's choice:** Leave to planner (Recommended) → D-03.
**Notes:** Claude's discretion with documented lean.

---

## Area 2 — ChunkId Identity & Stability

### Q2.1 — What does `<n>` in `ChunkId = <DocId>#chunk-<n>` actually mean?

| Option | Description | Selected |
|--------|-------------|----------|
| Content-stable: <n> = first-7-of-chunk-hash (Recommended) | First 7 hex chars of chunk's content sha256. Inserting paragraphs leaves unchanged chunks' IDs identical. Staleness becomes content-driven. | ✓ |
| Chunker ordinal: <n> = 0,1,2,... | Simple, human-readable. But top-of-doc edits bump every subsequent ChunkId — defeats chunk-level granularity. | |
| Stable section anchor: <n> = section_anchor#chunk_within_section | Reuses Phase 3 section anchors. Stable across heading-preserving edits; mid-section edits still shift. | |
| Hybrid: <n> = section_anchor#first-7-of-chunk-hash | Combines section anchor (readability) + content hash (stability). Bigger ID for marginal gain. | |

**User's choice:** Content-stable (Recommended) → D-04.
**Notes:** Make-or-break for staleness correctness. Collision risk at 7 hex chars negligible at document scope.

### Q2.2 — Where does the content-hash ChunkId fragment live in the schema?

| Option | Description | Selected |
|--------|-------------|----------|
| New column on chunks table (Recommended) | `chunks.chunk_id_fragment TEXT NOT NULL` via migration 012. Populated by chunker. Public identity built as `${doc_uri}#chunk-${fragment}`. | ✓ |
| Computed on read | Don't store. Recompute sha256 on every read building a ChunkId. Lower migration risk; higher CPU. | |
| New `chunk_hashes` table | Separate table keyed off INTEGER PK. More normalized; extra join. | |

**User's choice:** New column on chunks table (Recommended) → D-05.
**Notes:** Migration 012 backfills via runMigration008 chunked pattern. Existing chunk_id INTEGER PK stays as DB-internal FK target.

### Q2.3 — How does the staleness daemon find which briefs reference a changed chunk?

| Option | Description | Selected |
|--------|-------------|----------|
| New `brief_sources` reverse-index table (Recommended) | Migration 012 adds brief_sources(brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash). Indexes on chunk_doc_id. O(log N) lookup. | ✓ |
| Scan brief properties on each change | Daemon reads every _briefs/*.md source_hashes per ChangeEvent. O(B*S) — painful at scale. | |
| Hybrid: in-memory cache built at daemon start | Daemon builds {chunk_doc_id -> brief_doc_ids[]} map at boot. Lost on restart. | |

**User's choice:** New brief_sources reverse-index table (Recommended) → D-06.

---

## Area 3 — Daemon Lifecycle & Process Model

### Q3.1 — Where does the staleness daemon run?

| Option | Description | Selected |
|--------|-------------|----------|
| In-process at MCP server boot (Recommended) | `vault-memory serve` starts daemon as coroutine alongside VaultWatcher. One process, one lifecycle. Piggybacks on existing ChangeFeed. | ✓ |
| Separate `vault-memory daemon` CLI | New subcommand; daemon independent of serve. Extra ergonomics; conflict with serve's ChangeFeed subscriber. | |
| In-process but opt-in via config flag | Defaults off; user enables in config.toml. Conservative — but staleness is the brief layer's reason for existing. | |

**User's choice:** In-process at MCP server boot (Recommended) → D-07.

### Q3.2 — Lock contention behavior when a second `serve` starts?

| Option | Description | Selected |
|--------|-------------|----------|
| Second server starts; daemon disabled with warning (Recommended) | Second serve boots normally; logs structured WARN; multi-MCP-client friendly. | ✓ |
| Second server refuses to start | Hard error. Safest but breaks shared-vault multi-client use case. | |
| Second server takes over (steal lock) | Always-steal protocol. Tricky semantics; never the happy path. | |
| Stale-lock detection + auto-takeover only | Option 1 plus crash recovery via PID liveness check. | |

**User's choice:** Second server starts; daemon disabled with warning (Recommended) → D-08.
**Notes:** Stale-lock PID-dead detection recommended as Claude's discretion lean for planner.

### Q3.3 — How does the daemon replay missed change events on startup?

| Option | Description | Selected |
|--------|-------------|----------|
| mtime-based: scan all source docs vs recorded source_hashes (Recommended) | No explicit cursor. Daemon walks every brief at boot, recomputes chunk hashes, marks stale on divergence. O(B*S) once per boot. | |
| Explicit cursor in `~/.vault-memory/state/<vault>.cursor.json` | JSON file with last_seen_event_id/mtime. ChangeFeed.subscribe(since: ...). Lower runtime cost; ChangeFeed contract change. | |
| DB-resident cursor in a new daemon_state table | Migration 012 daemon_state table. Transactional with DB. | |
| Hybrid: scan at startup + cursor at runtime | Option 1 at boot (correctness floor) + cursor for steady-state efficiency. Defense in depth. | ✓ |

**User's choice:** Hybrid: scan at startup + cursor at runtime → D-09.
**Notes:** Departure from recommended (option 1). Migration 012 includes daemon_state(vault_name, last_seen_doc_mtime). Adds introspection: "is my daemon current?" answerable from a SELECT.

---

## Area 4 — LLM Strategy + Brief Body + Recompile Policy

### Q4.1 — What triggers the LLM-strategy fallback ladder?

| Option | Description | Selected |
|--------|-------------|----------|
| Capability-first then runtime error (Recommended) | Tier 1: MCP Sampling if client declares capability. Tier 2: Ollama if config has model set. Tier 3: caller-passed prepared_text. Tier 4: structured error. | ✓ |
| Config-pinned (one path per vault) | User pins strategy in config. No ladder. Conflict if multiple MCP clients with different capabilities share a vault. | |
| Caller-explicit per call | Caller picks strategy per call. Most flexible; pushes complexity into every caller. | |
| Ladder with per-call override | Default ladder + optional override param. Most ergonomic; biggest API surface. | |

**User's choice:** Capability-first then runtime error (Recommended) → D-10.
**Notes:** No silent degradation. Phase 5 ADR (`docs/v2/adr/005-brief-compile-strategy.md`) authored BEFORE implementation in plan 05-01.

### Q4.2 — What is the structural shape of a brief's body?

| Option | Description | Selected |
|--------|-------------|----------|
| Plain markdown body with inline `[[wikilinks]]` to sources (Recommended) | LLM emits markdown freely; validator ensures every cited source has a wikilink (appends Sources footer if not). source_hashes is the staleness contract; wikilinks give graph back-edges via Phase 4 D-02 indexer. | ✓ |
| Structured BlockNodes with per-block source attribution | Strong provenance; enables block-level staleness. Requires ADR-003 amendment + structured-output LLM prompt. | |
| Hybrid: markdown body + per-section sources list | Markdown body with `Sources:` paragraph per H2 section. Middle ground. | |

**User's choice:** Plain markdown body with inline wikilinks (Recommended) → D-11.
**Notes:** Briefs become first-class graph nodes — `list_backlinks(source_doc)` returns the brief that cites it, no new API needed.

### Q4.3 — Recompile-same-target policy?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-supersede via Phase 2 `supersede()` (Recommended) | New brief gets timestamped doc_id; old marked status: superseded + superseded_by. Full audit history; `target` is the stable cross-version handle. | ✓ |
| Overwrite in place (single doc per target) | Same doc_id, body replaced, compiled_at bumped. No history. Violates Phase 2 forward-only supersede invariant. | |
| Reject — caller must supersede first | Hard error if target exists. Highest friction. | |

**User's choice:** Auto-supersede via Phase 2 supersede() (Recommended) → D-12.
**Notes:** target slug is the stable handle; full history accessible via Phase 3 include_superseded.

### Q4.4 — `get_brief` reconciliation of age, staleness, allow_stale?

| Option | Description | Selected |
|--------|-------------|----------|
| Staleness dominates; age is independent (Recommended) | If stale AND NOT allow_stale → {stale: true, changed_sources, brief: null}. If too_old AND NOT allow_stale → {too_old: true, brief: null}. Else: return brief. | ✓ |
| Return the brief always; flag separately | Always return brief with is_stale/is_too_old flags. Doesn't match BRF-04 "null forcing recompile". | |
| Auto-recompile when stale and policy allows | Internal compile_brief trigger. Surprise behavior; LLM costs invisible to caller. | |

**User's choice:** Staleness dominates; age is independent (Recommended) → D-13.
**Notes:** Null brief = caller must recompile. vault-memory never auto-recompiles in v2.0.0.

---

## Claude's Discretion

Areas left to researcher/planner with documented lean (see CONTEXT.md `<decisions>` → "Claude's Discretion"):

- Exact wording of the LLM-compile prompt template (D-10 ADR scope)
- `confidence: inferred` semantics (Phase 2 MEMORY_CONTRACT enum)
- `max_tokens` default value (lean: 2000)
- Brief `purpose` field validation (lean: no hard cap, soft ~500 chars)
- Daemon error reporting via `audit_log` with structured kinds
- `list_briefs` resource shape (lean: vault-memory://briefs/{vault}?target=<pattern>)
- Concurrent `compile_brief` calls for same target (lean: documented eventually-consistent semantics)
- Rename-event handling specifics for `brief_sources.chunk_doc_id` (lean: keyed off stable DocId per ADR-001)
- Cross-vault brief validation (lean: reject with structured error)
- D-03 input handling (dedupe + soft cap 50)
- Stale-lock PID-dead detection on Windows cross-platform behavior

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` — summary:

- Block-level staleness (per-block cited_chunks) — v3 with Notion
- Auto-recompile in `get_brief` — v2.x if user research demands
- Cross-vault briefs — v3 with Notion
- Per-call LLM strategy override — v2.x
- Block-level back-edges from brief body — v3
- Soft cap on source_doc_ids — v2.x if real briefs span >50
- `max_age_days` as soft expiry (background recompile) — v2.x
- Hybrid section+hash ChunkId — pure hash wins
- Separate `vault-memory daemon` CLI — v2.x if event-loop bottleneck
- ChangeFeed `since: cursor` parameter — v3 with adapter-level capability
- LLM-generated brief descriptions in `list_briefs` — v2.x
- Brief diff tool — out of v2.0.0 tool budget
- Cluster-driven auto-recompile suggestion — product feature, not infra
- v3 ChunkId hash flavor switching (blake3/xxhash) — migration step
