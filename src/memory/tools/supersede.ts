/**
 * `handleSupersede` — the MEM-04 controller.
 *
 * Marks an existing memory document as superseded by a replacement
 * document. Forward-only per D-03: this controller writes
 * `status: "superseded"`, `superseded_by: <replacement_doc_id>`, and
 * `superseded_reason: <reason>` on the OLD doc ONLY — the replacement
 * is never touched. Back-link materialization is deferred to the
 * Phase 4 graph layer (it can be derived from a single property scan).
 *
 * Single OCC `delivery.update()` call. The OLD doc's read-side hash
 * (`Document.hash`) is fetched via `SourceConnector.readDocument` and
 * passed as `opts.expectedHash` so concurrent edits surface as a
 * `hash_mismatch` WriteConflict — returned UNCHANGED.
 *
 * The controller is pure: no `node:fs`, no `node:path`, no
 * `gray-matter`, no `chokidar`. The DocId parsing chain
 * (`parseDocId` / `decomposeDocId`) lives in `src/adapters/registry.ts`.
 */

import type {
  DeliveryAdapter,
  UpdateResult,
} from "../../adapters/delivery/types.js";
import type { SourceConnector } from "../../adapters/source/types.js";
import { decomposeDocId, parseDocId } from "../../adapters/registry.js";
import type { Document } from "../../types.js";
import type { VaultManager } from "../../vault/index.js";
import type { MemorySinkRegistry } from "../registry.js";

export interface SupersedeDeps {
  memorySinkRegistry: MemorySinkRegistry;
  manager: VaultManager;
  deliveryAdapterFor: (vaultName: string) => DeliveryAdapter;
  /** Reads the OLD doc's current hash via `connector.readDocument(id)`. */
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

export interface SupersedeArgs {
  /** DocId of the document being superseded. */
  doc_id: string;
  /** DocId of the replacement document. */
  replacement_doc_id: string;
  /** Non-empty rationale; written to `superseded_reason` on the OLD doc. */
  reason: string;
}

/**
 * Mark the OLD doc as superseded. See file header for D-03 semantics.
 * Returns the `UpdateResult` from the delivery adapter UNCHANGED —
 * `newHash` is the post-update hash; never re-shaped to `hash`.
 */
export async function handleSupersede(
  deps: SupersedeDeps,
  args: SupersedeArgs,
): Promise<UpdateResult> {
  // Parse both DocIds at the controller boundary so malformed values
  // surface as helpful diagnostics. The replacement DocId is parsed
  // for validation only — we never dereference it (D-03).
  const oldId = parseDocId(args.doc_id);
  parseDocId(args.replacement_doc_id);

  // Identify the OLD doc's owning vault from its authority component.
  const { authority: vaultName } = decomposeDocId(oldId);

  // Confirm OLD doc lives inside a memory sink. Supersede applies only
  // to memory documents; user notes are immutable from the agent's
  // perspective per the Phase 2 safety invariant.
  const sink = deps.memorySinkRegistry.findSinkContaining(oldId);
  if (sink === null) {
    throw new Error(
      `supersede() target ${oldId} is not inside any configured MemorySink; ` +
        `supersede applies to memory documents only.`,
    );
  }

  // Fetch the OLD doc's current Document.hash via the read-side seam.
  // This is the canonical content hash (distinct from
  // WriteSuccess.newHash) that the OCC contract consumes. We also use
  // the read result to merge the supersede triple onto the OLD doc's
  // existing property bag — the delivery chokepoint validator runs the
  // contract schema against the PATCH ALONE (per Plan 02-03's
  // conformance test 17: "update() routes through the SAME validator
  // (missing observed_at refused)"), so a minimal patch like
  // `{status, superseded_by, superseded_reason}` would falsely fail
  // missing_provenance on `source`/`observed_at`/etc. We therefore
  // hand the delivery a "full" patch — existing props with the three
  // supersede keys layered on top — so the on-disk frontmatter
  // semantics are unchanged (the delivery itself ALSO shallow-merges
  // with disk before writing, so this is idempotent), and the
  // validator's standalone schema check passes.
  const source = deps.sourceConnectorFor(vaultName);
  const oldDoc = await source.readDocument(oldId);

  // Strip the adapter-injected `wikilinks` array (D-05): obsidian-fs
  // surfaces wikilinks via `Document.properties.wikilinks` when
  // reading, but the field is never written back into frontmatter.
  // The delivery's `stripWikilinks` runs the same trim later, but
  // keeping the patch clean avoids a no-op diff in the merged set.
  const {
    wikilinks: _w,
    ...existingProps
  } = oldDoc.properties as { wikilinks?: unknown } & Record<string, unknown>;

  // Forward-only — writes ONLY on the OLD doc. The replacement doc is
  // never touched (D-03; back-link materialization is the Phase 4
  // graph layer's responsibility).
  const patch: Partial<Document> = {
    properties: {
      ...existingProps,
      status: "superseded",
      superseded_by: args.replacement_doc_id,
      superseded_reason: args.reason,
    },
  };

  return await deps.deliveryAdapterFor(vaultName).update(oldId, patch, {
    expectedHash: oldDoc.hash,
    sink: sink.handle,
  });
}
