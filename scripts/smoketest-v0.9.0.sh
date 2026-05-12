#!/usr/bin/env bash
# v0.9.0 stdio smoketest — verifies the four new tools are wired up via MCP.
# Thin wrapper around scripts/smoketest-v0.9.0.mjs with a hard timeout
# (catch-up loops can hang the driver forever otherwise).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli.js"
DRIVER="$ROOT/scripts/smoketest-v0.9.0.mjs"

if [[ ! -f "$CLI" ]]; then
  echo "build artifact missing — run \`npm run build\` first" >&2
  exit 1
fi

# macOS doesn't ship `timeout`, so we hand-roll one with perl alarm — same
# pattern used elsewhere in this repo for the v0.8 smoketests.
perl -e 'alarm 20; exec @ARGV' node "$DRIVER" "$CLI"
result=$?

if (( result == 0 )); then
  printf '\033[32m\nv0.9.0 stdio smoketest passed\033[0m\n'
else
  printf '\033[31m\nv0.9.0 stdio smoketest FAILED (exit %s)\033[0m\n' "$result"
fi
exit $result
