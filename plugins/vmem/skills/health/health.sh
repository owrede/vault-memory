#!/usr/bin/env bash
# /vmem:health — thin dispatch into install/setup.sh's diagnostic mode.
#
# All probing logic lives in install/setup.sh under the
# VAULT_MEMORY_DIAGNOSE=1 branch. This wrapper exists so the user can
# invoke `/vmem:health` without remembering the env var.

set -u
set -o pipefail

# When invoked from the plugin tree (.claude/skills/health/health.sh),
# the sibling install/ directory holds the canonical setup.sh.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SETUP="$SCRIPT_DIR/../install/setup.sh"

if [ ! -x "$INSTALL_SETUP" ]; then
  # When invoked via the marketplace plugin path, setup.sh might live
  # in a peer skill directory. Try the absolute layout under
  # ~/.claude/plugins/cache/<plugin>/skills/install/setup.sh as a fallback.
  alt=$(find "${CLAUDE_PROJECT_DIR:-$HOME}/.claude" -maxdepth 6 -name 'setup.sh' -path '*/skills/install/setup.sh' 2>/dev/null | head -1 || true)
  if [ -n "$alt" ]; then
    INSTALL_SETUP="$alt"
  else
    echo "error: install/setup.sh not found relative to $SCRIPT_DIR" >&2
    echo "       run /vmem:install once to populate the plugin tree" >&2
    exit 1
  fi
fi

exec env VAULT_MEMORY_DIAGNOSE=1 bash "$INSTALL_SETUP" "$@"
