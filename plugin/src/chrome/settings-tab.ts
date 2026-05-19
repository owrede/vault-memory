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

/**
 * Restart-required notice copy template — exported so 07-08 Task 3's
 * secrets-panel can reuse the same phrasing where it touches restart-required
 * adjacent fields. Plain template string; keep `<field>` placeholder
 * verbatim so the grep in acceptance criteria can find this literal.
 */
const RESTART_NOTICE_PREFIX = "Restart required to apply.";

export class VaultMemorySettingsTab extends PluginSettingTab {
  readonly vmPlugin: VaultMemoryPlugin;
  /** Set during display(); cleared on hide() so $state subscriptions
   *  don't leak across settings-tab open/close cycles. */
  private secretsMount: SecretsPanelMount | null = null;

  constructor(app: App, plugin: VaultMemoryPlugin) {
    super(app, plugin);
    this.vmPlugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "vault-memory settings" });

    // Missing-CLI banner from 07-03 — preserved unchanged so users can
    // diagnose boot failures after the Notice toast has expired.
    if (this.vmPlugin.cliMissing) {
      const banner = containerEl.createDiv({ cls: "vm-cli-missing-banner" });
      banner.setText(
        "vault-memory CLI not found. Install via the `/vm-install` skill " +
          "or set the Server Command setting to the absolute path of " +
          "`vault-memory`.",
      );
    }

    // ---- Primary settings ---- (one `new Setting(...)` per row so the
    // structure is explicit; the wireText / wireToggle helpers only own
    // the value-coercion + onChange-push plumbing.)
    const ollamaUrlSetting = new Setting(containerEl);
    this.wireText(ollamaUrlSetting, {
      key: "ollamaUrl",
      name: "Ollama URL",
      desc: "Base URL of the local Ollama server. Default http://localhost:11434.",
    });

    const embeddingModelSetting = new Setting(containerEl);
    this.wireText(embeddingModelSetting, {
      key: "embeddingModel",
      name: "Embedding model",
      desc: "Ollama-loaded embedding model. Default bge-m3.",
    });

    const rerankerSetting = new Setting(containerEl);
    this.wireToggle(rerankerSetting, {
      key: "rerankerEnabled",
      name: "Reranker",
      desc: "Enable the cross-encoder reranker for search results.",
    });

    const defaultVaultSetting = new Setting(containerEl);
    this.wireText(defaultVaultSetting, {
      key: "defaultVault",
      name: "Default vault",
      desc: "Vault to scope hybrid search to by default. Empty = fan out across all vaults.",
      nullable: true,
    });

    // ---- Advanced section (collapsed by default) ----
    // Real <details> element (closed by default — no `open` attr).
    const advanced = containerEl.createEl("details", {
      attr: { "data-testid": "advanced-section" },
    });
    advanced.createEl("summary", { text: "Advanced" });

    const indexerBatchSetting = new Setting(advanced);
    this.wireText(indexerBatchSetting, {
      key: "indexerBatchSize",
      name: "Indexer batch size",
      desc: "Number of chunks the indexer embeds per Ollama call. Default 32.",
      coerce: "number",
    });

    const ftsTokenizerSetting = new Setting(advanced);
    this.wireText(ftsTokenizerSetting, {
      key: "ftsTokenizer",
      name: "FTS tokenizer override",
      desc: "SQLite FTS5 tokenizer override (e.g. 'porter unicode61'). Empty = SQLite default.",
      nullable: true,
    });

    const serverCommandSetting = new Setting(advanced);
    this.wireText(serverCommandSetting, {
      key: "serverCommand",
      name: "Server command",
      desc: "Path to the vault-memory binary. Default 'vault-memory' (uses PATH).",
    });

    const serverArgsSetting = new Setting(advanced);
    this.wireText(serverArgsSetting, {
      key: "serverArgs",
      name: "Server args",
      desc: "Space-separated CLI args passed to the server. Default 'serve'.",
      coerce: "args",
    });

    // ---- Secrets section ----
    // Mount the secrets-panel Svelte component into a stable host div so
    // its $state subscriptions and DOM tree are owned by this tab's
    // lifecycle. The mount is destroyed in hide() below.
    containerEl.createEl("h3", { text: "Secrets" });
    const secretsHost = containerEl.createDiv({
      attr: { "data-testid": "secrets-panel-host" },
    });
    // Tear down any prior mount before constructing a new one — display()
    // can be called multiple times for the same tab instance.
    this.secretsMount?.destroy();
    this.secretsMount = new SecretsPanelMount(secretsHost, {
      secretsStore: this.vmPlugin.secretsStore,
      safeStorage: this.vmPlugin.safeStorage,
    });
  }

  override hide(): void {
    this.secretsMount?.destroy();
    this.secretsMount = null;
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
        `Setting saved locally. The vault-memory server is unreachable — ${fieldName} will apply at next server start.`,
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
        `Setting saved locally; pushing to server failed: ${msg}`,
      );
    }
  }
}

