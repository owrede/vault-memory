/**
 * Tests for `getOutline` (Phase 3 ASM-02 / Plan 03-02).
 *
 * Strategy: spin up an in-memory SQLite via `Database`, seed the
 * `sections` + `chunks` + `notes` rows directly through the query
 * namespaces, and inject a stub `manager` + stub `SourceConnector`.
 * This keeps the test scope tight to the controller's tree-building
 * + chunk-ID resolution paths; the indexer/extractor integration is
 * covered by `src/sections/integration.test.ts` (landed in 03-01).
 *
 * Pinned behaviors (per plan §"Files to create"):
 *   (a) flat doc → all sections at root
 *   (b) nested H1>H2>H2 → root has one section with two children
 *   (c) deep H1>H2>H3 → three-level tree
 *   (d) preamble doc (level-0) → tree starts at level 0
 *   (e) doc with no sections → root: []
 *   (f) chunk_ids populated from chunk_id_first..chunk_id_last range
 *
 * Plus error-path cases pinned by the plan's acceptance criteria:
 *   - unknown doc_id (malformed) → DocNotFoundError
 *   - unknown vault → DocNotFoundError
 *   - unknown path (note missing) → DocNotFoundError
 *   - vaults filter excludes the DocId's vault → DocNotFoundError
 *   - document-level packet fields (title/mtime/hash/display_url) propagated
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Database } from "../db/index.js";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import type { DocId, Document, InsertSectionRow, SourceHandle } from "../types.js";
import type { Vault, VaultManager } from "../vault/index.js";
import { DocNotFoundError, buildOutlineTree, getOutline } from "./outline.js";

const VAULT_NAME = "test-vault";
const SOURCE_HANDLE = "obsidian-fs://test-vault" as SourceHandle;

// ─── Fixture builder ─────────────────────────────────────────────────────────

interface Fixture {
  db: Database;
  vault: Vault;
  manager: Pick<VaultManager, "require">;
  source: SourceConnector;
  /** Synthesize a doc to feed through the source seam. */
  setDoc: (path: string, overrides?: Partial<Document>) => void;
  /** Helper: insert a note row and return its id. */
  seedNote: (path: string, overrides?: { mtime?: number; hash?: string }) => number;
  /** Cleanup. */
  close: () => void;
}

function buildFixture(): Fixture {
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();

  // Minimal Vault-shaped object. We don't need a real `config` for
  // getOutline — the controller only reads `vault.db`.
  const vault: Vault = {
    config: { name: VAULT_NAME, path: "/tmp/nonexistent" } as Vault["config"],
    db,
    dbPath: ":memory:",
  };

  const manager: Pick<VaultManager, "require"> = {
    require: (name: string): Vault => {
      if (name !== VAULT_NAME) {
        throw new Error(`Unknown vault: "${name}"`);
      }
      return vault;
    },
  };

  // Per-path document store for the stub source. Tests register a
  // doc via `setDoc(...)` before calling `getOutline`.
  const docsByPath = new Map<string, Document>();

  const source: SourceConnector = {
    handle: SOURCE_HANDLE,
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
      // unused
    },
    readDocument: async (id: DocId) => {
      // DocId resource portion comes after `obsidian-fs://<vault>/`.
      const prefix = `obsidian-fs://${VAULT_NAME}/`;
      if (!(id as string).startsWith(prefix)) {
        throw new Error(`Doc not found: ${id}`);
      }
      const path = (id as string).slice(prefix.length);
      const doc = docsByPath.get(path);
      if (!doc) throw new Error(`Doc not found: ${id}`);
      return doc;
    },
    hash: async (id: DocId) => {
      const prefix = `obsidian-fs://${VAULT_NAME}/`;
      const path = (id as string).slice(prefix.length);
      const doc = docsByPath.get(path);
      if (!doc) throw new Error(`Doc not found: ${id}`);
      return doc.hash;
    },
    exists: async (id: DocId) => {
      const prefix = `obsidian-fs://${VAULT_NAME}/`;
      const path = (id as string).slice(prefix.length);
      return docsByPath.has(path);
    },
    formatDisplayUrl: (id: DocId): string => {
      const schemeEnd = (id as string).indexOf("://");
      const rest = (id as string).slice(schemeEnd + 3);
      const slashIdx = rest.indexOf("/");
      const vaultName = rest.slice(0, slashIdx);
      const resource = rest.slice(slashIdx + 1);
      return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(resource)}`;
    },
  };

  const setDoc = (path: string, overrides: Partial<Document> = {}): void => {
    const id = formatDocId("obsidian-fs", VAULT_NAME, path);
    docsByPath.set(path, {
      id,
      source: SOURCE_HANDLE,
      title: overrides.title ?? path.replace(/\.md$/, ""),
      blocks: overrides.blocks ?? [],
      properties: overrides.properties ?? {},
      links: overrides.links ?? [],
      mtime: overrides.mtime ?? 1_700_000_000_000,
      hash: overrides.hash ?? `hash-${path}`,
      ...(overrides.display_url !== undefined ? { display_url: overrides.display_url } : {}),
    });
  };

  const seedNote = (
    path: string,
    overrides: { mtime?: number; hash?: string } = {},
  ): number =>
    db.notes.upsertByPath({
      path,
      content: "x",
      frontmatter: null,
      title: path.replace(/\.md$/, ""),
      hash: overrides.hash ?? `hash-${path}`,
      bodyHash: `body-${path}`,
      mtime: overrides.mtime ?? 1_700_000_000_000,
      wordCount: 1,
    }).id;

  return {
    db,
    vault,
    manager,
    source,
    setDoc,
    seedNote,
    close: () => db.close(),
  };
}

// Convenience: build an InsertSectionRow with sensible defaults.
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

// ─── Pure tree-builder unit tests (buildOutlineTree) ────────────────────────

describe("buildOutlineTree", () => {
  it("returns [] when no rows", () => {
    expect(buildOutlineTree([], [])).toEqual([]);
  });
});

// ─── getOutline controller tests ─────────────────────────────────────────────

describe("getOutline", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = buildFixture();
  });

  // (a) flat doc — all sections at root.
  it("(a) flat doc → all sections at root, no children", async () => {
    const noteId = fx.seedNote("flat.md");
    fx.setDoc("flat.md", { title: "Flat Doc" });
    fx.db.sections.insertMany([
      sectionRow(noteId, { anchor: "a1", heading_text: "A", level: 1, ord: 0 }),
      sectionRow(noteId, { anchor: "a2", heading_text: "B", level: 1, ord: 1 }),
      sectionRow(noteId, { anchor: "a3", heading_text: "C", level: 1, ord: 2 }),
    ]);

    const docId = formatDocId("obsidian-fs", VAULT_NAME, "flat.md");
    const out = await getOutline(
      { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
      { doc_id: docId },
    );

    expect(out.title).toBe("Flat Doc");
    expect(out.root).toHaveLength(3);
    expect(out.root.map((n) => n.heading_text)).toEqual(["A", "B", "C"]);
    expect(out.root.every((n) => n.children.length === 0)).toBe(true);
    expect(out.root.every((n) => n.level === 1)).toBe(true);
  });

  // (b) nested H1 > H2 > H2 — root has one section with two children.
  it("(b) nested H1>H2>H2 → root has one node with two children", async () => {
    const noteId = fx.seedNote("nested.md");
    fx.setDoc("nested.md");
    const [parentId] = fx.db.sections.insertMany([
      sectionRow(noteId, { anchor: "p", heading_text: "Parent", level: 1, ord: 0 }),
    ]);
    fx.db.sections.insertMany([
      sectionRow(noteId, {
        anchor: "c1",
        heading_text: "Child1",
        heading_path: JSON.stringify(["Parent", "Child1"]),
        level: 2,
        parent_id: parentId!,
        ord: 0,
      }),
      sectionRow(noteId, {
        anchor: "c2",
        heading_text: "Child2",
        heading_path: JSON.stringify(["Parent", "Child2"]),
        level: 2,
        parent_id: parentId!,
        ord: 1,
      }),
    ]);

    const docId = formatDocId("obsidian-fs", VAULT_NAME, "nested.md");
    const out = await getOutline(
      { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
      { doc_id: docId },
    );

    expect(out.root).toHaveLength(1);
    const parent = out.root[0]!;
    expect(parent.heading_text).toBe("Parent");
    expect(parent.children).toHaveLength(2);
    expect(parent.children.map((c) => c.heading_text)).toEqual(["Child1", "Child2"]);
    expect(parent.children.map((c) => c.heading_path)).toEqual([
      ["Parent", "Child1"],
      ["Parent", "Child2"],
    ]);
    expect(parent.children.every((c) => c.level === 2)).toBe(true);
    expect(parent.children.every((c) => c.children.length === 0)).toBe(true);
  });

  // (c) deep H1 > H2 > H3 — three-level tree.
  it("(c) deep H1>H2>H3 → three-level tree", async () => {
    const noteId = fx.seedNote("deep.md");
    fx.setDoc("deep.md");
    const [h1Id] = fx.db.sections.insertMany([
      sectionRow(noteId, { anchor: "h1", heading_text: "H1", level: 1, ord: 0 }),
    ]);
    const [h2Id] = fx.db.sections.insertMany([
      sectionRow(noteId, {
        anchor: "h2",
        heading_text: "H2",
        heading_path: JSON.stringify(["H1", "H2"]),
        level: 2,
        parent_id: h1Id!,
        ord: 0,
      }),
    ]);
    fx.db.sections.insertMany([
      sectionRow(noteId, {
        anchor: "h3",
        heading_text: "H3",
        heading_path: JSON.stringify(["H1", "H2", "H3"]),
        level: 3,
        parent_id: h2Id!,
        ord: 0,
      }),
    ]);

    const docId = formatDocId("obsidian-fs", VAULT_NAME, "deep.md");
    const out = await getOutline(
      { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
      { doc_id: docId },
    );

    expect(out.root).toHaveLength(1);
    const h1 = out.root[0]!;
    expect(h1.heading_text).toBe("H1");
    expect(h1.children).toHaveLength(1);
    const h2 = h1.children[0]!;
    expect(h2.heading_text).toBe("H2");
    expect(h2.heading_path).toEqual(["H1", "H2"]);
    expect(h2.children).toHaveLength(1);
    const h3 = h2.children[0]!;
    expect(h3.heading_text).toBe("H3");
    expect(h3.heading_path).toEqual(["H1", "H2", "H3"]);
    expect(h3.level).toBe(3);
    expect(h3.children).toEqual([]);
  });

  // (d) preamble doc — level-0 section at root.
  it("(d) preamble doc (level-0) → tree starts at level 0", async () => {
    const noteId = fx.seedNote("preamble.md");
    fx.setDoc("preamble.md");
    fx.db.sections.insertMany([
      sectionRow(noteId, {
        anchor: "pre",
        heading_text: "",
        heading_path: JSON.stringify([]),
        level: 0,
        ord: 0,
      }),
      sectionRow(noteId, {
        anchor: "after",
        heading_text: "After",
        heading_path: JSON.stringify(["After"]),
        level: 1,
        ord: 1,
      }),
    ]);

    const docId = formatDocId("obsidian-fs", VAULT_NAME, "preamble.md");
    const out = await getOutline(
      { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
      { doc_id: docId },
    );

    expect(out.root).toHaveLength(2);
    expect(out.root[0]!.level).toBe(0);
    expect(out.root[0]!.heading_text).toBe("");
    expect(out.root[0]!.heading_path).toEqual([]);
    expect(out.root[1]!.level).toBe(1);
    expect(out.root[1]!.heading_text).toBe("After");
  });

  // (e) doc with no sections → root: [].
  it("(e) doc with no sections → root: []", async () => {
    fx.seedNote("empty.md");
    fx.setDoc("empty.md", { title: "Empty Doc" });

    const docId = formatDocId("obsidian-fs", VAULT_NAME, "empty.md");
    const out = await getOutline(
      { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
      { doc_id: docId },
    );

    expect(out.root).toEqual([]);
    expect(out.title).toBe("Empty Doc");
    // Doc-level packet fields still populated.
    expect(out.doc_id).toBe(docId);
    expect(out.source_handle).toBe(SOURCE_HANDLE);
    expect(out.hash).toBe("hash-empty.md");
    expect(out.mtime).toBe(1_700_000_000_000);
    expect(out.display_url).toBe(
      "obsidian://open?vault=test-vault&file=empty.md",
    );
  });

  // (f) chunk_ids populated from chunk_id_first..chunk_id_last.
  it("(f) chunk_ids populated from chunk_id_first..chunk_id_last range", async () => {
    const noteId = fx.seedNote("chunked.md");
    fx.setDoc("chunked.md");
    // Seed 4 chunks so we have real FKs.
    const chunkIds = fx.db.chunks.insertBatch(noteId, [
      { idx: 0, text: "a", headingPath: null, startOffset: 0, endOffset: 1, tokenCount: 1 },
      { idx: 1, text: "b", headingPath: null, startOffset: 1, endOffset: 2, tokenCount: 1 },
      { idx: 2, text: "c", headingPath: null, startOffset: 2, endOffset: 3, tokenCount: 1 },
      { idx: 3, text: "d", headingPath: null, startOffset: 3, endOffset: 4, tokenCount: 1 },
    ]);
    expect(chunkIds).toHaveLength(4);
    const [c0, c1, c2, c3] = chunkIds as [number, number, number, number];

    fx.db.sections.insertMany([
      // Section spans chunks 0..1
      sectionRow(noteId, {
        anchor: "sec1",
        heading_text: "Sec1",
        level: 1,
        ord: 0,
        chunk_id_first: c0,
        chunk_id_last: c1,
      }),
      // Section spans chunks 2..3
      sectionRow(noteId, {
        anchor: "sec2",
        heading_text: "Sec2",
        level: 1,
        ord: 1,
        chunk_id_first: c2,
        chunk_id_last: c3,
      }),
      // Heading with no body — NULL range → empty chunk_ids
      sectionRow(noteId, {
        anchor: "sec3",
        heading_text: "Sec3",
        level: 1,
        ord: 2,
        chunk_id_first: null,
        chunk_id_last: null,
      }),
    ]);

    const docId = formatDocId("obsidian-fs", VAULT_NAME, "chunked.md");
    const out = await getOutline(
      { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
      { doc_id: docId },
    );

    expect(out.root).toHaveLength(3);
    expect(out.root[0]!.chunk_ids).toEqual([String(c0), String(c1)]);
    expect(out.root[1]!.chunk_ids).toEqual([String(c2), String(c3)]);
    expect(out.root[2]!.chunk_ids).toEqual([]);
  });

  // ─── Error-path cases ─────────────────────────────────────────────────────

  it("throws DocNotFoundError on malformed DocId", async () => {
    await expect(
      getOutline(
        { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
        { doc_id: "not-a-valid-doc-id" },
      ),
    ).rejects.toBeInstanceOf(DocNotFoundError);
  });

  it("throws DocNotFoundError on unknown vault", async () => {
    const docId = formatDocId("obsidian-fs", "unknown-vault", "x.md");
    await expect(
      getOutline(
        { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
        { doc_id: docId },
      ),
    ).rejects.toBeInstanceOf(DocNotFoundError);
  });

  it("throws DocNotFoundError when the note row is missing", async () => {
    // No seedNote call → notes.getByPath returns null.
    fx.setDoc("ghost.md");
    const docId = formatDocId("obsidian-fs", VAULT_NAME, "ghost.md");
    await expect(
      getOutline(
        { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
        { doc_id: docId },
      ),
    ).rejects.toBeInstanceOf(DocNotFoundError);
  });

  it("throws DocNotFoundError when the source seam cannot read the doc", async () => {
    // Note row exists; doc not registered with the stub source.
    fx.seedNote("orphan.md");
    const docId = formatDocId("obsidian-fs", VAULT_NAME, "orphan.md");
    await expect(
      getOutline(
        { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
        { doc_id: docId },
      ),
    ).rejects.toBeInstanceOf(DocNotFoundError);
  });

  it("throws DocNotFoundError when vaults filter excludes the DocId's vault", async () => {
    fx.seedNote("scoped.md");
    fx.setDoc("scoped.md");
    const docId = formatDocId("obsidian-fs", VAULT_NAME, "scoped.md");
    await expect(
      getOutline(
        { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
        { doc_id: docId, vaults: ["other-vault"] },
      ),
    ).rejects.toBeInstanceOf(DocNotFoundError);
  });

  it("returns the full document-level citation packet on success", async () => {
    fx.seedNote("packet.md", { mtime: 1_234_567_890_000, hash: "abc-hash" });
    fx.setDoc("packet.md", {
      title: "Packet Title",
      mtime: 1_234_567_890_000,
      hash: "abc-hash",
    });
    fx.db.sections.insertMany([
      sectionRow(fx.db.notes.getByPath("packet.md")!.id, {
        anchor: "only",
        heading_text: "Only",
        level: 1,
        ord: 0,
      }),
    ]);

    const docId = formatDocId("obsidian-fs", VAULT_NAME, "packet.md");
    const out = await getOutline(
      { manager: fx.manager as VaultManager, sourceConnectorFor: () => fx.source },
      { doc_id: docId },
    );

    expect(out.doc_id).toBe(docId);
    expect(out.source_handle).toBe(parseSourceHandle("obsidian-fs://test-vault"));
    expect(out.title).toBe("Packet Title");
    expect(out.mtime).toBe(1_234_567_890_000);
    expect(out.hash).toBe("abc-hash");
    expect(out.display_url).toBe(
      "obsidian://open?vault=test-vault&file=packet.md",
    );
    expect(out.root).toHaveLength(1);
    expect(out.root[0]!.anchor).toBe("only");
  });
});
