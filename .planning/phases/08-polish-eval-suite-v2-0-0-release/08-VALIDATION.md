---
phase: 8
slug: polish-eval-suite-v2-0-0-release
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 8 is a release phase: validation means proving the release artifacts are correct and the merge gate is enforced.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.8 |
| **Config file** | none — defaults; co-located `*.test.ts` files |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm run lint:check && npm test && npm run eval:baseline && npm run build && node scripts/smoketest-non-claude.mjs` |
| **Estimated runtime** | ~30–60s (quick) · ~3–5min (full) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (~30–60s)
- **After every plan wave:** Run `npm run lint:check && npm test && npm run eval:baseline` (matches CI's first 3 steps)
- **Before `/gsd:verify-work` (phase gate / pre-tag):** Full suite must be green
- **Max feedback latency:** 60 seconds (per-task quick run)

---

## Per-Task Verification Map

> Per-task IDs will be filled in once PLAN.md files are generated. The table below is the per-requirement map; the planner must wire each task's `<acceptance_criteria>` to one of these commands or flag it manual.

| Req ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|--------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| REL-01 | TBD | 2+ | Eval suite required for merge | — | CI branch protection blocks merge on red eval | smoke + manual | `gh api repos/owrede/vault-memory/branches/main/protection \| jq '.required_status_checks.contexts'` returns array including `"lint-and-test"` | ❌ W0 (branch protection setup) | ⬜ pending |
| REL-02 | TBD | 1 | CHANGELOG `[Unreleased]` covers Phases 5 + 7 user-visible changes | — | N/A | manual review + grep | `grep -E "^### " CHANGELOG.md` shows entries citing Phase 5 (briefs) and Phase 7 (plugin) | ❌ manual sign-off | ⬜ pending |
| REL-03 | TBD | 1 | README rewritten — agentic-knowledge-layer pitch, 6-section structure | — | N/A | manual review | maintainer reads README cold + checks all 6 sections present | ❌ manual | ⬜ pending |
| REL-04 | TBD | 1 | README Roadmap names Phase 9 + v3 explicitly | — | N/A | grep | `grep -q "Phase 9" README.md && grep -q "v3" README.md` | automatable | ⬜ pending |
| REL-05 | TBD | 1 | `MIGRATION-V1-TO-V2.md` covers SDK 1.29 + Zod 4 + type-import changes | — | N/A | grep | `grep -q "1.29" docs/v2/MIGRATION-V1-TO-V2.md && grep -q "Zod 4" docs/v2/MIGRATION-V1-TO-V2.md` | ❌ W0 (file missing) | ⬜ pending |
| REL-06 | TBD | 3 | v2.0.0 tag exists + GitHub Release auto-created | — | N/A | manual + workflow | `git tag -l v2.0.0` returns tag; `gh release view v2.0.0` returns Release | n/a — post-release | ⬜ pending |
| REL-07 | TBD | 3 | npm publish succeeded | — | npm provenance attestation present | manual + workflow | `npm view @owrede/vault-memory@2.0.0 version` returns `2.0.0` | n/a — post-publish | ⬜ pending |
| REL-08 | TBD | 2 | Default tool surface ≤32 (with MCP Resources promotion of 5 list-style tools) | — | Tools-list snapshot is the contract | snapshot test | `npm run eval:baseline` passes against updated `tools-list.snapshot.json` (32 entries); extended assertion in `scripts/smoketest-non-claude.mjs` for resources-list | ❌ W0 (snapshots regen + resources-list snapshot) | ⬜ pending |
| REL-09 | TBD | 3 | Maintainer signed off | — | N/A | manual | maintainer line at bottom of `docs/v2/PHASE-8-SIGN-OFF.md` | ❌ manual (D-18) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/release.mjs` — does not exist; create with version-bump + CHANGELOG-rename + commit + tag + push (covers REL-06)
- [ ] `CONTRIBUTING.md` — does not exist; create with "Cut a release" + "Eval suite is a merge gate" sections (supports REL-01, REL-06)
- [ ] `evals/v1-baseline/resources-list.snapshot.json` — does not exist; generate via new `scripts/dump-resources.mjs` or extend `scripts/dump-tools.mjs` (REL-08 snapshot)
- [ ] `docs/v2/MIGRATION-V1-TO-V2.md` — does not exist; create per D-12 (REL-05)
- [ ] `docs/v2/PHASE-8-SIGN-OFF.md` — does not exist; create per D-18 (template from `docs/v2/PHASE-6-SIGN-OFF.md`) (REL-09)
- [ ] `docs/v2/plugin/screencast-thumbnail.png` — does not exist; create per D-14 (carryover from Phase 7 CAN-09)
- [ ] Tarball-build step in `.github/workflows/publish.yml` — does not exist as a step; add before the `Create GitHub Release` step (Phase 7 carryover: tarball + manifest.sha256 release assets)
- [ ] Branch protection rule on `main` — must be configured via GitHub Settings → Branches (REL-01)
- [ ] Update `evals/v1-baseline/tools-list.snapshot.json` to 32-tool inventory (REL-08)
- [ ] Update `EXPECTED_TOOLS` array in `scripts/smoketest-non-claude.mjs` to match the 32-tool inventory (REL-08)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Branch protection enforces eval as required check on `main` | REL-01 | GitHub Settings UI; declarative API path exists but is not part of the repo's standard tooling | Set required status checks on `main` via Settings → Branches → main → "Require status checks to pass before merging" → tick `lint-and-test`. Verify with `gh api repos/owrede/vault-memory/branches/main/protection`. |
| CHANGELOG covers every user-visible Phase 5 + 7 change | REL-02 | Subjective — what counts as "user-visible" requires maintainer judgement | Read `docs/v2/PHASE-5-SIGN-OFF.md` and `docs/v2/PHASE-7-SIGN-OFF.md`; cross-check that every "Shipped" / "User-visible" bullet has a CHANGELOG entry under `### Added / ### Changed`. |
| README "reads well cold" | REL-03 | Editorial judgement | Maintainer reads README from top to bottom without prior context; flags any section that needs another revision. |
| MIGRATION guide is accurate for downstream library consumers | REL-05 | Requires comparing v1.x type signatures vs HEAD across the published surface | Run `git diff v1.x.x..HEAD -- src/types.ts src/server.ts package.json` and confirm every type-import change, SDK version bump, and tool delta is reflected in the MIGRATION guide. |
| npm publish succeeded with provenance attestation | REL-07 | The publish workflow runs once on the v2.0.0 tag; post-publish verification | After workflow green: `npm view @owrede/vault-memory@2.0.0 version` returns `2.0.0`; provenance link present on the npmjs.com page. |
| GitHub Release contains screencast MP4 + plugin tarball + manifest.sha256 | REL-06, Phase 7 carryover | Asset upload is a workflow step but verification is visual | `gh release view v2.0.0 --json assets \| jq '.assets[].name'` lists `vault-memory-plugin-walkthrough.mp4`, `vault-memory-plugin-v2.0.0.tar.gz`, `manifest.sha256`. |
| Maintainer sign-off | REL-09 | Human gate | Maintainer adds signature line at bottom of `docs/v2/PHASE-8-SIGN-OFF.md` and commits. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (quick) / < 5min (full)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
