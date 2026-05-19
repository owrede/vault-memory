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
# Two installable versions, both on the public npm registry:
#   1) v2.0.0-rc.1 (current, recommended) — dist-tag: next
#      32 canonical tools + 10 MCP Resources, typed-edge graph, briefs,
#      Obsidian plugin, task contracts. Not yet promoted to `latest` until
#      the v2.0.0 stable cut.
#   2) v1.0.0 (legacy stable) — dist-tag: latest
#      Original 23 MCP tools. Pinned for users that need the older surface
#      or have not yet completed migration to v2.
#
# Version choice and install mechanism are ORTHOGONAL:
#   - SELECTED_VERSION = "2.0.0-rc.1" (default) or "1.0.0" (explicit opt-in)
#   - INSTALL_MODE     = "npm" (default) or "source" (developer mode, v2 only)
#
# Selection order:
#   1. Explicit VAULT_MEMORY_VERSION env var (e.g. 1.0.0 or 2.0.0-rc.1)
#   2. Legacy VAULT_MEMORY_INSTALL_MODE env var (source → INSTALL_MODE=source,
#      version stays at the default 2.0.0-rc.1)
#   3. Interactive prompt — ALWAYS fires, even in AUTO mode, because the
#      version choice is a meaningful product decision the user must make
#      once. Every OTHER prompt in this script still auto-yeses under AUTO.
#   4. Non-interactive shell (no TTY) defaults to v2.0.0-rc.1 (current).

step "0/7  Choose version"

SELECTED_VERSION=""
INSTALL_MODE="npm"  # default; can be flipped to "source" by env var

resolve_version() {
  case "$1" in
    1.0.0|2.0.0-rc.1)
      SELECTED_VERSION="$1"
      ;;
    *)
      err "Unknown VAULT_MEMORY_VERSION: $1 (expected '2.0.0-rc.1' or '1.0.0')"
      exit 1
      ;;
  esac
}

if [ -n "${VAULT_MEMORY_VERSION:-}" ]; then
  info "Version pinned via VAULT_MEMORY_VERSION=$VAULT_MEMORY_VERSION"
  resolve_version "$VAULT_MEMORY_VERSION"
elif [ ! -t 0 ] && [ ! -e /dev/tty ]; then
  warn "Non-interactive shell — defaulting to v2.0.0-rc.1 (current). Set VAULT_MEMORY_VERSION=1.0.0 to override."
  SELECTED_VERSION="2.0.0-rc.1"
else
  # Interactive prompt — fires unconditionally (including in AUTO mode).
  # Version choice is the single exception to the AUTO-never-prompts rule.
  if [ "$AUTO" = "1" ]; then
    info "AUTO mode: still asking which version to install — this is the one prompt that fires regardless of AUTO."
  fi
  log ""
  log "vault-memory has two installable versions:"
  log ""
  log "  1) v2.0.0-rc.1  ${c_bold}(current, recommended)${c_reset}  npm dist-tag: next"
  log "     - 32 canonical MCP tools + 10 MCP Resources (REL-08 surface)"
  log "     - Typed-edge graph, compiled briefs, Obsidian plugin, task contracts"
  log "     - Backwards-compatible: all v1 tool names + shapes preserved"
  log ""
  log "  2) v1.0.0       (legacy stable)         npm dist-tag: latest"
  log "     - Original 23 MCP tools — semantic + BM25 + RRF hybrid search"
  log "     - For users that need the older surface or have not migrated"
  log ""
  log "  q) quit (no install)"
  log ""
  log "  (Pass VAULT_MEMORY_VERSION=2.0.0-rc.1 or 1.0.0 to skip this prompt on future runs.)"
  log ""
  printf "${c_yellow}? Choice [1/2/q] (default 1):${c_reset} " >&2
  read -r version_reply </dev/tty
  case "$version_reply" in
    ""|1)
      SELECTED_VERSION="2.0.0-rc.1"
      ;;
    2)
      SELECTED_VERSION="1.0.0"
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

# Now resolve INSTALL_MODE. Developers can opt into source-build for v2 via
# the legacy env var; everyone else uses npm.
if [ "${VAULT_MEMORY_INSTALL_MODE:-}" = "source" ]; then
  if [ "$SELECTED_VERSION" = "1.0.0" ]; then
    err "VAULT_MEMORY_INSTALL_MODE=source is incompatible with VAULT_MEMORY_VERSION=1.0.0."
    log "v1.0.0 is only published on npm; the source-build path always builds the current main branch (v2.0.0-rc.1+)."
    exit 1
  fi
  INSTALL_MODE="source"
  info "Developer env: VAULT_MEMORY_INSTALL_MODE=source → building $SELECTED_VERSION from source"
elif [ -n "${VAULT_MEMORY_INSTALL_MODE:-}" ] && [ "$VAULT_MEMORY_INSTALL_MODE" != "npm" ]; then
  err "Unknown VAULT_MEMORY_INSTALL_MODE: $VAULT_MEMORY_INSTALL_MODE (expected 'npm' or 'source')"
  exit 1
fi

# Report the resolved combination.
case "$INSTALL_MODE" in
  npm)
    case "$SELECTED_VERSION" in
      2.0.0-rc.1) info "Resolved: v2.0.0-rc.1 → npm registry, dist-tag 'next' (npm install -g @owrede/vault-memory@$SELECTED_VERSION)" ;;
      1.0.0)      info "Resolved: v1.0.0 → npm registry, dist-tag 'latest' (npm install -g @owrede/vault-memory@$SELECTED_VERSION)" ;;
    esac
    ;;
  source)
    info "Resolved: v$SELECTED_VERSION → source build from $REPO_URL"
    if command -v vault-memory >/dev/null 2>&1; then
      ok "vault-memory already in PATH — skipping GitHub auth check"
    elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      ok "GitHub CLI authenticated ($(gh api user --jq .login 2>/dev/null || echo 'ok'))"
    else
      err "Source-build mode needs git access to owrede/vault-memory."
      log "Either set up gh auth ('gh auth login') or unset VAULT_MEMORY_INSTALL_MODE for npm install."
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

# Print the upgrade warning block. Called when the user picks v2.0.0-rc.1
# AND a vector index from an older version already exists. Honest about what
# changes and what doesn't, names a backup command, gives a downgrade recipe.
print_upgrade_warning() {
  local from_version="$1"
  local has_existing_index="$2"  # "yes" if ~/.vault-memory/*.db exists
  log ""
  log "${c_yellow}${c_bold}╔══════════════════════════════════════════════════════════════╗${c_reset}"
  log "${c_yellow}${c_bold}║  UPGRADE WARNING: v${from_version} → v2.0.0-rc.1$(printf '%*s' $((45 - ${#from_version})) '')║${c_reset}"
  log "${c_yellow}${c_bold}╚══════════════════════════════════════════════════════════════╝${c_reset}"
  log ""
  log "You selected v2.0.0-rc.1, but v${from_version} is currently installed."
  log "This is a ${c_bold}full replacement${c_reset} — both versions cannot run side-by-side"
  log "because they share the same global binary name (\`vault-memory\`) and"
  log "the same data directory (~/.vault-memory/)."
  log ""
  log "${c_bold}What WILL change:${c_reset}"
  log "  • Global binary: ${c_bold}v${from_version}${c_reset} → ${c_bold}v2.0.0-rc.1${c_reset}"
  log "    Install command: ${c_bold}npm install -g @owrede/vault-memory@2.0.0-rc.1${c_reset}"
  log "    Published on the public npm registry under dist-tag \`next\`."
  if [ "$has_existing_index" = "yes" ]; then
    log "  • Database schema in ~/.vault-memory/*.db will be ${c_bold}migrated${c_reset}"
    log "    on first run. Migration is automatic + forward-only (adds typed-edge"
    log "    tables, contract audit, additional model + chunk indexes)."
    log "  • A ${c_bold}full re-index${c_reset} is recommended after migration — new edge"
    log "    types (mention, frontmatter-ref, hyperlink) and contract tables need"
    log "    fresh data to populate. v1 vectors stay valid and won't be re-embedded."
  fi
  log "  • MCP tool surface grows: 23 v1 tools → 32 canonical tools + 10 MCP Resources."
  log "    All v1 tool names + shapes are preserved (backwards-compatible)."
  log ""
  log "${c_bold}What will NOT change:${c_reset}"
  log "  • Your Markdown notes (they live in the vault, not in vault-memory)"
  log "  • Vault registration in ~/.vault-memory/config.toml"
  log "  • Ollama / bge-m3 model"
  log "  • Other vaults registered with vault-memory — ALL of them upgrade"
  log "    together (single global binary, single data dir)"
  log ""
  log "${c_red}${c_bold}No automatic downgrade path:${c_reset}"
  log "  • Once migrated, v2 DBs cannot be opened by v1 (schema is forward-only)."
  log "  • To return to v${from_version} you need BOTH:"
  log "      1. ${c_bold}npm install -g @owrede/vault-memory@${from_version}${c_reset}"
  log "      2. Restore ~/.vault-memory/ from a pre-upgrade backup OR"
  log "         delete the DBs and let v${from_version} re-index from scratch"
  if [ "$has_existing_index" = "yes" ]; then
    log "  • RECOMMENDED before proceeding:"
    log "      ${c_bold}tar -czf ~/vault-memory-v${from_version}-backup-\$(date +%Y%m%d-%H%M%S).tar.gz ~/.vault-memory${c_reset}"
  fi
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

# Check if a vector index already exists. Returns "yes" if any *.db file is
# present under ~/.vault-memory/, "no" otherwise. Used to scope the upgrade
# warning — fresh installs don't need the migration / re-index paragraphs.
has_existing_vector_index() {
  if [ -d "$HOME/.vault-memory" ]; then
    if ls "$HOME/.vault-memory"/*.db >/dev/null 2>&1; then
      printf 'yes'
      return
    fi
  fi
  printf 'no'
}

# Offer to make a backup tarball of ~/.vault-memory/ before applying an
# upgrade. The recommendation is in the warning text; this function gives the
# user a one-key way to execute it.
offer_pre_upgrade_backup() {
  local from_version="$1"
  if [ ! -d "$HOME/.vault-memory" ]; then return 0; fi
  local backup_path
  backup_path="$HOME/vault-memory-v${from_version}-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  if confirm "Create backup tarball at $backup_path before upgrade?" \
    "Saves a snapshot of ~/.vault-memory/ (config + all SQLite DBs) so you can restore the v${from_version} state if rc.1 doesn't work for you. Migration is forward-only so this is your only out. Tarball size matches your DB size; for a 50k-note vault expect 100-500 MB."; then
    tar -czf "$backup_path" -C "$HOME" .vault-memory \
      || { err "Backup failed — refusing to proceed without recovery option."; exit 1; }
    ok "Backup written: $backup_path"
  else
    warn "Skipping backup. You will not be able to restore the v${from_version} state if rc.1 has issues."
  fi
}

# Track whether we just performed an upgrade. Checkpoint 6 uses this to
# escalate the index prompt from incremental to full re-index.
UPGRADED_FROM_VERSION=""

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
  # The right question is not "is this binary exactly the right version?" but:
  # "does the in-PATH binary match the user's Checkpoint-0 choice?"
  #
  # Two failure modes to catch:
  #   - User on v0.9.x / v1.x chooses v2.0.0-rc.1 → upgrade prompt fires
  #   - User has source-clone present but in-PATH binary is npm-installed
  #     (because `npm install -g @latest` ran later) → re-link/upgrade fires
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
    ok "Version $vm_version and origin $vm_origin match your Checkpoint-0 choice — no install change needed."
  elif [ "$SELECTED_VERSION" = "1.0.0" ]; then
    # ── User picked v1.0.0 (legacy) but a different version/origin is installed ──
    # This is a DOWNGRADE if vm_version > 1.0.0, otherwise a switch within v1
    # patch lineage. Either way we ask via standard confirm (not destructive)
    # because going to v1 from a newer version is unusual and the user must be
    # explicit about it.
    log ""
    info "Mismatch detected:"
    info "  installed version: $vm_version  (you selected: 1.0.0)"
    info "  installed origin:  $vm_origin   (expected: npm)"
    log ""
    if [ "$vm_origin" = "source" ] || [[ "$vm_version" =~ ^2\. ]]; then
      warn "You are about to DOWNGRADE from $vm_version to 1.0.0."
      warn "Note: if your vaults have been re-indexed under v2 (typed-edges, briefs),"
      warn "      v1.0.0 will refuse to open those DBs. Restore from backup or delete"
      warn "      ~/.vault-memory/ and let v1 re-index from scratch."
    fi
    if confirm "Switch to @owrede/vault-memory@1.0.0 (legacy stable)?" \
      "Replaces the current binary with v1.0.0 from the public npm registry. 'npm install -g @owrede/vault-memory@1.0.0' overrides the current install in-place. Markdown notes are untouched; vault-memory DBs may be incompatible if you came from v2."; then
      npm install -g @owrede/vault-memory@1.0.0 \
        || { err "npm install -g failed"; exit 1; }
      ok "vault-memory switched to 1.0.0 (legacy stable)"
    else
      warn "Switch declined. Keeping the existing $vm_version install."
    fi
  else
    # ── User picked v2.0.0-rc.1; in-PATH binary is wrong version or wrong origin ──
    # This is the upgrade path. Show the warning, offer a backup, run the
    # actual install via npm (much faster than source-build), then continue.
    has_index=$(has_existing_vector_index)
    print_upgrade_warning "$vm_version" "$has_index"

    if ! confirm_destructive "Proceed with full replacement v${vm_version} → v2.0.0-rc.1?"; then
      err "Upgrade declined. v${vm_version} stays in place."
      log "  To install v2.0.0-rc.1 later, re-run with VAULT_MEMORY_VERSION=2.0.0-rc.1"
      log "  and confirm the destructive prompt."
      exit 2
    fi

    # Offer the backup before touching anything.
    if [ "$has_index" = "yes" ]; then
      offer_pre_upgrade_backup "$vm_version"
    fi

    # Execute the upgrade.
    if [ "$INSTALL_MODE" = "npm" ]; then
      info "Installing v2.0.0-rc.1 via 'npm install -g @owrede/vault-memory@2.0.0-rc.1'…"
      npm install -g @owrede/vault-memory@2.0.0-rc.1 \
        || { err "npm install -g failed. Inspect 'npm config get prefix' for permissions; re-run after fixing."; exit 1; }
    else
      # Developer mode: build from source.
      info "Building v2.0.0-rc.1 from source at $INSTALL_DIR…"
      if [ -d "$INSTALL_DIR/.git" ]; then
        ( cd "$INSTALL_DIR" && git pull --ff-only && npm install && npm run build && npm link ) \
          || { err "Source rebuild failed in $INSTALL_DIR"; exit 1; }
      else
        mkdir -p "$(dirname "$INSTALL_DIR")"
        if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
          gh repo clone owrede/vault-memory "$INSTALL_DIR" \
            || { err "gh repo clone failed"; exit 1; }
        else
          git clone "$REPO_URL" "$INSTALL_DIR" \
            || { err "git clone failed"; exit 1; }
        fi
        ( cd "$INSTALL_DIR" && npm install && npm run build && npm link ) \
          || { err "Source build failed"; exit 1; }
      fi
    fi
    ok "Upgrade complete: v${vm_version} → v2.0.0-rc.1"
    UPGRADED_FROM_VERSION="$vm_version"
  fi
fi

# Fresh install path: no vault-memory in PATH at script start, or the upgrade
# above didn't run (which it does run, so this branch only fires on first install).
if ! command -v vault-memory >/dev/null 2>&1; then
  warn "vault-memory not in PATH — performing first install."

  if [ "$INSTALL_MODE" = "npm" ]; then
    # Both v1.0.0 and v2.0.0-rc.1 are available on npm. Pin to SELECTED_VERSION.
    install_cmd="npm install -g @owrede/vault-memory@$SELECTED_VERSION"
    if confirm "Install vault-memory@$SELECTED_VERSION via '$install_cmd'?" \
      "Pulls v$SELECTED_VERSION from the public npm registry (https://registry.npmjs.org/@owrede/vault-memory) and installs the 'vault-memory' binary globally. Pinned to v$SELECTED_VERSION — no surprise jumps to a future release."; then
      eval "$install_cmd" \
        || { err "npm install -g failed. Inspect 'npm config get prefix' for permissions; try opening a new shell."; exit 1; }
      ok "vault-memory v$SELECTED_VERSION installed from npm registry"
    else
      err "vault-memory is required."
      exit 2
    fi
  else
    # Source-build (developer mode, v2 only).
    if [ -d "$INSTALL_DIR/.git" ]; then
      info "Existing clone at $INSTALL_DIR — will pull + rebuild."
      if confirm "Rebuild vault-memory at $INSTALL_DIR?" \
        "Pulling latest from main, reinstalling deps, rebuilding TypeScript, and re-linking via 'npm link' to make the binary globally available."; then
        ( cd "$INSTALL_DIR" && git pull --ff-only && npm install && npm run build && npm link ) \
          || { err "Rebuild failed in $INSTALL_DIR"; exit 1; }
        ok "vault-memory rebuilt and linked"
      else
        err "vault-memory binary is required."
        exit 2
      fi
    else
      if confirm "Clone owrede/vault-memory to $INSTALL_DIR and install?" \
        "Source-build mode: clone the repo, run npm install + build + npm link. Use only if you intend to modify vault-memory itself; for normal use, unset VAULT_MEMORY_INSTALL_MODE for the much faster npm install."; then
        mkdir -p "$(dirname "$INSTALL_DIR")"
        if command -v gh >/dev/null 2>&1; then
          gh repo clone owrede/vault-memory "$INSTALL_DIR" \
            || { err "gh repo clone failed (auth?)"; exit 1; }
        else
          git clone "$REPO_URL" "$INSTALL_DIR" \
            || { err "git clone failed. Set up GitHub auth or use the npm path (unset VAULT_MEMORY_INSTALL_MODE)."; exit 1; }
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
fi

# Final verify
if ! command -v vault-memory >/dev/null 2>&1; then
  err "After install, vault-memory still not in PATH. Try opening a new shell (or check 'npm bin -g')."
  exit 1
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
#  - Post-upgrade (UPGRADED_FROM_VERSION non-empty): A FULL re-index is
#    strongly recommended so the new v2 typed-edge tables and contract
#    scaffold populate for every note. v1 vectors stay valid (same embed
#    model + dim); only the graph signal is rebuilt.
#  - Normal (fresh install OR no version change): incremental index is
#    fine. Subsequent runs only re-embed changed notes.
if [ -n "$UPGRADED_FROM_VERSION" ]; then
  warn "Upgrade detected (v${UPGRADED_FROM_VERSION} → v$SELECTED_VERSION). A FULL re-index is strongly recommended."
  log "  Reason: v2 adds new edge types (mentions, frontmatter-refs, hyperlinks)"
  log "  and new tables (briefs, contracts) that the v${UPGRADED_FROM_VERSION} index never populated."
  log "  Schema migration on first \`vault-memory serve\` will create the tables;"
  log "  the re-index fills them. Existing embeddings are reused (same model + dim)."
  log ""
  if confirm "Run 'vault-memory index --full' now? (≈5-15 min for a 90 MB vault)" \
    "Full re-index rebuilds the typed-edge graph + contract scaffold for every note. Existing vector embeddings are reused (same bge-m3, same 1024-dim); only the graph signal is rebuilt. Required to make semantic+graph search return v2-quality results. Incremental updates after this will be fast as usual."; then
    vault-memory index --full || { err "Full re-index failed"; exit 1; }
    ok "Vault re-indexed under v$SELECTED_VERSION"
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
