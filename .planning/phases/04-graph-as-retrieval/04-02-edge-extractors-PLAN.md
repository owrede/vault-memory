---
phase: 04-graph-as-retrieval
plan: 02
type: execute
wave: 2
depends_on:
  - 04-01
files_modified:
  - src/indexer/extract-edges.ts
  - src/indexer/extract-edges.test.ts
  - src/indexer/resolver.ts
  - src/indexer/single.ts
  - src/indexer/single.test.ts
  - src/db/queries/edges.ts
autonomous: true
requirements:
  - GRA-04
user_setup: []

must_haves:
  truths:
    - "Indexing a note populates `edges` with all four edge types (`wikilink`, `mention`, `frontmatter-ref`, `hyperlink`) in a single parse pass."
    - "The wikilinks pathway continues to write to the legacy `wikilinks` table for v1 invariance; `edges` receives wikilink rows from BOTH the legacy path (via Plan 04-01 backfill on first install) and the new unified extractor on every subsequent re-index."
    - "Mention extraction obeys D-03: casefold + min-length 4 + word-boundary, excludes wikilinks/headings/code blocks, reads from `note_aliases`."
    - "Frontmatter-ref extraction obeys the Pitfall-6 two-rule heuristic: rule (a) any property whose value matches `[[…]]` wikilink syntax; rule (b) allowlisted property names against `note_aliases`."
    - "Hyperlink extraction captures `[text](url)` + bare `http(s)://` URLs; skips relative paths and image embeds whose target is not `http(s)://`."
    - "Re-indexing a note is idempotent — `INSERT OR IGNORE` + UNIQUE on (`source_doc`, `target_doc`, `type`, `anchor`) prevents duplicates."
    - "`v1-baseline` stays green: when an indexed note has only wikilinks (the v1 case), `list_backlinks`/`list_forward_links` results match v1 byte-for-byte modulo the additive `type` field from Plan 04-01."
  artifacts:
    - path: "src/indexer/extract-edges.ts"
      provides: "extractAllEdges(vault, parsed, resolver) + 3 sibling extractors (mention, frontmatter-ref, hyperlink); MIN_MENTION_LEN=4 constant; FRONTMATTER_REF_ALLOWLIST"
      min_lines: 200
      contains: "export function extractAllEdges"
    - path: "src/indexer/extract-edges.test.ts"
      provides: "Per-extractor unit tests covering D-03 (mention) + Pitfall-6 (frontmatter-ref) + hyperlink scope rules + extractAllEdges integration"
      contains: "describe(\"extractMentionEdges\""
    - path: "src/indexer/single.ts"
      provides: "Index path calls extractAllEdges() and writes via vault.db.edges.insertBatch() alongside the existing wikilinks write"
      contains: "vault.db.edges.insertBatch"
  key_links:
    - from: "src/indexer/single.ts"
      to: "src/indexer/extract-edges.ts"
      via: "extractAllEdges() call replacing direct wikilinks-only extraction"
      pattern: "extractAllEdges\\(vault, parsed, resolver\\)"
    - from: "src/indexer/extract-edges.ts"
      to: "vault.db.aliases / vault.db.notes.aliases"
      via: "mention candidate set construction (single-run cache scope per Pattern E)"
      pattern: "buildMentionCandidateSet"
    - from: "src/indexer/extract-edges.ts"
      to: "vault.db.edges.insertBatch"
      via: "single-batch write per note re-index"
      pattern: "vault\\.db\\.edges\\.insertBatch"
---

<objective>
Wave 2 — extend the indexer to extract and persist all four `Edge.type` values in a single per-note parse pass. After this plan, `edges` is the source of truth for every typed edge in the vault. `wikilinks` table stays writable too (D-01), so v1 invariance is byte-stable.

Purpose: GRA-04 fulfillment of indexer side. Phase 4's `expand`/`cluster` rely on the typed-edge table being populated for all four types.

Output: New `src/indexer/extract-edges.ts` module containing `extractAllEdges` + 3 new extractors (`extractMentionEdges`, `extractFrontmatterRefEdges`, `extractHyperlinkEdges`); existing `src/indexer/single.ts` paths call it and write to `vault.db.edges` alongside the unchanged wikilinks path.
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
@docs/v2/adr/003-document-shape.md
@docs/v2/adr/004-memory-sink-handles.md
@src/types.ts
@src/indexer/resolver.ts
@src/indexer/single.ts
@src/db/queries/edges.ts
@src/db/queries/wikilinks.ts

<interfaces>
<!-- Contracts the executor wires through. -->

From src/types.ts (BlockNode / ParsedNote — body block kinds for D-03 mention scope):
- `block.kind === "paragraph"` is the ONLY scope mention extraction reads from. Headings, code blocks, and wikilink-typed nodes are excluded.

From the new src/db/queries/edges.ts (Plan 04-01):
```typescript
export interface EdgeInput {
  targetNoteId: number | null;
  targetPath: string | null;       // raw target string for unresolved (hyperlink URLs, dangling refs)
  type: "wikilink" | "mention" | "frontmatter-ref" | "hyperlink";
  rel: string | null;              // for frontmatter-ref: the property name (e.g. "owner", "assignee")
  anchor: string | null;
  lineNumber: number | null;
}
class EdgesQueries {
  insertBatch(sourceNoteId: number, edges: EdgeInput[]): void;
  deleteByNote(noteId: number): number;
}
```

D-02 contract — `extractAllEdges` shape (RESEARCH lines 565–578):
```typescript
export function extractAllEdges(vault: Vault, parsed: ParsedNote, resolver: WikilinkResolver): EdgeInput[];
```

D-03 contract — mention extraction:
- Tokenization: casefold + min-length 4 + word-boundary regex `\b`.
- Scope: paragraph blocks only; pre-strip `[[…]]` wikilinks and inline code spans.
- Candidate set: titles + aliases from `note_aliases` (already indexed by `alias_norm`); built once per indexer run (Pattern E single-run cache).
- Constant `MIN_MENTION_LEN = 4` exported and tested.

Pitfall 6 contract — frontmatter-ref extraction:
- Rule (a): any property value (at any depth) matching `^\s*\[\[([^\]]+)\]\]\s*$` → resolve via existing `WikilinkResolver`; `rel` = the property path (e.g. `"owner"`, `"attendees[0]"`).
- Rule (b): allowlisted property names whose value is a bare string → match against `note_aliases` only (NOT against arbitrary titles). Allowlist constant:
  ```typescript
  const FRONTMATTER_REF_ALLOWLIST = new Set([
    "assignee", "owner", "project", "related",
    "parent", "child", "attendees", "superseded_by",
  ]);
  ```
- Document this heuristic in tool description text (referenced by Plan 04-04 `expand` tool registration); also as a header comment in `extract-edges.ts`.

Hyperlink contract (Claude's Discretion, locked here):
- Match Markdown link syntax `[text](url)` AND bare `http://` / `https://` URLs in paragraph block text.
- Skip relative paths (no scheme; those are Obsidian asset embeds, captured by future `embed` edge type).
- Image embeds `![alt](url)` are included ONLY when `url` starts with `http(s)://`.
- `target` = raw URL string; `targetNoteId = null` (hyperlinks do not resolve to DocIds in v2.0.0); store URL in `target_path` column.

WikilinkResolver call site (existing — `src/indexer/resolver.ts`): Plan 04-02 does NOT modify the resolver itself. It is reused as a black box from `extractFrontmatterRefEdges` for rule (a) wikilink-shaped property values.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement three new edge extractors + extractAllEdges entry point</name>
  <files>src/indexer/extract-edges.ts, src/indexer/extract-edges.test.ts</files>
  <behavior>
    Mention extractor (D-03):
    - Test 1: A paragraph block "Alice and Bob met yesterday." with `note_aliases` containing `alice` (target=people/alice-chen.md) and `bob` (target=people/bob-martinez.md) produces two edges with `type='mention'`, correct `targetNoteId`, and `lineNumber` = the paragraph's line.
    - Test 2: A paragraph "the API is slow" with alias `the` and `API` present in note_aliases — neither produces a mention (both under MIN_MENTION_LEN=4 after casefold).
    - Test 3: A paragraph containing `[[Alice]] and Alice C. attended.` produces ONE wikilink edge for the bracketed span AND ONE mention edge for the bare "Alice" in `Alice C.` — the wikilink syntax is pre-stripped before the mention regex runs, so the bare occurrence outside the bracket is matched independently (avoids double-counting the bracketed name; standalone occurrence outside the bracket is a legitimate mention per D-03).
    - Test 4: An inline code span ``the `Alice` API`` — no mention edge for "Alice" (pre-strip code spans).
    - Test 5: A heading block `## Alice` — no mention edge (only paragraph blocks scanned).
    - Test 6: A code-fence block (kind !== 'paragraph') — no mentions extracted.
    - Test 7: Dedup — paragraph "Alice met Alice and Alice" produces ONE edge per (target, line) pair via `dedupBy(e, e => `${e.targetNoteId}:${e.lineNumber}`)` per RESEARCH lines 608–609.

    Frontmatter-ref extractor (Pitfall 6):
    - Test 8: Frontmatter `owner: "[[alice-chen]]"` → rule (a) fires; one frontmatter-ref edge with `rel='owner'`, target resolved via WikilinkResolver.
    - Test 9: Frontmatter `attendees: ["[[alice-chen]]", "[[bob-martinez]]"]` → rule (a) fires per element; two edges with `rel='attendees'` (array index NOT encoded in `rel` — keep flat property name; alternatively `rel='attendees[0]'` is acceptable but pick one convention and pin in the test).
    - Test 10: Frontmatter `owner: "alice-chen"` → rule (b) fires (owner is in allowlist + value is bare string); one edge resolved via `note_aliases`.
    - Test 11: Frontmatter `status: "active"` → NO edge even if a note titled "Active" exists with alias "active" (status is NOT in allowlist; rule (b) blocks).
    - Test 12: Frontmatter `random_key: "alice-chen"` → NO edge (key not in allowlist; rule (b) blocks).
    - Test 13: Frontmatter `superseded_by: "obsidian-fs://v2-test-vault/decisions/x-old.md"` (a DocId, not an alias) → rule (b) attempts alias resolution and fails; NO edge emitted. (Acceptable: forward-only supersede from Phase 2 D-03 means the back-edge is derived at query time, not materialized; the test pins this non-extraction explicitly.)

    Hyperlink extractor:
    - Test 14: Paragraph "See https://example.com for details." → one hyperlink edge with `target_path='https://example.com'`, `targetNoteId=null`.
    - Test 15: Paragraph "[docs](https://example.com/docs) explain it." → one hyperlink edge with `target_path='https://example.com/docs'`.
    - Test 16: Paragraph "[local](./readme.md)" → NO edge (relative path, skipped).
    - Test 17: Paragraph "![diagram](https://example.com/d.png)" → one hyperlink edge (image with http(s) target).
    - Test 18: Paragraph "![local](images/d.png)" → NO edge (image with relative path).
    - Test 19: A code-fence block containing `https://example.com` — NO edge (paragraph-block-only scope, like mentions).

    extractAllEdges integration:
    - Test 20: A note with all four edge types in one parse pass → exactly the expected mix returned in a single `EdgeInput[]`; no dedup across types; wikilink path delegates to the existing wikilink extraction path (call `extractWikilinkEdges(parsed, resolver)` returning the same `EdgeInput[]` as today's wikilink resolution).
  </behavior>
  <action>
    Create `src/indexer/extract-edges.ts`. Top of file: header comment block per Pattern F citing Phase 4 / 04-02 / GRA-04 / D-02 / D-03 / Pitfall 6 / RESEARCH §"Code Examples". Export `MIN_MENTION_LEN = 4 as const` and `FRONTMATTER_REF_ALLOWLIST` as a frozen Set per `<interfaces>` above.

    Implement four exported functions:
    - `extractWikilinkEdges(parsed, resolver): EdgeInput[]` — wrap the existing wikilink resolution path (currently inside `src/indexer/single.ts:insertWikilinks` per PATTERNS line 209–222). Resolve each `ParsedWikilink` via `resolver`; produce `EdgeInput` with `type='wikilink'`, `targetNoteId` = resolved or null, `targetPath` = the original target string (for `findBrokenLinks` to surface unresolved), `anchor` = section anchor if present, `lineNumber` = parsed line. Per D-01, the legacy `wikilinks` table also keeps receiving these rows from `single.ts`; this function only adds the `edges`-row side.
    - `extractMentionEdges(parsed, vault): EdgeInput[]` — see RESEARCH lines 581–611. Build candidate set once: read all `note_aliases` rows; for each row, casefold the alias and skip if length < `MIN_MENTION_LEN`; map casefolded alias → `{ noteId, path }`. Iterate `parsed.blocks.filter(b => b.kind === "paragraph")`. For each block, strip `[[…]]` and inline `` `code` `` spans (regex: `/(?:\[\[[^\]]+\]\]|`[^`]*`)/g` → ` `); build a regex `\b(cand1|cand2|…)\b` casefolded over all candidates ≥ MIN_MENTION_LEN (use `(?<![a-zA-Z0-9])(cands)(?![a-zA-Z0-9])` for proper word-boundary handling around hyphens and underscores). Iterate matches; lookup candidate map (lowercased match); produce `EdgeInput` with `type='mention'`, `lineNumber` = block.line, `rel=null`, `anchor=null`. Dedup output by `${targetNoteId}:${lineNumber}` (RESEARCH line 609).
    - `extractFrontmatterRefEdges(parsed, vault, resolver): EdgeInput[]` — see RESEARCH lines 620–656 + Pitfall 6 + `<interfaces>`. Implement the two rules. `rel` field carries the top-level property name (`"owner"`, `"attendees"`, etc.) per the interface contract; if value is array, emit one edge per element with same `rel` value.
    - `extractHyperlinkEdges(parsed): EdgeInput[]` — paragraph-only scope. Regex (apply both, dedup by `target_path`):
      ```
      /\[(?:[^\]]*?)\]\((https?:\/\/[^\s)]+)\)/g   // [text](http://...)
      /(?<![\(\[])https?:\/\/[^\s\)\]]+/g         // bare URLs, not inside markdown link parens
      ```
      `EdgeInput`: `type='hyperlink'`, `targetNoteId=null`, `targetPath=<url>`, `rel=null`, `anchor=null`, `lineNumber=block.line`.

    `extractAllEdges(vault, parsed, resolver)` returns `[...extractWikilinkEdges, ...extractMentionEdges, ...extractFrontmatterRefEdges, ...extractHyperlinkEdges]`. No cross-type dedup — the UNIQUE constraint on `(source_doc, target_doc, type, anchor)` handles row-level idempotency at the DB layer per Pattern C.

    Source-neutrality: zero imports of `fs`, `path.join`, `gray-matter`, `chokidar`. Only imports allowed: `src/types.ts`, `src/db/queries/edges.ts`, `src/indexer/resolver.ts`, `src/vault/manager.ts` (for `Vault`). Pattern A enforces this; CI grep verifies.

    Co-locate `src/indexer/extract-edges.test.ts`. Fixture-build helper:
    ```typescript
    function makeParsed(blocks: Array<{kind: string; text: string; line: number}>,
                       frontmatter: Record<string, unknown> = {}): ParsedNote { ... }
    ```
    `:memory:` Vault per PATTERNS line 114–119. For each test, seed `db.notes.upsertByPath` + `db.aliases.setForNote` to populate the candidate set.
  </action>
  <verify>
    <automated>npx vitest run src/indexer/extract-edges.test.ts</automated>
  </verify>
  <done>All 20 extractor tests green; lint clean; no new fs/path/gray-matter imports.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire extractAllEdges into the indexer write path</name>
  <files>src/indexer/single.ts, src/indexer/single.test.ts, src/indexer/resolver.ts</files>
  <behavior>
    - Test 1: Indexing a single note that contains a wikilink, a mention, a frontmatter-ref, and a hyperlink produces exactly four rows in `edges` (one of each type) after one `indexSingle()` call. Re-indexing the same note produces no duplicates (INSERT OR IGNORE + UNIQUE) and no row count change.
    - Test 2: The legacy `wikilinks` table also still receives the wikilink row (per D-01, the legacy write path is preserved for v1 invariance).
    - Test 3: Deleting a note (FK ON DELETE CASCADE from migration 011) removes all of that note's outgoing `edges`.
    - Test 4: The body-hash fast-path branch (`single.ts:117–119`) also calls `extractAllEdges` and writes to `edges` — re-indexing a note whose body changed but frontmatter did not still produces the correct edge mix (fast path is NOT a shortcut around edge re-extraction).
    - Test 5 (regression): `evals/v1-baseline/baseline.test.ts` green.
  </behavior>
  <action>
    In `src/indexer/single.ts`: at the two existing call sites (PATTERNS line 224–235 — body-hash fast path and full re-embed branch), add the unified extractor call alongside the existing `insertWikilinks` call:
    ```typescript
    // ── Phase 4 / 04-02 / GRA-04 / D-02: write all four edge types ──
    // The legacy wikilinks path stays in place per D-01; we additionally
    // populate vault.db.edges so all graph reads (Plan 04-01) see typed
    // edges. INSERT OR IGNORE + UNIQUE makes re-indexing idempotent.
    vault.db.edges.deleteByNote(upsert.id);
    const allEdges = extractAllEdges(vault, parsed, resolver);
    if (allEdges.length > 0) vault.db.edges.insertBatch(upsert.id, allEdges);
    ```
    Insert this immediately after the existing `vault.db.wikilinks.deleteByNote(upsert.id)` / `insertWikilinks(...)` pair in BOTH branches (analog PATTERNS lines 225–229 and 232–235).

    Do NOT modify `src/indexer/resolver.ts` mechanics. The WikilinkResolver instance threaded through `single.ts` is passed straight into `extractAllEdges` for use by `extractFrontmatterRefEdges` rule (a). If the resolver is not currently in scope at the call site, lift it from the existing indexer surface (or create a helper accepting `(vault, parsed)` that constructs the resolver internally — pick whichever requires fewer touches to `single.ts`'s call signature).

    Append cases to `src/indexer/single.test.ts` per `<behavior>` above. Fixture: synthesize a `ParsedNote` (per the existing helper pattern in `single.test.ts`) carrying one of each edge-type-emitting construct. Assertions read `db.prepare("SELECT type, target_doc, target_path FROM edges WHERE source_doc = ?").all(noteId)`.

    Pattern F comment block above every change site.
  </action>
  <verify>
    <automated>npx vitest run src/indexer/single.test.ts && npm run eval:baseline</automated>
  </verify>
  <done>Indexer writes all 4 edge types per parse pass; legacy wikilinks path unchanged; v1-baseline green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Untrusted note body → mention extractor | Mention extractor reads user-authored markdown; min-length + word-boundary regex limits false-positive amplification but does not protect against malicious-input pathologies. |
| Untrusted frontmatter → frontmatter-ref extractor | Property keys are user-controlled; allowlist (8 keys) prevents arbitrary key activation. |
| User aliases → mention candidate set | `note_aliases` is user-controlled; agent observations cannot inject aliases (writes go through DeliveryAdapter and aliases are not a write-target of agent tools per Phase 2 contract). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-02-01 | Information Disclosure | Mention extractor over-matching on private terms in agent memory | mitigate | D-03 exact-match only (no fuzzy); MIN_MENTION_LEN=4 prevents pronoun/acronym noise; word-boundary regex prevents substring matches inside other words. |
| T-04-02-02 | Information Disclosure | Frontmatter-ref allowlist over-activation | mitigate | Allowlist is closed set (8 keys); rule (b) restricts to `note_aliases` only (no arbitrary title match); rule (a) requires `[[…]]` syntax (explicit author intent). |
| T-04-02-03 | Denial of Service | Catastrophic regex backtracking on malformed markdown | mitigate | Mention regex uses simple `\b(alt1\|alt2\|…)\b` (no nested quantifiers); hyperlink regexes are linear (`[^\s)]+`). Tested with fixtures up to 1MB body content (no exponential blowup). |
| T-04-02-04 | Integrity / determinism | Mention regex matching depends on Map insertion order on candidate set | mitigate | Candidate set sorted by alias_norm before regex compilation; regex alternation order is deterministic across runs. |
| T-04-02-05 | Information Disclosure | `_memory` body content gaining mention edges that leak via expand() | accept (this plan) | `_memory` opacity is enforced at `expand()` hydration time (Plan 04-03 / Pitfall 3), not at extraction time. Storing the edge is fine — surfacing it is gated. |
</threat_model>

<verification>
**Acceptance:**
- `npx vitest run src/indexer/extract-edges.test.ts src/indexer/single.test.ts` — all new tests pass.
- `npm test` — 1076+ tests pass.
- `npm run lint` clean.
- `bash scripts/lint-adapters.sh` — zero hits.
- `npm run eval:baseline` — v1-baseline byte-identical.
- Empirical validation against Atlas Robotics fixture (RESEARCH Pitfall 2 + A1):
  ```bash
  # Indexer dry-run + dump of extracted edges per note
  node --import tsx scripts/debug-extract-edges.mts evals/fixtures/v2-test-vault > /tmp/edge-dump.txt
  ```
  Manually inspect for < 3 false-positive mentions per note. If "Spire" or "Alice" produces > 3 false positives per note, raise MIN_MENTION_LEN to 5 (assumption A1 mitigation). The `debug-extract-edges.mts` script is optional — if not authored, run a one-off vitest test in-place to dump per-note edge mix.

**Eval queries:** none new. Plan 04-06 lands `_queries/expand.yaml` etc.

**Snapshot checks:** No tool-list snapshot regen yet (deferred to Plan 04-07).
</verification>

<validation>
**Nyquist Dimension 8:**
- **Coverage map:**
  - GRA-04 (D-02 unified extractor) → `src/indexer/extract-edges.test.ts` "extractAllEdges integration" (test 20)
  - GRA-04 (D-03 mention rules) → `src/indexer/extract-edges.test.ts` tests 1–7
  - GRA-04 (Pitfall 6 frontmatter-ref rules) → `src/indexer/extract-edges.test.ts` tests 8–13
  - GRA-04 (hyperlink scope) → `src/indexer/extract-edges.test.ts` tests 14–19
  - GRA-04 (indexer integration + idempotency) → `src/indexer/single.test.ts` tests 1–5
- **Per-task verify:** see `<verify>`.
- **Sampling per RESEARCH:** per task — `npx vitest run <file>` + `npm run lint`. Per wave merge — `npm test` + `npm run eval:baseline`. Phase gate — full eval suite green (deferred to Plan 04-07).
</validation>

<success_criteria>
1. `src/indexer/extract-edges.ts` exists with `extractAllEdges` + 3 sibling extractors implementing D-03 and Pitfall-6 verbatim.
2. Mention extraction is deterministic, casefold + min-length 4 + word-boundary, excludes wikilinks/headings/code blocks.
3. Frontmatter-ref extraction follows two-rule heuristic with closed 8-key allowlist for rule (b).
4. Hyperlink extraction captures `[text](url)` + bare URLs + image embeds with `http(s)://` only.
5. `vault.db.edges.insertBatch` is called from BOTH indexer branches; re-index is idempotent.
6. `npm test` + `npm run lint` + `scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
7. Empirical validation against Atlas Robotics: < 3 false-positive mentions per note (raise to MIN_MENTION_LEN=5 if not met, per A1).
</success_criteria>

<commit>
Atomic commit message:

```
feat(04-02): indexer extracts mention/frontmatter-ref/hyperlink edges

- src/indexer/extract-edges.ts: extractAllEdges() + 3 sibling extractors
  implementing D-03 (mention: casefold + min-length 4 + word boundary,
  paragraph blocks only, reuses note_aliases), Pitfall 6 (frontmatter-ref:
  rule (a) [[...]] wikilink syntax in property values; rule (b) closed
  8-key allowlist matched against note_aliases), and hyperlink scope
  ([text](url) + bare URLs, http(s) only, skip relative paths).
- src/indexer/single.ts: both indexer branches now call extractAllEdges()
  and write via vault.db.edges.insertBatch() in addition to the legacy
  wikilinks path (D-01 keeps wikilinks table writable for v1 invariance).
- Re-indexing is idempotent via INSERT OR IGNORE + UNIQUE on
  (source_doc, target_doc, type, anchor).

GRA-04 complete. v1-baseline green; lint-adapters greps zero.

Refs: GRA-04, D-01, D-02, D-03, Pitfall 6
```
</commit>

<output>
Create `.planning/phases/04-graph-as-retrieval/04-02-edge-extractors-SUMMARY.md` when done.
</output>
