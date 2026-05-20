#!/usr/bin/env bash
# vault-memory setup script — invoked by /install-vault-memory skill.
#
# Walks through 9 idempotent checkpoints (0–8). Each checkpoint either silently
# passes when already met, or asks for permission once before applying a fix.
# Never overwrites user data without confirmation. Never installs anything
# without consent.
#
# Modes:
#   - default            full install / upgrade flow
#   - VAULT_MEMORY_DIAGNOSE=1  read-only health-check across all dimensions,
#                              prints a single PASS/WARN/FAIL report and exits.
#
# Headless-agent contract (run from Claude / CI / any non-TTY shell):
#   - Set VAULT_MEMORY_AUTO=1 to short-circuit every non-destructive prompt.
#   - Set VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1 to short-circuit the destructive
#     upgrade prompt (v1 → v2). The agent has already asked the human via
#     AskUserQuestion and is passing the answer along — without this env var
#     the script declines the destructive op when there is no TTY.
#   - Set VAULT_MEMORY_VERSION=2.0.0-rc.2 (or 1.0.0) to skip the version prompt.
#   - The script honors these env vars regardless of TTY presence.
#
# Exit codes:
#   0  success (or already-set-up; diagnose all green)
#   1  recoverable failure with instructions printed
#   2  user declined a required step
#   3  diagnose detected at least one FAIL dimension

set -u
set -o pipefail

# ─── Helpers ────────────────────────────────────────────────────────────────

c_reset=$'\033[0m'
c_dim=$'\033[2m'
c_green=$'\033[32m'
c_yellow=$'\033[33m'
c_red=$'\033[31m'
c_bold=$'\033[1m'

log()     { printf "%s\n" "$*" >&2; }
info()    { printf "${c_dim}%s${c_reset}\n" "$*" >&2; }
ok()      { printf "${c_green}✓${c_reset} %s\n" "$*" >&2; }
warn()    { printf "${c_yellow}⚠${c_reset} %s\n" "$*" >&2; }
err()     { printf "${c_red}✗${c_reset} %s\n" "$*" >&2; }
step()    { printf "\n${c_bold}%s${c_reset}\n" "$*" >&2; }

# AUTO=1 → auto-yes for non-destructive prompts (default for headless agents).
AUTO="${VAULT_MEMORY_AUTO:-0}"

# Did the agent already collect destructive confirmation from the human?
DESTRUCTIVE_CONFIRMED="${VAULT_MEMORY_DESTRUCTIVE_CONFIRMED:-0}"

# Smoketest timeout (seconds). Configurable for cold-start Ollama.
SMOKETEST_TIMEOUT="${VAULT_MEMORY_SMOKETEST_TIMEOUT:-10}"

# Has a TTY for interactive prompts? Computed once so every branch
# answers consistently.
have_tty() {
  [ -t 0 ] || [ -e /dev/tty ]
}

# Ask user yes/no. Default no — unless VAULT_MEMORY_AUTO=1, then default yes
# for non-destructive steps. The `why:` line is always printed BELOW the
# prompt for visual consistency (resolves item 8 from the issue list).
confirm() {
  local prompt="$1"
  local reason="${2:-}"
  local reply=""
  if [ "$AUTO" = "1" ]; then
    info "auto: yes → $prompt"
    if [ -n "$reason" ]; then
      info "  why: $reason"
    fi
    return 0
  fi
  if ! have_tty; then
    warn "Non-interactive shell — cannot prompt. Skipping: $prompt"
    if [ -n "$reason" ]; then
      info "  why: $reason"
    fi
    return 1
  fi
  printf "${c_yellow}? %s [y/N]${c_reset} " "$prompt" >&2
  if [ -n "$reason" ]; then
    printf "\n${c_dim}  why: %s${c_reset}\n${c_yellow}> ${c_reset}" "$reason" >&2
  fi
  read -r reply </dev/tty || reply=""
  case "$reply" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Destructive confirm — auto-yeses ONLY when VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1
# (the agent has already asked the human and is passing the answer along).
# Otherwise requires a TTY and an explicit y/yes.
confirm_destructive() {
  local prompt="$1"
  local reply=""
  if [ "$DESTRUCTIVE_CONFIRMED" = "1" ]; then
    info "destructive: confirmed via VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1 → $prompt"
    return 0
  fi
  if ! have_tty; then
    err "Non-interactive shell — cannot prompt for destructive op: $prompt"
    log ""
    log "This is a destructive operation. Re-run with VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1"
    log "after the human has explicitly approved it (e.g. via AskUserQuestion). Example:"
    log ""
    log "  VAULT_MEMORY_AUTO=1 VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1 \\"
    log "    VAULT_MEMORY_VERSION=2.0.0-rc.2 bash setup.sh"
    log ""
    return 1
  fi
  printf "${c_red}! DESTRUCTIVE: %s [y/N]${c_reset} " "$prompt" >&2
  read -r reply </dev/tty || reply=""
  case "$reply" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Canonicalize a path (resolves symlinks). Works on both Linux (readlink -f)
# and macOS (no -f flag on the BSD readlink — use python or perl as fallback).
canonical_path() {
  local p="$1"
  if [ -z "$p" ]; then return 0; fi
  if readlink -f "$p" 2>/dev/null; then return 0; fi
  if command -v realpath >/dev/null 2>&1 && realpath "$p" 2>/dev/null; then return 0; fi
  # perl fallback (always present on macOS)
  perl -MCwd=abs_path -le 'print abs_path(shift)' "$p" 2>/dev/null && return 0
  # last resort — just print as-is
  printf '%s' "$p"
}

VAULT_ROOT_RAW="${CLAUDE_PROJECT_DIR:-$(pwd)}"
VAULT_ROOT="$(canonical_path "$VAULT_ROOT_RAW")"
INSTALL_DIR="${VAULT_MEMORY_INSTALL_DIR:-$HOME/Documents/GitHub/vault-memory}"
REPO_URL="${VAULT_MEMORY_REPO_URL:-https://github.com/owrede/vault-memory}"
CONFIG_FILE="$HOME/.vault-memory/config.toml"
WIZARD="$VAULT_ROOT/.claude/skills/install-vault-memory/config-wizard.sh"

# ─── Diagnostic mode ────────────────────────────────────────────────────────
#
# Read-only health-check across every dimension the install touches. Produces
# a PASS/WARN/FAIL report per dimension and exits 0 / 3.
#
# Triggered by: VAULT_MEMORY_DIAGNOSE=1, or first positional arg "--diagnose".

if [ "${VAULT_MEMORY_DIAGNOSE:-0}" = "1" ] || [ "${1:-}" = "--diagnose" ]; then
  log ""
  log "${c_bold}vault-memory diagnostic${c_reset}"
  log "Vault:    $VAULT_ROOT"
  log "Config:   $CONFIG_FILE"
  log ""

  any_fail=0
  any_warn=0

  diag_pass() { printf "${c_green}PASS${c_reset}  %s\n" "$*" >&2; }
  diag_warn() { printf "${c_yellow}WARN${c_reset}  %s\n" "$*" >&2; any_warn=1; }
  diag_fail() { printf "${c_red}FAIL${c_reset}  %s\n" "$*" >&2; any_fail=1; }

  # Binary — `vault-memory --version` may not be implemented in older builds.
  # Fall back to npm's view of the global package.
  if command -v vault-memory >/dev/null 2>&1; then
    vm_v=$(vault-memory --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' | head -1 || true)
    if [ -z "$vm_v" ]; then
      vm_v=$(npm ls -g @owrede/vault-memory --depth=0 --parseable=false 2>/dev/null \
        | grep -oE '@owrede/vault-memory@[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' \
        | head -1 | sed 's/^@owrede\/vault-memory@//' || true)
    fi
    diag_pass "vault-memory binary in PATH (version ${vm_v:-unknown})"
  else
    diag_fail "vault-memory binary not in PATH"
  fi

  # Ollama
  ollama_endpoint="${VAULT_MEMORY_OLLAMA_ENDPOINT:-http://localhost:11434}"
  if [ -f "$CONFIG_FILE" ]; then
    cfg_endpoint=$(grep -E '^ollama_endpoint = ' "$CONFIG_FILE" 2>/dev/null | head -1 | sed 's/^ollama_endpoint = //; s/"//g' || true)
    if [ -n "$cfg_endpoint" ]; then ollama_endpoint="$cfg_endpoint"; fi
  fi
  if curl -s --max-time 2 "$ollama_endpoint/api/tags" >/dev/null 2>&1; then
    diag_pass "Ollama responding at $ollama_endpoint"
  else
    diag_fail "Ollama not reachable at $ollama_endpoint"
  fi

  # Config validity
  if [ -f "$CONFIG_FILE" ]; then
    diag_pass "Config exists: $CONFIG_FILE"
    # Count registered vaults
    n_vaults=$(grep -cE '^\[\[vaults\]\]' "$CONFIG_FILE" 2>/dev/null || echo 0)
    diag_pass "  $n_vaults vault(s) registered"
  else
    diag_warn "Config missing: $CONFIG_FILE"
  fi

  # Per-vault DB probes. v0.x stored DBs at ~/.vault-memory/*.db; v1+ moved
  # them to ~/.vault-memory/vaults/*.db. Scan both locations.
  if [ -d "$HOME/.vault-memory" ]; then
    for db in "$HOME/.vault-memory"/*.db "$HOME/.vault-memory/vaults"/*.db; do
      [ -e "$db" ] || continue
      [ -s "$db" ] || { diag_warn "DB $(basename "$db") — empty (0 bytes); legacy path?"; continue; }
      db_basename=$(basename "$db")
      if command -v sqlite3 >/dev/null 2>&1; then
        # Basic open + integrity_check
        if sqlite3 "$db" "PRAGMA integrity_check;" 2>/dev/null | head -1 | grep -q '^ok$'; then
          n_notes=$(sqlite3 "$db" "SELECT COUNT(*) FROM notes;" 2>/dev/null | head -1 || true)
          n_notes="${n_notes:-?}"
          diag_pass "DB $db_basename — integrity ok, $n_notes notes"
        else
          diag_fail "DB $db_basename — integrity_check failed"
        fi
      else
        # No sqlite3 binary — just check the file exists and is > 0
        if [ -s "$db" ]; then
          diag_pass "DB $db_basename — present ($(du -h "$db" | cut -f1))"
        else
          diag_warn "DB $db_basename — empty"
        fi
      fi
      # WAL leftover check
      if [ -s "$db-wal" ]; then
        wal_size=$(du -h "$db-wal" | cut -f1)
        diag_warn "  $db_basename has uncommitted WAL ($wal_size) — run 'vault-memory index' to flush"
      fi
    done
  else
    diag_warn "~/.vault-memory/ directory missing"
  fi

  # MCP smoketest
  if command -v vault-memory >/dev/null 2>&1; then
    smoke=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"diag","version":"1"}}}' \
      | perl -e "alarm $SMOKETEST_TIMEOUT; exec @ARGV" vault-memory serve 2>/dev/null | head -20 || true)
    if printf '%s' "$smoke" | grep -q '"serverInfo"'; then
      diag_pass "MCP server responds to initialize"
    else
      diag_fail "MCP server smoketest failed (no serverInfo in response)"
    fi
  fi

  log ""
  if [ "$any_fail" = "1" ]; then
    log "${c_red}${c_bold}Diagnostic: FAIL${c_reset} — at least one dimension is broken."
    exit 3
  elif [ "$any_warn" = "1" ]; then
    log "${c_yellow}${c_bold}Diagnostic: WARN${c_reset} — installation works but has caveats."
    exit 0
  else
    log "${c_green}${c_bold}Diagnostic: PASS${c_reset} — vault-memory is healthy."
    exit 0
  fi
fi

# ─── Re-entrancy guard ──────────────────────────────────────────────────────
#
# Two parallel invocations of the script can corrupt config.toml because
# vault-memory add-vault is not process-safe. Acquire a mkdir-based lock
# (works on macOS without flock).

LOCK_DIR="$HOME/.vault-memory/.setup.lock"
mkdir -p "$HOME/.vault-memory" 2>/dev/null || true
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Check if the lock holder is alive (PID file inside the lock dir).
  if [ -f "$LOCK_DIR/pid" ] && kill -0 "$(cat "$LOCK_DIR/pid" 2>/dev/null)" 2>/dev/null; then
    err "Another vault-memory setup is running (PID $(cat "$LOCK_DIR/pid"))."
    log "If you're sure no other run is in progress: rm -rf $LOCK_DIR"
    exit 1
  else
    # Stale lock — clean up and re-acquire.
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" || { err "Failed to acquire lock at $LOCK_DIR"; exit 1; }
  fi
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

# ─── Platform check ──────────────────────────────────────────────────────────

PLATFORM="$(uname -s)"
case "$PLATFORM" in
  Darwin)
    PKG_INSTALLER="brew"
    ;;
  Linux)
    if [ "${VAULT_MEMORY_ALLOW_UNSUPPORTED_PLATFORM:-0}" != "1" ]; then
      err "Linux is experimental. Set VAULT_MEMORY_ALLOW_UNSUPPORTED_PLATFORM=1 to proceed."
      log "Known to work on Ubuntu/Debian/Fedora with apt/dnf. WSL2 supported."
      exit 1
    fi
    if   command -v apt-get >/dev/null 2>&1; then PKG_INSTALLER="apt"
    elif command -v dnf     >/dev/null 2>&1; then PKG_INSTALLER="dnf"
    elif command -v pacman  >/dev/null 2>&1; then PKG_INSTALLER="pacman"
    else
      err "No supported package manager (apt/dnf/pacman) detected on this Linux."
      exit 1
    fi
    info "Linux mode (experimental): using $PKG_INSTALLER for system packages."
    ;;
  *)
    err "Unsupported platform: $PLATFORM. Set VAULT_MEMORY_ALLOW_UNSUPPORTED_PLATFORM=1 to override at your own risk."
    exit 1
    ;;
esac

# ─── Disk + RAM pre-check ────────────────────────────────────────────────────
#
# A full v2 install with one indexed vault occupies ~3 GB (1.1 GB bge-m3 +
# DB + npm node_modules). Five-vault multi-tenant installs can hit 10+ GB.

check_disk_space() {
  local target_dir="$HOME"
  # Get free MB on the target's filesystem.
  local free_mb
  if [ "$PLATFORM" = "Darwin" ]; then
    free_mb=$(df -m "$target_dir" 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
  else
    free_mb=$(df -BM --output=avail "$target_dir" 2>/dev/null | awk 'NR==2 {gsub("M",""); print}' || echo "0")
  fi
  if [ -z "$free_mb" ] || [ "$free_mb" -lt 5000 ] 2>/dev/null; then
    warn "Low disk space: ${free_mb} MB free on $target_dir's filesystem."
    warn "  Recommend ≥ 5 GB free. Aborting before pulling models or indexing."
    if ! confirm "Proceed anyway?" \
      "You may run out of disk during model pull or vault indexing. Cleanup happens at the end of the script and may not free enough space mid-flight."; then
      exit 1
    fi
  else
    info "Disk free: ${free_mb} MB on $target_dir's filesystem."
  fi
}

check_ram() {
  local total_gb=0
  if [ "$PLATFORM" = "Darwin" ]; then
    local bytes
    bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
    total_gb=$(( bytes / 1024 / 1024 / 1024 ))
  else
    local kb
    kb=$(grep -E '^MemTotal:' /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    total_gb=$(( kb / 1024 / 1024 ))
  fi
  if [ "$total_gb" -gt 0 ] && [ "$total_gb" -le 16 ]; then
    warn "System RAM: ${total_gb} GB. bge-m3 inference + Obsidian + Chrome can pressure this."
    warn "  Consider VAULT_MEMORY_EMBED_MODEL=qwen3-embedding:0.6b for lower footprint."
  else
    info "System RAM: ${total_gb} GB."
  fi
}

# ─── Banner ──────────────────────────────────────────────────────────────────

log ""
log "${c_bold}vault-memory setup${c_reset}"
log "Vault:    $VAULT_ROOT"
log "Install:  $INSTALL_DIR"
if [ "$AUTO" = "1" ]; then
  log "Mode:     ${c_green}autonomous${c_reset} (VAULT_MEMORY_AUTO=1)"
fi
if [ "$DESTRUCTIVE_CONFIRMED" = "1" ]; then
  log "Destrct:  ${c_yellow}pre-confirmed${c_reset} (VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1)"
fi
log ""

check_disk_space
check_ram

# ─── Embedding model detection (config-aware) ────────────────────────────────
#
# Item 21 from the issue list: if the user already has a config.toml with a
# dominant embedding model (e.g. qwen3-embedding:0.6b on a low-RAM machine),
# prefer that as the default for THIS vault rather than hardcoded bge-m3.
# Explicit VAULT_MEMORY_EMBED_MODEL still wins.

detect_dominant_embedding_model() {
  if [ ! -f "$CONFIG_FILE" ]; then
    printf 'bge-m3'
    return
  fi
  # Look for [server] default_embedding_model first.
  local default
  default=$(grep -E '^default_embedding_model = ' "$CONFIG_FILE" 2>/dev/null \
    | head -1 | sed 's/^default_embedding_model = //; s/"//g' || true)
  if [ -n "$default" ]; then
    printf '%s' "$default"
    return
  fi
  # Fall back to the most common embedding_model across [[vaults]] blocks.
  local most_common
  most_common=$(grep -E '^embedding_model = |^secondary_embedding_model = ' "$CONFIG_FILE" 2>/dev/null \
    | sed 's/.*= //; s/"//g' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}' || true)
  if [ -n "$most_common" ]; then
    printf '%s' "$most_common"
    return
  fi
  printf 'bge-m3'
}

if [ -n "${VAULT_MEMORY_EMBED_MODEL:-}" ]; then
  EMBEDDING_MODEL="$VAULT_MEMORY_EMBED_MODEL"
  info "Embedding model: $EMBEDDING_MODEL (pinned via VAULT_MEMORY_EMBED_MODEL)"
else
  EMBEDDING_MODEL="$(detect_dominant_embedding_model)"
  info "Embedding model: $EMBEDDING_MODEL (auto-detected from existing config or default)"
fi
log "Model:    $EMBEDDING_MODEL"
log ""

# ─── Checkpoint 0: Choose version ────────────────────────────────────────────

step "0/8  Choose version"

# Default to 2.0.0-rc.3 (the latest prerelease published to npm under @next).
# This constant is bumped whenever a new RC is cut.
DEFAULT_V2_VERSION="2.0.0-rc.3"

SELECTED_VERSION=""
INSTALL_MODE="npm"

resolve_version() {
  case "$1" in
    1.0.0|2.0.0-rc.1|2.0.0-rc.2|2.0.0-rc.3|2.0.0)
      SELECTED_VERSION="$1"
      ;;
    *)
      err "Unknown VAULT_MEMORY_VERSION: $1 (expected '$DEFAULT_V2_VERSION' or '1.0.0')"
      exit 1
      ;;
  esac
}

if [ -n "${VAULT_MEMORY_VERSION:-}" ]; then
  info "Version pinned via VAULT_MEMORY_VERSION=$VAULT_MEMORY_VERSION"
  resolve_version "$VAULT_MEMORY_VERSION"
elif ! have_tty; then
  warn "Non-interactive shell — defaulting to v$DEFAULT_V2_VERSION (current). Set VAULT_MEMORY_VERSION=1.0.0 to override."
  SELECTED_VERSION="$DEFAULT_V2_VERSION"
elif [ "$AUTO" = "1" ]; then
  # Even in AUTO, if a TTY is available we surface the choice once.
  # If no TTY, we already took the fallback branch above.
  info "AUTO mode + TTY available — surfacing the version prompt anyway (one-time product decision)."
  log ""
  log "vault-memory has two installable versions:"
  log "  1) v$DEFAULT_V2_VERSION  ${c_bold}(current, recommended)${c_reset}  dist-tag: next"
  log "  2) v1.0.0       (legacy stable)             dist-tag: latest"
  log "  q) quit"
  log ""
  log "  (Pass VAULT_MEMORY_VERSION=$DEFAULT_V2_VERSION or 1.0.0 to skip this prompt.)"
  log ""
  printf "${c_yellow}? Choice [1/2/q] (default 1):${c_reset} " >&2
  version_reply=""
  read -r version_reply </dev/tty || version_reply=""
  case "$version_reply" in
    ""|1) SELECTED_VERSION="$DEFAULT_V2_VERSION" ;;
    2)    SELECTED_VERSION="1.0.0" ;;
    q|Q|quit|QUIT) err "Install cancelled by user."; exit 2 ;;
    *) err "Invalid choice: $version_reply (expected 1, 2, or q)"; exit 1 ;;
  esac
else
  # Interactive mode (no AUTO).
  log ""
  log "vault-memory has two installable versions:"
  log ""
  log "  1) v$DEFAULT_V2_VERSION  ${c_bold}(current, recommended)${c_reset}  npm dist-tag: next"
  log "     - 32 canonical MCP tools + 10 MCP Resources"
  log "     - Typed-edge graph, compiled briefs, Obsidian plugin, task contracts"
  log "     - Backwards-compatible: all v1 tool names + shapes preserved"
  log ""
  log "  2) v1.0.0       (legacy stable)             dist-tag: latest"
  log "     - Original 23 MCP tools — semantic + BM25 + RRF hybrid search"
  log ""
  log "  q) quit (no install)"
  log ""
  log "  (Pass VAULT_MEMORY_VERSION=$DEFAULT_V2_VERSION or 1.0.0 to skip this prompt.)"
  log ""
  printf "${c_yellow}? Choice [1/2/q] (default 1):${c_reset} " >&2
  version_reply=""
  read -r version_reply </dev/tty || version_reply=""
  case "$version_reply" in
    ""|1) SELECTED_VERSION="$DEFAULT_V2_VERSION" ;;
    2)    SELECTED_VERSION="1.0.0" ;;
    q|Q|quit|QUIT) err "Install cancelled by user."; exit 2 ;;
    *) err "Invalid choice: $version_reply (expected 1, 2, or q)"; exit 1 ;;
  esac
fi

# Resolve INSTALL_MODE.
if [ "${VAULT_MEMORY_INSTALL_MODE:-}" = "source" ]; then
  if [ "$SELECTED_VERSION" = "1.0.0" ]; then
    err "VAULT_MEMORY_INSTALL_MODE=source is incompatible with VAULT_MEMORY_VERSION=1.0.0."
    log "v1.0.0 is only published on npm; the source-build path always builds the current main branch."
    exit 1
  fi
  INSTALL_MODE="source"
  info "Developer env: VAULT_MEMORY_INSTALL_MODE=source → building $SELECTED_VERSION from source"
elif [ -n "${VAULT_MEMORY_INSTALL_MODE:-}" ] && [ "$VAULT_MEMORY_INSTALL_MODE" != "npm" ]; then
  err "Unknown VAULT_MEMORY_INSTALL_MODE: $VAULT_MEMORY_INSTALL_MODE (expected 'npm' or 'source')"
  exit 1
fi

case "$INSTALL_MODE" in
  npm)
    info "Resolved: v$SELECTED_VERSION → npm registry (npm install -g @owrede/vault-memory@$SELECTED_VERSION)"
    ;;
  source)
    info "Resolved: v$SELECTED_VERSION → source build from $REPO_URL"
    if command -v vault-memory >/dev/null 2>&1; then
      ok "vault-memory already in PATH — skipping GitHub auth check"
    elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      ok "GitHub CLI authenticated"
    else
      err "Source-build mode needs git access to owrede/vault-memory."
      log "Either set up gh auth ('gh auth login') or unset VAULT_MEMORY_INSTALL_MODE for npm install."
      exit 1
    fi
    ;;
esac

# ─── Checkpoint 1: Homebrew / pkg manager ────────────────────────────────────

step "1/8  Package manager"

case "$PKG_INSTALLER" in
  brew)
    if command -v brew >/dev/null 2>&1; then
      ok "Homebrew installed ($(brew --version | head -1))"
    else
      err "Homebrew is required and not installed."
      log "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
      exit 1
    fi
    ;;
  apt|dnf|pacman)
    ok "Using $PKG_INSTALLER as package manager"
    ;;
esac

# ─── Checkpoint 2: Node 22+ ──────────────────────────────────────────────────

step "2/8  Node 22+"

node_ok=false
if command -v node >/dev/null 2>&1; then
  node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
  if [ "$node_major" -ge 22 ] 2>/dev/null; then
    ok "Node $(node --version)"
    node_ok=true
  else
    warn "Node $(node --version) found, but 22+ required."
  fi
else
  warn "Node not in PATH."
fi

install_node_22() {
  case "$PKG_INSTALLER" in
    brew)
      brew install node@22 || return 1
      brew link --overwrite node@22 2>/dev/null || true
      ;;
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - || return 1
      sudo apt-get install -y nodejs || return 1
      ;;
    dnf)
      sudo dnf install -y nodejs npm || return 1
      ;;
    pacman)
      sudo pacman -S --noconfirm nodejs npm || return 1
      ;;
  esac
}

if ! $node_ok; then
  if confirm "Install Node 22 via $PKG_INSTALLER?" \
    "vault-memory is a Node.js program (MCP server). Node 22+ is required because it uses native fetch and modern ES modules."; then
    install_node_22 || { err "Node 22 install failed"; exit 1; }
    if command -v node >/dev/null 2>&1; then
      ok "Node $(node --version) installed"
    else
      err "Node still not in PATH after install."
      exit 1
    fi
  else
    err "Node 22+ is required. Skipped."
    exit 2
  fi
fi

# ─── Checkpoint 3: Ollama running ────────────────────────────────────────────

step "3/8  Ollama"

# Honor explicit endpoint override and config-derived endpoint over the default.
OLLAMA_ENDPOINT="${VAULT_MEMORY_OLLAMA_ENDPOINT:-http://localhost:11434}"
if [ -z "${VAULT_MEMORY_OLLAMA_ENDPOINT:-}" ] && [ -f "$CONFIG_FILE" ]; then
  cfg_endpoint=$(grep -E '^ollama_endpoint = ' "$CONFIG_FILE" 2>/dev/null | head -1 | sed 's/^ollama_endpoint = //; s/"//g' || true)
  if [ -n "$cfg_endpoint" ]; then
    OLLAMA_ENDPOINT="$cfg_endpoint"
    info "Using ollama_endpoint from config: $OLLAMA_ENDPOINT"
  fi
fi

ollama_binary_ok=false
if command -v ollama >/dev/null 2>&1; then
  ollama_binary_ok=true
fi

install_ollama() {
  case "$PKG_INSTALLER" in
    brew) brew install ollama ;;
    apt|dnf|pacman) curl -fsSL https://ollama.com/install.sh | sh ;;
  esac
}

# If endpoint is non-default (e.g. remote or alternate port), we don't need
# the local binary at all — just probe the endpoint.
endpoint_is_default=true
case "$OLLAMA_ENDPOINT" in
  http://localhost:11434|http://127.0.0.1:11434) endpoint_is_default=true ;;
  *) endpoint_is_default=false ;;
esac

if ! $ollama_binary_ok && $endpoint_is_default; then
  if confirm "Install Ollama via $PKG_INSTALLER?" \
    "Ollama runs the embedding model locally — your notes never leave the machine. Without Ollama, semantic search cannot work."; then
    install_ollama || { err "Ollama install failed"; exit 1; }
    ollama_binary_ok=true
  else
    err "Ollama is required. Skipped."
    exit 2
  fi
fi

# Probe the endpoint.
if curl -s --max-time 2 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
  ok "Ollama service responding at $OLLAMA_ENDPOINT"
else
  if ! $endpoint_is_default; then
    err "Ollama not reachable at $OLLAMA_ENDPOINT."
    log "  Configured via VAULT_MEMORY_OLLAMA_ENDPOINT or config.toml. Check the remote / SSH tunnel."
    log "  To fall back to a local Ollama, unset the env var and re-run."
    exit 1
  fi
  warn "Ollama service not responding at $OLLAMA_ENDPOINT."
  if confirm "Start Ollama service?" \
    "vault-memory talks to Ollama via HTTP. Without the service running, indexing and search both fail."; then
    case "$PKG_INSTALLER" in
      brew) brew services start ollama || { err "Failed to start Ollama"; exit 1; } ;;
      *) sudo systemctl start ollama 2>/dev/null || ollama serve >/dev/null 2>&1 &
         sleep 2 ;;
    esac
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -s --max-time 1 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
        ok "Ollama service started"
        break
      fi
      sleep 1
    done
    if ! curl -s --max-time 1 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
      err "Ollama still not responding after start."
      exit 1
    fi
  else
    err "Ollama service is required. Skipped."
    exit 2
  fi
fi

# ─── Checkpoint 4: Embedding model(s) ────────────────────────────────────────

step "4/8  Embedding model: $EMBEDDING_MODEL"

ollama_list=$(ollama list 2>/dev/null || true)
ollama_names=$(printf '%s\n' "$ollama_list" | awk 'NR>1 {print $1}')

# Tag-tolerant check.
case "$EMBEDDING_MODEL" in
  *:*) model_with_tag="$EMBEDDING_MODEL" ;;
  *)   model_with_tag="${EMBEDDING_MODEL}:latest" ;;
esac

pull_model_if_missing() {
  local model="$1"
  local mt
  case "$model" in
    *:*) mt="$model" ;;
    *)   mt="${model}:latest" ;;
  esac
  if printf '%s\n' "$ollama_names" | grep -qx "$mt"; then
    return 0
  fi
  if printf '%s\n' "$ollama_names" | grep -q "^${model%:*}"; then
    warn "A variant of ${model%:*} is pulled, but not exactly $model."
  fi
  if confirm "Pull $model (one-time, ~600 MB – 1.2 GB)?" \
    "The embedding model converts notes into vectors. Stored in ~/.ollama/models, reused across vaults."; then
    ollama pull "$model" || { err "ollama pull $model failed"; return 1; }
    # Refresh the cached list.
    ollama_list=$(ollama list 2>/dev/null || true)
    ollama_names=$(printf '%s\n' "$ollama_list" | awk 'NR>1 {print $1}')
    ok "Model $model pulled"
    return 0
  else
    err "$model is required. Skipped."
    return 2
  fi
}

pull_model_if_missing "$EMBEDDING_MODEL" || exit $?
ok "Model $EMBEDDING_MODEL ready"

# Cross-vault model conflict check (item 13). Walk every embedding_model
# referenced in config.toml; warn (and offer to pull) for any model that
# isn't in `ollama list`.
if [ -f "$CONFIG_FILE" ]; then
  referenced_models=$(grep -E '^(embedding_model|secondary_embedding_model|default_embedding_model) = ' "$CONFIG_FILE" 2>/dev/null \
    | sed 's/.*= //; s/"//g' | sort -u || true)
  for m in $referenced_models; do
    [ "$m" = "$EMBEDDING_MODEL" ] && continue
    case "$m" in
      *:*) mt="$m" ;;
      *)   mt="${m}:latest" ;;
    esac
    if ! printf '%s\n' "$ollama_names" | grep -qx "$mt"; then
      warn "Vault config references model '$m' but it's not pulled."
      if confirm "Pull $m?" \
        "Required for at least one other registered vault. Without it, queries against that vault will fail at runtime."; then
        ollama pull "$m" || warn "Skipping (pull failed for $m)"
      fi
    fi
  done
fi

# ─── Checkpoint 5: vault-memory binary ───────────────────────────────────────

step "5/8  vault-memory binary"

detect_vault_memory_version() {
  local v=""
  v=$(vault-memory --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' | head -1 || true)
  if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  v=$(npm ls -g @owrede/vault-memory --depth=0 --parseable=false 2>/dev/null \
      | grep -oE '@owrede/vault-memory@[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' \
      | head -1 \
      | sed 's/^@owrede\/vault-memory@//' || true)
  if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  v=$(vault-memory --help 2>&1 | head -10 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' | head -1 || true)
  if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  printf 'unknown'
}

detect_vault_memory_origin() {
  local vm_path realpath_vm
  vm_path=$(command -v vault-memory 2>/dev/null || true)
  if [ -z "$vm_path" ]; then printf 'unknown'; return; fi
  realpath_vm=$(canonical_path "$vm_path")
  case "$realpath_vm" in
    *"$INSTALL_DIR"/*) printf 'source'; return ;;
  esac
  local npm_prefix
  npm_prefix=$(npm prefix -g 2>/dev/null || true)
  case "$realpath_vm" in
    "$npm_prefix"/*|/opt/homebrew/*|/usr/local/*)
      printf 'npm'
      return
      ;;
  esac
  printf 'unknown'
}

# Detect uncommitted WAL on existing vault DBs (item 12). If present, try to
# checkpoint via sqlite3 (system binary); otherwise warn loudly because v1→v2
# migration on top of an uncommitted WAL risks data loss.
check_wal_state() {
  if [ ! -d "$HOME/.vault-memory" ]; then return 0; fi
  local large_wal=0
  for wal in "$HOME/.vault-memory"/*.db-wal; do
    [ -e "$wal" ] || continue
    local size_bytes
    size_bytes=$(stat -f%z "$wal" 2>/dev/null || stat -c%s "$wal" 2>/dev/null || echo 0)
    if [ "$size_bytes" -gt 4096 ]; then
      large_wal=1
      local db="${wal%-wal}"
      warn "Uncommitted WAL on $(basename "$db") ($(du -h "$wal" | cut -f1)) — previous run aborted."
      if command -v sqlite3 >/dev/null 2>&1; then
        if sqlite3 "$db" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1; then
          ok "  Flushed WAL on $(basename "$db")"
        else
          warn "  Could not flush WAL — migration may surface inconsistent state."
        fi
      else
        warn "  sqlite3 not installed — cannot flush automatically. Install sqlite3 or accept risk."
      fi
    fi
  done
  return 0
}

print_upgrade_warning() {
  local from_version="$1"
  local to_version="$2"
  local has_existing_index="$3"
  log ""
  log "${c_yellow}${c_bold}╔══════════════════════════════════════════════════════════════╗${c_reset}"
  log "${c_yellow}${c_bold}║  UPGRADE WARNING: v${from_version} → v${to_version}$(printf '%*s' $((48 - ${#from_version} - ${#to_version})) '')║${c_reset}"
  log "${c_yellow}${c_bold}╚══════════════════════════════════════════════════════════════╝${c_reset}"
  log ""
  log "Selected v$to_version, currently v$from_version. ${c_bold}Full replacement${c_reset}"
  log "— both versions cannot run side-by-side (shared binary + data dir)."
  log ""
  log "${c_bold}What WILL change:${c_reset}"
  log "  • Global binary: v$from_version → v$to_version"
  log "    Command: npm install -g @owrede/vault-memory@$to_version"
  if [ "$has_existing_index" = "yes" ]; then
    log "  • Database schema in ~/.vault-memory/*.db migrated on first run."
    log "  • Full re-index recommended (new edge types + contract tables)."
    log "  • Vector embeddings stay valid (same model + dim, no re-embedding)."
  fi
  log "  • MCP tool surface grows: 23 v1 tools → 32 canonical + 10 MCP Resources."
  log "  • v1 tool names + shapes preserved (backwards-compatible)."
  log ""
  log "${c_bold}What will NOT change:${c_reset}"
  log "  • Your Markdown notes"
  log "  • Vault registration in ~/.vault-memory/config.toml"
  log "  • Ollama / embedding model"
  log ""
  log "${c_red}${c_bold}Rollback recipe (if v2 has issues):${c_reset}"
  log "  1. npm install -g @owrede/vault-memory@$from_version"
  if [ "$has_existing_index" = "yes" ]; then
    log "  2. tar -xzf ~/vault-memory-v${from_version}-backup-*.tar.gz -C ~/  (restore DBs)"
  else
    log "  2. (no DBs to restore — fresh re-index on next start)"
  fi
  log ""
  if [ -f "$CONFIG_FILE" ]; then
    local registered_vaults
    registered_vaults=$(grep -E "^name = " "$CONFIG_FILE" 2>/dev/null | sed 's/name = //; s/"//g' | tr '\n' ',' | sed 's/,$//; s/,/, /g')
    if [ -n "$registered_vaults" ]; then
      log "${c_bold}Scope:${c_reset} ALL registered vaults switch to v$to_version: ${c_bold}$registered_vaults${c_reset}"
      log ""
    fi
  fi
}

has_existing_vector_index() {
  if [ -d "$HOME/.vault-memory" ]; then
    if ls "$HOME/.vault-memory"/*.db >/dev/null 2>&1; then
      printf 'yes'
      return
    fi
  fi
  printf 'no'
}

# Always-backup on the upgrade path (item 5). AUTO mode still creates the
# tarball; only an explicit `no` skips it. If $HOME/.vault-memory is absent,
# this is a no-op.
make_pre_upgrade_backup() {
  local from_version="$1"
  if [ ! -d "$HOME/.vault-memory" ]; then return 0; fi
  local backup_path
  backup_path="$HOME/vault-memory-v${from_version}-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  if [ "$AUTO" = "1" ] || confirm "Create backup tarball at $backup_path before upgrade?" \
    "Snapshot of ~/.vault-memory/ (config + DBs). Your only rollback option once v2 migration runs (forward-only)."; then
    info "Creating backup: $backup_path"
    if tar -czf "$backup_path" -C "$HOME" .vault-memory 2>/dev/null; then
      ok "Backup written: $backup_path"
    else
      err "Backup failed."
      if ! confirm "Proceed without backup?" \
        "No rollback option if the upgrade fails. Strongly recommend aborting and investigating."; then
        exit 1
      fi
    fi
  else
    warn "Skipping backup. You will not be able to restore v$from_version state if v2 has issues."
  fi
}

# Multi-vault migration probe (item 4). For each DB in ~/.vault-memory/,
# attempt sqlite3 PRAGMA quick_check. Any failure surfaces the failing DB
# by name and offers to quarantine it (move <name>.db aside) so the rest
# of the install can proceed.
probe_existing_vaults() {
  if [ ! -d "$HOME/.vault-memory" ]; then return 0; fi
  if ! command -v sqlite3 >/dev/null 2>&1; then return 0; fi
  for db in "$HOME/.vault-memory"/*.db; do
    [ -e "$db" ] || continue
    if ! sqlite3 "$db" "PRAGMA quick_check;" 2>/dev/null | head -1 | grep -q '^ok$'; then
      warn "DB $(basename "$db") fails quick_check — likely will crash migration."
      local quarantine="${db}.quarantined-$(date +%Y%m%d-%H%M%S)"
      if confirm "Move $(basename "$db") aside to ${quarantine##*/} so the rest of the install can proceed?" \
        "Renames the file so VaultManager.loadAll() doesn't open it. You can investigate manually later. Other vaults remain usable."; then
        mv "$db" "$quarantine" || { err "Failed to move $db"; exit 1; }
        # Also move companions (-wal, -shm).
        [ -e "$db-wal" ] && mv "$db-wal" "$quarantine-wal" || true
        [ -e "$db-shm" ] && mv "$db-shm" "$quarantine-shm" || true
        ok "  Moved aside: $(basename "$quarantine")"
      fi
    fi
  done
}

# Pre-upgrade hygiene.
check_wal_state
probe_existing_vaults

UPGRADED_FROM_VERSION=""

if command -v vault-memory >/dev/null 2>&1; then
  vm_version=$(detect_vault_memory_version)
  vm_origin=$(detect_vault_memory_origin)
  vm_path=$(command -v vault-memory 2>/dev/null || true)
  ok "vault-memory in PATH (version $vm_version, origin: $vm_origin)"

  version_matches=false
  origin_matches=false
  [ "$vm_version" = "$SELECTED_VERSION" ] && version_matches=true
  case "$INSTALL_MODE" in
    npm)    [ "$vm_origin" = "npm" ]    && origin_matches=true ;;
    source) [ "$vm_origin" = "source" ] && origin_matches=true ;;
  esac

  if $version_matches && $origin_matches; then
    ok "Version $vm_version and origin $vm_origin match your Checkpoint-0 choice — no install change needed."
  elif [ "$SELECTED_VERSION" = "1.0.0" ]; then
    log ""
    info "Mismatch detected: installed $vm_version ($vm_origin), selected 1.0.0 (npm)"
    if [ "$vm_origin" = "source" ] || [[ "$vm_version" =~ ^2\. ]]; then
      warn "DOWNGRADE from $vm_version to 1.0.0."
      warn "Vaults re-indexed under v2 cannot be opened by v1. Restore from backup or wipe ~/.vault-memory/."
    fi
    if confirm "Switch to @owrede/vault-memory@1.0.0 (legacy stable)?" \
      "Replaces current binary with v1.0.0 from npm."; then
      npm install -g @owrede/vault-memory@1.0.0 || { err "npm install -g failed"; exit 1; }
      ok "vault-memory switched to 1.0.0"
    else
      warn "Switch declined. Keeping $vm_version."
    fi
  else
    has_index=$(has_existing_vector_index)
    print_upgrade_warning "$vm_version" "$SELECTED_VERSION" "$has_index"

    if ! confirm_destructive "Proceed with full replacement v${vm_version} → v${SELECTED_VERSION}?"; then
      err "Upgrade declined. v${vm_version} stays in place."
      log "  To retry: VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1 VAULT_MEMORY_VERSION=$SELECTED_VERSION bash setup.sh"
      exit 2
    fi

    if [ "$has_index" = "yes" ]; then
      make_pre_upgrade_backup "$vm_version"
    fi

    if [ "$INSTALL_MODE" = "npm" ]; then
      info "Installing v$SELECTED_VERSION via npm…"
      npm install -g "@owrede/vault-memory@$SELECTED_VERSION" \
        || { err "npm install -g failed."; exit 1; }
    else
      info "Building v$SELECTED_VERSION from source at $INSTALL_DIR…"
      if [ -d "$INSTALL_DIR/.git" ]; then
        ( cd "$INSTALL_DIR" && git pull --ff-only && npm install && npm run build && npm link ) \
          || { err "Source rebuild failed in $INSTALL_DIR"; exit 1; }
      else
        mkdir -p "$(dirname "$INSTALL_DIR")"
        if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
          gh repo clone owrede/vault-memory "$INSTALL_DIR" || { err "gh repo clone failed"; exit 1; }
        else
          git clone "$REPO_URL" "$INSTALL_DIR" || { err "git clone failed"; exit 1; }
        fi
        ( cd "$INSTALL_DIR" && npm install && npm run build && npm link ) \
          || { err "Source build failed"; exit 1; }
      fi
    fi
    ok "Upgrade complete: v${vm_version} → v${SELECTED_VERSION}"
    UPGRADED_FROM_VERSION="$vm_version"
  fi
fi

# Fresh install path.
if ! command -v vault-memory >/dev/null 2>&1; then
  warn "vault-memory not in PATH — performing first install."
  if [ "$INSTALL_MODE" = "npm" ]; then
    if confirm "Install vault-memory@$SELECTED_VERSION via npm?" \
      "Pulls from public npm registry. Pinned — no surprise jumps."; then
      npm install -g "@owrede/vault-memory@$SELECTED_VERSION" \
        || { err "npm install -g failed."; exit 1; }
      ok "vault-memory v$SELECTED_VERSION installed"
    else
      err "vault-memory is required."
      exit 2
    fi
  else
    if [ -d "$INSTALL_DIR/.git" ]; then
      info "Existing clone at $INSTALL_DIR — pull + rebuild."
      ( cd "$INSTALL_DIR" && git pull --ff-only && npm install && npm run build && npm link ) \
        || { err "Rebuild failed"; exit 1; }
    else
      mkdir -p "$(dirname "$INSTALL_DIR")"
      if command -v gh >/dev/null 2>&1; then
        gh repo clone owrede/vault-memory "$INSTALL_DIR" || { err "clone failed"; exit 1; }
      else
        git clone "$REPO_URL" "$INSTALL_DIR" || { err "clone failed"; exit 1; }
      fi
      ( cd "$INSTALL_DIR" && npm install && npm run build && npm link ) \
        || { err "Build failed"; exit 1; }
    fi
    ok "vault-memory installed from source"
  fi
fi

# Final PATH verify (item 16). If binary is at npm prefix but not in PATH,
# print the exact zsh PATH-edit instead of "open a new shell".
if ! command -v vault-memory >/dev/null 2>&1; then
  npm_prefix=$(npm prefix -g 2>/dev/null || true)
  candidate="$npm_prefix/bin/vault-memory"
  if [ -x "$candidate" ]; then
    err "vault-memory exists at $candidate but is not in your PATH."
    log ""
    log "Add this to ~/.zshrc (or ~/.bashrc on Linux):"
    log "  export PATH=\"$npm_prefix/bin:\$PATH\""
    log ""
    log "Then: source ~/.zshrc  (or open a new terminal)"
    exit 1
  fi
  err "vault-memory not in PATH after install. Check 'npm config get prefix'."
  exit 1
fi

# ─── Checkpoint 6: Config + initial index ────────────────────────────────────

step "6/8  Config + initial index"

# Item 15: canonical-path match against config.toml (handles symlinks +
# different quoting styles).
vault_already_registered() {
  if [ ! -f "$CONFIG_FILE" ]; then return 1; fi
  local target="$VAULT_ROOT"
  # Walk every `path = "..."` line in the config; canonicalize each and
  # compare. Avoids brittleness around quoting differences.
  while IFS= read -r line; do
    local p
    p=$(printf '%s' "$line" | sed 's/^path = //; s/"//g')
    p=$(canonical_path "$p")
    if [ "$p" = "$target" ]; then return 0; fi
  done < <(grep -E '^path = ' "$CONFIG_FILE" 2>/dev/null || true)
  return 1
}

# Item 7: pre-existing vault state report (last index, note delta, recommendation).
report_existing_vault_state() {
  local vault_name
  vault_name=$(basename "$VAULT_ROOT" | tr '[:upper:] ' '[:lower:]_')
  local db_path="$HOME/.vault-memory/${vault_name}.db"
  if [ ! -f "$db_path" ]; then return 0; fi
  if ! command -v sqlite3 >/dev/null 2>&1; then return 0; fi
  local n_notes_db n_notes_disk
  n_notes_db=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM notes;" 2>/dev/null || echo "?")
  n_notes_disk=$(find "$VAULT_ROOT" -name '*.md' -not -path '*/.obsidian/*' -not -path '*/.trash/*' 2>/dev/null | wc -l | tr -d ' ')
  log "  Notes in DB:    $n_notes_db"
  log "  Notes on disk:  $n_notes_disk"
  if [ "$n_notes_db" -lt "$n_notes_disk" ] 2>/dev/null; then
    info "  → recommend: vault-memory index (incremental, picks up new notes)"
  elif [ "$n_notes_db" -gt "$n_notes_disk" ] 2>/dev/null; then
    info "  → recommend: vault-memory index --full (DB has stale entries)"
  else
    info "  → recommend: no-op (DB and disk in sync)"
  fi
}

# Item 14: .mcp.json merge. If the vault already has a .mcp.json with other
# servers, vault-memory's CLI may overwrite it — pre-merge here.
merge_mcp_json_if_needed() {
  local mcp_json="$VAULT_ROOT/.mcp.json"
  if [ ! -f "$mcp_json" ]; then return 0; fi
  if ! command -v node >/dev/null 2>&1; then return 0; fi
  # Check if vault-memory is already listed.
  if grep -q '"vault-memory"' "$mcp_json" 2>/dev/null; then
    info "  .mcp.json already references vault-memory — no merge needed."
    return 0
  fi
  # Has OTHER servers?
  if grep -q '"mcpServers"' "$mcp_json" 2>/dev/null && grep -qE '":\s*{[^}]*"command"' "$mcp_json" 2>/dev/null; then
    warn ".mcp.json has other servers — will merge instead of overwrite."
    # Use node to do an atomic merge.
    node -e "
      const fs = require('fs');
      const p = '$mcp_json';
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      j.mcpServers = j.mcpServers || {};
      j.mcpServers['vault-memory'] = {
        command: 'vault-memory',
        args: ['serve'],
        env: {}
      };
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    " && ok "  .mcp.json merged" || warn "  .mcp.json merge failed (will let CLI try)"
  fi
}

if [ -f "$CONFIG_FILE" ]; then
  ok "Config exists: $CONFIG_FILE"
  if vault_already_registered; then
    ok "This vault is already in the config"
    report_existing_vault_state
  else
    warn "Config exists but does not reference this vault ($VAULT_ROOT)."
    merge_mcp_json_if_needed
    if confirm "Append this vault to the existing config via 'vault-memory add-vault'?" \
      "Atomic append — preserves existing vault entries. Also writes/merges .mcp.json."; then
      # We pass --no-index because the index prompt comes next, separately.
      # If .mcp.json already exists and we merged, skip --write.
      mcp_already_has_vm=0
      if [ -f "$VAULT_ROOT/.mcp.json" ] && grep -q '"vault-memory"' "$VAULT_ROOT/.mcp.json" 2>/dev/null; then
        mcp_already_has_vm=1
      fi
      if [ "$mcp_already_has_vm" = "1" ]; then
        vault-memory add-vault "$VAULT_ROOT" --no-index \
          || { err "vault-memory add-vault failed."; exit 1; }
      else
        vault-memory add-vault "$VAULT_ROOT" --write --no-index \
          || { err "vault-memory add-vault failed."; exit 1; }
      fi
      ok "Vault appended to config"
    else
      warn "Skipped. Edit $CONFIG_FILE manually."
    fi
  fi
else
  if [ -x "$WIZARD" ]; then
    bash "$WIZARD" "$VAULT_ROOT" "$EMBEDDING_MODEL" "$CONFIG_FILE" || { err "Config wizard failed"; exit 1; }
  else
    warn "Wizard not executable; creating minimal default config."
    mkdir -p "$(dirname "$CONFIG_FILE")"
    cat > "$CONFIG_FILE" <<EOF
[server]
log_level = "info"
ollama_endpoint = "$OLLAMA_ENDPOINT"
default_embedding_model = "$EMBEDDING_MODEL"

# [plugin] enabled = true exposes the five plugin-control MCP tools
# (set_runtime_config, resolve_secret, set_mcp_client, get_runtime_stats,
# trigger_reindex) that the Obsidian plugin needs for its side panel
# (Stats, Connectors, Reindex). Without this, the plugin opens to
# "Could not load stats" / "Could not load connectors" errors. Safe to
# leave on — these tools are no-ops when no client calls them.
[plugin]
enabled = true

[[vaults]]
name = "$(basename "$VAULT_ROOT" | tr '[:upper:] ' '[:lower:]_')"
path = "$VAULT_ROOT"
write_enabled = true
exclude_globs = [".obsidian/**", ".trash/**", "_research/**", ".claude/**", ".turbovault/**"]
EOF
    ok "Default config written to $CONFIG_FILE"
  fi
fi

# Always ensure [plugin] enabled = true is present (item: plugin side panel
# requires plugin-control tools to be exposed). Idempotent: only inserts the
# block if it doesn't already exist or is set to false.
ensure_plugin_block_enabled() {
  [ ! -f "$CONFIG_FILE" ] && return 0
  # If [plugin] block exists with enabled = true, do nothing.
  if grep -E '^\s*\[plugin\]\s*$' "$CONFIG_FILE" >/dev/null 2>&1; then
    # Block exists — check enabled
    if awk '/^\[plugin\]/{flag=1;next} /^\[/{flag=0} flag && /^[[:space:]]*enabled[[:space:]]*=[[:space:]]*true/{found=1} END{exit !found}' "$CONFIG_FILE"; then
      info "  [plugin] enabled=true already in config"
      return 0
    fi
    # Block exists but enabled is false or missing — flip it.
    if command -v node >/dev/null 2>&1; then
      node -e "
        const fs = require('fs');
        const p = '$CONFIG_FILE';
        let s = fs.readFileSync(p, 'utf8');
        s = s.replace(/(\[plugin\][^\[]*?)enabled\s*=\s*false/, '\$1enabled = true');
        if (!/(\[plugin\][^\[]*?)enabled\s*=\s*true/.test(s)) {
          s = s.replace(/(\[plugin\]\s*\n)/, '\$1enabled = true\n');
        }
        fs.writeFileSync(p, s);
      " && ok "  [plugin] enabled flipped to true in config"
    else
      warn "  Could not auto-edit [plugin] block — manually set 'enabled = true'."
    fi
  else
    # No [plugin] block at all — append it.
    cat >> "$CONFIG_FILE" <<'EOF'

# Added by /vmem:install — required for the Obsidian plugin's side panel
# (Stats, Connectors, Reindex). Without this the plugin shows MCP errors.
[plugin]
enabled = true
EOF
    ok "  Added [plugin] enabled = true block to config"
  fi
}

ensure_plugin_block_enabled

log ""
step "Initial index"

# Item 4 cont: run the index command with crash-shape detection. If it
# crashes with a SQLITE_CONSTRAINT or stack trace, identify which vault
# failed and offer quarantine.
run_index_with_crash_detection() {
  local index_args="$1"
  local stderr_log
  stderr_log=$(mktemp -t vm-index.XXXXXX)
  if vault-memory index $index_args 2>"$stderr_log"; then
    rm -f "$stderr_log"
    return 0
  fi
  local ec=$?
  err "Index command failed (exit $ec)."
  # Look for SQLITE_CONSTRAINT or migration stack trace in stderr.
  if grep -qE 'SQLITE_CONSTRAINT|UNIQUE constraint|migrateInternal' "$stderr_log"; then
    err "Detected a migration crash. Likely cause: a vault DB still has incompatible state."
    log ""
    log "Stderr tail:"
    tail -20 "$stderr_log" >&2
    log ""
    # Try to extract a vault name.
    local hint
    hint=$(grep -oE 'vault[^ ]*\.db|"\\S+\\.db"' "$stderr_log" | head -1 || true)
    if [ -n "$hint" ]; then
      log "Failing DB hint: $hint"
    fi
    log ""
    log "Recovery: re-run setup with VAULT_MEMORY_DIAGNOSE=1 to see which DB fails integrity_check,"
    log "then quarantine it manually:"
    log "  mv ~/.vault-memory/<failing-vault>.db ~/.vault-memory/<failing-vault>.db.quarantined"
    log "  vault-memory index --vault <healthy-vault>"
  fi
  rm -f "$stderr_log"
  return $ec
}

if [ -n "$UPGRADED_FROM_VERSION" ]; then
  warn "Upgrade detected (v${UPGRADED_FROM_VERSION} → v$SELECTED_VERSION). FULL re-index strongly recommended."
  log ""
  if confirm "Run 'vault-memory index --full' now?" \
    "Rebuilds typed-edge graph + contract scaffold. Embeddings reused (no re-embed)."; then
    run_index_with_crash_detection "--full" || { warn "Continuing despite index failure — agent can still use raw search after fix."; }
    ok "Re-index complete (or partial — check report above)"
  else
    warn "Skipped. v2 graph signal will be empty until 'vault-memory index --full' runs."
  fi
else
  if confirm "Run 'vault-memory index' now?" \
    "Builds the vector index for every Markdown note. Incremental on subsequent runs."; then
    run_index_with_crash_detection "" || { warn "Continuing despite index failure."; }
    ok "Index built (or partial — check report above)"
  else
    info "Skipped. Run 'vault-memory index' later."
  fi
fi

# ─── Checkpoint 6.5: Obsidian plugin ─────────────────────────────────────────

step "6.5/8  Obsidian plugin"

OBSIDIAN_DIR="$VAULT_ROOT/.obsidian"
PLUGIN_DIR="$OBSIDIAN_DIR/plugins/vault-memory"

install_obsidian_plugin() {
  local target_version="$SELECTED_VERSION"
  local tarball_url="https://github.com/owrede/vault-memory/releases/download/v${target_version}/vault-memory-plugin-v${target_version}.tar.gz"
  local tmp_dir
  tmp_dir=$(mktemp -d -t vm-plugin.XXXXXX)
  local tarball="$tmp_dir/plugin.tar.gz"

  info "Downloading plugin: $tarball_url"
  if command -v gh >/dev/null 2>&1; then
    # gh release download is more reliable than curl (handles auth + redirects).
    if gh release download "v${target_version}" \
         --repo owrede/vault-memory \
         --pattern "vault-memory-plugin-v${target_version}.tar.gz" \
         --output "$tarball" 2>/dev/null; then
      :
    else
      warn "gh release download failed — falling back to curl."
      curl -fsSL -o "$tarball" "$tarball_url" || { err "Plugin download failed (curl)"; rm -rf "$tmp_dir"; return 1; }
    fi
  else
    curl -fsSL -o "$tarball" "$tarball_url" || { err "Plugin download failed (no gh, curl failed)"; rm -rf "$tmp_dir"; return 1; }
  fi

  if [ ! -s "$tarball" ]; then
    err "Downloaded plugin tarball is empty."
    rm -rf "$tmp_dir"
    return 1
  fi

  mkdir -p "$PLUGIN_DIR"
  if ! tar -xzf "$tarball" -C "$PLUGIN_DIR"; then
    err "Failed to extract plugin tarball."
    rm -rf "$tmp_dir"
    return 1
  fi
  rm -rf "$tmp_dir"

  # Enable in community-plugins.json
  local enabled_json="$OBSIDIAN_DIR/community-plugins.json"
  if [ ! -f "$enabled_json" ]; then
    printf '["vault-memory"]\n' > "$enabled_json"
    ok "  Enabled plugin in community-plugins.json (created)"
  else
    if grep -q '"vault-memory"' "$enabled_json"; then
      info "  Plugin already enabled in community-plugins.json"
    else
      # Insert vault-memory using node for safe JSON manipulation.
      if command -v node >/dev/null 2>&1; then
        node -e "
          const fs = require('fs');
          const p = '$enabled_json';
          const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (!arr.includes('vault-memory')) arr.push('vault-memory');
          fs.writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
        " && ok "  Enabled plugin in community-plugins.json"
      else
        warn "  Could not auto-enable (no node). Manually add 'vault-memory' to $enabled_json"
      fi
    fi
  fi

  seed_plugin_data_json
  seed_example_contracts

  ok "Plugin installed at v$target_version: $PLUGIN_DIR"
  info "  Restart Obsidian (or 'Reload app without saving') to load the plugin."
  return 0
}

# Copy bundled example contracts into the user's vault at
# _contracts/examples/ on first install. Gated so we never overwrite
# user-edited examples and never pollute a vault that already has
# contracts of its own.
#
# Source: the plugin tarball ships an `examples/_contracts/*.contract`
# tree (in this repo, plugin/examples/_contracts/). After
# install_obsidian_plugin extracts the tarball into $PLUGIN_DIR, those
# .contract envelope files are available at $PLUGIN_DIR/examples/_contracts/.
# We ship .contract (canvas-editor format) not raw .yaml so a click in
# the Obsidian file explorer opens the canvas, not the OS file opener.
#
# Users get four reference contracts (meeting-prep, project-status,
# code-review-brief, smoketest-trivial) on first install, with a header
# comment explaining what they are. This addresses the user's complaint
# that opening the plugin showed no contracts and no way to understand
# how the contract system works.
seed_example_contracts() {
  if [ ! -d "$OBSIDIAN_DIR" ]; then return 0; fi
  local src="$PLUGIN_DIR/examples/_contracts"
  if [ ! -d "$src" ]; then
    info "  Bundled example contracts not found in $src — skipping seed."
    return 0
  fi
  local dst="$VAULT_ROOT/_contracts/examples"

  # Don't pollute if the user has contracts of their own already.
  if [ -d "$VAULT_ROOT/_contracts" ]; then
    local existing
    existing=$(find "$VAULT_ROOT/_contracts" -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' -o -name '*.contract' \) 2>/dev/null | head -1)
    if [ -n "$existing" ] && [ ! -d "$dst" ]; then
      info "  Vault already has contracts at _contracts/ — not seeding examples."
      return 0
    fi
  fi

  # Idempotent: only create the examples/ dir if it doesn't exist yet,
  # OR if it exists but is empty (a previous failed seed attempt).
  if [ -d "$dst" ] && [ "$(find "$dst" -type f | head -1)" ]; then
    info "  Example contracts already present at _contracts/examples/"
    return 0
  fi

  mkdir -p "$dst"
  cp "$src"/*.contract "$dst/" 2>/dev/null || {
    warn "  Failed to copy example contracts from $src"
    return 1
  }

  # Drop a README into the examples dir so the user understands they're
  # reference material, safe to delete, and the entry point to learn the
  # contract DSL.
  cat > "$dst/README.md" <<'EOF'
# Example Contracts

These four `.contract` files are reference task contracts shipped by
`/vmem:install`. They demonstrate the v2 contract DSL — the agentic
workflow primitive vault-memory exposes to MCP-aware agents. Click any
one in Obsidian's file explorer to open it in the canvas editor.

Each contract is a sequence of steps that an agent can instantiate via
the `instantiate_contract` MCP tool. Steps compose via `{{template}}`
references; sinks must resolve to a `MemorySink` (per the project's
non-negotiable memory-namespace safety invariant).

## Files

- `meeting-prep.contract` — surfaces context for an upcoming meeting from
  notes, recent calendar items, and topic keywords
- `project-status.contract` — rolls up a project's current state from
  related notes + recent commits
- `code-review-brief.contract` — assembles a code-review context bundle
- `smoketest-trivial.contract` — minimal literal-only contract used in CI

## Next steps

- Open any of these files in the **Contracts** side panel of the
  vault-memory plugin to inspect them
- Copy one into `_contracts/` (without the `examples/` prefix) to make
  it a "real" contract available to your agents
- Read the contract DSL reference at
  https://github.com/owrede/vault-memory/blob/main/docs/v2/adr/006-task-contract-dsl.md
- Safe to delete this whole folder if you don't need the examples

These files will NOT be re-seeded on subsequent `/vmem:install` runs.
EOF

  local count
  count=$(ls -1 "$dst"/*.yaml 2>/dev/null | wc -l | tr -d ' ')
  ok "  Seeded $count example contracts at _contracts/examples/"
}

# Seed/refresh .obsidian/plugins/vault-memory/data.json with absolute binary
# path so the plugin doesn't show "vault-memory CLI not found" on first open.
#
# Background: Obsidian (a GUI app launched from Finder / Dock / Spotlight)
# inherits a minimal PATH from launchd — typically just /usr/bin:/bin:
# /usr/sbin:/sbin. The npm global prefix (/opt/homebrew/bin, ~/.local/bin,
# nvm dirs, …) is added by the user's shell rc files, which GUI apps do NOT
# source. Result: `which vault-memory` works in Terminal, fails in Obsidian's
# child-process spawn — exactly the "CLI not found" banner from the screenshot.
#
# Fix: write the absolute, canonicalized path of the vault-memory binary into
# data.json's `serverCommand`. Idempotent: preserves any user-set keys we
# don't own (rerankerEnabled, indexerBatchSize, etc.) and refuses to OVERWRITE
# a user-set absolute path with our own.
seed_plugin_data_json() {
  local vm_abs_path
  vm_abs_path=$(command -v vault-memory 2>/dev/null || true)
  if [ -n "$vm_abs_path" ]; then
    vm_abs_path=$(canonical_path "$vm_abs_path")
  fi
  local plugin_data_json="$PLUGIN_DIR/data.json"
  local plugin_default_vault
  plugin_default_vault=$(basename "$VAULT_ROOT" | tr '[:upper:] ' '[:lower:]_')

  if command -v node >/dev/null 2>&1; then
    if VM_ABS_PATH="$vm_abs_path" \
       VM_OLLAMA_URL="$OLLAMA_ENDPOINT" \
       VM_EMBED_MODEL="$EMBEDDING_MODEL" \
       VM_DEFAULT_VAULT="$plugin_default_vault" \
       VM_DATA_JSON="$plugin_data_json" \
       node -e "
        const fs = require('fs');
        const p = process.env.VM_DATA_JSON;
        let cur = {};
        try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
        // serverCommand replacement rules:
        //   - empty / missing            → our absolute path
        //   - literal 'vault-memory'     → our absolute path (default, will fail in GUI PATH)
        //   - any other absolute path    → KEEP (user override, don't trample)
        const ours = process.env.VM_ABS_PATH;
        const existing = cur.serverCommand;
        let nextCmd = existing;
        if (!existing || existing === 'vault-memory') {
          nextCmd = ours || existing || 'vault-memory';
        }
        const next = Object.assign({}, cur, {
          serverCommand: nextCmd,
          serverArgs: cur.serverArgs || ['serve'],
          ollamaUrl: cur.ollamaUrl || process.env.VM_OLLAMA_URL || 'http://localhost:11434',
          embeddingModel: cur.embeddingModel || process.env.VM_EMBED_MODEL || 'bge-m3',
          defaultVault: cur.defaultVault || process.env.VM_DEFAULT_VAULT || null,
          rerankerEnabled: cur.rerankerEnabled !== undefined ? cur.rerankerEnabled : false,
          indexerBatchSize: cur.indexerBatchSize || 32,
          ftsTokenizer: cur.ftsTokenizer || null,
        });
        fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
        // emit which path we wrote so the parent shell can report it
        process.stderr.write(nextCmd + '\n');
      " 2>"$PLUGIN_DIR/.seed.stderr"; then
      seeded_path=$(cat "$PLUGIN_DIR/.seed.stderr" 2>/dev/null | head -1 || echo "")
      rm -f "$PLUGIN_DIR/.seed.stderr"
      if [ -n "$vm_abs_path" ]; then
        ok "  Plugin data.json seeded (serverCommand → $seeded_path)"
      else
        warn "  Plugin data.json seeded, but vault-memory binary path not resolvable — plugin will fall back to PATH lookup (may fail under Obsidian's GUI PATH)."
      fi
    else
      rm -f "$PLUGIN_DIR/.seed.stderr"
      warn "  Could not write $plugin_data_json — plugin may show 'CLI not found' until you set Server Command manually."
    fi
  else
    # No node. Emit minimal JSON directly.
    cat > "$plugin_data_json" <<EOF
{
  "serverCommand": "${vm_abs_path:-vault-memory}",
  "serverArgs": ["serve"],
  "ollamaUrl": "$OLLAMA_ENDPOINT",
  "embeddingModel": "$EMBEDDING_MODEL",
  "defaultVault": "$plugin_default_vault",
  "rerankerEnabled": false,
  "indexerBatchSize": 32,
  "ftsTokenizer": null
}
EOF
    ok "  Wrote $plugin_data_json (no node available — minimal seed)"
  fi
}

if [ ! -d "$OBSIDIAN_DIR" ]; then
  info "Not an Obsidian vault (no .obsidian/) — skipping plugin install."
elif [ "$SELECTED_VERSION" = "1.0.0" ]; then
  info "v1.0.0 does not ship an Obsidian plugin — skipping."
elif [ -d "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/manifest.json" ]; then
  # Already installed — check version.
  installed_v=""
  if command -v node >/dev/null 2>&1; then
    installed_v=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_DIR/manifest.json','utf8')).version)" 2>/dev/null || echo "")
  fi
  if [ -z "$installed_v" ]; then
    installed_v=$(grep -E '"version"' "$PLUGIN_DIR/manifest.json" | head -1 | sed 's/.*"version":\s*"\([^"]*\)".*/\1/' || echo "")
  fi
  # Plugin version follows the CLI's major.minor (currently 2.0.0).
  target_plugin_v="${SELECTED_VERSION%-*}"  # strip -rc.N suffix
  if [ "$installed_v" = "$target_plugin_v" ] || [ "$installed_v" = "$SELECTED_VERSION" ]; then
    ok "Obsidian plugin already at v$installed_v"
    # ALWAYS re-seed data.json — fixes the "CLI not found" symptom from
    # earlier runs that didn't include this step. Idempotent + non-destructive
    # for user-set values.
    seed_plugin_data_json
    # Idempotent re-seed of examples (no-op if already present).
    seed_example_contracts
  else
    warn "Obsidian plugin installed (v$installed_v) differs from target (v$target_plugin_v)."
    if confirm "Update Obsidian plugin to v$target_plugin_v?" \
      "Replaces .obsidian/plugins/vault-memory/ with the GitHub Release artifact."; then
      install_obsidian_plugin || warn "Plugin update failed — continuing. CLI works independently."
    else
      # Even if user declines the version update, seed data.json so the
      # currently-installed plugin can find the binary.
      seed_plugin_data_json
    fi
  fi
else
  if confirm "Install Obsidian plugin into .obsidian/plugins/vault-memory/?" \
    "Provides the visible UI half of vault-memory: brief panels, contract editor, search UI."; then
    install_obsidian_plugin || warn "Plugin install failed — continuing. CLI works independently."
  else
    info "Skipped. The CLI works without the plugin; install later via the same skill."
  fi
fi

# ─── Checkpoint 7: End-to-end smoketest ──────────────────────────────────────

step "7/8  Smoketest — does the MCP server respond?"

smoke_response=$(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"setup-smoketest","version":"1"}}}' \
    | perl -e "alarm $SMOKETEST_TIMEOUT; exec @ARGV" vault-memory serve 2>/dev/null | head -20
) || true

if printf '%s' "$smoke_response" | grep -q '"result"' && printf '%s' "$smoke_response" | grep -q '"serverInfo"'; then
  ok "MCP server responded to initialize"
else
  err "MCP server did not respond as expected (timeout: ${SMOKETEST_TIMEOUT}s)."
  log "Raw response (first 20 lines):"
  printf '%s\n' "$smoke_response" >&2
  log ""
  log "Troubleshooting:"
  log "  - VAULT_MEMORY_SMOKETEST_TIMEOUT=30 if Ollama is cold-starting"
  log "  - Run 'vault-memory serve' manually to inspect stderr"
  log "  - Check ~/.vault-memory/config.toml syntax"
  log "  - 'curl -s $OLLAMA_ENDPOINT/api/tags'"
  exit 1
fi

# Item 9: functional smoketest — also confirm the target vault appears in
# list_vaults and that a trivial search returns without throwing.
expected_vault_name=$(basename "$VAULT_ROOT" | tr '[:upper:] ' '[:lower:]_')
list_vaults_req='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_vaults","arguments":{}}}'
init_req='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"setup-smoketest","version":"1"}}}'
list_response=$(
  printf '%s\n%s\n' "$init_req" "$list_vaults_req" \
    | perl -e "alarm $SMOKETEST_TIMEOUT; exec @ARGV" vault-memory serve 2>/dev/null | head -40
) || true
if printf '%s' "$list_response" | grep -q "$expected_vault_name"; then
  ok "list_vaults includes '$expected_vault_name'"
else
  warn "list_vaults did not include '$expected_vault_name' — agent may need a restart to pick up the new vault."
fi

# ─── Done ────────────────────────────────────────────────────────────────────

log ""
log "${c_green}${c_bold}✓ Setup complete.${c_reset}"
log ""
log "Next: restart Claude Code in this vault. The mcp__vault-memory__* tools will appear."
log ""
log "Try asking the agent:"
log "  • \"search the vault for notes about <topic>\""
log "  • \"what are the backlinks to <Note>?\""
log "  • \"summarize what I have written about <person>\""
log ""
log "Health check anytime:  VAULT_MEMORY_DIAGNOSE=1 bash setup.sh"
log ""
