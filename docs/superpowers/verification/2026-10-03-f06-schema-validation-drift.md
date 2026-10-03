# F06 — Schema-Kandidaten, Validierung und Drift: TDD und Abnahme

Stand 2026-10-03; Codecommits `3eee397`, `3cf1d44`, `0fb17da`.

Opt-in schema_inspection registriert genau inspect_schema v1. Infer liefert
Stichprobengröße, deduplizierte Quellzitate, geordnete Typen/Häufigkeiten und
candidate-only Felder. Kein Schema wird geschrieben oder empirisch verbindlich.
Explizite MemoryContract-Pflichtkeys behalten ihre Pflicht, auch wenn absent.

Validate nutzt unveränderte Zod-Contracts und Pflichtkeylisten. Provenienz,
Typfehler und Cross-Field-Fehler bleiben Fehler; unbekannte Felder/Kategorien/
Rollen warnen permissiv und scheitern strikt. Diff zeigt missing/unexpected/
type_changed sowie explizite Vocabularyabweichungen. YAML-Contracts erhalten
optionale inspection-Vokabulare. Diskfallback braucht einen expliziten einzelnen
Filesystemvault; bestehender globaler benannter Contractcache bleibt in Gebrauch.
Readonly/locked Quellen werden gelesen, keine Notizen/Audits/Contracts mutiert.

## RED → GREEN

- Kernstub: 6 fehlgeschlagen, 2 bestanden; danach 8/8 grün.
- Integrationstub: 7 fehlgeschlagene Fälle; danach Quellen-/Contract-/MCP-Pfade
  grün, inklusive Pflicht-Evidence, strict/permissive, leere/doppelte Samples,
  null/mixed types und unavailable/unknown diagnostics.
- Expliziter Diskcontract zunächst unbekannt, dann vorhandene YAML-Auflösung grün.
- Review: strukturierte echte StubSource zunächst ohne Listenkategorien/Relations;
  ein roter Adapterfall sowie vier rote Rendererfälle. Danach BlockNodes erhalten:
  Headings, Listen, Fortsetzungen, nested Sections und robuste Code-Fences.
  Gerenderte Linien tragen line_basis=rendered_markdown; native soleparagraph
  bleibt exact source_body. Hash/DocId/properties bleiben ursprüngliche Quelle.
- Adapter-wikilinks werden nur aus FS-Profil/Validierung ausgeschlossen, nicht
  aus den Original-CitationProperties. Logs liegen neben diesem Bericht.

## Verifikation

- Erste Gesamtprüfung: 1.973 bestanden, 16 übersprungen.
- Nach Reviewkorrektur: **1.978 bestanden, 16 übersprungen**, 168 Dateien bestanden.
- Gezielte finale Prüfung: 193 bestanden, 11 übersprungen, 17 Dateien.
- TypeScript, Adapter-Invarianten und Build exit 0 mit Node 24.11.1.
- Unabhängiges finales Review `0fb17da`: 162 bestanden, 11 übersprungen;
  ursprüngliche Repro nun passed:false mit zwei Vocabularyfehlern und markierten
  Projektionskoordinaten. Keine offenen Critical/Important/Minor-Findings.
- Keine DB-Migration, keine neue Dependency, default tool catalog und separat
  eingefrorene originale 23 v1-Schemas bleiben unverändert.

## Grenzen

Inferenz ist empirische Feld-/Typ- und Vokabularbeobachtung, kein JSON-Schema-
Compiler für beliebige externe Ontologien. Die bestehenden MemoryContract-
Dateien/Zod-Regeln bleiben bindend. Diskcontracts werden im bestehenden globalen
Namenscache geladen; nach Dateiedits folgt dessen bestehende Reload-Lebensdauer.
Vocabularies betreffen inspection, nicht vorhandene Sink-Schreibvalidatoren.
Gerenderte Structured-Block-Linien sind Projektionskoordinaten und keine native
Quellbyteposition. Keine automatische Provenienz- oder Schema-Promotion.
