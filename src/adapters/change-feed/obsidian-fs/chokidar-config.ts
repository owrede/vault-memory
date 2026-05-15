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

import { posix } from "node:path";
import type { ChokidarOptions } from "chokidar";

/**
 * Build chokidar options for a vault root.
 *
 * The caller-provided `excludes` are joined with `vaultPath` (absolute
 * glob patterns) and pre-pended to the v1 baseline filters (`hidden
 * files at any level` regex + `**\/*.tmp.*` atomic-write artifacts).
 */
export function buildChokidarOptions(
  vaultPath: string,
  excludes: ReadonlyArray<string>,
): ChokidarOptions {
  return {
    persistent: true,
    ignoreInitial: true, // we expect initial state via indexVault
    ignored: [
      // chokidar handles glob-like patterns. Provide both raw and absolute.
      ...excludes.map((g) => posix.join(vaultPath, g)),
      /(^|[\\/])\../, // hidden files at any level
      "**/*.tmp.*", // our atomic-write artifacts
    ],
    // Only watch markdown files — saves event volume.
    // chokidar's `ignored` runs against absolute paths, so we filter via
    // an after-the-fact event check (cheaper than a glob).
    awaitWriteFinish: {
      stabilityThreshold: 400,
      pollInterval: 50,
    },
    followSymlinks: false,
  };
}
