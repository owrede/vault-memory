---
plan: 03-04-get-document-bundle
phase: 03
wave: 2
depends_on: [03-01-sections-infrastructure, 03-02-get-outline, 03-05-search-hybrid-rescore]
asm: [ASM-01, ASM-05]
status: pending
---

# Slice 03-04: `get_document_bundle` MCP tool

## Objective

Ship the `get_document_bundle({doc_id, depth?: 1})` MCP tool — the document-tree retrieval surface that composes every other Phase 3 read: the document's own citation packet, its outline (via 03-02's `buildOutlineTree`), backlinks + forward links (from `src/graph/graph.ts`), and up to 10 most recent edits from `audit_log`. Every result item carries a citation packet (D-01 from Phase 2).

## Requirements covered

- **ASM-01** — `get_document_bundle({doc_id, depth?: 1})` MCP tool with document + backlinks (with property snippets) + forward links + section tree + recent edits.
- **ASM-05** (partial) — bundle response carries citation packets on the anchor document AND on every backlink/forward-link entry. Citation packet shape is byte-identical to `recall`'s (Phase 2 D-01 contract). Closes the citation-packet half of ROADMAP success criterion #1 for the bundle tool specifically.
- **ASM-06** (anchor doc) — the bundle's anchor packet carries `status?` and `superseded_by?` via the same hydration extension shipped in 03-05. This is why 03-04 depends on 03-05.

## Dependency rationale

03-04 depends on 03-05 (in addition to 03-01 and 03-02) because the bundle's anchor `CitationPacket` reads `properties.status` / `properties.superseded_by` (ASM-06) using the same hydration code path that 03-05 extends in `src/search/hybrid.ts` and the shared note-hydration helper. If 03-04 landed before 03-05, the anchor's `status` / `superseded_by` would be `undefined` and ASM-06 would be unsatisfied for the bundle's anchor doc. 03-04 stays in wave 2 (after 03-02 + 03-05 ship in wave 1).

## Files to create / modify

### Create

- `src/assembly/bundle.ts` — `getDocumentBundle(deps, args)` implementation.
- `src/assembly/bundle.test.ts` — unit tests covering: (a) doc with backlinks + forward links returns both; (b) doc with no backlinks returns `backlinks: []`; (c) `recent_edits` capped at 10 even if `audit_log` has 50; (d) unknown `doc_id` → `{ isError: true, error: "doc_not_found" }`; (e) bundle response includes outline tree (delegates to `buildOutlineTree` from 03-02); (f) backlinks carry property snippets (first 200 chars of linking doc body) per ASM-01 spec; (g) `is_memory_sink_write` flag surfaces on recent_edits when the writing client was the memory subsystem.

### Modify

- `src/tool-registry.ts` — register `get_document_bundle`. Zod input:
  ```ts
  export const GetDocumentBundleArgs = z.object({
    doc_id: z.string(),
    depth: z.literal(1).optional().default(1),  // v2.0.0 ships only depth=1; depth=2 is a Phase 4 widen.
    vaults: z.array(z.string()).optional(),
  });
  ```
- `src/server.ts` — handler dispatch mirroring 03-02's pattern.
- `src/assembly/index.ts` — re-export `getDocumentBundle`, `BundleResult` types.

## Approach

**Citation packet contract (M1 fix — single source of truth).** The bundle response, every backlink entry, and every forward-link entry are typed in terms of `CitationPacket` imported directly from `src/memory/citation-packet.ts`. Per `src/memory/citation-packet.ts:45-62`, `CitationPacket` has **8 REQUIRED fields** including `properties: Record<string, unknown>` (always populated by `toCitationPacket()`; empty object `{}` when the doc has no frontmatter). The slice does NOT define a bespoke 7-field packet shape — that would silently diverge from Phase 2's contract. Bundle-specific extras (`property_snippet`, `relation`, `status?`, `superseded_by?`) are intersected onto `CitationPacket` via `CitationPacket & { ...extras }`.

**Response shape (BundleResult):**

```ts
import type { CitationPacket } from "../memory/citation-packet.js";

interface BundleResult {
  // Anchor document — full CitationPacket + ASM-06 optional extras hydrated by 03-05's path
  anchor: CitationPacket & {
    status?: string;          // hydrated via the same path 03-05 extends
    superseded_by?: string;
  };

  // The four bundle components
  outline: OutlineNode[];                          // from 03-02's buildOutlineTree
  backlinks: BacklinkEntry[];                      // citation packets + snippet
  forward_links: ForwardLinkEntry[];               // citation packets
  recent_edits: BundleRecentEdit[];                // ≤10, from audit_log
}

type BacklinkEntry = CitationPacket & {
  property_snippet: string;   // first ~200 chars of the linking doc's body (per ASM-01 spec)
  relation: "wikilink";       // single value in v2.0.0; widens in Phase 4 additively
  // heading_path is inherited from CitationPacket; backlinks point at documents → packet has [] in v2.0.0
};

type ForwardLinkEntry = CitationPacket & {
  property_snippet: string;
  relation: "wikilink";
};

interface BundleRecentEdit {
  at: number;                                      // epoch ms
  op: "create" | "update" | "delete";
  client_id: string | null;                        // null = user, real string = agent
  is_memory_sink_write?: boolean;                  // surfaced per RESEARCH §5 open question
}
```

`CitationPacket.properties` is REQUIRED (`Record<string, unknown>`), defaulting to `{}` when no frontmatter is present. Tests assert `expect(packet.properties).toBeDefined()` AND `expect(typeof packet.properties).toBe("object")` for every entry — no `properties: undefined`.

**Algorithm:**

1. Resolve `doc_id` → `(vault, note_id)` via `decomposeDocId` (from `src/adapters/registry.ts`).
2. If note not found → `{ isError: true, error: "doc_not_found" }`.
3. Read the anchor `Document` via `SourceConnector.readDocument(doc_id)` — this is the only adapter-seam read.
4. Build document-level citation packet via `toCitationPacket(doc, displayUrlFor(doc.id, source))`. This returns a full 8-field `CitationPacket`. Layer the ASM-06 extras (`status`, `superseded_by`) by reading from `doc.properties` (already populated by the source adapter; the same hydration path 03-05 extends ensures consistency).
5. Build outline via 03-02's `buildOutlineTree(sectionsQueries.getByNote(noteId))`. Re-use the function — do NOT duplicate.
6. Read backlinks via `vault.db.wikilinks.listBacklinks(notePath)` (or whatever the Phase 1 `src/graph/graph.ts` exposes — verify). For each backlink, hydrate via `SourceConnector.readDocument` → `toCitationPacket` to get a full 8-field packet (including `properties: {}` at minimum), then truncate body plain text to 200 chars for `property_snippet`.
7. Read forward links via the symmetric `listForwardLinks(notePath)`. Same hydration loop.
8. Read recent edits via `getAuditLog({ vault, notePath, limit: 10 })` per RESEARCH §5 (`src/audit/audit.ts:62`). Map each `AuditLogEntry` to a `BundleRecentEdit` (keep only `{at, op, client_id, is_memory_sink_write}`).
9. Return the assembled `BundleResult`.

**`depth: 1` semantics** (only value accepted in v2.0.0): one-hop backlinks/forward-links. Phase 4 may widen to `depth: 2` (transitive) — out of scope for Phase 3. Zod schema pins to `z.literal(1).optional().default(1)` so the field is explicit but only one value is legal.

**Property snippet (ASM-01 spec literal: "backlinks (with property snippets)"):** "Property snippet" is interpreted per RESEARCH §5 context as a short content snippet from the linking doc's body — sized to fit a bundle response without blowing token budget. Use the first 200 chars of plain-text-rendered body (strip frontmatter). If the body is shorter, return whatever exists.

**Adapter-seam discipline:** `src/assembly/bundle.ts` reads `Document` via `SourceConnector.readDocument()` only. NO `fs.readFile`, NO `gray-matter`. The audit log access (`vault.db.audit.getAuditLog`) and graph access (`vault.db.wikilinks`) are L0 substrate, fine.

**Backlinks relation field caveat:** Per RESEARCH §9 and CHANGELOG note in 03-PLAN.md — v1's `wikilinks` table only knows `"wikilink"` edge type. Bundle ships `relation: "wikilink"` on every entry. Phase 4 widens; additive change.

**Recent-edits is_memory_sink_write:** Surfaces the Phase 2 Plan 02-06 discriminator. Useful so an agent inspecting a bundle can see "this doc was last edited by the memory subsystem" without joining tables. Optional field — only set when truthy.

## Known risks

### Rename-history is not surfaced (M3 fix — v2.0.0 limitation, documented)

`getAuditLog({notePath})` at `src/audit/audit.ts:93-97` looks up entries by current note path. Pre-rename audit_log entries are keyed on `note_id` internally but the path-lookup misses them — so if a doc was renamed from `foo.md` → `bar.md`, asking `get_document_bundle({doc_id: "obsidian://vault/bar.md"})` returns only the post-rename edits.

This is acceptable for v2.0.0 because: (a) Phase 3 is read-side; no new write path widens the rename problem; (b) audit_log retains the pre-rename rows for forensic purposes; (c) the collaborative-vault operating context (CONTEXT.md `<domain>` — "tolerating collaborators renaming notes") names this as a design pressure but does not require Phase 3 to surface pre-rename history in `recent_edits`.

**Action — no code change this phase:**
- Add a JSDoc note on `getDocumentBundle` (in `src/assembly/bundle.ts`) and on the `BundleRecentEdit` interface noting: "`recent_edits` is keyed by current note path; pre-rename history is preserved in `audit_log` but not surfaced by this tool. Widen in Phase 4 (graph) where `doc_id → note_id` resolution is centralized."
- 03-PLAN.md "Open questions / known risks" carries the same note (added in this revision).
- Phase 4 plan should pick this up as a follow-up under graph/expand work.

## Tasks

1. **`getDocumentBundle` implementation** in `src/assembly/bundle.ts` — import `CitationPacket` and `toCitationPacket` directly; the bundle response shape composes `CitationPacket & { ... }` intersections rather than redefining the 8 fields. Add JSDoc rename-history note. (~250 LOC)
2. **Tool registration** in `src/tool-registry.ts`. (~30 LOC)
3. **Server handler** in `src/server.ts`. (~30 LOC)
4. **Unit tests** `src/assembly/bundle.test.ts` — 7 cases per Files-to-create list. Use in-memory DB; mock `SourceConnector` to return canned `Document` objects so the body-snippet path is deterministic. Add explicit assertion that `bundle.anchor.properties` is always an object (never `undefined`) per the Phase 2 `CitationPacket` contract; same for every backlink/forward-link entry. (~270 LOC)
5. **Integration smoke** — one test that indexes a 3-note fixture (note A links to note B; B links to C; C has no backlinks), calls `getDocumentBundle` for B, asserts both backlinks (A→B) and forward links (B→C) appear, plus the outline + recent_edits. Also asserts that when B has `status: superseded` in frontmatter, the anchor packet carries `status: "superseded"` (proves the 03-05 dependency wiring works). (~120 LOC)
6. **`src/assembly/index.ts` re-export update** — barrel exposes `getDocumentBundle` and `BundleResult` type. (~5 LOC)

## Tests

- 7 unit cases + 1 integration case in `src/assembly/bundle.test.ts`
- 1 conformance assertion in slice 03-07 ("`get_document_bundle` includes recent_edits up to 10 and citation packets on both adapters")

**Estimated new test cases:** 10–12.

## Acceptance criteria

- [ ] `get_document_bundle` registered, listed, callable.
- [ ] Response includes outline + backlinks + forward_links + recent_edits + anchor citation packet.
- [ ] `recent_edits` length ≤ 10 even when audit log has more entries.
- [ ] Every backlink/forward-link entry has a full 8-field `CitationPacket` (imported from `src/memory/citation-packet.ts`); `properties` is always a `Record<string, unknown>` (at minimum `{}`), never `undefined`.
- [ ] Anchor packet carries `status?` / `superseded_by?` when present in frontmatter (proves 03-05 hydration-path dependency works).
- [ ] `property_snippet` is body plain-text, ≤200 chars, no frontmatter.
- [ ] Unknown `doc_id` → `{ isError: true, error: "doc_not_found" }`.
- [ ] JSDoc on `getDocumentBundle` records the v2.0.0 rename-history limitation per the Known risks section.
- [ ] No fs/gray-matter/chokidar/path imports.
- [ ] All tests pass; v1-baseline green; CI greps clean.
- [ ] `is_memory_sink_write` flag surfaces on recent_edits when applicable.

## Estimated effort

- **Tasks:** 6
- **Lines changed:** ~705 added across 2 new files + 3 modified files
- **PR shape:** one PR; depends on 03-01, 03-02, AND 03-05 (re-uses `buildOutlineTree` from 03-02 and inherits the hydration-extension contract from 03-05).

## Citations

- `src/memory/citation-packet.ts:45-62` — `CitationPacket` 8-field shape (imported directly; bundle does NOT redefine)
- `src/audit/audit.ts:62-125` — `getAuditLog({vault, notePath, limit})` API (RESEARCH §5)
- `src/audit/audit.ts:19-43` — `AuditLogEntry` shape
- `src/audit/audit.ts:93-97` — path-keyed lookup (rename-history limitation, documented in Known risks)
- `src/graph/graph.ts:1-130` — backlink/forward-link reads (RESEARCH §"Reusable Assets")
- `src/adapters/registry.ts` — `decomposeDocId`
- 03-CONTEXT.md §"Claude's Discretion" recent-edits — audit_log picked
- 03-RESEARCH.md §5 — recent_edits source rationale
