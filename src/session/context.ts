import type { Document, DocId } from "../types.js";
import type { CitationPacket } from "../memory/citation-packet.js";
export interface SessionContextArgs {
  topic: string;
  max_chars?: number;
  as_of?: string;
}
export interface SessionContextDeps {
  getBrief: (topic: string) => Promise<{ brief: Document | null; stale?: boolean }>;
  verify: (brief: Document) => Promise<{ stale: boolean; citations: CitationPacket[] }>;
  displayUrlFor: (id: DocId) => string;
  clock?: () => number;
}
import { resolveAsOf, parseValidity, isValidAt } from "../memory/valid-time.js";
import { projectContext } from "../assembly/projection.js";
import { inspectionBody } from "../schema/body.js";
import { toCitationPacket } from "../memory/citation-packet.js";
export async function buildSessionContext(
  args: SessionContextArgs,
  deps: SessionContextDeps,
): Promise<{ text: string; citations: CitationPacket[]; stale: boolean; truncated: boolean }> {
  if (!args.topic.trim()) throw new Error("topic must be nonempty");
  const asOf = resolveAsOf(args.as_of, deps.clock),
    limit = args.max_chars ?? 6000;
  projectContext("", limit);
  const result = await deps.getBrief(args.topic);
  if (!result.brief)
    return { text: "", citations: [], stale: result.stale ?? false, truncated: false };
  const verified = await deps.verify(result.brief);
  const validity = parseValidity(result.brief.properties);
  const stale =
    result.stale || verified.stale || !validity.ok || !isValidAt(validity.validity, asOf);
  const citations = [
    toCitationPacket(result.brief, deps.displayUrlFor(result.brief.id)),
    ...verified.citations,
  ];
  if (stale) return { text: "", citations, stale: true, truncated: false };
  const projected = projectContext(inspectionBody(result.brief.blocks).text, limit);
  return { text: projected.text, citations, stale: false, truncated: projected.truncated };
}
