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
| F10 Sitzungscheckpoints | abgeschlossen | `2026-10-03-f10-session-checkpoints.md` |
| F11 Gesprächsimporte | abgeschlossen (neutral-v1) | `2026-10-03-f11-conversation-import.md` |

Ausführung mit `superpowers:executing-plans` und beobachtetem RED→GREEN. Node24-PATH muss auch für npm-Childprozesse gesetzt sein; vollständige Testsuite außerhalb der Sandbox wegen nativer Watcher. Keine unbeauftragte Integration in den ursprünglichen Branch oder Veröffentlichung.

## Abschließende gemeinsame Abnahme

Bei Codecommit62176bd: **2087 Tests bestanden,17 optionale Tests übersprungen**; TypeScript, Adapterprüfung und Build erfolgreich Node24.11.1. Alle elf Features haben beobachtete RED→GREEN-Nachweise und unabhängige Reviews. 23 originale v1-Namen/Eingabeschemas bleiben eingefroren; Standardtools32 kanonisch plus5deprecated unverändert. Neue Aktionen nur per explizitem Featureflag.

Betriebsgrenzen: ONNX braucht kompatible lokal gepinnte Assets; optionaler multilingualer Qualitätslauf nicht aktiviert. Sessionhooks und Gesprächsimporte unterstützen jeweils das dokumentierte neutrale v1-Profil. Ungeprüfte ChatGPT-Exportformate liefern unsupported_format. Featurebranch und Worktree sind die vollständige Lieferung; keine Veröffentlichung oder automatische Änderung von Clientkonfiguration.
