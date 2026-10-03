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
    const marker = text.indexOf("<!-- validity:");
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
