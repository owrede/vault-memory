# 03-02 Deviations

## D-1 (Rule 3 — blocking issue): Worktree was created from a stale ancestor of main

**Found during:** initial environment check, before Task 1.

**Issue:** The worktree at `.claude/worktrees/agent-aec993f2b49fee40e/`, on branch
`worktree-agent-aec993f2b49fee40e`, was created from commit `cbed220` (a v1.0.0-era
state that predates Phase 2 + Phase 3). The plan's required dependencies — `src/memory/`,
`src/sections/`, the Phase 2 citation packet, `SectionsQueries`, migration 010, and the
v1 `tool-registry.ts` two-export pattern — did not exist on the worktree branch. Building
on top of an empty `src/` would either duplicate 03-01 (forbidden — depends on it) or
collapse on the first import resolution.

**Fix:** Fast-forwarded the worktree branch onto `main` (FF-only — the worktree branch
was a strict ancestor of main, so the merge added 285 commits with zero conflicts and
no history rewrite). The worktree HEAD is now at `d1bbdaf docs(03-01): summary +
deviations note` and still attached to `worktree-agent-aec993f2b49fee40e` per the
pre-commit allow-list invariant. `npm ci` installed dependencies fresh in the worktree
(`node_modules` was absent).

**Why this is Rule 3, not Rule 4:** the user's constraint was "Stay on the worktree's
branch" — fast-forwarding the agent-branch onto main satisfies that literally (branch
unchanged, only the commit it points to moved). No architectural change; the alternative
("work on a stale tree") is mechanically impossible. Surfacing as a deviation rather
than asking a question because the plan already names 03-01 as a wave-0 hard dependency
and the worktree visibly does not carry it.

## D-2 (Rule 3 — blocking issue): Initial Edit/Write calls drifted to the main repo

**Found during:** Task 1 (assembly skeleton).

**Issue:** The first two `Write` calls used absolute paths under
`/Users/wrede/Documents/GitHub/vault-memory/src/assembly/`, which resolve to the
**main repo checkout**, not the worktree. This is the `#3099` cwd-drift class of bug
called out in the executor protocol — `pwd` from the orchestrator's perspective points
at the main repo even when the agent's actual cwd is the worktree.

**Fix:** Removed the two stray files (`src/assembly/index.ts`, `src/assembly/types.ts`)
from the main repo with `rm -rf` — both were untracked, so no committed work was lost.
All subsequent file writes use absolute paths under
`/Users/wrede/Documents/GitHub/vault-memory/.claude/worktrees/agent-aec993f2b49fee40e/`.
Verified after each write that the target path lives inside the worktree's
`git rev-parse --show-toplevel`.
