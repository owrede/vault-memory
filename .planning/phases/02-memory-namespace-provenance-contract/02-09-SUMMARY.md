---
phase: 02-memory-namespace-provenance-contract
plan: 09
subsystem: memory/sink-handle-parser
tags: [memory-namespace, safety-invariant, path-traversal, cr-01, gap-closure]
gap_closure: true
resolves: [CR-01]
dependency_graph:
  requires:
    - 02-02 # memory-substrate (parseMemorySinkHandle exists)
    - 02-03 # registry (calls parseMemorySinkHandle on config load)
    - 02-08 # validator-and-guards (Guards A/B sit on top of this substrate)
  provides:
    - hardened-sink-handle-parser # rejects ".." / "." / empty / backslash segments
    - safe-by-construction-pathInSink # downstream pathInSink can no longer escape vault root
  affects:
    - src/memory/registry.ts # loadSinksFromConfig parses every [[memory_sinks]] entry
    - src/adapters/delivery/obsidian-fs/sentinel.ts # provisionSink resolves via pathInSink
    - src/adapters/delivery/obsidian-fs/path.ts # pathInSink no longer needs to defend in depth
tech_stack:
  added: []
  patterns:
    - per-segment-whitelist-after-regex
    - nfc-normalization-before-validation
    - input-boundary-defense
key_files:
  modified:
    - src/memory/sink.ts # +57 lines: SEGMENT_PATTERN constant, NFC normalize, per-segment scan, diagnostic error
    - src/memory/sink.test.ts # +74 lines: 9 new assertions covering CR-01
  created: []
decisions:
  - "Tightening at the parser boundary, NOT downstream — pathInSink semantics, Guard A/B firing, and registry behavior are all untouched. Per CLAUDE.md memory-namespace safety invariant, the input boundary is the only place to absorb this fix; softening downstream would have inverted the safety direction."
  - "SEGMENT_PATTERN allows '.' INSIDE segments (file extensions, dotfiles like .memory-sink-meta) but the per-segment bare-dot / bare-dot-dot check refuses '.' and '..' as standalone segments — exactly the values path.normalize would collapse."
  - "NFC normalization applied BEFORE the regex test, not after. ASCII inputs are fixed points so this is a no-op for positive controls; for would-be Unicode-tricks, normalization happens before any byte-level pattern matching."
  - "Error message echoes the original input handle (after NFC) AND names the offending segment, so config-error diagnostics tell the operator both what they wrote and which segment failed."
metrics:
  duration: 22m
  completed: 2026-05-16
---

# Phase 02 Plan 09: CR-01 — MemorySinkHandle path-traversal rejection Summary

**One-liner:** Tightened `parseMemorySinkHandle` to reject `..` / `.` / empty / backslash / control-character segments after applying Unicode NFC normalization, closing CR-01 at the input boundary so `pathInSink` is safe-by-construction.

## What changed

The Phase 2 review (02-REVIEW.md, CR-01) flagged that `MEMORY_SINK_HANDLE_PATTERN` accepted any non-whitespace characters in the resource segment, so a `[[memory_sinks]]` entry with handle `obsidian-fs://atlas/../../etc/passwd-fake/` parsed cleanly. Downstream `pathInSink(vaultAbs, sink)` then called `path.join`, which collapsed the `..` segments and escaped the vault root. `provisionSink` would write `.memory-sink` outside the vault; subsequent `record_observation` writes landed outside the vault as well. This was the substrate the memory-namespace safety invariant rests on, and the gap let an attacker (or a misconfiguration) point a "sink" anywhere on disk.

The fix is at the parser boundary only:

1. **NFC normalization first.** `s = rawInput.normalize("NFC")` runs before the top-level regex test, so decomposed-vs-precomposed Unicode equivalents cannot smuggle a `..` past the per-segment whitelist. ASCII inputs are NFC fixed points → no behavior change on positive controls.
2. **Per-segment whitelist.** A new `SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/` is applied to each `/`-separated segment of the resource after the regex passes. Each segment must be non-empty, not `"."`, not `".."`, and match the whitelist. Backslashes, leading slashes (which create empty segments), control characters, and Unicode lookalikes are all refused.
3. **Diagnostic error.** The thrown error names the offending segment (`JSON.stringify(segment)`), echoes the original handle, and describes the allowed shape. Operators reading config-error logs see both what they wrote and which segment failed.

`formatMemorySinkHandle` round-trips through `parseMemorySinkHandle`, so it inherits the hardening for free. No Guard A/B, validator, or `pathInSink` code was softened; the safety floor is now tighter than what Phase 2 originally shipped.

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1a | RED: failing tests for path-traversal rejection | a2a3fe7 | src/memory/sink.test.ts |
| 1b | GREEN: SEGMENT_PATTERN + NFC + per-segment scan | 3f71469 | src/memory/sink.ts |

## Behavior changes

### Rejected (newly)

| Input | Reason |
|---|---|
| `obsidian-fs://atlas/../escape/` | `".."` segment |
| `obsidian-fs://atlas/../../etc/passwd-fake/` | repeated `".."` |
| `obsidian-fs://atlas/foo/../bar/` | interior `".."` |
| `obsidian-fs://atlas/./foo/` | interior `"."` |
| `obsidian-fs://atlas//double/` | empty segment from `//` |
| `obsidian-fs://atlas/foo\bar/` | backslash inside segment |

### Still accepted (positive controls)

| Input | Phase 2 baseline preserved |
|---|---|
| `obsidian-fs://atlas/_memory/` | single-segment sink folder |
| `obsidian-fs://atlas/_memory/inbox/` | multi-segment resource |
| All existing 20 sink.test.ts assertions | regex / sentinel / format helpers unchanged |

## Verification

- `npx vitest run --no-coverage src/memory/sink.test.ts` — **29 passed** (20 baseline + 9 new).
- `npx vitest run --no-coverage src/memory/ src/adapters/delivery/` — **227 passed** across 17 test files; no Phase 2 surface regressed.
- `npm test` (full suite) — **837 passed | 11 todo** across 68 test files. The 9 newly-passing sink assertions account for the delta from the pre-plan 828.
- `npx tsc --noEmit` — clean.
- `bash scripts/lint-adapters.sh` — `✓ All adapter-seam invariants green.` No new `node:fs` / `node:path` imports were added; this plan touches only `src/memory/sink.ts` (which has always been adapter-free).
- Acceptance greps: `SEGMENT_PATTERN` declared at `src/memory/sink.ts:71`; `normalize("NFC")` applied at line 84.

## Deviations from Plan

None — plan executed exactly as written.

## Stub tracking

No stubs introduced. The change is a pure-substrate hardening with no UI / data-source coupling.

## Threat surface scan

No new threat surface. The change strictly **tightens** an existing input-validation surface (the sink handle parser), which is the substrate Guards A/B in `src/adapters/delivery/obsidian-fs/index.ts` and the validator chokepoint in `src/memory/validator.ts` already rest on. The memory-namespace safety invariant (CLAUDE.md) is now defended at two layers: the parser refuses traversal-shaped handles at config load time, and the Guards refuse non-agent writes inside sinks at runtime.

## Self-Check: PASSED

- src/memory/sink.ts — FOUND (modified, +57 lines)
- src/memory/sink.test.ts — FOUND (modified, +74 lines)
- Commit a2a3fe7 (RED) — FOUND in git log
- Commit 3f71469 (GREEN) — FOUND in git log
- All 837 project tests pass
- TypeScript clean
- Adapter-seam invariants green
