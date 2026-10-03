# Basic-Memory-Ideen für vault-memory

Stand: 2026-10-03. vault-memory: `9bc728e`, 2.4.1. Referenz: Basic Memory `194afe165b3e7676496aaa53b70e39a78ea5aa4f`, lokal installiert und mit CLI/MCP geprüft. Ausgangslage: 1.781 bestandene Tests, 16 übersprungen unter Node 24.11.1.

## Ziel und Grenzen

Wissen feiner darstellen, gezielter abrufen und sichere Bearbeitung erleichtern. Basic Memory liefert Ideen; seine Implementierung wird nicht kopiert. vault-memory behält seinen Provenienzvertrag, den Schutz von MemorySinks, aktive statt supersedierte Suchergebnisse und lokale Verarbeitung. Dieses Programm besteht aus elf unabhängig abnehmbaren Lieferungen. In der ersten Lieferung wird F01 vollständig umgesetzt; F02–F11 sind anschließend ausführbare Ausbaupläne, keine bereits implementierten Funktionen.

## Globale Anforderungen

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- TypeScript, Vitest, SQLite; keine Cloudpflicht und keine Telemetrie.
- Kanonische Obsidian-Dateien sind die Wahrheitsquelle; SQLite bleibt ein rekonstruierbarer Index.
- Dateisystemzugriffe bleiben in Adaptern; Controller verwenden SourceConnector und DeliveryAdapter.
- Bestehende Provenienz-, Sentinel-, Pfad- und Hash-Prüfungen bleiben erhalten.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Ohne neue Optionen bleibt das bisherige Verhalten ungeschützter Dokumente erhalten.
- Neue Tool-Aktionen werden bei Bedarf in explizit aktivierten Featuremodulen registriert. Der Standard bleibt bei 32 kanonischen Tools und fünf deprecated Aufrufen; keine heimliche Vergrößerung des Basiskatalogs.
- Jede Verhaltensänderung beginnt mit einem wirklich fehlgeschlagenen Verhaltenstest; Import- oder Umgebungsfehler zählen nicht als RED.
- Featureabnahme: gezielte Tests, betroffene Regressionen, `npm test`, `npm run lint`, `npm run lint:adapters` und `npm run build`.
- Lokale Zeitstempel und Modelle werden explizit übergeben; keine versteckten Netzwerkabrufe in Tests.

## Reihenfolge und Lieferumfang

| Rang | Feature | Verbesserung und konkreter Nutzen | Voraussetzung | Aufwand* |
|---|---|---|---|---|
| F01 | Dokumentensperren | `locked: true` verhindert Änderungen und Löschung über alle bestehenden Schreibwege; freigegebene Notizen bleiben geschützt. | keine | S |
| F02 | Gezieltes Editieren | Überschriftenabschnitt oder eindeutige Textstelle mit erwartetem Hash bearbeiten; weniger vollständige Überschreibungen. | F01 | M |
| F03 | Kompakter Kontextabruf | Metadaten/Outline zuerst, angeforderte Abschnitte danach; Umfang und Abschneidung werden sichtbar. | keine | M |
| F04 | Kategorisierte Beobachtungen | Aussagen wie `[preference]` oder `[decision]` mit Quellzeilen indexieren und gezielt zitieren. | F03 | L |
| F05 | Fachliche Beziehungen | `owns`, `depends_on` usw. auf bestehende `Edge.rel` abbilden und nach Relation/Richtung abrufen. | F04 | M |
| F06 | Schema-Prüfung und Drift | Aus Beobachtungen/Feldern Kandidaten ableiten, gegen explizite Schemas prüfen und Abweichungen vergleichen. | F04, F05 | L |
| F07 | Fachliche Gültigkeitszeit | `valid_from`/`valid_to` von `observed_at` trennen; aktuelle und historische Aussagen passend filtern. | F04, F06 | L |
| F08 | CLI, Handbuch und Tool-Hinweise | Bestehende Server-/Index-CLI um Such-/Lese-/Editierbefehle und bedarfsgerechte MCP-Dokumentation erweitern. | F02, F03 | M |
| F09 | Lokaler ONNX-Embeddingprovider | Optionaler Provider ohne Ollama-Dienst, mit ehrlicher Modellidentität und Dimensionalität. | keine; nach Abrufverbesserungen | L |
| F10 | Sitzungsstart und Checkpoints | Vorhandene Briefs für explizit aktivierte Agentenintegrationen nutzen; Fortschritt mit Provenienz speichern. | F03, F07, F08 | M |
| F11 | Provenienztreuer Gesprächsimport | Gespräche in überprüfbare Quellen und erst danach freigegebene Beobachtungen überführen. | F04, F05, F07 | L |

*S/M/L sind relative Komplexität, keine zugesagten Kalenderzeiten. F08/F09 können nach ihren Voraussetzungen parallel zu F04–F07 entstehen. Die angegebene Reihenfolge bevorzugt zuerst überprüfbare, risikoarme Verbesserungen und anschließend Änderungen am Wissensmodell. F02 wird vor F03 geliefert, weil alle späteren Agentenschreibwege denselben sicheren Editierpfad nutzen sollen.

## Vorhandene Bausteine statt Doppelentwicklung

- F01/F02: `src/adapters/delivery/obsidian-fs/write.ts`, `src/frontmatter/update.ts`, `src/memory/tools/supersede.ts` besitzen bereits OCC, Audit und Sink-Schutz.
- F03: `src/assembly/bundle.ts`, `src/assembly/dossier.ts`, `src/assembly/search-sections.ts` und `src/memory/citation-packet.ts` liefern bereits Kontext und Zitate.
- F04: `record_observation` erzeugt heute vollständige Memory-Dokumente; Aussagen innerhalb eines Dokuments werden zusätzlich als abgeleitete Datensätze indexiert, nicht als zweite Wahrheit gespeichert.
- F05: `src/db/queries/edges.ts` besitzt bereits `rel`; `src/indexer/extract-edges.ts` kennt technische Edge-Typen. Fachliche Relationen ersetzen diese nicht.
- F06: `src/schema/` schlägt bereits Frontmatterwerte aus Ordnern, Nachbarn und Inhalt vor. `src/contracts/` und der MemoryContract sind verbindliche Verträge. Abgeleitete Kandidaten dürfen sie nicht abschwächen.
- F07: Status-/Supersede-Filter sind vorhanden. Fachliche Gültigkeit ist ein zusätzlicher Filter; Beobachtungsdatum bleibt ein Provenienzfeld.
- F08: `src/cli.ts` besitzt `serve`, `index`, `add-vault`; erweitert werden Wissenszugriff und Dokumentation.
- F09: ONNX wird bereits fürs Reranking verwendet; ContextFit ist bereits ein CPU-basierter Abruf ohne Embeddings. ONNX-Embeddings werden deshalb optional, nicht der neue Pflichtstandard.
- F10: `src/brief/daemon.ts` besitzt bereits Briefs und Stalenessprüfung. Host-Hooks konsumieren diesen Mechanismus.
- F11: Importe dürfen `source: imported` außerhalb von Agenten-MemorySinks schreiben. Agentisch abgeleitete Aussagen benötigen separat `source: agent`, Evidence und Confidence.

## F01: verbindliche Semantik

1. Nur der boolesche Wert `locked: true` im aktuell gespeicherten Dokument sperrt. `false`, fehlend, `null` und die Zeichenkette `"true"` bleiben ungesperrt.
2. Erstellen einer bereits gesperrten Notiz und Setzen der Sperre auf einer ungesperrten Notiz sind zulässig, sofern alle bisherigen Guards bestehen.
3. Bestehende gesperrte Dokumente dürfen über DeliveryAdapter weder überschrieben, aktualisiert, gelöscht noch supersediert werden. Eingehendes `locked: false`, Entfernen des Feldes oder ein richtiger Hash erlauben keinen Bypass.
4. Die Obsidian-Prüfung liest die kanonische Datei frisch; ein veralteter SQLite-Eintrag entsperrt nichts. Der Stub bildet dieselbe Semantik auf seinem gespeicherten Dokument ab.
5. Ablehnung: `{ok: false, reason: "document_locked", message: ...}`. Frontmatter- und MCP-Ergebnisse erhalten diesen Grund, statt ihn als Hash-Konflikt zu maskieren.
6. Sink-/Provenienz-/Sentinel-, Pfad- und Read-only-Guards behalten ihren bisherigen Vorrang. Bei einer erreichten, existierenden Datei wird die Sperre vor dem Hash geprüft. Fehlendes Pflicht-`expectedHash` am Adapter darf weiterhin `hash_mismatch` ergeben; das erlaubt keine Mutation.
7. Auch leere Frontmatter-Aufträge an ein gesperrtes Dokument werden als `document_locked` abgelehnt. Reines Lesen bleibt zulässig.
8. Abgewiesene Schreibvorgänge verändern weder Datei, DB, Audit noch Watcher-Suppression. Suppression wird deshalb erst unmittelbar vor einem echten Schreibzugriff gesetzt.
9. Entsperren erfolgt durch direkte Bearbeitung der Markdown-Datei in Obsidian/einem Editor und anschließendes erneutes Lesen. Es gibt keinen Agenten-Override. Das ist eine Anwendungssperre, keine Betriebssystem-Zugriffskontrolle; externe Schreibvorgänge können mit dem bestehenden OCC-Mechanismus konkurrieren.
10. Kein neues Tool, kein geändertes v1-Eingabeschema, keine DB-Migration, keine neue Abhängigkeit für F01.

## TDD und Liefernachweise

Jeder Plan benennt konkrete Dateien, Interfaces, Testfälle und RED/GREEN-Kommandos. Tests verwenden echte temporäre Dateien, In-memory-SQLite und reale Adapter; Mocking nur an langsamen externen Modell-/Hostgrenzen. Abgeleitete Indexdaten erhalten Reindex- und Löschtests. Schreibtests prüfen Bytes, Hash, DB-Zeilen, Audit sowie das Fehlen von Nebenwirkungen bei Ablehnung. Abruf-/Rankingtests verwenden handgeprüfte erwartete Treffer statt Scores, die dieselbe Funktion berechnet.

Pro Lieferung werden commitbarer Code, Tests, Bedienungsdokumentation und ein Prüfbericht gespeichert. Unausgeführte Tests in F02–F11 sind geplante Abnahmekriterien. Testausgaben und Zustand stehen in den Ausführungsnachweisen, nicht in bloßen Erfolgsbehauptungen.

## Quellen

- [Basic Memory, geprüfter Stand](https://github.com/basicmachines-co/basic-memory/tree/194afe165b3e7676496aaa53b70e39a78ea5aa4f)
- Lokale Installation: `/Users/wrede/IA/testground/basic-memory`; MCP-/Schema-/Suchnachweise: `/Users/wrede/IA/testground/basic-memory-lab/results`.
- Vergleichsbericht: `/Users/wrede/Documents/GitHub/vault-memory/.lavish/basic-memory-vergleich-2026-10-03.html`.

## Planindex

Je Feature liegt ein eigener Plan unter `docs/superpowers/plans/2026-10-03-fNN-*.md`. Die Ausführung erfolgt zunächst inline für F01 mit anschließendem unabhängigem Code-Review. Ein Worktree unter `/private/tmp/vault-memory-basic-memory-features` hält den bisherigen Checkout sauber. Der Nutzer hat Erstellung der Pläne und anschließenden Implementierungsbeginn bereits beauftragt.

## Einzelpläne

- [document-locks](../plans/2026-10-03-f01-document-locks.md)
- [targeted-edits](../plans/2026-10-03-f02-targeted-edits.md)
- [compact-retrieval](../plans/2026-10-03-f03-compact-retrieval.md)
- [categorized-observations](../plans/2026-10-03-f04-categorized-observations.md)
- [domain-relations](../plans/2026-10-03-f05-domain-relations.md)
- [schema-validation-drift](../plans/2026-10-03-f06-schema-validation-drift.md)
- [valid-time](../plans/2026-10-03-f07-valid-time.md)
- [cli-manuals](../plans/2026-10-03-f08-cli-manuals.md)
- [local-onnx-embeddings](../plans/2026-10-03-f09-local-onnx-embeddings.md)
- [session-checkpoints](../plans/2026-10-03-f10-session-checkpoints.md)
- [conversation-import](../plans/2026-10-03-f11-conversation-import.md)
