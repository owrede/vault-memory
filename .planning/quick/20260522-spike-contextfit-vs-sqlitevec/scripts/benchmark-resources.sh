#!/usr/bin/env bash
# Dedicated, reproducible resource benchmark: indexing + storage + RAM + hardware
# for both backends. Separate from run.sh's inline metrics (which write to a
# path the CLI no longer uses — db lands under .vault-memory/vaults/, not
# .vault-memory/). This script measures from scratch in fresh sandboxes and
# writes results/resource-metrics.json.
#
# Measures, per backend:
#   - ingest wallclock (cold, from empty index)
#   - peak RSS during ingest (/usr/bin/time -l on macOS)
#   - on-disk index size (bytes + human)
#   - hardware path (contextfit = CPU only; sqlite-vec = Ollama model on GPU)
#
# Requires the same env as run.sh: VAULT_PATH, CONTEXTFIT_BIN, CONTEXTFIT_PY,
# EMBEDDING_MODEL (auto-detected if unset). Run with the venv active.
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SPIKE_DIR/../../.." && pwd)"
: "${VAULT_PATH:?export VAULT_PATH first}"
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://localhost:11434}"
CONTEXTFIT_BIN="${CONTEXTFIT_BIN:-$(command -v contextfit || true)}"
CONTEXTFIT_PY="${CONTEXTFIT_PY:-$(dirname "$CONTEXTFIT_BIN")/python3}"
mkdir -p "$SPIKE_DIR/results"

# macOS /usr/bin/time -l prints "  N  maximum resident set size" in BYTES.
peak_rss() { grep "maximum resident set size" "$1" | awk '{print $1}'; }

VAULT_NOTES=$(find "$VAULT_PATH" -type f -name "*.md" -not -path "*/.obsidian/*" -not -path "*/.trash/*" | wc -l | tr -d ' ')
VAULT_BYTES=$(find "$VAULT_PATH" -type f -name "*.md" -not -path "*/.obsidian/*" -print0 | xargs -0 stat -f%z 2>/dev/null | awk '{s+=$1} END{print s}')

echo "── Resource benchmark ──"
echo "Vault: $VAULT_NOTES notes, $((VAULT_BYTES/1024)) KB markdown"
echo

# ─── Embedding model (sqlite-vec path) ───────────────────────────────
EMBEDDING_MODEL="${EMBEDDING_MODEL:-}"
if [ -z "$EMBEDDING_MODEL" ]; then
  MODELS=$(curl -fsS "$OLLAMA_ENDPOINT/api/tags" | "$CONTEXTFIT_PY" -c 'import sys,json;print("\n".join(m["name"] for m in json.load(sys.stdin).get("models",[])))')
  for c in "bge-m3:latest" "bge-m3" "qwen3-embedding:latest"; do
    echo "$MODELS" | grep -qx "$c" && EMBEDDING_MODEL="$c" && break
  done
fi
echo "Embedding model: $EMBEDDING_MODEL"

# Ollama model RAM/processor footprint (warm it, then read `ollama ps`).
curl -s "$OLLAMA_ENDPOINT/api/embed" -d "{\"model\":\"$EMBEDDING_MODEL\",\"input\":\"warmup\"}" >/dev/null 2>&1 || true
OLLAMA_PS=$(ollama ps 2>/dev/null | awk 'NR==2{print}')
echo "Ollama model footprint: ${OLLAMA_PS:-unknown}"
echo

# ─── sqlite-vec ingest ───────────────────────────────────────────────
SQ_HOME="$(mktemp -d "${TMPDIR:-/tmp}/vm-bench-sq-XXXXXX")"
mkdir -p "$SQ_HOME/.vault-memory"
cat > "$SQ_HOME/.vault-memory/config.toml" <<EOF
[server]
log_level = "warn"
ollama_endpoint = "$OLLAMA_ENDPOINT"
default_embedding_model = "$EMBEDDING_MODEL"
[[vaults]]
name = "bench"
path = "$VAULT_PATH"
write_enabled = false
exclude_globs = [".obsidian/**", ".trash/**"]
EOF

echo "→ sqlite-vec ingest (cold) ..."
SQ_T0=$(node -e 'console.log(Date.now())')
HOME="$SQ_HOME" /usr/bin/time -l node "$REPO_ROOT/dist/cli.js" index --vault bench --full \
  > "$SPIKE_DIR/results/bench-sqlite.log" 2>&1
SQ_T1=$(node -e 'console.log(Date.now())')
SQ_WALL=$((SQ_T1 - SQ_T0))
SQ_RSS=$(peak_rss "$SPIKE_DIR/results/bench-sqlite.log")
SQ_DB=$(find "$SQ_HOME/.vault-memory" -name "*.db" | head -1)
SQ_DB_BYTES=$(stat -f%z "$SQ_DB" 2>/dev/null || echo 0)
SQ_CHUNKS=$(grep -oE "[0-9]+ chunks" "$SPIKE_DIR/results/bench-sqlite.log" | tail -1 | grep -oE "[0-9]+" || echo "?")
echo "  ${SQ_WALL}ms, peak RSS $((SQ_RSS/1024/1024)) MB (node only; +Ollama model on GPU), db $((SQ_DB_BYTES/1024/1024)) MB, $SQ_CHUNKS chunks"

# ─── contextfit ingest + build-index ─────────────────────────────────
CF_KB="$(mktemp -d "${TMPDIR:-/tmp}/vm-bench-cf-XXXXXX")/kb"
echo "→ contextfit ingest + build-index (cold) ..."
CF_T0=$(node -e 'console.log(Date.now())')
/usr/bin/time -l "$CONTEXTFIT_BIN" --kb "$CF_KB" ingest "$VAULT_PATH" --defer-index-build \
  > "$SPIKE_DIR/results/bench-cf-ingest.log" 2>&1
/usr/bin/time -l "$CONTEXTFIT_BIN" --kb "$CF_KB" build-index \
  > "$SPIKE_DIR/results/bench-cf-build.log" 2>&1
CF_T1=$(node -e 'console.log(Date.now())')
CF_WALL=$((CF_T1 - CF_T0))
CF_RSS_INGEST=$(peak_rss "$SPIKE_DIR/results/bench-cf-ingest.log")
CF_RSS_BUILD=$(peak_rss "$SPIKE_DIR/results/bench-cf-build.log")
CF_RSS=$(( CF_RSS_INGEST > CF_RSS_BUILD ? CF_RSS_INGEST : CF_RSS_BUILD ))
CF_KB_BYTES=$(find "$CF_KB" -type f -print0 | xargs -0 stat -f%z 2>/dev/null | awk '{s+=$1} END{print s}')
CF_CHUNKS=$("$CONTEXTFIT_PY" -c "import json,sys;print(json.load(open(sys.argv[1])).get('counts',{}).get('chunks','?'))" "$CF_KB/ingest_manifest.json" 2>/dev/null || echo "?")
echo "  ${CF_WALL}ms, peak RSS $((CF_RSS/1024/1024)) MB (CPU only, no model), kb $((CF_KB_BYTES/1024/1024)) MB, $CF_CHUNKS chunks"

# ─── write JSON ──────────────────────────────────────────────────────
export VAULT_NOTES VAULT_BYTES EMBEDDING_MODEL OLLAMA_PS SQ_WALL SQ_RSS SQ_DB_BYTES SQ_CHUNKS CF_WALL CF_RSS CF_KB_BYTES CF_CHUNKS SPIKE_DIR
HW="$(sysctl -n machdep.cpu.brand_string 2>/dev/null) / $(( $(sysctl -n hw.memsize)/1024/1024/1024 )) GB"
export HW

node -e '
  const fs=require("node:fs");
  const out={
    generated_at: new Date().toISOString(),
    vault: { notes: +process.env.VAULT_NOTES, markdown_bytes: +process.env.VAULT_BYTES },
    hardware: { machine: process.env.HW||"", embedding_model: process.env.EMBEDDING_MODEL, ollama_footprint: process.env.OLLAMA_PS||"" },
    sqlite_vec: { ingest_wallclock_ms:+process.env.SQ_WALL, peak_rss_bytes:+process.env.SQ_RSS, peak_rss_note:"node process only; Ollama embedding model resident separately on GPU (~1.3 GB)", index_bytes:+process.env.SQ_DB_BYTES, chunks:process.env.SQ_CHUNKS, hardware_path:"Ollama BGE-M3 embedding on GPU (Metal) + sqlite-vec on CPU" },
    contextfit: { ingest_wallclock_ms:+process.env.CF_WALL, peak_rss_bytes:+process.env.CF_RSS, peak_rss_note:"CPU only; no neural model, no GPU", index_bytes:+process.env.CF_KB_BYTES, chunks:process.env.CF_CHUNKS, hardware_path:"CPU only (tiktoken + MinHash/LSH + roaring bitmaps); no embedding model" },
  };
  fs.writeFileSync(process.env.SPIKE_DIR+"/results/resource-metrics.json", JSON.stringify(out,null,2));
  console.error("✓ wrote results/resource-metrics.json");
'

# cleanup bench sandboxes (keep logs + json)
rm -rf "$SQ_HOME" "$(dirname "$CF_KB")"
echo
echo "── Benchmark complete → results/resource-metrics.json ──"
