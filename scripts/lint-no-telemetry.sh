#!/bin/sh
# scripts/lint-no-telemetry.sh
#
# Fails if src/**/*.ts contains any banned substring (case-insensitive)
# without a sibling `// vault-memory:no-telemetry-ok` escape comment.
#
# Banlist is curated; updates require maintainer review.

set -eu

# Banned substrings (case-insensitive). Whole-word match where reasonable;
# substring match where it must (e.g., "segment.com" is a domain).
BANNED='analytics|telemetry|posthog|segment\.com|mixpanel|sentry|datadog|track\(|trackEvent|report\(|reportMetric'

# The escape marker. If a line containing a banned substring ALSO contains
# this marker on the same line, it is allowed.
ESCAPE='vault-memory:no-telemetry-ok'

# Find all .ts files under src/, exclude *.test.ts (banned-word references
# in tests/comments are OK if escaped — but the test should be obvious).
violations=$(
  find src -name '*.ts' -not -name '*.test.ts' -type f \
    | xargs grep -inE "$BANNED" 2>/dev/null \
    | grep -v "$ESCAPE" \
    || true
)

if [ -n "$violations" ]; then
  echo "✗ Telemetry-banlist violation in src/**/*.ts:" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "  If this is a legitimate non-telemetry reference, append" >&2
  echo "  '// $ESCAPE' to the offending line." >&2
  exit 1
fi

echo "✓ Telemetry banlist clean ($(find src -name '*.ts' -not -name '*.test.ts' | wc -l | tr -d ' ') files scanned)"
