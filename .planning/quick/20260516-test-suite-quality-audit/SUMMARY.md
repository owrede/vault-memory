---
quick_id: 20260516-test-suite-quality-audit
status: complete
type: audit
created: 2026-05-16
---

# Test Suite Quality Audit — Phase 2 Memory Namespace

**Scope:** vault-memory project at HEAD `f30bb82` (Phase 2 complete: 9 implementation plans + 7 gap-closure plans, 16/16 review findings claimed closed, 884 tests reported passing in 69 files, 1 `it.skip`, 1 `it.todo`).

**Question:** Does the green test count actually substantiate the safety-invariant claims in `02-VERIFICATION.md`?

**Verdict:** **Partially.** The parser/validator/round-trip layer is strongly tested. Three named claims rest on tests that don't assert what their names suggest.

---

## Findings (severity-ordered)

### HIGH

**H1 — `conformance.test.ts:588` "filesystem invariants" doesn't read the filesystem.**

The block titled `ObsidianFsDelivery — filesystem invariants (adapter-specific)` (line 588) is supposed to verify on-disk state. Instead, its "write produces a file on disk at the resolved path" test (`conformance.test.ts:589-614`) calls `f.adapter.write(...)` then `f.adapter.update(...)` and asserts `upd.ok === true`. It never calls `fs.readFile` on the written path. The smoking gun is at line 631-632: `void fs; void tmpdir;` — imports retained but deliberately unused. The block's own comment at line 605-606 admits: *"Just verify SOMETHING was written by re-checking via the adapter facade's own update() not-found probe inverted."*

This test would pass even if `ObsidianFsDelivery.write()` returned `ok:true` without touching the filesystem at all (as long as the in-memory state machine was self-consistent for the subsequent `update()`).

**Prior assessment CONFIRMED, with stronger evidence than the original wording.**

**H2 — CR-03 cross-platform claim is not actually tested cross-platform.**

`02-VERIFICATION.md` marks CR-03 (Windows path-separator divergence) closed. The supporting tests in `src/adapters/delivery/obsidian-fs/path.test.ts` inject literal backslash strings (`joinVaultPathPosix("_memory\\sub", "foo.md")`, line 82) and assert no backslashes in output. Zero tests stub `process.platform === "win32"` or import `path.win32`. Grep across all 69 test files: zero matches for `process.platform`, `path.win32`, or `win32`.

What's verified: *"If a string with `\` lands at the comparison helper, it gets normalized."*
What's NOT verified: *"On Windows, the FS-bound helpers actually produce backslash output that consumers then route through the new comparison-bound helpers."* The audit path (SQL prefix lookups in `src/db/queries/audit.ts` / `notes.ts`) was not audited for whether it routes through the new helpers — the gap-closure plan 02-11 SUMMARY explicitly notes "Consumer audit confirms every existing call site is FS-bound (correct)" but adds no callers and no integration test of the audit→Guards path on Windows-shaped inputs.

**CR-03 closure is logical, not empirical.** A real Windows CI run or a unit test with `process.platform` stubbed would close it.

### MEDIUM

**M1 — Retrieval quality is unproven across the entire suite.**

`evals/v1-baseline/baseline.test.ts:139-141` contains the suite's **only** `it.todo`, and it is exactly the precision/recall floor that defines retrieval quality:

```typescript
it.todo("achieves >= 0.8 precision and >= 0.8 recall vs expected_doc_ids");
```

The surrounding baseline tests verify fixture shape (queries reference real files, tool inputs validate) but never assert that hybrid search returns the right notes. `recall.test.ts` (memory recall tool) tests the filter/sort pipeline against hand-built `SearchHit` stubs, not retrieval quality on real fixtures.

**Implication for the 884-test count:** Of the project's two AI-quality claims (semantic retrieval; memory recall over fixtures), zero have a passing quality floor. The eval suite passes by virtue of `it.todo` not being a failure.

**Prior assessment CONFIRMED.** This is "incomplete future work," honestly marked, but worth tracking against the explicit D-14 precision/recall target in CONTEXT.

**M2 — WR-08 audit-flag derivation: prior assessment partially right.**

Of the 5 WR-08 tests in `src/adapters/delivery/obsidian-fs/index.test.ts` (lines 277-489):

| Test | What it asserts | Evidence |
|---|---|---|
| write into sink (L333) | `audit row.is_memory_sink_write === 1` | ✓ Asserts the flag |
| update inside sink (L361) | `audit row.is_memory_sink_write === 1` | ✓ Asserts the flag |
| write outside sink (L432) | `audit row.is_memory_sink_write === 0` | ✓ Asserts the flag |
| no registry → fallback false (L459) | `audit row.is_memory_sink_write === 0` | ✓ Asserts the flag |
| **delete inside sink (L396)** | `result.reason === 'sink_write_blocked'` | ✗ Asserts refusal, NOT the flag |

The delete test's own comment (line 401-405) is admirably honest: *"A delete that resolves into a sink is refused with sink_write_blocked BEFORE the audit row is written... the resulting audit row count is zero on this path."*

That's correct behavior, but the test's name (`delete(): is_memory_sink_write flag is derived from findSinkContaining(id) (refused upstream...)`) overclaims by structure: the test cannot fail in a way that surfaces a regression of the flag-derivation logic, because the flag never gets derived. A consumer reading the test name would believe the derivation symmetry is regression-protected; it isn't.

**Prior assessment partially confirmed.** 4 of 5 WR-08 tests are honest; 1 is a name-only assertion.

**M3 — Parser → `pathInSink` composition has no regression test.**

`src/memory/sink.test.ts` rigorously exercises `parseMemorySinkHandle` against malicious inputs (`default:../escape`, NFC/NFD variants, etc.). All assertions are at the parser layer. CR-01's safety claim, however, is *compositional*: "`pathInSink` is now safe-by-construction because the parser refuses any traversal-shaped input at config load time" (02-09 SUMMARY).

There is no test that pipes each of the 6+ adversarial parser inputs through `pathInSink` and asserts the resulting absolute path stays inside the vault. A future refactor that loosens `SEGMENT_PATTERN` (or adds a code path that constructs a `MemorySink` without going through the parser) would not break any existing test, despite breaking the safety invariant.

**Acceptable for now** — the parser is the only documented sink-handle entry point — but the regression guard is structural, not behavioral.

### LOW / INFO

**L1 — Surface tests are minimal, not a real concern.** Grep for `toBeDefined\b` returns 17 hits; spot-reading shows most are mid-assertion existence guards (`expect(result.someField).toBeDefined(); expect(result.someField.value).toBe(...)`), not standalone "thing exists" tests. The handful of true smoke tests in `src/tool-registry.test.ts:11-41` (tool count, schema present) are honest sanity checks for the v1 API surface. **Prior assessment overstated this concern.**

**I1 — `record-observation.test.ts:178-235` is the strongest safety test in Phase 2.** The WR-07 adversarial loop parameterizes over all 8 protected provenance keys, writes real files, reads them back via `fs.readFile + gray-matter`, and asserts the caller's bogus override (e.g. `source: "user"` instead of agent-sugar `"agent"`) did not survive to the on-disk frontmatter. This pattern — adversarial input + on-disk verification — is what H1 should have looked like. **The prior assessment under-credited this test.**

**I2 — `it.skip` count = 1, `it.todo` count = 1.** The skip is a capability-gated ONNX reranker test (honest — runs when reranker is installed). The todo is M1. No hidden deferred coverage.

---

## Prior Assessment Verdict Table

| Claim | Verdict | Evidence |
|---|---|---|
| `src/memory/sink.test.ts` meaningful | **Confirmed** (parser layer only — M3 caveat) | Rigorous adversarial inputs, but no `pathInSink` composition test |
| `src/memory/validator.test.ts` meaningful | **Confirmed** | Tests both the pure validator and the chokepoint integration |
| `record-observation.test.ts` meaningful | **Confirmed + under-credited** (see I1) | Parameterized adversarial WR-07 test reads real disk |
| `supersede.test.ts` meaningful | **Confirmed** | Round-trip + audit assertions |
| `recall.test.ts` meaningful | **Partially** | Pipeline-correctness only; doesn't test retrieval quality (M1) |
| `baseline.test.ts` proves shape not quality | **Confirmed** | The `it.todo` IS the quality floor (M1) |
| `conformance.test.ts` filesystem invariant overclaims | **Confirmed strongly** | H1 — actually calls `update()`, not `fs.readFile` |
| WR-08 delete test only proves `sink_write_blocked` | **Confirmed** for delete (M2); 4/5 WR-08 tests do assert the flag |
| Tests are smoke / "tool exists" | **Overstated** | ~4 honest sanity checks in tool-registry; not a systemic issue |

---

## Bad test vs incomplete future work vs acceptable smoke

| Category | Examples |
|---|---|
| **Bad test** (asserts wrong thing, or its name overclaims) | H1 (filesystem invariant via adapter), M2 delete case |
| **Incomplete future work** (honest gap) | M1 (`it.todo` for precision/recall), M3 (parser→pathInSink composition) |
| **Logical-only verification of cross-platform claim** | H2 (CR-03 closed without Windows simulation) |
| **Acceptable smoke** | tool-registry.test.ts:11-41 (tool count, schema present) |
| **Strong test (exemplar)** | record-observation.test.ts:178-235 (WR-07 adversarial loop) |

---

## Would I trust 884 green as evidence the safety invariant holds?

**No — partially.** The 884-test count is strong evidence for:

- Parser refuses malicious sink handles in isolation (CR-01 ✓)
- Validator returns correct `GuardFailure` codes at the function level (CR-02 ✓ at function layer)
- `record_observation` round-trips correctly to disk with provenance preserved, including adversarial overrides (WR-07 ✓ — gold standard)
- v1 tool surface byte-identical (regression guard for the existing 23 tools)
- Audit flag derivation for write/update on POSIX (4/5 WR-08 cases)

It is **not** evidence for:

- Cross-platform safety (H2 — no Windows simulation)
- Composition safety: parser → `pathInSink` → on-disk write (M3 — only the input boundary is tested)
- On-disk verification at the DeliveryAdapter layer (H1 — the "filesystem invariant" block doesn't read disk)
- Audit-row honesty on the bypass paths that *would* reach audit if Guards were defeated (M2 delete-case)
- Retrieval quality at any layer (M1)

---

## Recommended follow-up (minimum set)

These are small, surgical tests/edits — none rewrite Phase 2 work. File new quick tasks or fold into a Phase 8 polish:

1. **H1 fix** — `conformance.test.ts:589` block: add a sibling test `it("write produces a file on disk at the resolved path (disk-verified)", ...)` that calls `fs.readFile` on the resolved path and asserts non-zero bytes. Rename the existing test to honestly describe what it does ("write returns ok and is subsequently updatable").
2. **H2 fix** — `path.test.ts`: add one Windows-simulation test using `vi.stubGlobal` or direct `path.win32` import. Verify that `joinVaultPath` (the FS-bound helper) produces backslashes on Windows and that consumers (audit SQL, recall) route the result through `joinVaultPathPosix` / `vaultRelativeInSink` before comparison.
3. **M1 visibility** — `baseline.test.ts:139`: replace `it.todo` with `it.skipIf(!ollamaAvailable)("achieves >= 0.8 precision...", async () => { /* index fixtures + run hybrid */ })`. The skip count rising from 1 to 2 makes the gap surface honestly in `npm test` output instead of being invisible.
4. **M2 fix** — `obsidian-fs/index.test.ts:396`: split the test into (a) the refusal assertion (current behavior) and (b) a hand-constructed bypass scenario (e.g., direct `auditAdapter.recordWrite` call with `findSinkContaining`-derived flag) that asserts the derivation logic in isolation, so a future regression to the flag function fails.
5. **M3 fix** — `sink.test.ts`: add a single composition `describe` block that, for each adversarial parser input, asserts `pathInSink(vault, handle, "x.md")` either throws or returns a path inside `vault`. Currently the parser tests stop at "parse failed"; this would close the compositional loop.
6. **Phase 3 prerequisite** — implement the deferred precision/recall harness from M1 before adding the bundles/authority/staleness scoring functions; otherwise Phase 3's "compiled brief beats the 85%-rediscovery failure mode" claim has no measurement.

---

## Notes for the maintainer

- The `npm test` execution issue under Node v26 (better-sqlite3@11.10.0 native ABI mismatch) was **not** investigated in this audit — agent was instructed to ignore pass/fail. But: when you fix it, also pin Node version in `package.json` `engines` (currently `>=22`) to match the better-sqlite3 ABI you're shipping against; otherwise this recurs on the next Node major.
- The audit was done at HEAD `f30bb82` on **main**, not pushed. 259 commits ahead of `origin/main`.
- 02-VERIFICATION.md `status: passed` is defensible for the in-scope safety claims at the **POSIX, function-layer, adversarial-input** level. The "cross-platform" wording in CR-03 closure and the "filesystem invariants" wording in `conformance.test.ts:588` are the two places where the report overclaims relative to test evidence.
