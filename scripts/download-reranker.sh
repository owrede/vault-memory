#!/usr/bin/env bash
# Download BAAI/bge-reranker-v2-m3 ONNX model + tokenizer into
# ~/.vault-memory/models/bge-reranker-v2-m3/. Idempotent: re-runs skip
# files that already exist with non-zero size.

set -euo pipefail

DIR="${VAULT_MEMORY_RERANKER_DIR:-$HOME/.vault-memory/models/bge-reranker-v2-m3}"
BASE="https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/resolve/main"

mkdir -p "$DIR"

fetch() {
  local url="$1"
  local out="$2"
  if [[ -s "$out" ]]; then
    echo "✓ $(basename "$out") already present ($(du -h "$out" | cut -f1))"
    return 0
  fi
  echo "→ Downloading $(basename "$out")…"
  curl -L --fail --progress-bar "$url" -o "$out.partial"
  mv "$out.partial" "$out"
  echo "✓ Downloaded $(basename "$out") ($(du -h "$out" | cut -f1))"
}

fetch "$BASE/onnx/model_quantized.onnx" "$DIR/model_quantized.onnx"
fetch "$BASE/tokenizer.json"           "$DIR/tokenizer.json"

echo
echo "✓ Reranker model ready at $DIR"
echo "  Set in ~/.vault-memory/config.toml:"
echo "    [server]"
echo "    reranker_model = \"bge-reranker-v2-m3\""
echo "    reranker_backend = \"onnx\"   # (default when reranker_model is set)"
