# vault-memory — Roadmap & Genese

*Wie dieses Projekt entstand, in einfacher Sprache. Fachbegriffe stehen jeweils in
der rechten Spalte — wer sie nicht braucht, liest nur links.*

> Hinweis: Dies ist die **erzählende** Roadmap für Menschen. Die operative
> Phasen-Planung liegt in [`.planning/ROADMAP.md`](.planning/ROADMAP.md).

---

## 1. Was vault-memory 1.0.0 war

Eine Brücke zwischen deinen Obsidian-Notizen und einer KI: Die KI konnte deine Notizen
**durchsuchen, lesen und kontrolliert beschreiben** — schnell und lokal auf deinem
Rechner, ohne Cloud.

| In einfacher Sprache | Fachbegriff |
|---|---|
| Findet Notizen nach *Bedeutung*, nicht nur nach Stichwort | Hybride Suche (semantisch + Stichwort + RRF-Fusion) |
| Optionales Nachschärfen der besten Treffer | Cross-Encoder-Reranking (ONNX) |
| Merkt Datei-Änderungen sofort | Live-Indexing (File-Watcher) |
| Mehrere Notizbücher gleichzeitig | Multi-Vault |
| Sichere, kollisionsfreie Schreibvorgänge | Hash-geschützte atomare Writes |
| ~23 Werkzeuge für eine KI | MCP-Tools |

**Kurz:** v1.0.0 war eine **starke Such- und Lese-Schicht** — ein schneller Bibliothekar,
der findet und ausliefert.

---

## 2. Was vault-memory 2.0.0 anders macht

v1 fand Dinge. v2 macht daraus einen **mitdenkenden Wissens-Assistenten**, der Kontext
*zusammenstellt und behält*, statt ihn bei jeder Anfrage neu zu suchen. Das adressiert
ein bekanntes Problem: KI-Agenten entdecken bei jedem Lauf rund 85 % ihres Kontexts neu.

| In einfacher Sprache | Fachbegriff |
|---|---|
| Die KI schreibt **nie heimlich** in deine Notizen — nur in ein getrenntes KI-Gedächtnis, mit Herkunftsstempel | Memory-Namespace + Provenance; un-umgehbar am DeliveryAdapter-Chokepoint |
| Ergebnisse mit Quellenangabe statt loser Treffer | Citation-Packets; Bundles / Dossiers |
| Dem Verweis-Netz zwischen Notizen folgen, Themengruppen erkennen | Graph-as-Retrieval; typed edges; Community-Clustering (Louvain) |
| Mehrere Notizen zu einem fertigen Briefing zusammenfassen | Compiled Briefs (`compile_brief`) |
| Ein Briefing merkt selbst, wenn seine Quellen veralten | Source-Hash-Staleness-Daemon |
| Gespeicherte Recherche-Rezepte für wiederkehrende Aufgaben | Task Contracts (YAML-DSL) |
| Diese Rezepte visuell zusammenklicken | Obsidian-Plugin (Canvas-Editor) |
| Vorbereitet für andere Quellen/Datenbanken, nicht nur Obsidian | Adapter-Seams (source / delivery / change-feed) |

**Kurz:** v2.0.0 ist die **agentic knowledge layer** — sichere, quellenbelegte,
wiederverwendbare Wissensschicht.

> **Ehrlicher Stand:** Sechs der sieben Säulen sind gebaut und durch ~1693 Tests
> abgesichert. Das Aushängeschild „Task Contracts" lief im ersten echten End-to-End-Test
> aber **nicht zuverlässig durch** — die Bausteine sprachen nicht dieselbe Sprache. Das
> wird in einer eingeschobenen **Phase 8.5** vor dem Release behoben.

---

## 3. Themen, die während der Entwicklung dazukamen

Im Verlauf der Arbeit (und durch echtes Ausprobieren) sind fünf größere Themen
entstanden. Sie sind als Architektur-Entscheidungen festgehalten und größtenteils
**Konzepte für die Zukunft** (v2.x / v3), nicht Teil von v2.0.0.

| Thema (einfach) | Worum es geht | Status | Fachbegriff / ADR |
|---|---|---|---|
| **Contracts müssen wirklich laufen** | Die Recherche-Bausteine auf eine gemeinsame Sprache bringen, damit Rezepte beim echten Nutzer funktionieren | vor v2.0.0 | Verb-Output-Normalisierung; ADR-027 |
| **Rezepte sind Kontext-Spezifikationen** | Ein Rezept liefert dem Agenten ein optimal zusammengesetztes „Sichtfenster" (Umfang, Reihenfolge, Budget) | Konzept | Context-Window-Spec; ADR-026 |
| **Recherche ≠ Handeln** | Ein Contract *recherchiert* nur (sicher). Was am Ende *entstehen oder geschehen* soll (Dokument, E-Mail), ist eine eigene Schicht | Konzept | Workflow- vs. Research-Pipeline; ADR-028 |
| **Das System soll lernen** | Nutzer-Feedback („denk künftig an X") automatisch aufgreifen und Rezepte verbessern — braucht zuerst Qualitäts-Signale | Konzept | Learning Loops / Quality Signals; ADR-029 |
| **Vorberechnete Ergebnisse** | Häufig gestellte strukturierte Fragen vorab beantworten und zwischenspeichern — schneller, weniger Tokens | Konzept (strategische Wette) | Precompiled Artifacts; ADR-030 |

### Zwei Querschnitt-Einsichten

| In einfacher Sprache | Fachbegriff / ADR |
|---|---|
| „Alt" heißt nicht „unwichtig", sondern „prüfbedürftig" — Alter ist ein Pflege-Signal, keine Abwertung | Staleness als Curation-Signal; ADR-021 (korrigiert) |
| Nicht jede Auswahl ist „die KI entscheidet" — manche brauchen einen mathematischen Optimierer, der aus tausenden Varianten die besten 3–12 für einen Menschen filtert | Deterministischer Optimierer (z. B. Ungarische Methode) als Quality Gate; ADR-028 |

---

## 4. Wohin es geht (grobe Linie)

| Meilenstein | Inhalt (einfach) | Fachbegriff |
|---|---|---|
| **v2.0.0** (kurz bevor) | Sichere, quellenbelegte Wissensschicht + lauffähige Rezepte | agentic knowledge layer |
| **v2.x** | Rezepte werden klüger: Kontext-Budgets, Lernen aus Feedback, vorberechnete Ergebnisse | Context-Spec, Learning Loops, Artifacts |
| **v3.0.0** | Weitere Quellen anbinden (z. B. Notion) — nicht mehr nur Obsidian | Notion-Connector; weitere Adapter |
| **evtl. eigenes System / „4.0"** | Die *Handlungs*-Schicht (Workflows, Aktionen, Optimierer) — getrennt vom sicheren Gedächtnis-Kern | Workflow-Layer; deterministische Optimierer |

---

## 5. Das Leitprinzip, das nie wackelt

> Die KI darf **niemals heimlich in deine Notizen schreiben.** Jede von der KI
> verfasste Information landet mit Herkunftsstempel in einem **getrennten, gekennzeichneten
> KI-Gedächtnis** — niemals in deinen eigenen Notizen. Diese eine Regel ist die
> nicht-verhandelbare Sicherheitsgrundlage des ganzen Systems.

*(Technisch: Memory-Namespace-Invariante, zentral erzwungen am `DeliveryAdapter.write()`-Chokepoint.)*

---

*Eine ausführliche, alltagssprachliche Erklärung der Funktionsweise steht in
[`docs/v2/HOW-IT-WORKS.md`](docs/v2/HOW-IT-WORKS.md). Alle Architektur-Entscheidungen:
[`docs/v2/adr/`](docs/v2/adr/README.md).*
