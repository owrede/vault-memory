# Deferred items — Phase 07

Items discovered during execution but outside the scope of the active plan.


## 07-04 execution: flaky change-feed rename test

**File:** `src/adapters/change-feed/obsidian-fs/change-feed.test.ts`
**Test:** `ObsidianFsChangeFeed > rename surfaces as delete + create (Phase 1 — emitsRename=false)`
**Observed:** Fails ~1 in N runs in full `npx vitest run`; passes in isolation.
**Diagnosis:** chokidar timing race when the full test suite saturates the FS event loop. Not introduced by 07-04 (plugin-tools touch only `src/plugin-tools/` and `src/server.ts` wiring after the bootstrap — no change-feed interaction).
**Disposition:** deferred. Track for a future hardening pass on the change-feed test harness (e.g. raise the awaitable timeout, drain explicitly).
