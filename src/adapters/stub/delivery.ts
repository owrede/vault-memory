/**
 * StubDelivery — in-memory DeliveryAdapter for the conformance suite.
 *
 * Backed by `Map<DocId, Document>` — the same map can be shared with a
 * `StubSource` so writes are observable via `source.readDocument` /
 * `source.exists`. This is the "shared-Map" pattern from plan 01-04
 * task 03 (plan-checker W2 — preferred over indirect created-flag
 * assertions for delete observability).
 *
 * Capabilities published HONESTLY per Invariant I-7:
 *   - atomic:         true   (JS event loop = single-step)
 *   - hashProtected:  none   (NO OCC — expectedHash is ignored)
 *   - enforcedSchema: false  (untyped properties, like obsidian-fs)
 *   - naming:         caller-provided
 *
 * No filesystem, no gray-matter, no path joining — by design.
 *
 * Plan 02-06 note: the audit log is DB-backed (`AuditQueries.recordWrite`,
 * see `src/db/queries/audit.ts`) and StubDelivery is in-memory only —
 * it does not record audit rows, so the `is_memory_sink_write` flag
 * (migration 009) has nothing to stamp here. The flag-derivation is
 * tested through `ObsidianFsDelivery` end-to-end.
 */

import type {
  DeliveryAdapter,
  DeliveryCapabilities,
  WriteOptions,
  WriteResult,
  UpdateResult,
  DeleteResult,
} from "../delivery/types.js";
import type { Document, DocId, MemorySink, SourceHandle } from "../../types.js";
import { parseSourceHandle } from "../registry.js";
import { validateAgentWrite } from "../../memory/validator.js";
import { getContract } from "../../memory/contract/index.js";
import type { MemorySinkRegistry } from "../../memory/registry.js";

function fnv1a(s: string): string {
  // Tiny deterministic hash so write/update results carry a stable
  // `newHash` field. Not cryptographic — adequate for in-memory tests.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function computeStubHash(doc: Document): string {
  // Stable over the canonical fields the conformance test cares about.
  const canon = JSON.stringify({
    blocks: doc.blocks,
    properties: doc.properties,
  });
  return fnv1a(canon);
}

export class StubDelivery implements DeliveryAdapter {
  readonly handle: SourceHandle = parseSourceHandle("stub://memory");

  readonly capabilities: DeliveryCapabilities = {
    atomic: true,
    hashProtected: "none",
    enforcedSchema: false,
    naming: "caller-provided",
  };

  /**
   * @param docs Shared `Map<DocId, Document>` backing this delivery.
   * @param memorySinkRegistry Optional Phase 2 sink registry. When supplied,
   *  the adapter runs Guards A/B at the entry of `write` / `update` /
   *  `delete` for conformance parity with `ObsidianFsDelivery`. Sentinel
   *  checks are filesystem-specific and omitted here by design.
   *  When omitted (Phase 1 fixture tests + back-compat), the validator
   *  is silently skipped.
   */
  constructor(
    private readonly docs: Map<DocId, Document>,
    private readonly memorySinkRegistry?: MemorySinkRegistry,
  ) {}

  /** Resolve `opts.sink` (if any) or path-based enclosure; null on miss. */
  private resolveTargetSink(id: DocId, opts?: WriteOptions): MemorySink | null {
    const registry = this.memorySinkRegistry;
    if (!registry) return null;
    if (opts?.sink !== undefined) {
      try {
        return registry.resolveMemorySink(opts.sink);
      } catch {
        // Fall through to path-based lookup.
      }
    }
    return registry.findSinkContaining(id);
  }

  /**
   * Run Guards A/B for a write or update. Returns the conflict to
   * short-circuit on, or `null` to proceed. No sentinel check (no FS).
   */
  private preflight(id: DocId, doc: Partial<Document>, opts?: WriteOptions): WriteResult | null {
    if (!this.memorySinkRegistry) return null;
    const sink = this.resolveTargetSink(id, opts);
    const contract = sink ? getContract(sink.contractName) : null;
    return validateAgentWrite(id, doc, sink, contract);
  }

  async write(id: DocId, doc: Partial<Document>, opts?: WriteOptions): Promise<WriteResult> {
    const guard = this.preflight(id, doc, opts);
    if (guard) return guard;
    // hashProtected="none" ⇒ expectedHash is ignored by contract. The
    // conformance test gates this assertion on the capability descriptor.
    const created = !this.docs.has(id);
    const merged: Document = {
      id,
      source: this.handle,
      title: doc.title ?? "",
      blocks: doc.blocks ?? [],
      properties: { ...(this.docs.get(id)?.properties ?? {}), ...(doc.properties ?? {}) },
      links: doc.links ?? [],
      mtime: doc.mtime ?? Date.now(),
      hash: "",
    };
    merged.hash = computeStubHash(merged);
    this.docs.set(id, merged);
    return { ok: true, doc_id: id, newHash: merged.hash, created };
  }

  async update(id: DocId, patch: Partial<Document>, opts?: WriteOptions): Promise<UpdateResult> {
    const guard = this.preflight(id, patch, opts);
    if (guard) return guard;
    const existing = this.docs.get(id);
    if (!existing) {
      return { ok: false, reason: "not_found", message: `Document not found: ${id}` };
    }
    const next: Document = {
      ...existing,
      ...patch,
      id,
      source: this.handle,
      properties: { ...existing.properties, ...(patch.properties ?? {}) },
      hash: "",
    };
    next.hash = computeStubHash(next);
    this.docs.set(id, next);
    return { ok: true, doc_id: id, newHash: next.hash };
  }

  async delete(id: DocId, _opts?: WriteOptions): Promise<DeleteResult> {
    // Hard-deletion of memory documents is forbidden in v2.0.0
    // (parity with ObsidianFsDelivery; see Plan 02-03 RESEARCH Pitfall 5).
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
    const existed = this.docs.delete(id);
    if (!existed) {
      return { ok: false, reason: "not_found", message: `Document not found: ${id}` };
    }
    return { ok: true, doc_id: id };
  }
}
