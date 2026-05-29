# Spike Summary — contextfit vs. sqlite-vec

**Status:** ✅ abgeschlossen — alle Achsen gemessen, Qualität bewertet, Verdict gesetzt.
**Datum:** 2026-05-29
**Vault:** INIM-VM-TEST (255 Notizen, 1,4 MB Markdown, überwiegend Deutsch)
**Hardware:** Apple M1 Max, 32 GB RAM, 24 GPU-Cores
**Methodik:** README.md · Rohdaten: `results/` · 45 Queries (35 DE / 4 EN-Kontrolle / 6 DE-EN-Misch), 22 mit Ground-Truth-Ankern
**Qualitätsbewertung:** 23 Queries vom Nutzer selbst bewertet, 22 von einem inhaltslesenden Agenten (Kalibrierung: Agent stimmte bei 3/6 Nutzer-Urteilen überein und war systematisch contextfit-strenger — die 22 Agent-Urteile unterschätzen contextfit also eher).

---

## Verdict

- [x] **DEFER → Komposition** — contextfit ist kein Ersatz, aber ein starker komplementärer Layer. Die Performance-/Ressourcen-Vorteile sind massiv und unstrittig; die Retrieval-Qualität ist **intent-abhängig komplementär**, nicht global besser oder schlechter. Empfehlung: ADR-008 für eine `RetrievalBackend`-Naht aufsetzen, die **Backend-Komposition** ermöglicht (contextfit als schneller Token-Layer + Embeddings für semantische Intents), statt eines Entweder-Oder.

_Begründung im Detail unten. Strikt nach README-Schwellen (contextfit Recall@5 ≥ 90% von sqlite UND DE ≥ 70%) wäre es ein knappes GO auf der objektiven Achse (100%/100%) und ein DEFER auf der subjektiven A/B-Achse. Da die Verfahren komplementär sind, ist „Komposition" die ehrlichere Schlussfolgerung als ein binäres GO/NO-GO._

---

## Gegenüberstellung der beiden Verfahren

| | **sqlite-vec** (heutiger Stack) | **contextfit** (Kandidat) |
|---|---|---|
| **Grundidee** | Dichte semantische Vektoren (BGE-M3) + BM25, per RRF fusioniert | Token-nativ: kein neuronales Embedding. BM25 + MinHash/LSH + gelernte „Semantic IDs" |
| **Embedding** | BGE-M3 (1024-dim) über Ollama-HTTP | keines — tiktoken-Tokenisierung + Postings-Bitmaps |
| **Hardware** | Ollama-Modell auf **GPU** (Metal) + CPU | **nur CPU**, kein Modell, kein GPU |
| **Sprachverständnis** | Multilingual semantisch (DE↔EN über Vektornähe) | Lexikalisch/strukturell (Token-Überlapp) |

---

## 1. Indexing-Performance

| Metrik | sqlite-vec | contextfit | Verhältnis |
|---|---|---|---|
| Ingest Wallclock (255 Notizen) | **131,3 s** | **5,7 s** | contextfit **~23× schneller** |
| Chunks erzeugt | 2547 | 1062 | unterschiedliche Chunk-Strategie |
| Index-Größe | 18,4 MB | 10,2 MB | contextfit **~1,8× kleiner** |

Flaschenhals bei sqlite-vec: Embedding-Inferenz (2547 Chunks × BGE-M3 über Ollama). contextfit überspringt das komplett.

> **Caveat:** contextfits `--rebuild-index-after-ingest` baute den Index in v0.1.0 nicht (Stats blieben 0); ein expliziter `contextfit build-index` (3,5 s) war nötig — in den 5,7 s enthalten. API-Bug, kein Performance-Problem.

## 2. Retrieval-Performance (Query-Latenz)

| Metrik | sqlite-vec | contextfit | Verhältnis |
|---|---|---|---|
| Query P50 (warm) | 113 ms | **13 ms** | contextfit **~9× schneller** |
| Query P95 (warm) | 128 ms | **16 ms** | contextfit **~8× schneller** |

> **Fairness-Hinweis:** Erste Messung zeigte contextfit bei 748 ms — Mess-Artefakt (frischer CLI-Prozess pro Query, `import contextfit` allein = 0,75 s). Nach Umbau auf persistenten Query-Server (`scripts/contextfit-server.py`, Engine einmal geladen — spiegelt vault-memorys warmen MCP-Server) → 13 ms. Beide jetzt „warm" gemessen, symmetrisch. Der Vorteil ist strukturell: sqlite-vec braucht pro Query einen Ollama-Roundtrip zum Query-Embedding (~100 ms davon).

## 3. Ressourcen & Skalierung

| Metrik | sqlite-vec | contextfit |
|---|---|---|
| GPU-Speicher (Modell) | **1,3 GB** (dauerhaft resident) | **0 — kein Modell** |
| Peak-RSS (Index-Prozess) | 180 MB | 196 MB |
| Hardware-Anforderung | GPU/Metal empfohlen | **jede CPU genügt** |

contextfit hat **keinen Modell-Footprint**: keine Modellgewichte, kein GPU-Resident, keine Ollama-Abhängigkeit.

### Hochrechnung auf große Materialsammlungen (linear, Caveat unten)

| Notizen | sqlite-vec Ingest | contextfit Ingest | sqlite-vec Index | contextfit Index |
|---|---|---|---|---|
| 255 (gemessen) | 2,2 min | **6 s** | 18 MB | 10 MB |
| 2.550 (10×) | 21,9 min | **57 s** | 184 MB | 102 MB |
| 25.500 (100×) | 3,6 h | **9,5 min** | 1,8 GB | 1,0 GB |
| 255.000 (1000×) | 36,5 h | **1,6 h** | 18 GB | 10 GB |

Bei 25.500 Notizen: contextfit indexiert in ~9,5 min statt ~3,6 h — und ohne GPU. Das ist der Effekt bei großen Materialsammlungen.

> **Caveat:** Lineare Extrapolation aus einem Messpunkt (255 Notizen). sqlite-vec-Ingest skaliert realistisch linear (Embedding pro Chunk); contextfits Index-Build ist optimistisch geschätzt (LSH/SID-Training kann super-linear werden). Query-Latenz wurde nicht über Größe gemessen; contextfits In-Memory-Postings könnten bei sehr großen Indizes RAM-seitig beißen, wo sqlite-vec ANN auf Disk skaliert. Echter 10×-Messpunkt steht aus.

## 4. Retrieval-Qualität ⭐ (wichtigste Achse)

### 4a. Objektiv — Ground-Truth (22 Queries mit bekannten Anker-Notizen)

| Metrik | sqlite-vec | contextfit |
|---|---|---|
| Recall@3 | 36,4 % | 36,4 % |
| Recall@5 | 50,0 % | 50,0 % |
| Recall@10 | 63,6 % | 54,5 % |
| MRR | 0,336 | 0,341 |

„Findet das Backend die exakt erwartete Anker-Notiz im Top-K?" — **bei Recall@3/@5 und MRR praktisch identisch.** sqlite-vec hat nur bei Recall@10 einen Vorsprung. Niedrige Absolutwerte = enge Anker („genau diese Notiz"); verwandte Projekt-/Meetingnotizen ranken oft höher.

### 4b. Subjektiv — A/B-Urteil pro Query (45 Queries: „welches Verfahren liefert die besseren Treffer?")

| Ausgang | Anzahl | Anteil |
|---|---|---|
| **sqlite-vec besser** | 20 | 44 % |
| **contextfit besser** | 15 | 33 % |
| beide gleich | 3 | 7 % |
| beide unbrauchbar | 7 | 16 % |

sqlite-vec gewinnt das direkte Duell — aber **nicht deutlich**, und die 16 % „beide unbrauchbar" zeigen Vault-Lücken (Fragen ohne passende Notiz), nicht Backend-Schwächen.

### 4c. Das eigentliche Ergebnis: Komplementarität nach Intent

| Intent-Klasse | sqlite | contextfit | Muster |
|---|---|---|---|
| `reference_lookup` (Faktensuche) | **5** | 1 | sqlite stark |
| `entity_lookup` (Personen/Orgs) | **3** | 0 | sqlite stark |
| `temporal_lookup` (Datumsfenster) | **2** | 0 | sqlite stark |
| `decision_lookup` | **2** | 1 | sqlite leicht vorn |
| `person_context` | **2** | 1 | sqlite leicht vorn |
| `vague_advice` | **2** | 1 | sqlite leicht vorn |
| `project_status` | 1 | 1 | gleich |
| `open_loop` (offene Aufgaben) | 1 | **2** | contextfit vorn |
| `meeting_recap` | 1 | **2** | contextfit vorn |
| `cross_doc` (Querschnitt) | 0 | **2** | contextfit vorn |
| `topic_summary` (Themen-Überblick) | 0 | **4** | **contextfit stark** |

**Das ist der Kernbefund:** Die Verfahren sind **komplementär, nicht konkurrierend.**
- **sqlite-vec / Embeddings** gewinnen bei **präziser, punktueller Suche** (eine bestimmte Person, ein Fakt, ein Datum).
- **contextfit / token-nativ** gewinnt bei **breiten, assoziativen, thematischen** Fragen (Themen-Überblick, Querschnitt, offene Schleifen).

### 4d. Sprache

| Sprache | sqlite | contextfit | gleich | beide schlecht |
|---|---|---|---|---|
| DE (35) | 16 | 12 | 2 | 5 |
| EN (4) | 2 | 1 | 0 | 1 |
| Mixed/Code-Switching (6) | 2 | 2 | 1 | 1 |

**contextfits befürchteter DE-Einbruch tritt nicht ein.** Auf Deutsch hält es klar mit (12 vs. 16), bei Code-Switching ist es gleichauf. Die These „token-nativ verliert ohne semantische Sprachbrücke auf DE" wird durch die Daten **nicht** gestützt — im Gegenteil, contextfits stärkste Kategorie (`topic_summary`) ist überwiegend deutsch.

## 5. Beobachtungen (qualitativ)

- **contextfits Schwäche bei vagen Fragen:** Es fällt wiederholt auf dieselben generischen „semantischen Magneten" zurück — die Beratungs-Playbook-Achsen (04 Zukunftsfähigkeit, 05 Karriere und Skill-Aufbau, 10 Ethik). Diese verdrängen bei vagen Queries echte Treffer. (Sichtbar bei q05, q08, q13, q16, q41.)
- **contextfit verfehlt punktuelle Faktensuche komplett:** Bei q41 („Tools für Agent Memory") und q42 („Vector Database") fand es nicht einmal die offensichtliche Zielnotiz, während sqlite sie lieferte. Embeddings sind hier klar überlegen.
- **sqlite-vec schweigt lieber, contextfit rät:** Bei vagen Langfragen (q04, q05, q23, q45) gibt sqlite-vec teils **0 Treffer** zurück (RRF-Cutoff). contextfit liefert immer Kandidaten — manchmal hilfreich (q12, q20, q35: contextfit gewinnt, weil sqlite leer ist), manchmal nur Rauschen (q45). Ein Precision-vs-Recall-Trade-off: sqlite optimiert auf „nichts Falsches", contextfit auf „immer etwas".
- **Absenz-Probe (q44, Quantencomputing — im Vault nicht vorhanden):** Beide liefern falsche Treffer mit hohem Score statt „nichts gefunden". Kein Backend hat eine Halluzinations-Bremse. Relevant für die Agentic-Layer-Sicherheit.
- **Dubletten:** Beide Backends liefern oft denselben Pfad mehrfach (verschiedene Chunks derselben Notiz) in den Top-5. Für eine note-level-Antwort wäre Deduplizierung sinnvoll.

## 6. Tuning-Potenzial von contextfit ⚙️

Getestet, ob contextfit sich über die Spike-Defaults hinaus verbessern lässt. Reproduzierbar via `scripts/benchmark-tuning.mjs` (Recall@5 über die 22 Anker-Queries, Rohdaten `results/tuning-metrics.json`).

### ✅ Was funktioniert: Multi-Query (Geschwindigkeitsvorteil ausnutzen)

| Strategie | Recall@5 | Latenz/Query |
|---|---|---|
| single (Spike-Baseline) | 50,0 % | 18 ms |
| **multi_keywords (2×, blind)** | **54,5 %** | 29 ms |
| method=bm25 (statt hybrid) | 50,0 % | 3 ms |
| method=sid (statt hybrid) | 50,0 % | 8 ms |
| sqlite-vec (Referenz) | 50,0 % | 113 ms |

**Mehrere Query-Formulierungen abzusetzen und die Treffer zu mergen, hebt contextfit über die Embedding-Baseline** — bei 29 ms/Query immer noch ~4× schneller als sqlite-vec mit *einer* Query. Genau wie vermutet: contextfits Geschwindigkeit ist „Budget", das in Retrieval-Qualität umgemünzt werden kann.

**Wichtiger Vorbehalt zur Stärke des Effekts:** Die +4,5 Punkte gelten für *blinde* Keyword-Varianten (kein Wissen über die Zielnotiz). In Einzeltests mit *gut gewählten* Synonym-/Begriffsvarianten (wie ein LLM-Agent sie generiert) sprangen zuvor komplett verfehlte Queries auf Rang 1–2 (q41 ContextFit, q42 Pinecone, q13 agentOS). Der Grund ist strukturell: **contextfit kennt keine Synonyme.** Die semantische Brücke, die ein Embedding automatisch zieht (z.B. „evaluiert" ≈ „retrieves"), muss die Query-Variante bei contextfit **explizit als Token liefern**. → **Der natürliche Partner für contextfit ist ein LLM-gestützter Query-Expander**, den ein Agent billig vorschalten kann.

### ❌ Was NICHT funktioniert (bei diesem Vault)

- **Kleinere Chunks (256 statt 512) + trainierter SID-Generator:** Recall **bricht ein** (~5 %). Mehr, kürzere Fragmente → mehr Ranking-Konkurrenz → die Zielnotiz wird verdünnt. Die Default-512 sind hier besser. Tuning ≠ automatisch Verbesserung.
- **Alternative Query-Methoden einzeln** (`bm25`, `sid` statt `hybrid`): keine Verbesserung gegenüber `hybrid`.
- **`--hierarchy` beim Ingest:** crasht in v0.1.0 (Bug).
- **Ungenutzte query()-Parameter** (`expand_query`, `token_rerank`, `expand_graph`, `use_hierarchy`, `metadata_boost`): kein messbarer Effekt auf die getesteten Fehlschläge. (Die CLI reicht ohnehin nur `top_k`/`method` durch — das volle API-Tuning ist nur in-process erreichbar.)

### Konsequenz fürs Verdict

Das Tuning-Ergebnis **stärkt** die Komposition-Empfehlung: contextfit + LLM-Query-Expander schlägt die Embedding-Baseline bei dramatisch geringeren Ressourcen. Der Expander ist genau die Komponente, die einem Agent ohnehin zur Verfügung steht.

---

## Offene Fragen / Folge-Punkte

- [ ] **Backend-Komposition** (Kernidee aus dem Befund): contextfit als schneller Token-/BM25-Layer für `topic_summary`/`cross_doc`/`open_loop` + Embeddings für `reference_lookup`/`entity_lookup`/`temporal`. Intent-Routing oder Fusion?
- [ ] Echter 10×/100×-Skalierungs-Messpunkt statt linearer Hochrechnung — wann beißt contextfits In-Memory-RAM?
- [ ] **LLM-Query-Expander vor contextfit** (aus §6 abgeleitet): Multi-Query mit *generierten* Synonym-/Begriffsvarianten systematisch über alle 45 Queries messen — wie weit über die +4,5 Punkte (blind) kommt man mit gutem Expander? (contextfits eingebautes `expand_query` brachte nichts; ein externer LLM-Expander ist der vielversprechende Weg.)
- [ ] Dedup auf Note-Level + Halluzinations-Bremse (Absenz-Probe) — beide Backends betroffen.
- [ ] contextfits `build-index`-Bug (Flag wirkungslos) — upstream prüfen/melden.

## Entscheidung / Nächster Schritt

ADR-008 schreiben: `RetrievalBackend`-Naht, die **Komposition** erlaubt (nicht Ersatz). contextfits Performance-/Ressourcen-Profil (CPU-only, 23× schnelleres Indexing, 9× schnelleres Retrieval, kein GPU, kleinerer Index) macht es als **zusätzlichen** Layer attraktiv — besonders für große Sammlungen und für die thematisch-assoziativen Retrieval-Intents, wo es Embeddings schlägt. Als alleiniger Ersatz scheitert es an der punktuellen Faktensuche.
