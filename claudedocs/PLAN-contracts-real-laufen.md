# Plan: Contracts REAL lauffähig + nutzer-editierbar + als Context-Spec

## Problem (belegt durch Live-Lauf + zwei Code-Untersuchungen)

Drei Quellen der Wahrheit über Verb-Outputs widersprechen sich:

| Schicht | sagt über `expand` |
|---|---|
| JSDoc (`src/contracts/verbs/index.ts`) | `→ {doc_ids, edges}` |
| Plugin-Katalog (`plugin/.../verb-catalog.ts`) | `outputShape: "{ doc_ids: string[] }"` |
| **Echte Impl** (`src/graph/expand.ts`) | `→ {documents, warnings}` |

**9 von 11 Verbs** weichen ab. Folgen:
1. Der ausgelieferte `meeting-prep`-Fixture-Contract läuft gegen den echten Server **nicht** (nur gemockt grün).
2. Der Plugin-Editor bietet **falsche** Output-Felder an → Nutzer verdrahten `{{linked.doc_ids}}`, das nie existiert.
3. Der Template-Resolver kann **keine Array-Projektion** → `expand → compile_brief` ist via Templates unmöglich.

## Entscheidungen (vom Nutzer bestätigt)

1. **Verbs normalisieren** → einheitliches `doc_ids: string[]`, eine Quelle der Wahrheit.
2. **Verb-Katalog aus echter Impl** synchronisieren + Live-`{{ref}}`-Validierung im Editor.
3. **Context-Window-Assembly jetzt mitdenken** → eigenes ADR.

---

## Teil A — Verb-Output-Normalisierung (macht Contracts real verkettbar)

**Ziel:** Jeder Verb-Output trägt ein dokumentiertes, einheitliches `doc_ids: string[]` ZUSÄTZLICH zu den reichen Objekten. Rückwärtskompatibel (additiv, keine Felder entfernt).

| Verb | heute → | normalisiert → |
|---|---|---|
| expand | `{documents, warnings}` | `{doc_ids, documents, warnings}` |
| recall | `{packets, count}` | `{doc_ids, packets, count}` |
| query_frontmatter | `NoteRow[]` | `{doc_ids, rows}` |
| search_hybrid | `SearchHit[]` | `{doc_ids, hits}` |
| cluster | `{ok, clusters}` | `{ok, doc_ids, clusters}` (alle Member-DocIds) |
| search_sections | `{results, count}` | `{doc_ids, results, count}` |
| get_outline | `OutlineResult` | + `doc_ids: [self]` (Konsistenz) |
| read_note / get_brief / list_backlinks / compile_brief | (Einzel/own) | unverändert / wo sinnvoll `doc_id` |

**Umsetzung:** Eine kleine Normalisierungs-Schicht im `verbDispatcher` (`src/contracts/verbs/index.ts`), die NACH dem Handler-Call das `doc_ids`-Feld aus dem reichen Output ableitet (eine reine `extractDocIds(verb, output)`-Funktion). Kein Eingriff in die v1-Handler selbst → keine Regression an den 23 MCP-Tools.

**Tests:** Pro Verb ein Test „Output enthält doc_ids passend zu documents/hits". Eval-Runner-Mocks an die NEUEN echten Shapes angleichen (sie loggen heute Fiktion).

## Teil B — Eine Quelle der Wahrheit für Verb-Signaturen

**Ziel:** JSDoc, Plugin-Katalog und Impl können nicht mehr driften.

1. **Kanonische Verb-Spec server-seitig** — neue Datei `src/contracts/verb-spec.ts`: pro Baseline-Verb `{verb, args: ArgSpec[], output_fields: string[], output_type, title, description}`. EINE strukturierte Definition (löst die Namens-Liste `BASELINE_VERBS` ab/erweitert sie).
2. **MCP-Resource `contract-verbs` liefert die volle Spec** (heute nur Namen). Der Plugin-Editor liest sie zur Laufzeit statt handgepflegtem `verb-catalog.ts`.
3. **CI-Drift-Gate** — ein Test, der die `verb-spec.ts`-`output_fields` gegen die echten Handler-Return-Typen prüft (bzw. gegen die `extractDocIds`-Map aus Teil A). Drift bricht den Build.
4. **Plugin-Katalog wird Konsument** — `verb-catalog.ts` bezieht Signaturen aus der Resource/shared-types statt sie zu duplizieren; handgepflegt bleiben nur UI-Texte (Hilfe, Labels).

## Teil C — Editor: vertrauenswürdig + Live-Validierung

1. **Korrekte Output-Felder** im Referenz-Picker (folgt automatisch aus Teil B).
2. **Live-`{{ref}}`-Validierung** (`inspector-pane.svelte`): prüft, dass `{{alias.field}}` (a) auf einen existierenden Upstream-Step zeigt und (b) `field` in dessen `output_fields` vorkommt. Broken refs → sichtbare Warnung statt stiller Fehler.
3. **Parse-Zeit-Check beim Laden** — hand-editiertes YAML mit toten Refs wird im Inspector markiert.

## Teil D — Fixtures real lauffähig machen (der eigentliche Beweis)

1. `meeting-prep`, `person-dossier`, `project-status` so umschreiben, dass sie gegen den ECHTEN Server `ok:true` liefern (verifiziert wie beim Sarah-Maihaus-Lauf, nicht nur gemockt).
2. **Kein redundanter `write_back`** wo `compile_brief` selbst schreibt (Designbefund aus dem Live-Lauf).
3. **Auto-Provisionierung des Memory-Sinks** dokumentieren/erleichtern (heute scheitert es, wenn `_memory/.memory-sink` fehlt — Onboarding-Hürde).
4. Ein **Smoke-Test gegen den echten gebauten Server** (analog `scripts/eval-real-vault.mjs`), der mindestens einen Contract end-to-end fährt — als CI- oder Release-Gate.

## Teil E — ADR: Contract als Context-Window-Spec

Neues ADR `docs/v2/adr/026-contract-as-context-spec.md`. Inhalt:
- **These:** Ein Contract ist nicht nur eine Retrieval-Pipeline, sondern die **Prozess-Spec, die einem Agent für eine wiederkehrende Aktivität ein optimal zusammengesetztes Context Window kompiliert.**
- **Context-Assembly-Modell:** Token-Budget pro Contract; Priorisierung (welche Quellen zuerst), Dedup (gleiche Notiz aus mehreren Hops), Reihenfolge (Meeting-Notiz vor Hintergrund), Truncation-Strategie bei Budget-Überschreitung.
- **Verhältnis zu `compile_brief`:** heute kompiliert es einen *Brief*; das ADR verallgemeinert auf *Context-Assembly* (Brief = eine Ausprägung).
- **Discovery:** wie ein Agent (via `describe_contract`) die Spec als Prozess-Anleitung liest (knüpft an `use-contracts`-Skill + ADR-023 an).
- **Abgrenzung:** Was v2.0.0 liefert vs. was Folge-Milestone ist (kein Scope-Creep ins Release).

---

## Reihenfolge & Aufwand

1. **Teil A** (Normalisierung) — Fundament, ~Verb-Handler + Tests. Mittel.
2. **Teil D** (Fixtures real) — beweist A, liefert sofortigen Nutzen. Klein-mittel.
3. **Teil B** (Single Source + CI-Gate) — verhindert künftige Drift. Mittel.
4. **Teil C** (Editor-Validierung) — Nutzer-Vertrauen. Mittel (Plugin/Svelte).
5. **Teil E** (ADR Context-Spec) — kann parallel/zuerst als Design geschrieben werden. Klein (Doku).

## Constraints (aus CLAUDE.md)
- Rückwärtskompatibel: 23 v1-Tools unverändert; Normalisierung rein additiv.
- Adapter-Seams: keine neuen `fs`/`yaml`-Imports außerhalb der Adapter; `lint-adapters.sh` muss grün bleiben.
- Test-Disziplin: kein Regress der bestehenden Tests; neue Verbs/Refs mit Unit-Tests im selben PR.
- MEM-05: write_back nur über DeliveryAdapter; unangetastet.
- GSD: Ausführung läuft über einen GSD-Command (vermutlich `/gsd-execute-phase` als neue Phase 8.5, oder `/gsd-quick` pro Teil).

## Release-Einordnung (entschieden)
- **Neue GSD-Phase 8.5 VOR v2.0.0.** v2.0.0 verschiebt sich, bis Contracts nachweislich
  real laufen. Begründung: nicht-lauffähige Referenz-Contracts in einem .0-Release
  untergraben das Kernversprechen. Plan 08-08 (v2.0.0-Cut) wartet, bis Phase 8.5 grün ist.

## Startschritt (entschieden)
1. **ZUERST reine Doku, kein Code:**
   - `docs/v2/adr/026-contract-as-context-spec.md` (Teil E) — Contract als Context-Window-Spec.
   - Normalisierte Verb-Spec als Design-Tabelle (Teil A+B) im ADR oder separatem
     `docs/v2/adr/027-verb-output-normalization.md` festschreiben — die abgesegnete
     Vorlage für die Implementierung.
2. **Dann GSD-Phase 8.5 aufsetzen** und A→D gegen die ADRs ausführen.
3. Erst nach Phase-8.5-Sign-off (echter Smoke-Test grün) zurück zu Plan 08-08 / v2.0.0-Cut.

## Nächster konkreter Schritt
ADR-026 (Context-Spec) + ADR-027 (Verb-Normalisierung) schreiben. Danach Freigabe
einholen, dann Phase 8.5 via GSD planen/ausführen.
