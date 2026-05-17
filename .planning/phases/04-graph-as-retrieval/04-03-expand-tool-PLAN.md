---
phase: 04-graph-as-retrieval
plan: 03
type: execute
wave: 3
depends_on:
  - 04-01
  - 04-02
files_modified:
  - src/graph/expand.ts
  - src/graph/expand.test.ts
  - src/graph/index.ts
  - src/db/queries/edges.ts
  - src/db/queries/edges.test.ts
  - src/tool-registry.ts
autonomous: true
requirements:
  - GRA-01
user_setup: []

must_haves:
  truths:
    - "`expand({seed_doc_ids, hops, direction?, edge_types?, filter_properties?, include_superseded?})` returns a flat, dedup'd array of citation packets each carrying `via: {seed_doc_id, hop, edge_type, direction}`."
    - "Hops is hard-capped at 2 via Zod literal union (1 | 2)."
    - "Shortest path wins on dedup; ties broken by sort order on `seed_doc_id` then `edge_type` (deterministic comparator)."
    - "`_memory` opacity (Pitfall 3 / ADR-004) honored at hydration time: `_memory` docs surface only when their inbound edge in the result set traces back to a non-`_memory` seed."
    - "Unknown seed_doc_ids return as `warnings: [{seed_doc_id, reason: \"unknown_doc\"}]` — no hard throw."
    - "`filter_properties` applies strict equality (no operators) against `Document.properties`; matches Plan 03 dossier convention."
    - "`include_superseded: false` (default) drops docs where `properties.status === \"superseded\"`; never traverses INTO superseded docs via untyped scans (forward-only supersede per Phase 2 D-03)."
    - "MCP tool `expand` is registered in `src/tool-registry.ts` with Zod schema matching D-05/D-06/D-08."
  artifacts:
    - path: "src/graph/expand.ts"
      provides: "expand() BFS implementation + isShorterPath comparator + types (ExpandOptions, ExpansionResult, ViaTrace, CitationPacketWithVia)"
      min_lines: 200
      contains: "export async function expand"
    - path: "src/graph/expand.test.ts"
      provides: "Unit tests: 1-hop, 2-hop with shortest-path dedup, direction merging, filter_properties, include_superseded, _memory opacity, warnings on unknown seeds"
      contains: "describe(\"expand\""
    - path: "src/tool-registry.ts"
      provides: "MCP tool registration for `expand` (JSON Schema in TOOLS + Zod in TOOL_SCHEMAS)"
      contains: "name: \"expand\""
  key_links:
    - from: "src/graph/expand.ts"
      to: "vault.db.edges.getBacklinks / getForwardLinks"
      via: "BFS frontier traversal"
      pattern: "vault\\.db\\.edges\\.(getBacklinks|getForwardLinks)"
    - from: "src/graph/expand.ts"
      to: "Phase 3 citation-packet hydration (src/assembly/)"
      via: "hydrate noteIds → CitationPacket + attach via field"
      pattern: "toCitationPacket"
    - from: "src/tool-registry.ts"
      to: "src/graph/expand.ts"
      via: "tool handler dispatch"
      pattern: "expand\\("
---

<objective>
Wave 3 — implement the typed-edge BFS retrieval tool. `expand()` is the surface that Phase 5 (briefs) and Phase 6 (contracts) build on; it's also the workhorse called by `search_hybrid({expand})` (Plan 04-04) and `cluster({query})` (Plan 04-05). Lock the BFS contract, dedup semantics, and `_memory` opacity rule first; downstream plans compose this primitive without modifying it.

Purpose: GRA-01 fulfillment. Sole tool surface added in this plan; D-05 hop cap + D-06 direction + D-07 dedup + D-08 filters + D-09 module path + ADR-004 memory opacity all enforced.

Output: `src/graph/expand.ts` + colocated tests + tool-registry registration. Public via `src/graph/index.ts` barrel.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/04-graph-as-retrieval/04-CONTEXT.md
@.planning/phases/04-graph-as-retrieval/04-RESEARCH.md
@.planning/phases/04-graph-as-retrieval/04-PATTERNS.md
@.planning/phases/04-graph-as-retrieval/04-01-edges-substrate-PLAN.md
@.planning/phases/04-graph-as-retrieval/04-02-edge-extractors-PLAN.md
@.planning/phases/03-bundles-authority-staleness/03-CONTEXT.md
@docs/v2/adr/004-memory-sink-handles.md
@src/types.ts
@src/graph/graph.ts
@src/graph/index.ts
@src/assembly/bundle.ts
@src/tool-registry.ts

<interfaces>
<!-- Contracts the executor wires through. -->

ExpandOptions input (Zod schema in tool-registry, runtime type here):
```typescript
export interface ExpandOptions {
  seed_doc_ids: DocId[];              // 1+ DocIds (URI-style, e.g. obsidian-fs://...)
  hops: 1 | 2;                        // hard cap per D-05
  direction?: "forward" | "backward" | "both";  // default "both" per D-06
  edge_types?: EdgeType[];            // optional filter; default = all four
  filter_properties?: Record<string, unknown>;  // strict equality, no operators (D-08)
  include_superseded?: boolean;       // default false (D-08)
}
```

Result shape (D-07):
```typescript
export interface ViaTrace {
  seed_doc_id: DocId;
  hop: 1 | 2;
  edge_type: EdgeType;
  direction: "forward" | "backward";
}
export interface CitationPacketWithVia extends CitationPacket {
  via: ViaTrace;
}
export interface ExpansionResult {
  documents: CitationPacketWithVia[];
  warnings: Array<{ seed_doc_id: string; reason: "unknown_doc" }>;
}
```

CitationPacket — the Phase 3 D-05 locked 8-field shape (read from `src/assembly/`):
```
doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties
```
`expand()` adds the additive `via` field per D-07; never reshapes the existing 8 fields.

EdgesQueries surface from Plan 04-01 (extend if needed):
```typescript
getBacklinks(noteId: number, edgeTypes?: EdgeType[]): EdgeBacklinkRow[];   // SELECT ... FROM edges WHERE target_doc = ?
getForwardLinks(noteId: number, edgeTypes?: EdgeType[]): EdgeForwardLinkRow[]; // SELECT ... FROM edges WHERE source_doc = ?
```
`expand()` needs the per-row `type` AND `target_doc` AND (for forward) `target_path`. If the existing `EdgesQueries` row shapes from Plan 04-01 omit any of these, extend them in this plan as part of Task 1.

Shortest-path comparator contract (D-07 tie-breaker order):
```typescript
// Returns true iff `a` is a strictly shorter / preferable path than `b`.
// Order: 1) lower hop wins; 2) lower seed_doc_id (lexicographic) wins;
// 3) lower edge_type (alphabetical) wins; 4) prefer forward over backward.
function isShorterPath(a: ViaTrace, b: ViaTrace): boolean;
```
Unit-tested directly per Pitfall 4 (RESEARCH lines 536–541).

`_memory` opacity rule (ADR-004 + Pitfall 3):
- At hydration time, drop any visited noteId whose `doc_uri` starts with `_memory/` UNLESS one of its inbound edges in `visited` traces back to a non-`_memory` seed (i.e. the document was already linked from a user note in the result set).
- Concretely: a `_memory` doc surfaces if there exists an edge from a non-`_memory` doc to it that is already in `visited` (or is one of the seeds).
- Cite ADR-004 + Pitfall 3 in the rule's header comment.

Tool registration shape (analog `src/tool-registry.ts:113–172` for JSON Schema in TOOLS array; analog `tool-registry.ts:829–843` for Zod in TOOL_SCHEMAS):
```typescript
// Hops as Zod literal union per D-05:
hops: z.union([z.literal(1), z.literal(2)])
// Edge type union per src/types.ts:
edge_types: z.array(z.enum(["wikilink","mention","frontmatter-ref","hyperlink"])).optional()
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement expand() BFS + isShorterPath comparator</name>
  <files>src/graph/expand.ts, src/graph/expand.test.ts, src/graph/index.ts, src/db/queries/edges.ts, src/db/queries/edges.test.ts</files>
  <behavior>
    isShorterPath comparator (unit-tested directly per Pitfall 4):
    - Test 1: `{hop:1}` is shorter than `{hop:2}` regardless of other fields.
    - Test 2: Same hop, lower `seed_doc_id` (lex order) wins.
    - Test 3: Same hop + seed_doc_id, lower `edge_type` (alpha) wins.
    - Test 4: Same hop + seed + edge_type, `"forward"` wins over `"backward"`.
    - Test 5: Identical traces — comparator returns false (not strictly shorter).

    expand() BFS:
    - Test 6: 1-hop from a single seed with 3 outbound + 2 inbound edges returns 5 packets (default direction='both'); each packet's `via.hop === 1`, `via.seed_doc_id` matches seed, `via.direction` reflects edge direction, `via.edge_type` matches stored type.
    - Test 7: 2-hop from a single seed: a doc reachable in 1 hop AND in 2 hops via different path appears ONCE with `via.hop === 1` (shortest path wins).
    - Test 8: 2-hop from TWO seeds: a doc reachable in 1 hop from seed B and 2 hops from seed A appears with `via.seed_doc_id === B` and `via.hop === 1`.
    - Test 9: `direction: "forward"` returns only forward-traversed targets; backward edges from a seed are NOT followed.
    - Test 10: `edge_types: ["frontmatter-ref"]` filters to only edges with `type='frontmatter-ref'`. Edges with other types are not traversed.
    - Test 11: `filter_properties: {type: "Project"}` returns only docs whose `properties.type === "Project"`; applied at hydration time (post-BFS), not during traversal.
    - Test 12: `include_superseded: false` (default) drops docs where `properties.status === "superseded"`.
    - Test 13: `include_superseded: true` returns superseded docs.
    - Test 14: Unknown seed_doc_id returns `{documents, warnings: [{seed_doc_id, reason:"unknown_doc"}]}` — no throw.
    - Test 15: Empty seed_doc_ids returns `{documents: [], warnings: []}`.
    - Test 16: `_memory` opacity — a seed = user note `projects/atlas-1.md`; user note links to `_memory/observations/x.md` (1-hop wikilink); `_memory/observations/x.md` links to another `_memory/observations/y.md` (2-hop from seed via internal `_memory` edge). 1-hop result includes `_memory/x` (already user-linked). 2-hop traversal does NOT surface `_memory/y` (no non-`_memory` inbound edge in the result set; cite ADR-004 + Pitfall 3).
    - Test 17: Self-loops are skipped — a seed never appears in its own results regardless of edge presence.
    - Test 18: A note that wikilinks to itself is not surfaced as a 1-hop result of itself.
    - Test 19: Citation packets carry all 8 Phase-3-locked fields plus the additive `via` field. None of the existing 8 fields are reshaped.

    Edges-queries extension:
    - Test 20: `vault.db.edges.getBacklinks(noteId, ['wikilink','mention'])` returns only rows with those types; `getBacklinks(noteId)` (no filter) returns all types.
    - Test 21: `getForwardLinks(noteId, ['hyperlink'])` returns rows with raw URL `target_path` (no resolved `target_doc`).
  </behavior>
  <action>
    Create `src/graph/expand.ts` per RESEARCH Pattern 3 (lines 372–413). Header comment block cites Phase 4 / 04-03 / GRA-01 / D-05–D-09 / Pitfall 3 / Pitfall 4 / ADR-004.

    1. **Extend EdgesQueries** in `src/db/queries/edges.ts` to accept an optional `edgeTypes?: EdgeType[]` filter on `getBacklinks` / `getForwardLinks`. Implementation: build the WHERE clause dynamically only when filter is non-empty (avoid SQL string concat — use a dispatch over a small number of pre-prepared statements, OR construct the param list and use `IN (?, ?, …)` with a fresh prepare per call cached by sorted type list). Simplest: build the IN-clause inline with parameterized placeholders (acceptable since EdgeType is a closed union of 4 strings — Zod validation upstream prevents SQL injection). Update `src/db/queries/edges.test.ts` with tests 20–21 above.

    2. **Implement `isShorterPath(a: ViaTrace, b: ViaTrace): boolean`** as an exported pure function. Tie-breaker order from `<interfaces>`. Document with a header comment citing D-07 + Pitfall 4.

    3. **Implement `expand(vault: Vault, opts: ExpandOptions): Promise<ExpansionResult>`** per the Pattern 3 skeleton:
       - Resolve each seed_doc_id → `notes` row via `vault.db.notes.getByDocUri(id)` (or equivalent existing accessor). Push misses to `warnings`.
       - Initialize `visited: Map<number, ViaTrace>` keyed by noteId. Seeds themselves are NOT added to `visited` (they're not "expanded" results); they're frontier starting points.
       - For each seed: run two single-direction BFS sweeps if `direction === 'both'`, else one. Frontier elements `{noteId, depth}`. At each depth < `opts.hops`:
         - For each frontier node, query `vault.db.edges.getForwardLinks(noteId, opts.edge_types)` and/or `getBacklinks(...)` per direction.
         - For each neighbor: compute `targetNoteId` (`target_doc` for forward, `source_doc` for backward); if null (unresolved hyperlink) skip — Phase 4 BFS only traverses resolved edges; if `targetNoteId === seed.noteId` skip (self-loop test 17).
         - Build `candidate: ViaTrace = { hop: newHop, seed_doc_id: seed.docId, edge_type: row.type, direction: dir }`.
         - If `!visited.has(targetNoteId)` OR `isShorterPath(candidate, visited.get(targetNoteId)!)`: set `visited.set(targetNoteId, candidate)` AND if `newHop < opts.hops` push `{targetNoteId, depth: newHop}` to next frontier.
       - **Hydration**: for each `[noteId, via]` in `visited`, fetch `notes` row + properties, call existing `toCitationPacket(...)` helper from `src/assembly/` (look up the exact import path; the Phase 3 dossier integration test references it). Attach `via`.
       - **`_memory` opacity filter** (Pitfall 3): the BFS already records every traversal step in `visited` as `via: { seed_doc_id, hop, edge_type, direction }`. Build a Set of `noteIds` whose `doc_uri` starts with `_memory/`. For each `_memory` noteId in `visited`, perform an **in-memory check** using the BFS traversal record: walk the `via` chain back to its `seed_doc_id` and keep the candidate iff the seed is non-`_memory` AND the first inbound edge into this `_memory` noteId came from a non-`_memory` source already in `visited` (i.e. the doc was already linked from a user note in the result set). No fresh DB query — the traversal already saw the inbound edge that surfaced this candidate. Cite ADR-004 + Pitfall 3 in inline comment. Implementation note: maintain a parallel `Map<noteId, inboundSourceId>` during the BFS frontier expansion so the opacity check is O(1) per candidate at hydration; avoids the N+1 query path.
       - **Property filter** (D-08): `filter_properties` is a strict-equality predicate; for each key/value, require `packet.properties[key] === value`. No operators.
       - **Supersede filter** (D-08): drop docs with `packet.properties.status === "superseded"` unless `opts.include_superseded`.
       - Return `{ documents: filteredPackets, warnings }`.

    4. **Export from `src/graph/index.ts`**: add re-exports for `expand`, `ExpandOptions`, `ExpansionResult`, `ViaTrace`, `CitationPacketWithVia`, `isShorterPath` (PATTERNS line 370–374).

    Adapter-seam discipline: zero imports of `fs`, `path.join`, `gray-matter`, `chokidar`. Only allowed external deps: `src/types.ts`, `src/db/queries/edges.ts`, `src/vault/manager.ts`, `src/assembly/` (citation-packet hydration). Pattern A.

    Co-locate `src/graph/expand.test.ts`. `:memory:` Vault per PATTERNS line 114–119. Seed via `db.notes.upsertByPath` + `db.edges.insertBatch`. For `_memory` opacity test, seed notes with `doc_uri` prefixed `obsidian-fs://test-vault/_memory/...`. For supersede tests, set `notes.status = "superseded"` via the existing `notes.setStatus` path (or directly via `db.prepare("UPDATE notes SET status = ? WHERE id = ?")`).

    Comment block at every expansion point per Pattern F.
  </action>
  <verify>
    <automated>npx vitest run src/graph/expand.test.ts src/db/queries/edges.test.ts</automated>
  </verify>
  <done>All 21 tests green; full suite green; lint clean; no new fs/path imports.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Register `expand` MCP tool in tool-registry</name>
  <files>src/tool-registry.ts</files>
  <behavior>
    - Test 1 (integration via server.test.ts pattern): A `CallToolRequest` for `name: "expand"` with `{seed_doc_ids: ["obsidian-fs://v2-test-vault/people/alice-chen.md"], hops: 1}` returns a non-error response containing `documents: [...]`.
    - Test 2: Zod rejects `hops: 3` (must be 1 or 2 literal).
    - Test 3: Zod rejects empty `seed_doc_ids: []` (require at least 1, per Phase 3 dossier-tool convention; alternatively allow empty + return `{documents: [], warnings: []}` — pick one and pin in test; recommendation: require ≥ 1 to match other graph tools).
    - Test 4: Zod accepts optional `direction`, `edge_types`, `filter_properties`, `include_superseded` — when omitted, defaults apply.
    - Test 5: Tool description text mentions: (a) hop cap 2, (b) `_memory` opacity rule per ADR-004, (c) the Pitfall-6 frontmatter-ref allowlist constants so users know which property names trigger rule (b).
  </behavior>
  <action>
    In `src/tool-registry.ts` (analog PATTERNS line 431–456 for JSON Schema in TOOLS array; analog tool-registry.ts:829–843 for Zod in TOOL_SCHEMAS):

    1. Add a JSON Schema entry to the TOOLS array (the one consumed by `ListToolsRequestSchema`):
       ```json
       {
         "name": "expand",
         "description": "<long-form description; see action notes>",
         "inputSchema": {
           "type": "object",
           "required": ["seed_doc_ids", "hops"],
           "properties": {
             "seed_doc_ids": { "type": "array", "items": { "type": "string", "pattern": "<DOC_ID_PATTERN reused>" } },
             "hops": { "type": "number", "enum": [1, 2] },
             "direction": { "type": "string", "enum": ["forward", "backward", "both"] },
             "edge_types": { "type": "array", "items": { "type": "string", "enum": ["wikilink","mention","frontmatter-ref","hyperlink"] } },
             "filter_properties": { "type": "object", "additionalProperties": true },
             "include_superseded": { "type": "boolean" }
           }
         }
       }
       ```

    2. Add Zod schema to TOOL_SCHEMAS:
       ```typescript
       expand: {
         seed_doc_ids: z.array(z.string().regex(DOC_ID_PATTERN)).min(1),
         hops: z.union([z.literal(1), z.literal(2)]),
         direction: z.enum(["forward","backward","both"]).optional().default("both"),
         edge_types: z.array(z.enum(["wikilink","mention","frontmatter-ref","hyperlink"])).optional(),
         filter_properties: z.record(z.unknown()).optional(),
         include_superseded: z.boolean().optional().default(false),
       },
       ```

    3. Dispatch in the `CallToolRequestSchema` handler (`src/server.ts` or wherever the registry calls into; follow the existing dossier/bundle tool dispatch pattern). Handler: call `await expand(vault, opts)`; serialize via the existing `ok(data)` wrapper per `src/server.ts` convention.

    4. **Tool description** (long-form, included in step 1 above) MUST cover:
       - "Returns typed-edge neighborhood as flat array of citation packets with `via: {seed_doc_id, hop, edge_type, direction}` provenance."
       - "Hops hard-capped at 2 (v2.0.0)."
       - "Default direction = 'both'. Filterable by edge_type and document properties (strict equality)."
       - "Memory-sink documents (`_memory/...`) surface only if already linked from a user note in the result set (per ADR-004)."
       - "Frontmatter-ref edges are extracted heuristically: `[[...]]` in any property value OR allowlisted property names (`assignee`, `owner`, `project`, `related`, `parent`, `child`, `attendees`, `superseded_by`) matched against `note_aliases`."
       - "Unknown seed_doc_ids do not throw; returned in `warnings: []`."

    Tool-list snapshot regen is deferred to Plan 04-07 (one regen with the full additive diff). DO NOT regen the snapshot in this plan; tests that read the live tool list (vs. the pinned snapshot) will see the new tool, and that is expected.
  </action>
  <verify>
    <automated>npx vitest run src/server.test.ts -t "expand" && npm run lint -- --silent</automated>
  </verify>
  <done>`expand` tool registered; Zod validation enforced; description covers all locked rules; full suite green except possibly tool-list snapshot test (acceptable — regen happens in Plan 04-07).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client → `expand` Zod | Untrusted seed_doc_ids (validated via `DOC_ID_PATTERN`), edge_types (closed union), filter_properties (object passthrough — strict equality, never used in SQL). |
| `expand()` → DB read | Read-only; no writes. Edge-type filter passes through Zod-validated closed enum into SQL `IN (?, ?, …)` with parameter binding. |
| Hydration → `_memory` docs | Memory-namespace opacity rule enforced at this layer (Pitfall 3 / ADR-004). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-03-01 | Information Disclosure | `_memory` docs leaked via untyped 2-hop BFS | mitigate | Hydration-time filter: drop `_memory` doc unless an inbound edge in `visited ∪ seeds` originates from a non-`_memory` doc. Cited inline (ADR-004 + Pitfall 3). Unit-tested (test 16). |
| T-04-03-02 | DoS | BFS explosion on dense seed | mitigate | Hops hard-capped at 2 (D-05 Zod literal union); visited-set dedup; shortest-path pruning prevents revisiting nodes at deeper depths. |
| T-04-03-03 | DoS | Pathological filter_properties causing O(n²) hydration | mitigate | filter_properties is strict equality on already-hydrated packets — O(n × k) where k = filter keys (typically ≤ 3); no operators / regex. |
| T-04-03-04 | Tampering | SQL injection via edge_types filter | mitigate | EdgeType is a closed Zod enum (4 values); SQL uses `IN (?, ?, ?, ?)` with bound params. |
| T-04-03-05 | Integrity / determinism | `via` field flakes across runs due to Map iteration order | mitigate | `isShorterPath` is a pure function with explicit tie-breaker order (D-07); unit-tested directly (tests 1–5). Map iteration in Node ≥ 22 is insertion-ordered, which suffices because seeds are processed in input order and edges are iterated in DB row order. |
| T-04-03-06 | Information Disclosure | Superseded docs surfacing through expand neighbors | mitigate | Default `include_superseded: false` drops via Plan 03 D-06 property-level filter; tested (tests 12–13). |
| T-04-03-SC | Tampering | npm install | N/A | No new npm deps in Plan 04-03 (graphology lands in 04-05). |
</threat_model>

<verification>
**Acceptance:**
- `npx vitest run src/graph/expand.test.ts src/db/queries/edges.test.ts` — all new tests pass.
- `npx vitest run src/server.test.ts -t "expand"` — tool dispatch green.
- `npm test` — full suite green (modulo deferred tool-list snapshot regen).
- `npm run lint` clean; `bash scripts/lint-adapters.sh` zero hits.
- `npm run eval:baseline` — v1-baseline green (expand is a NEW tool, not modifying existing tools yet — that's Plan 04-04).

**Eval queries:** none (deferred to Plan 04-06).

**Snapshot checks:** Tool-list snapshot intentionally NOT regenerated; that happens in Plan 04-07 with the full additive diff.
</verification>

<validation>
**Nyquist Dimension 8:**
- **Coverage map:**
  - GRA-01 (expand 1-hop) → `src/graph/expand.test.ts` test 6
  - GRA-01 (expand 2-hop shortest-path dedup) → tests 7–8
  - GRA-01 (direction filter) → test 9
  - GRA-01 (edge_types filter) → test 10
  - GRA-01 (filter_properties strict equality) → test 11
  - GRA-01 (include_superseded default) → tests 12–13
  - GRA-01 (warnings on unknown seeds) → tests 14–15
  - GRA-01 (`_memory` opacity per ADR-004 + Pitfall 3) → test 16
  - GRA-01 (self-loop skip) → tests 17–18
  - GRA-01 (citation-packet shape unchanged) → test 19
  - GRA-01 (edge-types filter in DB layer) → tests 20–21
  - GRA-01 (isShorterPath determinism per Pitfall 4) → tests 1–5
  - GRA-01 (MCP tool dispatch + Zod) → server.test.ts tests 1–5
- **Sampling per RESEARCH:** per-task — co-located vitest + lint. Per-wave merge — full suite + eval:baseline.
</validation>

<success_criteria>
1. `expand()` signature matches D-05/D-06/D-07/D-08 verbatim.
2. BFS bounded at hops ≤ 2; shortest-path dedup via `isShorterPath` comparator (unit-tested directly per Pitfall 4).
3. `_memory` opacity enforced at hydration time (Pitfall 3 / ADR-004).
4. Unknown seed_doc_ids return as warnings; no hard throw.
5. `filter_properties` strict-equality only; `include_superseded` default false.
6. EdgesQueries gains optional `edgeTypes?` filter on `getBacklinks` / `getForwardLinks`.
7. MCP tool `expand` registered with full Zod schema + descriptive tool description covering all locked rules.
8. `npm test` + `npm run lint` + `scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
</success_criteria>

<commit>
Atomic commit message:

```
feat(04-03): expand() typed-edge BFS retrieval + MCP tool

- src/graph/expand.ts: bounded BFS over vault.db.edges with hop cap=2,
  shortest-path `via` dedup (D-07 tie-break: hop → seed_doc_id →
  edge_type → direction), explicit `_memory` opacity per ADR-004 +
  Pitfall 3, soft warnings on unknown seeds (no throw).
- EdgesQueries gains optional edgeTypes filter on getBacklinks /
  getForwardLinks.
- isShorterPath comparator is a pure exported function, unit-tested
  directly to pin the tie-breaker contract (Pitfall 4).
- MCP tool `expand` registered in tool-registry with full Zod schema
  (hops as z.literal union 1|2) and tool description covering opacity
  rule + frontmatter-ref allowlist.

GRA-01 complete. Tool-list snapshot regen deferred to Plan 04-07.

Refs: GRA-01, D-05, D-06, D-07, D-08, D-09, ADR-004
```
</commit>

<output>
Create `.planning/phases/04-graph-as-retrieval/04-03-expand-tool-SUMMARY.md` when done.
</output>
