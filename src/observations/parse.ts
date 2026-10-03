import { parseListItems } from "../markdown/list-items.js";
export interface ObservationDraft {
  category: string;
  text: string;
  line_start: number;
  line_end: number;
}
export function parseObservations(body: string): ObservationDraft[] {
  return parseListItems(body).flatMap((item) => {
    const tagged = /^\[([a-z][a-z0-9_-]*)\][\t ]+([\s\S]+)$/.exec(item.text);
    if (!tagged || tagged[1] === "x" || !tagged[2]!.trim()) return [];
    return [
      {
        category: tagged[1]!,
        text: tagged[2]!.trim(),
        line_start: item.line_start,
        line_end: item.line_end,
      },
    ];
  });
}
