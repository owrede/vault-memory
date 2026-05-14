/**
 * DeliveryAdapter — the write seam (ADR-002 §DeliveryAdapter).
 *
 * A `DeliveryAdapter` lets vault-memory write, update, and delete
 * documents against a backing store. Implementations: `ObsidianFsDelivery`
 * (Plan 01-04, atomic FS write + OCC); `StubDelivery` (Plan 01-04,
 * in-memory conformance fixture); future notion-api delivery in Phase 10.
 *
 * # Invariants (ADR-002)
 *
 *   I-1..I-7 (see src/adapters/source/types.ts header). DeliveryAdapter
 *   implementations carry I-2/I-3/I-4 (fs / path / gray-matter imports
 *   are licensed inside the adapter directory only).
 *
 * # Result types — discriminated unions per `ok: true|false`
 *
 * Following the v1 `src/write/write.ts:19–35` pattern: every write,
 * update, and delete returns a discriminated-union result so callers
 * branch on `.ok` before destructuring. The shape replaces v1's
 * `noteId: number` with `doc_id: DocId` per the new identity contract
 * (ADR-001).
 *
 * # Memory-sink guard (Phase 2 hook)
 *
 * Phase 2 (MEM-01..12) inserts the MemorySink guard at the entry of
 * `write()`. Concretely, Phase 2 adds:
 *
 *   - Guard A: provenance required. Every agent-authored write MUST
 *     carry source / client_id / created_at properties; missing
 *     provenance → `{ ok: false, reason: "permission_denied" }`.
 *   - Guard B: source:agent outside sink rejected. If `source: "agent"`
 *     and the resolved path is NOT under a configured `MemorySink`,
 *     reject the write.
 *
 * Phase 1 implementations have ONLY the existing `write_enabled` flag +
 * `safeJoinInsideVault` path safety (per v1 `src/write/write.ts`). The
 * interface SHAPE deliberately permits Phase 2's guard insertion without
 * a signature change — the `Document` properties carry provenance, and
 * the adapter inspects `properties.source` / `properties.client_id`
 * inside `write()` before touching the backing store.
 *
 * # Failure semantics
 *
 * - Hash mismatch → `{ ok: false, reason: "hash_mismatch" }`. Caller
 *   re-reads, re-merges, retries. `currentHash` carries the current
 *   on-store hash so the caller can compute a sensible conflict-resolved
 *   write.
 * - Permission denied → `{ ok: false, reason: "permission_denied" }`.
 *   Vault config `write_enabled: false`, MemorySink guard failure
 *   (Phase 2), or remote-API auth failure.
 * - Not found → `{ ok: false, reason: "not_found" }`. Update/delete
 *   against a non-existent DocId.
 */

import type { DocId, Document, MemorySinkHandle, SourceHandle } from "../../types.js";
import type { HashProtected, NamingMode } from "../capabilities.js";

/**
 * Successful write. `doc_id` replaces v1's `noteId: number` per the
 * branded-DocId identity contract.
 */
export interface WriteSuccess {
  ok: true;
  /** Post-write content hash, opaque to callers. */
  newHash: string;
  /** DocId of the written document (caller-provided or adapter-assigned). */
  doc_id: DocId;
  /** True iff a brand-new document was created (false on overwrite). */
  created: boolean;
}

/**
 * Failed write. `reason` discriminates: hash mismatch (OCC), permission
 * denied (write_enabled / sink guard / remote auth), or not found
 * (update/delete against an unknown DocId).
 */
export interface WriteConflict {
  ok: false;
  reason: "hash_mismatch" | "permission_denied" | "not_found";
  /** Current on-store hash (when known); helps callers re-merge. */
  currentHash?: string;
  /** Human-readable diagnostic. */
  message?: string;
}

/** Discriminated write result. Branch on `.ok` before destructuring. */
export type WriteResult = WriteSuccess | WriteConflict;

/** Update result mirrors WriteResult; `created` is always `false`. */
export interface UpdateSuccess {
  ok: true;
  newHash: string;
  doc_id: DocId;
}

export type UpdateResult = UpdateSuccess | WriteConflict;

/** Delete result. */
export interface DeleteSuccess {
  ok: true;
  doc_id: DocId;
}

export type DeleteResult = DeleteSuccess | WriteConflict;

/**
 * Options accepted by write / update / delete. ADR-002 §WriteOptions.
 *
 * `expectedHash` is the OCC token: when set, the adapter MUST refuse to
 * write if the on-store hash differs.
 *
 * `clientId` is the audit-log attribution — defaults at the adapter
 * constructor level (D-02: bound from MCP `client_info` at server
 * bootstrap, falling back to `"unknown"`).
 *
 * `dryRun` causes the adapter to validate inputs (path safety, sink
 * guard, OCC) without performing the write. Returns the same shape as
 * a successful write would.
 */
export interface WriteOptions {
  /** OCC token — refuse write if on-store hash differs. */
  expectedHash?: string;
  /** Audit-log attribution; defaults at constructor level (D-02). */
  clientId?: string;
  /** Validate but do not perform the write. */
  dryRun?: boolean;
  /**
   * Optional MemorySink handle (Phase 2). When set, the adapter routes
   * the write under the named sink and the MemorySink guard checks
   * apply. Phase 1 implementations may ignore this field; the type
   * surface is published now so Plan 01-04 can wire it.
   */
  sink?: MemorySinkHandle;
}

/**
 * Published capability descriptor for a DeliveryAdapter. ADR-002 lines
 * 202–209 + Adversarial Finding 10. The conformance suite asserts every
 * field against observed behavior (Invariant I-7).
 */
export interface DeliveryCapabilities {
  /** Writes are atomic (no partial-write visibility). */
  atomic: boolean;
  /** Hash protection tier; gates `expectedHash` OCC semantics. */
  hashProtected: HashProtected;
  /** Schema is enforced server-side (Notion typed properties yes; obsidian-fs no). */
  enforcedSchema: boolean;
  /** DocId naming mode. */
  naming: NamingMode;
}

/**
 * The write seam. Phase 1: `ObsidianFsDelivery` (reference) +
 * `StubDelivery` (conformance fixture). Phase 2 layers the MemorySink
 * guards on top of `write()` per the file header.
 */
export interface DeliveryAdapter {
  /** The adapter handle that names this delivery in the registry. */
  readonly handle: SourceHandle;
  /** Published capability descriptor. Honest per Invariant I-7. */
  readonly capabilities: DeliveryCapabilities;

  /**
   * Create or overwrite a document.
   *
   * Phase 1: enforces `write_enabled` flag + `safeJoinInsideVault` path
   * safety (obsidian-fs) + OCC via `opts.expectedHash` (when
   * `capabilities.hashProtected !== "none"`).
   *
   * Phase 2 ADDS: MemorySink guard at entry — provenance required
   * (Guard A) + source:agent-outside-sink rejected (Guard B). The
   * interface signature does NOT change in Phase 2; the guard is
   * implemented inside the adapter, reading `doc.properties` to detect
   * provenance.
   */
  write(id: DocId, doc: Partial<Document>, opts?: WriteOptions): Promise<WriteResult>;

  /**
   * Partial update — patch `doc.properties` and/or `doc.blocks` against
   * an existing document. The `patch` shape is `Partial<Document>`;
   * fields not supplied are preserved on the backing store.
   *
   * MUST return `{ ok: false, reason: "not_found" }` if the document
   * does not exist (no implicit create).
   */
  update(id: DocId, patch: Partial<Document>, opts?: WriteOptions): Promise<UpdateResult>;

  /**
   * Remove a document. `opts.expectedHash` is REQUIRED for adapters
   * with `hashProtected !== "none"` (matches v1 `deleteNote` shape).
   */
  delete(id: DocId, opts?: WriteOptions): Promise<DeleteResult>;
}
