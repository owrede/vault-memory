# F10 Agenten-Sitzungsstart und provenienztreue Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frische Briefs zum Sitzungsstart und explizite Fortschritts-Checkpoints am Sitzungsende bereitstellen.

**Architecture:** Host-spezifische Adapter erhalten ein gemeinsames, lokal ausführbares Lifecycle-Modul. Start liest bestehende Briefs mit Hash-/Stalenesskontrolle. Checkpoint schreibt ausschließlich über record_observation in einen bestehenden MemorySink und nie automatisch Gesprächsvolltexte.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F10; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Geplant. Tests und Kommandos dieses Plans sind Abnahmevorgaben und wurden noch nicht als Implementierungsnachweis ausgeführt.

**Voraussetzungen:** F03, F07, F08.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`CheckpointInput={session_id:string;event_id:string;sink:string;summary:string;source_doc_ids:string[];observed_at:string}`; `checkpointKey(session_id:string,event_id:string):string` SHA256 mit getrennten Komponenten. `buildSessionContext({topic,max_chars,as_of},deps):Promise<{text:string;citations:object[];stale:boolean;truncated:boolean}>`; `recordCheckpoint(input,deps):Promise<object>`.

## Dateien und Zuständigkeit

- Create: `src/session/context.ts`, `src/session/context.test.ts`, `src/session/checkpoint.ts`, `src/session/checkpoint.test.ts`, `src/session/hooks.ts`, `src/session/hooks.test.ts`
- Modify: `src/cli.ts`, `src/brief/resources.ts`, `src/server/feature-tools.ts`, `README.md`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Opt-in Hooks, keine automatische Änderung globaler Claude/Codex-Konfiguration. Bereits vorhandene Briefs wiederverwenden; keine neue permanente Hintergrundschleife. Idempotenzmigration bei eigener Reservierungstabelle nächste freie Version, stale Reservierungen recoverbar.

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
import {checkpointKey} from "./checkpoint.js";
it("does not confuse concatenated session and event ids", () => {
  expect(checkpointKey("ab","c")).not.toBe(checkpointKey("a","bc"));
  expect(checkpointKey("ab","c")).toBe(checkpointKey("ab","c"));
});
```

- [ ] **Step 2: RED prüfen.**

Run: `npm test -- src/session/checkpoint.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [ ] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
import {createHash} from "node:crypto";
export function checkpointKey(session_id:string,event_id:string):string {
  return createHash("sha256").update(JSON.stringify([session_id,event_id])).digest("hex");
}
// Staleness/validity aus bestehendem Briefcontroller konsumieren; nie mtime als Gültigkeit verwenden.
```

Verbindliche Fallmatrix: Fehlender Sink/Sentinel; leeres Summary/Evidence; stale Brief nach externem Source-Edit; idempotentes wiederholtes Event; gleiche Session neues Event; Host-Timeout beendet Prozess ohne Halbwrite; Inhaltsbudget mit Quellzitaten.

- [ ] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/session/checkpoint.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [ ] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F10 session-checkpoints core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [ ] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

Neue CLI `session start --topic ... --max-chars ... --json`, `session checkpoint --input file.json`; Funktionen deklarieren Adapterdependencies für Brief/record_observation. Provenienz source:agent, evidence:Source-DocIds + session_id/event_id, confidence:inferred, observed_at explizit, type:summary. Idempotenz: checkpoint-Key in dedizierter Property und sink query vor erneuter Erstellung; atomare Reservierung/unique constraint im abgeleiteten Index gegen parallele Hooks, ohne Prüflogik allein. Tests mit echtem Sink + DB: zweimal gleicher event erzeugt genau eine Datei/Auditcreate, parallel ebenfalls eine; staleness nach Dateiedit sichtbar, Fehler führt zu keinem Memorydoc. Beispiel-Hookfiles für unterstützte Hosts mit exakt validierten Eventpayloads; Skripte werden in temporären Harnesses ausgeführt, nicht nur Text geprüft.

- [ ] **Step 2: RED beobachten.**

Run: `npm test -- session`

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

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F10 session-checkpoints"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f10-session-checkpoints.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
