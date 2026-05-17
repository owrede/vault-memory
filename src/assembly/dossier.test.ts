/**
 * Tests for `assembleDossier` (ASM-04, Plan 03-06).
 *
 * Strategy mirrors `src/memory/tools/recall.test.ts`: build a minimal
 * in-memory fixture with a stub `SourceConnector` and a real SQLite
 * `Database` seeded with `notes` + `wikilinks` rows. The controller's
 * candidate-resolution path goes through `queryFrontmatter` (which
 * reads `notes.frontmatter` JSON) and `listBacklinks` (which reads
 * `wikilinks` rows by `target_note` FK); both run against the same
 * in-memory DB.
 *
 * Pinned behaviors (per plan must_haves §Tests):
 *   - (a) title match → anchor + linked docs + rollups
 *   - (b) alias match → same anchor as title match
 *   - (c) no match → anchor: null + empty linked + zero rollups + structured error
 *   - (d) ambiguous title → deterministic lex tiebreak by (title, doc_id)
 *   - (e) property_rollups.linked_count === linked_documents.length
 *   - (f) linked_types aggregates by properties.type
 *   - (g) status_distribution aggregates by properties.status (missing → "unknown")
 *   - (h) every linked_documents entry has relation: "wikilink" (v2.0.0)
 *   - (i) every linked.properties is a Record<string, unknown> (never undefined)
 *
 * Plus a few invariant checks: the anchor citation packet has all 8
 * required CitationPacket fields; the unknown-vault check fans through
 * VaultManager.require (throws).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { Database } from "../db/index.js";
import type { DocId, Document, SourceHandle } from "../types.js";
import { VaultManager, type Vault } from "../vault/index.js";
import { assembleDossier } from "./dossier.js";

const VAULT_NAME = "test-vault";

// ─── fixture builder ─────────────────────────────────────────────────────────

interface FixtureNoteSpec {
  /** Vault-relative path, forward slashes. */
  notePath: string;
  /** Note title (H1 / basename fallback). */
  title: string;
  /** Frontmatter object — passed as JSON-stringified into the row, but
   *  the stub source surfaces the parsed object as Document.properties. */
  frontmatter: Record<string, unknown>;
  /** Hash for the synthesized Document.hash. */
  hash?: string;
  /** mtime override (default = current epoch ms). */
  mtime?: number;
}

interface FixtureLinkSpec {
  /** Source note's vault-relative path. MUST also appear in `notes`. */
  sourcePath: string;
  /** Target note's vault-relative path. MUST also appear in `notes`. */
  targetPath: string;
}

interface Fixture {
  vault: Vault;
  manager: VaultManager;
  /** Note title indexed by vault-relative path. */
  notesByPath: Map<string, FixtureNoteSpec>;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  /** Clean up the in-memory DB. */
  cleanup: () => void;
}

function buildFixture(
  notes: FixtureNoteSpec[],
  links: FixtureLinkSpec[] = [],
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

  // Seed `notes` rows.
  const notesByPath = new Map<string, FixtureNoteSpec>();
  const idByPath = new Map<string, number>();
  const now = Date.now();
  for (const spec of notes) {
    notesByPath.set(spec.notePath, spec);
    const result = vault.db.notes.upsertByPath({
      path: spec.notePath,
      content: spec.title, // body placeholder
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

  // Seed `wikilinks` rows so listBacklinks(anchor) returns the right
  // source notes. The DB schema's wikilinks insertion is indexed by
  // source_note (FK); we group by source.
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
    const wikilinkInputs = group.map((g, idx) => ({
      targetPath: g.targetPath,
      targetNoteId: idByPath.get(g.targetPath) ?? null,
      linkText: g.targetPath,
      anchor: null,
      lineNumber: idx + 1,
    }));
    vault.db.wikilinks.insertBatch(sourceId, wikilinkInputs);
    // Phase 4 / 04-01 (D-01): dual-write into `edges` so graph reads
    // (post-04-01) see the same rows. Plan 04-02 collapses this into
    // a single helper.
    vault.db.edges.insertBatch(
      sourceId,
      wikilinkInputs.map((wl) => ({
        targetNoteId: wl.targetNoteId,
        targetPath: wl.targetPath,
        type: "wikilink" as const,
        rel: null,
        anchor: wl.anchor,
        lineNumber: wl.lineNumber,
        linkText: wl.linkText,
      })),
    );
  }

  // Stub SourceConnector — looks up the fixture spec by DocId suffix
  // and synthesizes a Document with the seeded frontmatter as
  // `properties`. Mirrors the recall.test.ts stub.
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
      // not used by assembleDossier
    },
    readDocument: async (id: DocId): Promise<Document> => {
      for (const [notePath, spec] of notesByPath) {
        if (id.endsWith(`/${notePath}`)) {
          return {
            id,
            source,
            title: spec.title,
            blocks: [{ kind: "paragraph", text: spec.title }],
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

  return {
    vault,
    manager,
    notesByPath,
    sourceConnectorFor,
    cleanup: () => {
      db.close();
    },
  };
}

// ─── canonical test fixture ──────────────────────────────────────────────────

/**
 * The standard fixture for cases (a)–(i): one anchor `Alice Chen`
 * (type: "Person", aliases: ["Alice C.", "ac"]) with 5 backlinks of
 * mixed type / status to exercise rollups.
 */
function aliceFixtureSpecs(): { notes: FixtureNoteSpec[]; links: FixtureLinkSpec[] } {
  const anchor: FixtureNoteSpec = {
    notePath: "people/alice-chen.md",
    title: "Alice Chen",
    frontmatter: {
      title: "Alice Chen",
      type: "Person",
      aliases: ["Alice C.", "ac"],
      status: "active",
    },
  };

  const backlinks: FixtureNoteSpec[] = [
    {
      notePath: "projects/atlas-1.md",
      title: "Atlas-1",
      frontmatter: { title: "Atlas-1", type: "Project", status: "active" },
    },
    {
      notePath: "projects/spire.md",
      title: "Spire",
      frontmatter: { title: "Spire", type: "Project", status: "active" },
    },
    {
      notePath: "projects/old-thing.md",
      title: "Old Thing",
      frontmatter: { title: "Old Thing", type: "Project", status: "archived" },
    },
    {
      notePath: "meetings/2026-04-15-q2-okr-review.md",
      title: "Q2 OKR Review",
      frontmatter: { title: "Q2 OKR Review", type: "Meeting", status: "done" },
    },
    {
      // Missing status — bucketed as "unknown" by status_distribution.
      notePath: "meetings/2026-05-04-kickoff.md",
      title: "Kickoff",
      frontmatter: { title: "Kickoff", type: "Meeting" },
    },
  ];

  const links: FixtureLinkSpec[] = backlinks.map((bl) => ({
    sourcePath: bl.notePath,
    targetPath: anchor.notePath,
  }));

  return { notes: [anchor, ...backlinks], links };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("assembleDossier — type/key resolution + rollups", () => {
  let fx: Fixture;

  beforeEach(() => {
    const seed = aliceFixtureSpecs();
    fx = buildFixture(seed.notes, seed.links);
  });

  afterEach(() => {
    fx.cleanup();
  });

  // (a) title match — happy path.
  it("(a) resolves type+key via title match and returns anchor + 5 linked + rollups", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    expect(result.error).toBeNull();
    expect(result.anchor).not.toBeNull();
    expect(result.anchor?.title).toBe("Alice Chen");
    expect(result.linked_documents).toHaveLength(5);
    expect(result.property_rollups.linked_count).toBe(5);
  });

  // (b) alias match — same anchor as (a).
  it("(b) resolves type+key via alias match (Alice C. → alice-chen.md)", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice C." },
    );
    expect(result.error).toBeNull();
    expect(result.anchor).not.toBeNull();
    expect(result.anchor?.title).toBe("Alice Chen");
    // Same doc, same backlinks.
    expect(result.linked_documents).toHaveLength(5);
  });

  // (c) no match — structured error per D-04.
  it("(c) no match → anchor null + empty linked + zero rollups + structured error", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Project", key: "does-not-exist" },
    );
    expect(result.anchor).toBeNull();
    expect(result.linked_documents).toEqual([]);
    expect(result.property_rollups.linked_count).toBe(0);
    expect(result.property_rollups.linked_types).toEqual({});
    expect(result.property_rollups.status_distribution).toEqual({});
    expect(result.error).toEqual({
      code: "no_matching_anchor_document",
      type: "Project",
      key: "does-not-exist",
    });
  });

  // (d) ambiguous title — deterministic lex tiebreak.
  it("(d) multiple matching docs of the same type → returns lex-first by (title, doc_id)", async () => {
    fx.cleanup();
    // Two Project-type docs both titled "Atlas" — tiebreak by doc_id.
    fx = buildFixture(
      [
        {
          notePath: "projects/atlas-zeta.md",
          title: "Atlas",
          frontmatter: { type: "Project" },
        },
        {
          notePath: "projects/atlas-alpha.md",
          title: "Atlas",
          frontmatter: { type: "Project" },
        },
      ],
      [],
    );
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Project", key: "Atlas" },
    );
    expect(result.error).toBeNull();
    // doc_id "obsidian-fs://test-vault/projects/atlas-alpha.md"
    // sorts BEFORE "obsidian-fs://test-vault/projects/atlas-zeta.md".
    expect(result.anchor?.doc_id).toBe(
      "obsidian-fs://test-vault/projects/atlas-alpha.md" as DocId,
    );
  });

  // (e) linked_count === linked_documents.length.
  it("(e) property_rollups.linked_count equals linked_documents.length", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    expect(result.property_rollups.linked_count).toBe(result.linked_documents.length);
  });

  // (f) linked_types aggregates by properties.type.
  it("(f) linked_types aggregates by properties.type per linked doc", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    // 3 Project + 2 Meeting in the fixture.
    expect(result.property_rollups.linked_types).toEqual({
      Meeting: 2,
      Project: 3,
    });
    // Determinism: keys sorted alphabetically.
    expect(Object.keys(result.property_rollups.linked_types)).toEqual(["Meeting", "Project"]);
  });

  // (g) status_distribution missing → "unknown".
  it("(g) status_distribution buckets missing status as 'unknown'", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    // 2 active (atlas-1, spire), 1 archived (old-thing), 1 done (q2-okr),
    // 1 missing (kickoff) → unknown.
    expect(result.property_rollups.status_distribution).toEqual({
      active: 2,
      archived: 1,
      done: 1,
      unknown: 1,
    });
    // Determinism: keys sorted alphabetically.
    expect(Object.keys(result.property_rollups.status_distribution)).toEqual([
      "active",
      "archived",
      "done",
      "unknown",
    ]);
  });

  // (h) every linked entry has relation: "wikilink".
  it("(h) every linked_documents entry has relation: 'wikilink' (v2.0.0)", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    expect(result.linked_documents.length).toBeGreaterThan(0);
    for (const linked of result.linked_documents) {
      expect(linked.relation).toBe("wikilink");
    }
  });

  // (i) linked.properties is always a Record<string, unknown> (never undefined).
  it("(i) every linked.properties is a non-null object (CitationPacket contract)", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    for (const linked of result.linked_documents) {
      expect(linked.properties).toBeDefined();
      expect(typeof linked.properties).toBe("object");
      expect(linked.properties).not.toBeNull();
      // Spot-check that the synthesized property bag survives the
      // toCitationPacket spread copy.
      expect("type" in linked.properties || Object.keys(linked.properties).length === 0).toBe(true);
    }
  });

  // Additional invariants beyond the must-have list:

  it("anchor packet carries all 8 required CitationPacket fields", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    expect(result.anchor).not.toBeNull();
    const a = result.anchor;
    if (!a) throw new Error("anchor null"); // narrow for TS
    expect(a.doc_id).toBe("obsidian-fs://test-vault/people/alice-chen.md");
    expect(a.source_handle).toBe("obsidian-fs://test-vault");
    expect(a.title).toBe("Alice Chen");
    expect(Array.isArray(a.heading_path)).toBe(true);
    expect(typeof a.mtime).toBe("number");
    expect(typeof a.hash).toBe("string");
    expect(typeof a.display_url).toBe("string");
    expect(typeof a.properties).toBe("object");
    expect(a.properties).not.toBeNull();
    expect(a.properties.aliases).toEqual(["Alice C.", "ac"]);
  });

  it("anchor surfaces status when present in frontmatter", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    expect(result.anchor?.status).toBe("active");
  });

  it("dossier does NOT filter superseded backlinks (CONTEXT D-04 — show the whole picture)", async () => {
    fx.cleanup();
    fx = buildFixture(
      [
        {
          notePath: "people/eve.md",
          title: "Eve",
          frontmatter: { type: "Person" },
        },
        {
          notePath: "projects/superseded-thing.md",
          title: "Superseded Thing",
          frontmatter: {
            type: "Project",
            status: "superseded",
            superseded_by: "obsidian-fs://test-vault/projects/replacement.md",
          },
        },
      ],
      [{ sourcePath: "projects/superseded-thing.md", targetPath: "people/eve.md" }],
    );
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Eve" },
    );
    expect(result.linked_documents).toHaveLength(1);
    const sup = result.linked_documents[0];
    expect(sup?.status).toBe("superseded");
    expect(sup?.superseded_by).toBe("obsidian-fs://test-vault/projects/replacement.md");
    expect(result.property_rollups.status_distribution).toEqual({ superseded: 1 });
  });

  it("strict type match — same key as a doc of a different type returns no match", async () => {
    // "Alice Chen" only matches type=Person; asking with type=Project must miss.
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Project", key: "Alice Chen" },
    );
    expect(result.anchor).toBeNull();
    expect(result.error?.code).toBe("no_matching_anchor_document");
  });

  it("anchor's display_url is computed via the SourceConnector adapter seam", async () => {
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Alice Chen" },
    );
    expect(result.anchor?.display_url).toBe(
      "obsidian://open?vault=test-vault&file=people%2Falice-chen.md",
    );
  });

  it("backlinks of a doc with zero incoming wikilinks → empty linked_documents (no error)", async () => {
    fx.cleanup();
    fx = buildFixture(
      [
        {
          notePath: "people/hermit.md",
          title: "Hermit",
          frontmatter: { type: "Person" },
        },
      ],
      [],
    );
    const result = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "Hermit" },
    );
    expect(result.error).toBeNull();
    expect(result.anchor).not.toBeNull();
    expect(result.linked_documents).toEqual([]);
    expect(result.property_rollups).toEqual({
      linked_count: 0,
      linked_types: {},
      status_distribution: {},
    });
  });

  it("unknown vault in args.vaults throws via VaultManager.require", async () => {
    await expect(
      assembleDossier(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { type: "Person", key: "Alice Chen", vaults: ["does-not-exist"] },
      ),
    ).rejects.toThrow(/Unknown vault/);
  });
});

describe("assembleDossier — defensive handling", () => {
  let fx: Fixture;

  afterEach(() => {
    fx?.cleanup();
  });

  it("ignores non-string entries in properties.aliases", async () => {
    fx = buildFixture(
      [
        {
          notePath: "people/bob.md",
          title: "Bob",
          frontmatter: {
            type: "Person",
            // Mixed array — should match "BobAlias" but ignore the rest.
            aliases: ["BobAlias", 42, null, { name: "x" }],
          },
        },
      ],
      [],
    );
    const ok = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "BobAlias" },
    );
    expect(ok.error).toBeNull();
    expect(ok.anchor?.title).toBe("Bob");

    // A non-string alias entry must not match its stringified form.
    const miss = await assembleDossier(
      { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
      { type: "Person", key: "42" },
    );
    expect(miss.anchor).toBeNull();
  });
});
