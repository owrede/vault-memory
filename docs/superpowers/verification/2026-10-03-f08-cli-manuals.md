# F08 Wissens-CLI und Handbuch — TDD und Abnahme

Code eec18e9, f3dff1d, 7206577.

Strenge CLI-Argumente, sichere DocId/Hash/Patch-Übergabe an vorhandenen Editcontroller, JSON stdout und Diagnose stderr. Exitcodes 0/2/3/4/5; read/search as_of; separate versionierte MCP-Handbuchvorlage, bestehende 13 Ressourcen und 23 v1-Schemas unverändert. VM_CONFIG_DIR isoliert Konfiguration und SQLite. Separate Toolannotations-Snapshotdatei.

RED: sieben Parserfälle, ein Handbuchfall, zwei echte gebaute CLI-Integrationen. Danach grün. Review fand fehlenden Reindexclient, umgangenes ContextFit-Routing, implizite Sink-Provisionierung beim Lesen und falsche Annotationshinweise. Zusätzliche echte CLI-Tests reproduzierten Fehler vor Korrektur; anschließend alle fünf CLI-Fälle grün, einschließlich lokalem HTTP-Embedding-Testserver und unveränderter gesperrter Datei. Lese-/Suchaufrufe laden keine Sink-Konfiguration; Edit registriert Guards ohne Sentinel-Provisionierung.

Gesamtprüfung vor Review: 2023 bestanden, 16 übersprungen; zusätzlich separater Annotationstest grün. Spätere vollständige Regression nach Review und F09: 2044 bestanden, 17 übersprungen. TypeScript, Adapterprüfung und Build erfolgreich Node24. Unabhängige Nachprüfung7206577: 111 bestanden, 11 übersprungen, keine offenen Befunde.

Die volle CLI-Leseprojektion verwendet ein 6000-Zeichen-Budget und meldet Kürzung. Der bestehende KontextFit-Dispatcher bestimmt dessen Suchverhalten. Kein globales Hostconfig-Schreiben. CLI-Edits benötigen document_edit-Aktivierung. Index-Refreshfehler erhalten die erfolgreiche kanonische Änderung mit pending-Diagnose.
