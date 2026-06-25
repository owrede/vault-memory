/**
 * Edge extractors — produce typed `EdgeInput[]` rows for the `edges`
 * table from a single `ParsedNote`.
 *
 * Phase 4 / 04-02 / GRA-04. Implements the contracts:
 *   - D-02  — `extractAllEdges` unified entry: wikilink + mention +
 *             frontmatter-ref + hyperlink in one parse pass.
 *   - D-03  — mention: casefold + min-length 4 + word-boundary, scanned
 *             only on paragraph blocks (headings + fenced code + inline
 *             code + bracketed wikilink spans are pre-masked away).
 *             Candidate set built once per indexer run from `note_aliases`.
 *   - Pitfall 6 — frontmatter-ref two-rule heuristic:
 *                  (a) ANY property whose value is `[[...]]` syntax →
 *                      resolve via `WikilinkResolver`; `rel` = property name.
 *                  (b) Allowlisted property names (closed set of 8) whose
 *                      value is a bare string → resolve against
 *                      `note_aliases` only.
 *
 * Source-neutral by construction: zero imports of `fs`, `path`,
 * `chokidar`, or `gray-matter`. CI `scripts/lint-adapters.sh` verifies
 * this on every push (rule I-2). All inputs flow through the
 * already-parsed `ParsedNote` shape produced by the obsidian-fs
 * adapter (Phase 1 seam).
 *
 * RESEARCH.md §"Code Examples" lines 580–656 spell out the algorithms;
 * `<interfaces>` in `04-02-edge-extractors-PLAN.md` pins the exact
 * function signatures + the `FRONTMATTER_REF_ALLOWLIST` constant.
 *
 * Idempotency: re-extracting the same note yields the same `EdgeInput[]`
 * (order-stable; mention candidates sorted by `alias_norm` ASC inside
 * `db.aliases.listAll()`). The DB layer's `UNIQUE INDEX` on
 * `(source_doc, target_doc, type, anchor)` + `INSERT OR IGNORE` makes
 * the write side idempotent independently — see `src/db/queries/edges.ts`.
 */

import type { ParsedNote } from "../types.js";
import type { EdgeInput } from "../db/queries/edges.js";
import type { Vault } from "../vault/index.js";
import type { WikilinkResolver } from "./resolver.js";

// ───────────────────────────────────────────────────────────────────────────
// constants (D-03 + Pitfall 6)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Minimum casefolded alias length eligible for mention extraction.
 *
 * D-03 fixes this at 4 to block pronoun / acronym noise ("the", "API",
 * "you"). RESEARCH §Pitfall 2 + A1 carry the empirical reasoning; if
 * false positives exceed 3/note on the Atlas fixture, the plan
 * §verification step raises it to 5.
 */
export const MIN_MENTION_LEN = 4 as const;

/**
 * Closed allowlist of frontmatter property names whose bare-string
 * values are resolved against `note_aliases` (Pitfall 6 rule (b)).
 *
 * Sealed at the **type level** via `ReadonlySet<string>` — the TS
 * compiler rejects `.add()` at any call site without an explicit
 * cast. Runtime sealing via `Object.freeze` is intentionally avoided:
 * it is a no-op on the internal slot Set uses for its entries, so it
 * gives a false sense of immutability. The closed-set property is a
 * *compile-time* invariant; widening this set requires an ADR plus a
 * matching update to the threat-model mitigations T-04-02-01 +
 * T-04-02-02 (over-activation / private-term over-matching).
 */
export const FRONTMATTER_REF_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "assignee",
  "owner",
  "project",
  "related",
  "parent",
  "child",
  "attendees",
  "superseded_by",
]);

// ───────────────────────────────────────────────────────────────────────────
// entry point — D-02
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run all four extractors on a single parsed note. No cross-type
 * dedup — the UNIQUE index on `edges` handles row-level idempotency
 * (Pattern C from PATTERNS.md).
 *
 * Order:
 *   1. wikilink (delegates to `extractWikilinkEdges` — same shape as
 *      the legacy `insertWikilinks` helper produces, just reshaped
 *      to `EdgeInput`)
 *   2. mention
 *   3. frontmatter-ref
 *   4. hyperlink
 *
 * Stable order matters for snapshot tests downstream (Plan 04-04
 * cluster output) and for the per-note edge dump used in
 * `<verification>` empirical validation.
 */
export function extractAllEdges(
  vault: Vault,
  parsed: ParsedNote,
  resolver: WikilinkResolver,
): EdgeInput[] {
  return [
    ...extractWikilinkEdges(parsed, resolver),
    ...extractMentionEdges(parsed, vault),
    ...extractFrontmatterRefEdges(parsed, vault, resolver),
    ...extractHyperlinkEdges(parsed),
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// wikilink extractor
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reshape `parsed.wikilinks` (produced by the parser's
 * `extractWikilinks` + `extractFrontmatterWikilinks`) into typed
 * `EdgeInput` rows. Resolution uses the long-lived `WikilinkResolver`
 * to amortize prepared-statement cost across a full indexer run.
 *
 * Per D-01, the legacy `wikilinks` table also receives these rows
 * via the existing `insertWikilinks` helper in `single.ts` /
 * `indexer.ts`. This function only adds the `edges` side; the
 * indexer write path stays a dual-write until v3 retires `wikilinks`.
 */
export function extractWikilinkEdges(parsed: ParsedNote, resolver: WikilinkResolver): EdgeInput[] {
  const out: EdgeInput[] = [];
  for (const wl of parsed.wikilinks) {
    const hit = resolver.resolve(wl.normalizedTarget);
    out.push({
      targetNoteId: hit?.id ?? null,
      targetPath: wl.normalizedTarget,
      type: "wikilink",
      rel: null,
      anchor: wl.anchor,
      lineNumber: wl.line,
      linkText: wl.alias,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// mention extractor — D-03
// ───────────────────────────────────────────────────────────────────────────

interface MentionCandidate {
  noteId: number;
  path: string;
}

/**
 * Per-note mention extraction.
 *
 * Algorithm (RESEARCH lines 581–611):
 *   1. Build candidate set from `note_aliases` — casefold each alias
 *      and skip if length < MIN_MENTION_LEN. (T-04-02-04 mitigation:
 *      `db.aliases.listAll()` returns rows sorted by `alias_norm`
 *      ASC for deterministic regex alternation.)
 *   2. Mask the note body to keep only "paragraph" scope:
 *        - strip fenced code blocks (replace contents with spaces,
 *          preserving newlines so line numbers stay aligned),
 *        - strip ATX heading lines,
 *        - strip inline backtick code spans,
 *        - strip wikilink `[[...]]` spans (those become wikilink
 *          edges; the bare text after the span on the same line
 *          can still match — see Test 3).
 *   3. Run `\b(alt1|alt2|...)\b` (casefold + Unicode-aware
 *      word-boundary via lookbehind/lookahead on \w) over the
 *      masked body; for each hit, push an EdgeInput.
 *   4. Dedup by `${targetNoteId}:${lineNumber}` per RESEARCH line 609.
 */
export function extractMentionEdges(parsed: ParsedNote, vault: Vault): EdgeInput[] {
  const candidates = buildMentionCandidateSet(vault);
  if (candidates.size === 0) return [];

  const masked = maskForMentionScope(parsed.content);

  // Precompute line starts for O(log n) line lookup per match.
  const lineStarts = computeLineStarts(masked);

  // Build a single regex from the candidate set. Sorted descending by
  // length so longer aliases win greedy alternation (prevents "alice"
  // from masking "alice-chen" when both are registered).
  const alts = [...candidates.keys()]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegex);
  // Word-boundary via character-class lookbehind/lookahead so it
  // works for aliases containing `-` and `_` (which \w does match).
  // We use `(?<![\w-])` + `(?![\w-])` — the alias side keeps
  // hyphens intact ("alice-chen" as a whole token) while still
  // rejecting "inspire" matching "spire".
  const re = new RegExp(`(?<![\\w-])(?:${alts.join("|")})(?![\\w-])`, "gi");

  const seen = new Set<string>();
  const out: EdgeInput[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    const lower = match[0].toLowerCase();
    const cand = candidates.get(lower);
    if (!cand) continue;
    const line = lineOf(lineStarts, match.index);
    const key = `${cand.noteId}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      targetNoteId: cand.noteId,
      targetPath: cand.path,
      type: "mention",
      rel: null,
      anchor: null,
      lineNumber: line,
      linkText: null,
    });
  }
  return out;
}

function buildMentionCandidateSet(vault: Vault): Map<string, MentionCandidate> {
  const out = new Map<string, MentionCandidate>();
  for (const row of vault.db.aliases.listAll()) {
    const norm = row.alias_norm;
    if (norm.length < MIN_MENTION_LEN) continue;
    // First-seen-wins so the deterministic `alias_norm ASC` order
    // from listAll() decides ties.
    if (!out.has(norm)) {
      out.set(norm, { noteId: row.note_id, path: row.path });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// frontmatter-ref extractor — Pitfall 6
// ───────────────────────────────────────────────────────────────────────────

const WIKILINK_SHAPED = /^\s*\[\[([^\]]+)\]\]\s*$/;

/**
 * Recursive frontmatter walker — emits one edge per matched value.
 *
 * Rule (a): wikilink-shaped property value at ANY depth → resolver
 * lookup. `rel` carries the TOP-LEVEL property name (not the dotted
 * path — RESEARCH +interfaces both treat `attendees: ["[[X]]"]` as
 * `rel='attendees'` for every array element; this matches the plan's
 * Test 9 expectation and aligns with how Plan 04-03's `expand()`
 * filters by `rel`).
 *
 * Rule (b): top-level property name in the closed 8-key allowlist
 * with a bare-string value → resolve against `note_aliases` only.
 * Sub-arrays of bare strings on allowlisted keys are also resolved
 * (e.g. `attendees: ["alice-chen", "bob-martinez"]` — each element
 * goes through the alias resolver).
 *
 * Rule (a) takes precedence over (b) for a given value: a value
 * that's `[[...]]` shaped never falls through to alias-only
 * resolution.
 */
export function extractFrontmatterRefEdges(
  parsed: ParsedNote,
  vault: Vault,
  resolver: WikilinkResolver,
): EdgeInput[] {
  const fm = parsed.frontmatter;
  if (!fm) return [];

  const out: EdgeInput[] = [];

  for (const [key, value] of Object.entries(fm)) {
    if (key === "aliases" || key === "alias") continue;
    collectFrontmatterRefsForKey(key, value, vault, resolver, out);
  }
  return out;
}

function collectFrontmatterRefsForKey(
  key: string,
  value: unknown,
  vault: Vault,
  resolver: WikilinkResolver,
  out: EdgeInput[],
): void {
  // Array → recurse per element with same `key`.
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFrontmatterRefsForKey(key, item, vault, resolver, out);
    }
    return;
  }
  // Plain string — try rule (a) first, then rule (b) if allowlisted.
  if (typeof value === "string") {
    // Rule (a) — wikilink syntax. Fires for ANY key.
    const wl = WIKILINK_SHAPED.exec(value);
    if (wl !== null) {
      const inner = wl[1];
      if (inner !== undefined) {
        // Strip alias / anchor parts mirroring the body wikilink parser.
        const normalized = normalizeWikilinkInner(inner);
        if (normalized.length > 0) {
          const hit = resolver.resolve(normalized);
          if (hit) {
            out.push({
              targetNoteId: hit.id,
              targetPath: normalized,
              type: "frontmatter-ref",
              rel: key,
              anchor: null,
              lineNumber: null,
              linkText: null,
            });
          }
        }
      }
      return;
    }
    // Rule (b) — closed allowlist; alias-only resolution.
    if (FRONTMATTER_REF_ALLOWLIST.has(key)) {
      const aliasHit = vault.db.aliases.resolve(value);
      if (aliasHit) {
        out.push({
          targetNoteId: aliasHit.note_id,
          targetPath: aliasHit.path,
          type: "frontmatter-ref",
          rel: key,
          anchor: null,
          lineNumber: null,
          linkText: null,
        });
      }
    }
    return;
  }
  // Nested object — recurse, but carry the TOP-LEVEL key forward
  // (consistent with the array case + the plan's Test 9 expectation).
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectFrontmatterRefsForKey(key, v, vault, resolver, out);
    }
  }
}

function normalizeWikilinkInner(inner: string): string {
  // Strip `|alias` and `#anchor` suffixes; trim; drop trailing `.md`.
  let s = inner;
  const pipe = s.indexOf("|");
  if (pipe >= 0) s = s.slice(0, pipe);
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(0, hash);
  s = s.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
  return s;
}

// ───────────────────────────────────────────────────────────────────────────
// hyperlink extractor
// ───────────────────────────────────────────────────────────────────────────

const MD_LINK_RE = /(!?)\[(?:[^\]]*?)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL_RE = /(?<![\(\[a-zA-Z0-9])https?:\/\/[^\s)\]]+/g;

/**
 * Paragraph-scope hyperlink extraction.
 *
 * Captures:
 *   - `[text](https?://...)` — markdown link form
 *   - `![alt](https?://...)` — image with http(s) target only
 *   - bare `https?://...` URLs in prose
 *
 * Skips:
 *   - relative `[text](path)` / `![alt](path)` — those are future
 *     `embed` edges (Phase 4 v3 scope).
 *   - URLs inside fenced code blocks — masked out before matching,
 *     same treatment as mention scope.
 *
 * One edge per unique URL per line — dedup happens on `(targetPath,
 * lineNumber)` because the same URL may legitimately appear on
 * different lines and we want to preserve the line provenance.
 * Per-line collapse mirrors the mention dedup rule (RESEARCH 609).
 */
export function extractHyperlinkEdges(parsed: ParsedNote): EdgeInput[] {
  const masked = maskForMentionScope(parsed.content);
  const lineStarts = computeLineStarts(masked);

  const seen = new Set<string>();
  const out: EdgeInput[] = [];

  MD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK_RE.exec(masked)) !== null) {
    const url = m[2];
    if (url === undefined) continue;
    const line = lineOf(lineStarts, m.index);
    const cleaned = stripTrailingPunctuation(url);
    pushHyperlinkEdge(out, seen, cleaned, line);
  }

  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(masked)) !== null) {
    const raw = m[0];
    const line = lineOf(lineStarts, m.index);
    const cleaned = stripTrailingPunctuation(raw);
    pushHyperlinkEdge(out, seen, cleaned, line);
  }

  return out;
}

function pushHyperlinkEdge(out: EdgeInput[], seen: Set<string>, url: string, line: number): void {
  const key = `${url}:${line}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    targetNoteId: null,
    targetPath: url,
    type: "hyperlink",
    rel: null,
    anchor: null,
    lineNumber: line,
    linkText: null,
  });
}

function stripTrailingPunctuation(url: string): string {
  // Trim common terminator punctuation that authors append immediately
  // after a URL ("...see https://example.com."). Keeps trailing slashes
  // and intentional fragments / queries intact.
  return url.replace(/[.,;:!?]+$/, "");
}

// ───────────────────────────────────────────────────────────────────────────
// shared masking — keep mention + hyperlink scope to "paragraph-like"
// regions: no headings, no fenced code, no inline code, no [[wikilink]]
// spans. Newlines and offsets are preserved so line lookups stay valid.
// ───────────────────────────────────────────────────────────────────────────

function maskForMentionScope(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];

  let inFence = false;
  let fenceMarker = "";
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inFence) {
      const fenceOpen = /^(`{3,}|~{3,})/.exec(trimmed);
      if (fenceOpen !== null && fenceOpen[1] !== undefined) {
        inFence = true;
        fenceMarker = fenceOpen[1][0] ?? "`";
        out.push(blankLine(line));
        continue;
      }
    } else {
      const fenceClose = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
      if (fenceClose !== null && fenceClose[1] !== undefined && fenceClose[1][0] === fenceMarker) {
        inFence = false;
        out.push(blankLine(line));
        continue;
      }
      out.push(blankLine(line));
      continue;
    }
    // ATX heading lines: mask entirely. (Setext headings are rare in
    // Obsidian vaults and v1 wikilink extraction did not special-case
    // them either — leaving them in scope is consistent.)
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      out.push(blankLine(line));
      continue;
    }
    // Mask inline code spans + bracketed wikilinks within the line.
    let lineOut = line;
    lineOut = maskRanges(lineOut, /`[^`\n]*`/g);
    lineOut = maskRanges(lineOut, /\[\[[^\[\]\n]+\]\]/g);
    out.push(lineOut);
  }

  return out.join("\n");
}

function blankLine(line: string): string {
  // Preserve length so byte offsets / line numbers are stable.
  return " ".repeat(line.length);
}

function maskRanges(line: string, re: RegExp): string {
  let result = "";
  let last = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    result += line.slice(last, m.index);
    result += " ".repeat(m[0].length);
    last = m.index + m[0].length;
  }
  result += line.slice(last);
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// line-lookup helpers (mirrors the obsidian-fs parser idiom)
// ───────────────────────────────────────────────────────────────────────────

function computeLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineOf(lineStarts: number[], offset: number): number {
  // Largest lineStart <= offset, 1-based.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const v = lineStarts[mid];
    if (v !== undefined && v <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
