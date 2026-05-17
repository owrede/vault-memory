/**
 * Shared Atlas Robotics live-fixture builder for Phase 4 integration tests.
 *
 * Mirrors `src/assembly/dossier.integration.test.ts:buildLiveFixture` but
 * extends it to populate ALL FOUR Phase 4 edge types
 * (wikilink + mention + frontmatter-ref + hyperlink) via the production
 * `extractAllEdges` extractor.
 *
 * Used by:
 *   - `src/graph/expand.integration.test.ts`
 *   - `src/graph/cluster.integration.test.ts`
 *   - `src/search/hybrid-expand.integration.test.ts`
 *
 * # Slug-alias synthesis (test-only)
 *
 * Atlas Robotics fixture notes do NOT carry explicit `aliases:` declarations
 * beyond Alice's `["Alice C.", "ac"]`. Production `extractAllEdges` Rule (b)
 * for `frontmatter-ref` and the mention extractor's candidate set BOTH read
 * exclusively from `note_aliases`. So `owner: alice-chen` (bare string,
 * present in many project notes) cannot resolve, and "Alice Chen" appearing
 * in body text cannot be tagged as a mention.
 *
 * To exercise the typed-edge mix the Phase 4 plan calls for without
 * mutating committed fixture content, this helper SYNTHESIZES slug-style
 * aliases for every person note BEFORE running `extractAllEdges`. Concretely
 * for each `people/<slug>.md` row we insert two aliases into `note_aliases`:
 *   1. The slug itself (e.g. `alice-chen`) — activates `attendees: [alice-chen]`
 *      frontmatter-ref rule (b) and the bare-token mention path.
 *   2. The title (e.g. `Alice Chen`) — activates mentions of the full name
 *      in body prose ("Alice Chen co-founded ...").
 *
 * Aliases shorter than `MIN_MENTION_LEN` (4) for mention candidate eligibility
 * are still inserted but the mention extractor's filter drops them, so
 * single-token aliases like `ac` produce no mention noise.
 *
 * # A1 empirical note
 *
 * Without these synthetic aliases, the fixture produces 0 mention edges
 * over 62 notes (avg 0.00 mentions/note) — well below the ≤3 FP/note
 * trip-wire from RESEARCH §Pitfall 2. MIN_MENTION_LEN=4 stays confirmed.
 * The synthesized aliases here are scoped to the test process and never
 * touch the on-disk fixture, so the empirical A1 finding stands.
 */

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AdapterRegistry, parseSourceHandle } from "../../adapters/registry.js";
import { parseNote } from "../../adapters/source/obsidian-fs/parser.js";
import { ObsidianFsSource } from "../../adapters/source/obsidian-fs/index.js";
import { chunkNote } from "../../chunker/index.js";
import { Database } from "../../db/index.js";
import { extractAliases } from "../../indexer/indexer.js";
import { WikilinkResolver } from "../../indexer/resolver.js";
import { extractAllEdges } from "../../indexer/extract-edges.js";
import type { ParsedNote, SourceHandle } from "../../types.js";
import type { SourceConnector } from "../../adapters/source/types.js";
import { VaultManager, type Vault } from "../../vault/index.js";

export const ATLAS_VAULT_NAME = "v2-test-vault";
export const ATLAS_FIXTURE_ROOT = resolve(process.cwd(), "evals/fixtures/v2-test-vault");

export interface AtlasLiveFixture {
  vault: Vault;
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  sourceHandle: SourceHandle;
  cleanup: () => void;
}

export interface BuildAtlasLiveFixtureOptions {
  /**
   * When true, the builder also chunks every note via `chunkNote` and
   * inserts the chunks + FTS rows so the BM25 path of `hybridSearch`
   * has something to find. Defaults to false (graph-only fixtures
   * skip the chunk insert for speed). Embeddings are NOT generated —
   * the BM25-only hybrid path is sufficient for the integration tests
   * that consume this option.
   */
  withChunks?: boolean;
}

function walkMd(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (name === "_queries") continue;
      walkMd(full, out);
    } else if (name.endsWith(".md") && name !== "README.md") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Synthesize slug + title aliases for every `people/<slug>.md` note so
 * the production frontmatter-ref Rule (b) resolver and the mention
 * extractor's candidate set have entries to match against.
 *
 * Test-only — the on-disk fixture is unchanged.
 */
function synthesizePersonAliases(vault: Vault): void {
  const personRows = vault.db.handle
    .prepare(`SELECT id, path, title FROM notes WHERE path LIKE 'people/%'`)
    .all() as Array<{ id: number; path: string; title: string }>;
  for (const row of personRows) {
    // Existing aliases (e.g. Alice's "Alice C.", "ac") must be preserved.
    const existing = vault.db.aliases.listForNote(row.id);
    const slug = row.path.replace(/^people\//, "").replace(/\.md$/, "");
    const merged = new Set<string>([...existing, slug, row.title]);
    vault.db.aliases.setForNote(row.id, [...merged]);
  }
}

/**
 * Build a live in-memory vault populated from the Atlas Robotics fixture
 * with all four typed edge types resolved.
 *
 * Returns the assembled deps for `expand()` / `hybridSearch({expand})` /
 * `cluster()`. Caller MUST invoke `cleanup()` to close the DB.
 */
export async function buildAtlasLiveFixture(
  options: BuildAtlasLiveFixtureOptions = {},
): Promise<AtlasLiveFixture> {
  const withChunks = options.withChunks === true;
  const db = new Database(":memory:", ATLAS_VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: ATLAS_VAULT_NAME, path: ATLAS_FIXTURE_ROOT, write_enabled: false },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(ATLAS_VAULT_NAME, vault);

  // Pass 1 — parse every fixture markdown file, insert notes + aliases.
  const parsed: ParsedNote[] = [];
  for (const abs of walkMd(ATLAS_FIXTURE_ROOT)) {
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
      vaultName: ATLAS_VAULT_NAME,
    });
    vault.db.aliases.setForNote(res.id, extractAliases(p.frontmatter));

    // Maintain notes.status (denormalized — exercised by expand's
    // include_superseded filter).
    const status =
      p.frontmatter && typeof p.frontmatter["status"] === "string"
        ? (p.frontmatter["status"] as string)
        : null;
    if (status !== null) vault.db.notes.setStatus(res.id, status);

    if (withChunks) {
      const chunks = chunkNote(p.content);
      if (chunks.length > 0) {
        vault.db.chunks.insertBatch(
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
      }
    }
  }

  // Synthesize slug + title aliases for people so frontmatter-ref Rule (b)
  // and the mention candidate set both have entries.
  synthesizePersonAliases(vault);

  // Pass 2 — run the unified edge extractor against every note. This
  // populates `edges` with the full wikilink + mention + frontmatter-ref
  // + hyperlink mix that expand() / cluster() read.
  const resolver = new WikilinkResolver(vault);
  for (const p of parsed) {
    const noteRow = vault.db.notes.getByPath(p.relativePath);
    if (!noteRow) continue;
    const edges = extractAllEdges(vault, p, resolver);
    if (edges.length > 0) vault.db.edges.insertBatch(noteRow.id, edges);

    // Also write the v1 wikilinks table for any code path (dossier,
    // baseline) that still reads it. Mirrors the production indexer's
    // dual-write per Phase 4 D-01.
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
    if (wikilinkInputs.length > 0) {
      vault.db.wikilinks.insertBatch(noteRow.id, wikilinkInputs);
    }
  }

  // SourceConnector wiring — production pattern (mirrors
  // dossier.integration.test.ts).
  const adapterRegistry = new AdapterRegistry();
  const source = new ObsidianFsSource(vault.config);
  adapterRegistry.registerSource(source.handle, source);

  const sourceConnectorFor = (vaultName: string): SourceConnector => {
    const handle = parseSourceHandle(`obsidian-fs://${vaultName}`);
    return adapterRegistry.resolveSource(handle);
  };

  return {
    vault,
    manager,
    sourceConnectorFor,
    sourceHandle: source.handle,
    cleanup: () => db.close(),
  };
}

/** Helper: format an Atlas Robotics vault-relative path as a branded DocId. */
export function atlasDocId(vaultRelativePath: string): string {
  return `obsidian-fs://${ATLAS_VAULT_NAME}/${vaultRelativePath}`;
}
