export type TextPatch =
  | { kind: "replace"; old_text: string; new_text: string }
  | { kind: "section"; heading_path: string[]; content: string };
export type PatchResult =
  | { ok: true; body: string }
  | { ok: false; reason: "ambiguous_target" | "target_not_found" | "invalid_patch" };
export function patchBody(body: string, patch: TextPatch): PatchResult {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const normalize = (text: string) => text.replace(/\r?\n/g, newline);
  if (patch.kind === "replace") {
    if (patch.old_text.length === 0) return { ok: false, reason: "invalid_patch" };
    const first = body.indexOf(patch.old_text);
    if (first < 0) return { ok: false, reason: "target_not_found" };
    if (body.indexOf(patch.old_text, first + patch.old_text.length) >= 0) {
      return { ok: false, reason: "ambiguous_target" };
    }
    return {
      ok: true,
      body:
        body.slice(0, first) +
        normalize(patch.new_text) +
        body.slice(first + patch.old_text.length),
    };
  }
  if (patch.heading_path.length === 0 || patch.heading_path.some((part) => part.length === 0)) {
    return { ok: false, reason: "invalid_patch" };
  }
  const matches = sectionRanges(body).filter(
    (range) =>
      range.heading_path.length === patch.heading_path.length &&
      range.heading_path.every((part, index) => part === patch.heading_path[index]),
  );
  if (matches.length === 0) return { ok: false, reason: "target_not_found" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous_target" };
  const range = matches[0]!;
  let content = normalize(patch.content);
  if (content && range.end < body.length && !content.endsWith(newline)) content += newline;
  const separator =
    content && range.body_start === body.length && !body.endsWith("\n") ? newline : "";
  return {
    ok: true,
    body: body.slice(0, range.body_start) + separator + content + body.slice(range.end),
  };
}
import { sectionRanges } from "../sections/ranges.js";
