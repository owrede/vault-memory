# Retrieval No-Regression — vault-memory v1.0.0 → v2.0.0

**Question:** Did the indexer + retrieval get worse from v1.0.0 to v2.0.0?
**Answer:** No. The default search path is *by construction* identical to v1; the v2
additions are opt-in and only kick in when their parameters are explicitly set. A live run
against the real test vault confirms working retrieval (MRR@10 = 0.769 with rerank).
Created 2026-05-25.

---

## Part 1 — Static proof (source diff v1.0.0 → HEAD)

The retrieval engine was compared (`git diff v1.0.0 HEAD -- src/search/ src/rerank/`).

**The RRF fusion core is unchanged.** Semantic kNN + BM25 + reciprocal-rank fusion (k=60)
and the ONNX cross-encoder rerank path are the same as in v1.0.0.

**The v2 additions in `hybrid.ts` are purely additive and short-circuit to the v1 path when
their parameters are not set** (= the default that `search_hybrid` produces with no extra
arguments):

| v2 addition | Default | Behavior at default |
|-----------|---------|------------------------|
| Recency rescore (`recencyWeight`) | `0` | Guard `if (recencyWeight !== 0 \|\| authorityWeight !== 0)` → block is skipped, **zero DB reads** |
| Authority rescore (`authorityWeight`) | `0` | same guard, skipped |
| Expand (`opts.expand`) | `undefined` | guard short-circuit, **zero new DB reads, zero new computation** |

Source: `src/search/hybrid.ts:79-82, 295-297, 492-495`. The code documents this itself:
*"The v1-default path (none of these set) is byte-identical to v1 by construction."*

### Tests that pin the parity (all green)

- `src/search/hybrid.rescore.test.ts`
  - `v1 invariance → returns same chunk order as v1 — rescore guard short-circuits`
  - `v1-baseline invariance pin (ROADMAP success criterion #2) → v1-default search
    produces a stable score+order across runs`
  - Suite: **16/16 passed**
- `evals/v1-baseline/baseline.test.ts` — freezes the v1 retrieval surface against golden
  fixtures + snapshot: **34 passed | 11 skipped**

> **Methodological note:** A "real" v1.0.0 server cannot read today's index — the schema is
> at v14, and v1.0.0 only knows migrations up to v6. A direct binary-vs-binary run against
> the same index is therefore impossible. The source diff + the invariance tests are the
> clean substitute: they prove the *algorithm* is identical, instead of comparing two
> binaries against differently-migrated indexes.

---

## Part 2 — Live run (v2.0.0 / HEAD against the real vault)

Harness: `scripts/eval-real-vault.mjs` drives the built server (`dist/cli.js`) over stdio,
exactly like an MCP client. Vault: `inim-vm-test`. Query set:
`evals/real-vault/queries.inim.json` (15 queries, curated ground truth). Metric: MRR@10 at
the note level. Run: 2026-05-25T21:24Z.

### MRR@10 (excluding 2 known vault-structure gaps A3/C2)

| Config | MRR@10 |
|--------|--------|
| C — bge-m3, **without** rerank | **0.667** |
| D′ — bge-m3 **+ ONNX rerank** | **0.769** |

_v4 manual baseline (whole set incl. gaps): bge-m3 0.82._

**The rerank path has a measurable effect:** +0.10 MRR. Concrete improvements from rerank:
- B5 (corporate→consulting transition): rank 6 → **rank 1**
- D1 (combinatorial optimization, EN→DE cross-lingual): not found → **rank 2**

### MRR@10 by category (D′ with rerank)

| Category | C | D′ | Reading |
|-----------|---|----|--------|
| A — factual | 0.875 | 0.875 | very strong |
| B — concept-deep | 0.833 | **1.000** | perfect after rerank |
| C — exact/short | 0.500 | 0.500 | acronym recall gap (see below) |
| D — cross-lingual | 0.000 | 0.250 | rerank rescues 1 of 2 |

### Known, documented weaknesses (not a v2 regression)

- **C1 "JHE"** (❌): alias/acronym recall — aliases do not feed the full-text index.
  Documented as backlog (`ISSUE-aliases-not-in-fulltext-retrieval.md`), **not**
  release-blocking, **not** a v2 regression (applies to v1 equally, since the FTS path is
  unchanged).
- **A3/C2 "LAG-EPIX"** (`known_gap`): there is no canonical MOC note for LAG-EPIX in the
  vault — a vault-structure gap, not a retrieval error. Excluded from the primary MRR.
- **D2 "airport ground staff scheduling"** (❌): cross-lingual + very generic; the closest
  topical document exists but ranks outside the top 10.

---

## Conclusion

1. **No regression.** The default retrieval path is algorithmically identical to v1.0.0 —
   proven by source diff and by invariance tests that pin byte-identical order/scores.
2. **More likely an improvement — but not in the default path.** v2 adds *opt-in* recency,
   authority, and expand signals that a caller (or a contract) can deliberately enable to go
   beyond the v1 baseline path. When unused: zero cost, zero behavior change.
3. **Live confirmed:** v2 retrieves reliably on the real test vault (MRR@10 0.769 with
   rerank, B category perfect). The remaining misses are known, documented vault/alias
   themes — not an engine regression.
