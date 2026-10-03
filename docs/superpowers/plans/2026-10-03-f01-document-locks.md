# F01 Dokumentensperren Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Der Nutzer hat Planerstellung und unmittelbaren Implementierungsbeginn beauftragt.

**Goal:** Gesperrte Dokumente über alle bestehenden Schreibwege schützen.

**Architecture:** Eine kleine gemeinsame Policy wertet nur gespeicherte boolesche `locked`-Werte aus. Obsidian prüft frisch gelesene Dateien am atomaren Schreibpfad; der Stub prüft seine gespeicherten Dokumente. Frontmatter und MCP leiten Fehler unverfälscht weiter. Watcher-Suppression wird als optionaler interner Callback erst unmittelbar vor tatsächlichem Schreiben ausgelöst.

**Tech Stack:** TypeScript, Vitest, gray-matter, SQLite, vorhandene Source-/DeliveryAdapter.

**Spec:** `docs/superpowers/specs/2026-10-03-basic-memory-inspired-design.md`, insbesondere F01 Punkte 1–10.

## Global Constraints

- Node.js >=22 <26; Prüfung hier mit Node 24.11.1.
- Keine neue Dependency, kein Tool, keine DB-Migration und keine v1-Schemaänderung.
- Bisherige Provenienz-, Sink-, Sentinel-, Pfad-, Read-only- und OCC-Guards bleiben erhalten.
- Dateisystemzugriffe bleiben in Adaptern. Nur echte temporäre Dateien/In-memory-SQLite in Mutationstests.
- Pflichtabnahme: `npm test`, `npm run lint`, `npm run lint:adapters`, `npm run build`.

## Review Focus

- Vorhandene Datei wird nach Indexierung manuell gesperrt: Task 1 prüft Ablehnung gegen den aktuellen Dateiinhalt und unveränderten DB-Stand.
- Eingehender Payload löscht/überschreibt `locked`: Task 1 prüft Ablehnung unabhängig vom Payload.
- YAML `locked: "true"` ist kein Boolean: Task 1 prüft weiterhin erlaubte Mutation.
- Fehlgeschlagene Mutation unterdrückt spätere externe Dateiereignisse: Task 2 prüft unveränderte echte SuppressionSet.
- Entsperren durch Editor und erneutes Lesen: Task 1 prüft danach erlaubte Änderung mit neuem Hash.

### Task 1: Sperrvertrag am Delivery-Schreibpfad

**Files:**
- Create: `src/adapters/delivery/document-lock.ts` — reine gemeinsame Policy.
- Create/Test: `src/adapters/delivery/obsidian-fs/locked.test.ts` — echte FS-/SQLite-Regressionen.
- Modify/Test: `src/adapters/delivery/conformance.test.ts` — identisches beobachtbares Verhalten für Stub/FS.
- Modify: `src/adapters/delivery/types.ts`, `src/adapters/delivery/obsidian-fs/write.ts`, `src/adapters/stub/delivery.ts`.

**Interfaces:**
- Consumes: `writeNote(input: WriteNoteInput): Promise<WriteResult>`, `deleteNote(input: DeleteNoteInput): Promise<WriteResult>`, bestehende `DeliveryAdapter.write/update/delete`.
- Produces: `DocumentLockedConflict = {ok: false; reason: "document_locked"; message: string}` und `getDocumentLockConflict(properties?: Record<string, unknown> | null): DocumentLockedConflict | null`; V1/V2-Konflikttypen erlauben `document_locked`.

- [ ] **Step 1: Verhaltenstests schreiben.** Neue Datei nutzt `Database(":memory:", "locks")`, Vault `{name:"locks",path:tempDir,write_enabled:true}`, `mkdtemp`, `afterEach` mit DB close + temp cleanup. Dokument über echte `writeNote` anlegen, Bytes/DB/Audit speichern und jeden verbotenen Zugriff prüfen:

```ts
const first = await writeNote({vault, relativePath: "approved.md", content: "Approved", frontmatter: {locked: true}});
if (!first.ok) throw new Error("fixture creation failed");
const before = await fs.readFile(join(vaultDir, "approved.md"), "utf8");
const row = vault.db.notes.getByPath("approved.md");
const audit = vault.db.audit.listWrites({noteId: first.noteId});
const result = await writeNote({vault, relativePath: "approved.md", content: "Changed", frontmatter: {locked: false}, expectedHash: first.newHash});
expect(result).toMatchObject({ok: false, reason: "document_locked"});
expect(await fs.readFile(join(vaultDir, "approved.md"), "utf8")).toBe(before);
expect(vault.db.notes.getByPath("approved.md")).toEqual(row);
expect(vault.db.audit.listWrites({noteId: first.noteId})).toEqual(audit);
```

Weitere konkrete Fälle: Löschung mit richtigem Hash; Overwrite ohne Frontmatter; stale Hash bei gesperrter Datei; direkt auf Disk neu gesetzte Sperre bei veraltetem Index; Callback nicht aufgerufen; ungesperrt→gesperrt zulässig; neu gesperrt anlegen zulässig; `false`, `null`, fehlend, `"true"` editable; manuell entsperren→frischen `ObsidianFsSource.readDocument(id).hash` nutzen→Update zulässig; Read-only bleibt `permission_denied`. Conformance: jede der Operationen `write`, `update`, `delete` gegen erstellt gesperrtes Dokument für beide Adapter ablehnen und Original über realen Source/Dateiinhalt erhalten; Stub-Map zusätzlich in eigenen Testfällen prüfen.

- [ ] **Step 2: RED beobachten.**

Run: `npm test -- src/adapters/delivery/obsidian-fs/locked.test.ts src/adapters/delivery/conformance.test.ts`

Expected: Assertions erwarten `document_locked`, bekommen bisher `ok:true` oder `hash_mismatch`. Keine Import-/ABI-Fehler; Node 24 verwenden.

- [ ] **Step 3: Minimale Policy und Guards implementieren.**

```ts
export interface DocumentLockedConflict {
  ok: false;
  reason: "document_locked";
  message: string;
}
export function getDocumentLockConflict(properties?: Record<string, unknown> | null): DocumentLockedConflict | null {
  return properties?.locked === true
    ? {ok: false, reason: "document_locked", message: "Document is locked. Unlock it in your editor before retrying."}
    : null;
}
```

In `writeNote` nach dem tatsächlichen `readExistingFile`, innerhalb `existing !== null`, vor OCC: Policy auf `existing.frontmatter`, Konflikt zurückgeben. In `deleteNote` nach Not-found, vor OCC identisch. Stub: Policy auf `this.docs.get(id)?.properties` nach bisherigen Guards, vor Map-Mutation anwenden; `update` behält Not-found-Vorrang. Bestehende `onBeforeFsWrite` bleiben ausschließlich im Mutationspfad. V1/V2 `WriteConflict.reason` um `document_locked` erweitern.

- [ ] **Step 4: GREEN und Regressionen.**

Run: `npm test -- src/adapters/delivery src/adapters/stub/delivery.test.ts`

Expected: neue Sperrtests und bisherige Delivery-/Guard-/OCC-Tests bestanden.

- [ ] **Step 5: Commit.**

Run: `git add src/adapters && git commit -m "feat: enforce stored document locks in delivery adapters"`

Expected: nur Policy, Adapter und zugehörige Tests im Commit.

### Task 2: Frontmatter, MCP und Memory-Schreibwege integrieren

**Files:**
- Modify/Test: `src/frontmatter/update.ts`, `src/frontmatter/update.test.ts`.
- Modify: `src/adapters/delivery/types.ts`, `src/adapters/delivery/obsidian-fs/index.ts`, `src/adapters/stub/delivery.ts`, `src/server/handlers/notes.ts`.
- Create/Test: `src/server/handlers/notes.locked.test.ts` — echte Handler/Registry/FS/Suppression.
- Modify/Test: `src/memory/tools/supersede.test.ts` — Lock-Konflikt unverändert zurückgegeben.
- Modify: `README.md`, `CHANGELOG.md` — Sperrsemantik und Entsperrweg.

**Interfaces:**
- Consumes: Task-1 `getDocumentLockConflict(...)`, Konflikt `document_locked`.
- Produces: `WriteOptions.onBeforeWrite?: () => void` als rein interner Callback. FS-Adapter reicht ihn in bestehendes `onBeforeFsWrite` weiter. Stub ruft ihn unmittelbar vor Map-Mutation. `updateFrontmatter`-Konflikte enthalten `document_locked`. Keine neue öffentliche MCP-Eingabe.

- [ ] **Step 1: RED-Tests schreiben.** In `update.test.ts` gesperrte Datei mit bestehender Testfixture anlegen. `merge:{locked:{$unset:true}}` und `merge:{}` beide ablehnen; Bytes/DB/Audit und Hook unangetastet. Handlerfixture: echte `AdapterRegistry`, `ObsidianFsSource`, `ObsidianFsDelivery`, `VaultManager`, `MemorySinkRegistry` und `SuppressionSet`. Nur von `makeNotesHandlers` konsumierte Dependencies aus realen Instanzen bereitstellen.

```ts
const result = await handlers.write_note({vault: "locks", path: "approved.md", content: "Changed", expected_hash: originalHash});
expect(result).toMatchObject({ok: false, reason: "document_locked"});
expect(suppression.has("approved.md")).toBe(false);
```

Ebenso `delete_note` und `update_frontmatter`; `read_note` bleibt erfolgreich. Ungesperrter erfolgreicher Write/Delete erzeugt Suppression. Stale Hash/Read-only erzeugen keine Suppression. Frontmatter-Test nutzt ein echtes Delivery-Objekt, das Datei zwischen Source-Read und Delivery-Write manuell sperrt; Konflikt weitergeben statt in `hash_mismatch` umzuwandeln. Supersede-Test nutzt echte FS-Delivery + provisionierten Sink + vollständige gültige Provenienz, sperrt OLD, prüft OLD und Replacement unverändert. Kein Mock ersetzt den zu prüfenden Schreibschutz.

- [ ] **Step 2: RED beobachten.**

Run: `npm test -- src/frontmatter/update.test.ts src/server/handlers/notes.locked.test.ts src/memory/tools/supersede.test.ts`

Expected: Frontmatter maskiert Konflikt/akzeptiert leeres Merge; Handler setzt Suppression zu früh. Bereits durch Task 1 geschützte Supersede-Fälle dürfen direkt grün sein, da hier keine neue Supersede-Produktlogik gebaut wird.

- [ ] **Step 3: Fehler und Callback weiterreichen.** Nach frischem Source-Read vorhandenes Frontmatter mit Policy prüfen, vor No-op-Rückgaben. Delivery-`document_locked` explizit abbilden. `onBeforeFsWrite` nicht vor `delivery.write` auslösen, sondern als `WriteOptions.onBeforeWrite` übergeben. `ObsidianFsDelivery.write/update/delete` reicht Callback an Low-level-Schreiber. Handler `handleWriteNote`/`handleDeleteNote` bekommen optionalen internen Callback-Parameter und liefern ihn über WriteOptions; Factory übergibt `() => suppression.add(path)`, statt vorher zu suppressen. Dokumentation nennt Boolean, Create/Lock-Allow, API-Unlock-Verbot und manuelles Entsperren.

```ts
const lock = getDocumentLockConflict(existingFm);
if (lock) return lock;
// Erst die tatsächliche Mutation ruft diesen Callback auf:
const writeOpts = {expectedHash: currentHash, onBeforeWrite: onBeforeFsWrite};
// Nach delivery.write: document_locked als document_locked zurückgeben.
```

- [ ] **Step 4: GREEN, kompletter Bestand, Build.**

Run: `npm test -- src/frontmatter/update.test.ts src/server/handlers/notes.locked.test.ts src/memory/tools/supersede.test.ts src/adapters/delivery src/adapters/stub/delivery.test.ts`

Expected: alle betroffenen Tests grün.

Run: `npm test && npm run lint && npm run lint:adapters && npm run build`

Expected: gesamter Bestand einschließlich eingefrorener Tool-/Resource-Snapshots grün; Typecheck und Adapter-Lint ohne Fehler; Build erzeugt CLI/server Bundles.

- [ ] **Step 5: Commit und unabhängiges Review.**

Run: `git add src README.md CHANGELOG.md && git commit -m "feat: propagate document lock conflicts without write side effects"`

Expected: prüfbarer Feature-Commit. Whole-branch-Review prüft die fünf Review-Focus-Fälle und Guard-Reihenfolge. Wichtige Findings erneut RED→GREEN beheben. Ergebnis in `docs/superpowers/verification/2026-10-03-f01-document-locks.md` dokumentieren.
