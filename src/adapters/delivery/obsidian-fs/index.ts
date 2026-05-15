/**
 * ObsidianFsDelivery — v2 DeliveryAdapter implementation. Wraps the relocated
 * write/atomic-write modules (writeNote, deleteNote) and exposes them under
 * the ADR-002 §DeliveryAdapter contract.
 *
 * I-2/I-3/I-4/I-6 (raw fs.*, raw path.*, gray-matter, fs.writeFile/unlink/rename)
 * are ALLOWED here — this directory is the only legitimate home for write-side
 * filesystem operations on obsidian-fs vaults.
 *
 * Phase 2 (MEM-01..12) will inject MemorySink guards A (provenance required)
 * and B (source:agent outside configured sink rejected) at the entry of
 * `write()` WITHOUT changing the public method shape. The TSDoc note on
 * `DeliveryAdapter.write()` (see ../types.ts) signals that seam; this Phase 1
 * implementation has ONLY the existing `write_enabled` flag + safeJoinInsideVault
 * path safety.
 *
 * Backwards-compat: the legacy `writeNote` / `deleteNote` / `atomicWriteFile` /
 * `safeJoinInsideVault` / `OutsideVaultError` symbols are still re-exported
 * for v1 handlers that haven't been refactored to call the facade directly.
 * The DeliveryAdapter facade is the preferred entry point for v2 consumers.
 */

import { promises as fs } from "node:fs";
import matter from "gray-matter";
import type {
  DeliveryAdapter,
  DeliveryCapabilities,
  WriteOptions,
  WriteResult as V2WriteResult,
  UpdateResult as V2UpdateResult,
  DeleteResult as V2DeleteResult,
} from "../types.js";
import type { Document, DocId, SourceHandle } from "../../../types.js";
import type { Vault } from "../../../vault/index.js";
import { parseSourceHandle } from "../../registry.js";
import {
  writeNote as writeNoteInternal,
  deleteNote as deleteNoteInternal,
  type WriteResult as V1WriteResult,
} from "./write.js";
import { safeJoinInsideVault } from "./fs.js";
import { computeNoteHash } from "../../source/obsidian-fs/hash.js";

// ─── Legacy re-exports (v1 callers + tests) ─────────────────────────────────
//
// Existing handlers in src/server.ts and tests import these directly. They
// continue to work; new code should construct an ObsidianFsDelivery and call
// the DeliveryAdapter methods instead.

export { writeNote, deleteNote } from "./write.js";
export type {
  WriteResult,
  WriteSuccess,
  WriteConflict,
  WriteNoteInput,
  DeleteNoteInput,
} from "./write.js";
export { atomicWriteFile, safeJoinInsideVault, OutsideVaultError } from "./fs.js";

// ─── DeliveryAdapter facade ─────────────────────────────────────────────────

const SCHEME = "obsidian-fs";

/**
 * Map a v1 internal `WriteResult` (with `noteId: number`) to the v2
 * `WriteResult` shape (with `doc_id: DocId`). The facade owns this
 * boundary mapping so the internal write.ts can keep its v1 shape and
 * caller-facing handlers can keep deriving v1 `noteId` from the DB.
 */
function v1ToV2WriteResult(id: DocId, v1: V1WriteResult): V2WriteResult {
  if (!v1.ok) {
    return v1.currentHash !== undefined
      ? { ok: false, reason: v1.reason, currentHash: v1.currentHash, message: v1.message }
      : { ok: false, reason: v1.reason, message: v1.message };
  }
  return { ok: true, doc_id: id, newHash: v1.newHash, created: v1.created };
}

function v1ToV2UpdateResult(id: DocId, v1: V1WriteResult): V2UpdateResult {
  if (!v1.ok) {
    return v1.currentHash !== undefined
      ? { ok: false, reason: v1.reason, currentHash: v1.currentHash, message: v1.message }
      : { ok: false, reason: v1.reason, message: v1.message };
  }
  return { ok: true, doc_id: id, newHash: v1.newHash };
}

export class ObsidianFsDelivery implements DeliveryAdapter {
  readonly handle: SourceHandle;

  readonly capabilities: DeliveryCapabilities = {
    atomic: true,
    hashProtected: "strong",
    enforcedSchema: false,
    naming: "caller-provided",
  };

  /**
   * @param vault The Vault unit-of-access (config + db handle).
   * @param clientId Default audit-log attribution. Per D-02, captured from
   *  MCP InitializeRequest.params.clientInfo (via the SDK's
   *  `Server.getClientVersion()?.name`) at server bootstrap. May be a static
   *  string OR a lazy getter — the getter form lets the server construct
   *  deliveries BEFORE the initialize handshake completes and have the
   *  handshake value flow through automatically on the first write.
   *  Falls back to "unknown" at the call site if no value is supplied at
   *  any level (per RESEARCH Pitfall 4: clientInfo is OPTIONAL in the MCP
   *  spec, so older or non-conformant clients may not send it).
   */
  constructor(
    private readonly vault: Vault,
    private readonly clientIdSource: string | (() => string),
  ) {
    this.handle = parseSourceHandle(`${SCHEME}://${vault.config.name}`);
  }

  private get clientId(): string {
    return typeof this.clientIdSource === "function"
      ? this.clientIdSource()
      : this.clientIdSource;
  }

  async write(id: DocId, doc: Partial<Document>, opts?: WriteOptions): Promise<V2WriteResult> {
    const path = this.docIdToPath(id);
    const { body, frontmatter } = extractBodyAndFrontmatter(doc);
    const effectiveClientId = opts?.clientId ?? this.clientId;
    const v1 = await writeNoteInternal({
      vault: this.vault,
      relativePath: path,
      content: body,
      frontmatter,
      ...(opts?.expectedHash !== undefined ? { expectedHash: opts.expectedHash } : {}),
      clientId: effectiveClientId,
    });
    return v1ToV2WriteResult(id, v1);
  }

  /**
   * Replace-or-merge update. Reads current document via the filesystem,
   * applies `patch.properties` (shallow-merged into existing frontmatter)
   * and/or `patch.blocks` (replaces body), then writes via writeNote with
   * the OCC token.
   *
   * Returns `{ ok: false, reason: "not_found" }` when the file is absent
   * (matches DeliveryAdapter contract — no implicit create on update).
   *
   * The v1 MCP `update_frontmatter` handler continues to route through
   * `src/frontmatter/update.ts` (merge-DSL semantics + diff emission). This
   * `update()` path exists primarily for conformance and for non-merge-DSL
   * callers (Phase 2+).
   */
  async update(id: DocId, patch: Partial<Document>, opts?: WriteOptions): Promise<V2UpdateResult> {
    const path = this.docIdToPath(id);

    // Resolve absolute path with safety check; on traversal this throws,
    // which surfaces upstream — that is intentional, matching v1 writeNote.
    const abs = await safeJoinInsideVault(this.vault.config.path, path);

    let raw: string;
    try {
      raw = await fs.readFile(abs, "utf-8");
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return {
          ok: false,
          reason: "not_found",
          message: `Document not found: ${id}`,
        };
      }
      throw err;
    }
    const parsed = matter(raw);
    const existingFm = (parsed.data ?? {}) as Record<string, unknown>;
    const existingBody = parsed.content;

    // Merge properties (shallow). If patch.blocks is supplied, replace body
    // with the concatenation of paragraph-block text; otherwise preserve.
    const patchProps = patch.properties as Record<string, unknown> | undefined;
    const nextFm =
      patchProps !== undefined ? { ...existingFm, ...stripWikilinks(patchProps) } : existingFm;
    const nextBody =
      patch.blocks !== undefined
        ? patch.blocks
            .map((b) => (b.kind === "paragraph" ? b.text : ""))
            .filter((s) => s.length > 0)
            .join("\n\n")
        : existingBody;

    // When the caller did not supply an expectedHash, compute the current
    // on-disk hash so the internal writeNote will accept the overwrite as
    // intentional. Callers can override by passing opts.expectedHash —
    // the OCC contract still surfaces a hash_mismatch for stale hashes.
    const existingHash =
      computeNoteHash(existingBody, Object.keys(existingFm).length > 0 ? existingFm : null);
    const effectiveExpectedHash = opts?.expectedHash ?? existingHash;

    const effectiveClientId = opts?.clientId ?? this.clientId;
    const v1 = await writeNoteInternal({
      vault: this.vault,
      relativePath: path,
      content: nextBody,
      frontmatter: Object.keys(nextFm).length > 0 ? nextFm : null,
      expectedHash: effectiveExpectedHash,
      clientId: effectiveClientId,
    });
    return v1ToV2UpdateResult(id, v1);
  }

  async delete(id: DocId, opts?: WriteOptions): Promise<V2DeleteResult> {
    const path = this.docIdToPath(id);

    // The v1 deleteNote requires expectedHash. If the caller did not
    // supply one, surface a permission-denied-style failure so the
    // hashProtected="strong" guarantee holds.
    if (opts?.expectedHash === undefined) {
      // Use a "not_found"-style probe via the FS to distinguish a
      // missing-doc case from a missing-hash case (the conformance test
      // expects `not_found` when deleting an unknown DocId).
      try {
        const abs = await safeJoinInsideVault(this.vault.config.path, path);
        await fs.stat(abs);
      } catch {
        return {
          ok: false,
          reason: "not_found",
          message: `Document not found: ${id}`,
        };
      }
      return {
        ok: false,
        reason: "hash_mismatch",
        message: `delete() requires opts.expectedHash for hashProtected="strong" adapters`,
      };
    }

    const effectiveClientId = opts?.clientId ?? this.clientId;
    const v1 = await deleteNoteInternal({
      vault: this.vault,
      relativePath: path,
      expectedHash: opts.expectedHash,
      clientId: effectiveClientId,
    });
    if (!v1.ok) {
      // v1 returns hash_mismatch when the file is absent. Re-shape to
      // not_found for the v2 contract.
      if (v1.reason === "hash_mismatch" && v1.currentHash === undefined) {
        return {
          ok: false,
          reason: "not_found",
          message: v1.message,
        };
      }
      return v1.currentHash !== undefined
        ? { ok: false, reason: v1.reason, currentHash: v1.currentHash, message: v1.message }
        : { ok: false, reason: v1.reason, message: v1.message };
    }
    return { ok: true, doc_id: id };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Parse the URI authority + resource off a DocId. Asserts the authority
   * matches the configured vault name — mirrors ObsidianFsSource.docIdToPath
   * to prevent cross-vault forgery.
   */
  private docIdToPath(id: DocId): string {
    const prefix = `${SCHEME}://`;
    if (!id.startsWith(prefix)) {
      throw new Error(
        `DocId scheme mismatch: expected "${SCHEME}://…", got ${JSON.stringify(id)}`,
      );
    }
    const rest = id.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      throw new Error(`Invalid DocId shape: missing resource path in ${JSON.stringify(id)}`);
    }
    const authority = rest.slice(0, slash);
    const resource = rest.slice(slash + 1);
    if (authority !== this.vault.config.name) {
      throw new Error(
        `DocId vault mismatch: id authority "${authority}" does not match ` +
          `this adapter's configured vault "${this.vault.config.name}"`,
      );
    }
    if (resource.length === 0) {
      throw new Error(`Invalid DocId: empty resource path in ${JSON.stringify(id)}`);
    }
    return resource;
  }
}

// ─── Partial<Document> → body + frontmatter ─────────────────────────────────

function stripWikilinks(props: Record<string, unknown>): Record<string, unknown> {
  // D-05: ObsidianFsSource surfaces wikilinks as Document.properties.wikilinks
  // when READING. We must NOT write that field back into the user's frontmatter.
  const { wikilinks: _w, ...rest } = props as { wikilinks?: unknown } & Record<string, unknown>;
  return rest;
}

function extractBodyAndFrontmatter(doc: Partial<Document>): {
  body: string;
  frontmatter: Record<string, unknown> | null;
} {
  // body: concatenate flat-text paragraph blocks. Phase 1 only emits
  // single-paragraph blocks anyway (ADR-003 BodyShape="flat-text").
  const body = (doc.blocks ?? [])
    .map((b) => (b.kind === "paragraph" ? b.text : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");

  const props = doc.properties;
  if (props === undefined || props === null) {
    return { body, frontmatter: null };
  }
  const stripped = stripWikilinks(props as Record<string, unknown>);
  return {
    body,
    frontmatter: Object.keys(stripped).length > 0 ? stripped : null,
  };
}
