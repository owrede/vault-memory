/**
 * ObsidianFsSource — the v2 SourceConnector implementation for
 * filesystem-backed Obsidian vaults.
 *
 * Wraps the relocated scanner / parser / hash / wikilinks modules behind
 * the ADR-002 §SourceConnector contract. This file is the SOLE entry
 * point through which Layer-0 retrieval obtains content for an
 * obsidian-fs vault; the registry hands callers an `ObsidianFsSource`
 * keyed by the `obsidian-fs://<vault-name>` handle.
 *
 * # Invariant carve-outs (ADR-002)
 *
 * - I-2 (raw `node:fs` / `node:path`): ALLOWED inside this directory.
 *   `readDocument`, `hash`, and `exists` use `fs.readFile` / `fs.stat`
 *   directly; `formatDisplayUrl` uses `path.basename` style helpers.
 * - I-3 (raw file-path manipulation): ALLOWED — the adapter owns the
 *   conversion between DocId and absolute filesystem path.
 * - I-4 (YAML-frontmatter parsing via `gray-matter`): ALLOWED — the
 *   relocated `./parser.ts` already imports it, and that import is now
 *   confined to this directory (modulo the existing write-side leaks in
 *   `src/write/write.ts` and `src/frontmatter/update.ts`, which plan
 *   01-04 absorbs into the delivery adapter).
 *
 * # Capabilities (Invariant I-7 — honest publication)
 *
 *   bodyShape:         "flat-text"    — single-paragraph fallback for v1 compat
 *   properties:        "untyped"      — YAML frontmatter is untyped per ADR-003
 *   linkTypes:         ["wikilink"]   — sole edge type emitted
 *   identityStable:    false          — paths rename; DocIds are not durable
 *   permissions:       false          — fs ACLs not modeled
 *   contentHashStable: true           — sha256(content + canonicalJson(fm))
 *   refHashKind:       "content"      — DocumentRef.hash === Document.hash
 *   watch:             "push"         — chokidar lands in plan 01-05
 *
 * # Phase-3 follow-ups
 *
 * - `blocks` is a single-paragraph stub; richer block decomposition is
 *   Phase 3 work (ADR-003 BlockNode union).
 * - The v1 hash semantics (`computeNoteHash(body, frontmatter)`) are
 *   preserved for Phase 1 backwards-compat. ADR-003 H-1..H-6 may revise
 *   the canonical hash later.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Document, DocId, SourceHandle, VaultConfig, WikilinkRef } from "../../../types.js";
import type { DocumentRef, ListOptions, SourceCapabilities, SourceConnector } from "../types.js";
import { formatDocId, parseSourceHandle } from "../../registry.js";
import { scanVault, scanContractFiles } from "./scanner.js";
import { parseNote } from "./parser.js";
import { computeBodyHash } from "./hash.js";

/**
 * Phase 6 / Plan 06-04 — task-contract YAML path matcher. Mirrors
 * `CONTRACT_PATH_REGEX` in `src/contracts/types.ts` (Pitfall F3
 * non-recursion). YAML files under `_contracts/` are enumerated +
 * read through the SourceConnector seam so the contract loader's
 * boot scan + ChangeFeed paths see real on-disk YAML.
 */
const CONTRACT_PATH_RE = /^_contracts\/[^/]+\.yaml$/;

// ─────────────────────────────────────────────────────────────────────────────
// ObsidianFsSource
// ─────────────────────────────────────────────────────────────────────────────

const SCHEME = "obsidian-fs";

export class ObsidianFsSource implements SourceConnector {
  readonly handle: SourceHandle;

  readonly capabilities: SourceCapabilities = {
    bodyShape: "flat-text",
    properties: "untyped",
    linkTypes: ["wikilink"] as const,
    identityStable: false,
    permissions: false,
    contentHashStable: true,
    refHashKind: "content",
    watch: "push",
  };

  constructor(private readonly vault: VaultConfig) {
    this.handle = parseSourceHandle(`${SCHEME}://${vault.name}`);
  }

  // ── enumeration ────────────────────────────────────────────────────────────

  async *listDocuments(opts?: ListOptions): AsyncIterable<DocumentRef> {
    const excludeOverlay = opts?.excludeGlobs;
    const mdFiles = await scanVault(this.vault.path, {
      ...(excludeOverlay ? { excludeGlobs: excludeOverlay } : {}),
    });
    // Phase 6 / Plan 06-04 — yield task-contract YAML files alongside .md
    // notes. The contract loader's boot scan + ChangeFeed paths filter by
    // CONTRACT_PATH_REGEX inside `src/contracts/loader.ts`, so unrelated
    // consumers (indexer, watcher, search) that filter on `.md` extension
    // are unaffected. The indexer uses scanVault() directly (not this
    // method) so its .md-only contract is preserved.
    const yamlFiles = await scanContractFiles(this.vault.path);
    const files = mdFiles.concat(yamlFiles);
    files.sort();
    const since = opts?.since;
    const limit = opts?.limit;
    let yielded = 0;
    for (const abs of files) {
      if (limit !== undefined && yielded >= limit) break;
      const rel = this.toPosix(path.relative(path.resolve(this.vault.path), abs));
      const stat = await fs.stat(abs);
      const mtime = Math.floor(stat.mtimeMs);
      if (since !== undefined && mtime < since) continue;
      // Cheap content hash for the ref — matches refHashKind: "content"
      const body = await fs.readFile(abs, "utf-8");
      const hash = computeBodyHash(body);
      // A pathological filename (e.g. an embedded newline from a botched
      // Obsidian title) makes pathToDocId → formatDocId throw. Skipping the
      // one bad file keeps a single malformed note from aborting the whole
      // listDocuments() iteration — which previously took down bootScan /
      // the contract registry for the entire vault.
      let id: DocId;
      try {
        id = this.pathToDocId(rel);
      } catch (err) {
        console.error(
          `[obsidian-fs:${this.vault.name}] skipping un-addressable file ` +
            `${JSON.stringify(rel)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      yield { id, mtime, hash };
      yielded++;
    }
  }

  // ── single-doc reads ───────────────────────────────────────────────────────

  async readDocument(id: DocId): Promise<Document> {
    const rel = this.docIdToPath(id);
    const abs = this.absPath(rel);

    // Phase 6 / Plan 06-04 — task-contract YAML branch. parseNote()
    // assumes markdown + frontmatter; it would mis-parse a YAML
    // contract file. Return the raw text as a single paragraph block
    // with no properties; the contract loader (`src/contracts/loader.ts`)
    // is the only consumer and parses the body via `yaml@2.9`.
    if (CONTRACT_PATH_RE.test(rel)) {
      const body = await fs.readFile(abs, "utf-8");
      const stat = await fs.stat(abs);
      const hash = computeBodyHash(body);
      return {
        id,
        source: this.handle,
        title: rel,
        blocks: [{ kind: "paragraph", text: body }],
        properties: {},
        links: [],
        mtime: Math.floor(stat.mtimeMs),
        hash,
        display_url: this.formatDisplayUrl(id),
      };
    }

    const parsed = await parseNote(abs, this.vault.path);

    // D-05: surface wikilinks as Document.properties.wikilinks: WikilinkRef[]
    const wikilinks: WikilinkRef[] = parsed.wikilinks.map((w) => {
      const ref: WikilinkRef = { target: w.normalizedTarget };
      if (w.alias !== null) ref.alias = w.alias;
      if (w.anchor !== null) ref.section = w.anchor;
      return ref;
    });

    const properties: Record<string, unknown> = {
      ...(parsed.frontmatter ?? {}),
      wikilinks,
    };

    return {
      id,
      source: this.handle,
      title: parsed.title,
      blocks: [{ kind: "paragraph", text: parsed.content }],
      properties,
      links: [],
      mtime: parsed.mtime,
      hash: parsed.hash,
      display_url: this.formatDisplayUrl(id),
    };
  }

  async hash(id: DocId): Promise<string> {
    const rel = this.docIdToPath(id);
    const abs = this.absPath(rel);
    const body = await fs.readFile(abs, "utf-8");
    return computeBodyHash(body);
  }

  async exists(id: DocId): Promise<boolean> {
    try {
      const rel = this.docIdToPath(id);
      const abs = this.absPath(rel);
      await fs.stat(abs);
      return true;
    } catch {
      return false;
    }
  }

  // ── display ────────────────────────────────────────────────────────────────

  formatDisplayUrl(id: DocId): string {
    const rel = this.docIdToPath(id);
    const vault = encodeURIComponent(this.vault.name);
    const file = encodeURIComponent(rel);
    return `obsidian://open?vault=${vault}&file=${file}`;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Parse the URI authority + resource off a DocId. Asserts the authority
   * matches `this.vault.name` — prevents one vault's adapter from reading
   * another vault's file via a forged DocId (T-01-03-02 in the plan's
   * threat model).
   */
  private docIdToPath(id: DocId): string {
    const prefix = `${SCHEME}://`;
    if (!id.startsWith(prefix)) {
      throw new Error(`DocId scheme mismatch: expected "${SCHEME}://…", got ${JSON.stringify(id)}`);
    }
    const rest = id.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      throw new Error(`Invalid DocId shape: missing resource path in ${JSON.stringify(id)}`);
    }
    const authority = rest.slice(0, slash);
    const resource = rest.slice(slash + 1);
    if (authority !== this.vault.name) {
      throw new Error(
        `DocId vault mismatch: id authority "${authority}" does not match ` +
          `this adapter's configured vault "${this.vault.name}"`,
      );
    }
    if (resource.length === 0) {
      throw new Error(`Invalid DocId: empty resource path in ${JSON.stringify(id)}`);
    }
    return resource;
  }

  private pathToDocId(rel: string): DocId {
    const posix = this.toPosix(rel);
    return formatDocId(SCHEME, this.vault.name, posix);
  }

  private absPath(rel: string): string {
    return path.resolve(this.vault.path, rel);
  }

  private toPosix(p: string): string {
    return p.split(path.sep).join("/");
  }
}
