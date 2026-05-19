#!/usr/bin/env bash
# Smoke test for skills/vm-update/update.sh.
#
# Two scenarios:
#   A. No-op path — installed == latest → "Already up to date" exit 0
#   B. Upgrade path — installed < latest → downloads fixture, verifies SHA,
#      swaps in the new plugin atomically
#
# Exit codes:
#   0  all assertions passed
#   1  an assertion failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

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

# ─── Build a fixture plugin tarball for a given version ──────────────────────

build_fixture_tarball() {
  local version="$1"
  local out_dir="$2"
  local stage
  stage="$(mktemp -d)"
  cat > "$stage/manifest.json" <<JSON
{
  "id": "vault-memory",
  "name": "vault-memory",
  "version": "$version",
  "minAppVersion": "1.5.0",
  "description": "fixture v$version",
  "author": "test",
  "isDesktopOnly": true
}
JSON
  printf "// fixture main v%s\n" "$version" > "$stage/main.js"
  printf "/* fixture styles v%s */\n" "$version" > "$stage/styles.css"
  printf '{ "%s": "1.5.0" }\n' "$version" > "$stage/versions.json"

  local tarball="$out_dir/vault-memory-plugin-v${version}.tar.gz"
  ( cd "$stage" && tar -czf "$tarball" manifest.json main.js styles.css versions.json )

  local sha
  if command -v shasum >/dev/null 2>&1; then
    sha="$(shasum -a 256 "$tarball" | awk '{print $1}')"
  else
    sha="$(sha256sum "$tarball" | awk '{print $1}')"
  fi
  printf "%s\n" "$sha" > "$out_dir/manifest-v${version}.sha256"

  rm -rf "$stage"
  printf "%s" "$tarball"
}

# Place a manifest.json in a vault plugin dir simulating an installed plugin.
install_fixture_plugin() {
  local vault="$1"
  local version="$2"
  local plugin_dir="$vault/.obsidian/plugins/vault-memory"
  mkdir -p "$plugin_dir"
  cat > "$plugin_dir/manifest.json" <<JSON
{
  "id": "vault-memory",
  "name": "vault-memory",
  "version": "$version",
  "minAppVersion": "1.5.0",
  "description": "preinstalled fixture v$version",
  "author": "test",
  "isDesktopOnly": true
}
JSON
  printf "// preinstalled main v%s\n" "$version" > "$plugin_dir/main.js"
}

# ─── Scenario A: no-op ───────────────────────────────────────────────────────

echo "── Scenario A: no-op (installed == latest) ──"

VAULT_A="$SANDBOX/vault-a"
HOME_A="$SANDBOX/home-a"
FIX_A="$SANDBOX/fixtures-a"
mkdir -p "$VAULT_A/.obsidian" "$HOME_A" "$FIX_A"

install_fixture_plugin "$VAULT_A" "2.0.0"

if HOME="$HOME_A" \
  VAULT_PATH="$VAULT_A" \
  VM_UPDATE_LATEST_VERSION="2.0.0" \
  VM_UPDATE_AUTO=1 \
  bash "$SCRIPT_DIR/update.sh" \
  > "$SANDBOX/run-a.out" 2> "$SANDBOX/run-a.err"
then
  RUN_A_EXIT=0
else
  RUN_A_EXIT=$?
fi

assert "no-op run exits 0" \
  test "$RUN_A_EXIT" -eq 0
assert "no-op prints 'Already up to date'" \
  grep -q "Already up to date" "$SANDBOX/run-a.err"
assert "no-op leaves installed manifest untouched (still v2.0.0)" \
  grep -q '"version": "2.0.0"' "$VAULT_A/.obsidian/plugins/vault-memory/manifest.json"

# ─── Scenario B: upgrade path ────────────────────────────────────────────────

echo "── Scenario B: upgrade (installed < latest) ──"

VAULT_B="$SANDBOX/vault-b"
HOME_B="$SANDBOX/home-b"
FIX_B="$SANDBOX/fixtures-b"
mkdir -p "$VAULT_B/.obsidian" "$HOME_B" "$FIX_B"

install_fixture_plugin "$VAULT_B" "2.0.0"

NEW_TARBALL="$(build_fixture_tarball "2.1.0" "$FIX_B")"
NEW_SHA_FILE="$FIX_B/manifest-v2.1.0.sha256"

if HOME="$HOME_B" \
  VAULT_PATH="$VAULT_B" \
  VM_UPDATE_LATEST_VERSION="2.1.0" \
  VM_UPDATE_RELEASE_URL="file://$NEW_TARBALL" \
  VM_UPDATE_SHA256_URL="file://$NEW_SHA_FILE" \
  VM_UPDATE_AUTO=1 \
  bash "$SCRIPT_DIR/update.sh" \
  > "$SANDBOX/run-b.out" 2> "$SANDBOX/run-b.err"
then
  RUN_B_EXIT=0
else
  RUN_B_EXIT=$?
fi

assert "upgrade run exits 0" \
  test "$RUN_B_EXIT" -eq 0
assert "upgrade prints version delta v2.0.0 -> v2.1.0" \
  grep -qE "v2\.0\.0.*v2\.1\.0" "$SANDBOX/run-b.err"
assert "upgrade prints SHA-256 OK line" \
  grep -q "SHA-256 OK" "$SANDBOX/run-b.err"
assert "upgrade prompts user to reload" \
  grep -qi "Reload" "$SANDBOX/run-b.err"
assert "upgrade replaces installed manifest with v2.1.0" \
  grep -q '"version": "2.1.0"' "$VAULT_B/.obsidian/plugins/vault-memory/manifest.json"
assert "no .OLD/.NEW staging dirs left behind" \
  bash -c 'test ! -d "'"$VAULT_B"'/.obsidian/plugins/vault-memory.OLD" \
        && test ! -d "'"$VAULT_B"'/.obsidian/plugins/vault-memory.NEW"'
assert "vm-update.log created" \
  test -f "$HOME_B/.vault-memory/skills/vm-update.log"

# ─── Scenario C: re-run after upgrade → no-op ────────────────────────────────

echo "── Scenario C: re-run after upgrade is a no-op ──"

if HOME="$HOME_B" \
  VAULT_PATH="$VAULT_B" \
  VM_UPDATE_LATEST_VERSION="2.1.0" \
  VM_UPDATE_RELEASE_URL="file://$NEW_TARBALL" \
  VM_UPDATE_SHA256_URL="file://$NEW_SHA_FILE" \
  VM_UPDATE_AUTO=1 \
  bash "$SCRIPT_DIR/update.sh" \
  > "$SANDBOX/run-c.out" 2> "$SANDBOX/run-c.err"
then
  RUN_C_EXIT=0
else
  RUN_C_EXIT=$?
fi

assert "re-run after upgrade exits 0" \
  test "$RUN_C_EXIT" -eq 0
assert "re-run prints 'Already up to date'" \
  grep -q "Already up to date" "$SANDBOX/run-c.err"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "FAILED" >&2
  exit 1
fi
echo "OK"
