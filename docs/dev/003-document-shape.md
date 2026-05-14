# ADR-003: Normalized Document Shape

**Status:** Proposed — Phase 0 foundation
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
