#!/usr/bin/env bash
# Smoke test for skills/vm-install/setup.sh.
#
# Strategy:
#   1. Build a fixture plugin tarball in a temp dir containing minimal
#      manifest.json + main.js + styles.css.
#   2. Compute its SHA-256 and write it to a fixture manifest.sha256 file.
#   3. Build a fake vault layout (a directory containing `.obsidian/`).
#   4. Point the installer at the fixture URLs via VM_INSTALL_RELEASE_URL +
#      VM_INSTALL_SHA256_URL, redirect HOME to a temp dir so we don't touch
#      the real ~/.vault-memory/, and run setup.sh.
#   5. Assert the plugin was extracted into <vault>/.obsidian/plugins/vault-memory/.
#   6. Assert [plugin] enabled = true was written to the fake config.toml.
#   7. Re-run and assert the second run is a no-op (early-exit path taken).
#
# Exit codes:
#   0  all assertions passed
#   1  an assertion failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Setup test sandbox ──────────────────────────────────────────────────────

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

FAKE_HOME="$SANDBOX/home"
FAKE_VAULT="$SANDBOX/vault"
FIXTURE_DIR="$SANDBOX/fixtures"
mkdir -p "$FAKE_HOME" "$FAKE_VAULT/.obsidian" "$FIXTURE_DIR"

# ─── Build fixture tarball ───────────────────────────────────────────────────

FIXTURE_VERSION="2.0.0"
STAGE="$SANDBOX/stage"
mkdir -p "$STAGE"
cat > "$STAGE/manifest.json" <<JSON
{
  "id": "vault-memory",
  "name": "vault-memory",
  "version": "$FIXTURE_VERSION",
  "minAppVersion": "1.5.0",
  "description": "fixture",
  "author": "test",
  "isDesktopOnly": true
}
JSON
cat > "$STAGE/main.js" <<'JS'
// fixture main.js for vm-install smoke test
JS
cat > "$STAGE/styles.css" <<'CSS'
/* fixture */
CSS
cat > "$STAGE/versions.json" <<'JSON'
{ "2.0.0": "1.5.0" }
JSON

TARBALL="$FIXTURE_DIR/vault-memory-plugin-v${FIXTURE_VERSION}.tar.gz"
( cd "$STAGE" && tar -czf "$TARBALL" manifest.json main.js styles.css versions.json )

if command -v shasum >/dev/null 2>&1; then
  SHA="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
else
  SHA="$(sha256sum "$TARBALL" | awk '{print $1}')"
fi
SHA_FILE="$FIXTURE_DIR/manifest.sha256"
printf "%s\n" "$SHA" > "$SHA_FILE"

# ─── Helpers ─────────────────────────────────────────────────────────────────

PASS=0
FAIL=0

assert() {
  local desc="$1"
  shift
  if "$@"; then
    printf "  ✓ %s\n" "$desc"
    PASS=$((PASS+1))
  else
    printf "  ✗ %s\n" "$desc" >&2
    FAIL=$((FAIL+1))
  fi
}

# ─── First run ──────────────────────────────────────────────────────────────

echo "── First run: fresh install ──"

HOME="$FAKE_HOME" \
  VAULT_PATH="$FAKE_VAULT" \
  VM_INSTALL_RELEASE_URL="file://$TARBALL" \
  VM_INSTALL_SHA256_URL="file://$SHA_FILE" \
  VM_INSTALL_AUTO=1 \
  bash "$SCRIPT_DIR/setup.sh" \
  > "$SANDBOX/run1.out" 2> "$SANDBOX/run1.err" \
  || {
    echo "First run failed. stderr:"
    cat "$SANDBOX/run1.err" >&2
    exit 1
  }

assert "plugin manifest extracted" \
  test -f "$FAKE_VAULT/.obsidian/plugins/vault-memory/manifest.json"
assert "plugin main.js extracted" \
  test -f "$FAKE_VAULT/.obsidian/plugins/vault-memory/main.js"
assert "plugin styles.css extracted" \
  test -f "$FAKE_VAULT/.obsidian/plugins/vault-memory/styles.css"
assert "config.toml created" \
  test -f "$FAKE_HOME/.vault-memory/config.toml"
assert "[plugin] enabled = true set in config.toml" \
  grep -qE 'enabled[[:space:]]*=[[:space:]]*true' "$FAKE_HOME/.vault-memory/config.toml"
assert "vm-install.log created" \
  test -f "$FAKE_HOME/.vault-memory/skills/vm-install.log"
assert "manifest.json contains expected version" \
  grep -q "\"version\": \"$FIXTURE_VERSION\"" "$FAKE_VAULT/.obsidian/plugins/vault-memory/manifest.json"

# ─── Second run — must be a no-op ────────────────────────────────────────────

echo "── Second run: idempotent no-op ──"

HOME="$FAKE_HOME" \
  VAULT_PATH="$FAKE_VAULT" \
  VM_INSTALL_RELEASE_URL="file://$TARBALL" \
  VM_INSTALL_SHA256_URL="file://$SHA_FILE" \
  VM_INSTALL_AUTO=1 \
  bash "$SCRIPT_DIR/setup.sh" \
  > "$SANDBOX/run2.out" 2> "$SANDBOX/run2.err" \
  || {
    echo "Second run failed. stderr:"
    cat "$SANDBOX/run2.err" >&2
    exit 1
  }

assert "second run signals no-op via 'Already installed' message" \
  grep -q "Already installed" "$SANDBOX/run2.err"
assert "plugin manifest still present after no-op" \
  test -f "$FAKE_VAULT/.obsidian/plugins/vault-memory/manifest.json"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "FAILED" >&2
  exit 1
fi
echo "OK"
