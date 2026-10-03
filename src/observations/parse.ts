import { parseValidity, type Validity } from "../memory/valid-time.js";
import { parseListItems } from "../markdown/list-items.js";
export interface ObservationDraft {
  category: string;
  text: string;
  line_start: number;
  line_end: number;
  validity?: Validity;
  validity_error?: string;
}
export function parseObservations(body: string): ObservationDraft[] {
  return parseListItems(body).flatMap((item) => {
    const tagged = /^\[([a-z][a-z0-9_-]*)\][\t ]+([\s\S]+)$/.exec(item.text);
    if (!tagged || tagged[1] === "x" || !tagged[2]!.trim()) return [];
    let text = tagged[2]!.trim();
    let attributes: Pick<ObservationDraft, "validity" | "validity_error"> = {};
    const candidate = text.lastIndexOf("<!-- validity:");
    const suffix = text.slice(candidate);
    const closing = suffix.indexOf("-->");
    const marker =
      candidate >= 0 &&
      !inCodeSpan(text, candidate) &&
      (closing < 0 || !suffix.slice(closing + 3).trim())
        ? candidate
        : -1;
    if (marker >= 0) {
      const annotation = /^<!-- validity:\s*([\s\S]*?)\s*-->$/.exec(text.slice(marker));
      text = text.slice(0, marker).trim();
      try {
        const raw = annotation ? JSON.parse(annotation[1]!) : null;
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.keys(raw).some((key) => key !== "valid_from" && key !== "valid_to")
        )
          throw new Error();
        const parsed = parseValidity(raw);
        attributes = parsed.ok ? { validity: parsed.validity } : { validity_error: parsed.key };
      } catch {
        attributes = { validity_error: "annotation" };
      }
    }
    if (!text) return [];
    return [
      {
        category: tagged[1]!,
        text,
        line_start: item.line_start,
        line_end: item.line_end,
        ...attributes,
      },
    ];
  });
}

function inCodeSpan(text: string, offset: number): boolean {
  const runs = [...text.matchAll(/`+/g)];
  for (let i = 0; i < runs.length; i++) {
    const opening = runs[i]!;
    const j = runs.findIndex((run, index) => index > i && run[0].length === opening[0].length);
    if (j < 0) continue;
    const closing = runs[j]!;
    if (offset > opening.index! && offset < closing.index!) return true;
    i = j;
  }
  return false;
}
