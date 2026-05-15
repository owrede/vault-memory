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
 *   - awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 50 }
 *   - ignored:          [/(^|[\\/])\../, "**\/*.tmp.*"]   (+ caller excludes)
 *   - followSymlinks:   false
 *   - ignoreInitial:    true   (initial state arrives via indexVault catch-up)
 *
 * Note (quick-task 260515-hkc): stabilityThreshold was bumped in two
 * notches — first 200→400ms, then 400→500ms — to eliminate the
 * intermittent full-suite flake in change-feed.test.ts:91/74 and
 * watcher.test.ts:95 where the chokidar event sometimes failed to
 * fire before the test's 700–800ms sleep elapsed. The 400ms threshold
 * still left only ~250ms margin, which collapsed under adversarial
 * GC/event-loop load on ~17% of consecutive full-suite runs. 500ms
 * gives 200–300ms margin and survived a 5/5 stability soak. The
 * drain() and closed-feed tests in watcher.test.ts:132 and
 * change-feed.test.ts:147 had their sleeps bumped in lock-step to
 * preserve a 100ms margin above the threshold. The Pitfall 6
 * suppression integration test was re-run at both notches and
 * remains green — extending the stability window only widens the
 * favorable race for own-write suppression.
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
      stabilityThreshold: 500,
      pollInterval: 50,
    },
    followSymlinks: false,
  };
}
