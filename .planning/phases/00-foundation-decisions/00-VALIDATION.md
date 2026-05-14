---
phase: 0
slug: foundation-decisions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `00-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.8 (existing devDep) |
| **Config file** | none — vitest defaults from `package.json` |
| **Quick run command** | `npx vitest run evals/v1-baseline/baseline.test.ts` |
| **Full suite command** | `npm run lint:check && npm test` |
| **Estimated runtime** | ~15 s quick · ~45 s full (no Ollama / ONNX warmup on baseline-only path) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run evals/v1-baseline/baseline.test.ts` (baseline-only — fast, deterministic, no Ollama)
- **After every plan wave:** Run `npm run lint:check && npm test` (full lint + full vitest)
- **Before `/gsd-verify-work`:** Full suite must be green AND `docs/v2/SIGN-OFF.md` checklist all `[x]`
- **Max feedback latency:** 15 seconds (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 00-01-01 | 01 | 1 | FND-01 | — | ADRs publicly committed under `docs/v2/adr/` | filesystem | `test -f docs/v2/adr/001-document-identity.md && test -f docs/v2/adr/002-adapter-seams.md && test -f docs/v2/adr/003-document-shape.md && test -f docs/v2/adr/004-memory-sink-handles.md` | ❌ W0 | ⬜ pending |
| 00-01-02 | 01 | 1 | FND-01 | — | `docs/dev/` removed from `.gitignore` (no re-leak) | grep | `! grep -q '^docs/dev/' .gitignore || grep -q '^# docs/dev/' .gitignore` | ❌ W0 | ⬜ pending |
| 00-02-01 | 02 | 2 | FND-02 | — | ADR-003 carries hash-semantics pseudocode + `source_hashes` schema | doc grep | `grep -q 'sha256.*canonical.*PropertyBag' docs/v2/adr/003-document-shape.md && grep -q 'source_hashes' docs/v2/adr/003-document-shape.md && grep -q 'RFC 8785' docs/v2/adr/003-document-shape.md` | ❌ W0 | ⬜ pending |
| 00-02-02 | 02 | 2 | FND-02 | — | NFC / LF / number-canonicalization failure modes explicitly named | doc grep | `grep -qi 'NFC' docs/v2/adr/003-document-shape.md && grep -qi 'LF\|line ending' docs/v2/adr/003-document-shape.md && grep -qi 'number.*canonical\|IEEE 754' docs/v2/adr/003-document-shape.md` | ❌ W0 | ⬜ pending |
| 00-03-01 | 03 | 2 | FND-03 | — | ADR-004 specifies folder-default sink only code path | doc grep | `grep -qi 'folder-default' docs/v2/adr/004-memory-sink-handles.md && grep -qi 'no code branch' docs/v2/adr/004-memory-sink-handles.md` | ❌ W0 | ⬜ pending |
| 00-03-02 | 03 | 2 | FND-03 | — | Separate-vault option is config-only with example | doc grep | `grep -q 'config.toml' docs/v2/adr/004-memory-sink-handles.md && grep -q '\[memory\]' docs/v2/adr/004-memory-sink-handles.md && grep -q 'sink *= *"@' docs/v2/adr/004-memory-sink-handles.md` | ❌ W0 | ⬜ pending |
| 00-04-01 | 04 | 1 | FND-04 | — | Every ADR carries `## Invariants` section | doc grep | `for f in docs/v2/adr/00{1,2,3,4}-*.md; do grep -q '^## Invariants' "$f" || exit 1; done` | ❌ W0 | ⬜ pending |
| 00-04-02 | 04 | 1 | FND-04 | — | Every ADR carries `## Examples` with both `obsidian-fs://` and `notion-api://` worked examples | doc grep | `for f in docs/v2/adr/00{1,2,3,4}-*.md; do grep -q '^## Examples' "$f" && grep -q 'obsidian-fs://' "$f" && grep -q 'notion-api://' "$f" || exit 1; done` | ❌ W0 | ⬜ pending |
| 00-05-01 | 05 | 3 | FND-05 | — | `docs/v2/ARCHITECTURE.md` exists with layer model + ≤800 lines | filesystem + grep + wc | `test -f docs/v2/ARCHITECTURE.md && grep -qE 'L0\|L1\|L2\|L3\|L4' docs/v2/ARCHITECTURE.md && [ $(wc -l < docs/v2/ARCHITECTURE.md) -le 800 ]` | ❌ W0 | ⬜ pending |
| 00-06-01 | 06 | 3 | FND-06 | — | `docs/v2/MEMORY_CONTRACT.md` exists with PropertyBag contract | filesystem + grep | `test -f docs/v2/MEMORY_CONTRACT.md && grep -qE 'confidence\|evidence\|status\|provenance' docs/v2/MEMORY_CONTRACT.md` | ❌ W0 | ⬜ pending |
| 00-07-01 | 07 | 3 | FND-07 | — | `docs/v2/AGENT_AGNOSTIC.md` exists; no Claude-only strings | filesystem + negative grep | `test -f docs/v2/AGENT_AGNOSTIC.md && ! grep -qE 'Claude-only\|claude-specific' docs/v2/AGENT_AGNOSTIC.md` | ❌ W0 | ⬜ pending |
| 00-08-01 | 08 | 2 | FND-08 | — | Fixture vault has 50–100 markdown notes | filesystem count | `[ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_queries/*' | wc -l) -ge 50 ] && [ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_queries/*' | wc -l) -le 110 ]` | ❌ W0 | ⬜ pending |
| 00-08-02 | 08 | 2 | FND-08 | — | `_memory/` subset has ≥15 notes | filesystem count | `[ $(find evals/fixtures/v2-test-vault/_memory -name '*.md' | wc -l) -ge 15 ]` | ❌ W0 | ⬜ pending |
| 00-08-03 | 08 | 2 | FND-08 | — | ≥3 hand-labeled queries per `_queries/*.yaml` | yaml parse | `for f in evals/fixtures/v2-test-vault/_queries/*.yaml; do [ $(grep -c '^- id:' "$f") -ge 3 ] || exit 1; done` | ❌ W0 | ⬜ pending |
| 00-09-01 | 09 | 3 | FND-09 | — | v1-baseline semantic-floor YAMLs exist for behavioral tools | filesystem | `for tool in search search_text search_hybrid frontmatter_query graph_neighbors graph_path; do test -f "evals/v1-baseline/${tool}.yaml" || exit 1; done` | ❌ W0 | ⬜ pending |
| 00-09-02 | 09 | 3 | FND-09 | — | Baseline test runner discovers and parses all fixtures (Phase 0: `.todo` for floor execution; full wiring in Phase 1) | vitest | `npx vitest run evals/v1-baseline/baseline.test.ts -t 'baseline fixtures parse'` | ❌ W0 | ⬜ pending |
| 00-10-01 | 10 | 3 | FND-10 | — | `dump-tools.mjs` produces 23 deterministic tool entries | node | `node evals/v1-baseline/dump-tools.mjs | node -e 'process.stdin.on("data",d=>{const t=JSON.parse(d);if(!Array.isArray(t)||t.length!==23)process.exit(1)})'` | ❌ W0 | ⬜ pending |
| 00-10-02 | 10 | 3 | FND-10 | — | Snapshot equality test passes against `tools-list.snapshot.json` | vitest | `npx vitest run evals/v1-baseline/baseline.test.ts -t 'tools/list matches pinned snapshot'` | ❌ W0 | ⬜ pending |
| 00-11-01 | 11 | 4 | FND-11 | — | `check-fixture-privacy.sh` exists, is executable, passes on clean tree | shell smoke | `test -x scripts/check-fixture-privacy.sh && sh scripts/check-fixture-privacy.sh` | ❌ W0 | ⬜ pending |
| 00-11-02 | 11 | 4 | FND-11 | — | Lint fails when a forbidden path is staged (red-test) | shell smoke | `git stash; mkdir -p evals/fixtures/sneaky-vault && touch evals/fixtures/sneaky-vault/dummy.md; git add evals/fixtures/sneaky-vault/dummy.md; ! sh scripts/check-fixture-privacy.sh; git reset HEAD evals/fixtures/sneaky-vault/dummy.md; rm -rf evals/fixtures/sneaky-vault; git stash pop || true` | ❌ W0 | ⬜ pending |
| 00-12-01 | 12 | 4 | FND-12 | — | `lint-no-telemetry.sh` exists, is executable, passes on clean tree | shell smoke | `test -x scripts/lint-no-telemetry.sh && sh scripts/lint-no-telemetry.sh` | ❌ W0 | ⬜ pending |
| 00-12-02 | 12 | 4 | FND-12 | — | Lint fails on banlist substring (red-test) | shell smoke | manual — see Manual-Only Verifications table | ❌ W0 | ⬜ pending |
| 00-12-03 | 12 | 4 | FND-12 | — | Escape comment `// vault-memory:no-telemetry-ok` actually suppresses match | shell smoke | manual — see Manual-Only Verifications table | ❌ W0 | ⬜ pending |
| 00-13-01 | 13 | 5 | FND-13 | — | ADR index `docs/v2/adr/README.md` has rows for 001..004 with `Accepted` status | doc grep | `for n in 001 002 003 004; do grep -qE "^\| ${n} \|" docs/v2/adr/README.md || exit 1; done && grep -q 'Accepted' docs/v2/adr/README.md` | ❌ W0 | ⬜ pending |
| 00-13-02 | 13 | 5 | FND-13 | — | Index lists ≥14 open ADRs with `Status: Open` and `Phase: v3-Phase-10` | doc grep | `[ $(grep -c 'Status: Open' docs/v2/adr/README.md) -ge 14 ] && grep -q 'v3-Phase-10' docs/v2/adr/README.md` | ❌ W0 | ⬜ pending |
| 00-14-01 | 14 | 5 | FND-14 | — | `docs/v2/SIGN-OFF.md` exists with FND-01..FND-14 checklist all `[x]` | doc grep | `test -f docs/v2/SIGN-OFF.md && [ $(grep -cE '^- \[x\] FND-' docs/v2/SIGN-OFF.md) -eq 14 ]` | ❌ W0 | ⬜ pending |
| 00-14-02 | 14 | 5 | FND-14 | — | Each FND-* line carries a resolving commit SHA (7+ hex chars) | doc grep | `[ $(grep -cE '^- \[x\] FND-[0-9]+:.*[0-9a-f]{7,}' docs/v2/SIGN-OFF.md) -eq 14 ]` | ❌ W0 | ⬜ pending |
| 00-15-01 | 15 | 4 | FND-21 (D-21) | — | `.github/workflows/ci.yml` exists with PR + push-to-main triggers | yaml grep | `test -f .github/workflows/ci.yml && grep -qE 'pull_request:|push:' .github/workflows/ci.yml && grep -q 'lint:check' .github/workflows/ci.yml` | ❌ W0 | ⬜ pending |
| 00-16-01 | 16 | 4 | FND-21 (D-21) | — | `npm run lint:check` runs both shell lints + tsc + prettier | npm script grep | `node -e 'const p=require("./package.json");if(!/check-fixture-privacy/.test(p.scripts["lint:check"])||!/lint-no-telemetry/.test(p.scripts["lint:check"])||!/tsc/.test(p.scripts["lint:check"])||!/prettier/.test(p.scripts["lint:check"]))process.exit(1)'` | ❌ W0 | ⬜ pending |
| 00-17-01 | 17 | 6 | FND-04 | — | `docs/v2/adr/ADVERSARIAL-REVIEW.md` exists and lists ≥1 finding per ADR | doc grep | `test -f docs/v2/adr/ADVERSARIAL-REVIEW.md && [ $(grep -cE '^### Finding' docs/v2/adr/ADVERSARIAL-REVIEW.md) -ge 4 ]` | ❌ W0 | ⬜ pending |
| 00-17-02 | 17 | 6 | FND-04 | — | Every finding resolved as `Amended` or `Deferred-v3` (no silent ignores) | doc grep | `! grep -qE '^### Finding' docs/v2/adr/ADVERSARIAL-REVIEW.md || [ $(grep -cE '^Status: (Amended|Deferred-v3)' docs/v2/adr/ADVERSARIAL-REVIEW.md) -ge $(grep -cE '^### Finding' docs/v2/adr/ADVERSARIAL-REVIEW.md) ]` | ❌ W0 | ⬜ pending |
| 00-18-01 | 18 | 5 | D-23 (stretch) | — | (If shipped) ADR-index regenerator script produces same table as hand-edited | shell diff | `[ ! -x scripts/regen-adr-index.sh ] || diff <(sh scripts/regen-adr-index.sh) docs/v2/adr/README.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 = files/scripts that must exist before sampling commands return non-zero in a useful way.

- [ ] `evals/v1-baseline/baseline.test.ts` — vitest runner; covers FND-09 (parse + `.todo` for semantic floors) and FND-10 (snapshot equality)
- [ ] `evals/v1-baseline/dump-tools.mjs` — snapshot generator (imports tool registry; FND-10)
- [ ] `evals/v1-baseline/tools-list.snapshot.json` — the pinned artifact (FND-10); regenerated via `npm run eval:snapshot -- --update`
- [ ] `evals/v1-baseline/{search,search_text,search_hybrid,frontmatter_query,graph_neighbors,graph_path,...}.yaml` × 6–11 behavioral tools — semantic-floor fixtures (FND-09)
- [ ] `evals/fixtures/v2-test-vault/_queries/{search,bundle,dossier,brief,graph,memory,contract}.yaml` × 7 — hand-labeled queries (FND-08)
- [ ] `evals/fixtures/v2-test-vault/` directory: ~75 hand-authored notes across `projects/`, `meetings/`, `people/`, `decisions/`, `references/` + `_memory/` subset of ~20 notes (FND-08)
- [ ] `scripts/check-fixture-privacy.sh` (FND-11) + `tests/scripts/check-fixture-privacy.red.sh` for red-test
- [ ] `scripts/lint-no-telemetry.sh` (FND-12) + `tests/scripts/lint-no-telemetry.red.sh` for red-test (includes escape-comment check)
- [ ] `.github/workflows/ci.yml` (D-21) — runs `npm ci`, `npm run lint:check`, `npm test` on PR + push-to-main; `cancel-in-progress: true` concurrency group
- [ ] `src/tool-registry.ts` — extract `TOOLS = [...]` from `src/server.ts` lines 326–720 so `dump-tools.mjs` can import without spinning the full MCP server. **Documented exception to CONTEXT.md "zero src/ changes"** — pre-approved scope (Assumption A5 in RESEARCH.md, needs maintainer sign-off in PR review)
- [ ] `npm install --save yaml@^2.9.0` — pulled forward from Phase 6 per D-10 (parses YAML fixture queries)
- [ ] `package.json` script additions: `lint:check`, `eval:baseline`, `eval:snapshot` — weave `lint:check` and `eval:baseline` into existing `test` so `npm test` stays the one-shot
- [ ] `docs/v2/adr/ADVERSARIAL-REVIEW.md` — produced by `gsd-advisor-researcher` agent in a separate session; format per D-15

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `lint-no-telemetry.sh` red-test (banlist substring trips) | FND-12 / 00-12-02 | Mutating `src/**/*.ts` with a banlisted word in a scripted test would either pollute the tree or require complex `git stash` orchestration. Done as a one-shot during plan-task 12 with maintainer eyes on. | (1) In a scratch branch, append `// analytics()` to `src/server.ts`; (2) run `sh scripts/lint-no-telemetry.sh`; (3) confirm non-zero exit + clear error message; (4) `git checkout src/server.ts`. |
| Escape comment suppresses match | FND-12 / 00-12-03 | Same as above. | (1) Append `const x = "analytics"; // vault-memory:no-telemetry-ok` to a scratch file in `src/`; (2) run `sh scripts/lint-no-telemetry.sh`; (3) confirm zero exit; (4) revert. |
| Alpine bake-test for both shell lints | FND-11, FND-12 (POSIX portability) | macOS BSD grep vs Linux GNU grep silent-fail risk per RESEARCH.md Pitfall 6. Done once in Phase 0 before merge; not re-run per commit. | `docker run --rm -v "$PWD":/repo -w /repo alpine sh -c 'apk add --no-cache grep findutils && sh scripts/check-fixture-privacy.sh && sh scripts/lint-no-telemetry.sh'` — confirm exit 0 on clean tree. |
| Two-commit pattern preserves `git log --follow` history through ADR amendment | D-01 / FND-01 | Verifying the rename detection requires running `git log --follow docs/v2/adr/00X-*.md` after the relocation+amend PR lands. Cannot be scripted as a pre-merge test. | After each ADR PR merges: `git log --follow --oneline docs/v2/adr/00X-*.md` — confirm history extends back through `docs/dev/00X-*.md`. If broken, the squash-merge assumption (A1) is wrong and policy must change before Phase 1. |
| Maintainer PR sign-off (FND-14 audit trail) | FND-14 | Human act of code review. | Final Phase 0 PR ships `docs/v2/SIGN-OFF.md` + ADVERSARIAL-REVIEW.md + all amendments. Maintainer's PR approval is the audit record. No bot can fake this. |
| Adversarial-review session runs in fresh context | FND-04 / D-15 | The reviewer must NOT have seen Phase 0 planning context — that's the whole point of "hostile implementer" testing. Run by maintainer in a new Claude session with the prompt template from RESEARCH.md Example 6. | Open new Claude session → spawn `gsd-advisor-researcher` with only `docs/v2/adr/00{1,2,3,4}-*.md` + `docs/v2/ARCHITECTURE.md` + `docs/v2/MEMORY_CONTRACT.md` + `docs/v2/AGENT_AGNOSTIC.md` as inputs → save output as `docs/v2/adr/ADVERSARIAL-REVIEW.md`. |
| Maintainer confirms Assumptions A1, A5, A6 from RESEARCH.md | (planning) | A1 (squash-merge policy), A5 (`src/tool-registry.ts` 5-line extraction), A6 (whether `docs/dev/gsd-agent-knowledg-layer.md` goes public). Each blocks at least one Phase 0 task. | Resolve in plan-discussion or first-PR review before relocation lands. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or are listed in Manual-Only table with explicit instructions
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (longest manual streak is 1 — adversarial review + sign-off run interleaved with automated index/SIGN-OFF.md checks)
- [ ] Wave 0 covers all ❌ W0 references — 11 scripts/files/dirs enumerated above
- [ ] No watch-mode flags — `npx vitest run` is one-shot; lints are one-shot shell
- [ ] Feedback latency < 15s for quick run (`vitest run evals/v1-baseline/baseline.test.ts` ≈ 5–10 s; no Ollama, no ONNX warmup)
- [ ] Alpine bake-test passes (manual; once per phase)
- [ ] `nyquist_compliant: true` set in frontmatter (after maintainer approval)

**Approval:** pending
