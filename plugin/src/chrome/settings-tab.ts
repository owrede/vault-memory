/**
 * VaultMemorySettingsTab — Obsidian `PluginSettingTab` for PLG-01.
 *
 * Phase 7 / 07-08 / D-CHROME-SETTINGS (07-CONTEXT.md L94–100).
 *
 * # Field surface (D-CHROME-SETTINGS)
 *
 * Restart-required (RESEARCH §"Pitfall" + 07-03 settings-store metadata):
 *   - ollamaUrl              — Ollama URL (text input)
 *   - embeddingModel         — Embedding model (text input)
 *   - ftsTokenizer           — FTS tokenizer override (text input, in Advanced)
 *   - serverCommand          — vault-memory binary path (text, in Advanced)
 *   - serverArgs             — server CLI args (text, in Advanced)
 *
 * Hot-swappable (pushes to running server via `set_runtime_config` MCP tool):
 *   - rerankerEnabled        — Reranker on/off (toggle)
 *   - defaultVault           — Default vault selection (text input)
 *   - indexerBatchSize       — Indexer batch size (text input, in Advanced)
 *
 * # Restart-required vs hot-swap behavior
 *
 *   Restart-required field onChange:
 *     1. Update SettingsStore + persist to data.json.
 *     2. Surface a `Notice` "Restart Obsidian to apply the new <field> setting."
 *     3. Do NOT call `set_runtime_config` — the running server cannot apply.
 *
 *   Hot-swappable field onChange:
 *     1. Update SettingsStore + persist to data.json.
 *     2. Call `plugin.mcpClient.callTool("set_runtime_config", {key, value})`.
 *     3. On failure (CLI missing / server error): surface a Notice, keep the
 *        local save. Local edits are durable across server restarts.
 *
 * # Layout
 *
 *   - Missing-CLI banner (07-03; preserved) — top of tab when `cliMissing`.
 *   - Primary fields — Ollama URL, Embedding model, Reranker, Default vault.
 *   - Advanced (`<details>` collapsed by default) — indexer batch size, FTS
 *     tokenizer, server command, server args.
 *   - Secrets section — task 3 mounts the secrets-panel here.
 *
 * # Pattern F (08-CONTEXT) — header doc-block citing PLG-01 + D-CHROME-SETTINGS.
 */

import { PluginSettingTab, Setting, Notice, type App } from "obsidian";
import type VaultMemoryPlugin from "../../main.js";
import type { VaultMemorySettings } from "../services/settings-store.js";
import { SecretsPanelMount } from "./secrets-panel-mount.js";
import { SourcesPanelMount } from "./sources-panel-mount.js";
import { renderChangelog } from "../changelog.js";

/**
 * Restart-required notice copy template — exported so 07-08 Task 3's
 * secrets-panel can reuse the same phrasing where it touches restart-required
 * adjacent fields. Plain template string; keep `<field>` placeholder
 * verbatim so the grep in acceptance criteria can find this literal.
 */
const RESTART_NOTICE_PREFIX = "Restart required to apply.";

type SettingsTabId =
  | "search"
  | "indexing"
  | "sources"
  | "secrets"
  | "server"
  | "about";

const TABS: ReadonlyArray<{ id: SettingsTabId; label: string }> = [
  { id: "search", label: "Search" },
  { id: "indexing", label: "Indexing" },
  { id: "sources", label: "Sources" },
  { id: "secrets", label: "Secrets" },
  { id: "server", label: "Server" },
  { id: "about", label: "About" },
];

export class VaultMemorySettingsTab extends PluginSettingTab {
  readonly vmPlugin: VaultMemoryPlugin;
  /** Set during display(); cleared on hide() so $state subscriptions
   *  don't leak across settings-tab open/close cycles. */
  private secretsMount: SecretsPanelMount | null = null;
  private sourcesMount: SourcesPanelMount | null = null;
  /** Active tab. Preserved across display() calls in this instance. */
  private currentTab: SettingsTabId = "search";

  constructor(app: App, plugin: VaultMemoryPlugin) {
    super(app, plugin);
    this.vmPlugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "vault-memory settings" });

    // Missing-CLI banner — preserved at the top so users can diagnose
    // boot failures regardless of which tab they're on.
    if (this.vmPlugin.cliMissing) {
      const banner = containerEl.createDiv({ cls: "vm-cli-missing-banner" });
      banner.setText(
        "The vault-memory server isn't running. Run the `/vmem:install` skill " +
          "to set it up, or point Server command (under the Server tab) to the " +
          "vault-memory binary on your machine.",
      );
    }

    // Tear down any prior mounts before the container gets re-rendered;
    // they'll be reconstructed only if the active tab needs them.
    this.secretsMount?.destroy();
    this.secretsMount = null;
    this.sourcesMount?.destroy();
    this.sourcesMount = null;

    // Tab nav — pattern adapted from perspecta-slides SettingsTab.
    const tabNav = containerEl.createDiv({
      cls: "vm-settings-tabs",
      attr: { "data-testid": "settings-tabs" },
    });
    for (const tab of TABS) {
      const btn = tabNav.createEl("button", {
        cls: `vm-settings-tab ${this.currentTab === tab.id ? "is-active" : ""}`,
        text: tab.label,
        attr: { "data-testid": `settings-tab-${tab.id}` },
      });
      btn.addEventListener("click", () => {
        if (this.currentTab === tab.id) return;
        this.currentTab = tab.id;
        this.display();
      });
    }

    const content = containerEl.createDiv({
      cls: "vm-settings-content",
      attr: { "data-testid": `settings-content-${this.currentTab}` },
    });

    switch (this.currentTab) {
      case "search":
        this.renderSearchTab(content);
        break;
      case "indexing":
        this.renderIndexingTab(content);
        break;
      case "sources":
        this.renderSourcesTab(content);
        break;
      case "secrets":
        this.renderSecretsTab(content);
        break;
      case "server":
        this.renderServerTab(content);
        break;
      case "about":
        this.renderAboutTab(content);
        break;
    }
  }

  override hide(): void {
    this.secretsMount?.destroy();
    this.secretsMount = null;
    this.sourcesMount?.destroy();
    this.sourcesMount = null;
  }

  // ─── Tab renderers ────────────────────────────────────────────────────

  private renderSearchTab(host: HTMLElement): void {
    this.wireText(new Setting(host), {
      key: "ollamaUrl",
      name: "Ollama URL",
      desc: "Where to reach the local Ollama server. Leave the default unless you've moved Ollama to a different port.",
    });

    this.wireText(new Setting(host), {
      key: "embeddingModel",
      name: "Embedding model",
      desc: "Which Ollama model to use for understanding your notes. Default: bge-m3.",
    });

    this.wireToggle(new Setting(host), {
      key: "rerankerEnabled",
      name: "Smarter ranking",
      desc: "Re-order search results so the most relevant notes come first. A bit slower, usually much better.",
    });

    this.wireText(new Setting(host), {
      key: "defaultVault",
      name: "Default vault",
      desc: "Which vault to search by default. Leave empty to search across all your vaults.",
      nullable: true,
    });
  }

  private renderIndexingTab(host: HTMLElement): void {
    this.wireText(new Setting(host), {
      key: "indexerBatchSize",
      name: "Indexer batch size",
      desc: "How many note chunks to send to Ollama at once. Higher = faster indexing but more memory. Default 32.",
      coerce: "number",
    });

    this.wireText(new Setting(host), {
      key: "ftsTokenizer",
      name: "Full-text search tokenizer",
      desc: "Custom SQLite FTS5 tokenizer (e.g. 'porter unicode61'). Leave empty unless you know you need it.",
      nullable: true,
    });
  }

  private renderSourcesTab(host: HTMLElement): void {
    // Spec: .planning/specs/SOURCES-REGISTRY.md §8.
    const sourcesHost = host.createDiv({
      attr: { "data-testid": "sources-panel-host" },
    });
    const settingsStore = this.vmPlugin.settingsStore;
    const vaultName = settingsStore.get("defaultVault") ?? "default";
    this.sourcesMount = new SourcesPanelMount(sourcesHost, {
      mcpClient: {
        callTool: (name, args) => this.vmPlugin.mcpClient.callTool(name, args),
        readResource: (uri) => this.vmPlugin.mcpClient.readResource(uri),
      },
      enabledTools: {
        get: () => settingsStore.get("sourceEnabledTools"),
        setForSource: async (source, tools) => {
          const current = { ...settingsStore.get("sourceEnabledTools") };
          if (tools === null) {
            delete current[source];
          } else {
            current[source] = [...tools];
          }
          await settingsStore.set("sourceEnabledTools", current);
        },
      },
      vaultName,
    });
  }

  private renderSecretsTab(host: HTMLElement): void {
    const secretsHost = host.createDiv({
      attr: { "data-testid": "secrets-panel-host" },
    });
    this.secretsMount = new SecretsPanelMount(secretsHost, {
      secretsStore: this.vmPlugin.secretsStore,
      safeStorage: this.vmPlugin.safeStorage,
    });
  }

  private renderServerTab(host: HTMLElement): void {
    this.wireText(new Setting(host), {
      key: "serverCommand",
      name: "Server command",
      desc: "vault-memory's local server. Leave the default ('vault-memory') unless you know what you're changing.",
    });

    this.wireText(new Setting(host), {
      key: "serverArgs",
      name: "Server arguments",
      desc: "Extra options passed to the server. Leave the default ('serve') unless you know what you're changing.",
      coerce: "args",
    });
  }

  private renderAboutTab(host: HTMLElement): void {
    const versionLine = host.createDiv({
      cls: "vm-settings-version",
      attr: { "data-testid": "settings-version" },
    });
    versionLine.setText(`vault-memory plugin v${this.vmPlugin.manifest.version}`);

    host.createEl("h3", { text: "Changelog" });
    const changelogHost = host.createDiv({
      cls: "vm-changelog-host",
      attr: { "data-testid": "changelog-host" },
    });
    renderChangelog(changelogHost);
  }

  /**
   * Wire one text-input row for a settings key onto a pre-constructed
   * `Setting`. The caller owns the `new Setting(container)` call site so
   * the row count is explicit at the use site (one row per call).
   *
   * Restart-required keys append `RESTART_NOTICE_PREFIX` to the description
   * and skip the `set_runtime_config` push on change.
   */
  private wireText<K extends keyof VaultMemorySettings>(
    setting: Setting,
    spec: {
      key: K;
      name: string;
      desc: string;
      nullable?: boolean;
      coerce?: "number" | "args";
    },
  ): void {
    const store = this.vmPlugin.settingsStore;
    const isRestart = store.isRestartRequired(spec.key);
    const desc = isRestart ? `${spec.desc} ${RESTART_NOTICE_PREFIX}` : spec.desc;

    setting
      .setName(spec.name)
      .setDesc(desc)
      .addText((text) => {
        const current = store.get(spec.key);
        const presented =
          current === null || current === undefined
            ? ""
            : Array.isArray(current)
              ? current.join(" ")
              : String(current);
        text.setValue(presented).onChange(async (raw) => {
          const value = this.coerceValue(spec, raw);
          await store.set(spec.key, value as VaultMemorySettings[K]);
          await this.pushOrNotify(spec.key, value, isRestart, spec.name);
        });
      });
    // Tag the row for tests. The real Obsidian Setting puts `setName` as
    // an inner element; we annotate the wrapper so test queries are
    // robust to layout changes.
    (setting as unknown as { settingEl: { setAttribute: (n: string, v: string) => void } }).settingEl.setAttribute(
      "data-testid",
      `setting-${String(spec.key)}`,
    );
  }

  private wireToggle(
    setting: Setting,
    spec: { key: "rerankerEnabled"; name: string; desc: string },
  ): void {
    const store = this.vmPlugin.settingsStore;
    const isRestart = store.isRestartRequired(spec.key);
    const desc = isRestart ? `${spec.desc} ${RESTART_NOTICE_PREFIX}` : spec.desc;
    setting
      .setName(spec.name)
      .setDesc(desc)
      .addToggle((toggle) => {
        toggle.setValue(store.get(spec.key)).onChange(async (v) => {
          await store.set(spec.key, v);
          await this.pushOrNotify(spec.key, v, isRestart, spec.name);
        });
      });
    (setting as unknown as { settingEl: { setAttribute: (n: string, v: string) => void } }).settingEl.setAttribute(
      "data-testid",
      `setting-${spec.key}`,
    );
  }

  private coerceValue<K extends keyof VaultMemorySettings>(
    spec: { key: K; nullable?: boolean; coerce?: "number" | "args" },
    raw: string,
  ): unknown {
    if (spec.coerce === "number") {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 32;
    }
    if (spec.coerce === "args") {
      return raw.trim().length === 0 ? [] : raw.trim().split(/\s+/);
    }
    if (spec.nullable && raw.trim().length === 0) {
      return null;
    }
    return raw;
  }

  /**
   * Hot-swap path. On restart-required keys, surface a Notice and skip
   * the MCP call. On hot-swappable keys, attempt the call and degrade
   * gracefully when the CLI is missing — local save is durable either way.
   */
  private async pushOrNotify(
    key: keyof VaultMemorySettings,
    value: unknown,
    isRestart: boolean,
    fieldName: string,
  ): Promise<void> {
    if (isRestart) {
      new Notice(`Restart Obsidian to apply the new ${fieldName} setting.`);
      return;
    }
    if (this.vmPlugin.cliMissing) {
      new Notice(
        `Saved. The vault-memory server isn't running, so ${fieldName} will take effect the next time it starts.`,
      );
      return;
    }
    try {
      await this.vmPlugin.mcpClient.callTool("set_runtime_config", {
        key,
        value,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(
        `Saved locally, but couldn't tell the running server: ${msg}`,
      );
    }
  }
}

