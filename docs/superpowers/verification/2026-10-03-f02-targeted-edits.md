# F02 — Gezieltes Editieren: TDD und Abnahme

Stand 2026-10-03. Branch `feat/basic-memory-inspired`, Codebereich
`1c690e9..d842780`. Keine Veröffentlichung oder Integration in den ursprünglichen Checkout.

Geliefert: optionales Modul `server.features = ["document_edit"]` mit
`edit_document` v1. Eindeutige Textstelle oder ATX-Abschnitt bearbeiten,
Caller-Hash unverändert prüfen und weitergeben. Frontmatter-Bytes bleiben
bei reinen Body-Edits erhalten; identische Änderungen haben nach allen Guards
keine Schreib-, Audit- oder Suppression-Nebenwirkungen. Lock, OCC, Pfad,
readonly und Sink-Provenienz gelten weiterhin.

## Beobachtetes RED → GREEN

- Patch-Kern: 14 fehlgeschlagene Assertions, 2 bestanden; anschließend 18 Kernfälle grün.
- Integration: 14 fehlgeschlagene Assertions, 24 bestanden; echte Dateien,
  SQLite, Source/Delivery und MCP-InMemoryTransport, keine gemockte Kernlogik.
- Fence-Randfälle: 2 fehlgeschlagene Assertions; korrigierte Fence-Länge und
  legal eingerückte ATX-Überschriften anschließend grün.
- Review: 4 fehlgeschlagene Assertions für leere ATX-Grenze, ungültigen
  Backtick-Info-String, identische Mixed-EOL-Ersetzung und veraltete Chunks.
- MCP-Refresh: 1 fehlgeschlagene Assertion für edit → neue Such-Chunks.
- Retry: 2 fehlgeschlagene Assertions für Edit-Refresh fehlgeschlagen →
  Catchup ebenfalls fehlgeschlagen → Backend wieder verfügbar → Reparatur.
  Auch ContextFit-Failed-Status hält die Invalidierung aufrecht.

Die RED-Logs liegen neben diesem Bericht. Lokale Tests benötigen keine laufenden
Modelldienste; externe Ollama-/ContextFit-Aufrufe werden ausschließlich an ihren
I/O-Grenzen kontrolliert. Datei-, Adapter-, Index- und Guardlogik laufen real.

## Indexkonsistenz

Targeted Edits invalidieren Chunks, Abschnitte und Kanten im DB-Schreibtransaction.
Der kanonische Dateihash bleibt korrekt; `body_hash = NULL` kennzeichnet die
erforderliche Reparatur. Single-, Full- und Catchup-Indexierung respektieren
diese Markierung; Single/Full löschen sie erst nach erfolgreichem Aufbau.
MCP aktualisiert anschließend den konfigurierten Backend-Index inklusive
ContextFit-KB. Fehler ändern den erfolgreichen kanonischen Edit nicht in eine
scheinbar fehlgeschlagene Mutation um: `ok: true`, `index_refresh: "pending"`
und `warning` melden ausstehende Reparatur. Ohne registriertes Modell wird
der lexikalische Index ohne Ollama aufgebaut.

## Prüfung und Review

- Erste Gesamtprüfung: 1.864 bestanden, 16 übersprungen.
- Nach erster Review-Korrektur: 1.883 bestanden, 16 übersprungen,
  einschließlich 11 bereits grüner F03-Kerntests.
- Abschließende gemeinsame Regression F02/F03: **1.897 bestanden,
  16 übersprungen, 159 Testdateien bestanden**.
- Typecheck, Adapter-Invarianten und CLI-Build: exit 0 unter Node 24.11.1.
- Originale v1-Namen und Eingabeschemas bleiben unverändert. Keine DB-Migration
  oder neue Abhängigkeit; vorhandenes NULL-Signal wird für Reparaturen genutzt.
- Unabhängiges Read-only-Review fand zunächst drei Important-Fehler; ein weiterer
  Fehler im fehlgeschlagenen Retry wurde ebenfalls RED → GREEN korrigiert.
  Letztes gezieltes Re-review bestätigte 123 Tests in 13 Dateien und alle
  Fehlerabläufe: **keine Critical/Important/Minor-Findings, freigabereif**.

Grenzen: ATX-Überschriften werden unterstützt, Setext nicht. Ein Abschnittsedit
ersetzt auch verschachtelte Unterabschnitte. Es gibt keine zusätzliche
prozessübergreifende Dateisperre; bestehende OCC-/Delivery-Garantien gelten.
