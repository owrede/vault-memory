#!/usr/bin/env bash
# Preflight checks for the contextfit-vs-sqlite-vec spike.
# Run from the spike directory (.planning/quick/20260522-.../).
set -euo pipefail

VAULT_PATH="${VAULT_PATH:?VAULT_PATH must be set, e.g. export VAULT_PATH='/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact'}"
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../../../.." && pwd)}"

fail() { echo "✗ $1" >&2; exit 1; }
ok()   { echo "✓ $1"; }

echo "── Preflight ──"
echo "Repo root:  $REPO_ROOT"
echo "Vault path: $VAULT_PATH"
echo

# 1. vault-memory built?
if [ ! -f "$REPO_ROOT/dist/cli.js" ]; then
  fail "dist/cli.js missing — run 'npm install && npm run build' in $REPO_ROOT"
fi
ok "vault-memory built: $REPO_ROOT/dist/cli.js"

# 2. Node version
NODE_MAJ=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJ" -lt 22 ]; then
  fail "Node >=22 required (have v$(node -v))"
fi
ok "Node $(node -v)"

# 3. Vault accessible?
if [ ! -d "$VAULT_PATH" ]; then
  fail "Vault directory not found: $VAULT_PATH"
fi
VAULT_NOTE_COUNT=$(find "$VAULT_PATH" -type f -name "*.md" -not -path "*/.obsidian/*" -not -path "*/.trash/*" | wc -l | tr -d ' ')
ok "Vault accessible: $VAULT_NOTE_COUNT markdown files"

# 4. Ollama reachable?
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://localhost:11434}"
if ! curl -fsS --max-time 3 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
  fail "Ollama not reachable at $OLLAMA_ENDPOINT — run 'ollama serve'"
fi
ok "Ollama reachable: $OLLAMA_ENDPOINT"

# 5. Embedding model installed?
MODELS=$(curl -fsS "$OLLAMA_ENDPOINT/api/tags" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log((o.models||[]).map(m=>m.name).join("\n"));})')
EMBEDDING_MODEL=""
for candidate in "bge-m3:latest" "bge-m3" "qwen3-embedding:latest" "qwen3-embedding"; do
  if echo "$MODELS" | grep -qx "$candidate"; then
    EMBEDDING_MODEL="$candidate"
    break
  fi
done
if [ -z "$EMBEDDING_MODEL" ]; then
  fail "No embedding model found in Ollama. Try: ollama pull bge-m3"
fi
ok "Embedding model available: $EMBEDDING_MODEL"
echo "EMBEDDING_MODEL=$EMBEDDING_MODEL" > "${SPIKE_DIR:-.}/results/.env"

# 6. Python + contextfit
if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 not found"
fi
PY_VER=$(python3 -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_OK=$(python3 -c 'import sys;print(int(sys.version_info >= (3,10)))')
if [ "$PY_OK" != "1" ]; then
  fail "Python >=3.10 required (have $PY_VER)"
fi
ok "Python $PY_VER"

# Try `contextfit` from PATH; allow override via $CONTEXTFIT_BIN.
CONTEXTFIT_BIN="${CONTEXTFIT_BIN:-$(command -v contextfit || echo '')}"
if [ -z "$CONTEXTFIT_BIN" ] || [ ! -x "$CONTEXTFIT_BIN" ]; then
  fail "contextfit not found. Install: 'pip install contextfit' or set CONTEXTFIT_BIN=/path/to/contextfit"
fi
CF_VERSION=$("$CONTEXTFIT_BIN" --version 2>/dev/null || echo 'unknown')
ok "contextfit available: $CONTEXTFIT_BIN ($CF_VERSION)"
echo "CONTEXTFIT_BIN=$CONTEXTFIT_BIN" >> "${SPIKE_DIR:-.}/results/.env"

# The persistent query server (scripts/contextfit-server.py) must run under
# the SAME interpreter that has contextfit installed — i.e. the venv python
# next to the contextfit entrypoint, not the bare system python3.
CONTEXTFIT_PY="$(dirname "$CONTEXTFIT_BIN")/python3"
if [ ! -x "$CONTEXTFIT_PY" ]; then
  CONTEXTFIT_PY="$(command -v python3)"
fi
ok "contextfit interpreter: $CONTEXTFIT_PY"
echo "CONTEXTFIT_PY=$CONTEXTFIT_PY" >> "${SPIKE_DIR:-.}/results/.env"

# 7. tiktoken encoding reachable? contextfit tokenizes with cl100k_base, which
# tiktoken lazily downloads from openaipublic.blob.core.windows.net on first
# use. Behind a restrictive proxy/firewall this 403s and ingest fails. Warm
# it here so the failure (if any) surfaces in preflight, not mid-ingest.
if python3 -c "import tiktoken; tiktoken.get_encoding('cl100k_base')" >/dev/null 2>&1; then
  ok "tiktoken cl100k_base encoding available"
else
  fail "tiktoken cannot fetch cl100k_base encoding (blocked network?). Fix: pre-seed \$TIKTOKEN_CACHE_DIR with cl100k_base.tiktoken, or run on an unrestricted network."
fi

echo
echo "── Preflight complete ──"
