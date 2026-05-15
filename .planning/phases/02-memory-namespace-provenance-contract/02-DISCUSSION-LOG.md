# Phase 2: Memory namespace & provenance contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 02-memory-namespace-provenance-contract
**Areas discussed:** Tool surface & ergonomics

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Tool surface & ergonomics | record_observation / recall / supersede arg shape and return shape | ✓ |
| Error-shape contract for guard rejections | Rich envelope vs string reason for Guards A/B/sentinel | (Claude's Discretion) |
| MemoryContract loading + caching | Hardcoded vs YAML loader; cache strategy | (Claude's Discretion) |
| MEM-10 fixture scope + MCP-Resources shape | Fixture dimensions + URI scheme + subscribable | (Claude's Discretion) |

---

## Tool Surface & Ergonomics

### Q1 — `recall` return shape

| Option | Description | Selected |
|--------|-------------|----------|
| Citation-packet shape from day one | `{doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties}[]` — same as Phase 3 ASM-05 | ✓ |
| Document[] (full content) | Raw `Document[]` per ADR-003; properties + blocks + hash all included | |
| Lightweight summary, Phase-3-promoted later | Phase 2 `{doc_id, claim, confidence, observed_at, source}`; Phase 3 changes shape (breaking) | |

**User's choice:** Citation-packet shape from day one
**Notes:** Aligns recall with Phase 3's bundles/dossiers (ASM-05). No breaking-change risk between v2.0.0 minors. Decision captured as **D-01**.

### Q2 — `record_observation` argument shape

| Option | Description | Selected |
|--------|-------------|----------|
| Freeform `properties` escape hatch | `{claim, evidence, confidence, type, sink?, properties?: Record<string, unknown>}`; contract validator at write() is single source of truth | ✓ |
| Strictly typed args only | Five canonical args; contract evolution requires tool-shape evolution (breaking) | |
| Strict args + named optional fields | Add explicit `expires_at?`, `tags?` etc.; every new contract field bumps tool shape | |

**User's choice:** Freeform `properties` escape hatch
**Notes:** Lets contract evolve without breaking the MCP tool surface. Canonical args remain as sugar that prefills required keys. Decision captured as **D-02**.

### Q3 — `supersede` back-link semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Forward-only (mark old as superseded, link forward to new) | Single OCC write on old doc; Phase 4 derives back-edges at query time | ✓ |
| Forward + back-link (two writes) | Mutate replacement doc with `supersedes: [<old>]`; OCC retry possible | |
| Forward-only + typed edge in graph layer | Forward link in properties + edge row for Phase 4 | |

**User's choice:** Forward-only
**Notes:** Cheapest; no race with freshly-written replacement; Phase 4 (GRA-04) computes back-edges. Decision captured as **D-03**. Note: a `superseded-reason` property is added to the OLD doc — researcher to confirm whether this extends `default-memory-v1` or lives in audit log only.

### Q4 — Atomic composite (record_observation + supersede)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep separate — caller chains | `new_id = record_observation(...); supersede(old_id, new_id, reason)` | ✓ |
| Add `supersedes?: DocId[]` to record_observation | One-shot composite arg | |
| Both — separate ops AND atomic composite | Adds `record_and_supersede` as a third tool | |

**User's choice:** Keep separate
**Notes:** MEM-09 is explicitly cutting the v2.0.0 tool surface — a composite would move in the opposite direction. Failure mode is clean (if supersede fails, new observation still exists). Decision captured as **D-04**.

### Continuation check

| Option | Description | Selected |
|--------|-------------|----------|
| Satisfied — write CONTEXT.md | Four decisions captured; remaining areas → Claude's Discretion | ✓ |
| One more question on tool surface | (e.g., `evidence` accepts wikilinks vs DocIds; default-sink resolution rules) | |

**User's choice:** Satisfied — write CONTEXT.md

---

## Claude's Discretion

Three areas explicitly delegated to researcher + planner, anchored by ADR-004 + MEM-01..12:

1. **Error-shape contract for guard rejections (Guard A / Guard B / sentinel-missing / contract-violation).** Planner picks whether to extend the `WriteResult` discriminated union with new `reason` codes + richer envelope, or emit structured MCP errors, or both. Constraint: error messages must be actionable (sink name, missing keys, suggested tool).
2. **MemoryContract loading + caching strategy.** Hardcoded `default-memory-v1` vs YAML loader; module placement; cache revalidation strategy. Researcher consults `src/config/loader.ts` for the TOML+Zod pattern.
3. **MEM-10 fixture scope + dimensions + edge cases.** Provenance dimensions to cover; whether to include malformed docs in-fixture vs separate `tests/fixtures/malformed-memory/`; whether to include a supersede chain A→B→C. Recommendations: clean fixture vault, malformed inputs in separate tree, include at least one A→B→C chain.
4. **MCP Resources URI scheme for `memory_stats` + `list_sinks`.** Flat (`vault-memory://memory/sinks` + `/stats`) vs nested (`/sinks/<name>/stats`); subscribable vs polled-only. Recommendation: polled-only in v2.0.0 unless trivially cheap.

## Deferred Ideas

- Subscribable MCP Resources (`notifyResourceUpdated`) for memory_stats / list_sinks → Phase 5/6.
- `record_and_supersede` composite tool → revisit in Phase 5/6 if chaining proves painful in real agent usage.
- MemoryContract YAML loader (if not shipped in Phase 2 by Claude's Discretion) → Phase 5/6.
- Back-link materialization on supersede → Phase 4 derives back-edges; revisit only if query-time derivation is slow.
- Per-sink stats subscription → same as first item, scoped per-sink.
- Notion adapter memory-sink support → out of v2 scope; tracked in `docs/v2/adr/NOTION-ADAPTER-PLAN.md` for v3.0.0.
