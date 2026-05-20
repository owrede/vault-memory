# Obsidian Plugin Changelog

User-visible changes to the vault-memory Obsidian plugin. CLI/MCP-server
changes are tracked separately in `CHANGELOG-cli.md`.

## [Unreleased]

### Changed

- **Side panel restructured to surface contracts first.** Opening
  the panel ("Open Contracts panel" command) now shows a Contracts
  list at the top — every `.contract` and `_contracts/*.yaml` file
  in the vault, click a row to open in the canvas editor. The
  admin sections (Operations / Stats / Connectors) are moved into
  a collapsible "Advanced" `<details>` block at the bottom. Open
  state persists across sessions.
- **Workspace tab label** renamed from `vault-memory` to
  `vault-memory: Contracts` to signal the panel's primary purpose.
- **Command name** renamed from `Open vault-memory panel` to
  `Open Contracts panel`.

### Fixed

- **"Malformed MCP envelope" errors on Stats + Connectors panels.**
  The server's `isError: true` envelopes are now properly recognised
  by the plugin's MCP client and surfaced as the server's
  human-readable message instead of "MCP error -32603: …".
- **Friendlier message when plugin-control MCP tools are not exposed**
  (`get_runtime_stats`, `set_mcp_client`, …). The Stats and
  Connectors panels now show "Plugin tools are not exposed by the
  server. Add `[plugin] enabled = true` to ~/.vault-memory/config.toml,
  then restart Obsidian (or re-run /vmem:install)." instead of a
  raw JSON-RPC error string.
- **CLI-not-found banner** now points users at `/vmem:install`
  (the new marketplace plugin) instead of the deprecated
  `/vm-install` skill.

### Added

- **Changelog viewer in Settings.** Plugin settings → Changelog
  shows the plugin's own version history alongside the CLI's
  version history, both rendered from the bundled
  `CHANGELOG-plugin.md` and `CHANGELOG-cli.md` files.

## [2.0.0] — 2026-05-19

Initial 2.0.0 release ships with the CLI's v2.0.0-rc.* line.
