import { extractHeadings } from "../chunker/headings.js";
import { extractSections, markdownToSectionBlocks } from "./extract.js";

/** Byte-preserving UTF-16 offsets into a raw Markdown body. */
export interface SectionRange {
  heading_path: string[];
  heading_start: number;
  body_start: number;
  end: number;
}

export function sectionRanges(body: string): SectionRange[] {
  const headings = extractHeadings(body);
  const sections = extractSections(markdownToSectionBlocks(body)).filter((s) => s.level > 0);
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const newline = body.indexOf("\n", heading.startOffset);
    return {
      heading_path: sections[index]!.heading_path,
      heading_start: heading.startOffset,
      body_start: newline === -1 ? body.length : newline + 1,
      end: next?.startOffset ?? body.length,
    };
  });
}
