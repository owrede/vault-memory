import { createHash } from "node:crypto";
import { parseDocId } from "../adapters/registry.js";
import { timestampMillis } from "../memory/valid-time.js";
export interface CheckpointInput {
  session_id: string;
  event_id: string;
  sink: string;
  summary: string;
  source_doc_ids: string[];
  observed_at: string;
}
export function checkpointKey(session: string, event: string): string {
  if (!session.trim() || !event.trim()) throw new Error("session_id and event_id must be nonempty");
  return createHash("sha256")
    .update(JSON.stringify([session, event]))
    .digest("hex");
}
export function checkpointProperties(input: CheckpointInput): Record<string, unknown> {
  if (
    !input.summary.trim() ||
    !input.sink.trim() ||
    !input.source_doc_ids.length ||
    timestampMillis(input.observed_at) === null
  )
    throw new Error("Invalid checkpoint summary, sink, evidence or observed_at");
  const ids = [...new Set(input.source_doc_ids.map(parseDocId))];
  return {
    source: "agent",
    confidence: "inferred",
    type: "summary",
    observed_at: input.observed_at,
    evidence: [...ids, `session:${input.session_id}`, `event:${input.event_id}`],
    checkpoint_key: checkpointKey(input.session_id, input.event_id),
    session_id: input.session_id,
    event_id: input.event_id,
  };
}
