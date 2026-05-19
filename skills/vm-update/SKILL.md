---
name: vm-update
description: Updates the installed vault-memory Obsidian plugin to the latest GitHub Release. Reads the installed `manifest.json.version`, queries GitHub Releases for the latest tag, and if newer downloads + verifies SHA-256 + replaces the plugin directory atomically. No-op when already on the latest version. Bypasses the Obsidian community plugin store. Use when the user says "/vm-update", "update vault-memory plugin", "upgrade vault-memory", "Plugin aktualisieren".
---

# /vm-update — Upgrade the vault-memory Obsidian plugin

Out-of-band updater for installations that were sideloaded via `vm-install`.
Checks GitHub Releases for a version newer than what is on disk; if a newer
release is published, downloads + verifies it and swaps it into place
atomically.

## When to invoke

- User runs `/vm-update` (primary trigger)
- User says "update vault-memory plugin", "upgrade vault-memory", "Plugin aktualisieren"
- After a new vault-memory v2.x release lands and the user wants to pick it up

## Release prerequisites

**IMPORTANT:** This skill queries a hard-coded GitHub Releases endpoint. Before
v2.0.0 (and any subsequent release) is published, the API returns 404 — the
release artifacts referenced by this skill DO NOT exist yet. They will be
published during Phase 8 release prep.

Required release artifacts (publisher checklist, same as `vm-install`):

| Asset | Purpose |
|-------|---------|
| `vault-memory-plugin-<version>.tar.gz` | Plugin tarball with `manifest.json`, `main.js`, `styles.css`, `versions.json` at the archive root |
| `manifest.sha256` | Single-line SHA-256 hex digest of the tarball |

The release URL template is set via the `RELEASE_URL_PLACEHOLDER` constant
near the top of `update.sh`. The constant is marked with a `# TODO: replace
placeholder before publishing` comment. The latest release lookup uses
`https://api.github.com/repos/owrede/vault-memory/releases/latest`; override
the tarball + checksum URLs at test time via `VM_UPDATE_RELEASE_URL` and
`VM_UPDATE_SHA256_URL`, and override the release-version lookup itself via
`VM_UPDATE_LATEST_VERSION`.

## When to invoke

- User runs `/vm-update` (primary trigger)
- User says "update vault-memory plugin", "upgrade vault-memory", "Plugin aktualisieren"
- After a new vault-memory v2.x release lands

## What this skill does

7 idempotent checkpoints mirroring `vm-install`, scoped to the update path.

| # | Checkpoint | Action |
|---|------------|--------|
| 1 | Discover Obsidian vault | Same logic as `vm-install`. Honors `VAULT_PATH`. |
| 2 | Read installed `manifest.json.version` | Parse `<vault>/.obsidian/plugins/vault-memory/manifest.json`. If missing, abort with "Plugin not installed — run /vm-install first." |
| 3 | Fetch latest release tag from GitHub API | `curl https://api.github.com/repos/owrede/vault-memory/releases/latest`. Falls back to `VM_UPDATE_LATEST_VERSION` env var for testing / offline. |
| 4 | Compare versions (semver) | If installed >= latest → exit 0 with "Already up to date". |
| 5 | Download + verify SHA-256 | Same atomic flow as `vm-install` (download → checksum → mismatch aborts before extraction). |
| 6 | Atomic replace | Extract into `.NEW`, swap in via `mv`, delete `.OLD`. Failure leaves the prior install intact. |
| 7 | Prompt user to reload | Print: "Reload Obsidian (Cmd+R / Ctrl+R) or disable+enable the plugin in Settings → Community Plugins to pick up the upgrade." |

## Autonomous mode (default)

Runs autonomously when:

- Exactly one Obsidian vault is detected with the plugin installed
- A clean version delta exists (installed < latest)

Multiple vaults or ambiguous detection triggers a prompt.

Set `VM_UPDATE_AUTO=0` for fully-interactive mode.

## How to execute

```bash
bash skills/vm-update/update.sh
```

Optional environment variables:

- `VAULT_PATH` — explicit vault root (must contain `.obsidian/plugins/vault-memory/`)
- `VM_UPDATE_LATEST_VERSION` — short-circuit the GitHub API lookup (e.g. `2.1.0`)
- `VM_UPDATE_RELEASE_URL` — override the release tarball URL (testing with `file://` fixture)
- `VM_UPDATE_SHA256_URL` — override the checksum file URL
- `VM_UPDATE_AUTO` — set to `0` to disable autonomous mode

## Implementation files

- `update.sh` — the 7-checkpoint updater (POSIX bash, `set -euo pipefail`)
- `update.test.sh` — smoke test covering no-op + upgrade paths with local fixtures

## Idempotency contract

- **Re-running with no version delta:** prints `Already up to date: vX.Y.Z` and exits 0.
- **Re-running mid-upgrade after failure:** the atomic swap leaves the prior version intact; a fresh run re-attempts cleanly.
- **Never** mutates `~/.vault-memory/config.toml` — the `[plugin] enabled` flag is owned by `vm-install`. If the plugin is somehow missing the config flag, this updater logs a warning but does not "fix" it; instruct the user to re-run `/vm-install`.

## Failure modes & recovery

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `Plugin not installed` | No `.obsidian/plugins/vault-memory/` directory found | Run `/vm-install` first. |
| `curl: (22) HTTP 404` on the latest-release API call | The repo has no published releases yet | Set `VM_UPDATE_LATEST_VERSION` to the desired test version, or wait for a real release. |
| `SHA-256 mismatch` | Tarball corruption or tampering | Abort. Old version stays in place. Re-download. If repeated, file a security report. |
| `Already up to date` printed on every run | Working as designed (idempotent no-op) | None. |
| Obsidian still shows the old plugin behavior after upgrade | Plugin not reloaded | Reload Obsidian, or toggle the plugin off+on in Settings → Community Plugins. |

## Limits

- macOS + Linux (relies on `shasum` or `sha256sum`, `curl`, `tar`).
- Does not downgrade. If the installed version is greater than the latest published release, the updater exits with a notice.
- Does not handle pre-release tags (only the GitHub `releases/latest` endpoint, which excludes pre-releases by default).
