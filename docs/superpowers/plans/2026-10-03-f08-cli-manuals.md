# F08 Wissens-CLI und bedarfsgerechtes Handbuch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suchen, Lesen und sicheres Editieren über Skripte ermöglichen und Toolwissen gezielt abrufbar machen.

**Architecture:** CLI dispatcht dieselben Anwendungscontroller wie MCP. Maschinenlesbarer Output geht auf stdout, Logs/Fehler auf stderr. Ein versioniertes Handbuch wird als MCP-ResourceTemplate und CLI man geliefert; passende readOnly/destructive/idempotent-Hinweise werden aus tatsächlichem Verhalten abgeleitet.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F08; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Geplant. Tests und Kommandos dieses Plans sind Abnahmevorgaben und wurden noch nicht als Implementierungsnachweis ausgeführt.

**Voraussetzungen:** F02, F03.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`parseKnowledgeArgs(args:string[]):{command:"search"|"read"|"edit"|"man";vault?:string;query?:string;doc_id?:string;expected_hash?:string;json:boolean;patch_file?:string;topic?:string}`. `runKnowledgeCommand(args,deps,io:{stdout:(s:string)=>void;stderr:(s:string)=>void}):Promise<number>`. Exit codes 0 success, 2 invalid input, 3 missing doc, 4 conflict, 5 unavailable backend.

## Dateien und Zuständigkeit

- Create: `src/cli/knowledge.ts`, `src/cli/knowledge.test.ts`, `src/manual/catalog.ts`, `src/manual/catalog.test.ts`, `src/cli/knowledge.integration.test.ts`
- Modify: `src/cli.ts`, `src/resource-registry.ts`, `src/tool-registry.ts`, `src/server.ts`, `README.md`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Kein globales Clientconfig-Schreiben. Neue CLI-Befehle additive; serve/index/add-vault bleiben unverändert. Installierte lokale man-Datei optional, MCP-Handbuch canonical.

## Review Focus

- Gesperrte/readonly/sink-geschützte Quellen bleiben geschützt; Integrationstest nutzt echten Schreibpfad.
- Alte Anfragen ohne neue Optionen bleiben kompatibel; Baseline-Snapshots und Default-Regressionen laufen.
- Ungültige/mehrdeutige Daten erzeugen Diagnose statt Datenverlust; Kernfallmatrix unten.
- Wiederholung/Reindex verändert Ergebnis nicht ungewollt; eigener Idempotenz- oder Wiederholungstest.
- Quellidentität/Hash/Provenienz überlebt die neue Darstellung; Integration prüft exakte erwartete DocIds.

### Task 1: Deterministischer Kern und Fehlerfälle

**Files:** die oben genannten neuen Kernmodule und ihre colocated `.test.ts`-Dateien.

**Interfaces:** Produziert die im Feature-Vertrag exakt definierten Typen und Funktionen. Konsumiert vorhandene Parser/Contract-Utilities nur über deren bestehende Exporte.

- [ ] **Step 1: Folgenden primären Verhaltenstest zuerst anlegen.** Exporte mit Signaturen aus dem Feature-Vertrag zunächst als minimale Stubs anlegen (z.B. leere Ergebnislisten); der beobachtete RED muss eine falsche Ergebnisaussage sein, nicht bloß ein fehlender Import.

```ts
import {expect, it} from "vitest";
import {parseKnowledgeArgs} from "./knowledge.js";
it("refuses an edit that cannot prove the version read", () => {
  expect(() => parseKnowledgeArgs(["edit","--doc-id","obsidian-fs://main/A.md","--patch-file","patch.json"]))
    .toThrow("--expected-hash");
});
```

- [ ] **Step 2: RED prüfen.**

Run: `npm test -- src/cli/knowledge.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [ ] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
if (command === "edit" && !expected_hash) throw new Error("edit requires --expected-hash");
// Reuse search/assembly/edit controller. Keine zweite Such-/Schreiblogik.
// JSON pro Aufruf ein vollständiges Objekt + newline; niemals Logging auf stdout.
```

Verbindliche Fallmatrix: Unicode und Leerzeichen in DocId/query; stdin deaktiviert sofern keine explizite - Option; unbekannte Flags fehlen nicht still; Konflikte exit4 mit structured reason; read_only Felder ehrlich für audit/read/index/write; Schema-Version im Handbuch.

- [ ] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/cli/knowledge.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [ ] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F08 cli-manuals core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [ ] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

`vault-memory search --vault V --query Q --json`, `read --doc-id ID --projection metadata --json`, `edit --doc-id ID --expected-hash H --patch-file P --json`, `man edit_document`. E2E startet gebauten CLI-Childprozess mit isoliertem Configpfad (loader bekommt explizites VM_CONFIG_DIR, default unverändert), echter temporärer Vault + SQLite, embeddings:none. Test reads→patch→reads, Konflikt/locked exit4, stdout JSON parsebar und stderr enthält Logs. Register Handbuch `vault-memory://man/{topic}` als ResourceTemplate; Standardliste bleibt13, Templates separat. Toolannotations nur Eigenschaften, die beobachtbare Tests bestätigen; komplette v1 Eingabeschemas unverändert und Metadaten-Snapshot bewusst aktualisiert.

- [ ] **Step 2: RED beobachten.**

Run: `npm test -- cli`

Expected: neuer Integrationspfad ist noch nicht verdrahtet; konkrete Resultat-/Zustandsassertion scheitert. Bestehende Tests dürfen nicht wegen fehlender Infrastruktur ausfallen. Zusätzlich neue unter anderen Verzeichnissen angelegte Integrationstestdateien explizit angeben.

- [ ] **Step 3: Verdrahten und dokumentieren.** Daten vom frisch gelesenen SourceConnector in Task-1-Kern geben, Resultat über bestehenden Controller zurückführen. Für Mutationen ausschließlich DeliveryAdapter mit echtem expectedHash. Neue SQL-Operationen verwenden gebundene Parameter/Transaktionen. Folgende gemeinsame Mutation ist verbindlich:

```ts
const original = await source.readDocument(docId);
// Patch/Importpayload nach dem Feature-Vertrag bilden; source.hash nie selbst erfinden.
const result = await delivery.update(docId, patch, {expectedHash: original.hash});
if (!result.ok) return result; // document_locked/OCC/provenance bleiben unverändert sichtbar.
```

Bei reinen Abruf-/Inferenzfeatures entfällt dieser Mutationspfad vollständig. Dokumentation erklärt Aktivierung, Default, konkrete Beispielanfrage, Konfliktbehandlung und den oben beschriebenen Migrationsweg.

- [ ] **Step 4: GREEN und Gesamtprüfung.**

Run: `npm test && npm run lint && npm run lint:adapters && npm run build`

Expected: alle lokalen Tests inklusive neuer Integrationstests und unveränderter v1-Eingabeschemas grün; keine Adapterimportverletzung; CLI-/Serverbundles erfolgreich. Migrationsfeatures zusätzlich auf frisch initialisierter und aktualisierter SQLite prüfen. ONNX-/Host-Netzwerktests dürfen die Standardtests nicht von externen Diensten abhängig machen.

- [ ] **Step 5: Commit, Review und Nachweis.**

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F08 cli-manuals"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f08-cli-manuals.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
