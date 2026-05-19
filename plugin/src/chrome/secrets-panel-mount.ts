/**
 * SecretsPanelMount — bridge between the Obsidian settings tab (plain DOM)
 * and the Svelte secrets-panel component.
 *
 * Phase 7 / 07-08 / Task 3.
 *
 * The settings tab is a `PluginSettingTab` that renders plain DOM; the
 * secrets panel is a Svelte 5 component that needs an explicit `mount()`
 * call. This mount class owns the lifecycle: construct on settings-tab
 * `display()`, dispose on settings-tab `hide()` so the Svelte $state
 * subscriptions are released.
 *
 * Vitest never compiles `.svelte` files (no svelte plugin configured), so
 * tests target `SecretsPanelController` directly. The mount class is
 * exercised at integration time (real Obsidian via manual smoke test).
 */

import type { SafeStorageAdapter } from "../services/safe-storage.js";
import type { SecretsStore } from "../services/secrets-store.js";

export interface SecretsPanelMountProps {
  secretsStore: SecretsStore;
  safeStorage: SafeStorageAdapter;
}

/**
 * Bridge from the Obsidian settings tab (plain DOM) to the Svelte
 * secrets-panel component. Vitest never compiles `.svelte` files in this
 * project (no svelte plugin in vitest.config.ts), so the import of
 * `secrets-panel.svelte` is dynamic — vitest skips the path entirely when
 * `mount()` is never called, which keeps unit tests for the settings tab
 * fast and free of a Svelte runtime.
 *
 * In production esbuild bundles the .svelte file at build time so the
 * dynamic import resolves synchronously (the bundle inlines it).
 */
export class SecretsPanelMount {
  private app: unknown = null;
  private unmountFn: ((app: unknown) => Promise<void>) | null = null;

  constructor(host: HTMLElement, props: SecretsPanelMountProps) {
    // Fire-and-forget — Svelte's mount is synchronous in production, but
    // the dynamic import is async. The Promise resolves before the user
    // can interact with the secrets panel in practice.
    void this.mountAsync(host, props);
  }

  private async mountAsync(
    host: HTMLElement,
    props: SecretsPanelMountProps,
  ): Promise<void> {
    const svelte = await import("svelte");
    const mod = await import("./secrets-panel.svelte");
    const SecretsPanel = (mod as { default: unknown }).default;
    this.unmountFn = svelte.unmount as unknown as (app: unknown) => Promise<void>;
    this.app = (svelte.mount as unknown as (
      c: unknown,
      o: { target: HTMLElement; props: Record<string, unknown> },
    ) => unknown)(SecretsPanel, {
      target: host,
      props: {
        store: props.secretsStore,
        safeStorage: props.safeStorage,
      },
    });
  }

  destroy(): void {
    if (this.app && this.unmountFn) {
      void this.unmountFn(this.app);
      this.app = null;
      this.unmountFn = null;
    }
  }
}
