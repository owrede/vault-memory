# Phase 1: Adapter extraction & tech-debt-up - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 01-adapter-extraction-tech-debt-up
**Areas discussed:** Obsidian-concept reabsorption, Wikilinks-as-schema (defer to Phase 4?)

---

## Selection of gray areas

Six gray areas were presented across two question batches. The user selected exactly two for discussion; the other four were marked Claude's Discretion (researcher + planner decide).

**Presented & not selected (Claude's Discretion):**

| Gray area | Description | Selected |
|-----------|-------------|----------|
| Refactor sequence & PR cadence | Order of three seams + SDK/Zod bump + smoketest + conformance; one mega-PR or sequenced | |
| doc_uri Strategy A staging | Single migration vs split (v7 add nullable, v8 backfill+NOT-NULL); does Phase 1 flip read preference | |
| SDK 1.29 + Zod 4 migration approach | Migrate all 23 tools to registerTool(...) or keep setRequestHandler and bump deps | |
| Stub-adapter conformance suite scope | Interface-shape only / behavioral with fake connector / full v1-baseline eval against stub | |

**User's choice:** "Nothing to discuss here." — defer all four to Claude's Discretion in CONTEXT.md.

**Presented & selected:**

| Gray area | Description | Selected |
|-----------|-------------|----------|
| Obsidian-concept reabsorption strategy | Where do obsidianUrl(), DEFAULT_CLIENT_ID="claude-code", .obsidian/** hardcoded exclude go? | ✓ |
| Non-Claude smoketest target & CI gating | MCP Inspector vs SDK harness; CI merge gate vs README instruction | |
| Wikilinks-as-schema concern (defer to Phase 4?) | Wikilinks deeply embedded in core DB; Phase 1 scope or Phase 4 | ✓ |
| Skip — go straight to planning | (Recommended only if already locked elsewhere) | |

---

## Obsidian-concept reabsorption

Three concrete leaks identified in `.planning/codebase/CONCERNS.md`. Each got a sub-question.

### Sub-question 1 of 3: `obsidian://` URL generation

| Option | Description | Selected |
|--------|-------------|----------|
| SourceConnector.formatDisplayUrl(id) | Each adapter knows how to deep-link its docs. obsidian-fs returns obsidian://, future notion-api returns notion.so/.... Result lands in Document.display_url, propagates into Phase 3 ASM-05 citation packets. | ✓ |
| Capability descriptor + optional method | Add SourceCapabilities.canFormatDisplayUrl: boolean + optional formatDisplayUrl(id). More honest, but adds a branch in every consumer. | |
| DeliveryAdapter / presentation seam (defer) | Stash obsidianUrl() inside obsidian-fs adapter as unexported helper, defer to later src/presentation/ module. Minimal Phase 1 work. | |

**User's choice:** SourceConnector.formatDisplayUrl(id) → string | null
**Notes:** The `display_url` field is already required by Phase 3 ASM-05 (citation packets), so this option also pre-installs the producer side at zero extra cost.

### Sub-question 2 of 3: `DEFAULT_CLIENT_ID = "claude-code"`

| Option | Description | Selected |
|--------|-------------|----------|
| Read from MCP client_info handshake | Capture client name/version from InitializeRequest at server bootstrap, thread as default into write paths. Falls back to "unknown" if absent. Aligns with AGENT_AGNOSTIC.md. | ✓ |
| Static fallback "mcp-client" | Replace literal "claude-code" with neutral "mcp-client". Simple, but loses real attribution — every client looks the same in audit logs. | |
| Require explicit client_id (no default) | Make client_id required on write tools. Forces every client to identify itself, but breaks v1.x tool shape compat (non-negotiable per PROJECT constraints). | |

**User's choice:** Read from MCP client_info handshake
**Notes:** Preserves real audit attribution; does not change tool shapes (client_id arg stays optional and overrides the default when supplied).

### Sub-question 3 of 3: `DEFAULT_EXCLUDES = [".obsidian/**", ...]`

| Option | Description | Selected |
|--------|-------------|----------|
| Adapter-internal defaults inside obsidian-fs | Excludes hardcoded inside src/adapters/source/obsidian-fs/scanner.ts. User config + ListOptions.excludeGlobs override. Future adapters define their own. | ✓ |
| Config-only — no built-in defaults | Adapter ships with empty default excludes; users MUST add .obsidian/** explicitly. Most honest but breaks every existing user on upgrade unless we ship a migration. | |
| Adapter capability + config overlay | Adapter publishes defaultExcludeGlobs in SourceCapabilities; core merges adapter defaults + user config. Useful introspection but low value for v2 (one user). | |

**User's choice:** Adapter-internal defaults inside obsidian-fs
**Notes:** Zero behavior change for existing users; zero leak into core code.

---

## Wikilinks-as-schema concern (defer to Phase 4?)

### Sub-question 1 of 2: Where does the wikilinks abstraction land?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer entirely to Phase 4 | Phase 1 leaves wikilinks table + queries + resolver as-is. Phase 4 GRA-04 introduces typed-edge schema and that's when abstraction happens. CONTEXT.md adds a Phase-4 carry-forward note. | ✓ |
| Minimal Phase 1 hooks for Phase 4 | Move WikilinkResolver into the obsidian-fs source adapter (it's Obsidian-grammar specific), but keep the wikilinks table in core. ~1 file move. | |
| Full abstraction now — rename to `edges` table | Migrate wikilinks → edges with `type` column in Phase 1, rebuild resolver to be edge-type-aware. Expands Phase 1 scope significantly. | |

**User's choice:** Defer entirely to Phase 4
**Notes:** CI greps in Phase 1 do **not** flag the token `wikilink` — it's a legitimate Phase 1 concept; abstraction is Phase 4's job.

### Sub-question 2 of 2: How do extracted wikilinks flow from the obsidian-fs adapter into core after the parseNote() relocation?

| Option | Description | Selected |
|--------|-------------|----------|
| Document.properties.wikilinks: WikilinkRef[] | Adapter populates Document.properties.wikilinks during readDocument(); core wikilinks table + resolver consume the property. Other adapters don't populate. Phase 4 later promotes to Document.edges with type. | ✓ |
| Document.edges: Edge[] (early Phase 4 shape) | Pull forward the Phase 4 Edge shape into Phase 1: obsidian-fs emits Edge[] with type:"wikilink". Cleaner long-term but creeps into Phase 4 scope. | |
| Side-channel — adapter writes wikilinks rows directly | obsidian-fs adapter has direct DB access to wikilinks table. Pragmatic but breaks "adapter is pure interface" and blocks conformance suite from asserting wikilink emission via stub. | |

**User's choice:** Document.properties.wikilinks: WikilinkRef[]
**Notes:** Honors ADR-003 untyped-properties capability for obsidian-fs; gives conformance suite a single Document field to assert against; Phase 4 promotes to Document.edges cleanly.

---

## Claude's Discretion

Five implementation areas deliberately not discussed; researcher + planner decide using ADRs + Phase 0 outputs:

1. PR cadence and refactor sequence (which seam first; how `main` / phase branch stays green)
2. doc_uri Strategy-A staging (single vs split migration; when read-preference flips)
3. MCP SDK 1.29 + Zod 4 migration approach (`registerTool` vs `setRequestHandler`)
4. Stub-adapter conformance suite scope (interface-shape vs behavioral vs eval-grade)
5. `scripts/smoketest-non-claude.mjs` target client (MCP Inspector vs SDK harness vs both) — must run in CI as merge gate

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. Summary:

**To Phase 4:** wikilinks table → edges table with `type` column; Document.properties.wikilinks → Document.edges
**To Phase 2:** memory-sink write guard inside DeliveryAdapter.write()
**To Phase 10 (v3):** VAULT_MEMORY_<SCHEME>_* env-var secrets convention; adapter-private __adapter_<scheme>_* SQLite tables; third-party plugin loading
**Considered, kept out of Phase 1:** `src/config/add-vault.ts` path-safety hardening; pre-migration DB backup; `src/rerank/onnx-reranker.ts` path-ops carve-out (planner's choice)
