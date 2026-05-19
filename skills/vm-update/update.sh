#!/usr/bin/env bash
# vault-memory plugin updater — invoked by /vm-update skill.
#
# Reads the installed plugin's manifest.json.version, queries GitHub Releases
# for the latest tag, and — if newer — downloads + verifies SHA-256 + replaces
# the plugin directory atomically. No-op when already on the latest version.
#
# Exit codes:
#   0  success (upgrade applied OR already up to date)
#   1  recoverable failure with instructions printed
#   2  plugin not installed (run vm-install first)
#   3  SHA-256 verification failed (potential tampering)

set -euo pipefail

# ─── Release configuration ────────────────────────────────────────────────────
#
# TODO: replace placeholder before publishing
# The vault-memory v2.0.0 release has NOT been published yet. Until Phase 8
# release prep ships the tarball + checksum, the GitHub Releases API endpoint
# below returns 404 / empty. For testing, override via VM_UPDATE_LATEST_VERSION
# + VM_UPDATE_RELEASE_URL + VM_UPDATE_SHA256_URL.
RELEASE_URL_PLACEHOLDER="https://github.com/owrede/vault-memory/releases/download/v__VERSION__/vault-memory-plugin-v__VERSION__.tar.gz"
SHA256_URL_PLACEHOLDER="https://github.com/owrede/vault-memory/releases/download/v__VERSION__/manifest.sha256"
LATEST_API_URL="https://api.github.com/repos/owrede/vault-memory/releases/latest"

# ─── Colors / logging ────────────────────────────────────────────────────────

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

AUTO="${VM_UPDATE_AUTO:-1}"
LOG_FILE="${HOME}/.vault-memory/skills/vm-update.log"
mkdir -p "$(dirname "$LOG_FILE")"

log_event() {
  printf "[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE"
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

sha256_of() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    fail "Neither 'shasum' nor 'sha256sum' is available."
    return 1
  fi
}

download_artifact() {
  local url="$1"
  local target="$2"
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl not found."
    return 1
  fi
  curl --fail --silent --show-error --location --output "$target" "$url"
}

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

# Pure-bash semver comparator.
# Returns: 0 if a == b, 1 if a > b, 2 if a < b.
# Handles standard X.Y.Z; strips any leading 'v'.
compare_semver() {
  local a="${1#v}"
  local b="${2#v}"
  if [ "$a" = "$b" ]; then return 0; fi
  local IFS=.
  # shellcheck disable=SC2206
  local -a aa=($a)
  # shellcheck disable=SC2206
  local -a bb=($b)
  local i
  for i in 0 1 2; do
    local an="${aa[$i]:-0}"
    local bn="${bb[$i]:-0}"
    # Strip any pre-release suffix from the segment.
    an="${an%%-*}"
    bn="${bn%%-*}"
    # Default missing segments to 0.
    [ -z "$an" ] && an=0
    [ -z "$bn" ] && bn=0
    if [ "$an" -gt "$bn" ] 2>/dev/null; then return 1; fi
    if [ "$an" -lt "$bn" ] 2>/dev/null; then return 2; fi
  done
  return 0
}

# Resolve the URL template by substituting the version placeholder.
resolve_url() {
  local template="$1"
  local version="$2"
  echo "${template//__VERSION__/$version}"
}

# Read installed plugin version. Echoes the version string or empty.
read_installed_version() {
  local vault="$1"
  local manifest="$vault/.obsidian/plugins/vault-memory/manifest.json"
  if [ ! -f "$manifest" ]; then
    return 1
  fi
  grep -E '"version"\s*:' "$manifest" \
    | head -n 1 \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

# Fetch the latest release tag. Honors VM_UPDATE_LATEST_VERSION override.
fetch_latest_version() {
  if [ -n "${VM_UPDATE_LATEST_VERSION:-}" ]; then
    echo "${VM_UPDATE_LATEST_VERSION#v}"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl not found — cannot reach GitHub Releases API."
    return 1
  fi
  local payload
  if ! payload="$(curl --fail --silent --show-error --location "$LATEST_API_URL" 2>&1)"; then
    fail "Could not reach $LATEST_API_URL"
    info "Set VM_UPDATE_LATEST_VERSION=<version> to skip the lookup."
    return 1
  fi
  # Extract "tag_name" without depending on jq.
  local tag
  tag="$(echo "$payload" \
    | grep -E '"tag_name"\s*:' \
    | head -n 1 \
    | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  if [ -z "$tag" ]; then
    fail "Could not parse tag_name from GitHub Releases response."
    return 1
  fi
  echo "${tag#v}"
}

# ─── Discover vault (same logic as vm-install) ───────────────────────────────

discover_vault() {
  step "1/7  Discover Obsidian vault"
  if [ -n "${VAULT_PATH:-}" ]; then
    if [ -d "$VAULT_PATH/.obsidian" ]; then
      ok "Using VAULT_PATH=$VAULT_PATH"
      printf "%s" "$VAULT_PATH"
      return 0
    fi
    fail "VAULT_PATH set but $VAULT_PATH/.obsidian does not exist."
    return 1
  fi
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

# ─── Atomic replace ──────────────────────────────────────────────────────────

install_atomic() {
  local tarball="$1"
  local vault="$2"
  local plugins_dir="$vault/.obsidian/plugins"
  local target="$plugins_dir/vault-memory"
  local staging="$plugins_dir/vault-memory.NEW"
  local backup="$plugins_dir/vault-memory.OLD"

  mkdir -p "$plugins_dir"
  rm -rf "$staging" "$backup"
  mkdir -p "$staging"

  if ! tar -xzf "$tarball" -C "$staging"; then
    fail "Tarball extraction failed — prior install retained."
    rm -rf "$staging"
    return 1
  fi
  if [ ! -f "$staging/manifest.json" ]; then
    fail "Tarball does not contain manifest.json at the archive root — prior install retained."
    rm -rf "$staging"
    return 1
  fi
  if [ -d "$target" ]; then
    mv "$target" "$backup"
  fi
  if ! mv "$staging" "$target"; then
    fail "Failed to swap new plugin into place — rolling back."
    if [ -d "$backup" ]; then
      mv "$backup" "$target"
    fi
    return 1
  fi
  rm -rf "$backup"
  ok "Upgraded: $target"
}

# ─── Prompt user to reload ───────────────────────────────────────────────────

prompt_reload() {
  cat >&2 <<EOF

${c_bold}Reload required${c_reset}

The plugin files have been swapped in. To pick up the new version:

  • Reload Obsidian (Cmd+R on macOS, Ctrl+R elsewhere), OR
  • Open Settings → Community Plugins → toggle ${c_bold}vault-memory${c_reset} off and back on.

EOF
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  log_event "vm-update started"

  local vault
  vault="$(discover_vault)" || { log_event "vault discovery failed"; exit 1; }

  step "2/7  Read installed plugin version"
  local installed
  if ! installed="$(read_installed_version "$vault")" || [ -z "$installed" ]; then
    fail "Plugin not installed at $vault/.obsidian/plugins/vault-memory/"
    info "Run /vm-install first."
    log_event "plugin not installed at $vault"
    exit 2
  fi
  ok "Installed: v$installed"

  step "3/7  Fetch latest release version"
  local latest
  if ! latest="$(fetch_latest_version)" || [ -z "$latest" ]; then
    fail "Could not determine latest release version."
    log_event "latest version lookup failed"
    exit 1
  fi
  ok "Latest:    v$latest"

  step "4/7  Compare versions"
  local cmp=0
  compare_semver "$installed" "$latest" || cmp=$?
  case "$cmp" in
    0)
      ok "Already up to date: v$installed"
      log_event "no-op: installed=$installed latest=$latest"
      exit 0
      ;;
    1)
      warn "Installed version v$installed is newer than latest published v$latest — refusing to downgrade."
      log_event "downgrade refused: installed=$installed latest=$latest"
      exit 0
      ;;
    2)
      info "Upgrade available: v$installed → v$latest"
      ;;
  esac

  step "5/7  Download + verify SHA-256"
  local tmpdir
  tmpdir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmpdir'" EXIT
  local tarball="$tmpdir/plugin.tar.gz"
  local sha_file="$tmpdir/manifest.sha256"

  local release_url
  release_url="${VM_UPDATE_RELEASE_URL:-$(resolve_url "$RELEASE_URL_PLACEHOLDER" "$latest")}"
  local sha_url
  sha_url="${VM_UPDATE_SHA256_URL:-$(resolve_url "$SHA256_URL_PLACEHOLDER" "$latest")}"

  info "URL: $release_url"
  if ! download_artifact "$release_url" "$tarball"; then
    fail "Tarball download failed."
    info "If the release has not been published yet, set VM_UPDATE_RELEASE_URL to a local fixture."
    log_event "download failed: $release_url"
    exit 1
  fi
  ok "Downloaded $(du -h "$tarball" | awk '{print $1}')"

  info "SHA URL: $sha_url"
  if ! download_artifact "$sha_url" "$sha_file"; then
    fail "Checksum file download failed."
    log_event "sha download failed: $sha_url"
    exit 1
  fi
  local expected_sha
  expected_sha="$(awk '{print $1}' "$sha_file")"

  if ! verify_checksum "$tarball" "$expected_sha"; then
    log_event "sha verification failed: expected=$expected_sha"
    exit 3
  fi

  step "6/7  Atomic replace"
  install_atomic "$tarball" "$vault" || { log_event "atomic replace failed"; exit 1; }

  step "7/7  Prompt user to reload"
  prompt_reload
  ok "vault-memory plugin upgraded: v$installed → v$latest"
  log_event "upgraded $installed -> $latest at $vault"
}

main "$@"
