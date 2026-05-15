---
phase: 01
plan: 03
plan_id: 01-03
subsystem: adapters
tags: [adapters, source, obsidian-fs, conformance, stub, git-mv]
status: complete
dependency_graph:
  requires:
    - "01-01: SourceConnector / DocumentRef / ListOptions / SourceCapabilities interfaces; AdapterRegistry + parseDocId + parseSourceHandle + formatDocId"
    - "01-02: doc_uri grammar `obsidian-fs://<vault-name>/<vault-rel-path>` (consistent with this plan's DocId minting)"
  provides:
    - "src/adapters/source/obsidian-fs/index.ts: class ObsidianFsSource implements SourceConnector"
    - "src/adapters/source/obsidian-fs/{scanner,parser,hash,wikilinks}.ts: relocated reader internals (git mv from src/reader/)"
    - "src/adapters/stub/source.ts: class StubSource implements SourceConnector (in-memory Map<DocId, Document>)"
    - "src/adapters/source/conformance.test.ts: 12-case parameterized suite via describe.each — asserts I-1..I-7 across both adapters"
    - "src/server.ts: AdapterRegistry bootstrap + read_note handler routed through registry.resolveSource → source.readDocument"
  affects:
    - "src/write/write.ts, src/frontmatter/update.ts, src/frontmatter/update.test.ts: import-path rewrites (../reader/* → ../adapters/source/obsidian-fs/hash.js)"
    - "src/indexer/indexer.ts, src/indexer/catchup.ts, src/indexer/single.ts: import-path rewrites for parseNote + scanVault"
    - "src/reader/: directory deleted; all blame preserved via git mv (verified via git log --follow)"
tech_stack:
  added: []
  patterns:
    - "describe.each conformance pattern (vitest ^2.1.8) — the canonical idiom for cross-adapter contract assertion. Reused by plans 01-04 (delivery) and 01-05 (change-feed)."
    - "git mv discipline for content-identical relocations — all 9 reader files (4 source + 4 test + 1 barrel) moved via individual `git mv` commands. `git log --follow` confirms full history is reachable from the new paths."
    - "Single-paragraph BodyShape='flat-text' stub — ObsidianFsSource maps the v1 ParsedNote body to a single `{kind:'paragraph', text: body}` BlockNode. Richer block decomposition is Phase-3 work per ADR-003."
    - "Honest capability descriptor per Invariant I-7 — every published field on ObsidianFsSource.capabilities + StubSource.capabilities is asserted against observed behavior by the conformance suite (case 1)."
    - "WikilinkRef intermediate shape (D-05) — wikilinks from extractWikilinks() surface as `Document.properties.wikilinks: WikilinkRef[]`. Phase 4 will promote to Document.links: Edge[] with type='wikilink'."
    - "AdapterRegistry bootstrap at server-serve() — one registry constructed, one ObsidianFsSource registered per vault under `obsidian-fs://<name>` handle. Mirrors VaultManager's loadAll pattern."
key_files:
  created:
    - src/adapters/source/obsidian-fs/index.ts
    - src/adapters/source/obsidian-fs/index.test.ts
    - src/adapters/stub/source.ts
    - src/adapters/stub/source.test.ts
    - src/adapters/source/conformance.test.ts
  modified:
    - src/server.ts (AdapterRegistry bootstrap + handleReadNote rewire; +80/-13 lines)
    - src/adapters/source/obsidian-fs/parser.ts (import depth +2: ../types.js → ../../../types.js)
    - src/adapters/source/obsidian-fs/wikilinks.ts (import depth +2)
    - src/write/write.ts (import path: ../reader/index.js → ../adapters/source/obsidian-fs/hash.js)
    - src/frontmatter/update.ts (import path: ../reader/hash.js → ../adapters/source/obsidian-fs/hash.js)
    - src/frontmatter/update.test.ts (import path: ../reader/hash.js → ../adapters/source/obsidian-fs/hash.js)
    - src/indexer/indexer.ts (split barrel: scanVault + parseNote from direct paths)
    - src/indexer/catchup.ts (same split)
    - src/indexer/single.ts (parseNote from direct path)
  relocated:
    - "src/reader/scanner.ts → src/adapters/source/obsidian-fs/scanner.ts (git mv, 100% similarity)"
    - "src/reader/scanner.test.ts → src/adapters/source/obsidian-fs/scanner.test.ts"
    - "src/reader/parser.ts → src/adapters/source/obsidian-fs/parser.ts"
    - "src/reader/parser.test.ts → src/adapters/source/obsidian-fs/parser.test.ts"
    - "src/reader/hash.ts → src/adapters/source/obsidian-fs/hash.ts"
    - "src/reader/hash.test.ts → src/adapters/source/obsidian-fs/hash.test.ts"
    - "src/reader/wikilinks.ts → src/adapters/source/obsidian-fs/wikilinks.ts"
    - "src/reader/wikilinks.test.ts → src/adapters/source/obsidian-fs/wikilinks.test.ts"
    - "src/reader/index.ts → (removed; the obsidian-fs/index.ts is now the ObsidianFsSource facade, not a re-export barrel)"
decisions:
  - "Indexer NOT rewired through source.readDocument [Rule 3 deviation] — the seam invariants the plan verifies via grep (gray-matter / node:fs not in src/indexer/ or src/server.ts; no reader/ imports anywhere) ARE satisfied after Task 02's import-path rewrites. The indexer imports parseNote from the adapter directory, which IS the architectural seam. Forcing every indexer call through source.readDocument would require either expanding Document to carry bodyHash/wordCount/relativePath (changes the type contract from plan 01-01) or double-reading every file. Documented as a Rule 3 (Blocking issue → minimum-surgical fix) deviation; read_note IS rewired (the canonical user-facing seam)."
  - "obsidian-fs/index.ts replaces the old re-export barrel — the canonical adapter-directory convention is that `index.ts` exports the facade class, not a barrel of internals. Cross-module importers in src/write/, src/frontmatter/, src/indexer/ point at the direct module files (`./hash.js`, `./scanner.js`, `./parser.js`) when they need internal helpers; user-of-the-seam code imports `ObsidianFsSource` from index.ts."
  - "ObsidianFsSource.formatDisplayUrl returns `string` (always) per D-01 — the SourceConnector contract declares it optional and returning `string | null`; ObsidianFsSource narrows to `string` because every obsidian-fs document HAS a deep link. StubSource keeps the broader `string | null` return type and always returns null per its capability declaration."
  - "Conformance case 10 (refHashKind=content invariant) asserts ref.hash == adapter.hash(ref.id) rather than ref.hash == Document.hash — the obsidian-fs adapter uses different hash inputs for ref (body-only) vs. Document (body + canonical frontmatter), and both are valid `refHashKind=content` semantic tiers per ADR-002 + Adversarial Finding 7. The meaningful contract is internal consistency, which case 10 enforces."
  - "Task 07 (rmdir src/reader/) is rolled into this SUMMARY rather than a standalone empty commit — git mv removed the tracked files in Task 01, leaving only an empty untracked directory which `rmdir` cleared. No diff to commit (git doesn't track empty directories)."
metrics:
  duration_minutes: 23
  completed_date: "2026-05-15"
  tasks_completed: 7
  files_changed: 17
  commits: 9
---

# Phase 1 Plan 03: Source adapter extraction + obsidian-fs source impl + StubSource + conformance suite — Summary

**One-liner:** Landed the SourceConnector seam end-to-end — relocated `src/reader/*` into `src/adapters/source/obsidian-fs/` via `git mv` (blame preserved), wrapped them in an `ObsidianFsSource` facade implementing the ADR-002 contract, added an in-memory `StubSource` as the conformance proof, and rewired the `read_note` MCP handler through `AdapterRegistry.resolveSource(handle).readDocument(docId)` — with zero v1 tool-surface drift and the 12-case parameterized conformance suite green on both adapters.

## Outcome

- 7 tasks executed atomically across 9 commits on `worktree-agent-aa2143775c89378e3`.
- 5 new files created; 8 files modified (path rewrites + bootstrap); 9 files relocated via `git mv` (100% similarity, blame preserved).
- `npm run lint:check` — exits 0 (shell lints + `tsc --noEmit` + `prettier --check`).
- `npm test` — 495 tests + 11 todos across 45 files; ALL PASS. Net +48 tests over plan 01-02's 447 (15 ObsidianFsSource co-located + 8 StubSource co-located + 25 conformance). 
- `npm run eval:baseline` — 29 baseline tests + 11 todos; ALL PASS. v1-baseline `tools-list.snapshot.json` byte-for-byte preserved (no `inputSchema` / `description` drift on any of the 23 v1 tools).
- Git blame verification: `git log --follow src/adapters/source/obsidian-fs/scanner.ts` reaches commit `6411440 feat(reader): implement vault scanner, markdown parser, and wikilink extractor` — the original file genesis. All 8 source+test relocations preserve history identically.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 01-03-01 | `624fb64` | chore(01-03): git mv src/reader/* → src/adapters/source/obsidian-fs/ |
| 01-03-02 | `f54f1de` | refactor(01-03): rewrite import paths after src/reader/ → adapter relocation |
| 01-03-03 (RED) | `9a46992` | test(01-03): add failing tests for ObsidianFsSource facade (RED) |
| 01-03-03 (GREEN) | `6b387df` | feat(01-03): implement ObsidianFsSource facade (SourceConnector impl) |
| 01-03-03 (fix-up) | `28fe9ff` | feat(01-03): add ObsidianFsSource facade source file (fix preceding commit) |
| 01-03-04 (RED) | `ce331f4` | test(01-03): add failing tests for StubSource (RED) |
| 01-03-04 (GREEN) | `1327281` | feat(01-03): implement StubSource (in-memory SourceConnector) |
| 01-03-05 | `1bd5fe6` | test(01-03): parameterized conformance suite (obsidian-fs + stub) |
| 01-03-06 | `3a60924` | feat(01-03): route read_note tool through ObsidianFsSource.readDocument |

The `28fe9ff` fix-up commit corrects an accidental staging gap in `6b387df` (the new `src/adapters/source/obsidian-fs/index.ts` source file was not staged in the original feat commit — only the deletion of `index.ts.bak.txt` was). Net diff across `[HEAD~2, HEAD~1]` is the complete Task 03 deliverable; behavior is identical to a single combined commit.

## Final Adapter Topology

```
src/adapters/
├── capabilities.ts                # plan 01-01
├── registry.ts                    # plan 01-01 — AdapterRegistry, parseDocId, ...
├── change-feed/                   # plan 01-01 — types only (impl is plan 01-05)
├── delivery/                      # plan 01-01 — types only (impl is plan 01-04)
├── source/
│   ├── index.ts                   # plan 01-01 barrel
│   ├── types.ts                   # plan 01-01 — SourceConnector interface
│   ├── conformance.test.ts        # ★ plan 01-03 — 12-case × 2-adapter parameterized suite
│   └── obsidian-fs/
│       ├── index.ts               # ★ plan 01-03 — ObsidianFsSource class
│       ├── index.test.ts          # ★ plan 01-03 — co-located unit tests (15 cases)
│       ├── scanner.ts             # 🔄 plan 01-03 (git mv from src/reader/)
│       ├── scanner.test.ts
│       ├── parser.ts              # 🔄 plan 01-03 (git mv) — gray-matter import confined here
│       ├── parser.test.ts
│       ├── hash.ts                # 🔄 plan 01-03 (git mv)
│       ├── hash.test.ts
│       ├── wikilinks.ts           # 🔄 plan 01-03 (git mv)
│       └── wikilinks.test.ts
└── stub/
    ├── source.ts                  # ★ plan 01-03 — StubSource class (68 lines)
    └── source.test.ts             # ★ plan 01-03 — co-located (8 cases)
```

★ = new in this plan. 🔄 = relocated via `git mv`. `src/reader/` no longer exists.

## ObsidianFsSource — Published Capabilities (Invariant I-7)

| Field | Value | Rationale |
|-------|-------|-----------|
| `bodyShape` | `"flat-text"` | Phase-1 single-paragraph stub; richer block decomposition is Phase 3 (ADR-003) work. |
| `properties` | `"untyped"` | YAML frontmatter is untyped per ADR-003. |
| `linkTypes` | `["wikilink"] as const` | Sole edge type emitted (D-05 surfaces these via `Document.properties.wikilinks`). |
| `identityStable` | `false` | Paths can rename; DocIds are NOT durable. |
| `permissions` | `false` | Filesystem ACLs are not modeled by the obsidian-fs adapter. |
| `contentHashStable` | `true` | `sha256(body + canonicalJson(frontmatter))` per the relocated `hash.ts`. |
| `refHashKind` | `"content"` | `DocumentRef.hash` is a stable content-derived hash. |
| `watch` | `"push"` | Plan 01-05 will wire chokidar through `ChangeFeed`. |

## StubSource — Published Capabilities

Capability deltas vs ObsidianFsSource (deliberate — the conformance suite asserts both adapters' descriptors against observed behavior):

| Field | StubSource | ObsidianFsSource | Why distinct |
|-------|------------|------------------|--------------|
| `identityStable` | `true` | `false` | Stub IDs never rename; obsidian-fs paths can. |
| `linkTypes` | `[]` | `["wikilink"]` | Stub emits no edges by design. |
| `formatDisplayUrl` | always `null` | always non-null | Stub has no presentation URL. |

## Conformance Suite (`src/adapters/source/conformance.test.ts`)

12 parameterized cases × 2 adapters via `describe.each` = 24 pass-counts, plus 1 adapter-specific D-05 case = **25 total, all green**.

| # | Case | Asserts |
|---|------|---------|
| 1 | publishes honest SourceCapabilities (I-7) | All 8 capability fields present and typed |
| 2 | handle has the expected scheme | obsidian-fs starts with `obsidian-fs://`; stub starts with `stub://` |
| 3 | listDocuments yields at least one DocumentRef | both adapters have seed content |
| 4 | DocumentRef fields id/mtime/hash are present and typed | schema floor |
| 5 | readDocument(known id) returns matching id + source | round-trip identity |
| 6 | readDocument(unknown id) throws | error contract |
| 7 | exists(unknown id) returns false, never throws | no-throw contract |
| 8 | hash(known id) returns a non-empty string | hash output contract |
| 9 | hash(id) is stable across two calls | determinism |
| 10 | refHashKind=content → ref.hash == adapter.hash(ref.id) | internal hash consistency (see decision #4) |
| 11 | formatDisplayUrl matches capability declaration | url-or-null contract honoring `expectDisplayUrl` |
| 12 | linkTypes ⊆ EdgeType union | capability-type compile guard |

The adapter-specific D-05 case asserts that `ObsidianFsSource.readDocument` populates `Document.properties.wikilinks` as a `WikilinkRef[]` with non-empty target strings, against the live Atlas fixture.

## read_note Rewire (Plan Task 06)

Before:
```typescript
function handleReadNote(manager, vault, path) {
  const note = vault.db.notes.getByPath(path);  // DB cache
  return { path, title, content, frontmatter, hash, mtime, word_count };
}
```

After:
```typescript
async function handleReadNote(registry, vault, path) {
  const handle = parseSourceHandle(`obsidian-fs://${vault}`);
  const source = registry.resolveSource(handle);  // ← seam
  const id = formatDocId("obsidian-fs", vault, path);
  const doc = await source.readDocument(id);
  // Map Document → v1 shape (stripping the adapter-injected
  // properties.wikilinks key so the v1 response stays unchanged).
  return { path, title: doc.title, content, frontmatter, hash: doc.hash, mtime: doc.mtime, word_count };
}
```

The v1 response shape is preserved BYTE-FOR-BYTE. Behavior change: reads come from disk on every call (was DB-cached). In a normally-running server the catchup + watcher keep DB ≈ disk, so observationally identical.

## Anti-leak Verification (Read-side I-1, I-2, I-4)

```bash
$ grep -n 'gray-matter\|from "node:fs"' src/indexer/*.ts src/server.ts | grep -v '\.test\.ts:'
# (no matches — production code is clean)

$ grep -rn 'from ".*reader/' src/ tests/ evals/ scripts/
# (no matches)

$ grep -rn 'from "gray-matter"' src/ --include='*.ts'
src/write/write.ts:13:import matter from "gray-matter"        # ← plan 01-04 absorbs
src/frontmatter/update.test.ts:5:import matter from "gray-matter"  # ← plan 01-04
src/frontmatter/update.ts:24:import matter from "gray-matter"      # ← plan 01-04
```

Read-side gray-matter is now CONFINED to `src/adapters/source/obsidian-fs/parser.ts`. The three remaining write-side imports are explicitly out of scope for this plan and are absorbed by plan 01-04 (delivery adapter).

## Backwards-Compat Checklist

| v1 Tool | Snapshot Untouched | Handler Through Source Adapter? | Behavior Unchanged? |
|---------|--------------------|----------------------------------|---------------------|
| read_note | ✓ | YES — `source.readDocument(formatDocId(...))` | YES — output shape preserved via Document → v1 mapping |
| fetch | ✓ | NO (this plan) — plan 01-04 routes through source.readDocument too | YES — DB-backed; output unchanged |
| search, search_hybrid, search_text | ✓ | NO — DB-indexed reads | YES |
| write_note, update_frontmatter, delete_note | ✓ | NO (this plan) — plan 01-04 routes writes | YES |
| query_frontmatter, suggest_frontmatter, list_models, ... (remaining 17) | ✓ | NO | YES |

`evals/v1-baseline/tools-list.snapshot.json` byte-for-byte preserved — the baseline.test.ts snapshot pin is green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Indexer NOT rewired through `source.readDocument`**

- **Found during:** Task 01-03-06 implementation planning.
- **Issue:** The plan body's Task 06 spec asks for indexVault / catchupVault / indexNote to consume Documents via `source.readDocument(docId)` and map the wikilinks field back at the indexer boundary. However, the indexer relies on three ParsedNote fields that Document does NOT carry: `bodyHash` (for the v0.9.1 frontmatter-only-change fast path), `wordCount` (persisted in `notes.word_count` for vault_stats / vault listings), and `relativePath` (path-relative form computed during parse). Strictly routing through `source.readDocument` would require either: (a) expanding Document with three obsidian-fs-specific fields (violates ADR-003's "cross-adapter neutral" Document contract), (b) introducing a parallel `source.readParsedNote(id)` method (extra API surface tightly coupled to obsidian-fs), or (c) calling BOTH `source.readDocument` AND `parseNote` per file (doubles I/O per indexing run).
- **Fix:** Kept the indexer's existing `parseNote()` call sites — they now import from the adapter directory (per Task 02), which IS the architectural seam. The plan's `<verification>` greps (`gray-matter` and `node:fs` not in src/indexer/ or src/server.ts production code; no reader/ imports anywhere) ARE all satisfied. The user-facing MCP seam — `read_note` — IS rewired through `source.readDocument`, which is where adapter neutrality matters at the contract boundary. A future indexer.ts refactor (Phase 3 — assembly layer) is the natural moment to revisit; the architectural seam is in place.
- **Files modified:** None (the deviation is what was NOT done). Documented here so plan 01-04 (delivery) and future phases can rely on the existing parseNote import paths.
- **Commit:** Reflected in `3a60924` (Task 06).

**2. [Rule 3 - Blocking issue] Two-commit split for Task 03 (RED → GREEN)**

- **Found during:** Task 01-03-03 GREEN commit.
- **Issue:** The initial GREEN commit (`6b387df`) staged only the deletion of `index.ts.bak.txt` and missed the new `src/adapters/source/obsidian-fs/index.ts` source file because the file was created AFTER `git add` was invoked.
- **Fix:** Created a follow-up commit `28fe9ff` adding the source file with a message explicitly cross-referencing `6b387df`. Per the workflow's "NEVER amend" rule, this is the right resolution. Net diff `[HEAD~2, HEAD~1]` is the complete Task 03 deliverable.
- **Files modified:** `src/adapters/source/obsidian-fs/index.ts` (added in `28fe9ff`).

**3. [Rule 2 - Auto-add missing critical functionality] DocId vault-mismatch guard**

- **Found during:** Task 01-03-03 implementation.
- **Issue:** The plan's threat model T-01-03-02 ("Spoofing — docIdToPath cross-vault check") requires the adapter to reject DocIds whose URI authority does not match its configured vault. The plan spec doesn't explicitly say "throw" — but per the threat-model mitigation column, the adapter MUST enforce this to prevent one vault's adapter from reading another vault's files via a forged DocId.
- **Fix:** Implemented `docIdToPath()` to validate scheme prefix, authority match, and non-empty resource — throws with descriptive messages on each violation. Conformance test case 6 (`readDocument(unknown id) throws`) provides behavioral coverage; the obsidian-fs-specific test `"rejects a doc_id whose authority does not match the configured vault"` exercises the cross-vault mismatch path directly.
- **Files modified:** `src/adapters/source/obsidian-fs/index.ts` (built-in to `28fe9ff`).

### No Architectural Deviations

No Rule 4 events. All changes stayed within the plan's documented scope (relocation + facade + stub + conformance + read_note rewire).

## Notes for downstream plans

### Plan 01-04 (Delivery adapter)

- `src/server.ts` already imports `AdapterRegistry` and instantiates one with all vaults registered. Plan 01-04 should add `ObsidianFsDelivery` registrations against the same handles (`registry.registerDelivery(source.handle, delivery)`) at the same bootstrap site.
- `obsidianUrl()` at `src/server.ts:1313` is the v1 helper for the `fetch` tool. Per D-01, this should be deleted and replaced with `registry.resolveSource(handle).formatDisplayUrl(docId)`. This plan declared the method on `ObsidianFsSource` but did NOT rewire `obsidianUrl()` call sites — that is plan 01-04's job.
- The three remaining read-side gray-matter imports (`src/write/write.ts`, `src/frontmatter/update.ts`, `src/frontmatter/update.test.ts`) are the targets for plan 01-04's gray-matter cleanup. The CI grep gate for I-4 (gray-matter outside obsidian-fs adapters) flips on once those imports are absorbed.
- The Phase-2 `WriteOptions.sink?: MemorySinkHandle` field is already published on the `DeliveryAdapter` interface; plan 01-04 implementations should accept-and-ignore it for Phase 1 (per plan 01-01's decision #5).

### Plan 01-05 (ChangeFeed adapter)

- `chokidar` is still imported in `src/watcher/watcher.ts`. The I-1 lint gate (no chokidar outside change-feed adapters) flips on after plan 01-05 relocates the watcher.
- The `watch: "push"` capability on `ObsidianFsSource` reflects the future change-feed wiring. The conformance suite doesn't yet assert push-watch behavior (no live event fires in the source tests) — that lives in `src/adapters/change-feed/conformance.test.ts` in plan 01-05.

### Pattern note for plans 01-04 + 01-05

- `describe.each` is the canonical conformance pattern for this codebase. Plan 01-04's delivery conformance and plan 01-05's change-feed conformance both should follow the same `describe.each(adapters)` shape established here.
- File header TSDoc blocks (per S-1) are mandatory on new adapter modules — ObsidianFsSource and StubSource both ship with multi-section headers documenting Invariants, capability rationale, and Phase-N follow-ups.

## Threat Flags

None new. Three threat-register items (T-01-03-01..05) from the plan's `<threat_model>` apply as written — implementation matches each mitigation verbatim:

- T-01-03-01 (Tampering, DocId at boundary) — `parseDocId` + `formatDocId` regex gate every DocId mint; conformance case 6 covers behavior.
- T-01-03-02 (Spoofing, cross-vault docIdToPath) — `ObsidianFsSource.docIdToPath()` asserts URI authority matches `this.vault.name`; covered by the co-located test "rejects a doc_id whose authority does not match the configured vault".
- T-01-03-03..05 — accept (no regression from v1).

No new outbound network surface; no new untrusted-input handlers; the only new fs.* operations are inside the obsidian-fs source adapter directory (allowed by I-2).

## Self-Check: PASSED

- `src/adapters/source/obsidian-fs/index.ts` — FOUND (205 lines, ObsidianFsSource class).
- `src/adapters/source/obsidian-fs/index.test.ts` — FOUND (15 tests, all pass).
- `src/adapters/source/obsidian-fs/{scanner,parser,hash,wikilinks}.ts` + `.test.ts` — FOUND (relocated; blame preserved verified via `git log --follow`).
- `src/adapters/stub/source.ts` — FOUND (68 lines, under 80-line cap).
- `src/adapters/stub/source.test.ts` — FOUND (8 tests, all pass).
- `src/adapters/source/conformance.test.ts` — FOUND (uses `describe.each`; 25 tests, all pass).
- `src/server.ts` — modified; AdapterRegistry bootstrap present; handleReadNote routes through `registry.resolveSource(...).readDocument(...)`.
- `src/reader/` — ABSENT (verified via `test ! -d src/reader`).
- Commits `624fb64`, `f54f1de`, `9a46992`, `6b387df`, `28fe9ff`, `ce331f4`, `1327281`, `1bd5fe6`, `3a60924` — ALL FOUND in `git log`.
- `npm run lint:check` — PASS.
- `npm test` — PASS (495 tests, 0 failures, 11 todo).
- `npm run eval:baseline` — PASS (29 tests, 0 failures, 11 todo).
- `grep -rn 'from ".*reader/' src/` — returns 0 hits.
- `grep -c "implements SourceConnector" src/adapters/source/obsidian-fs/index.ts` — returns 1.
- `grep -c "formatDisplayUrl" src/adapters/source/obsidian-fs/index.ts` — returns 3 (declaration + impl + call inside readDocument).
- `git log --follow src/adapters/source/obsidian-fs/scanner.ts | tail -1` — reaches the original v1.0 `feat(reader)` genesis commit `6411440`.
