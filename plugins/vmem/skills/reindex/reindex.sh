#!/usr/bin/env bash
# /vmem:reindex — rebuild the vector index for the current vault.

set -u
set -o pipefail

c_reset=$'\033[0m'
c_dim=$'\033[2m'
c_green=$'\033[32m'
c_yellow=$'\033[33m'
c_red=$'\033[31m'

log()  { printf "%s\n" "$*" >&2; }
info() { printf "${c_dim}%s${c_reset}\n" "$*" >&2; }
ok()   { printf "${c_green}✓${c_reset} %s\n" "$*" >&2; }
warn() { printf "${c_yellow}⚠${c_reset} %s\n" "$*" >&2; }
err()  { printf "${c_red}✗${c_reset} %s\n" "$*" >&2; }

if ! command -v vault-memory >/dev/null 2>&1; then
  err "vault-memory not in PATH — run /vmem:install first."
  exit 1
fi

FULL=true
VAULT_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --incremental) FULL=false ; shift ;;
    --full)        FULL=true  ; shift ;;
    --vault)       VAULT_NAME="${2:-}" ; shift 2 ;;
    *)             err "unknown arg: $1" ; exit 1 ;;
  esac
done

CONFIG_FILE="$HOME/.vault-memory/config.toml"

# Resolve vault name from CLAUDE_PROJECT_DIR if not pinned.
canonical_path() {
  local p="$1"
  [ -z "$p" ] && return 0
  readlink -f "$p" 2>/dev/null && return 0
  command -v realpath >/dev/null 2>&1 && realpath "$p" 2>/dev/null && return 0
  perl -MCwd=abs_path -le 'print abs_path(shift)' "$p" 2>/dev/null && return 0
  printf '%s' "$p"
}

if [ -z "$VAULT_NAME" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CONFIG_FILE" ]; then
  target=$(canonical_path "$CLAUDE_PROJECT_DIR")
  current_name=""
  while IFS= read -r line; do
    case "$line" in
      'name = '*) current_name=$(printf '%s' "$line" | sed 's/^name = //; s/"//g') ;;
      'path = '*)
        p=$(printf '%s' "$line" | sed 's/^path = //; s/"//g')
        p=$(canonical_path "$p")
        if [ "$p" = "$target" ]; then
          VAULT_NAME="$current_name"
          break
        fi
        ;;
    esac
  done < "$CONFIG_FILE"
fi

if [ -z "$VAULT_NAME" ]; then
  warn "Could not resolve a vault for CLAUDE_PROJECT_DIR=$CLAUDE_PROJECT_DIR"
  warn "Falling back to indexing ALL registered vaults."
fi

# Count notes-in-DB before, if sqlite3 is available.
db_path="$HOME/.vault-memory/vaults/${VAULT_NAME}.db"
[ ! -f "$db_path" ] && db_path="$HOME/.vault-memory/${VAULT_NAME}.db"
before_count="?"
if [ -n "$VAULT_NAME" ] && [ -f "$db_path" ] && command -v sqlite3 >/dev/null 2>&1; then
  before_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM notes;" 2>/dev/null || echo "?")
fi

flags=""
$FULL && flags="$flags --full"
[ -n "$VAULT_NAME" ] && flags="$flags --vault $VAULT_NAME"

info "Running: vault-memory index$flags"
info "  notes in DB before: $before_count"

stderr_log=$(mktemp -t vm-reindex.XXXXXX)
if vault-memory index $flags 2>"$stderr_log"; then
  rm -f "$stderr_log"
else
  ec=$?
  err "vault-memory index failed (exit $ec)"
  if grep -qE 'SQLITE_CONSTRAINT|UNIQUE constraint|migrateInternal' "$stderr_log"; then
    err "Detected a migration crash — likely a sibling DB has incompatible state."
    log "Stderr tail:"
    tail -20 "$stderr_log" >&2
    log "Recovery: run /vmem:health to see which DB fails integrity_check."
  fi
  rm -f "$stderr_log"
  exit $ec
fi

after_count="?"
if [ -n "$VAULT_NAME" ] && [ -f "$db_path" ] && command -v sqlite3 >/dev/null 2>&1; then
  after_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM notes;" 2>/dev/null || echo "?")
fi

ok "Index updated"
info "  notes in DB after:  $after_count"
