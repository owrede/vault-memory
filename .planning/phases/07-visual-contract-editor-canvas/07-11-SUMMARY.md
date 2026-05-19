---
phase: 07-visual-contract-editor-canvas
plan: 11
subsystem: distribution-skills
tags: [skills, distribution, github-releases, sha256, obsidian-plugin, can-09]
requires: ["07-05", "07-07", "07-08", "07-09", "07-10"]
provides:
  - "vm-install skill — sideload plugin from GitHub Releases tarball"
  - "vm-update skill — atomic upgrade against /releases/latest"
  - "SHA-256 verification before any extraction (T-07-11-01 mitigation)"
  - "Idempotent re-run contract for both skills"
affects:
  - "Plugin distribution channel for v2.0.0 — bypasses Obsidian community store"
tech-stack:
  added: []
  patterns:
    - "POSIX bash + set -euo pipefail; macOS shasum / Linux sha256sum portable detection"
    - "Atomic install: stage to .NEW, mv old → .OLD, mv .NEW → target, rm .OLD only on success"
    - "Pure-bash semver comparator (no python/jq dependency)"
key-files:
  created:
    - skills/vm-install/SKILL.md
    - skills/vm-install/setup.sh
    - skills/vm-install/setup.test.sh
    - skills/vm-update/SKILL.md
    - skills/vm-update/update.sh
    - skills/vm-update/update.test.sh
  modified: []
decisions:
  - "Placeholder GitHub Releases URL with explicit TODO comment per user direction — v2.0.0 release ships in Phase 8 prep"
  - "Skill format follows existing install-vault-memory sibling: YAML frontmatter (name + description) + markdown body with checkpoint table"
  - "vm-update reuses (re-declares, not sources) helpers from vm-install for simplicity at v2.0.0; future refactor to skills/_lib/ deferred"
  - "Plugin enable flag in ~/.vault-memory/config.toml is owned by vm-install; vm-update does NOT touch it"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-19"
  tasks_total: 3
  tasks_executed: 2
  tasks_deferred: 1
  test_assertions_passing: 21
---

# Phase 07 Plan 11: vm-install + vm-update Skills Summary

CAN-09 distribution-half closes: shipped two GSD-compatible skills (`vm-install`
+ `vm-update`) that sideload the vault-memory Obsidian plugin from GitHub
Releases tarballs, verify SHA-256 against `manifest.sha256`, install/upgrade
atomically into `<vault>/.obsidian/plugins/vault-memory/`, and surface a clear
manual-step prompt for enabling/reloading the plugin in Obsidian.

## What shipped

**`skills/vm-install/`** — sideload installer (3 files, 665 LOC across SKILL +
script + test):

- 7-checkpoint flow: discover vault → download tarball → verify SHA-256 →
  atomic extract → set `[plugin] enabled = true` → prompt user → log
- Vault discovery probes `~/Documents/*/.obsidian`, `~/Notes/.obsidian`,
  iCloud Obsidian path, `~/Obsidian/*/.obsidian`; overridable via
  `VAULT_PATH` env var
- Idempotency short-circuit: if installed `manifest.json.version` matches
  the release version, skip download + extract and only patch the config
  flag (which is itself idempotent — the awk block edits in place when the
  `[plugin]` block already exists)
- TOML patcher uses pure awk (no `tomlq` / external dependency); handles
  three cases: file missing → create; file exists with `[plugin]` block →
  patch `enabled` line in place; file exists without `[plugin]` block →
  append the block
- Atomic install: extract to `vault-memory.NEW/`, move existing
  `vault-memory/` aside to `vault-memory.OLD/`, mv `.NEW` → `vault-memory`,
  rm `.OLD` on success. Failure rolls back from `.OLD`.

**`skills/vm-update/`** — atomic updater (3 files, 682 LOC):

- 7-checkpoint flow: discover vault → read installed version → fetch latest
  tag (GitHub API or `VM_UPDATE_LATEST_VERSION` override) → semver compare
  → download + verify SHA-256 → atomic replace → prompt user to reload
- Pure-bash `compare_semver()` three-way comparator handles X.Y.Z, strips
  leading `v`, defaults missing segments to 0, strips pre-release suffixes
  per-segment
- Refuses to downgrade (installed > latest → exits 0 with notice, leaves
  prior install intact)
- Reuses the same atomic-replace semantics as vm-install; failure during
  extraction or swap restores the prior install from the `.OLD` aside

## Release artifact convention (publisher contract)

Both skills consume the same release shape from
`https://github.com/owrede/vault-memory/releases/v<version>/`:

| Asset | Purpose | Format |
|-------|---------|--------|
| `vault-memory-plugin-v<version>.tar.gz` | Plugin tarball | gzipped tar; contains `manifest.json` + `main.js` + `styles.css` + `versions.json` at the archive root |
| `manifest.sha256` | SHA-256 of the tarball | Single line of lowercase hex (with optional trailing whitespace; `awk '{print $1}'` strips it) |

Latest-version lookup uses the standard GitHub API endpoint
`/repos/owrede/vault-memory/releases/latest` (which excludes pre-releases by
default). Tag name format: `v<version>` (the leading `v` is stripped by
`compare_semver`).

## Idempotency contract details

`vm-install`:

- First run on a clean vault → full flow, exit 0
- Second run with same version installed → skips download/extract entirely;
  re-asserts `[plugin] enabled = true` is set; exits 0 silently
- Re-run after partial failure → `.NEW` / `.OLD` staging dirs cleaned at
  start of `install_atomic`, then fresh attempt

`vm-update`:

- Installed == latest → prints "Already up to date: vX.Y.Z", exits 0
- Installed > latest → prints "refusing to downgrade", exits 0 (leaves
  prior install intact)
- Installed < latest → download + verify + atomic swap → print reload prompt
- Re-run after upgrade → falls into the no-op path

## Tests

| Test | Assertions | Result |
|------|------------|--------|
| `skills/vm-install/setup.test.sh` | 9 | PASS — first-run install lays down all files + config; second run signals no-op via "Already installed" message |
| `skills/vm-update/update.test.sh` | 12 | PASS — no-op path; upgrade path (v2.0.0 → v2.1.0 via fixture tarball + file:// URL); re-run-after-upgrade no-op; no staging dirs left behind |

Both tests use `file://` URLs against fixture tarballs built at test setup,
so they run hermetically without network access. SHA-256 is computed against
the actual fixture content at test time, so the assertions exercise the
real verification path (not a mocked check).

## Security: T-07-11-01 mitigation (RESEARCH §Security Domain)

The "GitHub Releases tarball MITM" threat is mitigated by SHA-256
verification before extraction:

1. Both scripts download the tarball AND its `manifest.sha256` companion
   into a temp directory.
2. `sha256_of()` computes the actual digest (portable across macOS
   `shasum -a 256` and Linux `sha256sum`).
3. The actual digest is compared to the expected value parsed from the
   `.sha256` file.
4. Mismatch → exit code 3, abort BEFORE any extraction attempt. The user's
   plugin directory is never touched.

Caveat: this does not defend against a compromised GitHub Releases asset
where both the tarball AND the checksum file are replaced by an attacker.
That broader threat is out of scope for this plan; release signing (cosign
or GPG) would be the v2.1+ improvement, tracked as a follow-up.

## Deviations from Plan

### Task 3 (checkpoint:human-verify) — deferred, not executed

**Rule classification:** Plan execution deviation, surfaced for orchestrator
awareness (not Rule 1–4 — this is the orchestrator-level decision noted in
`<plan_specifics>`).

**Reason:** This executor was dispatched by the orchestrator with explicit
instruction that "the vault-memory plugin v2.0.0 has not been published to
GitHub Releases yet. The skills must use a placeholder release URL."
Task 3 requires a live dry-run against a real Obsidian vault using a real
GitHub release artifact, which does not exist. The checkpoint cannot be
satisfied until Phase 8 release prep ships the v2.0.0 tarball + checksum.

**What was done instead:** Both skill scripts were verified end-to-end
against fixture tarballs via `file://` URLs. The 21 combined test
assertions exercise the same code paths the live dry-run would (vault
discovery, SHA-256 verification, atomic extraction, idempotent re-run).
The placeholder URL is clearly marked with a `# TODO: replace placeholder
before publishing` comment in both `setup.sh` and `update.sh`, and the
"Release prerequisites" section of each `SKILL.md` documents the
publisher checklist.

**Resume path:** After Phase 8 release prep publishes v2.0.0 with the
required artifacts, run Task 3 manually against a clean test Obsidian
vault following the `<how-to-verify>` checklist in the plan. The skills
are ready for that dry run today; only the release artifacts are
missing.

## CAN-09 status

| Half | Status | Owner |
|------|--------|-------|
| Plugin chrome (Phases 7-04 → 7-10) | Complete | prior plans |
| Distribution skills (this plan) | Complete pending release artifacts | 07-11 |
| Live dry-run verification | Deferred to Phase 8 release prep | future |

## Known stubs

- `RELEASE_URL_PLACEHOLDER` constant in both `setup.sh` and `update.sh` —
  intentional, marked with TODO, documented in each SKILL.md's "Release
  prerequisites" section. Resolves when Phase 8 release prep ships v2.0.0
  to GitHub Releases.

## Threat Flags

None. The skills' threat surface is fully enumerated in the plan's
`<threat_model>` block (T-07-11-01 through T-07-11-04); no new surfaces
were introduced.

## Self-Check: PASSED

Files exist:

- skills/vm-install/SKILL.md — FOUND
- skills/vm-install/setup.sh — FOUND (executable)
- skills/vm-install/setup.test.sh — FOUND (executable)
- skills/vm-update/SKILL.md — FOUND
- skills/vm-update/update.sh — FOUND (executable)
- skills/vm-update/update.test.sh — FOUND (executable)

Commits exist:

- bd2c5b1 — feat(07-11): add vm-install skill — FOUND
- aba53bd — feat(07-11): add vm-update skill — FOUND

Tests:

- vm-install smoke test: 9/9 assertions PASS
- vm-update smoke test: 12/12 assertions PASS
