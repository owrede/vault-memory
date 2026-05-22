#!/usr/bin/env bash
# Orchestrator for the contextfit-vs-sqlite-vec spike.
#
# Usage:
#   export VAULT_PATH='/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact'
#   ./run.sh setup     # preflight + ingest both backends (~3-15 min)
#   ./run.sh query     # run all queries against both, render report.md (~1-3 min)
#   ./run.sh aggregate # after manual evaluation in report.md, compute metrics
#   ./run.sh clean     # remove sandbox + results
#   ./run.sh all       # setup + query (manual evaluation between this and aggregate)
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SPIKE_DIR/../../.." && pwd)"
export SPIKE_DIR REPO_ROOT

print_help() {
  cat <<'EOF'
Spike orchestrator: contextfit vs. sqlite-vec.

REQUIRED ENV:
  VAULT_PATH        Absolute path to your Obsidian vault.
  CONTEXTFIT_BIN    (optional) path to `contextfit`; auto-detected from PATH.
  OLLAMA_ENDPOINT   (optional) default http://localhost:11434

COMMANDS:
  ./run.sh setup       Run preflight, build sandbox config, ingest both backends.
  ./run.sh query       Drive both backends with queries.yaml, render report.md.
  ./run.sh aggregate   Parse manual evaluation in report.md → metrics.{md,json}.
  ./run.sh clean       Wipe sandbox + results/.
  ./run.sh all         setup + query (manual eval needed before aggregate).

Output:
  results/setup-metrics.json   Per-backend ingest wallclock + storage footprint.
  results/sqlite-vec-raw.json  Per-query Top-10 hits + latencies.
  results/contextfit-raw.json  Per-query Top-10 hits + latencies.
  results/query-metrics.json   P50/P95 latency summary.
  results/report.md            Side-by-side per-query report for manual scoring.
  results/metrics.md           Recall@5, MRR, etc. after aggregate.
  results/metrics.json         Same, machine-readable.
EOF
}

run_setup() {
  : "${VAULT_PATH:?VAULT_PATH not set — export it first.}"
  mkdir -p "$SPIKE_DIR/results"

  if [ -z "${SANDBOX:-}" ]; then
    SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/vm-spike-XXXXXX")"
    echo "$SANDBOX" > "$SPIKE_DIR/results/.sandbox"
    export SANDBOX
  fi
  echo "→ sandbox: $SANDBOX"

  bash "$SPIKE_DIR/scripts/preflight.sh"

  if [ -f "$SPIKE_DIR/results/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SPIKE_DIR/results/.env"
    set +a
  fi

  export HOME="$SANDBOX"
  mkdir -p "$SANDBOX/.vault-memory"
  cat > "$SANDBOX/.vault-memory/config.toml" <<EOF
[server]
log_level = "warn"
ollama_endpoint = "${OLLAMA_ENDPOINT:-http://localhost:11434}"
default_embedding_model = "$EMBEDDING_MODEL"

[[vaults]]
name = "spike"
path = "$VAULT_PATH"
write_enabled = false
exclude_globs = [".obsidian/**", ".trash/**"]
EOF
  echo "✓ wrote $SANDBOX/.vault-memory/config.toml"

  echo "→ vault-memory index (sqlite-vec + Ollama)"
  local SQ_START SQ_END SQ_WALL DB_PATH DB_BYTES NOTES_COUNT
  SQ_START=$(node -e 'console.log(Date.now())')
  node "$REPO_ROOT/dist/cli.js" index --vault spike --full \
    2>&1 | tee "$SPIKE_DIR/results/sqlite-vec-ingest.log"
  SQ_END=$(node -e 'console.log(Date.now())')
  SQ_WALL=$((SQ_END - SQ_START))

  DB_PATH="$SANDBOX/.vault-memory/spike.db"
  if [ -f "$DB_PATH" ]; then
    DB_BYTES=$(stat -f%z "$DB_PATH" 2>/dev/null || stat -c%s "$DB_PATH")
    NOTES_COUNT=$(node -e "
      const Database = require('$REPO_ROOT/node_modules/better-sqlite3');
      const db = new Database('$DB_PATH', { readonly: true });
      console.log(db.prepare('SELECT count(*) AS n FROM notes').get().n);
    " 2>/dev/null || echo "?")
  else
    DB_BYTES=0
    NOTES_COUNT="?"
  fi

  node -e '
    const fs = require("node:fs");
    const p = process.env.SPIKE_DIR + "/results/setup-metrics.json";
    const cur = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : {};
    cur.sqlite_vec = {
      wallclock_ms: parseInt(process.env.SQ_WALL, 10),
      db_bytes: parseInt(process.env.DB_BYTES, 10),
      notes_indexed: process.env.NOTES_COUNT === "?" ? null : parseInt(process.env.NOTES_COUNT, 10),
      db_path: process.env.DB_PATH,
      completed_at: new Date().toISOString(),
    };
    fs.writeFileSync(p, JSON.stringify(cur, null, 2));
  ' SQ_WALL="$SQ_WALL" DB_BYTES="$DB_BYTES" NOTES_COUNT="$NOTES_COUNT" DB_PATH="$DB_PATH"
  echo "✓ sqlite-vec ingest: ${SQ_WALL}ms, $NOTES_COUNT notes, $(du -sh "$DB_PATH" 2>/dev/null | cut -f1 || echo '?')"

  bash "$SPIKE_DIR/scripts/ingest-contextfit.sh"

  echo
  echo "── Setup complete ──"
  echo "Sandbox: $SANDBOX"
  echo "Next:    ./run.sh query"
}

run_query() {
  : "${VAULT_PATH:?VAULT_PATH not set — export it first.}"
  if [ ! -f "$SPIKE_DIR/results/.sandbox" ]; then
    echo "No sandbox found. Run './run.sh setup' first." >&2
    exit 2
  fi
  SANDBOX="$(cat "$SPIKE_DIR/results/.sandbox")"
  export SANDBOX HOME="$SANDBOX"

  if [ -f "$SPIKE_DIR/results/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SPIKE_DIR/results/.env"
    set +a
  fi

  node "$SPIKE_DIR/scripts/query-both.mjs"
  node "$SPIKE_DIR/scripts/render.mjs"

  echo
  echo "── Query phase complete ──"
  echo "Next: Bewerte Treffer in $SPIKE_DIR/results/report.md, dann './run.sh aggregate'"
}

run_aggregate() {
  if [ ! -f "$SPIKE_DIR/results/report.md" ]; then
    echo "results/report.md missing — run './run.sh query' first." >&2
    exit 2
  fi
  node "$SPIKE_DIR/scripts/aggregate.mjs"
  echo
  echo "── Aggregation complete ──"
  echo "→ $SPIKE_DIR/results/metrics.md"
  echo "→ $SPIKE_DIR/results/metrics.json"
  echo "Übertrage das Verdict in SUMMARY.md."
}

run_clean() {
  if [ -f "$SPIKE_DIR/results/.sandbox" ]; then
    local SB
    SB="$(cat "$SPIKE_DIR/results/.sandbox")"
    if [ -d "$SB" ]; then
      echo "→ rm -rf $SB"
      rm -rf "$SB"
    fi
  fi
  echo "→ rm -rf $SPIKE_DIR/results"
  rm -rf "$SPIKE_DIR/results"
  echo "✓ clean"
}

CMD="${1:-help}"
case "$CMD" in
  setup)     run_setup ;;
  query)     run_query ;;
  aggregate) run_aggregate ;;
  clean)     run_clean ;;
  all)       run_setup && run_query ;;
  help|"")   print_help ;;
  *)         echo "Unknown: $CMD" >&2; print_help; exit 2 ;;
esac
