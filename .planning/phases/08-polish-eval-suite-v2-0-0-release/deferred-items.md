# Phase 08 — Deferred items

Out-of-scope discoveries surfaced during plan execution but not fixed by the
discovering plan. Each row identifies the discovering plan and the
investigation/fix follow-up location.

| Discovered by | File | Issue | Pre-existing? |
|---|---|---|---|
| 08-02 | `src/contracts/resources.ts` (lines 46, 57, 64, 112, 122, 147) and `src/contracts/index.ts` (lines 84, 87) | `npm run lint:check` fails on `scripts/lint-no-telemetry.sh`: identifiers `ListContractsEntry` and `ListContractVerbsEntry` match the telemetry banlist substring (`List...`). Either the lint pattern is too aggressive or the identifiers need a `// vault-memory:no-telemetry-ok` suffix. The names refer to MCP Resource entry types (Phase 6 plan 06-04), not telemetry payloads. | Yes — Phase 6 commit `9aaf325 feat(06-04): list_contracts + list_contract_verbs MCP Resources`. Predates Phase 8. |
