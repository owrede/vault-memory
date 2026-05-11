# 001 — Datacore-Sidecar-Indexing

**Status**: planned
**Created**: 2026-05-11
**Motivation source**: [Eval-v3 results](../../README.md), Befund A3/C2 — MOCs mit Datacore-Codeblöcken sind im Hybrid-Search systematisch unterrepräsentiert.

## Problem

Notes in einem Obsidian-Vault können `datacorejsx` / `datacorets` / `dataviewjs` Codeblöcke enthalten. Im laufenden Obsidian rendern diese Blöcke zu Tabellen, Listen oder dynamischen Views — der gerenderte Inhalt ist oft der eigentliche **inhaltliche Kern** der Note (z.B. eine Person-Liste, eine Projekt-Übersicht).

vault-memory indiziert nur den Markdown-Quelltext. Die Codeblöcke selbst tragen zwar Tokens (`dc.require`, `ProjectFolderListing`, etc.), aber kein semantisch sinnvolles Signal für Embeddings oder FTS. Folge:

- Im Eval-v3 erschien die `LAG-EPIX.md` MOC-Note in Konfig C nicht in den Top-10 für „Was ist LAG-EPIX". Der Großteil ihrer Chunks bestand aus `\`\`\`datacorejsx ... \`\`\``-Boilerplate.
- Ähnliches Problem für alle Project-MOCs, Person-Listen-Notes und andere Datacore-zentrierte Übersichten.

## Lösung — Sidecar-MD mit Plugin-Orchestrierung

Ein eigenes Obsidian-Plugin rendert Datacore-Codeblöcke zu statischem Markdown und schreibt das Ergebnis in eine Sidecar-Datei neben die Haupt-Note. vault-memory liest die Sidecar beim Indexieren und behandelt ihren Inhalt, als wäre er Teil der Haupt-Note (selbe `note_id` für Chunks und Wikilinks).

Das Plugin steuert den Lifecycle: Render → Sidecar schreiben → vault-memory triggern → Sidecar löschen.

### Architektur

```
┌────────────────────┐    Render-Trigger    ┌────────────────────────┐
│ Obsidian-Plugin    │ ────────────────────▶│ Datacore-API           │
│ vm-datacore-render │   evaluate JSX       │ app.plugins.datacore   │
└────────┬───────────┘ ◀────────────────────┴────────────────────────┘
         │ writes
         ▼
┌────────────────────┐
│ <note>.rendered.md │  ← Sidecar (gitignored, not visible in Obsidian)
└────────┬───────────┘
         │ triggers CLI
         ▼
┌────────────────────┐    reads + merges    ┌────────────────────────┐
│ vault-memory CLI   │ ────────────────────▶│ <note>.md + sidecar    │
│ index <vault>      │                      │ → chunks under note_id │
└────────┬───────────┘                      └────────────────────────┘
         │ completes
         ▼
┌────────────────────┐
│ Plugin deletes     │
│ <note>.rendered.md │
└────────────────────┘
```

### Design-Entscheidungen

1. **Plugin steuert alles** (orchestrator pattern). vault-memory ist passiv — es liest die Sidecar wenn sie existiert, sonst indiziert es nur die Haupt-Note. Headless-CLI-Aufrufe ohne Plugin funktionieren weiter, indizieren dann ohne gerenderten Datacore-Content (= aktuelles Verhalten).

2. **Sidecar-Inhalt fließt unter selber `note_id` ein** — keine eigene Note-Row für die Sidecar. Chunks aus Note + Sidecar teilen sich denselben `note_id`. Backlinks/Forward-Links aus der Sidecar werden als Wikilinks der Haupt-Note registriert.

3. **mtime-basierter Re-Index-Trigger**: vault-memory prüft beim inkrementellen Index pro Note, ob eine `<note>.rendered.md` existiert. Wenn `sidecar.mtime > note_row.last_indexed_at`, wird die Note forciert re-indexiert (Hash wird ignoriert).

4. **Sidecar-Naming**: `<original-filename>.rendered.md` direkt neben der Original-Note. Beispiel: `Projekte/LAG-EPIX/LAG-EPIX.md` → Sidecar `Projekte/LAG-EPIX/LAG-EPIX.rendered.md`.

5. **`.gitignore`**: Pattern `*.rendered.md` im Vault-Root. Sidecars sind ephemerer Render-Output, nicht Source of Truth — gehören nicht ins Repo. README dokumentiert das Pattern.

6. **Lifecycle-Cleanup**: Plugin löscht die Sidecar nach erfolgreichem vault-memory-Run. Falls der Index crashed: Sidecar bleibt liegen, beim nächsten Plugin-Lauf wird sie überschrieben (idempotent). Cleanup-Command im Plugin für Notfälle.

## Implementation Plan

### Phase 1 — vault-memory (dieses Repo)

**Goal**: Sidecar-Infrastruktur fertig, sodass auch ohne Plugin manuell geschriebene Sidecars korrekt indiziert werden.

Files to modify / create:

- **`src/reader/parser.ts`** — `parseNote()` erweitern:
  - Sidecar-Pfad ableiten: `<note-path>.rendered.md`
  - Wenn Sidecar existiert: Content lesen, an `note.content` anhängen (nach dem Body, vor Hash-Berechnung)
  - Wikilinks aus Sidecar werden mit `extractWikilinks()` extrahiert und in `note.wikilinks` gemergt (analog zum bestehenden Frontmatter-Wikilink-Merge aus Task #26)
  - Neue Felder im `ParsedNote`: `sidecarPath: string | null`, `sidecarMtime: number | null`

- **`src/indexer/incremental.ts`** — `shouldReindex()` erweitern:
  - Zusätzlich zur Hash-Prüfung: wenn `parsed.sidecarMtime > note_row.last_indexed_at`, forciere Re-Index
  - `last_indexed_at` muss aus der `notes`-Tabelle gelesen werden (siehe Schema-Änderung)

- **`src/db/schema.sql`** — `notes`-Tabelle:
  - Neue Spalte: `last_indexed_at INTEGER` (unix-ms, gesetzt vom Indexer beim erfolgreichen Index-Commit)
  - Optional: `sidecar_mtime_at_index INTEGER` (mtime zur Zeit des letzten Index — Diagnostik)
  - Migration: `ALTER TABLE notes ADD COLUMN last_indexed_at INTEGER` (NULL für Bestandsdaten, wird beim nächsten Index gefüllt)

- **`src/reader/parser.test.ts`** — neue Tests:
  - Note mit Sidecar: Chunks enthalten Sidecar-Content
  - Note ohne Sidecar: Verhalten identisch zu vorher
  - Sidecar mit Wikilink: Wikilink ist in `note.wikilinks` enthalten
  - Sidecar älter als Note: wird ignoriert (Note ist Source of Truth)
  - Sidecar mit gleichem Wikilink wie Body: Dedupe greift (analog Frontmatter-Merge)

- **`src/indexer/incremental.test.ts`** — neue Tests:
  - Bestehende Note + neue Sidecar erscheint: Re-Index getriggert
  - Sidecar gelöscht: nächster Index behandelt Note ohne Sidecar (Chunks aus Sidecar werden entfernt)

- **`README.md`** — Sektion „Datacore-Sidecars" mit Erklärung + `.gitignore`-Empfehlung

### Phase 2 — Obsidian-Plugin (separates Repo: `vm-datacore-render`)

**Goal**: Plugin orchestriert Render → Sidecar → CLI → Cleanup.

Funktionen:
- Command „vault-memory: Re-index with rendered datacore" — alle Notes mit Datacore-Blöcken durchgehen
- Datacore-API ansprechen (`app.plugins.plugins.datacore.api.query()`), JSX-Komponenten ausführen, Output als Markdown serialisieren
- Sidecar-Schreib-Routine: rendered output → `<note>.rendered.md`
- CLI-Trigger: `child_process.spawn('vault-memory', ['index', vaultName])` — falls vault-memory-CLI nicht im PATH: Pfad konfigurierbar
- Cleanup: alle Sidecars löschen nach erfolgreichem CLI-Exit
- Settings: Vault-Name (für CLI-Aufruf), CLI-Pfad, Auto-Trigger on Note Save (optional)
- Notfall-Command: „vault-memory: Clean up orphan render sidecars"

Out of scope für vault-memory selbst — dieses Plugin wird separat entwickelt und released. vault-memory funktioniert auch ohne das Plugin (dann eben ohne gerenderte Inhalte).

### Phase 3 — Verifikation

- Re-Index `inim`-Vault mit manuell geschriebenen Sidecars für LAG-EPIX MOC + 1-2 weitere Datacore-Notes
- Eval-Query „Was ist LAG-EPIX" erneut laufen: LAG-EPIX.md MOC sollte jetzt in Top-3 erscheinen
- Re-Eval Konfig D′ (BGE-M3 + Reranker) für die Datacore-affected queries — MRR-Vergleich

## Schema-Migration

```sql
-- Migration 0009 (oder nächste freie Nummer)
ALTER TABLE notes ADD COLUMN last_indexed_at INTEGER;
ALTER TABLE notes ADD COLUMN sidecar_mtime_at_index INTEGER;

-- Bestandsdaten: NULL → wird beim nächsten Index-Run gefüllt
-- Inkrementeller Indexer behandelt NULL als „noch nie indiziert" → re-index
```

## Anti-Patterns / Out of Scope

- **Datacore-Queries in vault-memory reimplementieren**: zu hoher Aufwand, zu hohe Brittleness gegen Datacore-DSL-Updates. Plugin-Orchestrierung ist der robustere Pfad.
- **Headless-Obsidian booten**: zu viel Cold-Start-Overhead pro Index-Run, zu fragil im Headless-Modus.
- **Sidecars als sichtbare Notes**: Sidecars werden NICHT in Obsidian sichtbar (Pattern in vault-memory `path_exclude_glob` aufnehmen? Nein — sie werden ja durch das Plugin gelöscht. Aber falls eine hängenbleibt: das Plugin hat einen Cleanup-Command).
- **Versionskontrolle der Sidecars**: niemals committen. Sidecars sind Render-Cache, nicht Content.

## Erwartete Auswirkung

- **MRR-Gewinn auf MOC-Queries**: Eval-v3 zeigte LAG-EPIX MOC bei C nicht in Top-10. Nach Sidecar-Indexing sollte die MOC mit ihren gerenderten Listen (Aktuelle Klienten, Sub-Folder, etc.) als legitimer Top-3-Treffer auftauchen.
- **Person-Listen werden suchbar**: Notes mit `ProjectParticipantsTable` u.ä. liefern dann Embeddings für die tatsächlichen Personen-Namen, nicht nur für den Komponent-Aufruf.
- **Frontmatter-driven Aggregationen** (z.B. „alle Personen mit `participation: [[LAG-EPIX]]`") werden via gerenderte Tabelle indiziert — auch wenn der Frontmatter-Forward-Link selbst schon durch Task #26 abgedeckt ist, kommt die gerenderte Tabelle als zusätzlicher semantischer Kontext dazu.

## Offene Fragen

- **Mehrfache Sidecars pro Note?** Eine Note kann mehrere `datacore`-Codeblöcke haben. Plugin sollte sie alle in eine einzelne Sidecar zusammenfassen (in derselben Reihenfolge wie im Original), nicht mehrere Files pro Note schreiben.
- **Rendering bei Note-Read vs. Note-Save?** Open question für Plugin. Vermutlich „auf expliziten Trigger" reicht — Auto-Render bei Note-Save könnte Performance kosten.
- **Cross-Note-Effekte**: Wenn eine Person der Liste `participation: [[LAG-EPIX]]` hinzugefügt wird, ändert sich die gerenderte Tabelle in LAG-EPIX MOC, aber die Person-Note selbst hat keine `.rendered.md`. Plugin muss erkennen: „diese Note-Änderung könnte andere Notes' Sidecars invalidieren". Erste Iteration: Plugin macht keinen Auto-Dependency-Tracking — User triggert Full-Render-Pass manuell wenn Listen veralten. Spätere Iteration: Datacore-Query-Dependency-Tracking.

## References

- Eval-v3 Befund A3/C2: `_research/vault-memory-eval-v3-results.md` (im inim-Vault)
- Task #26 (Frontmatter-Wikilinks): Commit `0b7dc06`
- Datacore-Plugin: https://github.com/blacksmithgu/datacore (siehe `api.query()` für headless-Render-Ansatz)
