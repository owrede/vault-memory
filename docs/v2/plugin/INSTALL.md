# Installing the vault-memory Obsidian plugin

> Phase 7 / v2.0.0 — vault-memory Obsidian plugin / Last verified: 2026-05-19

## Overview

The vault-memory plugin is the **L5 user surface** for the v2 agentic knowledge
layer (see [docs/v2/ARCHITECTURE.md](../ARCHITECTURE.md) and
[ADR-007](../adr/007-contract-editor.md)). It registers an Obsidian view for
`.contract` files (the visual task-contract editor) and adds plugin chrome —
settings, secrets, manual reindex, stats, peer-MCP connectors — so vault-memory
is operable from inside Obsidian without dropping to a terminal.

The plugin talks to a running `vault-memory serve` MCP server over local stdio.
You install the CLI **first**, then install the plugin on top.

> **Screencast:** [![Plugin walkthrough (5-7 min)](./screencast-thumbnail.png)](https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4)
>
> Click the thumbnail to watch the 5–7 minute install → first contract authored → first `instantiate_contract` walkthrough (MP4, attached as a GitHub Release asset at v2.0.0).

## Prerequisites

| Requirement | Version | How |
|---|---|---|
| Obsidian | ≥ 1.5.0 | https://obsidian.md |
| `vault-memory` CLI on `$PATH` | ≥ 2.0.0 | See the root [README](../../../README.md) install section |
| At least one vault registered with vault-memory | — | `vault-memory add-vault "/path/to/vault"` |
| Desktop OS | macOS / Windows / Linux | Manifest sets `isDesktopOnly: true` — Obsidian mobile is not supported |

The plugin spawns the server via `serverCommand` (default `vault-memory`) +
`serverArgs` (default `["serve"]`). If `vault-memory` is not on `$PATH`, the
plugin will fail to start the server. Resolve this first.

## Install via the `vm-install` skill (recommended)

`vm-install` is a GSD-compatible skill that bypasses the Obsidian community
plugin store. Invoke it from any MCP-skill-aware client (Claude Code, Claude
Desktop with skill loader, etc.):

```
/vm-install
```

The skill executes seven idempotent checkpoints:

1. Discover the target Obsidian vault.
2. Query the GitHub Releases API for the latest plugin tag.
3. Download `vault-memory-plugin-<version>.tar.gz` and its
   `.sha256` companion.
4. Verify the SHA-256 checksum against the companion file.
5. Extract the tarball into `<vault>/.obsidian/plugins/vault-memory/`.
6. Set `[plugin] enabled = true` in `~/.vault-memory/config.toml`.
7. Prompt the user to enable the plugin in Obsidian → Settings → Community
   Plugins.

Re-running `vm-install` with no version delta is a no-op. See
[skills/vm-install/SKILL.md](../../../skills/vm-install/SKILL.md) for the
verbatim checkpoint shape and idempotency contract.

## Manual sideload (fallback)

If you cannot run the skill — no MCP-skill-aware client, headless host, or you
want to install a pre-release build — sideload the plugin by hand.

### 1. Download the tarball

From the [GitHub Releases page](https://github.com/owrede/vault-memory/releases)
for the tag matching your `vault-memory` CLI version, download:

- `vault-memory-plugin-<version>.tar.gz`
- `vault-memory-plugin-<version>.tar.gz.sha256`

### 2. Verify the checksum

```bash
shasum -a 256 -c vault-memory-plugin-<version>.tar.gz.sha256
```

The command must print `OK`. If it does not, stop — the archive is corrupt or
tampered. Do not proceed.

### 3. Extract into the vault

```bash
VAULT=/path/to/your/obsidian/vault
mkdir -p "$VAULT/.obsidian/plugins/vault-memory"
tar -xzf vault-memory-plugin-<version>.tar.gz -C "$VAULT/.obsidian/plugins/vault-memory"
```

The resulting directory layout:

```
<vault>/.obsidian/plugins/vault-memory/
├── manifest.json
├── main.js
├── styles.css
└── versions.json
```

### 4. Enable in Obsidian

Open the vault in Obsidian → **Settings → Community Plugins** → toggle
**vault-memory** on. Obsidian loads `main.js` and registers the
`.contract` view.

### 5. Flip the server-side flag

In `~/.vault-memory/config.toml`, set:

```toml
[plugin]
enabled = true
```

This gates the plugin-control MCP tools (`set_runtime_config`,
`resolve_secret`, `set_mcp_client`, `get_runtime_stats`, `trigger_reindex`,
`suppress_contract_write`). Default OFF preserves the v1 tools-list snapshot
for non-plugin deployments.

Restart `vault-memory serve` (or restart Obsidian, which respawns the server
via the plugin) to register the new tools.

## Verify the install

1. Open Obsidian.
2. Open `examples/contracts/meeting-prep.contract` (copy it into the vault if
   the example dir is not synced) — Obsidian should launch the three-pane
   visual editor automatically. If a JSON view opens instead, the plugin did
   not register the `.contract` extension; check that the plugin is enabled in
   Settings → Community Plugins.
3. Open the plugin's chrome view (command palette → "vault-memory: Open
   chrome") — the Settings / Secrets / Reindex / Stats / Connectors tabs
   should render and the Stats tab should show the running server's per-vault
   snapshot.

## Update via the `vm-update` skill

```
/vm-update
```

`vm-update` checks GitHub Releases for a newer version than the installed
`manifest.json.version`. If newer, it downloads, verifies the checksum, and
replaces the plugin directory atomically. If not, it exits with a no-op.

See [skills/vm-update/SKILL.md](../../../skills/vm-update/SKILL.md).

## Uninstall

1. Delete `<vault>/.obsidian/plugins/vault-memory/`.
2. Set `[plugin] enabled = false` in `~/.vault-memory/config.toml` (or remove
   the `[plugin]` section entirely).
3. Restart Obsidian (and `vault-memory serve` if running headless).

Uninstalling **does not** remove secrets from the OS keyring. The keyring
entries remain until manually purged (see [SECRETS.md](SECRETS.md) §"Uninstall
leaves keyring entries").

## Compatibility

| Surface | Requirement |
|---|---|
| Obsidian | ≥ 1.5.0 |
| Platform | macOS / Windows / Linux desktop (no mobile — `isDesktopOnly: true`) |
| vault-memory CLI | Matching major.minor (plugin v2.0.0 ↔ CLI v2.0.x) |
| Node.js | ≥ 22 (CLI requirement; the plugin itself runs in Obsidian's Electron) |

## Sync substrate caveats

If you sync the vault across devices (Syncthing, iCloud Drive, git-sync,
Obsidian Sync), the plugin's `data.json` — which contains encrypted secret
ciphertext — will sync too. Decryption keys do **not** sync:

- macOS Keychain, Windows Credential Manager, and Linux libsecret/kwallet are
  per-device. Ciphertext encrypted on machine A cannot be decrypted on machine
  B. You will be prompted to re-enter each secret on the new device.
- This is the correct security posture — synced ciphertext that decrypts
  anywhere is equivalent to plaintext. See [SECRETS.md](SECRETS.md).

Vault registrations (`~/.vault-memory/config.toml`) live outside the vault and
do **not** sync. Each device gets its own configuration.

## Known limitations

- The plugin requires `vault-memory` on `$PATH`. There is no embedded server
  binary.
- Obsidian community plugin store submission is deferred to v2.0.x / v2.1
  (D-DIST-SECONDARY). The store has a multi-week review delay; the skills are
  the canonical install path for v2.0.0.
- The plugin is per-vault. Multi-vault workspaces install the plugin once per
  vault. A workspace-level config is deferred to v2.x.
- The `vm-install` skill assumes a GitHub-accessible network. Air-gapped
  installs use the manual sideload path.
