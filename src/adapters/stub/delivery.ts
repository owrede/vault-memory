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
 */

import type {
  DeliveryAdapter,
  DeliveryCapabilities,
  WriteOptions,
  WriteResult,
  UpdateResult,
  DeleteResult,
} from "../delivery/types.js";
import type { Document, DocId, SourceHandle } from "../../types.js";
import { parseSourceHandle } from "../registry.js";

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

  constructor(private readonly docs: Map<DocId, Document>) {}

  async write(id: DocId, doc: Partial<Document>, _opts?: WriteOptions): Promise<WriteResult> {
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

  async update(id: DocId, patch: Partial<Document>, _opts?: WriteOptions): Promise<UpdateResult> {
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
    const existed = this.docs.delete(id);
    if (!existed) {
      return { ok: false, reason: "not_found", message: `Document not found: ${id}` };
    }
    return { ok: true, doc_id: id };
  }
}
