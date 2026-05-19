# Phase 8: Polish, eval suite, v2.0.0 release - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Cut **v2.0.0** — take the pile of shipped phases (Phase 2 memory namespace, Phase 3 assembly, Phase 4 graph, Phase 5 briefs, Phase 6 contracts, Phase 7 plugin) and ship them as a releasable, marketable, npm-published package. **No new product features in Phase 8.** Every deliverable is documentation, eval-suite wiring, release engineering, or carryover finishing work from Phase 7.

Phase 8 closes the v2.0.0 milestone. After Phase 8, the project enters Phase 9 (HARD GATE) → Phase 10/v3 (Notion connector, deferred).

The deliverables fall into six buckets:

1. **Eval suite as merge gate** — REL-01. The existing CI already runs `npm test` + `npm run eval:baseline` + `scripts/smoketest-non-claude.mjs`. Phase 8 locks this AS a required-for-merge gate via GitHub branch protection and confirms the three components (v1-baseline + v2-fixtures + stub-adapter conformance) cover the v2 surface.

2. **CHANGELOG curation + completeness audit** — REL-02. The current `[Unreleased]` block has Phase 4 + Phase 6 entries. Phases 2 (memory), 3 (assembly), 5 (briefs), 7 (plugin) appear to be missing. Phase 8 audits each phase's SIGN-OFF / SUMMARY artifact and backfills every user-visible change before renaming the block to `[2.0.0] - YYYY-MM-DD`.

3. **README rewrite + MIGRATION guide** — REL-03/04/05/09. README rewritten practical-first (install → first contract instantiation → pitch → architecture → roadmap-with-Phase-9/v3). MIGRATION-V1-TO-V2.md primarily for downstream library consumers (SDK 1.29 + Zod 4 bump notes, type-import changes, no-breaking-change tool delta) with a short end-user upgrade appendix.

4. **Tool surface promotion (REL-08)** — ship at ≤32 tools via MCP Resources promotion. Current default surface is 37 tools (post-Phase 6, with Phase 7 plugin tools default-OFF). Promote 5+ list-style tools to Resources to hit ≤32 (precedent: BRF-09, Phase 6 `list_contracts` + `list_contract_verbs`).

5. **Release ritual + sign-off** — REL-06/07/09. Single `npm run release` script (version bump + CHANGELOG rename + git tag + push) hands off to the existing `publish.yml` workflow (npm publish + GitHub Release auto-create). `docs/v2/PHASE-8-SIGN-OFF.md` mirrors prior phases.

6. **Phase 7 carryovers** — the ≤8-min plugin walkthrough screencast and the v2.0.0 GitHub Release assets (`vault-memory-plugin-v2.0.0.tar.gz` + `manifest.sha256`) that unblock the `vm-install`/`vm-update` skills (replace `RELEASE_URL_PLACEHOLDER` in the skill scripts).

**MVP mode is set on this phase** (ROADMAP.md `**Mode:** mvp`). The planner organizes Phase 8 plans as vertical slices: each slice ends with a maintainer-visible artifact landing on disk and a piece of the release pipeline working end-to-end. The "thinnest end-to-end working slice" interpretation for a release phase is "tag-to-published-npm-package + GitHub Release with valid assets" — every plan moves measurably closer to that.

**Operating environment (inherited)** — solo maintainer (Oliver), local-first, no telemetry, no remote LLM SDK, no marketing superlatives, MIT license. v2.0.0 ships when Oliver decides. The release ritual is automated where it removes friction without hiding what's happening.

**Scope discipline:** Phase 8 does NOT add new MCP tools, new connectors, new file formats, new editor features. It curates, documents, promotes-to-Resources (which is an additive surface change, not a new tool), and ships. Any "while we're here, we should also..." goes to Deferred Ideas.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-19, single discuss-phase session). All four primary gray areas and all four ritual/process decisions resolved by accepting Claude's recommendations. Decisions are recorded with `D-` IDs for downstream agent reference. Claude's reasoning per area is in `08-DISCUSSION-LOG.md`.

### Tool Surface (REL-08)

- **D-01 / REL-08-TARGET: Ship v2.0.0 at ≤32 tools via MCP Resources promotion.** Phase 6 sign-off explicitly deferred REL-08 retirement into Phase 8 (Pitfall F7). The current default surface (plugin OFF) is 37 tools. Promote 5+ list-style tools to MCP Resources to hit ≤32. Plugin-gated tools (6 added in Phase 7, default OFF) are NOT counted against REL-08 per the existing snapshot-test gating.

- **D-02 / REL-08-CANDIDATES: Promotion candidates (planner finalizes the closed set).** Initial list — planner audits the v1 surface + Phase 2–6 additions and picks 5+ from this list (or proposes alternatives with rationale):
  - `list_vaults` → `vault-memory://vaults` Resource
  - `list_models` → `vault-memory://models/{vault}` Resource
  - `list_aliases` → `vault-memory://aliases/{vault}` Resource
  - `recent_notes` → `vault-memory://recent/{vault}` Resource (list-style)
  - `vault_stats` → `vault-memory://stats/{vault}` Resource (read-only enumeration; aligns with Phase 7 PLG-04 stats panel reading)
  - `list_briefs` (BRF-09) — already promoted in Phase 5; verify
  - `list_contracts` + `list_contract_verbs` (Phase 6) — already promoted; verify
  - Audit-log list-style endpoints — candidate if planner finds any that are pure enumeration
  - The closed set lands as part of plan 08-XX with rationale per choice.

- **D-03 / REL-08-PROCESS: Each promotion is additive then deprecating.** v2.0.0 ships the Resource AND keeps the Tool (deprecated in description, removed in v3.0.0). Backwards-compat rule from PROJECT.md: "Backwards compat non-negotiable until a major version. Net-new tools get net-new names." Promotion is the inverse — Tool stays callable; Resource is the canonical agent-discovery path. v3.0.0 removes the deprecated tools. Plan: deprecation notice in tool description, CHANGELOG entry per promoted tool, snapshot test updated to reflect both surfaces.

- **D-04 / REL-08-SNAPSHOT: `evals/v1-baseline/tools-list.snapshot.json` updated, NOT broken.** The snapshot test must continue to pass. Promoted tools remain in the snapshot (with deprecation notice in their descriptions). New Resources are NOT in the tools-list snapshot — they have their own Resource snapshot at `evals/v2-fixtures/resources-list.snapshot.json` (planner creates if absent).

### Eval Suite + CI Gate (REL-01)

- **D-05 / REL-01-COMPONENTS: "Full eval suite" = v1-baseline + v2-fixtures + stub-adapter conformance.** Literal interpretation of ROADMAP.md success criterion 2. The components already exist in CI today:
  - `evals/v1-baseline/baseline.test.ts` + per-tool YAMLs — runs via `npm run eval:baseline`
  - `evals/v2-fixtures.test.ts` — runs via `npm test`
  - `src/adapters/{source,delivery,change-feed}/conformance.test.ts` — runs via `npm test`
  - `scripts/smoketest-non-claude.mjs` — runs as a CI step on `dist/cli.js`
  Per-phase eval scenarios (ASM dossier queries, GRA expansion queries, BRF staleness, CON contract scenarios) ARE part of `evals/v2-fixtures.test.ts` or co-located unit tests and already run.

- **D-06 / REL-01-GATING: Required-for-merge with NO maintainer override.** GitHub branch protection on `main` requires the `lint-and-test` job (existing `.github/workflows/ci.yml:jobs.lint-and-test`) to pass before merge. No `[skip eval]` token, no `eval-bypass` label, no documented override route. Rationale: solo maintainer can still force-push to `main` in a genuine emergency (the gate is intentionally annoying to bypass, not impossible), but introducing a sanctioned override defeats the gate culturally. Aligns with CLAUDE.md / RULES.md `🔴 CRITICAL: Never Skip Tests`. Phase 8 deliverable: branch protection ruleset configured + documented in CONTRIBUTING.md.

- **D-07 / REL-01-CI-MATRIX: Single Linux runner is sufficient for v2.0.0.** No Windows/macOS CI matrix in v2.0.0. The MCP Inspector smoketest covers the "any MCP-aware agent" promise mechanically. macOS-specific concerns (safeStorage, Schlüsselbund) live in the plugin — its own test suite handles them. Multi-OS CI is a v2.x add when demand surfaces.

### CHANGELOG (REL-02)

- **D-08 / REL-02-AUDIT: Phase 8 first task audits every phase 2–7 SIGN-OFF / SUMMARY artifact and backfills missing CHANGELOG entries.** Current `[Unreleased]` block has Phase 4 + Phase 6 only. Phase 2 (memory namespace), Phase 3 (assembly), Phase 5 (briefs), Phase 7 (plugin) entries appear to be missing. The audit-task reads each phase's sign-off doc, extracts user-visible changes (new MCP tools, new Resources, new config blocks, new file formats, new dependencies, behavior changes), and appends entries grouped by category (Added / Changed / Deprecated / Removed / Fixed / Security per Keep-a-Changelog).

- **D-09 / REL-02-CURATION: Curate after backfill.** Once `[Unreleased]` contains every user-visible v2 change, do a final pass for:
  - Voice consistency (terse, technical, no marketing language)
  - Cross-references to ADRs and SIGN-OFF docs verified (every `docs/v2/...` link resolves)
  - Tool-count deltas reconciled with REL-08 final state (link to the Resources-promotion plan)
  - Plugin section explicitly framed as default-OFF (so users don't expect plugin tools by default)

- **D-10 / REL-02-FORMAT: Keep the existing Keep-a-Changelog format.** Don't restructure. The footer release recipe stays; the `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD` rename is what the release script automates (D-13).

### README + MIGRATION (REL-03, REL-04, REL-05, REL-09)

- **D-11 / REL-03-04-SHAPE: README practical-first, 6 sections.** Order:
  1. **30-second example** — `npm install -g @owrede/vault-memory`, `vault-memory add-vault ~/Notes`, `vault-memory serve`, claude-desktop config snippet, a one-paragraph "what you can now do" (e.g., "ask the agent to summarize last week's meetings — it instantiates a `meeting-prep` contract").
  2. **What this is** — 30-second pitch: "agentic knowledge layer over Obsidian; more sources coming."
  3. **Architecture (one diagram)** — the L0…L5 layer model from `docs/v2/ARCHITECTURE.md`, rendered as a single ASCII or SVG diagram. Phase 8 picks ASCII for in-README rendering (no external assets).
  4. **What's new in v2** — bullet list of v2 capabilities (memory namespace, assembly, graph, briefs, contracts, plugin) with one link each.
  5. **Roadmap** — explicit "Phase 9 hard gate; v3.0.0 (Phase 10) adds Notion as a second source" wording per REL-04. Names the post-v2 line.
  6. **Install & docs** — links to `docs/v2/INSTALL.md` (skill-based + manual), `docs/v2/plugin/README.md`, `docs/v2/MIGRATION-V1-TO-V2.md`, `docs/v2/ARCHITECTURE.md`, ADRs.
  Tone: tight, technical, zero marketing superlatives ("blazingly fast", "magnificent", etc. are banned per CLAUDE.md / RULES.md `Professional Honesty`). No emoji except where they're already in CHANGELOG.

- **D-12 / REL-05-SHAPE: MIGRATION-V1-TO-V2.md targets downstream library consumers PRIMARILY + short end-user appendix.** ~3 pages total.
  - **Main body (library consumers):** SDK 1.29 bump notes, Zod 4 bump notes, `verbatimModuleSyntax: true` and type-import changes, no-breaking-change tool API delta (every v1 tool's shape preserved; net-new tools have net-new names), branded `DocId` nominal type implications for downstream TS users.
  - **Appendix "What's new at runtime":** one paragraph per phase pointing at the user-facing surface (memory namespace, assembly tools, graph tools, briefs, contracts, plugin). Each paragraph links to that phase's SIGN-OFF + the relevant section of README. No per-tool migration notes — additive surface means there is nothing to migrate.
  - Sign-off (REL-09): maintainer reads README + MIGRATION + signs PHASE-8-SIGN-OFF.md (D-14).

### Screencast + Release Assets (Phase 7 carryovers)

- **D-13 / SCREENCAST: Strict 5–7 min storyboard, GitHub Release MP4 only.** Storyboard (planner refines exact beats):
  1. (0:00–1:00) Install via `vm-install` skill — show the skill run, prompt to enable in Obsidian.
  2. (1:00–2:00) Open `examples/contracts/meeting-prep.contract` in Obsidian — the visual editor opens automatically; palette + canvas + inspector visible.
  3. (2:00–3:30) Edit one verb arg in the inspector — show the typed-form autocomplete + the live `.yaml` regenerating on save.
  4. (3:30–5:00) Switch to a terminal / Claude Desktop / MCP Inspector — call `instantiate_contract({name: "meeting-prep", inputs: {...}})` — show the brief returned.
  5. (5:00–7:00) Quick tour of plugin chrome — stats panel, secrets entry, reindex trigger, connectors panel.
  ≤8 min hard cap. Recording: macOS native screen recording (QuickTime) + a tiny intro/outro title card. Export as MP4 1080p. No background music. Captions baked in as static title-card highlights (no separate VTT file in v2.0.0 — accessibility is a v2.x improvement).

- **D-14 / SCREENCAST-HOST: GitHub Release asset `vault-memory-plugin-walkthrough.mp4`.** Linked from `README.md`, `docs/v2/plugin/INSTALL.md`, `docs/v2/plugin/CONTRACT-EDITOR.md`. Each linking site embeds a static thumbnail PNG (`docs/v2/plugin/screencast-thumbnail.png`) → click-through to the GitHub Release MP4. No YouTube dependency. Replace the existing deferral notes in those files with the resolved release URL.

- **D-15 / RELEASE-ASSETS: Minimum required asset set for v2.0.0.**
  - `vault-memory-plugin-v2.0.0.tar.gz` — built plugin tarball that `vm-install` consumes
  - `manifest.sha256` — checksum for `vm-install` integrity check
  - `vault-memory-plugin-walkthrough.mp4` — the screencast (D-13)
  - Auto-attached by GitHub: source zip + tarball
  - **Excluded:** standalone eval-fixture tarball (downstream consumers get evals via `git clone` or the npm package), prebuilt CLI binary (the npm tarball IS the binary distribution), separate docs bundle (docs/ ships in the npm package). Rationale: each extra asset adds a maintenance cost per release with no clear consumer.

- **D-16 / RELEASE-URL-RESOLUTION: Replace `RELEASE_URL_PLACEHOLDER` in `skills/vm-install/setup.sh` and `skills/vm-update/update.sh` as part of the v2.0.0 release plan.** Plan 08-XX runs a sed/replace on these two files with the resolved GitHub Release URL pattern, commits, and re-tags if needed (or, preferred: the URL is templated from `package.json.version` at install-script run time so no per-release commit is needed — planner picks the lower-friction option).

### Release Ritual + Sign-off (REL-06, REL-07, REL-09)

- **D-17 / RELEASE-SCRIPT: `npm run release` is a single script.** `scripts/release.mjs` (Node ESM, matches the project's runtime).
  - Prompts for `version` (defaults to next-patch from `package.json.version`).
  - Validates: clean working tree, on `main` branch, `[Unreleased]` block exists in CHANGELOG.md and is non-empty.
  - Runs `npm test` locally before any mutation (fail-fast).
  - `npm version <version> --no-git-tag-version` (bumps `package.json` + `package-lock.json`).
  - Renames CHANGELOG `## [Unreleased]` → `## [<version>] - <YYYY-MM-DD>` and inserts a fresh `## [Unreleased]` block above it.
  - `git add` + `git commit -m "release: vX.Y.Z"` + `git tag -a vX.Y.Z -m "vX.Y.Z"` + `git push origin main vX.Y.Z`.
  - Print confirmation that `.github/workflows/publish.yml` (which already exists, triggers on `v*.*.*` tag push, and handles npm publish + GitHub Release creation using the CHANGELOG section as the release body) will take over from here.
  - Documented in `CONTRIBUTING.md` § "Cut a release" — one paragraph, points at the script.

- **D-18 / SIGN-OFF: `docs/v2/PHASE-8-SIGN-OFF.md` artifact.** Mirrors Phase 4 / Phase 6 / Phase 7 sign-off pattern. Sections:
  - Success Criteria — each of the 5 ROADMAP criteria with evidence link (test path, commit hash, file diff, screenshot)
  - Requirements coverage — REL-01..REL-09, each linked to the implementing plan or artifact
  - Phase 7 carryovers — screencast + GitHub Release assets, both resolved
  - Tool surface inventory — final count post-promotion, link to snapshot
  - Maintainer sign-off line at the bottom (Oliver signs after reviewing README + MIGRATION + final eval-suite green run on the release commit)
  - One file, ~1 page. Committed before the release tag is pushed (so the tag includes the sign-off in the source tree).

### Claude's Discretion

Several implementation areas are deliberately not discussed. Planner + researcher choose, anchored by the locked decisions above + ROADMAP + REQUIREMENTS framing + the v1.x CI patterns already in `.github/workflows/`.

- **Exact Resources-promotion implementation** — which 5+ tools, the URI templates, the snapshot-test extension shape. Planner finalizes in the REL-08 plan. Constraint: the closed set must hit ≤32 default tools at v2.0.0 ship.
- **CHANGELOG entry voice for backfilled phases** — terse, technical, no superlatives is the rule; the planner writes drafts and the maintainer edits at sign-off.
- **Branch protection ruleset implementation** — UI configuration in GitHub Settings vs `.github/branch-protection.yml` declarative config. If the declarative format is mature enough, prefer that for auditability. Planner researches.
- **`npm run release` script exact prompts and confirmations** — what to validate, what to confirm interactively, what to refuse without `--force`. Planner picks based on `safe-by-default` principle.
- **README architecture diagram** — ASCII or SVG. ASCII is the recommendation for in-README rendering without an external asset; planner verifies layout is readable in both GitHub's web view and a 100-col terminal.
- **MIGRATION end-user appendix breadth** — one paragraph per phase (Phase 2/3/4/5/6/7) is the recommendation; planner expands if a phase's surface is large enough to warrant two paragraphs.
- **Screencast intro/outro card design** — minimal text, project logo if one exists, version number. No motion graphics. Planner sketches; maintainer approves.
- **Screencast thumbnail (`docs/v2/plugin/screencast-thumbnail.png`) shape** — a still frame from the screencast or a custom-composed thumbnail. Planner picks based on what reads at 600px wide in a README.
- **Release script error-handling depth** — how much to validate (dirty tree, wrong branch, missing CHANGELOG block) vs how much to trust the maintainer. Lean toward thorough validation since releases are rare and a botched release is expensive.
- **CONTRIBUTING.md scope** — Phase 8 adds the "Cut a release" section and the eval-gate-no-override note. The rest of CONTRIBUTING.md (commit conventions, PR workflow, code style) is out of Phase 8 scope unless it's currently missing (planner checks; if missing, planner proposes a minimal version).
- **Manifest sha256 generation** — `shasum -a 256` on the tarball at release-script time, committed to the release as a separate file. Planner picks shell tool (shasum vs openssl dgst).
- **Phase 7 plugin CHANGELOG entry depth** — Phase 7 added a lot. Planner drafts a concise summary (one bullet per CAN-*/PLG-* group) rather than an exhaustive per-task list.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 8 framing (the WHAT)

- `.planning/REQUIREMENTS.md` §"Release & Polish (Phase 8 — v2.0.0)" — REL-01..REL-09 (the locked deliverable list)
- `.planning/ROADMAP.md` §"Phase 8: Polish, eval suite, v2.0.0 release" — goal + 5 success criteria + Phase 7 carryover notes + `**Mode:** mvp`
- `.planning/PROJECT.md` — v2 mission, constraints (no telemetry, MIT license, local-first, no marketing language), backwards-compat invariants
- `.planning/STATE.md` — Phase 7 sign-off summary; Phase 8 carryover list; current tool count (default 37; +6 with `plugin.enabled=true`)

### Prior phase sign-offs (CHANGELOG audit source — D-08)

- `docs/v2/PHASE-4-SIGN-OFF.md` (path verified in REQUIREMENTS.md traceability)
- `docs/v2/PHASE-6-SIGN-OFF.md` (path mentioned in CHANGELOG `[Unreleased]`)
- `.planning/phases/02-memory-namespace-provenance-contract/02-SUMMARY.md` (if present — verify path)
- `.planning/phases/03-bundles-authority-staleness/03-SUMMARY.md` (if present — verify path)
- `.planning/phases/05-compiled-brief-layer/05-SUMMARY.md` (if present — verify path)
- `.planning/phases/07-visual-contract-editor-canvas/07-SUMMARY.md` or sign-off equivalent — Phase 7 was just signed off 2026-05-19 per STATE.md
- Each phase's `*-CONTEXT.md` for the decision rationale that should surface in the CHANGELOG

### Existing release infrastructure (extend, don't rebuild)

- `.github/workflows/ci.yml` — already runs lint + test + eval:baseline + smoketest on PRs and main. Phase 8 confirms this is the merge gate (D-06) and updates branch-protection to require it.
- `.github/workflows/publish.yml` — already triggers on `v*.*.*` tag push, runs full test suite, publishes to npm with `--access public` and provenance, then auto-creates the GitHub Release using `softprops/action-gh-release` with the matching CHANGELOG section as the release body. Phase 8 verifies this works end-to-end on a dry-run tag (e.g., `v2.0.0-rc1`) before cutting v2.0.0.
- `CHANGELOG.md` — Keep-a-Changelog format; `[Unreleased]` block + footer release recipe. Phase 8 audits + backfills + renames.
- `package.json` — `version: 1.0.0` today; release script bumps to `2.0.0`. `bin: {vault-memory: "dist/cli.js"}`, `files: ["dist", "README.md", "LICENSE"]`, `engines: {node: ">=22"}`, `type: "module"` — none of these change in Phase 8.
- `scripts/smoketest-non-claude.mjs` — verifies the "any MCP-aware agent" promise mechanically; runs in CI; Phase 8 verifies it still asserts the right surface after Resources promotion (the assertion list may need to add Resources checks).
- `evals/v1-baseline/tools-list.snapshot.json` — pinned tool surface; updated by REL-08 promotion plan to reflect deprecation notices (D-04).
- `evals/v1-baseline/baseline.test.ts` + per-tool YAMLs — eval suite v1 component; runs unchanged.
- `evals/v2-fixtures.test.ts` — eval suite v2 component; runs unchanged.
- `evals/fixtures/v2-test-vault/` — 50–100 notes "Atlas Robotics" narrative; covers ASM/GRA/BRF/CON eval scenarios.
- `src/adapters/source/conformance.test.ts` + `src/adapters/delivery/conformance.test.ts` + `src/adapters/change-feed/conformance.test.ts` — stub-adapter conformance suite; runs unchanged. (Multiple worktree copies under `.claude/worktrees/agent-*/` are scratch — they are not run by CI.)

### Tool surface (REL-08 — D-01..D-04)

- `evals/v1-baseline/tools-list.snapshot.json` — current pinned tool list (verify count + tool names before promotion)
- `evals/v1-baseline/dump-tools.mjs` — script that regenerates the snapshot
- `src/server.ts` — tool registration + Resource registration sites
- `src/tool-registry.ts` — gating pattern (Phase 6 D-A1 + Phase 7 D-MCP-SURFACE pattern)
- Phase 5 BRF-09 precedent: `list_briefs` promoted to Resource — confirm the implementation pattern to follow
- Phase 6 CON-04 precedent: `list_contracts` (Resource `vault-memory://contracts/{vault}`)
- Phase 6 D-A2b precedent: `list_contract_verbs` (Resource `vault-memory://contract-verbs/{vault}`)
- `docs/v2/PHASE-6-SIGN-OFF.md` note: "MCP Resources delta: +2 (list_contracts, list_contract_verbs); do NOT count toward REL-08 budget" — this rule applies to all promoted Resources in Phase 8

### Phase 7 carryover anchors (D-13..D-16)

- `skills/vm-install/setup.sh` — contains `RELEASE_URL_PLACEHOLDER` to be replaced at v2.0.0 ship (D-16)
- `skills/vm-update/update.sh` — same placeholder
- `docs/v2/plugin/INSTALL.md` — deferral notes mentioning the screencast and the GitHub Release URL — update with resolved URLs (D-14)
- `docs/v2/plugin/CONTRACT-EDITOR.md` — deferral note for screencast — update (D-14)
- `README.md` — needs the screencast link added in the appropriate section (D-14)
- `plugin/manifest.json` — version field; v2.0.0 plugin = v2.0.0 server (Phase 7 D-VERSION); release script should NOT touch this (plugin has its own build/release within the same tag)
- `plugin/` directory at repo root — Phase 7's plugin package; v2.0.0 tar.gz is built from this

### ADRs to verify still hold

- `docs/v2/adr/001-document-identity.md` — opaque `DocId`; the branded type that affects MIGRATION
- `docs/v2/adr/002-adapter-seams.md` — seam invariants (CI greps in `ci.yml` already enforce; verify still green)
- `docs/v2/adr/003-document-shape.md` — `Document` shape; affects MIGRATION type-import section
- `docs/v2/adr/004-memory-sink-handles.md` — memory-sink invariant (MEM-05); affects "what's new at runtime" appendix
- `docs/v2/adr/005-brief-compile-strategy.md` — brief-compile path (affects appendix)
- `docs/v2/adr/006-task-contract-dsl.md` — contract DSL (affects appendix; mention in README "what's new in v2")
- `docs/v2/adr/007-contract-editor.md` — plugin/editor (affects appendix; mention in README)
- `docs/v2/adr/README.md` — Phase 8 README links to this as the ADR index

### Project-level architecture docs

- `docs/v2/ARCHITECTURE.md` — L0…L5 layer model (README architecture diagram source — D-11 §3)
- `docs/v2/AGENT_AGNOSTIC.md` — "MCP is canonical; Skills are one delivery mechanism" — informs README pitch (D-11 §2)
- `docs/v2/MEMORY_CONTRACT.md` — memory namespace property contract (Phase 2 reference for MIGRATION appendix)
- `docs/v2/PHASE-4-SIGN-OFF.md`, `docs/v2/PHASE-6-SIGN-OFF.md`, and the Phase 7 sign-off (path TBD) — CHANGELOG audit sources

### NEW Phase 8 artifacts

- `MIGRATION-V1-TO-V2.md` at repo root OR `docs/v2/MIGRATION-V1-TO-V2.md` — planner picks location (Phase 7 placed docs at `docs/v2/...`; this likely belongs there too, with a stub at the repo root linking in)
- `scripts/release.mjs` — the `npm run release` script (D-17)
- `docs/v2/PHASE-8-SIGN-OFF.md` — sign-off artifact (D-18)
- `CONTRIBUTING.md` § "Cut a release" — short paragraph documenting `npm run release` (D-17)
- `CONTRIBUTING.md` § "Eval suite is a merge gate" — short paragraph documenting D-06 + how to address red evals
- `docs/v2/plugin/screencast-thumbnail.png` — thumbnail for the screencast link (D-14)
- `.github/branch-protection.yml` or equivalent — if declarative branch protection is used (D-06)
- README.md — full rewrite per D-11
- CHANGELOG.md — backfilled + renamed `[Unreleased]` → `[2.0.0] - YYYY-MM-DD`

### Codebase maps (read for Phase 8 mechanics)

- `.planning/codebase/STACK.md` — Node 22 / TypeScript 5.7 / ESM / npm; informs release script + CI patterns
- `.planning/codebase/STRUCTURE.md` — where the script lands (`scripts/release.mjs`), where docs land (`docs/v2/`)
- `.planning/codebase/TESTING.md` — vitest layout; informs how Resources tests are added
- `.planning/codebase/ARCHITECTURE.md` — layer model for README architecture diagram

### External references (planner verifies against current versions)

- Keep a Changelog 1.1.0 — https://keepachangelog.com/en/1.1.0/ (CHANGELOG format reference)
- Semantic Versioning 2.0.0 — https://semver.org/spec/v2.0.0.html (versioning rules; v2.0.0 = major bump, breaking changes allowed but D-12 says we don't have any)
- GitHub branch protection / required status checks — current API + declarative options
- `softprops/action-gh-release` — the GitHub Release creation action already used in `publish.yml` (verify version)
- `actions/upload-release-asset` or equivalent — for attaching the tarball + manifest.sha256 + mp4 to the release
- MCP SDK 1.29 Resources spec — Resource URI templates, list operation shape, notification semantics (for D-02 promotion)

### Constraints that anchor Phase 8

- **No new MCP tools.** Promotion to Resources is additive surface, not new tools. Deprecating an existing tool is allowed (added in v2.0.0 description) but removal is v3.0.0.
- **No breaking changes.** Every v1 tool's shape preserved byte-for-byte. The "additive only" tool API delta is the locked contract per REL-05 and PROJECT.md backwards-compat invariants.
- **No telemetry.** The release script does not emit telemetry. The screencast does not include any telemetry-collection mention. CI does not collect telemetry. This is permanent, not deferred.
- **No remote LLM SDK bundled.** v2.0.0 ships with Ollama localhost + optional ONNX reranker + (Phase 5) MCP Sampling routing. No new LLM dependency in Phase 8.
- **MIT license.** All new code (release script, screencast assets, CONTRIBUTING.md additions) under MIT.
- **Solo maintainer.** Tooling that requires team coordination (e.g., approval workflows beyond branch protection) is out of scope.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`.github/workflows/ci.yml`** — already runs lint + test + eval:baseline + smoketest. Phase 8 makes this the merge gate (D-06) without adding new CI jobs. Possibly adds a Resources-snapshot test invocation if it isn't already covered by `npm test`.
- **`.github/workflows/publish.yml`** — already wires tag-triggered npm publish + GitHub Release auto-creation with CHANGELOG-section release body. Phase 8 verifies it works end-to-end (dry-run with `v2.0.0-rc1` tag) and updates it if needed to also attach the plugin tarball + manifest.sha256 + screencast MP4 to the Release.
- **`evals/v1-baseline/dump-tools.mjs`** — regenerates the tools-list snapshot. REL-08 promotion plan uses this to update the snapshot post-promotion.
- **`evals/v1-baseline/baseline.test.ts`** — runs each v1 tool's expected behavior; the per-tool YAML files (e.g., `evals/v1-baseline/list_backlinks.yaml`) define expected outputs. Promoted tools' YAMLs stay green (deprecation in description only).
- **`scripts/check-fixture-privacy.sh`** + **`scripts/lint-no-telemetry.sh`** — existing CI lints; Phase 8 doesn't change them.
- **`scripts/install-skills.sh`** — existing skill install path; relevant to Phase 7 carryover (D-16) flow.
- **CHANGELOG.md footer "release process" comment** — existing rule: "every PR that ships a user-visible change MUST append an entry under `## [Unreleased]`". Phase 8 enforces this retroactively for missing entries.
- **`package.json` `files: ["dist", "README.md", "LICENSE"]`** — the npm tarball ships only these. Phase 8 verifies CHANGELOG should NOT be added (users get it from GitHub Release) but planner decides.
- **`tsup.config.ts`** — bundles `src/cli.ts` → `dist/cli.js` with native bindings external. Phase 8 doesn't modify; the existing build is what `npm publish` ships.

### Established Patterns

- **Phase sign-off artifact per phase** — Phase 4 / Phase 6 / Phase 7 all have a `PHASE-N-SIGN-OFF.md` in `docs/v2/`. Phase 8's PHASE-8-SIGN-OFF.md follows the same template (success criteria + evidence + requirements coverage + maintainer sign).
- **MCP Resources for read-only enumeration** — established by BRF-09 (list_briefs), Phase 6 CON-04 (list_contracts), Phase 6 D-A2b (list_contract_verbs). REL-08 promotion follows the same pattern.
- **Snapshot tests for "no drift" surfaces** — `tools-list.snapshot.json` precedent; Phase 8 adds an equivalent Resources snapshot if one doesn't exist.
- **Tag-triggered release workflow** — `publish.yml` triggers on `v*.*.*` tag push. No manual GitHub Release creation needed; the workflow does it. This is the model the release script (D-17) hands off to.
- **`npm version --no-git-tag-version`** — Standard npm pattern that bumps package.json + package-lock.json without creating a tag. Lets the release script bundle the version bump into a single commit with the CHANGELOG rename, then tag.
- **Keep-a-Changelog `[Unreleased]` block convention** — every user-visible change PR appends here; release renames the block. Phase 8 enforces + automates the rename.
- **No marketing superlatives** — PROJECT.md, CLAUDE.md, RULES.md all enforce. The README and CHANGELOG rewrites comply.

### Integration Points

- **`package.json` scripts** — add `release: "node scripts/release.mjs"`. Existing scripts (`build`, `test`, `lint:check`, `eval:baseline`) stay.
- **CHANGELOG.md `[Unreleased]` block** — Phase 8 audits, backfills missing phases (D-08), curates (D-09), then the release script (D-17) renames at tag time.
- **`evals/v1-baseline/tools-list.snapshot.json`** — REL-08 promotion plan updates with deprecation notices in promoted-tool descriptions.
- **NEW `evals/v2-fixtures/resources-list.snapshot.json` (if absent)** — REL-08 plan adds.
- **`README.md`** — full rewrite per D-11. Replaces v1.0.0 README. Keep the LICENSE / contributing footer.
- **`CONTRIBUTING.md`** — likely needs creation if absent (planner checks); add release recipe + eval-gate documentation.
- **GitHub Settings → Branches → main → Branch protection rule** — UI or declarative config; require `lint-and-test` status check.
- **NEW `docs/v2/plugin/screencast-thumbnail.png`** — Phase 8 deliverable.
- **NEW v2.0.0 GitHub Release** — `publish.yml` creates it on tag push; release script triggers via push.

</code_context>

<specifics>
## Specific Ideas

- **The release script is single-screen Node, not a bash pipeline.** `scripts/release.mjs` uses Node's `node:child_process` to call `git`, `npm`, and `sed`-equivalent in-Node. Rationale: matches the project's runtime (ESM Node 22), is easier to test, and survives the macOS → Linux portability concerns of bash pipelines.

- **Resources promotion is one cohesive plan, not five mini-plans.** REL-08 lands as a single plan (e.g., 08-XX-resources-promotion.md) that picks the closed set, implements each Resource, updates server.ts + tool-registry.ts + snapshots, and adds CHANGELOG entries. Atomic delivery; one PR.

- **CHANGELOG backfill is a research-then-write task.** First Phase 8 plan: read each phase's sign-off and SUMMARY artifacts, extract user-visible changes, write a structured backfill draft. Then a separate task: curate the draft into the `[Unreleased]` block. This makes the writing focused and verifiable per phase.

- **The MIGRATION end-user appendix points outward.** It does NOT duplicate per-phase docs; it links to them. One paragraph per phase + one link = ~6 paragraphs total in the appendix. The "what to read next" is README + per-phase sign-offs.

- **README architecture diagram is ASCII.** Renders in GitHub web, in `cat README.md`, in `man`-style terminal pagers, and in any editor. SVG would be prettier in GitHub web but invisible elsewhere. The L0…L5 model is simple enough that ASCII handles it well. Planner sketches; maintainer approves at sign-off.

- **Branch protection: declarative if mature, UI if not.** Phase 8 prefers `.github/branch-protection.yml` (auditable, reviewable) but GitHub's declarative format may not be stable enough. If not, document the required-checks list in CONTRIBUTING.md and configure via UI.

- **Sign-off is the LAST commit before the tag.** `docs/v2/PHASE-8-SIGN-OFF.md` is written + committed AFTER the release commit (which bumps version and renames CHANGELOG). The tag includes both commits. The maintainer "signs" by reviewing the diff and pushing the tag.

- **No `v2.0.0-rc1` in the public NPM channel.** Use the tag locally to smoke-test the publish workflow against a private/test registry (or use `npm publish --dry-run`), but the actual v2.0.0 cut is the first publicly-published v2 tag.

- **The screencast records on the maintainer's primary machine.** macOS QuickTime + Audacity for voiceover if needed (most likely no voiceover — captions baked in). Cursor highlights ON. No third-party recording software. Rationale: minimum-dependency principle; the maintainer can re-record without setup if a fix is needed in v2.0.1.

- **No "v2.0.0 launch announcement" plan.** Phase 8 is about the artifact (the npm package + GitHub Release + screencast + docs). Launch promotion (HN post, Twitter thread, blog post) is the maintainer's choice and out of Phase 8 scope.

- **The eval-suite-is-the-gate decision protects future phases too.** Phase 9 (hard gate) and v3 phases benefit from a culture where "red CI = revert, not skip". Phase 8 is the moment to lock that culture.

- **Phase 8 plans are vertical slices per MVP mode.** Examples (planner refines):
  - Slice 1: CHANGELOG backfill + voice curation → green CI → committed `[Unreleased]` block ready for rename.
  - Slice 2: Resources promotion → snapshot updated → tool count ≤32 verifiable via test.
  - Slice 3: README rewrite (practical-first) → maintainer can read it cold and understand v2.
  - Slice 4: MIGRATION-V1-TO-V2.md → downstream lib consumer can upgrade.
  - Slice 5: Phase 7 carryover screencast → MP4 exists at `docs/v2/plugin/walkthrough.mp4` locally (uploaded as Release asset at release time).
  - Slice 6: Release script + branch protection + CONTRIBUTING.md release recipe → dry-run tag (`v2.0.0-rc1`) successfully exercises the publish workflow against `--dry-run`.
  - Slice 7: Phase 7 carryover Release assets pipeline → tarball + manifest.sha256 generation wired into `publish.yml` (or a pre-tag step in the release script).
  - Slice 8: PHASE-8-SIGN-OFF.md + final dry-run + tag cut → v2.0.0 live on npm + GitHub Release + skills functional.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-OS CI matrix** (macOS, Windows) — Linux-only in v2.0.0 (D-07). v2.x add when downstream consumers report platform-specific issues.
- **VTT caption file for the screencast** — accessibility improvement; baked-in title-card highlights only in v2.0.0. v2.x.
- **Eval-suite override token** (`[skip eval]` PR title) — rejected per D-06; the gate is the gate. If maintainer-overhead becomes painful, revisit.
- **Standalone eval-fixture tarball as Release asset** — v3 if downstream consumers want to run evals without cloning.
- **Prebuilt CLI binary as Release asset** — npm distribution is the canonical channel; standalone binary deferred to v2.x if user demand emerges (e.g., for non-Node-user environments).
- **YouTube / external video hosting** — GitHub Release MP4 only in v2.0.0 (D-14). If discoverability becomes a problem, mirror to YouTube post-launch.
- **Launch promotion plan** — HN post, Twitter thread, blog post. Maintainer's choice; out of Phase 8 scope.
- **`vault-memory migrate-v1-to-v2` CLI command** — there's no data migration needed (v1 SQLite DBs are forward-compatible with v2 reads). Tool deferred unless a v3 PostgreSQL or schema-breaking change requires it.
- **PHASE-9-SIGN-OFF.md template generation** — done as part of Phase 9, not pre-emptively.
- **CONTRIBUTING.md full overhaul** — Phase 8 adds the two minimum sections (release + eval gate); full polish is post-v2.0.0.
- **Architecture diagram in SVG** — ASCII for v2.0.0 (D-11 §3). v2.x if README format demands.
- **Release script telemetry** — explicitly rejected per project constraint; not deferred, permanently out.
- **Auto-PR-comment with eval results** — nice-to-have; eval results already surface in PR status checks. v2.x.
- **`vm-uninstall` skill** — Phase 7 reserved `vm-*` namespace; uninstaller deferred to v2.x if support demand materializes.
- **Multi-version README sidebar** — single-branch README in v2.0.0 (no historical v1.x README archived in-tree). v3 if multi-version docs become necessary.

</deferred>

---

*Phase: 08-polish-eval-suite-v2-0-0-release*
*Context gathered: 2026-05-19*
