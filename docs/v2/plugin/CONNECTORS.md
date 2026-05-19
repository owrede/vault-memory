# Connectors (peer-MCP clients)

> Phase 7 / v2.0.0 — vault-memory Obsidian plugin / Last verified: 2026-05-19

vault-memory can spawn other MCP servers ("peer-MCP clients") and expose
their verbs through the contract system. The plugin's Connectors tab is the
UI for declaring those clients without hand-editing
`~/.vault-memory/config.toml`.

## Overview

A peer-MCP client is declared in the server's config under
`[contracts.mcp_clients]`. Each entry has:

- `name` — alias used as the verb namespace in contracts (e.g.
  `notion.search`).
- `command` — executable that starts the peer-MCP server.
- `args` — arg list passed to `command`.
- `env_secrets` — map of env-var-name → `${secret:name}` reference. The
  server resolves these via the [`resolve_secret`](SECRETS.md#server-side-resolution)
  MCP tool at spawn time and injects them into the child process
  environment.

The server is the authority for its own config. The plugin reads and writes
peer-MCP entries via the [`set_mcp_client`](../../../src/plugin-tools/set-mcp-client.ts)
MCP tool — it does **not** edit `config.toml` directly. This keeps the
config file under server ownership and gives the server a single chokepoint
for validation.

Verbs declared by configured peer-MCP clients populate **palette section 5**
in the contract editor (see [CONTRACT-EDITOR.md](CONTRACT-EDITOR.md) §"Palette").

## Adding a connector

1. Open the chrome view → **Connectors** tab.
2. Click **Add connector**.
3. Fill the form:

| Field | Example | Notes |
|---|---|---|
| Name | `notion` | Alphanumerics, underscore, hyphen. Used as the verb namespace. |
| Command | `notion-mcp-server` | Resolved against `$PATH`. Absolute paths accepted. |
| Args | `["--workspace", "primary"]` | JSON array of strings. |
| Env secrets | `{ "NOTION_TOKEN": "${secret:notion_token}" }` | Map of env-var name → secret reference. See [SECRETS.md](SECRETS.md). |

4. Click **Save**. The plugin calls
   `set_mcp_client({name, command, args, env_secrets})`. The server
   validates the shape, persists the entry to `config.toml`, and
   refreshes its in-memory `[contracts.mcp_clients]` list.

The inventory-read variant (`set_mcp_client({list: true})`) returns the
current `[contracts.mcp_clients]` map. The Connectors tab calls this on
load to populate the list.

## Referencing secrets

Credentials never appear in connector forms as plaintext. Use the
`${secret:name}` reference syntax in the **Env secrets** map:

```json
{
  "NOTION_TOKEN": "${secret:notion_token}",
  "OPENAI_API_KEY": "${secret:openai_key}"
}
```

The full resolution flow:

1. Server reaches `Client.connect()` for the `notion` client.
2. Server walks `env_secrets`; for each value matching
   `\$\{secret:([a-zA-Z0-9_-]+)\}`, it calls
   `resolve_secret({name})`.
3. The plugin's `resolve_secret` handler decrypts the ciphertext via
   `safeStorage.decryptString(ciphertext)` and returns the plaintext.
4. Server substitutes plaintext into the env map and spawns the peer-MCP
   child process with the resolved environment.

Plaintext crosses the boundary only over local stdio and is never logged.
Failure modes (`secret_not_found`, `decrypt_failed`,
`safe_storage_unavailable`) surface inline in the Connectors tab next to
the affected entry. See [SECRETS.md](SECRETS.md) §"Server-side resolution"
for the failure-mode table.

## Test connection

The Connectors tab shows a **Test** button per entry. Clicking it:

1. The plugin calls a server tool that runs the full peer-MCP spawn flow:
   resolve `env_secrets`, spawn `command` with `args`, perform an MCP
   `initialize` handshake, then close the connection.
2. The server returns either `{ok: true, capabilities}` or
   `{ok: false, reason}`.
3. The tab renders a green check and the peer's declared verb count on
   success, or a red error chip with the reason on failure.

Common failures and resolutions:

| Reason | Cause | Fix |
|---|---|---|
| `command_not_found` | `command` not on `$PATH`. | Install the peer server, or use an absolute path. |
| `secret_not_found` | An `env_secrets` reference points at a missing secret. | Add the secret in the Secrets tab. |
| `mcp_initialize_failed` | Peer process exited or did not speak MCP. | Run the command manually in a terminal; check its stderr. |
| `timeout` | Peer took longer than 5 seconds to handshake. | Verify the peer's startup time; some servers do heavy first-run init. |

The test does **not** persist a connection. Each `instantiate_contract`
call that uses a peer verb spawns a fresh peer process.

## Removing a connector

1. Click the connector in the list.
2. Click **Remove**.
3. Confirm the modal.

The plugin calls `set_mcp_client({name, _delete: true})` (or whatever
delete shape `set_mcp_client` expects — see the tool's input schema). The
server removes the entry from `config.toml` and refreshes its in-memory
state.

Removing a connector does **not** delete the secrets referenced in its
`env_secrets`. Secrets are managed independently in the Secrets tab.

## Cloud-source connectors

Cloud-source connectors (Notion, GitHub, Google Drive, etc.) as a vault-memory
data source — separate from peer-MCP verb declarations — are deferred to
**Phase 10 / v3**. The Connectors UI scaffold here is the model that grows:
the same form shape (name + command + args + secrets) will host source-side
adapters when v3 lands.

In v2.0.0, "connector" means **peer-MCP client only** — an external MCP
server whose verbs vault-memory exposes through contracts. Configure the
peer-MCP server's own data sources in the peer-MCP server itself.

## Known limitations

- The plugin cannot enumerate peer-MCP verbs without spawning the peer.
  The Test button performs a real `initialize` handshake to populate the
  verb count.
- Each `instantiate_contract` call that uses a peer verb spawns a fresh
  peer process. There is no connection pooling in v2.0.0.
- The `args` and `env_secrets` forms are JSON-typed; malformed JSON
  surfaces a parse error on save. A schema-aware form is deferred to
  v2.x.
- Per-environment overrides (e.g. a different `command` per host) are
  not supported. The plugin is per-vault, so multi-host setups install
  per-host.
- There is no per-connector access policy. Any contract in the vault can
  reference any configured peer-MCP verb.

See also: [SECRETS.md](SECRETS.md) for the secret-store mechanics;
[CONTRACT-EDITOR.md](CONTRACT-EDITOR.md) §"Palette" for how configured peer
verbs surface in the contract editor.
