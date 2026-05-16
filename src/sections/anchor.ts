/**
 * Phase 3 — section anchor computation.
 *
 * Per ADR-003 H-7:
 *   anchor = sha256_hex(NFC(heading_text) || "\n" || NFC(plain_text_body))
 *
 * The `plain_text_body` is produced by `blockToPlainText` (defined below)
 * walking the section's `BlockNode[]`. The renderer is intentionally
 * minimal — it is NOT a markdown round-trip; its only contract is that
 * identical-content sections produce identical hashes.
 *
 * Pure function. No fs / gray-matter / chokidar / path imports. The
 * adapter-seam linter (`scripts/lint-adapters.sh`) enforces this.
 */

import { createHash } from "node:crypto";
import type { BlockNode } from "../types.js";

/**
 * Compute the canonical content-hash anchor for a section.
 *
 * Algorithm:
 *   plainBody  = blocks.map(blockToPlainText).join("\n")
 *   canonical  = headingText.normalize("NFC") + "\n" + plainBody.normalize("NFC")
 *   anchor     = sha256_hex(canonical)
 *
 * NFC normalization is required so that the same logical string
 * encoded differently (precomposed vs decomposed Unicode) produces
 * identical anchors. LF (0x0A) is the only separator.
 *
 * The trailing newline separator (between heading and body) is emitted
 * UNCONDITIONALLY — even when the body is empty or the heading is the
 * synthetic preamble "" — so that a section with `heading_text = ""`
 * and `blocks = []` produces a deterministic, well-defined hash
 * (not the sha256 of the empty string).
 */
export function computeAnchor(headingText: string, blocks: readonly BlockNode[]): string {
  const plainBody = blocks.map(blockToPlainText).join("\n");
  const canonical = headingText.normalize("NFC") + "\n" + plainBody.normalize("NFC");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Deterministic plain-text rendering of a single block. Identical
 * content produces identical output; this is the only requirement.
 *
 * Discriminated-union exhaustiveness is enforced via the `never`
 * fallthrough — a future block variant added without updating this
 * function fails type-check.
 */
export function blockToPlainText(block: BlockNode): string {
  switch (block.kind) {
    case "paragraph":
      return block.text;
    case "heading":
      return "#".repeat(block.level) + " " + block.text;
    case "code":
      return "```" + (block.lang ?? "") + "\n" + block.text + "\n```";
    case "list": {
      const marker = block.ordered ? "1." : "-";
      return block.items.map((item) => marker + " " + item).join("\n");
    }
    case "section":
      // Recursive case — sections nesting sections is permitted by the
      // type union (the canonical Phase 3 `BlockNode` tree). The plain
      // text of a section block is its own heading line + its blocks'
      // plain text, joined consistently with the top-level anchor
      // algorithm above.
      return (
        "#".repeat(Math.max(1, block.level)) +
        " " +
        // For the synthetic preamble (level 0, empty heading_text) the
        // hash collapses to "# " + "" which is fine — sections-of-sections
        // is an unusual shape and only appears in tree-builder outputs.
        (block.heading_path[block.heading_path.length - 1] ?? "") +
        "\n" +
        block.blocks.map(blockToPlainText).join("\n")
      );
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}
