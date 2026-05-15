/**
 * StubSource — in-memory SourceConnector for the conformance suite.
 *
 * Backed by `Map<DocId, Document>`. Capabilities are published HONESTLY
 * per Invariant I-7: `identityStable=true` (stub IDs never rename),
 * `permissions=false`, `contentHashStable=true`, `refHashKind="content"`,
 * `watch="push"`. `formatDisplayUrl` returns `null` — the stub has no
 * presentation URL.
 *
 * This adapter is the conformance PROOF for the SourceConnector contract.
 * The parameterized suite at `../source/conformance.test.ts` asserts the
 * same ADR-002 invariants (I-1..I-7) against both this adapter and
 * `ObsidianFsSource`.
 */

import type {
  DocumentRef,
  ListOptions,
  SourceCapabilities,
  SourceConnector,
} from "../source/types.js";
import type { Document, DocId, SourceHandle } from "../../types.js";
import { parseSourceHandle } from "../registry.js";

export class StubSource implements SourceConnector {
  /** Internal store. Exposed via `inner()` so a sibling `StubDelivery`
   *  can share the same Map for round-trip read-after-write tests
   *  (per plan 01-04 task 03 — plan-checker W2 shared-Map pattern). */
  private readonly docs: Map<DocId, Document>;

  readonly handle: SourceHandle = parseSourceHandle("stub://memory");

  readonly capabilities: SourceCapabilities = {
    bodyShape: "flat-text",
    properties: "untyped",
    linkTypes: [] as const,
    identityStable: true,
    permissions: false,
    contentHashStable: true,
    refHashKind: "content",
    watch: "push",
  };

  /**
   * Accepts either:
   *   - An array of Documents (legacy, seed-then-query).
   *   - An existing `Map<DocId, Document>` (Phase 1: shared with
   *     StubDelivery so writes are observable via Source reads).
   */
  constructor(initial: Document[] | Map<DocId, Document> = []) {
    this.docs = initial instanceof Map ? initial : new Map(initial.map((d) => [d.id, d]));
  }

  /** Escape hatch: the underlying store. Test-only — exposed so a
   *  sibling StubDelivery can mutate the same Map. Not part of the
   *  SourceConnector contract. */
  inner(): Map<DocId, Document> {
    return this.docs;
  }

  async *listDocuments(_opts?: ListOptions): AsyncIterable<DocumentRef> {
    for (const doc of this.docs.values()) {
      yield { id: doc.id, mtime: doc.mtime, hash: doc.hash };
    }
  }

  async readDocument(id: DocId): Promise<Document> {
    const doc = this.docs.get(id);
    if (!doc) throw new Error(`StubSource: not found: ${id}`);
    return doc;
  }

  async hash(id: DocId): Promise<string> {
    return this.docs.get(id)?.hash ?? "";
  }

  async exists(id: DocId): Promise<boolean> {
    return this.docs.has(id);
  }

  formatDisplayUrl(): string | null {
    return null;
  }
}
