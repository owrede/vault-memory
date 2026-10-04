# F03 Kompakter Kontext und selektive Abschnittslesung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Dokumente zuerst anhand von Metadaten und Outline entdecken und nur benötigte Abschnitte lesen.

**Architecture:** Die bestehende Assembly erhält eine optionale Projektion für v2-Aufrufe. CitationPackets behalten DocId, Quelle und Hash. Ein transparenter Zeichen-Budgetierer schneidet Body-Auszüge ab, ohne gekürzten Text als vollständige Datei zu kennzeichnen.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F03; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Implementiert und unabhängig geprüft; Nachweis `docs/superpowers/verification/2026-10-03-f03-compact-retrieval.md`.

**Voraussetzungen:** keine.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`projectContext(text:string,max_chars:number): {text:string;truncated:boolean;original_chars:number}`. v2 Assembly-Option `projection?: "full"|"metadata"|"sections"`; `max_chars?:number`; `heading_paths?:string[][]`. Omitted/full entspricht bisherigem Verhalten; metadata enthält keinen Body; sections benötigt heading_paths und liefert pro Slice CitationPacket + heading_path + truncation.

## Dateien und Zuständigkeit

- Create: `src/assembly/projection.ts`, `src/assembly/projection.test.ts`
- Modify/Test: `src/assembly/bundle.ts`, `src/assembly/bundle.test.ts`, `src/assembly/dossier.ts`, `src/assembly/dossier.test.ts`, `src/assembly/search-sections.ts`, `src/assembly/search-sections.test.ts`
- Modify: `src/tool-registry.ts`, `src/server/handlers/assembly.ts`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Keine DB-Migration. Nur v2-Optionen und explizit geprüfte Schema-/Snapshot-Erweiterung; ursprüngliche 23 Eingabeschemas unverändert.

## Review Focus

- Gesperrte/readonly/sink-geschützte Quellen bleiben geschützt; Integrationstest nutzt echten Schreibpfad.
- Alte Anfragen ohne neue Optionen bleiben kompatibel; Baseline-Snapshots und Default-Regressionen laufen.
- Ungültige/mehrdeutige Daten erzeugen Diagnose statt Datenverlust; Kernfallmatrix unten.
- Wiederholung/Reindex verändert Ergebnis nicht ungewollt; eigener Idempotenz- oder Wiederholungstest.
- Quellidentität/Hash/Provenienz überlebt die neue Darstellung; Integration prüft exakte erwartete DocIds.

### Task 1: Deterministischer Kern und Fehlerfälle

**Files:** die oben genannten neuen Kernmodule und ihre colocated `.test.ts`-Dateien.

**Interfaces:** Produziert die im Feature-Vertrag exakt definierten Typen und Funktionen. Konsumiert vorhandene Parser/Contract-Utilities nur über deren bestehende Exporte.

- [x] **Step 1: Folgenden primären Verhaltenstest zuerst anlegen.** Exporte mit Signaturen aus dem Feature-Vertrag zunächst als minimale Stubs anlegen (z.B. leere Ergebnislisten); der beobachtete RED muss eine falsche Ergebnisaussage sein, nicht bloß ein fehlender Import.

```ts
import {expect, it} from "vitest";
import {projectContext} from "./projection.js";
it("marks a shortened excerpt explicitly", () => {
  expect(projectContext("abcdef", 3))
    .toEqual({text:"abc", truncated:true, original_chars:6});
});
it("keeps a complete excerpt identifiable", () => {
  expect(projectContext("abc", 3))
    .toEqual({text:"abc", truncated:false, original_chars:3});
});
```

- [x] **Step 2: RED prüfen.**

Run: `npm test -- src/assembly/projection.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [x] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
if (!Number.isInteger(max_chars) || max_chars < 0) throw new RangeError("max_chars must be a non-negative integer");
const truncated = text.length > max_chars;
let end = Math.min(max_chars, text.length);
// Kein einzelner UTF-16 high surrogate am Ende eines gekürzten Ausschnitts.
if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
return {text:text.slice(0,end), truncated, original_chars:text.length};
```

Verbindliche Fallmatrix: Budget 0 → leer und truncated falls Text vorhanden; negative/NaN/nichtganzzahlige Budgets abweisen; Emojis nicht halbieren; leere/vollständige Texte; identische Default-Payload vor/nach Änderung. metadata darf Body weder direkt noch über backlink property_snippet ausgeben.

- [x] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/assembly/projection.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [x] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F03 compact-retrieval core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [x] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

v2 get_document_bundle und assemble_dossier akzeptieren zusätzliche Optionen, v1 read_note/search bleiben unverändert. Prüfe echte Notiz mit Outline A/B/C: metadata ohne Textfragmente, sections liefert ausschließlich B mit Ursprungs-Hash und Quellbereich. Budget gilt global über sämtliche Slices, Ausgabe enthält budget_used und excluded/truncated Kennzeichnung; Quellmetadaten zählen separat und sind nie stumm abgeschnitten. Unknown heading_path → target_not_found statt kompletter Datei. Default-Payload mit altem Fixture literal vergleichen. SDK-E2E vergleicht metadata- und full-Antwortgröße für denselben Text und prüft vollständige Zitatfelder.

- [x] **Step 2: RED beobachten.**

Run: `npm test -- assembly`

Expected: neuer Integrationspfad ist noch nicht verdrahtet; konkrete Resultat-/Zustandsassertion scheitert. Bestehende Tests dürfen nicht wegen fehlender Infrastruktur ausfallen. Zusätzlich neue unter anderen Verzeichnissen angelegte Integrationstestdateien explizit angeben.

- [x] **Step 3: Verdrahten und dokumentieren.** Daten vom frisch gelesenen SourceConnector in Task-1-Kern geben, Resultat über bestehenden Controller zurückführen. Für Mutationen ausschließlich DeliveryAdapter mit echtem expectedHash. Neue SQL-Operationen verwenden gebundene Parameter/Transaktionen. Folgende gemeinsame Mutation ist verbindlich:

```ts
const original = await source.readDocument(docId);
// Patch/Importpayload nach dem Feature-Vertrag bilden; source.hash nie selbst erfinden.
const result = await delivery.update(docId, patch, {expectedHash: original.hash});
if (!result.ok) return result; // document_locked/OCC/provenance bleiben unverändert sichtbar.
```

Bei reinen Abruf-/Inferenzfeatures entfällt dieser Mutationspfad vollständig. Dokumentation erklärt Aktivierung, Default, konkrete Beispielanfrage, Konfliktbehandlung und den oben beschriebenen Migrationsweg.

- [x] **Step 4: GREEN und Gesamtprüfung.**

Run: `npm test && npm run lint && npm run lint:adapters && npm run build`

Expected: alle lokalen Tests inklusive neuer Integrationstests und unveränderter v1-Eingabeschemas grün; keine Adapterimportverletzung; CLI-/Serverbundles erfolgreich. Migrationsfeatures zusätzlich auf frisch initialisierter und aktualisierter SQLite prüfen. ONNX-/Host-Netzwerktests dürfen die Standardtests nicht von externen Diensten abhängig machen.

- [x] **Step 5: Commit, Review und Nachweis.**

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F03 compact-retrieval"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f03-compact-retrieval.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
