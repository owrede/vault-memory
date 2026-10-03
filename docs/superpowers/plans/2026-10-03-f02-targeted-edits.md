# F02 Gezielte, hashgeschützte Änderungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Abschnitte oder eindeutige Textstellen ändern, ohne den Rest einer Notiz neu zu erzeugen.

**Architecture:** Ein reiner Patch-Interpreter arbeitet auf dem frisch gelesenen Body. Eine explizit aktivierte MCP-Aktion nutzt denselben DeliveryAdapter und den vom Aufrufer gelieferten erwarteten Hash; MemorySinks behalten ihre bestehenden Contracts.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F02; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Implementiert, Gesamtprüfung und unabhängiges Re-review grün; Nachweis in `docs/superpowers/verification/2026-10-03-f02-targeted-edits.md`.

**Voraussetzungen:** F01.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`TextPatch = {kind:"replace"; old_text:string; new_text:string} | {kind:"section"; heading_path:string[]; content:string}`; `patchBody(body:string, patch:TextPatch): {ok:true; body:string} | {ok:false; reason:"ambiguous_target"|"target_not_found"|"invalid_patch"}`. `applyDocumentPatch(deps:{source:SourceConnector;delivery:DeliveryAdapter}, args:{doc_id:DocId;expected_hash:string;patch:TextPatch}): Promise<UpdateResult | {ok:false;reason:"ambiguous_target"|"target_not_found"|"invalid_patch"}>`.

## Dateien und Zuständigkeit

- Create: `src/edit/patch.ts`, `src/edit/patch.test.ts`, `src/edit/apply.ts`, `src/edit/apply.test.ts`, `src/server/feature-tools.ts`, `src/server/feature-tools.test.ts`
- Modify: `src/config/loader.ts`, `src/types.ts`, `src/server.ts`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Keine DB-Migration. Neue opt-in Konfiguration `server.features: string[]`, default `[]`; unbekannte Feature-Namen werden bei Config-Validierung abgelehnt. Optional aktivierte Aktionen sind separat versioniert und erhalten eigene Snapshots.

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
import {patchBody} from "./patch.js";
it("refuses ambiguous replacements without altering the body", () => {
  expect(patchBody("old / old", {kind:"replace", old_text:"old", new_text:"new"}))
    .toEqual({ok:false, reason:"ambiguous_target"});
});
it("preserves surrounding sections", () => {
  expect(patchBody("# A\nKeep\n## B\nOld\n## C\nKeep\n", {kind:"section", heading_path:["A","B"], content:"New\n"}))
    .toEqual({ok:true, body:"# A\nKeep\n## B\nNew\n## C\nKeep\n"});
});
```

- [x] **Step 2: RED prüfen.**

Run: `npm test -- src/edit/patch.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [x] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
// Replace zählt nichtüberlappende Treffer; leerer Suchtext ist ungültig.
const first = body.indexOf(patch.old_text);
if (first < 0) return {ok:false, reason:"target_not_found"};
if (body.indexOf(patch.old_text, first + patch.old_text.length) >= 0)
  return {ok:false, reason:"ambiguous_target"};
return {ok:true, body:body.slice(0, first) + patch.new_text + body.slice(first + patch.old_text.length)};
```

Verbindliche Fallmatrix: Empty old_text → invalid_patch; kein Treffer → target_not_found; Markdown-Codefences enthalten keine echten Überschriften; doppelte Heading-Pfade → ambiguous_target; CRLF bleibt CRLF; gleiche Ersetzung → erfolgreicher No-op ohne Audit. Reuse `src/sections/extract.ts` für Heading-Bereiche statt zweitem Markdown-Parser.

- [x] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/edit/patch.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [x] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F02 targeted-edits core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [x] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

`edit_document({doc_id,expected_hash,patch})` nur für `server.features=["document_edit"]` registrieren. `FEATURE_TOOLS.document_edit` definiert Name/Schema; `registerFeatureTools(server,deps,features): void` ist der einzige Registrar. Frischen Source-Hash mit expected_hash vergleichen, dann `delivery.update(id,{blocks:[{kind:"paragraph",text:patchedBody}],properties:originalProperties},{expectedHash:expected_hash})`; `wikilinks` wird wie bisher entfernt. Tests: echte FS-Notiz mit drei Abschnitten; nur mittlerer Abschnitt geändert; Frontmatter/Bytes anderer Bereiche erhalten; locked/hash mismatch/sink-invalid → keine Datei/DB/Audit/Suppression geändert. Registrierungs-Smoke über echten SDK-InMemoryTransport: deaktiviert unveränderter Standardkatalog; aktiviert genau edit_document zusätzlich; v1-Schemas bleiben unverändert.

- [x] **Step 2: RED beobachten.**

Run: `npm test -- edit`

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

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F02 targeted-edits"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f02-targeted-edits.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
