# `audit_log` tool

Query the write audit trail for a vault.

## v1 input shape (unchanged)

| Field       | Type      | Required | Description                                       |
| ----------- | --------- | -------- | ------------------------------------------------- |
| `vault`     | `string`  | yes      | Vault name.                                       |
| `note_path` | `string`  | no       | Filter to a single note path.                     |
| `op`        | `enum`    | no       | `create` / `update` / `delete`.                   |
| `since`     | `integer` | no       | Epoch ms — entries at or after this timestamp.    |
| `limit`     | `integer` | no       | Default 50, max 1000.                             |

## v2 additive filter (Plan 02-06 / MEM-08)

| Field                  | Type      | Required | Description                                                                                                                                                                              |
| ---------------------- | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `is_memory_sink_write` | `boolean` | no       | Restrict rows to memory-sink writes (`true`) or non-memory writes (`false`). Omit to include all rows — preserves Phase 1 default behavior. Backed by SQLite partial index for `true`. |

The MCP tool's `description` text is intentionally **unchanged** vs. Phase 1
— the new capability is additive in the input JSON Schema and the output row
shape. v1 tools/list snapshot bytes for `audit_log.description` are preserved.

## v2 output rows

Every row now carries an additional field:

```
{
  "id": <number>,
  "notePath": <string|null>,
  "noteTitle": <string|null>,
  "op": "create" | "update" | "delete",
  "previousHash": <string|null>,
  "newHash": <string|null>,
  "expectedHash": <string|null>,
  "clientId": <string|null>,
  "diffSummary": <string|null>,
  "at": <epoch_ms>,
  "is_memory_sink_write": <boolean>     // NEW (Plan 02-06)
}
```

Existing audit rows that pre-date migration 009 surface as
`is_memory_sink_write: false` — migration 009's `ALTER TABLE ... DEFAULT 0`
applies cleanly to v1.x databases on first open.

## How the flag is derived

Writes routed through a `DeliveryAdapter` with `opts.sink` set
(`record_observation`, `supersede`) are stamped `is_memory_sink_write = 1`.
All other writes (v1 `write_note`, `update_frontmatter`, `delete_note`)
record `0`. The DeliveryAdapter facade in `src/adapters/delivery/obsidian-fs/`
is the single derivation site.
