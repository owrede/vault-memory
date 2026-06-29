---
name: install-vault-memory
description: Complete, guided installer for vault-memory in an Obsidian vault. The agent asks two decisions up front — (1) which retrieval engine, Ollama-based vector index OR CPU-only ContextFit, and (2) install scope: the current vault, a specific path, or search the drive for vaults — then installs EVERY missing dependency for the chosen engine, registers the vault(s), builds the index, wires the MCP server, and verifies. Use when the user says "/install-vault-memory" or "/vmem:install", "install vault-memory", "set up memory", "Memory aktivieren", or when the mcp__vault-memory__* tools are missing.
---

# install-vault-memory — Guided vault-memory setup

You (the agent) drive this install interactively. Do NOT blindly run a script:
**ask the two decisions below first**, explain the trade-offs so the user can
choose, then install everything required for the chosen path. Use
`AskUserQuestion` for the decisions and `Bash` for the steps. Every step is
idempotent — re-running on a complete setup should report "already done".

The end state of a successful install:

- `vault-memory` CLI / MCP server installed and on `PATH`
- All dependencies for the chosen engine present (see per-engine sections)
- The target vault(s) registered in `~/.vault-memory/config.toml`
- Initial index built
- `.mcp.json` written into each vault root so an MCP-aware client auto-spawns the server
- The Obsidian plugin installed into `.obsidian/plugins/vault-memory/` (when a vault has `.obsidian/`)
- MCP smoketest passes

---

## Decision 1 — Which retrieval engine?

Ask the user with `AskUserQuestion`. Present BOTH options with this comparison so
they can make an educated choice:

| | **Ollama (vector / embeddings)** | **ContextFit (CPU-only)** |
|---|---|---|
| How it retrieves | Neural embeddings + sqlite-vec ANN + BM25, RRF-fused (semantic search) | Token-native BM25 + Semantic-IDs (lexical/structural) |
| Hardware | Practically needs a GPU (or is slow on CPU); a model stays resident (~1.1 GB for bge-m3) | **CPU-only, no GPU, no model** (~41 MB deps) |
| Extra dependency | Ollama + a pulled embedding model | Python + `contextfit` (via pipx) |
| Strengths | Best semantic recall; paraphrase/cross-lingual matching | Fast ingest + query, tiny footprint, fully local, no model download |
| Ideal for | A workstation/laptop with a GPU or spare RAM | **Resource-limited / non-GPU hosts (e.g. a Synology NAS), privacy-strict setups** |
| Tradeoff | Heavy; GPU/RAM pressure | Lexical, not vector-semantic — exact/structural matches over fuzzy paraphrase |

Both build the same SQLite content layer, so graph/sections/frontmatter/stats
tools work either way. The choice only changes the **search** engine and its
dependencies. The engine is per-vault — different vaults can use different
engines, and it can be changed later by re-indexing.

Phrase the question plainly, e.g.: *"vault-memory can retrieve with an
Ollama-based vector index (best semantic search, needs Ollama + a model, GPU
recommended) or with ContextFit (CPU-only, no model, ideal for a NAS or
low-resource machine). Which do you want?"* Default suggestion: **Ollama** for a
GPU/laptop, **ContextFit** if the user mentions a NAS / no GPU / low resources.

## Decision 2 — Install scope (which vault(s)?)

Ask the user with `AskUserQuestion`. Detect context first:

- If `.obsidian/` exists in the current working directory → offer **"this vault
  (current directory)"** as the recommended first option.
- Otherwise omit that option.

Options to present:

1. **This vault** — the current directory (only when `.obsidian/` is present here).
2. **A specific path** — ask for the absolute path to the vault root.
3. **Search the drive** — find Obsidian vaults by locating `.obsidian/` directories,
   then let the user pick which to register. Ask whether to search the whole home
   directory or a specific subtree (whole-drive scans are slow — prefer a path).

To find vaults under a chosen root (default `$HOME`, or a user-given path):

```bash
# Each line is a vault root (the parent of a .obsidian directory).
find "<root>" -type d -name .obsidian -prune 2>/dev/null \
  | sed 's:/\.obsidian$::' | sort -u
```

Present the found vault roots and let the user select one, several, or all
(`AskUserQuestion` multiSelect). Register each selected vault with the engine
chosen in Decision 1.

---

## Preflight — detect what's already there

```bash
uname -s                                   # Darwin | Linux
command -v vault-memory && vault-memory --help 2>&1 | head -1
command -v node && node --version          # need >= 22
command -v brew                            # macOS package manager
cat ~/.vault-memory/config.toml 2>/dev/null | head -40
```

Only install what is missing. Report each check's result to the user.

## Common dependencies (both engines)

### Package manager
- **macOS:** Homebrew. If missing: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- **Linux:** detect `apt` / `dnf` / `pacman`.

### Node.js ≥ 22
```bash
# macOS
brew install node@22 && brew link --overwrite node@22
# Debian/Ubuntu
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
# Fedora:        sudo dnf install -y nodejs npm
# Arch:          sudo pacman -S --noconfirm nodejs npm
```

### vault-memory CLI / MCP server
```bash
npm install -g @owrede/vault-memory@latest
vault-memory --help    # confirm it's on PATH
```
If `npm install -g` warns the binary isn't on `PATH`, find it with `npm bin -g`
and tell the user the exact line to add to their shell rc (zsh: `~/.zshrc`).

---

## Engine-specific dependencies

### If Ollama was chosen

1. **Install + start Ollama**
   ```bash
   # macOS
   brew install ollama && brew services start ollama
   # Linux
   curl -fsSL https://ollama.com/install.sh | sh && (systemctl --user start ollama || ollama serve &)
   ```
2. **Verify the daemon** (honor a non-default endpoint if the user has one):
   ```bash
   curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null && echo "Ollama up"
   ```
3. **Pull the embedding model** (default `bge-m3`; `qwen3-embedding:0.6b` is a
   lighter option for low-RAM machines — offer it if RAM is tight):
   ```bash
   ollama pull bge-m3
   ```
   Also pull any model already referenced in an existing `config.toml`
   (`embedding_model` / `secondary_embedding_model`) so other vaults keep working.

### If ContextFit was chosen

1. **Python 3.10+** (usually present; install via the package manager if not).
2. **pipx** (isolated installs), then ContextFit:
   ```bash
   # macOS:  brew install pipx && pipx ensurepath
   # Linux:  python3 -m pip install --user pipx && python3 -m pipx ensurepath
   pipx install contextfit
   contextfit --help    # confirm it's on PATH
   ```
   (Plain `pip install contextfit` also works if the user prefers.)
3. **No Ollama, no model, no GPU needed.** If `contextfit` isn't on `PATH` after
   install, note the absolute path — it can be set per-vault via
   `[vaults.contextfit].command` in `config.toml`.

---

## Register the vault(s) + build the index

For EACH target vault from Decision 2, with the engine from Decision 1:

```bash
# Ollama vault:
vault-memory add-vault "<VAULT_PATH>" --name "<name>" --write

# ContextFit vault:
vault-memory add-vault "<VAULT_PATH>" --name "<name>" --backend contextfit --write
```

`add-vault` is idempotent (re-registering the same path is a no-op), appends a
`[[vaults]]` block to `~/.vault-memory/config.toml`, writes/merges `.mcp.json`
into the vault root (so an MCP-aware client can spawn the server for that vault),
and builds the initial index. Omit `--write` to keep the server read-only for
that vault (safer; the agent can't write notes). Pass `--no-index` to defer
indexing and run `vault-memory index <name>` later.

Notes:
- Indexing an Ollama vault requires Ollama up + the model pulled.
- Indexing a ContextFit vault requires the `contextfit` CLI on PATH.
- A large drive-wide search may find many vaults — only register the ones the
  user selected.

## Obsidian plugin (per vault, when `.obsidian/` exists)

If the vault has `.obsidian/`, install the desktop plugin so the user gets the
in-Obsidian UI:

1. Detect `<VAULT_PATH>/.obsidian/plugins/vault-memory/`. If absent, install the
   plugin artifacts (`main.js`, `manifest.json`, `styles.css`) — prefer a
   published GitHub release; otherwise build from the `plugin/` source.
2. Seed `<VAULT_PATH>/.obsidian/plugins/vault-memory/data.json` so the plugin
   finds the CLI even under Obsidian's minimal GUI PATH — set `serverCommand` to
   a **node + absolute-script pair** (the plugin already self-heals via a PATH
   probe, but seeding avoids the "CLI not found" banner on first open):
   ```json
   { "serverCommand": "<abs path to node>", "serverArgs": ["<abs path to vault-memory>", "serve"] }
   ```
   Resolve the paths with `command -v node` and `command -v vault-memory`.
3. Enable it in `<VAULT_PATH>/.obsidian/community-plugins.json` (append
   `"vault-memory"`).

If the vault has no `.obsidian/`, skip the plugin with an info line — it's not an
Obsidian vault or Obsidian hasn't initialized it.

## Verify (MCP smoketest)

```bash
# Confirms the server starts and the vault is registered.
vault-memory index <name> >/dev/null 2>&1   # (re-run is a fast no-op if current)
```
Then, ideally, drive a one-shot MCP `initialize` + `list_vaults` against
`vault-memory serve` and confirm the registered vault appears. Report PASS/FAIL.

On next Claude Code restart the `mcp__vault-memory__*` tools attach for the
registered vault(s).

---

## Reporting

After finishing, tell the user concisely:
- which engine was installed and why it fits their machine,
- which vault(s) were registered (name + path + engine),
- what was newly installed vs already present,
- that they should restart their MCP client to pick up the tools,
- and the follow-ups: `/vmem:health` (diagnostic), `/vmem:reindex` (rebuild index).

## Anti-patterns
- Do NOT pick the engine for the user without asking (unless they already stated
  CPU-only / NAS / GPU preference — then confirm the implied choice).
- Do NOT install Ollama/models if the user chose ContextFit, or pipx/contextfit
  if they chose Ollama.
- Do NOT register vaults the user didn't select during a drive search.
- Do NOT overwrite an existing `config.toml` wholesale or re-pull existing models.

## Related skills
- `/vmem:health` — read-only diagnostic across binary, deps, config, each vault DB, MCP smoketest
- `/vmem:reindex` — rebuild a vault's index (full or incremental)
