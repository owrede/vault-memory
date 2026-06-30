# ADR-033 — Index rendered Datacore/Dataview content via the Obsidian plugin

**Status:** Proposed
**Date:** 2026-06-30
**Phase:** v2.x
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-002 (adapter seams), ADR-007 (Obsidian plugin), ADR-008 (RetrievalBackend seam).
External: Datacore — https://blacksmithgu.github.io/datacore/ , `@blacksmithgu/datacore` npm package.

---

## Context

Obsidian notes can embed **Datacore** views — fenced `datacorejsx` (and Dataview
`dataview`/`dataviewjs`) blocks. These render a *different structure* at view time
(tables, lists computed from the vault), and that rendered structure is exactly
the high-value, queryable content a user would want retrievable.

Today vault-memory's reader takes the raw markdown body (`parsed.content`) and
indexes the **block source verbatim**. Inspection of a real vault (`inarch`, 97
notes / 130 blocks, 100% `datacorejsx`) shows the indexed "content" is JavaScript
— `dc.useQuery("@page")`, `allPages.filter(p => …)`, JSX `<ProjectMeetingsTable>`
— plus 5-line call-site stubs (`dc.require(...); return ProjectMeetingsTable;`).
This is noise for both retrieval engines and wastes chunk budget; a call-site
note whose only body is a stub indexes as gibberish instead of its prose.

### Why we cannot render headless (research, 2026-06-30)
Rendering `datacorejsx` outside the running Obsidian app is **not feasible**.
Confirmed dependencies (Datacore DeepWiki + plugin docs):
- the live Obsidian app + the plugin's in-memory `Datastore` index,
- a Preact runtime and **Sucrase** JSX transpilation at execution time,
- the `dc` global, injected only inside codeblock-execution context.

The complementary **Render API** plugin exposes rendered *Dataview/Tasks/markdown*
over local HTTP but **does not support Datacore**. So no out-of-process route
renders `datacorejsx`. The only place it can render is **inside Obsidian, where
Datacore is active** — i.e. vault-memory's own Obsidian plugin (ADR-007), which
runs in-app and can detect + drive Datacore.

## Decision

**The Obsidian plugin renders Datacore/Dataview blocks (only when Datacore is
active) and feeds the rendered note body to the indexer as a source-hash-keyed
overlay. Headless / Datacore-inactive paths index the raw file (current
behavior).**

### Model — rendered overlay keyed to source hash
- The note's identity stays the on-disk file. The watcher/CLI detect change via
  the **source file hash** as today.
- When the plugin renders note `P` whose current source hash is `H`, it sends the
  **rendered body** plus `H` to a new server tool; the server indexes the
  rendered body but records the index entry as `rendered@H`.
- If the source file later changes (hash `H' ≠ H`), the entry is stale; the next
  raw re-index (watcher/CLI) replaces it with raw content until the plugin
  supplies a fresh render for `H'`.
- If no render is available (Datacore inactive, or headless CLI), index the raw
  file. One note = one index entry; the render is an *override*, not a parallel
  store.

### Components
1. **Plugin (in Obsidian):**
   - On its reindex action (and optionally on file save / a manual "reindex with
     Datacore" command), check `app.plugins.plugins.datacore` (or the
     enabled-plugins set). If absent → do nothing (raw path handles the note).
   - For each note containing a Datacore/Dataview fence, render each block via
     Datacore's API to plain text / markdown (table → pipe-table or TSV-ish text;
     list → bulleted lines), splice the rendered text in place of the fence
     source, and assemble the rendered note body.
   - Call a new MCP tool `index_rendered_note { vault, path, content, source_hash }`.
   - Gated by a plugin setting (default on when Datacore is present).
2. **Server (new MCP tool `index_rendered_note`):**
   - Validate the vault + path; compute the canonical note hash for `content`;
     index it through the SAME pipeline as a normal note (chunks, sections,
     wikilinks, edges, and — per engine — embeddings or ContextFit ingest), but
     using the supplied rendered `content` rather than reading the file.
   - Record the `source_hash` so staleness is detectable.
   - Plugin-gated like the other plugin-control tools (ADR-007 `[plugin].enabled`).
3. **Schema:** add a nullable `notes.rendered_source_hash TEXT` column (migration
   016). NULL = raw-indexed (default, back-compat); non-NULL = a plugin render
   keyed to that source hash. No change to existing rows or the Ollama path.
4. **Reader (lightweight, headless):** OPTIONAL companion — when NOT rendering,
   replace a Datacore/Dataview fence body with a short placeholder
   (`[Datacore view]`) so the raw fallback doesn't index JS source. Keeps prose +
   headings. This is the "inactive" baseline beneath the rendered override.

## Consequences

### Positive
- The actual rendered tables/lists become retrievable — the user's real goal.
- "No need if Datacore is inactive" is satisfied by construction (plugin checks).
- Works for both engines (rendered body flows through the same index pipeline).
- The raw/headless path keeps working unchanged; rendered indexing is additive
  and plugin-gated.

### Negative / accepted
- Requires the Obsidian plugin to be installed + running to capture renders; a
  headless-only deployment (e.g. a NAS with no Obsidian) gets the raw/placeholder
  path, not rendered Datacore. Acceptable — Datacore itself only exists in Obsidian.
- Rendered content can drift from the source until the plugin re-renders; the
  source-hash tag makes drift detectable and self-healing on next reindex.
- Datacore render output is text-flattened (no live interactivity); fidelity is
  "good enough for retrieval," not a pixel-perfect table.
- New surface area: one MCP tool + one migration + plugin render logic + a render
  setting.

### Boundaries
- Render logic lives in the plugin (the only place Datacore is reachable);
  vault-memory core stays Obsidian-agnostic (ADR-002).
- `index_rendered_note` is plugin-gated; default-off deployments see no new tool
  (preserves the tool-list snapshot for non-plugin installs).

## Rollout (suggested phases)
1. **Reader placeholder** (headless baseline) — strip Datacore fence source to a
   placeholder so raw indexing isn't polluted. Small, immediate.
2. **Server `index_rendered_note` + migration 016** — the ingest path + overlay.
3. **Plugin render + setting** — detect Datacore, render, push. The payoff.

Each phase is independently shippable and testable; phase 3 is the largest.
