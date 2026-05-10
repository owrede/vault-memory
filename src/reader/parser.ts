import { promises as fs } from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import type { ParsedNote } from "../types.js";
import { extractWikilinks } from "./wikilinks.js";
import { computeNoteHash } from "./hash.js";

/**
 * Parse a single markdown file into a ParsedNote.
 *
 * `relativePath` is always posix (forward slashes), relative to `vaultRoot`.
 */
export async function parseNote(
  absolutePath: string,
  vaultRoot: string,
): Promise<ParsedNote> {
  const raw = await fs.readFile(absolutePath, "utf-8");
  const stat = await fs.stat(absolutePath);

  const parsed = matter(raw);
  const content = parsed.content;
  const fmData = parsed.data as Record<string, unknown> | undefined;
  const frontmatter: Record<string, unknown> | null =
    fmData !== undefined && Object.keys(fmData).length > 0 ? fmData : null;

  const title = extractTitle(content) ?? path.basename(absolutePath, ".md");
  const hash = computeNoteHash(content, frontmatter);
  const mtime = Math.floor(stat.mtimeMs);
  const wikilinks = extractWikilinks(content);
  const wordCount = countWords(content);
  const relativePath = toPosix(
    path.relative(path.resolve(vaultRoot), path.resolve(absolutePath)),
  );

  return {
    relativePath,
    content,
    frontmatter,
    title,
    hash,
    mtime,
    wikilinks,
    wordCount,
  };
}

/** Find the first H1 (`# Title`) at the start of a line. */
function extractTitle(content: string): string | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== undefined) return m[1].trim();
    // Stop scanning into the body too far — but Obsidian title H1 can be
    // anywhere near the top. We keep scanning the whole content; cheap.
  }
  return null;
}

function countWords(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
