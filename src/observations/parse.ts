export interface ObservationDraft {
  category: string;
  text: string;
  line_start: number;
  line_end: number;
}
export function parseObservations(body: string): ObservationDraft[] {
  const rows: ObservationDraft[] = [];
  let active: { draft: ObservationDraft; indent: number } | undefined;
  const listIndents: number[] = [];
  let fence: { char: string; length: number } | undefined;
  const lines = body.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const fenceIndent = /^ */.exec(line)![0].length;
    const marker = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[2]![0] === fence.char &&
        marker[2]!.length >= fence.length &&
        !marker[3]!.trim()
      )
        fence = undefined;
      continue;
    }
    if (
      marker &&
      (fenceIndent <= 3 || listIndents.some((level) => level < fenceIndent)) &&
      !(marker[2]![0] === "`" && marker[3]!.includes("`"))
    ) {
      fence = { char: marker[2]![0]!, length: marker[2]!.length };
      active = undefined;
      continue;
    }
    const bullet = /^( *)([-*+])[\t ]+(.*)$/.exec(line);
    if (bullet) {
      const indent = bullet[1]!.length;
      active = undefined;
      // Four spaces alone denote code, unless a shallower list item
      // establishes the nesting context.
      if (indent > 3 && !listIndents.some((level) => level < indent)) continue;
      while (listIndents.length && listIndents.at(-1)! >= indent) listIndents.pop();
      listIndents.push(indent);
      const tagged = /^\[([a-z][a-z0-9_-]*)\][\t ]+(.+)$/.exec(bullet[3]!);
      if (!tagged || tagged[1] === "x" || !tagged[2]!.trim()) continue;
      const draft = {
        category: tagged[1]!,
        text: tagged[2]!.trim(),
        line_start: index + 1,
        line_end: index + 1,
      };
      rows.push(draft);
      active = { draft, indent };
      continue;
    }
    const indent = /^ */.exec(line)![0].length;
    if (line.trim() && active && indent > active.indent) {
      active.draft.text += "\n" + line.trim();
      active.draft.line_end = index + 1;
    } else {
      active = undefined;
      if (line.trim() && indent === 0) listIndents.length = 0;
    }
  }
  return rows;
}
