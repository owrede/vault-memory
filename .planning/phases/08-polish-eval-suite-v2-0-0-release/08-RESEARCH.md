# Phase 8: Polish, eval suite, v2.0.0 release — Research

**Researched:** 2026-05-19
**Domain:** Release engineering, docs, CHANGELOG curation, MCP Resources promotion, CI gating
**Confidence:** HIGH (all claims grounded in repo files at HEAD; external claims marked)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Direct from `.planning/phases/08-polish-eval-suite-v2-0-0-release/08-CONTEXT.md` `<decisions>` block. The planner MUST honor these verbatim:

- **D-01 / REL-08-TARGET:** Ship v2.0.0 at **≤32 tools** via MCP Resources promotion. Current default surface (plugin OFF) is **37 tools**. Promote 5+ list-style tools. Plugin-gated tools (6 added Phase 7, default OFF) do NOT count.
- **D-02 / REL-08-CANDIDATES:** Initial candidate list (planner finalizes closed set, 5+ from list or proposes alternatives with rationale):
  - `list_vaults` → `vault-memory://vaults`
  - `list_models` → `vault-memory://models/{vault}`
  - `list_aliases` → `vault-memory://aliases/{vault}` **[ASSUMED — does NOT exist as a tool in the registry; see Validation §1.6 below]**
  - `recent_notes` → `vault-memory://recent/{vault}`
  - `vault_stats` → `vault-memory://stats/{vault}`
  - `list_briefs` (BRF-09) — **already promoted Phase 5; verify**
  - `list_contracts` + `list_contract_verbs` (Phase 6) — **already promoted; verify**
  - Audit-log list-style — candidate if pure enumeration
- **D-03 / REL-08-PROCESS:** Each promotion is **additive then deprecating**. v2.0.0 ships Resource AND keeps Tool (deprecated in description). v3.0.0 removes deprecated tools. CHANGELOG entry per promoted tool; snapshot test updated to reflect both surfaces.
- **D-04 / REL-08-SNAPSHOT:** `evals/v1-baseline/tools-list.snapshot.json` updated, NOT broken. Promoted tools remain in the snapshot (with deprecation notice). New Resources go in a separate `evals/v2-fixtures/resources-list.snapshot.json` (planner creates if absent).
- **D-05 / REL-01-COMPONENTS:** "Full eval suite" = v1-baseline + v2-fixtures + stub-adapter conformance. Already in CI today; per-phase eval scenarios (ASM/GRA/BRF/CON) live inside these.
- **D-06 / REL-01-GATING:** **Required-for-merge with NO maintainer override.** Branch protection on `main` requires the `lint-and-test` job. No `[skip eval]` token, no bypass label.
- **D-07 / REL-01-CI-MATRIX:** Single Linux runner is sufficient for v2.0.0. No Windows/macOS matrix.
- **D-08 / REL-02-AUDIT:** Audit every phase 2–7 SIGN-OFF/SUMMARY and backfill missing `[Unreleased]` entries. **Note:** CONTEXT claims Phases 2/3/5/7 are missing — **the actual CHANGELOG currently contains Phases 2, 3, 4, and 6**. Only Phases 5 and 7 are missing. See Standard Stack §CHANGELOG audit.
- **D-09 / REL-02-CURATION:** Voice consistency (terse, technical, no marketing). Cross-references verified. Tool-count deltas reconciled with REL-08 final state. Plugin section framed default-OFF.
- **D-10 / REL-02-FORMAT:** Keep existing Keep-a-Changelog format. Don't restructure.
- **D-11 / REL-03-04-SHAPE:** README practical-first, 6 sections (30-sec example → what this is → architecture (ASCII diagram) → what's new in v2 → roadmap (Phase 9, v3 explicit) → install & docs). Tight, technical, zero marketing superlatives.
- **D-12 / REL-05-SHAPE:** MIGRATION-V1-TO-V2.md targets downstream **library consumers** primarily + short end-user appendix (~3 pages). SDK 1.29 + Zod 4 bump notes; `verbatimModuleSyntax: true`; no-breaking-change tool API delta; branded `DocId` implications.
- **D-13 / SCREENCAST:** Strict 5–7 min storyboard, MP4 1080p, ≤8 min hard cap, no music, baked-in captions, no separate VTT.
- **D-14 / SCREENCAST-HOST:** GitHub Release asset `vault-memory-plugin-walkthrough.mp4`. Linked from README, `docs/v2/plugin/INSTALL.md`, `docs/v2/plugin/CONTRACT-EDITOR.md`. Static thumbnail PNG at `docs/v2/plugin/screencast-thumbnail.png`.
- **D-15 / RELEASE-ASSETS:** Minimum asset set — `vault-memory-plugin-v2.0.0.tar.gz`, `manifest.sha256`, `vault-memory-plugin-walkthrough.mp4`. Auto-attached: source zip + tarball. Excluded: standalone eval-fixture tarball, prebuilt CLI binary, separate docs bundle.
- **D-16 / RELEASE-URL-RESOLUTION:** Replace `RELEASE_URL_PLACEHOLDER` in `skills/vm-install/setup.sh` + `skills/vm-update/update.sh`. **Note:** `setup.sh:26` already has literal `v2.0.0` URL; `update.sh:23` uses `v__VERSION__` template substitution. Planner picks lower-friction option (recommendation below).
- **D-17 / RELEASE-SCRIPT:** `scripts/release.mjs` (Node ESM). Validates clean tree, on main, `[Unreleased]` non-empty. Runs `npm test`. `npm version --no-git-tag-version`. Renames CHANGELOG block. Single commit + tag + push. Hands off to `publish.yml`. Documented in CONTRIBUTING.md.
- **D-18 / SIGN-OFF:** `docs/v2/PHASE-8-SIGN-OFF.md` — mirrors Phase 4/6/7 pattern. Committed before tag is pushed.

### Claude's Discretion

(Verbatim from CONTEXT.md `<decisions>` Claude's Discretion section. Planner picks; researcher recommends below.)

- Exact Resources-promotion closed set (5+ tools); URI templates; snapshot-test shape
- CHANGELOG entry voice for backfilled phases
- Branch protection: declarative `.github/branch-protection.yml` vs UI
- `npm run release` exact prompts & validations
- README architecture diagram: ASCII vs SVG
- MIGRATION end-user appendix breadth (one paragraph/phase recommended)
- Screencast intro/outro card design
- Screencast thumbnail composition
- Release script error-handling depth
- CONTRIBUTING.md scope (minimum: release recipe + eval-gate note)
- Manifest sha256 generation tool (shasum vs openssl dgst)
- Phase 7 plugin CHANGELOG entry depth

### Deferred Ideas (OUT OF SCOPE)

(Verbatim from CONTEXT.md `<deferred>`. Researcher does NOT explore alternatives for these.)

Multi-OS CI matrix; VTT caption file; `[skip eval]` override; standalone eval-fixture tarball; prebuilt CLI binary asset; YouTube hosting; launch promotion plan; `migrate-v1-to-v2` CLI; PHASE-9-SIGN-OFF.md template; CONTRIBUTING.md full overhaul; SVG architecture diagram; release-script telemetry; auto-PR-comment with eval results; `vm-uninstall` skill; multi-version README sidebar.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REL-01 | Full eval suite passing; eval suite integrated in CI | §"Eval suite already wired" — `.github/workflows/ci.yml` runs `npm run lint:check`, `npm test`, `npm run eval:baseline`, builds, and runs `scripts/smoketest-non-claude.mjs` (5 steps). Phase 8 adds branch protection only. |
| REL-02 | CHANGELOG curated for v2.0.0 — every user-visible v2 change listed | §"CHANGELOG audit (actual state)" — current `[Unreleased]` has Phases 2/3/4/6; **Phases 5 + 7 missing**. Sources: `docs/v2/PHASE-5-SIGN-OFF.md`, Phase 7 evidence in `.planning/phases/07-*/{VERIFICATION.md, 07-12-SUMMARY.md, 07-12-PLAN.md}`. |
| REL-03 | README rewritten around new pitch | §"README rewrite scope" — current 459-line README is v1-shaped (lists 23 tools, no plugin-first install path, no Phase 9/v3 roadmap). |
| REL-04 | README "Roadmap" section names Phase 9/v3 explicitly | New section per D-11 §5. |
| REL-05 | MIGRATION-V1-TO-V2.md — SDK + Zod bumps, tool API delta | §"MIGRATION content" — SDK `^1.0.4` → `^1.29.0`; Zod `^3.x` → `^4.4.3`; `verbatimModuleSyntax: true`; additive-only tool delta confirmed by snapshot diff. |
| REL-06 | v2.0.0 git tag exists; CI auto-creates GitHub Release | §"publish.yml exists" — `.github/workflows/publish.yml` already implements `softprops/action-gh-release@v2` on `v*.*.*` tag; extracts matching CHANGELOG section as release body. |
| REL-07 | npm publish completed | Same workflow runs `npm publish --access public --provenance` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and `id-token: write` for provenance. |
| REL-08 | Tool surface ≤32 (with Resources promotion) or ≤40 (without) | §"Tool surface today" — 37 default tools verified against `evals/v1-baseline/tools-list.snapshot.json` (37 `"name":` entries excluding inputSchema nesting). Promotion targets identified. |
| REL-09 | Maintainer signs off on README rewrite | `docs/v2/PHASE-8-SIGN-OFF.md` (D-18) is the artifact. |
</phase_requirements>

## Summary

Phase 8 is **release engineering and curation**, not feature development. The hard infrastructure is already in place: `ci.yml` runs the full eval suite on every PR; `publish.yml` triggers on `v*.*.*` tag and publishes to npm with provenance + auto-creates a GitHub Release with the matching CHANGELOG section as the body. The skill scripts (`vm-install`, `vm-update`) are stubbed and waiting for the release URL.

**Primary recommendation:** Lean on what exists. Do not rebuild CI or the publish workflow — verify and extend. The work is concentrated in three areas: (1) CHANGELOG + README + MIGRATION content (high-touch authoring), (2) MCP Resources promotion to hit ≤32 tools (small surface change with a snapshot update), (3) a small `scripts/release.mjs` glue script and branch protection configuration. Phase 7 carryovers (screencast + tarball release assets + placeholder substitution in skill scripts) bolt onto the same v2.0.0 tag.

The biggest CONTEXT-vs-reality gap to surface to the planner: **CONTEXT.md says CHANGELOG is missing Phases 2/3/5/7. Reading the file: it actually has Phases 2/3/4/6 entries, and is missing Phases 5 (briefs) and 7 (plugin). This materially changes the backfill scope.**

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Eval suite execution | CI / GitHub Actions | Local `npm test` | CI is canonical; local runs are dev convenience |
| Merge gate enforcement | GitHub branch protection | (UI or declarative file) | Lives in GitHub config, not code |
| CHANGELOG curation | Documentation (repo) | — | Pure content; no runtime impact |
| README rewrite | Documentation (repo) | — | Pure content; consumed at npmjs.com + GitHub |
| MIGRATION guide | Documentation (`docs/v2/`) | Repo-root stub link | Authoritative under `docs/v2/`; stub at repo root for discoverability |
| Resources promotion | MCP server runtime (`src/server.ts` + `src/tool-registry.ts`) | Snapshot test | Backend code change + snapshot update |
| Release script | Local Node script (`scripts/release.mjs`) | Git + npm CLI | Glue; the heavy lifting is `publish.yml` |
| npm publish | `publish.yml` GitHub Action runner | — | Already implemented; verify only |
| GitHub Release | `softprops/action-gh-release@v2` in `publish.yml` | — | Already implemented; verify only |
| Release asset attach (mp4, tar.gz, sha256) | `publish.yml` extension or pre-tag script | — | Planner decides where the asset-build step lives |
| Screencast recording | Maintainer's macOS QuickTime | — | Manual artifact; uploaded to GitHub Release |

## Standard Stack

Phase 8 does not add new runtime dependencies. The standard stack below is **what's already in use** that Phase 8 leverages.

### Core (already installed, do NOT re-install)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server transport, `server.registerTool`, `server.registerResource`, `ResourceTemplate` | Already used for existing 5 Resources (memory-sinks, memory-stats, briefs, contracts, contract-verbs) [VERIFIED: `src/server.ts:1756–1920`] |
| `vitest` | `^2.1.8` | Test runner, snapshot tests | Existing eval harness [VERIFIED: `package.json:62`] |
| `tsup` | `^8.3.5` | Bundle `dist/cli.js` | Already shipped to npm [VERIFIED: `tsup.config.ts`] |
| `softprops/action-gh-release@v2` | v2 | GitHub Release creation on tag push | Already wired in `publish.yml:100` [VERIFIED: `.github/workflows/publish.yml:100`] |
| `actions/setup-node@v4` | v4 | Node 22 install in CI | [VERIFIED: `ci.yml:25`, `publish.yml:31`] |

### Supporting (already in scripts/ — Phase 8 follows pattern)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node `node:child_process` | built-in | Spawn `git`, `npm` in `release.mjs` | Per CONTEXT specific idea: "single-screen Node, not bash pipeline" |
| Node `node:fs/promises` | built-in | CHANGELOG read/rewrite | Atomic CHANGELOG block rename in `release.mjs` |
| `awk` (in `publish.yml:76`) | builtin | Extract CHANGELOG section for release body | Already implemented; keep as-is |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written `scripts/release.mjs` | `release-it` (npm pkg) | `release-it` adds a dep + opinionated workflow; the bespoke script is ~150 LOC and matches existing project style (see `scripts/smoketest-non-claude.mjs` 18kB precedent). **Stay bespoke.** |
| `softprops/action-gh-release@v2` | `actions/create-release` (deprecated by GitHub) or `gh release create` in a script step | softprops is the de-facto standard; already in use; do not change. |
| Declarative branch protection (`.github/branch-protection.yml`) | GitHub Settings UI | Declarative is auditable but **GitHub does not have a stable, first-class `.github/branch-protection.yml` format as of 2026** [ASSUMED — researcher could not verify a current GitHub-native spec]. Repository Rulesets (newer feature) support API + Terraform but not in-tree YAML. **Recommendation: configure via UI, document the required-checks list in CONTRIBUTING.md, and treat that doc as the source of truth.** |

**Installation:** None. All deps are pre-installed in `package.json`. New `package.json` scripts entry only:
```json
"release": "node scripts/release.mjs"
```

**Version verification:** All packages verified against repo `package.json` at HEAD. No external registry lookups needed since Phase 8 adds zero deps.

## Package Legitimacy Audit

**Phase 8 installs zero new packages.** All work uses existing dependencies (`@modelcontextprotocol/sdk`, `vitest`, `tsup`) or built-in Node modules. No slopcheck run needed.

| Package | Disposition |
|---------|-------------|
| — | No new packages this phase |

## Architecture Patterns

### System Architecture Diagram

```
                ┌──────────────────────────────────────────────────────┐
                │                  Phase 8 Pipeline                     │
                └──────────────────────────────────────────────────────┘

  Maintainer                                  Repo / GitHub
  ──────────                                  ─────────────
       │
       │ 1. Local: write README, MIGRATION,
       │    backfill CHANGELOG, record screencast
       │
       ├─────────────► CHANGELOG.md, README.md, MIGRATION-V1-TO-V2.md, *.mp4
       │
       │ 2. Local: ensure resources-promotion PR merged
       │    (Tool count snapshot: 37 → 32-34)
       │
       │ 3. `npm run release` → scripts/release.mjs
       │      ├─ validate clean tree + on main
       │      ├─ run `npm test` locally
       │      ├─ `npm version 2.0.0 --no-git-tag-version`
       │      ├─ rename `[Unreleased]` → `[2.0.0] - YYYY-MM-DD`
       │      ├─ git add + commit "release: v2.0.0"
       │      ├─ git tag -a v2.0.0
       │      └─ git push origin main v2.0.0
       │
       ▼
  GitHub Actions
  ──────────────
  ┌─ ci.yml ─────────┐    ┌─ publish.yml ─────────────────────────────┐
  │ (on PR + push)   │    │ (on tag push v*.*.*)                       │
  │ lint:check       │    │ npm ci → lint → test → build               │
  │ npm test         │    │ verify package.json version == tag          │
  │ eval:baseline    │    │ npm publish --access public --provenance    │
  │ build            │    │ extract CHANGELOG section (awk)             │
  │ smoketest        │    │ softprops/action-gh-release@v2              │
  │                  │    │   body_path: /tmp/release-notes.md          │
  │ Required for     │    │   make_latest: legacy                       │
  │ merge (D-06)     │    │ [extension: attach *.tar.gz + sha256 + mp4] │
  └──────────────────┘    └────────────────────────────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │  npmjs.com (published)  │
                          │  GitHub Release page    │
                          │    + plugin tarball     │
                          │    + manifest.sha256    │
                          │    + walkthrough.mp4    │
                          └─────────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │   vm-install / vm-update│
                          │   skills now functional │
                          └─────────────────────────┘
```

### Recommended Project Structure (what changes/lands)
```
.
├── CHANGELOG.md                          # edited (backfill Phases 5, 7; rename Unreleased)
├── CONTRIBUTING.md                       # NEW (Cut a release + Eval suite is the gate)
├── README.md                             # rewritten (D-11 6 sections)
├── package.json                          # version 1.0.0 → 2.0.0; "release" script added
├── scripts/
│   └── release.mjs                       # NEW (D-17)
├── docs/v2/
│   ├── PHASE-8-SIGN-OFF.md               # NEW (D-18)
│   ├── MIGRATION-V1-TO-V2.md             # NEW (D-12) — primary location
│   └── plugin/
│       └── screencast-thumbnail.png      # NEW (D-14)
├── MIGRATION-V1-TO-V2.md                 # optional stub linking to docs/v2/ version
├── evals/
│   └── v2-fixtures/
│       └── resources-list.snapshot.json  # NEW (D-04) — if not already present
├── .github/
│   └── workflows/
│       ├── ci.yml                        # unchanged unless resources snapshot test needs wiring
│       └── publish.yml                   # extend if attaching tarball+mp4+sha256 (recommended)
└── src/
    ├── server.ts                         # +5 registerResource calls (REL-08)
    └── tool-registry.ts                  # +deprecation note in 5 tool descriptions
```

### Pattern 1: MCP Resource registration (existing pattern, replicate for REL-08)
**What:** Each Resource is one `server.registerResource()` call with a URI string (static or `ResourceTemplate`), a metadata block (`title`, `description`, `mimeType: "application/json"`), and a read handler `(uri) => ({ contents: [{ uri: uri.href, mimeType, text: JSON.stringify(payload, null, 2) }] })`.

**When to use:** Every REL-08 promotion. The pattern is identical for all 5 candidates.

**Example (verbatim from existing code):**
```typescript
// Source: src/server.ts:1850-1893 (Phase 6 list_contracts Resource)
server.registerResource(
  "contracts",
  new ResourceTemplate(`${RESOURCE_URI_LIST_CONTRACTS}/{vault}`, { list: undefined }),
  {
    title: "Task contracts",
    description: "Discovery of task contracts available in a vault (CON-04). ...",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const vault = String(variables.vault ?? "");
    // ... resolve state, build payload
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
    };
  },
);
```

### Pattern 2: CHANGELOG section extraction (existing pattern in publish.yml)
**What:** awk pulls the section between `## [X.Y.Z]` and the next `## [` heading.

**Example (verbatim from existing CI):**
```yaml
# Source: .github/workflows/publish.yml:76-89
awk -v ver="$VERSION" '
  BEGIN { in_section = 0 }
  /^## \[/ {
    if (in_section) exit
    if ($0 ~ "\\[" ver "\\]") { in_section = 1; next }
  }
  in_section { print }
' CHANGELOG.md > /tmp/release-notes.md
```

**Implication for Phase 8:** The CHANGELOG section heading must match `## [2.0.0]` exactly (with `## [` prefix). Verify the release script's rename produces this exact format.

### Pattern 3: Tool deprecation (additive description change)
**What:** v2.0.0 keeps the tool callable but appends "deprecated since v2.0.0; use Resource `<uri>` instead" to its description. v3.0.0 removes the tool entry from `TOOLS`.

**When to use:** Each REL-08 promotion (per D-03).

**Example (planner writes; no precedent in repo yet — first-of-kind):**
```typescript
// src/tool-registry.ts (new pattern)
{
  name: "list_vaults",
  description:
    "List configured vaults. (Deprecated since v2.0.0 — use MCP Resource " +
    "`vault-memory://vaults` for canonical discovery. The tool remains callable " +
    "through v2.x; removal scheduled for v3.0.0.)",
  inputSchema: { ... },
}
```

### Anti-Patterns to Avoid

- **Building a new release tool/system.** The `publish.yml` workflow already exists, works, and is wired to npm provenance + GitHub Releases. Phase 8 does not redesign it.
- **Adding Resources without keeping the Tool callable.** Per D-03, every promotion is additive in v2.0.0. Removing a tool now would violate REL-05 ("tool API delta is additive only").
- **CHANGELOG voice drift.** Existing entries are technical, terse, link to phase docs. Don't introduce marketing language (banned per CLAUDE.md `Professional Honesty` + PROJECT.md).
- **Using SVG for the README architecture diagram.** Per D-11 §3, ASCII renders everywhere (GitHub, terminal pagers, `cat`). SVG is a v2.x add-on, not Phase 8.
- **Committing `CHANGELOG.md` to the `files:` whitelist in `package.json`.** Today `files: ["dist", "README.md", "LICENSE"]` — users get the changelog from GitHub Releases. Adding CHANGELOG to the npm tarball is a deferred decision (see CONTEXT specifics §"`package.json` `files`").
- **Running `npm publish` from the release script.** That's `publish.yml`'s job. The release script's last action is `git push origin main vX.Y.Z`; `publish.yml` fires on the tag.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GitHub Release creation | Custom `gh api` script | `softprops/action-gh-release@v2` (already wired) | Asset upload, body extraction, draft/prerelease semantics handled. Source: `publish.yml:100`. |
| npm publish with provenance | Hand-rolled OIDC flow | `npm publish --access public --provenance` + `id-token: write` permission | Native npm 9.5+ feature; OIDC handled by Actions. Source: `publish.yml:64`. |
| CHANGELOG section extraction | Regex in Node | The existing awk in `publish.yml:76` | Already battle-tested; matches Keep-a-Changelog format. |
| Branch-protection-as-code | Bespoke YAML format | GitHub UI + a paragraph in CONTRIBUTING.md documenting required checks | No stable in-tree format exists. Configuration drift risk is low (one rule, one job name: `lint-and-test`). |
| Version bumping | Sed on `package.json` | `npm version <ver> --no-git-tag-version` | Bumps `package.json` + `package-lock.json` atomically. Source: D-17. |
| sha256 generation | OpenSSL invocation | `shasum -a 256 <file>` (built-in macOS + Linux) | One-line, no deps. CONTEXT specifies "planner picks shell tool". `shasum -a 256` is recommended (BSD + GNU portable). |
| MP4 recording | Third-party recorder | macOS QuickTime native screen recording | Zero install; CONTEXT specifies (D-13). |

**Key insight:** The release pipeline already exists and works. Phase 8 is 90% authoring (docs, CHANGELOG, screencast) and 10% wiring (release script + branch protection + Resource promotion). Reach for existing patterns; do not re-invent.

## Runtime State Inventory

> Phase 8 is **not** a rename/refactor/migration phase. This section is included briefly for any runtime state that affects the release ritual.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema migrations in Phase 8 (last was Phase 6 migration 014) | None |
| Live service config | `~/.vault-memory/config.toml` — unchanged in Phase 8; `[plugin]` block default OFF preserved | None |
| OS-registered state | None | None |
| Secrets/env vars | `NPM_TOKEN` repo secret — already configured for `publish.yml`; Phase 8 verifies token has publish rights for `@owrede/vault-memory` and bypass-2fa enabled (`publish.yml:66` comment) | Verify NPM_TOKEN scope before first v2 publish |
| Build artifacts | `dist/cli.js` (regenerated by `npm run build` in `publish.yml`); `plugin/main.js` (built by `plugin/esbuild.config.mjs` for the tarball) | Tarball-build step must be invoked before release-asset attach |

## Common Pitfalls

### Pitfall 1: CHANGELOG backfill scope mismatch
**What goes wrong:** CONTEXT.md claims Phases 2/3/5/7 are missing from `[Unreleased]`. Reading the file: Phases 2, 3, 4, and 6 ARE present; Phases 5 (briefs) and 7 (plugin) are absent.
**Why it happens:** CONTEXT was drafted from a quick scan; entries are long and the Phase 4 + Phase 3 entries near the bottom are easy to miss on a casual read.
**How to avoid:** Plan-checker MUST diff `CHANGELOG.md` `## [Unreleased]` against `docs/v2/PHASE-{2,3,4,5,6}-SIGN-OFF.md` + Phase 7 `VERIFICATION.md`/`07-12-SUMMARY.md` before writing entries. The actual delta is **Phase 5 + Phase 7 only**.
**Warning signs:** Re-writing Phase 2/3/4/6 entries that already exist = doubled CHANGELOG; CI test (if one existed) would catch but none does today.

### Pitfall 2: `package.json` version drift between commit and tag
**What goes wrong:** `publish.yml:50-57` aborts if `package.json.version != tag`. If `release.mjs` bumps version but the tag is pushed before the commit lands on the remote, the workflow's checkout reads the un-bumped version.
**Why it happens:** Race between `git push origin main` and `git push origin vX.Y.Z`. If they happen as two operations and the tag arrives first.
**How to avoid:** `release.mjs` MUST push as `git push origin main vX.Y.Z` in a **single command** (or `git push --follow-tags origin main`). The atomic push ensures the workflow sees both refs.
**Warning signs:** The publish workflow fails with `"package.json version (X.Y.Z) does not match tag"`.

### Pitfall 3: Resource promotion breaks `tools-list.snapshot.json`
**What goes wrong:** Removing a tool from `TOOLS` array deletes its snapshot entry → strict-equality snapshot test (re-enabled in Phase 4 per CHANGELOG) fails.
**Why it happens:** Naive promotion = "delete tool, add resource". Correct promotion = "keep tool callable + add deprecation note + register resource".
**How to avoid:** Per D-03/D-04. Snapshot regen (`npm run eval:snapshot`) shows ONLY description-text changes for promoted tools, plus a new file `evals/v2-fixtures/resources-list.snapshot.json` (planner creates).
**Warning signs:** `evals/v1-baseline/baseline.test.ts` test "preserves the 23 v1 baseline tool names byte-identical" or "matches the pinned snapshot exactly" goes red.

### Pitfall 4: Smoketest assertion mismatch after Resource promotion
**What goes wrong:** `scripts/smoketest-non-claude.mjs:200` asserts `tools.length !== EXPECTED_TOOLS.length` (=37). Promotion that *removes* tools changes this count; CI red.
**Why it happens:** Per D-03, promotion is additive — tools STAY callable. But if a future plan removes a tool, the smoketest's `EXPECTED_TOOLS` must update.
**How to avoid:** Phase 8 promotion strategy = additive only. `EXPECTED_TOOLS` array stays at 37. Smoketest may be extended to also assert Resources surface count (recommended add: `resources/list` returns N=5 Resources today + the promoted ones).
**Warning signs:** `node scripts/smoketest-non-claude.mjs` fails at the assertion-1 tool count check.

### Pitfall 5: `RELEASE_URL_PLACEHOLDER` is two different patterns
**What goes wrong:** CONTEXT D-16 implies a single `sed` replace on both skill scripts. Reality:
- `skills/vm-install/setup.sh:26` has the literal hardcoded URL `https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-v2.0.0.tar.gz` (ready to use; no replacement needed for v2.0.0)
- `skills/vm-update/update.sh:23` has a templated `v__VERSION__` URL designed for runtime substitution
**Why it happens:** Two scripts, two different lifecycle patterns (install pins a version; update walks versions).
**How to avoid:** Per CONTEXT specifics — pick the lower-friction option. **Recommendation:** Leave both as-is. `setup.sh` works the moment v2.0.0 is published; `update.sh` works for v2.0.x and beyond via its templating. The Phase 8 work is to verify the URL pattern matches what `publish.yml` actually produces (which it does, by GitHub Release convention: `releases/download/<tag>/<asset-filename>`).
**Warning signs:** Live-vault dry-run of `vm-install` fails with 404 on the tarball URL.

### Pitfall 6: Eval suite "as merge gate" requires repo Settings work, not a code change
**What goes wrong:** Team assumes adding branch protection = `.github/branch-protection.yml`. GitHub does not natively support that file. Without UI/API config, the gate is not actually enforced.
**Why it happens:** Familiarity bias; declarative configs exist for many other CI surfaces.
**How to avoid:** Phase 8 deliverable for D-06 is two parts: (1) configure branch protection via GitHub Settings → Branches → main, requiring the `lint-and-test` status check (job name from `ci.yml:16`); (2) document in `CONTRIBUTING.md` under "Eval suite is a merge gate" with the exact required-check name so future audits can verify.
**Warning signs:** Branch protection looks "configured" but PRs can merge despite red CI.

### Pitfall 7: README rewrite removes v1-stable section
**What goes wrong:** Wholesale README replacement loses the v1.0.0 stability declaration and SemVer commitments (current `README.md` §"What's stable"-equivalent content).
**Why it happens:** D-11 6-section structure doesn't explicitly include "stability".
**How to avoid:** Preserve a SemVer note in §6 "Install & docs" or in §4 "What's new in v2"; cross-link to `CHANGELOG.md` `[1.0.0]` block which contains the stability declaration verbatim.
**Warning signs:** Downstream library consumer asks "what's the stability promise for v2 tools?" and the only answer is git history.

### Pitfall 8: Snapshot test for Resources doesn't exist yet
**What goes wrong:** D-04 specifies `evals/v2-fixtures/resources-list.snapshot.json`. The current eval directory layout is:
```
evals/v1-baseline/{baseline.test.ts, tools-list.snapshot.json, ...per-tool.yaml}
evals/v2-fixtures.test.ts  # FLAT FILE — not a directory
evals/fixtures/v2-test-vault/...
```
There is no `evals/v2-fixtures/` directory. Creating `evals/v2-fixtures/resources-list.snapshot.json` either (a) requires creating the directory and a companion test that loads it, or (b) routing the snapshot under `evals/v1-baseline/` next to the tools-list snapshot.
**How to avoid:** Planner decides location. Recommendation: place under `evals/v1-baseline/` next to `tools-list.snapshot.json` (call it `resources-list.snapshot.json`); extend `baseline.test.ts` with a parallel assertion. Avoids creating a new directory for a single file.
**Warning signs:** Test imports fail; snapshot file is orphaned (no test reads it).

## Code Examples

### CHANGELOG section rename (release.mjs core logic)
```javascript
// scripts/release.mjs (sketch)
import { readFile, writeFile } from "node:fs/promises";

const VERSION = "2.0.0";
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const changelog = await readFile("CHANGELOG.md", "utf8");
const lines = changelog.split("\n");
const unreleasedIdx = lines.findIndex((l) => l === "## [Unreleased]");
if (unreleasedIdx === -1) throw new Error("No `## [Unreleased]` heading found.");

// Replace the heading and prepend a fresh Unreleased block.
lines.splice(
  unreleasedIdx,
  1,
  "## [Unreleased]",
  "",
  "_Nothing yet._",
  "",
  `## [${VERSION}] — ${TODAY}`,
);
await writeFile("CHANGELOG.md", lines.join("\n"));
```
*[Source: derived from existing `publish.yml:76-89` awk pattern + `CHANGELOG.md` footer recipe]*

### Resource registration for `vault-memory://vaults`
```typescript
// src/server.ts (new addition near line 1756)
server.registerResource(
  "vaults",
  "vault-memory://vaults",  // static URI; no template variable
  {
    title: "Configured vaults",
    description:
      "List all vaults configured under [vaults] in ~/.vault-memory/config.toml " +
      "with their name, path, and indexing status. (Promoted from the `list_vaults` " +
      "MCP tool in v2.0.0; the tool remains callable through v2.x.)",
    mimeType: "application/json",
  },
  async (uri) => {
    const vaults = manager.list().map((v) => ({
      name: v.config.name,
      path: v.config.path,
      // ... mirror list_vaults output
    }));
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(vaults, null, 2) }],
    };
  },
);
```
*[Source: pattern verbatim from `src/server.ts:1756-1775` (memory-sinks Resource)]*

### Branch protection note for CONTRIBUTING.md
```markdown
## Eval suite is a merge gate

Pull requests targeting `main` cannot merge unless the GitHub Actions check
`lint-and-test` is green. This check runs the full eval suite:

- `npm run lint:check` — fixture-privacy + no-telemetry + adapter-seam + tsc + prettier
- `npm test` — vitest (includes evals/v2-fixtures + stub-adapter conformance)
- `npm run eval:baseline` — v1 tools-list snapshot + per-tool semantic floors
- `npm run build` + `node scripts/smoketest-non-claude.mjs` — non-Claude MCP SDK smoketest

If the check is red, fix the failure and push a new commit. **There is no `[skip eval]`
override.** A bypass token is intentionally not provided; a red eval is a real signal
that should be addressed in code, not waived.

Branch protection is configured via GitHub Settings → Branches → `main` →
"Require status checks to pass before merging" with `lint-and-test` selected.
```
*[Source: D-06 + `.github/workflows/ci.yml:16` job name]*

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tool-only MCP surface | MCP Resources for read-only enumeration | MCP SDK 1.x adopted Resources broadly; first vault-memory use Phase 5 BRF-09 | REL-08 promotion model; resources don't count toward tool budget |
| Single `Server` + `setRequestHandler` | `McpServer` + `server.registerTool` / `registerResource` | SDK 1.29 (adopted Phase 1) | Cleaner per-tool registration; pattern Phase 8 follows for 5+ promotions |
| Hand-rolled `gh release create` | `softprops/action-gh-release@v2` | Already adopted in `publish.yml` | Phase 8 reuses; do not change |
| Manual npm publish | OIDC provenance via `id-token: write` + `--provenance` | npm 9.5+ (already in `publish.yml`) | Supply-chain attestation comes free |

**Deprecated/outdated:**
- `actions/create-release` (deprecated by GitHub; do not re-introduce)
- The `EXPECTED_TOOLS` literal list in `scripts/smoketest-non-claude.mjs` will fall out of sync if Phase 8 promotes tools that ALSO remove from the tools list — but per D-03 promotion is additive, so no change needed.
- The `## [1.0.0]` stability declaration in `CHANGELOG.md:130-164` should be referenced from the v2 README rather than rewritten (CHANGELOG is the source of truth).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `list_aliases` is in CONTEXT's promotion candidate list but does NOT exist as a tool in `src/tool-registry.ts` (verified by grep — only `list_vaults`, `list_models`, `list_backlinks`, `list_forward_links` exist as `list_*` tools) | User Constraints D-02 | Planner picks a candidate that can't be promoted; wastes a plan iteration. Mitigation: planner audits `TOOLS` array in `src/tool-registry.ts` BEFORE finalizing closed set. |
| A2 | GitHub's `.github/branch-protection.yml` is not a stable native format as of 2026 | Standard Stack §Alternatives | If GitHub has shipped a native format, Phase 8 misses an opportunity for declarative config. Mitigation: planner spends 10 min verifying current GitHub docs before committing to UI-only config. |
| A3 | `shasum -a 256` is portable across macOS + Linux for `manifest.sha256` generation | Don't Hand-Roll table | Older Linux containers may not ship `shasum`. Mitigation: `publish.yml` runs on `ubuntu-latest` which has `shasum`; if asset build moves to a different runner, switch to `sha256sum` (GNU). |
| A4 | Adding `CHANGELOG.md` to `package.json` `files` is NOT desired (current is `["dist", "README.md", "LICENSE"]`) | CONTEXT specifics §`package.json` files | Users may want offline-readable changelog from `node_modules/@owrede/vault-memory/CHANGELOG.md`. Mitigation: defer the decision; planner can add CHANGELOG to files in a separate task if maintainer prefers. |
| A5 | The Phase 7 plugin tarball is built from `plugin/` via `plugin/esbuild.config.mjs` + `plugin/main.js`. **No existing script bundles this into a `.tar.gz` matching the `vault-memory-plugin-v2.0.0.tar.gz` filename** | Build artifacts in Runtime State Inventory | Phase 8 needs a new tarball-build step (in `publish.yml` or `release.mjs`). Mitigation: planner adds this as an explicit task in the carryover slice (CONTEXT specifics Slice 7). |
| A6 | `evals/v2-fixtures/` directory does not exist; only `evals/v2-fixtures.test.ts` (single file) does | Pitfall 8 | Resources snapshot file may land in unexpected location. Mitigation: planner picks location, places under `evals/v1-baseline/` next to existing snapshot. |
| A7 | Branch protection requires repo Settings access (admin); cannot be configured by a non-admin contributor | Pitfall 6 | If the release ritual is delegated, admin step blocks. Mitigation: solo maintainer is admin; not a real risk. |

## Open Questions

1. **Where does the plugin tarball build live — `publish.yml` or `release.mjs`?**
   - What we know: `publish.yml` does `npm run build` for CLI dist; nothing builds the plugin tarball today. The `plugin/` workspace has its own `esbuild.config.mjs`.
   - What's unclear: Should the tarball be built locally in `release.mjs` (so it's part of the pre-tag commit's artifacts) or in `publish.yml` (so it's reproducible on a clean runner)?
   - Recommendation: Build in `publish.yml` as a new step BEFORE the `Create GitHub Release` step, with the tarball path passed to `softprops/action-gh-release@v2`'s `files:` parameter. Reproducibility wins. Same step generates `manifest.sha256` via `shasum -a 256 vault-memory-plugin-v2.0.0.tar.gz`.

2. **Should the screencast MP4 be committed to the repo or only uploaded as a Release asset?**
   - What we know: D-14 says "GitHub Release asset only". The asset upload step in `publish.yml` would need the MP4 to be available somewhere accessible to the runner.
   - What's unclear: Does the maintainer upload the MP4 manually post-tag, or does the workflow pick it up from a pre-tag commit?
   - Recommendation: Manual upload via GitHub UI immediately after the workflow creates the empty Release page. Avoids bloating the repo with binary content. The `softprops/action-gh-release@v2` workflow can leave the Release in "draft" with `make_latest: legacy` and the maintainer attaches the MP4 + clicks "Publish".

3. **Does the `releases/download/<tag>/<filename>` URL resolve immediately or after the maintainer publishes the draft Release?**
   - What we know: GitHub generates the download URL when an asset is uploaded; the URL is predictable but only resolvable after upload completes.
   - What's unclear: Timing for the `vm-install` dry-run carryover from Phase 7 Plan 07-11 Task 3 — needs to happen AFTER the tarball asset is live.
   - Recommendation: Phase 8 sign-off order: (1) cut tag → (2) workflow publishes npm + creates draft Release → (3) maintainer uploads tarball + sha256 + mp4 to Release → (4) maintainer clicks Publish on Release → (5) live-vault dry-run of `vm-install` → (6) `docs/v2/PHASE-8-SIGN-OFF.md` commits referencing the live URL. The sign-off doc is the LAST commit before tag per CONTEXT specifics; this implies an order conflict that the planner must resolve. **Recommendation: sign off on a dry-run RC tag (`v2.0.0-rc1`) for the publish-workflow verification, then sign off on `v2.0.0` after a successful publish-and-attach cycle.**

4. **Tool count after promotion — does CONTEXT.md's "≤32 tools" target include the 6 plugin tools (default-OFF)?**
   - What we know: STATE.md says "default surface 37; +6 with `plugin.enabled = true`". CONTEXT D-01 says plugin tools are NOT counted against REL-08.
   - What's unclear: REL-08 phrasing "tool surface inventory ≤32 (after promotion)" — does the inventory mean the default-OFF tools/list result, or the union including plugin tools?
   - Recommendation: Default-OFF is the inventory (matches D-01). After promoting 5 tools (`list_vaults`, `list_models`, `recent_notes`, `vault_stats`, plus one — see Q5), default tools = 37 − 5 = 32. Plugin tools (+6) are out of budget per D-01.

5. **REL-08 closed-set fifth promotion target — `list_backlinks` or `index_runs` or another?**
   - What we know: Phase 5 sign-off (`docs/v2/PHASE-5-SIGN-OFF.md:226-246`) explicitly recommends `list_backlinks` + `list_forward_links` as promotion candidates "pure-read discovery surfaces with no side effects". CONTEXT D-02 lists `list_vaults`, `list_models`, `list_aliases` (does not exist), `recent_notes`, `vault_stats`, plus audit-log endpoints.
   - What's unclear: 5 promotions hits 32; 6 hits 31. CONTEXT D-01 says "5+". The maintainer probably wants tight 32, not over-promote.
   - Recommendation: 5 promotions: `list_vaults`, `list_models`, `recent_notes`, `vault_stats`, **and `list_backlinks`** (per Phase 5 explicit recommendation). Hits 32 exactly. Defer `list_forward_links`, `index_runs`, `audit_log` promotion to v2.x. **Replace the non-existent `list_aliases` in CONTEXT D-02 with `list_backlinks` (per Phase 5 sign-off precedent).**

## Environment Availability

> Phase 8 has limited external tool dependencies (it's mostly content + CI config). Listed below are the tools the release ritual needs.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | release.mjs | ✓ | system | — |
| `npm` | release.mjs | ✓ | ships with Node 22 | — |
| `node` | release.mjs | ✓ | 22+ | — |
| `shasum` | manifest.sha256 generation | ✓ (macOS + ubuntu-latest) | system | `sha256sum` (GNU) |
| `awk` | publish.yml CHANGELOG extract | ✓ (already in use) | system | — |
| GitHub repo admin | branch protection config | ✓ (solo maintainer) | — | — |
| `NPM_TOKEN` secret | publish.yml | ✓ (already configured per `publish.yml:66`) | — | — |
| macOS QuickTime | screencast recording | ✓ (maintainer's machine) | system | — |
| `gh` CLI (optional) | manual release management | likely ✓ | — | GitHub web UI |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

Phase 8 is a release phase; "validation" means proving the release artifacts are correct and the merge gate is enforced.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 |
| Config file | none — defaults; co-located `*.test.ts` files |
| Quick run command | `npm test` (~30-60s) |
| Full suite command | `npm run lint:check && npm test && npm run eval:baseline && npm run build && node scripts/smoketest-non-claude.mjs` |
| Phase gate | All five steps green on the v2.0.0 commit; branch protection enforces on PRs |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-01 | Eval suite runs in CI and is required for merge | smoke + manual config | `gh api repos/owrede/vault-memory/branches/main/protection \| jq '.required_status_checks.contexts'` (returns array including `"lint-and-test"`) | ❌ Wave 0 (need branch protection set up + a manual-verify step) |
| REL-02 | CHANGELOG `[Unreleased]` contains every user-visible Phase 2-7 change | manual review | grep-based diff: every phase has at least one entry; `git log --since="Phase 5 start" --grep "user-visible"` cross-checked | ❌ manual sign-off task |
| REL-03 | README rewritten 6-section structure | manual review | maintainer reads cold + checks all 6 sections present | ❌ manual |
| REL-04 | README Roadmap names Phase 9/v3 | grep | `grep -q "Phase 9" README.md && grep -q "v3" README.md` | automatable in CONTRIBUTING.md note |
| REL-05 | MIGRATION-V1-TO-V2.md covers SDK 1.29 + Zod 4 | grep | `grep -q "1.29" docs/v2/MIGRATION-V1-TO-V2.md && grep -q "Zod 4" docs/v2/MIGRATION-V1-TO-V2.md` | ❌ Wave 0 |
| REL-06 | v2.0.0 tag exists + GitHub Release auto-created | manual + workflow | `git tag -l v2.0.0` returns the tag; `gh release view v2.0.0` returns the Release | n/a — verified post-release |
| REL-07 | npm publish completed | manual + workflow | `npm view @owrede/vault-memory@2.0.0 version` returns `2.0.0` | n/a — verified post-publish |
| REL-08 | Default tools/list = 32 entries | snapshot test | `npm run eval:baseline` passes against updated `tools-list.snapshot.json` (32 entries after promotion); plus extended assertion in `scripts/smoketest-non-claude.mjs` | ❌ Wave 0 (snapshot regen) |
| REL-09 | Maintainer signed off | manual | maintainer line at bottom of `docs/v2/PHASE-8-SIGN-OFF.md` | ❌ manual (D-18) |

### Sampling Rate
- **Per task commit:** `npm test` (quick — runs vitest only)
- **Per wave merge:** `npm run lint:check && npm test && npm run eval:baseline` (matches CI's first 3 steps)
- **Phase gate (pre-tag):** Full 5-step command above + `npm run build && node scripts/smoketest-non-claude.mjs`

### Wave 0 Gaps
- [ ] `scripts/release.mjs` — does not exist; create with version-bump + CHANGELOG-rename + commit + tag + push
- [ ] `CONTRIBUTING.md` — does not exist (verified absent); create with "Cut a release" + "Eval suite is a merge gate" sections
- [ ] `evals/v1-baseline/resources-list.snapshot.json` — does not exist; generate via a new `dump-resources.mjs` or extend `dump-tools.mjs`
- [ ] `docs/v2/MIGRATION-V1-TO-V2.md` — does not exist; create per D-12
- [ ] `docs/v2/PHASE-8-SIGN-OFF.md` — does not exist; create per D-18 (template from `docs/v2/PHASE-6-SIGN-OFF.md`)
- [ ] `docs/v2/plugin/screencast-thumbnail.png` — does not exist; create per D-14
- [ ] Tarball-build step in `publish.yml` — does not exist; add step before the `Create GitHub Release` step
- [ ] Branch protection rule — must be configured via GitHub Settings → Branches → main

## Tool Surface Today (REL-08 baseline)

**Default (plugin OFF) — 37 tools** (verified by counting `"name":` entries in `evals/v1-baseline/tools-list.snapshot.json`):

| # | Tool | Phase introduced | List-style? | REL-08 candidate |
|---|------|------------------|-------------|---------|
| 1 | `list_vaults` | v1 | ✓ enumeration | **YES — D-02** |
| 2 | `read_note` | v1 | — | no |
| 3 | `search_semantic` | v1 | — | no |
| 4 | `search_text` | v1 | — | no |
| 5 | `search_hybrid` | v1 | — | no |
| 6 | `list_backlinks` | v1 | ✓ per-doc enum | **recommended** (Phase 5 sign-off) |
| 7 | `list_forward_links` | v1 | ✓ per-doc enum | candidate (defer to v2.x) |
| 8 | `find_broken_links` | v1 | — | no |
| 9 | `query_frontmatter` | v1 | — (DSL) | no |
| 10 | `write_note` | v1 | — | no |
| 11 | `update_frontmatter` | v1 | — | no |
| 12 | `delete_note` | v1 | — | no |
| 13 | `audit_log` | v1 | ✓ (filtered enum) | candidate but has params |
| 14 | `list_models` | v1 | ✓ enumeration | **YES — D-02** |
| 15 | `start_shadow_index` | v1 | — | no |
| 16 | `switch_active_model` | v1 | — | no |
| 17 | `vacuum_embeddings` | v1 | — | no |
| 18 | `index_runs` | v1 | ✓ enum | candidate (defer) |
| 19 | `search` | v0.9 (OB1) | — | no |
| 20 | `fetch` | v0.9 (OB1) | — | no |
| 21 | `vault_stats` | v0.9 | ✓ (read-only stats) | **YES — D-02** |
| 22 | `recent_notes` | v0.9 | ✓ enum | **YES — D-02** |
| 23 | `suggest_frontmatter` | v0.10 | — | no |
| 24 | `record_observation` | Phase 2 | — | no |
| 25 | `recall` | Phase 2 | — | no |
| 26 | `supersede` | Phase 2 | — | no |
| 27 | `get_outline` | Phase 3 | — (per-doc) | no |
| 28 | `search_sections` | Phase 3 | — | no |
| 29 | `get_document_bundle` | Phase 3 | — | no |
| 30 | `assemble_dossier` | Phase 3 | — | no |
| 31 | `expand` | Phase 4 | — | no |
| 32 | `cluster` | Phase 4 | — | no |
| 33 | `compile_brief` | Phase 5 | — | no |
| 34 | `get_brief` | Phase 5 | — | no |
| 35 | `describe_contract` | Phase 6 | — | no |
| 36 | `instantiate_contract` | Phase 6 | — | no |
| 37 | `register_contracts_as_tools` | Phase 6 | — | no |

**Plugin-enabled (additive when `[plugin] enabled = true`)** — 6 tools, NOT counted against REL-08 budget (per D-01 + Phase 7 design):
`set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats`, `trigger_reindex`, `suppress_contract_write`.

**Existing MCP Resources today** (5; verified `src/server.ts:1756-1920`):
| URI | Phase | Source |
|-----|-------|--------|
| `vault-memory://memory/sinks` | Phase 2 | `src/server.ts:1756` |
| `vault-memory://memory/stats` | Phase 2 | `src/server.ts:1776` |
| `vault-memory://briefs` | Phase 5 (BRF-09) | `src/server.ts:1803` |
| `vault-memory://contracts/{vault}` | Phase 6 (CON-04) | `src/server.ts:1850` |
| `vault-memory://contract-verbs/{vault}` | Phase 6 (D-A2b) | `src/server.ts:1895` |

**CONTEXT D-02 candidate inventory verification:**
- `list_vaults` → exists in TOOLS ✓
- `list_models` → exists in TOOLS ✓
- `list_aliases` → **does NOT exist in TOOLS** — this is a phantom; verified by grep. Likely confused with the Obsidian-style aliases substrate (`AliasesQueries` in `src/db/`) which is internal-only, not a tool.
- `recent_notes` → exists in TOOLS ✓
- `vault_stats` → exists in TOOLS ✓
- `list_briefs` → already a Resource (Phase 5 BRF-09) ✓ verified
- `list_contracts` + `list_contract_verbs` → already Resources (Phase 6) ✓ verified
- Audit-log list-style — `audit_log` and `index_runs` are filtered/paginated, not pure enumeration; defer

**Closed-set recommendation (5 promotions, hits 32 exactly):**
1. `list_vaults` → `vault-memory://vaults`
2. `list_models` → `vault-memory://models/{vault}`
3. `recent_notes` → `vault-memory://recent/{vault}`
4. `vault_stats` → `vault-memory://stats/{vault}`
5. `list_backlinks` → `vault-memory://backlinks/{vault}/{docId}` (per Phase 5 sign-off explicit recommendation)

After promotion: 37 − 5 = **32 tools** (D-01 target hit). Resources count: 5 existing + 5 new = 10. Plugin tools (+6) unchanged, default-OFF.

## CHANGELOG Audit (actual state)

**Current `[Unreleased]` entries** (verified by reading `CHANGELOG.md:13-128`):

| Phase | Has entry? | Evidence |
|-------|-----------|----------|
| Phase 1 (adapters) | ✓ YES — "Adapter seams (Phase 1, plans 01-01..06)" + 4 sub-bullets (`CHANGELOG.md:39-45`) | full coverage |
| Phase 2 (memory) | ✓ YES — `record_observation`, `recall`, `supersede`, MCP Resources (sinks/stats), is_memory_sink_write column, MemorySink runtime, 5 fixture docs (`CHANGELOG.md:46-57`) | full coverage |
| Phase 3 (assembly) | ✓ YES — section identity substrate, `get_outline`, `search_sections`, `get_document_bundle`, `assemble_dossier`, search_hybrid rescore signals, recency eval fixture (`CHANGELOG.md:58-73`) | full coverage |
| Phase 4 (graph) | ✓ YES — `expand`, `cluster`, search_hybrid({expand}), typed edges, indexer changes (`CHANGELOG.md:27-38`) | full coverage |
| **Phase 5 (briefs)** | **✗ MISSING** | No entries for `compile_brief`, `get_brief`, `list_briefs` Resource, staleness daemon, migration 013, ChunkId fragment, OllamaClient.chat() |
| Phase 6 (contracts) | ✓ YES — Task Contract DSL, 3 contract tools, 2 contract Resources, reference contracts, contract_audit, [contracts] config, write_back chokepoint (`CHANGELOG.md:17-26`) | full coverage |
| **Phase 7 (plugin)** | **✗ MISSING** | No entries for plugin tools (6, gated), `.contract` file format, three-pane editor, safeStorage secrets, ReloadNotifier, hash-aware SuppressionSet, vm-install/vm-update skills, 6 plugin docs |
| Phase 0 (foundations) | ✓ YES — relocated ADRs, ARCHITECTURE.md, MEMORY_CONTRACT.md, AGENT_AGNOSTIC.md, fixture vault, v1-baseline regression suite, CI lints (`CHANGELOG.md:117-127`) | full coverage |

**Source documents for Phase 5 + Phase 7 backfill:**
- Phase 5: `docs/v2/PHASE-5-SIGN-OFF.md` (382 lines) — §"What shipped" + §"Migration delta" + §"Test counts"
- Phase 7: `.planning/phases/07-visual-contract-editor-canvas/VERIFICATION.md` + per-plan summaries (`07-01-SUMMARY.md` through `07-12-SUMMARY.md`) — phase has no `docs/v2/PHASE-7-SIGN-OFF.md` file; the VERIFICATION.md is the equivalent artifact

**Major correction to CONTEXT D-08:** The decision text says "Phase 2 (memory), 3 (assembly), 5 (briefs), 7 (plugin) appear to be missing". **Actual state: Phase 2 and Phase 3 ARE present; only Phase 5 and Phase 7 are missing.** Planner should write entries ONLY for Phases 5 and 7. Do NOT rewrite Phase 2/3/4/6 entries that already exist.

## README Rewrite Scope

Current `README.md` (459 lines) structure:
1. Title + tagline (lines 1-21)
2. "What is vault-memory?" (lines 22-40) — features bullet list
3. "What it provides" — MCP tools (23) section (lines 42-90)
4. Implicit v1.0.0 + 0.x progression context
5. Plugin section (Phase 7 added, ~lines 200-290) — has v2.0.0 framing
6. Architecture in one paragraph (lines 290+)
7. Reranker, Search scope, etc. (deep technical detail)

**Per D-11 6-section target:**

| § | Target | Source for content |
|---|--------|---------|
| 1. 30-second example | install + add-vault + serve + Claude Desktop config + 1-paragraph "what you can do" | New; example contract is `meeting-prep` (per CONTEXT) |
| 2. What this is | "agentic knowledge layer over Obsidian; more sources coming" | `docs/v2/AGENT_AGNOSTIC.md` + PROJECT.md core value |
| 3. Architecture (ASCII) | L0…L5 layer model | `docs/v2/ARCHITECTURE.md` |
| 4. What's new in v2 | bullets per phase: memory / assembly / graph / briefs / contracts / plugin | CHANGELOG `[Unreleased]` after backfill |
| 5. Roadmap | Phase 9 hard gate; v3.0.0 (Phase 10) Notion connector | `.planning/ROADMAP.md` §"Phase 9" + §"Phase 10" + §"v3.0.0 — Deferred" |
| 6. Install & docs | links to INSTALL/plugin docs/MIGRATION/ARCHITECTURE/ADRs | `docs/v2/plugin/INSTALL.md`, `docs/v2/plugin/README.md`, `docs/v2/MIGRATION-V1-TO-V2.md`, `docs/v2/ARCHITECTURE.md`, `docs/v2/adr/README.md` |

**Preserve from current README:**
- The "any MCP-aware agent" framing (`README.md:1-21`) is the v2 pitch already
- Reranker setup steps (one-time `bash scripts/download-reranker.sh`) — relocate to §6 or `docs/v2/INSTALL.md` (planner decides)
- `VAULT_MEMORY_ACTIVE_VAULT` env var note — relocate to §6
- v1.0.0 stability declaration link to CHANGELOG `[1.0.0]` block (Pitfall 7)

## MIGRATION Content (D-12 outline)

### Body sections (library consumers — primary)
1. **Major dependency bumps**
   - `@modelcontextprotocol/sdk`: `^1.0.4` → `^1.29.0` (verified `package.json:41`) — breaking: low-level `Server` → `McpServer` migration path
   - `zod`: `^3.x` → `^4.4.3` (verified `package.json:52`) — breaking: refinements + `errorMap` sweep per Zod 4 migration guide
2. **TypeScript config changes**
   - `verbatimModuleSyntax: true` adopted (Phase 1) — downstream consumers must use `import type { Foo }` for type-only imports
3. **Tool API delta (no breaking changes)**
   - All 23 v1 tools preserved byte-identical (verified by `tools-list.snapshot.json` v1 entries pinned in `baseline.test.ts`)
   - New tools (14 net new in v2: 3 Phase 2 + 4 Phase 3 + 2 Phase 4 + 2 Phase 5 + 3 Phase 6) all have net-new names per PROJECT.md "Backwards compat non-negotiable until a major version. Net-new tools get net-new names."
   - Additive widening in `search_hybrid` (rescore params, expand param); `assemble_dossier`/`get_document_bundle` `relation` field widens from `"wikilink"` literal to `EdgeType` union
4. **Type system changes downstream consumers will see**
   - Branded `DocId` (nominal type) — old `string` callsites need explicit narrowing via `parseDocId()` (per ADR-001)
   - `Document.properties: Record<string, unknown>` is the canonical content type (ADR-003)
   - `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` interfaces (ADR-002)
5. **Resources promotion (REL-08)**
   - 5 list-style tools deprecated in description; Resources URIs canonical
   - List of deprecated tools + Resource URIs per the final closed set

### Appendix (end-user — one paragraph per phase)
- Phase 2 memory namespace → `record_observation`, `recall`, `supersede`; link to `docs/v2/MEMORY_CONTRACT.md`
- Phase 3 assembly tools → `get_outline`, `search_sections`, `get_document_bundle`, `assemble_dossier`; link to `docs/v2/PHASE-3-SIGN-OFF.md`
- Phase 4 graph → `expand`, `cluster`, typed edges; link to `docs/v2/PHASE-4-SIGN-OFF.md`
- Phase 5 briefs → `compile_brief`, `get_brief`, `list_briefs` Resource; link to `docs/v2/PHASE-5-SIGN-OFF.md`
- Phase 6 contracts → `describe_contract`, `instantiate_contract`, `register_contracts_as_tools`, contracts Resources; link to `docs/v2/PHASE-6-SIGN-OFF.md`
- Phase 7 plugin → Obsidian plugin (separate install via `vm-install` skill); link to `docs/v2/plugin/README.md`

**Location decision:** Primary file at `docs/v2/MIGRATION-V1-TO-V2.md` (matches Phase 7 docs layout). Optional repo-root `MIGRATION-V1-TO-V2.md` stub of 2-3 lines: "See [docs/v2/MIGRATION-V1-TO-V2.md](docs/v2/MIGRATION-V1-TO-V2.md)". The stub aids discoverability for users browsing the GitHub repo root; planner decides if worth the extra file.

## Phase 9 Compatibility (HARD GATE — what NOT to touch)

Phase 9 (per `.planning/ROADMAP.md:270-286`) verifies the v3 multi-source premise. Phase 8 must not invalidate these gates:

- **GAT-01:** All Phase 1 CI greps return zero hits on main. Phase 8 must not introduce new chokidar/gray-matter/path/`Claude`/`obsidian://`/`.md`-literal usage outside adapters. The 5 Resource registrations land in `src/server.ts` (already an outer-layer file); their URI strings (`vault-memory://...`) are fine. Resource read handlers must NOT touch `path.*` directly — go through `manager.list()` / vault DBs. **Check `scripts/lint-adapters.sh` runs green after every Phase 8 commit.**
- **GAT-02:** ADRs 001–004 remain unviolated. Promoting tools to Resources is additive at the seam — Resource handlers can call the same internal functions (e.g., `manager.list()` for `list_vaults`). Do NOT introduce new DocId mint sites (ADR-001 §I-6); do NOT bypass the registry; do NOT add new path-literal sites.
- **GAT-03:** Stub-adapter conformance suite green. Adding Resources does NOT add to the conformance suite (Resources are server-level, not adapter-level). No action needed; verify by running `npm test` post-promotion.
- **GAT-04:** Capability-descriptor test coverage. Phase 7 added these; Phase 8 must not regress.
- **GAT-05:** Maintainer sign-off cleared. Phase 8 sign-off (`docs/v2/PHASE-8-SIGN-OFF.md`) does NOT pre-empt Phase 9.

**Concrete Phase 8 → Phase 9 contract:**
- All 5 new Resource registrations route through existing internal layers (no new file-system access)
- `scripts/lint-adapters.sh` stays green
- `src/adapters/source/conformance.test.ts` + `delivery/conformance.test.ts` + `change-feed/conformance.test.ts` stay green
- No new ADR amendments needed
- The deprecation notes added to 5 tool descriptions DO modify v1 tool descriptions byte-content — **this is the one exception to "v1 byte-identical"** and must be called out in CHANGELOG + MIGRATION as an additive description-only change. The `inputSchema` and tool name stay byte-identical; only the `description` text gains "deprecated since v2.0.0; use Resource ..." appended. **Verify with maintainer that this is acceptable** before promotion; if not, fall back to ≤40 budget (REL-08 escape hatch in ROADMAP success criterion 5).

## Project Constraints (from CLAUDE.md)

The vault-memory `CLAUDE.md` enforces these directives that Phase 8 must honor:

1. **Tech stack locked** — TypeScript 5.7+, Node ≥22, ESM-only, MCP SDK ≥1.0.4. Phase 8 does not change.
2. **Local-only network** — `localhost:11434` (Ollama) only. Phase 8 does not introduce remote calls (release publishes via GitHub Actions runner, not from the local server).
3. **Backwards-compatible v1.x API** — Phase 8 deprecates 5 tool descriptions (additive); does NOT remove or change signatures. Tool names + inputSchema preserved.
4. **Seam preservation** — Resource read handlers must not introduce new chokidar/path/gray-matter usage. All 5 promotions route through existing `manager`, query objects, or already-public helpers.
5. **Memory namespace sacrosanct** — Phase 8 does not touch this. No changes to `MemorySinkRegistry`, `DeliveryAdapter.write()`, or the labeled-sink invariant.
6. **Document identity opaque** — Resource URIs use `vault-memory://...` (server scheme), not document `obsidian://...` URIs. New URIs do not violate.
7. **Test discipline — 324 tests, do not regress** — Phase 8 actually runs at 1657+ tests (per Phase 7 sign-off). The 324 was an older floor; current is higher. Phase 8 must not regress; CI enforces.
8. **Branch hygiene** — `gsd/phase-08-...` per `.planning/config.json` `phase_branch_template`. Deliverable PRs onto the phase branch; merge to main at sign-off. Configured.
9. **Eval discipline** — fixture vault eval suite consumes `Document` objects from Phase 3 onward. Phase 8 doesn't change fixtures.
10. **No premature LLM coupling** — Phase 8 doesn't add LLM dependencies (briefs LLM call is Phase 5's `OllamaClient.chat`).
11. **GSD workflow enforcement** — Phase 8 goes through `/gsd:plan-phase` then `/gsd:execute-phase`. Standard.

**No-marketing-language enforcement** (PROJECT.md + CLAUDE.md/RULES.md `Professional Honesty`):
- README rewrite: zero "blazingly fast", "magnificent", "100% secure"
- CHANGELOG backfill: technical, terse (matches existing voice)
- MIGRATION: factual, no promotional tone
- Release tag annotation message: `git tag -a v2.0.0 -m "v2.0.0"` (mirror existing simple style; do not write a marketing tagline)

## Security Domain

Phase 8 is a release phase with minimal new attack surface. ASVS categories applicable:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | `NPM_TOKEN` granular access token + bypass-2fa for `npm publish` (already configured per `publish.yml:66`); GitHub repo admin OAuth |
| V3 Session Management | no | n/a — release tooling, no sessions |
| V4 Access Control | yes | Branch protection on `main` (D-06); `id-token: write` permission scoped per `publish.yml:19` |
| V5 Input Validation | minimal | `release.mjs` validates version string format and clean tree; refuses to proceed otherwise |
| V6 Cryptography | yes | npm provenance attestation via OIDC (`--provenance` flag in `publish.yml:64`); `manifest.sha256` for plugin tarball integrity (D-15) |
| V14 Configuration | yes | Branch protection config + repo secrets handling |

### Known Threat Patterns for release pipeline

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquatting of an npm dependency | Spoofing | No new deps in Phase 8; existing audit happened in prior phases (Phase 4 package legitimacy review documented) |
| NPM_TOKEN leakage from CI logs | Information disclosure | Already mitigated: GitHub Actions automatically masks `NODE_AUTH_TOKEN`; no `echo $NODE_AUTH_TOKEN` anywhere |
| Tag race (push tag without commit) | Tampering | `publish.yml:50-57` verifies `package.json.version == tag`; aborts on mismatch |
| Malicious release-script PR | Tampering | Branch protection requires `lint-and-test` green; `release.mjs` lands via the same PR review path |
| GitHub Release asset replacement | Tampering | `manifest.sha256` checksum lets `vm-install`/`vm-update` verify tarball integrity |
| Compromised maintainer machine recording screencast | n/a | Out of scope; not threat-modelled |
| Unverified `softprops/action-gh-release@v2` | Supply chain | Pin to a specific SHA (recommendation), or accept v2 major tag (current state — acceptable for solo maintainer, can tighten in v2.x) |

**Recommendation:** Keep `softprops/action-gh-release@v2` as a major version tag for now (matches industry norm); if security posture tightens in v3, pin to a SHA.

## Sources

### Primary (HIGH confidence) — repo files at HEAD
- `package.json` (`package.json:1-64`) — version, scripts, dependencies
- `CHANGELOG.md` (`CHANGELOG.md:1-370`) — current `[Unreleased]` content verified
- `README.md` (`README.md:1-459`) — current state
- `.github/workflows/ci.yml` (`ci.yml:1-54`) — CI pipeline; job `lint-and-test`
- `.github/workflows/publish.yml` (`publish.yml:1-104`) — release pipeline; verified npm publish + GitHub Release + CHANGELOG extraction logic
- `evals/v1-baseline/tools-list.snapshot.json` (`tools-list.snapshot.json:1-1148`) — 37 tool entries verified
- `src/server.ts` (`src/server.ts:1700-1920`) — tool registration + 5 Resources
- `src/tool-registry.ts` (`src/tool-registry.ts:41-460`) — TOOLS array, 37 entries
- `scripts/smoketest-non-claude.mjs` (`smoketest-non-claude.mjs:11-345`) — EXPECTED_TOOLS, 37 entries
- `docs/v2/PHASE-5-SIGN-OFF.md` — Phase 5 user-visible changes for CHANGELOG backfill
- `docs/v2/PHASE-6-SIGN-OFF.md` — REL-08 hand-off context
- `.planning/phases/07-visual-contract-editor-canvas/VERIFICATION.md` + per-plan SUMMARY.md files — Phase 7 backfill source
- `.planning/STATE.md` — current position, Phase 8 carryover list
- `.planning/ROADMAP.md` (`ROADMAP.md:246-286`) — Phase 8 + Phase 9 sections
- `.planning/REQUIREMENTS.md` (`REQUIREMENTS.md:142-152`) — REL-01..REL-09
- `skills/vm-install/setup.sh` (`setup.sh:26-29`) — RELEASE_URL pattern
- `skills/vm-update/update.sh` (`update.sh:23-338`) — RELEASE_URL_PLACEHOLDER template
- `plugin/manifest.json` — already at version 2.0.0
- `CLAUDE.md` (project root) — project constraints

### Secondary (MEDIUM confidence) — pattern interpolation
- Existing Resource registration pattern (`src/server.ts:1756`, `1776`, `1803`, `1850`, `1895`) — 5 examples to follow for the 5 promotions
- Existing CHANGELOG section voice — terse, technical, links to phase docs; backfill voice should match

### Tertiary (LOW confidence) — external references
- Keep a Changelog 1.1.0 spec — referenced in CHANGELOG header, not re-fetched in this research
- SemVer 2.0.0 — universal
- GitHub branch protection / declarative format — researcher could not verify a stable in-tree format exists as of 2026 (A2)
- `softprops/action-gh-release@v2` version stability — assumed stable v2 major; could pin to SHA for hardening

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in `package.json`; no new deps
- Architecture: HIGH — patterns directly read from existing `src/server.ts` Resource registrations
- Pitfalls: HIGH — derived from observed state mismatches between CONTEXT and repo (CHANGELOG backfill scope; non-existent `list_aliases` tool; two different `RELEASE_URL_PLACEHOLDER` patterns; missing `evals/v2-fixtures/` directory; tarball-build step not yet present)
- Resources promotion: HIGH — existing 5-Resource pattern is the template; URI design follows BRF-09 + Phase 6 precedent
- Branch protection mechanism: MEDIUM — declarative format availability not freshly verified against GitHub docs

**Research date:** 2026-05-19
**Valid until:** 2026-06-18 (30 days; release engineering surface is slow-moving)
