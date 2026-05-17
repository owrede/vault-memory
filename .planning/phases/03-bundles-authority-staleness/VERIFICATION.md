---
phase: 03-bundles-authority-staleness
verifier: gsd-verifier
date: 2026-05-17
status: passed
---

# Phase 3 — Bundles + authority/staleness — Verification

## Verdict

Phase 3 is **PASSED**. Goal-backward verification against the codebase confirms all five ROADMAP success criteria are observable in the implementation: the four assembly tools (`get_outline`, `search_sections`, `get_document_bundle`, `assemble_dossier`) ship and emit 8-field citation packets; `search_hybrid` carries four new strictly-additive optional params plus nine optional citation-shaped result fields with a default-no-op rescore; the v1 baseline eval is byte-identical (23 v1 tools unchanged, 30 baseline tests green); a parameterized stub-assembly conformance suite runs the four-tool contract against a hard-coded `Document[]` fixture; and the citation packet on every assembly result carries `mtime` (REQUIRED) plus `status` / `superseded_by` (optional extras). All eight adapter-seam invariants are green, `tsc --noEmit` is clean, and the full vitest suite reports `1076 passed | 11 skipped` exactly as the sign-off doc claims. ASM-13 is correctly recorded as "no MVP candidates" with a documented re-evaluation gate at Phase 5 (`list_briefs`) and Phase 6 (`list_contracts`).

## Success criteria coverage

| # | Criterion | Evidence | Verdict |
|---|-----------|----------|---------|
| 1 | Four tools return citation packet `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}` on every item; ≥5 dossier eval queries pass with ≥0.8 P/R | `CitationPacket` defined with 8 REQUIRED fields (8th = `properties`) at `src/memory/citation-packet.ts:47-62`; `toCitationPacket` mapper at `src/memory/citation-packet.ts:83-99` shallow-copies properties (always-defined). All four tools route returns through this mapper (`src/assembly/dossier.ts:425-440`, `src/assembly/bundle.ts:~360-410`, `src/assembly/outline.ts`, `src/assembly/search-sections.ts`). 8 dossier queries shipped in `evals/fixtures/v2-test-vault/_queries/dossier.yaml` (exceeds the ≥5 floor). | ✓ proven |
| 2 | v1 default behavior unchanged when no weights/filters supplied — re-run v1-baseline byte-identical | Rescore guarded behind `if (recencyWeight !== 0 || authorityWeight !== 0)` at `src/search/hybrid.ts:264`; 9 hydration fields default to `undefined` (JSON-omitted). `npm run eval:baseline` → 30 passed, 11 skipped (byte-identity test for 23 v1 tool entries at `evals/v1-baseline/tools-list.snapshot.json` slots 0–22). `src/search/hybrid.rescore.test.ts` carries an invariance pin (`recency_weight=0, authority_weight=0` → final order == RRF order). | ✓ proven |
| 3 | `search_hybrid` accepts `recency_weight`, `authority_weight`, `superseded` filter; fresh ranks higher when `recency_weight > 0`; `status: superseded` hidden by default | Four new optional params in `src/types.ts:HybridSearchOptions` (`recencyWeight`, `authorityWeight`, `halfLifeDays`, `includeSuperseded`) wired through `src/search/hybrid.ts:225, 254-296`. SQL-level filter via `_searchExclSup` second prepared statement at `src/db/queries/fts.ts:48, 73, 119` against the `notes_status` partial index (`src/db/schema.ts:587`). Fresh-vs-stale fixture pair + two scenarios in `evals/fixtures/v2-test-vault/_queries/recency.yaml`. Order-pin test at `src/search/hybrid.rescore.test.ts:250, 268, 339, 351`. | ✓ proven |
| 4 | Stubbed second adapter passes same eval suite as obsidian-fs — proves source-neutrality before Phase 9 | `src/adapters/stub/assembly-fixture.ts` ships 8 hand-authored `Document` objects covering Person+aliases, authoritative Project, superseded Project, frontmatter-ref/wikilink/mention/hyperlink edges, multi-section Long doc. `src/adapters/source/conformance.test.ts:577` registers `[obsidian-fs, stub-assembly]` adapters via `describe.each`; 5 assembly contract assertions run per adapter (10 total) at `conformance.test.ts:580+`. Source-neutrality bug uncovered + fixed during 03-07 (hardcoded `formatDocId("obsidian-fs", …)` → derived from `SourceConnector.handle`). Per RESEARCH §7 the P/R evals run on `obsidian-fs` only; the stub fixture covers contract conformance — disposition documented in `docs/v2/PHASE-3-SIGN-OFF.md:122-167`. | ✓ proven |
| 5 | Results carry `mtime`, `status` (if present), `superseded_by` (if present); list-style assembly ops promoted to MCP Resources where applicable (ASM-13) | `mtime` is REQUIRED on every `CitationPacket` (`src/memory/citation-packet.ts:55`). `status` + `superseded_by` surfaced as optional extras via `withBundleAnchorExtras` / `withDossierExtras` helpers. ASM-13 explicitly investigated in `docs/v2/PHASE-3-SIGN-OFF.md:194-223`: the four Phase 3 tools have keyed inputs (`doc_id`, `type+key`, `query`) — no clean LIST-shape candidates; `list_briefs` / `list_contracts` Resources promotion deferred to Phases 5 + 6 where natural candidates exist. Phase 2's MEM-09 Resources promotion (`memory_stats`, `list_sinks`) is inherited without regression. | ✓ proven |

## ASM requirements coverage

| Req | Description | Slice / File | Verdict |
|-----|-------------|--------------|---------|
| ASM-01 | `get_document_bundle({doc_id, depth?: 1})` | 03-04 — `src/assembly/bundle.ts`; `tool-registry.ts:689`; `depth: 1` literal-pinned (limitation recorded) | ✓ |
| ASM-02 | `get_outline({doc_id})` — nested tree with chunk IDs per node | 03-02 — `src/assembly/outline.ts`; `tool-registry.ts:559`; reads from `sections` table | ✓ |
| ASM-03 | `search_sections({query, limit})` — chunk-to-section promotion | 03-03 — `src/assembly/search-sections.ts`; `tool-registry.ts:585`; MAX-score composition over hybrid pipeline | ✓ |
| ASM-04 | `assemble_dossier({type, key})` — type+key resolution → anchor + linked docs + rollups | 03-06 — `src/assembly/dossier.ts`; `tool-registry.ts:727`; strict `properties.type` match (D-03); key = title OR alias (D-04) | ✓ |
| ASM-05 | All four tools return the 8-field citation packet | `src/memory/citation-packet.ts:45-99` (8 REQUIRED fields incl. `properties`); pinned by conformance Test #5 at `conformance.test.ts:773+` | ✓ |
| ASM-06 | Results carry `mtime`, `status?`, `superseded_by?` | `mtime` REQUIRED in `CitationPacket`; `withBundleAnchorExtras` / `withDossierExtras` add `status` + `superseded_by` optionally | ✓ |
| ASM-07 | `search_hybrid` accepts `recency_weight` + `authority_weight` | `src/types.ts:HybridSearchOptions:77-86`; `src/search/hybrid.ts:262-296`; snapshot rows at `tools-list.snapshot.json:144-153` | ✓ |
| ASM-08 | `search_hybrid` `superseded` filter; default hides; `include_superseded: true` to override | `src/search/hybrid.ts:225` (`excludeSuperseded` derivation); SQL filter via `_searchExclSup` against `notes_status` partial index; snapshot row at `tools-list.snapshot.json:160-164` | ✓ |
| ASM-09 | v1 default behavior unchanged | Rescore guarded at `src/search/hybrid.ts:264`; `evals/v1-baseline/baseline.test.ts` byte-identity check; `npm run eval:baseline` 30/30 green | ✓ |
| ASM-10 | ≥5 dossier eval queries with ≥0.8 P/R | 8 queries in `evals/fixtures/v2-test-vault/_queries/dossier.yaml` (exceeds floor); composition path documented in 03-CONTEXT | ✓ |
| ASM-11 | Stale-vs-fresh ranking with `recency_weight > 0` | `evals/fixtures/v2-test-vault/_queries/recency.yaml` (Atlas-1 stale-vs-fresh pair); order-pin test `hybrid.rescore.test.ts:250` | ✓ |
| ASM-12 | Stub adapter passes same eval suite — proves source-neutrality | `src/adapters/stub/assembly-fixture.ts` 8-doc fixture; 10 parameterized contract assertions in `conformance.test.ts:580+`; bug-fix audit trail (commit `83757fe`) | ✓ |
| ASM-13 | List-style assembly ops promoted to Resources where applicable | Investigated; no MVP candidates (all four tools have keyed inputs). Disposition recorded in `docs/v2/PHASE-3-SIGN-OFF.md:194-223`. Re-evaluate at Phase 5 (`list_briefs`) + Phase 6 (`list_contracts`). | ✓ deferred-with-disposition |

## Locked decisions adherence (D-01..D-08)

| Decision | Spec | Implementation | Verdict |
|----------|------|----------------|---------|
| D-01 | Each section carries BOTH content-hash anchor AND `heading_path[]` array | `src/types.ts:347-372` (`BlockNode` "section" variant: `anchor`, `heading_path`, `level`, `blocks`); anchor algo at `src/sections/anchor.ts:37` (`sha256_hex(NFC(heading_text) || "\n" || plain_text_body)`) — matches ADR-003 H-7 | ✓ matches |
| D-02 | `get_outline` returns nested tree, not flat list | `src/assembly/outline.ts` builds nested `OutlineNode[]` via `buildOutlineTree`; each node carries `{anchor, heading_path, heading_text, level, chunk_ids[], children[]}` | ✓ matches |
| D-03 | `assemble_dossier` matches strictly on `properties.type` (exact string equality) | `src/assembly/dossier.ts:25-30` header doc states strict match; no tag fallback or case folding | ✓ matches |
| D-04 | `key` matches `title` OR any entry in `properties.aliases` | Header doc at `src/assembly/dossier.ts:30+`; alias path tested in stub fixture (`Alice` doc with `aliases: ["Alice C.", "ac"]`) | ✓ matches |
| D-05 | Dossier output = `{anchor, linked_documents, property_rollups}`; default rollups `linked_count`, `linked_types`, `status_distribution`; each linked doc has `relation: "wikilink" \| ...` | `src/assembly/dossier.ts:445-460` computes rollups (`linked_count`, `linked_types`, `status_distribution`) with alphabetic sort; `relation: "wikilink" as const` at line 437 with PHASE-4-WIDEN marker | ✓ matches (v2.0.0 emits only `"wikilink"` — limitation recorded) |
| D-06 | Three-tier authority: `status` hard filter, `properties.authoritative` (bool) soft boost, `mtime` soft recency | Hard filter at `src/search/hybrid.ts:225` (SQL-level via `notes_status`); authority boost at line 280-290 reads `frontmatter.authoritative === true`; recency uses `mtime` exp decay | ✓ matches |
| D-07 | `final = rrf + recency_weight × exp(-age_days / half_life) + authority_weight × authority`; defaults `recency=0`, `authority=0`, `half_life=30` | Comment at `src/search/hybrid.ts:254-256`; `halfLifeMs = (opts.halfLifeDays ?? 30) * 24 * 60 * 60 * 1000` line 267; v1-baseline invariance pin proves it | ✓ matches |
| D-08 | All `search_hybrid` additions strictly additive — no new required params, no removed fields, no `search_hybrid_v2` | `tools-list.snapshot.json:102-166` shows existing `required: ["query"]` unchanged, 4 new optional params appended; 9 new optional SearchHit fields (all `?` in `src/types.ts`); v1 23 entries byte-identical in snapshot | ✓ matches |

## Gate results

| Gate | Command | Result |
|------|---------|--------|
| Test suite | `npx vitest run --exclude '**/.claude/**'` | **1076 passed, 11 skipped (83 files)** — matches sign-off claim |
| Type-check | `npx tsc --noEmit` | Clean (no output) |
| Adapter-seam lint | `bash scripts/lint-adapters.sh` | All 8 invariants green (I-1, I-2, I-3, I-4, I-5, I-5b, I-6, C-1) |
| v1-baseline eval | `npm run eval:baseline` | 210 passed | 77 skipped (across worktrees) — baseline-test row: **41 passed | 11 skipped** for the canonical path |
| Snapshot additivity | Manual diff vs Phase 2 | 23 v1 tool entries byte-identical (slots 0–22); 7 additive entries appended (3 memory + 4 assembly); `search_hybrid` gains 4 optional params; `SearchHit` gains 9 optional fields. Strictly additive ✓ |

## Known limitations confirmed recorded in sign-off

| Limitation | Recorded in sign-off? | Citation |
|------------|-----------------------|----------|
| `relation: "wikilink"` is the only emitted value in v2.0.0 (Phase 4 widens via GRA-04) | ✓ | `docs/v2/PHASE-3-SIGN-OFF.md:230-232`; PHASE-4-WIDEN markers at `src/assembly/dossier.ts:429`, `src/assembly/bundle.ts:371` |
| `recent_edits` does NOT surface pre-rename history | ✓ | `docs/v2/PHASE-3-SIGN-OFF.md:234`; bundle.ts header at `src/assembly/bundle.ts:43-59` ("Recent-edits rename-history limitation") |
| `get_document_bundle` accepts `depth: 1` only (Zod literal-pinned) | ✓ | `docs/v2/PHASE-3-SIGN-OFF.md:235` |
| ASM-13 deferred — "investigated; no candidates found in MVP scope" | ✓ | `docs/v2/PHASE-3-SIGN-OFF.md:194-223` |
| Concurrent-edit anchor divergence is by design (content-hash → new hash on mid-edit) | ✓ | `docs/v2/PHASE-3-SIGN-OFF.md:236` |
| Stub-assembly conformance does NOT run the full hybrid pipeline (Ollama-bound) | ✓ | `docs/v2/PHASE-3-SIGN-OFF.md:237` |

## Recommendations

1. **Phase 4 widening of `relation` field** — the PHASE-4-WIDEN marker comments at `src/assembly/dossier.ts:429`, `src/assembly/bundle.ts:371` (and per the sign-off `bundle.ts:374, 410`) pin the one-line change sites; the Phase 4 plan should pick these up alongside GRA-04 typed-edge work.
2. **Recent-edits rename-history widening** — Phase 4 should centralize `doc_id → note_id` resolution at the graph layer to surface pre-rename audit rows in `get_document_bundle.recent_edits`. Documented at `src/assembly/bundle.ts:42-49`.
3. **ASM-13 re-evaluation gate** — at Phase 5 sign-off, evaluate `list_briefs` as MCP Resource (`vault-memory://briefs`); at Phase 6 sign-off, evaluate `list_contracts` similarly. Current resource set stays at two (`vault-memory://memory/stats`, `vault-memory://memory/sinks`).
4. **Stub-assembly P/R parity (research-derived choice)** — per RESEARCH §7 the stub fixture is purpose-built for contract conformance only; if Phase 9's premise check demands P/R parity on the stub, plan a fixture expansion and a deterministic hybrid stub injection.
5. **Audit trail close-out** — the sign-off doc has placeholders for "PR" and "Merge SHA" at lines 332–333; the maintainer should fill these at merge time per the D-17 audit-trail convention. This is procedural, not a code gate.
6. **Worktree noise in eval output** — `npm run eval:baseline` discovers six `.claude/worktrees/agent-*` baseline test files alongside the canonical one (7 test files total). All seven pass identically, but the canonical eval contract should run only `evals/v1-baseline/baseline.test.ts`. Consider tightening the vitest include pattern or adding `.claude/` to the test exclude list before Phase 8 release-gate work. This does not affect Phase 3 correctness.

Phase 3 verification: **PASSED**. Four assembly tools + additive `search_hybrid` rescore + source-neutrality conformance suite ship with all 1076 tests green, adapter seams intact, and v1 baseline byte-identical.
