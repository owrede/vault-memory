import { describe, it } from "vitest";

/**
 * Phase 5 / D-08 — `~/.vault-memory/locks/<vault>.lock` scaffolding.
 *
 * Wave 0 stub. Behavior tests for lock acquisition, stale-PID
 * detection (kill(0, pid)), and second-server WARN logging land in
 * Plan 05-03.
 *
 * NOTE: `src/brief/lock.ts` is the ONE module in `src/brief/` that
 * uses `node:fs/promises` directly — process state, not vault content.
 * The file carries the `// vault-memory:claude-ok` escape marker so
 * `scripts/lint-adapters.sh` accepts the fs imports. See ADR-005
 * §"Decision: Lockfile carve-out".
 */
describe("brief lockfile (D-08)", () => {
  it.skip("[scaffold] tests land in slice 3 (Plan 05-03)", () => {});
});
