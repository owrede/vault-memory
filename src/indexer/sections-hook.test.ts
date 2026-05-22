import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { buildSectionsForNote, extractStatus, mapChunksToSections } from "./indexer.js";

/**
 * Phase 3 / 03-01 Task 7: indexer's section hook + denormalized
 * `notes.status` maintenance.
 *
 * Verified here (without booting the full `indexVault` pipeline so
 * tests stay fast and Ollama-free):
 *   - `buildSectionsForNote` persists the expected SectionInfo rows
 *     with correct anchors + parent_id threading.
 *   - `mapChunksToSections` bins chunks by start_offset into the
 *     innermost containing section.
 *   - `extractStatus` extracts the frontmatter status string.
 *   - The denormalized `notes.status` column is written by
 *     `setStatus` (smoke; the indexer code path is exercised by the
 *     integration test in src/sections/integration.test.ts).
 */
describe("indexer section hook + status maintenance (03-01 Task 7)", () => {
  let db: Database;
  let vault: Vault;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = {
      config: { name: "test-vault", path: "/tmp/test-vault" },
      db,
      dbPath: ":memory:",
    };
  });

  afterEach(() => {
    db.close();
  });

  function seedNote(path: string, content: string): number {
    return db.notes.upsertByPath({
      path,
      content,
      frontmatter: null,
      title: path,
      hash: path + "-h",
      bodyHash: path + "-bh",
      mtime: 0,
      wordCount: 1,
    }).id;
  }

  it("buildSectionsForNote: nested headings produce correct parent_id pointers + anchors", () => {
    const content = "# Top\n\nintro.\n\n## Sub\n\nsub body.\n";
    const nid = seedNote("a.md", content);
    // Seed a chunk so the section gets a chunk_id range.
    const [cid] = db.chunks.insertBatch(nid, [
      {
        idx: 0,
        text: "sub body.",
        headingPath: "## Sub",
        startOffset: content.indexOf("sub body."),
        endOffset: content.indexOf("sub body.") + "sub body.".length,
        tokenCount: 2,
      },
    ]);
    const count = buildSectionsForNote(vault, nid, content, [cid!]);
    expect(count).toBe(2);
    const rows = db.sections.getByNote(nid);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.heading_text).toBe("Top");
    expect(rows[0]!.parent_id).toBeNull();
    expect(rows[1]!.heading_text).toBe("Sub");
    expect(rows[1]!.parent_id).toBe(rows[0]!.id);
    // The chunk falls inside the H2 → it should own the chunk range.
    expect(rows[1]!.chunk_id_first).toBe(cid);
    expect(rows[1]!.chunk_id_last).toBe(cid);
  });

  it("buildSectionsForNote: preamble + H1 produces two sections, preamble at top level", () => {
    const content = "preamble.\n\n# H1\nbody.\n";
    const nid = seedNote("p.md", content);
    const count = buildSectionsForNote(vault, nid, content, []);
    expect(count).toBe(2);
    const rows = db.sections.getByNote(nid);
    expect(rows).toHaveLength(2);
    // Both rows are NULL-parent (preamble + H1 live at the doc root).
    expect(rows[0]!.parent_id).toBeNull();
    expect(rows[1]!.parent_id).toBeNull();
    // Preamble level === 0, H1 level === 1.
    const levels = rows.map((r) => r.level).sort();
    expect(levels).toEqual([0, 1]);
  });

  it("buildSectionsForNote: re-running produces identical anchors on the same content (idempotency on anchor values)", () => {
    const content = "# Stable\nbody bytes.\n";
    const nid = seedNote("s.md", content);
    buildSectionsForNote(vault, nid, content, []);
    const first = db.sections.getByNote(nid).map((r) => r.anchor);
    // Simulate a re-index: clear sections and rebuild.
    db.sections.deleteByNote(nid);
    buildSectionsForNote(vault, nid, content, []);
    const second = db.sections.getByNote(nid).map((r) => r.anchor);
    expect(second).toEqual(first);
  });

  it("mapChunksToSections bins chunks into the innermost containing section", () => {
    // 3 ranges: outer covers [0, 100), middle covers [10, 50), inner covers [20, 40).
    const ranges = [
      { start: 0, end: 100 },
      { start: 10, end: 50 },
      { start: 20, end: 40 },
    ];
    const chunks = [
      // chunk at offset 5 → only outer covers it.
      { id: 1, start_offset: 5 },
      // chunk at offset 25 → all three; innermost (last) wins.
      { id: 2, start_offset: 25 },
      // chunk at offset 45 → outer + middle but not inner.
      { id: 3, start_offset: 45 },
    ] as Array<{ id: number; start_offset: number }> as any;
    const out = mapChunksToSections(chunks, ranges);
    // Outer: only chunk 1.
    expect(out[0]).toEqual({ first: 1, last: 1 });
    // Middle: only chunk 3 (chunk 2 was claimed by inner).
    expect(out[1]).toEqual({ first: 3, last: 3 });
    // Inner: only chunk 2.
    expect(out[2]).toEqual({ first: 2, last: 2 });
  });

  it("extractStatus reads `status` from a frontmatter object", () => {
    expect(extractStatus({ status: "active" })).toBe("active");
    expect(extractStatus({ status: "superseded", other: 1 })).toBe("superseded");
    expect(extractStatus({})).toBeNull();
    expect(extractStatus(null)).toBeNull();
    // Non-string status values (number, array, object) are dropped.
    expect(extractStatus({ status: 42 })).toBeNull();
    expect(extractStatus({ status: ["a", "b"] })).toBeNull();
  });

  it("setStatus + getStatus round-trip for an indexer-style write", () => {
    const nid = seedNote("n.md", "x");
    // Mimic the indexer's call: write frontmatter via upsertByPath, then setStatus.
    db.notes.upsertByPath({
      path: "n.md",
      content: "x",
      frontmatter: JSON.stringify({ status: "active" }),
      title: "n",
      hash: "h",
      bodyHash: "bh",
      mtime: 0,
      wordCount: 1,
    });
    db.notes.setStatus(nid, extractStatus({ status: "active" }));
    expect(db.notes.getStatus(nid)).toBe("active");
    // Remove status from frontmatter → setStatus(null) clears.
    db.notes.setStatus(nid, extractStatus({}));
    expect(db.notes.getStatus(nid)).toBeNull();
  });
});
