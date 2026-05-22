/**
 * Unit tests for `searchSections` (ASM-03).
 *
 * Strategy: a stub `searchHybrid` returns fixed `SearchHit[]` candidates;
 * a stub `sectionForHit` returns prefab `SectionResolution` rows; a stub
 * `readDocument` returns synthesized `Document` objects. This isolates
 * the controller's promote-dedup-rank pipeline from the DB, the
 * filesystem, and the v1 RRF implementation.
 *
 * Pinned behaviors (per 03-03-PLAN.md "Files to create" §a–f):
 *   a) single chunk → one section; section.score == chunk.score
 *   b) multi-chunk-per-section query → section count ≤ limit;
 *      section.score == max(constituent chunk scores)
 *   c) chunks across multiple notes → one section hit per (note, section)
 *   d) tie-break: equal scores → sort by chunk_id_first ASC
 *   e) orphan chunk (`sectionForHit` returns null) silently dropped
 *   f) every section hit carries non-empty `heading_path`
 *
 * Plus contract assertions:
 *   - inflated topK = limit × 5 passed to inner hybridSearch
 *   - rescore params (recency_weight / authority_weight / include_superseded)
 *     are accepted on the args boundary (forwarded once 03-05 lands)
 *   - preamble sections (level 0, empty heading_path) are dropped
 *   - empty hybridSearch result → []
 *   - `readDocument` throw → hit silently dropped (recall-style)
 *
 * Plus an integration smoke at the bottom that wires a real
 * `findContainingChunk` against an in-memory SQLite DB seeded by the
 * indexer; asserts the end-to-end chunk-to-section promotion produces
 * the expected ranking under a stub `searchHybrid`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DocId, Document, SearchHit, SourceHandle } from "../types.js";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import {
  searchSections,
  type SearchSectionsDeps,
  type SearchSectionsHybridInput,
  type SectionResolution,
} from "./search-sections.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VAULT = "test-vault";
const SOURCE: SourceHandle = parseSourceHandle(`obsidian-fs://${VAULT}`);

function makeHit(opts: {
  notePath: string;
  chunkIdx: number;
  score: number;
  chunkText?: string;
  vault?: string;
}): SearchHit {
  return {
    vault: opts.vault ?? VAULT,
    notePath: opts.notePath,
    noteTitle: opts.notePath.replace(/\.md$/, ""),
    chunkText: opts.chunkText ?? `chunk text for ${opts.notePath}#${opts.chunkIdx}`,
    chunkIdx: opts.chunkIdx,
    headingPath: null,
    score: opts.score,
  };
}

function makeDoc(notePath: string, properties: Record<string, unknown> = {}): Document {
  return {
    id: formatDocId("obsidian-fs", VAULT, notePath),
    source: SOURCE,
    title: notePath.replace(/\.md$/, ""),
    blocks: [{ kind: "paragraph", text: "body" }],
    properties,
    links: [],
    mtime: 1_700_000_000_000,
    hash: `hash-${notePath}`,
  };
}

/** Wire a deps bag from per-test fixture maps. */
function buildDeps(opts: {
  candidates: SearchHit[];
  /** map keyed by `${notePath}#${chunkIdx}` → resolution (or null for orphan). */
  resolutions: Map<string, SectionResolution | null>;
  /** map keyed by notePath → doc (or undefined to throw — simulates stale). */
  docs: Map<string, Document>;
  /** captures the args the inner searchHybrid is called with. */
  hybridCalls?: SearchSectionsHybridInput[];
}): SearchSectionsDeps {
  return {
    searchHybrid: async (input) => {
      opts.hybridCalls?.push(input);
      return opts.candidates;
    },
    sectionForHit: (vaultName, notePath, chunkIdx) => {
      if (vaultName !== VAULT) return null;
      return opts.resolutions.get(`${notePath}#${chunkIdx}`) ?? null;
    },
    readDocument: async (_vaultName, notePath) => {
      const d = opts.docs.get(notePath);
      if (!d) throw new Error(`stale: ${notePath}`);
      return d;
    },
    displayUrlFor: (docId, _vault) => `obsidian://stub?id=${encodeURIComponent(docId)}`,
  };
}

// ─── Unit tests ──────────────────────────────────────────────────────────────

describe("searchSections — chunk → section promotion", () => {
  it("(a) single chunk → one section hit; section.score == chunk.score", async () => {
    const deps = buildDeps({
      candidates: [makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.42 })],
      resolutions: new Map([
        [
          "alpha.md#1",
          {
            noteId: 100,
            anchor: "anchor-A",
            headingPath: ["Alpha", "Plan"],
            chunkIdFirst: 10,
          },
        ],
      ]),
      docs: new Map([["alpha.md", makeDoc("alpha.md")]]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(0.42);
    expect(out[0]!.anchor).toBe("anchor-A");
    expect(out[0]!.heading_path).toEqual(["Alpha", "Plan"]);
    expect(out[0]!.chunk_ids).toEqual([1]);
  });

  it("(b) multiple chunk hits in same section → one result; score = max", async () => {
    const deps = buildDeps({
      candidates: [
        makeHit({ notePath: "alpha.md", chunkIdx: 5, score: 0.3 }),
        makeHit({ notePath: "alpha.md", chunkIdx: 6, score: 0.8 }),
        makeHit({ notePath: "alpha.md", chunkIdx: 7, score: 0.5 }),
      ],
      resolutions: new Map([
        ["alpha.md#5", { noteId: 100, anchor: "A", headingPath: ["H"], chunkIdFirst: 5 }],
        ["alpha.md#6", { noteId: 100, anchor: "A", headingPath: ["H"], chunkIdFirst: 5 }],
        ["alpha.md#7", { noteId: 100, anchor: "A", headingPath: ["H"], chunkIdFirst: 5 }],
      ]),
      docs: new Map([["alpha.md", makeDoc("alpha.md")]]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(0.8);
    // All three chunks listed.
    expect(out[0]!.chunk_ids.slice().sort()).toEqual([5, 6, 7]);
    // Snippet sourced from the best-scoring chunk (idx 6).
    expect(out[0]!.snippet).toContain("alpha.md#6");
  });

  it("(c) chunks across multiple notes → one section hit per (note, section)", async () => {
    const deps = buildDeps({
      candidates: [
        makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.5 }),
        makeHit({ notePath: "beta.md", chunkIdx: 1, score: 0.6 }),
        makeHit({ notePath: "alpha.md", chunkIdx: 2, score: 0.4 }),
      ],
      resolutions: new Map([
        ["alpha.md#1", { noteId: 1, anchor: "A1", headingPath: ["Alpha"], chunkIdFirst: 1 }],
        ["alpha.md#2", { noteId: 1, anchor: "A2", headingPath: ["Alpha", "Sub"], chunkIdFirst: 2 }],
        ["beta.md#1", { noteId: 2, anchor: "B1", headingPath: ["Beta"], chunkIdFirst: 1 }],
      ]),
      docs: new Map([
        ["alpha.md", makeDoc("alpha.md")],
        ["beta.md", makeDoc("beta.md")],
      ]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out).toHaveLength(3);
    // Sort by score DESC: beta(0.60), alpha-A1(0.50), alpha-A2(0.40).
    expect(out.map((h) => h.anchor)).toEqual(["B1", "A1", "A2"]);
  });

  it("(d) tie-break: equal scores → sort by chunk_id_first ASC", async () => {
    const deps = buildDeps({
      candidates: [
        makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.5 }),
        makeHit({ notePath: "alpha.md", chunkIdx: 2, score: 0.5 }),
        makeHit({ notePath: "alpha.md", chunkIdx: 3, score: 0.5 }),
      ],
      resolutions: new Map([
        // Three distinct sections, same score, different chunk_id_first.
        ["alpha.md#1", { noteId: 1, anchor: "S-late", headingPath: ["L"], chunkIdFirst: 30 }],
        ["alpha.md#2", { noteId: 1, anchor: "S-mid", headingPath: ["M"], chunkIdFirst: 20 }],
        ["alpha.md#3", { noteId: 1, anchor: "S-early", headingPath: ["E"], chunkIdFirst: 10 }],
      ]),
      docs: new Map([["alpha.md", makeDoc("alpha.md")]]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out.map((h) => h.anchor)).toEqual(["S-early", "S-mid", "S-late"]);
  });

  it("(e) orphan chunk (sectionForHit returns null) is silently dropped", async () => {
    const deps = buildDeps({
      candidates: [
        makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.9 }),
        makeHit({ notePath: "orphan.md", chunkIdx: 99, score: 0.99 }), // orphan
      ],
      resolutions: new Map([
        ["alpha.md#1", { noteId: 1, anchor: "A", headingPath: ["X"], chunkIdFirst: 1 }],
        ["orphan.md#99", null],
      ]),
      docs: new Map([["alpha.md", makeDoc("alpha.md")]]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.anchor).toBe("A");
  });

  it("(f) every section hit carries non-empty heading_path", async () => {
    // Mix of valid + preamble (empty heading_path).
    const deps = buildDeps({
      candidates: [
        makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.9 }),
        makeHit({ notePath: "alpha.md", chunkIdx: 2, score: 0.5 }),
      ],
      resolutions: new Map([
        // Preamble — must be dropped.
        ["alpha.md#1", { noteId: 1, anchor: "preamble", headingPath: [], chunkIdFirst: 0 }],
        [
          "alpha.md#2",
          {
            noteId: 1,
            anchor: "real",
            headingPath: ["Real", "Heading"],
            chunkIdFirst: 2,
          },
        ],
      ]),
      docs: new Map([["alpha.md", makeDoc("alpha.md")]]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.anchor).toBe("real");
    for (const h of out) {
      expect(h.heading_path.length).toBeGreaterThan(0);
    }
  });
});

describe("searchSections — contract assertions", () => {
  it("calls inner searchHybrid exactly once with topK = limit × 5", async () => {
    const hybridCalls: SearchSectionsHybridInput[] = [];
    const deps = buildDeps({
      candidates: [],
      resolutions: new Map(),
      docs: new Map(),
      hybridCalls,
    });
    await searchSections(deps, { query: "q", limit: 8 });
    expect(hybridCalls).toHaveLength(1);
    expect(hybridCalls[0]!.topK).toBe(40);
    expect(hybridCalls[0]!.query).toBe("q");
  });

  it("forwards `vaults` filter into searchHybrid", async () => {
    const hybridCalls: SearchSectionsHybridInput[] = [];
    const deps = buildDeps({
      candidates: [],
      resolutions: new Map(),
      docs: new Map(),
      hybridCalls,
    });
    await searchSections(deps, { query: "q", limit: 3, vaults: ["v1", "v2"] });
    expect(hybridCalls[0]!.vaults).toEqual(["v1", "v2"]);
  });

  it("accepts rescore params on the args boundary (forward-compat with 03-05)", async () => {
    const deps = buildDeps({
      candidates: [],
      resolutions: new Map(),
      docs: new Map(),
    });
    // Just ensure these args do not crash; once 03-05 lands the controller
    // will forward them into the hybridSearch options.
    await expect(
      searchSections(deps, {
        query: "q",
        limit: 3,
        recency_weight: 0.5,
        authority_weight: 0.2,
        include_superseded: true,
      }),
    ).resolves.toBeDefined();
  });

  it("empty inner search → []", async () => {
    const deps = buildDeps({
      candidates: [],
      resolutions: new Map(),
      docs: new Map(),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out).toEqual([]);
  });

  it("readDocument throw → hit silently dropped (recall-style)", async () => {
    const deps = buildDeps({
      candidates: [
        makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.9 }),
        makeHit({ notePath: "stale.md", chunkIdx: 1, score: 0.7 }),
      ],
      resolutions: new Map([
        ["alpha.md#1", { noteId: 1, anchor: "A", headingPath: ["X"], chunkIdFirst: 1 }],
        ["stale.md#1", { noteId: 2, anchor: "S", headingPath: ["Y"], chunkIdFirst: 1 }],
      ]),
      // Only alpha.md is readable — stale.md throws on read.
      docs: new Map([["alpha.md", makeDoc("alpha.md")]]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.anchor).toBe("A");
  });

  it("respects `limit` (slices after sort)", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeHit({ notePath: `n${i}.md`, chunkIdx: 1, score: 1 - i * 0.01 }),
    );
    const resolutions = new Map<string, SectionResolution | null>();
    const docs = new Map<string, Document>();
    for (let i = 0; i < 10; i++) {
      resolutions.set(`n${i}.md#1`, {
        noteId: i,
        anchor: `a${i}`,
        headingPath: [`H${i}`],
        chunkIdFirst: 1,
      });
      docs.set(`n${i}.md`, makeDoc(`n${i}.md`));
    }
    const deps = buildDeps({ candidates, resolutions, docs });
    const out = await searchSections(deps, { query: "q", limit: 3 });
    expect(out).toHaveLength(3);
    // Top three by score.
    expect(out.map((h) => h.anchor)).toEqual(["a0", "a1", "a2"]);
  });

  it("citation packet shape: 8 D-01 fields present on each hit", async () => {
    const deps = buildDeps({
      candidates: [makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.5 })],
      resolutions: new Map([
        ["alpha.md#1", { noteId: 1, anchor: "A", headingPath: ["X"], chunkIdFirst: 1 }],
      ]),
      docs: new Map([["alpha.md", makeDoc("alpha.md", { tag: "memo" })]]),
    });
    const out = await searchSections(deps, { query: "q", limit: 10 });
    const h = out[0]!;
    expect(h.doc_id).toBeTruthy();
    expect(h.source_handle).toBe(SOURCE);
    expect(h.title).toBe("alpha");
    expect(h.heading_path).toEqual(["X"]);
    expect(typeof h.mtime).toBe("number");
    expect(h.hash).toBe("hash-alpha.md");
    expect(h.display_url).toContain("obsidian://");
    expect(h.properties).toEqual({ tag: "memo" });
  });
});

// ─── Integration smoke ───────────────────────────────────────────────────────
//
// Wires a real `findContainingChunk` against an in-memory SQLite DB
// seeded by the section indexer; asserts the end-to-end chunk-to-section
// promotion under a stub `searchHybrid`.
//
// Test-file imports below pierce the adapter seam (Database, Vault); this
// is allowed for *.test.ts (the lint script excludes test files).

import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { buildSectionsForNote } from "../indexer/indexer.js";

describe("searchSections — integration smoke (real DB, stub searchHybrid)", () => {
  let db: Database;
  let vault: Vault;

  beforeEach(() => {
    db = new Database(":memory:", VAULT);
    db.migrate();
    vault = {
      config: { name: VAULT, path: "/tmp/test-vault" },
      db,
      dbPath: ":memory:",
    };
  });

  afterEach(() => {
    db.close();
  });

  it("end-to-end: chunks → sections via findContainingChunk; results ranked by score", async () => {
    // Seed two notes with multi-section content; mirror the indexer's
    // upsertByPath → insertBatch → buildSectionsForNote sequence used by
    // the live indexer pipeline.
    const alphaContent =
      "# Alpha\nIntro for alpha.\n\n## Plan\nplan body of alpha.\n\n## Status\nstatus body.\n";
    const betaContent = "# Beta\nbeta body content.\n";

    const alphaNote = db.notes.upsertByPath({
      path: "alpha.md",
      content: alphaContent,
      frontmatter: null,
      title: "Alpha",
      hash: "h-alpha",
      bodyHash: "bh-alpha",
      mtime: 1,
      wordCount: 10,
    });
    const planOffset = alphaContent.indexOf("plan body of alpha.");
    const statusOffset = alphaContent.indexOf("status body.");
    const alphaChunkIds = db.chunks.insertBatch(alphaNote.id, [
      {
        idx: 0,
        text: "plan body of alpha.",
        headingPath: null,
        startOffset: planOffset,
        endOffset: planOffset + 19,
        tokenCount: 4,
      },
      {
        idx: 1,
        text: "status body.",
        headingPath: null,
        startOffset: statusOffset,
        endOffset: statusOffset + 12,
        tokenCount: 2,
      },
    ]);
    buildSectionsForNote(vault, alphaNote.id, alphaContent, alphaChunkIds);

    const betaNote = db.notes.upsertByPath({
      path: "beta.md",
      content: betaContent,
      frontmatter: null,
      title: "Beta",
      hash: "h-beta",
      bodyHash: "bh-beta",
      mtime: 1,
      wordCount: 4,
    });
    const betaChunkIds = db.chunks.insertBatch(betaNote.id, [
      {
        idx: 0,
        text: "beta body content.",
        headingPath: null,
        startOffset: betaContent.indexOf("beta body"),
        endOffset: betaContent.indexOf("beta body") + 18,
        tokenCount: 4,
      },
    ]);
    buildSectionsForNote(vault, betaNote.id, betaContent, betaChunkIds);

    // Build the production-style deps using the real DB.
    const deps: SearchSectionsDeps = {
      searchHybrid: async () => [
        makeHit({ notePath: "alpha.md", chunkIdx: 0, score: 0.5 }), // → Plan
        makeHit({ notePath: "beta.md", chunkIdx: 0, score: 0.9 }), // → Beta
        makeHit({ notePath: "alpha.md", chunkIdx: 1, score: 0.3 }), // → Status
      ],
      sectionForHit: (_vaultName, notePath, chunkIdx) => {
        const note = db.notes.getByPath(notePath);
        if (!note) return null;
        const chunks = db.chunks.getByNote(note.id);
        const chunk = chunks.find((c) => c.idx === chunkIdx);
        if (!chunk) return null;
        const section = db.sections.findContainingChunk(note.id, chunk.id);
        if (!section) return null;
        return {
          noteId: note.id,
          anchor: section.anchor,
          headingPath: JSON.parse(section.heading_path) as string[],
          chunkIdFirst: section.chunk_id_first ?? Number.MAX_SAFE_INTEGER,
        };
      },
      readDocument: async (_vaultName, notePath) => makeDoc(notePath),
      displayUrlFor: (docId) => `obsidian://stub?id=${encodeURIComponent(docId)}`,
    };

    const out = await searchSections(deps, { query: "q", limit: 10 });
    // Three distinct sections: Plan, Beta, Status — ranked by score DESC.
    expect(out).toHaveLength(3);
    expect(out.map((h) => h.heading_path[h.heading_path.length - 1])).toEqual([
      "Beta",
      "Plan",
      "Status",
    ]);
    // Anchors are non-empty hex strings (ADR-003 H-7).
    for (const h of out) {
      expect(h.anchor).toMatch(/^[0-9a-f]+$/);
    }
  });
});
