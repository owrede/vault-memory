import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**", "plugin/**"],
    // chokidar-based filesystem-watcher tests are timing-sensitive: when many
    // real FSWatchers run concurrently with the rest of the suite, OS event
    // delivery is starved and positive-assertion tests miss their window
    // (documented flake, STATE.md). Pin these three files to a single forked
    // worker so they neither contend with each other nor with the parallel
    // pool. The rest of the suite keeps full parallelism. Combined with the
    // poll-until-condition helpers in those files, this removes the flake
    // without serializing the whole suite.
    poolMatchGlobs: [
      ["**/adapters/change-feed/obsidian-fs/change-feed.test.ts", "forks"],
      ["**/adapters/change-feed/obsidian-fs/watcher.test.ts", "forks"],
      ["**/adapters/change-feed/conformance.test.ts", "forks"],
    ],
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
