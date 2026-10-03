import type { BlockNode } from "../types.js";
import { blockToPlainText } from "../sections/anchor.js";
function render(block: BlockNode): string {
  if (block.kind === "section")
    return [
      ...(block.level > 0
        ? ["#".repeat(block.level) + " " + (block.heading_path.at(-1) ?? "")]
        : []),
      ...block.blocks.map(render),
    ].join("\n\n");
  if (block.kind === "code") {
    const maxRun = [...block.text.matchAll(/`+/g)].reduce(
      (max, match) => Math.max(max, match[0].length),
      2,
    );
    const fence = "`".repeat(maxRun + 1);
    return fence + (block.lang ?? "").replace(/[`\r\n]/g, "") + "\n" + block.text + "\n" + fence;
  }
  if (block.kind === "list") {
    const marker = block.ordered ? "1. " : "- ";
    return block.items
      .map((item) => marker + item.replace(/\n/g, "\n" + " ".repeat(marker.length)))
      .join("\n");
  }
  return blockToPlainText(block);
}
/** Structured source lines are projection coordinates, never native source offsets. */
export function inspectionBody(blocks: BlockNode[]): {
  text: string;
  line_basis: "source_body" | "rendered_markdown";
} {
  if (blocks.length === 1 && blocks[0]!.kind === "paragraph")
    return { text: blocks[0]!.text, line_basis: "source_body" };
  return { text: blocks.map(render).join("\n\n"), line_basis: "rendered_markdown" };
}
