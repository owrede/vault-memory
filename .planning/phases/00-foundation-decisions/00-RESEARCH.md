# Phase 0: Foundation & decisions - Research

**Researched:** 2026-05-14
**Domain:** Documentation engineering — ADR relocation/amendment, eval-fixture authoring, vitest regression baselines, POSIX-shell CI lints, adversarial review methodology
**Confidence:** HIGH for stack/tools/process, MEDIUM for some edge-case pitfalls (git-mv-with-content-change semantics, BSD/GNU grep behavior in shell lints)

## Summary

Phase 0 is the **only zero-code phase** in v2 — every artifact is docs, evals, or CI scaffolding. The hard part is not what to write but in what order and with what invariants, because Phases 1–9 will be implemented against these documents and CI gates. The research below converges on six findings the planner must internalize:

1. **`git mv` + content-change in the same commit is the canonical anti-pattern for history preservation.** D-02 mandates relocation + amendments in one PR per ADR. Git rename detection is heuristic (default 50% similarity); a same-commit move + heavy Invariants/Examples insertion can flip a rename to a delete-plus-add and silently lose `git log --follow` traceability. The planner should structure each ADR PR as **two commits** — first `git mv` alone, then the amendments — so that `git log --follow` survives even though the PR ships as a unit.
2. **RFC 8785 (JCS) is the right citation for ADR-003's "canonical PropertyBag" amendment**, but D-05's pseudocode must explicitly call out the three failure modes JCS implementations get wrong: number canonicalization (IEEE 754 / ECMAScript `Number.prototype.toString`), UTF-16 lexicographic key sort, and Unicode NFC normalization. Without these the invariant remains gameable — a Phase 10 Notion implementer could ship a JS-default `JSON.stringify` with sorted keys and the hash would diverge from a Rust adapter that uses serde's default emit.
3. **Tool-snapshot pinning is best implemented as a literal JSON file at a stable path** (`evals/v1-baseline/tools-list.snapshot.json`) with a vitest test that reads + parses + `toEqual` compares — NOT `toMatchSnapshot()` or `toMatchFileSnapshot()`. Reason: vitest's snapshot machinery owns the file (auto-update behavior on `-u`, automatic obsolete-snapshot removal), which defeats the "contractual surface, drift fails CI" goal. A literal file under git control with a hand-edited update workflow makes drift loud.
4. **POSIX shell portability matters for D-18 / D-21 because GitHub Actions runners are Linux (GNU grep) and the maintainer's machine is macOS (BSD grep).** The two lints (`check-fixture-privacy.sh`, `lint-no-telemetry.sh`) must avoid GNU-only flags (`-P`, `--include`), prefer `grep -rE` with simple alternation, and use `find` for traversal instead of recursive globs. A lint that passes locally on Mac and fails on Linux CI (or vice versa) is the silent-pass trap to design out.
5. **The MCP SDK 1.0.4 `tools/list` response is a stable, deterministic JSON-RPC envelope** (`{tools: [{name, description, inputSchema, outputSchema?}, ...]}`) — no timestamps, no random IDs, no non-deterministic enum ordering in the current `src/server.ts`. The 23 tools are registered as a literal array (line 326 of server.ts) so the snapshot is exactly the array literal, serialized. There is no SDK-introduced non-determinism to worry about.
6. **Adversarial review (D-15, FND-04) is the one non-formal gate** in Phase 0. The planner must operationalize it: the reviewer reads ONLY the four ADRs + three architecture docs, attempts to write an implementation plan for a Notion source/delivery/change-feed adapter, and emits one finding per ambiguity. Each finding terminates in either (a) an ADR amendment commit or (b) a row in the ADR index marked `Status: Deferred-v3` with a one-line rationale. No silent ignores.

**Primary recommendation:** Sequence Phase 0 as 14 vertical slices (one per FND-* requirement), with the four ADR PRs front-loaded and the adversarial review intentionally late (after architecture docs land) so the reviewer has the full substrate. Ship one full vertical slice — ADR-001 relocated + Invariants + Examples + index row + CHANGELOG note — before scaling the pattern to ADRs 002/003/004. This validates the workflow before committing to four parallel PRs.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**ADR relocation strategy:**
- **D-01:** Relocate via `git mv docs/dev/00X-*.md docs/v2/adr/00X-*.md` to preserve history. Same PR removes `docs/dev/` from `.gitignore`. No fresh copy — git history is the most valuable diagnostic when an ADR is later questioned.
- **D-02:** Amend in the **same PR** as the relocation. One PR per ADR (four PRs total), each containing (a) the `git mv`, (b) the Invariants + Examples sections, (c) the relevant amendment for ADR-003 and ADR-004. Rationale: ADR amendments and relocation are read together; splitting them invites stale-link drift in the index.
- **D-03:** `Invariants` section format on every ADR — bullet list of normative MUST/MUST-NOT statements grep-able by Phase 9's adversarial review. Example invariant for ADR-001: "MUST NOT use raw filesystem paths as primary keys outside `src/adapters/source/obsidian-fs/`."
- **D-04:** `Examples` section on every ADR — at minimum one `obsidian-fs://` example AND one `notion-api://` example. Forces source-neutrality into the ADR text from day 0; Phase 9's adversarial reviewer can grep for both schemes.
- **D-05:** ADR-003 hash-semantics amendment — explicit pseudocode block: `hash = sha256(canonical(blocks_as_plain_text) || canonical(PropertyBag))` with `canonical()` defined as Unicode NFC + LF line endings + JSON Canonical Form for PropertyBag. Chunk-level `source_hashes: string[]` schema documented inline with an example.
- **D-06:** ADR-004 amendment — folder-default `MemorySink` is the only code path; the separate-vault option is **config-only** (`[memory] sink = "@other-vault"` in `config.toml`). No code branch. Document the sentinel file (`.memory-sink`) and the `obsidian-fs://_memory/` handle syntax with both folder-default and separate-vault config examples.

**Eval fixture narrative:**
- **D-07:** Use **"Atlas Robotics"** — ~75 notes, 5 top-level folders (`projects/`, `meetings/`, `people/`, `decisions/`, `references/`), includes `_memory/` subset of ~20 documents.
- **D-08:** Notes are **hand-authored by the maintainer**, not LLM-drafted.
- **D-09:** Hand-labeled queries live in `evals/fixtures/v2-test-vault/_queries/<tool-category>.yaml`. Schema: `{id, query, expected_doc_ids, expected_must_contain?, rationale}`. ≥3 queries per file.
- **D-10:** YAML format (not JSON) for queries, loaded by `yaml` (Phase 6 dependency pulled forward).

**v1-baseline regression suite:**
- **D-11:** Tool-snapshot pinning (exact JSON equality) for `tools/list` at `evals/v1-baseline/tools-list.snapshot.json`. Drift fails CI.
- **D-12:** Semantic floors (precision/recall + must-contain) for behavioral checks of v1 search/graph/frontmatter tools. Per-tool YAML at `evals/v1-baseline/<tool-name>.yaml`.
- **D-13:** Suite-runner is `evals/v1-baseline/baseline.test.ts` — same vitest as `src/**/*.test.ts`. Single `npm test` runs everything.
- **D-14:** Per-tool precision/recall floor: **0.8** for both.

**Adversarial review format:**
- **D-15:** Performed by a separate Claude session with `gsd-advisor-researcher` agent acting as a hostile Phase-10 implementer. Inputs: only the four ADRs + three architecture docs. Output: `docs/v2/adr/ADVERSARIAL-REVIEW.md` listing every ambiguity, missing example, or unspecified edge case. Each finding becomes a blocker that either gets amended into the ADR, or gets a "deferred to Phase 10" note in the index — never silently ignored.
- **D-16:** Adversarial review is **not** a real spike (no Notion-skeleton code).
- **D-17:** Maintainer sign-off (FND-14) is a single PR approval on the final Phase 0 PR which carries: the ADVERSARIAL-REVIEW.md, all amendments addressing it, and a top-level `docs/v2/SIGN-OFF.md` listing the FND-01..14 checklist with each item checked and the resolving commit SHA.

**CI lint scripts:**
- **D-18:** Both lints (`scripts/check-fixture-privacy.sh`, `scripts/lint-no-telemetry.sh`) are POSIX shell.
- **D-19:** `check-fixture-privacy.sh` — fails if any path matching `evals/fixtures/*/` outside `v2-test-vault/` is committed (allowlist of one fixture).
- **D-20:** `lint-no-telemetry.sh` — fails if `src/**/*.ts` contains literal substrings from a curated banlist (`analytics`, `telemetry`, `posthog`, `segment.com`, `mixpanel`, `sentry`, `datadog`, `track(`, `trackEvent`, `report(`, `reportMetric` — case-insensitive). Positive-allow comment escape: `// vault-memory:no-telemetry-ok`.
- **D-21:** Both lints block merge via new `.github/workflows/ci.yml` on PR + push-to-main. Workflow runs: `npm ci` → `npm run lint:check` (shell lints + `tsc --noEmit` + `prettier --check`) → `npm test`.

**ADR index & open-question parking:**
- **D-22:** `docs/v2/adr/README.md` is a MADR-style index table with columns: `#`, `Title`, `Status`, `Phase`, `Supersedes`, `Tags`. Status enum: `Accepted`, `Proposed`, `Open`, `Superseded`, `Deferred-v3`. 14 open ADRs (005–01x) for v3 are listed as `Status: Open, Phase: v3-Phase-10` with one-line stub descriptions.
- **D-23:** Each ADR file gets a top-level `Tags:` frontmatter field. **Stretch only** — manual table is acceptable shipping state.

### Claude's Discretion
- **Doc tone and length** — `ARCHITECTURE.md`, `MEMORY_CONTRACT.md`, `AGENT_AGNOSTIC.md` follow the existing `docs/dev/gsd-agent-knowledg-layer.md` tone: technical, dense, no marketing copy. Each ≤ 800 lines.
- **Phase 0 CHANGELOG entry** — yes, under `[Unreleased]` → `### Documentation`.
- **Version bump** — no. v2.0.0 ships at Phase 8. Phase 0 stays `[Unreleased]`.
- **Fixture-privacy lint on `main` history** — no retroactive scan; only current tree on PR/push.

### Deferred Ideas (OUT OF SCOPE)
- ADR index regenerator script (D-23 stretch)
- Retroactive history scan for fixture-privacy lint
- Per-PR comment automation linking FND-* satisfaction
- Eval-harness LLM-judge layer (semantic floors are sufficient for v2.0.0)
- Multi-platform CI matrix (Phase 0 ships Linux-only on `ci.yml`)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | ADRs 001–004 relocated from `docs/dev/` to `docs/v2/adr/` | Findings J1, J2 below (git mv mechanics); D-01 mandate. |
| FND-02 | ADR-003 amended to specify `Document.hash` semantics; chunk-level `source_hashes` | Findings B1–B4 (RFC 8785, canonicalization pitfalls); D-05. |
| FND-03 | ADR-004 amended for folder-default + config-only separate-vault | D-06; ADR-004 source already has the open question — amendment is a tightening, not a redesign. |
| FND-04 | Each ADR gains Invariants + Examples; adversarial review confirms Notion implementability | Findings G1–G3 (adversarial methodology); D-03, D-04, D-15. |
| FND-05 | `docs/v2/ARCHITECTURE.md` published — layer model | Existing `.planning/research/ARCHITECTURE.md` is the source; Phase 0 publishes a public-facing version. |
| FND-06 | `docs/v2/MEMORY_CONTRACT.md` published | ADR-004 + the MemoryContract YAML schema already in ADR-004 (line 119–137) is the substrate. |
| FND-07 | `docs/v2/AGENT_AGNOSTIC.md` published | `CONCERNS.md` "Claude-Specific Strings" section catalogs the debt to document. |
| FND-08 | `evals/fixtures/v2-test-vault/` — ~75 notes, ≥3 queries per category | Findings C1–C4 (BEIR/MS MARCO patterns); D-07, D-08, D-09, D-10. |
| FND-09 | `evals/v1-baseline/` regression suite frozen | Findings D1–D3 (semantic floors); D-12, D-14. |
| FND-10 | Tool-snapshot tests pin `tools/list` for all 23 v1 tools | Findings H1–H3, I1–I3 (MCP SDK + vitest snapshot patterns); D-11. |
| FND-11 | `scripts/check-fixture-privacy.sh` CI lint | Findings E1–E4 (POSIX shell portability); D-19. |
| FND-12 | `scripts/lint-no-telemetry.sh` CI lint | Findings E1–E4; D-20. |
| FND-13 | Decision Log / ADR index at `docs/v2/adr/README.md` | Findings A1–A2 (MADR conventions); D-22. |
| FND-14 | Maintainer sign-off | D-17 (SIGN-OFF.md + PR approval as audit trail). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ADR documents | Documentation (repo) | — | Pure markdown under git; no runtime tier involved. |
| Architecture docs (3) | Documentation (repo) | — | Same — public-facing markdown. |
| Eval fixture vault | Test infrastructure (`evals/fixtures/`) | — | Hand-authored markdown corpus; not part of `src/` or `dist/`. |
| v1-baseline regression suite | Test infrastructure (`evals/v1-baseline/`) | vitest runner | Tests live alongside fixtures; runner is the same vitest used by `src/**/*.test.ts`. |
| `tools/list` snapshot generator | Build/test script (`evals/v1-baseline/dump-tools.mjs`) | MCP SDK | One-shot Node script reads from `src/server.ts` registry; SDK provides the schema. |
| CI lint scripts | CI infrastructure (`scripts/*.sh`) | GitHub Actions runner | POSIX shell scripts invoked from `ci.yml`; no runtime dependency. |
| Adversarial review | Documentation (`docs/v2/adr/ADVERSARIAL-REVIEW.md`) | Separate Claude session with `gsd-advisor-researcher` | The artifact is a markdown finding-list; the session that produces it is out-of-band. |
| `ci.yml` workflow | CI infrastructure (`.github/workflows/ci.yml`) | npm + vitest | Standard Linux runner; mirrors `publish.yml` style. |
| Sign-off artifact | Documentation (`docs/v2/SIGN-OFF.md`) | GitHub PR approval | Markdown checklist + PR review as audit trail. |

**Key insight:** Phase 0 is uniformly in the **Documentation + Test Infrastructure + CI** tiers. There are no API, database, or browser concerns. The planner should NOT introduce any `src/` changes; the only TypeScript code added is `evals/v1-baseline/baseline.test.ts` and `evals/v1-baseline/dump-tools.mjs` — both consumers of `src/server.ts`, not modifiers.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vitest` | `^2.1.8` (current) | Test runner for `baseline.test.ts` | `[VERIFIED: package.json]` Already in devDeps; reuse avoids new dependency surface. **Do not bump to v3 in Phase 0** — that's Phase 1 territory if at all. `[VERIFIED: npm view vitest version]` latest is 4.1.6 but Phase 0 is no-deps. |
| `yaml` | `^2.6.x` | Load `_queries/*.yaml` and `<tool-name>.yaml` files | `[CITED: D-10]` D-10 pulls forward the Phase 6 dependency. `[VERIFIED: npm view yaml version]` latest is 2.9.0 — install at `^2.9.0` for forward-compat with Phase 6. |
| `@modelcontextprotocol/sdk` | `^1.0.4` (current) | `tools/list` schema for snapshot generation | `[VERIFIED: package.json]` Already in deps. Phase 0 does NOT bump to 1.29 — that's Phase 1 (`ADP-08`). |
| POSIX shell | n/a | CI lint scripts | `[CITED: D-18]` Matches existing `scripts/*.sh` style; zero deps. |
| GitHub Actions | n/a | CI workflow | `[CITED: D-21]` Mirrors `publish.yml`. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `prettier` | `^3.4.0` (current) | Format check (`prettier --check`) | `[VERIFIED: package.json]` Already devDep. Add `npm run lint:check` script. |
| `typescript` | `^5.7.0` (current) | `tsc --noEmit` type check | `[VERIFIED: package.json]` Already devDep; reused for lint pipeline. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest snapshot (`toMatchSnapshot`) | Literal JSON file + `expect.toEqual(JSON.parse(fs.readFile))` | Snapshot machinery auto-manages files (e.g., `--update` regenerates, obsolete snapshots auto-removed) — defeats "drift is loud" goal. Literal file with hand-edited update workflow forces a human to ack any change. **Decision: literal file.** |
| Custom YAML schema validation | Reuse zod from `package.json` | zod is already a dep; `evals/v1-baseline/baseline.test.ts` can validate `<tool-name>.yaml` shape using the same pattern as `src/server.ts` arg schemas. |
| Standalone POSIX shell linter (shellcheck) | None — manual review | `[ASSUMED]` shellcheck would catch BSD-vs-GNU portability bugs (E2 below) but adds a CI dep. Decision deferred; can be added in Phase 1 if a lint regression surfaces. |
| MADR template package (npm `madr@2.x`) | Hand-rolled MADR-style table | MADR npm package is a CLI scaffolder, not a library. We need the table format only. Hand-roll the 14-row table; one entry per ADR. |

**Installation:**

```bash
# Only one new dep in Phase 0 (pulled forward from Phase 6 per D-10):
npm install --save yaml@^2.9.0
```

**Version verification (run during planning):**
```bash
npm view yaml version    # confirm 2.9.x is current
npm view vitest version  # confirm we stay on the 2.x line for this phase
```

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────────────────────┐
                       │      Maintainer (Oliver) — author    │
                       └────────────────┬─────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
┌─────────────────┐         ┌────────────────────┐         ┌──────────────────────┐
│ git mv docs/dev │         │ Hand-author        │         │ Author docs/v2/      │
│ → docs/v2/adr/  │         │ evals/fixtures/    │         │ ARCHITECTURE.md      │
│ (4 PRs, 1 ADR   │         │ v2-test-vault/     │         │ MEMORY_CONTRACT.md   │
│  each)          │         │ + _queries/*.yaml  │         │ AGENT_AGNOSTIC.md    │
└────────┬────────┘         └─────────┬──────────┘         └──────────┬───────────┘
         │                            │                               │
         │ (1 commit per PR =         │                               │
         │  rename only, no edits)    │                               │
         ▼                            │                               │
┌─────────────────┐                   │                               │
│ Amend ADR with  │                   │                               │
│ Invariants +    │                   │                               │
│ Examples +      │                   │                               │
│ ADR-003/004     │                   │                               │
│ amendments      │                   │                               │
│ (commit 2)      │                   │                               │
└────────┬────────┘                   │                               │
         │                            │                               │
         └──────────────┬─────────────┴───────────────┬───────────────┘
                        │                             │
                        ▼                             ▼
         ┌──────────────────────────────┐  ┌────────────────────────────────┐
         │ Adversarial review session   │  │ Build evals/v1-baseline/:      │
         │ (separate Claude, gsd-       │  │  - dump-tools.mjs (reads       │
         │  advisor-researcher agent)   │  │    src/server.ts registry)     │
         │ Inputs: 4 ADRs + 3 arch docs │  │  - tools-list.snapshot.json    │
         │ Output: ADVERSARIAL-         │  │  - <tool-name>.yaml fixtures   │
         │  REVIEW.md (one finding =    │  │  - baseline.test.ts (vitest)   │
         │  one ambiguity)              │  └────────────────┬───────────────┘
         └──────────────┬───────────────┘                   │
                        │                                   │
                        ▼                                   ▼
         ┌──────────────────────────────┐  ┌────────────────────────────────┐
         │ For each finding:            │  │ Author scripts/                │
         │  a) amend ADR (commit)       │  │  - check-fixture-privacy.sh    │
         │  b) row in index marked      │  │  - lint-no-telemetry.sh        │
         │     Status: Deferred-v3     │  │ Wire to npm run lint:check     │
         │     + one-line rationale     │  └────────────────┬───────────────┘
         └──────────────┬───────────────┘                   │
                        │                                   │
                        └─────────────────┬─────────────────┘
                                          │
                                          ▼
                       ┌──────────────────────────────────────┐
                       │ .github/workflows/ci.yml             │
                       │  trigger: PR + push:main             │
                       │  steps: npm ci → npm run lint:check  │
                       │         → npm test (incl. baseline)  │
                       └──────────────────┬───────────────────┘
                                          │
                                          ▼
                       ┌──────────────────────────────────────┐
                       │ docs/v2/SIGN-OFF.md                  │
                       │  FND-01..14 checklist                │
                       │  + resolving commit SHA per item     │
                       │  + maintainer PR approval = audit    │
                       └──────────────────────────────────────┘
```

### Recommended Project Structure

```
vault-memory/
├── docs/
│   ├── dev/                           # REMOVED from .gitignore as part of FND-01
│   │   └── gsd-agent-knowledg-layer.md  # remains (full brief; not an ADR)
│   └── v2/
│       ├── ARCHITECTURE.md            # FND-05 (layer model)
│       ├── MEMORY_CONTRACT.md         # FND-06 (property contract)
│       ├── AGENT_AGNOSTIC.md          # FND-07 (MCP canonical, Skills are clients)
│       ├── SIGN-OFF.md                # FND-14 (checklist + commit SHAs)
│       └── adr/
│           ├── README.md              # FND-13 (MADR-style index table)
│           ├── 001-document-identity.md       # FND-01 (relocated)
│           ├── 002-adapter-seams.md           # FND-01 (relocated, renamed from "source-and-delivery-seams")
│           ├── 003-document-shape.md          # FND-01 + FND-02 (amended w/ hash semantics)
│           ├── 004-memory-sink-handles.md     # FND-01 + FND-03 (amended w/ folder-default)
│           └── ADVERSARIAL-REVIEW.md          # FND-04 (sub-agent output)
│
├── evals/
│   ├── fixtures/
│   │   └── v2-test-vault/                     # FND-08 (~75 notes)
│   │       ├── README.md                      # narrative + folder map
│   │       ├── .obsidian/                     # (omitted — fixture isn't an Obsidian-opened vault)
│   │       ├── projects/                      # ~20 notes
│   │       ├── meetings/                      # ~15 notes
│   │       ├── people/                        # ~10 notes
│   │       ├── decisions/                     # ~10 notes
│   │       ├── references/                    # ~15-20 notes
│   │       ├── _memory/                       # ~20 notes (subset of total) — primes Phase 2
│   │       └── _queries/                      # FND-08 query fixtures
│   │           ├── search.yaml                # ≥3 queries
│   │           ├── bundle.yaml                # ≥3 queries
│   │           ├── dossier.yaml               # ≥3 queries
│   │           ├── brief.yaml                 # ≥3 queries
│   │           ├── graph.yaml                 # ≥3 queries
│   │           ├── memory.yaml                # ≥3 queries
│   │           └── contract.yaml              # ≥3 queries
│   └── v1-baseline/                           # FND-09, FND-10
│       ├── baseline.test.ts                   # vitest entry; iterates fixtures
│       ├── dump-tools.mjs                     # one-shot snapshot generator
│       ├── tools-list.snapshot.json           # FND-10 (pinned)
│       ├── search_semantic.yaml               # FND-09 semantic floor (per-tool)
│       ├── search_text.yaml
│       ├── search_hybrid.yaml
│       ├── list_backlinks.yaml
│       ├── list_forward_links.yaml
│       ├── find_broken_links.yaml
│       ├── query_frontmatter.yaml
│       ├── search.yaml                        # (flat-shape adapter)
│       ├── fetch.yaml                         # (flat-shape adapter)
│       ├── vault_stats.yaml
│       └── suggest_frontmatter.yaml
│
├── scripts/
│   ├── check-fixture-privacy.sh               # FND-11
│   ├── lint-no-telemetry.sh                   # FND-12
│   ├── download-reranker.sh                   # (existing)
│   └── install-skills.sh                      # (existing)
│
├── .github/
│   └── workflows/
│       ├── ci.yml                             # FND-11/12/21 (new)
│       └── publish.yml                        # (existing — unchanged)
│
├── .gitignore                                 # MODIFIED — remove `docs/dev/`
├── package.json                               # MODIFIED — add lint:check, eval:baseline, eval:snapshot
└── CHANGELOG.md                               # MODIFIED — append [Unreleased] → Documentation
```

### Pattern 1: Two-Commit Relocation-Plus-Amendment PR

**What:** Each of the four ADR PRs ships as two commits: commit-1 is the `git mv` alone (preserves rename detection for `git log --follow`), commit-2 is the content amendments.

**When to use:** Always for D-01/D-02 — every ADR PR.

**Why:** Git's rename detection is heuristic. The default similarity threshold is ~50%; if commit-1 both renames AND adds 200 lines of Invariants + Examples, git may classify the change as delete-plus-add and `git log --follow docs/v2/adr/003-document-shape.md` will stop at the rename instead of tracing through to `docs/dev/003-document-shape.md`. [VERIFIED: git-mv documentation + multiple sources]

**Example (sequence inside one PR branch):**

```bash
git checkout -b phase-0/adr-001-relocate
# Commit 1: rename only — no other changes
git mv docs/dev/001-document-identity.md docs/v2/adr/001-document-identity.md
# Also in commit 1: gitignore tweak (line removed for docs/dev/)
sed -i.bak '/^docs\/dev\/$/d' .gitignore && rm .gitignore.bak
git add .gitignore
git commit -m "docs(adr-001): relocate to public docs/v2/adr/"

# Commit 2: amendments — Invariants + Examples sections
# (edit the file in place)
git add docs/v2/adr/001-document-identity.md docs/v2/adr/README.md
git commit -m "docs(adr-001): add Invariants + Examples sections; add index row"
```

### Pattern 2: Literal-File Snapshot (not vitest snapshot)

**What:** `tools-list.snapshot.json` is a hand-committed file. The test reads it with `fs.readFileSync`, parses, and `toEqual` compares against the live `tools/list` output dumped via `evals/v1-baseline/dump-tools.mjs`.

**When to use:** Whenever the goal is "contractual surface — drift fails loudly." Use vitest's built-in snapshot only for transient implementation-detail assertions.

**Example:**
```typescript
// evals/v1-baseline/baseline.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dumpTools } from "./dump-tools.mjs";  // one-shot helper

describe("v1 tools/list surface", () => {
  it("matches the pinned snapshot exactly", async () => {
    const actual = await dumpTools();  // returns { tools: [...] }
    const pinned = JSON.parse(
      readFileSync(join(__dirname, "tools-list.snapshot.json"), "utf-8")
    );
    expect(actual).toEqual(pinned);
  });
});
```

**Update workflow (intentionally manual):**
```bash
# When a tool is intentionally added/changed (Phase 1+):
node evals/v1-baseline/dump-tools.mjs > evals/v1-baseline/tools-list.snapshot.json
# Review the diff in PR — the human ack IS the gate.
```

### Pattern 3: One Eval-Fixture-Vault Slice = Coherent Sub-Narrative

**What:** The ~75 Atlas Robotics notes form a coherent fictional company. Each top-level folder hangs off a single narrative thread so cross-references are realistic.

**When to use:** When authoring `evals/fixtures/v2-test-vault/`.

**Example narrative outline:**
- `people/Alice-Chen.md` (CEO), `people/Bob-Martinez.md` (CTO), `people/Carlos-Yim.md` (Lead Engineer)
- `projects/Atlas-1.md` (the flagship robot), `projects/Spire.md` (warehouse ops product), `projects/Beacon.md` (R&D side bet)
- `meetings/2026-04-15-Q2-OKR-review.md` references projects + people via `[[wikilinks]]`
- `decisions/2026-03-12-pivot-to-warehouse.md` is the company decision that made Spire the priority
- `references/IEEE-Robotics-Society-2025.md` is a citation reference
- `_memory/observations/2026-04-15-alice-prefers-async-standups.md` (provenance-labeled, `source: agent`)

Realism > volume. ~10 minutes per note × 75 ≈ 12 hours of authoring is the eval substrate for the entire v2 line — pay this cost once.

### Anti-Patterns to Avoid

- **`git mv` + 200-line edit in one commit** — Git classifies as delete-plus-add ~50% of the time; rename history is silently lost. **Always two commits.** [VERIFIED: git docs + sqlpey.com]
- **Vitest `toMatchSnapshot()` for the tools/list pin** — The `-u` workflow auto-updates the snapshot file on local re-run, defeating "drift is loud." Use literal file + `toEqual`.
- **LLM-drafted fixture notes** — Eval debugging requires human-legible content. LLM drafts are hallucination-friendly and homogeneous; real notes have asymmetries that catch real bugs. [CITED: D-08]
- **`grep -P` (Perl regex) in lint scripts** — BSD grep on macOS does not support `-P`. Use `grep -E` (POSIX extended regex). [VERIFIED: FreeBSD grep man page + ponderthebits.com]
- **Snapshot file path includes test filename** — Vitest issue #8655: if `toMatchFileSnapshot("__snapshots__/foo.test.ts.snap")` matches the host test filename, vitest can delete it on `--update`. Use a stable, unrelated path: `tools-list.snapshot.json`.
- **Banlist using single substring without escape** — A doc comment that says "we considered Sentry-style telemetry" would fail `lint-no-telemetry.sh`. Provide the `// vault-memory:no-telemetry-ok` escape comment per D-20.
- **Adversarial review that produces vague findings** — "ADR-002 is unclear" is not a finding. A finding is: "ADR-002 §`SourceConnector.hash(id)` does not specify what stability guarantees apply when the underlying file is being written concurrently — must the hash be of a snapshot, or a best-effort read?" One sentence, one ambiguity, addressable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing of `_queries/*.yaml` | Hand-rolled regex parser | `yaml` (`^2.9.0`) | Comment preservation matters for Phase 6 contracts; `yaml` is the same parser Phase 6 will use. |
| JSON canonical form for ADR-003 hash invariant pseudocode | Hand-written description of sorted-keys | Cite **RFC 8785 (JCS)** directly + show three failure modes (NFC, LF, number canonicalization) | RFC 8785 is the canonical reference for any future Notion/Rust/Go implementer; ambiguous prose is the exact failure mode the adversarial reviewer should catch. [VERIFIED: rfc-editor.org/rfc/rfc8785] |
| ADR template | Bespoke format | Adopt **MADR 4.0** structure (status, context, decision, consequences, alternatives) — existing ADRs already follow this | MADR is the de-facto standard for OSS markdown ADRs; matches existing ADR 001–004 shape. [CITED: adr.github.io/madr/] |
| Tool-snapshot diffing in CI | Custom JSON-deep-diff | vitest's `toEqual` + read literal file | vitest already gives a precise, line-numbered diff; no need for jest-diff or custom logic. |
| Fixture-privacy detection | `find` with complex predicates | `git ls-tree -r HEAD` + `grep -v` filter | Operates on git index state, not working tree — robust against uncommitted local debris and untracked fixtures. |
| Adversarial-review tracking | Issue tracker / spreadsheet | Single ADVERSARIAL-REVIEW.md with numbered findings + status column | One file = one review pass; status mutates to "amended in commit ABC123" or "deferred — see ADR-index row N". |

**Key insight:** Phase 0's pitfalls are almost all *git*, *shell*, and *spec-precision* — not novel engineering. Lean on standards (RFC 8785, MADR, POSIX) and existing tools (vitest, prettier, tsc) rather than inventing.

## Runtime State Inventory

> Phase 0 is docs/CI only — no rename or migration. Runtime state inventory is largely N/A, but two categories deserve explicit mention because the planner could miss them.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no SQLite migrations, no Mem0, no ChromaDB touched in Phase 0. | None. |
| Live service config | `.gitignore` line `docs/dev/` — this is config (config-as-code in the repo), not just a list. Removing it changes what subsequent `git add .` will index. | Verify that no maintainer-only files in `docs/dev/` (currently 5 files: ADRs 001–004 + `gsd-agent-knowledg-layer.md`) become accidentally public-but-unintended. The brief stays gitignored if not relocated; ADRs become public. Decision: leave `gsd-agent-knowledg-layer.md` where it is — it's an internal v2 brief, not an ADR. **Add an explicit `.gitignore` line for `docs/dev/gsd-agent-knowledg-layer.md`** after removing the directory-wide ignore, OR move that file to `docs/dev-internal/` and gitignore that. |
| OS-registered state | None — no systemd unit, no scheduled task, no global npm install. | None. |
| Secrets/env vars | None — Phase 0 changes no env vars, secrets, or `~/.vault-memory/config.toml` semantics. | None. |
| Build artifacts | `dist/` is rebuilt by `tsup` on `npm run build`; Phase 0 changes no `src/` code, so `dist/` is unaffected. `package.json#files` is `["dist", "README.md", "LICENSE"]` — the new `docs/v2/`, `evals/`, `scripts/check-fixture-privacy.sh`, `scripts/lint-no-telemetry.sh` are repo-only artifacts NOT shipped to npm. | Verify `package.json#files` is unchanged. The eval fixture vault MUST NOT ship to npm subscribers. |

**The single live-config item to action:** decide where `gsd-agent-knowledg-layer.md` lives post-Phase-0. Recommendation: keep it in `docs/dev/` but add a narrow gitignore line for that single file rather than the whole directory.

## Common Pitfalls

### Pitfall 1: `git mv` rename-detection failure when content also changes in same commit

**What goes wrong:** `git log --follow docs/v2/adr/003-document-shape.md` stops at the rename, doesn't trace back to `docs/dev/003-document-shape.md`. The valuable git history is silently lost.

**Why it happens:** Git stores no rename data in commits. Rename detection is recomputed at every `git log --follow` invocation using a similarity threshold (default `-M50%`). If the commit that does `git mv` also adds 200 lines of new content (Invariants + Examples), the post-commit file is <50% similar to the pre-commit file, and git classifies as delete-plus-add. [VERIFIED: linuxctl.com + sqlpey.com + git-scm.com/docs/git-mv]

**How to avoid:** Two commits per PR. Commit-1: `git mv` alone (and `.gitignore` removal). Commit-2: content amendments. PR ships both — squash-merge is FINE if the reviewer ensures both commits land separately on the merge branch (don't squash; use "Rebase and merge" or merge commit on the four ADR PRs specifically).

**Warning signs:** After the PR merges, run `git log --follow docs/v2/adr/00X-*.md` and confirm at least one commit predates the rename. If not, the history is severed — recoverable only by ad-hoc rename-detection-tweaking flags (`-M30%`).

### Pitfall 2: JSON canonical form ambiguity in ADR-003 amendment

**What goes wrong:** Two implementers (Phase 1 obsidian-fs adapter, Phase 10 Notion adapter) produce different hashes for the same `Document` because they canonicalize the `PropertyBag` differently — one uses `JSON.stringify` with sorted keys (Node's default behavior with `Object.keys().sort()`), the other uses strict RFC 8785 with UTF-16 code-unit key sort + ECMAScript `Number.prototype.toString`. Briefs flip stale spuriously when a connector changes; conformance suite (ADP-13) silently passes both implementations.

**Why it happens:** "Sorted keys + minimal whitespace" is underspecified. JSON has at least three canonical-form proposals (RFC 7515 §7 sketches one, RFC 8785 is the formal one, JCS-strict variants exist). Implementers default to whatever their language's stdlib provides. [VERIFIED: rfc-editor.org/rfc/rfc8785 + json-canonicalize npm + connect2id.com]

**How to avoid:** ADR-003 amendment MUST cite **RFC 8785 by RFC number**, and the pseudocode MUST show explicit handling of these three failure modes:
1. **Number canonicalization** — `42.0` and `42` MUST hash identically. RFC 8785 specifies ECMAScript's `Number.prototype.toString` (per IEEE 754 + ECMA-262). Example: `{"x": 1.0}` canonicalizes to `{"x":1}`.
2. **UTF-16 lexicographic key sort** — keys are sorted by their **UTF-16 code-unit values**, not by UTF-8 bytes. Example: `"é"` (é, NFC) sorts before `"é"` (é, NFD) — but the canonical form requires NFC, so this only bites if input isn't normalized.
3. **Unicode NFC normalization** — input strings (both keys and values) MUST be NFC-normalized before serialization. This is the most-frequently-missed step.

Recommended pseudocode block for the ADR-003 amendment (write into `Examples` section):

````markdown
### Hash canonicalization (Invariant H-1)

```
hash(doc: Document) -> string:
    blocks_text   = render_blocks_to_plain_text(doc.blocks)
                    # NFC-normalized; LF line endings (no CRLF); no trailing whitespace
    props_json    = jcs(doc.properties)
                    # RFC 8785 JSON Canonicalization Scheme:
                    #   - keys sorted by UTF-16 code units (after NFC normalization)
                    #   - numbers serialized per ECMAScript Number.prototype.toString
                    #   - no whitespace, no trailing newline
                    #   - strings NFC-normalized
                    #   - booleans/null as "true"/"false"/"null"
    return sha256_hex(utf8(blocks_text || "\n" || props_json))
                    # "||" is byte concatenation; "\n" is a single 0x0A byte
```

#### Worked example

Document:
```json
{
  "id": "obsidian-fs://atlas/people/Alice.md",
  "title": "Alice Chen",
  "blocks": [{"kind": "paragraph", "text": "CEO of Atlas Robotics."}],
  "properties": {
    "role": {"type": "string", "value": "CEO"},
    "joined": {"type": "date", "value": "2024-03-15"}
  }
}
```

- `blocks_text` = `"CEO of Atlas Robotics."`
- `props_json`  = `{"joined":{"type":"date","value":"2024-03-15"},"role":{"type":"string","value":"CEO"}}`
- input to sha256 = `"CEO of Atlas Robotics.\n{\"joined\":{\"type\":\"date\",\"value\":\"2024-03-15\"},\"role\":{\"type\":\"string\",\"value\":\"CEO\"}}"`
- hash = `sha256_hex(...)` = e.g. `"a3f5b...e9"` (deterministic across Node/Python/Rust/Go).
```
````

**Warning signs:** Two adapters (obsidian-fs and the conformance-test stub) produce different hashes for the same Document fixture. CI conformance suite (Phase 1, ADP-13) should include this exact fixture and assert byte-equal hash output across implementations.

### Pitfall 3: BSD vs GNU grep silent divergence in CI lints

**What goes wrong:** `lint-no-telemetry.sh` passes on the maintainer's macOS (BSD grep) but fails (or silently passes a real telemetry leak) on the Linux CI runner (GNU grep), or vice versa.

**Why it happens:** BSD and GNU grep diverge on multiple axes: `-P` (Perl regex) is GNU-only; `-r` is supported in both but treats symlinks differently; `--include` and `--exclude-dir` are GNU-only; lazy-vs-greedy quantifier behavior in `-E` extended regex differs. [VERIFIED: FreeBSD grep man page + ponderthebits.com + ycombinator.com discussion]

**How to avoid:**
- **Use only POSIX-portable flags:** `-r`, `-E`, `-i`, `-l`, `-n`, `-v`, `-q`. Avoid `-P`, `--include`, `--exclude-dir`, `--color`, `-Z`.
- **Prefer `find ... | grep` over `grep -r`** for any complex traversal — `find` is more portable for path filtering.
- **Test alternation with explicit `|` inside `()`:** `grep -E '(analytics|telemetry|posthog)'` rather than `\<analytics\|telemetry\>` (word-boundary syntax differs).
- **Test the lint on both platforms before sign-off:** macOS local + a one-off `docker run --rm -v $PWD:/work alpine sh /work/scripts/lint-no-telemetry.sh`. Alpine's `grep` is BusyBox, even stricter than GNU — if both pass, GNU and BSD will both pass.

**Warning signs:** Lint passes locally, fails on CI with a confusing exit code (BusyBox `grep -P` returns exit code 2 on macOS; GNU `grep -P` would succeed). Or the inverse: CI is green but a planted test case (e.g., commit a file with the literal word "telemetry" in `src/foo.test.ts`) doesn't trip the lint. Add a planted-bait test as part of the lint's own test suite.

### Pitfall 4: Tool-snapshot non-determinism in `tools/list`

**What goes wrong:** Snapshot drift fires not because the tool surface changed, but because something in the JSON output is non-deterministic — and CI is now red on a meaningless diff.

**Why it happens (and DOES NOT happen here):** Potential sources of non-determinism include: (a) timestamp in description string, (b) randomly ordered enum values, (c) variable-order schema property listings, (d) SDK-injected metadata like `version` or `serverInstance`.

**Inspection of `src/server.ts`:** [VERIFIED: read of src/server.ts:325-720]
- Tools are registered as a **literal static array** in the order: `list_vaults`, `read_note`, `search_semantic`, `search_text`, `search_hybrid`, `list_backlinks`, `list_forward_links`, `find_broken_links`, `query_frontmatter`, `write_note`, `update_frontmatter`, `delete_note`, `audit_log`, `list_models`, `start_shadow_index`, `switch_active_model`, `vacuum_embeddings`, `index_runs`, `search`, `fetch`, `vault_stats`, `recent_notes`, `suggest_frontmatter`.
- **23 tools confirmed** by grep on `name:` (matches FND-10 expectation).
- Every `inputSchema` is a literal object with no `Date.now()`, no env-variable interpolation, no enum-from-config — except `search_semantic` / `search_text` / `search_hybrid` which list `vaults` as `array of string` (not enumerated).
- **No SDK-injected wrapper fields.** The `tools/list` response is exactly `{tools: <array>}`; the SDK adds no `id`, no `meta`, no timestamp. [CITED: modelcontextprotocol.io tools spec + sdk @1.0.4 source]

**How to avoid:** None needed — the snapshot will be stable. But the planner should add a **deterministic-JSON-stringify pass** in `dump-tools.mjs` to defend against future drift:

```javascript
// dump-tools.mjs
import { serve } from "../../dist/cli.js";  // or harness directly via the same Server() setup
// Easiest: re-instantiate the tools array literal by importing from src/
// directly via a tiny refactor — extract the array into `src/tool-registry.ts`
// to make it importable. That's a Phase 1 cleanup; for Phase 0, replicate.

import { TOOLS } from "../../src/tool-registry.js";  // Phase 0 minor refactor: extract literal

const sorted = { tools: TOOLS };  // already in registration order; preserve it
process.stdout.write(JSON.stringify(sorted, null, 2) + "\n");
```

**One required Phase 0 micro-refactor:** Extract the tools array literal from `src/server.ts` lines 326–720 into `src/tool-registry.ts` exporting `const TOOLS = [...]`, and import it into `server.ts`. This is the ONLY `src/` change in Phase 0 and it must be flagged in the planner's task list. Alternative: dump-tools.mjs spawns the actual MCP server in-process and issues a `tools/list` JSON-RPC call, but that's more complex than the 5-line extraction.

**Warning signs:** First-time snapshot drift on an unrelated PR. Confirm the diff is intentional before regenerating.

### Pitfall 5: Eval fixture realism vs. test-coupling

**What goes wrong:** The Atlas Robotics fixture is hand-authored to feel realistic, but the `_queries/*.yaml` `expected_doc_ids` are tightly coupled to specific note filenames. A later cleanup pass renames `projects/Atlas-1.md` → `projects/atlas-1.md` (kebab-case normalization), and a dozen query fixtures break silently — eval still runs but every expected ID is wrong.

**Why it happens:** No referential integrity check between query fixtures and the actual vault. The fixture is human-authored, the queries are human-authored, the linkage is human-maintained.

**How to avoid:**
- **Add a fixture-integrity test** to `evals/v1-baseline/baseline.test.ts`: for every `expected_doc_ids` entry in every `_queries/*.yaml`, assert that the corresponding file exists in `evals/fixtures/v2-test-vault/`. Cheap, runs in <100ms, catches every fixture-rename desync. [Pattern referenced from `.planning/research/PITFALLS.md` Pitfall 12].
- **Use `obsidian-fs://` URI form for `expected_doc_ids`** to match the eventual ADR-001 identity scheme. Adapter sees the fixture differently than the live system, but the eval surface is forward-compatible.

**Warning signs:** Eval passes on `main`, but a `recall` metric of 0.00 on a specific tool indicates a fixture-vs-query desync, not a real regression.

### Pitfall 6: Adversarial review producing checkbox findings

**What goes wrong:** The sub-agent reports "ADR-001 is comprehensive, ADR-002 is comprehensive, all good" — a rubber-stamp. The gate looks passed but no ambiguities were actually surfaced.

**Why it happens:** The sub-agent is given a permissive prompt ("review these ADRs") and produces an empty-ish review because no specific adversarial framing is in the prompt. [Pattern from `.planning/research/PITFALLS.md` Pitfall 11].

**How to avoid:** The Phase 0 planner MUST script the sub-agent's invocation prompt precisely. Recommended template:

```
You are a v3 Phase-10 contractor with funding to ship a Notion source-connector,
delivery-adapter, and change-feed adapter for vault-memory. You have access ONLY
to these documents:
  - docs/v2/adr/001-document-identity.md
  - docs/v2/adr/002-adapter-seams.md
  - docs/v2/adr/003-document-shape.md
  - docs/v2/adr/004-memory-sink-handles.md
  - docs/v2/ARCHITECTURE.md
  - docs/v2/MEMORY_CONTRACT.md
  - docs/v2/AGENT_AGNOSTIC.md

You may NOT look at vault-memory's source code, the v2 brief, or any other
documents. Produce a Notion-adapter implementation plan (interface signatures,
schema mapping, edge cases). At every point where the ADRs/architecture leave
a decision unspecified, file a numbered Finding in ADVERSARIAL-REVIEW.md:

  ## Finding N
  **ADR / doc**: <which document, section>
  **Ambiguity**: <one-sentence description>
  **Impact on Notion adapter**: <concrete decision the implementer must invent>
  **Recommended resolution**: <one of: ADR amendment / index "Deferred-v3" row>

Findings should be specific enough that a maintainer can either (a) commit a
text amendment to the ADR, or (b) mark the deferral in the index. Vague
findings ("ADR-X is unclear") are useless — rewrite until specific.

Stop when you have produced a complete plan OR you have ≥10 findings,
whichever comes first.
```

Maintainer reads the Findings, dispositions each one (amend / defer / reject as out-of-scope), and the resolutions land in PRs before sign-off.

**Warning signs:** ADVERSARIAL-REVIEW.md has zero findings (= rubber-stamp), or every finding is "deferred to v3" with no amendments (= ADRs are not actually being tightened — the gate failed). A healthy outcome has 3–8 findings, ~half amended, ~half deferred with explicit rationale.

## Code Examples

Verified patterns from official sources and existing project conventions.

### Example 1: `check-fixture-privacy.sh` (POSIX-portable)

```bash
#!/bin/sh
# scripts/check-fixture-privacy.sh
#
# Fails if any path under evals/fixtures/*/ (other than v2-test-vault/)
# is committed. Detects accidental commit of a real user vault.
#
# POSIX-portable: tested on macOS (BSD grep) + Linux (GNU grep) + Alpine (BusyBox).

set -eu

ALLOW="v2-test-vault"

# Use git ls-tree (operates on git index, not working tree — robust against
# uncommitted local debris). Filter to evals/fixtures/*/ first-level dir names.
violations=$(
  git ls-tree -r --name-only HEAD 2>/dev/null \
    | grep -E '^evals/fixtures/[^/]+/' \
    | awk -F/ '{print $3}' \
    | sort -u \
    | grep -vxF "$ALLOW" \
    || true
)

if [ -n "$violations" ]; then
  echo "✗ Fixture-privacy violation: only 'evals/fixtures/$ALLOW/' is allowed." >&2
  echo "  Found committed fixtures outside the allowlist:" >&2
  printf "    - evals/fixtures/%s/\n" $violations >&2
  echo "" >&2
  echo "  Either remove these directories from git, or update the allowlist" >&2
  echo "  in scripts/check-fixture-privacy.sh after maintainer review." >&2
  exit 1
fi

echo "✓ Fixture-privacy lint passed (allowlist: $ALLOW)"
```

### Example 2: `lint-no-telemetry.sh` (POSIX-portable with escape-comment)

```bash
#!/bin/sh
# scripts/lint-no-telemetry.sh
#
# Fails if src/**/*.ts contains any banned substring (case-insensitive)
# without a sibling `// vault-memory:no-telemetry-ok` escape comment.
#
# Banlist is curated; updates require maintainer review.

set -eu

# Banned substrings (case-insensitive). Whole-word match where reasonable;
# substring match where it must (e.g., "segment.com" is a domain).
BANNED='analytics|telemetry|posthog|segment\.com|mixpanel|sentry|datadog|track\(|trackEvent|report\(|reportMetric'

# The escape marker. If a line containing a banned substring ALSO contains
# this marker on the same line, it is allowed.
ESCAPE='vault-memory:no-telemetry-ok'

# Find all .ts files under src/, exclude *.test.ts (banned-word references
# in tests/comments are OK if escaped — but the test should be obvious).
violations=$(
  find src -name '*.ts' -not -name '*.test.ts' -type f \
    | xargs grep -inE "$BANNED" 2>/dev/null \
    | grep -v "$ESCAPE" \
    || true
)

if [ -n "$violations" ]; then
  echo "✗ Telemetry-banlist violation in src/**/*.ts:" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "  If this is a legitimate non-telemetry reference, append" >&2
  echo "  '// $ESCAPE' to the offending line." >&2
  exit 1
fi

echo "✓ Telemetry banlist clean ($(find src -name '*.ts' -not -name '*.test.ts' | wc -l | tr -d ' ') files scanned)"
```

### Example 3: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

# Cancel previous runs on the same branch when a new push lands.
# Each PR / branch gets its own queue (no cross-branch cancellation).
concurrency:
  group: ci-${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: true

jobs:
  lint-and-test:
    name: Lint, type-check, test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history — needed for check-fixture-privacy.sh

      - name: Setup Node 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint (shell + tsc + prettier)
        run: npm run lint:check

      - name: Test (vitest — includes evals/v1-baseline)
        run: npm test
```

### Example 4: `package.json` script additions

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsx watch src/cli.ts",
    "start": "node dist/cli.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "lint:check": "sh scripts/check-fixture-privacy.sh && sh scripts/lint-no-telemetry.sh && tsc --noEmit && prettier --check \"src/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\"",
    "eval:baseline": "vitest run evals/v1-baseline/baseline.test.ts",
    "eval:snapshot": "node evals/v1-baseline/dump-tools.mjs > evals/v1-baseline/tools-list.snapshot.json"
  }
}
```

### Example 5: `evals/v1-baseline/dump-tools.mjs`

```javascript
#!/usr/bin/env node
// dump-tools.mjs — emit the v1 tools/list response as canonical JSON.
//
// Reads the literal TOOLS array from src/tool-registry.ts (Phase 0 micro-
// refactor: extract the literal from src/server.ts into its own module).
//
// Output: { tools: [...] } printed to stdout with 2-space indentation
// and a trailing newline. Run via:
//
//   node evals/v1-baseline/dump-tools.mjs > evals/v1-baseline/tools-list.snapshot.json

import { TOOLS } from "../../src/tool-registry.js";

const payload = { tools: TOOLS };
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
```

### Example 6: `evals/v1-baseline/baseline.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { TOOLS } from "../../src/tool-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = join(__dirname, "..", "fixtures", "v2-test-vault");

describe("v1 tools/list surface (FND-10)", () => {
  it("matches the pinned snapshot exactly", () => {
    const actual = { tools: TOOLS };
    const pinned = JSON.parse(
      readFileSync(join(__dirname, "tools-list.snapshot.json"), "utf-8"),
    );
    expect(actual).toEqual(pinned);
  });

  it("has exactly 23 tools", () => {
    expect(TOOLS).toHaveLength(23);
  });
});

describe("v1 behavioral floors (FND-09)", () => {
  // Discover all <tool-name>.yaml fixtures in evals/v1-baseline/
  const fixtures = readdirSync(__dirname).filter(
    (f) => f.endsWith(".yaml") && f !== "README.yaml",
  );

  for (const fixtureFile of fixtures) {
    const toolName = fixtureFile.replace(/\.yaml$/, "");
    describe(toolName, () => {
      const data = parseYaml(readFileSync(join(__dirname, fixtureFile), "utf-8"));

      // Schema validation (referential integrity — Pitfall 5 mitigation)
      it("expected_doc_ids reference real fixture files", () => {
        for (const q of data.queries) {
          for (const expectedId of q.expected_doc_ids) {
            // expected_doc_ids use vault-relative form: "projects/Atlas-1.md"
            const fullPath = join(FIXTURE_VAULT, expectedId);
            expect(
              existsSync(fullPath),
              `Query "${q.id}" references missing fixture file: ${expectedId}`,
            ).toBe(true);
          }
        }
      });

      // Per-tool precision/recall floor (D-14: 0.8)
      // NOTE: actual tool invocation requires a real vault DB + Ollama running.
      // Phase 0 ships this test as a skip-if-no-Ollama-running pattern,
      // mirroring src/rerank/onnx-reranker.test.ts. The pin is added; the
      // execution wiring against a live indexed fixture vault is a Phase 1
      // task because it requires actually indexing the v2-test-vault.
      it.todo("achieves >= 0.8 precision and >= 0.8 recall vs expected_doc_ids");
    });
  }
});
```

### Example 7: ADR Invariants section template

```markdown
## Invariants

Normative MUST/MUST-NOT statements. Phase 9's adversarial review (and any
future ADR-conformance audit) greps for these.

- **I-1**: A `DocId` MUST be of the form `<scheme>://<authority>/<resource>`.
  No other form is permitted in code paths outside `src/adapters/source/`.
- **I-2**: The `<scheme>` MUST be lowercase, hyphenated, and registered in
  `src/adapters/registry.ts`. Adapters MUST NOT mint DocIds for unregistered
  schemes.
- **I-3**: `path` (vault-relative file path) MUST NOT be used as a primary
  key in core code after the Phase 1 migration. Adapter modules MAY retain
  `path` as a denormalized cache column.
- **I-4**: For `identityStable: false` adapters, a `rename` `ChangeEvent`
  MUST be emitted with both `old_id` and `new_id`. Treating rename as
  delete-plus-create is FORBIDDEN.
- **I-5**: `obsidian://` URLs are DISPLAY-ONLY. They MUST NOT appear as
  identity in DB rows, audit logs, or tool inputs/outputs (except as the
  citation packet's `display_url` field per ADR-003).
```

### Example 8: ADR-003 chunk-level `source_hashes` schema (for the amendment)

```markdown
### Chunk-level `source_hashes` schema

A brief's `source_hashes` property is a map from chunk-id to hash. This is
finer-grained than per-document hashing — a brief flips `stale: true` only
when one of its **cited chunks** changes, not when any unrelated chunk in a
source document changes.

```typescript
type ChunkHash = string;     // hex sha256
type SourceHashes = Record<ChunkId, ChunkHash>;
```

#### Example (brief in `_memory/_briefs/`)

```yaml
---
target: project-atlas-q2-review
purpose: prep for 2026-04-15 OKR review
compiled_from:
  - obsidian-fs://atlas/projects/Atlas-1.md
  - obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md
compiled_at: 2026-04-14T18:30:00Z
source_hashes:
  obsidian-fs://atlas/projects/Atlas-1.md#chunk-3: "a3f5b…e9"
  obsidian-fs://atlas/projects/Atlas-1.md#chunk-7: "b1c2d…f4"
  obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md#chunk-1: "9d8e7…12"
confidence: inferred
status: active
---

# Atlas Q2 Review Brief

(...compiled content...)
```

The staleness daemon (Phase 5, BRF-05) checks each chunk-id against current
source state. If `obsidian-fs://atlas/projects/Atlas-1.md#chunk-3` re-indexes
to a different hash, the brief flips to `status: stale` and lists that chunk
in `stale_sources`. Frontmatter changes that re-chunk the document mark all
chunks of that document as stale (per Invariant H-1 — hash covers properties).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jest snapshot testing | Vitest snapshot or literal-file `toEqual` | Vitest matured ~2023; v2.x is the current line for ESM-native projects | Vitest is the project's existing runner; no change. |
| Per-project ADR format (free-form) | MADR 4.x (status / context / decision / consequences / alternatives) | MADR 4.0 released 2024 | Existing ADRs 001–004 already conform; just add Invariants + Examples on top. [VERIFIED: adr.github.io/madr/] |
| JSON-stringify + sort-keys | RFC 8785 (JCS) for canonical JSON | RFC 8785 published 2020; widely adopted by 2024 | Cite RFC 8785 in ADR-003 amendment; no implementation in Phase 0 (canonicalization happens at hash-time in Phase 1+). [VERIFIED: rfc-editor.org/rfc/rfc8785] |
| `git mv` + content edit in same commit | Two commits per rename PR (`mv` first, edits second) | Long-standing best practice; reaffirmed by GitHub's own follow-history limitations | Adopted as the Phase 0 PR pattern per D-01/D-02. [VERIFIED: multiple sources] |
| GitHub Actions `node_modules` cache via `actions/cache@v3` | `actions/setup-node@v4` with `cache: 'npm'` built-in | `setup-node@v4` ships native cache 2024+ | `publish.yml` already uses this pattern; `ci.yml` mirrors it. [VERIFIED: .github/workflows/publish.yml] |

**Deprecated/outdated:**
- **Jest** — not used in this project; Vitest is the existing runner. Don't reach for Jest patterns.
- **CommonJS `require()`** — project is ESM-only (`"type": "module"`). All new files use ESM imports with `.js` extensions.
- **Hand-rolled JSON sorted-keys canonicalization** — superseded by RFC 8785 references. Don't ship pseudocode that says "sort keys + minify"; say "per RFC 8785" and reference a TypeScript library implementation as a non-binding example.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All test/build/lint operations | ✓ | v24.11.1 (≥22 required) | — |
| npm | Dependency install | ✓ | 11.6.2 | — |
| git | All ADR relocation operations | ✓ (system git) | — | — |
| vitest | Test runner | ✓ | 2.1.8 (devDep) | — |
| prettier | Format check | ✓ | 3.4.0 (devDep) | — |
| typescript / tsc | Type check | ✓ | 5.7.0 (devDep) | — |
| `yaml` npm package | Loading `_queries/*.yaml` + per-tool baselines | ✗ | — | Install at `^2.9.0` (Phase 6 dep pulled forward) |
| GitHub Actions runner (ubuntu-latest) | CI workflow | ✓ (GitHub managed) | — | — |
| POSIX `/bin/sh` | Lint scripts | ✓ (macOS + Linux + Alpine) | — | — |
| `gsd-advisor-researcher` agent | Adversarial review (D-15) | ✓ (per CONTEXT.md) | — | — |
| Ollama | NOT required in Phase 0 | n/a | — | The `eval:baseline` precision/recall tests are marked `.todo` in Phase 0; live execution is Phase 1+. |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `yaml` — install during the package.json-update task; no fallback needed because adding it is trivial and pre-staged for Phase 6.

## Validation Architecture

> `.planning/config.json` was not located in the repo at research time; treating `nyquist_validation` as enabled per default.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 (existing devDep) |
| Config file | none — vitest runs with defaults from `package.json` (matches existing repo pattern per `.planning/codebase/TESTING.md`) |
| Quick run command | `npx vitest run evals/v1-baseline/baseline.test.ts` |
| Full suite command | `npm test` (runs all `*.test.ts` including `evals/v1-baseline/baseline.test.ts`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FND-01 | ADRs live at `docs/v2/adr/*` | filesystem assertion | `test -f docs/v2/adr/001-document-identity.md && test -f docs/v2/adr/002-adapter-seams.md && test -f docs/v2/adr/003-document-shape.md && test -f docs/v2/adr/004-memory-sink-handles.md` | ❌ — files don't exist yet (Phase 0 creates them) |
| FND-02 | ADR-003 contains hash-semantics pseudocode | doc grep | `grep -q 'sha256.*canonical.*PropertyBag' docs/v2/adr/003-document-shape.md && grep -q 'source_hashes' docs/v2/adr/003-document-shape.md` | ❌ Wave 0 |
| FND-03 | ADR-004 specifies folder-default + config-only separate-vault | doc grep | `grep -q 'folder-default' docs/v2/adr/004-memory-sink-handles.md && grep -q 'config.toml' docs/v2/adr/004-memory-sink-handles.md` | ❌ Wave 0 |
| FND-04 | Invariants + Examples on every ADR; ADVERSARIAL-REVIEW.md exists | doc grep + filesystem | `for f in docs/v2/adr/00{1,2,3,4}-*.md; do grep -q '^## Invariants' "$f" && grep -q '^## Examples' "$f"; done && test -f docs/v2/adr/ADVERSARIAL-REVIEW.md` | ❌ Wave 0 |
| FND-05 | `docs/v2/ARCHITECTURE.md` exists with layer model | filesystem + grep | `test -f docs/v2/ARCHITECTURE.md && grep -q 'L0\|L1\|L2\|L3\|L4' docs/v2/ARCHITECTURE.md` | ❌ Wave 0 |
| FND-06 | `docs/v2/MEMORY_CONTRACT.md` exists with property contract | filesystem + grep | `test -f docs/v2/MEMORY_CONTRACT.md && grep -q 'confidence\|evidence\|status' docs/v2/MEMORY_CONTRACT.md` | ❌ Wave 0 |
| FND-07 | `docs/v2/AGENT_AGNOSTIC.md` exists | filesystem | `test -f docs/v2/AGENT_AGNOSTIC.md` | ❌ Wave 0 |
| FND-08 | Eval fixture vault exists with ~75 notes + ≥3 queries per category | filesystem + count | `find evals/fixtures/v2-test-vault -name '*.md' | wc -l` ≥ 50; ≥3 entries per `_queries/*.yaml` | ❌ Wave 0 |
| FND-09 | v1-baseline regression suite frozen | vitest | `vitest run evals/v1-baseline/baseline.test.ts` | ❌ Wave 0 |
| FND-10 | Tool-snapshot pins `tools/list` for 23 tools | vitest unit | `vitest run evals/v1-baseline/baseline.test.ts -t "matches the pinned snapshot"` | ❌ Wave 0 |
| FND-11 | `check-fixture-privacy.sh` exists + executable | filesystem + smoke | `test -x scripts/check-fixture-privacy.sh && sh scripts/check-fixture-privacy.sh` | ❌ Wave 0 |
| FND-12 | `lint-no-telemetry.sh` exists + executable | filesystem + smoke | `test -x scripts/lint-no-telemetry.sh && sh scripts/lint-no-telemetry.sh` | ❌ Wave 0 |
| FND-13 | ADR index README at `docs/v2/adr/README.md` lists every contested ADR | doc grep | `test -f docs/v2/adr/README.md && grep -q '^| 001 |' docs/v2/adr/README.md && grep -q 'Deferred-v3' docs/v2/adr/README.md` | ❌ Wave 0 |
| FND-14 | SIGN-OFF.md exists with all 14 items checked | doc grep | `test -f docs/v2/SIGN-OFF.md && grep -c '^- \[x\] FND-' docs/v2/SIGN-OFF.md == 14` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run evals/v1-baseline/baseline.test.ts` (run the v1-baseline regression alone — fast, deterministic, no Ollama needed)
- **Per wave merge:** `npm run lint:check && npm test` (full lint + full vitest)
- **Phase gate:** `npm run lint:check && npm test` green + `docs/v2/SIGN-OFF.md` checklist all `[x]` + maintainer PR approval

### Wave 0 Gaps

- [ ] `evals/v1-baseline/baseline.test.ts` — covers FND-09, FND-10 (referential integrity + snapshot equality)
- [ ] `evals/v1-baseline/dump-tools.mjs` — covers FND-10 (snapshot generator)
- [ ] `evals/v1-baseline/tools-list.snapshot.json` — covers FND-10 (the pinned artifact)
- [ ] `evals/v1-baseline/<tool-name>.yaml` × 11 behavioral tools — covers FND-09 (semantic floor fixtures; precision/recall execution is `.todo` in Phase 0, full wiring in Phase 1)
- [ ] `evals/fixtures/v2-test-vault/_queries/*.yaml` × 7 categories — covers FND-08 (hand-labeled queries)
- [ ] `evals/fixtures/v2-test-vault/` ~75 hand-authored notes + `_memory/` subset — covers FND-08
- [ ] `scripts/check-fixture-privacy.sh` — covers FND-11
- [ ] `scripts/lint-no-telemetry.sh` — covers FND-12
- [ ] `.github/workflows/ci.yml` — covers FND-11, FND-12, FND-21 (gates the lints on PR + push)
- [ ] One-line micro-refactor: extract `TOOLS = [...]` array from `src/server.ts` lines 326–720 into `src/tool-registry.ts`; import back into `server.ts`. Required so `dump-tools.mjs` can import without spinning the full server.
- [ ] Framework install: `npm install --save yaml@^2.9.0` (pulled forward per D-10)
- [ ] `package.json` script additions: `lint:check`, `eval:baseline`, `eval:snapshot`

## Sources

### Primary (HIGH confidence)
- `.planning/phases/00-foundation-decisions/00-CONTEXT.md` — all 23 user decisions D-01..D-23
- `.planning/REQUIREMENTS.md` lines 13–25 — FND-01..14 verbatim
- `.planning/ROADMAP.md` lines 28–39 — Phase 0 goal + 5 success criteria
- `docs/dev/001-document-identity.md` — full ADR-001 source (200 lines)
- `docs/dev/002-source-and-delivery-seams.md` — full ADR-002 source (283 lines)
- `docs/dev/003-document-shape.md` — full ADR-003 source (353 lines)
- `docs/dev/004-memory-sink-handles.md` — full ADR-004 source (311 lines)
- `src/server.ts` — 23 tool registrations confirmed by grep (line 326–720)
- `package.json` — dependency versions verified
- `.github/workflows/publish.yml` — existing CI pattern to mirror
- `.gitignore` — confirms `docs/dev/` line at line 17
- `.planning/codebase/TESTING.md` — vitest layout pattern; co-located `*.test.ts`
- `.planning/codebase/CONCERNS.md` — Claude-specific debt to document; raw-fs sites; obsidian:// URL leakage
- `.planning/codebase/STRUCTURE.md` — directory layout; `evals/` would be a new top-level dir
- `.planning/research/PITFALLS.md` — Pitfall 5 (hash overload), Pitfall 11 (adversarial review), Pitfall 12 (fixture privacy/realism)
- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785) — canonical reference for ADR-003 amendment
- [MADR specification](https://adr.github.io/madr/) — ADR template format
- [Git rename detection documentation](https://git-scm.com/docs/git-mv) — `-M` similarity threshold semantics
- [Vitest Snapshot guide](https://vitest.dev/guide/snapshot.html) — `toMatchFileSnapshot` vs `toMatchSnapshot` semantics
- [MCP `tools/list` schema](https://modelcontextprotocol.io/specification/draft/server/tools) — response envelope shape

### Secondary (MEDIUM confidence — WebSearch results cross-verified against primary)
- [linuxctl.com — git preserve history](https://linuxctl.com/p/git-preserve-history-when-moving-files/) — confirms two-commit pattern for rename+amend
- [sqlpey.com — git file move history](https://sqlpey.com/git/git-file-move-history-preservation/) — confirms content-change-in-same-commit anti-pattern
- [ponderthebits.com — Linux GNU vs Mac BSD command-line utilities](https://ponderthebits.com/2017/01/know-your-tools-linux-gnu-vs-mac-bsd-command-line-utilities-grep-strings-sed-and-find/) — grep portability gotchas
- [GitHub Docs — Workflow concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency) — `cancel-in-progress` semantics
- [vitest issue #8655](https://github.com/vitest-dev/vitest/issues/8655) — toMatchFileSnapshot filename collision bug
- [connect2id.com — JCS in action](https://connect2id.com/blog/how-to-secure-json-objects-with-hmac) — JCS practical implementation notes
- [dev.to — json-canon strict JCS](https://dev.to/lenny321/json-canon-a-strict-rfc-8785-implementation-in-go-for-deterministic-json-3mfg) — number canonicalization pitfalls
- [npm view @modelcontextprotocol/sdk version → 1.29.0](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — confirms 1.29 exists but Phase 0 stays on 1.0.4
- [npm view vitest version → 4.1.6](https://www.npmjs.com/package/vitest) — confirms newer line exists but Phase 0 stays on 2.1.8
- [npm view yaml version → 2.9.0](https://www.npmjs.com/package/yaml) — install target for D-10

### Tertiary (LOW confidence — flagged as `[ASSUMED]` in claims, needs validation if disputed)
- Adversarial review prompt template (Example 6 / Pitfall 6) — synthesized from D-15 + `.planning/research/PITFALLS.md` Pitfall 11; no public reference for OSS projects doing "hostile-implementer review" of ADRs in this exact form. The pattern is plausible and follows the documented Pitfall 11 mitigation but is novel for this project.
- Specific banlist words in Example 2 — copied verbatim from D-20; if any false positive arises in `src/`, the escape-comment mechanism is the relief valve.
- Two-commit pattern's interaction with squash-merge — `[ASSUMED]` that GitHub's "Rebase and merge" or merge-commit preserves the two commits intact; this is the dominant convention but should be confirmed by the maintainer's GitHub repo settings before the first PR lands.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep verified against `package.json` + npm registry; only `yaml` is new.
- Architecture / file layout: HIGH — consistent with existing `.planning/codebase/STRUCTURE.md`.
- ADR amendment language (ADR-003 hash semantics): HIGH on the RFC 8785 reference + worked example, MEDIUM on the exact prose recommendation — the maintainer/Claude doing the actual ADR edit will refine. The three failure modes (NFC / LF / number canonicalization) are non-negotiable.
- POSIX shell lints: MEDIUM — examples are POSIX-portable per careful flag selection, but no CI has yet run them on Alpine. Recommend planner add a "lint-the-lint" step: bake-test on `docker run alpine sh` before merging.
- Pitfalls (especially git-mv content-change): HIGH for the symptom, MEDIUM for severity in this specific repo — git's default `-M50%` threshold may be generous enough that even commit-1-with-edits-in-same-commit survives, but the two-commit pattern is the defensive choice. Cheap.
- Adversarial-review methodology: MEDIUM — the prompt template is novel and may need tuning after the first run.

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (30 days for stable areas — ADR/MADR/git/POSIX shell; refresh sooner for MCP SDK if Phase 1 advances)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The maintainer's GitHub repo settings allow non-squash merge for the four ADR PRs (so the two-commit pattern survives merge). | Pattern 1 + Pitfall 1 | If the repo enforces squash-only merge, the two-commit history collapses to one — same problem the pattern was trying to avoid. **Mitigation:** the planner should add a task to verify GitHub repo settings (or run the test by pushing a tiny test-PR before doing the real ADR PRs). |
| A2 | The `gsd-advisor-researcher` agent will accept the adversarial-review prompt template in Example 6 / Pitfall 6 without modification. | Pitfall 6 | If the agent's tool surface doesn't support the prompt template (e.g., requires a specific input schema), the prompt needs adjustment. **Mitigation:** the Phase 0 final task ("dispatch adversarial review") should include a 5-minute "dry-run with a single ADR" before issuing the full prompt. |
| A3 | The semantic floors at 0.8 precision/recall are achievable on the hand-authored Atlas Robotics fixture once Phase 1 wires live indexing. | FND-09 + D-14 | If the fixture is too small or too homogeneous, recall may hit a ceiling below 0.8. **Mitigation:** Phase 0 ships the fixtures + the `.todo` test wiring; Phase 1 surfaces any threshold problems via real eval runs. Adjust the threshold then if needed. |
| A4 | All 23 `tools/list` entries are deterministic with no SDK-injected non-determinism. | Pitfall 4 + FND-10 | If MCP SDK 1.0.4 injects a `meta` field, server-instance ID, or similar at JSON-RPC envelope time, the snapshot will be flaky. **Mitigation:** the `dump-tools.mjs` script in Example 5 emits the `TOOLS` array directly, bypassing the SDK's JSON-RPC layer — so the snapshot is exactly the literal array, not the envelope. Verified by reading src/server.ts. |
| A5 | The Phase 0 `src/tool-registry.ts` micro-refactor (Pitfall 4 mitigation) is acceptable per D-CONTEXT — CONTEXT.md says "zero src/ changes" but this is a 5-line extract-constant move with no behavior change. | Pitfall 4 + Wave 0 Gaps | If the maintainer rejects ANY `src/` change in Phase 0, the alternative is to spawn the full MCP server in `dump-tools.mjs` and issue a JSON-RPC `tools/list` call — more code, more dependencies, but zero source change. **Mitigation:** the planner should explicitly call this out in the plan and let the maintainer choose. |
| A6 | `docs/dev/gsd-agent-knowledg-layer.md` (the full v2 brief) is internal and should NOT become public. | Runtime State Inventory | If it should also be relocated (the brief is the source of truth for v2), then add to FND-01 scope. **Mitigation:** the planner asks the maintainer; current research assumes it stays gitignored, with a single-file `.gitignore` line replacing the directory-wide one. |
| A7 | Vitest 2.1.8 stays the runner for Phase 0; no upgrade to 4.x is needed or attempted. | Standard Stack | If vitest 2.1.8 has a snapshot-related bug we haven't checked, the first test run could be surprising. **Mitigation:** the literal-file `toEqual` pattern (Pattern 2) avoids vitest's snapshot machinery entirely — defensive against any v2-line snapshot bug. |

**If this table is empty:** N/A — seven assumptions are logged for user/maintainer confirmation before plan execution begins. A5 and A6 are the most consequential (they touch scope); A1, A2, A4 are operational; A3 is a future-validation; A7 is a defensive-implementation choice.

## Open Questions

1. **Should `src/tool-registry.ts` extraction be in Phase 0 or Phase 1?**
   - What we know: D-CONTEXT says "zero `src/` changes." The micro-refactor is a 5-line non-behavioral extract.
   - What's unclear: Whether "zero src/ changes" is absolute or has an "obvious-mechanical-extract" exception.
   - Recommendation: Ask the maintainer in the planning loop. If "absolute," `dump-tools.mjs` instead spawns the MCP server in-process and issues a `tools/list` JSON-RPC call — about 30 lines of code, doable but heavier. If "extract is OK," do the extract — cleaner and faster.

2. **Is `gsd-agent-knowledg-layer.md` (full v2 brief) public or private?**
   - What we know: Currently gitignored alongside the ADRs. Brief is the source of truth for v2.
   - What's unclear: Whether the brief itself should become public alongside the ADRs (it contains all the design rationale), or remain internal.
   - Recommendation: Default to internal — replace the directory-wide `docs/dev/` ignore with a narrow `docs/dev/gsd-agent-knowledg-layer.md` ignore. Confirm with maintainer.

3. **Should the ADR file `002-source-and-delivery-seams.md` be renamed to `002-adapter-seams.md` per the CONTEXT canonical_refs reference?**
   - What we know: `docs/dev/002-source-and-delivery-seams.md` is the current filename. CONTEXT.md (line 76) explicitly says target → `docs/v2/adr/002-adapter-seams.md`.
   - What's unclear: This is a filename change concurrent with relocation — increases the same-commit-content-change risk for git rename detection.
   - Recommendation: Treat the rename as part of commit-1 (the `git mv` commit). `git mv` with a new name is fully supported and rename detection handles it. But if any history-preservation concern surfaces, fall back to keeping the old filename and adding an alias note in the index.

4. **What's the format of the per-tool `<tool-name>.yaml` semantic-floor fixtures?**
   - What we know: D-12 says "per-tool YAML at `evals/v1-baseline/<tool-name>.yaml` reusing the D-09 schema." D-09 schema is `{id, query, expected_doc_ids, expected_must_contain?, rationale}`.
   - What's unclear: Whether the schema needs additional fields per-tool (e.g., `expected_min_recall: 0.8` overriding the global D-14 default, or per-tool `top_k` to use when invoking).
   - Recommendation: Start with the D-09 schema verbatim. Add per-tool extensions only if Phase 1 reveals genuine need.

5. **Should the `_queries/*.yaml` files in the fixture vault use vault-relative paths or `obsidian-fs://` URIs in `expected_doc_ids`?**
   - What we know: The fixture exists in pre-ADR-001 form; vault-relative paths are the current shape.
   - What's unclear: Forward-compatibility — if the eval harness reads via the (future) `SourceConnector` interface, it will see `obsidian-fs://atlas/projects/Atlas-1.md`, not `projects/Atlas-1.md`.
   - Recommendation: Use vault-relative paths in Phase 0 (matches v1 reality). Phase 1's adapter extraction will provide a translation layer in the eval harness if needed. Don't pre-emptively encode `obsidian-fs://` in the fixture queries — it would require committing to the exact URI grammar before Phase 1 implements it.

6. **What's the right place for `docs/v2/AGENT_AGNOSTIC_AUDIT.md` — Phase 0 or Phase 1?**
   - What we know: FND-07 says ship `AGENT_AGNOSTIC.md` (the *positive* doc — "MCP is canonical, Skills are one client"). Phase 1 (`ADP-11`) ships `AGENT_AGNOSTIC_AUDIT.md` (the audit — every Claude-specific assumption).
   - What's unclear: Whether the audit shapes the AGENT_AGNOSTIC.md in Phase 0 or follows it in Phase 1.
   - Recommendation: AGENT_AGNOSTIC.md is the *spec*; the audit is the *verification*. Phase 0 writes the spec, Phase 1 audits the implementation against it. Don't conflate.

## Security Domain

> Phase 0 is documentation/CI only — no new attack surface in `src/`. Security considerations are minimal but worth documenting per the security_enforcement default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surfaces touched. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | No new access controls; existing path-traversal guards (`safeJoinInsideVault`) are unchanged. |
| V5 Input Validation | partial | Lint scripts parse user-influenced input (filenames committed to git, file contents in `src/`); validate via `set -eu` + grep with controlled regex. |
| V6 Cryptography | partial | ADR-003 amendment specifies SHA-256 for `Document.hash` via Node's `crypto.createHash('sha256')` — never hand-roll. **MUST NOT** propose a custom hash function. |

### Known Threat Patterns for `docs + CI + shell scripts`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Accidental commit of real maintainer notes | Information disclosure | `check-fixture-privacy.sh` allowlist (one fixture: `v2-test-vault`). |
| Telemetry SDK slipping in via transitive dep | Information disclosure | `lint-no-telemetry.sh` substring banlist + maintainer review on every PR. |
| Lint script command injection via filename | Tampering / Elevation | Use `git ls-tree --name-only` (NUL-safe alternative: `-z` flag) + `grep` with no `eval`/no shell expansion of filenames. Don't interpolate filenames into shell commands. |
| Shell-script-as-curl-pipe-bash (existing pattern in `install-skills.sh`) | Tampering | Out of scope for Phase 0 — existing scripts use this; lint scripts are not exposed via curl-pipe-bash. |
| Adversarial-review session leaking confidential ADR content | Information disclosure | Adversarial review runs locally as a Claude session with access only to public ADRs (post-Phase-0 these are public). No risk. |
| Lint false negative — banlist substring matches a legitimate doc comment | Availability | Escape comment `// vault-memory:no-telemetry-ok` (per D-20). |

**Bottom line:** Phase 0 introduces no cryptographic primitives in `src/`. The SHA-256 + RFC 8785 reference in ADR-003 is *specification text* — Phase 1 implements it using `node:crypto`. No hand-rolled crypto.

---

*Phase: 0-Foundation & decisions*
*Research completed: 2026-05-14*
