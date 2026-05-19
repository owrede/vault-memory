#!/usr/bin/env bash
# vault-memory plugin installer — invoked by /vm-install skill.
#
# Downloads the vault-memory Obsidian plugin tarball from GitHub Releases,
# verifies SHA-256 against the release's manifest.sha256, extracts atomically
# to <vault>/.obsidian/plugins/vault-memory/, and sets [plugin] enabled = true
# in ~/.vault-memory/config.toml.
#
# Idempotent: re-running with the same version is a no-op (skips download/
# extraction via version check; config flag is set idempotently).
#
# Exit codes:
#   0  success (or already installed at the same version)
#   1  recoverable failure with instructions printed
#   2  user declined a required step
#   3  SHA-256 verification failed (potential tampering — investigate)

set -euo pipefail

# ─── Release configuration ─────────────────────────────────────────────────────
#
# TODO: replace placeholder before publishing
# The v2.0.0 release has NOT been published to GitHub Releases yet. Until
# Phase 8 release prep ships the tarball + checksum, this URL returns 404.
# For testing, override via VM_INSTALL_RELEASE_URL / VM_INSTALL_SHA256_URL.
RELEASE_URL_PLACEHOLDER="https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-v2.0.0.tar.gz"
SHA256_URL_PLACEHOLDER="https://github.com/owrede/vault-memory/releases/download/v2.0.0/manifest.sha256"

RELEASE_URL="${VM_INSTALL_RELEASE_URL:-$RELEASE_URL_PLACEHOLDER}"
SHA256_URL="${VM_INSTALL_SHA256_URL:-$SHA256_URL_PLACEHOLDER}"

# ─── Colors / logging ─────────────────────────────────────────────────────────

c_reset=$'\033[0m'
c_dim=$'\033[2m'
c_green=$'\033[32m'
c_yellow=$'\033[33m'
c_red=$'\033[31m'
c_bold=$'\033[1m'

log()  { printf "%s\n" "$*" >&2; }
info() { printf "%s%s%s\n" "$c_dim" "$*" "$c_reset" >&2; }
ok()   { printf "%s✓%s %s\n" "$c_green" "$c_reset" "$*" >&2; }
warn() { printf "%s⚠%s %s\n" "$c_yellow" "$c_reset" "$*" >&2; }
fail() { printf "%s✗%s %s\n" "$c_red" "$c_reset" "$*" >&2; }
step() { printf "\n%s%s%s\n" "$c_bold" "$*" "$c_reset" >&2; }

AUTO="${VM_INSTALL_AUTO:-1}"
LOG_FILE="${HOME}/.vault-memory/skills/vm-install.log"
mkdir -p "$(dirname "$LOG_FILE")"

# Append timestamped entries to the run log.
log_event() {
  printf "[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE"
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Pick the right SHA-256 tool: macOS ships `shasum`, Linux usually `sha256sum`.
sha256_of() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    fail "Neither 'shasum' nor 'sha256sum' is available. Install one and retry."
    return 1
  fi
}

# ─── 1. Discover Obsidian vault ──────────────────────────────────────────────

discover_vault() {
  step "1/7  Discover Obsidian vault"

  if [ -n "${VAULT_PATH:-}" ]; then
    if [ -d "$VAULT_PATH/.obsidian" ]; then
      ok "Using VAULT_PATH=$VAULT_PATH"
      printf "%s" "$VAULT_PATH"
      return 0
    else
      fail "VAULT_PATH set but $VAULT_PATH/.obsidian does not exist."
      return 1
    fi
  fi

  # Probe common Obsidian vault locations.
  local candidates=()
  local pattern

  for pattern in \
    "$HOME/Documents"/*/.obsidian \
    "$HOME/Notes/.obsidian" \
    "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents"/*/.obsidian \
    "$HOME/Obsidian"/*/.obsidian \
  ; do
    if [ -d "$pattern" ]; then
      candidates+=("$(dirname "$pattern")")
    fi
  done

  case "${#candidates[@]}" in
    0)
      fail "No Obsidian vault found in default locations."
      info "Set VAULT_PATH=/path/to/your/vault and retry."
      return 1
      ;;
    1)
      ok "Vault: ${candidates[0]}"
      printf "%s" "${candidates[0]}"
      return 0
      ;;
    *)
      if [ "$AUTO" = "1" ]; then
        warn "Multiple vaults detected — autonomous mode cannot pick one."
        info "Candidates:"
        local v
        for v in "${candidates[@]}"; do info "  - $v"; done
        info "Re-run with VAULT_PATH=<one of the above>"
        return 1
      fi
      info "Multiple vaults detected. Pick one:"
      local i=1
      local v
      for v in "${candidates[@]}"; do
        printf "  [%d] %s\n" "$i" "$v" >&2
        i=$((i+1))
      done
      printf "Choice [1-%d]: " "${#candidates[@]}" >&2
      local reply
      read -r reply </dev/tty
      if ! [[ "$reply" =~ ^[0-9]+$ ]] || [ "$reply" -lt 1 ] || [ "$reply" -gt "${#candidates[@]}" ]; then
        fail "Invalid choice."
        return 1
      fi
      printf "%s" "${candidates[$((reply-1))]}"
      return 0
      ;;
  esac
}

# ─── 2. Download tarball ─────────────────────────────────────────────────────

download_artifact() {
  local url="$1"
  local target="$2"
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl not found. Install curl and retry."
    return 1
  fi
  curl --fail --silent --show-error --location --output "$target" "$url"
}

# ─── 3. Verify SHA-256 ───────────────────────────────────────────────────────

verify_checksum() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(sha256_of "$file")" || return 1
  if [ "$actual" = "$expected" ]; then
    ok "SHA-256 OK: $actual"
    return 0
  fi
  fail "SHA-256 mismatch"
  info "  expected: $expected"
  info "  actual:   $actual"
  return 3
}

# ─── 4. Atomic install ───────────────────────────────────────────────────────

install_atomic() {
  local tarball="$1"
  local vault="$2"
  local plugins_dir="$vault/.obsidian/plugins"
  local target="$plugins_dir/vault-memory"
  local staging="$plugins_dir/vault-memory.NEW"
  local backup="$plugins_dir/vault-memory.OLD"

  mkdir -p "$plugins_dir"

  # Clean any leftover staging from a prior interrupted run.
  rm -rf "$staging" "$backup"

  mkdir -p "$staging"
  if ! tar -xzf "$tarball" -C "$staging"; then
    fail "Tarball extraction failed."
    rm -rf "$staging"
    return 1
  fi

  # Validate the extracted layout — `manifest.json` must be present.
  if [ ! -f "$staging/manifest.json" ]; then
    fail "Tarball does not contain manifest.json at the archive root."
    rm -rf "$staging"
    return 1
  fi

  # Move the old version aside, swap in the new one, clean up the old.
  if [ -d "$target" ]; then
    mv "$target" "$backup"
  fi
  if ! mv "$staging" "$target"; then
    fail "Failed to swap new plugin into place."
    # Roll back if we moved aside an existing install.
    if [ -d "$backup" ]; then
      mv "$backup" "$target"
    fi
    return 1
  fi
  rm -rf "$backup"
  ok "Installed: $target"
}

# Compare installed version to release version. Returns 0 if same (no-op).
already_installed_same_version() {
  local vault="$1"
  local release_version="$2"
  local installed_manifest="$vault/.obsidian/plugins/vault-memory/manifest.json"
  if [ ! -f "$installed_manifest" ]; then
    return 1
  fi
  local installed_version
  installed_version="$(grep -E '"version"\s*:' "$installed_manifest" \
    | head -n 1 \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  if [ -z "$installed_version" ]; then
    return 1
  fi
  if [ "$installed_version" = "$release_version" ]; then
    ok "Already installed at v$installed_version — skipping download + extract."
    return 0
  fi
  info "Installed: v$installed_version → upgrading to v$release_version"
  return 1
}

# Pull the version string out of the URL (vault-memory-plugin-v2.0.0.tar.gz → 2.0.0).
parse_release_version() {
  local url="$1"
  echo "$url" \
    | sed -E 's#.*/vault-memory-plugin-v?([0-9][^/]*)\.tar\.gz.*#\1#' \
    | sed -E 's/\.tar\.gz$//'
}

# ─── 5. Enable plugin flag in config.toml ────────────────────────────────────

enable_plugin_flag() {
  local config_dir="${HOME}/.vault-memory"
  local config_file="$config_dir/config.toml"
  mkdir -p "$config_dir"

  if [ ! -f "$config_file" ]; then
    cat > "$config_file" <<'TOML'
# Created by vm-install skill — vault-memory plugin install.
# Add your [[vaults]] entries below using `vault-memory add-vault`.

[plugin]
enabled = true
TOML
    ok "Created $config_file with [plugin] enabled = true"
    return 0
  fi

  # File exists — patch idempotently.
  if grep -qE '^\[plugin\]' "$config_file"; then
    # The [plugin] block exists. Check the enabled flag.
    if awk '
      /^\[plugin\]/ { in_block=1; next }
      /^\[/ { in_block=0 }
      in_block && /^[[:space:]]*enabled[[:space:]]*=[[:space:]]*true/ { found=1 }
      END { exit (found ? 0 : 1) }
    ' "$config_file"; then
      ok "[plugin] enabled = true already set in $config_file"
      return 0
    fi
    # Replace the line inside the [plugin] block (or append if absent).
    local tmp
    tmp="$(mktemp)"
    awk '
      /^\[plugin\]/ { print; in_block=1; printed=0; next }
      /^\[/ && in_block {
        if (!printed) { print "enabled = true"; printed=1 }
        in_block=0
        print
        next
      }
      in_block && /^[[:space:]]*enabled[[:space:]]*=/ {
        print "enabled = true"
        printed=1
        next
      }
      { print }
      END {
        if (in_block && !printed) print "enabled = true"
      }
    ' "$config_file" > "$tmp"
    mv "$tmp" "$config_file"
    ok "Updated [plugin] enabled = true in $config_file"
    return 0
  fi

  # No [plugin] block — append.
  printf "\n[plugin]\nenabled = true\n" >> "$config_file"
  ok "Appended [plugin] enabled = true to $config_file"
}

# ─── 6. Prompt user ──────────────────────────────────────────────────────────

prompt_user() {
  local vault="$1"
  cat >&2 <<EOF

${c_bold}Next step — manual action required${c_reset}

The plugin files are now in:
  $vault/.obsidian/plugins/vault-memory/

To activate the plugin in Obsidian:

  1. Open (or restart) Obsidian.
  2. Open Settings → Community Plugins → Installed plugins.
  3. Toggle ${c_bold}vault-memory${c_reset} on.

If you have not already enabled community plugins in this vault, Obsidian
will prompt you to do so first.

EOF
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  log_event "vm-install started"

  local vault
  vault="$(discover_vault)" || { log_event "vault discovery failed"; exit 1; }

  local release_version
  release_version="$(parse_release_version "$RELEASE_URL")"
  info "Target release version: $release_version"

  # Idempotency short-circuit — same version already installed.
  if already_installed_same_version "$vault" "$release_version"; then
    enable_plugin_flag
    log_event "no-op: already at v$release_version"
    ok "Done (no-op)."
    exit 0
  fi

  step "2/7  Download plugin tarball"
  local tmpdir
  tmpdir="$(mktemp -d)"
  # Defensive trap: tmpdir is local to main(), so guard against unbound at EXIT.
  # shellcheck disable=SC2064
  trap "rm -rf '$tmpdir'" EXIT
  local tarball="$tmpdir/plugin.tar.gz"
  local sha_file="$tmpdir/manifest.sha256"

  info "URL: $RELEASE_URL"
  if ! download_artifact "$RELEASE_URL" "$tarball"; then
    fail "Tarball download failed."
    info "If the v2.0.0 release has not been published yet, set VM_INSTALL_RELEASE_URL to a local fixture (file://...) for testing."
    log_event "download failed: $RELEASE_URL"
    exit 1
  fi
  ok "Downloaded $(du -h "$tarball" | awk '{print $1}')"

  info "SHA URL: $SHA256_URL"
  if ! download_artifact "$SHA256_URL" "$sha_file"; then
    fail "Checksum file download failed."
    log_event "sha download failed: $SHA256_URL"
    exit 1
  fi
  local expected_sha
  expected_sha="$(awk '{print $1}' "$sha_file")"

  step "3/7  Verify SHA-256"
  if ! verify_checksum "$tarball" "$expected_sha"; then
    log_event "sha verification failed: expected=$expected_sha"
    exit 3
  fi

  step "4/7  Extract atomically"
  install_atomic "$tarball" "$vault" || { log_event "install_atomic failed"; exit 1; }

  step "5/7  Set [plugin] enabled = true in ~/.vault-memory/config.toml"
  enable_plugin_flag

  step "6/7  Prompt user to enable plugin"
  prompt_user "$vault"

  step "7/7  Done"
  ok "vault-memory plugin v$release_version installed."
  log_event "installed v$release_version at $vault"
}

main "$@"
