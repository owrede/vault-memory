/**
 * scripts/sync-marketplace.mjs
 *
 * Syncs the canonical skills in this repo to the inim-store marketplace
 * (https://github.com/owrede/inim-store). Reads scripts/marketplace-sync.json
 * for the list of skills to publish, copies them into the marketplace's
 * `plugins/<name>/skills/<name>/` tree, bumps versions in both
 * `plugins/<name>/.claude-plugin/plugin.json` and the marketplace's
 * `.claude-plugin/marketplace.json`, validates structural invariants, and
 * commits.
 *
 * By design this script does NOT push by default. The user supplies
 * `--push` to also push the inim-store branch to origin.
 *
 * Usage:
 *   node scripts/sync-marketplace.mjs                 # sync, no version bump, commit
 *   node scripts/sync-marketplace.mjs --bump patch    # sync, bump patch (0.1.0 → 0.1.1), commit
 *   node scripts/sync-marketplace.mjs --bump minor    # sync, bump minor (0.1.0 → 0.2.0), commit
 *   node scripts/sync-marketplace.mjs --bump major    # sync, bump major (0.1.0 → 1.0.0), commit
 *   node scripts/sync-marketplace.mjs --bump 0.5.0    # sync, set explicit version 0.5.0, commit
 *   node scripts/sync-marketplace.mjs --bump patch --push   # sync + commit + push to origin
 *   node scripts/sync-marketplace.mjs --dry-run       # show what WOULD change, no writes
 *
 * Exit codes:
 *   0  success (or no changes)
 *   1  recoverable failure (e.g. invalid arg, marketplace path missing)
 *   2  invariant violation (JSON parse, version disagreement, path mismatch)
 */

import { readFile, writeFile, copyFile, mkdir, stat, chmod } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit, stderr, stdout, env } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = join(__dirname, "marketplace-sync.json");

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

const log = (msg) => stderr.write(`${msg}\n`);
const info = (msg) => log(`${c.dim}${msg}${c.reset}`);
const ok = (msg) => log(`${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => log(`${c.yellow}⚠${c.reset} ${msg}`);
const fail = (msg, code = 1) => { log(`${c.red}✗${c.reset} ${msg}`); exit(code); };
const section = (msg) => log(`\n${c.bold}${msg}${c.reset}`);

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { bump: null, push: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--push") args.push = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--bump") {
      args.bump = argv[++i];
      if (!args.bump) fail("--bump requires a value (patch|minor|major|X.Y.Z)");
    } else if (a === "--help" || a === "-h") {
      stdout.write(`Usage: node scripts/sync-marketplace.mjs [--bump patch|minor|major|X.Y.Z] [--push] [--dry-run]\n`);
      exit(0);
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  return args;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bumpSemver(current, bumpArg) {
  // Strip pre-release suffix for the math; user can pass explicit X.Y.Z to set one.
  const [major, minor, patch] = current.split("-")[0].split(".").map(Number);
  switch (bumpArg) {
    case "patch": return `${major}.${minor}.${patch + 1}`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "major": return `${major + 1}.0.0`;
    default:
      if (SEMVER_RE.test(bumpArg)) return bumpArg;
      fail(`invalid --bump value: ${bumpArg} (expected patch|minor|major|X.Y.Z)`, 2);
  }
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  try { return JSON.parse(raw); }
  catch (e) { fail(`JSON parse error in ${path}: ${e.message}`, 2); }
}

async function writeJson(path, obj) {
  // Match the existing files' 2-space indent, trailing newline.
  await writeFile(path, JSON.stringify(obj, null, 2) + "\n");
}

function captureGit(cmd, opts = {}) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts }).trim();
}

function runGit(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

async function copyRecursive(src, dst) {
  // Simple recursive copy for skill dirs. Preserves executable bit on .sh files.
  const { readdir } = await import("node:fs/promises");
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, dstPath);
      // Preserve executable bit on .sh files.
      if (entry.name.endsWith(".sh")) {
        await chmod(dstPath, 0o755);
      }
    }
  }
}

async function dirContentsEqual(a, b) {
  // Cheap check: compare list of relative file paths + content hashes.
  // execSync diff -r is the easiest cross-platform path.
  try {
    execSync(`diff -r "${a}" "${b}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = parseArgs(argv);
section(`marketplace sync — ${args.dryRun ? "DRY RUN" : args.push ? "commit + push" : "commit only"}`);

if (!await exists(MANIFEST_PATH)) {
  fail(`manifest not found: ${MANIFEST_PATH}`);
}
const manifest = await readJson(MANIFEST_PATH);

// Resolve marketplace path relative to this repo's root.
const marketplaceRoot = resolve(REPO_ROOT, manifest.marketplace.local_path);
if (!await exists(marketplaceRoot)) {
  fail(`marketplace local_path does not exist: ${marketplaceRoot}\n` +
       `  clone it first: gh repo clone ${manifest.marketplace.repo} ${marketplaceRoot}`);
}
info(`marketplace: ${marketplaceRoot}`);

const marketplaceJsonPath = join(marketplaceRoot, manifest.marketplace.marketplace_json_path);
if (!await exists(marketplaceJsonPath)) {
  fail(`marketplace.json not found at ${marketplaceJsonPath}`, 2);
}
const marketplaceJson = await readJson(marketplaceJsonPath);

// Pre-check: marketplace working tree must be clean (unless --dry-run).
if (!args.dryRun) {
  const dirty = captureGit("git status --porcelain", { cwd: marketplaceRoot });
  if (dirty) {
    fail(`marketplace working tree is dirty — commit or stash first:\n${dirty}`);
  }
  const branch = captureGit("git branch --show-current", { cwd: marketplaceRoot });
  if (branch !== "main") {
    fail(`marketplace is not on main branch (currently: ${branch || "<detached HEAD>"}).`);
  }
}

// Walk each skill in the manifest, plan what changes.
const changes = [];

for (const skill of manifest.skills) {
  section(`skill: ${skill.plugin_name}`);

  const skillSrc = resolve(REPO_ROOT, skill.source);
  if (!await exists(skillSrc)) {
    fail(`skill source missing: ${skillSrc}`, 2);
  }

  const pluginRoot = join(marketplaceRoot, manifest.marketplace.plugins_dir, skill.plugin_name);
  const skillDst = join(pluginRoot, "skills", skill.plugin_name);
  const pluginJsonPath = join(pluginRoot, ".claude-plugin", "plugin.json");

  // Existing plugin.json (or "this is a new plugin")
  let existingPluginJson = null;
  let isNew = false;
  if (await exists(pluginJsonPath)) {
    existingPluginJson = await readJson(pluginJsonPath);
  } else {
    isNew = true;
    info(`new plugin (no existing plugin.json)`);
  }

  // Existing marketplace entry
  const mktEntryIdx = marketplaceJson.plugins.findIndex(p => p.name === skill.plugin_name);
  const existingMktEntry = mktEntryIdx >= 0 ? marketplaceJson.plugins[mktEntryIdx] : null;

  // Decide the new version
  let currentVersion = "0.0.0";
  if (existingPluginJson?.version) currentVersion = existingPluginJson.version;
  else if (existingMktEntry?.version) currentVersion = existingMktEntry.version;

  let newVersion = currentVersion;
  if (args.bump) {
    newVersion = bumpSemver(currentVersion, args.bump);
  } else if (isNew) {
    newVersion = "0.1.0";
  }

  // Description: pull from the skill's SKILL.md frontmatter so the marketplace
  // and plugin.json stay in sync with the canonical source.
  const skillMdPath = join(skillSrc, "SKILL.md");
  if (!await exists(skillMdPath)) {
    fail(`SKILL.md missing in ${skillSrc} — every published skill must have one.`, 2);
  }
  const skillMd = await readFile(skillMdPath, "utf8");
  // Extract description from frontmatter (first YAML block).
  const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) fail(`no frontmatter in ${skillMdPath}`, 2);
  const descMatch = fmMatch[1].match(/^description:\s*(.+?)\s*$/m);
  if (!descMatch) fail(`no description field in ${skillMdPath} frontmatter`, 2);
  const description = descMatch[1];

  // Is the skill content already identical?
  let contentChanged = true;
  if (await exists(skillDst)) {
    contentChanged = !await dirContentsEqual(skillSrc, skillDst);
  }
  const versionChanged = currentVersion !== newVersion;

  if (!contentChanged && !versionChanged && !isNew) {
    info(`unchanged (v${currentVersion}) — skipping`);
    continue;
  }

  log(`  source:      ${relative(REPO_ROOT, skillSrc)}`);
  log(`  plugin dir:  ${relative(marketplaceRoot, pluginRoot)}`);
  log(`  version:     ${currentVersion} ${versionChanged ? "→ " + newVersion : "(unchanged)"}`);
  log(`  content:     ${contentChanged ? "changed" : "unchanged"}`);

  changes.push({ skill, skillSrc, pluginRoot, skillDst, pluginJsonPath, mktEntryIdx, existingMktEntry, existingPluginJson, newVersion, description, isNew, contentChanged, versionChanged });
}

if (changes.length === 0) {
  ok("nothing to do — marketplace is in sync");
  exit(0);
}

if (args.dryRun) {
  log("\n--- dry-run — no writes ---");
  exit(0);
}

// Apply changes
section("applying changes");
for (const ch of changes) {
  // 1. Copy skill files
  if (ch.contentChanged || ch.isNew) {
    await copyRecursive(ch.skillSrc, ch.skillDst);
    ok(`copied: ${relative(REPO_ROOT, ch.skillSrc)} → ${relative(marketplaceRoot, ch.skillDst)}`);
  }

  // 2. Write/update plugin.json
  const pluginJson = ch.existingPluginJson ?? {
    "$schema": "https://anthropic.com/claude-code/plugin.schema.json",
    name: ch.skill.plugin_name,
    description: ch.description,
    author: marketplaceJson.owner,
    homepage: ch.skill.homepage,
    license: ch.skill.license,
    keywords: ch.skill.keywords,
  };
  pluginJson.version = ch.newVersion;
  pluginJson.description = ch.description; // keep in sync with SKILL.md
  if (ch.skill.homepage && !pluginJson.homepage) pluginJson.homepage = ch.skill.homepage;
  if (ch.skill.license && !pluginJson.license) pluginJson.license = ch.skill.license;
  if (ch.skill.keywords && !pluginJson.keywords) pluginJson.keywords = ch.skill.keywords;

  await mkdir(dirname(ch.pluginJsonPath), { recursive: true });
  await writeJson(ch.pluginJsonPath, pluginJson);
  ok(`wrote: ${relative(marketplaceRoot, ch.pluginJsonPath)} (v${ch.newVersion})`);

  // 3. Update marketplace.json entry
  const newEntry = {
    name: ch.skill.plugin_name,
    description: ch.description,
    version: ch.newVersion,
    category: ch.skill.category,
    source: {
      source: "git-subdir",
      url: `https://github.com/${manifest.marketplace.repo}.git`,
      path: `${manifest.marketplace.plugins_dir}/${ch.skill.plugin_name}`,
      ref: "main",
    },
  };
  if (ch.mktEntryIdx >= 0) {
    marketplaceJson.plugins[ch.mktEntryIdx] = newEntry;
  } else {
    marketplaceJson.plugins.push(newEntry);
  }
}

await writeJson(marketplaceJsonPath, marketplaceJson);
ok(`wrote: ${relative(marketplaceRoot, marketplaceJsonPath)}`);

// 4. Structural invariants
section("validating invariants");
for (const ch of changes) {
  const pj = await readJson(ch.pluginJsonPath);
  const mktEntry = marketplaceJson.plugins.find(p => p.name === ch.skill.plugin_name);
  if (!mktEntry) fail(`marketplace entry missing for ${ch.skill.plugin_name}`, 2);
  if (pj.version !== mktEntry.version) {
    fail(`version mismatch for ${ch.skill.plugin_name}: plugin.json=${pj.version} marketplace=${mktEntry.version}`, 2);
  }
  if (pj.name !== ch.skill.plugin_name) {
    fail(`plugin.json name mismatch for ${ch.skill.plugin_name}: got ${pj.name}`, 2);
  }
  const sourcePath = join(marketplaceRoot, mktEntry.source.path);
  if (!await exists(sourcePath)) {
    fail(`source.path does not resolve: ${sourcePath}`, 2);
  }
  ok(`${ch.skill.plugin_name}: name + version + path invariants OK`);
}

// 5. Commit
section("committing to inim-store");

const changedFiles = [];
for (const ch of changes) {
  changedFiles.push(relative(marketplaceRoot, ch.pluginRoot));
}
changedFiles.push(relative(marketplaceRoot, marketplaceJsonPath));

const commitTitle = changes.length === 1
  ? `chore(${changes[0].skill.plugin_name}): sync to v${changes[0].newVersion}`
  : `chore: sync ${changes.length} plugin(s)`;

const commitBody = changes.map(ch =>
  `- ${ch.skill.plugin_name}: ${ch.existingPluginJson?.version || "(new)"} → ${ch.newVersion}` +
  (ch.contentChanged ? " (content updated)" : "") +
  (ch.isNew ? " (initial publish)" : "")
).join("\n") + "\n\nSynced from vault-memory repo via scripts/sync-marketplace.mjs.";

const commitMsg = `${commitTitle}\n\n${commitBody}`;

runGit(`git add ${changedFiles.map(f => `"${f}"`).join(" ")}`, { cwd: marketplaceRoot });
// Quote the commit message via heredoc-equivalent (Node spawns through a shell, so just use stdin).
execSync(`git commit -F -`, { input: commitMsg, stdio: ["pipe", "inherit", "inherit"], cwd: marketplaceRoot });
ok(`committed: ${commitTitle}`);

if (args.push) {
  section("pushing inim-store to origin");
  runGit(`git push origin main`, { cwd: marketplaceRoot });
  ok("pushed");
} else {
  info("\nDone. To publish, run:");
  log(`  git -C "${marketplaceRoot}" push origin main`);
  log(`Or re-run this script with --push.`);
}
