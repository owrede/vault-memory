import { defineConfig } from "vitest/config";

const EXCLUDE = ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**", "plugin/**"];

// chokidar-based filesystem-watcher tests are timing-sensitive: when many
// real FSWatchers run concurrently with the rest of the suite, OS event
// delivery is starved and positive-assertion tests miss their window
// (documented flake, STATE.md). Pin these files to a single forked worker so
// they neither contend with each other nor with the parallel pool. The rest
// of the suite keeps full parallelism. Combined with the poll-until-condition
// helpers in those files, this removes the flake without serializing the
// whole suite.
//
// Vitest 4 removed `poolMatchGlobs` (and top-levelled `poolOptions`), so the
// per-file pool assignment is expressed as two projects instead.
const WATCHER_TESTS = [
  "**/adapters/change-feed/obsidian-fs/change-feed.test.ts",
  "**/adapters/change-feed/obsidian-fs/watcher.test.ts",
  "**/adapters/change-feed/obsidian-fs/chokidar-config.test.ts",
  "**/adapters/change-feed/conformance.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "watchers",
          include: WATCHER_TESTS,
          exclude: EXCLUDE,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: [...EXCLUDE, ...WATCHER_TESTS],
        },
      },
    ],
  },
});
