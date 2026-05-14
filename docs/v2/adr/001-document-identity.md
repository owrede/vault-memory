---
title: Document identity is opaque, URI-style
status: Accepted
phase: 0
tags: identity, source-agnostic, uri, opaque-id
---

# ADR-001: Document identity is opaque, URI-style

**Status:** Accepted — Phase 0 foundation
**Date:** 2026-05-14
**Scope:** v2 schema, all tools introduced from Phase 1 onward
**Supersedes:** —
**Superseded by:** —

## Context

vault-memory v1 keys notes by `path` — the vault-relative file path. This is fine
for a single source type (Obsidian filesystem) where the path *is* the identifier
the user thinks in. It does not survive the v3 plan:

- **Multiple source types.** Notion pages have stable opaque IDs but no paths.
  Web sources have URLs. RSS items have GUIDs. A path-based primary key encodes
  the assumption that all sources are file trees.
- **Rename instability.** Even within Obsidian, a path is not a stable identity.
  Renaming a note today breaks every wikilink, backlink reference, and audit
  entry that pointed at the old path; the indexer effectively treats rename as
  delete-plus-create.
- **Cross-source references.** A v3 brief compiled from both an Obsidian note
  and a Notion page must reference each by a uniform identifier. There is no
  "path" that captures both.

We need an identifier that (a) is uniform across source types, (b) can be
stable when the underlying adapter supports it, (c) is human-readable enough to
appear in citations and logs, (d) maps cleanly to the URLs the agent emits for
display.

## Decision

**Documents are identified by URI-style opaque strings** of the form:

```
<scheme>://<authority>/<resource>
```

- **`scheme`** — the adapter name. `obsidian-fs`, `notion-api`, future
  `rss-feed`, `web-archive`, etc. Lowercase, hyphenated, registered in
  `src/adapters/registry.ts`.
- **`authority`** — the configured source instance name. For Obsidian, the
  vault `name` from `config.toml`. For Notion, the workspace slug. Never a
  filesystem absolute path; never a secret.
- **`resource`** — adapter-specific. For `obsidian-fs`, the vault-relative
  path. For `notion-api`, the page ID. Adapters MAY use slashes inside the
  resource component (and they will, for folder-structured sources); resource
  parsing is the adapter's responsibility.

### Examples

```
obsidian-fs://my-vault/projects/Atlas.md
obsidian-fs://my-vault/_memory/observations/2026-05-14-alice-prefers-async.md
notion-api://acme/page/c5b9f3a2-1234-…
rss-feed://my-feeds/items/8f3e2c1a
```

### Type

```typescript
type DocId = string;  // URI per this ADR. Validated by the adapter registry.
```

We deliberately use a branded string rather than a structured tuple. Reasons:
URIs serialize cleanly to JSON, MCP tool arguments, log lines, and frontmatter;
a tuple would require encoding/decoding at every boundary.

### Identity stability

Two adapter capability flags govern behavior:

- `identityStable: true` — the adapter guarantees that a document's `DocId`
  never changes for the life of the document. Notion gives us this. The indexer
  can treat `DocId` as a primary key and ignore renames.
- `identityStable: false` — the adapter may emit `rename` `ChangeEvent`s with
  `{old_id, new_id}`. The indexer translates these to UPDATEs against the
  primary key. `obsidian-fs` is in this category — a vault-relative path is
  the resource, and the user is allowed to move files.

The on-disk DB schema does not change between these cases. The translation is
all in the indexer.

### Display URLs

Adapters mint display URLs for citation rendering. For Obsidian:

```
obsidian://open?vault=my-vault&file=projects%2FAtlas.md
```

These are **presentation**, not identity. A `DocId` never appears in a UI
unless the adapter explicitly wants it to. The citation packet (per ADR-003)
includes both `doc_id` and `display_url`.

### Backwards compatibility

The existing flat-shape `search`/`fetch` connector contract uses an external
ID of the form `<vault>:<vault-relative-path>` (e.g. `my-vault:projects/Atlas.md`).
That format is a **presentation** choice of the flat-shape adapter — internally
the same document maps to `obsidian-fs://my-vault/projects/Atlas.md`. The
flat-shape adapter is responsible for the bidirectional translation. No change
to the external connector contract is required for v2.

Existing v1.x tools that accept `path` continue to work in v2. They resolve
`path` to a `doc_id` via the obsidian-fs adapter on entry. Deprecation is
documented in the changelog but not enforced. Removal is a v3.0.0 breaking
change.

## Invariants

Normative MUST/MUST-NOT statements. Phase 9's adversarial review (and any
future ADR-conformance audit) greps for these.

- **I-1**: A `DocId` MUST be of the form `<scheme>://<authority>/<resource>`.
  No other form is permitted in code paths outside `src/adapters/source/`.
- **I-2**: The `<scheme>` MUST be lowercase, hyphenated, and registered in
  `src/adapters/registry.ts`. Adapters MUST NOT mint DocIds for unregistered
  schemes.
- **I-3**: `path` (vault-relative file path) MUST NOT be used as a primary
  key in core code after the Phase 1 migration. Adapter modules MAY retain
  `path` as a denormalized cache column.
- **I-4**: For `identityStable: false` adapters, a `rename` `ChangeEvent`
  MUST be emitted with both `old_id` and `new_id`. Treating rename as
  delete-plus-create is FORBIDDEN.
- **I-5**: `obsidian://` URLs are DISPLAY-ONLY. They MUST NOT appear as
  identity in DB rows, audit logs, or tool inputs/outputs (except as the
  citation packet's `display_url` field per ADR-003).
- **I-6**: For adapters whose source IDs have multiple canonical
  serializations, the adapter MUST pick exactly one canonical form,
  document it in the adapter's README and capability descriptor, and
  emit only that form in `<resource>`. Re-encoding/normalization happens
  at the adapter boundary on ingest; core code MUST treat `<resource>`
  as a byte-stable opaque string and MUST NOT attempt its own
  normalization. Two adapters processing the same logical source
  document MUST emit the same `DocId` — divergent serializations of the
  same underlying ID violate the identity-stability guarantee that the
  `notes`-table primary key depends on.

  Concrete adapter rules (must be honored by Phase-10 and later
  adapters; non-exhaustive — each adapter records its own
  normalization in its README):

  - `notion-api`: Notion page/database IDs are UUIDs with two
    serializations (hyphenated `c5b9f3a2-1234-4abc-9def-0123456789ab`
    and unhyphenated `c5b9f3a212344abc9def0123456789ab`). The
    canonical form is **lowercase hyphenated UUID (RFC 4122)**. The
    adapter MUST normalize both forms (and any mixed-case variant) to
    lowercase hyphenated at ingest before minting the `DocId`. The
    `page/`-prefix convention (`page/<uuid>`, `database/<uuid>`) is
    part of the canonical resource grammar.
  - `obsidian-fs`: vault-relative paths are normalized to forward
    slashes (`/`), with no leading slash. Percent-encoding of
    non-ASCII / space characters is left to the Phase-1 follow-up
    decision below; the adapter's chosen encoding is canonical once
    committed.

## SQLite schema migration

Phase 1 introduces a migration that adds `doc_uri TEXT NOT NULL UNIQUE` to
each affected table:

- `notes` (or whatever the v1 raw-document table is called)
- `chunks`
- `edges` (or `wikilinks`) — both endpoints
- `embeddings_m*_d*` — via FK to `chunks`
- `audit_log` entries that referenced paths

Migration steps:

1. Add the new column nullable.
2. Backfill: for every row, compute `doc_uri = "obsidian-fs://" + vault.name + "/" + path`.
3. Add the `NOT NULL` constraint and the unique index.
4. Update all queries in `src/` to select/filter by `doc_uri`.
5. Keep `path` as a denormalized cache column for the obsidian-fs adapter's
   use; it accelerates filesystem operations and external `obsidian://` URL
   minting. `path` is **never** used as a primary key in core code.

The `path` column is removed in v3.0.0.

### Chunk IDs

Chunk IDs (`chunk_id`) are independent of `doc_id`. They stay stable across
document renames within a single document (the chunker keys them by the
hash of the chunk's heading path + content, not by the doc path). When a
document is replaced wholesale (content edit), `chunk_id`s for unchanged
chunks remain stable; this is the basis of the existing body-hash
short-circuit optimization and we preserve it.

## Consequences

### Positive

- All new tools accept and return `doc_id`. Source-type branching is confined
  to adapters.
- Citations carry stable, copy-pasteable IDs that work across adapter types.
- The change-feed `rename` event handles Obsidian moves cleanly without losing
  history.
- v3 connectors add new schemes to the registry; no schema migration needed.

### Negative / costs

- A migration is required for every v1 user upgrading to v2.
- `doc_id` strings are longer than `path` strings; tooling that displays them
  must elide for readability. Citation packets should display `title` + short
  `path`-style suffix, with the full `doc_id` available for copy.
- Adapter authors must implement consistent URI parsing/minting. The registry
  enforces a minimal grammar but adapters can shoot themselves in the foot.

### Open follow-ups

- Decide whether `doc_uri` values are URL-encoded (paths with spaces, slashes
  in titles, non-ASCII). Recommendation: yes, percent-encoded; the adapter
  handles encoding/decoding. To be confirmed when Phase 1 starts the obsidian-fs
  refactor.
- Decide whether `authority` can include port-like suffixes for multi-instance
  setups (e.g. two Notion workspaces under the same scheme). Recommendation:
  the authority is the `[[memory_sinks]].name` or `[[vaults]].name` from
  config — uniqueness is enforced at config load.

## Examples

Worked round-trips for both currently-anticipated adapters. Both schemes
appear here deliberately (D-04): source-neutrality must be greppable in the
ADR text from day 0. Phase 9's adversarial reviewer can confirm by grepping
`obsidian-fs://` AND `notion-api://` in this same file.

### Example A — `obsidian-fs` (identityStable: false)

A note `projects/Atlas.md` in the vault `my-vault`.

**DocId decomposition**

| Component | Value |
|---|---|
| `scheme` | `obsidian-fs` |
| `authority` | `my-vault` (the `[[vaults]].name` from `~/.vault-memory/config.toml`) |
| `resource` | `projects/Atlas.md` (vault-relative path; slashes inside the resource are allowed and preserved) |
| `DocId` | `obsidian-fs://my-vault/projects/Atlas.md` |

**Display URL minted by the adapter** (presentation only — never identity per I-5):

```
obsidian://open?vault=my-vault&file=projects%2FAtlas.md
```

**Rename event** — the user moves `projects/Atlas.md` → `archive/2026/Atlas.md`:

```json
{
  "type": "rename",
  "old_id": "obsidian-fs://my-vault/projects/Atlas.md",
  "new_id": "obsidian-fs://my-vault/archive/2026/Atlas.md",
  "occurred_at": "2026-05-14T10:23:00Z"
}
```

The indexer translates this to an `UPDATE notes SET doc_uri = new_id WHERE doc_uri = old_id` (per I-4 — treating rename as delete-plus-create is forbidden). Wikilinks, backlinks, citations, and audit-log entries continue to resolve.

### Example B — `notion-api` (identityStable: true)

A Notion page with the workspace-stable page ID `c5b9f3a2-1234-4abc-9def-0123456789ab` in the workspace `acme`.

**DocId decomposition**

| Component | Value |
|---|---|
| `scheme` | `notion-api` |
| `authority` | `acme` (the workspace slug from `~/.vault-memory/config.toml`) |
| `resource` | `page/c5b9f3a2-1234-4abc-9def-0123456789ab` (Notion's stable page ID with a `page/` prefix; the prefix lets the adapter route by Notion object type) |
| `DocId` | `notion-api://acme/page/c5b9f3a2-1234-4abc-9def-0123456789ab` |

**Display URL** — Notion exposes its own canonical URL, which the adapter forwards directly (no minting required):

```
https://www.notion.so/acme/c5b9f3a21234abc9def0123456789ab
```

**Rename event** — none. Because the Notion adapter advertises `identityStable: true`, the page title may change but the `DocId` does not. The change feed emits an `update` `ChangeEvent` (content/properties drift) but never a `rename`. Indexer treats `DocId` as a hard primary key.

### Cross-source citation packet

A v3 brief that cites one Obsidian note and one Notion page (the v3 use case ADR-001 must enable):

```json
{
  "citations": [
    {
      "doc_id": "obsidian-fs://my-vault/projects/Atlas.md",
      "display_url": "obsidian://open?vault=my-vault&file=projects%2FAtlas.md",
      "title": "Atlas — Q2 roadmap"
    },
    {
      "doc_id": "notion-api://acme/page/c5b9f3a2-1234-4abc-9def-0123456789ab",
      "display_url": "https://www.notion.so/acme/c5b9f3a21234abc9def0123456789ab",
      "title": "Atlas — partner sync notes"
    }
  ]
}
```

The brief's compiler does not branch on `scheme` — both citations are resolved through the adapter registry by their `DocId`. Source-type knowledge is confined to adapter modules (per I-1, I-2, I-3).

## Alternatives considered

### (a) Keep raw paths; add a `source_type` column

Rejected. A `(source_type, source_id)` pair works mechanically but encourages
source-specific branching throughout the codebase (`if (source_type === 'obsidian')…`).
A single opaque ID with all routing inside adapters has lower long-term
complexity.

### (b) Opaque UUIDs / surrogate keys

Rejected. UUIDs are unreadable in citations and logs, and the surrogate key
must be stored somewhere durable — making the index a primary source of truth
rather than purely derived. vault-memory's architecture explicitly keeps
identity recoverable from the raw layer alone.

### (c) URI shape with adapter-defined grammar (no shared structure)

Adopted partially. The `<scheme>://<authority>/<resource>` skeleton is
enforced; the inside of `resource` is adapter-defined. This balances uniformity
(at the boundary) with flexibility (inside).

### (d) Reuse the `obsidian://` URL scheme as identity

Rejected. `obsidian://open?vault=…&file=…` is a query-string URL. Treating it as
identity means percent-encoding adventures in every SQL query. It's a fine
*display* format and is preserved as such.
