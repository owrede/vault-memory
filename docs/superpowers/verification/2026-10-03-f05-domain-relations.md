# F05 — Fachliche Relationen: TDD und Abnahme

Stand 2026-10-03; Commits `d41604e`, `1350d29`, `ffbc3f7`.

Explizite komplette Listeneinträge unter tatsächlichen Relations-ATX-Abschnitten
reichern bestehende Wikilinkkanten mit Edge.rel an. Heading/Code-Scopes teilen
F04s Markdown-Scanner. Unbekannte Rollen bleiben erhalten, Alias/Anchor/Ziel
werden mit der vorhandenen Wikilinknormalisierung aus jeder validierten
Deklarationszeile ermittelt; die Legacy-Fencemaske kann keine echte Rolle verlieren.
Keine doppelte Graphtabelle, neue technische Linkart oder DB-Migration.

V2 expand bietet gebundene Rollenfilter pro Hop und incoming/outgoing als
Aliase für die erhaltenen backward/forward-Werte. Weglassen = alle, [] = keine
Rollen, Default direction bleibt both. via zitiert die deklarierende Quelle mit
Quellhash und Body-Zeile; Zielpaket bleibt seine eigene Quelle/Provenienz.
Stale Quellen werden diagnostiziert und ausgeschlossen, keine Umkehrrolle oder
Confidence erfunden. Volles Reindex backfillt vorhandene Notizen.

## RED → GREEN

- Parserstub: 8 fehlgeschlagen, 2 bestanden; anschließend zehn Kernfälle grün.
- Gemeinsame Heading-Fencegrenze zusätzlich rot, dann grün.
- Integration: Rollen/Direction/Filter/Repeat/SDK-Assertions zuerst rot. Ein
  anfänglich falscher Test-Patch-Schlüssel wurde korrigiert und ist kein Nachweis.
- Review: 4 rote Verhaltensassertions für gewöhnlichen Delivery-Write mit alten
  Relationen und Legacy-Fence-/Whitespacevarianten. Anschließend 358 Tests grün.
- Normale geänderte canonical Writes invalidieren jetzt in derselben Rollback-
  Transaktion body_hash, Sections, Chunks, Wikilinks und Edges. Catchup/Single/
  Full bauen den Index neu auf; alte Kanten können nicht neuen Hash zitieren.
- Frische Rolle braucht neben SourceHashgleichheit einen aktuellen body_hash.
  Keine neue Persistenzschicht erforderlich. Logs neben diesem Bericht.

## Verifikation

- Erste Gesamtprüfung: 1.952 bestanden, 16 übersprungen.
- Nach Reviewkorrektur mit bereits integrierter F06: **1.973 bestanden,
  16 übersprungen**, 167 Dateien bestanden.
- TypeScript, Adapter-Lint und Build exit 0 unter Node 24.11.1.
- Unabhängiges Re-review gepinnt auf `ffbc3f7`: 197 bestanden/11 übersprungen
  und weiterer Lauf 150 bestanden; alle drei ursprünglichen Repros einschließlich
  gewöhnlichem Catchup bestätigt, keine offenen Critical/Important/Minor-Findings.
- Original 23 v1 Eingabeschemas unverändert; nur expand-v2-Snapshot erweitert.

## Grenzen

Rollenfilter gelten für bestehende Edge.rel-Werte, auch Frontmatter-Referenzen.
Traversal behält die zweistufige Hopgrenze und ein dedupliziertes Zielpaket mit
gewinnendem via-Weg; mehrere Rollen sind im Kantenindex erhalten. Geänderte
Delivery-Writes liefern vor Indexrefresh keine alten abgeleiteten Treffer. Bis
Refresh kann Retrieval unvollständig sein; Single/Catchup/Full reparieren den
expliziten dirty-Marker. ATX-Relations, keine automatische semantische Inferenz.
