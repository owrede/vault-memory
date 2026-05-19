---
phase: 07-visual-contract-editor-canvas
plan: 12
subsystem: docs
tags: [phase-07, can-09, plugin-docs, documentation]
requires:
  - "Phase 7 plans 07-01..07-11 (feature-complete plugin to document)"
provides:
  - "docs/v2/plugin/INSTALL.md — vm-install skill + manual sideload"
  - "docs/v2/plugin/SETTINGS.md — every settings knob with restart-vs-hot-swap flag"
  - "docs/v2/plugin/SECRETS.md — safeStorage + ${secret:name} + per-device ciphertext"
  - "docs/v2/plugin/CONTRACT-EDITOR.md — three-pane editor walkthrough"
  - "docs/v2/plugin/CONNECTORS.md — peer-MCP via set_mcp_client"
  - "docs/v2/plugin/README.md — index page"
  - "README.md — '## Obsidian plugin (Phase 7 / v2.0.0)' section"
affects:
  - "User discoverability: a reader landing on README sees the plugin path"
tech-stack:
  added: []
  patterns: ["agent-agnostic doc tone (docs/v2/AGENT_AGNOSTIC.md)"]
key-files:
  created:
    - docs/v2/plugin/INSTALL.md
    - docs/v2/plugin/SETTINGS.md
    - docs/v2/plugin/SECRETS.md
    - docs/v2/plugin/CONTRACT-EDITOR.md
    - docs/v2/plugin/CONNECTORS.md
    - docs/v2/plugin/README.md
  modified:
    - README.md
decisions:
  - "Screencast deferred to Phase 8 per orchestrator direction; deferral recorded inline in INSTALL.md + CONTRACT-EDITOR.md + README.md"
  - "STATE.md and ROADMAP.md edits deferred to orchestrator per worktree-mode protocol"
metrics:
  duration: "~30 min"
  completed: 2026-05-19
---

# Phase 07 Plan 12: Plugin documentation set Summary

CAN-09 documentation half closed: five plugin docs + one index + README amendment.
A reader landing on the repo README can install + use + configure the plugin from
the docs alone. Screencast deferred to Phase 8.

## What shipped

### docs/v2/plugin/ (6 files)

| File | Covers |
|---|---|
| INSTALL.md | `vm-install` skill (7-checkpoint flow) + manual sideload (`.obsidian/plugins/vault-memory/` layout); prerequisites; verification; uninstall; sync-substrate caveats |
| SETTINGS.md | Table of every `VaultMemorySettings` key with `Restart-required` column; hot-swappable explicitly noted as in-memory-only across server restarts (config file is authoritative); advanced section call-out |
| SECRETS.md | safeStorage / Schlüsselbund / DPAPI / libsecret; `${secret:name}` syntax + regex; per-device ciphertext implications; Linux `basic_text` fallback + yellow warning; server-side `resolve_secret` resolution flow + failure-mode table; uninstall-leaves-keyring-entries note |
| CONTRACT-EDITOR.md | Three-pane Variant C editor; five palette sections (type catalog, read verbs, assembly verbs, escape-hatch `literal`, peer-MCP dynamic); save cycle with `suppress_contract_write` SuppressionSet integration; `vault-memory://contracts/reloaded` external-edit prompt; walkthrough using `examples/contracts/meeting-prep.contract` |
| CONNECTORS.md | Peer-MCP clients via `set_mcp_client` (including `{list: true}` inventory-read variant); `${secret:name}` resolution flow; test-connection; remove; cloud-source connectors deferred to Phase 10/v3 |
| README.md (index) | TOC + reading order + related references (ADR-007, ADR-006, ARCHITECTURE, AGENT_AGNOSTIC, skills) |

### README.md (root)

New `## Obsidian plugin (Phase 7 / v2.0.0)` H2 section inserted between the
"Adding a second vault" section and the "Architecture in one paragraph" section.
Content:

- One-paragraph What/Why
- Capability summary (editor, settings, secrets, reindex, stats, connectors)
- Install path: `/vm-install` + link to `docs/v2/plugin/INSTALL.md`
- Update path: `/vm-update`
- Screencast-deferred note (links forward to `.planning/ROADMAP.md`)
- Architectural-decisions link to `docs/v2/adr/007-contract-editor.md`

## Cross-references between docs

| From → To | Topic |
|---|---|
| INSTALL.md → SECRETS.md | "Uninstall does not remove keyring entries" |
| INSTALL.md → ROADMAP.md (forward) | Screencast deferral |
| SETTINGS.md → SECRETS.md | Secrets are stored alongside settings in `data.json` |
| SECRETS.md → CONNECTORS.md | `${secret:name}` is referenced from connector env |
| SECRETS.md → CONTRACT-EDITOR.md | `${secret:name}` vs `${alias.field}` distinction |
| CONTRACT-EDITOR.md → SETTINGS.md | `defaultVault` + reranker toggles affect retrieval |
| CONTRACT-EDITOR.md → SECRETS.md / CONNECTORS.md | Peer-MCP palette section 5 |
| CONTRACT-EDITOR.md → ROADMAP.md (forward) | Screencast deferral |
| CONNECTORS.md → SECRETS.md | Server-side resolution and failure modes |
| CONNECTORS.md → CONTRACT-EDITOR.md | Palette section 5 wiring |
| README.md (index) → all five docs + ADR-007 + AGENT_AGNOSTIC + ARCHITECTURE + skills | TOC |
| Root README.md → INSTALL.md / SETTINGS.md / SECRETS.md / CONNECTORS.md / CONTRACT-EDITOR.md / ADR-007 | Discoverability links |

## Acceptance criteria

- [x] All five required docs (INSTALL, SETTINGS, SECRETS, CONTRACT-EDITOR, CONNECTORS) plus index README exist under `docs/v2/plugin/`.
- [x] INSTALL.md references `vm-install` and `vm-update` skills.
- [x] SETTINGS.md contains a table with one row per `VaultMemorySettings` field.
- [x] SETTINGS.md explicitly states hot-swappable settings are in-memory-only across server restarts; config file is authoritative.
- [x] SECRETS.md references `safeStorage`, `${secret:name}`, and the per-device ciphertext caveat.
- [x] CONTRACT-EDITOR.md references the five palette sections and the SuppressionSet.
- [x] CONNECTORS.md references `set_mcp_client` and cross-links to SECRETS.md.
- [x] No doc uses the words "easily", "simply", "just", "blazingly", or "magnificent" (verified by `grep -iEn '\beasily\b|\bsimply\b|\bjust\b|\bblazingly\b|\bmagnificent\b' docs/v2/plugin/*.md` → no output).
- [x] README.md contains the new `## Obsidian plugin` section, references `vm-install`, and links to `docs/v2/plugin/INSTALL.md`.

## Deviations from Plan

### Orchestrator-directed deviations

**1. [Orchestrator decision] Screencast deferred to Phase 8.**

- **Found during:** Plan kickoff (per executor prompt's `<plan_specifics>` block).
- **Issue:** Task 3 of the plan (the `checkpoint:human-action` task) called for recording an ≤8-minute screencast. Per the orchestrator's chain decision, recording is deferred to Phase 8.
- **Fix:** Documented the deferral inline in `INSTALL.md`, `CONTRACT-EDITOR.md`, and the root `README.md` plugin section. Did NOT block on the checkpoint. Did NOT include a broken GitHub Release asset URL in the README (the original plan placeholder linked to `v2.0.0/vault-memory-plugin-walkthrough.mp4`, which would 404 at this point).
- **Files modified:** docs/v2/plugin/INSTALL.md, docs/v2/plugin/CONTRACT-EDITOR.md, README.md (all carry a "Screencast: deferred to Phase 8" note).

**2. [Orchestrator decision] STATE.md and ROADMAP.md edits deferred to orchestrator.**

- **Found during:** Plan kickoff (worktree-mode protocol).
- **Issue:** Plan frontmatter lists `.planning/STATE.md` and `.planning/ROADMAP.md` as `files_modified`. In worktree mode, orchestrator owns these.
- **Fix:** Skipped both edits. Exact orchestrator instructions provided in the "Deferred to orchestrator" section below.

### Auto-fixed issues

None. The plan was pure-Markdown authoring; no Rule 1/2/3 deviations triggered.

## Deferred to orchestrator

The orchestrator must apply the following edits to `.planning/STATE.md` and
`.planning/ROADMAP.md` after merging this worktree. These bookkeeping edits
are required for CAN-09 closure per Plan 07-12 Task 3 (deferred path).

### `.planning/STATE.md` — append to Phase 7 section

Append the following bullets under the Phase 7 status block (typically under
"### Phase 7 — Visual contract editor + canvas"):

```markdown
- CAN-09 docs complete; screencast deferred to Phase 8 (REL-XX bookkeeping)
- Plan 07-12 merged 2026-05-19 — five plugin docs + README amendment landed
- Phase 7 implementation complete; release polish + screencast tracked in Phase 8
```

If STATE.md tracks a "Current Plan" pointer for Phase 7, advance it past 07-12
(plan 12 is the last in the phase). If STATE.md has a Phase 7 "Status" field,
set it to `complete` (or `complete-pending-phase-8-screencast` if the
orchestrator's vocabulary distinguishes).

### `.planning/ROADMAP.md` — Phase 7 checkbox + Phase 8 backlog

In the Phase 7 entry, mark CAN-09 (or the equivalent Phase 7 completion
checkbox) as complete:

```markdown
- [x] CAN-09 — Plugin distribution + documentation (docs half merged 2026-05-19; screencast deferred to Phase 8)
```

In the Phase 8 section (or `.planning/BACKLOG.md` if that file exists),
append:

```markdown
- [ ] Phase 8 backlog: ≤8-minute screencast covering install → first contract authored → first `instantiate_contract` call (CAN-09 carryover from Phase 7). Storyboard per Plan 07-12 Task 3. Publish as `vault-memory-plugin-walkthrough.mp4` GitHub Release asset on the v2.0.0 tag; update README.md link to point at the resolved URL.
```

### Optional README cleanup after Phase 8 ships the screencast

When the screencast is published, update the root `README.md` "Obsidian
plugin" section: replace the deferral note with a real link to the GitHub
Release asset (`https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4`
or whatever URL the asset resolves to). Same update in
`docs/v2/plugin/INSTALL.md` and `docs/v2/plugin/CONTRACT-EDITOR.md`.

## Tone / quality check

`grep -iEn '\beasily\b|\bsimply\b|\bjust\b|\bblazingly\b|\bmagnificent\b' docs/v2/plugin/*.md`
returns no matches. All five docs follow the AGENT_AGNOSTIC.md terse,
technical, second-person tone.

## Self-Check: PASSED

**Files created:**
- FOUND: docs/v2/plugin/INSTALL.md
- FOUND: docs/v2/plugin/SETTINGS.md
- FOUND: docs/v2/plugin/SECRETS.md
- FOUND: docs/v2/plugin/CONTRACT-EDITOR.md
- FOUND: docs/v2/plugin/CONNECTORS.md
- FOUND: docs/v2/plugin/README.md

**Files modified:**
- FOUND (sectioned): README.md — `## Obsidian plugin (Phase 7 / v2.0.0)` section present

**Commits:**
- FOUND: 4f47776 docs(07-12): add plugin documentation set
- FOUND: 54b62d3 docs(07-12): extend README.md with Obsidian plugin section

**Plan automated verify command:** ALL VERIFY CHECKS PASS (run inline).
