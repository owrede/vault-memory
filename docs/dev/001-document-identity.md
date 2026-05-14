# ADR-001: Document identity is opaque, URI-style

**Status:** Proposed — Phase 0 foundation
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
