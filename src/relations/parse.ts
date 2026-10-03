import { parseListItems } from "../markdown/list-items.js";
import { sectionRanges } from "../sections/ranges.js";
export interface DomainRelation {
  rel: string;
  target: string;
  line: number;
}
/** Roles are declared only by complete list items under a Relations heading. */
export function parseDomainRelations(body: string): DomainRelation[] {
  const ranges = sectionRanges(body)
    .filter((range) => range.heading_path.at(-1) === "Relations")
    .map((range) => ({
      start: body.slice(0, range.body_start).split("\n").length,
      end: body.slice(0, Math.max(range.body_start, range.end - 1)).split("\n").length,
    }));
  return parseListItems(body).flatMap((item) => {
    if (!ranges.some((range) => item.line_start >= range.start && item.line_end <= range.end))
      return [];
    const match = /^([a-z][a-z0-9_]*) \[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(item.text);
    if (!match || !match[2]!.trim()) return [];
    return [{ rel: match[1]!, target: match[2]!.trim(), line: item.line_start }];
  });
}
