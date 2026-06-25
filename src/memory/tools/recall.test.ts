/**
 * Tests for `handleRecall` (MEM-03).
 *
 * Strategy: build a minimal in-memory fixture with a stub `searchHybrid`
 * that returns a fixed candidate list, a stub `sourceConnectorFor` that
 * returns synthesized `Document` objects, and a real `MemorySinkRegistry`
 * (with a no-op provisioner). This isolates the controller's filter/sort/
 * truncate pipeline from the search backend and the file system — the
 * end-to-end real-index path is covered in `server.test.ts`.
 *
 * Pinned behaviors (per plan must_haves):
 *   - happy path returns 5 packets in observed_at DESC order, 8 fields each
 *   - min_confidence: "inferred" excludes uncertain
 *   - types: ["observation"] excludes non-observations
 *   - max_age_days: 30 excludes older docs
 *   - status: "superseded" hidden by default
 *   - sink scoping
 *   - limit truncates AFTER sort
 *   - empty search → []
 *   - unknown sink throws
 *   - packet.display_url + packet.hash equal Document.hash
 */

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { formatDocId, parseSourceHandle } from "../../adapters/registry.js";
import type { DocId, Document, MemorySink, SearchHit, SourceHandle } from "../../types.js";
import type { SourceConnector } from "../../adapters/source/types.js";
import type { Vault } from "../../vault/index.js";
import { VaultManager } from "../../vault/index.js";
import { Database } from "../../db/index.js";
import { MemorySinkRegistry, parseMemorySinkHandle } from "../../memory/index.js";
import { handleRecall, type RecallSearchHybridInput } from "./recall.js";

const VAULT_NAME = "test-vault";
const SINK_REL_PATH = "_memory/";

// ─── Fixture builder ─────────────────────────────────────────────────────────

interface FixtureDocSpec {
  /** Vault-relative path within the sink, e.g. "_memory/observations/foo.md". */
  notePath: string;
  title: string;
  hash: string;
  mtime: number;
  properties: Record<string, unknown>;
}

interface Fixture {
  vaultDir: string;
  vault: Vault;
  manager: VaultManager;
  registry: MemorySinkRegistry;
  /** Map of docId → Document, indexed by the synth source. */
  docsByPath: Map<string, Document>;
  /** All synth SearchHit candidates (one per doc). */
  candidates: SearchHit[];
  /** Stub source connector keyed by vault. */
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  /** Stub searchHybrid that returns `candidates` verbatim. */
  searchHybrid: (input: RecallSearchHybridInput) => Promise<SearchHit[]>;
  /** Cleanup. */
  cleanup: () => Promise<void>;
}

async function buildFixture(
  docs: FixtureDocSpec[],
  opts: { multipleSinks?: boolean } = {},
): Promise<Fixture> {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-recall-"));
  await fs.mkdir(join(vaultDir, "_memory"), { recursive: true });
  await fs.writeFile(join(vaultDir, "_memory", ".memory-sink"), "fixture", "utf-8");
  if (opts.multipleSinks) {
    await fs.mkdir(join(vaultDir, "_archive"), { recursive: true });
    await fs.writeFile(join(vaultDir, "_archive", ".memory-sink"), "fixture", "utf-8");
  }

  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  const registry = new MemorySinkRegistry();
  const sinkHandle = parseMemorySinkHandle(`obsidian-fs://${VAULT_NAME}/${SINK_REL_PATH}`);
  const sinkConfigs = [{ name: "default", handle: sinkHandle, contract: "default-memory-v1" }];
  if (opts.multipleSinks) {
    const archiveHandle = parseMemorySinkHandle(`obsidian-fs://${VAULT_NAME}/_archive/`);
    sinkConfigs.push({
      name: "archive",
      handle: archiveHandle,
      contract: "default-memory-v1",
    });
  }
  await registry.registerMemorySinks(sinkConfigs, {
    resolveVaultAbsolutePath: () => vaultDir,
    provisioner: async (_sink: MemorySink, _vaultAbs: string) => {
      // no-op — files already created above
    },
  });

  // Build the in-memory docs + candidates.
  const source: SourceHandle = parseSourceHandle(`obsidian-fs://${VAULT_NAME}`);
  const docsByPath = new Map<string, Document>();
  const candidates: SearchHit[] = [];
  for (const spec of docs) {
    const id: DocId = formatDocId("obsidian-fs", VAULT_NAME, spec.notePath);
    const doc: Document = {
      id,
      source,
      title: spec.title,
      blocks: [{ kind: "paragraph", text: spec.title }],
      properties: spec.properties,
      links: [],
      mtime: spec.mtime,
      hash: spec.hash,
    };
    docsByPath.set(spec.notePath, doc);
    candidates.push({
      vault: VAULT_NAME,
      notePath: spec.notePath,
      noteTitle: spec.title,
      chunkText: spec.title,
      chunkIdx: 0,
      headingPath: null,
      score: 1.0 - candidates.length * 0.01,
    });
  }

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
      // not used by recall
    },
    readDocument: async (id: DocId) => {
      // Match by notePath suffix.
      for (const [notePath, doc] of docsByPath) {
        if (id.endsWith(notePath)) return doc;
      }
      throw new Error(`Doc not found: ${id}`);
    },
    hash: async (id: DocId) => {
      for (const [notePath, doc] of docsByPath) {
        if (id.endsWith(notePath)) return doc.hash;
      }
      throw new Error(`Doc not found: ${id}`);
    },
    exists: async (id: DocId) => {
      for (const notePath of docsByPath.keys()) {
        if (id.endsWith(notePath)) return true;
      }
      return false;
    },
    formatDisplayUrl: (id: DocId): string => {
      // Mirror the obsidian-fs adapter's URL convention so the unit
      // tests can assert exact strings without coupling to the adapter
      // import (which would re-introduce the seam dependency).
      const schemeEnd = (id as string).indexOf("://");
      const rest = (id as string).slice(schemeEnd + 3);
      const slashIdx = rest.indexOf("/");
      const vaultName = rest.slice(0, slashIdx);
      const resource = rest.slice(slashIdx + 1);
      return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(resource)}`;
    },
  });

  const searchHybrid = async (_input: RecallSearchHybridInput): Promise<SearchHit[]> => {
    return candidates;
  };

  return {
    vaultDir,
    vault,
    manager,
    registry,
    docsByPath,
    candidates,
    sourceConnectorFor,
    searchHybrid,
    cleanup: async () => {
      db.close();
      await fs.rm(vaultDir, { recursive: true, force: true });
    },
  };
}

// ─── Test data helpers ───────────────────────────────────────────────────────

// Use the wall-clock at test execution time so `max_age_days` filters
// compare against `Date.now()` inside the controller correctly. Tests
// build documents with `observed_at` values offset from this anchor.
const NOW = Date.now();

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * 86_400_000).toISOString();
}

function fiveDocFixtureSpecs(): FixtureDocSpec[] {
  return [
    {
      notePath: "_memory/observations/2026-direct-recent.md",
      title: "Direct recent observation",
      hash: "hash-direct-recent",
      mtime: NOW - 1 * 86_400_000,
      properties: {
        source: "agent",
        confidence: "direct",
        evidence: [],
        status: "active",
        observed_at: iso(1),
        type: "observation",
        superseded_by: null,
      },
    },
    {
      notePath: "_memory/observations/2026-inferred-mid.md",
      title: "Inferred mid-age observation",
      hash: "hash-inferred-mid",
      mtime: NOW - 10 * 86_400_000,
      properties: {
        source: "agent",
        confidence: "inferred",
        evidence: [],
        status: "active",
        observed_at: iso(10),
        type: "observation",
        superseded_by: null,
      },
    },
    {
      notePath: "_memory/observations/2026-uncertain-old.md",
      title: "Uncertain old observation",
      hash: "hash-uncertain-old",
      mtime: NOW - 60 * 86_400_000,
      properties: {
        source: "agent",
        confidence: "uncertain",
        evidence: [],
        status: "active",
        observed_at: iso(60),
        type: "observation",
        superseded_by: null,
      },
    },
    {
      notePath: "_memory/_briefs/2026-hypothesis-fresh.md",
      title: "Hypothesis fresh",
      hash: "hash-hypothesis",
      mtime: NOW - 5 * 86_400_000,
      properties: {
        source: "agent",
        confidence: "direct",
        evidence: [],
        status: "active",
        observed_at: iso(5),
        type: "hypothesis",
        superseded_by: null,
      },
    },
    {
      notePath: "_memory/observations/2026-superseded-doc.md",
      title: "Superseded doc",
      hash: "hash-superseded",
      mtime: NOW - 2 * 86_400_000,
      properties: {
        source: "agent",
        confidence: "direct",
        evidence: [],
        status: "superseded",
        observed_at: iso(2),
        type: "observation",
        superseded_by: "obsidian-fs://test-vault/_memory/observations/2026-direct-recent.md",
        superseded_reason: "replaced",
      },
    },
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("handleRecall — provenance filter + recency sort pipeline", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await buildFixture(fiveDocFixtureSpecs());
  });

  // teardown handled per-test via the `cleanup` callback; vitest's
  // `afterEach` integration would race with the dynamic fixture builder.

  async function withFixture(fn: (fx: Fixture) => Promise<void>): Promise<void> {
    try {
      await fn(fx);
    } finally {
      await fx.cleanup();
    }
  }

  it("happy path: returns 4 non-superseded packets in observed_at DESC order with 8 fields each", async () => {
    await withFixture(async (fx) => {
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything" },
      );
      // 5 candidates → 4 results (superseded doc filtered).
      expect(packets).toHaveLength(4);
      // observed_at DESC: 1d-ago > 5d-ago > 10d-ago > 60d-ago
      const titles = packets.map((p) => p.title);
      expect(titles).toEqual([
        "Direct recent observation",
        "Hypothesis fresh",
        "Inferred mid-age observation",
        "Uncertain old observation",
      ]);
      // 8 fields per packet.
      for (const p of packets) {
        const keys = Object.keys(p).sort();
        expect(keys).toEqual(
          [
            "display_url",
            "doc_id",
            "hash",
            "heading_path",
            "mtime",
            "properties",
            "source_handle",
            "title",
          ].sort(),
        );
      }
      // packet.hash mirrors Document.hash
      const first = packets[0]!;
      expect(first.hash).toBe("hash-direct-recent");
      // display_url is the obsidian:// open URL
      expect(first.display_url).toMatch(/^obsidian:\/\/open\?vault=test-vault&file=/);
    });
  });

  it("min_confidence: 'inferred' returns only direct + inferred (excludes uncertain)", async () => {
    await withFixture(async (fx) => {
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything", min_confidence: "inferred" },
      );
      // direct-recent, hypothesis-fresh, inferred-mid — 3 docs
      expect(packets).toHaveLength(3);
      expect(packets.map((p) => p.properties.confidence)).toEqual(["direct", "direct", "inferred"]);
    });
  });

  it("types: ['observation'] returns only observation-typed docs", async () => {
    await withFixture(async (fx) => {
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything", types: ["observation"] },
      );
      // direct-recent, inferred-mid, uncertain-old — superseded excluded, hypothesis excluded
      expect(packets).toHaveLength(3);
      for (const p of packets) {
        expect(p.properties.type).toBe("observation");
      }
    });
  });

  it("max_age_days: 30 excludes docs older than 30 days", async () => {
    await withFixture(async (fx) => {
      // Recall uses Date.now() internally; in our fixture observed_at
      // values are relative to NOW (a fixed constant), so the actual
      // wall-clock-now will be slightly larger than NOW. The 1d, 5d,
      // 10d "ago" docs are well within 30d; the 60d-ago doc is well
      // outside. Tests are stable as long as wall-clock doesn't drift
      // by more than ~5 days from when the test file was written.
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything", max_age_days: 30 },
      );
      const titles = packets.map((p) => p.title).sort();
      expect(titles).not.toContain("Uncertain old observation");
      expect(titles).toContain("Direct recent observation");
      expect(titles).toContain("Hypothesis fresh");
      expect(titles).toContain("Inferred mid-age observation");
    });
  });

  it("hides status:'superseded' docs by default", async () => {
    await withFixture(async (fx) => {
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything" },
      );
      for (const p of packets) {
        expect(p.properties.status).not.toBe("superseded");
      }
      expect(packets.map((p) => p.title)).not.toContain("Superseded doc");
    });
  });

  it("limit: 2 returns exactly the 2 newest packets after filter+sort", async () => {
    await withFixture(async (fx) => {
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything", limit: 2 },
      );
      expect(packets).toHaveLength(2);
      expect(packets.map((p) => p.title)).toEqual([
        "Direct recent observation",
        "Hypothesis fresh",
      ]);
    });
  });

  it("empty searchHybrid result → []", async () => {
    await withFixture(async (fx) => {
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: async () => [],
        },
        { query: "no-match" },
      );
      expect(packets).toEqual([]);
    });
  });

  it("unknown sink name throws", async () => {
    await withFixture(async (fx) => {
      await expect(
        handleRecall(
          {
            memorySinkRegistry: fx.registry,
            manager: fx.manager,
            sourceConnectorFor: fx.sourceConnectorFor,
            searchHybrid: fx.searchHybrid,
          },
          { query: "foo", sink: "not-a-real-sink" },
        ),
      ).rejects.toThrow(/Unknown memory sink/);
    });
  });

  it("each packet display_url matches obsidian://open?vault=<v>&file=<encoded-path>", async () => {
    await withFixture(async (fx) => {
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything", limit: 1 },
      );
      expect(packets).toHaveLength(1);
      const p = packets[0]!;
      expect(p.display_url).toBe(
        "obsidian://open?vault=test-vault&file=_memory%2Fobservations%2F2026-direct-recent.md",
      );
      // hash mirrors Document.hash
      expect(p.hash).toBe("hash-direct-recent");
    });
  });
});

describe("handleRecall — observed_at YAML Date coercion (Rule 1 bug fix)", () => {
  /**
   * YAML frontmatter parsers (`gray-matter` → `js-yaml`) deserialize
   * canonical ISO-8601 timestamps as JS `Date` objects via the YAML
   * `tag:yaml.org,2002:timestamp` schema rule. Our `observed_at` is
   * canonical ISO, so it surfaces as a `Date` — not a string. The
   * controller must accept both shapes for the recency filter + sort
   * to work against the real v2 fixture.
   */
  it("filters + sorts correctly when observed_at is a JS Date object (not a string)", async () => {
    const docsSpec: FixtureDocSpec[] = [
      {
        notePath: "_memory/observations/2026-newer.md",
        title: "Newer (Date object)",
        hash: "h1",
        mtime: NOW - 1 * 86_400_000,
        properties: {
          source: "agent",
          confidence: "direct",
          evidence: [],
          status: "active",
          // Real YAML→Date — what gray-matter actually surfaces.
          observed_at: new Date(NOW - 1 * 86_400_000),
          type: "observation",
          superseded_by: null,
        },
      },
      {
        notePath: "_memory/observations/2026-older.md",
        title: "Older (Date object)",
        hash: "h2",
        mtime: NOW - 5 * 86_400_000,
        properties: {
          source: "agent",
          confidence: "direct",
          evidence: [],
          status: "active",
          observed_at: new Date(NOW - 5 * 86_400_000),
          type: "observation",
          superseded_by: null,
        },
      },
    ];
    const fx = await buildFixture(docsSpec);
    try {
      // max_age_days: 30 must work against Date objects.
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything", max_age_days: 30 },
      );
      expect(packets).toHaveLength(2);
      // observed_at DESC: newer first
      expect(packets[0]!.title).toBe("Newer (Date object)");
      expect(packets[1]!.title).toBe("Older (Date object)");
    } finally {
      await fx.cleanup();
    }
  });
});

describe("handleRecall — sink scoping", () => {
  it("sink: 'default' constrains to that sink; archive-sink docs excluded", async () => {
    const archiveSpec: FixtureDocSpec = {
      notePath: "_archive/old-doc.md",
      title: "Archived doc",
      hash: "hash-archive",
      mtime: NOW,
      properties: {
        source: "agent",
        confidence: "direct",
        evidence: [],
        status: "active",
        observed_at: iso(0),
        type: "observation",
        superseded_by: null,
      },
    };
    const fx = await buildFixture([...fiveDocFixtureSpecs(), archiveSpec], { multipleSinks: true });
    try {
      // With sink: "default", archive doc is excluded.
      const packets = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything", sink: "default" },
      );
      const titles = packets.map((p) => p.title);
      expect(titles).not.toContain("Archived doc");
      // Without sink, archive doc IS included (all sinks queried).
      const packetsAll = await handleRecall(
        {
          memorySinkRegistry: fx.registry,
          manager: fx.manager,
          sourceConnectorFor: fx.sourceConnectorFor,
          searchHybrid: fx.searchHybrid,
        },
        { query: "anything" },
      );
      expect(packetsAll.map((p) => p.title)).toContain("Archived doc");
    } finally {
      await fx.cleanup();
    }
  });
});
