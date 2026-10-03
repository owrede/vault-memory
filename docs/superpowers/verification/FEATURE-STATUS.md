# Ausführungsstatus F01–F11

Verbindliches Ziel: alle elf Feature-Upgrades gemäß Design und Einzelplänen implementieren und nachweisen. Branch: `feat/basic-memory-inspired`; Worktree: `/private/tmp/vault-memory-basic-memory-features`. Die erste abgeschlossene Lieferung F01 verkleinert dieses Ziel nicht.

| Feature | Status | Nachweis |
|---|---|---|
| F01 Dokumentensperren | abgeschlossen | `2026-10-03-f01-document-locks.md` |
| F02 Gezieltes Editieren | abgeschlossen | `2026-10-03-f02-targeted-edits.md` |
| F03 Kompakter Kontext | Gesamtprüfung grün, Review ausstehend | `.superpowers/sdd/2026-10-03-f03-compact-retrieval/progress.md` |
| F04 Beobachtungen | geplant | eigener Plan |
| F05 Fachliche Relationen | geplant | eigener Plan |
| F06 Schemas/Drift | geplant | eigener Plan |
| F07 Gültigkeitszeit | geplant | eigener Plan |
| F08 CLI/Handbuch | geplant | eigener Plan |
| F09 ONNX-Embeddings | geplant | eigener Plan |
| F10 Sitzungscheckpoints | geplant | eigener Plan |
| F11 Gesprächsimporte | geplant | eigener Plan |

Ausführung mit `superpowers:executing-plans` und beobachtetem RED→GREEN. Node24-PATH muss auch für npm-Childprozesse gesetzt sein; vollständige Testsuite außerhalb der Sandbox wegen nativer Watcher. Keine unbeauftragte Integration in den ursprünglichen Branch oder Veröffentlichung.
