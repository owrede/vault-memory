# F03 — Kompakter Kontext: TDD und Abnahme

Stand 2026-10-03; Codecommits `ed129a0`, `77bb8f5`, `734dae7` auf
`feat/basic-memory-inspired`. Vollständiges F01–F11-Ziel bleibt aktiv.

Die drei v2-Assembly-Tools bieten Metadaten ohne Body-Snippets, gezielt frisch
gelesene Abschnitte und globale UTF-16-Zeichenbudgets. CitationPackets,
Originalhash, vollständige Quellbereiche, ursprüngliche Länge, Truncation und
Budgetausschlüsse bleiben sichtbar. Bundle/Dossier lesen Abschnitte des Anchors;
Search-Selektoren beziehen sich auf die Query-Kandidaten. Omitted/full ohne
Budget liefert unverändert den bisherigen Payload. Die 23 ursprünglichen
v1-Literale und Zod-Eingabeschemas sind separat vor der Erweiterung eingefroren.

## RED → GREEN

- Budgetkern: 8 fehlgeschlagen, 3 bestanden; anschließend 11/11 grün,
  einschließlich Budget null, NaN/negative/gebrochene Werte und Emojis.
- Echte Datei-/SQLite-Assembly: 5 fehlgeschlagen, 1 bestanden; anschließend
  6/6 grün. Enthält gesperrte Quelle, Body-Freiheit, exakte Zitate/Ranges,
  mehrere Slices, globales Budget, fehlende/mehrdeutige Selektoren und Dossier.
- Search-Projektion: 3 fehlgeschlagene Assertions; frisch gelesene Source-Texte
  ersetzen indexierte Snippets in sections. Fehlender Suchselektor separat RED.
- MCP-SDK: 1 fehlgeschlagene Assertion für veröffentlichte Projektion; danach
  kürzere Metadatenantwort, vollständige Zitatfelder, Budget und Fehlercode grün.
- Review: 2 fehlgeschlagene Assertions für leere/verwaiste Query-Kandidaten;
  `target_not_found` gilt anschließend auf sämtlichen leeren Rückwegen.

Logs liegen neben diesem Bericht. Keine Dateien werden durch Abrufe mutiert.
Metadaten/Provenienz werden getrennt vom Body-Budget vollständig erhalten.

## Prüfungen

- Integration/Baseline: 119 bestanden, 11 übersprungen.
- Erste Gesamtprüfung: 1.897 bestanden, 16 übersprungen.
- Nach Review-Korrektur: **1.911 bestanden, 16 übersprungen**, 160 Testdateien
  bestanden; darin 12 bereits grüne F04-Parserfälle.
- Typecheck, Adapter-Lint und Build exit 0 unter Node 24.11.1.
- Kein neues Standardtool, keine neue Abhängigkeit oder DB-Migration.
- Gesamt-Tools-Snapshot nur für drei v2-Optionserweiterungen aktualisiert;
  separate v1-Baseline unverändert.

Unabhängiges Read-only-Review fand einen Important-Fall. Re-review der
Korrektur bestätigte 20 Suchtests sowie empty/orphan/preamble/deleted jeweils
mit allen Projektionen: **keine offenen Findings, freigabereif**.

## Grenzen

Budget zählt UTF-16-Codeeinheiten, keine Bytes/Tokens/Graphemcluster. Abschnitte
umfassen verschachtelte Unterabschnitte; Quellbereiche beschreiben den ganzen
Abschnitt, auch bei gekürztem Text. ATX-Selektoren, keine Setext-Überschriften.
Suchselektoren fehlen gegebenenfalls in einem begrenzten Query-Kandidatenpool,
auch wenn eine andere Suche sie finden würde. Vollständige Metadaten können
die Gesamtantwort größer als das Body-Budget machen.
