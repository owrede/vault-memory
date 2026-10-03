import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { indexVault } from "../indexer/indexer.js";
import { indexNote } from "../indexer/single.js";
import { getDocumentBundle } from "../assembly/bundle.js";
import { applyDocumentPatch } from "../edit/apply.js";
import { searchSectionsWithContext } from "../assembly/search-sections.js";
import { assembleDossier } from "../assembly/dossier.js";
describe("observation index uses canonical files", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  const body = "# A\n- [fact] First\n## B\n- [decision] Second\n";
  beforeEach(async () => {
    f = await createVaultFixture();
    await fs.writeFile(
      join(f.root, "a.md"),
      "---\nsource: imported\nevidence: [source-1]\nconfidence: direct\n---\n" + body,
    );
  });
  afterEach(async () => {
    await f.cleanup();
  });
  const opts = () => ({
    vault: f.vault,
    absolutePath: join(f.root, "a.md"),
    embeddingModel: "unused",
    embeddings: "none" as const,
  });
  const bundle = (args = {}) =>
    getDocumentBundle(
      { manager: f.manager, sourceConnectorFor: () => f.source },
      { doc_id: f.id("a.md"), include_observations: true, ...args },
    );
  it("indexes explicit statements with canonical hashes and stable repeated snapshots", async () => {
    await indexNote(opts());
    const noteId = f.vault.db.notes.getByPath("a.md")!.id;
    const rows = f.vault.db.observations.listForNote(noteId);
    expect(rows).toMatchObject([
      { category: "fact", text: "First", line_start: 2, line_end: 2 },
      { category: "decision", text: "Second", line_start: 4, line_end: 4 },
    ]);
    expect(rows.map((row) => row.doc_hash)).toEqual(
      Array(2).fill((await f.source.readDocument(f.id("a.md"))).hash),
    );
    await indexNote(opts());
    await indexVault(f.vault, { mode: "full", embeddingModel: "unused", embeddings: "none" });
    expect(f.vault.db.observations.listForNote(noteId)).toEqual(rows);
  });
  it("publishes statements on direct writes, removes obsolete statements and cascades delete", async () => {
    const id = f.id("written.md");
    const initial = await f.delivery.write(id, { blocks: [{ kind: "paragraph", text: body }] });
    if (!initial.ok) throw new Error("seed failed");
    const noteId = f.vault.db.notes.getByPath("written.md")!.id;
    expect(f.vault.db.observations.listForNote(noteId)).toHaveLength(2);
    const result = await f.delivery.update(
      id,
      { blocks: [{ kind: "paragraph", text: "# A\n- [fact] Changed\n" }] },
      { expectedHash: initial.newHash },
    );
    expect(result.ok).toBe(true);
    expect(f.vault.db.observations.listForNote(noteId)).toMatchObject([
      { category: "fact", text: "Changed" },
    ]);
    const hash = (await f.source.readDocument(id)).hash;
    expect(await f.delivery.delete(id, { expectedHash: hash })).toMatchObject({ ok: true });
    expect(f.vault.db.observations.listForNote(noteId)).toEqual([]);
  });
  it("rolls a failed statement publication back with the file, note and audit", async () => {
    const id = f.id("atomic.md");
    const initial = await f.delivery.write(id, { blocks: [{ kind: "paragraph", text: body }] });
    if (!initial.ok) throw new Error("seed failed");
    const noteId = f.vault.db.notes.getByPath("atomic.md")!.id;
    const before = {
      bytes: await fs.readFile(join(f.root, "atomic.md"), "utf8"),
      note: f.vault.db.notes.getById(noteId),
      rows: f.vault.db.observations.listForNote(noteId),
      audit: f.vault.db.audit.listWrites({}),
    };
    f.vault.db.handle.exec(
      "CREATE TRIGGER reject_statement BEFORE INSERT ON observations WHEN new.category = 'reject' BEGIN SELECT RAISE(ABORT, 'reject fixture'); END;",
    );
    await expect(
      f.delivery.update(
        id,
        { blocks: [{ kind: "paragraph", text: "- [reject] Forbidden\n" }] },
        { expectedHash: initial.newHash },
      ),
    ).rejects.toThrow("reject fixture");
    expect({
      bytes: await fs.readFile(join(f.root, "atomic.md"), "utf8"),
      note: f.vault.db.notes.getById(noteId),
      rows: f.vault.db.observations.listForNote(noteId),
      audit: f.vault.db.audit.listWrites({}),
    }).toEqual(before);
  });
  it("removes old statement rows on rename and cites the new source identity", async () => {
    await indexNote(opts());
    const oldId = f.vault.db.notes.getByPath("a.md")!.id;
    await fs.rename(join(f.root, "a.md"), join(f.root, "renamed.md"));
    await indexVault(f.vault, { embeddingModel: "unused", embeddings: "none" });
    expect(f.vault.db.observations.listForNote(oldId)).toEqual([]);
    const result = await getDocumentBundle(
      { manager: f.manager, sourceConnectorFor: () => f.source },
      { doc_id: f.id("renamed.md"), include_observations: true },
    );
    expect(result.observations).toMatchObject({
      state: "fresh",
      statements: [{ doc_id: f.id("renamed.md") }, { doc_id: f.id("renamed.md") }],
    });
    expect(f.vault.db.handle.pragma("foreign_key_check")).toEqual([]);
  });
  it("surfaces fresh citations/provenance and suppresses stale indexed statements", async () => {
    await indexNote(opts());
    const result = await bundle();
    expect(result.observations).toMatchObject({
      state: "fresh",
      available_count: 2,
      statements: [
        {
          doc_id: f.id("a.md"),
          source_handle: f.source.handle,
          category: "fact",
          text: "First",
          properties: { source: "imported", evidence: ["source-1"], confidence: "direct" },
        },
        { category: "decision", text: "Second" },
      ],
    });
    await fs.writeFile(join(f.root, "a.md"), "# A\n- [fact] External change\n");
    expect((await bundle()).observations).toMatchObject({ state: "stale", statements: [] });
    await indexNote(opts());
    expect((await bundle()).observations).toMatchObject({
      state: "fresh",
      available_count: 1,
      statements: [{ text: "External change" }],
    });
  });
  it("marks a pre-backfill source unindexed even when no statements are found", async () => {
    const doc = await f.source.readDocument(f.id("a.md"));
    f.vault.db.notes.upsertByPath({
      path: "a.md",
      content: body,
      frontmatter: JSON.stringify(doc.properties),
      title: "A",
      hash: doc.hash,
      bodyHash: "old",
      mtime: doc.mtime,
      wordCount: 10,
    });
    expect((await bundle()).observations).toMatchObject({ state: "unindexed", statements: [] });
    await indexNote(opts());
    expect((await bundle()).observations).toMatchObject({ state: "fresh", available_count: 2 });
  });
  it("keeps metadata body-free and counts statement excerpts in the global budget", async () => {
    await indexNote(opts());
    expect(JSON.stringify(await bundle({ projection: "metadata" }))).not.toContain("Second");
    const result = await bundle({ projection: "full", max_chars: 3 });
    expect(result.context).toMatchObject({ budget_used: 3, truncated: true });
    expect(result.observations!.statements).toMatchObject([
      { text: "Fir", truncated: true, original_chars: 5 },
    ]);
  });
  it("selected bundle sections exclude statements from other headings", async () => {
    await indexNote(opts());
    const result = await bundle({ projection: "sections", heading_paths: [["A", "B"]] });
    expect(result.observations!.statements.map((row) => row.text)).toEqual(["Second"]);
  });
  it("dossiers preserve statement provenance and share selected-section semantics", async () => {
    await fs.writeFile(
      join(f.root, "a.md"),
      "---\ntype: Project\nsource: imported\nevidence: [source-1]\nconfidence: direct\n---\n" +
        body,
    );
    await indexNote(opts());
    const result = await assembleDossier(
      { manager: f.manager, sourceConnectorFor: () => f.source },
      {
        type: "Project",
        key: "A",
        include_observations: true,
        projection: "sections",
        heading_paths: [["A", "B"]],
      },
    );
    expect(result.observations!.statements).toMatchObject([
      {
        text: "Second",
        properties: { source: "imported", evidence: ["source-1"], confidence: "direct" },
      },
    ]);
    expect(result.observations!.statements).toHaveLength(1);
  });
  it("does not infer provenance or bypass a locked source for statement edits", async () => {
    await fs.writeFile(join(f.root, "a.md"), "---\nlocked: true\n---\n" + body);
    await indexNote(opts());
    const noteId = f.vault.db.notes.getByPath("a.md")!.id;
    const rows = f.vault.db.observations.listForNote(noteId);
    expect(
      await applyDocumentPatch(
        { source: f.source, delivery: f.delivery },
        {
          doc_id: f.id("a.md"),
          expected_hash: (await f.source.readDocument(f.id("a.md"))).hash,
          patch: { kind: "replace", old_text: "First", new_text: "Changed" },
        },
      ),
    ).toMatchObject({ ok: false, reason: "document_locked" });
    expect(f.vault.db.observations.listForNote(noteId)).toEqual(rows);
    expect((await bundle()).observations!.statements[0]!.properties).not.toHaveProperty("source");
  });
  it("section retrieval cites only statements inside the matched source range", async () => {
    await fs.writeFile(
      join(f.root, "a.md"),
      "# A\n- [fact] First\n\n" +
        "plain filler ".repeat(400) +
        "\n## B\n" +
        "body filler ".repeat(400) +
        "\n- [decision] Second\n",
    );
    await indexNote(opts());
    const result = await searchSectionsWithContext(
      {
        searchHybrid: async () =>
          f.vault.db.fts.search("Second", 10).map((hit) => {
            const row = f.vault.db.chunks.getById(hit.chunkId)!;
            return {
              vault: "lab",
              notePath: "a.md",
              noteTitle: "A",
              chunkIdx: row.idx,
              chunkText: row.text,
              headingPath: row.heading_path,
              score: hit.score,
            };
          }),
        sectionForHit: (_vault, _path, idx) => {
          const noteId = f.vault.db.notes.getByPath("a.md")!.id;
          const chunk = f.vault.db.chunks.getByNote(noteId).find((row) => row.idx === idx)!;
          const section = f.vault.db.sections.findContainingChunk(noteId, chunk.id);
          return section
            ? {
                noteId,
                anchor: section.anchor,
                headingPath: JSON.parse(section.heading_path),
                chunkIdFirst: section.chunk_id_first!,
              }
            : null;
        },
        readDocument: async () => f.source.readDocument(f.id("a.md")),
        displayUrlFor: (id) => f.source.formatDisplayUrl(id),
        observationIndex: () => {
          const noteId = f.vault.db.notes.getByPath("a.md")!.id;
          return {
            doc_hash: f.vault.db.observations.indexedHash(noteId),
            rows: f.vault.db.observations.listForNote(noteId),
          };
        },
      },
      { query: "Second", limit: 1, include_observations: true },
    );
    expect(result.results[0]!.heading_path).toEqual(["A", "B"]);
    expect(result.results[0]!.observations).toMatchObject({
      state: "fresh",
      statements: [{ category: "decision", text: "Second", heading_path: ["A", "B"] }],
    });
    expect(JSON.stringify(result.results[0]!.observations)).not.toContain("First");
  });
});
