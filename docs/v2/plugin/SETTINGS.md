# Plugin settings

> Phase 7 / v2.0.0 — vault-memory Obsidian plugin / Last verified: 2026-05-19

Settings live in the Obsidian **Settings → Community Plugins → vault-memory**
tab. Persistence is via Obsidian's `Plugin.loadData()` / `saveData()` API to
`<vault>/.obsidian/plugins/vault-memory/data.json`.

## Settings reference

Every settings key, its default, and whether changing it requires a restart.

| Key | Default | Description | Restart-required |
|---|---|---|---|
| `ollamaUrl` | `http://localhost:11434` | Base URL of the Ollama embedding server. | **Yes** |
| `embeddingModel` | `bge-m3` | Name of the embedding model Ollama serves. Must already be `ollama pull`ed. | **Yes** |
| `rerankerEnabled` | `false` | Toggle the ONNX cross-encoder reranker on/off for `search_hybrid` calls that pass `rerank: true`. | No (hot-swappable) |
| `defaultVault` | `null` | Vault name search tools default to when the caller omits an explicit `vaults` filter. `null` = fan out across all registered vaults. | No (hot-swappable) |
| `indexerBatchSize` | `32` | Number of chunks the indexer embeds per Ollama batch call. | No (hot-swappable) |
| `ftsTokenizer` | `null` | Override the SQLite FTS5 tokenizer string (e.g. `"porter unicode61"`). `null` uses the schema default. | **Yes** |
| `serverCommand` | `vault-memory` | Executable the plugin spawns to start `vault-memory serve`. Resolved against `$PATH`. | **Yes** |
| `serverArgs` | `["serve"]` | Args passed to `serverCommand`. | **Yes** |

The canonical definition lives in
[`plugin/src/services/settings-store.ts`](../../../plugin/src/services/settings-store.ts)
(`DEFAULT_SETTINGS`, `RESTART_REQUIRED_KEYS`).

## Hot-swappable settings

`rerankerEnabled`, `defaultVault`, and `indexerBatchSize` change behavior in
the running server immediately. The settings tab calls the `set_runtime_config`
MCP tool, which mutates the live server's in-memory configuration.

**These mutations are in-memory only.** They do **not** write back to
`~/.vault-memory/config.toml`. The config file is the authoritative source of
record. The hot-swap exists to change behavior for the current process
lifetime — restarting `vault-memory serve` reverts the in-memory mutation to
whatever the config file says.

If you want a hot-swap change to survive restarts, edit
`~/.vault-memory/config.toml` and restart the server. The plugin does not
mutate the user's config file directly, by design — the server owns its own
config (D-CHROME-CONNECTORS pattern; see ADR-007).

## Restart-required settings

`ollamaUrl`, `embeddingModel`, `ftsTokenizer`, `serverCommand`, `serverArgs`
require a server restart to take effect. The settings tab surfaces a clear
**"Restart required"** badge next to each. The reason:

- **`ollamaUrl`** — the `OllamaClient` is constructed at server bootstrap and
  holds the URL in a closure; changing it mid-run does not redirect existing
  batch calls.
- **`embeddingModel`** — switching models requires re-loading the model
  metadata into the `models` table and rebinding the per-model embedding
  vec0 table. Hot-swap would break in-flight indexer batches.
- **`ftsTokenizer`** — SQLite FTS5 tokenizer is set at table creation. Changing
  it without a rebuild produces inconsistent BM25 scores.
- **`serverCommand` / `serverArgs`** — these control which process the plugin
  spawns. They take effect at the next plugin reload.

To apply: change the setting → restart Obsidian (or run **Reload app without
saving** from the command palette). The plugin respawns its server child with
the new flags.

## Advanced section

The settings tab collapses these by default to keep the surface short for new
users:

- `ftsTokenizer`
- `indexerBatchSize`
- `serverCommand` + `serverArgs`

Click "Show advanced" to reveal them. The collapse state is UI-only; the
values persist regardless of visibility.

## Persistence path

```
<vault>/.obsidian/plugins/vault-memory/data.json
```

The file is plain JSON. Secrets live alongside settings in the same file but
under a separate `secrets` key with ciphertext only — see
[SECRETS.md](SECRETS.md) for the encryption posture.

If you sync the vault across devices, `data.json` syncs too. Settings are
portable across devices; secrets are not (ciphertext is per-device).

## Settings inheritance

The plugin reads settings from `data.json` only. It does **not** read
`~/.vault-memory/config.toml` directly — that file is the server's source of
truth. The two are independent surfaces.

If you change `ollamaUrl` in the plugin settings tab and the server's
`config.toml` has a different value, the spawned server will use the value the
plugin passes via `set_runtime_config`. Persistence still requires the
restart-and-edit-config path described above.

## Known limitations

- The settings tab does not validate the Ollama URL until the server tries to
  use it. A typo surfaces as a connection error in the Stats panel.
- `embeddingModel` is a free-text field; misspelled model names produce
  `model_not_found` errors at first indexer run.
- The "Restart required" badge is advisory — Obsidian does not enforce it. If
  you change a restart-required field and ignore the badge, the running server
  silently keeps using the old value.
- Per-vault setting overrides are not supported in v2.0.0. The plugin is
  per-vault by Obsidian convention, so each vault has its own `data.json`; if
  you need different settings per vault, install the plugin separately per
  vault.
