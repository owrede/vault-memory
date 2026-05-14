# Phase 0: Foundation & decisions - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Lock the public substrate that every later v2 phase builds on: relocate ADRs 001–004 from the gitignored `docs/dev/` to public `docs/v2/adr/` (amended with Invariants + Examples sections and the ADR-003/ADR-004 amendments the brief specifies), publish three architecture docs (`ARCHITECTURE.md`, `MEMORY_CONTRACT.md`, `AGENT_AGNOSTIC.md`), ship the eval fixture vault and v1-baseline regression suite, pin `tools/list` JSON for all 23 v1 tools, add two CI lints (fixture-privacy, no-telemetry), and clear an adversarial-review gate confirming a Phase-10 agent could implement Notion from the ADRs alone. **Zero `src/` code changes** — this phase is docs, evals, and CI scaffolding only.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-14): "Find the most elegant solution that offers a robust system that is easy to install and maintain." Decisions below optimize for that. Maintainer retains veto in PR review on any of these.

### ADR relocation strategy
- **D-01:** Relocate via `git mv docs/dev/00X-*.md docs/v2/adr/00X-*.md` to preserve history. Same PR removes `docs/dev/` from `.gitignore`. No fresh copy — git history is the most valuable diagnostic when an ADR is later questioned.
- **D-02:** Amend in the **same PR** as the relocation. One PR per ADR (four PRs total), each containing (a) the `git mv`, (b) the Invariants + Examples sections, (c) the relevant amendment for ADR-003 and ADR-004. Rationale: ADR amendments and relocation are read together; splitting them invites stale-link drift in the index.
- **D-03:** `Invariants` section format on every ADR — bullet list of normative MUST/MUST-NOT statements grep-able by Phase 9's adversarial review. Example invariant for ADR-001: "MUST NOT use raw filesystem paths as primary keys outside `src/adapters/source/obsidian-fs/`."
- **D-04:** `Examples` section on every ADR — at minimum one `obsidian-fs://` example AND one `notion-api://` example. Forces source-neutrality into the ADR text from day 0; Phase 9's adversarial reviewer can grep for both schemes.
- **D-05:** ADR-003 hash-semantics amendment — explicit pseudocode block: `hash = sha256(canonical(blocks_as_plain_text) || canonical(PropertyBag))` with `canonical()` defined as Unicode NFC + LF line endings + JSON Canonical Form for PropertyBag. Chunk-level `source_hashes: string[]` schema documented inline with an example.
- **D-06:** ADR-004 amendment — folder-default `MemorySink` is the only code path; the separate-vault option is **config-only** (`[memory] sink = "@other-vault"` in `config.toml`). No code branch. Document the sentinel file (`.memory-sink`) and the `obsidian-fs://_memory/` handle syntax with both folder-default and separate-vault config examples.

### Eval fixture narrative
- **D-07:** Use **"Atlas Robotics"** (the brief's suggested narrative) — a small fictional robotics startup. Decided to accept the brief's suggestion to avoid bikeshedding; coherent narrative matters more than the specific theme. ~75 notes target (mid-point of 50–100), organized as: `projects/`, `meetings/`, `people/`, `decisions/`, `references/`. Includes a `_memory/` subset of ~20 documents to seed Phase 2 eval requirements (FND-08 + Phase 2 success criterion #5).
- **D-08:** Notes are **hand-authored by the maintainer**, not LLM-drafted. Rationale: eval fixtures must be *legible* enough that a human can debug why a query failed; LLM-drafted fixtures tend to be hallucination-friendly. Maximum ~10 minutes per note is acceptable; total ≈12 hours of authoring is the eval substrate for the entire v2 line.
- **D-09:** Hand-labeled queries live in **`evals/fixtures/v2-test-vault/_queries/<tool-category>.yaml`** — one YAML file per upcoming tool category (e.g., `search.yaml`, `bundle.yaml`, `dossier.yaml`, `brief.yaml`, `graph.yaml`, `memory.yaml`, `contract.yaml`). Schema per entry: `{ id, query, expected_doc_ids: string[], expected_must_contain?: string[], rationale }`. ≥3 queries per file before declaring FND-08 complete.
- **D-10:** Queries are stored as YAML (not JSON) for human-edit friendliness; loaded by the eval harness via `yaml` (already a planned Phase 6 dependency — pulled forward acceptably).

### v1-baseline regression suite
- **D-11:** **Tool-snapshot pinning (exact JSON equality)** for `tools/list` output (FND-10) — single golden file at `evals/v1-baseline/tools-list.snapshot.json`. Drift fails CI. Rationale: the v1 tool surface is contractual; we want a loud breakage signal before SDK 1.29 lands in Phase 1.
- **D-12:** **Semantic floors (precision/recall + must-contain)** for behavioral checks of v1 search/graph/frontmatter tools (FND-09). Per-tool YAML at `evals/v1-baseline/<tool-name>.yaml` reusing the D-09 schema. Rationale: search outputs include scores, IDs, and ranking that legitimately fluctuate across embedding model versions; exact equality would fail spuriously on Ollama updates. Tool-snapshot tests catch surface drift; semantic floors catch behavior drift.
- **D-13:** Suite-runner is a `vitest` test file (`evals/v1-baseline/baseline.test.ts`) that iterates over the YAML fixtures. Same test runner as `src/**/*.test.ts` — single command (`npm test`) runs everything; CI doesn't need a new step.
- **D-14:** Per-tool precision/recall floor: **0.8** for both. Matches Phase 3 success criterion #1 (dossier eval threshold). Same number across all behavioral evals to reduce cognitive overhead.

### Adversarial review format
- **D-15:** Adversarial review is performed by a **separate Claude session with `gsd-advisor-researcher` agent** acting as a hostile Phase-10 implementer. Inputs: only `docs/v2/adr/001-*.md` through `004-*.md`, `docs/v2/ARCHITECTURE.md`, `docs/v2/MEMORY_CONTRACT.md`, `docs/v2/AGENT_AGNOSTIC.md`. Output: `docs/v2/adr/ADVERSARIAL-REVIEW.md` listing every ambiguity, missing example, or unspecified edge case it would need to invent to ship a Notion connector. Each finding becomes a blocker that either (a) gets amended into the ADR, or (b) gets a "deferred to Phase 10" note in the index — never silently ignored.
- **D-16:** Adversarial review is **not** a real spike (no Notion-skeleton code). Rationale: writing a skeletal adapter forces decisions the ADRs intentionally defer to v3 (auth, rate limits, watch); the gate is "are the ADRs unambiguous on what they DO cover", not "is v3 already designed". Avoids premature v3 commitment.
- **D-17:** Maintainer **sign-off (FND-14) is a single PR approval** on the final Phase 0 PR which carries: the ADVERSARIAL-REVIEW.md, all amendments addressing it, and a top-level `docs/v2/SIGN-OFF.md` listing the FND-01..14 checklist with each item checked and the resolving commit SHA. No separate signed-commit ceremony; PR approval + the SIGN-OFF.md file is the audit trail.

### CI lint scripts (Claude's discretion below — flagging here for visibility)
- **D-18:** Both lints (`scripts/check-fixture-privacy.sh`, `scripts/lint-no-telemetry.sh`) are **POSIX shell** (matches existing `scripts/download-reranker.sh` and `scripts/install-skills.sh`). Rationale: zero dependencies, runs in any CI environment, easy to read. TypeScript would require `tsx` and an extra build step for one-shot scripts.
- **D-19:** `check-fixture-privacy.sh` — fails if **any path matching `evals/fixtures/*/` outside `v2-test-vault/`** is committed (i.e., explicit allowlist of one fixture). Detects accidental commit of a real user vault. Single grep + path check.
- **D-20:** `lint-no-telemetry.sh` — fails if `src/**/*.ts` contains literal substrings from a curated banlist: `analytics`, `telemetry`, `posthog`, `segment.com`, `mixpanel`, `sentry`, `datadog`, `track(`, `trackEvent`, `report(`, `reportMetric` (case-insensitive). Plus a positive-allow comment escape (`// vault-memory:no-telemetry-ok`) for the inevitable false positive. Rationale: trust-but-verify rather than tokenizing AST.
- **D-21:** Both lints **block merge** via a new `.github/workflows/ci.yml` workflow on PR + push-to-main (separate from `publish.yml` which only fires on tags). Workflow runs: `npm ci`, `npm run lint:check` (which `package.json` wires to both shell scripts + `tsc --noEmit` + `prettier --check`), then `npm test`.

### ADR index & open-question parking
- **D-22:** `docs/v2/adr/README.md` is a **MADR-style index table** with columns: `#`, `Title`, `Status`, `Phase`, `Supersedes`, `Tags`. Status enum: `Accepted`, `Proposed`, `Open`, `Superseded`, `Deferred-v3`. The 14 open ADRs (005–01x) for v3 are listed as `Status: Open, Phase: v3-Phase-10` with one-line stub descriptions — a single visible parking lot, no separate doc. Rationale: one entry point for everyone (maintainer, future agents, adversarial reviewer); separation invites drift.
- **D-23:** Each ADR file gets a top-level `Tags:` frontmatter field (e.g., `Tags: identity, source-agnostic, hash, memory`) so the README table can be regenerated mechanically by a tiny script (FND-13 helper). Stretch — only ship the manual table if the regenerator script slips schedule.

### Claude's Discretion
- **Doc tone and length** — `ARCHITECTURE.md`, `MEMORY_CONTRACT.md`, `AGENT_AGNOSTIC.md` follow the existing `docs/dev/gsd-agent-knowledg-layer.md` tone: technical, dense, no marketing copy. Each ≤ 800 lines. Will be drafted in Phase 0 plan.
- **Whether to add a Phase 0 CHANGELOG entry** — yes, under `[Unreleased]` → `### Documentation`. v2 brief's first user-visible artifact even though no `src/` change.
- **Whether to bump version** — no. v2.0.0 ships at Phase 8. Phase 0 stays `[Unreleased]`.
- **Fixture-privacy lint enforcement on `main` history** — no retroactive scan of committed history; only checks the current tree on each PR/push. Yes, this means a historical leak could survive — acceptable trade-off; the repo is currently clean per the project structure.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project foundation (already in repo)
- `.planning/PROJECT.md` — full v2 mission, constraints (ESM-only, Node ≥22, MCP SDK ≥1.29, eval discipline, branch hygiene), 10-phase roadmap rationale, key decisions table
- `.planning/REQUIREMENTS.md` §"v1 Requirements" lines 1–145 — full v1 retrieval/write/frontmatter/graph contract (114 items) the v1-baseline suite must pin
- `.planning/REQUIREMENTS.md` lines 13–25 — FND-01 through FND-14, the precise deliverable list for this phase
- `.planning/REQUIREMENTS.md` §"Out of Scope" lines 172–193 — non-negotiable exclusions (no cloud sync, no telemetry, no remote LLM bundling, no path-as-PK after Phase 1)
- `.planning/ROADMAP.md` lines 28–39 — Phase 0 goal + 5 success criteria (the WHAT this phase must achieve)
- `.planning/STATE.md` — current position, blockers (ADRs gitignored, Phase 2/5/7 ADR pre-conditions)

### Existing ADRs (to be relocated + amended)
- `docs/dev/001-document-identity.md` — opaque URI-style identity (`<scheme>://<authority>/<resource>`); target → `docs/v2/adr/001-document-identity.md`
- `docs/dev/002-source-and-delivery-seams.md` — `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` interfaces; target → `docs/v2/adr/002-adapter-seams.md`
- `docs/dev/003-document-shape.md` — `Document` canonical type, `PropertyBag`, hash semantics (TO BE AMENDED — see D-05); target → `docs/v2/adr/003-document-shape.md`
- `docs/dev/004-memory-sink-handles.md` — `MemorySink` handle parser, sentinel file (TO BE AMENDED — see D-06); target → `docs/v2/adr/004-memory-sink-handles.md`
- `docs/dev/gsd-agent-knowledg-layer.md` — full v2 brief; primary source of truth for Phase 1–9 design

### Codebase context (to be pinned by FND-09/FND-10)
- `src/server.ts` — 23 v1 tool registrations + Zod schemas; the `tools/list` snapshot will be derived from this surface
- `.planning/codebase/STACK.md` + `STRUCTURE.md` + `CONVENTIONS.md` — current architecture, conventions, file layout (informs `docs/v2/ARCHITECTURE.md` style)
- `.planning/codebase/CONCERNS.md` — known seam-leak hotspots (raw `fs.*`, chokidar imports outside adapter modules, `obsidian://` URL construction in `src/server.ts`, hardcoded `.obsidian/**`, Claude-specific strings) — informs the FND-04 invariants and Phase 1's CI greps which extend from Phase 0's lint foundation
- `.planning/codebase/TESTING.md` — current vitest layout (co-located `*.test.ts`) — informs where `evals/v1-baseline/baseline.test.ts` lives

### Research already done
- `.planning/research/PITFALLS.md` — known v2 pitfalls; especially relevant for ADR-amendment language (hash determinism, sink rejection semantics)
- `.planning/research/ARCHITECTURE.md` — research-derived architecture; double-check `docs/v2/ARCHITECTURE.md` doesn't drift from this
- `.planning/research/SUMMARY.md` — synthesis the roadmap was derived from

### External patterns to mirror
- MADR (Markdown Any Decision Record) — informal reference for the ADR index table format (D-22); no link required — pattern is standard
- JSON Canonical Form (RFC 8785) — referenced in ADR-003 hash amendment (D-05)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`vitest` test runner** — already present; `evals/v1-baseline/baseline.test.ts` and `evals/fixtures/` tests plug in with zero new dependencies (per D-13).
- **`scripts/download-reranker.sh` + `scripts/install-skills.sh`** — establish POSIX shell convention for utility scripts (per D-18); new lint scripts follow the same shebang/style.
- **`src/server.ts` tool registrations** — single source for FND-10 tool-snapshot generation. Snapshot is dumped by a one-shot Node script at `evals/v1-baseline/dump-tools.mjs` invoked by the snapshot test.
- **`gsd-advisor-researcher` agent** — already available; used for the adversarial review per D-15.
- **Existing `.gitignore` line for `docs/dev/`** — surgical removal is the relocation enabler (D-01).

### Established Patterns
- **`kebab-case` filenames** — applied to new ADR files (`002-adapter-seams.md` not `002_AdapterSeams.md`) and lint scripts.
- **ESM + `.js` extension on relative imports** — applies to `evals/v1-baseline/dump-tools.mjs`.
- **TOML for config, YAML for fixtures** — config stays TOML; fixture queries land in YAML (D-09, D-10). Don't mix.
- **Co-located `*.test.ts`** — broken intentionally for evals (lives under `evals/` not `src/`) because eval data is fixture-coupled; documented in the Phase 0 plan.
- **Type-checking is the linter** — no ESLint. Add `npm run lint:check` script that calls both shell lints + `tsc --noEmit` + `prettier --check` (per D-21).

### Integration Points
- **`.github/workflows/`** — currently only `publish.yml` (tag-triggered). Phase 0 adds **`ci.yml`** (PR + push-to-main triggered) running the new lints + tests. This is the gate for every later phase.
- **`package.json` scripts** — add `lint:check`, `eval:baseline`, `eval:snapshot`; weave into existing `test` so `npm test` is still the one-shot.
- **`.gitignore`** — remove `docs/dev/` line; consider whether `docs/optimization-todos/` stays gitignored (yes — those are maintainer-private roadmap notes per the existing comment).
- **`CHANGELOG.md`** — append `[Unreleased] → ### Documentation` entry naming the v2 doc set.

</code_context>

<specifics>
## Specific Ideas

- Atlas Robotics fixture: maintainer-authored, ~75 notes, 5 top-level folders, includes `_memory/` with ~20 documents for Phase 2 priming.
- "Invariants + Examples" pattern on every ADR: bullet MUST/MUST-NOT list + at least one `obsidian-fs://` and one `notion-api://` worked example. Adversarial reviewer in Phase 9 must be able to grep both schemes in every ADR.
- ADVERSARIAL-REVIEW.md is a real artifact, not a checkbox — every finding is either amended into ADRs or filed as a v3 deferral with explicit rationale.
- SIGN-OFF.md is FND-14's only artifact — a checklist linked from the final PR. No separate ceremony.

</specifics>

<deferred>
## Deferred Ideas

- **ADR index regenerator script** (D-23 stretch) — defer to a maintenance pass if time-boxed Phase 0 slips. Manual table is acceptable shipping state.
- **Retroactive history scan** for fixture-privacy lint — acceptable trade-off; repo audited at Phase 0 commit time.
- **Per-PR comment automation** linking to which FND-* a PR satisfies — nice-to-have, no requirement covers it.
- **Eval-harness LLM-judge layer** — explicitly out of v2; semantic floors (precision/recall on labeled IDs) are sufficient for v2.0.0. Reserve LLM-as-judge for v3.
- **Multi-platform CI matrix** (macOS + Linux + Windows) — Phase 0 ships Linux-only on `ci.yml`. Cross-platform validation reserved for Phase 8 release-gate work.

</deferred>

---

*Phase: 0-Foundation & decisions*
*Context gathered: 2026-05-14*
