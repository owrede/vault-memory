# Optimization TODOs

Dieser Ordner enthält ausgearbeitete Design-Dokumente für künftige vault-memory-Optimierungen. Jedes Doc beschreibt ein konkretes Problem, eine vorgeschlagene Lösung mit Architektur-Skizze, einen Implementierungsplan in Phasen, und erwartete Auswirkungen.

Die Docs sind nicht der Backlog selbst (der lebt in der externen Task-Verwaltung) — sondern die **Spezifikation**, gegen die später implementiert wird. Sie überleben Conversation-Compactions und Session-Wechsel.

## Konvention

- **Nummerierung**: `NNN-kurzer-slug.md` (Nummern aufsteigend, niemals wiederverwendet)
- **Frontmatter**: keins — die Docs sind nicht Teil eines Tooling-Indexes, nur Source of Truth für Menschen
- **Status-Werte**:
  - `planned` — Spec geschrieben, noch nicht angefangen
  - `in-progress` — Implementierung läuft, ggf. mit Branch-Verweis
  - `implemented` — Code merged, Doc bleibt als Architektur-Referenz erhalten
  - `superseded by NNN` — durch ein anderes Doc abgelöst, falls Ansatz revidiert wird
- **Struktur**: Problem → Lösung → Design-Entscheidungen → Implementation Plan (in Phasen) → Anti-Patterns → Offene Fragen

## Aktuelle Docs

- [001 — Datacore-Sidecar-Indexing](001-datacore-sidecar-indexing.md) (`planned`) — MOC-Notes mit `datacorejsx`-Codeblöcken werden im Hybrid-Search systematisch unterrepräsentiert. Lösung: Obsidian-Plugin rendert Datacore zu Sidecar-MD, vault-memory indiziert Sidecar unter selber `note_id` wie Haupt-Note.
