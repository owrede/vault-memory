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
import type { Document, DocId, MemorySink, SourceHandle } from "../../../types.js";
import type { Vault } from "../../../vault/index.js";
import { parseSourceHandle } from "../../registry.js";
import {
  writeNote as writeNoteInternal,
  deleteNote as deleteNoteInternal,
  type WriteResult as V1WriteResult,
} from "./write.js";
import { safeJoinInsideVault } from "./fs.js";
import { validateAgentWrite } from "../../../memory/validator.js";
import { getContract } from "../../../memory/contract/index.js";
import type { MemorySinkRegistry } from "../../../memory/registry.js";
import { assertSentinelExists, SinkSentinelCheckError } from "./sentinel.js";

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
   * @param memorySinkRegistry Optional Phase 2 sink registry. When supplied,
   *  the adapter runs Guards A/B + sentinel check at the entry of
   *  `write` / `update` / `delete` per ADR-002 §DeliveryAdapter. When
   *  omitted (Phase 1 fixture tests + back-compat), the validator is
   *  silently skipped — production paths in Plan 02-03b's server
   *  bootstrap always pass the registry, so production is always
   *  guarded.
   */
  constructor(
    private readonly vault: Vault,
    private readonly clientIdSource: string | (() => string),
    private readonly memorySinkRegistry?: MemorySinkRegistry,
  ) {
    this.handle = parseSourceHandle(`${SCHEME}://${vault.config.name}`);
  }

  private get clientId(): string {
    return typeof this.clientIdSource === "function" ? this.clientIdSource() : this.clientIdSource;
  }

  /**
   * Resolve the sink that "owns" a write target.
   *
   * Resolution order (per ADR-004 §Resolution + Plan 02-03 <action>):
   *   1. If `opts.sink` is supplied AND the registry knows it, use it.
   *      The caller explicitly routed the write under that sink.
   *   2. Else, ask the registry `findSinkContaining(id)` — for DocIds
   *      whose vault-relative path lies inside a registered sink, this
   *      returns the enclosing sink. Used for guarding writes that
   *      target memory paths WITHOUT an explicit `opts.sink` (e.g. v1
   *      `writeNote` against `_memory/...`).
   *   3. Else, the target is outside every sink — return `null`.
   *
   * Returns `null` when no registry is configured (Phase 1 fixture
   * tests + back-compat). The validator then silently passes.
   */
  private resolveTargetSink(id: DocId, opts?: WriteOptions): MemorySink | null {
    const registry = this.memorySinkRegistry;
    if (!registry) return null;
    if (opts?.sink !== undefined) {
      try {
        return registry.resolveMemorySink(opts.sink);
      } catch {
        // Fall through to path-based lookup; surfaces as
        // `agent_write_outside_sink` if the caller declared the wrong
        // sink and the path also doesn't land in any registered sink.
      }
    }
    return registry.findSinkContaining(id);
  }

  /**
   * Run Guards A/B + sentinel for a write or update. Returns the
   * conflict to short-circuit on, or `null` to proceed.
   *
   * Order: Guard B (cheap) → sentinel (fail-closed) → Guard A.
   * The sentinel check is filesystem-specific and intentionally lives
   * here, not in the validator.
   */
  private async preflight(
    id: DocId,
    doc: Partial<Document>,
    opts?: WriteOptions,
  ): Promise<V2WriteResult | null> {
    if (!this.memorySinkRegistry) return null;
    const sink = this.resolveTargetSink(id, opts);
    const contract = sink ? getContract(sink.contractName) : null;

    // Guard B (and partial Guard A for source mismatch) — runs first.
    // Guard A short-circuits if source-check fails.
    const sourceCheck = validateAgentWrite(id, doc, sink, null);
    if (sourceCheck) return sourceCheck;

    // Sentinel check (filesystem-specific) — only when target lands in a sink.
    // WR-06 (gap-closure Plan 02-10): ENOENT distinguishes from other errno
    // codes. The literal `"sentinel_check_failed"` was added to the
    // WriteConflict.reason union by Plan 02-13 Task 1 in wave 9; this plan
    // CONSUMES that literal here.
    if (sink !== null) {
      let ok: boolean;
      try {
        ok = await assertSentinelExists(sink, this.vault.config.path);
      } catch (err) {
        if (err instanceof SinkSentinelCheckError) {
          return {
            ok: false,
            reason: "sentinel_check_failed",
            sinkName: sink.name,
            message: err.message,
            suggestion:
              `Check filesystem permissions / disk health for ` +
              `${this.vault.config.name}/${sink.resolveToRelativePath}. ` +
              `Underlying errno: ${err.underlyingCode}.`,
          };
        }
        throw err;
      }
      if (!ok) {
        return {
          ok: false,
          reason: "sentinel_missing",
          sinkName: sink.name,
          message:
            `MemorySink "${sink.name}" refuses to resolve: ` +
            `'.memory-sink' sentinel file is missing under ${this.vault.config.name}/${sink.resolveToRelativePath}.`,
          suggestion:
            "Restart the server (it re-provisions automatically) or restore .memory-sink manually.",
        };
      }
    }

    // Guard A (full Zod schema validation) — only when target lands in a sink
    // and a contract is bound.
    if (sink !== null && contract !== null) {
      const guardA = validateAgentWrite(id, doc, sink, contract);
      if (guardA) return guardA;
    }
    return null;
  }

  async write(id: DocId, doc: Partial<Document>, opts?: WriteOptions): Promise<V2WriteResult> {
    const guard = await this.preflight(id, doc, opts);
    if (guard) return guard;
    const path = this.docIdToPath(id);
    const { body, frontmatter } = extractBodyAndFrontmatter(doc);
    const effectiveClientId = opts?.clientId ?? this.clientId;
    // Plan 02-06 (MEM-08): the audit row's `is_memory_sink_write` flag is
    // derived from `opts.sink !== undefined` — the shared Phase 1 routing
    // signal. Sink-routed writes (record_observation, supersede) ALWAYS
    // pass `opts.sink`; user/v1 writes never do.
    const v1 = await writeNoteInternal({
      vault: this.vault,
      relativePath: path,
      content: body,
      frontmatter,
      ...(opts?.expectedHash !== undefined ? { expectedHash: opts.expectedHash } : {}),
      clientId: effectiveClientId,
      isMemorySinkWrite: opts?.sink !== undefined,
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
   * WR-05 (Plan 02-14): callers MUST supply `opts.expectedHash`. Omitting
   * it returns `{ ok: false, reason: "hash_mismatch" }` — symmetric with
   * `delete()`'s existing behavior. The previous implementation silently
   * fabricated `expectedHash` from the on-disk hash, racing with concurrent
   * edits and downgrading the `hashProtected: "strong"` capability to
   * best-effort.
   *
   * The v1 MCP `update_frontmatter` handler continues to route through
   * `src/frontmatter/update.ts` (merge-DSL semantics + diff emission). This
   * `update()` path exists primarily for conformance and for non-merge-DSL
   * callers (Phase 2+).
   */
  async update(id: DocId, patch: Partial<Document>, opts?: WriteOptions): Promise<V2UpdateResult> {
    const guard = await this.preflight(id, patch, opts);
    if (guard) return guard;

    // WR-05 (Plan 02-14): refuse if expectedHash is missing. The OCC token
    // is mandatory for hashProtected="strong" adapters; silently fabricating
    // it from the on-disk hash (the previous behavior) downgraded the
    // contract to best-effort and raced with concurrent edits.
    if (opts?.expectedHash === undefined) {
      return {
        ok: false,
        reason: "hash_mismatch",
        message: `update() requires opts.expectedHash for hashProtected="strong" adapters`,
      };
    }

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

    // WR-05 (Plan 02-14): expectedHash is mandatory (checked above). The OCC
    // contract is honored by passing opts.expectedHash straight through;
    // writeNoteInternal surfaces a hash_mismatch for stale tokens.
    const effectiveClientId = opts?.clientId ?? this.clientId;
    // Plan 02-06 (MEM-08): symmetric with write() — update() also derives
    // the audit-row sink flag from `opts.sink !== undefined`. supersede
    // routes through update() with `opts.sink` set, so the resulting
    // audit row is correctly stamped as a memory-sink write.
    const v1 = await writeNoteInternal({
      vault: this.vault,
      relativePath: path,
      content: nextBody,
      frontmatter: Object.keys(nextFm).length > 0 ? nextFm : null,
      expectedHash: opts.expectedHash,
      clientId: effectiveClientId,
      isMemorySinkWrite: opts?.sink !== undefined,
    });
    return v1ToV2UpdateResult(id, v1);
  }

  async delete(id: DocId, opts?: WriteOptions): Promise<V2DeleteResult> {
    // Hard-deletion of memory documents is forbidden in v2.0.0
    // (per Plan 02-03 truths + RESEARCH Pitfall 5). If the DocId
    // resolves into ANY registered sink (regardless of opts.sink),
    // refuse with sink_write_blocked. Use `supersede` instead.
    if (this.memorySinkRegistry) {
      const enclosing = this.memorySinkRegistry.findSinkContaining(id);
      if (enclosing !== null) {
        return {
          ok: false,
          reason: "sink_write_blocked",
          sinkName: enclosing.name,
          message:
            `Hard deletion of MemorySink "${enclosing.name}" documents is ` +
            `not permitted in v2.0.0.`,
          suggestion:
            "Use supersede to retire memory documents. Hard deletion is not yet supported in v2.0.0.",
        };
      }
    }

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
    // Plan 02-06 (MEM-08): symmetric flag for delete. Sink-routed deletes
    // are normally refused upstream (v2.0.0 forbids hard-delete of memory
    // documents — callers use `supersede`). The flag is forwarded for
    // symmetry only; this path generally records non-memory deletes.
    const v1 = await deleteNoteInternal({
      vault: this.vault,
      relativePath: path,
      expectedHash: opts.expectedHash,
      clientId: effectiveClientId,
      isMemorySinkWrite: opts?.sink !== undefined,
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
      throw new Error(`DocId scheme mismatch: expected "${SCHEME}://…", got ${JSON.stringify(id)}`);
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
