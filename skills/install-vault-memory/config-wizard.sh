#!/usr/bin/env bash
# Config wizard — writes ~/.vault-memory/config.toml interactively.
#
# Invoked by setup.sh. Args:
#   $1 = vault root path
#   $2 = embedding model
#   $3 = config file path

set -u
set -o pipefail

VAULT_ROOT="${1:?vault root required}"
EMBED_MODEL="${2:?embedding model required}"
CONFIG_FILE="${3:?config path required}"

c_reset=$'\033[0m'
c_yellow=$'\033[33m'
c_green=$'\033[32m'
c_dim=$'\033[2m'

prompt() {
  local label="$1"
  local default="$2"
  local var
  if [ -e /dev/tty ]; then
    printf "${c_yellow}? %s${c_reset} ${c_dim}[%s]${c_reset}: " "$label" "$default" >&2
    read -r var </dev/tty || var=""
  else
    var=""
  fi
  printf "%s" "${var:-$default}"
}

# Suggest vault name from directory basename: lowercase, spaces → underscores.
default_name=$(basename "$VAULT_ROOT" | tr '[:upper:] ' '[:lower:]_')

vault_name=$(prompt "Vault name (short, lowercase, no spaces)" "$default_name")

mkdir -p "$(dirname "$CONFIG_FILE")"

cat > "$CONFIG_FILE" <<EOF
# vault-memory configuration
# Edit this file to add more vaults under [[vaults]] blocks.
# See https://github.com/owrede/vault-memory for full schema.

[server]
log_level = "info"
ollama_endpoint = "http://localhost:11434"
default_embedding_model = "$EMBED_MODEL"

[[vaults]]
name = "$vault_name"
path = "$VAULT_ROOT"
write_enabled = true
exclude_globs = [
  ".obsidian/**",
  ".trash/**",
  "_research/**",
  ".claude/**",
  ".turbovault/**",
  ".obsidian-memory/**",
]
EOF

printf "${c_green}✓${c_reset} Config written: %s\n" "$CONFIG_FILE" >&2
