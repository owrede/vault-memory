---
phase: 03-bundles-authority-staleness
plan: 04
status: complete
completed: 2026-05-17
requirements:
  - ASM-01
  - ASM-05
  - ASM-06
files_created:
  - src/assembly/bundle.ts
  - src/assembly/bundle.test.ts
files_modified:
  - src/assembly/index.ts
  - src/tool-registry.ts
  - src/tool-registry.test.ts
  - src/server.ts
  - src/server.test.ts
  - evals/v1-baseline/baseline.test.ts
  - evals/v1-baseline/tools-list.snapshot.json
commits: 3
tests_added: 15
---

# Phase 3 Plan 04: `get_document_bundle` MCP tool — Summary

Ship the document-tree retrieval surface of Phase 3: given a `doc_id`,
the new `get_document_bundle` returns a single composite packet with
the anchor's citation packet, the section outline (delegating to
`buildOutlineTree` from 03-02), backlinks + forward links (each with
their own full citation packet + body snippet), and the ≤10 most
recent `audit_log` entries for the document.

The bundle is the Phase 3 read tool that composes the most other Phase
3 reads — anchor packet hydration shared with `recall` /
`search_hybrid`, outline tree shared with `get_outline`, link hydration
shared with `assemble_dossier`, recent-edits surfacing the Plan 02-06
`is_memory_sink_write` discriminator. Closes ASM-01 entirely and
contributes the anchor half of ASM-05 + the bundle half of ASM-06.

Every citation packet on the wire is byte-shape-identical to recall's
8-field D-01 packet — the bundle imports `CitationPacket` and
`toCitationPacket` directly from `src/memory/citation-packet.ts` and
does NOT redefine the 8 fields (M1 fix from plan-checker). Bundle
extras (`property_snippet`, `relation`, `status`, `superseded_by`,
`is_memory_sink_write?`) are intersected onto `CitationPacket` rather
than substituted.

## Outcome

| Acceptance criterion | Status |
|---|---|
| `get_document_bundle` registered, listed, callable | ✅ TOOLS array + TOOL_SCHEMAS, snapshot regen passes byte-identity |
| Response includes outline + backlinks + forward_links + recent_edits + anchor packet | ✅ `BundleResult` shape covers all five |
| `recent_edits` length ≤ 10 even when audit log has more entries | ✅ Test (c): 50-row audit fixture, asserts `.toHaveLength(10)` |
| Every backlink/forward-link entry has a full 8-field `CitationPacket` | ✅ Imported from `src/memory/citation-packet.ts`; test (a) pins all 8 fields per entry |
| `properties` is always `Record<string, unknown>` (≥ `{}`), never `undefined` | ✅ Test (a) asserts `typeof bl.properties === "object"` on backlinks + forward links |
| Anchor packet carries `status?` / `superseded_by?` when present in frontmatter | ✅ ASM-06 hydration test + integration smoke confirm propagation |
| `property_snippet` is body plain-text, ≤200 chars, no frontmatter | ✅ Test (f) + long-body truncation test pin both invariants |
| Unknown `doc_id` → `{isError:true, error:"doc_not_found"}` | ✅ Test (d) + malformed/unknown-vault/vault-filter-exclusion variants |
| JSDoc records v2.0.0 rename-history limitation | ✅ File header §"Recent-edits rename-history limitation" |
| No `fs`/`gray-matter`/`chokidar`/`path` imports | ✅ `scripts/lint-adapters.sh` green |
| All tests pass; v1-baseline green | ✅ 15 new tests pass; baseline 30 pass / 11 skipped |
| `is_memory_sink_write` surfaces on recent_edits when applicable | ✅ Test (g): truthy-only — omitted from wire shape when false |

## How the slice composes other Phase 3 / Phase 2 surfaces

| Bundle field | Source |
|---|---|
| `anchor` (CitationPacket + status/superseded_by) | `toCitationPacket` (Phase 2 `src/memory/citation-packet.ts`) + the same hydration codepath 03-05 extends in `search_hybrid` / `recall` |
| `outline` (OutlineNode[]) | `buildOutlineTree` (03-02, `src/assembly/outline.ts`) — delegated, NOT duplicated |
| `backlinks[].relation`, `forward_links[].relation` | `listBacklinks` / `listForwardLinks` (Phase 1 `src/graph/graph.ts`), v2.0.0 only emits `"wikilink"`; PHASE-4-WIDEN markers flag the change site |
| `backlinks[].property_snippet`, `forward_links[].property_snippet` | New `bodyPlainText(BlockNode[])` helper in `bundle.ts`; frontmatter is already separated by the `Document.properties` / `Document.blocks` split so no manual strip is needed |
| `recent_edits[]` | `getAuditLog({notePath, limit: 10})` (Phase 1 `src/audit/audit.ts`); maps `AuditLogEntry` → compact `BundleRecentEdit` wire shape |
| `recent_edits[].is_memory_sink_write` | Plan 02-06 / MEM-08 discriminator on `audit_log`; surfaced truthy-only to keep the wire shape compact for the common non-memory write case |

## What ships

1. **`src/assembly/bundle.ts`** (~450 LOC):
   - `getDocumentBundle(deps, args)` controller.
   - `BundleResult` / `BundleAnchor` / `BacklinkEntry` / `ForwardLinkEntry` / `BundleRecentEdit` types.
   - `withBundleAnchorExtras(packet)` helper — same shape as dossier's `withDossierExtras`.
   - `bodyPlainText(blocks)` helper — projects `BlockNode[]` to ≤200 char plain-text snippet.
   - File header JSDoc documents the rename-history limitation (M3 fix from plan-checker).
2. **`src/assembly/bundle.test.ts`** (~700 LOC): 15 unit + integration test cases.
3. **`src/assembly/index.ts`**: re-exports `getDocumentBundle` + types.
4. **`src/tool-registry.ts`**:
   - TOOLS entry: `get_document_bundle` with depth pinned via JSON Schema `enum: [1]`.
   - TOOL_SCHEMAS entry: Zod `z.literal(1).optional().default(1)` for depth, regex-pinned doc_id.
5. **`src/server.ts`**: handler dispatch closure over `manager` + `sourceConnectorFor`. The existing `DocNotFoundError` catch (added in 03-02) wraps thrown not-found errors into `{error:"doc_not_found", doc_id}` consistent with `get_outline`.
6. **Tool-count assertion bumps** (29 → 30) at: `src/server.test.ts` (3 sites), `src/tool-registry.test.ts`, `evals/v1-baseline/baseline.test.ts`.
7. **Snapshot regen**: `evals/v1-baseline/tools-list.snapshot.json` — additive only (one new tool entry).

## Decisions / interpretations

- **Forward links: broken links omitted.** The bundle calls `listForwardLinks(vault, path, includeBroken: false)`. A broken wikilink (target file does not exist) cannot be hydrated via `SourceConnector.readDocument` — there is no document to cite. `find_broken_links` / `list_forward_links` remain the right tools for the broken-link audit use case. Phase 4 may add a separate `broken_forward_links` array if the use case emerges.
- **`is_memory_sink_write`: truthy-only.** The wire shape omits the field on regular user writes rather than always emitting `false`. Keeps the bundle response compact for the common case and matches the "surfaced per RESEARCH §5 open question" instruction in the plan — explicit when true, invisible when not.
- **Property snippet sourcing.** The plan reads "first 200 chars of the linking doc's body (strip frontmatter)". Because `Document.blocks` already excludes frontmatter (frontmatter lives in `Document.properties`), the implementation just projects block text and truncates. No `--- delimiter` strip is needed. Test (f) pins this — the snippet never contains `---` or YAML keys.
- **Depth pin.** `depth` is implemented as `z.literal(1).optional().default(1)` — Zod rejects any other value at the boundary. The controller does not clamp because it never sees a non-1 value. Phase 4 widens additively (literal union or `z.number().int().min(1).max(2)`).
- **Snapshot stability.** The snapshot regen produced an additive-only diff — one new tool entry inserted between `search_sections` and `assemble_dossier`. The 23-entry v1 prefix remained byte-identical.

## Adapter seam discipline

`src/assembly/bundle.ts` imports only from: `../adapters/registry.js`, `../adapters/source/types.js`, `../audit/audit.js`, `../graph/graph.js`, `../memory/citation-packet.js`, `./outline.js`, `./types.js`, `../types.js`, `../vault/index.js`. No `fs`, no `gray-matter`, no `chokidar`, no `path.*`. CI lint (`scripts/lint-adapters.sh`) confirms green across all I-1 .. I-7 invariants plus the C-1 Claude-branding check.

## Test outcomes

- `src/assembly/bundle.test.ts`: 15 / 15 passing.
- `src/assembly/`: 8 files, 122 tests passing (15 new + 107 prior).
- `evals/v1-baseline/baseline.test.ts`: 30 passing / 11 skipped — additive snapshot verified.
- `src/tool-registry.test.ts`: 27 / 27 passing.
- Full repo (excluding `.claude/worktrees/**` duplicate-discovery noise): 1051 passing, 1 pre-existing flaky timing-sensitive chokidar test (`change-feed.test.ts > emits delete on an unlinked .md file`) that passes in isolation — not introduced by this slice.
- `npx tsc --noEmit`: clean.
- `bash scripts/lint-adapters.sh`: all 7 invariants green.

## Known v2.0.0 limitations (documented, no fix this slice)

### Rename-history not surfaced in `recent_edits` (M3 fix from plan-checker)

`getAuditLog({notePath})` looks up entries by current note path. Pre-rename audit_log rows are keyed on `note_id` internally — when a note is renamed `foo.md → bar.md`, `get_document_bundle({doc_id: "obsidian-fs://vault/bar.md"})` returns only post-rename edits. Documented in:
- `src/assembly/bundle.ts` file header §"Recent-edits rename-history limitation".
- 03-PLAN.md §"Open questions / known risks".

Phase 4 will widen this once the graph layer centralizes `doc_id → note_id` resolution. The audit_log retains pre-rename rows for forensic purposes — they remain queryable via `audit_log({note_path: "foo.md"})` until the old note row is purged.

### `relation: "wikilink"` is the only edge type in v2.0.0

The v1 `wikilinks` table is the only edge source available. Phase 4 (GRA-04 typed edges) widens additively. `PHASE-4-WIDEN` marker comments flag the one-line change site (mirrors the same convention in `src/assembly/dossier.ts`).

## Commits

| Hash | Type | Message |
|---|---|---|
| `664ef6b` | feat | `getDocumentBundle` controller — anchor + outline + links + recent edits |
| `8b28c6e` | feat | Register `get_document_bundle` MCP tool + server dispatch |
| `e4c11fd` | test | `bundle.test.ts` — 15 cases covering composition + error paths + ASM-06 hydration |

## Self-Check: PASSED

Verified after writing this SUMMARY:

- `src/assembly/bundle.ts` exists.
- `src/assembly/bundle.test.ts` exists.
- All three commits (`664ef6b`, `8b28c6e`, `e4c11fd`) present in `git log`.
- `evals/v1-baseline/tools-list.snapshot.json` regen committed; baseline test passes.
- Adapter lint + typecheck clean.
