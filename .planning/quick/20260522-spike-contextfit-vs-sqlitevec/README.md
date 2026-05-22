# Spike: contextfit vs. sqlite-vec — Retrieval-Backend A/B-Vergleich

**Datum:** 2026-05-22
**Status:** offen — wartet auf lokalen Lauf + manuelle Bewertung

## Spike-Frage

Ist [contextfit](https://github.com/ContextFit/cf) (token-native, embedding-frei,
Python) ein praktikables alternatives Retrieval-Backend zu unserem heutigen
sqlite-vec + Ollama-BGE-M3-Stack — **gemessen am echten User-Vault "Intelligence
Impact"** und an realen Mischsprachen-Anfragen (DE/EN)?

Der Spike entscheidet:

1. **Recall-Achse:** Findet contextfit die "richtigen" Notizen für vage
   Agent-Memory-Anfragen, bei denen Embeddings normalerweise dem BM25 voraus
   sind?
2. **Sprach-Achse:** Wie deutlich verliert contextfit (kein Embedding) bei
   DE-Paraphrasen englischer Anfragen oder umgekehrt?
3. **Cost-Achse:** Ingest-Zeit, Storage-Footprint, Query-Latenz, RAM-Peak.
4. **Operationale Achse:** Wie umständlich ist Setup und Live-Reindex
   verglichen mit unserem heutigen chokidar+OCC-Pfad?

Der Spike **modifiziert keinen Production-Code in `src/`**. Beide Backends
laufen unabhängig in einem temporären Sandbox-`$HOME`.

## Was der Spike NICHT entscheidet

- Endgültige Architektur der `RetrievalBackend`-Naht (kommt erst nach
  positivem Spike, in einem ADR-008).
- Plugin-UI-Integration (Setting für Backend-Wahl).
- Mehrvault-Verhalten — der Spike läuft single-vault.

## Voraussetzungen (auf deinem Mac)

```bash
# 1. vault-memory gebaut
npm install && npm run build

# 2. Ollama läuft + BGE-M3 (oder konfiguriertes) Modell vorhanden
ollama serve &
ollama list | grep -E "bge-m3|qwen3"   # mindestens eins davon

# 3. Python 3.10+ und contextfit installiert
python3 --version    # >=3.10
pip install contextfit
contextfit --help    # erscheint? gut.

# 4. Vault-Pfad verfügbar
ls "/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact" | head
```

## Ausführung — drei Phasen

### Phase A: Setup + Ingest beider Backends (~3-15 Min, je nach Vault-Größe)

```bash
cd .planning/quick/20260522-spike-contextfit-vs-sqlitevec
./run.sh setup
```

Das Skript:
- Legt eine temporäre Sandbox unter `$TMPDIR/vm-spike-XXXXX/` an
- Schreibt eine isolierte `config.toml`, die nur den Spike-Vault sieht
- Indexiert den Vault mit `vault-memory index` (sqlite-vec + Ollama)
- Indexiert denselben Vault mit `contextfit ingest` (contextfit_kb in der Sandbox)
- Misst Wallclock + Peak-RAM + Storage-Footprint pro Backend
- Schreibt `results/setup-metrics.json`

### Phase B: Queries gegen beide Backends (~1-3 Min)

```bash
./run.sh query
```

Liest `queries.yaml`, führt jede Query gegen beide Backends aus, sammelt:
- Top-10 Treffer (Pfad, Score, optional Snippet)
- Query-Latenz pro Backend (3 Wiederholungen, P50)

Output: `results/contextfit-raw.json`, `results/sqlite-vec-raw.json`,
`results/query-metrics.json`.

Anschließend wird `results/report.md` gerendert — eine Markdown-Datei mit
Side-by-Side-Tabellen pro Query und Bewertungs-Checkboxen.

### Phase C: Manuelle Bewertung + Aggregation (~30-45 Min)

Öffne `results/report.md`. Pro Query:

1. Lies die Frage.
2. Schau dir die Top-5-Treffer pro Backend an (Pfade).
3. Setze pro Treffer `[x]` (relevant), `[~]` (teilweise/tangential) oder
   `[ ]` (irrelevant).

Wenn fertig:

```bash
./run.sh aggregate
```

Parst die Checkboxen, berechnet Recall@5 / MRR / Precision@5 pro Backend
und pro Sprache (EN/DE), schreibt `results/metrics.md`.

## Querystruktur in `queries.yaml`

```yaml
queries:
  - id: q01
    lang: en
    text: "What did I decide about <topic>?"
    intent: decision_lookup
    notes: "Tests retrieval of decision-type notes"

  - id: q02
    lang: de
    text: "Was habe ich zu <thema> entschieden?"
    intent: decision_lookup
    adversarial_for: q01
    notes: "DE paraphrase — same intent, different vocab"
```

Die Default-Queries sind **themen-agnostisch**: sie funktionieren in
prinzipiell jedem Knowledge-Vault. Es gibt einen Slot am Ende der YAML
für 3-5 **vault-spezifische Queries** mit bekannter Ground-Truth — die
gibst du selbst ein (siehe Kommentare in `queries.yaml`).

## Reproduzierbarkeit

`run.sh` setzt `RANDOM_SEED=42` für beide Backends, soweit konfigurierbar.
Identische Outputs zwischen zwei Läufen sind nicht garantiert
(contextfit lernt SID-Generator stochastisch), aber Top-K-Listen sollten
sehr stabil sein.

## Aufräumen

```bash
./run.sh clean   # löscht den temp-$HOME und results/
```

Der Production-Vault wird nie geschrieben (Read-only-Ingest in beiden
Pfaden).

## Bekannte Spike-Limitierungen

- **Single-Vault.** Multi-Vault-Verhalten wird nicht getestet.
- **Manuelle Bewertung.** Recall/MRR-Zahlen sind vom Bewertenden abhängig.
  Für die Spike-Entscheidung ausreichend; eine vollwertige Eval-Suite
  käme erst nach ADR-008.
- **Keine Cross-Encoder-Reranker-Spalte.** Der ONNX-bge-Reranker hat in
  contextfit kein Äquivalent. Sqlite-vec läuft im Spike **ohne**
  Reranker, damit der Vergleich fair RRF-vs-token-native bleibt.
  Reranker-Effekt wird separat in einem Annex gemessen (`./run.sh query --with-reranker`).
- **Keine Live-Updates.** Watcher/chokidar wird nicht getestet — nur
  cold-start Ingest. Live-Update-Story wird im Spike-Summary qualitativ
  diskutiert.

## Erfolgs-/Misserfolgskriterien für die Spike-Entscheidung

Nach Abschluss schreibe SUMMARY.md mit Verdict in einer der drei Kategorien:

- **GO**: contextfit erreicht ≥ 90 % der Recall@5 des sqlite-vec-Backends
  *und* DE-Adversarial-Recall@5 ≥ 70 % von sqlite-vec, *bei* ≥ 5× besserer
  P50-Latenz oder ≥ 50 % geringerem Storage. ADR-008 + `RetrievalBackend`
  Naht werden in einem v2.1-Mini-Milestone aufgesetzt.
- **NO-GO**: contextfit erreicht < 70 % Recall@5 auf EN oder < 50 %
  Recall@5 auf DE-Adversarials. Spike geschlossen, keine Naht eingezogen.
- **DEFER**: Werte dazwischen. SUMMARY listet konkrete Folge-Fragen
  (z.B. "wirkt die contextfit-`SemanticExpander`-Option als Brücke?"),
  Entscheidung wandert in `.planning/STATE.md` Blockers/Concerns.
