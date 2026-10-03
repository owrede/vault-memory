# F11 Gesprächsimport mit überprüfbarer Herkunft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gespräche als Quellen importieren und Aussagen erst über den geprüften Agenten-Schreibweg ableiten.

**Architecture:** Ein neutrales Conversation-Modell trennt Rohquelle, deterministischen Preview und abgeleitete Aussagen. Import erzeugt source:imported außerhalb von Agenten-MemorySinks; eine separate explizite Promotion schreibt source:agent mit konkreten Quellenreferenzen.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F11; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Geplant. Tests und Kommandos dieses Plans sind Abnahmevorgaben und wurden noch nicht als Implementierungsnachweis ausgeführt.

**Voraussetzungen:** F04, F05, F07.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`Conversation={provider:string;external_id:string;messages:{id:string;role:"user"|"assistant"|"system"|"tool";text:string;at?:string}[]}`. `parseConversation(json:unknown,format:"neutral"|"chatgpt"):Conversation[]`; `renderConversation(c:Conversation):string`; `previewImport(conversations:Conversation[],target:string):{source_id:string;content:string;hash:string;target:string}[]`; `commitImport(preview,deps):Promise<object>`.

## Dateien und Zuständigkeit

- Create: `src/imports/conversation.ts`, `src/imports/conversation.test.ts`, `src/imports/preview.ts`, `src/imports/preview.test.ts`, `src/imports/commit.ts`, `src/imports/commit.test.ts`, `src/imports/promotion.ts`, `src/imports/promotion.test.ts`
- Modify: `src/cli.ts`, `src/server/feature-tools.ts`, `README.md`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Importe liegen in explizit gewähltem Quellordner. Keine automatische Modellanalyse, keine Cloud und kein Import vertraulicher Daten in Testfixtures. Native Conversationformat zuerst, ChatGPT Parser nur gegen dokumentierte aktuelle Referenz implementieren.

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
import {renderConversation} from "./conversation.js";
it("keeps role and message identity in the imported source", () => {
  expect(renderConversation({provider:"neutral",external_id:"c1",messages:[{id:"m1",role:"user",text:"Two pilots"}]}))
    .toBe("# Conversation c1\n\n## m1 · user\n\nTwo pilots\n");
});
```

- [ ] **Step 2: RED prüfen.**

Run: `npm test -- src/imports/conversation.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [ ] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
return "# Conversation " + c.external_id + "\n" + c.messages.map(m =>
  "\n## " + m.id + " · " + m.role + "\n\n" + m.text + "\n"
).join("");
// parseConversation validiert Rollen und externe IDs; fremde IDs nie als ungeprüften Dateipfad verwenden.
```

Verbindliche Fallmatrix: Unbekanntes Format; malformed JSON; doppelte Message-ID; Werkzeugantwort keine Useraussage; fehlender Zeitstempel nicht erfinden; nichttextuelle Anhänge als explicit unsupported; externe IDs mit ../ bleiben sanitized; ChatGPT branching/current_node statt alle Varianten doppelt importieren.

- [ ] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/imports/conversation.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [ ] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F11 conversation-import core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [ ] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

CLI import --format neutral|chatgpt --input file --target obsidian-fs://vault/imports/ --preview standardmäßig nur Vorschau; --commit mit zuvor gespeicherter Manifestdatei und erwarteten Sourcehashes. Providerexport-Formate an versionierten Originalfixtures aus offiziellen Exportbeispielen prüfen; Schemaänderung liefert unsupported_format statt stillschweigend leerem Import. Rohquelle source:imported, import_source_id, import_hash, imported_at erhalten. Contenthash + Provider + external_id macht wiederholten identischen Import idempotent; geänderter Export braucht erwarteten bestehenden DocHash, locked/OCC verhindern Änderungen. Promotion nimmt ausgewählte message_ids/claims, erstellt evidence DocId#message_id, source:agent und confidence gemäß Ableitungsart via record_observation. Tests echte Delivery/Sink: identischer Import kein zusätzlicher Auditwrite; Exportupdate conflict ohne Hash; Quelle darf nicht in MemorySink; Promotion ohne existierende Quellmessage abgelehnt.

- [ ] **Step 2: RED beobachten.**

Run: `npm test -- imports`

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

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F11 conversation-import"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f11-conversation-import.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
