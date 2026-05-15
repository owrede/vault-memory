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
 * # Memory-sink guard (Phase 2 — wired at write/update/delete entry)
 *
 * Phase 2 (MEM-01..12) HAS wired the MemorySink guard chain at the
 * entry of `write()`, `update()`, and `delete()`. The chain is
 * implemented as a single chokepoint per ADR-002 §DeliveryAdapter and
 * runs in this order on every call:
 *
 *   1. Guard B (cheap; runs first): inspect `properties.source` against
 *      the target's sink-membership. `source: "agent"` outside any
 *      configured sink → `{ ok:false, reason:"agent_write_outside_sink" }`.
 *      `source: "user" | "imported"` INSIDE a configured sink →
 *      `{ ok:false, reason:"non_agent_write_inside_sink" }`.
 *   2. Sentinel check (obsidian-fs-only; not Stub): the sink-resolved
 *      folder MUST contain a `.memory-sink` file. Absence →
 *      `{ ok:false, reason:"sentinel_missing" }`. Fail-closed —
 *      never auto-create.
 *   3. Guard A (heavier): when the target lands inside a sink AND a
 *      `MemoryContract` is bound, run the contract's Zod
 *      `propertiesSchema.safeParse(doc.properties)`. Map the FIRST
 *      issue to one of: `missing_provenance` (required key undefined),
 *      `invalid_provenance` (enum/format/type mismatch),
 *      `supersede_mismatch` (cross-field rule on
 *      `superseded_by`/`superseded_reason`).
 *
 * The shared `WriteOptions.sink?: MemorySinkHandle` (declared in
 * Phase 1) is the canonical signal of a sink-targeted write across
 * `write` / `update` / `delete` — no separate options types needed for
 * symmetric guard application. The same validator runs at all three
 * entry points.
 *
 * `delete()` carries an ADDITIONAL refusal: any DocId whose path
 * resolves inside ANY registered sink (regardless of
 * `opts.sink`) returns `{ ok:false, reason:"sink_write_blocked" }` —
 * hard-deletion of memory documents is forbidden in v2.0.0. Use
 * `supersede` to retire memory documents.
 *
 * Implementation: `src/memory/validator.ts` exports
 * `validateAgentWrite(id, doc, sink, contract)` — pure function
 * returning a `GuardFailure | null`. Adapters call it at the very top
 * of write/update/delete, before any FS read or DB tx. The
 * `ObsidianFsDelivery` and `StubDelivery` adapters both wire the same
 * call (proven by the parameterized conformance test suite); the
 * sentinel check is filesystem-specific and stays inside the
 * obsidian-fs adapter directory.
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
 * Failed write. `reason` discriminates:
 *
 *   - Phase 1 codes: hash mismatch (OCC), permission denied
 *     (`write_enabled` / remote auth), or not found (update/delete
 *     against an unknown DocId).
 *   - Phase 2 codes (Guard A / B / sentinel / v1 entry-point refusals):
 *     `missing_provenance`, `invalid_provenance`, `supersede_mismatch`,
 *     `agent_write_outside_sink`, `non_agent_write_inside_sink`,
 *     `sentinel_missing`, `sink_write_blocked`.
 *   - Phase 2 gap-closure codes (added in Plan 02-13, wave 9):
 *     `collision_retry_exhausted` — emitted by `record_observation`
 *     when `MAX_COLLISION_RETRIES` is exhausted (WR-04 closure).
 *     Distinct from `permission_denied` (which means
 *     `write_enabled=false`) so callers can branch on a meaningful
 *     recovery path (vary the claim text or retry later).
 *     `sentinel_check_failed` — emitted by
 *     `ObsidianFsDelivery.preflight()` when `assertSentinelExists`
 *     throws with a non-ENOENT errno (EACCES, EIO, ENAMETOOLONG,
 *     EPERM). Distinct from `sentinel_missing` which is reserved for
 *     the literal not-existing case (WR-06 closure).
 *
 * The Phase 2 codes also populate up to four optional envelope fields:
 * `sinkName`, `key`, `observedValue`, `suggestion` — all additive, all
 * optional, all backwards-compatible with Phase 1 consumers that only
 * branched on `reason`.
 */
// Added in Plan 02-13; sentinel_check_failed is wired by Plan 02-10 in wave 10.
export interface WriteConflict {
  ok: false;
  reason:
    | "hash_mismatch"
    | "permission_denied"
    | "not_found"
    // Phase 2 — Guard A / B / sentinel / v1 entry-point refusals:
    | "missing_provenance"
    | "invalid_provenance"
    | "supersede_mismatch"
    | "agent_write_outside_sink"
    | "non_agent_write_inside_sink"
    | "sentinel_missing"
    | "sink_write_blocked"
    // Phase 2 gap-closure (Plan 02-13, wave 9):
    | "collision_retry_exhausted"
    | "sentinel_check_failed";
  /** Current on-store hash (when known); helps callers re-merge. */
  currentHash?: string;
  /** Human-readable diagnostic. */
  message?: string;
  // Phase 2 envelope (all optional, all additive):
  /** Name of the MemorySink involved in the refusal (Guard A/B/sentinel). */
  sinkName?: string;
  /** Property key that failed validation (Guard A). */
  key?: string;
  /** Observed value at `key` when known (Guard A invalid_provenance). */
  observedValue?: unknown;
  /** Actionable next-step hint for the caller. */
  suggestion?: string;
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
