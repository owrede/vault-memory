---
phase: 7
slug: visual-contract-editor-canvas
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-19
updated: 2026-05-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x (existing server) + vitest 2.x (new `plugin/` package, same major) + Playwright 1.x deferred to v2.1 per RESEARCH §11 |
| **Config file** | `vitest.config.ts` (root, server tests + `examples/` glob); `plugin/vitest.config.ts` (plugin tests with `obsidian` module alias to `plugin/tests/mocks/obsidian.ts`) |
| **Quick run command** | `npx vitest run --reporter=basic` (server-only tasks) / `cd plugin && npm test -- --run --reporter=basic` (plugin-only tasks) |
| **Full suite command** | `npm test && cd plugin && npm test -- --run` |
| **Estimated runtime** | ~45s server unit + ~30s plugin unit ≈ ~75s end-to-end |

---

## Sampling Rate

- **After every task commit:** Run the workspace-scoped quick command (server-only tasks → server quick; plugin-only tasks → plugin quick).
- **After every plan wave:** Run the full suite (server + plugin unit) plus the v1-baseline snapshot test.
- **Before `/gsd:verify-work`:** Full suite must be green; round-trip eval must be green; v1-baseline snapshot must be BYTE-IDENTICAL.
- **Max feedback latency:** 60 seconds (quick) / 90 seconds (full).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-T1 | 07-01 | 1 | CAN-10 | T-07-01-ADR | ADR-007 lands with all locked D-* decisions | grep | `grep -q "ADR-007" docs/v2/adr/007-contract-editor.md && grep -q "D-UI" docs/v2/adr/007-contract-editor.md` | ❌ W0 | ⬜ |
| 07-01-T2 | 07-01 | 1 | CAN-10 | T-07-01-SC | Plugin scaffold + meeting-prep prototype builds | build | `cd plugin && npm run typecheck && npm run build && npm test -- --run` | ❌ W0 | ⬜ |
| 07-01-T3 | 07-01 | 1 | CAN-10 | T-07-01-PROTO | Human go/no-go on prototype | checkpoint | (manual) | n/a | ⬜ |
| 07-02-T1 | 07-02 | 2 | CAN-01 | T-07-02-01 | ContractDocumentSchema validates `.contract` shape | unit | `npx vitest run src/contracts/contract-file-schema.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-02-T2 | 07-02 | 2 | CAN-07 | T-07-02-01 | canonicalize + editor-state-comment pure helpers | unit | `cd plugin && npm test -- --run plugin/src/codec/canonicalize.test.ts plugin/src/codec/editor-state-comment.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-02-T3 | 07-02 | 2 | CAN-02, CAN-07 | T-07-02-01 | Codec round-trip stability + comment preservation | unit | `cd plugin && npm test -- --run plugin/src/codec/contract-codec.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-03-T1 | 07-03 | 2 | PLG-01 | T-07-03-02 | SettingsStore typed defaults + persist round-trip | unit | `cd plugin && npm test -- --run plugin/src/services/settings-store.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-03-T2 | 07-03 | 2 | CAN-01 | T-07-03-03 | VaultMemoryMcpClient stdio + missing-CLI error | unit | `cd plugin && npm test -- --run plugin/src/services/mcp-client.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-03-T3 | 07-03 | 2 | CAN-01, CAN-05 | T-07-03-01 | Plugin onload lifecycle + missing-CLI banner | build | `cd plugin && npm run typecheck && npm run build` | ❌ W0 | ⬜ |
| 07-04-T1 | 07-04 | 2 | PLG-01..05 | T-07-04-05 | `[plugin]` config block parses with default false | unit | `npx vitest run src/config/loader.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-04-T2 | 07-04 | 2 | PLG-01..05 | T-07-04-01,02,03 | 5 plugin-control tool handlers Zod-validated | unit | `npx vitest run src/plugin-tools/ --reporter=basic` | ❌ W0 | ⬜ |
| 07-04-T3 | 07-04 | 2 | PLG-01..05 | T-07-04-05 | syncPluginTools gating + v1-baseline snapshot byte-identical | snapshot | `npx vitest run src/plugin-tools/index.test.ts src/server.plugin-gating.test.ts evals/v1-baseline/baseline.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-05-T1 | 07-05 | 3 | CAN-04 | T-07-05-02 | layout + palette + zod-to-form pure modules | unit | `cd plugin && npm test -- --run plugin/src/views/contract-editor/canvas/layout.test.ts plugin/src/views/contract-editor/palette/verb-list.test.ts plugin/src/views/contract-editor/palette/peer-mcp.test.ts plugin/src/views/contract-editor/inspector/zod-to-form.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-05-T2 | 07-05 | 3 | CAN-01..05 | T-07-05-01 | Svelte three-pane editor builds | build | `cd plugin && npm run typecheck && npm run build` | ❌ W0 | ⬜ |
| 07-05-T3 | 07-05 | 3 | CAN-02, CAN-03 | T-07-05-01,03 | view.ts wires codec + debounced YAML emission | build + grep | `cd plugin && npm run build && grep -q "ContractDocumentSchema" plugin/src/views/contract-editor/view.ts && grep -q "emitYaml" plugin/src/views/contract-editor/view.ts` | ❌ W0 | ⬜ |
| 07-06-T1 | 07-06 | 3 | CAN-06 | T-07-06-01 | Three reference .contract files exist + parse | shape | `node -e "for (const n of ['meeting-prep','project-status','code-review-brief']) { const j=require('./examples/contracts/'+n+'.contract'); if(j.vmFormatVersion!==1\|\|j.contract.name!==n) process.exit(1); }"` | ❌ W0 | ⬜ |
| 07-06-T2 | 07-06 | 3 | CAN-07 | T-07-06-01 | CAN-07 round-trip acceptance test pinned | integration | `npx vitest run examples/contracts/round-trip.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-07-T1 | 07-07 | 4 | CAN-08 | T-07-07-02 | SuppressionSet hash extension + Phase 6 loader consume() | unit | `npx vitest run src/adapters/change-feed/obsidian-fs/suppression.test.ts src/contracts/loader.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-07-T2 | 07-07 | 4 | CAN-08 | T-07-07-01 | suppress_contract_write tool gated + snapshot byte-identical | unit | `npx vitest run src/plugin-tools/suppress-contract-write.test.ts src/plugin-tools/index.test.ts src/server.plugin-gating.test.ts evals/v1-baseline/baseline.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-07-T3 | 07-07 | 4 | CAN-08 | T-07-07-03 | ReloadNotifier subscribes + view.ts strict suppression-before-write ordering | unit + grep | `cd plugin && npm test -- --run plugin/src/services/reload-notifier.test.ts --reporter=basic && grep -q "suppress_contract_write" plugin/src/views/contract-editor/view.ts` | ❌ W0 | ⬜ |
| 07-08-T1 | 07-08 | 3 | PLG-02 | T-07-08-01,02,03 | SafeStorageAdapter + SecretsStore encrypted persistence | unit | `cd plugin && npm test -- --run plugin/src/services/safe-storage.test.ts plugin/src/services/secrets-store.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-08-T2 | 07-08 | 3 | PLG-01 | T-07-08-04 | Full settings tab UI fields | unit | `cd plugin && npm test -- --run plugin/src/chrome/settings-tab.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-08-T3 | 07-08 | 3 | PLG-02 | T-07-08-01,02 | Secrets panel UI + basic_text consent flow | unit + build | `cd plugin && npm test -- --run plugin/src/chrome/secrets-panel.test.ts --reporter=basic && cd plugin && npm run build` | ❌ W0 | ⬜ |
| 07-09-T1 | 07-09 | 3 | PLG-03 | T-07-09-01 | Reindex panel triggers MCP tool + progress notifications | unit | `cd plugin && npm test -- --run plugin/src/chrome/reindex-panel.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-09-T2 | 07-09 | 3 | PLG-04 | T-07-09-02 | Stats panel renders MCP response + refresh | unit | `cd plugin && npm test -- --run plugin/src/chrome/stats-panel.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-09-T3 | 07-09 | 3 | PLG-03, PLG-04 | T-07-09-01 | ChromeView + open-chrome command + side-panel mount | unit + build | `cd plugin && npm test -- --run plugin/src/chrome/chrome-view.test.ts --reporter=basic && cd plugin && npm run build && grep -q "open-chrome" plugin/main.ts` | ❌ W0 | ⬜ |
| 07-10-T1 | 07-10 | 4 | PLG-05 | T-07-10-01 | connector-resolver: `${secret:name}` substitution | unit | `cd plugin && npm test -- --run plugin/src/services/connector-resolver.test.ts --reporter=basic` | ❌ W0 | ⬜ |
| 07-10-T2 | 07-10 | 4 | PLG-05 | T-07-10-02 | Connectors panel CRUD via set_mcp_client | unit + build | `cd plugin && npm test -- --run plugin/src/chrome/connectors-panel.test.ts --reporter=basic && cd plugin && npm run build` | ❌ W0 | ⬜ |
| 07-11-T1 | 07-11 | 5 | CAN-09 | T-07-11-01,04 | vm-install skill: shape + SHA-256 verify | static | `bash -n skills/vm-install/setup.sh && grep -q "shasum -a 256" skills/vm-install/setup.sh && grep -q "name: vm-install" skills/vm-install/SKILL.md` | ❌ W0 | ⬜ |
| 07-11-T2 | 07-11 | 5 | CAN-09 | T-07-11-01,03 | vm-update skill: shape + semver compare | static | `bash -n skills/vm-update/update.sh && grep -q "compare_semver" skills/vm-update/update.sh && grep -q "name: vm-update" skills/vm-update/SKILL.md` | ❌ W0 | ⬜ |
| 07-11-T3 | 07-11 | 5 | CAN-09 | T-07-11-01 | Live-vault dry run | checkpoint | (manual) | n/a | ⬜ |
| 07-12-T1 | 07-12 | 5 | CAN-09 | T-07-12-01 | 5 plugin docs + INDEX exist with required content markers | grep | `for f in INSTALL SETTINGS SECRETS CONTRACT-EDITOR CONNECTORS README; do test -f docs/v2/plugin/$f.md \|\| exit 1; done && grep -q "vm-install" docs/v2/plugin/INSTALL.md && grep -q "set_mcp_client" docs/v2/plugin/CONNECTORS.md` | ❌ W0 | ⬜ |
| 07-12-T2 | 07-12 | 5 | CAN-09 | T-07-12-01 | README has plugin section | grep | `grep -q "## Obsidian plugin" README.md && grep -q "docs/v2/plugin/INSTALL.md" README.md` | ❌ W0 | ⬜ |
| 07-12-T3 | 07-12 | 5 | CAN-09 | T-07-12-02 | Screencast recorded OR deferred to Phase 8 | checkpoint | (manual) | n/a | ⬜ |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. The planner fills the `Status` column after each task is implemented; the harness flips on completion.*

---

## Wave 0 Requirements

- [x] `plugin/package.json` + `plugin/vitest.config.ts` — initialized in plan 07-01 task 2.
- [x] `plugin/tests/mocks/obsidian.ts` — initialized in plan 07-01 task 2; extended by 07-03 (loadData/saveData), 07-08 (Modal/Setting), 07-09 (ItemView).
- [x] `examples/contracts/round-trip.test.ts` — landed by plan 07-06 task 2. Plan 07-02 task 3 lands the underlying codec unit tests first.
- [x] Root `vitest.config.ts` (or `vitest.workspace.ts`) — Plan 07-06 task 2 updates the include glob to pick up `examples/**/*.test.ts` if not already present.
- [ ] Playwright config — DEFERRED to v2.1 per RESEARCH §11 + §"Validation Architecture" decision "View-level tests deferred to v2.1; v2.0.0 ships unit tests for pure-codec / pure-service modules only; manual smoke via screencast".

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Spike prototype renders meeting-prep.contract in real Obsidian | CAN-10 / D-SPIKE | Requires running Obsidian + symlinked plugin dir | Plan 07-01 Task 3 checkpoint |
| `vm-install` skill end-to-end install in a real Obsidian vault | CAN-09 / D-DIST-PRIMARY | Touches Obsidian's community-plugins config + user FS outside CI | Plan 07-11 Task 3 checkpoint |
| `vm-update` skill upgrades plugin in place | D-DIST-UPDATE | Same as above; depends on GitHub Releases reachability + Obsidian runtime | Plan 07-11 Task 3 checkpoint |
| `safeStorage` per-device ciphertext re-prompt on a second device | D-CHROME-SECRETS / PLG-02 | Requires two physical/virtual devices with synced vault | Documented in `docs/v2/plugin/SECRETS.md` (Plan 07-12); not CI-enforced in v2.0.0 |
| Screencast renders the end-to-end flow correctly | D-SCREENCAST | Visual/audio artifact, not a test | Plan 07-12 Task 3 checkpoint |
| External-edit detection prompt in editor | D-WATCH-SERVER-NOTIFY | Requires Obsidian runtime + a second editor process | Smoke listed in Plan 07-07 verification block |
| Variant C editor renders against all three reference contracts | CAN-04, CAN-05 | Visual confirmation | Plan 07-05 verification block + screencast (Plan 07-12) |

---

## Nyquist Compliance

Every task in the per-task verification map either:
1. Has an `<automated>` verify command that runs in CI, OR
2. Is an explicit checkpoint task (`checkpoint:human-verify` or `checkpoint:human-action`) with a documented manual procedure, OR
3. Depends on a Wave 0 stub that creates the test infrastructure (every plugin-side test depends on `plugin/vitest.config.ts` + `plugin/tests/mocks/obsidian.ts` created in plan 07-01).

No 3 consecutive tasks lack automated verify. The frontmatter `nyquist_compliant: true` reflects this.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are flagged as manual checkpoints
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (plugin workspace, vitest config, obsidian mock, vitest workspace glob)
- [x] No watch-mode flags in CI / sampling commands
- [x] Feedback latency < 60s (quick) / 90s (full)
- [x] `nyquist_compliant: true` set in frontmatter
- [ ] Maintainer sign-off after Wave 1 spike checkpoint resolves

**Approval:** pending maintainer go/no-go from plan 07-01 Task 3.
