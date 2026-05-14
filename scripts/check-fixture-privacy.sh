#!/bin/sh
# scripts/check-fixture-privacy.sh
#
# Fails if any path under evals/fixtures/*/ (other than v2-test-vault/)
# is committed. Detects accidental commit of a real user vault.
#
# POSIX-portable: tested on macOS (BSD grep) + Linux (GNU grep) + Alpine (BusyBox).

set -eu

ALLOW="v2-test-vault"

# Use git ls-tree (operates on git index, not working tree — robust against
# uncommitted local debris). Filter to evals/fixtures/*/ first-level dir names.
violations=$(
  git ls-tree -r --name-only HEAD 2>/dev/null \
    | grep -E '^evals/fixtures/[^/]+/' \
    | awk -F/ '{print $3}' \
    | sort -u \
    | grep -vxF "$ALLOW" \
    || true
)

if [ -n "$violations" ]; then
  echo "✗ Fixture-privacy violation: only 'evals/fixtures/$ALLOW/' is allowed." >&2
  echo "  Found committed fixtures outside the allowlist:" >&2
  printf "    - evals/fixtures/%s/\n" $violations >&2
  echo "" >&2
  echo "  Either remove these directories from git, or update the allowlist" >&2
  echo "  in scripts/check-fixture-privacy.sh after maintainer review." >&2
  exit 1
fi

echo "✓ Fixture-privacy lint passed (allowlist: $ALLOW)"
