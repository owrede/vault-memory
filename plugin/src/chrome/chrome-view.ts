/**
 * ChromeView — single workspace leaf hosting the Reindex + Stats panels.
 *
 * Phase 7 / 07-09 / PLG-03 + PLG-04 / ADR-007 §D-CHROME-REINDEX +
 * §D-CHROME-STATS.
 *
 * Pattern: `ItemView` subclass (matches Obsidian's convention for
 * side-panel surfaces — sidebars are reserved for content navigation;
 * the Operations + Stats surface is plugin chrome, opened on demand via
 * a command). Two stacked sections separated by `var(--size-4-6)` per
 * UI-SPEC §"Side-panel layout".
 *
 * # onOpen() lifecycle
 *
 *   1. Clear contentEl (Obsidian may call onOpen multiple times across
 *      view re-init cycles).
 *   2. Append the `vm-chrome-view` host div + two section headings.
 *   3. Mount `ReindexPanel` and `StatsPanel` Svelte components into
 *      their respective slots; pass `mcpClient` + `activeVault` props.
 *
 * # onClose() lifecycle
 *
 *   - Unmount both Svelte trees so subscription cleanup runs
 *     (`onDestroy` in the panels triggers `controller.subscribe`
 *     unsubscribers).
 *
 * # Memory namespace invariant (PROJECT.md "Core Value")
 *
 * The chrome view is read-only on the user's vault — it never calls
 * `app.vault.adapter.write` directly. The reindex panel triggers a
 * server-side reindex via MCP, which has its own DeliveryAdapter
 * (memory-sink) discipline. The stats panel only reads via MCP.
 */

import { ItemView, type WorkspaceLeaf } from "obsidian";

// Svelte runtime + components are loaded lazily inside `onOpen` so the
// module surface (`VIEW_TYPE_CHROME`, `composeChromePanels`,
// `ChromeView` metadata) can be imported by unit tests without
// dragging in the svelte runtime — which is not available in the test
// environment. The mock obsidian module mirrors this lazy-import
// discipline.
type MountFn = (cmp: unknown, opts: { target: unknown; props: unknown }) => unknown;
type UnmountFn = (instance: unknown) => unknown;

export const VIEW_TYPE_CHROME = "vault-memory-chrome";

/**
 * Minimal plugin surface ChromeView depends on. Real callers pass the
 * `VaultMemoryPlugin` instance from `plugin/main.ts`; tests pass a fake
 * conforming to this interface. Defined here (not imported from
 * `main.ts`) to avoid a cycle (`main.ts` → ChromeView → main.ts) and to
 * make composeChromePanels stand-alone unit-testable.
 */
export interface ChromeViewPlugin {
  mcpClient: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    onProgress: (
      token: string,
      handler: (progress: number, total: number | undefined) => void,
    ) => () => void;
  };
  settingsStore: {
    get: (key: "defaultVault") => string | null;
  };
}

/**
 * Spec returned by `composeChromePanels` — declarative description of
 * what onOpen will mount. Pulled out so the panel composition can be
 * unit-tested without touching Svelte's `mount()` (which needs a DOM).
 */
export interface ChromePanelsSpec {
  panels: ReadonlyArray<{
    kind: "reindex" | "stats";
    props: {
      mcpClient: ChromeViewPlugin["mcpClient"];
      activeVault: string | null;
    };
  }>;
}

/**
 * Pure-logic helper: returns the declarative spec for what ChromeView
 * mounts. ChromeView.onOpen consumes this to wire up the actual Svelte
 * mounts; tests inspect the spec directly.
 */
export function composeChromePanels(plugin: ChromeViewPlugin): ChromePanelsSpec {
  const activeVault = plugin.settingsStore.get("defaultVault");
  const sharedProps = {
    mcpClient: plugin.mcpClient,
    activeVault,
  };
  return {
    panels: [
      { kind: "reindex", props: sharedProps },
      { kind: "stats", props: sharedProps },
    ],
  };
}

export class ChromeView extends ItemView {
  private reindexApp: unknown = null;
  private statsApp: unknown = null;
  private mount: MountFn | null = null;
  private unmountFn: UnmountFn | null = null;
  readonly plugin: ChromeViewPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ChromeViewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  override getViewType(): string {
    return VIEW_TYPE_CHROME;
  }

  override getDisplayText(): string {
    return "vault-memory";
  }

  override getIcon(): string {
    return "activity";
  }

  override async onOpen(): Promise<void> {
    await this.disposeSvelte();
    const root = this.contentEl;
    if (!root || typeof (root as { empty?: () => void }).empty !== "function") {
      // No DOM in test environment — onOpen is callable but a no-op.
      return;
    }
    (root as { empty: () => void }).empty();
    (root as HTMLElement).addClass?.("vm-chrome-view");

    // Lazy-import svelte + the panel components only when we actually
    // mount. Falls back to a no-op in environments where either is
    // unresolvable (test environment, server-side rendering).
    if (!this.mount || !this.unmountFn) {
      try {
        const svelteMod = (await import("svelte")) as {
          mount: MountFn;
          unmount: UnmountFn;
        };
        this.mount = svelteMod.mount;
        this.unmountFn = svelteMod.unmount;
      } catch {
        return;
      }
    }

    let ReindexPanel: unknown;
    let StatsPanel: unknown;
    try {
      ReindexPanel = ((await import("./reindex-panel.svelte")) as { default: unknown }).default;
      StatsPanel = ((await import("./stats-panel.svelte")) as { default: unknown }).default;
    } catch {
      return;
    }

    const spec = composeChromePanels(this.plugin);

    // Section 1: Operations (Reindex)
    (root as HTMLElement).createEl("h3", {
      text: "Operations",
      cls: "vm-chrome-view__section-heading",
    });
    const reindexSlot = (root as HTMLElement).createDiv({
      cls: "vm-chrome-view__slot vm-chrome-view__slot--reindex",
    });
    this.reindexApp = this.mount(ReindexPanel, {
      target: reindexSlot,
      props: spec.panels[0]!.props,
    });

    // Section 2: Stats
    (root as HTMLElement).createEl("h3", {
      text: "Stats",
      cls: "vm-chrome-view__section-heading",
    });
    const statsSlot = (root as HTMLElement).createDiv({
      cls: "vm-chrome-view__slot vm-chrome-view__slot--stats",
    });
    this.statsApp = this.mount(StatsPanel, {
      target: statsSlot,
      props: spec.panels[1]!.props,
    });
  }

  override async onClose(): Promise<void> {
    await this.disposeSvelte();
  }

  private async disposeSvelte(): Promise<void> {
    if (this.reindexApp && this.unmountFn) {
      try {
        await this.unmountFn(this.reindexApp);
      } catch {
        // Best-effort
      }
      this.reindexApp = null;
    }
    if (this.statsApp && this.unmountFn) {
      try {
        await this.unmountFn(this.statsApp);
      } catch {
        // Best-effort
      }
      this.statsApp = null;
    }
  }
}
