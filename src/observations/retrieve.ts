import type { Document } from "../types.js";
import type { ObservationRow } from "../db/queries/observations.js";
import { toCitationPacket, type CitationPacket } from "../memory/citation-packet.js";
import { sectionRanges } from "../sections/ranges.js";
import {
  sameHeading,
  takeContext,
  ProjectionError,
  type ContextSelection,
} from "../assembly/selection.js";
export interface ObservationIndex {
  doc_hash: string | null;
  rows: ObservationRow[];
}
export type CitedObservation = CitationPacket &
  ObservationRow & { truncated?: boolean; original_chars?: number };
export interface ObservationResult {
  state: "fresh" | "stale" | "unindexed";
  doc_hash: string | null;
  available_count: number;
  statements: CitedObservation[];
  excluded: { id: number; reason: "metadata_projection" | "budget_exhausted" }[];
}
export function retrieveObservations(
  doc: Document,
  url: string,
  index: ObservationIndex,
  context?: ContextSelection,
  headingPath: string[] = [],
  selectedPaths?: string[][],
): ObservationResult {
  const state =
    index.doc_hash === null ? "unindexed" : index.doc_hash === doc.hash ? "fresh" : "stale";
  const result: ObservationResult = {
    state,
    doc_hash: index.doc_hash,
    available_count: 0,
    statements: [],
    excluded: [],
  };
  if (state !== "fresh") return result;
  let rows = index.rows.filter((row) => row.doc_hash === doc.hash);
  const selectors = selectedPaths ?? (headingPath.length ? [headingPath] : undefined);
  if (selectors) {
    const body = doc.blocks
      .map((block) => (block.kind === "paragraph" ? block.text : ""))
      .join("\n\n");
    const ranges = sectionRanges(body);
    const selected = selectors.map((path) => {
      const matches = ranges.filter((range) => sameHeading(range.heading_path, path));
      if (!matches.length) throw new ProjectionError("target_not_found", path);
      if (matches.length > 1) throw new ProjectionError("ambiguous_target", path);
      const range = matches[0]!;
      return {
        startLine: body.slice(0, range.body_start).split("\n").length,
        endLine: body.slice(0, Math.max(range.body_start, range.end - 1)).split("\n").length,
      };
    });
    rows = rows.filter((row) =>
      selected.some((range) => row.line_start >= range.startLine && row.line_end <= range.endLine),
    );
  }
  result.available_count = rows.length;
  for (const row of rows) {
    if (context?.projection === "metadata") {
      result.excluded.push({ id: row.id, reason: "metadata_projection" });
      continue;
    }
    const excerpt = context ? takeContext(context, row.text) : undefined;
    if (excerpt && !excerpt.text.length && excerpt.original_chars) {
      result.excluded.push({ id: row.id, reason: "budget_exhausted" });
      context!.excluded.push({
        doc_id: doc.id,
        heading_path: [...headingPath],
        reason: "budget_exhausted",
      });
      continue;
    }
    result.statements.push({
      ...toCitationPacket({ ...doc, heading_path: headingPath }, url),
      ...row,
      ...(excerpt ?? {}),
    });
  }
  return result;
}
