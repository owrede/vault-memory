# F04 Kategorisierte Aussagen innerhalb von Dokumenten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einzelne Fakten, Entscheidungen und Präferenzen mit Dokumenthash und Quellbereich indexieren.

**Architecture:** Ein deterministischer Markdown-Parser erkennt explizit markierte Listenpunkte und ignoriert Codefences. Eine abgeleitete SQLite-Tabelle speichert Kategorie/Text/Quellbereich; die Markdown-Datei und deren Provenienz bleiben autoritativ. Bestehendes record_observation bleibt kompatibel.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F04; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Geplant. Tests und Kommandos dieses Plans sind Abnahmevorgaben und wurden noch nicht als Implementierungsnachweis ausgeführt.

**Voraussetzungen:** F03.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`ObservationDraft={category:string;text:string;line_start:number;line_end:number}`; `parseObservations(body:string): ObservationDraft[]`. `ObservationQueries.replaceForNote(noteId:number,docHash:string,rows:ObservationDraft[]):void`, `listForNote(noteId:number,category?:string): ObservationRow[]`; `ObservationRow` ergänzt `{id:number;note_id:number;doc_hash:string}`.

## Dateien und Zuständigkeit

- Create: `src/observations/parse.ts`, `src/observations/parse.test.ts`, `src/db/queries/observations.ts`, `src/db/queries/observations.test.ts`, `src/observations/index.integration.test.ts`
- Modify: `src/db/schema.ts`, `src/db/database.ts`, `src/indexer/index.ts`, `src/assembly/bundle.ts`, `src/assembly/search-sections.ts`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Abgeleitete Tabelle; bestehende Vaults benötigen Backfill/Reindex. Migration übernimmt keine freie Textinferenz und verändert keine Markdown-Dateien. Stale Indexkennzeichnung bei noch nicht reindexierten Quellen.

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
import {parseObservations} from "./parse.js";
it("anchors explicit observations and ignores fenced examples", () => {
  expect(parseObservations("# Oliver\n- [preference] Async writing\n```md\n- [fact] Example\n```\n"))
    .toEqual([{category:"preference",text:"Async writing",line_start:2,line_end:2}]);
});
```

- [ ] **Step 2: RED prüfen.**

Run: `npm test -- src/observations/parse.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [ ] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
// Nach Fence-/Listen-Kontextbestimmung für jede echte Listenzeile:
const match = /^\s*[-*+] \[([a-z][a-z0-9_-]*)\]\s+(.+)$/.exec(line);
if (match) rows.push({category:match[1]!, text:match[2]!, line_start:lineNumber, line_end:lineNumber});
// Fortsetzungszeilen einer Liste an denselben Draft hängen; freie Absätze nie aufnehmen.
```

Verbindliche Fallmatrix: Mehrzeilige Bullet-Aussage; verschachtelte Listen; normale Checkbox [x] nicht als Kategorie; leere Kategorie/Text; CRLF-Zeilenzählung; Codefence mit Backticks/Tilden; unbekannte explizite Kategorie behalten; keine KI-inferierten Aussagen ohne Evidence.

- [ ] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/observations/parse.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [ ] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F04 categorized-observations core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [ ] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

Neue nächste freie Migration in src/db/schema.ts anlegen: observations(id,note_id FK ON DELETE CASCADE,doc_hash,category,text,line_start,line_end), Index(note_id,category), CHECK line_end>=line_start. QueryNamespace an Database binden, idempotente Migration testen. Indexer tauscht alle Aussagen eines Dokuments in derselben Transaktion wie Note/Sections aus. Normaler Reindex/Write/Delete/Umbenennung darf keine verwaisten Aussagen lassen. Tests mit echter SQLite: initial 2 statements, Edit entfernt eines und ändert Text des anderen, Delete leert Tabelle; vollständiger Reindex reproduziert dieselben Inhalte. Bundle/section retrieval liefert Aussagen nur mit frischem DocHash; source/evidence/confidence aus der Quelle erhalten. `record_observation` schreibt unverändert ganze Memory-Dokumente und deren verpflichtende Provenienz.

- [ ] **Step 2: RED beobachten.**

Run: `npm test -- observations`

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

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F04 categorized-observations"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f04-categorized-observations.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
