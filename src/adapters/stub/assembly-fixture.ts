/**
 * Phase 3 / 03-07 — purpose-built `Document[]` fixture for ASM-12
 * source-neutrality conformance.
 *
 * The Phase 3 assembly tools (`get_outline`, `search_sections`,
 * `get_document_bundle`, `assemble_dossier`) must produce
 * shape-identical responses against `StubSource` and `ObsidianFsSource`.
 * The existing `makeStubDocs()` fixture inside `conformance.test.ts`
 * is three trivial documents used to assert the SourceConnector
 * surface — it is NOT content-rich enough to exercise the assembly
 * tools' contracts. This fixture is the small, hand-curated
 * `Document[]` that closes that gap (per RESEARCH §7).
 *
 * Coverage:
 *   - Person doc with `aliases` (D-04 alias-match case).
 *   - Authoritative Project doc (D-06 authority signal).
 *   - Superseded Project doc (ASM-08 default-hide, with
 *     `superseded_by` pointing at the authoritative doc).
 *   - Meeting doc with `frontmatter-ref`-shaped edge (forward-compat
 *     marker for Phase 4 typed edges).
 *   - Doc with `wikilink` edge to alice (v1 wikilinks table — the
 *     ONLY edge type exercised by v2.0.0 assembly tools).
 *   - Doc with `mention` edge to alice (forward-compat for Phase 4).
 *   - Doc with `hyperlink` edge to alice (forward-compat for Phase 4).
 *   - Multi-section Long doc for `get_outline` + `search_sections`.
 *
 * Adapter-seam discipline: this file lives in `src/adapters/stub/`
 * (the adapter tier) so it MAY import branded-DocId helpers from the
 * registry. It does NOT import from `src/assembly/` or any L0 search
 * substrate — the fixture is consumed BY the conformance tests, not
 * by adapter implementations.
 *
 * Forward-compat note on `relation`: v2.0.0 `assemble_dossier`
 * surfaces `relation: "wikilink"` only because the v1 wikilinks table
 * is the only edge source available. The fixture includes
 * non-wikilink edges so Phase 4 (GRA-04 typed edges) can light them
 * up additively without a fixture rewrite — the conformance assertion
 * for v2.0.0 pins `relation === "wikilink"` and ignores non-wikilink
 * edges in the dossier-anchor backlinks. Mention/hyperlink/frontmatter-ref
 * edges currently DO NOT appear in `assemble_dossier`'s
 * `linked_documents` output (they live in `Document.links` but are
 * not read by `listBacklinks`).
 */

import type { Document } from "../../types.js";
import { formatDocId, parseSourceHandle } from "../registry.js";

const SOURCE = parseSourceHandle("stub://memory");

/** The DocId for the "Alice" person doc — exported so tests can target it. */
export const ALICE_DOC_ID = formatDocId("stub", "memory", "people/alice.md");
/** The DocId for the authoritative Atlas-1 Project doc. */
export const ATLAS_1_DOC_ID = formatDocId("stub", "memory", "projects/atlas-1.md");
/** The DocId for the superseded Atlas-0 Project doc. */
export const ATLAS_0_DOC_ID = formatDocId("stub", "memory", "projects/atlas-0.md");
/** The DocId for the multi-section Long doc (used by get_outline tests). */
export const LONG_DOC_ID = formatDocId("stub", "memory", "long.md");
/** The DocId for the Q2 Review Meeting doc (frontmatter-ref edge case). */
export const Q2_REVIEW_DOC_ID = formatDocId("stub", "memory", "meetings/2026-04-15.md");
/** The DocId for the sync notes doc — wikilinks to alice. */
export const SYNC_DOC_ID = formatDocId("stub", "memory", "notes/sync.md");

/**
 * Build the ~8-document assembly fixture. Returns a fresh array each
 * call so tests can mutate freely.
 *
 * mtimes are spread by 1000ms ascending so the order is deterministic
 * and recency math is sensible if a test exercises it. Hashes are
 * fixed-byte stubs (`0xNNNN...`) — adapters never re-hash, so the
 * stubbed values flow straight through to the citation packet.
 */
export function makeAssemblyStubDocs(): Document[] {
  return [
    // ── 1. Alice — Person doc with aliases (D-04 alias-match path) ──
    {
      id: ALICE_DOC_ID,
      source: SOURCE,
      title: "Alice",
      blocks: [
        { kind: "heading", level: 1, text: "Alice" },
        { kind: "paragraph", text: "CEO since 2024. Founded the company." },
        { kind: "heading", level: 2, text: "Working style" },
        { kind: "paragraph", text: "Async-first communication; weekly 1:1s." },
      ],
      properties: {
        type: "Person",
        aliases: ["Alice C.", "ac"],
        status: "active",
      },
      links: [],
      mtime: 1_700_000_000_000,
      hash: "0xa11ce000000000000000000000000000000000000000000000000000000000a1",
    },

    // ── 2. Atlas-1 — authoritative Project (D-06 authority signal) ──
    {
      id: ATLAS_1_DOC_ID,
      source: SOURCE,
      title: "Atlas-1",
      blocks: [
        { kind: "heading", level: 1, text: "Atlas-1" },
        { kind: "paragraph", text: "Flagship robotics project." },
      ],
      properties: {
        type: "Project",
        status: "active",
        authoritative: true,
        owner: "alice",
      },
      links: [],
      mtime: 1_700_000_001_000,
      hash: "0xa71a51000000000000000000000000000000000000000000000000000000a71a",
    },

    // ── 3. Atlas-0 — superseded Project (ASM-08 default-hide) ──
    {
      id: ATLAS_0_DOC_ID,
      source: SOURCE,
      title: "Atlas-0",
      blocks: [
        { kind: "heading", level: 1, text: "Atlas-0" },
        { kind: "paragraph", text: "Predecessor of Atlas-1; deprecated." },
      ],
      properties: {
        type: "Project",
        status: "superseded",
        superseded_by: ATLAS_1_DOC_ID,
      },
      links: [],
      mtime: 1_700_000_002_000,
      hash: "0xa71a50000000000000000000000000000000000000000000000000000000a71a",
    },

    // ── 4. Q2 Review Meeting — frontmatter-ref edge (Phase 4 forward-compat) ──
    {
      id: Q2_REVIEW_DOC_ID,
      source: SOURCE,
      title: "Q2 Review",
      blocks: [
        { kind: "heading", level: 1, text: "Q2 Review" },
        { kind: "paragraph", text: "OKR rewrite meeting." },
      ],
      properties: {
        type: "Meeting",
        attendees: ["Alice", "Bob"],
      },
      // Phase 4 typed-edge: v2.0.0 dossier ignores non-wikilink edges.
      links: [{ type: "frontmatter-ref", target: ALICE_DOC_ID }],
      mtime: 1_700_000_003_000,
      hash: "0xfeedface00000000000000000000000000000000000000000000000000feedfa",
    },

    // ── 5. Sync notes — wikilink to alice (THE v2.0.0 edge source) ──
    {
      id: SYNC_DOC_ID,
      source: SOURCE,
      title: "Sync notes",
      blocks: [
        { kind: "heading", level: 1, text: "Sync notes" },
        { kind: "paragraph", text: "Weekly sync touched [[Alice]] and Atlas-1." },
      ],
      properties: {
        type: "Note",
        // The fixture's `wikilinks` property mirrors what the obsidian-fs
        // source adapter populates (per D-05). Conformance assertions
        // read backlinks via the v1 `wikilinks` table, populated by the
        // `indexStubAssembly` helper in the test harness.
        wikilinks: [{ target: "alice" }],
      },
      links: [{ type: "wikilink", target: ALICE_DOC_ID }],
      mtime: 1_700_000_004_000,
      hash: "0x57c0000000000000000000000000000000000000000000000000000000005700",
    },

    // ── 6. Mention doc — Phase 4 forward-compat marker ──
    {
      id: formatDocId("stub", "memory", "notes/mention.md"),
      source: SOURCE,
      title: "Mention",
      blocks: [
        { kind: "heading", level: 1, text: "Mention" },
        { kind: "paragraph", text: "Mentions @alice without a wikilink." },
      ],
      properties: { type: "Note" },
      links: [{ type: "mention", target: ALICE_DOC_ID }],
      mtime: 1_700_000_005_000,
      hash: "0x4e7100000000000000000000000000000000000000000000000000000000004e",
    },

    // ── 7. Hyperlink doc — Phase 4 forward-compat marker ──
    {
      id: formatDocId("stub", "memory", "notes/hyperlink.md"),
      source: SOURCE,
      title: "Hyperlink",
      blocks: [
        { kind: "heading", level: 1, text: "Hyperlink" },
        { kind: "paragraph", text: "External link to alice's page." },
      ],
      properties: { type: "Note" },
      links: [{ type: "hyperlink", target: ALICE_DOC_ID }],
      mtime: 1_700_000_006_000,
      hash: "0x4e7700000000000000000000000000000000000000000000000000000000004e",
    },

    // ── 8. Long doc — multi-section for get_outline + search_sections ──
    {
      id: LONG_DOC_ID,
      source: SOURCE,
      title: "Long",
      blocks: [
        { kind: "heading", level: 1, text: "Intro" },
        { kind: "paragraph", text: "Document introduction text here." },
        { kind: "heading", level: 2, text: "Background" },
        { kind: "paragraph", text: "Some background context for the reader." },
        { kind: "heading", level: 2, text: "Conclusion" },
        { kind: "paragraph", text: "Concluding remarks; references Working style guide." },
      ],
      properties: { type: "Note" },
      links: [],
      mtime: 1_700_000_007_000,
      hash: "0x10c000000000000000000000000000000000000000000000000000000000010c",
    },
  ];
}

/**
 * Sanity check: every Document in the fixture has a structurally valid
 * shape. Used in the assembly-fixture.test.ts sibling test as a guard
 * against regressions in the hand-curated content.
 *
 * Returns the list of human-readable errors, empty when valid.
 */
export function validateAssemblyStubDocs(docs: Document[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const d of docs) {
    if (!d.id) errors.push(`Document with title=${JSON.stringify(d.title)} has no id`);
    if (ids.has(d.id)) errors.push(`Duplicate DocId in fixture: ${d.id}`);
    ids.add(d.id);
    if (!d.source) errors.push(`Document ${d.id} has no source`);
    if (typeof d.title !== "string") errors.push(`Document ${d.id} title is not a string`);
    if (!Array.isArray(d.blocks)) errors.push(`Document ${d.id} blocks is not an array`);
    if (typeof d.properties !== "object" || d.properties === null) {
      errors.push(`Document ${d.id} properties is not an object`);
    }
    if (!Array.isArray(d.links)) errors.push(`Document ${d.id} links is not an array`);
    if (typeof d.mtime !== "number") errors.push(`Document ${d.id} mtime is not a number`);
    if (typeof d.hash !== "string" || d.hash.length === 0) {
      errors.push(`Document ${d.id} hash is missing or empty`);
    }
  }
  return errors;
}

/**
 * Helper: extract markdown-equivalent content from a Document's blocks.
 * Used by the test harness's `indexStubAssembly()` to feed the
 * indexer's `buildSectionsForNote` pipeline, which expects raw
 * markdown text. The mapping is structural — heading levels and
 * paragraph text only; other BlockNode kinds project as their textual
 * payload.
 *
 * Exported for the test harness; not part of the SourceConnector
 * contract.
 */
export function blocksToMarkdown(blocks: Document["blocks"]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "heading":
        parts.push(`${"#".repeat(b.level)} ${b.text}`);
        break;
      case "paragraph":
        parts.push(b.text);
        break;
      case "code":
        parts.push(`\`\`\`${b.lang ?? ""}\n${b.text}\n\`\`\``);
        break;
      case "list":
        for (const item of b.items) {
          parts.push(b.ordered ? `1. ${item}` : `- ${item}`);
        }
        break;
      case "section":
        // Section blocks aren't used in the assembly fixture (we use
        // flat heading/paragraph blocks so the indexer's section
        // extractor builds the tree from the heading hierarchy).
        // Recurse defensively in case a future fixture adds them.
        parts.push(blocksToMarkdown(b.blocks));
        break;
    }
  }
  return parts.join("\n\n");
}
