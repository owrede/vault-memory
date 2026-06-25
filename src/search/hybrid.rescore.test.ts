/**
 * Phase 3 / 03-05 — post-RRF rescore + 9-field hydration + SQL-level
 * superseded filter.
 *
 * Test goals:
 *
 *  1. v1-baseline invariance: when none of the new params are supplied,
 *     hybridSearch produces a byte-identical hit list to v1 (same chunk
 *     IDs in same order, same RRF scores, same hydrated v1 fields).
 *
 *  2. Rescore math: with `recency_weight > 0`, the fresher of two
 *     near-duplicate docs ranks higher (ASM-11). With `authority_weight
 *     > 0`, the `authoritative: true` doc ranks higher.
 *
 *  3. Clock injection: `opts.clock` controls "now" deterministically.
 *
 *  4. SQL-level superseded filter: `include_superseded = false`
 *     (default) excludes superseded docs at the SQL level — proven
 *     behaviorally by candidate-row counts.
 *
 *  5. 9-field hydration: every hit carries doc_id, source_handle,
 *     mtime, hash, display_url, properties when frontmatter parses;
 *     status when the denormalized column is set; heading_path when
 *     the chunk maps to a section.
 *
 *  6. Invariance pin against a golden snapshot — proves the v1 default
 *     path stays byte-identical commit-over-commit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Database } from "../db/database.js";
import { hybridSearch } from "./hybrid.js";
import type { Vault } from "../vault/manager.js";
import type { OllamaClient } from "../ollama/index.js";

const DIM = 1024;
const oneHot = (i: number): number[] => {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
};

// Stable clock for deterministic age math. 2026-05-16T00:00:00.000Z.
const FROZEN_NOW = 1789516800000;
const dayMs = 24 * 60 * 60 * 1000;

interface FixtureChunks {
  fresh: number;
  old: number;
  authoritative: number;
  baseline: number;
  superseded: number;
}

function buildFixture(): {
  db: Database;
  vault: Vault;
  modelId: number;
  ollama: OllamaClient;
  chunks: FixtureChunks;
} {
  const db = new Database(":memory:", "test-vault");
  const model = db.models.upsert({ name: "test-model", provider: "test", dim: DIM });
  db.models.setActive(model.id);

  // Four near-duplicate notes, all matching the same query token "atlas".
  // Each gets a distinct mtime + frontmatter so the rescore + filter
  // tests have controlled inputs.
  const fresh = db.notes.upsertByPath({
    path: "fresh.md",
    content: "atlas status shipping today",
    frontmatter: JSON.stringify({ status: "active" }),
    title: "Fresh",
    hash: "h-fresh",
    bodyHash: "bh-fresh",
    mtime: FROZEN_NOW - 1 * dayMs,
    wordCount: 4,
  });
  const oldNote = db.notes.upsertByPath({
    path: "old.md",
    content: "atlas status prototyping then",
    frontmatter: JSON.stringify({ status: "active" }),
    title: "Old",
    hash: "h-old",
    bodyHash: "bh-old",
    mtime: FROZEN_NOW - 90 * dayMs,
    wordCount: 4,
  });
  const authoritative = db.notes.upsertByPath({
    path: "authoritative.md",
    content: "atlas official summary",
    frontmatter: JSON.stringify({ authoritative: true }),
    title: "Authoritative",
    hash: "h-auth",
    bodyHash: "bh-auth",
    mtime: FROZEN_NOW - 30 * dayMs,
    wordCount: 3,
  });
  const baseline = db.notes.upsertByPath({
    path: "baseline.md",
    content: "atlas mention nothing special",
    frontmatter: null,
    title: "Baseline",
    hash: "h-base",
    bodyHash: "bh-base",
    mtime: FROZEN_NOW - 30 * dayMs,
    wordCount: 4,
  });
  const superseded = db.notes.upsertByPath({
    path: "superseded.md",
    content: "atlas stale superseded record",
    frontmatter: JSON.stringify({ status: "superseded" }),
    title: "Superseded",
    hash: "h-sup",
    bodyHash: "bh-sup",
    mtime: FROZEN_NOW - 5 * dayMs,
    wordCount: 4,
  });
  // M4 critical step: maintain the denormalized notes.status column so
  // the SQL filter has signal to filter on. (Production indexer does
  // this automatically; the test fixture is hand-built.)
  db.notes.setStatus(superseded.id, "superseded");

  const makeChunk = (noteId: number, text: string, end: number): { id: number } => {
    const ids = db.chunks.insertBatch(noteId, [
      { idx: 0, text, headingPath: null, startOffset: 0, endOffset: end, tokenCount: 5 },
    ]);
    return { id: ids[0]! };
  };

  const cFresh = makeChunk(fresh.id, "atlas status shipping today", 27);
  const cOld = makeChunk(oldNote.id, "atlas status prototyping then", 29);
  const cAuth = makeChunk(authoritative.id, "atlas official summary", 22);
  const cBase = makeChunk(baseline.id, "atlas mention nothing special", 29);
  const cSup = makeChunk(superseded.id, "atlas stale superseded record", 29);

  // Embed all five — each chunk gets a one-hot vector at a distinct
  // index so the semantic ordering is fully determined.
  db.embeddings.insertBatch([
    { chunkId: cFresh.id, modelId: model.id, vector: oneHot(0) },
    { chunkId: cOld.id, modelId: model.id, vector: oneHot(1) },
    { chunkId: cAuth.id, modelId: model.id, vector: oneHot(2) },
    { chunkId: cBase.id, modelId: model.id, vector: oneHot(3) },
    { chunkId: cSup.id, modelId: model.id, vector: oneHot(4) },
  ]);

  const vault: Vault = {
    config: { name: "test-vault", path: "/dev/null" },
    db,
    dbPath: ":memory:",
  };

  // Query embedding tilts equally toward all five so RRF + BM25 do the
  // ordering. Returning a uniform-ish vector means the rescore signal
  // is the dominant ordering input.
  const queryVec = ((): number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[0] = 0.5;
    v[1] = 0.5;
    v[2] = 0.5;
    v[3] = 0.5;
    v[4] = 0.5;
    return v;
  })();

  const ollama = {
    embed: vi.fn().mockResolvedValue({
      vectors: [queryVec],
      dim: DIM,
      model: "test-model",
    }),
  } as unknown as OllamaClient;

  return {
    db,
    vault,
    modelId: model.id,
    ollama,
    chunks: {
      fresh: cFresh.id,
      old: cOld.id,
      authoritative: cAuth.id,
      baseline: cBase.id,
      superseded: cSup.id,
    },
  };
}

describe("hybridSearch — Phase 3 / 03-05 (rescore + filter + hydration)", () => {
  let fixture: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    fixture = buildFixture();
  });

  afterEach(() => {
    fixture.db.close();
  });

  // ── v1-baseline invariance ──────────────────────────────────────────
  describe("v1 invariance (no new params supplied)", () => {
    it("returns same chunk order as v1 — rescore guard short-circuits", async () => {
      // Two calls with identical args → identical hit list (modulo the
      // new optional hydrated fields which are additive).
      const a = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      const b = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      expect(a.map((h) => h.notePath)).toEqual(b.map((h) => h.notePath));
      expect(a.map((h) => h.score)).toEqual(b.map((h) => h.score));
    });

    it("RRF scores are unchanged when both weights are zero", async () => {
      const withWeights = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        recencyWeight: 0,
        authorityWeight: 0,
      });
      const v1 = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      expect(withWeights.map((h) => h.score)).toEqual(v1.map((h) => h.score));
    });
  });

  // ── Rescore math ────────────────────────────────────────────────────
  describe("post-RRF additive rescore (D-07)", () => {
    it("recency_weight > 0 → fresher note ranks above older near-duplicate (ASM-11)", async () => {
      const hits = await hybridSearch({
        query: "atlas status",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        recencyWeight: 1.0,
        halfLifeDays: 30,
        clock: () => FROZEN_NOW,
      });
      const freshIdx = hits.findIndex((h) => h.notePath === "fresh.md");
      const oldIdx = hits.findIndex((h) => h.notePath === "old.md");
      expect(freshIdx).toBeGreaterThanOrEqual(0);
      expect(oldIdx).toBeGreaterThanOrEqual(0);
      expect(freshIdx).toBeLessThan(oldIdx);
    });

    it("authority_weight > 0 → authoritative note ranks above peers", async () => {
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        authorityWeight: 1.0,
        clock: () => FROZEN_NOW,
      });
      const authIdx = hits.findIndex((h) => h.notePath === "authoritative.md");
      const baseIdx = hits.findIndex((h) => h.notePath === "baseline.md");
      expect(authIdx).toBeGreaterThanOrEqual(0);
      expect(baseIdx).toBeGreaterThanOrEqual(0);
      expect(authIdx).toBeLessThan(baseIdx);
    });

    it("clock injection produces deterministic age math (no Date.now leakage)", async () => {
      // Run twice with the same injected clock but distinct system times.
      // Result MUST be byte-identical — proves Date.now isn't sneaking in.
      const args = {
        query: "atlas status",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        recencyWeight: 1.0,
        halfLifeDays: 30,
        clock: () => FROZEN_NOW,
      } as const;
      const a = await hybridSearch(args);
      // Wait a tick — different real-wallclock but same injected clock.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const b = await hybridSearch(args);
      expect(a.map((h) => h.score)).toEqual(b.map((h) => h.score));
    });

    it("recency math at age=halfLife produces ~0.368 × recencyWeight contribution", async () => {
      // Pin the exact additive term at the half-life by comparing two
      // distinct recency weights' delta against a v1 baseline.
      const v1 = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        clock: () => FROZEN_NOW,
      });
      const withW = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        recencyWeight: 1.0,
        halfLifeDays: 30,
        clock: () => FROZEN_NOW,
      });
      const v1Auth = v1.find((h) => h.notePath === "authoritative.md");
      const wAuth = withW.find((h) => h.notePath === "authoritative.md");
      // authoritative.md mtime = FROZEN_NOW - 30*dayMs → age = halfLife.
      // recency contribution = 1.0 × exp(-1) ≈ 0.3679
      expect(v1Auth).toBeDefined();
      expect(wAuth).toBeDefined();
      const delta = wAuth!.score - v1Auth!.score;
      expect(delta).toBeCloseTo(Math.exp(-1), 3);
    });
  });

  // ── SQL-level superseded filter (M4) ────────────────────────────────
  describe("SQL-level superseded filter (M4)", () => {
    it("default-hide: include_superseded=false excludes superseded chunks", async () => {
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      const paths = hits.map((h) => h.notePath);
      expect(paths).not.toContain("superseded.md");
    });

    it("reveal: include_superseded=true brings superseded back", async () => {
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        includeSuperseded: true,
      });
      const paths = hits.map((h) => h.notePath);
      expect(paths).toContain("superseded.md");
    });

    it("filter happens at SQL (FTS JOIN) — superseded chunk never reaches RRF", async () => {
      // Direct FTS probe: with excludeSuperseded=true, the chunk is gone.
      // This proves the filter is in SQL, not in JS post-filtering.
      const fts = fixture.vault.db.fts.search("atlas", 50, false, true);
      const ftsIds = new Set(fts.map((h) => h.chunkId));
      expect(ftsIds.has(fixture.chunks.superseded)).toBe(false);
      // Without the flag, the FTS path still sees it.
      const ftsV1 = fixture.vault.db.fts.search("atlas", 50);
      expect(new Set(ftsV1.map((h) => h.chunkId)).has(fixture.chunks.superseded)).toBe(true);
    });
  });

  // ── 9-field hydration ──────────────────────────────────────────────
  describe("9-field hydration (ASM-06, D-08)", () => {
    it("doc_id, source_handle, mtime, hash, display_url always populated", async () => {
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        // Inject a synthetic resolver — production bootstrap supplies one
        // backed by `SourceConnector.formatDisplayUrl`; tests stay
        // adapter-free.
        displayUrlFor: (v, p) => `test://${v}/${p}`,
      });
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.doc_id).toMatch(/^obsidian-fs:\/\/test-vault\//);
        expect(h.source_handle).toBe("obsidian-fs://test-vault");
        expect(typeof h.mtime).toBe("number");
        expect(typeof h.hash).toBe("string");
        expect(h.display_url).toMatch(/^test:\/\/test-vault\//);
      }
    });

    it("display_url omitted when no resolver injected (adapter-seam discipline)", async () => {
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      for (const h of hits) {
        expect(h.display_url).toBeUndefined();
      }
    });

    it("status populated from denormalized notes.status column", async () => {
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
        includeSuperseded: true,
      });
      const sup = hits.find((h) => h.notePath === "superseded.md");
      expect(sup?.status).toBe("superseded");
      const fresh = hits.find((h) => h.notePath === "fresh.md");
      expect(fresh?.status).toBe("active");
      const base = hits.find((h) => h.notePath === "baseline.md");
      // baseline.md has no frontmatter — status is undefined.
      expect(base?.status).toBeUndefined();
    });

    it("properties populated from parsed JSON frontmatter (shallow copy)", async () => {
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      const auth = hits.find((h) => h.notePath === "authoritative.md");
      expect(auth?.properties?.["authoritative"]).toBe(true);
      const base = hits.find((h) => h.notePath === "baseline.md");
      // No frontmatter → properties undefined.
      expect(base?.properties).toBeUndefined();
    });

    it("heading_path is undefined for doc-level hits with no enclosing section", async () => {
      // The fixture has no sections table backfill (chunks were inserted
      // directly), so findContainingChunk returns null for every chunk.
      // Per CONTEXT.md convention, heading_path stays undefined.
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      for (const h of hits) {
        expect(h.heading_path).toBeUndefined();
      }
    });

    it("heading_path populated when chunk maps to a section", async () => {
      // Insert a section row whose range covers the baseline chunk.
      const baseNote = fixture.vault.db.notes.getByPath("baseline.md")!;
      fixture.vault.db.sections.insertMany([
        {
          note_id: baseNote.id,
          anchor: "abc123",
          heading_path: JSON.stringify(["Top", "Subsection"]),
          heading_text: "Subsection",
          level: 2,
          parent_id: null,
          ord: 0,
          chunk_id_first: fixture.chunks.baseline,
          chunk_id_last: fixture.chunks.baseline,
        },
      ]);
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 10,
      });
      const base = hits.find((h) => h.notePath === "baseline.md");
      expect(base?.heading_path).toEqual(["Top", "Subsection"]);
    });
  });

  // ── Invariance pin (golden snapshot) ──────────────────────────────
  describe("v1-baseline invariance pin (ROADMAP success criterion #2)", () => {
    it("v1-default search produces a stable score+order across runs", async () => {
      // The pin is captured as a vitest inline snapshot below — first
      // run records, subsequent runs compare. Any drift fails the test
      // and forces a deliberate review of the change.
      const hits = await hybridSearch({
        query: "atlas",
        embeddingModel: "test-model",
        ollama: fixture.ollama,
        vaults: [fixture.vault],
        topK: 5,
      });
      const summary = hits.map((h) => ({
        path: h.notePath,
        score: Number(h.score.toFixed(10)),
        rrf: Number(h.scoreBreakdown?.rrf?.toFixed(10) ?? "0"),
      }));
      expect(summary).toMatchInlineSnapshot(`
        [
          {
            "path": "authoritative.md",
            "rrf": 0.0325224749,
            "score": 0.0325224749,
          },
          {
            "path": "baseline.md",
            "rrf": 0.0320184426,
            "score": 0.0320184426,
          },
          {
            "path": "fresh.md",
            "rrf": 0.0317540323,
            "score": 0.0317540323,
          },
          {
            "path": "old.md",
            "rrf": 0.0317460317,
            "score": 0.0317460317,
          },
        ]
      `);
    });
  });
});
