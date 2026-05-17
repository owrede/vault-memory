---
phase: 04-graph-as-retrieval
plan: 06
type: execute
wave: 5
depends_on:
  - 04-03
  - 04-04
  - 04-05
files_modified:
  - evals/fixtures/v2-test-vault/_queries/expand.yaml
  - evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml
  - evals/fixtures/v2-test-vault/_queries/cluster.yaml
  - src/graph/expand.integration.test.ts
  - src/graph/cluster.integration.test.ts
  - src/search/hybrid-expand.integration.test.ts
  - src/adapters/source/conformance.test.ts
  - src/adapters/stub/assembly-fixture.ts
autonomous: true
requirements:
  - GRA-05
  - GRA-01
  - GRA-02
  - GRA-03
  - GRA-04
user_setup: []

must_haves:
  truths:
    - "`evals/fixtures/v2-test-vault/_queries/expand.yaml` exists with ≥5 hand-curated `expand` queries spanning all four edge types over Atlas Robotics; each query meets ≥0.8 precision AND ≥0.8 recall against `expected_doc_ids`."
    - "`evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml` exists with ~3 integration queries verifying (a) expanded neighbors land in `expansions`, (b) original ranking preserved, (c) v1-baseline byte-identity when `expand` omitted."
    - "`evals/fixtures/v2-test-vault/_queries/cluster.yaml` exists with a snapshot of cluster_id assignment for a hand-picked input — pinned to detect Louvain determinism drift."
    - "Integration tests in `src/graph/expand.integration.test.ts`, `src/graph/cluster.integration.test.ts`, and `src/search/hybrid-expand.integration.test.ts` consume the YAMLs and assert thresholds / snapshot equality."
    - "`src/adapters/source/conformance.test.ts` is extended with 2–3 `expand`/`cluster` cases that PASS against BOTH `obsidian-fs` and the stub adapter."
    - "Atlas Robotics fixture's mention-extraction false-positive rate is empirically ≤ 3 per note (assumption A1 validation); if exceeded, MIN_MENTION_LEN is bumped to 5 in `src/indexer/extract-edges.ts` before this plan closes."
  artifacts:
    - path: "evals/fixtures/v2-test-vault/_queries/expand.yaml"
      provides: "≥5 queries spanning wikilink, mention, frontmatter-ref, hyperlink edge types; manual gold-set"
      contains: "tool: expand"
    - path: "evals/fixtures/v2-test-vault/_queries/cluster.yaml"
      provides: "Cluster_id snapshot for ≥1 input"
      contains: "tool: cluster"
    - path: "evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml"
      provides: "~3 integration queries with `expand` arg"
      contains: "expand:"
    - path: "src/graph/expand.integration.test.ts"
      provides: "Loads expand.yaml, runs expand() against live obsidian-fs vault fixture, asserts precision/recall ≥0.8"
      contains: "expand.yaml"
    - path: "src/graph/cluster.integration.test.ts"
      provides: "Loads cluster.yaml, runs cluster() against fixture, asserts snapshot equality"
      contains: "cluster.yaml"
    - path: "src/search/hybrid-expand.integration.test.ts"
      provides: "Loads search-hybrid-with-expand.yaml, asserts expansions field + ranking preserved + v1 byte-equality"
      contains: "search-hybrid-with-expand.yaml"
    - path: "src/adapters/source/conformance.test.ts"
      provides: "2–3 expand/cluster conformance cases against obsidian-fs + stub"
      contains: "expand"
  key_links:
    - from: "src/graph/expand.integration.test.ts"
      to: "evals/fixtures/v2-test-vault/_queries/expand.yaml"
      via: "yaml.parse(readFileSync(...))"
      pattern: "_queries/expand\\.yaml"
    - from: "src/adapters/source/conformance.test.ts"
      to: "src/adapters/stub/assembly-fixture.ts (already has 3 forward-compat edges)"
      via: "stub adapter exercise"
      pattern: "assembly-fixture"
---

<objective>
Wave 5 — eval coverage + cross-adapter conformance. Author the three YAMLs that Phase 4's deliverables are measured against (per D-17, D-18, GRA-05) and the integration tests that consume them. Extend the source-neutrality conformance suite with `expand`/`cluster` cases against both `obsidian-fs` and the stub adapter (already carries forward-compat edges per `src/adapters/stub/assembly-fixture.ts:148,185,200`).

Purpose: GRA-05 fulfillment + cross-cutting validation per RESEARCH §Validation Architecture. This is the plan that proves Phase 4 deliverables work end-to-end on a real fixture.

Output: Three eval YAMLs + three integration test files + conformance suite extension. No production code changes.
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
@.planning/phases/04-graph-as-retrieval/04-04-search-hybrid-expand-PLAN.md
@.planning/phases/04-graph-as-retrieval/04-05-cluster-tool-PLAN.md
@evals/fixtures/v2-test-vault/_queries/dossier.yaml
@evals/fixtures/v2-test-vault/_queries/recency.yaml
@src/graph/expand.ts
@src/graph/cluster.ts
@src/adapters/source/conformance.test.ts
@src/adapters/stub/assembly-fixture.ts

<interfaces>
Eval YAML schemas (mirror existing `_queries/dossier.yaml` and `_queries/recency.yaml`):

`expand.yaml` (D-17):
```yaml
tool: expand
queries:
  - id: <slug>
    description: <prose>
    input:
      seed_doc_ids: [<DocId>, ...]
      hops: 1 | 2
      direction: forward | backward | both       # optional
      edge_types: [wikilink | mention | frontmatter-ref | hyperlink]  # optional
      filter_properties: {<key>: <value>}        # optional
    expected_doc_ids: [<DocId>, ...]
    min_precision: 0.8
    min_recall: 0.8
```

`search-hybrid-with-expand.yaml` (D-18):
```yaml
tool: search_hybrid
queries:
  - id: <slug>
    description: <prose>
    input:
      query: <string>
      expand: { hops: 1, direction: both }
    assertions:
      ranking_preserved_vs_no_expand: true
      expansions_present_per_hit: true
```

`cluster.yaml` (D-12 snapshot):
```yaml
tool: cluster
queries:
  - id: <slug>
    description: <prose>
    input:
      seed_doc_ids: [<DocId>, ...]
      method: edge-community
    expected_clusters:
      - cluster_id: <DocId>           # smallest member
        member_doc_ids: [<DocId>, ...]
      - cluster_id: <DocId>
        member_doc_ids: [<DocId>, ...]
```

Integration-test pattern (mirror `src/assembly/dossier.integration.test.ts`):
- Build live fixture via existing helper (or new helper following the pattern at `dossier.integration.test.ts:33–80`).
- Parse YAML via existing `yaml` dep (^2.9.0).
- For each query in the YAML, run the tool, compute precision/recall against `expected_doc_ids`, assert ≥ threshold OR snapshot-equal.

Stub adapter — `src/adapters/stub/assembly-fixture.ts:148, 185, 200` already includes `frontmatter-ref`, `mention`, `hyperlink` edges in its fixture data. Phase 4 conformance reuses these.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Empirical validation of mention extraction false-positive rate against Atlas Robotics (assumption A1 / Pitfall 2)</name>
  <files>src/indexer/extract-edges.ts</files>
  <behavior>
    - Goal: Before authoring `expand.yaml` gold-set, confirm MIN_MENTION_LEN=4 produces ≤ 3 false-positive mentions per note on Atlas Robotics. If exceeded, bump to 5.
  </behavior>
  <action>
    1. Run a one-off indexer pass against `evals/fixtures/v2-test-vault/` via existing `vault-memory index` CLI or via an inline vitest that builds a live fixture and dumps `vault.db.edges` filtered to `type='mention'`:
       ```typescript
       // src/indexer/extract-edges.empirical.test.ts (NEW, optional file — delete after validation)
       it("Atlas Robotics: mention false-positive rate ≤ 3 per note", async () => {
         const fx = await buildLiveFixture("v2-test-vault");
         const noteCount = fx.vault.db.notes.count();
         const totalMentions = fx.vault.db.prepare(
           "SELECT COUNT(*) AS c FROM edges WHERE type = 'mention'"
         ).get().c;
         // Per-note dump for manual inspection
         const perNote = fx.vault.db.prepare(`
           SELECT n.path, e.target_doc, e.line_number
             FROM edges e JOIN notes n ON e.source_doc = n.id
            WHERE e.type = 'mention'
            ORDER BY n.path, e.line_number
         `).all();
         console.table(perNote);  // manual review
         // Assertion: average ≤ 3 mentions per note (rough floor; real validation is human-eye review)
         expect(totalMentions / noteCount).toBeLessThanOrEqual(8);  // generous; actual FP rate depends on manual review
         fx.cleanup();
       });
       ```
    2. Manually review the table output. For each note, count obvious false positives ("Alice's" being matched at `Alice`'s' position is acceptable; "API" at length 3 is impossible since MIN=4; common nouns matching alias-shaped tokens count as FP).
    3. If ≤ 3 FPs/note average → keep MIN_MENTION_LEN=4 (assumption A1 confirmed).
    4. If > 3 FPs/note average → bump `MIN_MENTION_LEN` to 5 in `src/indexer/extract-edges.ts`; re-run; re-validate; commit the change separately (`fix(04-02): bump MIN_MENTION_LEN to 5 per A1 empirical validation`).
    5. Delete the empirical test file once the decision is locked.

    This task does not produce production code by default — it's a validation gate. The artifact is a documented decision in the SUMMARY: "A1 validated at MIN_MENTION_LEN=4 with avg <X FPs/note" (or "A1 mitigated by bumping to 5").
  </action>
  <verify>
    <automated>npx vitest run src/indexer/extract-edges.empirical.test.ts || true   # informational; the assertion is human-eye review</automated>
  </verify>
  <done>MIN_MENTION_LEN value confirmed (or bumped) and documented in plan SUMMARY.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Author expand.yaml + integration test (≥5 queries spanning 4 edge types)</name>
  <files>evals/fixtures/v2-test-vault/_queries/expand.yaml, src/graph/expand.integration.test.ts</files>
  <behavior>
    - Test 1: All ≥5 queries in `expand.yaml` parse via `yaml.parse` and match the schema in `<interfaces>`.
    - Test 2: For each query: `expand(vault, input)` returns documents whose `doc_id` set has precision ≥ `min_precision` AND recall ≥ `min_recall` against `expected_doc_ids`.
    - Test 3: At least one query exercises each of the four edge types: `wikilink`, `mention`, `frontmatter-ref`, `hyperlink`. Cover via `edge_types` filter or via the fixture topology (e.g., a seed whose 1-hop forward neighborhood is dominated by frontmatter-ref edges per Atlas Robotics property shapes).
    - Test 4: At least one query exercises `hops: 2` and at least one exercises a `direction` other than `both`.
    - Test 5: At least one query exercises `filter_properties` (e.g., `{type: "Project"}` over Atlas Robotics).
    - Test 6: At least one query uses an unknown `seed_doc_id` and asserts the `warnings: [{seed_doc_id, reason: "unknown_doc"}]` shape.
  </behavior>
  <action>
    1. **Author `expand.yaml`** under `evals/fixtures/v2-test-vault/_queries/expand.yaml`. Hand-curate ≥5 queries per RESEARCH lines 660–687 + D-17. Pull seed DocIds from Atlas Robotics (`obsidian-fs://v2-test-vault/people/alice-chen.md`, `projects/atlas-1.md`, `meetings/2026-04-15-q2-okr-review.md`, etc.). For each query, examine the fixture by hand and list `expected_doc_ids` exhaustively. Set `min_precision: 0.8` and `min_recall: 0.8` per D-17.

       Suggested queries (mix-and-match to cover criteria):
       - **alice-1-hop**: seed `people/alice-chen.md`, hops=1, direction=both. Expected: every Atlas project she owns (via frontmatter-ref `owner: alice-chen`), every meeting that wikilinks her, every note where her name appears as a mention.
       - **atlas-1-2-hop-frontmatter-only**: seed `projects/atlas-1.md`, hops=2, edge_types=["frontmatter-ref"], filter_properties: {type: "Person"}. Validates the deep traversal + filter + property filter combination.
       - **q2-okr-mentions**: seed a meeting note rich in mentions; hops=1, edge_types=["mention"]; expected = the cast of named entities mentioned.
       - **hyperlinks-from-decisions**: seed a decision note that hyperlinks external docs; hops=1, edge_types=["hyperlink"]; expected = empty array (since hyperlinks have null target_doc, they don't traverse to internal docs — Test pins that the FORWARD direction returns no internal docs for hyperlink-only filter). Alternative: use a seed whose backward direction includes external mentions reaching back into the vault.
       - **alice-unknown-seed**: seed includes both `people/alice-chen.md` (valid) and `nonexistent/foo.md` (invalid); assert warnings array contains the invalid entry; assert documents still includes Alice's 1-hop.
       - **directional-asymmetry**: seed `decisions/<some>.md`; direction=`backward` (callers wanting "what cites this decision?"). Expected = the documents that cite back.

       Include a `description:` field on every query explaining the rationale (analog `dossier.yaml`'s `rationale` field).

    2. **Author `src/graph/expand.integration.test.ts`**: load the YAML via `yaml.parse(readFileSync(...))`; build live fixture per the dossier-integration-test pattern; for each query, run `expand(vault, query.input)` and compute precision/recall:
       ```typescript
       function precisionRecall(returned: string[], expected: string[]): {p: number; r: number} {
         const expectedSet = new Set(expected);
         const returnedSet = new Set(returned);
         const tp = [...returnedSet].filter(d => expectedSet.has(d)).length;
         const p = returnedSet.size === 0 ? 1 : tp / returnedSet.size;
         const r = expectedSet.size === 0 ? 1 : tp / expectedSet.size;
         return { p, r };
       }
       ```
       Assert `p >= query.min_precision` and `r >= query.min_recall`. On failure, the test message includes the diff (missing + extra) to make gold-set updates obvious.

       For test 6 (warnings shape): assert `result.warnings.some(w => w.seed_doc_id === "<unknown>" && w.reason === "unknown_doc")`.
  </action>
  <verify>
    <automated>npx vitest run src/graph/expand.integration.test.ts</automated>
  </verify>
  <done>≥5 queries pass with ≥0.8 P/R; all four edge types covered; hops=2 and direction != both each represented; warnings test green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Author search-hybrid-with-expand.yaml + integration test</name>
  <files>evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml, src/search/hybrid-expand.integration.test.ts</files>
  <behavior>
    - Test 1: ~3 queries parse and run.
    - Test 2: For each query: top-K hits from `search_hybrid({query})` (no expand) and `search_hybrid({query, expand: {...}})` have IDENTICAL ranking (same `doc_id`s in the same order).
    - Test 3: Each hit in the `expand` variant has `expansions: CitationPacketWithVia[]`; every expansion's `via.seed_doc_id` equals the parent hit's `doc_id`.
    - Test 4: v1-baseline regression: `search_hybrid({query})` without expand returns the same JSON shape as today (additive `expansions` is not present unless `expand` was passed).
  </behavior>
  <action>
    Author `search-hybrid-with-expand.yaml` with ~3 queries (per D-18):
    - Query "atlas-1-with-expand-1hop": broad query → top-K + 1-hop expansions for graph context.
    - Query "alice-with-expand-frontmatter-only": query likely to surface Alice in top-K + `edge_types: ["frontmatter-ref"]` to restrict expansions.
    - Query "ranking-preservation-sanity": any query that produces multiple hits; assertion focuses on ordering identity vs. no-expand baseline.

    Co-locate integration test `src/search/hybrid-expand.integration.test.ts` that loads the YAML, calls `hybridSearch` twice per query (with and without `expand`), and asserts the four behaviors above. Use the existing search test fixture machinery.
  </action>
  <verify>
    <automated>npx vitest run src/search/hybrid-expand.integration.test.ts</automated>
  </verify>
  <done>~3 queries verify expansions attached + ranking preserved + v1 shape unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Author cluster.yaml snapshot + integration test (D-12 determinism)</name>
  <files>evals/fixtures/v2-test-vault/_queries/cluster.yaml, src/graph/cluster.integration.test.ts</files>
  <behavior>
    - Test 1: cluster.yaml parses; ≥1 query.
    - Test 2: Running `cluster()` on a hand-picked Atlas Robotics input produces clusters whose `cluster_id` set + `member_doc_ids` for each cluster MATCH the snapshot in cluster.yaml byte-for-byte.
    - Test 3: Running it twice in the same test process produces IDENTICAL output (in-process determinism, complements the cross-process snapshot pin).
    - Test 4: Bumping `Math.random()` somewhere outside Louvain (or perturbing node insertion order) would change the snapshot — pin this by a confidence test: explicitly reverse the input `seed_doc_ids` order and assert the output is STILL identical to the snapshot (because sortedDocIds is the canonical order).
  </behavior>
  <action>
    1. Author `cluster.yaml` (per `<interfaces>` schema above). Pick a meaningful Atlas Robotics input — e.g., seeds = `[people/alice-chen.md, projects/atlas-1.md]`. After the first successful run, capture the actual output via a one-off `console.log` and paste the cluster_id / member_doc_ids pairs into the YAML as the pinned snapshot. From then on the YAML is the authority.

    2. Author `src/graph/cluster.integration.test.ts` that loads the YAML and asserts `clusters.map(c => ({ cluster_id, member_doc_ids: c.members.map(m => m.doc_id).sort() }))` deep-equals `query.expected_clusters`.

    Pin the snapshot tightly. If Louvain drifts across Node minor versions (assumption A3 mitigation), this test fails loudly and the maintainer regenerates the snapshot intentionally.
  </action>
  <verify>
    <automated>npx vitest run src/graph/cluster.integration.test.ts</automated>
  </verify>
  <done>cluster.yaml + integration test pin the D-12 determinism contract.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Extend source-adapter conformance suite with expand + cluster cases</name>
  <files>src/adapters/source/conformance.test.ts, src/adapters/stub/assembly-fixture.ts</files>
  <behavior>
    - Test 1 (expand vs. obsidian-fs): A small fixture seed → expand returns expected typed-edge neighbors.
    - Test 2 (expand vs. stub): Same conformance assertion runs against `StubSource` (using `src/adapters/stub/assembly-fixture.ts` which already includes `frontmatter-ref`, `mention`, `hyperlink` edges at lines 148/185/200) — proves the `expand()` surface is source-neutral.
    - Test 3 (cluster determinism vs. stub): A stub-backed cluster() call produces the same cluster_id assignment on repeated invocations.
  </behavior>
  <action>
    Extend `src/adapters/source/conformance.test.ts` per PATTERNS line 36 + RESEARCH §"Stub-adapter coverage extension". Reuse the existing parameterized describe-block pattern (the file already runs the same suite over both adapters).

    Add 2–3 conformance cases:
    1. `expand()` from a fixture seed returns expected 1-hop neighbors with correct `via.edge_type` values for each of the four types (stub has all four; obsidian-fs has all four post-Plan 04-02).
    2. `cluster({seed_doc_ids: [...]})` returns a deterministic clustering — same input twice produces same output (in-process determinism).
    3. `_memory` opacity: a seed → expand should NOT surface a `_memory` doc whose only link is via another `_memory` doc.

    If `src/adapters/stub/assembly-fixture.ts` needs an additional 1–2 edges to make the new conformance cases meaningful (e.g., to ensure a `_memory` doc exists with the right link topology), extend it additively (no removals — backward compat).

    Per RESEARCH note: "per RESEARCH §7 P/R evals run on obsidian-fs only, contract conformance runs on both" — i.e., the eval YAMLs (Tasks 2–4) target obsidian-fs; the conformance tests in THIS task target both adapters via shape assertions, not P/R thresholds.
  </action>
  <verify>
    <automated>npx vitest run src/adapters/source/conformance.test.ts</automated>
  </verify>
  <done>Conformance suite green against both obsidian-fs and stub for new expand/cluster cases.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| YAML eval data → integration tests | Test-only data; not user-facing. |
| Fixture vault content → mention/frontmatter-ref extractors | Re-validated via empirical Task 1 — false-positive rate ≤ threshold. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-06-01 | Integrity | Eval gold-set drifts as fixture evolves | mitigate | Tests fail loudly when fixture diverges; maintainer regenerates gold-set intentionally during fixture updates. PR review confirms gold-set quality (D-17 requirement). |
| T-04-06-02 | Integrity | cluster.yaml snapshot drifts on Node minor version | mitigate | Snapshot test fails loudly; A3 documented; intentional regen required to advance. |
| T-04-06-03 | Information Disclosure | Eval fixtures contain plausible-private data | accept | Per `scripts/check-fixture-privacy.sh` (FND-11) CI lint, fixture must not contain real-world PII; Atlas Robotics is hand-authored fiction. |
| T-04-06-04 | Tampering | Conformance suite cross-adapter divergence | mitigate | Tests run identical assertions against both adapters; divergence is a hard failure. |
| T-04-06-SC | Tampering | npm install | N/A | No new deps. |
</threat_model>

<verification>
**Acceptance:**
- `npx vitest run src/graph/expand.integration.test.ts src/graph/cluster.integration.test.ts src/search/hybrid-expand.integration.test.ts src/adapters/source/conformance.test.ts` — all green.
- `npm test` — full suite green (modulo deferred tool-list snapshot regen).
- `npm run lint` clean; `bash scripts/lint-adapters.sh` zero hits.
- `bash scripts/check-fixture-privacy.sh` zero hits (FND-11 lint).
- Atlas Robotics empirical validation (Task 1) results recorded in plan SUMMARY.

**Eval queries:** all three new YAMLs land in this plan.

**Snapshot checks:** `cluster.yaml` is the canonical D-12 determinism pin going forward.
</verification>

<validation>
**Nyquist Dimension 8:**
- **Coverage map:**
  - GRA-05 (≥5 expand queries with P/R ≥ 0.8 over Atlas Robotics) → `src/graph/expand.integration.test.ts`
  - GRA-05 (~3 search_hybrid({expand}) integration queries) → `src/search/hybrid-expand.integration.test.ts`
  - GRA-05 (cluster.yaml snapshot) → `src/graph/cluster.integration.test.ts`
  - GRA-01, GRA-02 (cross-adapter source-neutrality conformance) → `src/adapters/source/conformance.test.ts`
  - A1 empirical validation (mention FP rate) → Task 1 plan SUMMARY entry
- **Sampling:** per-task vitest + lint; per-wave full suite + eval:baseline; phase gate (Plan 04-07) full eval suite + smoketest.
</validation>

<success_criteria>
1. ≥5 `expand` queries land in `expand.yaml`, each passing P/R ≥ 0.8 against `expected_doc_ids` on Atlas Robotics.
2. All four edge types (`wikilink`, `mention`, `frontmatter-ref`, `hyperlink`) covered by at least one query each.
3. `hops: 2` AND a non-default `direction` each represented by at least one query.
4. `search-hybrid-with-expand.yaml` has ~3 queries; integration test pins (a) expansions attached, (b) ranking preserved, (c) v1 shape unchanged when expand omitted.
5. `cluster.yaml` snapshot pins D-12 determinism for ≥1 input; integration test reproduces exactly.
6. `src/adapters/source/conformance.test.ts` extended with 2–3 expand/cluster cases passing on both obsidian-fs and stub.
7. Empirical mention-FP validation (Task 1) recorded in SUMMARY; MIN_MENTION_LEN bumped to 5 if necessary.
8. `npm test` + `npm run lint` + `scripts/lint-adapters.sh` + `scripts/check-fixture-privacy.sh` + `npm run eval:baseline` all green.
</success_criteria>

<commit>
Atomic commit message:

```
test(04-06): Phase 4 eval coverage + cross-adapter conformance

- evals/fixtures/v2-test-vault/_queries/expand.yaml: ≥5 hand-curated
  queries spanning all four edge types over Atlas Robotics; P/R ≥0.8
  thresholds per D-17.
- evals/fixtures/v2-test-vault/_queries/search-hybrid-with-expand.yaml:
  ~3 integration queries pinning expansions field + ranking preservation
  + v1 shape invariance.
- evals/fixtures/v2-test-vault/_queries/cluster.yaml: D-12 determinism
  snapshot — Louvain partition pinned for a hand-picked input.
- Integration tests co-located: src/graph/expand.integration.test.ts,
  src/graph/cluster.integration.test.ts,
  src/search/hybrid-expand.integration.test.ts.
- src/adapters/source/conformance.test.ts: 2–3 expand/cluster cases
  passing against both obsidian-fs and stub (proves source-neutrality).
- A1 empirical mention-FP validation: <result recorded in SUMMARY>.

GRA-05 complete.

Refs: GRA-01, GRA-02, GRA-03, GRA-04, GRA-05, D-12, D-17, D-18, A1
```
</commit>

<output>
Create `.planning/phases/04-graph-as-retrieval/04-06-evals-conformance-SUMMARY.md` when done, with explicit entries for A1 empirical validation outcome (MIN_MENTION_LEN value).
</output>
