# AGENT HANDOFF — Spike "contextfit vs. sqlite-vec"

**Erstellt:** 2026-05-28 von der Cloud-Session, die den Spike vorbereitet hat (PR #9).
**Letzter Commit auf der Spike-Branch:** `fd3593f` (Harness gegen contextfit 0.1.0 verifiziert).
**Spike-Branch:** `claude/review-consulting-terms-TNG4e` — falls schon nach `main` gemergt, dort weiterarbeiten.

---

## STOP — vor dem ersten Befehl prüfen

Du bist nur die richtige Session, wenn **alles** hier zutrifft:

```bash
uname -s                                            # → Darwin (macOS)
ls -d "/Users/wrede/Documents/Obsidian Vaults/INIM-VM-TEST"  # existiert
command -v ollama                                   # → /opt/homebrew/bin/ollama o.ä.
curl -fsS localhost:11434/api/tags | head -c 100   # liefert JSON
```

**Wenn auch nur eine dieser Prüfungen scheitert: SOFORT ABBRECHEN.** Du bist in einer falschen Umgebung. Antworte dem User: *„Ich bin nicht auf dem Mac mit dem Vault und Ollama. Diese Session kann den Spike nicht fahren — starte Claude Code lokal im vault-memory-Repo auf dem Mac und übergib dort den Auftrag."* Die Cloud-Sandboxen (Claude Code on the web) können das nicht — verifiziert in der Vorgängersession, dokumentiert in `NOTES-contextfit-api.md`.

---

## Was schon erledigt ist (musst du nicht nochmal tun)

Eine vorhergehende Cloud-Session hat die Harness gebaut und gegen die echte `contextfit==0.1.0` API verifiziert. Insbesondere:

- `scripts/query-both.mjs` parst contextfits `--json`-Output korrekt (Score liegt **pro Chunk**, nicht als top-level Array — verifiziert gegen `contextfit/cli.py::_query_to_json`).
- `scripts/preflight.sh` wärmt das tiktoken-`cl100k_base`-Encoding vor (contextfit braucht es, lädt es lazy von einem Blob-Host).
- `scripts/ingest-contextfit.sh` zieht die Chunk-Zahl aus `<KB>/ingest_manifest.json` (kein Tokenizer-Reload).
- 22 Default-Queries in `queries.yaml`: 12 EN themen-agnostisch + 10 DE-Paraphrasen (Adversarials für den Sprach-Achse-Test).
- `run.sh` orchestriert `setup → query → aggregate → clean`.

Lies vor dem Lauf einmal `README.md` (Methodik) und `NOTES-contextfit-api.md` (verifizierte API-Details).

---

## Was du gleich tust — in einem Satz

`./run.sh setup && ./run.sh query`, User bewertet `results/report.md` manuell, `./run.sh aggregate`, du schreibst Verdict in `SUMMARY.md`.

---

## Schritt 1 — Setup (einmalig pro Session)

```bash
# Repo + Branch
cd /pfad/zu/vault-memory                           # User sagt dir den Pfad; sonst:
                                                   #   find ~ -maxdepth 4 -type d -name vault-memory
git fetch origin claude/review-consulting-terms-TNG4e
git checkout claude/review-consulting-terms-TNG4e || git checkout main  # falls gemergt
git pull --ff-only

npm install && npm run build                       # dist/cli.js muss frisch sein

# contextfit in isoliertes venv (greift NICHT in System-Python ein)
python3 -m venv ~/.cf-venv
source ~/.cf-venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet contextfit                     # 0.1.0 ist die getestete Version
export CONTEXTFIT_BIN="$(command -v contextfit)"

# Ollama-Modell sicherstellen
ollama list | grep -qE 'bge-m3|qwen3-embedding' || ollama pull bge-m3
```

**Wichtig:** `CONTEXTFIT_BIN` muss in jeder neuen Shell gesetzt werden, weil das venv pro Shell aktiviert wird. Im Zweifel: `source ~/.cf-venv/bin/activate && export CONTEXTFIT_BIN="$(command -v contextfit)"`.

---

## Schritt 2 — Spike fahren

```bash
export VAULT_PATH='/Users/wrede/Documents/Obsidian Vaults/INIM-VM-TEST'
cd .planning/quick/20260522-spike-contextfit-vs-sqlitevec

./run.sh setup     # Preflight → beide Backends ingesten (~3-15 Min je nach Vault-Größe)
./run.sh query     # 22 Queries × 2 Backends × 3 Reps (~1-3 Min) → results/report.md
```

**Erwartete Artefakte nach `./run.sh query`:**
- `results/setup-metrics.json` (Wallclock + Storage beider Backends)
- `results/sqlite-vec-raw.json` + `results/contextfit-raw.json` (Top-10 + Latenzen pro Query)
- `results/query-metrics.json` (P50/P95 Latenz)
- `results/report.md` (Side-by-Side mit Bewertungs-Checkboxen)

**Sanity-Check nach `./run.sh query`** (bevor du den User um Bewertung bittest):
```bash
# Hat jedes Backend für jede Query Treffer geliefert? Erwartung: nirgendwo "(kein Treffer)"
grep -c "(kein Treffer)" results/report.md
# Sind die Latenzen plausibel? (Wenn contextfit-P50 > 1000 ms → Tokenizer-Reload pro Query, ein Bug)
cat results/query-metrics.json
```

---

## Schritt 3 — Manuelle Bewertung (User-Aufgabe)

Sag dem User wörtlich:

> `results/report.md` liegt jetzt vor. Bitte öffne sie im Editor und markiere für jede Query die Top-5-Treffer pro Backend:
> - `[x]` relevant — würdest du als Antwort verwenden
> - `[~]` tangential — teilweise relevant
> - `[ ]` irrelevant (Default, keine Markierung nötig)
>
> Dauer: ca. 30-45 Min für die 22 Default-Queries. Sag mir Bescheid, wenn du fertig bist.

**Du wartest dann.** Biete dich an, im Editor zu helfen oder einzelne Queries gemeinsam durchzugehen, wenn der User das möchte. **Du bewertest NICHT selbst** — du hast keine Ground Truth über den Inhalt des Vaults und der User würde sich auf falsche Zahlen verlassen.

Wenn der User vorschlägt, "ein paar Queries reichen" oder Auto-Bewertung — sag freundlich: ohne Bewertung an *allen* 22 Queries werden die Sprach-Splits (EN vs. DE) statistisch nicht aussagekräftig, der Spike beantwortet seine Frage dann nicht.

---

## Schritt 4 — Aggregation + Verdict (deine Aufgabe)

```bash
./run.sh aggregate     # → results/metrics.md + results/metrics.json
```

`metrics.md` zeigt Recall@5, Precision@5, MRR — gesplittet nach **overall / EN / DE / per intent**.

**Verdict-Regeln aus `README.md`:**

| Bedingung | Verdict |
|---|---|
| contextfit Recall@5 ≥ 90 % vom sqlite-vec-Wert **UND** DE-Recall@5 ≥ 70 % **UND** Latenz- oder Storage-Vorteil | **GO** |
| contextfit Recall@5 < 70 % auf EN **ODER** < 50 % auf DE | **NO-GO** |
| Werte dazwischen | **DEFER** mit konkreten Folge-Fragen |

**Schreibe `SUMMARY.md`** (Schablone steht schon, du füllst sie):
1. Verdict (eine Checkbox setzen).
2. Headline-Zahlen-Tabelle aus `metrics.md` übertragen.
3. **Qualitative Beobachtungen** (3-5 Sätze): wo hat contextfit überrascht, wo versagt, welche Intent-Klasse zeigt den größten Spread, hält DE-Recall oder bricht es ein wie befürchtet.
4. **Konkrete nächste Schritte** je nach Verdict:
   - GO → ADR-008 + `RetrievalBackend`-Naht in v2.1-Mini-Milestone planen.
   - NO-GO → Spike geschlossen, Notiz im STATE.md.
   - DEFER → offene Fragen auflisten, in STATE.md Blockers/Concerns eintragen.

---

## Schritt 5 — Ergebnisse persistieren

`results/` ist per `.gitignore` ausgenommen (vault-private Inhalte). Da `INIM-VM-TEST` ein dedizierter Test-Vault ist, kann der User die Ergebnisse mit-committen:

```bash
git add -f results/metrics.md results/report.md \
           results/metrics.json results/setup-metrics.json results/query-metrics.json
git add SUMMARY.md
git commit -m "spike: INIM-VM-TEST run results + verdict"
git push
```

**Frag den User vor `git add -f`**, ob die Test-Vault-Inhalte wirklich öffentlich werden dürfen — `report.md` enthält Notiz-Pfade und Snippets aus dem Vault.

---

## Bekannte Stolperfallen (alle in der Vorgängersession aufgetreten)

1. **`Vault directory not found`** — Du bist nicht auf dem Mac. Siehe STOP-Block oben.

2. **`Ollama unreachable`** — `ollama serve` läuft nicht. Fix: `ollama serve &`, dann `curl localhost:11434/api/tags` zur Verifikation.

3. **`Embedding model "bge-m3" not found`** — Modell fehlt. Fix: `ollama pull bge-m3`. Falls vault-memory-Config ein anderes Modell sagt: in `~/.vault-memory/config.toml` nachschauen oder Preflight passt sich an `qwen3-embedding` an.

4. **`tiktoken HTTP 403 for cl100k_base`** — Proxy/Firewall blockt `openaipublic.blob.core.windows.net`. Der Preflight prüft das. Wenn das auf dem Mac passiert: VPN aus, oder `TIKTOKEN_CACHE_DIR` mit vorgehaltener Encoding-Datei setzen.

5. **`contextfit JSON parse` Fehler im Treiber** — Die contextfit-API hat sich seit 0.1.0 evtl. geändert. Verifizieren mit:
   ```bash
   contextfit --kb /tmp/cf-probe ingest evals/fixtures/v2-test-vault --rebuild-index-after-ingest
   contextfit --kb /tmp/cf-probe query "test" --top-k 2 --json | head -40
   ```
   Erwartete Struktur siehe `NOTES-contextfit-api.md`. Falls abweichend: `query-both.mjs::parseContextfit` anpassen.

6. **vault-memory schreibt in `~/.vault-memory/`** — Nein, tut es nicht. `run.sh` setzt `$HOME` auf eine temp-Sandbox unter `$TMPDIR/vm-spike-XXXXXX/`. Die Live-Config bleibt unangetastet.

7. **Watcher hängt nach `./run.sh setup`** — vault-memory startet beim Indexieren chokidar; das Kommando beendet sich aber nach dem Full-Index-Run. Falls es trotzdem hängt: `^C`, der Index ist persistent (Wiederaufnahme via `./run.sh query`).

---

## Fertig-Definition (Definition of Done)

Der Spike ist abgeschlossen, wenn:

- [ ] `results/metrics.md` existiert und realistische Zahlen zeigt (Recall@5 ≠ 0 % beide Backends; `n queries` ≥ 20).
- [ ] `SUMMARY.md` hat eine Checkbox-Markierung (GO/NO-GO/DEFER) und gefüllte Tabelle.
- [ ] `SUMMARY.md` enthält 3-5 qualitative Beobachtungen und konkrete nächste Schritte.
- [ ] Ergebnisse sind committed und gepusht (Branch und Commit-SHA dem User mitteilen).
- [ ] PR-Body von #9 ist um einen Abschnitt "Spike-Ergebnis: <Verdict>" ergänzt, oder ein Kommentar mit dem Verdict ist auf #9 gepostet.

---

## Wenn der Spike NO-GO oder DEFER ergibt

Schließe trotzdem sauber ab. Insbesondere bei DEFER: liste in `SUMMARY.md` konkrete Folge-Fragen, die ein nachfolgender Spike beantworten würde, z.B.:

- "Wirkt contextfits `SemanticExpander` als Brücke für die DE-Mismatches?"
- "Was passiert mit Recall, wenn man contextfit nur als BM25-Ersatz nimmt und vault-memory's semantische Schicht behält (Backend-Komposition)?"
- "Wie sieht es auf einem 10× größeren Vault aus — wann beißen die Latenz-Skalen zu?"

Trage diese Fragen in `STATE.md` unter Blockers/Concerns ein, damit sie nicht verloren gehen.

---

## Kurz-Verifikation, dass du am Ende bist

```bash
ls -la results/{metrics,setup-metrics,query-metrics}.md results/{report,metrics}.md 2>/dev/null
head -20 SUMMARY.md     # Verdict-Checkbox gesetzt?
git log --oneline -3
```

Viel Erfolg. Wenn du blockst: paste den genauen Fehler an den User, nicht eine Vermutung.
