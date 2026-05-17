/**
 * Tests for `getDocumentBundle` (ASM-01, Plan 03-04).
 *
 * Strategy mirrors outline.test.ts + dossier.test.ts: build an
 * in-memory SQLite via `Database`, seed notes / sections / chunks /
 * wikilinks / audit_log rows directly, inject a stub `manager` + stub
 * `SourceConnector` that returns canned `Document` objects so the
 * body-snippet path is deterministic.
 *
 * Pinned behaviors (per plan §"Files to create" — cases (a) through (g)):
 *   (a) doc with backlinks + forward links → both returned, each entry
 *       carries a full 8-field CitationPacket + property_snippet +
 *       relation: "wikilink".
 *   (b) doc with no backlinks → backlinks: [].
 *   (c) recent_edits capped at 10 even when audit_log has 50 entries.
 *   (d) unknown doc_id → DocNotFoundError (server dispatch wraps this
 *       into {isError:true, error:"doc_not_found", doc_id}).
 *   (e) outline tree populated via buildOutlineTree from the sections
 *       table (delegates to 03-02's helper).
 *   (f) backlinks carry property_snippet (first 200 chars of plain-text
 *       body — stripped of frontmatter via the Document.blocks /
 *       Document.properties split).
 *   (g) is_memory_sink_write flag surfaces on recent_edits ONLY when
 *       the writing client was the memory subsystem (truthy-only — the
 *       wire shape omits the field when false to stay compact).
 *
 * Plus invariant checks pinned by acceptance criteria:
 *   - Anchor packet has all 8 required CitationPacket fields.
 *   - Anchor carries `status` / `superseded_by` when present in
 *     frontmatter (proves the 03-05 hydration-path dependency works at
 *     the type level).
 *   - Every backlink / forward-link entry has properties: object (never
 *     undefined) — per Phase 2 CitationPacket contract.
 *   - Malformed doc_id, unknown vault, vault-filter exclusion, missing
 *     note row all map to DocNotFoundError.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSourceHandle } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { Database } from "../db/index.js";
import type { DocId, Document, InsertSectionRow, SourceHandle } from "../types.js";
import { VaultManager, type Vault } from "../vault/index.js";
import { DocNotFoundError } from "./outline.js";
import { getDocumentBundle } from "./bundle.js";

const VAULT_NAME = "test-vault";

// ─── fixture builder ─────────────────────────────────────────────────────────

interface FixtureNoteSpec {
  notePath: string;
  title: string;
  /** YAML frontmatter (becomes Document.properties; also stored as JSON in notes.frontmatter). */
  frontmatter: Record<string, unknown>;
  /** Plain-text body (becomes Document.blocks = [{kind:"paragraph",text:body}]). */
  body?: string;
  hash?: string;
  mtime?: number;
}

interface FixtureLinkSpec {
  sourcePath: string;
  targetPath: string;
}

interface FixtureAuditSpec {
  notePath: string;
  op: "create" | "update" | "delete";
  clientId?: string | null;
  isMemorySinkWrite?: boolean;
}

interface Fixture {
  vault: Vault;
  manager: VaultManager;
  notesByPath: Map<string, FixtureNoteSpec>;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  /** Look up the seeded note row's id by path — useful for sections seeding. */
  idByPath: Map<string, number>;
  /** Synthesize a doc-id from a path inside this fixture vault. */
  docIdFor: (notePath: string) => string;
  cleanup: () => void;
}

function buildFixture(
  notes: FixtureNoteSpec[],
  links: FixtureLinkSpec[] = [],
  audits: FixtureAuditSpec[] = [],
): Fixture {
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: "/fake/vault/path", write_enabled: false },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  const notesByPath = new Map<string, FixtureNoteSpec>();
  const idByPath = new Map<string, number>();
  const now = Date.now();
  for (const spec of notes) {
    notesByPath.set(spec.notePath, spec);
    const result = vault.db.notes.upsertByPath({
      path: spec.notePath,
      content: spec.body ?? spec.title,
      frontmatter: JSON.stringify(spec.frontmatter),
      title: spec.title,
      hash: spec.hash ?? `hash-${spec.notePath}`,
      bodyHash: `bhash-${spec.notePath}`,
      mtime: spec.mtime ?? now,
      wordCount: 1,
      vaultName: VAULT_NAME,
    });
    idByPath.set(spec.notePath, result.id);
  }

  // Seed wikilinks rows so listBacklinks / listForwardLinks return the
  // expected source / target sets. Mirrors dossier.test.ts seeding.
  const linksBySource = new Map<string, FixtureLinkSpec[]>();
  for (const link of links) {
    if (!idByPath.has(link.sourcePath)) {
      throw new Error(`fixture link.sourcePath missing from notes: ${link.sourcePath}`);
    }
    if (!idByPath.has(link.targetPath)) {
      throw new Error(`fixture link.targetPath missing from notes: ${link.targetPath}`);
    }
    if (!linksBySource.has(link.sourcePath)) linksBySource.set(link.sourcePath, []);
    linksBySource.get(link.sourcePath)?.push(link);
  }
  for (const [sourcePath, group] of linksBySource) {
    const sourceId = idByPath.get(sourcePath) as number;
    vault.db.wikilinks.insertBatch(
      sourceId,
      group.map((g, idx) => ({
        targetPath: g.targetPath,
        targetNoteId: idByPath.get(g.targetPath) ?? null,
        linkText: g.targetPath,
        anchor: null,
        lineNumber: idx + 1,
      })),
    );
  }

  // Seed audit rows for the recent_edits tests. Inserted in declaration
  // order; the AuditQueries listWrites query orders by id DESC (newest
  // first) so callers can predict which entries appear at the top.
  for (const a of audits) {
    const noteId = idByPath.get(a.notePath);
    if (noteId === undefined) {
      throw new Error(`fixture audit.notePath missing from notes: ${a.notePath}`);
    }
    vault.db.audit.recordWrite({
      noteId,
      op: a.op,
      previousHash: null,
      newHash: `audit-${a.notePath}-${a.op}`,
      expectedHash: null,
      clientId: a.clientId ?? null,
      diffSummary: null,
      isMemorySinkWrite: a.isMemorySinkWrite ?? false,
    });
  }

  // Stub SourceConnector — synthesizes a single-paragraph Document
  // from the seeded spec so body-snippet rendering is deterministic.
  const source: SourceHandle = parseSourceHandle(`obsidian-fs://${VAULT_NAME}`);
  const sourceConnectorFor = (_vaultName: string): SourceConnector => ({
    handle: source,
    capabilities: {
      bodyShape: "flat-text",
      properties: "untyped",
      linkTypes: [],
      identityStable: true,
      permissions: false,
      contentHashStable: true,
      refHashKind: "content",
      watch: "push",
    },
    listDocuments: async function* () {
      // not used by getDocumentBundle
    },
    readDocument: async (id: DocId): Promise<Document> => {
      for (const [notePath, spec] of notesByPath) {
        if (id.endsWith(`/${notePath}`)) {
          return {
            id,
            source,
            title: spec.title,
            // Single flat-text paragraph — matches obsidian-fs adapter's
            // `bodyShape: "flat-text"` contract.
            blocks: [{ kind: "paragraph", text: spec.body ?? spec.title }],
            properties: { ...spec.frontmatter },
            links: [],
            mtime: spec.mtime ?? now,
            hash: spec.hash ?? `hash-${notePath}`,
          };
        }
      }
      throw new Error(`Doc not found: ${id}`);
    },
    hash: async (id: DocId) => {
      for (const [notePath, spec] of notesByPath) {
        if (id.endsWith(`/${notePath}`)) return spec.hash ?? `hash-${notePath}`;
      }
      throw new Error(`Doc not found: ${id}`);
    },
    exists: async (id: DocId) => {
      for (const notePath of notesByPath.keys()) {
        if (id.endsWith(`/${notePath}`)) return true;
      }
      return false;
    },
    // Mirror the obsidian-fs URL convention without importing the adapter.
    formatDisplayUrl: (id: DocId): string => {
      const schemeEnd = (id as string).indexOf("://");
      const rest = (id as string).slice(schemeEnd + 3);
      const slashIdx = rest.indexOf("/");
      const vaultName = rest.slice(0, slashIdx);
      const resource = rest.slice(slashIdx + 1);
      return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(resource)}`;
    },
  });

  const docIdFor = (notePath: string): string =>
    `obsidian-fs://${VAULT_NAME}/${notePath}`;

  return {
    vault,
    manager,
    notesByPath,
    sourceConnectorFor,
    idByPath,
    docIdFor,
    cleanup: () => {
      db.close();
    },
  };
}

// Convenience: build an InsertSectionRow with sensible defaults. Copied
// from outline.test.ts to keep this test file self-contained.
function sectionRow(
  noteId: number,
  overrides: Partial<InsertSectionRow> & Pick<InsertSectionRow, "anchor" | "heading_text">,
): InsertSectionRow {
  return {
    note_id: noteId,
    anchor: overrides.anchor,
    heading_path:
      overrides.heading_path ??
      JSON.stringify(overrides.heading_text === "" ? [] : [overrides.heading_text]),
    heading_text: overrides.heading_text,
    level: overrides.level ?? 1,
    parent_id: overrides.parent_id ?? null,
    ord: overrides.ord ?? 0,
    chunk_id_first: overrides.chunk_id_first ?? null,
    chunk_id_last: overrides.chunk_id_last ?? null,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("getDocumentBundle — composition: anchor + outline + links + recent edits", () => {
  let fx: Fixture;

  beforeEach(() => {
    // Three-note fixture: A links to B; B links to C.
    // B is the anchor: 1 backlink (A), 1 forward link (C).
    const notes: FixtureNoteSpec[] = [
      {
        notePath: "a.md",
        title: "Note A",
        frontmatter: { title: "Note A", type: "Note" },
        body: "A is the source — it links to B with content that should appear in the snippet field when this document is surfaced as a backlink of B.",
      },
      {
        notePath: "b.md",
        title: "Note B",
        // B has status: superseded in frontmatter to prove the
        // ASM-06 hydration path on the anchor packet (separate test).
        frontmatter: { title: "Note B", type: "Note", status: "active" },
        body: "B is the anchor — has both inbound and outbound links.",
      },
      {
        notePath: "c.md",
        title: "Note C",
        frontmatter: { title: "Note C", type: "Note" },
        body: "C is the forward-link target — its body should appear as the property_snippet when surfaced as a forward link from B.",
      },
    ];
    const links: FixtureLinkSpec[] = [
      { sourcePath: "a.md", targetPath: "b.md" },
      { sourcePath: "b.md", targetPath: "c.md" },
    ];
    fx = buildFixture(notes, links);
  });

  afterEach(() => {
    fx.cleanup();
  });

  // (a) Doc with backlinks + forward links: both returned with full
  //     citation packets, property_snippet, and relation: "wikilink".
  it("(a) doc with backlinks + forward links → both populated, every entry has 8-field CitationPacket", async () => {
    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("b.md") },
    );

    expect(out.backlinks).toHaveLength(1);
    expect(out.forward_links).toHaveLength(1);

    // Backlink shape: a.md → b.md
    const bl = out.backlinks[0]!;
    expect(bl.doc_id).toBe(fx.docIdFor("a.md"));
    expect(bl.title).toBe("Note A");
    expect(bl.relation).toBe("wikilink");
    // Full 8-field CitationPacket: doc_id, source_handle, title,
    // heading_path, mtime, hash, display_url, properties.
    expect(bl.doc_id).toBeDefined();
    expect(bl.source_handle).toBeDefined();
    expect(bl.title).toBeDefined();
    expect(bl.heading_path).toEqual([]);
    expect(typeof bl.mtime).toBe("number");
    expect(typeof bl.hash).toBe("string");
    expect(typeof bl.display_url).toBe("string");
    expect(bl.properties).toBeDefined();
    expect(typeof bl.properties).toBe("object");
    expect(bl.property_snippet.length).toBeGreaterThan(0);

    // Forward link shape: b.md → c.md
    const fl = out.forward_links[0]!;
    expect(fl.doc_id).toBe(fx.docIdFor("c.md"));
    expect(fl.title).toBe("Note C");
    expect(fl.relation).toBe("wikilink");
    expect(fl.heading_path).toEqual([]);
    expect(fl.properties).toBeDefined();
    expect(typeof fl.properties).toBe("object");
    expect(fl.property_snippet.length).toBeGreaterThan(0);
  });

  // (b) Doc with no backlinks (the leaf in the graph) → backlinks: [].
  it("(b) doc with no backlinks → backlinks: []", async () => {
    // c.md has one inbound (from b.md) and zero outbound links.
    // Use a.md instead — A has no inbound links.
    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("a.md") },
    );
    expect(out.backlinks).toEqual([]);
    // a.md has one forward link (to b.md).
    expect(out.forward_links).toHaveLength(1);
    expect(out.forward_links[0]?.title).toBe("Note B");
  });

  // (e) Outline tree delegates to buildOutlineTree from 03-02. Seed two
  //     sections on b.md and check they appear at the bundle's
  //     `outline` field.
  it("(e) outline tree populated from sections table (delegates to buildOutlineTree)", async () => {
    const bNoteId = fx.idByPath.get("b.md")!;
    fx.vault.db.sections.insertMany([
      sectionRow(bNoteId, { anchor: "s1", heading_text: "Intro", level: 1, ord: 0 }),
      sectionRow(bNoteId, { anchor: "s2", heading_text: "Body", level: 1, ord: 1 }),
    ]);

    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("b.md") },
    );

    expect(out.outline).toHaveLength(2);
    expect(out.outline.map((n) => n.heading_text)).toEqual(["Intro", "Body"]);
    expect(out.outline.every((n) => n.level === 1)).toBe(true);
  });

  // (f) Backlinks carry property_snippet (first 200 chars of plain-text
  //     body — frontmatter already separated out by Document.properties
  //     so no manual strip is needed).
  it("(f) backlinks carry property_snippet (≤200 chars body plain-text, no frontmatter)", async () => {
    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("b.md") },
    );

    const snippet = out.backlinks[0]?.property_snippet ?? "";
    expect(snippet.length).toBeGreaterThan(0);
    expect(snippet.length).toBeLessThanOrEqual(200);
    // a.md's seeded body — first segment must appear (no leakage of
    // "title:" or frontmatter values like "Note A" YAML keys).
    expect(snippet).toContain("A is the source");
    expect(snippet).not.toMatch(/---/);
    expect(snippet).not.toContain("type: Note");
  });

  it("(f) property_snippet truncates to 200 chars when body is longer", async () => {
    // Build a fixture with a very long body and assert truncation.
    const longBody = "lorem ipsum dolor sit amet ".repeat(50); // ~1350 chars
    fx.cleanup();
    fx = buildFixture(
      [
        {
          notePath: "long.md",
          title: "Long",
          frontmatter: { title: "Long" },
          body: longBody,
        },
        {
          notePath: "anchor.md",
          title: "Anchor",
          frontmatter: { title: "Anchor" },
          body: "anchor body",
        },
      ],
      [{ sourcePath: "long.md", targetPath: "anchor.md" }],
    );

    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("anchor.md") },
    );

    expect(out.backlinks[0]?.property_snippet.length).toBe(200);
  });
});

describe("getDocumentBundle — recent_edits semantics", () => {
  let fx: Fixture;
  afterEach(() => fx?.cleanup());

  // (c) recent_edits capped at RECENT_EDITS_LIMIT (10) even when the
  //     audit_log has more entries.
  it("(c) recent_edits capped at 10 even when audit_log has 50 entries", async () => {
    // Seed 50 audit rows on b.md so the cap is exercised.
    const audits: FixtureAuditSpec[] = [];
    for (let i = 0; i < 50; i++) {
      audits.push({ notePath: "b.md", op: "update" });
    }
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A", frontmatter: {} },
        { notePath: "b.md", title: "B", frontmatter: {} },
      ],
      [{ sourcePath: "a.md", targetPath: "b.md" }],
      audits,
    );

    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("b.md") },
    );
    expect(out.recent_edits).toHaveLength(10);
    // Every entry has the documented wire shape — only `at`, `op`,
    // `client_id`, and the optional `is_memory_sink_write` flag.
    for (const e of out.recent_edits) {
      expect(typeof e.at).toBe("number");
      expect(["create", "update", "delete"]).toContain(e.op);
      expect(e.client_id === null || typeof e.client_id === "string").toBe(true);
    }
  });

  // (g) is_memory_sink_write flag surfaces on recent_edits when the
  //     writing client was the memory subsystem. Truthy-only — the
  //     wire shape omits the field on regular user writes to stay
  //     compact.
  it("(g) is_memory_sink_write only present when the audit row's flag is true", async () => {
    fx = buildFixture(
      [{ notePath: "doc.md", title: "Doc", frontmatter: {} }],
      [],
      [
        { notePath: "doc.md", op: "create", clientId: null, isMemorySinkWrite: false },
        {
          notePath: "doc.md",
          op: "update",
          clientId: "memory-agent-1",
          isMemorySinkWrite: true,
        },
      ],
    );

    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("doc.md") },
    );

    expect(out.recent_edits).toHaveLength(2);
    // Audit rows are listed newest-first — the memory-routed update
    // appears at index 0 (most recent insertion), the user create at
    // index 1.
    const memoryRow = out.recent_edits.find((e) => e.client_id === "memory-agent-1");
    const userRow = out.recent_edits.find((e) => e.client_id === null);
    expect(memoryRow).toBeDefined();
    expect(memoryRow?.is_memory_sink_write).toBe(true);
    expect(userRow).toBeDefined();
    // Compact wire shape: the field is OMITTED (not `false`) on
    // non-memory writes. `in` check is the right invariant.
    expect("is_memory_sink_write" in (userRow ?? {})).toBe(false);
  });
});

describe("getDocumentBundle — anchor packet + ASM-06 status/superseded_by hydration", () => {
  let fx: Fixture;
  afterEach(() => fx?.cleanup());

  it("anchor packet carries status when frontmatter has status (proves 03-05 hydration wiring)", async () => {
    fx = buildFixture(
      [
        {
          notePath: "old.md",
          title: "Old",
          frontmatter: {
            title: "Old",
            status: "superseded",
            superseded_by: "obsidian-fs://test-vault/new.md",
          },
        },
      ],
      [],
    );

    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("old.md") },
    );

    expect(out.anchor.status).toBe("superseded");
    expect(out.anchor.superseded_by).toBe("obsidian-fs://test-vault/new.md");
    // 8-field CitationPacket invariants on the anchor.
    expect(out.anchor.doc_id).toBeDefined();
    expect(out.anchor.source_handle).toBeDefined();
    expect(out.anchor.title).toBe("Old");
    expect(out.anchor.heading_path).toEqual([]);
    expect(typeof out.anchor.mtime).toBe("number");
    expect(typeof out.anchor.hash).toBe("string");
    expect(typeof out.anchor.display_url).toBe("string");
    expect(out.anchor.properties).toBeDefined();
    expect(typeof out.anchor.properties).toBe("object");
  });

  it("anchor packet omits status/superseded_by when frontmatter has none", async () => {
    fx = buildFixture(
      [
        {
          notePath: "regular.md",
          title: "Regular",
          frontmatter: { title: "Regular", type: "Note" },
        },
      ],
      [],
    );

    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("regular.md") },
    );

    expect(out.anchor.status).toBeUndefined();
    expect(out.anchor.superseded_by).toBeUndefined();
  });
});

describe("getDocumentBundle — error paths (DocNotFoundError)", () => {
  let fx: Fixture;
  afterEach(() => fx?.cleanup());

  // (d) Unknown doc_id → DocNotFoundError. The server dispatch wraps
  //     this into {isError:true, error:"doc_not_found", doc_id}; we
  //     pin the throw at the controller seam.
  it("(d) unknown doc_id (note row missing) → DocNotFoundError", async () => {
    fx = buildFixture([{ notePath: "exists.md", title: "X", frontmatter: {} }], []);

    await expect(
      getDocumentBundle(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { doc_id: fx.docIdFor("missing.md") },
      ),
    ).rejects.toThrow(DocNotFoundError);
  });

  it("malformed doc_id → DocNotFoundError", async () => {
    fx = buildFixture([{ notePath: "x.md", title: "X", frontmatter: {} }], []);
    await expect(
      getDocumentBundle(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { doc_id: "this is not a doc id" },
      ),
    ).rejects.toThrow(DocNotFoundError);
  });

  it("unknown vault → DocNotFoundError", async () => {
    fx = buildFixture([{ notePath: "x.md", title: "X", frontmatter: {} }], []);
    await expect(
      getDocumentBundle(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { doc_id: "obsidian-fs://other-vault/x.md" },
      ),
    ).rejects.toThrow(DocNotFoundError);
  });

  it("vaults filter excludes the DocId's vault → DocNotFoundError", async () => {
    fx = buildFixture([{ notePath: "x.md", title: "X", frontmatter: {} }], []);
    await expect(
      getDocumentBundle(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { doc_id: fx.docIdFor("x.md"), vaults: ["some-other-vault"] },
      ),
    ).rejects.toThrow(DocNotFoundError);
  });
});

describe("getDocumentBundle — integration smoke (3-note A→B→C chain)", () => {
  let fx: Fixture;
  afterEach(() => fx?.cleanup());

  // Integration smoke per plan §"Tasks" item 5: indexes a 3-note
  // fixture, calls getDocumentBundle for B, asserts both backlinks
  // (A→B) and forward links (B→C) appear, plus the outline +
  // recent_edits, plus the 03-05 hydration path on the anchor.
  it("indexes 3-note fixture, surfaces backlinks + forward links + outline + recent_edits + status", async () => {
    const notes: FixtureNoteSpec[] = [
      {
        notePath: "a.md",
        title: "A",
        frontmatter: { title: "A", type: "Note" },
        body: "A links to B.",
      },
      {
        notePath: "b.md",
        title: "B",
        // B is superseded — proves the 03-05 wiring works through the
        // anchor packet hydration.
        frontmatter: {
          title: "B",
          type: "Note",
          status: "superseded",
          superseded_by: "obsidian-fs://test-vault/b-v2.md",
        },
        body: "B is the anchor.",
      },
      {
        notePath: "c.md",
        title: "C",
        frontmatter: { title: "C", type: "Note" },
        body: "C is the forward-link target.",
      },
    ];
    const links: FixtureLinkSpec[] = [
      { sourcePath: "a.md", targetPath: "b.md" },
      { sourcePath: "b.md", targetPath: "c.md" },
    ];
    const audits: FixtureAuditSpec[] = [
      { notePath: "b.md", op: "create" },
      { notePath: "b.md", op: "update", clientId: "memory-agent", isMemorySinkWrite: true },
    ];
    fx = buildFixture(notes, links, audits);

    // Add a section to B so the outline tree is non-empty.
    const bNoteId = fx.idByPath.get("b.md")!;
    fx.vault.db.sections.insertMany([
      sectionRow(bNoteId, { anchor: "sec1", heading_text: "Section One", level: 1, ord: 0 }),
    ]);

    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("b.md") },
    );

    // Anchor — proves 03-05 hydration path.
    expect(out.anchor.title).toBe("B");
    expect(out.anchor.status).toBe("superseded");
    expect(out.anchor.superseded_by).toBe("obsidian-fs://test-vault/b-v2.md");

    // Backlinks: A→B.
    expect(out.backlinks).toHaveLength(1);
    expect(out.backlinks[0]?.title).toBe("A");
    expect(out.backlinks[0]?.relation).toBe("wikilink");

    // Forward links: B→C.
    expect(out.forward_links).toHaveLength(1);
    expect(out.forward_links[0]?.title).toBe("C");
    expect(out.forward_links[0]?.relation).toBe("wikilink");

    // Outline.
    expect(out.outline).toHaveLength(1);
    expect(out.outline[0]?.heading_text).toBe("Section One");

    // Recent edits — both rows surface, the memory one has the flag.
    expect(out.recent_edits).toHaveLength(2);
    const memoryRow = out.recent_edits.find((e) => e.client_id === "memory-agent");
    expect(memoryRow?.is_memory_sink_write).toBe(true);
  });
});

describe("getDocumentBundle — vaults filter happy path", () => {
  let fx: Fixture;
  afterEach(() => fx?.cleanup());

  it("vaults filter that INCLUDES the DocId's vault passes through", async () => {
    fx = buildFixture(
      [{ notePath: "x.md", title: "X", frontmatter: { title: "X" } }],
      [],
    );
    const out = await getDocumentBundle(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { doc_id: fx.docIdFor("x.md"), vaults: [VAULT_NAME] },
    );
    expect(out.anchor.title).toBe("X");
  });
});

