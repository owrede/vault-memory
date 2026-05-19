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

## Carried forward to plan 08-08

### Plugin walkthrough screencast MP4 + thumbnail PNG

- **Surfaced during:** plan 08-04, Tasks 1 + 2 (both `checkpoint:human-action`).
- **Disposition:** Deferred to plan 08-08 (v2.0.0 cut), which owns the
  GitHub Release asset upload anyway. Plan 08-04 landed the docs-only
  Tasks 3 + 4 with the canonical Release URL pattern
  (`https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4`).
- **Carryover work for 08-08:**
  - Record `vault-memory-plugin-walkthrough.mp4` (≤8 min, 1080p, D-13 storyboard).
  - Produce `docs/v2/plugin/screencast-thumbnail.png` (≤600px width, <200 KB).
  - Upload MP4 as a Release asset; commit PNG to repo.
- **Cross-link gap (also for 08-08):** README.md still says "deferred to Phase 8"
  in the screencast section and does not yet link the thumbnail or MP4 URL —
  plan 08-02 rewrote the README without adding the screencast block. Plan 08-08
  should land the screencast block in README.md alongside the MP4 upload.

## Open (non-blocking)

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
