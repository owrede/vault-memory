#!/usr/bin/env python3
"""Persistent contextfit query server for the spike harness.

Mirrors how vault-memory's MCP server stays warm: load the RetrievalEngine
ONCE, then serve many queries over stdin/stdout. This removes the per-call
Python-interpreter + `import contextfit` + RetrievalEngine.load() cost
(~0.7s) from the measured query latency, so the comparison reflects the
retrieval algorithm — not CLI cold-start.

Protocol (newline-delimited JSON):
  stdin  : one request per line  -> {"query": str, "top_k": int, "method": str}
           a line {"cmd": "quit"} stops the server.
  stdout : one response per line -> the exact dict cli.py `_query_to_json`
           emits (same shape the harness already parses), wrapped as
           {"ok": true, "result": <_query_to_json dict>}; on error
           {"ok": false, "error": str}.
  stderr : a single READY line once the engine is loaded, plus diagnostics.

Usage:
  contextfit-server.py --kb /path/to/contextfit_kb [--tokenizer cl100k_base]
"""

import argparse
import json
import sys
from pathlib import Path

from contextfit import RetrievalEngine
import contextfit.cli as cli


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kb", required=True)
    ap.add_argument("--tokenizer", default="cl100k_base")
    args = ap.parse_args()

    kb_path = Path(args.kb)
    if not kb_path.exists():
        print(f"FATAL: knowledge base not found at {kb_path}", file=sys.stderr)
        return 1

    # The expensive part — done exactly once, like vault-memory's warm server.
    engine = RetrievalEngine.load(kb_path, tokenizer_name=args.tokenizer)
    print("READY", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"bad json: {e}"}), flush=True)
            continue

        if req.get("cmd") == "quit":
            break

        try:
            query = req["query"]
            top_k = int(req.get("top_k", 10))
            method = req.get("method", "hybrid")
            result = engine.query(query, top_k=top_k, method=method)
            payload = cli._query_to_json(engine, query, result)
            print(json.dumps({"ok": True, "result": payload}), flush=True)
        except Exception as e:  # noqa: BLE001 — surface any engine error to the driver
            print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
