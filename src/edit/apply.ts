import type { SourceConnector } from "../adapters/source/types.js";
import type { DeliveryAdapter, UpdateResult } from "../adapters/delivery/types.js";
import type { DocId } from "../types.js";
import { patchBody, type TextPatch, type PatchResult } from "./patch.js";

export interface EditDeps {
  source: SourceConnector;
  delivery: DeliveryAdapter;
  onBeforeWrite?: () => void;
}
export interface EditArgs {
  doc_id: DocId;
  expected_hash: string;
  patch: TextPatch;
}
export async function applyDocumentPatch(
  deps: EditDeps,
  args: EditArgs,
): Promise<UpdateResult | Extract<PatchResult, { ok: false }>> {
  if (!(await deps.source.exists(args.doc_id))) return { ok: false, reason: "not_found" };
  const original = await deps.source.readDocument(args.doc_id);
  if (original.hash !== args.expected_hash) {
    return { ok: false, reason: "hash_mismatch", currentHash: original.hash };
  }
  if (original.blocks.some((block) => block.kind !== "paragraph")) {
    return { ok: false, reason: "invalid_patch" };
  }
  const body = original.blocks
    .map((block) => (block.kind === "paragraph" ? block.text : ""))
    .join("\n\n");
  const patched = patchBody(body, args.patch);
  if (!patched.ok) return patched;
  const { wikilinks: _links, ...properties } = original.properties;
  return deps.delivery.update(
    args.doc_id,
    {
      blocks: [{ kind: "paragraph", text: patched.body }],
      properties,
    },
    { expectedHash: args.expected_hash, skipUnchanged: true, onBeforeWrite: deps.onBeforeWrite },
  );
}
