#!/usr/bin/env bash
# install-skills.sh — install or update vault-memory's Claude Code skills
# in a target Obsidian vault's .claude/skills/ folder.
#
# Idempotent: re-running fetches the current main-branch versions of each
# skill and overwrites the local copies. User notes are not touched.
#
# Usage:
#   ./install-skills.sh                    # installs into $(pwd) — must be a vault root
#   ./install-skills.sh /path/to/vault     # installs into the named vault
#   ./install-skills.sh --version          # print which commit this would fetch from
#
# Source: https://github.com/owrede/vault-memory/blob/main/scripts/install-skills.sh
# One-liner for first-time install from anywhere:
#   curl -fsSL https://raw.githubusercontent.com/owrede/vault-memory/main/scripts/install-skills.sh | bash -s -- /path/to/vault

set -eu

REPO_RAW="https://raw.githubusercontent.com/owrede/vault-memory/main"
SKILLS=(install-vault-memory add-vault audit-vault-health find-stale-notes triage-inbox)

# ─── Files per skill (kept in sync with the repo's skills/ tree) ─────────────
files_for() {
  case "$1" in
    install-vault-memory) echo "SKILL.md setup.sh config-wizard.sh" ;;
    add-vault)            echo "SKILL.md" ;;
    audit-vault-health)   echo "SKILL.md" ;;
    find-stale-notes)     echo "SKILL.md" ;;
    triage-inbox)         echo "SKILL.md" ;;
    *)                    echo "" ;;
  esac
}

# ─── Argument handling ───────────────────────────────────────────────────────
if [ "${1:-}" = "--version" ]; then
  curl -fsSL "https://api.github.com/repos/owrede/vault-memory/commits/main" \
    | sed -n 's/.*"sha": "\([^"]*\)".*/main @ \1/p' | head -1
  exit 0
fi

TARGET="${1:-$(pwd)}"
TARGET="${TARGET%/}"  # strip trailing slash

# ─── Sanity checks ───────────────────────────────────────────────────────────
if [ ! -d "$TARGET" ]; then
  echo "✗ Target does not exist: $TARGET" >&2
  exit 1
fi

if [ ! -d "$TARGET/.obsidian" ]; then
  echo "⚠ $TARGET does not look like an Obsidian vault (no .obsidian/ folder)." >&2
  printf "  Continue anyway? [y/N] " >&2
  read -r reply </dev/tty 2>/dev/null || reply=""
  case "$reply" in
    [yY]|[yY][eE][sS]) : ;;
    *) echo "Aborted." >&2; exit 1 ;;
  esac
fi

echo "→ Installing vault-memory skills into: $TARGET/.claude/skills/"

# ─── Fetch each file ─────────────────────────────────────────────────────────
mkdir -p "$TARGET/.claude/skills"

total=0
ok=0
for skill in "${SKILLS[@]}"; do
  mkdir -p "$TARGET/.claude/skills/$skill"
  for file in $(files_for "$skill"); do
    total=$((total + 1))
    url="$REPO_RAW/skills/$skill/$file"
    dest="$TARGET/.claude/skills/$skill/$file"
    if curl -fsSL "$url" -o "$dest"; then
      ok=$((ok + 1))
      printf "  ✓ %s/%s\n" "$skill" "$file"
    else
      printf "  ✗ %s/%s — failed to fetch %s\n" "$skill" "$file" "$url" >&2
    fi
  done
done

# Make shell scripts executable
chmod +x "$TARGET/.claude/skills/install-vault-memory"/*.sh 2>/dev/null || true

if [ "$ok" -eq "$total" ]; then
  echo ""
  echo "✓ All $total files installed."
  echo ""
  echo "Next: open the vault in Claude Code and run /install-vault-memory to set up vault-memory."
else
  echo ""
  echo "⚠ $ok of $total files installed. See errors above." >&2
  exit 1
fi
