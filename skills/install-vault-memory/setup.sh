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

# ─── Checkpoint 0: Install source — npm registry (default) or git ───────────

step "0/7  Install source"

# Two install modes:
#   npm    (default)  → `npm install -g @owrede/vault-memory` from the public registry
#   source            → clone the repo and build locally (developer mode)
# Switch via env var: VAULT_MEMORY_INSTALL_MODE=source
INSTALL_MODE="${VAULT_MEMORY_INSTALL_MODE:-npm}"

case "$INSTALL_MODE" in
  npm)
    info "Install mode: ${c_bold}npm${c_reset} (registry: https://registry.npmjs.org/@owrede/vault-memory)"
    ;;
  source)
    info "Install mode: ${c_bold}source${c_reset} (clone + build from $REPO_URL)"
    if command -v vault-memory >/dev/null 2>&1; then
      ok "vault-memory already in PATH — skipping GitHub auth check"
    elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      ok "GitHub CLI authenticated ($(gh api user --jq .login 2>/dev/null || echo 'ok'))"
    else
      err "Source-build mode needs git access to owrede/vault-memory."
      log "Either set up gh auth ('gh auth login') or use the default npm install:"
      log "  unset VAULT_MEMORY_INSTALL_MODE   # uses npm registry, no auth needed"
      exit 1
    fi
    ;;
  *)
    err "Unknown VAULT_MEMORY_INSTALL_MODE: $INSTALL_MODE (expected 'npm' or 'source')"
    exit 1
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

if ollama list 2>/dev/null | grep -q "^${EMBEDDING_MODEL%:*}"; then
  # Tag-tolerant check: model name (without :tag) is present
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$EMBEDDING_MODEL"; then
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

if command -v vault-memory >/dev/null 2>&1; then
  vm_version=$(vault-memory --help 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
  ok "vault-memory in PATH (version $vm_version)"

  # If npm has a newer 'latest' than what is installed, offer to upgrade.
  if [ "$INSTALL_MODE" = "npm" ] && [ "$vm_version" != "unknown" ]; then
    latest=$(npm view @owrede/vault-memory@latest version 2>/dev/null || echo "")
    if [ -n "$latest" ] && [ "$latest" != "$vm_version" ]; then
      info "npm registry has @owrede/vault-memory@$latest (you have $vm_version)"
      if confirm "Upgrade to @owrede/vault-memory@$latest?" \
        "A newer release is available on npm. Upgrading via 'npm install -g @owrede/vault-memory@latest' replaces the global binary in-place. Your data (~/.vault-memory/) and vault notes are untouched — only the engine code is updated."; then
        npm install -g @owrede/vault-memory@latest \
          || { err "npm install -g failed"; exit 1; }
        ok "vault-memory upgraded to $latest"
      fi
    fi
  fi
else
  warn "vault-memory not in PATH."

  if [ "$INSTALL_MODE" = "npm" ]; then
    # ── npm install path (default, no GitHub auth needed) ───────────────────
    if confirm "Install vault-memory via 'npm install -g @owrede/vault-memory'?" \
      "Pulls the published package from the public npm registry (https://registry.npmjs.org/@owrede/vault-memory) and installs the 'vault-memory' binary globally. No GitHub authentication or source build required. The package is the bundled dist/cli.js — same code that gets built from source."; then
      npm install -g @owrede/vault-memory \
        || { err "npm install -g failed. Possible causes: npm not in PATH, npm prefix not writable (try: npm config get prefix). Falling back to source build: re-run with VAULT_MEMORY_INSTALL_MODE=source."; exit 1; }
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
if confirm "Run 'vault-memory index' now? (≈2 min for a typical vault)" \
  "Builds the vector index for every Markdown note in this vault — required before semantic search returns results. Incremental on subsequent runs (only re-embeds changed notes). The index lives in ~/.vault-memory/<vault>.db — your notes themselves are not modified."; then
  vault-memory index || { err "Index build failed"; exit 1; }
  ok "Index built"
else
  info "Skipped. You can run 'vault-memory index' later."
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
