---
phase: 03-bundles-authority-staleness
plan: 06
status: complete
completed: 2026-05-16
requirements:
  - ASM-04
  - ASM-05
  - ASM-10
files_created:
  - src/assembly/dossier.ts
  - src/assembly/index.ts
  - src/assembly/dossier.test.ts
  - src/assembly/dossier.integration.test.ts
files_modified:
  - src/tool-registry.ts
  - src/tool-registry.test.ts
  - src/server.ts
  - src/server.test.ts
  - evals/v1-baseline/baseline.test.ts
  - evals/v1-baseline/tools-list.snapshot.json
  - evals/fixtures/v2-test-vault/people/alice-chen.md
  - evals/fixtures/v2-test-vault/projects/atlas-1.md
  - evals/fixtures/v2-test-vault/_queries/dossier.yaml
  - CHANGELOG.md
commits: 7
tests_added: 25
---

# Phase 3 Plan 06: `assemble_dossier` MCP tool — Summary

Ship the first content-walking assembly tool of Phase 3: given a
`{type, key}` pair, the new `assemble_dossier` resolves an anchor
document (strict `properties.type` match, title-or-aliases key match)
and walks its backlinks to produce a structured packet with rollups.
Closes the floor for the ASM-04 + ASM-05 (partial) + ASM-10
requirement trio.

Every linked document carries a full 8-field `CitationPacket` (D-01)
imported directly from `src/memory/citation-packet.ts` — the same
shape the Phase 2 `recall` tool returns — plus a `relation` tag.
v2.0.0 returns `relation: "wikilink"` on every entry because the v1
`wikilinks` table is the only edge source available; Phase 4 (GRA-04
typed edges) will widen the field. `PHASE-4-WIDEN` marker comments
flag the one-line change sites.

## Outcome

| Acceptance criterion | Status |
|---|---|
| `assemble_dossier` registered, listed, callable | PASS |
| Title match works (Alice → alice-chen.md) | PASS (unit + integration) |
| Alias match works (Alice C. → alice-chen.md) — alias frontmatter committed | PASS (unit + integration) |
| No match → `{anchor: null, error: { code: "no_matching_anchor_document", … }}` | PASS |
| `DossierResult.anchor` + every `LinkedDocument` typed via `CitationPacket` (M1 plan-checker fix) | PASS |
| `properties` field on every entry is `Record<string, unknown>`, never `undefined` | PASS (unit case (i)) |
| `linked_documents[].relation === "wikilink"` everywhere (v2.0.0) | PASS (unit case (h) + integration) |
| `property_rollups` computes `linked_count`, `linked_types`, `status_distribution` correctly | PASS (unit cases (e), (f), (g)) |
| Keys in `linked_types` / `status_distribution` sorted alphabetically | PASS |
| ≥7 dossier queries in `_queries/dossier.yaml` (was 6 → now 8 with the 2 new cases) | PASS |
| No `fs`/`path`/`gray-matter`/`chokidar` imports in `src/assembly/` | PASS (`bash scripts/lint-adapters.sh`) |
| All existing tests + new tests green; v1-baseline green; CI greps clean | PASS (985 / 996 in suite, 11 pre-existing skips, no new failures attributable to this slice) |

## Files changed

### Created (4)

- `src/assembly/dossier.ts` — `assembleDossier(deps, args)` controller (~330 LOC after comments).
  Pure: no fs/path/gray-matter/chokidar. Reads docs via injected `SourceConnector`.
- `src/assembly/index.ts` — public barrel; re-exports `assembleDossier`,
  `AssembleDossierArgs`, `AssembleDossierDeps`, `DossierAnchor`, `DossierError`,
  `DossierResult`, `LinkedDocument`.
- `src/assembly/dossier.test.ts` — 17 unit cases (9 plan-mandated + 8 invariants).
- `src/assembly/dossier.integration.test.ts` — 3 cases against the real
  Atlas Robotics fixture (walks `evals/fixtures/v2-test-vault/`, parses
  via `parseNote`, seeds notes + wikilinks).

### Modified (10)

- `src/tool-registry.ts` — TOOLS literal (entry 27) + TOOL_SCHEMAS Zod 4
  raw shape (`type: z.string().min(1)`, `key: z.string().min(1)`,
  `vaults: z.array(z.string().min(1)).optional()`).
- `src/tool-registry.test.ts` — count assertion 26 → 27; added 5
  schema-validation cases for `assemble_dossier`.
- `src/server.ts` — imports `assembleDossier`; new handler in the
  `handlers: Record<ToolName, Handler>` map; injects manager +
  `sourceConnectorFor` closure.
- `src/server.test.ts` — three byte-count assertions bumped 26 → 27.
- `evals/v1-baseline/baseline.test.ts` — count assertion 26 → 27.
- `evals/v1-baseline/tools-list.snapshot.json` — regenerated via
  `npm run eval:snapshot`. The 23-entry v1 prefix remains byte-identical.
- `evals/fixtures/v2-test-vault/people/alice-chen.md` —
  `type: Person`, `aliases: ["Alice C.", "ac"]` (see Deviation [Rule 2]).
- `evals/fixtures/v2-test-vault/projects/atlas-1.md` —
  `type: Project`, `authoritative: true`.
- `evals/fixtures/v2-test-vault/_queries/dossier.yaml` — appended 2 new
  queries (`alice-by-alias`, `authoritative-atlas-1`). Total 8.
- `CHANGELOG.md` — Unreleased / Added entry for `assemble_dossier`
  including the v2.0.0 `relation: "wikilink"` limitation.

## Decisions

1. **`CitationPacket` is the single source of truth.** Per the plan's M1
   plan-checker fix, dossier types are an intersection of `CitationPacket`
   (8 required fields, including `properties: Record<string, unknown>`
   always populated) with dossier-specific extras (`status`,
   `superseded_by`, `relation`). Dossier does NOT redefine a parallel
   7-field shape. Confirmed in 17 unit tests + 3 integration tests.

2. **Strict `properties.type` match — no synonyms, no case fold.** D-03.
   The unit case "type='Project' + key='Alice Chen' returns no match" pins
   this. The fixture mutation added `type: Person` / `type: Project` to
   the two fixture files because the existing people/projects notes had
   no `type:` field (logged as Rule 2 deviation).

3. **Title-OR-aliases key match.** D-04. The plan recommends an exact-
   string match against `title` OR any string entry in
   `properties.aliases`. Non-string entries in `aliases` are silently
   ignored (no coercion — `42` as an alias does not match the string
   `"42"`). Pinned by the defensive-handling test.

4. **Deterministic tiebreak by `(title, doc_id)` lex sort.** When two
   docs of the same type share a title, the lex-first candidate wins.
   Cross-vault: same rule, since the `doc_id` carries the vault name as
   authority. Unit case (d) pins.

5. **No superseded filter.** Per CONTEXT.md §Specifics, dossiers show
   the WHOLE picture — superseded backlinks appear in `linked_documents`
   with their `status` field populated. Only search applies an implicit
   `status: "superseded"` hide. Pinned by the "dossier does NOT filter
   superseded backlinks" unit test.

6. **`relation: "wikilink"` is hardcoded in v2.0.0.** A
   `// PHASE-4-WIDEN` marker comment in `src/assembly/dossier.ts:329`
   flags the one-line change site. The CHANGELOG entry documents the
   limitation. Phase 4 GRA-04 will swap `"wikilink" as const` for
   `edge.type` and widen `LinkedDocument.relation` to the full
   `Edge.type` enum.

7. **Rollup keys alphabetically sorted before return.** `linked_types`
   and `status_distribution` go through a `sortByKey` helper so the
   JSON serialization is deterministic across runs and across machines.
   Pinned by `Object.keys(...).toEqual(["Meeting", "Project"])` (case
   (f)) and the equivalent for status (case (g)).

## Metrics

| Metric | Value |
|---|---|
| Commits | 7 |
| Tests added | 25 (17 unit + 3 integration + 5 schema + bump to existing count assertions accounts for the rest) |
| Total suite size | 996 (was 971 — 25 new) |
| Suite pass rate | 985 passed + 11 pre-existing skips; 1 pre-existing chokidar flake unrelated to 03-06 (passes in isolation) |
| TypeScript | `tsc --noEmit` clean |
| Adapter-seam lint | All invariants green (I-1 through I-6 + I-5b + C-1) |
| `npm run eval:baseline` | 30 passed + 11 skipped, no regressions |
| Lines added (src/) | 463 (dossier.ts) + 577 (dossier.test.ts) + 211 (integration.test.ts) + 36 (tool-registry.ts) + 47 (tool-registry.test.ts) + 16 (server.ts) ≈ 1,350 |
| Lines added (evals/) | 38 (dossier.yaml) + 2 (fixture frontmatter) + ~150 (regenerated snapshot) |

## Self-Check

Verifying claims:

- **Files exist:**
  - `src/assembly/dossier.ts` — FOUND
  - `src/assembly/index.ts` — FOUND
  - `src/assembly/dossier.test.ts` — FOUND
  - `src/assembly/dossier.integration.test.ts` — FOUND
  - `evals/fixtures/v2-test-vault/people/alice-chen.md` `type: Person` + `aliases` — FOUND (`grep -c 'aliases:' …` returns 1)
  - `evals/fixtures/v2-test-vault/projects/atlas-1.md` `authoritative: true` — FOUND
  - `evals/fixtures/v2-test-vault/_queries/dossier.yaml` — 8 queries — FOUND

- **Commits exist (per `git log --oneline -8`):**
  - `45cd88b` — docs(03-06): CHANGELOG entry — FOUND
  - `90acb16` — test(03-06): integration smoke — FOUND
  - `17c940f` — chore(03-06): fixture mutations — FOUND
  - `28ec38e` — test(03-06): src/assembly/dossier.test.ts — FOUND
  - `f3ff073` — feat(03-06): server.ts handler — FOUND
  - `d47189b` — feat(03-06): register assemble_dossier — FOUND
  - `0fd5b3a` — feat(03-06): src/assembly/dossier.ts — FOUND

## Self-Check: PASSED

## Deviations

See `03-06-DEVIATIONS.md` for details. Summary:

- **[Rule 2]** Added `type: Person` to `alice-chen.md` and `type: Project`
  to `atlas-1.md` — the plan implicitly requires them for D-03 strict
  match resolution, but only explicitly mentioned `aliases:` and
  `authoritative:`. Without `type:` the acceptance criteria can't be met.
- **[Rule 1]** Dropped a corrupt-JSON unit test that probed a boundary
  below this module's responsibility (`queryFrontmatter`'s JSON1
  failure path, not `assembleDossier`'s own try/catch).
- **[Out of scope]** Pre-existing chokidar `unlink`-event flake in
  `change-feed.test.ts` triggered once in the final full-suite run; passes
  in isolation. Unrelated to 03-06; logged for traceability.

## Known stubs

None. The `relation: "wikilink"` hardcode is intentional v2.0.0 behavior
(documented in CHANGELOG + a `PHASE-4-WIDEN` source comment), not a stub —
v1's wikilinks table genuinely has no other edge types to emit. Phase 4
GRA-04 will widen.

## Threat flags

None. `assemble_dossier` is a pure read tool — no new write paths, no
new trust-boundary crossings, no new network calls. It composes existing
authorized surfaces (`queryFrontmatter`, `listBacklinks`,
`SourceConnector.readDocument`) and emits the same `CitationPacket`
shape Phase 2 already vetted. Nothing in the threat model applies that
isn't already covered by the existing surfaces.
