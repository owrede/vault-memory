# Contributing to vault-memory

## Cut a release (D-17)

To publish a new version, on a clean `main` checkout:

```bash
npm run release 2.0.0
```

`scripts/release.mjs` runs 6 phases. It refuses to proceed if any pre-flight gate fails:

1. **Pre-flight** — validates the version arg matches semver, the working tree is clean, the
   current branch is `main`, and `CHANGELOG.md` has a non-empty `## [Unreleased]` block.
2. **Test gate** — runs `npm test`. There is no skip-tests flag.
3. **Version bump** — `npm version X.Y.Z --no-git-tag-version` updates `package.json` and
   `package-lock.json`.
4. **CHANGELOG rename** — renames `## [Unreleased]` → `## [X.Y.Z] — YYYY-MM-DD` (em-dash,
   matches the awk extractor in `.github/workflows/publish.yml`) and re-opens a fresh
   `## [Unreleased]` block above it with `_Nothing yet._`.
5. **Commit, tag, atomic push** — commits the three files with message `release: vX.Y.Z`,
   annotates tag `vX.Y.Z`, and runs `git push --follow-tags origin main` as a single atomic
   push. The script never force-pushes.
6. **Confirmation** — prints the next-step pointers to stderr.

The tag push triggers `.github/workflows/publish.yml`, which publishes to npm (with
provenance) and creates the GitHub Release using the matching CHANGELOG section as the
body. The plugin tarball + `manifest.sha256` are attached automatically as Release assets.

**Manual step:** after the workflow completes, upload the MP4 screencast asset to the
GitHub Release page via the GitHub UI. The MP4 is intentionally not committed to the
repo (per D-13 / D-14).

## Eval suite is a merge gate (D-06)

Pull requests targeting `main` cannot merge unless the GitHub Actions check
`lint-and-test` (defined in `.github/workflows/ci.yml`) is green. The check runs the
full eval suite as four sub-checks:

- `npm run lint:check` — fixture-privacy + no-telemetry + adapter-seam invariants + `tsc --noEmit` + `prettier --check`
- `npm test` — vitest (includes `evals/v1-baseline/` snapshot tests and stub-adapter conformance)
- `npm run eval:baseline` — v1 tools-list snapshot + Resources-list snapshot + per-tool semantic floors
- `npm run build` + `node scripts/smoketest-non-claude.mjs` — non-Claude MCP SDK Client smoketest against `dist/cli.js`

If the check is red, fix the failure and push a new commit. **There is no `[skip eval]`
override. A red eval is a real signal.**

Branch protection is configured via GitHub Settings → Branches → `main` →
"Require status checks to pass before merging" with `lint-and-test` selected
(configured by plan 08-07).
