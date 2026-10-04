# F09 Optionaler lokaler ONNX-Embeddingprovider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Vektorsuche ohne dauerhaft laufenden Ollama-Dienst anbieten.

**Architecture:** Eine providerneutrale Schnittstelle extrahiert die bestehenden Embeddingcalls. Ollama bleibt Adapter und Default; ONNX nutzt bereits installierte Runtime/Tokenizer, aber eigene Modellmetadaten. ContextFit bleibt unverändert embeddingfrei.

**Tech Stack:** TypeScript, Vitest, SQLite, bestehende Adapter-/Controllerarchitektur.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, F09; der Feature-Vertrag unten konkretisiert dessen Lieferung.

**Status:** Abgeschlossen; TDD, native Integration und unabhängige Nachprüfung dokumentiert unter `../verification/2026-10-03-f09-local-onnx-embeddings.md`.

**Voraussetzungen:** keine; Lieferung nach F08 bevorzugt.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine Cloudpflicht, keine Telemetrie; echte lokale Fixtures statt Mocks der zu prüfenden Kernlogik.
- Markdown ist Quelle; SQLite ist rekonstruierbar; FS-Zugriff bleibt im Adapter.
- F01-Sperren, Provenienz, Sentinel-, Pfad- und OCC-Prüfungen bleiben wirksam.
- Die 23 v1-Aufrufe behalten Namen und Eingabeschemas. Standardkatalog bleibt 32 kanonische Tools; neue Aktionen nur explizit aktiviert.
- Zuerst Verhaltenstest RED beobachten, minimal GREEN implementieren, dann refaktorieren und gesamte Regression prüfen.

## Feature-Vertrag und Interfaces

`EmbeddingProvider={identity:{provider:string;model:string;revision:string;dimensions:number};embed(texts:string[]):Promise<number[][]>;close():Promise<void>}`. `meanPool(hidden:Float32Array,mask:bigint[],tokens:number,dimensions:number):number[]`; `normalizeVector(vector:number[]):number[]`. Modelmanifest pins Dateien/SHA256/tokenization/pooling/dimensions; standard candidate multilingual-e5-small mit Query-/Passagepräfixen und lokal bereitgestellten Assets.

## Dateien und Zuständigkeit

- Create: `src/embeddings/types.ts`, `src/embeddings/ollama.ts`, `src/embeddings/onnx.ts`, `src/embeddings/onnx.test.ts`, `src/embeddings/provider.integration.test.ts`
- Modify: `src/config/loader.ts`, `src/types.ts`, `src/indexer/index.ts`, `src/search/hybrid.ts`, `src/cli.ts`, `src/server.ts`, `src/db/queries/embeddings.ts`
- Modify: `README.md`, `CHANGELOG.md` — Bedienung, Defaults, Fehler- und Migrationsverhalten.

## Migration und Kompatibilität

Neue Vektoren in separatem Modelnamespace/ShadowIndex; niemals bestehende Vektoren überschreiben. ONNX Runtime/Tokenizer Dependencies sind vorhanden; kein FastEmbed/Python-Dienst nötig. Modellassets werden vom Nutzer explizit installiert, nicht automatisch aus dem Testnetz geladen.

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
import {meanPool,normalizeVector} from "./onnx.js";
it("ignores padded tokens and normalizes the pooled vector", () => {
  expect(meanPool(new Float32Array([3,4,99,99]),[1n,0n],2,2)).toEqual([3,4]);
  expect(normalizeVector([3,4])).toEqual([0.6,0.8]);
});
```

- [x] **Step 2: RED prüfen.**

Run: `npm test -- src/embeddings/onnx.test.ts`

Expected: mindestens der primäre Erwartungswert schlägt mit bisher fehlender/falscher Funktionalität fehl. Bei Import-/ABI-Fehler erst Umgebung korrigieren und erneut laufen lassen.

- [x] **Step 3: Kernlogik implementieren.** Folgender Kernbaustein legt das Verhalten fest; im Modul in die oben deklarierte Funktion einbetten und die genannten Fehlerfälle jeweils mit eigenem RED→GREEN bearbeiten.

```ts
const pooled = Array(dimensions).fill(0) as number[];
let count=0;
for(let token=0;token<tokens;token++) if(mask[token] !== 0n) {
  count++; for(let d=0;d<dimensions;d++) pooled[d]! += hidden[token*dimensions+d]!;
}
if(count===0) throw new Error("empty attention mask");
return pooled.map(value => value/count);
```

Verbindliche Fallmatrix: Shape mismatch, leere Batch, nonfinite output, zero vector, padded tokens, multiple texts Reihenfolge, zu langer Text deterministisch truncate; Query/Passage-Präfixe spezifisch nach Manifest, provider/model/revision/dimensions Identität nicht vermischen.

- [x] **Step 4: GREEN und Refactor.**

Run: `npm test -- src/embeddings/onnx.test.ts`

Expected: sämtliche positiven und negativen Kernfälle bestehen. Bei Aufteilung in mehrere Kernmodule deren Tests zusätzlich in demselben Lauf angeben.

- [x] **Step 5: Commit.**

Run: `git add src && git commit -m "feat: add F09 local-onnx-embeddings core"`

Expected: nur Kernmodule und zugehörige Tests, keine ungeprüften Integrationsänderungen.

### Task 2: Integration, Betriebsverhalten und Abnahme

**Files:** oben genannte bestehende Adapter-/DB-/Controller-/Configmodule, ihre colocated Tests, neue Integrationstests, README und Changelog.

**Interfaces:** Konsumiert genau die Task-1-Signaturen. Produziert den unten festgelegten Nutzerpfad; keine separate Umsetzung derselben Fachlogik im MCP-/CLI-Handler.

- [x] **Step 1: Integrationstest vor Verdrahtung anlegen.** Echte temporäre Quellen/SQLite, deterministische Inputs, manuell erwartete Ausgaben und unveränderte Sideeffects im Fehlerfall verwenden.

Neue Config embedding_provider:"ollama"|"onnx", default ollama; model_path explizit erforderlich ONNX; fehlende Assets diagnostizieren ohne Netzwerkdownload. Index/Search/Shadow-Switch konsumieren identische Provideridentität. Modellnamespace muss provider+model+revision+dimensions enthalten; Query gegen falsche Dimension niemals SQLite-Crash. Tests echte tiny deterministische ONNX fixture, geprüftes Lizenzmanifest, lokale Runtime: output dims/norm/order; echte SQLite index/query flow. Separater optionaler Qualitätstest mit lokal vorhandenem gepinntem multilingual Modell: Deutschparaphrase trifft erwartete Note Top3 gegen ähnlich klingende Distraktoren; keine Speed/Qualitätsbehauptung ohne Messung. Ollama bestehende Tests und ContextFit embeddings:none müssen grün bleiben.

- [x] **Step 2: RED beobachten.**

Run: `npm test -- embeddings`

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

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: integrate F09 local-onnx-embeddings"`

Expected: testbare, eigenständig lieferbare Erweiterung. Unabhängiges Branch-Review prüft Review Focus; wichtige Findings RED→GREEN beheben. Nachweis unter `docs/superpowers/verification/2026-10-03-f09-local-onnx-embeddings.md`: RED-Auszug, GREEN-Zahl, Regression/Build, Migration und begrenzte bekannte Einschränkungen.
