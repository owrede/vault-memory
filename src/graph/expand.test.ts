/**
 * Tests for `expand()` — Phase 4 / 04-03 / GRA-01.
 *
 * Coverage (Plan 04-03 §<behavior>):
 *   - Tests 1–5: `isShorterPath` comparator (Pitfall 4).
 *   - Tests 6–8: BFS 1-hop / 2-hop / shortest-path dedup across seeds.
 *   - Test 9:   direction filter (forward-only).
 *   - Test 10:  edge_types filter.
 *   - Test 11:  filter_properties strict equality.
 *   - Tests 12–13: include_superseded default + override.
 *   - Tests 14–15: warnings on unknown / empty seeds.
 *   - Test 16:  `_memory` opacity (ADR-004 + Pitfall 3).
 *   - Tests 17–18: self-loop / self-wikilink skip.
 *   - Test 19:  citation-packet shape (8 fields + via).
 *
 * Strategy mirrors `src/assembly/dossier.test.ts`: in-memory SQLite
 * fixture + stub `SourceConnector` + faked `VaultManager`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { Database } from "../db/index.js";
import type { DocId, Document, SourceHandle } from "../types.js";
import { VaultManager, type Vault } from "../vault/index.js";
import { expand, isShorterPath, type ExpandDeps, type ViaTrace } from "./expand.js";

const VAULT_NAME = "test-vault";

// ─── fixture builder ─────────────────────────────────────────────────────────

interface FxNote {
  notePath: string;
  title: string;
  frontmatter?: Record<string, unknown>;
}

interface FxEdge {
  source: string;
  target: string;
  type: "wikilink" | "mention" | "frontmatter-ref" | "hyperlink";
  /** When set: unresolved edge — target_doc null, target_path = raw string. */
  unresolvedTarget?: string;
  anchor?: string | null;
  lineNumber?: number | null;
}

interface Fixture {
  vault: Vault;
  manager: VaultManager;
  notesByPath: Map<string, FxNote>;
  idByPath: Map<string, number>;
  pathById: Map<number, string>;
  deps: ExpandDeps;
  cleanup: () => void;
}

function buildFixture(notes: FxNote[], edges: FxEdge[] = []): Fixture {
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: "/fake/vault/path", write_enabled: false },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  const notesByPath = new Map<string, FxNote>();
  const idByPath = new Map<string, number>();
  const pathById = new Map<number, string>();
  const now = Date.now();
  for (const spec of notes) {
    notesByPath.set(spec.notePath, spec);
    const res = vault.db.notes.upsertByPath({
      path: spec.notePath,
      content: spec.title,
      frontmatter: spec.frontmatter ? JSON.stringify(spec.frontmatter) : null,
      title: spec.title,
      hash: `hash-${spec.notePath}`,
      bodyHash: `bhash-${spec.notePath}`,
      mtime: now,
      wordCount: 1,
      vaultName: VAULT_NAME,
    });
    idByPath.set(spec.notePath, res.id);
    pathById.set(res.id, spec.notePath);
    // Phase 3 / 03-01 status denormalization mirror — keep notes.status
    // in sync with frontmatter.status so the supersede-filter tests
    // see consistent state at both the property bag AND the DB column.
    if (spec.frontmatter && typeof spec.frontmatter.status === "string") {
      vault.db.notes.setStatus(res.id, spec.frontmatter.status);
    }
  }

  // Group edges by source; respect unresolvedTarget for hyperlink rows.
  const bySource = new Map<string, FxEdge[]>();
  for (const e of edges) {
    if (!idByPath.has(e.source)) {
      throw new Error(`fixture edge.source missing: ${e.source}`);
    }
    if (!e.unresolvedTarget && !idByPath.has(e.target)) {
      throw new Error(`fixture edge.target missing: ${e.target}`);
    }
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source)?.push(e);
  }
  for (const [src, group] of bySource) {
    const srcId = idByPath.get(src) as number;
    const inputs = group.map((e, idx) => ({
      targetNoteId: e.unresolvedTarget ? null : (idByPath.get(e.target) ?? null),
      targetPath: e.unresolvedTarget ?? e.target,
      type: e.type,
      rel: null,
      anchor: e.anchor ?? null,
      lineNumber: e.lineNumber ?? idx + 1,
      linkText: null,
    }));
    vault.db.edges.insertBatch(srcId, inputs);
  }

  // Stub SourceConnector — synthesizes a Document from the seeded
  // note row + frontmatter. Mirrors the dossier.test.ts stub.
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
      // not used by expand
    },
    readDocument: async (id: DocId): Promise<Document> => {
      for (const [notePath, spec] of notesByPath) {
        if (id.endsWith(`/${notePath}`)) {
          return {
            id,
            source,
            title: spec.title,
            blocks: [{ kind: "paragraph", text: spec.title }],
            properties: { ...(spec.frontmatter ?? {}) },
            links: [],
            mtime: now,
            hash: `hash-${notePath}`,
          };
        }
      }
      throw new Error(`Doc not found: ${id}`);
    },
    hash: async (id: DocId) => {
      for (const [notePath] of notesByPath) {
        if (id.endsWith(`/${notePath}`)) return `hash-${notePath}`;
      }
      throw new Error(`Doc not found: ${id}`);
    },
    exists: async (id: DocId) => {
      for (const notePath of notesByPath.keys()) {
        if (id.endsWith(`/${notePath}`)) return true;
      }
      return false;
    },
    formatDisplayUrl: (id: DocId): string => {
      const schemeEnd = (id as string).indexOf("://");
      const rest = (id as string).slice(schemeEnd + 3);
      const slashIdx = rest.indexOf("/");
      const vaultName = rest.slice(0, slashIdx);
      const resource = rest.slice(slashIdx + 1);
      return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(resource)}`;
    },
  });

  return {
    vault,
    manager,
    notesByPath,
    idByPath,
    pathById,
    deps: { manager, sourceConnectorFor },
    cleanup: () => db.close(),
  };
}

function docIdFor(path: string): DocId {
  return formatDocId("obsidian-fs", VAULT_NAME, path);
}

// ─── Tests 1–5: isShorterPath comparator ────────────────────────────────────

describe("isShorterPath comparator (D-07 / Pitfall 4)", () => {
  const seedA = docIdFor("a.md");
  const seedB = docIdFor("b.md");

  it("Test 1: lower hop wins regardless of other fields", () => {
    const hop1: ViaTrace = {
      seed_doc_id: seedB,
      hop: 1,
      edge_type: "mention",
      direction: "backward",
    };
    const hop2: ViaTrace = {
      seed_doc_id: seedA,
      hop: 2,
      edge_type: "frontmatter-ref",
      direction: "forward",
    };
    expect(isShorterPath(hop1, hop2)).toBe(true);
    expect(isShorterPath(hop2, hop1)).toBe(false);
  });

  it("Test 2: same hop — lower seed_doc_id (lex) wins", () => {
    const a: ViaTrace = {
      seed_doc_id: seedA,
      hop: 2,
      edge_type: "mention",
      direction: "forward",
    };
    const b: ViaTrace = {
      seed_doc_id: seedB,
      hop: 2,
      edge_type: "wikilink", // earlier alpha — but seed dominates
      direction: "forward",
    };
    expect(isShorterPath(a, b)).toBe(true);
    expect(isShorterPath(b, a)).toBe(false);
  });

  it("Test 3: same hop + same seed — lower edge_type (alpha) wins", () => {
    // alpha order: frontmatter-ref < hyperlink < mention < wikilink
    const fmr: ViaTrace = {
      seed_doc_id: seedA,
      hop: 1,
      edge_type: "frontmatter-ref",
      direction: "backward",
    };
    const wl: ViaTrace = {
      seed_doc_id: seedA,
      hop: 1,
      edge_type: "wikilink",
      direction: "forward",
    };
    expect(isShorterPath(fmr, wl)).toBe(true);
    expect(isShorterPath(wl, fmr)).toBe(false);
  });

  it("Test 4: same hop + same seed + same edge_type — forward beats backward", () => {
    const f: ViaTrace = {
      seed_doc_id: seedA,
      hop: 1,
      edge_type: "wikilink",
      direction: "forward",
    };
    const b: ViaTrace = {
      seed_doc_id: seedA,
      hop: 1,
      edge_type: "wikilink",
      direction: "backward",
    };
    expect(isShorterPath(f, b)).toBe(true);
    expect(isShorterPath(b, f)).toBe(false);
  });

  it("Test 5: identical traces — comparator returns false (not strictly shorter)", () => {
    const x: ViaTrace = {
      seed_doc_id: seedA,
      hop: 1,
      edge_type: "wikilink",
      direction: "forward",
    };
    const y: ViaTrace = { ...x };
    expect(isShorterPath(x, y)).toBe(false);
    expect(isShorterPath(y, x)).toBe(false);
  });
});

// ─── Tests 6–18: expand() BFS behavior ───────────────────────────────────────

describe("expand() BFS", () => {
  let fx: Fixture;
  afterEach(() => {
    fx?.cleanup();
  });

  it("Test 6: 1-hop direction='both' returns 5 packets (3 forward + 2 backward)", async () => {
    // Seed A has 3 outbound (→B, →C, →D) and 2 inbound (E→A, F→A).
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "b.md", title: "B" },
        { notePath: "c.md", title: "C" },
        { notePath: "d.md", title: "D" },
        { notePath: "e.md", title: "E" },
        { notePath: "f.md", title: "F" },
      ],
      [
        { source: "a.md", target: "b.md", type: "wikilink" },
        { source: "a.md", target: "c.md", type: "mention" },
        { source: "a.md", target: "d.md", type: "frontmatter-ref" },
        { source: "e.md", target: "a.md", type: "wikilink" },
        { source: "f.md", target: "a.md", type: "mention" },
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
    });
    expect(res.warnings).toHaveLength(0);
    expect(res.documents).toHaveLength(5);
    for (const d of res.documents) {
      expect(d.via.hop).toBe(1);
      expect(d.via.seed_doc_id).toBe(docIdFor("a.md"));
    }
    // Forward neighbors have direction='forward', their edge_type matches.
    const byPath = new Map(res.documents.map((d) => [d.doc_id, d]));
    expect(byPath.get(docIdFor("b.md"))?.via.direction).toBe("forward");
    expect(byPath.get(docIdFor("b.md"))?.via.edge_type).toBe("wikilink");
    expect(byPath.get(docIdFor("c.md"))?.via.direction).toBe("forward");
    expect(byPath.get(docIdFor("c.md"))?.via.edge_type).toBe("mention");
    expect(byPath.get(docIdFor("d.md"))?.via.direction).toBe("forward");
    expect(byPath.get(docIdFor("d.md"))?.via.edge_type).toBe("frontmatter-ref");
    expect(byPath.get(docIdFor("e.md"))?.via.direction).toBe("backward");
    expect(byPath.get(docIdFor("f.md"))?.via.direction).toBe("backward");
  });

  it("Test 7: 2-hop — doc reachable via 1-hop AND 2-hop appears ONCE with via.hop=1", async () => {
    // a → b (1-hop, wikilink); a → c (1-hop); c → b (so b is also 2-hop from a).
    // The shortest-path rule must pick the 1-hop entry.
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "b.md", title: "B" },
        { notePath: "c.md", title: "C" },
      ],
      [
        { source: "a.md", target: "b.md", type: "wikilink" },
        { source: "a.md", target: "c.md", type: "wikilink" },
        { source: "c.md", target: "b.md", type: "mention" },
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 2,
      direction: "forward",
    });
    expect(res.warnings).toHaveLength(0);
    // Documents: B and C (A is the seed, never appears).
    expect(res.documents).toHaveLength(2);
    const byPath = new Map(res.documents.map((d) => [d.doc_id, d]));
    expect(byPath.get(docIdFor("b.md"))?.via.hop).toBe(1);
    expect(byPath.get(docIdFor("c.md"))?.via.hop).toBe(1);
  });

  it("Test 8: 2-hop with TWO seeds — closer seed wins (1-hop over 2-hop)", async () => {
    // B is 2 hops from A (a→c→b) and 1 hop from B-seed itself? Reread.
    // Plan: "a doc reachable in 1 hop from seed B and 2 hops from seed A
    // appears with via.seed_doc_id === B and via.hop === 1."
    // So seeds are A and B-seed; target is X. A→Y→X (2 hops); Bseed→X (1 hop).
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "bseed.md", title: "Bseed" },
        { notePath: "y.md", title: "Y" },
        { notePath: "x.md", title: "X" },
      ],
      [
        { source: "a.md", target: "y.md", type: "wikilink" },
        { source: "y.md", target: "x.md", type: "wikilink" },
        { source: "bseed.md", target: "x.md", type: "wikilink" },
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md"), docIdFor("bseed.md")],
      hops: 2,
      direction: "forward",
    });
    expect(res.warnings).toHaveLength(0);
    const xPacket = res.documents.find((d) => d.doc_id === docIdFor("x.md"));
    expect(xPacket).toBeDefined();
    expect(xPacket?.via.hop).toBe(1);
    expect(xPacket?.via.seed_doc_id).toBe(docIdFor("bseed.md"));
  });

  it("Test 9: direction='forward' does not follow backward edges from seed", async () => {
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "b.md", title: "B" },
        { notePath: "c.md", title: "C" },
      ],
      [
        { source: "a.md", target: "b.md", type: "wikilink" }, // forward from A
        { source: "c.md", target: "a.md", type: "wikilink" }, // backward to A
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
      direction: "forward",
    });
    expect(res.documents.map((d) => d.doc_id)).toEqual([docIdFor("b.md")]);
  });

  it("Test 10: edge_types=['frontmatter-ref'] filters traversal to that type only", async () => {
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "b.md", title: "B" },
        { notePath: "c.md", title: "C" },
      ],
      [
        { source: "a.md", target: "b.md", type: "frontmatter-ref" },
        { source: "a.md", target: "c.md", type: "wikilink" },
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
      direction: "forward",
      edge_types: ["frontmatter-ref"],
    });
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0]?.doc_id).toBe(docIdFor("b.md"));
    expect(res.documents[0]?.via.edge_type).toBe("frontmatter-ref");
  });

  it("Test 11: filter_properties strict equality applied at hydration time", async () => {
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "p1.md", title: "P1", frontmatter: { type: "Project" } },
        { notePath: "p2.md", title: "P2", frontmatter: { type: "Person" } },
      ],
      [
        { source: "a.md", target: "p1.md", type: "wikilink" },
        { source: "a.md", target: "p2.md", type: "wikilink" },
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
      direction: "forward",
      filter_properties: { type: "Project" },
    });
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0]?.doc_id).toBe(docIdFor("p1.md"));
    expect(res.documents[0]?.properties.type).toBe("Project");
  });

  it("Test 12: include_superseded default false drops superseded docs", async () => {
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "old.md", title: "Old", frontmatter: { status: "superseded" } },
        { notePath: "active.md", title: "Active", frontmatter: { status: "active" } },
      ],
      [
        { source: "a.md", target: "old.md", type: "wikilink" },
        { source: "a.md", target: "active.md", type: "wikilink" },
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
      direction: "forward",
    });
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0]?.doc_id).toBe(docIdFor("active.md"));
  });

  it("Test 13: include_superseded=true returns superseded docs", async () => {
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "old.md", title: "Old", frontmatter: { status: "superseded" } },
      ],
      [{ source: "a.md", target: "old.md", type: "wikilink" }],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
      direction: "forward",
      include_superseded: true,
    });
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0]?.doc_id).toBe(docIdFor("old.md"));
    expect(res.documents[0]?.properties.status).toBe("superseded");
  });

  it("Test 14: unknown seed_doc_id returns soft warning, no throw", async () => {
    fx = buildFixture([{ notePath: "a.md", title: "A" }]);
    const unknown = docIdFor("does-not-exist.md");
    const res = await expand(fx.deps, {
      seed_doc_ids: [unknown, docIdFor("a.md")],
      hops: 1,
    });
    expect(res.warnings).toEqual([{ seed_doc_id: unknown, reason: "unknown_doc" }]);
    // a.md has no outbound or inbound edges → 0 documents, but no throw.
    expect(res.documents).toEqual([]);
  });

  it("Test 15: empty seed_doc_ids returns {documents: [], warnings: []}", async () => {
    fx = buildFixture([{ notePath: "a.md", title: "A" }]);
    const res = await expand(fx.deps, {
      seed_doc_ids: [],
      hops: 2,
    });
    expect(res).toEqual({ documents: [], warnings: [] });
  });

  it("Test 16: _memory opacity — internal _memory→_memory edge does NOT surface at 2-hop (ADR-004 + Pitfall 3)", async () => {
    // Seed = user note. User note → _memory/x (1-hop wikilink); _memory/x →
    // _memory/y (2-hop via internal _memory edge). 1-hop result should
    // include _memory/x (already user-linked); 2-hop result must NOT
    // surface _memory/y (no non-_memory inbound edge in visited).
    fx = buildFixture(
      [
        { notePath: "projects/atlas-1.md", title: "Atlas-1" },
        { notePath: "_memory/observations/x.md", title: "X" },
        { notePath: "_memory/observations/y.md", title: "Y" },
      ],
      [
        {
          source: "projects/atlas-1.md",
          target: "_memory/observations/x.md",
          type: "wikilink",
        },
        {
          source: "_memory/observations/x.md",
          target: "_memory/observations/y.md",
          type: "wikilink",
        },
      ],
    );
    const seed = docIdFor("projects/atlas-1.md");
    // 1-hop: _memory/x surfaces (its inbound edge is from a user note).
    const oneHop = await expand(fx.deps, {
      seed_doc_ids: [seed],
      hops: 1,
      direction: "forward",
    });
    expect(oneHop.documents.map((d) => d.doc_id)).toEqual([docIdFor("_memory/observations/x.md")]);
    // 2-hop: _memory/x still surfaces; _memory/y is silently dropped
    // because its only inbound edge is from another _memory doc.
    const twoHop = await expand(fx.deps, {
      seed_doc_ids: [seed],
      hops: 2,
      direction: "forward",
    });
    const ids = twoHop.documents.map((d) => d.doc_id).sort();
    expect(ids).toEqual([docIdFor("_memory/observations/x.md")]);
    // _memory/y must NOT appear (opacity rule).
    expect(ids).not.toContain(docIdFor("_memory/observations/y.md"));
  });

  it("Test 17: self-loop — seed never appears in its own results regardless of edges", async () => {
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        { notePath: "b.md", title: "B" },
      ],
      [
        { source: "a.md", target: "a.md", type: "wikilink" }, // direct self-loop
        { source: "a.md", target: "b.md", type: "wikilink" },
      ],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 2,
      direction: "both",
    });
    // a.md (the seed) must NOT appear in documents.
    const docIds = res.documents.map((d) => d.doc_id);
    expect(docIds).not.toContain(docIdFor("a.md"));
    expect(docIds).toContain(docIdFor("b.md"));
  });

  it("Test 18: a note that wikilinks to itself is not surfaced as a 1-hop result of itself", async () => {
    // Stricter wording of Test 17 — the seed cannot appear via any
    // direction even if a self-edge is present.
    fx = buildFixture(
      [{ notePath: "a.md", title: "A" }],
      [{ source: "a.md", target: "a.md", type: "wikilink" }],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
      direction: "both",
    });
    expect(res.documents).toEqual([]);
  });

  it("Test 19: packets carry all 8 D-05 fields + additive via, no field reshape", async () => {
    fx = buildFixture(
      [
        { notePath: "a.md", title: "A" },
        {
          notePath: "b.md",
          title: "B",
          frontmatter: { type: "Project", tags: ["x"] },
        },
      ],
      [{ source: "a.md", target: "b.md", type: "wikilink" }],
    );
    const res = await expand(fx.deps, {
      seed_doc_ids: [docIdFor("a.md")],
      hops: 1,
      direction: "forward",
    });
    expect(res.documents).toHaveLength(1);
    const p = res.documents[0];
    // All 8 D-05 fields present and correctly populated.
    expect(p?.doc_id).toBe(docIdFor("b.md"));
    expect(p?.source_handle).toBe(`obsidian-fs://${VAULT_NAME}`);
    expect(p?.title).toBe("B");
    expect(p?.heading_path).toEqual([]);
    expect(typeof p?.mtime).toBe("number");
    expect(p?.hash).toBe("hash-b.md");
    expect(typeof p?.display_url).toBe("string");
    expect(p?.properties).toEqual({ type: "Project", tags: ["x"] });
    // Additive via field — not in the 8 fields, present here.
    expect(p?.via).toEqual({
      seed_doc_id: docIdFor("a.md"),
      hop: 1,
      edge_type: "wikilink",
      direction: "forward",
    });
  });
});

// Suppress unused-var lint for placeholder bindings.
describe("expand() — beforeEach noop", () => {
  beforeEach(() => undefined);
  afterEach(() => undefined);
  it("placeholder runs", () => {
    expect(true).toBe(true);
  });
});
