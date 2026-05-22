# Spike Summary — contextfit vs. sqlite-vec

**Status:** _(in progress — fill after running the spike)_
**Date completed:** _(YYYY-MM-DD)_
**Vault:** Intelligence Impact
**Run:** see `results/setup-metrics.json` + `results/metrics.md`

## Verdict

_(eines davon ankreuzen)_

- [ ] **GO** — contextfit reicht; ADR-008 + RetrievalBackend-Naht aufsetzen.
- [ ] **NO-GO** — Spike geschlossen.
- [ ] **DEFER** — siehe offene Fragen unten.

## Headline-Zahlen

_(aus `results/metrics.md` übertragen)_

| Achse | sqlite-vec | contextfit | Verhältnis |
|---|---|---|---|
| Ingest Wallclock | — | — | — |
| Index-Storage | — | — | — |
| Query P50 | — | — | — |
| Overall Recall@5 | — | — | — |
| EN Recall@5 | — | — | — |
| DE Recall@5 | — | — | — |
| Overall MRR | — | — | — |

## Beobachtungen

_(qualitative Beobachtungen aus der manuellen Bewertung — z.B.)_

- Wo hat contextfit überrascht?
- Wo hat es klar versagt?
- Welche Query-Klasse (intent) zeigt den größten Spread?
- DE-Recall: bricht es ein wie befürchtet, oder hält es?
- Operativ: wie lange dauerte das Setup auf deinem Mac?

## Offene Fragen / Folge-Punkte

_(falls Verdict = DEFER oder GO mit Caveats)_

- [ ] …
- [ ] …

## Entscheidung / Nächster Schritt

_(z.B. "ADR-008 schreiben", "Spike-Variante mit contextfit `SemanticExpander` testen", "Spike geschlossen")_
