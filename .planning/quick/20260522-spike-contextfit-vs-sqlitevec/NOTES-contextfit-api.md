# contextfit 0.1.0 — verifizierte API + Umgebungs-Befunde

Stand 2026-05-28. Verifiziert durch Installation von `contextfit==0.1.0`
in einem venv und Inspektion des Paket-Quellcodes (`contextfit/cli.py`).
Die Harness-Skripte (`query-both.mjs`, `ingest-contextfit.sh`) sind gegen
diese Realität abgeglichen.

## Paket-Charakter (bestätigt)

contextfit ist **embedding-frei / token-nativ**. Dependencies:
`tiktoken` (Tokenisierung, cl100k_base), `datasketch` (MinHash/LSH),
`pyroaring` (komprimierte Postings-Bitmaps), `networkx`, `scipy`.
**Kein** torch / onnxruntime / sentence-transformers — es gibt keine
Vektor-Embeddings. Retrieval-Methoden: `exact | bm25 | sid | graph |
hierarchy | hybrid` (`sid` = "semantic id", ein gelernter
Token→ID-Generator, kein neuronales Embedding).

Damit ist der Spike-Kern korrekt gerahmt: contextfits "hybrid" ist eine
Fusion lexikalischer + token-strukureller Signale, **ohne** den
dichten semantischen Vektorraum, den vault-memory über BGE-M3 nutzt.
Die Spike-Frage lautet also präzise: schlägt token-native Fusion den
embedding-basierten Hybrid auf echten DE/EN-Notizen?

## CLI (verifiziert)

```
contextfit [--kb DIR] [--tokenizer NAME] {ingest,build-index,train-sid,query,stats}

ingest <source> [--defer-index-build] [--rebuild-index-after-ingest]
                [--chunk-size 512] [--overlap 64] [--workers 4] ...
query  <text>   [--top-k 5] [--method {exact,bm25,sid,graph,hierarchy,hybrid}] [--json]
stats           [--json]
```

Alle von der Harness genutzten Flags existieren in 0.1.0.

## `query --json` Output (verifiziert, cli.py `_query_to_json`/`_chunk_to_json`)

```jsonc
{
  "query": "...",
  "method": "hybrid",
  "query_tokens": [int, ...],
  "retrieved_chunks": 10,
  "input_token_count": 1234,
  "input_ids": [int, ...],
  "sid_predictions": [ { "prefix": [...], "score": float, "depth": int,
                         "support": int, "candidate_chunks": [...] } ],
  "chunks": [
    {
      "rank": 1,
      "chunk_id": "...",
      "score": float,          // ← Score liegt PRO CHUNK, nicht als top-level array
      "level": int,
      "parent_id": "...",
      "token_count": int,
      "semantic_id": [...] | null,
      "metadata": { "source": "<dateipfad>" },   // default; ggf. mehr aus file_meta
      "preview": "<decodete erste ~100 tokens>",
      "tokens": [int, ...]
    }
  ]
}
```

**Korrektur an der Harness:** Eine frühere Annahme war ein paralleles
top-level `scores: []`-Array. Das ist falsch — `score` steht in jedem
Chunk-Objekt. `query-both.mjs::parseContextfit` liest jetzt `chunk.score`.
`metadata.source` (Dateipfad) ist bestätigt (cli.py:522:
`metadata=result.get("file_meta", {"source": str(path)})`).

## Chunk-Zählung

Nach Ingest steht `counts.chunks` in `<KB>/ingest_manifest.json` — ohne
Tokenizer-Load lesbar. `ingest-contextfit.sh` zieht die Zahl von dort.

## tiktoken-Gotcha (umgebungsabhängig)

contextfit tokenisiert mit `cl100k_base`, das `tiktoken` beim ersten
Gebrauch von `openaipublic.blob.core.windows.net` lädt. Hinter
restriktiven Netzen (403) schlägt der Ingest fehl. `preflight.sh` wärmt
das Encoding jetzt vor und meldet das Problem früh. Fix: erreichbares
Netz, oder `$TIKTOKEN_CACHE_DIR` mit `cl100k_base.tiktoken` vorbefüllen
(Cache-Dateiname = `sha1(<blob-url>)` = `9b5ad71b2ce5302211f9c61530b329a4922fc6a4`).

## Warum der Vergleich NICHT in der Claude-Code-Cloud-Sandbox lief

Die Cloud-Ausführungsumgebung (Linux-Container, nur geklontes Repo)
konnte den Vergleich nicht fahren — verifiziert, nicht vermutet:

1. **User-Vault nicht angebunden** — INIM-VM-TEST liegt auf dem Mac des
   Users, nicht im Container.
2. **Kein Embedding-Modell erreichbar** — die Netzwerk-Policy blockt
   `huggingface.co` (403) UND `registry.ollama.ai` (403). Keine
   Modellgewichte beziehbar.
3. **vault-memory verweigert ohne Ollama** — `src/indexer/indexer.ts:64-66`
   wirft `"Ollama unreachable"` und bricht vor dem BM25-Index ab.

contextfit allein lief (token-nativ), aber das ist kein Vergleich.
→ Lauf gehört auf den Mac des Users (Ollama vorhanden, Vault vorhanden),
  oder die Cloud-Umgebung braucht eine Policy, die ein Modell-Repo
  erlaubt, plus die Vault-Daten im Repo.
