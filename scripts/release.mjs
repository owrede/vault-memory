/**
 * vault-memory release ritual — REL-06 / D-17.
 *
 * Single-script "cut a release" entry point. Drives the version bump,
 * CHANGELOG rename, commit, tag, and atomic push from the maintainer's
 * machine. The tag push triggers `.github/workflows/publish.yml` which
 * handles npm publish (with provenance) + GitHub Release creation.
 *
 * Design philosophy (releases are rare; a botched release is expensive):
 *   - Fail fast and loud. Every pre-flight gate prints a clear, actionable
 *     stderr message and exits non-zero. Never proceed past a red gate.
 *   - No force-push, ever. The atomic `git push --follow-tags` is the
 *     ONLY push this script issues. Branch protection (configured in
 *     plan 08-07) refuses force-pushes to main as a second-line defense.
 *   - Never skip tests. `npm test` runs unconditionally before the
 *     version bump. There is no `--skip-tests` flag and there never will
 *     be — a red local test predicts a red CI.
 *   - The CHANGELOG rename must produce EXACTLY `## [X.Y.Z] — YYYY-MM-DD`
 *     (em-dash U+2014) so the awk extractor in publish.yml:76 matches.
 *
 * Phases:
 *   1. Pre-flight   — validate args, clean tree, on main, non-empty Unreleased.
 *   2. Test gate    — `npm test` (fail-fast via stdio: "inherit").
 *   3. Version bump — `npm version X.Y.Z --no-git-tag-version` (package.json).
 *   3b. Sync        — mirror the version into plugin/package.json,
 *                     plugin/manifest.json, and the README `Latest: **vX.Y.Z**`
 *                     badge so src/version-consistency.test.ts stays green (a
 *                     drift here previously failed publish.yml AFTER tagging).
 *   4. CHANGELOG    — stable releases rename `## [Unreleased]` → `## [X.Y.Z]`.
 *                     Prereleases INSERT a `## [X.Y.Z-pre] — YYYY-MM-DD`
 *                     snapshot above Unreleased without renaming it, so
 *                     Unreleased keeps accumulating through subsequent
 *                     prereleases until the final stable cut.
 *   5. Commit + tag + atomic push (`git push --follow-tags`).
 *   6. Confirmation — print what happens next.
 *
 * Prerelease behavior (e.g. 2.0.0-rc.1):
 *   - publish.yml's `npm publish` step picks up the prerelease suffix and
 *     publishes under the `next` dist-tag (configured in publish.yml itself,
 *     not in this script). `latest` is left untouched, so users running
 *     `npm install -g @owrede/vault-memory` (no version pin) still get the
 *     stable release.
 *   - GitHub flags the release as "Pre-release" automatically because the
 *     tag has a -prerelease suffix.
 *
 * Usage:
 *   node scripts/release.mjs 2.0.0           # stable release
 *   node scripts/release.mjs 2.0.0-rc.1      # prerelease (rc, beta, alpha)
 *   npm run release -- 2.0.0
 */

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { argv, exit, stderr, stdout } from "node:process";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SEMVER_PRERELEASE_RE = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;
const CHANGELOG_PATH = "CHANGELOG.md";
const PLUGIN_PKG_PATH = "plugin/package.json";
const PLUGIN_MANIFEST_PATH = "plugin/manifest.json";
const README_PATH = "README.md";
// The README carries a `Latest: **vX.Y.Z**` marker that
// src/version-consistency.test.ts asserts equals the CLI version.
const README_LATEST_RE = /(Latest:\s*\*\*v)\d+\.\d+\.\d+(\*\*)/;
const UNRELEASED_HEADING = "## [Unreleased]";
const NOTHING_YET = "_Nothing yet._";
const EM_DASH = "—"; // U+2014 — must match existing CHANGELOG entries

/**
 * Is this version a prerelease (e.g. 2.0.0-rc.1, 2.0.0-beta.3)?
 * Stable releases (e.g. 2.0.0) are NOT prereleases.
 */
function isPrerelease(version) {
  return SEMVER_PRERELEASE_RE.test(version);
}

/**
 * Print an error to stderr and exit non-zero.
 * @param {string} message
 * @param {number} [code=1]
 * @returns {never}
 */
function fail(message, code = 1) {
  stderr.write(`error: ${message}\n`);
  exit(code);
}

/**
 * Capture stdout of a shell command (trimmed).
 * Throws if the command exits non-zero.
 * @param {string} cmd
 * @returns {string}
 */
function capture(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

/**
 * Run a shell command with inherited stdio (fail-fast on non-zero exit).
 * @param {string} cmd
 */
function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

/**
 * Set the `version` field in a JSON file, preserving 2-space indentation and a
 * trailing newline (matches prettier + how `npm version` writes package.json).
 * @param {string} path
 * @param {string} version
 */
async function setJsonVersion(path, version) {
  const raw = await readFile(path, "utf8");
  const json = JSON.parse(raw);
  json.version = version;
  await writeFile(path, JSON.stringify(json, null, 2) + "\n");
}

// ─── Phase 1 — Pre-flight validations ────────────────────────────────────────

const VERSION = argv[2];

if (!VERSION) {
  fail(
    "missing version argument.\n" +
      "usage: node scripts/release.mjs <X.Y.Z>\n" +
      "       npm run release -- <X.Y.Z>\n" +
      "example: node scripts/release.mjs 2.0.0",
  );
}

if (!SEMVER_RE.test(VERSION)) {
  fail(
    `version "${VERSION}" is not a valid semver string.\n` +
      "expected: X.Y.Z or X.Y.Z-prerelease (e.g. 2.0.0, 2.0.0-rc.1)",
  );
}

// 1a — Working tree must be clean
const dirty = capture("git status --porcelain");
if (dirty) {
  fail("working tree is dirty — commit or stash first.\n" + "uncommitted changes:\n" + dirty);
}

// 1b — Must be on main
const branch = capture("git branch --show-current");
if (branch !== "main") {
  fail(`not on main branch (currently: ${branch || "<detached HEAD>"}).`);
}

// 1c — CHANGELOG must have `## [Unreleased]` heading
let changelog = await readFile(CHANGELOG_PATH, "utf8");
const lines = changelog.split("\n");
const unreleasedIdx = lines.findIndex((l) => l === UNRELEASED_HEADING);
if (unreleasedIdx === -1) {
  fail(
    `no \`${UNRELEASED_HEADING}\` heading found in ${CHANGELOG_PATH}.\n` +
      "the release script requires an Unreleased section to rename.",
  );
}

// 1d — Unreleased block must be non-empty (more than whitespace / `_Nothing yet._`)
const nextHeadingIdx = lines.findIndex((l, i) => i > unreleasedIdx && l.startsWith("## ["));
const unreleasedEnd = nextHeadingIdx === -1 ? lines.length : nextHeadingIdx;
const unreleasedBody = lines
  .slice(unreleasedIdx + 1, unreleasedEnd)
  .join("\n")
  .replace(NOTHING_YET, "")
  .trim();

if (unreleasedBody.length === 0) {
  fail(
    `${UNRELEASED_HEADING} block is empty — add user-visible changes to ${CHANGELOG_PATH} before release.\n` +
      "every release must surface at least one entry under Added / Changed / Fixed / Deprecated.",
  );
}

stderr.write(`Pre-flight OK. Releasing v${VERSION} from main.\n`);

// ─── Phase 2 — Test gate ─────────────────────────────────────────────────────

stderr.write("\n→ Phase 2: running npm test (fail-fast)…\n");
try {
  run("npm test");
} catch {
  fail("npm test failed — refusing to cut a release with red tests.");
}

// ─── Phase 3 — Version bump ──────────────────────────────────────────────────

stderr.write(`\n→ Phase 3: npm version ${VERSION} --no-git-tag-version…\n`);
try {
  run(`npm version ${VERSION} --no-git-tag-version`);
} catch {
  fail(`npm version ${VERSION} failed — check that ${VERSION} is greater than current version.`);
}

// ─── Phase 3b — Sync sibling version declarations ────────────────────────────
//
// `npm version` bumps package.json only. But src/version-consistency.test.ts
// (Issue #14 / P4) requires plugin/package.json, plugin/manifest.json, and the
// README `Latest: **vX.Y.Z**` badge to all equal the CLI version — otherwise
// publish.yml's Test step fails AFTER the tag is already pushed (as happened
// on the 2.3.1 cut). Sync all three here so the release commit is internally
// consistent and CI stays green.

stderr.write(
  `\n→ Phase 3b: syncing ${PLUGIN_PKG_PATH}, ${PLUGIN_MANIFEST_PATH}, ${README_PATH} to ${VERSION}…\n`,
);
try {
  await setJsonVersion(PLUGIN_PKG_PATH, VERSION);
  await setJsonVersion(PLUGIN_MANIFEST_PATH, VERSION);

  const readme = await readFile(README_PATH, "utf8");
  if (!README_LATEST_RE.test(readme)) {
    fail(
      `${README_PATH} has no \`Latest: **vX.Y.Z**\` marker to update.\n` +
        "src/version-consistency.test.ts expects one — restore it before releasing.",
    );
  }
  await writeFile(README_PATH, readme.replace(README_LATEST_RE, `$1${VERSION}$2`));
  stderr.write(`  synced plugin package + manifest + README badge.\n`);
} catch (err) {
  fail(`version sync failed: ${err instanceof Error ? err.message : String(err)}`);
}

// ─── Phase 4 — CHANGELOG section ─────────────────────────────────────────────
//
// Stable release behavior (e.g. cutting 2.0.0):
//   Rename `## [Unreleased]` → `## [X.Y.Z] — YYYY-MM-DD` and insert a fresh
//   empty `## [Unreleased]` above it. The existing Unreleased entries become
//   the new release's content.
//
// Prerelease behavior (e.g. cutting 2.0.0-rc.1):
//   The Unreleased section continues accumulating changes through subsequent
//   prereleases up to the final stable cut. So we INSERT a snapshot heading
//   `## [X.Y.Z-pre] — YYYY-MM-DD` above the Unreleased block without renaming
//   anything. The snapshot copies the current Unreleased entries as a frozen
//   record of "what shipped in this prerelease". Future prereleases get their
//   own snapshot heading; the final stable cut renames Unreleased as usual.

const PRERELEASE = isPrerelease(VERSION);
stderr.write(
  `\n→ Phase 4: ${PRERELEASE ? "inserting prerelease snapshot heading" : `renaming ${UNRELEASED_HEADING} → ## [${VERSION}]`} in ${CHANGELOG_PATH}…\n`,
);

// Re-read to be safe (npm version doesn't touch CHANGELOG, but read-after-write
// is the safer pattern if any future phase grows).
changelog = await readFile(CHANGELOG_PATH, "utf8");
const linesV2 = changelog.split("\n");
const unreleasedIdxV2 = linesV2.findIndex((l) => l === UNRELEASED_HEADING);
if (unreleasedIdxV2 === -1) {
  fail(`${UNRELEASED_HEADING} disappeared between phases — aborting.`);
}

const today = new Date().toISOString().slice(0, 10);
const renamedHeading = `## [${VERSION}] ${EM_DASH} ${today}`;

if (PRERELEASE) {
  // Snapshot the current Unreleased body, then insert a new dated heading
  // ABOVE Unreleased with that snapshot as its body. Unreleased itself is
  // untouched.
  const nextHeadingIdxV2 = linesV2.findIndex((l, i) => i > unreleasedIdxV2 && l.startsWith("## ["));
  const unreleasedEndV2 = nextHeadingIdxV2 === -1 ? linesV2.length : nextHeadingIdxV2;
  // Snapshot the body between the Unreleased heading and the next heading,
  // EXCLUDING any blank line trailing into the next section.
  const snapshotBody = linesV2
    .slice(unreleasedIdxV2 + 1, unreleasedEndV2)
    .join("\n")
    .replace(/\n+$/, ""); // trim trailing blank lines

  // The Unreleased block stays intact. Insert the snapshot section ABOVE it.
  linesV2.splice(unreleasedIdxV2, 0, renamedHeading, "", snapshotBody, "");
  await writeFile(CHANGELOG_PATH, linesV2.join("\n"));
  stderr.write(`  wrote ${CHANGELOG_PATH} — inserted prerelease snapshot: ${renamedHeading}\n`);
  stderr.write(`  ${UNRELEASED_HEADING} kept intact for the next prerelease or the stable cut\n`);
} else {
  // Stable release: rename Unreleased → X.Y.Z and reset Unreleased.
  // Splice: replace the Unreleased line with a fresh Unreleased block + the
  // renamed heading. Result:
  //   ## [Unreleased]
  //
  //   _Nothing yet._
  //
  //   ## [X.Y.Z] — YYYY-MM-DD
  //   (existing entries that were under Unreleased follow…)
  linesV2.splice(unreleasedIdxV2, 1, UNRELEASED_HEADING, "", NOTHING_YET, "", renamedHeading);
  await writeFile(CHANGELOG_PATH, linesV2.join("\n"));
  stderr.write(`  wrote ${CHANGELOG_PATH} — new heading: ${renamedHeading}\n`);
}

// ─── Phase 5 — Commit + tag + atomic push ────────────────────────────────────

stderr.write(`\n→ Phase 5: commit, tag v${VERSION}, push --follow-tags…\n`);

try {
  run(
    `git add package.json package-lock.json CHANGELOG.md ${PLUGIN_PKG_PATH} ${PLUGIN_MANIFEST_PATH} ${README_PATH}`,
  );
  run(`git commit -m "release: v${VERSION}"`);
  run(`git tag -a v${VERSION} -m "v${VERSION}"`);
} catch {
  fail(
    `commit or tag step failed for v${VERSION}.\n` +
      "inspect: git status / git tag -l. revert with `git reset --hard HEAD~1 && git tag -d v" +
      VERSION +
      "` if needed.",
  );
}

try {
  run("git push --follow-tags origin main");
} catch {
  fail(
    `git push --follow-tags failed for v${VERSION}.\n` +
      "the commit and tag exist locally but are NOT pushed. resolve the push failure\n" +
      "(network, branch protection, auth) and re-run `git push --follow-tags origin main`.\n" +
      "do NOT delete the tag — re-pushing is idempotent.",
  );
}

// ─── Phase 6 — Confirmation ──────────────────────────────────────────────────

const publishNote = PRERELEASE
  ? `    2. npm publish --access public --provenance --tag next  (dist-tag "next", NOT "latest").\n` +
    `       Users will get this prerelease only via:\n` +
    `         npm install -g @owrede/vault-memory@${VERSION}\n` +
    `         npm install -g @owrede/vault-memory@next\n` +
    `       \`npm install -g @owrede/vault-memory\` (no tag) still resolves to the\n` +
    `       current \`latest\` dist-tag, which this prerelease does NOT touch.\n`
  : `    2. npm publish --access public --provenance  (default dist-tag "latest").\n`;

stderr.write(
  `\n✓ Tag v${VERSION} pushed${PRERELEASE ? " (prerelease)" : ""}.\n\n` +
    "Next steps (automatic):\n" +
    "  .github/workflows/publish.yml will now run on the v" +
    VERSION +
    " tag:\n" +
    "    1. npm ci + lint + test + build on a clean Linux runner.\n" +
    publishNote +
    "    3. Build the plugin tarball + manifest.sha256.\n" +
    "    4. Create the GitHub Release with tarball + checksum attached.\n" +
    (PRERELEASE
      ? "       (GitHub treats the v" +
        VERSION +
        " release as a Pre-release\n" +
        "       automatically because the tag carries a -prerelease suffix.)\n"
      : "") +
    "\nNext steps (manual):\n" +
    "  After the workflow completes, upload the MP4 screencast asset to the\n" +
    "  GitHub Release page via the GitHub UI (per D-13 / D-14 — the MP4 is\n" +
    "  intentionally NOT committed to the repo).\n\n" +
    "Monitor: https://github.com/owrede/vault-memory/actions\n",
);

stdout.write(`v${VERSION}\n`);
