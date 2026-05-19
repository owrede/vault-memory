---
phase: 7
slug: visual-contract-editor-canvas
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x (existing server) + vitest 2.x (new `plugin/` package, same major) + Playwright 1.x (editor view smoke) |
| **Config file** | `vitest.config.ts` (root, server tests), `plugin/vitest.config.ts` (plugin tests), `plugin/playwright.config.ts` (editor view) |
| **Quick run command** | `npm test -- --run --reporter=dot` (server) / `npm --workspace=plugin test -- --run --reporter=dot` (plugin) |
| **Full suite command** | `npm test && npm --workspace=plugin test && npm --workspace=plugin run test:e2e` |
| **Estimated runtime** | ~45s server unit + ~30s plugin unit + ~60s Playwright = ~135s end-to-end |

---

## Sampling Rate

- **After every task commit:** Run the workspace-scoped quick command (server-only tasks → server quick; plugin-only tasks → plugin quick).
- **After every plan wave:** Run the full suite (server + plugin unit + Playwright editor smoke).
- **Before `/gsd:verify-work`:** Full suite must be green; round-trip eval must be green.
- **Max feedback latency:** 60 seconds (quick) / 180 seconds (full).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD by planner | TBD | TBD | CAN-01..10, PLG-01..05 | TBD | TBD | TBD | TBD | ❌ W0 | ⬜ pending |

*The planner fills this table from PLAN.md task IDs after Step 8. Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky.*

---

## Wave 0 Requirements

- [ ] `plugin/package.json` + `plugin/vitest.config.ts` — initialize the new `plugin/` workspace with vitest matching the server's major version.
- [ ] `plugin/playwright.config.ts` + `plugin/tests/e2e/editor.smoke.spec.ts` — Playwright config + one smoke test that boots the editor view headlessly and opens `meeting-prep.contract`.
- [ ] `examples/contracts/round-trip.test.ts` — Wave 0 stub for CAN-07 acceptance test (imports `ContractFileSchema`, asserts `import yaml → emit .contract → emit yaml` deep-equality on the three reference fixtures).
- [ ] Root `vitest.workspace.ts` (if not already present) so `npm test` from the repo root picks up both `src/` and `plugin/` test trees.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `vm-install` skill end-to-end install in a real Obsidian vault | CAN-09 / D-DIST-PRIMARY | Touches Obsidian's community-plugins config + user FS outside CI; depends on a running Obsidian app | Run `vm-install` against a clean test vault; verify `.obsidian/plugins/vault-memory/` populated, manifest enabled, plugin loads in Obsidian Settings → Community Plugins |
| `vm-update` skill upgrades plugin in place | D-DIST-UPDATE | Same as above; depends on GitHub Releases reachability + Obsidian runtime | Bump local `manifest.json.version` down by one, run `vm-update`, verify version increments and plugin reloads |
| `safeStorage` per-device ciphertext re-prompt on a second device | D-CHROME-SECRETS / PLG-02 | Requires two physical/virtual devices with synced vault | Add a secret on device A; sync vault to device B; open plugin; expect re-entry prompt for the secret |
| Screencast renders the end-to-end flow correctly | D-SCREENCAST | Visual/audio artifact, not a test | Watch the ≤8min `.mp4`; verify install → first contract authored → first `instantiate_contract` call all visible |
| External-edit detection prompt in editor | D-WATCH-SERVER-NOTIFY | Requires Obsidian runtime + a second editor process | Open `meeting-prep.contract` in the plugin; edit the corresponding `_contracts/meeting-prep.yaml` in a plain text editor; save; expect "External edit detected — reload editor?" prompt in the plugin |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (plugin workspace, Playwright config, round-trip test stub)
- [ ] No watch-mode flags in CI / sampling commands
- [ ] Feedback latency < 60s (quick) / 180s (full)
- [ ] `nyquist_compliant: true` set in frontmatter after planner backfills the verification map

**Approval:** pending
