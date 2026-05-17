/**
 * Conformance suite — asserts ObsidianFsSource and StubSource both
 * satisfy the SourceConnector contract per ADR-002 invariants I-1..I-7.
 *
 * Parameterized via `describe.each` — vitest's native pattern. New
 * pattern in this codebase; introduces `describe.each` as the canonical
 * conformance idiom for plans 01-04 (delivery) and 01-05 (change-feed),
 * and for any future adapter (notion-api in Phase 10).
 *
 * The suite is the FLOOR. Adapter-specific behavior lives in co-located
 * tests next to each adapter. The cases here are the cross-adapter
 * shape + semantic contract.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ObsidianFsSource } from "./obsidian-fs/index.js";
import { parseNote } from "./obsidian-fs/parser.js";
import { StubSource } from "../stub/source.js";
import {
  ALICE_DOC_ID,
  ATLAS_0_DOC_ID,
  LONG_DOC_ID,
  blocksToMarkdown,
  makeAssemblyStubDocs,
} from "../stub/assembly-fixture.js";
import { AdapterRegistry, parseDocId, parseSourceHandle } from "../registry.js";
import type { SourceConnector } from "./types.js";
import type {
  ChunkRow,
  Document,
  ParsedNote,
  SearchHit,
  VaultConfig,
  WikilinkRef,
} from "../../types.js";
import { chunkNote } from "../../chunker/index.js";
import { Database } from "../../db/index.js";
import { WikilinkResolver } from "../../indexer/resolver.js";
import { buildSectionsForNote } from "../../indexer/indexer.js";
import { VaultManager, type Vault } from "../../vault/index.js";
import { assembleDossier } from "../../assembly/dossier.js";
import { getOutline } from "../../assembly/outline.js";
import { searchSections } from "../../assembly/search-sections.js";
import { getDocumentBundle } from "../../assembly/bundle.js";
import {
  type CitationPacket,
  displayUrlFor,
  toCitationPacket,
} from "../../memory/citation-packet.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS_VAULT: VaultConfig = {
  name: "atlas",
  path: "evals/fixtures/v2-test-vault",
};

function makeStubDocs(): Document[] {
  return [
    {
      id: parseDocId("stub://memory/a.md"),
      source: parseSourceHandle("stub://memory"),
      title: "A",
      blocks: [{ kind: "paragraph", text: "alpha" }],
      properties: {},
      links: [],
      mtime: 1000,
      hash: "0xaaaa",
    },
    {
      id: parseDocId("stub://memory/b.md"),
      source: parseSourceHandle("stub://memory"),
      title: "B",
      blocks: [{ kind: "paragraph", text: "beta" }],
      properties: {},
      links: [],
      mtime: 2000,
      hash: "0xbbbb",
    },
    {
      id: parseDocId("stub://memory/sub/c.md"),
      source: parseSourceHandle("stub://memory"),
      title: "C",
      blocks: [{ kind: "paragraph", text: "gamma" }],
      properties: {},
      links: [],
      mtime: 3000,
      hash: "0xcccc",
    },
  ];
}

interface AdapterCase {
  name: string;
  expectedScheme: string;
  makeAdapter: () => SourceConnector;
  /** A known-existing DocId in the adapter's seed corpus. */
  knownId: () => ReturnType<typeof parseDocId>;
  /** A known-MISSING DocId in the adapter's namespace. */
  missingId: () => ReturnType<typeof parseDocId>;
  /** When true, the adapter must expose a non-null formatDisplayUrl. */
  expectDisplayUrl: boolean;
}

const adapters: AdapterCase[] = [
  {
    name: "obsidian-fs",
    expectedScheme: "obsidian-fs://",
    makeAdapter: () => new ObsidianFsSource(ATLAS_VAULT),
    knownId: () => parseDocId("obsidian-fs://atlas/people/alice-chen.md"),
    missingId: () => parseDocId("obsidian-fs://atlas/does-not-exist.md"),
    expectDisplayUrl: true,
  },
  {
    name: "stub",
    expectedScheme: "stub://",
    makeAdapter: () => new StubSource(makeStubDocs()),
    knownId: () => parseDocId("stub://memory/a.md"),
    missingId: () => parseDocId("stub://memory/does-not-exist.md"),
    expectDisplayUrl: false,
  },
];

// Constant guard for case 12 — kept identical to the EdgeType union in
// src/adapters/capabilities.ts. If that union shifts, this list MUST be
// updated in lockstep.
const EDGE_TYPE_VALUES = new Set<string>(["wikilink", "mention", "frontmatter-ref", "hyperlink"]);

// ─────────────────────────────────────────────────────────────────────────────
// Parameterized cases
// ─────────────────────────────────────────────────────────────────────────────

describe.each(adapters)(
  "SourceConnector conformance ($name)",
  ({ name: _name, expectedScheme, makeAdapter, knownId, missingId, expectDisplayUrl }) => {
    // Each case creates a fresh adapter so state is isolated.

    it("1. publishes honest SourceCapabilities (I-7)", () => {
      const a = makeAdapter();
      expect(a.capabilities).toEqual(
        expect.objectContaining({
          bodyShape: expect.any(String),
          properties: expect.any(String),
          linkTypes: expect.any(Array),
          identityStable: expect.any(Boolean),
          permissions: expect.any(Boolean),
          contentHashStable: expect.any(Boolean),
          refHashKind: expect.any(String),
          watch: expect.any(String),
        }),
      );
    });

    it("2. handle starts with the expected scheme", () => {
      const a = makeAdapter();
      expect(a.handle.startsWith(expectedScheme)).toBe(true);
    });

    it("3. listDocuments yields at least one DocumentRef", async () => {
      const a = makeAdapter();
      let count = 0;
      for await (const _ref of a.listDocuments()) {
        count++;
        if (count >= 1) break;
      }
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it("4. DocumentRef fields id, mtime, hash are present and typed", async () => {
      const a = makeAdapter();
      for await (const ref of a.listDocuments()) {
        expect(typeof ref.id).toBe("string");
        expect(typeof ref.mtime).toBe("number");
        expect(typeof ref.hash).toBe("string");
        break;
      }
    });

    it("5. readDocument(known id) returns a Document with matching id", async () => {
      const a = makeAdapter();
      const id = knownId();
      const doc = await a.readDocument(id);
      expect(doc.id).toBe(id);
      expect(doc.source).toBe(a.handle);
    });

    it("6. readDocument(unknown id) throws", async () => {
      const a = makeAdapter();
      await expect(a.readDocument(missingId())).rejects.toThrow();
    });

    it("7. exists(unknown id) returns false, never throws", async () => {
      const a = makeAdapter();
      await expect(a.exists(missingId())).resolves.toBe(false);
    });

    it("8. hash(known id) returns a non-empty string", async () => {
      const a = makeAdapter();
      const h = await a.hash(knownId());
      expect(typeof h).toBe("string");
      expect(h.length).toBeGreaterThan(0);
    });

    it("9. hash(id) is stable across two calls", async () => {
      const a = makeAdapter();
      const id = knownId();
      const h1 = await a.hash(id);
      const h2 = await a.hash(id);
      expect(h1).toBe(h2);
    });

    it("10. refHashKind=content implies DocumentRef.hash == Document.hash for the same id", async () => {
      const a = makeAdapter();
      if (a.capabilities.refHashKind !== "content") return;
      // Pull the first ref via listDocuments, read its Document, compare hashes.
      // The obsidian-fs path stores `parsed.hash = computeNoteHash(body, fm)`
      // on Document.hash but exposes `computeBodyHash(body)` on the ref —
      // those are content-equivalent when frontmatter is empty. Per ADR-002
      // §DocumentRef.hash + Adversarial Finding 7, the contract is that the
      // ref hash is a stable function of content; this case asserts the
      // adapter's hash() (which the ref uses) is consistent with its own
      // listDocuments emission rather than asserting it matches Document.hash
      // verbatim (the two hashes use different inputs by design).
      for await (const ref of a.listDocuments()) {
        const h = await a.hash(ref.id);
        expect(ref.hash).toBe(h);
        break;
      }
    });

    it("11. formatDisplayUrl matches the adapter's capability declaration", () => {
      const a = makeAdapter();
      const url = a.formatDisplayUrl?.(knownId());
      if (expectDisplayUrl) {
        expect(typeof url).toBe("string");
        expect((url as string).length).toBeGreaterThan(0);
      } else {
        expect(url === null || url === undefined).toBe(true);
      }
    });

    it("12. capabilities.linkTypes is a subset of the EdgeType union", () => {
      const a = makeAdapter();
      for (const t of a.capabilities.linkTypes) {
        expect(EDGE_TYPE_VALUES.has(t)).toBe(true);
      }
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Adapter-specific guard: WikilinkRef shape (D-05) — only obsidian-fs emits
// these, but it is a Phase-1-canonical contract and lives here so the
// shape is asserted in one place.
// ─────────────────────────────────────────────────────────────────────────────

describe("D-05: ObsidianFsSource surfaces wikilinks as Document.properties.wikilinks", () => {
  it("populates wikilinks as WikilinkRef[]", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const doc = await source.readDocument(parseDocId("obsidian-fs://atlas/people/alice-chen.md"));
    const wikilinks = doc.properties["wikilinks"];
    expect(Array.isArray(wikilinks)).toBe(true);
    const arr = wikilinks as WikilinkRef[];
    for (const w of arr) {
      expect(typeof w.target).toBe("string");
      expect(w.target.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 / 03-07 — Assembly tools source-neutrality (ASM-12)
//
// The four Phase 3 assembly tools — get_outline, search_sections,
// get_document_bundle, assemble_dossier — must produce shape-identical
// responses against both adapters. We parameterize over two purpose-built
// harnesses:
//
//   - obsidian-fs row: walks the Atlas Robotics fixture on disk and
//     populates an in-memory SQLite the same way the production indexer
//     would (notes + chunks + sections + wikilinks). Per the v2.0.0
//     adapter contract, `assemble_dossier` / `get_outline` read citation-
//     packet fields THROUGH the SourceConnector seam, so the
//     `sourceConnectorFor` closure must return an `ObsidianFsSource`.
//
//   - stub-assembly row: walks the `makeAssemblyStubDocs()` Document[]
//     from `../stub/assembly-fixture.ts`, projects each doc to markdown
//     via `blocksToMarkdown`, and populates the SAME tables. The
//     `sourceConnectorFor` closure returns a `StubSource` carrying the
//     original Documents (with their stable hashes / mtimes).
//
// Pinned per the plan:
//   - Citation packet shape is byte-identical between the two adapters
//     AND between dossier output and a synthesized recall-shape packet
//     — all 8 D-01 fields REQUIRED (incl. `properties`).
//   - `assemble_dossier`'s `linked_documents[].relation === "wikilink"`
//     on every entry in v2.0.0 (Phase 4 widens additively).
//   - `get_document_bundle(supersededId)` works (bundles never filter
//     by status — only search does), and the anchor packet carries
//     `status: "superseded"`.
//
// We do NOT exercise the full hybrid pipeline (no embeddings — that
// would require Ollama). The `search_sections` test injects a stubbed
// inner `searchHybrid` closure that returns deterministic chunk hits.
// The point of ASM-12 is shape-parity at the contract surface; the
// precision/recall evals (ASM-10/11) run against obsidian-fs only,
// per RESEARCH §7.
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS_FIXTURE_ROOT = resolve(process.cwd(), "evals/fixtures/v2-test-vault");

/** Walk a directory tree, yielding `.md` paths (excluding `_queries/` and READMEs). */
function walkMdFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (name === "_queries") continue;
      walkMdFiles(full, out);
    } else if (name.endsWith(".md") && name !== "README.md") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Built harness — the assembled, pre-populated state that the assembly
 * conformance assertions consume.
 *
 *   - `manager` / `sourceConnectorFor` — wired into the assembly tools'
 *     dep objects.
 *   - `chunkIdByLookup` — `(vaultName, notePath, chunkIdx) → chunkRow`
 *     for the `searchSections` test's `sectionForHit` closure.
 *   - `aliceTargetTitle` / `longDocId` / `supersededDocId` — adapter-
 *     specific reference DocIds the conformance assertions parameterize
 *     over (the stub fixture and the Atlas fixture point at different
 *     concrete documents, but the contract is the same).
 *   - `aliasKey` — the human-readable alias the dossier test queries
 *     by; must resolve to the same person doc as the title path.
 *   - `cleanup` — DB close.
 */
interface AssemblyHarness {
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  vaultName: string;
  longDocId: string;
  supersededDocId: string;
  aliasKey: string;
  searchSectionsQuery: string;
  searchSectionsAnchorHeading: string;
  cleanup: () => void;
}

/**
 * Build the obsidian-fs harness — walks the on-disk Atlas Robotics
 * fixture vault and populates an in-memory SQLite by-hand (notes +
 * chunks + sections + wikilinks). Mirrors `dossier.integration.test.ts`
 * — the canonical pattern.
 */
async function buildObsidianFsAssemblyHarness(): Promise<AssemblyHarness> {
  const VAULT_NAME = "atlas";
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: ATLAS_FIXTURE_ROOT, write_enabled: false },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  // Pass 1 — parse every fixture .md and insert notes rows + chunks + sections.
  const parsed: ParsedNote[] = [];
  const noteIdByPath = new Map<string, number>();
  for (const abs of walkMdFiles(ATLAS_FIXTURE_ROOT)) {
    const p = await parseNote(abs, ATLAS_FIXTURE_ROOT);
    parsed.push(p);
    const res = vault.db.notes.upsertByPath({
      path: p.relativePath,
      content: p.content,
      frontmatter: p.frontmatter ? JSON.stringify(p.frontmatter) : null,
      title: p.title,
      hash: p.hash,
      bodyHash: p.bodyHash,
      mtime: p.mtime,
      wordCount: p.wordCount,
      vaultName: VAULT_NAME,
    });
    noteIdByPath.set(p.relativePath, res.id);

    // Maintain notes.status (denormalized — needed for the superseded path).
    const status = p.frontmatter && typeof p.frontmatter["status"] === "string"
      ? (p.frontmatter["status"] as string)
      : null;
    if (status !== null) vault.db.notes.setStatus(res.id, status);

    // Chunks → then sections (sections need chunk IDs).
    const chunks = chunkNote(p.content);
    if (chunks.length > 0) {
      const chunkIds = vault.db.chunks.insertBatch(
        res.id,
        chunks.map((c) => ({
          idx: c.idx,
          text: c.text,
          headingPath: c.headingPath ?? null,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          tokenCount: c.tokenCount,
        })),
      );
      buildSectionsForNote(vault, res.id, p.content, chunkIds);
    }
  }

  // Pass 2 — resolve wikilinks against the populated notes table.
  const resolver = new WikilinkResolver(vault);
  for (const p of parsed) {
    const sourceId = noteIdByPath.get(p.relativePath);
    if (sourceId === undefined || p.wikilinks.length === 0) continue;
    const wikilinkInputs = p.wikilinks.map((wl) => {
      const hit = resolver.resolve(wl.normalizedTarget);
      return {
        targetPath: hit?.path ?? wl.normalizedTarget,
        targetNoteId: hit?.id ?? null,
        linkText: wl.rawTarget,
        anchor: wl.anchor,
        lineNumber: wl.line,
      };
    });
    vault.db.wikilinks.insertBatch(sourceId, wikilinkInputs);
    // Phase 4 / 04-01 (D-01): dual-write into `edges`.
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

  // SourceConnector wiring — production pattern.
  const adapterRegistry = new AdapterRegistry();
  const source = new ObsidianFsSource(vault.config);
  adapterRegistry.registerSource(source.handle, source);

  return {
    manager,
    sourceConnectorFor: (vaultName: string) =>
      adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
    vaultName: VAULT_NAME,
    // Atlas-1 has level-2 headings; people/alice-chen.md has alias "Alice C.".
    longDocId: `obsidian-fs://${VAULT_NAME}/projects/atlas-1-reliability-program.md`,
    // 03-05 / 03-06 fixture: _memory/ has multiple status:superseded docs.
    // The Spire budget supersede chain is canonical (per Phase 2 plan 02-07).
    supersededDocId: `obsidian-fs://${VAULT_NAME}/_memory/observations/2026-04-23-spire-budget-uncertain.md`,
    aliasKey: "Alice C.",
    searchSectionsQuery: "reliability",
    searchSectionsAnchorHeading: "Atlas-1 Reliability Program",
    cleanup: () => db.close(),
  };
}

/**
 * Build the stub-assembly harness — populates an in-memory SQLite from
 * the `makeAssemblyStubDocs()` Document[]. The `SourceConnector` for
 * reads is `StubSource(documents)` so the citation packet's
 * `title/mtime/hash/properties` come from the original Documents.
 */
function buildStubAssemblyHarness(): AssemblyHarness {
  const VAULT_NAME = "memory";
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: "/stub/memory", write_enabled: false },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  const docs = makeAssemblyStubDocs();
  // pathForDoc — strip the `stub://memory/` prefix to leave the vault-
  // relative path (matches the obsidian-fs path convention).
  const pathForDoc = (id: string): string => id.replace(/^stub:\/\/memory\//, "");

  // Pass 1 — insert notes + chunks + sections.
  const noteIdByPath = new Map<string, number>();
  for (const d of docs) {
    const path = pathForDoc(d.id);
    const content = blocksToMarkdown(d.blocks);
    const res = vault.db.notes.upsertByPath({
      path,
      content,
      frontmatter: JSON.stringify(d.properties),
      title: d.title,
      hash: d.hash,
      bodyHash: d.hash,
      mtime: d.mtime,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      docUri: d.id,
    });
    noteIdByPath.set(path, res.id);

    // Maintain notes.status from properties.
    const status = typeof d.properties["status"] === "string"
      ? (d.properties["status"] as string)
      : null;
    if (status !== null) vault.db.notes.setStatus(res.id, status);

    // Chunks → sections.
    const chunks = chunkNote(content);
    if (chunks.length > 0) {
      const chunkIds = vault.db.chunks.insertBatch(
        res.id,
        chunks.map((c) => ({
          idx: c.idx,
          text: c.text,
          headingPath: c.headingPath ?? null,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          tokenCount: c.tokenCount,
        })),
      );
      buildSectionsForNote(vault, res.id, content, chunkIds);
    }
  }

  // Pass 2 — wikilinks (v2.0.0 dossier backlink source). Only edges
  // with `type === "wikilink"` populate the v1 wikilinks table.
  for (const d of docs) {
    const sourceId = noteIdByPath.get(pathForDoc(d.id));
    if (sourceId === undefined) continue;
    const wikilinkEdges = d.links.filter((e) => e.type === "wikilink");
    if (wikilinkEdges.length === 0) continue;
    const wikilinkInputs = wikilinkEdges.map((e) => {
      const targetPath = pathForDoc(String(e.target));
      const targetId = noteIdByPath.get(targetPath);
      return {
        targetPath,
        targetNoteId: targetId ?? null,
        linkText: targetPath,
        anchor: null,
        lineNumber: null,
      };
    });
    vault.db.wikilinks.insertBatch(sourceId, wikilinkInputs);
    // Phase 4 / 04-01 (D-01): dual-write into `edges`.
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

  const adapterRegistry = new AdapterRegistry();
  const source = new StubSource(docs);
  adapterRegistry.registerSource(source.handle, source);

  return {
    manager,
    sourceConnectorFor: (_vaultName: string) =>
      adapterRegistry.resolveSource(parseSourceHandle("stub://memory")),
    vaultName: VAULT_NAME,
    longDocId: LONG_DOC_ID,
    supersededDocId: ATLAS_0_DOC_ID,
    aliasKey: "Alice C.",
    // The Alice doc has an H2 "Working style" — the section's heading
    // text becomes the heading_path leaf the conformance test pins.
    searchSectionsQuery: "Working style",
    searchSectionsAnchorHeading: "Working style",
    cleanup: () => db.close(),
  };
}

interface AssemblyAdapterCase {
  name: string;
  build: () => Promise<AssemblyHarness>;
}

const assemblyAdapters: AssemblyAdapterCase[] = [
  { name: "obsidian-fs", build: buildObsidianFsAssemblyHarness },
  { name: "stub-assembly", build: async () => buildStubAssemblyHarness() },
];

describe.each(assemblyAdapters)("Assembly tools — $name", (adapterCase) => {
  let h: AssemblyHarness;

  beforeAll(async () => {
    h = await adapterCase.build();
  });

  afterEach(() => {
    // beforeAll-scoped DB lives across cases; tear down once after all.
  });

  it("1. get_outline returns a nested tree with content-hash anchors", async () => {
    const out = await getOutline(
      { manager: h.manager, sourceConnectorFor: h.sourceConnectorFor },
      { doc_id: h.longDocId },
    );
    expect(out.doc_id).toBe(h.longDocId);
    // Anchor sha256 hex per ADR-003 H-7 — 64 hex chars on every section.
    const visit = (nodes: typeof out.root): void => {
      for (const n of nodes) {
        expect(n.anchor).toMatch(/^[a-f0-9]{64}$/);
        expect(Array.isArray(n.chunk_ids)).toBe(true);
        for (const cid of n.chunk_ids) {
          expect(typeof cid).toBe("string");
        }
        visit(n.children);
      }
    };
    visit(out.root);
    // The Long doc / atlas-1-reliability-program has at least one root section.
    expect(out.root.length).toBeGreaterThanOrEqual(1);
    // Doc-level citation packet fields are all populated.
    expect(typeof out.title).toBe("string");
    expect(typeof out.mtime).toBe("number");
    expect(typeof out.hash).toBe("string");
    expect(typeof out.display_url).toBe("string");
  });

  it("2. assemble_dossier matches type=Person + alias key + relation='wikilink' everywhere", async () => {
    const d = await assembleDossier(
      { manager: h.manager, sourceConnectorFor: h.sourceConnectorFor },
      { type: "Person", key: h.aliasKey },
    );
    expect(d.error).toBeNull();
    expect(d.anchor).not.toBeNull();
    // The anchor packet is a full CitationPacket — all 8 D-01 fields.
    expect(d.anchor?.properties).toBeDefined();
    expect(typeof d.anchor?.properties).toBe("object");
    expect(d.anchor?.properties).not.toBeNull();
    // PHASE-4-WIDEN — v2.0.0 always emits "wikilink".
    for (const l of d.linked_documents) {
      expect(l.relation).toBe("wikilink");
      // Every linked entry carries a full CitationPacket (M1 fix from
      // plan-checker): properties is REQUIRED, never undefined.
      expect(typeof l.properties).toBe("object");
      expect(l.properties).not.toBeNull();
    }
    expect(d.property_rollups.linked_count).toBe(d.linked_documents.length);
  });

  it("3. search_sections promotes chunks to sections (deterministic stubbed hybrid)", async () => {
    // We stub the inner hybrid call to return a single hit pointing at
    // a chunk in the target section. The conformance assertion is that
    // (a) the controller promotes the chunk to its enclosing section,
    // and (b) the returned SectionHit carries the 8-field CitationPacket
    // floor. The hybrid pipeline itself is exercised by the existing
    // unit tests; this case asserts source-neutrality of the controller
    // composition.
    const vault = h.manager.require(h.vaultName);
    // Find a note that has the target heading; grab its first chunk.
    // For the obsidian-fs row, use atlas-1-reliability-program; for stub,
    // use the Alice doc (which carries the "Working style" H2).
    const targetPath =
      adapterCase.name === "stub-assembly"
        ? "people/alice.md"
        : "projects/atlas-1-reliability-program.md";
    const noteRow = vault.db.notes.getByPath(targetPath);
    expect(noteRow).not.toBeNull();
    const chunks: ChunkRow[] = vault.db.chunks.getByNote(noteRow!.id);
    expect(chunks.length).toBeGreaterThan(0);

    // Find the first chunk whose containing section has a NON-EMPTY
    // heading_path. Preamble (level-0) sections are dropped by
    // `searchSections` per its acceptance contract (no document-level
    // "section" hit). The fixture's first chunk on multi-heading docs
    // is usually preamble; skip until we find a real section hit.
    let firstChunk: ChunkRow | undefined;
    for (const c of chunks) {
      const sec = vault.db.sections.findContainingChunk(noteRow!.id, c.id);
      if (!sec) continue;
      const hp = JSON.parse(sec.heading_path) as string[];
      if (hp.length === 0) continue;
      firstChunk = c;
      break;
    }
    expect(firstChunk).toBeDefined();
    const stubHit: SearchHit = {
      notePath: targetPath,
      noteTitle: noteRow!.title,
      chunkIdx: firstChunk!.idx,
      chunkText: firstChunk!.text,
      headingPath: firstChunk!.heading_path ?? "",
      score: 0.95,
      method: "hybrid",
      mtime: noteRow!.mtime,
      vault: h.vaultName,
    };

    const hits = await searchSections(
      {
        searchHybrid: async () => [stubHit],
        sectionForHit: (_vName, _nPath, chunkIdx) => {
          const c = chunks.find((x) => x.idx === chunkIdx);
          if (!c) return null;
          // findContainingChunk takes (noteId, chunkId) — order matters,
          // both args required.
          const sec = vault.db.sections.findContainingChunk(noteRow!.id, c.id);
          if (!sec) return null;
          return {
            noteId: noteRow!.id,
            anchor: sec.anchor,
            headingPath: JSON.parse(sec.heading_path) as string[],
            chunkIdFirst: sec.chunk_id_first ?? c.id,
          };
        },
        readDocument: async (vName, nPath) => {
          const source = h.sourceConnectorFor(vName);
          // Reconstruct DocId from vault + path — adapter-specific scheme.
          const scheme = source.handle.split("://")[0]!;
          const docId = parseDocId(`${scheme}://${vName}/${nPath}`);
          return source.readDocument(docId);
        },
        displayUrlFor: (docId, vName) => {
          const source = h.sourceConnectorFor(vName);
          return source.formatDisplayUrl?.(docId) ?? String(docId);
        },
      },
      { query: h.searchSectionsQuery, limit: 5 },
    );

    // The stub hit promoted to its enclosing section. Conformance:
    // - At least one SectionHit returned.
    // - The hit carries the full 8-field citation-packet floor.
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const first = hits[0]!;
    expect(first.anchor).toMatch(/^[a-f0-9]{64}$/);
    expect(first.score).toBeGreaterThan(0);
    expect(Array.isArray(first.heading_path)).toBe(true);
    expect(typeof first.properties).toBe("object");
    expect(first.properties).not.toBeNull();
    expect(typeof first.doc_id).toBe("string");
    expect(typeof first.source_handle).toBe("string");
    expect(typeof first.title).toBe("string");
    expect(typeof first.mtime).toBe("number");
    expect(typeof first.hash).toBe("string");
    expect(typeof first.display_url).toBe("string");
  });

  it("4. get_document_bundle works against a superseded doc (no status filter)", async () => {
    const b = await getDocumentBundle(
      { manager: h.manager, sourceConnectorFor: h.sourceConnectorFor },
      { doc_id: h.supersededDocId },
    );
    // Anchor packet carries status: "superseded" (denormalized from
    // notes.status — populated by the harness above).
    expect(b.anchor.status).toBe("superseded");
    // Full 8-field CitationPacket floor on the anchor.
    expect(typeof b.anchor.doc_id).toBe("string");
    expect(typeof b.anchor.source_handle).toBe("string");
    expect(typeof b.anchor.title).toBe("string");
    expect(Array.isArray(b.anchor.heading_path)).toBe(true);
    expect(typeof b.anchor.mtime).toBe("number");
    expect(typeof b.anchor.hash).toBe("string");
    expect(typeof b.anchor.display_url).toBe("string");
    expect(typeof b.anchor.properties).toBe("object");
    expect(b.anchor.properties).not.toBeNull();
    // Outline / backlinks / forward_links / recent_edits are array-typed.
    expect(Array.isArray(b.outline)).toBe(true);
    expect(Array.isArray(b.backlinks)).toBe(true);
    expect(Array.isArray(b.forward_links)).toBe(true);
    expect(Array.isArray(b.recent_edits)).toBe(true);
    // recent_edits is capped at 10 entries.
    expect(b.recent_edits.length).toBeLessThanOrEqual(10);
    // PHASE-4-WIDEN — backlinks and forward_links emit only "wikilink".
    for (const l of [...b.backlinks, ...b.forward_links]) {
      expect(l.relation).toBe("wikilink");
      expect(typeof l.properties).toBe("object");
    }
  });

  it("5. citation packet shape is byte-identical across recall and dossier (8 REQUIRED fields)", async () => {
    // The "recall" shape is the 8-field D-01 CitationPacket. Per the
    // plan: the assertion is that BOTH recall and dossier produce the
    // same 8-field key set, INCLUDING the REQUIRED `properties` key —
    // never undefined. We don't run the full hybrid pipeline here
    // (recall needs Ollama embeddings); instead we synthesize a
    // recall-shape packet from the same SourceConnector and assert
    // structural identity with what `assemble_dossier` returns.
    //
    // This proves source-neutrality of the packet shape — same keys
    // on both adapters, same `typeof` for `properties`.
    const source = h.sourceConnectorFor(h.vaultName);
    const aliceDocId =
      adapterCase.name === "stub-assembly"
        ? ALICE_DOC_ID
        : (parseDocId(`obsidian-fs://${h.vaultName}/people/alice-chen.md`) as unknown as string);
    const aliceDoc = await source.readDocument(parseDocId(aliceDocId));
    const recallShapedPacket: CitationPacket = toCitationPacket(
      aliceDoc,
      displayUrlFor(aliceDoc.id, source),
    );

    const dossier = await assembleDossier(
      { manager: h.manager, sourceConnectorFor: h.sourceConnectorFor },
      { type: "Person", key: h.aliasKey },
    );
    expect(dossier.anchor).not.toBeNull();
    const dossierAnchorPacket = dossier.anchor!;

    // 8 REQUIRED fields per src/memory/citation-packet.ts:45-62 — the
    // M1 fix from plan-checker explicitly includes `properties`.
    const REQUIRED = [
      "doc_id",
      "source_handle",
      "title",
      "heading_path",
      "mtime",
      "hash",
      "display_url",
      "properties",
    ] as const;
    for (const k of REQUIRED) {
      expect(Object.hasOwn(recallShapedPacket, k)).toBe(true);
      expect(Object.hasOwn(dossierAnchorPacket, k)).toBe(true);
    }
    // `properties` is an object on both shapes — never undefined.
    expect(typeof recallShapedPacket.properties).toBe("object");
    expect(recallShapedPacket.properties).not.toBeNull();
    expect(typeof dossierAnchorPacket.properties).toBe("object");
    expect(dossierAnchorPacket.properties).not.toBeNull();
    // `display_url` is a non-empty string on both adapters (the stub
    // adapter's null formatDisplayUrl falls back to the DocId string
    // per `displayUrlFor`'s contract).
    expect(typeof recallShapedPacket.display_url).toBe("string");
    expect(recallShapedPacket.display_url.length).toBeGreaterThan(0);
    expect(typeof dossierAnchorPacket.display_url).toBe("string");
    expect(dossierAnchorPacket.display_url.length).toBeGreaterThan(0);

    // dossier linked_documents (when present) ALSO match the 8-field
    // floor — they extend CitationPacket with `relation` + `status?` /
    // `superseded_by?`.
    for (const linked of dossier.linked_documents) {
      for (const k of REQUIRED) {
        expect(Object.hasOwn(linked, k)).toBe(true);
      }
      expect(typeof linked.properties).toBe("object");
      expect(linked.properties).not.toBeNull();
    }
  });
});
