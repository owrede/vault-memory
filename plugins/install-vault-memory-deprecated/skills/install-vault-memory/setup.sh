#!/usr/bin/env bash
# install-vault-memory — DEPRECATED redirect shim.
#
# The old `/install-vault-memory:install-vault-memory` slug has been
# replaced by the cleaner `/vmem:install` / `/vmem:health` / `/vmem:reindex`
# surface. This script prints a redirect and exits 0 — it does NOT
# install or modify anything.

c_reset=$'\033[0m'
c_yellow=$'\033[33m'
c_bold=$'\033[1m'

cat >&2 <<EOF

${c_yellow}${c_bold}⚠ /install-vault-memory has been renamed to /vmem${c_reset}

The install-vault-memory plugin is deprecated. To set up vault-memory:

  1. Install the ${c_bold}vmem${c_reset} plugin from the same marketplace
  2. Run ${c_bold}/vmem:install${c_reset}

Other new commands:
  ${c_bold}/vmem:health${c_reset}   — read-only diagnostic
  ${c_bold}/vmem:reindex${c_reset}  — rebuild the vector index

After installing vmem, uninstall this deprecated plugin to clean up.

This shim plugin will be removed from the marketplace in 60 days.

EOF
exit 0
