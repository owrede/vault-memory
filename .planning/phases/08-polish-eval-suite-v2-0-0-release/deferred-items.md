## 08-03 — out-of-scope lint findings

`npm run lint:check` reports a pre-existing telemetry-banlist false
positive in `src/contracts/resources.ts` (lines 46, 57, 64, 112, 122,
147) and `src/contracts/index.ts` (lines 84, 87). The matches are on
the `ListContracts*` / `ListContractVerbs*` identifier names — not
telemetry. Introduced in commit `9aaf325` (Phase 6-04). Plan 08-03
only modifies docs; this is out of scope per the executor SCOPE
BOUNDARY rule. Suggested fix when in scope: append
`// vault-memory:no-telemetry-ok` to each line, or refine the
telemetry-banlist regex to exclude `List*` identifier names.
