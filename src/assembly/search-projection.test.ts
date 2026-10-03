import { describe, expect, it } from "vitest";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import { searchSectionsWithContext, type SearchSectionsDeps } from "./search-sections.js";
import type { Document } from "../types.js";
const doc: Document = {
  id: formatDocId("stub", "v", "a"),
  source: parseSourceHandle("stub://v"),
  title: "A",
  hash: "source-hash",
  mtime: 1,
  properties: { evidence: ["real-source"] },
  links: [],
  blocks: [{ kind: "paragraph", text: "# A\nSECRET\n## B\nBBBB\n## C\nCCCC\n" }],
};
const deps: SearchSectionsDeps = {
  searchHybrid: async () =>
    [0, 1].map((chunkIdx) => ({
      vault: "v",
      notePath: "a",
      noteTitle: "A",
      headingPath: null,
      chunkIdx,
      score: 1 - chunkIdx / 10,
      chunkText: "STALE_CHUNK_TEXT",
    })),
  sectionForHit: (_v, _p, idx) => ({
    noteId: 1,
    anchor: "anchor-" + idx,
    headingPath: ["A", idx === 0 ? "B" : "C"],
    chunkIdFirst: idx,
  }),
  readDocument: async () => doc,
  displayUrlFor: (id) => id,
};
describe("section search projection", () => {
  it("metadata excludes indexed snippets", async () => {
    expect(
      JSON.stringify(
        await searchSectionsWithContext(deps, { query: "x", limit: 2, projection: "metadata" }),
      ),
    ).not.toContain("STALE_CHUNK_TEXT");
  });
  it("reads selected source sections with one global budget", async () => {
    const result = await searchSectionsWithContext(deps, {
      query: "x",
      limit: 2,
      projection: "sections",
      heading_paths: [
        ["A", "B"],
        ["A", "C"],
      ],
      max_chars: 7,
    });
    expect(result.context).toMatchObject({
      budget_used: 7,
      slices: [
        { text: "BBBB\n", hash: "source-hash", truncated: false },
        { text: "CC", hash: "source-hash", truncated: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("STALE_CHUNK_TEXT");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("full with a budget caps the combined snippet text", async () => {
    const result = await searchSectionsWithContext(deps, { query: "x", limit: 2, max_chars: 3 });
    expect(result.results.map((hit) => hit.snippet ?? "").join("")).toBe("STA");
    expect(result.context).toMatchObject({
      budget_used: 3,
      truncated: true,
      excluded: [{ reason: "budget_exhausted" }],
    });
  });
  it("reports selectors absent from the query candidate sections", async () => {
    await expect(
      searchSectionsWithContext(deps, {
        query: "x",
        limit: 2,
        projection: "sections",
        heading_paths: [["Missing"]],
      }),
    ).rejects.toMatchObject({ code: "target_not_found", heading_path: ["Missing"] });
  });
});
