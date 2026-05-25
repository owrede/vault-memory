#!/bin/sh
# scripts/lint-adapters.sh
#
# Mechanically enforces the adapter-seam invariants from ADR-002 §Invariants
# plus the C-1 Claude-leak invariant (D-02). Fails the build if any
# vault-content read, vault-content write, frontmatter parse, or
# client-name hardcode bleeds outside the obsidian-fs adapters.
#
# POSIX-portable: tested on macOS (BSD grep) + Linux (GNU grep) + Alpine
# (BusyBox). No bash-isms. The lint script is run by `npm run lint:check`
# in CI on every PR + push to main.

set -eu

FAIL=0

# ----------------------------------------------------------------------
# check(): runs a single invariant grep.
#
#   $1  invariant id (e.g. "I-1")
#   $2  extended-regex pattern (passed to `grep -E`)
#   $3  allow-list extended-regex (matched against the leading path of each
#       `grep -rEn` hit). Pass "NONEXISTENT_PREFIX" to disallow all hits.
#   $4  one-line human-readable description for output
#
# The grep over src/ excludes *.test.ts — test files legitimately import
# things to drive fixtures (e.g. gray-matter for assertion setup). The
# escape comment marker `// vault-memory:claude-ok` allows legitimate
# references (e.g. real product-name "Claude.ai" in a tool description)
# without weakening the gate.
# ----------------------------------------------------------------------

ESCAPE_MARK='vault-memory:claude-ok'

check() {
  invariant="$1"
  pattern="$2"
  allowed_prefix="$3"
  description="$4"

  # -a: treat as text (some src files contain UTF-8 em-dash, which BSD grep /
  # ugrep flag as binary and would silently skip without -a).
  # --exclude-dir: also skip `__test_helpers__/` (jest-convention dir for
  # test-only fixture builders that legitimately import raw FS — they
  # never end up in the production bundle; their imports are part of
  # test setup, not the seam).
  raw=$(grep -arEn "$pattern" src \
    --include='*.ts' \
    --exclude='*.test.ts' \
    --exclude-dir='__test_helpers__' \
    2>/dev/null || true)
  hits=$(printf '%s\n' "$raw" \
    | grep -vE "^$allowed_prefix" \
    | grep -vF "$ESCAPE_MARK" \
    || true)

  if [ -n "$hits" ]; then
    echo "✗ Invariant $invariant violated ($description):" >&2
    printf '%s\n' "$hits" | sed 's/^/    /' >&2
    FAIL=1
  else
    echo "✓ $invariant green: $description"
  fi
}

# ----------------------------------------------------------------------
# I-1: chokidar import only in change-feed adapter.
# ----------------------------------------------------------------------
check "I-1" \
  '^import .* from "chokidar"|^import .* from '\''chokidar'\''' \
  'src/adapters/change-feed/obsidian-fs/' \
  'chokidar import'

# ----------------------------------------------------------------------
# I-2: raw node:fs / node:fs/promises only in adapters + infrastructure
# (config loader, vault DB-dir mgmt, ONNX reranker model loader).
#
# Rationale for non-adapter allow-list entries:
#   - src/config/      reads ~/.vault-memory/config.toml + writes .mcp.json
#                      (CLI onboarding, NOT vault content)
#   - src/vault/       mkdir for ~/.vault-memory/vaults/ SQLite DB dir
#   - src/rerank/      ONNX model dir (~/.vault-memory/models/...)
#   - src/plugin-tools/set-mcp-client.ts — the ONE plugin-tool that mutates
#                      ~/.vault-memory/config.toml ([contracts.mcp_clients.*]
#                      CRUD), justified by ADR-007 §D-CHROME-CONNECTORS. A
#                      config-file path, NOT vault content — same class as
#                      src/config/. Narrow single-file allowance; the rest of
#                      src/plugin-tools/ stays seam-bound.
# These are infrastructure / config paths, NOT vault-content reads/writes. The
# seam invariant is "vault content goes through the adapter"; these
# paths never touch vault content.
# ----------------------------------------------------------------------
check "I-2" \
  '^import .* from "(node:)?fs"|^import .* from "(node:)?fs/promises"|^import .* from '\''(node:)?fs'\''|^import .* from '\''(node:)?fs/promises'\''' \
  'src/(adapters|config|vault|rerank)/|src/plugin-tools/set-mcp-client\.ts:' \
  'raw fs imports'

# ----------------------------------------------------------------------
# I-3: raw node:path only in adapters + infrastructure.
#
# Same allow-list as I-2, plus:
#   - src/server.ts        joinPath for ONNX model dir default
#   - src/indexer/single.ts vault-boundary path-resolution check
# ----------------------------------------------------------------------
check "I-3" \
  'from "(node:)?path"|from '\''(node:)?path'\''' \
  'src/(adapters|config|vault|rerank|indexer/single\.ts|server\.ts)' \
  'raw path imports'

# ----------------------------------------------------------------------
# I-4: gray-matter only in obsidian-fs source AND delivery adapters.
# (Delivery owns frontmatter MUTATION; source owns frontmatter PARSE.)
# ----------------------------------------------------------------------
check "I-4" \
  '^import .* from "gray-matter"|^import .* from '\''gray-matter'\''' \
  'src/adapters/(source|delivery)/obsidian-fs/' \
  'gray-matter import'

# ----------------------------------------------------------------------
# I-5: bare ".md" literals only in adapters.
# ----------------------------------------------------------------------
check "I-5" \
  '"\.md"|'\''\.md'\''|endsWith\("\.md"\)|endsWith\('\''\.md'\''\)' \
  'src/adapters/' \
  'bare .md literals'

# ----------------------------------------------------------------------
# I-6: fs.writeFile / fs.unlink / fs.rename only in delivery adapter +
# config (.mcp.json + config.toml writes during CLI onboarding).
# ----------------------------------------------------------------------
check "I-6" \
  'fs\.(writeFile|unlink|rename)' \
  'src/(adapters/delivery|config)/' \
  'raw write operations'

# ----------------------------------------------------------------------
# I-5b: `obsidian://` URL literal only in source adapter (the single
# minting site for Obsidian display URLs) + docs/types/registry comments
# that reference the format.
# ----------------------------------------------------------------------
check "I-5b" \
  'obsidian://' \
  'src/(adapters/source/obsidian-fs/|adapters/source/types\.ts|adapters/registry\.ts|server\.ts)' \
  'obsidian:// literal'

# ----------------------------------------------------------------------
# C-1: Claude-leak. No quoted "claude*" string identifiers, no bare
# "Claude Code" / "Claude.ai" mentions. The hardcoded
# DEFAULT_CLIENT_ID = "claude-code" was the canonical leak (D-02);
# this gate prevents reintroduction. Legitimate ecosystem mentions
# (the literal product name "Claude.ai" in an OB1-connector tool
# description) carry the `// vault-memory:claude-ok` escape marker.
# ----------------------------------------------------------------------
check "C-1" \
  '"claude[^"]*"|'\''claude[^'\'']*'\''|Claude Code|Claude\.ai|Claude Desktop|claude-code' \
  'NONEXISTENT_PREFIX' \
  'Claude branding / hardcoded client-id'

# ----------------------------------------------------------------------
# Exit handling.
# ----------------------------------------------------------------------
if [ "$FAIL" -eq 1 ]; then
  echo "" >&2
  echo "Adapter-seam invariant violation(s) above." >&2
  echo "See docs/v2/adr/002-adapter-seams.md §Invariants for the contract." >&2
  echo "" >&2
  echo "If a hit is a legitimate ecosystem reference (e.g. the real product" >&2
  echo "name 'Claude.ai' in a tool description), append the comment" >&2
  echo "  // $ESCAPE_MARK" >&2
  echo "to the same line." >&2
  exit 1
fi

echo "✓ All adapter-seam invariants green."
