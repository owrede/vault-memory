/**
 * Integration smoke test for `assembleDossier` against the real
 * `evals/fixtures/v2-test-vault/` Atlas Robotics fixture.
 *
 * Pinned behaviors:
 *   - Resolving `{type: "Person", key: "Alice C."}` (alias path, D-04)
 *     returns alice-chen.md as the anchor with a non-empty backlink set.
 *   - The anchor's `properties.aliases` array survives end-to-end (from
 *     YAML frontmatter → parser → notes.frontmatter JSON → SourceConnector
 *     → toCitationPacket).
 *   - Resolving `{type: "Project", key: "Atlas-1"}` exposes the new
 *     `authoritative: true` marker added in Plan 03-06.
 *   - `linked_documents[].relation === "wikilink"` on every entry
 *     (v2.0.0 surface from the v1 wikilinks table).
 *
 * Builds the in-memory SQLite by walking the fixture markdown files,
 * parsing via the obsidian-fs `parseNote`, and upserting notes +
 * wikilinks rows directly — bypasses embedding (no Ollama dependency,
 * since `assemble_dossier` does not call the embedding model).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AdapterRegistry, parseSourceHandle } from "../adapters/registry.js";
import { parseNote } from "../adapters/source/obsidian-fs/parser.js";
import { ObsidianFsSource } from "../adapters/source/obsidian-fs/index.js";
import { Database } from "../db/index.js";
import { WikilinkResolver } from "../indexer/resolver.js";
import type { ParsedNote } from "../types.js";
import { VaultManager, type Vault } from "../vault/index.js";
import { assembleDossier } from "./dossier.js";

const VAULT_NAME = "v2-test-vault";
const FIXTURE_ROOT = resolve(process.cwd(), "evals/fixtures/v2-test-vault");

function walkMd(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip `_queries/` — it's eval YAML, not Markdown content.
      if (name === "_queries") continue;
      walkMd(full, out);
    } else if (name.endsWith(".md") && name !== "README.md") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Build an in-memory vault populated with the fixture content + the
 * resolved wikilinks table. Returns the assembled deps for the
 * `assembleDossier` controller.
 */
async function buildLiveFixture(): Promise<{
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => ObsidianFsSource;
  cleanup: () => void;
}> {
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: FIXTURE_ROOT, write_enabled: false },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  // Pass 1 — parse all markdown files and insert notes rows.
  const parsed: ParsedNote[] = [];
  const noteIdByPath = new Map<string, number>();
  for (const abs of walkMd(FIXTURE_ROOT)) {
    const p = await parseNote(abs, FIXTURE_ROOT);
    parsed.push(p);
    const result = vault.db.notes.upsertByPath({
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
    noteIdByPath.set(p.relativePath, result.id);
  }

  // Pass 2 — resolve wikilinks against the now-populated notes table
  // and insert wikilink rows. Mirrors the indexer's two-pass flow.
  //
  // ── Phase 4 / 04-01 / GRA-04 (D-01) ──
  // Writes go to BOTH `wikilinks` (v1, kept in place) AND `edges` (Phase
  // 4 read substrate). Plan 04-02 lands the unified extractor that
  // collapses this dual-write into one helper. Until then, integration
  // tests that exercise post-04-01 read paths must seed both tables
  // (the migration-011 backfill only fires once at construction, when
  // `wikilinks` is empty).
  const resolver = new WikilinkResolver(vault);
  for (const p of parsed) {
    const sourceId = noteIdByPath.get(p.relativePath);
    if (sourceId === undefined) continue;
    if (p.wikilinks.length === 0) continue;
    const inputs = p.wikilinks.map((wl) => {
      const hit = resolver.resolve(wl.normalizedTarget);
      return {
        targetPath: hit?.path ?? wl.normalizedTarget,
        targetNoteId: hit?.id ?? null,
        linkText: wl.rawTarget,
        anchor: wl.anchor,
        lineNumber: wl.line,
      };
    });
    vault.db.wikilinks.insertBatch(sourceId, inputs);
    vault.db.edges.insertBatch(
      sourceId,
      inputs.map((wl) => ({
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

  // Build the AdapterRegistry + SourceConnector resolver — the same
  // wiring the server uses, but scoped to this in-memory fixture.
  const adapterRegistry = new AdapterRegistry();
  const source = new ObsidianFsSource(vault.config);
  adapterRegistry.registerSource(source.handle, source);

  const sourceConnectorFor = (vaultName: string): ObsidianFsSource => {
    const handle = parseSourceHandle(`obsidian-fs://${vaultName}`);
    return adapterRegistry.resolveSource(handle) as ObsidianFsSource;
  };

  return {
    manager,
    sourceConnectorFor,
    cleanup: () => {
      db.close();
    },
  };
}

describe("assembleDossier — integration against Atlas Robotics fixture", () => {
  it("resolves Alice by alias and returns a non-empty linked_documents set", async () => {
    const fx = await buildLiveFixture();
    try {
      const result = await assembleDossier(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { type: "Person", key: "Alice C." },
      );
      expect(result.error).toBeNull();
      expect(result.anchor).not.toBeNull();
      expect(result.anchor?.doc_id).toBe("obsidian-fs://v2-test-vault/people/alice-chen.md");
      expect(result.anchor?.title).toBe("Alice Chen");
      // The aliases array survives the round-trip from YAML → notes.frontmatter
      // → toCitationPacket.
      expect(result.anchor?.properties.aliases).toEqual(["Alice C.", "ac"]);

      // Atlas-1, the q2-okr meeting, etc. all wikilink TO Alice — the
      // fixture has multiple backlinks. We assert >= 1 (the exact count
      // depends on fixture content; pin via the existing dossier YAML
      // which lists 5 expected docs, but at least 1 is the only invariant
      // that survives fixture additions).
      expect(result.linked_documents.length).toBeGreaterThanOrEqual(1);

      // PHASE-4-WIDEN — every linked entry must carry the v2.0.0
      // wikilink edge type.
      for (const linked of result.linked_documents) {
        expect(linked.relation).toBe("wikilink");
        expect(typeof linked.properties).toBe("object");
        expect(linked.properties).not.toBeNull();
      }

      // linked_count is consistent with the array length.
      expect(result.property_rollups.linked_count).toBe(result.linked_documents.length);
    } finally {
      fx.cleanup();
    }
  });

  it("resolves Atlas-1 by title and surfaces the authoritative marker", async () => {
    const fx = await buildLiveFixture();
    try {
      const result = await assembleDossier(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { type: "Project", key: "Atlas-1" },
      );
      expect(result.error).toBeNull();
      expect(result.anchor).not.toBeNull();
      expect(result.anchor?.doc_id).toBe("obsidian-fs://v2-test-vault/projects/atlas-1.md");
      // Plan 03-06's authoritative-atlas-1 eval case asserts this:
      expect(result.anchor?.properties.authoritative).toBe(true);
      expect(result.anchor?.status).toBe("active");
      // Atlas-1 is the flagship project — many other docs wikilink to it.
      expect(result.linked_documents.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  it("strict type match — type='Person' + key='Atlas-1' returns no match", async () => {
    const fx = await buildLiveFixture();
    try {
      const result = await assembleDossier(
        { manager: fx.manager, sourceConnectorFor: fx.sourceConnectorFor },
        { type: "Person", key: "Atlas-1" },
      );
      expect(result.anchor).toBeNull();
      expect(result.error).toEqual({
        code: "no_matching_anchor_document",
        type: "Person",
        key: "Atlas-1",
      });
    } finally {
      fx.cleanup();
    }
  });
});
