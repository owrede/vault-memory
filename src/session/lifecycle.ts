import { inspectionBody } from "../schema/body.js";
import { createHash, randomUUID } from "node:crypto";
import {
  handleRecordObservation,
  type RecordObservationDeps,
} from "../memory/tools/record-observation.js";
import {
  decomposeDocId,
  parseDocId,
  parseSourceHandle,
  type AdapterRegistry,
} from "../adapters/registry.js";
import { checkpointProperties, type CheckpointInput } from "./checkpoint.js";
import { buildSessionContext, type SessionContextArgs } from "./context.js";
import { CheckpointQueries } from "../db/queries/checkpoints.js";
import { handleGetBrief } from "../brief/get.js";
import { decomposeChunkId, parseChunkId } from "../brief/chunk-id.js";
import { recomputeCurrentHash } from "../brief/source-hashes.js";
import { displayUrlFor, toCitationPacket, type CitationPacket } from "../memory/citation-packet.js";
import type { DocId } from "../types.js";
export interface SessionDeps extends RecordObservationDeps {
  adapterRegistry: AdapterRegistry;
}
function sourceFor(deps: SessionDeps, id: DocId) {
  const { scheme, authority } = decomposeDocId(id);
  return deps.adapterRegistry.resolveSource(parseSourceHandle(`${scheme}://${authority}`));
}
export async function recordCheckpoint(input: CheckpointInput, deps: SessionDeps) {
  const props = checkpointProperties(input);
  const sink = deps.memorySinkRegistry.resolveMemorySink(input.sink),
    vault = deps.manager.require(sink.vault);
  const key = props.checkpoint_key as string,
    payload = createHash("sha256")
      .update(JSON.stringify([input.summary, props.evidence, input.observed_at]))
      .digest("hex");
  const owner = randomUUID(),
    store = new CheckpointQueries(vault.db.handle);
  const reservation = store.acquire(sink.handle, key, payload, owner);
  if (reservation === "busy" || reservation === "mismatch")
    return {
      ok: false as const,
      reason: reservation === "busy" ? "checkpoint_in_progress" : "checkpoint_mismatch",
    };
  try {
    const source = deps.sourceConnectorFor(sink.vault),
      matches = [];
    for await (const ref of source.listDocuments()) {
      if (!decomposeDocId(ref.id).resource.startsWith(sink.resolveToRelativePath)) continue;
      const doc = await source.readDocument(ref.id);
      if (doc.properties.checkpoint_key === key) matches.push(doc);
    }
    if (matches.length > 1) throw new Error("Ambiguous canonical checkpoint");
    if (matches.length === 1) {
      const doc = matches[0]!;
      if (
        doc.properties.checkpoint_payload_hash !== payload ||
        doc.properties.source !== "agent" ||
        doc.properties.confidence !== "inferred" ||
        doc.properties.type !== "summary" ||
        inspectionBody(doc.blocks).text.trimEnd() !== input.summary.trimEnd() ||
        JSON.stringify(doc.properties.evidence) !== JSON.stringify(props.evidence) ||
        doc.properties.observed_at !== input.observed_at
      )
        return { ok: false as const, reason: "checkpoint_mismatch" };
      if (reservation === "acquired") store.complete(sink.handle, key, owner, doc.id);
      return { ok: true as const, doc_id: doc.id, newHash: doc.hash, reused: true };
    }
    if (reservation === "complete") return { ok: false as const, reason: "checkpoint_missing" };
    const citations: CitationPacket[] = [];
    for (const raw of input.source_doc_ids) {
      const id = parseDocId(raw),
        connector = sourceFor(deps, id);
      const doc = await connector.readDocument(id);
      citations.push(toCitationPacket(doc, displayUrlFor(id, connector)));
    }
    const result = await handleRecordObservation(deps, {
      vault: sink.vault,
      sink: sink.handle,
      claim: input.summary,
      evidence: props.evidence as string[],
      confidence: "inferred",
      type: "summary",
      observed_at: input.observed_at,
      properties: {
        ...props,
        checkpoint_payload_hash: payload,
        checkpoint_sources: citations.map((c) => ({ doc_id: c.doc_id, hash: c.hash })),
      },
    });
    if (result.ok) store.complete(sink.handle, key, owner, result.doc_id);
    return result;
  } finally {
    if (reservation === "acquired") store.release(sink.handle, key, owner);
  }
}
export async function startSession(
  args: SessionContextArgs & { vault: string; sink?: string },
  deps: SessionDeps,
) {
  return buildSessionContext(args, {
    getBrief: async (topic) =>
      handleGetBrief(deps, {
        vault: args.vault,
        target: topic,
        sink: args.sink,
        allow_stale: true,
      }),
    displayUrlFor: (id) => displayUrlFor(id, sourceFor(deps, id)),
    verify: async (brief) => {
      const hashes = brief.properties.source_hashes;
      if (
        !hashes ||
        typeof hashes !== "object" ||
        Array.isArray(hashes) ||
        Object.keys(hashes).length === 0
      )
        return { stale: true, citations: [] };
      const citations = new Map<DocId, CitationPacket>();
      let stale = false;
      for (const [raw, hash] of Object.entries(hashes)) {
        try {
          const { docId, fragment } = decomposeChunkId(parseChunkId(raw)),
            connector = sourceFor(deps, docId),
            doc = await connector.readDocument(docId);
          citations.set(docId, toCitationPacket(doc, displayUrlFor(docId, connector)));
          const d = decomposeDocId(docId),
            vault = deps.manager.require(d.authority),
            note = vault.db.notes.getByPath(d.resource);
          if (!note || note.hash !== doc.hash || !note.body_hash) {
            stale = true;
            continue;
          }
          const chunk = vault.db.chunks
            .getByNote(note.id)
            .find((c) => c.chunk_id_fragment === fragment);
          if (!chunk || recomputeCurrentHash(chunk.text) !== hash) stale = true;
        } catch {
          stale = true;
        }
      }
      return { stale, citations: [...citations.values()] };
    },
  });
}
