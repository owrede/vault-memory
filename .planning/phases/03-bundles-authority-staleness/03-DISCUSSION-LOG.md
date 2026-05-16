# Phase 3: Bundles + authority/staleness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 03-bundles-authority-staleness
**Areas discussed:** Section identity & outline shape, Dossier semantics, Authority signal & weight math, search_hybrid backwards-compatibility

**Discussion shape:** The user asked Claude to research all four candidate gray areas and present plausible options for the operating environment — *few expert users collaborating on the same Obsidian vault concurrently* (sync via Syncthing / iCloud / git; vault-memory stays local-first per PROJECT.md). Each area got a researched comparison table with explicit collab-vault impact analysis. The user accepted the recommended option on all four.

---

## Area 1 — Section identity & outline shape

**Driving question:** What's the stable address of a section inside a `Document` so citations survive concurrent edits, given that (a) `BlockNode` is currently flat, (b) the same note may have slightly different content on two synced machines, (c) Phase 5 briefs will later cite chunk-level `source_hashes` per ADR-003 D-05?

| Option | Section ID shape | Outline shape | Collab-vault fit | Implementation cost | Selected |
|--------|-----------------|---------------|------------------|---------------------|----------|
| Heading-path slugs only | `doc_id#projects/q3-status` slugs | Nested tree with `heading_path`, `slug` | Medium — survives reorder; collides when two users name H2s identically; Phase 5 still needs to invent content hashes | Low | |
| Positional chunk IDs only | `doc_id#chunk-7` | Flat list with `depth` | Low — any prepended section shifts every citation; fatal in collab | Lowest | |
| Content-hash anchors only | `doc_id#h:abc123` | Nested tree | High — breaks only on edit (which is what Phase 5 wants); two users editing same section produce different anchors → correctly signals divergence | Medium | |
| **Anchor + heading-path (both fields, anchor = citation token, heading-path = navigation/display)** | Nested tree with both `anchor` and `heading_path` per node | Highest — anchor for stable identity, heading-path for human-readable citations and agent navigation; doubles as Phase 5 chunk-level `source_hashes` | Medium | ✓ |

**User's choice:** Both anchor + heading-path (Recommended).
**Notes:** Anchor = content hash applied at section granularity. Heading-path = ordered heading texts from root to this section. The anchor is also the Phase 5 brief layer's chunk-level `source_hash` — no separate hashing infrastructure needed.

---

## Area 2 — Dossier semantics (`assemble_dossier({type, key})`)

The brief gave one example (`assemble_dossier("Person", "Alice")`) but left three sub-questions open. Each was researched separately.

### 2a — What does `type` resolve against?

| Option | Resolves against | Collab-vault fit | Selected |
|--------|------------------|------------------|----------|
| **`properties.type` only (strict)** | YAML `type: Person` | Requires schema discipline (expert users can adopt the convention); Atlas Robotics fixture already uses this; clear error for tag-only users | ✓ |
| `properties.type` OR top-level tag (`#person`) | Either | More forgiving but couples two conventions into one tool | |
| Per-vault TOML registry | `[dossier_types.Person] match = "type:Person OR #person"` | Most flexible; adds config surface to Phase 3 — deferred to Phase 6 contracts | |

### 2b — How is `key` matched?

| Option | Match strategy | Collab-vault fit | Selected |
|--------|----------------|------------------|----------|
| Exact title only | `title === "Alice"` | Fragile — breaks on rename | |
| **Title OR alias property** | `title` or any entry in `properties.aliases` | Obsidian-native; survives renames if aliases are maintained | ✓ |
| Explicit `properties.id` + title fallback | Explicit ID wins | Most robust but adds discipline overhead; deferred | |

### 2c — What does "property aggregates" mean?

| Option | Output | Use case | Selected |
|--------|--------|----------|----------|
| Counts only | `{ backlink_count: 23 }` | Cheap; agents can't act on counts alone | |
| Value rollups | `{ status_distribution: { active: 5, done: 8 } }` | Useful | |
| Citations of every linked doc | `{ linked_documents: [<packet>, ...] }` | Most useful, biggest payload | |
| **Rollups + citations (layered)** | Both | Most agent-friendly; gives both signal and navigation | ✓ |

**User's choice:** Type = `properties.type` strict, Key = title or aliases, Aggregates = rollups + linked citations (Recommended).
**Notes:** Per-vault TOML registry deferred to Phase 6 contracts. Explicit-ID matching deferred to v2.x.

---

## Area 3 — Authority signal & weight math

**Driving question:** Where does "authority" come from and how do `recency_weight` / `authority_weight` blend into the existing RRF pipeline? The operating-environment context matters most here: mtime drifts under sync timing, not content quality.

### 3a — Authority signal sources

| Option | Reads | Collab-vault fit | Selected |
|--------|-------|------------------|----------|
| mtime only | `Document.mtime` | Bad — drifts with sync | |
| `properties.authoritative` only | YAML flag | Excellent for "user-curated truth" but loses status semantics | |
| **`status` enum (hard filter) + `authoritative` (soft boost) + mtime (soft recency)** | Layered | Most robust; matches Phase 2 D-03's `status` field; mirrors how `recall` already works | ✓ |
| Above + numeric `properties.priority` | Layered + priority | Most flexible; expert users in shared vaults agree on enums faster than numbers | |

### 3b — Weight math

| Option | Math | v1-baseline invariance | Selected |
|--------|------|------------------------|----------|
| **Post-RRF additive rescore** | `final = rrf_score + recency_weight × exp(-age_days/30) + authority_weight × (authoritative?1:0)` | Proven trivially: weights = 0 → terms vanish → identical RRF order | ✓ |
| Pre-RRF: recency as fourth ranker fed into RRF | RRF over (semantic, BM25, rerank, recency) | More principled but harder to prove v1-equivalence | |
| Multiplicative authority + additive recency | `rrf × (1 + auth_weight × auth) + recency_term` | Most ergonomic for agents; harder v1-baseline proof | |

**User's choice:** 3-tier signal + post-RRF additive rescore + hard supersede filter (Recommended).
**Notes:** `status: superseded` is hidden by default (hard filter, not a weight, because superseded docs are *factually wrong* not just lower-priority). Defaults: both weights = 0, half_life = 30 days, `include_superseded = false`. v1-baseline invariance is proven by construction. For collab-vault "authoritative truth" queries: agents set `recency_weight = 0, authority_weight = 1.0`.

---

## Area 4 — `search_hybrid` backwards-compatibility

| Option | Approach | Pros | Cons | Selected |
|--------|----------|------|------|----------|
| **Strictly additive** | New optional params + new optional result fields; existing shape unchanged | Honors PROJECT.md / REQUIREMENTS.md "Backwards-compat v1.x API non-negotiable"; CI snapshot test catches breakage | None when handled disciplined | ✓ |
| Versioned tool name `search_hybrid_v2` | Cleaner separation | — | Doubles tool surface; contradicts the v2.0.0 constraint | |

**User's choice:** Strictly additive on `search_hybrid` (Recommended).
**Notes:** `evals/v1-baseline/tools-list.snapshot.json` enforces additive-only in CI. The snapshot regenerates once in the Phase 3 PR (showing the additive diff).

---

## Claude's Discretion

The user gave Claude latitude on these (researcher + planner choose, anchored by ADR-003 + ASM-01..ASM-13 + Phase 1/2 outputs; maintainer reviews):

- Where assembly code lives (`src/assembly/`, sub-files per tool — recommended)
- Section storage strategy (materialized `sections` table — leaning recommendation — vs. compute-on-demand vs. cached)
- `search_sections` ranking composition (chunk-level RRF then promote to enclosing section — leaning recommendation)
- Error shape (empty arrays for "no match"; Zod for malformed input; standard MCP `isError: true` envelope)
- `recent_edits` source for `get_document_bundle` (`audit_log` — leaning recommendation, capped at ≤10)
- Dossier eval design (≥5 queries covering 4 edge types + multi-alias + negative case)
- MCP Resources promotion candidates (`list_dossiers` is the obvious one; default to Tools otherwise)
- Stub-adapter eval coverage (purpose-built `Document[]` — leaning recommendation — vs. mirror Atlas Robotics)

## Deferred Ideas

- Per-vault TOML dossier-type registry — Phase 6 contracts
- Configurable half-life for recency decay — v2.x
- Numeric `properties.priority` — Phase 5/6 if real-world signal demands
- Multiplicative authority math — v2.x revisit
- Pre-RRF authority/recency as fourth ranker — v2.x revisit
- Subscribable MCP Resources — defer same as Phase 2
- Explicit `properties.id` dossier matching — v2.x
- Cross-source citation packets — Phase 10 / v3
- Edge-type filtering on dossier rollups — Phase 4
