---
phase: 5
slug: compiled-brief-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-18
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.x (existing) |
| **Config file** | none (uses package.json defaults) |
| **Quick run command** | `npx vitest run src/brief/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (quick) / ~120 seconds (full, ~1211+ tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/brief/` (or scope-targeted file)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Populated by gsd-planner. Each plan task gets one row; eval tasks reference fixture files; ADR/contract tasks reference file-exists checks.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | BRF-02 | — | ADR documents capability-first ladder + no-remote-SDK invariant | doc | `test -f docs/v2/adr/005-brief-compile-strategy.md` | ❌ W0 | ⬜ pending |
| TBD | — | — | BRF-01..BRF-11 | — | (planner fills) | unit/integration/eval | (planner fills) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner contract: every BRF-XX requirement must appear in at least one row with `Test Type ∈ {unit, integration, eval, conformance}`.*

---

## Wave 0 Requirements

- [ ] `src/brief/compile.test.ts` — stubs for BRF-01, BRF-03 (compile_brief contract + LLM ladder)
- [ ] `src/brief/get.test.ts` — stubs for BRF-04 (get_brief decision tree)
- [ ] `src/brief/source-hashes.test.ts` — stubs for D-04/D-05 ChunkId + hash recompute
- [ ] `src/brief/body-validator.test.ts` — stubs for D-11 wikilink emission
- [ ] `src/brief/daemon.test.ts` — stubs for BRF-05/06/07/08 (subscribe, single-owner, replay, rename)
- [ ] `src/brief/lock.test.ts` — stubs for D-08 lock + PID liveness
- [ ] `src/brief/resources.test.ts` — stubs for BRF-09 list_briefs Resource
- [ ] `evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml` — BRF-10 primary eval (curated source_doc_ids)
- [ ] `evals/fixtures/v2-test-vault/_queries/briefs-from-cluster.yaml` — D-02 pipeline integration eval
- [ ] `evals/fixtures/v2-test-vault/_queries/briefs-staleness-stub.yaml` — BRF-11 cross-adapter eval
- [ ] `src/adapters/source/conformance.test.ts` — extension for brief + staleness assertions against obsidian-fs + stub

*No framework install required — vitest 2.1.x already installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP Sampling capability negotiation in real client | BRF-05 (D-10 tier 1) | Sampling requires a live MCP client (Claude Desktop / Inspector) declaring `sampling.createMessage` capability; cannot fully simulate in vitest | Connect MCP Inspector → `vault-memory serve` → call `compile_brief` → confirm Inspector prompts for LLM consent → confirm brief written with `compiled_from: ["sampling"]` |
| Two `vault-memory serve` against same vault (D-07/D-08) | BRF-07 | Spawning two real Node processes with a shared `~/.vault-memory/locks/<vault>.lock` is a process-level test; runtime is OS scheduler dependent | (a) Start server A → confirm daemon active in audit_log; (b) Start server B → confirm WARN log "daemon already owned by PID N" + tools/list identical; (c) Kill server A → confirm server B does NOT auto-promote (single boot only acquires lock); (d) Restart server B → confirm it acquires the lock |
| Snapshot regen — `evals/v1-baseline/tools-list.snapshot.json` | (additive: +2 tools, +1 resource) | Snapshot is human-reviewed once per phase PR | `npm test -- tools-list.snapshot` (will fail) → review diff is exactly `compile_brief` + `get_brief` tools + `list_briefs` resource → `npx vitest run -u tools-list.snapshot.test` → commit |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (vitest CLI uses `run`, never `--watch` in CI)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
