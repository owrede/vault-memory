/** Shared source-line scanner for explicit list data and ATX sections. */
export interface MarkdownLine {
  text: string;
  line: number;
  offset: number;
  code: boolean;
  bullet?: { indent: number; contentIndent: number; text: string };
}
export function markdownLines(body: string): MarkdownLine[] {
  const result: MarkdownLine[] = [];
  const lists: { indent: number; contentIndent: number }[] = [];
  let fence: { char: string; length: number; base: number } | undefined;
  let offset = 0;
  let paragraphOpen = false;
  for (const [index, raw] of body.split("\n").entries()) {
    const text = raw.replace(/\r$/, "");
    const row: MarkdownLine = { text, line: index + 1, offset, code: false };
    offset += raw.length + 1;
    result.push(row);
    const indent = /^ */.exec(text)![0].length;
    if (!text.trim()) paragraphOpen = false;
    const marker = /^( *)(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence && fence.base > 0 && text.trim() && indent < fence.base) fence = undefined;
    if (fence) {
      row.code = true;
      paragraphOpen = false;
      if (
        marker &&
        indent >= fence.base &&
        indent <= fence.base + 3 &&
        marker[2]![0] === fence.char &&
        marker[2]!.length >= fence.length &&
        !marker[3]!.trim()
      )
        fence = undefined;
      continue;
    }
    const bullet = /^( *)([-*+])[\t ]+(.*)$/.exec(text);
    const container = lists.findLast((level) => level.contentIndent <= indent);
    const base = container?.contentIndent ?? 0;
    const validBullet = bullet && (indent <= 3 || (container && indent - base <= 3));
    const inline = validBullet && /^(`{3,}|~{3,})(.*)$/.exec(bullet[3]!);
    if (inline && !(inline[1]![0] === "`" && inline[2]!.includes("`"))) {
      fence = {
        char: inline[1]![0]!,
        length: inline[1]!.length,
        base: text.length - bullet[3]!.length,
      };
      row.code = true;
      paragraphOpen = false;
      continue;
    }
    if (marker && indent - base <= 3 && !(marker[2]![0] === "`" && marker[3]!.includes("`"))) {
      fence = { char: marker[2]![0]!, length: marker[2]!.length, base };
      row.code = true;
      paragraphOpen = false;
      continue;
    }
    if (bullet) {
      if (!validBullet) {
        row.code = !paragraphOpen;
        continue;
      }
      while (lists.length && lists.at(-1)!.indent >= indent) lists.pop();
      row.bullet = { indent, contentIndent: text.length - bullet[3]!.length, text: bullet[3]! };
      lists.push(row.bullet);
      paragraphOpen = true;
    } else if (text.trim() && indent === 0) {
      lists.length = 0;
      paragraphOpen = !/^#{1,6}(?:\s|$)/.test(text);
    } else if (text.trim() && indent - base >= 4 && !paragraphOpen) {
      row.code = true;
    }
  }
  return result;
}
export interface MarkdownListItem {
  text: string;
  line_start: number;
  line_end: number;
}
export function parseListItems(body: string): MarkdownListItem[] {
  const rows: MarkdownListItem[] = [];
  let active: { item: MarkdownListItem; indent: number } | undefined;
  for (const row of markdownLines(body)) {
    if (row.code) {
      active = undefined;
      continue;
    }
    if (row.bullet) {
      const item = { text: row.bullet.text.trim(), line_start: row.line, line_end: row.line };
      rows.push(item);
      active = { item, indent: row.bullet.indent };
    } else if (row.text.trim() && active && /^ */.exec(row.text)![0].length > active.indent) {
      active.item.text += "\n" + row.text.trim();
      active.item.line_end = row.line;
    } else active = undefined;
  }
  return rows;
}
