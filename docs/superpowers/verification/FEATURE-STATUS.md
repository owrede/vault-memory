# Ausführungsstatus F01–F11

Verbindliches Ziel: alle elf Feature-Upgrades gemäß Design und Einzelplänen implementieren und nachweisen. Branch: `feat/basic-memory-inspired`; Worktree: `/private/tmp/vault-memory-basic-memory-features`. Die erste abgeschlossene Lieferung F01 verkleinert dieses Ziel nicht.

| Feature | Status | Nachweis |
|---|---|---|
| F01 Dokumentensperren | abgeschlossen | `2026-10-03-f01-document-locks.md` |
| F02 Gezieltes Editieren | abgeschlossen | `2026-10-03-f02-targeted-edits.md` |
| F03 Kompakter Kontext | abgeschlossen | `2026-10-03-f03-compact-retrieval.md` |
| F04 Beobachtungen | abgeschlossen | `2026-10-03-f04-categorized-observations.md` |
| F05 Fachliche Relationen | abgeschlossen | `2026-10-03-f05-domain-relations.md` |
| F06 Schemas/Drift | abgeschlossen | `2026-10-03-f06-schema-validation-drift.md` |
| F07 Gültigkeitszeit | abgeschlossen | `2026-10-03-f07-valid-time.md` |
| F08 CLI/Handbuch | abgeschlossen | `2026-10-03-f08-cli-manuals.md` |
| F09 ONNX-Embeddings | abgeschlossen | `2026-10-03-f09-local-onnx-embeddings.md` |
| F10 Sitzungscheckpoints | Integration, Abnahme läuft | eigener Plan |
| F11 Gesprächsimporte | geplant | eigener Plan |

Ausführung mit `superpowers:executing-plans` und beobachtetem RED→GREEN. Node24-PATH muss auch für npm-Childprozesse gesetzt sein; vollständige Testsuite außerhalb der Sandbox wegen nativer Watcher. Keine unbeauftragte Integration in den ursprünglichen Branch oder Veröffentlichung.
