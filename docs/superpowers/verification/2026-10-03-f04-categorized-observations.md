# F04 — Kategorisierte Aussagen: TDD und Abnahme

Stand 2026-10-03; Codecommits `7de0131`, `f8cc5f4`, `5373bea`, `d41604e`, `b1b2c1c`.

Explizite kategorisierte Markdown-Listeneinträge werden mit Quellhash, Kategorie
und Body-Zeilen indexiert. Migration 17 ergänzt observations und observations_hash;
der Marker unterscheidet ungefüllten Index und gültiges leeres Ergebnis. Identische
Snapshots erhalten IDs. Schreiben nutzt vorhandene Schutzprüfungen und publiziert
Notiz/Aussagen transaktional; Fehlermeldungen aus Reindex-Publikation propagieren,
body_hash bleibt dirty und Wiederholung repariert Aussagen und Abschnitte.

`include_observations` ist an drei v2-Assembly-Tools optional, standardmäßig false.
Freshness wird am frisch gelesenen SourceHash geprüft; stale/unindexed zeigt keine
alten Aussagen. Abschnitte filtern korrekt und zitieren tatsächliche Headingpfade.
Metadaten geben keine Statementtexte aus; Exzerpte teilen das globale Body-Budget.
Provenienz wird aus der Quelle übernommen, keine Inferenz oder Promotion.

## RED → GREEN

- Parser primär 9 fehlgeschlagen, später Fencegrenzen 2 und verschachtelte Fence 1.
- Echte SQLite-Query-Verträge: 5 neue Tests, falsche Ergebnisaussagen zuerst rot.
- Datei-/SQLite-Integration: 6 neue fehlgeschlagene Assertions, Abschnittsfilter 2.
- Review: 6 rote Assertions (Listen-Fence, Root-Closer, single/full Triggerfehler
  mit dirty-Marker und Retry, Bundle-/Dossier-Headingpfade).
- Weitere Containergrenzen: 2 rote Assertions für eingerückten Code und Fence-Ende;
  anschließend 1 rote Assertion für tiefe Absatzfortsetzung ohne Leerzeile.
- Gemeinsamer Markdown-Scanner für Sections, Aussagen und F05-Relationen erhält
  Absatzfortsetzungen und verwirft Codebeispiele. Logs liegen neben diesem Bericht.

## Verifikation

- Endprüfung: **1.945 bestanden, 16 übersprungen**, 163 Testdateien bestanden;
  enthält bereits zehn grüne F05-Parserfälle.
- TypeScript-Lint, Adapter-Invarianten und Build exit 0 mit Node 24.11.1.
- Unabhängiges final gepinntes Review `b1b2c1c`: **148 bestanden, 11 übersprungen**,
  13 Dateien plus fünf manuelle Grenzfallassertions; keine offenen Findings.
- Upgrade von v16 und idempotente Migration, FK/Cascade, SQL-Rollback einschließlich
  Datei/Audit bei direkten Writes, Reindex/Rename, locked-Refusal und provenance geprüft.
- Keine neue Standardaktion/Abhängigkeit. Original 23 v1-Schemas unverändert eingefroren.

## Grenzen

IDs sind stabil für identische Kategorie/Text/Quellzeilen; Text-/Zeilenänderung
kann neue IDs erzeugen. Kategorien sind freie explizite Zeichenketten. ATX-Sections,
keine vollständige CommonMark-AST oder automatische Wissensinferenz. Statements
sind Rekonstruktionen aus Markdown und dürfen nicht als neue Evidenzquelle gelten.
Ein gescheiterter Reindex kann abgeleitete Chunks/Sections vorläufig unvollständig
hinterlassen; dirty-Marker und Wiederholung reparieren sie, der Lauf meldet Fehler.
