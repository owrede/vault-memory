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
 *   3. Version bump — `npm version X.Y.Z --no-git-tag-version`.
 *   4. CHANGELOG    — rename `## [Unreleased]` → `## [X.Y.Z] — YYYY-MM-DD`.
 *   5. Commit + tag + atomic push (`git push --follow-tags`).
 *   6. Confirmation — print what happens next + manual MP4 reminder.
 *
 * Usage:
 *   node scripts/release.mjs 2.0.0
 *   npm run release -- 2.0.0
 */

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { argv, exit, stderr, stdout } from "node:process";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHANGELOG_PATH = "CHANGELOG.md";
const UNRELEASED_HEADING = "## [Unreleased]";
const NOTHING_YET = "_Nothing yet._";
const EM_DASH = "—"; // U+2014 — must match existing CHANGELOG entries

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
  fail(
    "working tree is dirty — commit or stash first.\n" +
      "uncommitted changes:\n" +
      dirty,
  );
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
const nextHeadingIdx = lines.findIndex(
  (l, i) => i > unreleasedIdx && l.startsWith("## ["),
);
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

// ─── Phase 4 — CHANGELOG rename ──────────────────────────────────────────────

stderr.write(`\n→ Phase 4: renaming ${UNRELEASED_HEADING} → ## [${VERSION}] in ${CHANGELOG_PATH}…\n`);

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

// Splice: replace the Unreleased line with a fresh Unreleased block + the
// renamed heading. Result:
//   ## [Unreleased]
//
//   _Nothing yet._
//
//   ## [X.Y.Z] — YYYY-MM-DD
//   (existing entries that were under Unreleased follow…)
linesV2.splice(
  unreleasedIdxV2,
  1,
  UNRELEASED_HEADING,
  "",
  NOTHING_YET,
  "",
  renamedHeading,
);

await writeFile(CHANGELOG_PATH, linesV2.join("\n"));
stderr.write(`  wrote ${CHANGELOG_PATH} — new heading: ${renamedHeading}\n`);

// ─── Phase 5 — Commit + tag + atomic push ────────────────────────────────────

stderr.write(`\n→ Phase 5: commit, tag v${VERSION}, push --follow-tags…\n`);

try {
  run("git add package.json package-lock.json CHANGELOG.md");
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

stderr.write(
  `\n✓ Tag v${VERSION} pushed.\n\n` +
    "Next steps (automatic):\n" +
    "  .github/workflows/publish.yml will now run on the v" +
    VERSION +
    " tag:\n" +
    "    1. npm ci + lint + test + build on a clean Linux runner.\n" +
    "    2. npm publish --access public --provenance.\n" +
    "    3. Build the plugin tarball + manifest.sha256.\n" +
    "    4. Create the GitHub Release with tarball + checksum attached.\n\n" +
    "Next steps (manual):\n" +
    "  After the workflow completes, upload the MP4 screencast asset to the\n" +
    "  GitHub Release page via the GitHub UI (per D-13 / D-14 — the MP4 is\n" +
    "  intentionally NOT committed to the repo).\n\n" +
    "Monitor: https://github.com/owrede/vault-memory/actions\n",
);

stdout.write(`v${VERSION}\n`);
