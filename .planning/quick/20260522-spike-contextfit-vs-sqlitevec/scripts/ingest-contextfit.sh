#!/usr/bin/env bash
# Ingest the vault into a fresh contextfit_kb under the sandbox.
# Records wallclock + KB size into results/setup-metrics.json (append).
set -euo pipefail

VAULT_PATH="${VAULT_PATH:?}"
SANDBOX="${SANDBOX:?}"
CONTEXTFIT_BIN="${CONTEXTFIT_BIN:?}"
SPIKE_DIR="${SPIKE_DIR:?}"

KB="$SANDBOX/contextfit_kb"
mkdir -p "$KB"

echo "→ contextfit ingest ($VAULT_PATH → $KB)"
START_TS=$(node -e 'console.log(Date.now())')

# --defer-index-build + --rebuild-index-after-ingest is the recommended
# large-vault pattern from contextfit's MacBook deploy doc — keeps RAM
# flat during ingest, builds the final postings.bin afterward.
"$CONTEXTFIT_BIN" --kb "$KB" ingest "$VAULT_PATH" \
  --defer-index-build \
  --rebuild-index-after-ingest \
  2>&1 | tee "$SPIKE_DIR/results/contextfit-ingest.log"

END_TS=$(node -e 'console.log(Date.now())')
WALLCLOCK_MS=$((END_TS - START_TS))
KB_BYTES=$(du -sk "$KB" | awk '{print $1 * 1024}')

node -e '
  const fs = require("node:fs");
  const p = process.env.SPIKE_DIR + "/results/setup-metrics.json";
  const existing = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : {};
  // chunk count comes from the ingest manifest (no tokenizer load needed).
  let chunks = null;
  try {
    const m = JSON.parse(fs.readFileSync(process.env.KB + "/ingest_manifest.json", "utf8"));
    chunks = m?.counts?.chunks ?? null;
  } catch {}
  existing.contextfit = {
    wallclock_ms: parseInt(process.env.WALLCLOCK_MS, 10),
    kb_bytes: parseInt(process.env.KB_BYTES, 10),
    chunks_indexed: chunks,
    kb_path: process.env.KB,
    completed_at: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(existing, null, 2));
' WALLCLOCK_MS="$WALLCLOCK_MS" KB_BYTES="$KB_BYTES" KB="$KB"

echo "✓ contextfit ingest: ${WALLCLOCK_MS}ms, $(du -sh "$KB" | cut -f1)"
