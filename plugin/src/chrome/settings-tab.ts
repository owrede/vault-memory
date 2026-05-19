/**
 * VaultMemorySettingsTab — Obsidian `PluginSettingTab` skeleton.
 *
 * Phase 7 / 07-03 / D-CHROME-SETTINGS (PLG-01).
 *
 * Plan 07-03 lands the skeleton only — `display()` calls
 * `containerEl.empty()`, draws the section header, and emits a
 * placeholder div. The chrome plan (07-08) replaces the placeholder
 * with the full settings UI (every field with restart-required badge),
 * the secrets panel (07-09), and the connectors panel (07-10).
 *
 * The missing-CLI banner is rendered here unconditionally when
 * `plugin.cliMissing === true` so the user can diagnose the failure
 * mode from the settings tab even if the `Notice` toast has expired.
 *
 * Adapter-seam discipline: the tab reads from `plugin.settingsStore`
 * and calls `plugin.settingsStore.set(...)` — it never writes
 * `data.json` directly.
 */

import { PluginSettingTab, type App } from "obsidian";
import type VaultMemoryPlugin from "../../main.js";

export class VaultMemorySettingsTab extends PluginSettingTab {
  // Capture the concrete plugin type alongside the base-class `plugin`
  // field so 07-08 can reach `this.vmPlugin.mcpClient` and
  // `this.vmPlugin.settingsStore` without a cast.
  readonly vmPlugin: VaultMemoryPlugin;

  constructor(app: App, plugin: VaultMemoryPlugin) {
    super(app, plugin);
    this.vmPlugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "vault-memory settings" });

    // Missing-CLI banner — surfaces the boot-time failure mode in a
    // place the user can find it again after the Notice toast expires.
    if (this.vmPlugin.cliMissing) {
      const banner = containerEl.createDiv({ cls: "vm-cli-missing-banner" });
      banner.setText(
        "vault-memory CLI not found. Install via the `/vm-install` skill " +
          "or set the Server Command setting to the absolute path of " +
          "`vault-memory`.",
      );
    }

    // Plan 07-08 replaces this placeholder with the full settings UI
    // (each VaultMemorySettings field → Setting() row + restart-required
    // badge). Keeping the placeholder as a stable selector lets the
    // chrome plan write its diff against a known anchor.
    const placeholder = containerEl.createDiv();
    placeholder.setAttribute("data-testid", "settings-placeholder");
    placeholder.setText(
      "Settings UI lands in plan 07-08. Current values are loaded from " +
        "`.obsidian/plugins/vault-memory/data.json` and used by the plugin " +
        "at startup.",
    );
  }
}
