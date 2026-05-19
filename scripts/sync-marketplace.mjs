/**
 * scripts/sync-marketplace.mjs
 *
 * Syncs canonical plugins from this repo to the inim-store marketplace
 * (https://github.com/owrede/inim-store). Reads
 * `scripts/marketplace-sync.json` for the list of plugins to publish.
 *
 * Each plugin in this repo is a self-contained directory under `plugins/`
 * with its own `.claude-plugin/plugin.json` AND a `skills/` subtree that
 * holds one or more skills:
 *
 *   plugins/<name>/
 *     .claude-plugin/plugin.json   ← source-of-truth for name/desc/version
 *     skills/<verb-a>/SKILL.md     ← e.g. install, health, reindex
 *     skills/<verb-a>/*.sh         ← skill assets
 *     skills/<verb-b>/SKILL.md
 *     ...
 *
 * The sync:
 *   1. Copies the whole plugin directory verbatim to
 *      `inim-store/plugins/<name>/`
 *   2. Optionally bumps the version in the source-of-truth `plugin.json`
 *      (this repo) AND mirrors the bump into the marketplace's
 *      `.claude-plugin/marketplace.json` entry
 *   3. Commits to inim-store. `--push` also pushes.
 *
 * Description, keywords, license, homepage all live in each plugin's own
 * `plugin.json` — that is the single source of truth. The manifest at
 * `scripts/marketplace-sync.json` only carries the marketplace category +
 * source path; everything else is read from the plugin directory itself.
 *
 * Usage:
 *   node scripts/sync-marketplace.mjs                 # sync everything, no bump, commit
 *   node scripts/sync-marketplace.mjs --bump patch    # bump patch on every changed plugin
 *   node scripts/sync-marketplace.mjs --bump 0.1.0    # set explicit version (single-plugin runs)
 *   node scripts/sync-marketplace.mjs --plugin vmem --bump 0.1.0   # bump just one
 *   node scripts/sync-marketplace.mjs --push          # also push inim-store/main
 *   node scripts/sync-marketplace.mjs --dry-run       # show plan, no writes
 *
 * Exit codes:
 *   0  success (or no changes)
 *   1  recoverable failure (e.g. invalid arg, marketplace path missing)
 *   2  invariant violation (JSON parse, version disagreement, path mismatch)
 */

import { readFile, writeFile, copyFile, mkdir, stat, chmod, rm, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit, stderr, stdout } from "node:process";

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
  const args = { bump: null, push: false, dryRun: false, plugin: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--push") args.push = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--bump") {
      args.bump = argv[++i];
      if (!args.bump) fail("--bump requires a value (patch|minor|major|X.Y.Z)");
    } else if (a === "--plugin") {
      args.plugin = argv[++i];
      if (!args.plugin) fail("--plugin requires a name");
    } else if (a === "--help" || a === "-h") {
      stdout.write(`Usage: node scripts/sync-marketplace.mjs [--bump patch|minor|major|X.Y.Z] [--plugin <name>] [--push] [--dry-run]\n`);
      exit(0);
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  return args;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bumpSemver(current, bumpArg) {
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
  await writeFile(path, JSON.stringify(obj, null, 2) + "\n");
}

function captureGit(cmd, opts = {}) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts }).trim();
}

function runGit(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

async function copyRecursive(src, dst) {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, dstPath);
      if (entry.name.endsWith(".sh")) {
        await chmod(dstPath, 0o755);
      }
    }
  }
}

async function dirContentsEqual(a, b) {
  try {
    execSync(`diff -r "${a}" "${b}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Wipe-and-recopy semantics: when copying a plugin directory, we want the
// destination to match the source byte-for-byte. If the source REMOVED a
// file (e.g. dropped a skill), straight copy leaves stale files behind.
// Wipe the dst first, then copy.
async function wipeAndCopy(src, dst) {
  if (await exists(dst)) {
    await rm(dst, { recursive: true, force: true });
  }
  await copyRecursive(src, dst);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = parseArgs(argv);
section(`marketplace sync — ${args.dryRun ? "DRY RUN" : args.push ? "commit + push" : "commit only"}`);

if (!await exists(MANIFEST_PATH)) {
  fail(`manifest not found: ${MANIFEST_PATH}`);
}
const manifest = await readJson(MANIFEST_PATH);

if (!manifest.plugins || !Array.isArray(manifest.plugins)) {
  fail(`manifest at ${MANIFEST_PATH} must declare a "plugins" array`, 2);
}

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

// Filter to a single plugin if --plugin was passed.
const targetPlugins = args.plugin
  ? manifest.plugins.filter((p) => p.plugin_name === args.plugin)
  : manifest.plugins;
if (args.plugin && targetPlugins.length === 0) {
  fail(`no plugin named "${args.plugin}" in manifest`, 2);
}

const changes = [];

for (const plugin of targetPlugins) {
  section(`plugin: ${plugin.plugin_name}`);

  const pluginSrc = resolve(REPO_ROOT, plugin.source);
  if (!await exists(pluginSrc)) {
    fail(`plugin source missing: ${pluginSrc}`, 2);
  }

  const srcPluginJsonPath = join(pluginSrc, ".claude-plugin", "plugin.json");
  if (!await exists(srcPluginJsonPath)) {
    fail(`source plugin.json missing: ${srcPluginJsonPath}`, 2);
  }
  const srcPluginJson = await readJson(srcPluginJsonPath);

  if (srcPluginJson.name !== plugin.plugin_name) {
    fail(`plugin.json name "${srcPluginJson.name}" does not match manifest plugin_name "${plugin.plugin_name}"`, 2);
  }
  if (!srcPluginJson.version || !SEMVER_RE.test(srcPluginJson.version)) {
    fail(`plugin.json version "${srcPluginJson.version}" invalid (expected X.Y.Z)`, 2);
  }
  if (!srcPluginJson.description || srcPluginJson.description.length < 10) {
    fail(`plugin.json description too short or missing`, 2);
  }

  const pluginDst = join(marketplaceRoot, manifest.marketplace.plugins_dir, plugin.plugin_name);
  const dstPluginJsonPath = join(pluginDst, ".claude-plugin", "plugin.json");

  let existingPluginJson = null;
  let isNew = false;
  if (await exists(dstPluginJsonPath)) {
    existingPluginJson = await readJson(dstPluginJsonPath);
  } else {
    isNew = true;
    info(`new plugin (no existing plugin.json in marketplace)`);
  }

  const mktEntryIdx = marketplaceJson.plugins.findIndex((p) => p.name === plugin.plugin_name);
  const existingMktEntry = mktEntryIdx >= 0 ? marketplaceJson.plugins[mktEntryIdx] : null;

  // Compute the new version. Priority:
  //   1. --bump (explicit or patch/minor/major)
  //   2. The version in the source-of-truth plugin.json
  let newVersion = srcPluginJson.version;
  if (args.bump) {
    // Bump uses the higher of (source-of-truth, currently-deployed).
    let base = srcPluginJson.version;
    if (existingPluginJson?.version) {
      // pick whichever is the higher semver
      base = semverHigher(existingPluginJson.version, srcPluginJson.version);
    }
    newVersion = bumpSemver(base, args.bump);
  }

  // Has the content changed?
  let contentChanged = true;
  if (await exists(pluginDst)) {
    // Compare just the source tree against the dst tree, BUT account for
    // the fact that the version field will differ if we bumped. Quick check:
    // diff -r the source against destination; if the only file that differs
    // is plugin.json, treat content as unchanged (only version moved).
    contentChanged = !await dirContentsEqual(pluginSrc, pluginDst);
  }
  const versionChanged = (existingPluginJson?.version || existingMktEntry?.version) !== newVersion;

  if (!contentChanged && !versionChanged && !isNew) {
    info(`unchanged (v${srcPluginJson.version}) — skipping`);
    continue;
  }

  log(`  source:      ${relative(REPO_ROOT, pluginSrc)}`);
  log(`  plugin dir:  ${relative(marketplaceRoot, pluginDst)}`);
  log(`  version:     ${existingPluginJson?.version || existingMktEntry?.version || "(new)"} → ${newVersion}`);
  log(`  content:     ${contentChanged ? "changed" : "unchanged"}`);

  changes.push({
    plugin,
    pluginSrc,
    pluginDst,
    srcPluginJsonPath,
    dstPluginJsonPath,
    srcPluginJson,
    existingPluginJson,
    mktEntryIdx,
    newVersion,
    isNew,
    contentChanged,
    versionChanged,
  });
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
  // 1. If we bumped, write the new version back into the source-of-truth
  //    plugin.json in THIS repo first so the source and dst stay aligned.
  if (ch.srcPluginJson.version !== ch.newVersion) {
    const updated = { ...ch.srcPluginJson, version: ch.newVersion };
    await writeJson(ch.srcPluginJsonPath, updated);
    ok(`bumped source: ${relative(REPO_ROOT, ch.srcPluginJsonPath)} → v${ch.newVersion}`);
    ch.srcPluginJson = updated;
  }

  // 2. Copy the entire plugin directory verbatim (wipe-and-copy).
  await wipeAndCopy(ch.pluginSrc, ch.pluginDst);
  ok(`copied: ${relative(REPO_ROOT, ch.pluginSrc)} → ${relative(marketplaceRoot, ch.pluginDst)}`);

  // 3. Update marketplace.json entry.
  const newEntry = {
    name: ch.plugin.plugin_name,
    description: ch.srcPluginJson.description,
    version: ch.newVersion,
    category: ch.plugin.category,
    source: {
      source: "git-subdir",
      url: `https://github.com/${manifest.marketplace.repo}.git`,
      path: `${manifest.marketplace.plugins_dir}/${ch.plugin.plugin_name}`,
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
  const pj = await readJson(ch.dstPluginJsonPath);
  const mktEntry = marketplaceJson.plugins.find((p) => p.name === ch.plugin.plugin_name);
  if (!mktEntry) fail(`marketplace entry missing for ${ch.plugin.plugin_name}`, 2);
  if (pj.version !== mktEntry.version) {
    fail(`version mismatch for ${ch.plugin.plugin_name}: plugin.json=${pj.version} marketplace=${mktEntry.version}`, 2);
  }
  if (pj.name !== ch.plugin.plugin_name) {
    fail(`plugin.json name mismatch for ${ch.plugin.plugin_name}: got ${pj.name}`, 2);
  }
  const sourcePath = join(marketplaceRoot, mktEntry.source.path);
  if (!await exists(sourcePath)) {
    fail(`source.path does not resolve: ${sourcePath}`, 2);
  }
  // Verify every skill in the plugin's skills/ subtree has a SKILL.md
  // whose frontmatter `name:` matches the folder slug — Claude Code
  // resolves /plugin:skill against the folder name, so a mismatch
  // produces unreachable skills.
  const skillsRoot = join(ch.pluginDst, "skills");
  if (await exists(skillsRoot)) {
    const skillDirs = await readdir(skillsRoot, { withFileTypes: true });
    for (const sd of skillDirs) {
      if (!sd.isDirectory()) continue;
      const skillMdPath = join(skillsRoot, sd.name, "SKILL.md");
      if (!await exists(skillMdPath)) {
        fail(`skill folder ${sd.name} has no SKILL.md`, 2);
      }
      const md = await readFile(skillMdPath, "utf8");
      const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) fail(`no frontmatter in ${skillMdPath}`, 2);
      const nameMatch = fmMatch[1].match(/^name:\s*(.+?)\s*$/m);
      if (!nameMatch) fail(`no name field in ${skillMdPath} frontmatter`, 2);
      if (nameMatch[1] !== sd.name) {
        fail(`skill folder "${sd.name}" but SKILL.md frontmatter says name: "${nameMatch[1]}" — must match for /plugin:${sd.name} to resolve`, 2);
      }
    }
  }
  ok(`${ch.plugin.plugin_name}: name + version + path + skill-name invariants OK`);
}

// 5. Commit
section("committing to inim-store");

const changedFiles = [];
for (const ch of changes) {
  changedFiles.push(relative(marketplaceRoot, ch.pluginDst));
}
changedFiles.push(relative(marketplaceRoot, marketplaceJsonPath));

const commitTitle = changes.length === 1
  ? `chore(${changes[0].plugin.plugin_name}): sync to v${changes[0].newVersion}`
  : `chore: sync ${changes.length} plugin(s)`;

const commitBody = changes.map((ch) =>
  `- ${ch.plugin.plugin_name}: ${ch.existingPluginJson?.version || "(new)"} → ${ch.newVersion}` +
  (ch.contentChanged ? " (content updated)" : "") +
  (ch.isNew ? " (initial publish)" : "")
).join("\n") + "\n\nSynced from vault-memory repo via scripts/sync-marketplace.mjs.";

const commitMsg = `${commitTitle}\n\n${commitBody}`;

runGit(`git add ${changedFiles.map((f) => `"${f}"`).join(" ")}`, { cwd: marketplaceRoot });
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

// ─── Small helpers ────────────────────────────────────────────────────────────

function semverHigher(a, b) {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return a;
    if (pa[i] < pb[i]) return b;
  }
  return a;
}
