# Phase 8 — Deferred Items

Out-of-scope discoveries surfaced during plan execution but not fixed by the
discovering plan. Each row identifies the discovering plan and the
investigation/fix follow-up location.

## Resolved during Phase 8

### Pre-existing `lint-no-telemetry.sh` false positive on `Entry` ↔ `sentry`

- **Surfaced during:** plans 08-01, 08-02, 08-03 (each ran `npm run lint:check`).
- **Files affected:** `src/contracts/resources.ts` (lines 46, 57, 64, 112, 122, 147) and `src/contracts/index.ts` (lines 84, 87).
- **Root cause:** `scripts/lint-no-telemetry.sh` banlist contained `sentry` as a
  case-insensitive substring match. The Phase 6 type names
  `ListContractsEntry` and `ListContractVerbsEntry` contain the substring
  `sEntry` (within "Entry"), so all six TypeScript references tripped the
  banlist.
- **Pre-existing:** Yes — introduced by Phase 6 commit `9aaf325`
  (`feat(06-04): list_contracts + list_contract_verbs MCP Resources`).
- **Resolution:** Fixed on `main` in commit `2630804`
  (`chore(08): anchor telemetry banlist tokens with word boundaries`,
  2026-05-19) — orchestrator-side cleanup applied after Wave 1 agents
  surfaced the finding. The banlist now uses `\bsentry\b` (and the same
  for other whole-word tokens), leaving substring matchers like
  `segment.com`, `track(`, `report(` unanchored.

## Deferred past v2.0.0 (post-release follow-ups)

### Plugin walkthrough screencast MP4 + thumbnail PNG

- **Surfaced during:** plan 08-04, Tasks 1 + 2 (both `checkpoint:human-action`).
- **Initial disposition (08-04 → 08-08):** Plan 08-04 landed the docs-only
  Tasks 3 + 4 with the canonical Release URL pattern
  (`https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4`).
  The MP4 + thumbnail were originally scheduled for 08-08 as a manual asset
  upload to the v2.0.0 GitHub Release.
- **Final disposition (decided 2026-05-19, post-08-07 verification):**
  **DEFERRED PAST v2.0.0 entirely.** Plan 08-08 ships v2.0.0 without the
  screencast assets to tighten the critical path. The canonical Release URL
  in INSTALL.md and CONTRACT-EDITOR.md will be a dead link until the MP4
  is uploaded; the in-repo thumbnail PNG path will also be absent. Both
  are acceptable post-release gaps because:
  - The `vm-install` skill (Phase 7 → Plan 07-11) only depends on
    `vault-memory-plugin-v2.0.0.tar.gz` + `manifest.sha256` as Release
    assets, not on the MP4. Skill functionality is unaffected.
  - The README §What's new and §Architecture sections do not embed the
    screencast (plan 08-02 did not add it). Only the plugin INSTALL and
    CONTRACT-EDITOR docs link the eventual URL.
  - GitHub renders broken `[![alt](thumb.png)](url)` markdown gracefully
    (shows the alt text and a "play" badge) until the assets exist.
- **Carryover work (post-v2.0.0):**
  - Record `vault-memory-plugin-walkthrough.mp4` (≤8 min, 1080p, D-13 storyboard).
  - Produce `docs/v2/plugin/screencast-thumbnail.png` (≤600px width, <200 KB).
  - `gh release upload v2.0.0 vault-memory-plugin-walkthrough.mp4` (manual).
  - Commit thumbnail PNG to repo with `docs(plugin): add screencast thumbnail PNG`.
- **Cross-link gap:** README.md still says "deferred to Phase 8" in the
  screencast section if any was authored, and does not link the thumbnail
  or MP4. Plan 08-02 rewrote the README without adding a screencast block,
  so this is moot — the README has no broken screencast link. INSTALL.md
  and CONTRACT-EDITOR.md will have broken links until the assets land.

## Open (non-blocking)

### Ruleset hardening: add Block-force-pushes rule

- **Surfaced during:** plan 08-07 Task 1 (Repository Ruleset audit, 2026-05-19).
- **Ruleset affected:** `16599684` (`main - Branch Protection Ruleset`).
- **Gap:** The Ruleset enforces `lint-and-test` + PR-with-1-approval + strict
  status-check policy, but does not include a `non_fast_forward` rule (the
  Rulesets equivalent of Classic Branch Protection's
  `allow_force_pushes: false`). A direct `git push --force origin main` would
  still be blocked by the PR + status-check rules (no PR = no review = no merge
  path), but a defense-in-depth `Block force pushes` rule would make the
  protection independent of the merge-path reasoning.
- **Pre-existing:** No (Phase 8 deliverable). Logged as gap during this plan's
  Task 1 acceptance review.
- **Disposition:** Non-blocking for v2.0.0. Solo-maintainer repo, no other
  actors with write access. Add as a follow-up via the GitHub Settings UI
  (Settings → Rules → Rulesets → "main - Branch Protection Ruleset" → Add rule
  → "Block force pushes").

### I-2 adapter-seam violation in `src/plugin-tools/set-mcp-client.ts`

- **Surfaced during:** orchestrator-side `npm run lint:check` after the
  telemetry-banlist fix (2026-05-19).
- **File affected:** `src/plugin-tools/set-mcp-client.ts:33`
  (`import { readFile, writeFile } from "node:fs/promises"`).
- **Pre-existing:** Yes — Phase 7 carryover, not introduced in Phase 8.
- **Disposition:** Out of scope for Phase 8 (release engineering). Logged
  here for a future maintenance phase to route through the adapter-seam
  abstraction described in `docs/v2/adr/002-adapter-seams.md`. Does not
  block the v2.0.0 release.
