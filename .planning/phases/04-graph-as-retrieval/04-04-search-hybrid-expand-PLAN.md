---
phase: 04-graph-as-retrieval
plan: 04
type: execute
wave: 4
depends_on:
  - 04-03
files_modified:
  - src/search/hybrid.ts
  - src/search/hybrid.test.ts
  - src/tool-registry.ts
autonomous: true
requirements:
  - GRA-03
user_setup: []

must_haves:
  truths:
    - "`search_hybrid({expand: {hops: 1}})` attaches an additive `expansions?: CitationPacketWithVia[]` field per top-K hit; original ranking is preserved."
    - "Phase 3 recency/authority rescore runs BEFORE expand attachment (D-16); expand never participates in score computation."
    - "When `expand` is omitted, `search_hybrid` behavior is byte-identical to today — `evals/v1-baseline/baseline.test.ts` green by construction (guard-and-short-circuit pattern)."
    - "Tool schema for `search_hybrid` gains optional nested `expand?: {hops: 1|2, direction?, edge_types?}` Zod object (additive)."
    - "Per-hit expansions are grouped by `via.seed_doc_id === hit.doc_id` and attached to the corresponding hit."
  artifacts:
    - path: "src/search/hybrid.ts"
      provides: "Post-rescore expand attachment block at the END of hybridSearch() — guarded by `if (opts.expand)`"
      contains: "if (opts.expand)"
    - path: "src/search/hybrid.test.ts"
      provides: "Tests: expansions attached on opt-in; original ranking stable; v1-invariance when expand omitted; multi-seed grouping"
      contains: "expand"
    - path: "src/tool-registry.ts"
      provides: "search_hybrid Zod schema gains optional `expand` nested object"
      contains: "expand: z.object"
  key_links:
    - from: "src/search/hybrid.ts"
      to: "src/graph/expand.ts (Plan 04-03)"
      via: "expand() call after Phase 3 rescore, before return"
      pattern: "await expand\\(vault"
---

<objective>
Wave 4 (depends on Plan 04-03's `expand()` primitive). Wire auto-expansion into `search_hybrid` as a strictly additive optional input. Compose Phase 3's rescore + Phase 4's `expand()` — DO NOT modify either. The guard-and-short-circuit pattern (analog Phase 3 `recencyWeight` rescore block) preserves v1-baseline invariance by construction.

Purpose: GRA-03 fulfillment. This is the smallest plan in Phase 4 — pure composition over `expand()` (Plan 04-03) and the Phase 3 rescore block.

Output: `src/search/hybrid.ts` post-rescore expand block + Zod schema update for `search_hybrid` tool input. No new files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/04-graph-as-retrieval/04-CONTEXT.md
@.planning/phases/04-graph-as-retrieval/04-RESEARCH.md
@.planning/phases/04-graph-as-retrieval/04-PATTERNS.md
@.planning/phases/04-graph-as-retrieval/04-03-expand-tool-PLAN.md
@.planning/phases/03-bundles-authority-staleness/03-CONTEXT.md
@src/types.ts
@src/search/hybrid.ts
@src/graph/expand.ts
@src/tool-registry.ts

<interfaces>
<!-- The composition contract is small. -->

Phase 3 rescore block (src/search/hybrid.ts:245–294) — the analog pattern. End of `hybridSearch()`. The new expand block goes IMMEDIATELY AFTER it (per D-16: rescore FIRST, then expand).

Input schema extension (search_hybrid `opts.expand`):
```typescript
expand?: {
  hops: 1 | 2;
  direction?: "forward" | "backward" | "both";  // default "both"
  edge_types?: EdgeType[];
}
```
Per D-15 wording: "nested under a single optional `expand?: ...` object".

Result-per-hit extension:
```typescript
interface SearchHit {
  // ... existing 9 fields from Phase 3 ...
  expansions?: CitationPacketWithVia[];   // ← NEW, additive (Plan 04-04)
}
```
The Phase 3 SearchHit shape was extended once already; this is the same additive widening pattern.

Grouping rule (D-15):
- Call `expand({seed_doc_ids: hits.map(h => h.doc_id), hops: opts.expand.hops, direction: opts.expand.direction ?? "both", edge_types: opts.expand.edge_types })`.
- Group `expansion.documents` by `doc.via.seed_doc_id`.
- For each hit: `hit.expansions = bySeed.get(hit.doc_id) ?? []`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement post-rescore expand attachment in hybridSearch</name>
  <files>src/search/hybrid.ts, src/search/hybrid.test.ts</files>
  <behavior>
    - Test 1 (additive happy path): `search_hybrid({query: "atlas", expand: {hops: 1}})` returns hits with `expansions: CitationPacketWithVia[]`; each expansion's `via.seed_doc_id` equals the parent hit's `doc_id`; each expansion's `via.hop === 1`.
    - Test 2 (multi-seed grouping): top-K results from a query spanning multiple notes — every hit's expansions array contains ONLY docs whose `via.seed_doc_id === hit.doc_id`. No cross-hit pollution.
    - Test 3 (default direction): When `direction` is omitted, expand runs with `direction='both'`.
    - Test 4 (edge_types filter): `expand: {hops:1, edge_types: ["wikilink"]}` returns hits whose `expansions` contain only wikilink-typed expansions.
    - Test 5 (v1-invariance — CRITICAL): `search_hybrid({query: "atlas"})` (no `expand` arg) returns hits whose JSON shape is byte-identical to today. Compare against `evals/v1-baseline/baseline.test.ts` — must stay green.
    - Test 6 (ranking preservation): With and without `expand`, the top-K ranking (the order of `doc_id`s in the result array) is identical. expand never participates in score computation per D-16.
    - Test 7 (rescore order D-16): With `recency_weight: 1.0` AND `expand: {hops:1}`, the top-K ordering after rescore is computed first (Phase 3 path), then expand attaches per-hit expansions to that re-ordered list. Test pins this: a hit whose rank only became top-K AFTER recency rescore still gets expansions attached.
    - Test 8 (hop=2): `expand: {hops:2}` produces expansions up to 2 hops from each seed.
    - Test 9 (`expand` short-circuit when result list is empty): if `hits.length === 0`, expand block does not even call `expand()` (no DB reads beyond the existing rescore path).
  </behavior>
  <action>
    In `src/search/hybrid.ts`, at the END of `hybridSearch()` — immediately AFTER the existing Phase 3 rescore block at lines 245–294 (PATTERNS line 382–407) and AFTER any final sort/slice, BEFORE the `return hits` (or equivalent):

    ```typescript
    // ── Phase 4 / 04-04 / GRA-03 (D-15, D-16): post-rescore expand attachment ──
    //
    // When `opts.expand` is undefined (the v1/v2 default), this guard
    // short-circuits entirely — zero new DB reads, zero new computation,
    // preserving v1-baseline byte-identical behavior. Expand runs AFTER
    // Phase 3 recency/authority rescore so that expansions attach to the
    // RESCORED top-K (D-16). Expand never participates in score
    // computation; top-K ranking is stable.
    if (opts.expand && hits.length > 0) {
      const seedDocIds = hits.map(h => h.doc_id);
      // Determine which vault each seed is in. search_hybrid already fans out
      // across multiple vaults; expand is single-vault. For Phase 4 v2.0.0:
      // group hits by vault; call expand() per vault; attach to per-vault hits.
      // (Multi-vault expand is Phase 10 / v3 territory per Open Question 2.)
      const hitsByVault = groupBy(hits, h => h.vaultName);
      for (const [vaultName, vaultHits] of hitsByVault.entries()) {
        const vault = vaultByName.get(vaultName);
        if (!vault) continue;
        const result = await expand(vault, {
          seed_doc_ids: vaultHits.map(h => h.doc_id),
          hops: opts.expand.hops,
          direction: opts.expand.direction ?? "both",
          edge_types: opts.expand.edge_types,
        });
        const bySeed = new Map<string, CitationPacketWithVia[]>();
        for (const doc of result.documents) {
          const arr = bySeed.get(doc.via.seed_doc_id) ?? [];
          arr.push(doc);
          bySeed.set(doc.via.seed_doc_id, arr);
        }
        for (const hit of vaultHits) {
          hit.expansions = bySeed.get(hit.doc_id) ?? [];
        }
      }
    }
    ```
    (`groupBy` does NOT exist in the codebase as of 2026-05-17 — verified via `grep -rn "function groupBy\|const groupBy\|export.*groupBy" src/`. Inline this helper at the top of the expand block inside `src/search/hybrid.ts` (file-local, not a new utility module):
    ```ts
    const groupBy = <T, K>(xs: T[], k: (x: T) => K): Map<K, T[]> => {
      const m = new Map<K, T[]>();
      for (const x of xs) {
        const key = k(x);
        const arr = m.get(key);
        if (arr) arr.push(x); else m.set(key, [x]);
      }
      return m;
    };
    ```
    `vaultByName` map exists in the rescore block — reuse it.)

    Import `expand`, `CitationPacketWithVia` from `src/graph/index.ts` (re-exported by Plan 04-03's barrel update).

    Widen `SearchHit` (in `src/types.ts` or wherever the hit type lives) with `expansions?: CitationPacketWithVia[]`. Strictly additive.

    Append behavior-matching tests to `src/search/hybrid.test.ts` per `<behavior>`. Reuse the existing `:memory:` vault + hybrid fixture from the Phase 3 rescore tests.

    Pattern A: zero new fs/path/gray-matter imports. Pattern F: comment block above the guard.
  </action>
  <verify>
    <automated>npx vitest run src/search/hybrid.test.ts && npm run eval:baseline</automated>
  </verify>
  <done>All 9 tests green; v1-baseline byte-identical when `expand` is omitted; rescore + expand compose correctly per D-16.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend search_hybrid Zod schema with optional `expand` object</name>
  <files>src/tool-registry.ts</files>
  <behavior>
    - Test 1: Zod accepts `{query: "x", expand: {hops: 1}}` and `{query: "x", expand: {hops: 2, direction: "forward", edge_types: ["wikilink"]}}`.
    - Test 2: Zod rejects `{query: "x", expand: {hops: 3}}` (hops literal union 1|2).
    - Test 3: Zod rejects `{query: "x", expand: {hops: 1, direction: "sideways"}}`.
    - Test 4: Existing search_hybrid calls (without `expand`) still validate.
    - Test 5: The TOOLS array JSON Schema for `search_hybrid` also gains a corresponding `expand` property with the same constraints.
  </behavior>
  <action>
    Per PATTERNS line 460–476 (Phase 3's additive-Zod-params analog): in `src/tool-registry.ts` TOOL_SCHEMAS, extend the `search_hybrid` shape with:
    ```typescript
    // ── Phase 4 / 04-04 / GRA-03 (D-15): additive auto-expansion ──
    // When omitted, search_hybrid behavior is byte-identical to v1.
    expand: z.object({
      hops: z.union([z.literal(1), z.literal(2)]),
      direction: z.enum(["forward", "backward", "both"]).optional(),
      edge_types: z.array(z.enum(["wikilink","mention","frontmatter-ref","hyperlink"])).optional(),
    }).optional(),
    ```

    In the TOOLS array JSON Schema entry for `search_hybrid` (analog PATTERNS line 432–444), add to `properties`:
    ```json
    "expand": {
      "type": "object",
      "required": ["hops"],
      "properties": {
        "hops": { "type": "number", "enum": [1, 2] },
        "direction": { "type": "string", "enum": ["forward","backward","both"] },
        "edge_types": { "type": "array", "items": { "type": "string", "enum": ["wikilink","mention","frontmatter-ref","hyperlink"] } }
      }
    }
    ```

    The tool description text should append a single sentence: "Pass `expand: {hops: 1}` to auto-attach 1-hop typed-edge neighbors as `expansions[]` per hit (preserves ranking; runs after recency/authority rescore)."

    Tool-list snapshot regen is deferred to Plan 04-07.
  </action>
  <verify>
    <automated>npx vitest run src/server.test.ts -t "search_hybrid"</automated>
  </verify>
  <done>Zod + JSON Schema both gain `expand`; existing callers unaffected; full suite green modulo deferred snapshot regen.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `search_hybrid` input → Zod | Untrusted `expand` object validated against closed schema. |
| `hybridSearch()` → `expand()` | Internal call with already-Zod-validated params; no fresh untrusted input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-04-01 | DoS | Per-hit expand attachment ballooning result size | mitigate | Top-K is already bounded (default 10, max 100 per existing search_hybrid Zod); expand has its own hop cap=2 (D-05). Worst-case result size = topK × (avg degree)² ≈ bounded. |
| T-04-04-02 | Integrity | expand attached to a hit whose `doc_id` is from another vault (multi-vault fan-out) | mitigate | Hits grouped by vaultName before calling expand; per-vault expand calls only. Multi-vault expand is explicitly out-of-scope (Open Question 2, v3 territory). |
| T-04-04-03 | Information Disclosure | `_memory` opacity bypass via search → expand | mitigate | Inherited from Plan 04-03 — `expand()` enforces opacity at hydration; this plan only composes the call. |
| T-04-04-04 | Integrity | v1-baseline invariance broken | mitigate | Guard `if (opts.expand && hits.length > 0)` short-circuits when omitted; tested explicitly (test 5); evals/v1-baseline/baseline.test.ts is the regression gate. |
| T-04-04-SC | Tampering | npm install | N/A | No new deps. |
</threat_model>

<verification>
**Acceptance:**
- `npx vitest run src/search/hybrid.test.ts src/server.test.ts -t "search_hybrid"` — all tests green.
- `npm test` — full suite green (modulo tool-list snapshot deferred to 04-07).
- `npm run lint` clean; `bash scripts/lint-adapters.sh` zero hits.
- `npm run eval:baseline` — byte-identical (PRIMARY regression gate).

**Eval queries:** deferred to Plan 04-06.

**Snapshot checks:** deferred to Plan 04-07.
</verification>

<validation>
**Nyquist Dimension 8:**
- **Coverage map:**
  - GRA-03 (D-15 additive expansions field) → `src/search/hybrid.test.ts` tests 1–2, 8
  - GRA-03 (D-16 rescore-then-expand order) → test 7
  - GRA-03 (ranking preservation) → test 6
  - GRA-03 (v1-invariance) → test 5 + `evals/v1-baseline/baseline.test.ts`
  - GRA-03 (Zod schema) → `src/server.test.ts` -t "search_hybrid" tests 1–5
- **Sampling:** per-task vitest + lint; per-wave eval:baseline; phase gate full eval suite (Plan 04-07).
</validation>

<success_criteria>
1. `search_hybrid({expand: {hops: 1}})` attaches per-hit `expansions: CitationPacketWithVia[]`.
2. When `expand` is omitted, behavior is byte-identical to v1 (evals/v1-baseline green).
3. Rescore order: Phase 3 recency/authority rescore FIRST, then expand attaches to rescored top-K (D-16).
4. Top-K ranking unchanged by `expand` presence.
5. Multi-vault hits are grouped by vault; per-vault expand calls — never cross-vault.
6. Zod schema + JSON Schema both extended additively.
7. `npm test` + `npm run lint` + `scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
</success_criteria>

<commit>
Atomic commit message:

```
feat(04-04): search_hybrid({expand}) — additive auto-expansion of top-K

- src/search/hybrid.ts: post-rescore expand attachment, guarded by
  `if (opts.expand && hits.length > 0)`. When omitted, byte-identical
  to v1 (eval:baseline green by construction).
- D-16: Phase 3 recency/authority rescore runs FIRST; expand never
  participates in score computation. Top-K ranking stable.
- Per-hit `expansions: CitationPacketWithVia[]` grouped by via.seed_doc_id.
- Multi-vault hits handled per-vault (cross-vault expand is v3 territory).
- tool-registry: search_hybrid Zod schema gains optional nested
  `expand?: {hops: 1|2, direction?, edge_types?}` object; JSON Schema
  mirrored. Tool description updated.

GRA-03 complete. Tool-list snapshot regen deferred to Plan 04-07.

Refs: GRA-03, D-15, D-16
```
</commit>

<output>
Create `.planning/phases/04-graph-as-retrieval/04-04-search-hybrid-expand-SUMMARY.md` when done.
</output>
