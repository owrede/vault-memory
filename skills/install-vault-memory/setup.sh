#!/usr/bin/env bash
# vault-memory setup script — invoked by /install-vault-memory skill.
#
# Walks through 8 idempotent checkpoints (0–7). Each checkpoint either silently
# passes when already met, or asks for permission once before applying a fix.
# Never overwrites user data without confirmation. Never installs anything
# without consent.
#
# Exit codes:
#   0  success (or already-set-up)
#   1  recoverable failure with instructions printed
#   2  user declined a required step

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

# Ask user yes/no. Default no — unless VAULT_MEMORY_AUTO=1, then default yes for
# non-destructive steps. Destructive prompts must use confirm_destructive instead.
# Reads from /dev/tty so it works under Claude.
AUTO="${VAULT_MEMORY_AUTO:-0}"

confirm() {
  local prompt="$1"
  local reason="${2:-}"
  local reply
  if [ "$AUTO" = "1" ]; then
    info "auto: yes → $prompt"
    if [ -n "$reason" ]; then
      info "  why: $reason"
    fi
    return 0
  fi
  if [ ! -t 0 ] && [ ! -e /dev/tty ]; then
    warn "Non-interactive shell — cannot prompt. Skipping: $prompt"
    return 1
  fi
  if [ -n "$reason" ]; then
    printf "${c_dim}  why: %s${c_reset}\n" "$reason" >&2
  fi
  printf "${c_yellow}? %s [y/N]${c_reset} " "$prompt" >&2
  read -r reply </dev/tty
  case "$reply" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Destructive confirm — never auto-yes, always asks even in AUTO mode.
confirm_destructive() {
  local prompt="$1"
  local reply
  if [ ! -t 0 ] && [ ! -e /dev/tty ]; then
    warn "Non-interactive shell — refusing destructive op: $prompt"
    return 1
  fi
  printf "${c_red}! DESTRUCTIVE: %s [y/N]${c_reset} " "$prompt" >&2
  read -r reply </dev/tty
  case "$reply" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

VAULT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
INSTALL_DIR="${VAULT_MEMORY_INSTALL_DIR:-$HOME/Documents/GitHub/vault-memory}"
REPO_URL="${VAULT_MEMORY_REPO_URL:-https://github.com/owrede/vault-memory}"
EMBEDDING_MODEL="${VAULT_MEMORY_EMBED_MODEL:-bge-m3}"
CONFIG_FILE="$HOME/.vault-memory/config.toml"
WIZARD="$VAULT_ROOT/.claude/skills/install-vault-memory/config-wizard.sh"

# ─── Platform check ──────────────────────────────────────────────────────────

case "$(uname -s)" in
  Darwin) : ;;  # supported
  *) err "vault-memory setup currently supports macOS only (detected $(uname -s)). Linux support is on the roadmap."; exit 1 ;;
esac

log ""
log "${c_bold}vault-memory setup${c_reset}"
log "Vault:    $VAULT_ROOT"
log "Install:  $INSTALL_DIR"
log "Model:    $EMBEDDING_MODEL"
if [ "$AUTO" = "1" ]; then
  log "Mode:     ${c_green}autonomous${c_reset} (VAULT_MEMORY_AUTO=1)"
fi
log ""

# ─── Checkpoint 0: Choose version ────────────────────────────────────────────
#
# Two installable versions:
#   1) v1.0.0 (stable) — pulled from the public npm registry
#   2) v2.0.0-rc.1 (in-development) — built from source on `main`
#
# Selection order:
#   1. Explicit VAULT_MEMORY_VERSION env var (e.g. 1.0.0 or 2.0.0-rc.1)
#   2. Legacy VAULT_MEMORY_INSTALL_MODE env var (npm → 1.0.0; source → 2.0.0-rc.1)
#   3. Interactive prompt — ALWAYS fires, even in AUTO mode, because the
#      version choice is a meaningful product decision the user must make
#      once. Every OTHER prompt in this script still auto-yeses under AUTO.
#   4. Non-interactive shell (no TTY) defaults to 1.0.0 (stable) — the only
#      safe choice when we cannot ask.
#
# Internal INSTALL_MODE values stay `npm` / `source` so the rest of the
# script (Checkpoint 5) does not need to know about version labels.

step "0/7  Choose version"

resolve_install_mode_from_version() {
  case "$1" in
    1.0.0)
      INSTALL_MODE="npm"
      ;;
    2.0.0-rc.1)
      INSTALL_MODE="source"
      ;;
    *)
      err "Unknown VAULT_MEMORY_VERSION: $1 (expected '1.0.0' or '2.0.0-rc.1')"
      exit 1
      ;;
  esac
}

INSTALL_MODE=""

if [ -n "${VAULT_MEMORY_VERSION:-}" ]; then
  info "Version pinned via VAULT_MEMORY_VERSION=$VAULT_MEMORY_VERSION"
  resolve_install_mode_from_version "$VAULT_MEMORY_VERSION"
elif [ -n "${VAULT_MEMORY_INSTALL_MODE:-}" ]; then
  # Legacy env var — npm → 1.0.0, source → 2.0.0-rc.1
  case "$VAULT_MEMORY_INSTALL_MODE" in
    npm)
      info "Legacy env: VAULT_MEMORY_INSTALL_MODE=npm → installing v1.0.0 (stable)"
      INSTALL_MODE="npm"
      ;;
    source)
      info "Legacy env: VAULT_MEMORY_INSTALL_MODE=source → installing v2.0.0-rc.1 (in-development)"
      INSTALL_MODE="source"
      ;;
    *)
      err "Unknown VAULT_MEMORY_INSTALL_MODE: $VAULT_MEMORY_INSTALL_MODE (expected 'npm' or 'source')"
      exit 1
      ;;
  esac
elif [ ! -t 0 ] && [ ! -e /dev/tty ]; then
  # No TTY — can't prompt. Default to stable.
  warn "Non-interactive shell — defaulting to v1.0.0 (stable). Set VAULT_MEMORY_VERSION to override."
  INSTALL_MODE="npm"
else
  # Interactive prompt — fires unconditionally (including in AUTO mode).
  # Version choice is the single exception to the AUTO-never-prompts rule.
  if [ "$AUTO" = "1" ]; then
    info "AUTO mode: still asking which version to install — this is the one prompt that fires regardless of AUTO."
  fi
  log ""
  log "vault-memory has two installable versions:"
  log ""
  log "  1) v1.0.0 (stable)"
  log "     - Published to npm registry"
  log "     - 23 MCP tools, semantic + BM25 + RRF hybrid search, multi-vault, live indexing"
  log "     - Recommended for production use"
  log ""
  log "  2) v2.0.0-rc.1 (in-development)"
  log "     - Built from source (github.com/owrede/vault-memory main branch)"
  log "     - 32 canonical tools + 10 MCP Resources, REL-08 surface"
  log "     - Adds typed-edge graph, briefs, Obsidian plugin, task contracts"
  log "     - Not yet published to npm; not yet stable"
  log ""
  log "  q) quit (no install)"
  log ""
  log "  (Pass VAULT_MEMORY_VERSION=1.0.0 or 2.0.0-rc.1 to skip this prompt on future runs.)"
  log ""
  printf "${c_yellow}? Choice [1/2/q] (default 1):${c_reset} " >&2
  read -r version_reply </dev/tty
  case "$version_reply" in
    ""|1)
      INSTALL_MODE="npm"
      ;;
    2)
      INSTALL_MODE="source"
      ;;
    q|Q|quit|QUIT)
      err "Install cancelled by user."
      exit 2
      ;;
    *)
      err "Invalid choice: $version_reply (expected 1, 2, or q)"
      exit 1
      ;;
  esac
fi

# Resolve the human-readable version label from the install mode so the rest
# of the script can do precise mismatch detection in Checkpoint 5. This is
# the single source of truth for "what did the user pick?".
case "$INSTALL_MODE" in
  npm)    SELECTED_VERSION="1.0.0" ;;
  source) SELECTED_VERSION="2.0.0-rc.1" ;;
esac

# Report the resolved install mode + show the GitHub-auth check for source mode.
case "$INSTALL_MODE" in
  npm)
    info "Resolved: v1.0.0 (stable) → npm registry (https://registry.npmjs.org/@owrede/vault-memory)"
    ;;
  source)
    info "Resolved: v2.0.0-rc.1 (in-development) → source build from $REPO_URL"
    if command -v vault-memory >/dev/null 2>&1; then
      ok "vault-memory already in PATH — skipping GitHub auth check"
    elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      ok "GitHub CLI authenticated ($(gh api user --jq .login 2>/dev/null || echo 'ok'))"
    else
      err "Source-build mode needs git access to owrede/vault-memory."
      log "Either set up gh auth ('gh auth login') or pick v1.0.0 (stable)."
      log "  Re-run with: VAULT_MEMORY_VERSION=1.0.0"
      exit 1
    fi
    ;;
esac

# ─── Checkpoint 1: Homebrew ──────────────────────────────────────────────────

step "1/7  Homebrew"

if command -v brew >/dev/null 2>&1; then
  ok "Homebrew installed ($(brew --version | head -1))"
else
  err "Homebrew is required and not installed."
  log ""
  log "Install it manually (cannot do this from a script safely):"
  log "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  log ""
  log "Re-run this skill after Homebrew is installed."
  exit 1
fi

# ─── Checkpoint 2: Node 22+ ──────────────────────────────────────────────────

step "2/7  Node 22+"

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

if ! $node_ok; then
  if confirm "Install Node 22 via Homebrew?" \
    "vault-memory is a Node.js program (MCP server). Node 22+ is required because it uses native fetch and modern ES modules. Installs to /opt/homebrew/opt/node@22 — does not touch any existing Node installs you may have via nvm."; then
    brew install node@22 || { err "brew install node@22 failed"; exit 1; }
    # link node@22 if necessary
    brew link --overwrite node@22 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      ok "Node $(node --version) installed"
    else
      err "Node still not in PATH after install. Add to shell: brew link node@22"
      exit 1
    fi
  else
    err "Node 22+ is required. Skipped."
    exit 2
  fi
fi

# ─── Checkpoint 3: Ollama running ────────────────────────────────────────────

step "3/7  Ollama"

ollama_binary_ok=false
if command -v ollama >/dev/null 2>&1; then
  ollama_binary_ok=true
fi

if ! $ollama_binary_ok; then
  if confirm "Install Ollama via Homebrew?" \
    "Ollama runs the embedding model locally — this is what makes vault-memory privacy-preserving: your notes never leave the machine. No API keys, no cloud calls, no per-query cost. Without Ollama, semantic search cannot work."; then
    brew install ollama || { err "brew install ollama failed"; exit 1; }
    ollama_binary_ok=true
  else
    err "Ollama is required. Skipped."
    exit 2
  fi
fi

# Service running?
if curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  ok "Ollama service responding on :11434"
else
  warn "Ollama service not responding."
  if confirm "Start Ollama service (brew services start ollama)?" \
    "vault-memory talks to Ollama via HTTP on localhost:11434. Without the service running, indexing and search both fail. 'brew services' registers Ollama as a LaunchAgent so it auto-starts on login — you only do this once."; then
    brew services start ollama || { err "Failed to start Ollama service"; exit 1; }
    # wait up to 10s for service to come up
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -s --max-time 1 http://localhost:11434/api/tags >/dev/null 2>&1; then
        ok "Ollama service started"
        break
      fi
      sleep 1
    done
    if ! curl -s --max-time 1 http://localhost:11434/api/tags >/dev/null 2>&1; then
      err "Ollama still not responding after start. Check logs: brew services info ollama"
      exit 1
    fi
  else
    err "Ollama service is required. Skipped."
    exit 2
  fi
fi

# ─── Checkpoint 4: Embedding model ───────────────────────────────────────────

step "4/7  Embedding model: $EMBEDDING_MODEL"

# Capture `ollama list` output to a variable instead of piping to grep -q.
# Under `set -o pipefail`, a short-circuiting `grep -q` can race with
# `ollama list` and produce a SIGPIPE-induced exit 141, making the if-test
# falsely report "model missing". Capturing first avoids the pipe entirely.
ollama_list=$(ollama list 2>/dev/null || true)
ollama_names=$(printf '%s\n' "$ollama_list" | awk 'NR>1 {print $1}')

# Tag-tolerant check: if $EMBEDDING_MODEL has no explicit :tag, treat it as
# :latest because `ollama list` always prints the resolved tag (e.g.
# "bge-m3:latest"), never the bare name.
case "$EMBEDDING_MODEL" in
  *:*) model_with_tag="$EMBEDDING_MODEL" ;;
  *)   model_with_tag="${EMBEDDING_MODEL}:latest" ;;
esac

if printf '%s\n' "$ollama_names" | grep -q "^${EMBEDDING_MODEL%:*}"; then
  if printf '%s\n' "$ollama_names" | grep -qx "$model_with_tag"; then
    ok "Model $EMBEDDING_MODEL already pulled"
  else
    warn "A variant of ${EMBEDDING_MODEL%:*} is pulled, but not exactly $EMBEDDING_MODEL."
    if confirm "Pull $EMBEDDING_MODEL?" \
      "The embedding model converts your notes into vectors so vault-memory can find them by meaning, not just by keyword. bge-m3 is multilingual (DE/EN) and produces 1024-dim embeddings — the default since v0.7.3. One-time download, stored in ~/.ollama/models, reused across all vaults."; then
      ollama pull "$EMBEDDING_MODEL" || { err "ollama pull failed"; exit 1; }
      ok "Model pulled"
    else
      err "$EMBEDDING_MODEL is required. Skipped."
      exit 2
    fi
  fi
else
  if confirm "Pull $EMBEDDING_MODEL (one-time download, ~600 MB – 1.2 GB depending on model)?" \
    "The embedding model converts your notes into vectors so vault-memory can find them by meaning, not just by keyword. bge-m3 is multilingual (DE/EN) and produces 1024-dim embeddings — the default since v0.7.3. Stored in ~/.ollama/models, reused across all vaults."; then
    ollama pull "$EMBEDDING_MODEL" || { err "ollama pull failed"; exit 1; }
    ok "Model pulled"
  else
    err "$EMBEDDING_MODEL is required. Skipped."
    exit 2
  fi
fi

# ─── Checkpoint 5: vault-memory binary ───────────────────────────────────────

step "5/7  vault-memory binary"

# FORCE_SOURCE_REBUILD is set below when the user picks v2.0.0-rc.1 but the
# in-PATH binary is v1.0.0. Treating that case as "binary missing" routes
# control into the source-build branch.
FORCE_SOURCE_REBUILD=0

# Robust version detection. The CLI's --help output may not surface a version
# string on the first line (depends on commander/yargs/etc. style), and
# --version may or may not be wired. Try, in order:
#   1. `vault-memory --version` (cleanest if supported)
#   2. npm's view of the global package version (only meaningful if the binary
#      was installed via `npm install -g`, not via `npm link` from source)
#   3. fallback: `vault-memory --help | grep version line`
#   4. give up → "unknown"
detect_vault_memory_version() {
  local v=""
  # 1. --version
  v=$(vault-memory --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' | head -1 || true)
  if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  # 2. npm view of the globally-installed package
  v=$(npm ls -g @owrede/vault-memory --depth=0 --parseable=false 2>/dev/null \
      | grep -oE '@owrede/vault-memory@[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' \
      | head -1 \
      | sed 's/^@owrede\/vault-memory@//' || true)
  if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  # 3. --help first 10 lines
  v=$(vault-memory --help 2>&1 | head -10 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' | head -1 || true)
  if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  printf 'unknown'
}

# Detect where the in-PATH `vault-memory` actually comes from. Returns one of:
#   npm           — binary lives under an npm global prefix (npm-installed)
#   source        — binary symlinks into $INSTALL_DIR (npm-link from source clone)
#   unknown       — cannot determine (e.g. weird PATH setup)
detect_vault_memory_origin() {
  local vm_path realpath_vm
  vm_path=$(command -v vault-memory 2>/dev/null || true)
  if [ -z "$vm_path" ]; then printf 'unknown'; return; fi
  # Follow symlink to the real file
  realpath_vm=$(readlink -f "$vm_path" 2>/dev/null || realpath "$vm_path" 2>/dev/null || printf '%s' "$vm_path")
  case "$realpath_vm" in
    *"$INSTALL_DIR"/*) printf 'source'; return ;;
  esac
  # npm global prefix? Probe with `npm prefix -g` and also accept the common
  # /opt/homebrew and /usr/local prefixes that npm uses on macOS.
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

# Print the upgrade warning block (extracted into a function so we can call it
# from any mismatch branch — not only the v1.0.0 → v2.0.0-rc.1 case).
print_upgrade_warning() {
  local from_version="$1"
  log ""
  log "${c_yellow}${c_bold}╔══════════════════════════════════════════════════════════════╗${c_reset}"
  log "${c_yellow}${c_bold}║  UPGRADE WARNING: v${from_version} → v2.0.0-rc.1$(printf '%*s' $((45 - ${#from_version})) '')║${c_reset}"
  log "${c_yellow}${c_bold}╚══════════════════════════════════════════════════════════════╝${c_reset}"
  log ""
  log "You selected v2.0.0-rc.1 (in-development), but v${from_version} is currently"
  log "installed. This is a ${c_bold}full replacement${c_reset} — both versions cannot run"
  log "side-by-side because they share the same global binary name"
  log "(\`vault-memory\`) and the same data directory (~/.vault-memory/)."
  log ""
  log "${c_bold}What WILL change:${c_reset}"
  log "  • Global binary: ${c_bold}v${from_version}${c_reset} → ${c_bold}v2.0.0-rc.1${c_reset} (source-linked)"
  log "    (clone of $REPO_URL @ main, npm link from $INSTALL_DIR)"
  log "  • Database schema in ~/.vault-memory/*.db will be ${c_bold}migrated${c_reset}"
  log "    automatically on the next \`vault-memory serve\`. Migration is"
  log "    forward-only (typed-edges, briefs, task-contracts, additional tables)."
  log "  • A ${c_bold}full re-index${c_reset} is recommended after the upgrade — new edge"
  log "    types and new tables require fresh data to populate."
  log "  • MCP tool surface grows to 32 canonical tools + 10 Resources."
  log "    Existing tool names + shapes are preserved (backwards-compatible)."
  log ""
  log "${c_bold}What will NOT change:${c_reset}"
  log "  • Your Markdown notes (they live in the vault, not in vault-memory)"
  log "  • Vault registration in ~/.vault-memory/config.toml"
  log "  • Ollama / bge-m3 model"
  log "  • Other vaults registered with vault-memory — ALL of them upgrade"
  log "    together (single global binary, single data dir)"
  log ""
  log "${c_red}${c_bold}No automatic downgrade path:${c_reset}"
  log "  • The migrated DBs cannot be opened by v1.x anymore."
  log "  • To go back you need BOTH:"
  log "      1. \`npm install -g @owrede/vault-memory@1.0.0\` (revert binary)"
  log "      2. Restore ~/.vault-memory/ from a pre-upgrade backup OR"
  log "         delete the DBs and let v1 re-index from scratch"
  log "  • RECOMMENDED before proceeding: \`tar -czf ~/vault-memory-v1-backup.tar.gz ~/.vault-memory\`"
  log ""
  log "${c_bold}Scope of impact:${c_reset} ALL vaults registered with vault-memory will"
  log "use v2.0.0-rc.1 after this. There is no per-vault version selection."
  log ""
  # Inventory which vaults will be impacted so the user can see them by name.
  if [ -f "$CONFIG_FILE" ]; then
    local registered_vaults
    registered_vaults=$(grep -E "^name = " "$CONFIG_FILE" 2>/dev/null | sed 's/name = //; s/"//g' | tr '\n' ',' | sed 's/,$//; s/,/, /g')
    if [ -n "$registered_vaults" ]; then
      log "  Registered vaults that will switch to v2.0.0-rc.1: ${c_bold}$registered_vaults${c_reset}"
      log ""
    fi
  fi
}

if command -v vault-memory >/dev/null 2>&1; then
  vm_version=$(detect_vault_memory_version)
  vm_origin=$(detect_vault_memory_origin)
  vm_path=$(command -v vault-memory 2>/dev/null || true)
  ok "vault-memory in PATH (version $vm_version, origin: $vm_origin)"
  if [ "$vm_origin" = "source" ]; then
    info "  binary symlinks into source clone: $vm_path"
  fi

  # ── Mismatch detection ──
  #
  # The right question is not "is this binary exactly v1.0.0?" but:
  # "does the in-PATH binary match the user's Checkpoint-0 choice?"
  #
  # Two failure modes the OLD code missed:
  #   - User on v0.9.x or v0.10.x chooses v2.0.0-rc.1 → must trigger upgrade
  #   - User has source-clone present but in-PATH binary is npm-installed
  #     (because `npm install -g @latest` ran later) → must trigger relink
  #
  # `version_matches` is true iff vm_version equals SELECTED_VERSION exactly.
  # `origin_matches` is true iff the binary comes from the expected place:
  #   - npm-mode    → expects vm_origin = "npm"
  #   - source-mode → expects vm_origin = "source"
  version_matches=false
  origin_matches=false
  [ "$vm_version" = "$SELECTED_VERSION" ] && version_matches=true
  case "$INSTALL_MODE" in
    npm)    [ "$vm_origin" = "npm" ]    && origin_matches=true ;;
    source) [ "$vm_origin" = "source" ] && origin_matches=true ;;
  esac

  if $version_matches && $origin_matches; then
    ok "Version $vm_version and origin $vm_origin match your Checkpoint-0 choice — no upgrade needed."
  elif [ "$INSTALL_MODE" = "npm" ]; then
    # ── User picked v1.0.0; in-PATH binary is wrong version or wrong origin ──
    log ""
    info "Mismatch detected:"
    info "  installed version: $vm_version  (you selected: $SELECTED_VERSION)"
    info "  installed origin:  $vm_origin   (expected: npm)"
    log ""
    if confirm "Switch to @owrede/vault-memory@1.0.0 (stable npm release)?" \
      "Replaces the current binary with the stable v1.0.0 release from the public npm registry. 'npm install -g @owrede/vault-memory@1.0.0' overrides the current install in-place. Your data (~/.vault-memory/) and vault notes are untouched — only the engine code is changed. If the current binary came from a source-link (npm link), the npm install will replace the symlink with the registry artifact."; then
      npm install -g @owrede/vault-memory@1.0.0 \
        || { err "npm install -g failed"; exit 1; }
      ok "vault-memory switched to 1.0.0 (stable)"
    else
      warn "Switch declined. Keeping the existing $vm_version install."
    fi
  else
    # ── User picked v2.0.0-rc.1; in-PATH binary is wrong version or wrong origin ──
    # We are now in the upgrade-to-rc.1 path. This is destructive (DB schema
    # migration is forward-only, no automatic downgrade) — show the full
    # warning block, ask via confirm_destructive (always prompts, even in AUTO).
    print_upgrade_warning "$vm_version"

    if confirm_destructive "Proceed with full replacement v${vm_version} → v2.0.0-rc.1?"; then
      FORCE_SOURCE_REBUILD=1
      ok "Upgrade accepted. Proceeding with source build of v2.0.0-rc.1."
    else
      err "Upgrade declined. v${vm_version} stays in place."
      log "  To install v2.0.0-rc.1 later, re-run with VAULT_MEMORY_VERSION=2.0.0-rc.1"
      log "  and confirm the destructive prompt."
      exit 2
    fi
  fi
fi

if [ "$FORCE_SOURCE_REBUILD" = "1" ] || ! command -v vault-memory >/dev/null 2>&1; then
  if [ "$FORCE_SOURCE_REBUILD" = "1" ]; then
    info "Building v2.0.0-rc.1 from source to replace the in-PATH v1.0.0."
  else
    warn "vault-memory not in PATH."
  fi

  if [ "$INSTALL_MODE" = "npm" ]; then
    # ── npm install path (v1.0.0 stable, no GitHub auth needed) ─────────────
    if confirm "Install vault-memory@1.0.0 via 'npm install -g @owrede/vault-memory@1.0.0'?" \
      "Pulls v1.0.0 from the public npm registry (https://registry.npmjs.org/@owrede/vault-memory) and installs the 'vault-memory' binary globally. The version is pinned to 1.0.0 — running this skill later will not silently jump you to v2.x once it ships. No GitHub authentication or source build required."; then
      npm install -g @owrede/vault-memory@1.0.0 \
        || { err "npm install -g failed. Possible causes: npm not in PATH, npm prefix not writable (try: npm config get prefix). Falling back to source build: re-run with VAULT_MEMORY_VERSION=2.0.0-rc.1."; exit 1; }
      ok "vault-memory installed from npm registry"
    else
      err "vault-memory is required."
      exit 2
    fi
  else
    # ── source-build path (developer mode) ──────────────────────────────────
    if [ -d "$INSTALL_DIR/.git" ]; then
      info "Existing clone at $INSTALL_DIR — will pull + rebuild."
      if confirm "Rebuild vault-memory at $INSTALL_DIR?" \
        "An existing clone was found but the global 'vault-memory' command is not in PATH. Pulling latest, reinstalling deps, rebuilding TypeScript, and re-linking via 'npm link' to make the binary globally available."; then
        ( cd "$INSTALL_DIR" && git pull --ff-only && npm install && npm run build && npm link ) \
          || { err "Rebuild failed in $INSTALL_DIR"; exit 1; }
        ok "vault-memory rebuilt and linked"
      else
        err "vault-memory binary is required."
        exit 2
      fi
    else
      if confirm "Clone owrede/vault-memory to $INSTALL_DIR and install?" \
        "Source-build mode: clone the repo, run npm install + build + npm link. Use this only if you want to develop or modify vault-memory itself. For normal use, the default 'npm install -g' (unset VAULT_MEMORY_INSTALL_MODE) is simpler and does not require git access."; then
        mkdir -p "$(dirname "$INSTALL_DIR")"
        if command -v gh >/dev/null 2>&1; then
          gh repo clone owrede/vault-memory "$INSTALL_DIR" \
            || { err "gh repo clone failed (auth?)"; exit 1; }
        else
          git clone "$REPO_URL" "$INSTALL_DIR" \
            || { err "git clone failed. Set up GitHub auth (e.g. gh auth login) or check the URL."; exit 1; }
        fi
        ( cd "$INSTALL_DIR" && npm install && npm run build && npm link ) \
          || { err "Install/build/link failed in $INSTALL_DIR"; exit 1; }
        ok "vault-memory installed and linked from source"
      else
        err "vault-memory is required."
        exit 2
      fi
    fi
  fi

  # Verify
  if ! command -v vault-memory >/dev/null 2>&1; then
    err "After install, vault-memory still not in PATH. Try opening a new shell (or check 'npm bin -g')."
    exit 1
  fi
fi

# ─── Checkpoint 6: Config + initial index ────────────────────────────────────

step "6/7  Config + initial index"

if [ -f "$CONFIG_FILE" ]; then
  ok "Config exists: $CONFIG_FILE"
  if grep -q "path = \"$VAULT_ROOT\"" "$CONFIG_FILE" 2>/dev/null; then
    ok "This vault is already in the config"
  else
    warn "Config exists but does not reference this vault ($VAULT_ROOT)."
    if command -v vault-memory >/dev/null 2>&1; then
      info "Using 'vault-memory add-vault' to append this vault atomically (existing entries preserved)."
      if confirm "Append this vault to the existing config via 'vault-memory add-vault'?" \
        "Adds a [[vaults]] block to ~/.vault-memory/config.toml, writes .mcp.json to this vault's root (so Claude Code attaches the MCP server here), and builds the initial vector index. Existing vaults in the config are preserved — this is an atomic append, not a rewrite."; then
        vault-memory add-vault "$VAULT_ROOT" --write --no-index \
          || { err "vault-memory add-vault failed — inspect $CONFIG_FILE manually."; exit 1; }
        ok "Vault appended to config"
      else
        warn "Skipped. Edit $CONFIG_FILE manually to add a [[vaults]] entry."
      fi
    else
      warn "vault-memory binary not yet available — skipping config append. Re-run after Checkpoint 5 completed."
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
ollama_endpoint = "http://localhost:11434"
default_embedding_model = "$EMBEDDING_MODEL"

[[vaults]]
name = "$(basename "$VAULT_ROOT" | tr '[:upper:] ' '[:lower:]_')"
path = "$VAULT_ROOT"
write_enabled = true
exclude_globs = [".obsidian/**", ".trash/**", "_research/**", ".claude/**", ".turbovault/**"]
EOF
    ok "Default config written to $CONFIG_FILE"
  fi
fi

log ""
step "Initial index"

# Two flavours of the index prompt:
#  - Normal (incremental): first install OR no version change
#  - Post-upgrade: FORCE_SOURCE_REBUILD=1 was set above, indicating
#    v1.0.0 → v2.0.0-rc.1. Recommend a FULL re-index so the new typed-edge
#    tables and additional indexes are populated for ALL notes.
if [ "${FORCE_SOURCE_REBUILD:-0}" = "1" ]; then
  warn "Upgrade detected (v1.0.0 → v2.0.0-rc.1). A FULL re-index is strongly recommended."
  log "  Reason: v2 adds new edge types (mentions, frontmatter-refs, hyperlinks)"
  log "  and new tables (briefs, contracts) that the v1 index never populated."
  log "  Schema migration on first \`vault-memory serve\` will create the tables;"
  log "  the re-index fills them."
  log ""
  if confirm "Run 'vault-memory index --full' now? (≈5-15 min for a 90 MB vault)" \
    "Full re-index rebuilds the vector index AND populates the new v2 graph signal (typed edges, briefs scaffold) for every note. Required to make semantic+graph search return v2-quality results. Incremental updates after this will be fast as usual."; then
    vault-memory index --full || { err "Full re-index failed"; exit 1; }
    ok "Vault re-indexed under v2.0.0-rc.1"
  else
    warn "Skipped. v2 graph signal will be empty until you run 'vault-memory index --full' manually."
  fi
else
  if confirm "Run 'vault-memory index' now? (≈2 min for a typical vault)" \
    "Builds the vector index for every Markdown note in this vault — required before semantic search returns results. Incremental on subsequent runs (only re-embeds changed notes). The index lives in ~/.vault-memory/<vault>.db — your notes themselves are not modified."; then
    vault-memory index || { err "Index build failed"; exit 1; }
    ok "Index built"
  else
    info "Skipped. You can run 'vault-memory index' later."
  fi
fi

# ─── Checkpoint 7: End-to-end smoketest ──────────────────────────────────────

step "7/7  Smoketest — does the MCP server respond?"

# Send a minimal MCP initialize request on stdin, expect a JSON response.
# macOS has no `timeout` binary by default, so use perl's alarm() — portable.
smoke_response=$(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"setup-smoketest","version":"1"}}}' \
    | perl -e 'alarm 10; exec @ARGV' vault-memory serve 2>/dev/null | head -20
) || true

if printf '%s' "$smoke_response" | grep -q '"result"' && printf '%s' "$smoke_response" | grep -q '"serverInfo"'; then
  ok "MCP server responded to initialize"
else
  err "MCP server did not respond as expected."
  log ""
  log "Raw response (first 20 lines):"
  printf '%s\n' "$smoke_response" >&2
  log ""
  log "Troubleshooting:"
  log "  - Run 'vault-memory serve' manually in a terminal to inspect stderr"
  log "  - Check ~/.vault-memory/config.toml syntax"
  log "  - Make sure Ollama is reachable: curl -s http://localhost:11434/api/tags"
  exit 1
fi

log ""
log "${c_green}${c_bold}✓ Setup complete.${c_reset}"
log ""
log "Next: restart Claude Code in this vault. The mcp__vault-memory__* tools should appear."
log ""
log "Try asking the agent:"
log "  • \"search the vault for notes about <topic>\""
log "  • \"what are the backlinks to <Note>?\""
log "  • \"summarize what I have written about <person>\""
log ""
