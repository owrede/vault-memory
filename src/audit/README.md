# Audit + Permission Layer

User-facing wrapper around `AuditQueries` (low-level) that powers the
`audit_log` and `index_runs` MCP tools. Source of truth for who-wrote-what
and how the index has evolved over time.

## Audit Surface

### What gets stored

Every successful write through the MCP write tools (`write_note`,
`update_frontmatter`, `delete_note`) appends one row to the `write_audit`
table. Each row captures:

- `op` — `create` | `update` | `delete`
- `previous_hash` — content hash on disk **before** the write (`null` for create)
- `new_hash` — content hash **after** the write (`null` for delete)
- `expected_hash` — the hash the writer thought was on disk; if it diverges
  from `previous_hash` the write was rejected as a conflict (and no audit
  row is written)
- `client_id` — opaque caller id (e.g. `claude-code`, `obsidian-plugin`)
- `diff_summary` — short human-readable summary (e.g. `+12 -3 lines`)
- `at` — epoch ms

The audit row is written **inside the same transaction** as the note
upsert/delete by the write helpers. Read-only operations are not audited.

### When it is useful

- **Forensics** — "who/what client modified Note X on date Y?"
- **Rollback hints** — `previous_hash` is the pre-write hash; if a
  content snapshot for that hash exists on disk (or in a future snapshot
  table) the write can be reversed.
- **Conflict debugging** — non-null `expected_hash` rows that look unusual
  in volume hint at concurrent writers fighting over the same note.

### Where entries are created

Audit insertion lives in the write helpers (`writeNote`,
`updateFrontmatter`, `deleteNote`). This module only **reads** the audit
log. Writing is never done from here.

### Note resolution semantics

`getAuditLog` enriches each row with `notePath` / `noteTitle` by looking up
the `note_id` against the current `notes` table:

- Note still exists → `notePath` and `noteTitle` are populated from the
  current row (which may have changed since the audit event — this is a
  "best-effort current view", not a snapshot).
- Note has been hard-deleted from the `notes` table → both fields are
  `null`. The audit row itself stays (foreign key is intentionally not
  cascading on the audit table).
- A logical `op = "delete"` audit row whose note row still exists in
  `notes` (e.g. soft-delete or a delete that didn't propagate) **will**
  still resolve to a `notePath`. Callers should treat `notePath != null`
  as "the path the note has right now", not "the path at the time of the
  event".

## Permission Model

### Per-vault `write_enabled`

`~/.vault-memory/config.toml` has a `write_enabled` flag per vault:

```toml
[[vaults]]
name = "my-vault"
path = "/Users/me/Vault"
write_enabled = true   # default: false
```

- **Default is `false`** — vaults are read-only unless write is explicitly
  enabled.
- When `write_enabled = false`, every MCP write tool returns
  `permission_denied` immediately and **does not** record an audit entry
  (because no operation actually took place — auditing a non-event would
  be misleading).
- The flag is read from the resolved `VaultConfig` at request time, so
  toggling it does not require a server restart for new requests, though
  long-running operations within a single tool call see the value as it
  was when the call started.

### Trust boundary

The MCP server has **no authentication layer** of its own. It trusts
its single MCP client (typically Claude Code on the same machine).
Multi-user / multi-tenant deployments are explicitly **not a goal**.
If you connect a remote client to this server, that's on you.

This is why the `client_id` field exists in the audit log — it lets the
caller voluntarily tag its writes for forensics, but it is **not**
verified or enforced.

## Future

- **Rollback tool** built on `audit_log` + a content snapshot table
  (next to `write_audit`, keyed by `previous_hash`).
- **Richer diff_summary** — currently a free-form string; could be a
  structured JSON blob (added/removed lines, frontmatter key delta) once
  the write helpers compute it.
- **Per-client rate limiting** — group by `client_id`, throttle on
  unusual write velocity.
