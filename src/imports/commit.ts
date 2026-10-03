import { z } from "zod";
import type { Document, DocId } from "../types.js";
import type { SessionDeps } from "../session/lifecycle.js";
import { decomposeDocId, parseDocId, parseSourceHandle } from "../adapters/registry.js";
import {
  ConversationSchema,
  ImportError,
  type Conversation,
  renderConversation,
} from "./conversation.js";
import { previewImport, contentHash } from "./preview.js";
import { timestampMillis } from "../memory/valid-time.js";
import { inspectionBody } from "../schema/body.js";
export type ImportDeps = SessionDeps;
const PreviewSchema = z
  .object({
    source_id: z.string(),
    content: z.string(),
    hash: z.string(),
    target: z.string(),
    conversation: ConversationSchema,
  })
  .strict();
export const ImportManifestSchema = z
  .object({
    schema_version: z.literal(1),
    imported_at: z.string().refine((v) => timestampMillis(v) !== null),
    items: z.array(PreviewSchema).min(1).max(10000),
    expected_hashes: z.record(z.string(), z.string().min(1).nullable()),
  })
  .strict();
export const PreviewImportSchema = z
  .object({
    conversations: z.array(ConversationSchema).min(1),
    target: z.string().min(1),
    imported_at: z.string().refine((v) => timestampMillis(v) !== null),
  })
  .strict();
export type ImportManifest = z.infer<typeof ImportManifestSchema>;
export function importAdapters(id: DocId, deps: ImportDeps) {
  const d = decomposeDocId(id),
    handle = parseSourceHandle(`${d.scheme}://${d.authority}`);
  return {
    source: deps.adapterRegistry.resolveSource(handle),
    delivery: deps.adapterRegistry.resolveDelivery(handle),
  };
}
export function importedConversation(doc: Document): Conversation {
  const parsed = ConversationSchema.safeParse(doc.properties.import_conversation);
  if (doc.properties.source !== "imported" || !parsed.success)
    throw new ImportError(
      "invalid_conversation",
      "Source lacks a supported canonical imported conversation",
    );
  const rendered = renderConversation(parsed.data);
  const expected = previewImport([parsed.data], doc.id.slice(0, doc.id.lastIndexOf("/") + 1))[0]!;
  if (
    doc.properties.import_hash !== contentHash(rendered) ||
    inspectionBody(doc.blocks).text.trimEnd() !== rendered.trimEnd() ||
    doc.properties.import_source_id !== expected.source_id ||
    doc.id !== expected.target
  )
    throw new ImportError(
      "invalid_conversation",
      "Canonical conversation content or identity was modified; reimport with a fresh preview",
    );
  return parsed.data;
}
export async function prepareImport(
  conversations: Conversation[],
  target: string,
  imported_at: string,
  deps: ImportDeps,
): Promise<ImportManifest> {
  if (timestampMillis(imported_at) === null)
    throw new ImportError("invalid_manifest", "Invalid imported_at");
  const items = previewImport(conversations, target),
    expected_hashes: Record<string, string | null> = {};
  for (const item of items) {
    const id = parseDocId(item.target),
      { source } = importAdapters(id, deps);
    expected_hashes[id] = (await source.exists(id)) ? (await source.readDocument(id)).hash : null;
  }
  return { schema_version: 1, items, expected_hashes, imported_at };
}
export async function commitImport(preview: unknown, deps: ImportDeps) {
  const parsed = ImportManifestSchema.safeParse(preview);
  if (!parsed.success) throw new ImportError("invalid_manifest", "Invalid manifest structure");
  const manifest = parsed.data;
  const ids = manifest.items.map((i) => i.target);
  if (
    new Set(ids).size !== ids.length ||
    Object.keys(manifest.expected_hashes).length !== ids.length ||
    ids.some((id) => !(id in manifest.expected_hashes))
  )
    throw new ImportError("invalid_manifest", "Duplicate targets or missing source snapshots");
  const actions = [];
  for (const item of manifest.items) {
    const prefix = item.target.slice(0, item.target.lastIndexOf("/") + 1),
      expected = previewImport([item.conversation], prefix)[0]!;
    if (
      item.source_id !== expected.source_id ||
      item.content !== expected.content ||
      item.hash !== expected.hash ||
      item.target !== expected.target
    )
      throw new ImportError(
        "invalid_manifest",
        "Preview content, hash or destination differs from conversation",
      );
    const id = parseDocId(item.target);
    if (deps.memorySinkRegistry.findSinkContaining(id))
      return { ok: false as const, reason: "non_agent_write_inside_sink" };
    const { source, delivery } = importAdapters(id, deps),
      existing = (await source.exists(id)) ? await source.readDocument(id) : null;
    if (existing) {
      if (
        existing.properties.source !== "imported" ||
        existing.properties.import_source_id !== item.source_id
      )
        return { ok: false as const, reason: "import_identity_mismatch" };
      let intact = false;
      try {
        importedConversation(existing);
        intact = true;
      } catch {}
      if (intact && existing.properties.import_hash === item.hash) {
        actions.push({ item, id, delivery, existing, reused: true });
        continue;
      }
      if (manifest.expected_hashes[id] !== existing.hash)
        return {
          ok: false as const,
          reason: "hash_mismatch",
          doc_id: id,
          currentHash: existing.hash,
        };
    } else if (manifest.expected_hashes[id] !== null)
      return { ok: false as const, reason: "not_found", doc_id: id };
    actions.push({ item, id, delivery, existing, reused: false });
  }
  const results = [];
  for (const action of actions) {
    const { item, id, delivery, existing } = action;
    if (action.reused) {
      results.push({ ok: true as const, reused: true, doc_id: id, newHash: existing!.hash });
      continue;
    }
    const doc = {
      properties: {
        source: "imported",
        import_source_id: item.source_id,
        import_hash: item.hash,
        imported_at: existing?.properties.imported_at ?? manifest.imported_at,
        import_conversation: item.conversation,
      },
      blocks: [{ kind: "paragraph" as const, text: item.content }],
    };
    const result = existing
      ? await delivery.update(id, doc, { expectedHash: manifest.expected_hashes[id]! })
      : await delivery.write(id, doc);
    results.push(result);
    if (!result.ok) return { ...result, results };
  }
  return { ok: true as const, results };
}
