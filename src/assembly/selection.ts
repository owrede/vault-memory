import type { CitationPacket } from "../memory/citation-packet.js";
import type { Document } from "../types.js";
import { toCitationPacket } from "../memory/citation-packet.js";
import { sectionRanges } from "../sections/ranges.js";
import { projectContext } from "./projection.js";
export interface ProjectionArgs {
  include_observations?: boolean;
  projection?: "full" | "metadata" | "sections";
  max_chars?: number;
  heading_paths?: string[][];
}
export interface ContextSlice extends CitationPacket {
  text: string;
  truncated: boolean;
  original_chars: number;
  start_offset: number;
  end_offset: number;
  line_start: number;
  line_end: number;
}
export interface ContextSelection {
  projection: "full" | "metadata" | "sections";
  budget_limit: number;
  budget_used: number;
  truncated: boolean;
  slices: ContextSlice[];
  excluded: { doc_id: string; heading_path: string[]; reason: "budget_exhausted" }[];
}
export class ProjectionError extends Error {
  constructor(
    public readonly code: string,
    public readonly heading_path?: string[],
  ) {
    super(code);
  }
}
export const DEFAULT_CONTEXT_CHARS = 6000;
export function validateProjection(args: ProjectionArgs): void {
  if (
    args.projection !== undefined &&
    !["full", "metadata", "sections"].includes(args.projection)
  ) {
    throw new ProjectionError("invalid_projection");
  }
  if (
    args.max_chars !== undefined &&
    (!Number.isSafeInteger(args.max_chars) || args.max_chars < 0)
  ) {
    throw new ProjectionError("invalid_projection");
  }
  if (
    args.projection === "sections" &&
    (!args.heading_paths?.length ||
      args.heading_paths.some(
        (path) => !path.length || path.some((part) => typeof part !== "string" || !part.length),
      ))
  ) {
    throw new ProjectionError("invalid_projection");
  }
}
export function contextSelection(args: ProjectionArgs): ContextSelection | undefined {
  validateProjection(args);
  if ((args.projection === undefined || args.projection === "full") && args.max_chars === undefined)
    return undefined;
  return {
    projection: args.projection ?? "full",
    budget_limit: args.projection === "metadata" ? 0 : (args.max_chars ?? DEFAULT_CONTEXT_CHARS),
    budget_used: 0,
    truncated: false,
    slices: [],
    excluded: [],
  };
}
export function takeContext(context: ContextSelection, text: string) {
  const result = projectContext(text, context.budget_limit - context.budget_used);
  context.budget_used += result.text.length;
  context.truncated ||= result.truncated;
  return result;
}
export function sameHeading(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}
export function documentContext(
  doc: Document,
  url: string,
  args: ProjectionArgs,
): ContextSelection | undefined {
  const context = contextSelection(args);
  if (!context || context.projection !== "sections") return context;
  if (doc.blocks.some((block) => block.kind !== "paragraph"))
    throw new ProjectionError("invalid_projection");
  const body = doc.blocks
    .map((block) => (block.kind === "paragraph" ? block.text : ""))
    .join("\n\n");
  const ranges = sectionRanges(body);
  const seen = new Set<string>();
  for (const path of args.heading_paths!) {
    const key = JSON.stringify(path);
    if (seen.has(key)) continue;
    seen.add(key);
    const matches = ranges.filter((range) => sameHeading(range.heading_path, path));
    if (matches.length === 0) throw new ProjectionError("target_not_found", path);
    if (matches.length > 1) throw new ProjectionError("ambiguous_target", path);
    const range = matches[0]!;
    const text = body.slice(range.body_start, range.end);
    const excerpt = takeContext(context, text);
    if (!excerpt.text.length && text.length) {
      context.excluded.push({
        doc_id: doc.id,
        heading_path: [...path],
        reason: "budget_exhausted",
      });
      continue;
    }
    context.slices.push({
      ...toCitationPacket({ ...doc, heading_path: path }, url),
      ...excerpt,
      start_offset: range.body_start,
      end_offset: range.end,
      line_start: body.slice(0, range.body_start).split("\n").length,
      line_end: body
        .slice(0, Math.max(range.body_start, range.end - (text.endsWith("\n") ? 1 : 0)))
        .split("\n").length,
    });
  }
  return context;
}
