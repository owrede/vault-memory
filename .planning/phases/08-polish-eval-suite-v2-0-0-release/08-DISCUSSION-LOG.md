# Phase 8: Polish, eval suite, v2.0.0 release - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 08-polish-eval-suite-v2-0-0-release
**Areas discussed:** Gray-area selection routing, Tool surface target (REL-08), Migration scope (REL-05), README shape (REL-03/04), Screencast + Release assets (Phase 7 carryovers), Eval gate (REL-01), Release ritual (REL-06/07), Sign-off (REL-09), CHANGELOG curation (REL-02)

---

## Gray-area selection routing (meta)

| Option | Description | Selected |
|--------|-------------|----------|
| REL-08 target | ≤32 vs ≤40 tool budget | |
| Eval scope + CI gating | Three components + merge-block vs report-only | |
| README + MIGRATION audience | Lib consumers vs end-users | |
| Carryovers (screencast + assets) | Storyboard tightness + asset set | |
| All four (recommendations) | User accepted "Other: I go with your recommendations!" | ✓ |

**User's choice:** "I go with your recommendations!" — user delegated all four gray areas to Claude's recommendation.
**Notes:** Claude proceeded by recommending one option per gray area with rationale tied to ROADMAP success criteria, prior decisions in Phase 6/7, and project constraints (no telemetry, no marketing language, solo maintainer, MIT). All four recommendations were then confirmed individually.

---

## Tool surface target (REL-08) → D-01..D-04

| Option | Description | Selected |
|--------|-------------|----------|
| ≤32 via Resources promotion | Promote 5+ list-style tools to MCP Resources. Hits the harder success criterion. ~1 small plan. Snapshot updated. Aligns with Phase 6 Pitfall F7 deferral. | ✓ |
| ≤40 ceiling, no promotions | Keep v1 baseline surface byte-stable at 37 default tools. Faster to ship; looser criterion still met. | |

**User's choice:** ≤32 via Resources promotion (Recommended).
**Notes:** Phase 6 sign-off explicitly noted "REL-08 retirement deferred to Phase 8 per Pitfall F7". Choosing the harder ceiling now is consistent with that deferral. Promotion candidates include `list_vaults`, `list_models`, `list_aliases`, `recent_notes`, `vault_stats`, plus audit-log list-style endpoints (planner finalizes the closed set). Plugin-gated tools (6 added in Phase 7, default OFF) are NOT counted against REL-08 per existing snapshot-test gating.

---

## Migration scope (REL-05) → D-12

| Option | Description | Selected |
|--------|-------------|----------|
| Library consumers + short end-user appendix | ~3 pages. Main body: SDK 1.29 + Zod 4 bump notes. Appendix: one paragraph per phase pointing at user-visible surface. | ✓ |
| Library consumers only | ~1 page. Bump notes only; runtime surface in README + per-phase docs. | |
| Full end-user upgrade guide | ~5 pages. Per-tool migration notes, new config blocks, new file formats. Risk of duplicating per-phase docs. | |

**User's choice:** Library consumers + short end-user appendix (Recommended).
**Notes:** Matches the original REL-05 intent ("notes SDK and Zod major bumps for downstream library users; tool API delta (no breaking changes, additive only)") while adding a discovery breadcrumb for end-users running `npm update -g`. Appendix links to per-phase sign-offs rather than duplicating.

---

## README shape (REL-03, REL-04, REL-09) → D-11

| Option | Description | Selected |
|--------|-------------|----------|
| Practical-first | Install + first instantiate → pitch → architecture → roadmap with Phase 9/v3. Tone tight, technical. | ✓ |
| Pitch-first | "Agentic knowledge layer" thesis → install → example. More marketing-feel. | |

**User's choice:** Practical-first (Recommended).
**Notes:** The README aesthetic dev tools devs actually read. Tone constraint reinforced: no marketing superlatives ("blazingly fast", "magnificent") per CLAUDE.md / RULES.md `Professional Honesty`. Six-section structure documented in D-11.

---

## Screencast + Release assets (Phase 7 carryovers) → D-13..D-15

| Option | Description | Selected |
|--------|-------------|----------|
| Strict storyboard + minimum assets | Storyboard: install → open contract → edit verb → save → instantiate → brief. 5–7 min target, ≤8 cap. QuickTime. Release assets: tarball + sha256 + walkthrough.mp4. | ✓ |
| Storyboard + extended assets | Same screencast + standalone eval-fixture tarball + prebuilt CLI binary + docs bundle. Higher maintenance per release. | |

**User's choice:** Strict storyboard + minimum assets (Recommended).
**Notes:** Each extra Release asset adds maintenance cost per release with no clear consumer. CLI binary is the npm package; eval fixtures are in the repo; docs ship in the npm package. GitHub Release host avoids YouTube dependency. Thumbnail PNG provides the click-through preview in README + INSTALL.md + CONTRACT-EDITOR.md.

---

## Eval suite as merge gate (REL-01) → D-05..D-07

| Option | Description | Selected |
|--------|-------------|----------|
| Required-for-merge, no override | GitHub branch protection requires lint-and-test job. No bypass token. | ✓ |
| Required-for-merge with documented override | Same gate + `[skip eval]` token or label for emergencies. Risk: override gets used routinely. | |

**User's choice:** Required-for-merge, no override (Recommended).
**Notes:** Solo maintainer retains force-push capability for genuine emergencies, but introducing a sanctioned override defeats the gate culturally. Aligns with CLAUDE.md / RULES.md `Failure Investigation: Never Skip Tests` principle. Phase 8 lands the GitHub branch protection ruleset + CONTRIBUTING.md eval-gate documentation. CI matrix locked to Linux-only for v2.0.0 (D-07); multi-OS deferred.

---

## Release ritual (REL-06, REL-07) → D-17

| Option | Description | Selected |
|--------|-------------|----------|
| `npm run release` script | Single Node script: version bump + CHANGELOG rename + tag + push. publish.yml takes over from tag. Documented in CONTRIBUTING.md. | ✓ |
| Documented manual checklist | CONTRIBUTING.md lists each step (npm version, sed CHANGELOG, git tag, git push). No script. | |

**User's choice:** `npm run release` script (Recommended).
**Notes:** Removes friction without hiding what's happening (script is single-screen Node, auditable). The script hands off to the existing `.github/workflows/publish.yml` which already handles npm publish + GitHub Release auto-creation with CHANGELOG-section body. Script lands at `scripts/release.mjs` per project convention (matches Node 22 / ESM runtime, easier to test than bash).

---

## Sign-off (REL-09) → D-18

| Option | Description | Selected |
|--------|-------------|----------|
| PHASE-8-SIGN-OFF.md artifact | Mirrors Phase 4 / 6 / 7. One file, ~1 page, checklist + evidence links + maintainer signature. | ✓ |
| GitHub Release notes as sign-off | Use the v2.0.0 GitHub Release body (auto-generated from CHANGELOG) as the sign-off record. | |

**User's choice:** PHASE-8-SIGN-OFF.md artifact (Recommended).
**Notes:** Consistency with established pattern. Sign-off is the LAST commit before the tag — included in the source tree under the v2.0.0 tag. Maintainer signs by reviewing the diff and pushing the tag.

---

## CHANGELOG curation (REL-02) → D-08..D-10

| Option | Description | Selected |
|--------|-------------|----------|
| Audit + backfill all missing phase entries | Phase 8 first task reads each phase's sign-off and writes a CHANGELOG entry for any user-visible change missing from [Unreleased]. Then curate. | ✓ |
| Curate only what's already in [Unreleased] | Ship v2.0.0 with whatever Phase 4 + Phase 6 contributors added; trust per-phase docs for the rest. | |

**User's choice:** Audit + backfill all missing phase entries (Recommended).
**Notes:** Current `[Unreleased]` has Phase 4 + Phase 6 only. Phase 2 (memory), Phase 3 (assembly), Phase 5 (briefs), Phase 7 (plugin) appear to be missing. Highest-fidelity changelog; users see what actually shipped. Audit-task is research-then-write per area (CONTEXT.md `<specifics>` notes).

---

## Claude's Discretion

The following implementation details are left to the planner + researcher, grounded in CONTEXT.md decisions:

- Exact Resources-promotion closed set (5+ tools, the URI templates, deprecation-notice text in tool descriptions)
- CHANGELOG entry voice for backfilled phases (terse, technical, no superlatives — planner drafts, maintainer edits at sign-off)
- Branch protection implementation form (declarative `.github/branch-protection.yml` if mature, UI configuration if not)
- `scripts/release.mjs` exact prompts, validations, and refusal conditions
- README architecture diagram rendering (ASCII recommended for portability)
- MIGRATION end-user appendix breadth (one paragraph per phase recommended)
- Screencast intro/outro card design + thumbnail PNG composition
- Release script error-handling depth (lean thorough — releases are rare, mistakes are expensive)
- CONTRIBUTING.md scope (Phase 8 adds 2 sections; full overhaul out of scope)
- Manifest sha256 tool choice (`shasum -a 256` vs `openssl dgst -sha256`)
- Phase 7 plugin CHANGELOG entry depth (one bullet per CAN-*/PLG-* group, not per task)
- `RELEASE_URL_PLACEHOLDER` resolution mechanism — templated from `package.json.version` at install-script run time (preferred, zero per-release commits) vs sed-replace at release time

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. Highlights:

- Multi-OS CI matrix (Linux only in v2.0.0)
- VTT caption file for screencast (baked-in title cards only in v2.0.0)
- Eval-suite override token (rejected; the gate is the gate)
- Standalone eval-fixture tarball / prebuilt CLI binary as Release assets (minimum set in v2.0.0)
- YouTube / external video hosting (GitHub Release only)
- Launch promotion plan (maintainer's choice; out of Phase 8 scope)
- `vault-memory migrate-v1-to-v2` CLI command (no data migration needed)
- Architecture diagram in SVG (ASCII in v2.0.0)
- Release script telemetry (permanently out per project constraint)
- Auto-PR-comment with eval results (status checks suffice)
- `vm-uninstall` skill (deferred to v2.x)
- Multi-version README sidebar (single-branch README in v2.0.0)
