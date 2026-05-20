#!/usr/bin/env bash
# /vmem:help — print the vmem command surface.
#
# Pure stdout — no side effects. The skill body (SKILL.md) carries the
# canonical table; this script is here so users invoking the skill via
# a shell-out get a clean printed surface too.

set -u

c_bold=$'\033[1m'
c_dim=$'\033[2m'
c_reset=$'\033[0m'
c_green=$'\033[32m'

cat <<EOF
${c_bold}vmem command surface${c_reset}

  ${c_green}/vmem:install${c_reset}   One-call install (CLI + Obsidian plugin + example contracts)
  ${c_green}/vmem:health${c_reset}    Read-only diagnostic — PASS/WARN/FAIL per dimension
  ${c_green}/vmem:reindex${c_reset}   Rebuild vector index (full or --incremental)
  ${c_green}/vmem:help${c_reset}      This help

${c_dim}Common workflows:${c_reset}
  • First-time setup        → /vmem:install
  • "CLI not found" in plugin → /vmem:install (re-seeds data.json)
  • Memory broke            → /vmem:health
  • Stale search results    → /vmem:reindex --incremental
  • v1 → v2 upgrade         → /vmem:install (detects older install)

${c_dim}After install + Claude Code restart, the agent gets the mcp__vault-memory__*${c_reset}
${c_dim}tool family for in-conversation use (search_hybrid, read_note, expand, …).${c_reset}

EOF
