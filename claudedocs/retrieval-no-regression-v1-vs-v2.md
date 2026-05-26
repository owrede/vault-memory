# Retrieval No-Regression — vault-memory v1.0.0 → v2.0.0

**Frage:** Hat sich Indexer + Retrieval von v1.0.0 zu v2.0.0 verschlechtert?
**Antwort:** Nein. Der Default-Suchpfad ist *by construction* identisch mit v1; die
v2-Zusätze sind opt-in und greifen nur bei explizit gesetzten Parametern. Live-Lauf
gegen den realen Test-Vault bestätigt funktionierendes Retrieval (MRR@10 = 0.769 mit
Rerank). Erstellt 2026-05-25.

---

## Teil 1 — Statischer Beweis (Quell-Diff v1.0.0 → HEAD)

Verglichen wurde die Retrieval-Engine (`git diff v1.0.0 HEAD -- src/search/ src/rerank/`).

**Der RRF-Fusionskern ist unverändert.** Semantic-kNN + BM25 + Reciprocal-Rank-Fusion
(k=60) und der ONNX-Cross-Encoder-Rerank-Pfad sind dieselben wie in v1.0.0.

**Die v2-Ergänzungen in `hybrid.ts` sind rein additiv und short-circuiten auf den
v1-Pfad, wenn ihre Parameter nicht gesetzt sind** (= der Default, den `search_hybrid`
ohne Extra-Argumente erzeugt):

| v2-Zusatz | Default | Verhalten bei Default |
|-----------|---------|------------------------|
| Recency-Rescore (`recencyWeight`) | `0` | Guard `if (recencyWeight !== 0 \|\| authorityWeight !== 0)` → Block wird übersprungen, **null DB-Reads** |
| Authority-Rescore (`authorityWeight`) | `0` | gleicher Guard, übersprungen |
| Expand (`opts.expand`) | `undefined` | Guard short-circuit, **null neue DB-Reads, null neue Berechnung** |

Quelle: `src/search/hybrid.ts:79-82, 295-297, 492-495`. Der Code dokumentiert dies
selbst: *"The v1-default path (none of these set) is byte-identical to v1 by
construction."*

### Tests, die die Parität festnageln (alle grün)

- `src/search/hybrid.rescore.test.ts`
  - `v1 invariance → returns same chunk order as v1 — rescore guard short-circuits`
  - `v1-baseline invariance pin (ROADMAP success criterion #2) → v1-default search
    produces a stable score+order across runs`
  - Suite: **16/16 passed**
- `evals/v1-baseline/baseline.test.ts` — friert die v1-Retrieval-Oberfläche gegen
  Golden-Fixtures + Snapshot ein: **34 passed | 11 skipped**

> **Methodischer Hinweis:** Ein „echter" v1.0.0-Server kann den heutigen Index nicht
> lesen — Schema steht auf v14, v1.0.0 kennt nur Migrationen bis v6. Ein direkter
> Binary-vs-Binary-Lauf auf demselben Index ist daher nicht möglich. Der Quell-Diff +
> die Invarianz-Tests sind der saubere Ersatz: sie beweisen, dass der *Algorithmus*
> identisch ist, statt zwei Binaries gegen unterschiedlich migrierte Indizes zu
> vergleichen.

---

## Teil 2 — Live-Lauf (v2.0.0 / HEAD gegen realen Vault)

Harness: `scripts/eval-real-vault.mjs` treibt den gebauten Server (`dist/cli.js`) über
stdio, exakt wie ein MCP-Client. Vault: `inim-vm-test`. Query-Set:
`evals/real-vault/queries.inim.json` (15 Queries, kuratierte Ground-Truth). Metrik:
MRR@10 auf Notiz-Ebene. Lauf: 2026-05-25T21:24Z.

### MRR@10 (ohne 2 bekannte Vault-Struktur-Lücken A3/C2)

| Config | MRR@10 |
|--------|--------|
| C — bge-m3, **ohne** Rerank | **0.667** |
| D′ — bge-m3 **+ ONNX-Rerank** | **0.769** |

_v4-Handbaseline (ganzes Set inkl. Lücken): bge-m3 0.82._

**Der Rerank-Pfad wirkt nachweisbar:** +0.10 MRR. Konkrete Verbesserungen durch Rerank:
- B5 (Konzern→Beratung-Übergang): Rang 6 → **Rang 1**
- D1 (combinatorial optimization, EN→DE cross-lingual): nicht gefunden → **Rang 2**

### MRR@10 nach Kategorie (D′ mit Rerank)

| Kategorie | C | D′ | Lesart |
|-----------|---|----|--------|
| A — faktisch | 0.875 | 0.875 | sehr stark |
| B — konzeptuell-tief | 0.833 | **1.000** | perfekt nach Rerank |
| C — exakt/kurz | 0.500 | 0.500 | Akronym-Recall-Lücke (s.u.) |
| D — cross-lingual | 0.000 | 0.250 | Rerank rettet 1 von 2 |

### Bekannte, dokumentierte Schwächen (kein v2-Regress)

- **C1 „JHE"** (❌): Alias-/Akronym-Recall — Aliases fließen nicht in den
  Volltext-Index. Dokumentiert als Backlog
  (`ISSUE-aliases-not-in-fulltext-retrieval.md`), **nicht** Release-blockierend, **kein**
  v2-Regress (gilt für v1 genauso, da FTS-Pfad unverändert).
- **A3/C2 „LAG-EPIX"** (`known_gap`): Es existiert keine kanonische MOC-Notiz für
  LAG-EPIX im Vault — eine Vault-Struktur-Lücke, kein Retrieval-Fehler. Aus der
  Primär-MRR ausgeschlossen.
- **D2 „airport ground staff scheduling"** (❌): cross-lingual + sehr generisch; das
  thematisch nächste Dokument existiert, rankt aber außerhalb Top-10.

---

## Fazit

1. **Keine Verschlechterung.** Der Default-Retrieval-Pfad ist algorithmisch identisch
   mit v1.0.0 — bewiesen per Quell-Diff und per Invarianz-Tests, die byte-identische
   Reihenfolge/Scores festnageln.
2. **Eher Verbesserung — aber nicht im Default-Pfad.** v2 fügt *opt-in* Recency-,
   Authority- und Expand-Signale hinzu, die ein Caller (oder ein Contract) bewusst
   aktivieren kann, um über den v1-Baseline-Pfad hinauszugehen. Bei Nicht-Nutzung: null
   Kosten, null Verhaltensänderung.
3. **Live bestätigt:** v2 findet auf dem realen Test-Vault zuverlässig (MRR@10 0.769 mit
   Rerank, B-Kategorie perfekt). Die verbliebenen Misses sind bekannte, dokumentierte
   Vault-/Alias-Themen — keine Engine-Regression.
