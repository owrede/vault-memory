# Phase 8 — Deferred Items

Out-of-scope discoveries during plan execution. Each item names the plan that
surfaced it and the scope-boundary reason it was deferred (not fixed) at the
discovery moment.

## From plan 08-01 (CHANGELOG backfill)

### Pre-existing `lint-no-telemetry.sh` false positive on `Entry` ↔ `sentry`

- **Surfaced during:** plan 08-01 Task 3 (running `npm run lint:check`).
- **Files affected:** `src/contracts/resources.ts` (lines 46, 57, 64, 112, 122, 147) and `src/contracts/index.ts` (lines 84, 87).
- **Root cause:** `scripts/lint-no-telemetry.sh` banlist contains `sentry` as a
  case-insensitive substring match. The Phase 6 type names
  `ListContractsEntry` and `ListContractVerbsEntry` contain the substring
  `sEntry` (within "Entry"), so all six TypeScript references trip the
  banlist.
- **Pre-existing?** YES — these lines were introduced by Phase 6 commit
  `9aaf325` (`feat(06-04): list_contracts + list_contract_verbs MCP Resources`).
  Plan 08-01 modifies only `CHANGELOG.md`; the violations are not caused by
  this plan.
- **Scope-boundary disposition:** Out of scope for plan 08-01 (CHANGELOG-only).
  Logged here per the executor's scope-boundary rule.
- **Suggested fix (defer to a later Phase 8 plan or a follow-up patch):**
  - Either append `// vault-memory:no-telemetry-ok` to each of the 8 affected
    lines (the escape mechanism documented in `scripts/lint-no-telemetry.sh`),
    or
  - Tighten the banlist regex from `sentry` to `\bsentry\b` (POSIX `grep -E`
    word-boundary form) so identifier-substring collisions stop tripping the
    lint. The latter is the cleaner fix because future `Entry`-suffixed type
    names would otherwise need the same escape comment.

  Recommended landing site: plan 08-04 (eval / lint discipline) if scope
  allows, or a small `chore(lint): tighten telemetry banlist` PR before the
  v2.0.0 release script runs.
