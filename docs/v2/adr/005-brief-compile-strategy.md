---
title: Brief Compile Strategy
status: Accepted
phase: 5
tags: briefs, llm-ladder, chunk-id, recompile, lockfile, staleness
depends-on: ADR-001, ADR-002, ADR-003, ADR-004
---

# ADR-005: Brief Compile Strategy

**Status:** Accepted — Phase 5 foundation
**Date:** 2026-05-18
**Scope:** Phase 5 (compiled brief layer — `compile_brief`, `get_brief`,
`list_briefs` Resource, staleness daemon, `brief_sources` reverse-index)
**Depends on:** ADR-001 (Document Identity), ADR-002 (Adapter Seams),
ADR-003 (Document Shape — Invariants H-3 / H-4 / H-5 / H-6),
ADR-004 (Memory Sink Handles)
**Related:** [`docs/v2/MEMORY_CONTRACT.md`](../MEMORY_CONTRACT.md);
PHASE-5 plans 05-01..05-04
**Supersedes:** —
**Superseded by:** —

## Context

vault-memory v1 is a strong retrieval substrate. The diagnostic failure mode
v2 must beat is `PROJECT.md`'s "**agents rediscover ~85% of context every run**":
without a compiled artifact that the agent can read in one tool call,
every session re-pays the cost of searching, expanding, and synthesizing
a multi-document picture from scratch. The compiled-brief layer makes that
synthesis a first-class `Document` living inside `_memory/_briefs/` — agent
calls `get_brief({target: "atlas-q3-status"})` and either receives a fresh
brief or a `null` with the changed-source list, in which case the agent
re-runs `compile_brief` with current sources.

The Phase 4 sign-off note (`docs/v2/PHASE-4-SIGN-OFF.md`) hands off the
compile path:

> brief compiler will use `cluster()` over `_memory` + `expand()` from the brief
> target to gather citation packets, then the LLM-strategy ladder (MCP Sampling
> → local Ollama → caller-passed text per the Phase 5 ADR) compiles them into
> a brief Document.

This ADR locks the strategy decisions that Phase 5 implementation rests on,
**before** any `src/brief/*.ts` is written (matches the Phase 0 / Phase 2 /
Phase 4 discipline of authoring the ADR up front).

## Decision: Capability-first LLM ladder

`compile_brief` resolves the LLM provider per-call by walking a four-tier
ladder in order. The first tier whose precondition is satisfied wins;
later tiers are never consulted. No silent degradation: if no tier is
available the tool returns a **structured error**, never a partial brief.

### Tier 1 — MCP Sampling (SDK 1.29)

If `server.server.getClientCapabilities()?.sampling` is set, call
`server.createMessage({ messages, maxTokens })`. This routes the
brief-compile to the **caller's** LLM (Claude Code's, ChatGPT's, etc.).

Properties:

- Zero LLM coupling on the vault-memory side — we never bundle an
  OpenAI / Anthropic / Cohere / etc. SDK.
- Cost lives with the caller, where the user already has billing set up.
- Cross-client portable per ADR-002 §"capability-first dispatch".

### Tier 2 — Local Ollama

If the per-vault config `~/.vault-memory/config.toml` contains
`[brief.ollama] model = "..."`, call
`http://localhost:11434/api/chat` via the existing `OllamaClient`
(`src/ollama/client.ts`). Reuses the same retry / batching / error
machinery as embedding calls. Strictly localhost — no outbound network
beyond what v1 already does for embeddings (CONSTRAINTS in `CLAUDE.md`:
"Local-only network — `localhost:11434` (Ollama) only in v2").

### Tier 3 — Caller-supplied `prepared_text`

If the caller passes the additive `prepared_text?: string` field on the
`compile_brief` input, skip LLM invocation entirely and stitch
`prepared_text` into the brief Document with provenance preserved. This
covers:

- Air-gapped operation where neither Sampling nor Ollama is available.
- Deterministic test fixtures (eval YAMLs supply known-good text).
- Specialised callers that already ran their own LLM and want
  vault-memory to play purely as a typed write-and-link surface.

### Tier 4 — Structured error

If none of Tier 1 / 2 / 3 apply, return:

```json
{
  "ok": false,
  "reason": "no_llm_strategy_available",
  "attempted": ["sampling", "ollama", "prepared_text"],
  "hint": "configure [brief.ollama] in config.toml, use a sampling-capable MCP client, or pass prepared_text"
}
```

The error is **structured**, never thrown — callers can branch on
`reason` deterministically.

### Prompt template skeleton

Tier 1 / Tier 2 dispatch builds a markdown skeleton from the brief's
`purpose` field plus the resolved citation packets:

```
# Brief: {target}

## Purpose
{purpose}

## Synthesis
{LLM-generated body — MUST use [[Note Title]] wikilinks per cited source}

## Sources
{appended by BriefBodyValidator if any source missing from body}
```

The exact wording of the system / user messages is researcher discretion
and lives next to the prompt builder in `src/brief/compile.ts`. The
invariant is the `[[wikilink]]`-per-source emission — captured by D-11
and enforced by `BriefBodyValidator`.

## Decision: Chunk-level `source_hashes` (ChunkId)

**`ChunkId = <DocId>#chunk-<n>`** where `<n>` is the **first 7 hex chars of
`sha256(NFC(LF-normalized, trimEnd(text)))`**.

Re-references ADR-003 §"Chunk-level source_hashes schema":

- **H-3 (NFC).** The chunk text is normalized to Unicode NFC before
  hashing. The same logical string encoded differently (precomposed vs
  decomposed) produces the same fragment. Without this, syncing across
  macOS↔Linux↔iCloud can flip ChunkIds for unedited content.
- **H-4 (LF).** CRLF is normalized to LF (`\r\n` → `\n`). Without this,
  a Git-checkout-on-Windows can flip ChunkIds for unedited content.
- **H-5 (chunk-level granularity).** `source_hashes` keys are ChunkIds,
  not DocIds. Editing chunk 3 of a 50-chunk doc invalidates exactly one
  brief source entry; chunks 1, 2, 4-50 stay fresh.
- **H-6 (versioned-API hash inclusion).** Hash flavour is `sha256:` —
  the migration path for a future flavour switch (e.g. blake3, xxhash)
  is "all briefs marked stale, recompile required", documented in
  Forward compatibility below.

**Pitfall 8 — trim trailing whitespace.** The canonicalization includes
`trimEnd()`. The following two texts produce the same fragment:

```
"# Hello\n\n"
"# Hello"
```

Rationale: editors silently add or remove trailing newlines; we do not
want a brief invalidation cascade from a save-with-newline-at-end-of-file
preference flip.

**Content-only, not context-sensitive.** Two chunks in different
documents with byte-identical (post-canonicalization) text produce the
same fragment. Disambiguation comes from the `<DocId>` prefix in the
public ChunkId. Worked example:

```
obsidian-fs://atlas/projects/Atlas-1.md#chunk-a3f5b2c
obsidian-fs://atlas/meetings/2026-04-12.md#chunk-a3f5b2c
```

are different ChunkIds even though `<n>` collides.

**Storage shape.** Migration 013 adds `chunks.chunk_id_fragment TEXT NOT
NULL DEFAULT ''` and backfills it for every existing chunk in 10k-row
chunks (same pattern as `runMigration008`). `chunks.id` (INTEGER PRIMARY
KEY) stays the DB-internal foreign-key target; the public ChunkId is
assembled at the consumer boundary.

## Decision: Recompile chain auto-supersede

When `compile_brief({target: "X", ...})` is called and a brief with
`target = "X"` already exists, **the new brief auto-supersedes the
old one**.

```
1. resolve oldBrief via lookupBriefByTarget(target)
2. mint newDocId as `_memory/_briefs/{target}--{YYYYMMDDTHHmm}.md`
3. DeliveryAdapter.write(newBrief)                  // Phase 2 chokepoint
4. handleSupersede({                                // Phase 2 D-04 tool
     doc_id: oldBrief.doc_id,
     replacement_doc_id: newBrief.doc_id,
     reason: "recompiled",
   })
```

- `target` is the **stable cross-version handle**. `get_brief({target})`
  follows the supersede chain (Phase 3 D-08 default-hidden filter) and
  returns the freshest non-superseded brief.
- The timestamped slug separator is `--` to disambiguate from a literal
  `-` inside the `target` slug. ISO-8601 compact form (`YYYYMMDDTHHmm`)
  is filename-safe across macOS / Linux / Windows.
- The new brief gets fresh `brief_sources` rows pointing to current
  chunk hashes; the old brief's `brief_sources` rows remain inert
  because the staleness daemon's scan filters out `status: superseded`
  briefs (Phase 3 D-08 default).
- **Forward-only supersede invariant preserved** (Phase 2 D-03): the
  chain forms a DAG, never a cycle. Phase 2's atomicity guarantees
  hold; `handleSupersede` is the only mutation of the old brief.

### Concurrent compile semantics (B-6 invariant)

Two agents call `compile_brief({target: "X"})` simultaneously. Each
agent:

1. Reads its own snapshot of `oldBrief`.
2. Writes its own `newBrief` (distinct timestamps → distinct DocIds).
3. Calls `handleSupersede(oldBrief → newBrief)`.

Outcome: a chain of **two** superseded briefs and **one** active. Phase
2 supersede is atomic per MEM-04, so the chain is well-formed even when
both `handleSupersede` calls land at near-identical wall-clock instants.
This is "eventually consistent at the target slug" — both succeed; the
agent that ran second wins the active position. Acceptable: briefs are
synthesis artifacts; the loser is recoverable via Phase 3
`include_superseded: true`.

## Decision: Brief body shape

Brief body is **plain markdown** (no structured BlockNodes, no per-block
`cited_chunks` arrays). Bodies MUST contain `[[Note Title]]` (Obsidian
wikilink) for every cited `source_doc_id`. The LLM prompt template (in
`compile.ts`) tells the model so; the `BriefBodyValidator` enforces it
at write time:

1. For every `source_doc_id` in the input, extract the source's title
   (notes.title column).
2. Check the LLM-emitted body for at least one occurrence of
   `[[<title>]]` (or `[[<doc_id>]]`).
3. If any source is unreferenced, append:
   ```
   \n\n## Sources\n[[Title 1]]\n[[Title 2]]\n...
   ```
   one per line. The brief is still committed; provenance is preserved;
   the body always contains the wikilinks even when the LLM forgot some.

**Why wikilinks?** Because the Phase 4 D-02 unified-parse indexer
extracts wikilinks → `edges` automatically on the new
`_briefs/*.md` file's create event. Once the indexer runs, the brief is
**graph-native**: `list_backlinks(source_doc)` returns
`{type: "wikilink", source_doc: <brief_doc_id>}` for every source the
brief cites — no Phase 5 code needed for back-edges.

`source_hashes` remains the **staleness contract**; wikilinks are
**discovery only**. The two systems serve different consumers (daemon
vs graph-navigation) and must not be confused.

## Decision: New `default-brief-v1` contract (Pitfall 1 resolution)

`default-memory-v1` (Phase 2) declares
`status: z.enum(["active", "superseded", "archived"])`. Briefs require a
fourth state: `"stale"`. We do **not** widen `default-memory-v1`'s enum.

Reasons:

1. Widening `default-memory-v1` would be an ADR amendment to a Phase 2
   decision. Scope creep beyond Phase 5.
2. Existing memory documents (Phase 2 observations) cannot legally
   enter `stale` — only briefs can. A widened union would mis-type
   non-brief documents.
3. Cleaner narrative: briefs have a distinct lifecycle; modelling them
   with a distinct contract makes the validator's error messages
   sharper.

**Decision:** register `default-brief-v1` as a separate `MemoryContract`
bound to the `_memory/_briefs/` sink. Status enum is
`active | stale | superseded | archived`. Brief-required keys extend
the base seven (`source, confidence, evidence, status, observed_at,
superseded_by, type`) with: `target, purpose, compiled_from,
compiled_at, source_hashes`. Cross-field invariant: when
`status === "stale"`, `source_hashes` MUST be present (the daemon needs
hashes to drive recompute).

## Decision: Lockfile carve-out

`src/brief/lock.ts` (lands in Plan 05-03) acquires
`~/.vault-memory/locks/<vault>.lock` to enforce single-daemon-per-vault
ownership (D-08). The file uses `node:fs/promises` directly. **This is
process state, not vault content.** The adapter-seam invariant
("vault content goes through the adapter") does not apply.

`scripts/lint-adapters.sh` enforces no-fs-outside-adapters via the
`vault-memory:claude-ok` escape marker. `src/brief/lock.ts` carries
that marker on every relevant line (one per import).

## Decision: Sub-folder MemorySink ordering

`_memory/_briefs/` is a **labelled sub-namespace** of `_memory/`
(ADR-004 §"Folder-default sink"). `MemorySinkRegistry.findSinkContaining`
(`src/memory/registry.ts:190-202`) walks the registered sinks in
**insertion order** with `startsWith` matching. Sink ordering is
therefore semantic.

**Invariant:** `_memory/_briefs/` MUST be registered **before** `_memory/`
so a brief write resolves into the brief-specific sink (bound to
`default-brief-v1`), not the parent sink (bound to
`default-memory-v1`, which would reject `status: "stale"`).

**Enforcement:** the config loader (`src/config/loader.ts`) sorts the
`[[memory_sinks]]` array by path-specificity (longest `resource` first)
at parse time. Users do not have to remember the ordering rule in
TOML; the loader normalises.

## Invariants

| ID  | Statement |
|-----|-----------|
| B-1 | Closed source set. `compile_brief` only consumes the `source_doc_ids` the caller passed (D-01). Brief layer is a **compiler**; discovery lives in the agent's orchestration layer (Phase 6 contracts formalise it). |
| B-2 | Capability-first ladder. LLM resolution is Tier 1 → 2 → 3 → 4 (D-10). Tier 4 is a **structured error**, never a thrown exception. |
| B-3 | Recompile is auto-supersede. Two calls to `compile_brief` for the same `target` form a forward-only supersede chain (D-12). |
| B-4 | No remote LLM SDK bundled. Tier 2 is `localhost:11434` only (`OllamaClient`). Tier 1 routes back to the caller's LLM via MCP Sampling. We never bundle OpenAI / Anthropic / Cohere / etc. |
| B-5 | `chunk_id_fragment` is content-only. Two chunks with byte-identical canonical text produce the same fragment; disambiguation comes from the `<DocId>` prefix (D-04). |
| B-6 | Concurrent `compile_brief` for the same target is eventually-consistent. Both calls succeed; the chain forms via Phase 2 supersede atomicity (D-12). |

## Rationale (rejected alternatives)

### LLM strategy (D-10)

- **Option B: bundle one provider SDK (rejected).** Hard-codes a single
  vendor; user pays twice (their LLM subscription + an extra adapter
  layer); violates "local-first, no remote SDK" stance in
  `PROJECT.md`.
- **Option C: Ollama only (rejected).** Forces every user onto Ollama
  even when their MCP client (Claude Code, ChatGPT) is already
  Sampling-capable. Wastes the host's LLM and routes calls outside
  the user's existing billing relationship.

### ChunkId (D-04)

- **Option B: ordinal `<n>` (rejected).** Inserting a paragraph at the
  top of a 50-chunk note shifts every downstream ChunkId. Every brief
  citing any chunk after the insertion goes stale — chunk-level
  granularity is wiped out.
- **Option C: section-anchor compromise (rejected).** Doesn't help on
  mid-section edits; a section-stable ChunkId still flips when content
  inside the section changes. The point of chunk-level granularity is
  to NOT flip in that case.
- **Option D: hybrid section+hash (rejected).** Doubles ChunkId length
  for marginal diagnosability gain. The content hash alone carries
  enough information.

### Recompile (D-12)

- **Option B: overwrite-in-place (rejected).** Loses audit history;
  violates Phase 2 forward-only supersede invariant for `_memory/`
  writes. Memory writes never overwrite — they supersede.
- **Option C: reject-without-explicit-supersede (rejected).** High
  friction. Every common "give me a fresh brief about Atlas" becomes
  two tool calls (supersede + compile).

### Brief body shape (D-11)

- **Option B: structured BlockNodes with per-block `cited_chunks: ChunkId[]` (rejected).** Requires ADR-003 amendment, a structured-output LLM
  prompt (harder, less reliable across Sampling backends), and Phase
  6/7 implications. Defer to v3.
- **Option C: hybrid markdown+sections (rejected).** Block-level
  staleness is a v3 concern; doesn't pay for itself in v2.0.0.

### Status enum widening (Pitfall 1)

- **Option B: widen `default-memory-v1` enum to include `stale` (rejected).**
  Scope creep into Phase 2's ADR. Mis-types non-brief documents
  (observations cannot legally be stale). Cleaner to introduce a
  distinct contract.

## Forward compatibility

### Phase 10 Notion connector

The brief-layer eval YAMLs (BRF-11) parametrise over the source
adapter, so the staleness scenario also runs against the **stub
ChangeFeed**. A hypothetical Notion ChangeFeed would slot into the
same `feed.subscribe()` contract; the brief layer reads
`vault.db.briefSources` (an internal table) regardless of where the
sources live. No brief-layer code changes anticipated for Phase 10.

### v3 block-level staleness

Deferred. If demanded, ADR-003 amendment adds
`cited_chunks: ChunkId[]` to BlockNode; the LLM prompt becomes
structured-output (Phase 6 / 7 contracts may help); the staleness
daemon switches from doc-level to block-level invalidation.

### v3 chunk-hash flavour switching

If `sha256` is replaced by `blake3` / `xxhash` in v3, every brief's
`source_hashes` becomes invalid in one migration step. The migration
plan: write `MIGRATION-V*-TO-V*.md` with a "all briefs marked stale,
recompile required" notice; daemon scans on the v3 boot mark every
brief stale; agents recompile lazily on the next `get_brief` call.
Out of v2 scope.

### `[brief]` config block

Tier 2 (Ollama) reads `[brief.ollama] model = "..."`. v2.x may add
`[brief.lock] timeout_ms = ...` for stale-lock detection tuning,
`[brief.daemon] startup_scan = true|false` for the rare large-vault
opt-out, or `[brief] auto_recompile = true` if user research shows
the manual-recompile friction is real. v2.0.0 ships only
`[brief.ollama]`.
