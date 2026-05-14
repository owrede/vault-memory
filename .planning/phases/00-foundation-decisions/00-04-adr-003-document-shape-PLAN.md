---
phase: 00-foundation-decisions
plan: 04
type: execute
wave: 3
depends_on: [02]
files_modified:
  - docs/dev/003-document-shape.md
  - docs/v2/adr/003-document-shape.md
  - docs/v2/adr/README.md
autonomous: true
requirements: [FND-01, FND-02, FND-04, FND-13]
must_haves:
  truths:
    - "ADR-003 lives at the public path `docs/v2/adr/003-document-shape.md` with full git history preserved"
    - "ADR-003 contains explicit hash-semantics pseudocode citing RFC 8785, NFC normalization, LF line endings, and number canonicalization (FND-02)"
    - "ADR-003 documents the chunk-level `source_hashes` schema with a worked example (FND-02)"
    - "ADR-003 has `## Invariants` and `## Examples` sections (FND-04)"
    - "ADR index README has a row for `| 003 | … Document Shape … | Accepted | …`"
  artifacts:
    - path: "docs/v2/adr/003-document-shape.md"
      provides: "ADR-003 with hash-semantics amendment + Invariants + Examples"
      contains: "RFC 8785"
    - path: "docs/v2/adr/README.md"
      provides: "Index appended with ADR-003 row"
      contains: "| 003 |"
  key_links:
    - from: "docs/v2/adr/003-document-shape.md"
      to: "RFC 8785 reference"
      via: "citation in hash-canonicalization pseudocode"
      pattern: "RFC 8785|rfc8785"
---

<objective>
Two requirements bundled into one ADR: (FND-01) relocate ADR-003 from gitignored `docs/dev/` to public `docs/v2/adr/` preserving git history via the two-commit pattern; (FND-02) amend ADR-003 with the explicit hash-semantics pseudocode that names RFC 8785 by RFC number and documents the chunk-level `source_hashes` schema with a worked brief example. The amendment is the cornerstone of Phase 5's source-hash staleness daemon — getting it ambiguous here is the exact failure mode the adversarial review (plan 14) hunts for.

Runs in Wave 3 after plan 02 (the walking-skeleton ADR-001 vertical slice) proves the two-commit pattern and resolves assumption A1 (merge strategy). Parallel with plans 03, 05, 06, 07, 08, 09, 10 in Wave 3.

Purpose: ADR-003 is the load-bearing ADR for v3 cross-adapter conformance. A Phase 10 Notion adapter implemented in Rust must produce byte-identical `Document.hash` outputs to the Phase 1 obsidian-fs adapter for the same Document fixture. Three failure modes are mandated explicit in the amendment text (per RESEARCH §Pitfall 2): NFC normalization, LF line endings, ECMAScript-`Number.prototype.toString` number canonicalization.

Output: ADR-003 public, amended (FND-02), Invariants/Examples added (FND-04), index row.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@.planning/phases/00-foundation-decisions/00-02-SUMMARY.md
@docs/dev/003-document-shape.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Commit A — `git mv` ADR-003 to public path (no content edits)</name>
  <read_first>
    - docs/dev/003-document-shape.md (full file — 353 lines per RESEARCH; do NOT modify in this task)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 1 + §Pitfall 1
    - .planning/phases/00-foundation-decisions/00-02-SUMMARY.md (pattern proof from plan 02)
  </read_first>
  <action>Run `git mv docs/dev/003-document-shape.md docs/v2/adr/003-document-shape.md` (filename unchanged). Commit with message `docs(adr-003): relocate to public docs/v2/adr/`. Zero content edits. No `--amend`.</action>
  <acceptance_criteria>
    - `test -f docs/v2/adr/003-document-shape.md && ! test -e docs/dev/003-document-shape.md` exits 0.
    - `git log --follow --oneline docs/v2/adr/003-document-shape.md | wc -l` ≥ 2.
    - `diff <(git show HEAD:docs/v2/adr/003-document-shape.md) <(git show HEAD~1:docs/dev/003-document-shape.md)` is empty.
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/adr/003-document-shape.md && ! test -e docs/dev/003-document-shape.md && [ $(git log --follow --oneline docs/v2/adr/003-document-shape.md | wc -l) -ge 2 ]</automated>
  </verify>
  <done>ADR-003 at public path; history extends back.</done>
</task>

<task type="auto">
  <name>Task 2: Commit B — amend ADR-003 with hash-semantics pseudocode (FND-02) + `## Invariants` + `## Examples` + `Tags:` frontmatter</name>
  <read_first>
    - docs/v2/adr/003-document-shape.md (just-relocated file)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-05 — hash pseudocode requirements)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 2 (NFC / LF / number canonicalization) + §Don't Hand-Roll (RFC 8785 reference) + §Example 8 (chunk-level `source_hashes` worked example)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-02-01 + 00-02-02 (exact grep patterns the validator will run)
  </read_first>
  <action>Edit `docs/v2/adr/003-document-shape.md` in place. (1) Add top-of-file YAML frontmatter: `---\ntitle: Normalized Document Shape\nstatus: Accepted\nphase: 0\ntags: document-shape, hash, canonicalization, rfc-8785, source-hashes, property-bag\n---\n` and update existing `**Status:** Proposed` to `**Status:** Accepted`. (2) Add new H2 section `## Hash semantics` AFTER the existing `## Decision` (and after the `Document`/`BlockNode`/`PropertyBag` type definitions) and BEFORE `## Consequences`. The section MUST contain a fenced code block (NOT TypeScript — pseudocode) with the exact shape from RESEARCH §Pitfall 2 / Pseudocode block (the `hash(doc: Document) -> string` function). The block MUST explicitly: (a) cite `RFC 8785` and the human name `JSON Canonicalization Scheme (JCS)`; (b) name `Unicode NFC normalization` as a required step for both keys and values; (c) name `LF line endings` (forbid CRLF) for the blocks-rendered-to-plain-text input; (d) name `ECMAScript Number.prototype.toString` (IEEE 754) for number canonicalization; (e) compute `sha256_hex(utf8(blocks_text || "\\n" || props_json))`. After the fenced code block, include a `### Worked example` subsection with the Atlas/Alice document worked through to a `props_json` string (use the verbatim example from RESEARCH §Pitfall 2 — Document → blocks_text → props_json). (3) Add new H3 subsection `### Chunk-level source_hashes schema` (inside `## Hash semantics`) containing a `type SourceHashes = Record<ChunkId, ChunkHash>` declaration and a YAML brief example matching RESEARCH §Example 8 — a brief in `_memory/_briefs/` with `compiled_from`, `compiled_at`, `source_hashes` map keyed by `<doc-uri>#chunk-<id>`, `confidence`, `status`. (4) Add `## Invariants` section (separately from `## Hash semantics`) with at least 5 normative bullets in `**H-N**:` form (H for hash-related; differentiates from I-N adapter invariants in ADR-002): `**H-1**: Document.hash MUST be computed per the algorithm in §Hash semantics. Adapters MUST NOT substitute alternate canonicalization.`; `**H-2**: PropertyBag JSON canonicalization MUST follow RFC 8785. Implementations MAY use stdlib JSON.stringify only when explicitly verified byte-identical to RFC 8785 output.`; `**H-3**: Input strings (block text and PropertyBag keys/values) MUST be NFC-normalized before hashing.`; `**H-4**: Line endings in rendered block text MUST be LF (0x0A); CRLF is FORBIDDEN.`; `**H-5**: source_hashes is a map from chunk-URI to sha256-hex string; a brief is stale iff any cited chunk's current hash diverges from the recorded value.` (5) Add `## Examples` section AFTER `## Consequences`. Examples MUST include: (a) the Atlas/Alice example expanded with the final sha256 input string shown literally; (b) a parallel `notion-api://` worked example showing how a Notion page maps to the same `Document` shape and how its `properties` (Notion typed properties) canonicalize identically to the Obsidian `PropertyBag` once converted. Commit with message `docs(adr-003): amend with hash semantics (FND-02), Invariants, Examples; status Accepted`.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-02-01: `grep -q 'sha256.*canonical.*PropertyBag' docs/v2/adr/003-document-shape.md && grep -q 'source_hashes' docs/v2/adr/003-document-shape.md && grep -q 'RFC 8785' docs/v2/adr/003-document-shape.md` exits 0.
    - Match VALIDATION row 00-02-02 (BSD-portable, use `grep -E` for alternation): `grep -qi 'NFC' docs/v2/adr/003-document-shape.md && grep -qiE 'LF|line ending' docs/v2/adr/003-document-shape.md && grep -qiE 'number.*canonical|IEEE 754' docs/v2/adr/003-document-shape.md` exits 0.
    - `grep -q '^## Invariants' docs/v2/adr/003-document-shape.md && grep -q '^## Examples' docs/v2/adr/003-document-shape.md`.
    - `grep -q 'obsidian-fs://' docs/v2/adr/003-document-shape.md && grep -q 'notion-api://' docs/v2/adr/003-document-shape.md`.
    - `grep -cE '^\\*\\*H-[1-5]\\*\\*:' docs/v2/adr/003-document-shape.md` ≥ 5.
    - `head -10 docs/v2/adr/003-document-shape.md | grep -q '^tags:' && grep -q '^status: Accepted$' docs/v2/adr/003-document-shape.md`.
  </acceptance_criteria>
  <verify>
    <automated>grep -q 'sha256' docs/v2/adr/003-document-shape.md && grep -q 'source_hashes' docs/v2/adr/003-document-shape.md && grep -q 'RFC 8785' docs/v2/adr/003-document-shape.md && grep -qi 'NFC' docs/v2/adr/003-document-shape.md && grep -qiE 'line ending|LF' docs/v2/adr/003-document-shape.md && grep -qiE 'IEEE 754|number.*canonical' docs/v2/adr/003-document-shape.md && grep -q '^## Invariants' docs/v2/adr/003-document-shape.md && grep -q '^## Examples' docs/v2/adr/003-document-shape.md && grep -q 'notion-api://' docs/v2/adr/003-document-shape.md</automated>
  </verify>
  <done>ADR-003 amended with hash semantics + chunk source_hashes + Invariants + dual-scheme Examples.</done>
</task>

<task type="auto">
  <name>Task 3: Commit C — append ADR-003 row to `docs/v2/adr/README.md`</name>
  <read_first>
    - docs/v2/adr/README.md (with rows from plans 02, 03)
    - docs/v2/adr/003-document-shape.md (read `tags:` frontmatter)
  </read_first>
  <action>Append a row to the `## Accepted v2 ADRs` table after the ADR-002 row: `| 003 | [Normalized Document Shape](003-document-shape.md) | Accepted | 0 | — | document-shape, hash, canonicalization, rfc-8785, source-hashes, property-bag |`. Do NOT touch other rows or sections. Commit with message `docs(adr-003): append ADR-003 row to index`.</action>
  <acceptance_criteria>
    - `grep -qE '^\\| 003 \\|' docs/v2/adr/README.md && grep -q '003-document-shape.md' docs/v2/adr/README.md` exits 0.
    - `[ $(grep -cE '^\\| 00[1-9] \\|' docs/v2/adr/README.md) -ge 3 ]` (rows for 001, 002, 003).
  </acceptance_criteria>
  <verify>
    <automated>grep -qE '^\| 003 \|' docs/v2/adr/README.md && grep -q '003-document-shape.md' docs/v2/adr/README.md && [ $(grep -cE '^\| 00[1-9] \|' docs/v2/adr/README.md) -ge 3 ]</automated>
  </verify>
  <done>ADR index lists ADR-003.</done>
</task>

</tasks>

<verification>
- VALIDATION rows 00-02-01 + 00-02-02 (hash semantics + failure modes) pass for ADR-003.
- VALIDATION rows 00-04-01 / 00-04-02 partial pass for ADR-003.
- Manual: `git log --follow --oneline docs/v2/adr/003-document-shape.md` shows pre-rename history.
</verification>

<success_criteria>
- ADR-003 publicly readable; amended with the hash-semantics requirement that Phase 5 staleness daemon depends on.
- Three canonicalization failure modes (NFC, LF, number) explicit in the text.
- Chunk-level `source_hashes` schema documented with worked brief example.
- ADR index updated.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-04-SUMMARY.md` documenting: the exact pseudocode block adopted (paste it), the H-1..H-5 invariants chosen, history-preservation check, and any deviations from RESEARCH §Pitfall 2 or §Example 8.
</output>