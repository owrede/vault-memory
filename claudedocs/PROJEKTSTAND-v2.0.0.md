# Projektstand vault-memory v2.0.0 — Übersicht

Stand: 2026-05-26. Quellen: ROADMAP.md, PROJECT.md, STATE.md, CHANGELOG, Testlauf
(1693 passed / 11 skipped, tsc clean), Tool-/Resource-Snapshots, Git-Historie.

---

## 1. Die Ziele von v2.0.0

vault-memory v1.0.0 war ein **Retrieval-Substrat** (Layer 0): hybride Suche, 23 Tools,
Live-Indexing. v2.0.0 sollte daraus eine **agentic knowledge layer** machen, die das
Kernproblem schlägt: *„Agents entdecken 85% ihres Kontexts bei jedem Lauf neu."*

Sechs Ziel-Säulen (ROADMAP 0→9):

| # | Ziel | Phase |
|---|---|---|
| 1 | **Adapter-Seams** — source/delivery/changefeed entkoppeln (v3-Notion-ready) | 1 |
| 2 | **Memory-Namespace + Provenance** — die nicht-verhandelbare Sicherheits-Invariante | 2 |
| 3 | **Bundles + Authority/Staleness** — Dokument-Baum-Retrieval, Citation-Packets | 3 |
| 4 | **Graph-as-Retrieval** — typed-edge Expansion, Community-Clustering | 4 |
| 5 | **Compiled Briefs** — Briefs als Dokumente mit Staleness-Daemon (Signatur-Feature) | 5 |
| 6 | **Task Contracts** — deklarative YAML-Rezepte, via MCP instanziierbar | 6 |
| + | **Obsidian-Plugin** — visueller Contract-Editor + Chrome | 7 |

---

## 2. Was der aktuelle Stand leistet (erreicht & wodurch)

**Phasen 1–7: COMPLETE.** Verifiziert durch 1693 grüne Tests + tsc clean.

### Ziel 1 — Adapter-Seams ✓
`src/adapters/{source,delivery,change-feed}/` mit `obsidian-fs`-Impl + Stub-Adapter.
CI-Greps (`lint-adapters.sh`) erzwingen, dass `chokidar`/`fs`/`gray-matter`/`yaml` nur
in Adaptern vorkommen. Branded `DocId` (nominal). MCP SDK ^1.29 + Zod ^4. **Wodurch
erreicht:** alle 324 v1-Tests blieben grün (rein architektureller Umbau), Stub-Parity-
Conformance-Suite.

### Ziel 2 — Memory-Namespace + Provenance ✓ (die Kern-Invariante)
Agent-Writes gehen **nur** in einen gelabelten `MemorySink`, erzwungen am EINEN
Chokepoint `DeliveryAdapter.write()` (MEM-05, un-umgehbar). Tools: `record_observation`,
`recall`, `supersede`. Guards auf v1-`write_note`/`update_frontmatter` weisen Sink-Targets
ab. `.memory-sink`-Sentinel als einziger Sink-Resolver. **Wodurch:** zentralisierter
Provenance-Validator + Conformance-Cases 11–21.

### Ziel 3 — Bundles + Authority/Staleness ✓
`get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier` — alle mit
8-Feld-Citation-Packet. `search_hybrid` nimmt optional `recency_weight`/`authority_weight`.
**Wodurch:** v1-Default-Pfad byte-identisch (Invarianz-Pin in `hybrid.rescore.test.ts`),
≥8 Dossier-Eval-Queries.

### Ziel 4 — Graph-as-Retrieval ✓
`expand` (BFS-Primitiv), `cluster` (graphology + Louvain, deterministisch), `edges`-Tabelle
mit 4 typed edges. Cross-Adapter-Conformance. **Wodurch:** Phase-4-Tests + Stub-Parität.

### Ziel 5 — Compiled Briefs ✓ (Signatur-Differenzierer)
Briefs als `Document`s in `_memory/_briefs/` mit `compiled_from`, chunk-level
`source_hashes`, Provenance. Staleness-Daemon via `ChangeFeed.subscribe()`, single-owner
per Lock, repliert verpasste Events. LLM-Ladder: **MCP Sampling → Ollama → prepared_text**
(nie ein Remote-LLM-SDK gebündelt). **Wodurch:** `daemon.test.ts`, Conformance BRF-11
(4 Cases × 2 Adapter), ADR-005.

### Ziel 6 — Task Contracts ✓ (mit Vorbehalt, siehe §3)
Deklarative YAML-Contracts, closed assembly-verb-enum (11 baseline + `literal` +
`mcp://`-peer), `{{template}}`-Komposition, MemorySink-only writes. 3 Tools
(`describe_contract`, `instantiate_contract`, `register_contracts_as_tools`).
**Wodurch:** Phase-6-Sign-off, CON-10-Stub-Parität, CON-09-non-Claude-Smoketest.

### Ziel 7 — Obsidian-Plugin ✓
Visueller Contract-Editor (Canvas + Inspector + Palette, Svelte-Flow), eigenes
`.contract`-JSON-Format ↔ Phase-6-YAML-Codec, Settings/Secrets/Reindex/Stats/Sources-Panel.

### Zusätzlich über die Roadmap hinaus
- **Sources Registry (ADR-025, Phase 8)** — peer-MCP-Quellen als MCP-Resources.
- **Real-Vault-Eval-Harness** — reproduzierbares MRR@10 gegen echten Vault.

### Surface-Bilanz
- **37 MCP-Tools** (v1: 23 → +14 in v2), v1-Surface byte-identisch erhalten.
- **13 MCP-Resources** (memory-sinks, briefs, contracts, contract-verbs, sources, …).
- **1693 Tests** grün, tsc clean, alle Adapter-Lints grün.

---

## 3. Offene Enden

### A. Der v2.0.0-Release selbst — NICHT vollzogen
- **Phase 8 zu 7/8 fertig.** Es fehlt **Plan 08-08: der v2.0.0-Cut** (Cold-Read,
  `release.mjs`, npm publish, GitHub Release, Sign-off). Human-gated.
- RC-Historie zeigt Reibung: rc.3 wurde getaggt, aber npm-Publish scheiterte an einem
  registry-internen 404; **rc.4 supersedes rc.3**. Eine Ruleset-Push-Frage ist offen.

### B. Contracts laufen real NICHT durch — der kritische Befund dieser Session
Ein Live-Lauf des `meeting-prep`-Contracts gegen den **echten** Server (statt Mocks)
deckte auf: **9 von 11 Verbs** haben divergierende Output-Shapes zwischen JSDoc,
Plugin-Katalog und echter Impl. Folgen:
1. Die ausgelieferten Referenz-Contracts laufen real nicht (`expand` liefert
   `{documents}`, nicht `{doc_ids}`; Templates können nicht projizieren).
2. Der Editor bietet **falsche** Output-Felder an → Nutzer verdrahten tote Refs.
3. `compile_brief` schreibt selbst → der Fixture-`write_back` scheitert immer.

→ Adressiert durch **ADR-026** (Contract als Context-Spec) + **ADR-027**
(Verb-Output-Normalisierung), beide *Proposed*. Geplant als **Phase 8.5 VOR v2.0.0**
(eingeschobene INSERTED-Phase, Entscheidung dieser Session). Erst nach
Phase-8.5-Sign-off zurück zum 08-08-Cut.

### C. Bekannte, dokumentierte Backlog-Punkte
- **Alias-/Akronym-Recall-Lücke** (z.B. „JHE") — Aliases fließen nicht in den FTS-Index.
  Dokumentiert, nicht release-blockierend.
- **Memory-Sink-Onboarding** — `compile_brief`/Contracts scheitern, wenn `_memory/.memory-sink`
  im Vault fehlt; Auto-Discovery braucht den Sentinel. Erleichterung in Phase 8.5 geplant.

### D. Noch nicht begonnen
- **Phase 8.5 (INSERTED, vor v2.0.0)**: „Contracts real-laufen" — Verb-Normalisierung,
  vertrauenswürdiger Editor, reale Fixtures. Gated den v2.0.0-Cut (Plan 08-08). Siehe
  ROADMAP §Phase 8.5 + ADR-026/027.
- **Phase 9 (unverändert)**: „Pre-Phase-10 premise check" (Hard Gate vor v3). Behält
  ihre Nummer — in 8 ADRs + ARCHITECTURE/AGENT_AGNOSTIC verankert. Nummerierungskonflikt
  gelöst: die neue Contracts-Arbeit wurde als Decimal-Phase 8.5 eingeschoben (ROADMAP-
  Konvention für INSERTED), Phase 9 bleibt der Premise-Check.
- **v3.0.0 (deferred)**: Notion-Connector — eigener Milestone, außerhalb v2-Scope.

### E. Uncommittete Arbeit dieser Session
- Neu: `docs/v2/adr/026-…`, `027-…`, ADR-README-Index-Update, `claudedocs/` (Pläne +
  Auswertungen). dist/cli.js + AGENTS.md sind Build-/Tooling-Rauschen.

---

## 4. Einordnung in einem Satz

**v2.0.0 hat sechs der sieben Ziel-Säulen technisch erreicht und durch 1693 Tests
abgesichert — aber das Signatur-Feature „Task Contracts" läuft end-to-end gegen den
echten Server nicht zuverlässig (Mocks verdeckten das), weshalb vor dem Release-Cut eine
Phase 8.5 (Verb-Normalisierung + vertrauenswürdiger Editor + reale Fixtures) eingezogen
wurde.**
