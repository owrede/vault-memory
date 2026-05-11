import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseNote } from "./parser.js";
import { computeNoteHash } from "./hash.js";

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

    // Hash is deterministic on content + canonical-JSON frontmatter
    const expected = computeNoteHash(note.content, note.frontmatter);
    expect(note.hash).toBe(expected);
  });

  it("falls back to basename when no H1 is present", async () => {
    const f = path.join(root, "no-title.md");
    await fs.writeFile(f, "Just body text, no heading.\n", "utf-8");
    const note = await parseNote(f, root);
    expect(note.title).toBe("no-title");
    expect(note.frontmatter).toBeNull();
  });

  it("collects frontmatter wikilinks alongside body wikilinks (and deduplicates)", async () => {
    const f = path.join(root, "person.md");
    const c = [
      "---",
      "class: Person",
      'organisation: "[[INFORM GmbH]]"',
      "affiliated_with:",
      '  - "[[INFORM GmbH]]"',
      '  - "[[Intelligence Impact]]"',
      'cofounder_of: ["[[Intelligence Impact]]"]',
      'past_roles: ["[[RWTH Aachen]]"]',
      "aliases:",
      "  - JHE",
      "---",
      "",
      "# Jörg Herbers",
      "",
      "Worked at [[INFORM GmbH]] for 26 years.",
    ].join("\n");
    await fs.writeFile(f, c, "utf-8");

    const note = await parseNote(f, root);
    const targets = note.wikilinks.map((w) => w.normalizedTarget);

    expect(targets).toContain("INFORM GmbH");
    expect(targets).toContain("Intelligence Impact");
    expect(targets).toContain("RWTH Aachen");

    // aliases key is skipped (alias literal is not a wikilink target).
    expect(targets).not.toContain("JHE");

    // INFORM GmbH appears in body AND in frontmatter → only the body entry
    // is kept (frontmatter is deduped against body on (target, anchor)).
    const inform = note.wikilinks.filter(
      (w) => w.normalizedTarget === "INFORM GmbH",
    );
    expect(inform).toHaveLength(1);
    expect(inform[0]?.line).toBeGreaterThan(0); // came from body

    // Intelligence Impact appears only in frontmatter (in two keys, but
    // both have target=II, anchor=null → dedupe collapses to one).
    const ii = note.wikilinks.filter(
      (w) => w.normalizedTarget === "Intelligence Impact",
    );
    expect(ii).toHaveLength(1);
    expect(ii[0]?.line).toBe(0); // came from frontmatter

    // RWTH Aachen appears only in frontmatter (past_roles).
    const rwth = note.wikilinks.filter(
      (w) => w.normalizedTarget === "RWTH Aachen",
    );
    expect(rwth).toHaveLength(1);
    expect(rwth[0]?.line).toBe(0);
  });
});
