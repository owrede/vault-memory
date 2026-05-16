---
title: Normalized Document Shape
status: Accepted
phase: 0
tags: document-shape, hash, canonicalization, rfc-8785, source-hashes, property-bag
---

# ADR-003: Normalized Document Shape

**Status:** Accepted — Phase 0 foundation
**Date:** 2026-05-14
**Scope:** All assembly tools introduced from Phase 3 onward; the chunker after
its Phase 1 refactor; all adapters
**Depends on:** ADR-001 (Document Identity), ADR-002 (Seams)
**Supersedes:** —
**Superseded by:** —

## Context

Phase 3 onward introduces tools that consume documents at a higher level than
raw chunks: `get_document_bundle`, `get_outline`, `search_sections`,
`assemble_dossier`. Phase 6 (briefs) and Phase 7 (contracts) compose those.

If each tool parses markdown directly, the assembly layer becomes
Obsidian-coupled and the Phase 10 Notion path requires reimplementing every
tool. We need a normalized representation that:

- Obsidian markdown + YAML frontmatter can map into without loss for the cases
  vault-memory cares about (heading hierarchy, paragraphs, lists, code, tables,
  callouts, wikilinks, frontmatter properties).
- Notion blocks + page properties can map into without loss for the same cases.
- Preserves enough structure that `get_outline` returns a real tree rather than
  a flat list.
- Has untyped escape hatches so adapters can pass through source-specific data
  without polluting the canonical shape.

## Decision

A single canonical `Document` type is the unit of exchange between adapters
and the rest of the codebase.

### Top-level shape

```typescript
type DocId = string;          // URI per ADR-001
type SourceHandle = string;   // URI per ADR-002

interface Document {
  id: DocId;
  source: SourceHandle;
  title: string;
  blocks: BlockNode[];        // hierarchical body
  properties: PropertyBag;    // metadata
  links: Edge[];              // outgoing edges; backlinks are queried separately
  mtime: number;              // unix ms
  hash: string;               // content hash; opaque to consumers
  capabilities?: DocumentCapabilities;  // per-doc overrides if any
}
```

`title` is required and adapter-derived. For Obsidian, it defaults to the
filename minus extension unless overridden by frontmatter `title:`. For
Notion, it's the page title.

### `BlockNode` — the body tree

```typescript
type BlockNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | CodeNode
  | TableNode
  | QuoteNode
  | CalloutNode
  | EmbedNode
  | RawNode;

interface BlockBase {
  chunk_id?: string;          // assigned by the chunker during indexing
  anchor?: string;            // adapter-stable anchor for citations
}

interface HeadingNode extends BlockBase {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  children: BlockNode[];      // everything under this heading until the next
                              // heading of equal or higher level
}

interface ParagraphNode extends BlockBase {
  kind: 'paragraph';
  text: string;               // plain text with inline link markers stripped
                              // (see "Inline content" below)
}

interface ListNode extends BlockBase {
  kind: 'list';
  ordered: boolean;
  items: BlockNode[];         // typically ParagraphNode or nested ListNode
}

interface CodeNode extends BlockBase {
  kind: 'code';
  lang?: string;
  text: string;
}

interface TableNode extends BlockBase {
  kind: 'table';
  headers: string[];
  rows: string[][];
}

interface QuoteNode extends BlockBase {
  kind: 'quote';
  children: BlockNode[];
}

interface CalloutNode extends BlockBase {
  kind: 'callout';
  type: string;               // 'info', 'warning', 'tip', 'todo', or adapter-specific
  children: BlockNode[];
}

interface EmbedNode extends BlockBase {
  kind: 'embed';
  target_id: DocId | string;  // DocId if resolvable, raw string if not
}

interface RawNode extends BlockBase {
  kind: 'raw';
  format: string;             // 'markdown', 'html', adapter-specific
  text: string;
}
```

**Hierarchy.** `HeadingNode.children` is **strict**: a level-2 heading
contains everything until the next level-1 or level-2 heading. Non-heading
content before the first heading is held as siblings of the first heading at
the same level (i.e. at the top of `Document.blocks`). The chunker assigns
`chunk_id` per heading-rooted subtree; `get_outline` walks the heading tree
directly.

**The `raw` escape hatch.** Anything an adapter cannot map cleanly (math blocks,
mermaid diagrams, exotic Obsidian plugin syntax, Notion-specific block types
like databases or unfurl previews) becomes a `RawNode` with `format` indicating
the original. Core code does not interpret `RawNode.text`; the chunker may
still index it as searchable text.

**Inline content within paragraphs.** Inline links are extracted into
`Document.links` (as `Edge` objects) during adapter parsing. The text in
`ParagraphNode.text` is the plain reading flow with the link surface text
preserved. There is no inline span model in v2 — markdown bold/italic/code are
not modeled. Rationale: assembly tools need the *content* of the paragraph,
not its styling; styling round-trips through `RawNode` if needed.

### `Edge` — outgoing references

```typescript
type EdgeType =
  | 'wikilink'              // obsidian [[link]]
  | 'frontmatter-ref'       // property whose value is a DocId reference
  | 'mention'               // notion @-mention
  | 'hyperlink'             // markdown [text](url) where url maps to a DocId
  | 'embed';                // [[link]] used as transclusion (obsidian ![[]])

interface Edge {
  from_id: DocId;
  to_id: DocId | string;    // string if unresolved (broken link)
  type: EdgeType;
  anchor?: string;          // heading/block anchor inside the target
  label?: string;           // display text
  source_specific?: Record<string, unknown>;
}
```

`Edge.to_id` is a `string` when the link could not be resolved at index time
(broken wikilink, unresolved mention). The existing `find_broken_links` tool
queries these. Phase 5 (`expand`, `cluster`) consumes only resolved edges.

`Edge.type` is the primary discriminator. Phase 5's `edge_types` filter uses
this directly. Adding a new type (e.g. v3 `cross-source-ref`) does not require
schema migration — types are stored as strings in the edges table.

### `PropertyBag` — typed metadata

```typescript
type PropertyBag = Record<string, PropertyValue>;

type PropertyValue =
  | { type: 'string';    value: string }
  | { type: 'number';    value: number }
  | { type: 'boolean';   value: boolean }
  | { type: 'date';      value: string }       // ISO-8601
  | { type: 'array';     value: PropertyValue[] }
  | { type: 'reference'; value: DocId }
  | { type: 'unknown';   value: unknown };     // untyped fallback
```

**Untyped sources (Obsidian YAML frontmatter).** The `obsidian-fs` adapter
wraps every YAML value as `{type: 'unknown', value: <raw>}` by default. A
later schema-inference pass (already present as `suggest_frontmatter`) can
*promote* untyped values to typed ones based on observed patterns, but core
code MUST tolerate `unknown` everywhere.

**Typed sources (Notion).** Notion has explicit property types (number, date,
multi-select, relation, …). The `notion-api` adapter uses the typed variants
directly. `multi-select` maps to `array of string`. `relation` maps to
`reference`.

**Property access in core code.**

```typescript
const status = doc.properties.status;
if (status?.type === 'string' && status.value === 'authoritative') { … }

// For untyped sources, callers tolerate either typed or untyped:
function getStringProp(p?: PropertyValue): string | undefined {
  if (!p) return undefined;
  if (p.type === 'string') return p.value;
  if (p.type === 'unknown' && typeof p.value === 'string') return p.value;
  return undefined;
}
```

A helper module `src/properties/access.ts` exports these accessors so the
pattern is centralized.

### `DocumentCapabilities` — per-doc overrides

Most capabilities are at the source level. Some are per-doc:

```typescript
interface DocumentCapabilities {
  readonly readOnly?: boolean;    // notion shared/external pages, locked notes
  readonly schema?: string;       // notion database row → schema name
}
```

Optional; defaults from the source. The delivery adapter checks `readOnly`
before any write.

## Implications for existing modules

### `src/chunker/`

The chunker currently consumes raw markdown + headings. After Phase 1 it
consumes `BlockNode[]`. The heading-based chunking algorithm is unchanged —
it just walks the tree instead of re-parsing text. Chunk IDs are still derived
from the heading path + content hash, so they are stable across the refactor.

### `src/graph/`

The graph table stores `Edge` rows. The shape is already close to the existing
wikilinks table; Phase 1 migration renames columns to match the canonical
shape and adds the `type` column (backfilled to `'wikilink'` for existing
rows).

### `src/frontmatter/`

The frontmatter module becomes a thin wrapper around `Document.properties`. The
`query_frontmatter` MCP tool surface is unchanged externally; internally it
queries the `PropertyBag` representation.

### `src/search/`

Search continues to operate on chunks. Chunks now carry references to the
parent `BlockNode` via `chunk_id ↔ anchor`. `search_sections` (Phase 3)
groups chunks by their containing `HeadingNode` and returns the section
subtree, not the chunks.

### The flat-shape `search`/`fetch` adapter

`search` continues to return `{id, title, url, snippet}`. `fetch` continues to
return `{id, title, text, url, metadata}`. The `text` field is rendered from
`Document.blocks` via a `renderToPlainText(blocks)` helper. The `metadata`
field flattens `PropertyBag` into a flat object (typed values unwrap to their
raw `value`; references serialize as their `DocId`). This adapter does not
change shape — it just sits on top of `Document` instead of raw markdown.

## Hash semantics

`Document.hash` is the content fingerprint that downstream systems
(staleness daemon, brief layer, conformance suite) use to decide whether
two `Document` instances are equivalent. It MUST be computable identically
by any adapter — the Phase 1 obsidian-fs adapter (TypeScript), a Phase 10
Notion adapter (TypeScript), and any third-party adapter (Rust/Go/Python)
MUST all produce byte-identical `hash` outputs for the same `Document`
fixture. This is the foundation Phase 5's source-hash staleness daemon
(BRF-05) and the Phase 1 cross-adapter conformance suite (ADP-13) rely on.

In one line: `Document.hash = sha256(canonical(blocks_text) || canonical(PropertyBag))` per RFC 8785. Hand-rolled
"sort keys + minify" is forbidden: three canonicalization failure modes
(number canonicalization, UTF-16 key sort, Unicode NFC normalization)
cause divergent hashes if not handled per the RFC. See `### Failure
modes` below.

**Cost note for fetch-heavy adapters.** Invariant **H-1** requires the
hash to cover *both* `blocks` and `properties`. For adapters whose
backing store returns metadata cheaply but block content expensively
(Notion is the canonical example — page properties via
`/v1/pages/<id>` are one call; full block tree requires recursive
`/v1/blocks/<id>/children`), a literal "every `hash(id)` call refetches
the full body" implementation defeats ADR-002's "cheap relative to
read" framing for `SourceConnector.hash()`. ADR-002 §"Open follow-ups"
grants such adapters permission to maintain an `__adapter_<scheme>_*`
private SQLite cache keyed by `(DocId, last_modified_marker)` with
value `Document.hash`; on cache hit the adapter answers `hash()`
without a body fetch. The cache invalidation key is the same
`last_modified_marker` used in `SourceCapabilities.refHashKind:
'marker'` adapters (see ADR-002 §`DocumentRef.hash` contract). This
keeps H-1 honest without making Phase-5's staleness daemon
(BRF-05) economically infeasible against a multi-thousand-page Notion
workspace.

### Algorithm

```
hash(doc: Document) -> string:
    blocks_text   = render_blocks_to_plain_text(doc.blocks)
                    # Unicode NFC-normalized; LF line endings (no CRLF);
                    # no trailing whitespace on lines; single trailing 0x0A
                    # at end of document forbidden — produce exact bytes.
    props_json    = jcs(doc.properties)
                    # RFC 8785 JSON Canonicalization Scheme:
                    #   - keys sorted by UTF-16 code-unit values
                    #     (after NFC normalization of keys)
                    #   - numbers serialized per ECMAScript
                    #     Number.prototype.toString (IEEE 754, ECMA-262 §7.1.12.1)
                    #   - no insignificant whitespace, no trailing newline
                    #   - strings NFC-normalized
                    #   - booleans/null as "true"/"false"/"null"
    return sha256_hex(utf8(blocks_text || "\n" || props_json))
                    # "||" is byte concatenation; "\n" is a single 0x0A byte;
                    # the separator MUST appear even if either side is empty.
```

`render_blocks_to_plain_text(blocks)` is defined by the canonical renderer
(`src/render/plain-text.ts` in Phase 1): walks the `BlockNode[]` tree in
order, emits paragraph text joined by `"\n\n"`, list items prefixed by
`"- "` per level, headings prefixed by `"# "` × depth, code blocks fenced
with three backticks. The renderer is the single source of truth for
`blocks_text`; adapters MUST NOT bypass it.

### Failure modes (three to get right)

1. **Number canonicalization (IEEE 754 / ECMAScript)** — `42.0` and `42`
   MUST hash identically. RFC 8785 specifies ECMAScript
   `Number.prototype.toString`. Example: `{"x": 1.0}` canonicalizes to
   `{"x":1}`. Naive `JSON.stringify` happens to do this in Node, but
   Python's `json.dumps`, Go's `encoding/json`, and Rust's `serde_json`
   all need explicit IEEE-754 number-formatting helpers (or a JCS library).
2. **Unicode NFC normalization** — input strings (PropertyBag keys AND
   values AND rendered block text) MUST be NFC-normalized before
   serialization. Without this, `"café"` (NFC: U+00E9) and `"café"`
   (NFD: U+0065 U+0301) hash differently. Most-frequently-missed step;
   adapters that ingest user input MUST normalize at the source.
3. **LF line endings** — block text uses LF (0x0A) line separators
   exclusively. CRLF (0x0D 0x0A) is FORBIDDEN. Adapters reading from
   filesystems where files may have been edited on Windows MUST strip
   `\r` before emitting `BlockNode` text.

### Worked example

Document:

```json
{
  "id": "obsidian-fs://atlas/people/Alice.md",
  "title": "Alice Chen",
  "blocks": [{"kind": "paragraph", "text": "CEO of Atlas Robotics."}],
  "properties": {
    "role": {"type": "string", "value": "CEO"},
    "joined": {"type": "date", "value": "2024-03-15"}
  }
}
```

- `blocks_text` = `"CEO of Atlas Robotics."`
- `props_json`  = `{"joined":{"type":"date","value":"2024-03-15"},"role":{"type":"string","value":"CEO"}}`
- input to sha256 = `"CEO of Atlas Robotics.\n{\"joined\":{\"type\":\"date\",\"value\":\"2024-03-15\"},\"role\":{\"type\":\"string\",\"value\":\"CEO\"}}"`
- `hash` = `sha256_hex(<above utf8 bytes>)` — deterministic across
  Node/Python/Rust/Go implementations that follow RFC 8785 + NFC + LF.

The PropertyBag key sort order in `props_json` is `joined` before `role`
because `j` (U+006A) < `r` (U+0072) in UTF-16 code units (also UTF-8 here
since both are ASCII; the UTF-16 vs UTF-8 distinction only matters for
non-ASCII keys).

### Chunk-level `source_hashes` schema

A brief's `source_hashes` property is a map from chunk-URI to chunk hash.
This is finer-grained than per-document `Document.hash` — a brief flips
`status: stale` only when one of its **cited chunks** changes, not when
any unrelated chunk in a source document changes.

```typescript
type ChunkId = string;                       // e.g. "<doc-uri>#chunk-3"
type ChunkHash = string;                     // hex sha256
type SourceHashes = Record<ChunkId, ChunkHash>;
```

Chunk-URI form is `<DocId>#chunk-<n>` where `<n>` is the stable chunk
index assigned by the Phase 1 chunker. The chunk hash is computed via
the same algorithm above, restricted to the chunk's `BlockNode` slice
plus the parent `Document.properties` (so that frontmatter changes
invalidate every chunk per Invariant **H-1**).

#### Example (brief in `_memory/_briefs/`)

```yaml
---
target: project-atlas-q2-review
purpose: prep for 2026-04-15 OKR review
compiled_from:
  - obsidian-fs://atlas/projects/Atlas-1.md
  - obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md
compiled_at: 2026-04-14T18:30:00Z
source_hashes:
  obsidian-fs://atlas/projects/Atlas-1.md#chunk-3: "a3f5b…e9"
  obsidian-fs://atlas/projects/Atlas-1.md#chunk-7: "b1c2d…f4"
  obsidian-fs://atlas/meetings/2026-04-12-atlas-standup.md#chunk-1: "9d8e7…12"
confidence: inferred
status: active
---

# Atlas Q2 Review Brief

(...compiled content...)
```

The staleness daemon (Phase 5, BRF-05) checks each chunk-id against
current source state. If
`obsidian-fs://atlas/projects/Atlas-1.md#chunk-3` re-indexes to a
different hash, the brief flips to `status: stale` and lists that chunk
in `stale_sources`. Frontmatter changes that re-chunk the document mark
every chunk of that document as stale (per Invariant **H-1** — hash
covers `properties`).

## Invariants

- **H-1**: `Document.hash` MUST be computed per the algorithm in
  §Hash semantics. Adapters MUST NOT substitute alternate
  canonicalization. The hash MUST cover both `blocks` and `properties`
  — a frontmatter-only change is still a content change.
- **H-2**: PropertyBag JSON canonicalization MUST follow RFC 8785 (JCS).
  Implementations MAY use a stdlib `JSON.stringify` ONLY when explicitly
  verified byte-identical to RFC 8785 output across the conformance
  test fixtures.
- **H-3**: Input strings — `BlockNode` rendered text, PropertyBag keys,
  and PropertyBag string values — MUST be Unicode NFC-normalized before
  hashing. Adapters MUST normalize at ingest.
- **H-4**: Line endings in rendered block text MUST be LF (0x0A);
  CRLF (0x0D 0x0A) is FORBIDDEN. Adapters reading filesystems that may
  contain CRLF MUST strip `\r` before emitting `BlockNode` text.
- **H-5**: `source_hashes` is a `Record<ChunkId, ChunkHash>` where
  `ChunkId` is `<DocId>#chunk-<n>`. A brief is stale iff any cited
  chunk's currently-indexed `ChunkHash` diverges from its recorded value.
  Briefs with no `source_hashes` map MUST be treated as `status: stale`.
- **H-6**: For adapters that fetch from versioned external APIs (e.g.
  `notion-api` with its `Notion-Version` header), the adapter MUST
  EITHER (a) include the API version it was running against as part of
  the canonical input feeding `hash()` — making version drift a content
  change that flips affected briefs to stale — OR (b) guarantee that
  its parse layer produces bytewise-identical normalized `Document`
  output across the set of supported API versions, and document that
  invariant in its capability descriptor. Option (b) is preferred (it
  avoids false-positive staleness on harmless API revisions), but
  option (a) is the safe default when the adapter cannot prove
  cross-version normalization. The adapter MUST document its choice in
  its README so a Phase-5 staleness-daemon observer can reason about
  the failure mode. Adapters that read from a versionless source (file
  systems, RSS) are exempt — H-6 is vacuously satisfied. The
  `notion-api` adapter ships under option (b): the parse layer
  normalizes `paragraph.rich_text[].plain_text`, `unique_id`,
  `synced_block`, and the other version-sensitive fields away before
  emitting `BlockNode`s, and the conformance suite asserts identical
  hashes across the supported `Notion-Version` set.
- **H-7** *(Phase 3 / slice 03-01 — additive, no changes to H-1..H-6)*:
  A `Section` block aggregates a `HeadingNode` and all `BlockNode`
  descendants up to (but not including) the next equal-or-shallower
  heading. The `anchor` is the sha256 hex of
  `NFC(heading_text) || "\n" || render_blocks_to_plain_text(blocks)`,
  where `"||"` is byte concatenation and `"\n"` is a single 0x0A byte
  (emitted even when either side is empty). The `heading_path` is the
  array of ancestor heading texts (NFC-normalized, root → leaf,
  inclusive of this section's heading). Top-of-document content with
  no preceding heading is wrapped as
  `{kind: "section", level: 0, heading_path: [], heading_text: "",
  anchor: sha256(NFC("") || "\n" || NFC(body))}`. Section anchors are
  the chunk-level `source_hashes` referenced by D-05 — Phase 5 briefs
  consume them directly. NFC normalization of the heading text and
  body is required (per H-3); LF line endings only (per H-4).

## Consequences

### Positive

- Assembly tools have one shape to consume. No markdown parsing outside
  adapters.
- Notion's typed properties survive round-trip through the system.
- Heading hierarchy is a real tree; `get_outline` is a structural query rather
  than a regex pass.
- `RawNode` lets adapters handle exotic content (math, diagrams, embeds)
  without forcing the core to grow new block kinds.

### Negative / costs

- The shape is non-trivial. Adapter authors must implement a parser that
  produces it correctly; the chunker assumes correctness. Phase 1 includes a
  conformance test suite that any new adapter must pass.
- Inline styling is lost. If users want bold/italic preserved in output,
  adapters must use `RawNode` (or we extend the model in a future ADR). This
  is acceptable — vault-memory's job is retrieval, not rendering.
- `PropertyValue` discriminated union is verbose. The `src/properties/access.ts`
  helpers make this tolerable.

### Open follow-ups

- **Inline spans.** If a future use case (e.g. preserving citations within a
  paragraph for legal applications) demands inline structure, extend
  `ParagraphNode` with an optional `spans: InlineSpan[]` field. v2 ships
  without it.
- **Table semantics.** `TableNode` currently models a simple grid of strings.
  Notion tables can have typed columns and per-cell content blocks. For v2
  we accept lossy round-trip; for v3 revisit.
- **Embed resolution.** `EmbedNode.target_id` may be a `DocId` or a raw URL.
  For obsidian-fs, transclusions (`![[…]]`) resolve to DocIds. For Notion,
  embedded media may be external URLs. Treat URLs as `string` in `target_id`;
  consumers branch.

## Examples

### Example A: Obsidian-fs round-trip with explicit hash input

Source note `atlas/people/Alice.md` (CRLF stripped at ingest per **H-4**):

```markdown
---
role: CEO
joined: 2024-03-15
---

CEO of Atlas Robotics.
```

Produced `Document`:

```json
{
  "id": "obsidian-fs://atlas/people/Alice.md",
  "source": "obsidian-fs://atlas",
  "title": "Alice Chen",
  "blocks": [{"kind": "paragraph", "text": "CEO of Atlas Robotics."}],
  "properties": {
    "role":   {"type": "string", "value": "CEO"},
    "joined": {"type": "date",   "value": "2024-03-15"}
  },
  "links": [],
  "mtime": 1715600000000,
  "hash":  "<sha256-hex below>"
}
```

Hash inputs (literal):

- `blocks_text` (NFC, LF-only, no trailing whitespace):
  `CEO of Atlas Robotics.`
- `props_json` (RFC 8785 — keys sorted by UTF-16 code units; `joined` < `role`):
  `{"joined":{"type":"date","value":"2024-03-15"},"role":{"type":"string","value":"CEO"}}`
- sha256 input (UTF-8 bytes, `||` is byte concatenation, single 0x0A separator):
  `CEO of Atlas Robotics.\n{"joined":{"type":"date","value":"2024-03-15"},"role":{"type":"string","value":"CEO"}}`
- `Document.hash` = `sha256_hex(<those bytes>)`

Any Phase 1 obsidian-fs adapter implementation that produces a different
hex string for this exact `Document` is broken per **H-1**.

### Example B: Notion-api round-trip — identical hash, different adapter

The same logical document, retrieved from a Notion workspace and converted
by a Phase 10 `notion-api` adapter:

Notion page (abridged JSON from `/v1/pages/<id>` + `/v1/blocks/<id>/children`):

```json
{
  "object": "page",
  "id": "4f1c…a9",
  "properties": {
    "Name":   {"title":  [{"plain_text": "Alice Chen"}]},
    "Role":   {"rich_text": [{"plain_text": "CEO"}]},
    "Joined": {"date":  {"start": "2024-03-15"}}
  },
  "children": [
    {"type":"paragraph", "paragraph": {"rich_text":[{"plain_text":"CEO of Atlas Robotics."}]}}
  ]
}
```

Adapter-produced `Document`:

```json
{
  "id": "notion-api://atlas-workspace/4f1c…a9",
  "source": "notion-api://atlas-workspace",
  "title": "Alice Chen",
  "blocks": [{"kind": "paragraph", "text": "CEO of Atlas Robotics."}],
  "properties": {
    "role":   {"type": "string", "value": "CEO"},
    "joined": {"type": "date",   "value": "2024-03-15"}
  },
  "links": [],
  "mtime": 1715600000000,
  "hash":  "<sha256-hex — identical to Example A>"
}
```

Key normalization rules the Notion adapter MUST follow to land at the
same hash:

1. PropertyBag keys are **canonical lowercase**: Notion `"Name"` →
   `title` (consumed into `Document.title`, not `properties`); Notion
   `"Role"` → `role`; Notion `"Joined"` → `joined`. The adapter is
   responsible for the mapping; the conformance suite asserts the
   resulting `properties` is byte-identical to the obsidian-fs version.
2. PropertyValue type tags are canonical (`string`, `date`,
   `reference`, …) — not Notion-specific (`rich_text`, `relation`, …).
3. The `id` and `source` URIs differ by scheme (`obsidian-fs://` vs
   `notion-api://`), but `id`/`source`/`mtime` are NOT part of the
   `hash` input (the algorithm hashes only `blocks_text` + `props_json`).
   Two adapters producing equivalent canonical `blocks`+`properties`
   from different source URIs MUST land at the same hash. This is the
   property the Phase 1 ADP-13 conformance suite asserts.

### Example C: Chunk source-hashes citation packet

A brief compiled from both an obsidian-fs and a notion-api source
demonstrates **H-5** across schemes:

```yaml
---
target: cross-source-q2-roundup
compiled_from:
  - obsidian-fs://atlas/projects/Atlas-1.md
  - notion-api://atlas-workspace/4f1c…a9
compiled_at: 2026-05-14T10:00:00Z
source_hashes:
  obsidian-fs://atlas/projects/Atlas-1.md#chunk-3: "a3f5b…e9"
  notion-api://atlas-workspace/4f1c…a9#chunk-1:    "c2d1e…77"
confidence: inferred
status: active
---
```

Phase 5's staleness daemon evaluates both citations identically — it
does not branch on URI scheme. The Phase 1 conformance suite (ADP-13)
ensures `ChunkHash` outputs are byte-equal across adapters for
equivalent chunk content, so an `obsidian-fs` mirror of the Notion
page would yield the same `ChunkHash`.

## Alternatives considered

### (a) Keep raw markdown as the body; parse on demand

Rejected. Every consumer reimplements parsing. Notion has no markdown source —
forcing a markdown serialization at the adapter boundary is a lossy round-trip
that throws away information consumers want.

### (b) Adopt mdast (the unified ecosystem AST)

Considered. mdast is well-specified for markdown, but:
- It encodes too much (inline emphasis, HTML, etc.) that vault-memory does not
  need.
- It has no concept of "blocks with chunk IDs" or "blocks with anchors" — we'd
  augment it heavily.
- It has no obvious mapping to Notion blocks; we'd build a translator anyway.

Rejected. The custom shape is smaller and fits the use cases better. We can
adopt mdast for *parsing within the obsidian-fs adapter* as an implementation
detail — translating mdast → our `BlockNode[]` — without exposing mdast
elsewhere.

### (c) Adopt Notion's block schema as canonical

Rejected. Notion-block-shaped types in core would be jarring for Obsidian-only
users and would couple us to Notion's API revisions.

### (d) Use ProseMirror's schema

Rejected for the same reasons as mdast — too much surface, designed for
editing not retrieval.

### (e) Flat array of blocks; no hierarchy

Considered (and is closer to Notion's native model). Rejected: `get_outline`
becomes a tree-reconstruction problem from a flat list. The hierarchical model
is a better fit for the retrieval-unit selection that Phase 3 enables
("return this section, not chunks of it"). Adapters whose native model is
flat (Notion) reconstruct hierarchy from heading blocks during parsing — the
same operation `get_outline` would otherwise do at query time.
