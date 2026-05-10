import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseNote } from "./parser.js";
import { sha256 } from "./hash.js";

describe("parseNote", () => {
  let root: string;
  let file: string;

  const body = [
    "# Real Title",
    "",
    "Some intro with [[Linked]] and [[Other|alias]].",
    "",
    "```",
    "Inside code [[ShouldBeIgnored]]",
    "```",
    "",
    "End.",
  ].join("\n");

  const fileContent = ["---", "tag: foo", "count: 3", "---", "", body].join(
    "\n",
  );

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vm-parse-"));
    file = path.join(root, "sub", "note.md");
    await fs.mkdir(path.join(root, "sub"));
    await fs.writeFile(file, fileContent, "utf-8");
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("parses frontmatter, title, wikilinks, hash, relativePath", async () => {
    const note = await parseNote(file, root);

    expect(note.relativePath).toBe("sub/note.md");
    expect(note.frontmatter).toEqual({ tag: "foo", count: 3 });
    expect(note.title).toBe("Real Title");
    expect(note.content.startsWith("\n# Real Title")).toBe(true);
    expect(note.wordCount).toBeGreaterThan(0);
    expect(typeof note.mtime).toBe("number");
    expect(note.mtime).toBeGreaterThan(0);

    const targets = note.wikilinks.map((w) => w.rawTarget);
    expect(targets).toEqual(["Linked", "Other"]);

    // Hash is deterministic on content + JSON-stringified frontmatter
    const expected = sha256(
      note.content + JSON.stringify(note.frontmatter ?? {}),
    );
    expect(note.hash).toBe(expected);
  });

  it("falls back to basename when no H1 is present", async () => {
    const f = path.join(root, "no-title.md");
    await fs.writeFile(f, "Just body text, no heading.\n", "utf-8");
    const note = await parseNote(f, root);
    expect(note.title).toBe("no-title");
    expect(note.frontmatter).toBeNull();
  });
});
