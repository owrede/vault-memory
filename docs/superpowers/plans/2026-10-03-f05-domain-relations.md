# F05 Fachliche Beziehungen im bestehenden Graphen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fachliche Beziehungen wie owns und depends_on zusätzlich zur technischen Linkart abfragen.

**Architecture:** Neue Syntax wird auf die bereits vorhandene Edge.rel abgebildet. Edge.type bleibt wikilink/mention/frontmatter-ref/hyperlink; keine zweite Graphtabelle. Richtung und Quelle sind explizit, unbelegte Umkehrrelationen werden nicht erfunden.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F05; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Geplant. Tests und Kommandos dieses Plans sind Abnahmevorgaben und wurden noch nicht als Implementierungsnachweis ausgeführt.

**Voraussetzungen:** F04.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`DomainRelation={rel:string;target:string;line:number}`; `parseDomainRelations(body:string):DomainRelation[]`. Erweiterung v2 `expand` um `rels?:string[]` und `direction?:"outgoing"|"incoming"|"both"`; ohne Filter gilt bisheriges Verhalten. Query-Layer benutzt gebundene Parameter, nie SQL-String-Konkatenation.

## Dateien und Zuständigkeit

- Create: `src/relations/parse.ts`, `src/relations/parse.test.ts`, `src/relations/graph.integration.test.ts`
- Modify/Test: `src/indexer/extract-edges.ts`, `src/indexer/extract-edges.test.ts`, `src/db/queries/edges.ts`, `src/db/queries/edges.test.ts`, `src/graph/expand.ts`, `src/graph/expand.test.ts`
- Modify: `src/tool-registry.ts`, `src/server/handlers/graph.ts`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Kein neuer EdgeType; vor Änderung SQLite-Unique-Index prüfen, erforderliche nächste freie Migration erhält bisherige Kanten. Backfill optional durch Reindex, keine automatische Markdown-Umschreibung.

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
import {parseDomainRelations} from "./parse.js";
it("keeps role and direction from an explicit relation", () => {
  expect(parseDomainRelations("## Relations\n- owns [[Atlas]]\n- depends_on [[Budget|Funding]]\n"))
    .toEqual([{rel:"owns",target:"Atlas",line:2},{rel:"depends_on",target:"Budget",line:3}]);
});
```

- [ ] **Step 2: RED prüfen.**

Run: `npm test -- src/relations/parse.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [ ] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
// Nur unter einer echten Überschrift Relations und außerhalb von Codefences:
const match = /^\s*[-*+] ([a-z][a-z0-9_]*) \[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*$/.exec(line);
if (match) result.push({rel:match[1]!,target:match[2]!,line:lineNumber});
// extractEdges mappt result auf type:"wikilink", rel, original anchor_line.
```

Verbindliche Fallmatrix: Alias-Zielauflösung; Frontmatter owner/owns behält existing rel; normale Wikilinks unverändert; unknown target als broken relation statt erfundener DocId; verschiedene rel zwischen denselben Knoten bleiben erhalten; keine semantischen Relations aus Codebeispielen.

- [ ] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/relations/parse.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [ ] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F05 domain-relations core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [ ] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

Relations-Syntax nutzt gemeinsame Fence-/Heading-Auswertung aus Sections/Observations. Existing Edge.unique source/target/rel/anchor behält mehrere Rollen. Tests: Oliver owns Atlas, Atlas depends_on Budget; outgoing owns(Oliver) trifft Atlas, incoming owns(Atlas) trifft Oliver, outgoing owns(Atlas) trifft keinen, ungerichteter Default bleibt bisheriger Graph. Quellzeile/hash in graph bundle/expand, confidence nur aus expliziter Quelle. v1 list_forward_links Eingabeschema nicht erweitern; neue Filter gehören v2 expand. Vollreindex und Entfernen einer Relation löschen nur die betroffene Kante.

- [ ] **Step 2: RED beobachten.**

Run: `npm test -- relations`

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

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F05 domain-relations"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f05-domain-relations.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
