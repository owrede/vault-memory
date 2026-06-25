/**
 * Edge extractor unit tests
 *
 * Phase 4 / 04-02 / GRA-04 / D-02 / D-03 / Pitfall 6.
 *
 * Covers the three new extractors (mention / frontmatter-ref / hyperlink)
 * + the `extractAllEdges` integration entry point. Wikilink extraction
 * itself is exercised end-to-end via `single.test.ts` (Task 2) because
 * it reuses the existing parser-side `parsed.wikilinks` array verbatim.
 *
 * Fixtures construct a `ParsedNote` shape directly (skipping the
 * obsidian-fs parser) — extract-edges.ts is source-neutral and operates
 * on the `ParsedNote` contract, not on disk. Seed notes go through
 * `db.notes.upsertByPath` + `db.aliases.setForNote` so the mention
 * candidate set and the frontmatter-ref allowlist's alias-resolve
 * lookups see real rows.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import type { ParsedNote, ParsedWikilink } from "../types.js";
import { WikilinkResolver } from "./resolver.js";
import {
  FRONTMATTER_REF_ALLOWLIST,
  MIN_MENTION_LEN,
  extractAllEdges,
  extractFrontmatterRefEdges,
  extractHyperlinkEdges,
  extractMentionEdges,
  extractWikilinkEdges,
} from "./extract-edges.js";

function makeVault(db: Database): Vault {
  return {
    config: { name: "test-vault", path: "/tmp/does-not-matter" },
    db,
    dbPath: ":memory:",
  };
}

function makeParsed(args: {
  relativePath?: string;
  content: string;
  frontmatter?: Record<string, unknown> | null;
  wikilinks?: ParsedWikilink[];
}): ParsedNote {
  return {
    relativePath: args.relativePath ?? "note.md",
    content: args.content,
    frontmatter: args.frontmatter ?? null,
    title: "Note",
    hash: "h",
    bodyHash: "bh",
    mtime: 0,
    wikilinks: args.wikilinks ?? [],
    wordCount: args.content.split(/\s+/).filter(Boolean).length,
  };
}

interface SeededNote {
  id: number;
  path: string;
}

function seedNote(
  db: Database,
  relPath: string,
  title: string,
  aliases: string[] = [],
): SeededNote {
  const up = db.notes.upsertByPath({
    path: relPath,
    content: `# ${title}`,
    frontmatter: null,
    title,
    hash: `h-${relPath}`,
    mtime: 1000,
    wordCount: 1,
  });
  if (aliases.length > 0) {
    db.aliases.setForNote(up.id, aliases);
  }
  return { id: up.id, path: relPath };
}

describe("extract-edges constants", () => {
  it("MIN_MENTION_LEN is 4", () => {
    expect(MIN_MENTION_LEN).toBe(4);
  });
  it("FRONTMATTER_REF_ALLOWLIST contains the 8 D-03 keys", () => {
    expect(FRONTMATTER_REF_ALLOWLIST.has("assignee")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.has("owner")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.has("project")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.has("related")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.has("parent")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.has("child")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.has("attendees")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.has("superseded_by")).toBe(true);
    expect(FRONTMATTER_REF_ALLOWLIST.size).toBe(8);
    // Type-system seal: the export type is `ReadonlySet<string>`, so the
    // TypeScript compiler rejects `FRONTMATTER_REF_ALLOWLIST.add(...)` at
    // the call site without an `as Set<string>` cast. We deliberately do
    // NOT runtime-enforce immutability — `Object.freeze` is a no-op on
    // Set internals, and a runtime Proxy would burn an allocation on
    // every `.has()` call inside the mention/frontmatter-ref hot path.
    // The closed-set property is therefore a *compile-time* invariant.
    expect(FRONTMATTER_REF_ALLOWLIST.has("status")).toBe(false);
  });
});

describe("extractMentionEdges (D-03)", () => {
  let db: Database;
  let vault: Vault;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = makeVault(db);
  });

  afterEach(() => {
    db.close();
  });

  it("Test 1: emits one mention per matched alias in paragraph text", () => {
    // D-03 fixes the floor at MIN_MENTION_LEN=4, so we use full-name
    // aliases (≥ 4 chars). "Alice" (5) + "Bobby" (5) both clear the
    // threshold; "bob" alone (3) would be silently filtered out by
    // `buildMentionCandidateSet` per Test 2.
    const alice = seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice"]);
    const bob = seedNote(db, "people/bob-martinez.md", "Bob Martinez", ["bobby"]);
    const parsed = makeParsed({ content: "Alice and Bobby met yesterday." });
    const edges = extractMentionEdges(parsed, vault);
    expect(edges).toHaveLength(2);
    const targets = new Set(edges.map((e) => e.targetNoteId));
    expect(targets.has(alice.id)).toBe(true);
    expect(targets.has(bob.id)).toBe(true);
    for (const e of edges) {
      expect(e.type).toBe("mention");
      expect(e.lineNumber).toBe(1);
      expect(e.rel).toBeNull();
      expect(e.anchor).toBeNull();
    }
  });

  it("Test 2: aliases shorter than MIN_MENTION_LEN are excluded", () => {
    seedNote(db, "the.md", "The Note", ["the"]); // 3 chars
    seedNote(db, "api.md", "API", ["API"]); // 3 chars
    const parsed = makeParsed({ content: "the API is slow" });
    expect(extractMentionEdges(parsed, vault)).toHaveLength(0);
  });

  it("Test 3: pre-strips [[wikilinks]] before regex; bare occurrence outside the bracket still matches", () => {
    seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice"]);
    const parsed = makeParsed({ content: "[[Alice]] and Alice C. attended." });
    const edges = extractMentionEdges(parsed, vault);
    // The bracketed "Alice" is pre-stripped to spaces (handled by the
    // wikilink edge); the bare "Alice C." occurrence matches the
    // "alice" alias on its own word boundary.
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe("mention");
    expect(edges[0]?.lineNumber).toBe(1);
  });

  it("Test 4: inline code spans are stripped — no mention inside backticks", () => {
    seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice"]);
    const parsed = makeParsed({ content: "the `Alice` API" });
    expect(extractMentionEdges(parsed, vault)).toHaveLength(0);
  });

  it("Test 5: headings do not produce mention edges", () => {
    seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice"]);
    const parsed = makeParsed({ content: "## Alice\n" });
    expect(extractMentionEdges(parsed, vault)).toHaveLength(0);
  });

  it("Test 6: fenced code blocks are skipped (paragraph-only scope)", () => {
    seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice"]);
    const parsed = makeParsed({
      content: "```js\nconst Alice = 1;\n```\n",
    });
    expect(extractMentionEdges(parsed, vault)).toHaveLength(0);
  });

  it("Test 7: dedups by (targetNoteId, lineNumber) — repeated names on one line collapse", () => {
    seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice"]);
    const parsed = makeParsed({ content: "Alice met Alice and Alice" });
    const edges = extractMentionEdges(parsed, vault);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.lineNumber).toBe(1);
  });

  it("preserves line numbers across multi-line bodies", () => {
    seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice"]);
    seedNote(db, "people/bob-martinez.md", "Bob Martinez", ["bobby"]);
    const parsed = makeParsed({
      content: "First line ignored.\nAlice on line 2.\nBobby on line 3.",
    });
    const edges = extractMentionEdges(parsed, vault);
    expect(edges).toHaveLength(2);
    const lines = edges.map((e) => e.lineNumber).sort();
    expect(lines).toEqual([2, 3]);
  });

  it("word boundary excludes substrings inside other words", () => {
    seedNote(db, "spire.md", "Spire", ["spire"]);
    // "inspire" contains "spire" — the word-boundary regex must reject it.
    const parsed = makeParsed({ content: "We inspire teams every day." });
    expect(extractMentionEdges(parsed, vault)).toHaveLength(0);
  });
});

describe("extractFrontmatterRefEdges (Pitfall 6)", () => {
  let db: Database;
  let vault: Vault;
  let resolver: WikilinkResolver;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = makeVault(db);
    resolver = new WikilinkResolver(vault);
  });

  afterEach(() => {
    db.close();
  });

  it("Test 8: rule (a) — property value [[alice-chen]] resolves via WikilinkResolver", () => {
    const alice = seedNote(db, "people/alice-chen.md", "Alice Chen");
    const parsed = makeParsed({
      content: "",
      frontmatter: { owner: "[[alice-chen]]" },
    });
    const edges = extractFrontmatterRefEdges(parsed, vault, resolver);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe("frontmatter-ref");
    expect(edges[0]?.rel).toBe("owner");
    expect(edges[0]?.targetNoteId).toBe(alice.id);
    expect(edges[0]?.lineNumber).toBeNull();
    expect(edges[0]?.anchor).toBeNull();
  });

  it("Test 9: rule (a) — array of wikilink-shaped values emits one edge per element with rel=property name", () => {
    const alice = seedNote(db, "people/alice-chen.md", "Alice Chen");
    const bob = seedNote(db, "people/bob-martinez.md", "Bob Martinez");
    const parsed = makeParsed({
      content: "",
      frontmatter: { attendees: ["[[alice-chen]]", "[[bob-martinez]]"] },
    });
    const edges = extractFrontmatterRefEdges(parsed, vault, resolver);
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.type).toBe("frontmatter-ref");
      expect(e.rel).toBe("attendees");
    }
    const targets = new Set(edges.map((e) => e.targetNoteId));
    expect(targets.has(alice.id)).toBe(true);
    expect(targets.has(bob.id)).toBe(true);
  });

  it("Test 10: rule (b) — allowlisted property + bare alias string resolves via note_aliases", () => {
    const alice = seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice-chen"]);
    const parsed = makeParsed({
      content: "",
      frontmatter: { owner: "alice-chen" },
    });
    const edges = extractFrontmatterRefEdges(parsed, vault, resolver);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.rel).toBe("owner");
    expect(edges[0]?.targetNoteId).toBe(alice.id);
  });

  it("Test 11: rule (b) — non-allowlisted property does not fire even when alias matches", () => {
    seedNote(db, "active.md", "Active", ["active"]);
    const parsed = makeParsed({
      content: "",
      frontmatter: { status: "active" },
    });
    expect(extractFrontmatterRefEdges(parsed, vault, resolver)).toHaveLength(0);
  });

  it("Test 12: rule (b) — random_key not in allowlist blocks resolution", () => {
    seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice-chen"]);
    const parsed = makeParsed({
      content: "",
      frontmatter: { random_key: "alice-chen" },
    });
    expect(extractFrontmatterRefEdges(parsed, vault, resolver)).toHaveLength(0);
  });

  it("Test 13: rule (b) — DocId-shaped value that's not an alias does NOT emit an edge", () => {
    seedNote(db, "decisions/x-old.md", "X Old"); // no aliases registered
    const parsed = makeParsed({
      content: "",
      frontmatter: {
        superseded_by: "obsidian-fs://v2-test-vault/decisions/x-old.md",
      },
    });
    // Plan §interfaces Pitfall 6 rule (b): allowlisted property values
    // are matched against `note_aliases` only, NOT against arbitrary
    // titles or DocIds. The string above has no alias entry → no edge.
    // (Plan 04-03's expand() materializes the back-edge at query time.)
    expect(extractFrontmatterRefEdges(parsed, vault, resolver)).toHaveLength(0);
  });

  it("does not emit an edge for a wikilink-shaped value in a non-allowlisted property if rule (a) target is unresolved", () => {
    const parsed = makeParsed({
      content: "",
      frontmatter: { weird_key: "[[nonexistent]]" },
    });
    // Rule (a) fires regardless of allowlist BUT only when target resolves.
    // No seeded "nonexistent" note → no edge.
    expect(extractFrontmatterRefEdges(parsed, vault, resolver)).toHaveLength(0);
  });

  it("rule (a) fires for any property name, even non-allowlisted, when value is [[wikilink]] syntax and resolves", () => {
    const alice = seedNote(db, "people/alice-chen.md", "Alice Chen");
    const parsed = makeParsed({
      content: "",
      frontmatter: { weird_key: "[[alice-chen]]" },
    });
    const edges = extractFrontmatterRefEdges(parsed, vault, resolver);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.rel).toBe("weird_key");
    expect(edges[0]?.targetNoteId).toBe(alice.id);
  });
});

describe("extractHyperlinkEdges", () => {
  it("Test 14: bare https URL emits a hyperlink edge", () => {
    const parsed = makeParsed({ content: "See https://example.com for details." });
    const edges = extractHyperlinkEdges(parsed);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe("hyperlink");
    expect(edges[0]?.targetPath).toBe("https://example.com");
    expect(edges[0]?.targetNoteId).toBeNull();
    expect(edges[0]?.lineNumber).toBe(1);
  });

  it("Test 15: markdown [text](url) emits a hyperlink edge with the URL only", () => {
    const parsed = makeParsed({ content: "[docs](https://example.com/docs) explain it." });
    const edges = extractHyperlinkEdges(parsed);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.targetPath).toBe("https://example.com/docs");
  });

  it("Test 16: relative [text](./path) is skipped", () => {
    const parsed = makeParsed({ content: "[local](./readme.md)" });
    expect(extractHyperlinkEdges(parsed)).toHaveLength(0);
  });

  it("Test 17: image embed with http(s) URL emits a hyperlink edge", () => {
    const parsed = makeParsed({ content: "![diagram](https://example.com/d.png)" });
    const edges = extractHyperlinkEdges(parsed);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.targetPath).toBe("https://example.com/d.png");
  });

  it("Test 18: image embed with relative path is skipped", () => {
    const parsed = makeParsed({ content: "![local](images/d.png)" });
    expect(extractHyperlinkEdges(parsed)).toHaveLength(0);
  });

  it("Test 19: URLs inside fenced code blocks are skipped", () => {
    const parsed = makeParsed({
      content: "```\nhttps://example.com\n```\n",
    });
    expect(extractHyperlinkEdges(parsed)).toHaveLength(0);
  });

  it("dedupes by target_path (one edge per unique URL on the same line)", () => {
    const parsed = makeParsed({
      content: "Read https://example.com and again https://example.com please.",
    });
    const edges = extractHyperlinkEdges(parsed);
    expect(edges).toHaveLength(1);
  });

  it("captures both forms in the same paragraph", () => {
    const parsed = makeParsed({
      content: "See [docs](https://example.com/docs) or visit https://other.example.com .",
    });
    const edges = extractHyperlinkEdges(parsed);
    const urls = new Set(edges.map((e) => e.targetPath));
    expect(urls.has("https://example.com/docs")).toBe(true);
    expect(urls.has("https://other.example.com")).toBe(true);
  });
});

describe("extractAllEdges integration", () => {
  let db: Database;
  let vault: Vault;
  let resolver: WikilinkResolver;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = makeVault(db);
    resolver = new WikilinkResolver(vault);
  });

  afterEach(() => {
    db.close();
  });

  it("Test 20: produces all four edge types from one parse pass", () => {
    const alice = seedNote(db, "people/alice-chen.md", "Alice Chen", ["alice", "alice-chen"]);
    const bob = seedNote(db, "people/bob-martinez.md", "Bob Martinez", ["bob"]);

    const parsed = makeParsed({
      relativePath: "meeting.md",
      content: [
        "See [[bob-martinez]] for details.",
        "",
        "Alice attended yesterday. https://example.com",
      ].join("\n"),
      frontmatter: { owner: "[[alice-chen]]" },
      wikilinks: [
        {
          rawTarget: "bob-martinez",
          normalizedTarget: "bob-martinez",
          anchor: null,
          alias: null,
          line: 1,
        },
      ],
    });

    const edges = extractAllEdges(vault, parsed, resolver);
    const byType = edges.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});

    expect(byType["wikilink"]).toBe(1);
    expect(byType["frontmatter-ref"]).toBe(1);
    expect(byType["mention"]).toBeGreaterThanOrEqual(1);
    expect(byType["hyperlink"]).toBe(1);

    // Targets check
    const wlEdge = edges.find((e) => e.type === "wikilink");
    expect(wlEdge?.targetNoteId).toBe(bob.id);
    const frEdge = edges.find((e) => e.type === "frontmatter-ref");
    expect(frEdge?.targetNoteId).toBe(alice.id);
    expect(frEdge?.rel).toBe("owner");
    const hlEdge = edges.find((e) => e.type === "hyperlink");
    expect(hlEdge?.targetPath).toBe("https://example.com");
  });

  it("returns an empty array for a note with no edges of any kind", () => {
    const parsed = makeParsed({ content: "Just prose. Nothing to link." });
    expect(extractAllEdges(vault, parsed, resolver)).toEqual([]);
  });
});

describe("extractWikilinkEdges", () => {
  let db: Database;
  let vault: Vault;
  let resolver: WikilinkResolver;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = makeVault(db);
    resolver = new WikilinkResolver(vault);
  });

  afterEach(() => {
    db.close();
  });

  it("resolves wikilinks to note IDs and carries anchor / linkText / lineNumber", () => {
    const target = seedNote(db, "target.md", "Target");
    const parsed = makeParsed({
      content: "[[target#sec|display]]",
      wikilinks: [
        {
          rawTarget: "target",
          normalizedTarget: "target",
          anchor: "sec",
          alias: "display",
          line: 1,
        },
      ],
    });
    const edges = extractWikilinkEdges(parsed, resolver);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe("wikilink");
    expect(edges[0]?.targetNoteId).toBe(target.id);
    expect(edges[0]?.targetPath).toBe("target");
    expect(edges[0]?.anchor).toBe("sec");
    expect(edges[0]?.linkText).toBe("display");
    expect(edges[0]?.lineNumber).toBe(1);
    expect(edges[0]?.rel).toBeNull();
  });

  it("emits an edge with null targetNoteId for an unresolved wikilink", () => {
    const parsed = makeParsed({
      content: "[[nonexistent]]",
      wikilinks: [
        {
          rawTarget: "nonexistent",
          normalizedTarget: "nonexistent",
          anchor: null,
          alias: null,
          line: 1,
        },
      ],
    });
    const edges = extractWikilinkEdges(parsed, resolver);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.targetNoteId).toBeNull();
    expect(edges[0]?.targetPath).toBe("nonexistent");
  });
});
