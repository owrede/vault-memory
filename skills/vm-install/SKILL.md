---
name: vm-install
description: One-call installer for the vault-memory Obsidian plugin from GitHub Releases. Bypasses the Obsidian community plugin store for v2.0.0. Downloads the plugin tarball, verifies SHA-256 against the release's `manifest.sha256`, extracts atomically into `<vault>/.obsidian/plugins/vault-memory/`, sets `[plugin] enabled = true` in `~/.vault-memory/config.toml`, and prompts the user to enable in Obsidian Settings → Community Plugins. Idempotent — re-running with the same version is a no-op. Use when the user says "/vm-install", "install vault-memory plugin", "set up the plugin", "Plugin installieren", "VM plugin einrichten".
---

# /vm-install — Sideload the vault-memory Obsidian plugin

The single entry point for installing the vault-memory Obsidian plugin without
going through the Obsidian community plugin store. Downloads the latest
v2.0.0+ release tarball from GitHub Releases, verifies it, and lands it in
the user's vault.

## When to invoke

- User runs `/vm-install` (primary trigger)
- User says "install vault-memory plugin", "set up the plugin", "Plugin installieren", "VM plugin einrichten"
- The vault-memory plugin is not visible under `<vault>/.obsidian/plugins/vault-memory/`
- A fresh install on a machine where only the MCP server (CLI) is configured

## Release prerequisites

**IMPORTANT:** This skill installs from a hard-coded GitHub Releases URL. Before
v2.0.0 ships, the release artifacts referenced by this skill DO NOT exist —
they will be published during Phase 8 release prep.

Required release assets (publisher checklist):

| Asset | Purpose |
|-------|---------|
| `vault-memory-plugin-<version>.tar.gz` | Plugin tarball (contains `manifest.json`, `main.js`, `styles.css`, `versions.json` at archive root) |
| `manifest.sha256` | Single-line SHA-256 hex digest of the tarball |

The release URL is set via the `RELEASE_URL_PLACEHOLDER` constant near the
top of `setup.sh`. The constant is marked with a `# TODO: replace placeholder
before publishing` comment. Until the v2.0.0 release is published, invoking
this skill will fail at the download checkpoint — point the script at a local
fixture tarball via the `VM_INSTALL_RELEASE_URL` environment variable for
testing.

## What this skill does

The skill walks through 7 idempotent checkpoints. Each silently passes when
already met, or applies a fix once.

| # | Checkpoint | Action on miss |
|---|------------|----------------|
| 1 | Discover Obsidian vault | Probe `~/Documents/*/.obsidian`, `~/Notes/.obsidian`, iCloud Obsidian paths; honor `VAULT_PATH` env var override. If multiple vaults found, list + ask. |
| 2 | Download tarball | `curl --fail --location` from `RELEASE_URL_PLACEHOLDER` (or `VM_INSTALL_RELEASE_URL` override) into a temp dir. |
| 3 | Verify SHA-256 | Compute `shasum -a 256` of the tarball and compare against the `manifest.sha256` shipped in the same release. Mismatch → abort before extraction. |
| 4 | Extract atomically | Extract tarball into `<vault>/.obsidian/plugins/vault-memory.NEW/`, mv any existing dir aside to `vault-memory.OLD/`, mv `.NEW` → `vault-memory`, rm `.OLD` only on success. |
| 5 | Set plugin config flag | Add or update `[plugin]\nenabled = true` in `~/.vault-memory/config.toml`. Create the file if missing. |
| 6 | Prompt user | Print explicit copy: "Open Obsidian → Settings → Community Plugins → Installed plugins → toggle 'vault-memory' on." |
| 7 | Done | Print success summary, log run to `~/.vault-memory/skills/vm-install.log`. |

## Autonomous mode (default)

The skill runs autonomously when:

- Exactly one Obsidian vault is detected (no ambiguity)
- `~/.vault-memory/config.toml` does not already disable the plugin

When multiple vaults are found OR `VAULT_PATH` is unset and detection is
ambiguous, the skill lists candidates and asks once.

Set `VM_INSTALL_AUTO=0` to switch to fully-interactive mode.

## How to execute

```bash
bash skills/vm-install/setup.sh
```

Optional environment variables:

- `VAULT_PATH` — explicit vault root (must contain `.obsidian/`)
- `VM_INSTALL_RELEASE_URL` — override the hard-coded release tarball URL (useful for testing with a local `file://` fixture)
- `VM_INSTALL_SHA256_URL` — override the `manifest.sha256` URL paired with the tarball
- `VM_INSTALL_AUTO` — set to `0` to disable autonomous mode

## Implementation files

- `setup.sh` — the 7-checkpoint installer (POSIX bash, `set -euo pipefail`)
- `setup.test.sh` — smoke test using a local fixture tarball; asserts idempotent re-run

## Idempotency contract

Re-running this skill must:

- **First run on a fresh vault:** download, verify, extract, set the config
  flag, prompt the user, exit 0.
- **Second run with the same version installed:** detect that the installed
  `manifest.json.version` matches the release version, skip extraction, leave
  the config file untouched if already correct, exit 0.
- **Never** delete user data outside `.obsidian/plugins/vault-memory/`,
  never overwrite a user-owned config block without preserving sibling keys.

## Failure modes & recovery

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `curl: (22) HTTP 404` | Release tarball not yet published (placeholder URL) | Wait for v2.0.0 to ship; set `VM_INSTALL_RELEASE_URL` to a local fixture for testing |
| `SHA-256 mismatch` | Tarball corruption or tampering | Abort. Re-download. If repeated, file a security report. |
| `no Obsidian vault found` | Vault not in default locations | Set `VAULT_PATH=/path/to/your/vault` |
| Plugin not visible in Obsidian Settings | Obsidian was already running and has cached the plugin list | Restart Obsidian; the plugin appears under Community Plugins. |
| `vault-memory` CLI not available | User installed plugin without server | Skill works standalone; the `[plugin] enabled` flag is read by the MCP server when present, ignored otherwise. |

## Limits

- macOS + Linux (relies on `shasum` or `sha256sum`).
- Does not install the MCP server / CLI — that is the `install-vault-memory`
  skill's job. The two are independent: the plugin works against any running
  vault-memory server.
- Does not toggle the plugin on in Obsidian's `community-plugins.json` —
  Obsidian writes that file itself once the user clicks the toggle in
  Settings. We document the manual step explicitly.
