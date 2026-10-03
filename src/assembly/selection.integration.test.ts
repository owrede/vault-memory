import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { indexVault } from "../indexer/indexer.js";
import { getDocumentBundle } from "./bundle.js";
import { assembleDossier } from "./dossier.js";
import type { ProjectionArgs } from "./selection.js";

describe("compact assembly on canonical files", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  beforeEach(async () => {
    f = await createVaultFixture();
    await fs.writeFile(
      join(f.root, "anchor.md"),
      "---\ntype: Project\nlocked: true\n---\n# A\nTOP_SECRET\n## B\nBBBB\n## C\nCCCC\n",
    );
    await fs.writeFile(join(f.root, "linked.md"), "[[anchor]]\n" + "LINK_BODY_SECRET".repeat(30));
    await indexVault(f.vault, { embeddingModel: "unused", embeddings: "none" });
  });
  afterEach(async () => {
    await f.cleanup();
  });
  const deps = () => ({ manager: f.manager, sourceConnectorFor: () => f.source });
  const bundle = (args: ProjectionArgs = {}) =>
    getDocumentBundle(deps(), { doc_id: f.id("anchor.md"), ...args });
  it("preserves the legacy result for omitted/full projection", async () => {
    const original = await bundle();
    expect(original.backlinks[0]!.property_snippet).toContain("LINK_BODY_SECRET");
    expect(original).not.toHaveProperty("context");
    expect(await bundle({ projection: "full" })).toEqual(original);
  });
  it("metadata exposes no linked body snippets or anchor body", async () => {
    const result = await bundle({ projection: "metadata" });
    expect(JSON.stringify(result)).not.toContain("LINK_BODY_SECRET");
    expect(JSON.stringify(result)).not.toContain("TOP_SECRET");
    expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(await bundle()).length);
  });
  it("selects B with complete citation, fresh hash and exact source range", async () => {
    const result = await bundle({
      projection: "sections",
      heading_paths: [["A", "B"]],
      max_chars: 100,
    });
    const doc = await f.source.readDocument(f.id("anchor.md"));
    expect(result.context).toMatchObject({
      budget_used: 5,
      budget_limit: 100,
      truncated: false,
      excluded: [],
    });
    expect(result.context!.slices).toEqual([
      {
        doc_id: doc.id,
        source_handle: doc.source,
        title: doc.title,
        heading_path: ["A", "B"],
        mtime: doc.mtime,
        hash: doc.hash,
        properties: doc.properties,
        display_url: f.source.formatDisplayUrl(doc.id),
        text: "BBBB\n",
        truncated: false,
        original_chars: 5,
        start_offset: 20,
        end_offset: 25,
        line_start: 4,
        line_end: 4,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("TOP_SECRET");
    expect(JSON.stringify(result)).not.toContain("CCCC");
    expect(JSON.stringify(result)).not.toContain("LINK_BODY_SECRET");
  });
  it("applies one budget across all slices and reports exclusions at zero", async () => {
    const paths = [
      ["A", "B"],
      ["A", "C"],
    ];
    expect(
      (await bundle({ projection: "sections", heading_paths: paths, max_chars: 7 })).context,
    ).toMatchObject({
      budget_used: 7,
      truncated: true,
      slices: [
        { text: "BBBB\n", truncated: false },
        { text: "CC", truncated: true },
      ],
    });
    expect(
      (await bundle({ projection: "sections", heading_paths: paths, max_chars: 0 })).context,
    ).toMatchObject({
      budget_used: 0,
      truncated: true,
      slices: [],
      excluded: paths.map((heading_path) => ({
        doc_id: f.id("anchor.md"),
        heading_path,
        reason: "budget_exhausted",
      })),
    });
  });
  it("rejects unknown, ambiguous and missing selectors without writes", async () => {
    const before = await fs.readFile(join(f.root, "anchor.md"), "utf8");
    await expect(
      bundle({ projection: "sections", heading_paths: [["Missing"]] }),
    ).rejects.toMatchObject({ code: "target_not_found" });
    await expect(bundle({ projection: "sections" })).rejects.toMatchObject({
      code: "invalid_projection",
    });
    await expect(bundle({ max_chars: -1 })).rejects.toMatchObject({ code: "invalid_projection" });
    await fs.writeFile(join(f.root, "anchor.md"), before + "## B\nDuplicate\n");
    await expect(
      bundle({ projection: "sections", heading_paths: [["A", "B"]] }),
    ).rejects.toMatchObject({ code: "ambiguous_target" });
    expect(f.vault.db.audit.listWrites({})).toEqual([]);
  });
  it("dossier uses the same selected source context and preserves metadata", async () => {
    const result = await assembleDossier(deps(), {
      type: "Project",
      key: "A",
      projection: "sections",
      heading_paths: [["A", "C"]],
      max_chars: 3,
    });
    expect(result.context).toMatchObject({
      budget_used: 3,
      slices: [{ text: "CCC", heading_path: ["A", "C"], truncated: true }],
    });
    expect(result.anchor!.doc_id).toBe(f.id("anchor.md"));
    expect(result.linked_documents[0]!.doc_id).toBe(f.id("linked.md"));
    expect(f.vault.db.audit.listWrites({})).toEqual([]);
  });
});
