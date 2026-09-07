/**
 * Chokidar watcher options for the obsidian-fs adapters.
 *
 * Shared by:
 *   - `VaultWatcher` (v1 live-indexing path; see ./watcher.ts)
 *   - `ObsidianFsChangeFeed` (v2 ChangeFeed seam; see ./index.ts)
 *
 * The four critical fields originated BYTE-FOR-BYTE from v1
 * (`src/watcher/watcher.ts:79-96` pre-plan-01-05) per RESEARCH Pitfall 6.
 * Modifying these values may break the suppression-set integration (the
 * watcher could race the atomic-rename suppression window) — DO NOT
 * change without first re-running the suppression conformance test in
 * `src/adapters/change-feed/conformance.test.ts`.
 *
 *   - awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 50 }
 *   - ignored:          [/(^|[\\/])\../, "**\/*.tmp.*"]   (+ caller excludes)
 *   - followSymlinks:   false
 *   - ignoreInitial:    true   (initial state arrives via indexVault catch-up)
 *
 * Note (quick-task 260515-hkc): stabilityThreshold was bumped 200→400ms
 * to give a 300–400ms safety margin over the 700–800ms test sleeps in
 * change-feed.test.ts:91 and watcher.test.ts:95, which intermittently
 * raced under full-suite load. It remains safely below the two
 * 400ms-sleep test cases (closed-feed + drain()) which pass for
 * unrelated reasons. The suppression integration test (Pitfall 6) was
 * re-run and remains green — extending the stability window only
 * widens the favorable race for own-write suppression.
 */

import { relative, sep } from "node:path";
import { compileGlob } from "../../source/obsidian-fs/scanner.js";
import type { ChokidarOptions } from "chokidar";

/**
 * Build chokidar options for a vault root.
 *
 * Apply caller excludes to vault-relative paths, skip hidden/temporary
 * files, and avoid opening watchers for files outside the markdown corpus.
 */
export function buildChokidarOptions(
  vaultPath: string,
  excludes: ReadonlyArray<string>,
): ChokidarOptions {
  // Chokidar 4 treats strings as literal paths, not globs. Match the same
  // vault-relative patterns as the scanner, before allocating file watchers.
  const matchers = excludes.map(compileGlob);
  return {
    persistent: true,
    ignoreInitial: true,
    ignored: (candidate, stats) => {
      const rel = relative(vaultPath, candidate).split(sep).join("/");
      if (rel.length === 0) return false;
      if (/(^|\/)\../.test(rel) || /(^|\/)[^/]*\.tmp\.[^/]*$/.test(rel)) return true;
      if (matchers.some((matcher) => matcher.test(rel))) return true;
      // Keep directories so new notes remain discoverable. Filtering only
      // after events still holds a descriptor for every image/attachment,
      // which can make macOS posix_spawn fail with EBADF above fd 10239.
      return stats?.isFile() === true && !candidate.toLowerCase().endsWith(".md");
    },
    awaitWriteFinish: {
      stabilityThreshold: 400,
      pollInterval: 50,
    },
    followSymlinks: false,
  };
}
