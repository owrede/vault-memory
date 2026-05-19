# Secrets and credentials

> Phase 7 / v2.0.0 — vault-memory Obsidian plugin / Last verified: 2026-05-19

The plugin stores credentials (peer-MCP API keys, OAuth tokens, etc.) in the
OS keyring via Electron's `safeStorage` API. Secrets are referenced by name
in contracts and connector configs using `${secret:name}` substitution, which
the server resolves over local stdio at use time.

## Overview

`safeStorage` is Electron's wrapper over the OS-native credential stores:

| Platform | Backend |
|---|---|
| macOS | Keychain (Schlüsselbund) |
| Windows | DPAPI (Credential Manager) |
| Linux | libsecret (GNOME Keyring) or kwallet5 — falls back to `basic_text` if neither is installed |

Plaintext never touches disk. The plugin encrypts via
`safeStorage.encryptString(plaintext)` and persists only the ciphertext blob
inside `<vault>/.obsidian/plugins/vault-memory/data.json` under the `secrets`
key.

Implementation:
[`plugin/src/services/safe-storage.ts`](../../../plugin/src/services/safe-storage.ts),
[`plugin/src/services/secrets-store.ts`](../../../plugin/src/services/secrets-store.ts).

## Adding a secret

1. Open the chrome view → **Secrets** tab.
2. Click **Add secret**.
3. Enter a `name` (e.g. `notion_token`, `openai_api_key`) and a `value`.
4. Click **Save**. The plugin calls `safeStorage.encryptString(value)` and
   persists the resulting base64 ciphertext.

The UI lists existing secrets by **name + creation date only**. The plaintext
value is never displayed after the initial entry.

The form uses `data-testid` attributes (`secrets-add-name`,
`secrets-add-value`, `secrets-add-submit`) for the Playwright test harness.

## Referencing secrets

Anywhere a connector config or contract field accepts a string, write
`${secret:name}` instead of a literal value:

```toml
# ~/.vault-memory/config.toml — managed by the plugin via set_mcp_client
[[contracts.mcp_clients]]
name = "notion"
command = "notion-mcp-server"
args = ["--token", "${secret:notion_token}"]
```

The reference syntax is a strict regex: `\$\{secret:([a-zA-Z0-9_-]+)\}`. Names
allow alphanumerics, underscore, hyphen. Anything else fails the lookup at
resolution time with `secret_not_found`.

## Per-device ciphertext

`safeStorage` is per-device by design. A secret encrypted on machine A
**cannot** be decrypted on machine B — the keys live in the OS keyring, not in
the synced `data.json`.

When you sync the vault across devices (Syncthing, iCloud Drive, git-sync,
Obsidian Sync), `data.json` syncs with the ciphertext blobs. On the new
device, the plugin will detect the decryption failure on first use and prompt
you to **re-enter** each secret.

This is the correct security posture. A secret that decrypts on any device
the synced ciphertext lands on is equivalent to plaintext at rest. Re-entry
on a new device matches the behavior of every modern password manager.

## Linux backend caveats

On Linux sessions without `gnome-libsecret` or `kwallet5`, Electron's
`safeStorage` reports its backend as `"basic_text"` — secrets are written to
disk in **plaintext**, not encrypted at rest. The
[`SafeStorageAdapter`](../../../plugin/src/services/safe-storage.ts) refuses
to encrypt in this state unless the caller passes `{ allowBasicText: true }`.

The secrets panel surfaces a yellow warning banner when the backend is
`basic_text`:

> ⚠ Encryption unavailable on this device. Install `gnome-libsecret` or
> `kwallet5`, then restart Obsidian. Storing secrets without a keyring writes
> plaintext to `data.json`.

The user can dismiss the warning and proceed (`allowBasicText: true`). Doing
so is functional but **not** equivalent to a real keyring — anyone with read
access to the vault directory can read the secret.

Recommended fix on Linux desktops:

```bash
# Ubuntu / Debian
sudo apt install gnome-keyring libsecret-1-0

# Fedora
sudo dnf install gnome-keyring libsecret

# Arch
sudo pacman -S gnome-keyring libsecret
```

Then restart Obsidian. `safeStorage.getSelectedStorageBackend()` should
report `"gnome_libsecret"` (or equivalent). Re-add the secrets — the
`basic_text`-stored values do not migrate automatically.

## Server-side resolution

When `vault-memory serve` evaluates a contract or spawns a peer-MCP client
and encounters `${secret:name}`, it calls back into the plugin via the
`resolve_secret({name})` MCP tool. The flow:

1. Server hits `${secret:name}` during contract evaluation or connector
   spawn.
2. Server calls `resolve_secret({name: "notion_token"})` over the local
   stdio MCP transport.
3. The plugin's tool handler looks up the ciphertext in its in-memory
   secrets store, calls `safeStorage.decryptString(ciphertext)`, and returns
   the plaintext on the MCP response.
4. Server substitutes the plaintext into the contract field or connector
   args, then proceeds.

Plaintext crosses the boundary only over local stdio (same process tree, same
user) and is **never logged**. The plugin's tool handler enforces
`reason: "secret_not_found"` when the name is unknown.

Failure modes:

| Reason | Cause | Resolution |
|---|---|---|
| `secret_not_found` | No secret with that name. | Add it via the Secrets tab, or fix the typo in the reference. |
| `safe_storage_unavailable` | `safeStorage.isEncryptionAvailable()` returned false (e.g. running outside Electron). | Restart Obsidian; verify backend in the Secrets panel. |
| `decrypt_failed` | Ciphertext was encrypted on a different device. | Re-enter the secret on this device. |

The Connectors panel surfaces these reasons inline next to the connector
that triggered the resolution.

See `plugin/src/services/secrets-store.ts` for the ciphertext envelope shape
(`{v, alg, ct, createdAt}` — versioned for forward-migration headroom).

## Uninstall leaves keyring entries

Deleting the plugin directory or disabling the plugin does **not** purge
keyring entries. Electron's `safeStorage` stores ciphertext indexed by a
per-application key; the keyring entries persist after plugin removal.

To purge:

- **macOS:** Open **Keychain Access** → search for entries named
  `Obsidian` or `vault-memory` → delete.
- **Windows:** Open **Credential Manager → Web Credentials / Windows
  Credentials** → search for entries created by Obsidian → remove.
- **Linux:** `secret-tool` or `seahorse` (GNOME) / `kwalletmanager`
  (KDE) → search and delete.

This is RESEARCH §Runtime State Inventory residue — known and accepted.

## Known limitations

- Secrets are scoped per-vault (per Obsidian plugin install). A workspace with
  three vaults has three independent secret stores.
- The plaintext value is captured by an Obsidian `<input type="password">`
  field. Browser autocomplete and screen recorders see the field in DOM; the
  plugin cannot prevent that.
- There is no per-secret access policy. Any contract or peer-MCP client
  declared in this vault's config can reference any secret by name.
- External secret stores (1Password CLI, HashiCorp Vault) are deferred to
  v2.x via custom MCP tools. v2.0.0 ships `safeStorage` only.
- Secrets cannot be exported. The only way to copy them to another device is
  to re-enter them.

See also: [CONNECTORS.md](CONNECTORS.md) for how connector configs reference
secrets; [CONTRACT-EDITOR.md](CONTRACT-EDITOR.md) for `${alias.field}` (the
in-contract reference syntax, which is distinct from `${secret:name}`).
