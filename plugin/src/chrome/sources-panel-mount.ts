/**
 * SourcesPanelMount — bridges the Obsidian settings tab (plain DOM) to
 * the Svelte sources-panel component.
 *
 * Spec: .planning/specs/SOURCES-REGISTRY.md (Phase B scaffold).
 *
 * Same lifecycle pattern as SecretsPanelMount.
 */

import type { EnabledToolsPort, SourcesControllerDeps } from "./sources-controller.js";

export interface SourcesPanelMountProps {
  mcpClient: SourcesControllerDeps["mcpClient"];
  enabledTools: EnabledToolsPort;
  vaultName: string;
}

export class SourcesPanelMount {
  private app: unknown = null;
  private unmountFn: ((app: unknown) => Promise<void>) | null = null;

  constructor(host: HTMLElement, props: SourcesPanelMountProps) {
    void this.mountAsync(host, props);
  }

  private async mountAsync(
    host: HTMLElement,
    props: SourcesPanelMountProps,
  ): Promise<void> {
    const svelte = await import("svelte");
    const mod = await import("./sources-panel.svelte");
    const SourcesPanel = (mod as { default: unknown }).default;
    this.unmountFn = svelte.unmount as unknown as (app: unknown) => Promise<void>;
    this.app = (svelte.mount as unknown as (
      c: unknown,
      o: { target: HTMLElement; props: Record<string, unknown> },
    ) => unknown)(SourcesPanel, {
      target: host,
      props: {
        mcpClient: props.mcpClient,
        enabledTools: props.enabledTools,
        vaultName: props.vaultName,
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
