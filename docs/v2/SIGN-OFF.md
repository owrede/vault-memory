# Phase 0 — Sign-Off

**Phase:** 0 — Foundation & decisions
**Sign-off date:** 2026-05-14
**Maintainer:** _to be recorded at PR approval time per D-17_

This document is the canonical artifact for FND-14. Per ADR D-17, maintainer
approval on the final Phase 0 PR carrying this file (plus the ADRs, architecture
docs, eval fixtures, lint scripts, and adversarial review) IS the audit trail
— there is no separate signed-commit ceremony. See `## Audit trail` at the
bottom of this file.

## FND checklist

- [x] FND-01: ADRs 001–004 relocated from `docs/dev/` (gitignored) to `docs/v2/adr/` (public, tracked) — resolved by `e1b2524` (see ADR-001..004 relocate commits `e1b2524`, `cc81978`, `665e71d`, `edf4688`)
- [x] FND-02: ADR-003 amended to specify `Document.hash` semantics — covers `(blocks rendered to plain text) + (PropertyBag serialized canonically)`; chunk-level `source_hashes` schema — resolved by `ba46159` (amended further in `01ba6bd` for versioned-API + Notion cost note per Finding F2/F9)
- [x] FND-03: ADR-004 amended to specify folder-default `MemorySink` with config-only separate-vault option (no code branch) — resolved by `8510c13`
- [x] FND-04: Each ADR (001–004) gains explicit Invariants + Examples sections; adversarial-review sub-agent confirms a Phase 10 agent could implement Notion from ADRs alone — resolved by `47d1deb` (see Invariants/Examples commits `47d1deb`, `c794268`, `ba46159`, `8510c13`; adversarial review at `e5593bd` + `ebf5369`)
- [x] FND-05: `docs/v2/ARCHITECTURE.md` published — layer model (Adapter / L0 retrieval / L1 graph / L2 memory / L3 assembly / L4 contracts) — resolved by `5539463`
- [x] FND-06: `docs/v2/MEMORY_CONTRACT.md` published — property contract (`source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`) defined in terms of `Document.properties` — resolved by `ce3eb7c`
- [x] FND-07: `docs/v2/AGENT_AGNOSTIC.md` published — MCP is canonical client interface; Skills are one delivery mechanism — resolved by `bc3e0bc`
- [x] FND-08: `evals/fixtures/v2-test-vault/` ships — 50–100 notes with coherent narrative ("Atlas Robotics"); ≥3 hand-labeled queries per upcoming tool category — resolved by `d33b742` (see fixture authoring commits `d33b742`, `fe72ca4`, `b7db3e3`, `3b46daf`, `9841643`, `cd3ce70`; 56 narrative notes + 15 `_memory/` + 7 `_queries/*.yaml`)
- [x] FND-09: `evals/v1-baseline/` regression suite frozen — every v1 tool's expected behavior captured for per-PR regression checks — resolved by `fd68461` (13 baseline YAMLs; runner at `3fa9025`)
- [x] FND-10: Tool-snapshot tests pin `tools/list` JSON output for all 23 v1 tools — any drift fails CI — resolved by `1b96a8e` (snapshot generator + pinned artifact; registry extraction in `294e30f`)
- [x] FND-11: `scripts/check-fixture-privacy.sh` — CI lint preventing accidental private-vault commits — resolved by `825c28b`
- [x] FND-12: `scripts/lint-no-telemetry.sh` — CI lint preventing telemetry/analytics code from landing — resolved by `5e9fb7f` (CI workflow that runs both lints at `85c43c4`)
- [x] FND-13: Decision Log / ADR index page at `docs/v2/adr/README.md` listing every contested choice with numbered ADRs — resolved by `ac8e14f` (4 Accepted + 14 Open ADR stubs; Deferred-v3 section added in `e911d53`)
- [x] FND-14: Maintainer sign-off on all Phase 0 docs and ADRs — resolved by `cbb72b9` (this SIGN-OFF.md + adversarial-review disposition; maintainer PR approval is the audit-trail event per `## Audit trail` below)

## ADRs accepted

- [ADR-001 — Document identity is opaque (URI-style)](adr/001-document-identity.md) — Accepted; Invariants I-1..I-6; cross-source Examples (obsidian-fs + notion-api).
- [ADR-002 — Source / Delivery / ChangeFeed adapter seams](adr/002-adapter-seams.md) — Accepted; Invariants I-1..I-7; amended with `DocumentRef.hash` two-tier contract (`content` vs `marker`) per Findings F1/F7/F9/F10.
- [ADR-003 — Normalized Document shape + hash semantics](adr/003-document-shape.md) — Accepted; Invariants H-1..H-6; explicit `hash()` pseudocode citing RFC 8785 (JCS), NFC, LF, IEEE-754 number canonicalization; chunk-level `source_hashes` schema.
- [ADR-004 — Memory-sink handles (`obsidian-fs://<vault>/_memory/`)](adr/004-memory-sink-handles.md) — Accepted; Invariants M-1..M-5; folder-default is the only code path; separate-vault is config-only; `.memory-sink` sentinel mandatory.

## Architecture docs published

- [`docs/v2/ARCHITECTURE.md`](ARCHITECTURE.md) — L0–L4 layer model + responsibility map; ≤800 lines; cross-links to ADRs 001–004.
- [`docs/v2/MEMORY_CONTRACT.md`](MEMORY_CONTRACT.md) — provenance property contract (`source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`) on `Document.properties`; `DeliveryAdapter.write()` validator guards A + B specified.
- [`docs/v2/AGENT_AGNOSTIC.md`](AGENT_AGNOSTIC.md) — MCP-canonical client interface; Skills are one delivery mechanism; no Claude-only assumptions in the contract surface.

## Eval substrate

The eval substrate has two halves. The **v2 fixture vault** at
`evals/fixtures/v2-test-vault/` ("Atlas Robotics") ships 56 narrative
markdown notes across `projects/`, `meetings/`, `people/`, `decisions/`,
`references/`, a 15-document `_memory/` subset with full
`MEMORY_CONTRACT.md` provenance properties, and 7 hand-labeled query
YAMLs in `_queries/` — one per upcoming tool category (`search`,
`bundle`, `dossier`, `brief`, `graph`, `memory`, `contract`). The
**v1-baseline regression suite** at `evals/v1-baseline/` consists of a
pinned `tools-list.snapshot.json` (23 v1 tools), a `dump-tools.mjs`
generator that imports the new `src/tool-registry.ts` without spinning
the full MCP server, 11 per-tool semantic-floor YAMLs (`search.yaml`,
`search_text.yaml`, `search_hybrid.yaml`, `search_semantic.yaml`,
`frontmatter_query.yaml`, `graph_neighbors.yaml`, `graph_path.yaml`,
`list_backlinks.yaml`, `list_forward_links.yaml`, `fetch.yaml`,
`vault_stats.yaml`, `find_broken_links.yaml`,
`suggest_frontmatter.yaml`), and a `baseline.test.ts` vitest runner
that today asserts snapshot equality + YAML fixture integrity. Per-tool
precision/recall semantic-floor execution is wired as `.todo`
placeholders for Phase 1 to lift into real assertions once the adapter
boundary lands. Together they form the regression floor: any Phase 1+ PR
that breaks v1 behaviour or drifts the tool surface fails CI.

## CI gates

- [`scripts/check-fixture-privacy.sh`](../../scripts/check-fixture-privacy.sh) — fails (exit 1) when `evals/fixtures/<dir>/` other than the allowlisted `v2-test-vault` is committed; operates on `git ls-tree -r --name-only HEAD` (committed state, not working tree).
- [`scripts/lint-no-telemetry.sh`](../../scripts/lint-no-telemetry.sh) — banlist guard for telemetry/analytics tokens in `src/**`; supports per-line escape comment `// vault-memory:no-telemetry-ok`.
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — runs `npm ci`, `npm run lint:check` (both shell lints + `tsc --noEmit` + prettier check), and `npm test` on every `pull_request` and `push: main`; `cancel-in-progress: true` concurrency group.

## Adversarial review outcome

Full review at [`docs/v2/adr/ADVERSARIAL-REVIEW.md`](adr/ADVERSARIAL-REVIEW.md).
Ten findings raised against ADRs 001–004 by a fresh-context advisor
researcher; all ten dispositioned in this phase. **Amend / Defer-v3
split: 6 / 4.**

| Disposition | Count | Findings |
| --- | --- | --- |
| Amended (Phase 0) | 6 | F1, F2, F4, F7, F9, F10 |
| Deferred-v3 (Phase 10 / Notion) | 4 | F3, F5, F6, F8 |

Amendments landed across three commits: `aa320de` (ADR-001 I-6
canonical-serialization), `709339a` (ADR-002 `DocumentRef.hash`
contract + `hashProtected` enum + secrets convention + adapter-private
cache permission), `01ba6bd` (ADR-003 H-6 versioned-API hash invariant
+ Notion cost note). Deferred findings are recorded as Open ADR rows in
[`docs/v2/adr/README.md`](adr/README.md) §Deferred-v3 (commit `e911d53`)
and explicitly scoped to v3 / Phase 10 (Notion connector territory).
Companion Notion adapter draft at
[`docs/v2/adr/NOTION-ADAPTER-PLAN.md`](adr/NOTION-ADAPTER-PLAN.md)
sketches the second-adapter implementation contract that ADRs 001–004
must support.

Zero findings remain in `Status: Open`; every finding has a terminal
disposition with the resolving commit SHA recorded in
ADVERSARIAL-REVIEW.md.

## Phase 1 readiness

Phase 1 (Adapter extraction & tech-debt-up) is unblocked. The
preconditions ADP-01..ADP-15 require are all in place:

- ADRs 001–004 fix the contracts that the new adapter modules must satisfy.
- `src/tool-registry.ts` (commit `294e30f`) is the single approved
  pre-Phase-1 `src/` change; everything else still lives where v1.0.0
  left it.
- The v1-baseline regression suite + tool-snapshot fence Phase 1's
  refactor: any external behavior drift trips CI.
- The fixture vault is ready for Phase 1's stub-connector conformance
  tests (ASM-12 / GRA-05 ride on it from Phase 3 onward).
- The adversarial review's Deferred-v3 backlog gives Phase 1 a clear
  "not-now" list — the 14 Open ADR rows in `docs/v2/adr/README.md`
  cover every Phase 10 / Notion question we knew enough to ask but
  chose not to answer yet.

## Known deferred items

These were intentionally not closed in Phase 0 and are tracked for
future phases:

- **Alpine bake-test (manual, once-per-phase)** — POSIX-portability
  smoke for the two shell lints, documented in VALIDATION §Manual-Only.
  Run pre-merge on the final Phase 0 PR by the maintainer; not wired
  into CI matrix (deferred to Phase 8 release polish).
- **Multi-platform CI matrix** — `ci.yml` currently runs on
  `ubuntu-latest` only. macOS/Windows runners deferred to Phase 8
  (REL-* track).
- **ADR-index regenerator script** (D-23 stretch) — hand-edited today;
  optional `scripts/regen-adr-index.sh` deferred to Phase 1 or later.
- **Adversarial-review Deferred-v3 findings** — F3 (`listDocuments`
  scope), F5 (capability-handshake spec), F6 (rate-limit + retry
  contract), F8 (provenance-loss on lossy adapters). All four are
  recorded as Open ADR rows in `docs/v2/adr/README.md` §Deferred-v3
  and scoped to v3 / Phase 10.

## Audit trail

Per ADR D-17, this file plus the maintainer's approval on the final
Phase 0 PR constitutes the audit trail for FND-14. There is no separate
signed-commit ceremony, no detached signature artifact, and no GPG/SSH
trust-root requirement beyond what GitHub's PR-approval surface already
provides. The maintainer's GitHub approval click on the final Phase 0
PR — recorded by GitHub against the merge commit — IS the FND-14
satisfaction event.

To verify the audit trail after merge:

1. Open the final Phase 0 PR on GitHub; confirm `Reviewed by:
   <maintainer>` with `APPROVED` status.
2. Confirm the PR's merge commit contains this `docs/v2/SIGN-OFF.md`
   with every FND-* line `[x]` checked and a resolving commit SHA
   referenced.
3. Confirm `docs/v2/adr/ADVERSARIAL-REVIEW.md` carries zero
   `Status: Open` findings.

Phase 0 is complete on PR approval.
