// ============================================================================
// Changelog Data — Single Source of Truth
// Pattern adopted from perspecta-obsidian/src/changelog.ts.
// Used to render the Settings → Changelog UI in the Obsidian plugin AND
// to generate CHANGELOG-plugin.md / CHANGELOG-cli.md bundled with the
// plugin tarball. No async file reads, no markdown parsing — clean DOM.
// ============================================================================

export interface ChangelogEntry {
  version: string;
  date?: string;
  changes: string[];
}

/**
 * Obsidian plugin changelog — user-visible plugin-half changes.
 * CLI/MCP server changes live in PLUGIN_CLI_CHANGELOG below.
 */
export const PLUGIN_CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.0.5",
    date: "2026-05-20",
    changes: [
      'Fix: contract editor layout — palette and canvas were invisible; only the inspector\'s top-right corner ("Co" of "Contract details") peeked into the visible area. Root cause was two competing CSS grid containers: the outer `.vm-contract-editor` div created by view.ts defines `grid-template-areas: "palette canvas inspector"`, but the editor.svelte template (since 2.0.1) introduced an intermediate `.vm-editor-root` div with its OWN `display: grid`. That demoted the panes from direct children of the outer grid to grandchildren — `grid-area: palette` etc. silently stopped placing them.',
      "Fix: removed the `.vm-editor-root` wrapper div entirely. PalettePane / SvelteFlowProvider(CanvasPane) / InspectorPane now render as direct DOM children of the parent `.vm-contract-editor` host, so the outer grid's grid-area assignments apply again. SvelteFlowProvider's template is just `{@render children?.()}` — no wrapping element — so layout-transparent.",
    ],
  },
  {
    version: "2.0.4",
    date: "2026-05-20",
    changes: [
      'Fix: contract editor canvas now mounts. The 2.0.3 setViewData/onLoadFile try/catch wrappers caught the real underlying error — "To call useStore outside of <SvelteFlow /> you need to wrap your component in a <SvelteFlowProvider />" — thrown by @xyflow/svelte\'s useSvelteFlow() hook at canvas-pane.svelte module init. The hook was called at script top level but the matching <SvelteFlow> component is rendered inside the same component\'s template, so the store wasn\'t available yet.',
      "Wrapped the entire editor.svelte root in <SvelteFlowProvider> so useSvelteFlow() inside CanvasPane resolves to the same store that <SvelteFlow> creates further down the tree. This is the standard xyflow pattern when the flow API is consumed by siblings/ancestors of the flow canvas itself.",
    ],
  },
  {
    version: "2.0.3",
    date: "2026-05-20",
    changes: [
      'Fix (round 3): "" konnte nicht geöffnet werden when opening a .contract from the FILE EXPLORER (not the side panel). The earlier 2.0.2 fix addressed the side-panel path (openContract → workspace.openLinkText) but the file-explorer path goes through Obsidian\'s view-mount → ContractEditorView lifecycle directly, which is sensitive to any exception thrown during onLoadFile or setViewData. Obsidian swallows the exception and emits the empty-name notice instead of a useful error.',
      "Hardened ContractEditorView.setViewData with an outer try/catch — any exception (JSON parse, schema validation, Svelte mount failure, missing plugin reference, …) now renders an in-view error banner instead of bubbling up to Obsidian's view-mount path.",
      "Added ContractEditorView.onLoadFile override that wraps the super-call in try/catch + console.error diagnostic. If the file-read step itself fails (file vanished, permission denied, FS error), the error surfaces as a banner in the editor area instead of the empty-name notice.",
      'Fix: stdin-EOF watchdog in the CLI server (src/server.ts). When the parent Obsidian process dies for ANY reason — clean exit, crash, force-quit, ignored SIGTERM — the kernel closes stdin\'s read end. The server now detects this and shuts down within 500ms. Without this, the user accumulated 13 zombie `vault-memory serve` processes across a day of plugin reloads, each holding ~22k chokidar FDs. System-wide FD exhaustion (264k vs macOS\'s 245k cap) caused Obsidian to fail with "ENFILE: file table overflow" on next vault open. This watchdog is the permanent defense.',
    ],
  },
  {
    version: "2.0.2",
    date: "2026-05-20",
    changes: [
      'Fix: "" konnte nicht geöffnet werden — Obsidian\'s native "couldn\'t open <file>" notice with an empty filename when clicking a contract row in the side panel. Root cause was twofold: (a) openContract() used workspace.getLeaf(false).openFile(file), which on the side panel returns the side-panel leaf itself, and openFile rejects in-place view swap. (b) getViewData() returned "" when the parsed envelope was null, which could cause Obsidian\'s autosave path to overwrite the on-disk .contract file with empty content the next time the workspace decided to save (tab switch, sleep, etc.) — silently destroying user content and producing cascading empty-name notices when other contracts then tried to open against the broken state.',
      "Fix: openContract + createContract now route through workspace.openLinkText, which handles the leaf-selection edge cases properly (finds a main-pane leaf, creates one if needed, never tries to clobber the side panel). Both methods wrap the call in try/catch and surface failures as proper vault-memory: notices with the file path.",
      "Fix: getViewData() returns this.data (the file's on-disk bytes preserved by TextFileView) instead of \"\" when the in-memory envelope is null. A view that never successfully mounted now round-trips the existing file content unchanged on accidental saves, instead of nuking the file.",
      "Fix: contract scaffolds and converted YAML→.contract examples now satisfy ContractDocumentSchema. Five mismatches were present in 2.0.1: missing contract.version: 1, missing assembly[].as snake_case alias, editor.nodes[].id was `step-<N>` instead of `step:<alias>`, position was nested instead of flat x/y at node level, and editor.preservedComments instead of editor.yamlComments.",
      "Added: plugin/scripts/validate-examples.mjs — sanity-checks every bundled .contract file against the real Zod schema before each release.",
      'Added: empty-file / malformed-JSON paths in the contract editor now render a friendly "Initialize with scaffold" or "Replace with scaffold" button instead of just the raw JSON-parser error.',
    ],
  },
  {
    version: "2.0.1",
    date: "2026-05-20",
    changes: [
      'Side panel restructured to surface contracts first. "Open Contracts panel" command now shows a Contracts list at the top — every .contract and _contracts/*.yaml file in the vault. Click a row to open in the canvas editor. Admin sections (Operations / Stats / Connectors) moved into a collapsible "Advanced" details block at the bottom (open state persists across sessions).',
      'Workspace tab label renamed from "vault-memory" to "vault-memory: Contracts" to signal the panel\'s primary purpose. Command renamed from "Open vault-memory panel" to "Open Contracts panel".',
      'New "New contract" button in the Contracts panel — creates an untitled.contract file with a minimal valid scaffold and opens it in the canvas editor.',
      'Contract rows now show metadata (verb, source handle, sink handle) parsed from each file\'s YAML/JSON envelope.',
      "Example contracts shipped as `.contract` files (canvas-editable) in addition to the YAML form. The four reference contracts (meeting-prep, project-status, code-review-brief, smoketest-trivial) seed into _contracts/examples/ on first /vmem:install.",
      'Fix: "Malformed MCP envelope" errors on Stats + Connectors panels — peelEnvelope() now handles {isError: true} envelopes and throws a typed McpToolError carrying the server\'s human-readable text.',
      'Fix: Friendlier message when plugin-control MCP tools are not exposed — "Plugin tools are not exposed by the server. Add `[plugin] enabled = true` to ~/.vault-memory/config.toml" replaces the raw JSON-RPC error string.',
      "Fix: CLI-not-found banner now points users at `/vmem:install` (the new marketplace plugin) instead of the deprecated `/vm-install` skill.",
      "Added: Changelog viewer in Settings → Changelog (this section). Structured TS data; Perspecta-style renderer; no async file reads.",
    ],
  },
  {
    version: "2.0.0",
    date: "2026-05-19",
    changes: [
      "Initial 2.0.0 release shipping alongside the CLI's v2.0.0-rc.* line.",
      "Contract editor view registered for `.contract` extension (canvas-based agentic-workflow editor).",
      "Side-panel chrome with Reindex, Stats, Connectors sections.",
      "Settings tab with Ollama URL, embedding model, reranker toggle, default vault, indexer batch size, FTS tokenizer, server command, server args, secrets management.",
      "ReloadNotifier — subscribes to vault-memory://contracts/reloaded notifications so external contract edits refresh open canvas tabs.",
    ],
  },
];

/**
 * CLI / MCP server changelog — high-level summary mirroring the
 * repo-root CHANGELOG.md without duplicating its 600+ lines. Users get
 * the headline per version; for full detail the GitHub link in the
 * settings tab leads to the canonical CHANGELOG.md.
 */
export const PLUGIN_CLI_CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.0.0-rc.3",
    date: "2026-05-20",
    changes: [
      "Plugin error messages reference /vmem:install (was: vm-install).",
      "Includes all rc.2 fixes (migration-010, install-skill 22-issue backlog).",
    ],
  },
  {
    version: "2.0.0-rc.2",
    date: "2026-05-19",
    changes: [
      "Migration 010 fix: UNIQUE constraint failed: sections.note_id, sections.anchor — INSERT OR IGNORE + collision lookup. Unblocks v0.9.x/v1.0.0 → v2 upgrade for vaults with heading-only sibling sections (e.g. template scaffolds with repeated ## TODO headings).",
      "Install-skill (now /vmem:install) rewrite — 22 issues from real-world testing resolved.",
      "Auto-seeded plugin data.json with the absolute path of the vault-memory binary (fixes the \"CLI not found\" banner under Obsidian's GUI PATH).",
      "New diagnostic mode: VAULT_MEMORY_DIAGNOSE=1 (or --diagnose) runs read-only health checks across binary, Ollama, config, every DB integrity_check, MCP smoketest.",
      "[plugin] enabled = true auto-added to config.toml so the Obsidian side panel's Stats/Connectors work out of the box.",
    ],
  },
  {
    version: "2.0.0-rc.1",
    date: "2026-05-19",
    changes: [
      "First v2 prerelease. Tool surface: 23 v1 + 14 new = 37 total.",
      "New tools: expand (typed-edge BFS), cluster (Louvain), set_runtime_config, set_mcp_client, get_runtime_stats, trigger_reindex, resolve_secret, describe_contract, instantiate_contract, register_contracts_as_tools, load_brief, record_brief_usage.",
      "10 new MCP Resources (vault-memory://contracts/{vault}, …/contract-verbs/{vault}, …/brief/{vault}/{handle}, …/recent/{vault}, …/stats/{vault}, …/backlinks/{vault}/{+docId}, …/vaults, …/models/{vault}, others).",
      "Typed-edge graph: 4 edge types (wikilink, mention, frontmatter-ref, hyperlink) backfilled from v1 wikilinks.",
      "Task Contract DSL — declarative YAML contracts under _contracts/<name>.yaml, addressable by name, instantiable via MCP. Memory-sink invariant enforced at the DeliveryAdapter layer.",
      "Compiled briefs — addressable agent-prep documents, deduplicated across runs.",
      "Source/Sink adapter seams — Notion / Logseq connectors can drop in without touching src/server.ts.",
      "Backwards compatible: all 23 v1 tool names + shapes preserved byte-identical.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-05-12",
    changes: [
      "Stability declaration. 23-tool surface. Hybrid search (semantic + BM25 + RRF), ONNX cross-encoder reranker, live indexing, multi-vault, hash-protected writes.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-05-12",
    changes: ["suggest_frontmatter — three-layer schema inference."],
  },
  {
    version: "0.9.2",
    date: "2026-05-12",
    changes: ["Vault-hygiene skill pack."],
  },
  {
    version: "0.9.1",
    date: "2026-05-11",
    changes: ["Body-hash short-circuit for incremental re-indexing."],
  },
];

/**
 * Render a changelog into an Obsidian settings-tab container. Two
 * sections — plugin half + CLI half. Each version is an h3 + ul of
 * changes. Pattern matches perspecta-obsidian.
 */
export function renderChangelog(containerEl: HTMLElement): void {
  containerEl.createEl("h3", { text: "Obsidian plugin" });
  renderEntries(containerEl, PLUGIN_CHANGELOG);

  containerEl.createEl("h3", { text: "CLI / MCP server" });
  renderEntries(containerEl, PLUGIN_CLI_CHANGELOG);

  const footer = containerEl.createEl("p", { cls: "vm-changelog-footer" });
  footer.createSpan({ text: "Full CLI history: " });
  footer.createEl("a", {
    text: "github.com/owrede/vault-memory/blob/main/CHANGELOG.md",
    attr: {
      href: "https://github.com/owrede/vault-memory/blob/main/CHANGELOG.md",
      target: "_blank",
      rel: "noopener noreferrer",
    },
  });
}

function renderEntries(containerEl: HTMLElement, entries: ChangelogEntry[]): void {
  for (const entry of entries) {
    const versionDiv = containerEl.createDiv({ cls: "vm-changelog-version" });
    const heading = `v${entry.version}${entry.date ? ` — ${entry.date}` : ""}`;
    versionDiv.createEl("h4", { text: heading });
    const list = versionDiv.createEl("ul");
    for (const change of entry.changes) {
      list.createEl("li", { text: change });
    }
  }
}

/**
 * Generate markdown from a changelog list. Used to regenerate the
 * companion CHANGELOG-plugin.md / CHANGELOG-cli.md files in the
 * repository when bumping versions.
 */
export function generateChangelogMarkdown(
  title: string,
  entries: ChangelogEntry[],
): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const entry of entries) {
    lines.push(`## [${entry.version}]${entry.date ? ` — ${entry.date}` : ""}`);
    lines.push("");
    for (const change of entry.changes) {
      lines.push(`- ${change}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
