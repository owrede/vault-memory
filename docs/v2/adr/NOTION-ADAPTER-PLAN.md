# v3 Phase-10 — Notion Adapter Implementation Plan

**Scope:** `notion-api` `SourceConnector`, `DeliveryAdapter`, and `ChangeFeed`
implementations. Additive per ADR-002: zero modifications to L0–L4.

**Sources consulted:** ADR-001..004, ARCHITECTURE.md, MEMORY_CONTRACT.md,
AGENT_AGNOSTIC.md. No other source.

**Companion artifact:** `docs/v3/ADVERSARIAL-REVIEW.md` (findings filed
inline as the plan was written).

---

## 1. File layout

Per ADR-002 (`src/adapters/...`) co-location and the ARCHITECTURE.md
"Source-neutrality contract" five-file enumeration:

```
src/adapters/
  source/notion-api/
    index.ts              # NotionApiSource implements SourceConnector
    client.ts             # Notion API HTTP wrapper (or MCP-shim per ADR-002 §Alt-(b))
    parse-blocks.ts       # Notion blocks → BlockNode[] (ADR-003)
    parse-properties.ts   # Notion typed properties → PropertyBag (ADR-003)
    canonicalize.ts       # NFC + RFC 8785 helpers reused with obsidian-fs path
    hash.ts               # delegates to shared src/render/plain-text.ts (ADR-003)
  delivery/notion-api/
    index.ts              # NotionApiDelivery implements DeliveryAdapter
    render-blocks.ts      # BlockNode[] → Notion block create-requests
    render-properties.ts  # PropertyBag → Notion typed properties
    schema-check.ts       # database schema vs MemoryContract subset check
  change-feed/notion-api/
    index.ts              # NotionApiChangeFeed implements ChangeFeed
    poller.ts             # polling loop + cursor state
  conformance/
    fixtures/notion/...   # hash-equivalence fixtures vs obsidian-fs (ADR-003 §H-1)
```

One `registry.registerSource('notion-api', factory)` + matching
`registerDelivery` + `registerChangeFeed` call in `src/adapters/index.ts`.

The plan deliberately mirrors the layout from ADR-002 so the CI lint
(`scripts/lint-adapters.sh`) accepts the new module tree without rule
changes — `chokidar`, `fs.*`, `path.*`, `gray-matter`, `*.md` literals do
not appear in any of the new files.

## 2. Configuration

Per ADR-002 §"Adapter configuration secrets" (open follow-up) and ADR-004
§"Config":

```toml
# config.toml additions

[[connectors]]
scheme   = "notion-api"
name     = "acme"                       # authority component of every DocId
token    = "${env:NOTION_TOKEN}"        # see Finding 1
api_version = "2022-06-28"              # see Finding 2
root_pages  = ["c5b9f3a2-...", "..."]   # workspaces are not enumerable; see F3
root_databases = ["...", "..."]

[[memory_sinks]]                        # ADR-004 example B
name    = "team-memory"
handle  = "notion-api://acme/databases/<id>"
default = false
contract = "default-memory-v1"
```

`VAULT_MEMORY_NOTION_TOKEN` is the env var read by `${env:...}` substitution
(AGENT_AGNOSTIC §"Anti-patterns" — env vars MUST be `VAULT_MEMORY_*`).

## 3. DocId grammar (per ADR-001)

```
notion-api://<authority>/<object-type>/<notion-id>
```

`<object-type>` ∈ `{page, database, block}`. The prefix is required (see
ADR-001 Example B) so the adapter can route by Notion object type without
guessing. Notion's API uses unhyphenated UUIDs in some endpoints and
hyphenated in others; the adapter normalizes to the hyphenated lowercase
form for all DocIds (see Finding 4).

- `notion-api://acme/page/c5b9f3a2-1234-4abc-9def-0123456789ab`
- `notion-api://acme/database/40c1d2e3-...`
- `notion-api://acme/block/aaaaaaa-...`  ← used only for stable
  intra-page anchors when ADR-003 `BlockNode.anchor` is populated.

`identityStable: true`. No `rename` events ever (ADR-002 Example C).

Display URL: forwarded from Notion's canonical `url` field on the page
fetch response (ADR-001 Example B). Not minted.

## 4. `SourceConnector` interface (ADR-002 §SourceConnector)

```typescript
class NotionApiSource implements SourceConnector {
  readonly handle: SourceHandle = "notion-api://acme";
  readonly capabilities: SourceCapabilities = {
    bodyShape: "blocks",
    properties: "typed",
    linkTypes: ["mention", "child-page", "relation", "hyperlink", "embed"],
    identityStable: true,
    permissions: true,
    contentHashStable: true,
    watch: "poll",
  };

  async *listDocuments(opts?: ListOptions): AsyncIterable<DocumentRef> { … }
  async readDocument(id: DocId): Promise<Document>                     { … }
  async hash(id: DocId): Promise<string>                               { … }
  async exists(id: DocId): Promise<boolean>                            { … }
}
```

### 4.1 `listDocuments`

- Uses Notion `POST /v1/search` with cursor pagination.
- `opts.modifiedSince` → server-side `filter` on `last_edited_time`
  if supported; otherwise client-side filter (see Finding 5 — Notion's
  Search API does not actually support time filters on `last_edited_time`;
  must paginate fully and discard).
- `opts.excludeGlobs` → not natively meaningful for Notion; the adapter
  treats glob entries that look like `page/<id>` as DocId blocklist
  matches (see Finding 6 — `ListOptions.excludeGlobs` semantics are
  ADR-002-defined as "semantically interpreted by adapter", which is too
  loose for a glob-typed field).
- Yields `DocumentRef { id, mtime, hash }` where:
  - `id` is built from `page.id` (or `database.id`) plus authority.
  - `mtime` is `Date.parse(last_edited_time)`.
  - `hash` is the **cheap pre-flight hash** — per ADR-002 doc-string "may
    be coarse". The adapter returns `last_edited_time` digested as
    `sha256(last_edited_time)`. This is NOT the content hash; the
    content hash requires a full block-tree fetch (see Finding 7).

### 4.2 `readDocument`

Pipeline:

1. `GET /v1/pages/<id>` → page object with typed `properties` + `url`.
2. `GET /v1/blocks/<id>/children` (paginated) → top-level blocks. Recurse
   into block children where `has_children: true`. Concurrency cap: 4
   in-flight requests per document (see Finding 8 — no ADR specifies a
   crawl-depth limit; Notion pages can recurse arbitrarily and the
   `hash` invariant requires reading the whole tree).
3. Translate blocks → `BlockNode[]` (see §6).
4. Translate properties → `PropertyBag` (see §7).
5. Extract outgoing references → `Edge[]` (see §8).
6. Compute `Document.hash` per ADR-003 §Hash semantics through the shared
   `src/render/plain-text.ts` + RFC-8785 canonicalizer.
7. Return `Document` object.

### 4.3 `hash`

Per ADR-002 doc-string: "content hash; cheap relative to read."

There is no path to cheap content hashing on Notion — the `etag` in the
page response covers properties only (Finding 9). Two options:

- (a) Fetch the full block tree and compute the canonical hash. Not
  "cheap"; equal cost to `readDocument`.
- (b) Cache `(id, last_edited_time) → content_hash` in a local SQLite
  side-table owned by the adapter. `hash()` returns the cached hash when
  `last_edited_time` matches; otherwise it triggers a `readDocument`-
  equivalent fetch and updates the cache.

Recommended: (b). The cache is owned by the adapter (not core code) and
is invalidated by the change-feed.

### 4.4 `exists`

`GET /v1/pages/<id>` → 200 ⇒ true; 404 ⇒ false; 403 (page archived or
permission-denied) ⇒ see Finding 10.

## 5. `DeliveryAdapter` interface (ADR-002 §DeliveryAdapter)

```typescript
class NotionApiDelivery implements DeliveryAdapter {
  readonly handle: SinkHandle; // e.g. "notion-api://acme/databases/<id>"
  readonly capabilities: DeliveryCapabilities = {
    atomic: false,            // see Finding 11 — Notion writes are NOT atomic across blocks
    hashProtected: false,     // see Finding 12 — no If-Match equivalent
    enforcedSchema: true,     // databases enforce typed-property schemas
    naming: "adapter-assigned",
  };

  async write(doc: Document, opts: WriteOptions): Promise<WriteResult> { … }
  async update(id: DocId, patch: DocumentPatch, opts: UpdateOptions): Promise<WriteResult> { … }
  async delete(id: DocId, opts: DeleteOptions): Promise<DeleteResult> { … }
}
```

### 5.1 `write` (create)

1. **Memory-contract guard.** Per MEMORY_CONTRACT.md §"Validator behavior",
   Guards A + B run inside `write()` for memory-sink writes. For Notion,
   the handle resolves into a `MemorySink` iff
   `[[memory_sinks]].handle === this.handle`. Guard B runs first; Guard A
   iterates the seven required keys.
2. **Schema-subset check.** Per ADR-004 open follow-up "Schema-enforced
   sinks (Notion databases)": startup check confirms the database schema
   is a superset of the contract's required keys. If not, fail at startup
   (not at write time).
3. **PropertyBag → Notion typed properties.** Reverse of §7.
4. **`Document.blocks` → Notion blocks.** Reverse of §6. Tables and
   callouts have lossy round-trip (see Finding 13).
5. `POST /v1/pages` with `parent: {database_id: <id>}` and
   `properties` + `children` payload.
6. Returned page-id is wrapped into a DocId. `WriteResult.id` differs
   from `doc.id` because Notion assigned it (per ADR-002
   `naming: 'adapter-assigned'`).
7. `WriteResult.hash` is recomputed from the **server's echoed** page
   response (NOT from `doc` as passed in) — Notion may normalize
   whitespace, drop unsupported block types, etc. The persisted hash MUST
   reflect what was actually stored, else the staleness daemon (ADR-003
   §H-5) will think every newly-written doc is already stale (Finding 14).
8. `WriteResult.mtime = Date.parse(page.last_edited_time)`.

### 5.2 `update`

- `expectedHash` — ADR-002 specifies optimistic concurrency via
  `expectedHash`. Notion has no `If-Match` header. Implementation:
  - Fetch current state, compute hash, compare with `expectedHash`.
  - If equal, proceed with `PATCH /v1/pages/<id>` (properties) and
    `PATCH /v1/blocks/<id>` calls (block edits).
  - **TOCTOU window** between fetch-and-check and write — see Finding 15.
- `DocumentPatch.blocks` is documented as "full replacement; granular
  block edits deferred" (ADR-002). For Notion this means: delete every
  existing top-level block, then append the new ones. This is multiple
  HTTP calls and is NOT atomic (capability `atomic: false`).
- `DocumentPatch.title` → updates the database `title`-typed property
  (the property the schema designates as title), not a separate field.
- `DocumentPatch.properties` → partial PATCH on `properties`.

### 5.3 `delete`

Notion supports archive (`archived: true`) but does NOT support permanent
deletion via the public API (Finding 16). Implementation: PATCH page
`archived: true`. The audit-log row records this as a soft-delete.

This conflicts with ADR-004 open follow-up "Deletion semantics" which
recommends soft-delete by default (status flag), with hard-delete a
"separate explicit operation". For Notion, hard-delete is simply
unavailable (Finding 17).

### 5.4 Memory-contract validator interaction

Per MEMORY_CONTRACT.md the validator operates against `Document.properties`
(PropertyBag). The Notion adapter:

- On `write`: validate BEFORE translating PropertyBag → Notion properties.
- On read back (after Notion creates the page): translate Notion typed
  properties → PropertyBag, re-validate to confirm the contract round-
  tripped (defense-in-depth; not strictly required by MEMORY_CONTRACT.md
  but cheap and catches schema-drift between contract and database).

### 5.5 Sentinel file

ADR-004 §"Sentinel file" requires `.memory-sink` for **folder** sinks.
The Notion sink is a database, not a folder. The literal text of ADR-004
M-3 says "the sink-folder root", which makes M-3 inapplicable to Notion
sinks (Finding 18).

Recommended adapter behavior: at startup, the registry queries the
database and confirms the presence of a single specially-named property
(e.g. `vm_sink_marker: true`) as the Notion analog of the sentinel. Or,
the registry treats Notion sinks as exempt from M-3 and relies entirely
on `[[memory_sinks]]` config opt-in.

## 6. Notion blocks → `BlockNode[]` (ADR-003 §BlockNode)

| Notion block type            | BlockNode mapping                       |
| ---------------------------- | --------------------------------------- |
| `paragraph`                  | `ParagraphNode { text }`                |
| `heading_1`..`heading_3`     | `HeadingNode { level: 1..3, … }`        |
| `bulleted_list_item`         | gathered into `ListNode { ordered:false }` |
| `numbered_list_item`         | gathered into `ListNode { ordered:true }`  |
| `to_do`                      | `ListNode` item with `RawNode` checkbox marker |
| `toggle`                     | `QuoteNode`-shaped (no exact analog; Finding 19) |
| `code`                       | `CodeNode { lang, text }`               |
| `quote`                      | `QuoteNode { children }`                |
| `callout`                    | `CalloutNode { type: icon-or-emoji }`   |
| `divider`                    | `RawNode { format: 'notion-divider' }`  |
| `table`/`table_row`          | `TableNode { headers, rows }` (lossy — see F13) |
| `child_page`                 | `EmbedNode { target_id }`               |
| `child_database`             | `EmbedNode { target_id }`               |
| `link_to_page`               | `EmbedNode { target_id }`               |
| `image`/`video`/`file`/`pdf` | `EmbedNode { target_id: <external_url \| file_url> }` |
| `bookmark`/`embed`/`link_preview` | `EmbedNode`                        |
| `equation`                   | `RawNode { format: 'latex' }`           |
| `synced_block`               | see Finding 20                          |
| `column_list`/`column`       | flattened (children inlined) — see Finding 21 |
| `breadcrumb`/`table_of_contents` | `RawNode { format: 'notion-toc' }`  |
| `unsupported`                | `RawNode { format: 'notion-unsupported' }` |

**Heading hierarchy.** ADR-003 specifies strict hierarchy:
`HeadingNode.children` contains everything until next heading at same-
or-higher level. Notion's flat block list is converted to the tree by a
single-pass stack walk during parsing. Levels 4–6 do not exist in Notion
(only h1/h2/h3); the adapter never emits levels 4–6 (Finding 22 —
ADR-003 typing accepts 1..6 but Notion truncates).

**Rich text.** Notion `rich_text[]` arrays carry inline formatting
(bold/italic/code/links). Per ADR-003 §"Inline content" the adapter
extracts inline links into `Document.links`, preserves link surface text
in `ParagraphNode.text`, and discards styling. Annotations (bold/italic)
are silently dropped (Finding 23 — same lossy behavior as obsidian-fs,
acceptable per ADR-003).

**NFC + LF.** Per ADR-003 H-3, H-4. All Notion text is NFC-normalized at
parse boundary. Notion never returns CRLF but the adapter strips `\r`
defensively.

## 7. Notion typed properties → `PropertyBag` (ADR-003 §PropertyBag)

| Notion property type   | PropertyValue.type   | Notes |
| ---------------------- | -------------------- | ----- |
| `title`                | consumed into `Document.title` (not properties) |
| `rich_text`            | `string`             | concat all `plain_text`, NFC |
| `number`               | `number`             | |
| `select`               | `string`             | `.name` |
| `multi_select`         | `array` of `string`  | |
| `status`               | `string`             | |
| `date`                 | `date`               | `.start` (ISO 8601 only, drops time per Finding 24) |
| `people`               | `array` of `string`  | user-ids (see Finding 25) |
| `files`                | `array` of `string`  | file/external urls |
| `checkbox`             | `boolean`            | |
| `url`                  | `string`             | |
| `email`                | `string`             | |
| `phone_number`         | `string`             | |
| `formula`              | follow result type   | |
| `relation`             | `array` of `reference` | each Notion page-id → DocId |
| `rollup`               | `unknown`            | (Finding 26) |
| `created_time` / `last_edited_time` | `date`     | |
| `created_by` / `last_edited_by`     | `string`   | user-id |
| `unique_id`            | `string`             | `prefix-number` |
| `verification`         | `unknown`            | |

### 7.1 Property name canonicalization (ADR-003 Example B rule 1)

ADR-003 Example B states the Notion adapter MUST canonicalize property
names to lowercase to land at the same `Document.hash` as an obsidian-fs
mirror. The actual rule given is *only* "canonical lowercase". This is
under-specified (Finding 27): how are spaces, multi-word names, and
accents handled? `"First Name"` → `first name`? `first-name`?
`first_name`? Implementation needs an unambiguous algorithm to make
H-1/H-2 testable.

Recommended (subject to ADR amendment): NFC → lowercase → replace
`\s+` with `_` → strip everything outside `[a-z0-9_]`. Document this in
the ADR.

### 7.2 Database-schema property absent from a row

Notion returns every database property on every row, even when empty.
Empty cells are `{type: "rich_text", rich_text: []}` etc. The adapter
emits the cell with the typed empty value (`{type: "string", value: ""}`,
`{type: "array", value: []}`). It does NOT omit the key, because two
documents identical except for "Bob filled in `description`" must hash
differently per ADR-003 §H-1.

## 8. `Edge[]` extraction (ADR-003 §Edge)

| Source                       | `Edge.type`         | Notes |
| ---------------------------- | ------------------- | ----- |
| Inline `@mention` of a page  | `mention`           | `to_id` = mentioned page DocId |
| Inline `@mention` of a user  | not an Edge         | user is not a Document |
| Inline link to Notion URL    | `mention`           | parse URL → page DocId where possible |
| Inline link to external URL  | `hyperlink`         | `to_id` = string (unresolved) |
| `child_page` block           | `mention`           | per ADR-002 cap `linkTypes: child-page` (see F28) |
| `relation` property          | `mention`           | one Edge per related page |
| `synced_block` original ref  | see Finding 20      | |

**Conflict with ADR-002 vs ADR-003:** ADR-002 Example B declares
`linkTypes: ["mention", "child-page", "relation"]`. ADR-003 §Edge
defines `EdgeType` as `"wikilink" | "frontmatter-ref" | "mention" |
"hyperlink" | "embed"` — no `"child-page"` and no `"relation"`. The
two ADRs disagree (Finding 28).

## 9. `ChangeFeed` interface (ADR-002 §ChangeFeed)

```typescript
class NotionApiChangeFeed implements ChangeFeed {
  readonly handle: SourceHandle;
  subscribe(handler: (e: ChangeEvent) => void): Disposable { … }
  close(): Promise<void> { … }
}
```

### 9.1 Polling loop

- Interval: 60 seconds (default; configurable, see Finding 29 — no ADR
  specifies poll interval).
- Strategy: cursor over `POST /v1/search` sorted by `last_edited_time` desc.
- State (persisted in the adapter's side-table): `(workspace, last_seen_timestamp)`.
- On each tick:
  1. Fetch pages with `last_edited_time > last_seen_timestamp`.
  2. For each page, compare cached content-hash vs current
     `last_edited_time`. If `last_edited_time` advanced → emit `update`.
  3. New pages → emit `create`.
  4. Pages we'd seen that no longer appear in search results → AMBIGUOUS
     (could be deleted, archived, or permissions changed). See Finding 30.
- `rename` events: NEVER emitted (`identityStable: true`; ADR-002
  Example C).

### 9.2 At-least-once semantics

ARCHITECTURE.md §"Adapter tier" specifies "at-least-once change delivery"
and reconciliation via `catchupVault()`. The Notion adapter:

- Persists `last_seen_timestamp` only after the indexer acknowledges the
  emitted batch (else a crash loses events) — see Finding 31. The
  current `ChangeEvent` interface has no ack mechanism.

### 9.3 Webhooks (future)

ADR-002 §"Source-neutrality contract" mentions webhooks "later". Not in
scope for this phase; the adapter ships polling-only.

## 10. Conformance suite (ADR-003 H-1, ADR-002 §Open follow-ups)

Required fixtures under `src/adapters/conformance/fixtures/notion/`:

1. **Hash equivalence (ADR-003 Example B).** A pair of fixtures
   `(obsidian-fs, notion-api)` representing the SAME logical document.
   Test asserts `Document.hash` is byte-identical.
2. **NFC fixture.** Notion-returned text with NFD form. Test asserts
   the adapter normalizes before hashing.
3. **Property-name canonicalization.** Notion `"First Name"` page in
   fixture; obsidian-fs `first_name:` in fixture; same hash.
4. **Lossy round-trip.** Tables and callouts; assert read→write→read
   produces a stable representation (idempotent after one round) even
   if not bytewise identical to the original.
5. **Identity stability.** Simulated title change; assert no `rename`
   event emitted, only `update`.

## 11. Open questions and TODOs at handoff

See `docs/v3/ADVERSARIAL-REVIEW.md` for the 10 findings filed during
this plan. Stop condition reached (10 findings).

The plan above contains TODO marks at the §-points where a finding's
resolution is required to write code. Implementer should not begin
coding until at least findings 1, 4, 7, 11, 12, 14, 15, 18, 27, and 28
are resolved by ADR amendment OR by a "Deferred-v3" entry in the index
that documents the implementer's chosen interpretation.

## See also

- `docs/v2/adr/001-document-identity.md` — DocId grammar.
- `docs/v2/adr/002-adapter-seams.md` — `SourceConnector`,
  `DeliveryAdapter`, `ChangeFeed` interfaces.
- `docs/v2/adr/003-document-shape.md` — `Document`, `BlockNode`,
  `PropertyBag`, hash semantics.
- `docs/v2/adr/004-memory-sink-handles.md` — memory-sink resolution,
  sentinel file, Notion §Example B.
- `docs/v2/MEMORY_CONTRACT.md` — provenance contract.
- `docs/v3/ADVERSARIAL-REVIEW.md` — findings filed by this plan.
