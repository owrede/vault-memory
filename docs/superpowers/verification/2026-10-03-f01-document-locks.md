# F01 — Implementierung und TDD-Nachweis

Stand: 2026-10-03; Featurebranch `feat/basic-memory-inspired`; Basis `9bc728e`.

## Geliefert

Boolean `locked: true` im gespeicherten Dokument schützt write/update/delete am gemeinsamen FS-Schreibpfad und am Stub. Frontmatter, MCP-Notehandler und Supersede liefern `document_locked` unverändert. Die Prüfung liest aktuelle Dateien unabhängig vom Index. Erstellen/erstmaliges Sperren und manuelles Entsperren mit anschließendem frischen Read sind zulässig. Watcher-Suppression erfolgt erst unmittelbar vor tatsächlicher Mutation. Kein neues Tool, keine Schema-/Datenbankmigration und keine neue Abhängigkeit.

## RED → GREEN

| Schritt | Beobachtetes RED | GREEN |
|---|---|---|
| Task 1: Delivery/Low-level | 14 Assertions fehlgeschlagen: gesperrte Dateien wurden geschrieben/gelöscht oder OCC maskierte den Sperrgrund. | 168 betroffene Adaptertests bestanden. |
| Task 2: Frontmatter/MCP | 12 Assertions fehlgeschlagen: Frontmatter maskierte Sperren/akzeptierte No-op; Handler unterdrückten Events trotz Ablehnung. | 217 Tests in 11 Dateien bestanden, einschließlich Supersede und beider Adapter. |

Die Tests nutzen echte temporäre Markdown-Dateien, In-memory-SQLite, Source-/DeliveryAdapter und SuppressionSet. Sie vergleichen Dateibytes, DB-Zeilen und Audit vor/nach Ablehnung. Ein realer Adapter mit kontrolliertem Editorereignis reproduziert eine Sperre zwischen Source-Read und Delivery-Write. Die vollständigen RED-Ausgaben liegen neben diesem Bericht als Textdateien.

## Gesamtprüfung

Node 24.11.1, PATH auch für Childprozesse gesetzt; vollständige Suite außerhalb der Sandbox wegen nativer Datei-Watcher.

- Ausgangsbestand: 149 Dateien bestanden, 1 übersprungen; 1.781 Tests bestanden, 16 übersprungen.
- Featurebestand: 151 Dateien bestanden, 1 übersprungen; **1.831 Tests bestanden, 16 übersprungen**.
- `npm run lint`: exit 0.
- `npm run lint:adapters`: exit 0, alle Adapter-Seam-Invarianten grün.
- `npm run build`: exit 0, CLI/server erfolgreich gebündelt.
- `git diff --check`: exit 0.
- MCP-stdio-Smoke: alle 37 Aufrufe (32 kanonisch + 5 deprecated), 13 Resources und Contract-Describe/Instantiation geprüft; erfolgreich. Für den Smoke wird Polling genutzt, um Sandbox-Watcherbeschränkungen zu umgehen.

Initiale Prüfläufe mit vom npm-Pfad gewähltem Node26 scheiterten an der Node24-SQLite-ABI; sandboxinterne Watcher scheiterten mit EMFILE. Das wurde durch die unterstützte Node24-Version und passenden Ausführungskontext behoben, ohne Produktcode dafür zu ändern. Bestehende Vitest-poolOptions-Deprecation bleibt aus dem Ausgangsbestand erhalten.

## Unabhängiges Review

Read-only-Review durch einen frischen Reviewer (`gpt-6-astra`) auf `9bc728e..12effe7`: keine Critical-, Important- oder Minor-Findings, freigabefähig. Reviewer prüfte alle fünf Review-Focus-Klassen und führte selbst 217 Tests sowie diff-check aus.

## Festgehaltene Entscheidungen und Grenzen

- Vorhandene Handlerfactory heißt `makeNotesHandlers`; Plan-Tippfehler korrigiert, API nicht umbenannt. Die Dependency-Typen wurden auf die tatsächlich konsumierten realen Dienste beschränkt. Kosten bei falscher Einschätzung: Typanpassung, kein beabsichtigter Verhaltensunterschied.
- F02–F11 sind ausschließlich geplant, ihre Runtimefunktion ist nicht abgenommen. Kosten bei falscher Planung: Anpassung vor der jeweiligen Lieferung.
- Die Anwendungssperre verhindert geprüfte API-Schreibzugriffe. Externe Editoren können nach dem letzten Read weiterhin konkurrierende Änderungen erzeugen; keine neue Prozesssperre. Kosten bei Fehlannahme: bestehende OCC-Race mit externem Schreiben.
- Strukturierte Guard-Ablehnungen bleiben ohne Mutation. I/O-/SQLite-Ausnahmen nach Beginn einer Mutation nutzen bestehende Recoverypfade; universelle Fehleratomizität ist nicht zugesichert. Kosten bei Fehlannahme: Recovery/Reindex nach I/O-Fehlern nötig.
- Keine zurückgestellten Minor-Findings.

## Commits und weiterer Schritt

- `1543814`: elf Einzelpläne und Design.
- `6400244`: gespeicherte Locks in Delivery-Adaptern.
- `12effe7`: Integration und nebenwirkungsfreie Ablehnung.

F01 ist abgeschlossen. Nächste Lieferung: F02 gezieltes Editieren nach seinem eigenen RED→GREEN-Plan. Der Worktree/Branch bleibt für weitere Implementierung und Integration erhalten.
