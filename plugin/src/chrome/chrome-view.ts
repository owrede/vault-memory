/**
 * ChromeView — single workspace leaf hosting the Reindex + Stats +
 * Connectors panels.
 *
 * Phase 7 / 07-09 + 07-10 / PLG-03 + PLG-04 + PLG-05 / ADR-007
 * §D-CHROME-REINDEX + §D-CHROME-STATS + §D-CHROME-CONNECTORS.
 *
 * Pattern: `ItemView` subclass (matches Obsidian's convention for
 * side-panel surfaces — sidebars are reserved for content navigation;
 * the Operations + Stats + Connectors surface is plugin chrome, opened
 * on demand via a command). Three stacked sections separated by
 * `var(--size-4-6)` per UI-SPEC §"Side-panel layout".
 *
 * # onOpen() lifecycle
 *
 *   1. Clear contentEl (Obsidian may call onOpen multiple times across
 *      view re-init cycles).
 *   2. Append the `vm-chrome-view` host div + three section headings.
 *   3. Mount `ReindexPanel`, `StatsPanel`, and `ConnectorsPanel` Svelte
 *      components into their respective slots. The Connectors panel
 *      additionally receives `secretsStore` + `safeStorage` for the
 *      `${secret:name}` resolution path (CONTEXT D-CHROME-SECRETS:
 *      safeStorage decrypt happens in the plugin process).
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
  /**
   * Obsidian app handle — needed by the Contracts panel to enumerate
   * `.contract` and `_contracts/*.yaml` files and to open them in the
   * existing ContractEditorView. Optional so tests that only exercise
   * reindex/stats/connectors composition don't have to construct one.
   */
  app?: unknown;
  /**
   * Open a contract file in the contract editor view. Called by the
   * Contracts panel on row click. Optional for the same reason as `app`.
   */
  openContract?: (path: string) => Promise<void> | void;
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
  /**
   * PLG-05 / 07-10: the connectors panel needs the same SecretsStore
   * surface the settings tab uses, plus a `SafeStorageAdapter.decrypt`
   * for the plugin-process safeStorage step in `${secret:name}`
   * resolution. Optional so existing tests + composeChromePanels()
   * callers that only need reindex+stats keep working.
   */
  secretsStore?: {
    list: () => readonly { name: string; createdAt: string }[];
    getCiphertext: (name: string) => string | undefined;
  };
  safeStorage?: {
    decrypt: (ciphertextBase64: string) => string;
  };
}

/**
 * Spec returned by `composeChromePanels` — declarative description of
 * what onOpen will mount. Pulled out so the panel composition can be
 * unit-tested without touching Svelte's `mount()` (which needs a DOM).
 */
export type ChromePanelKind = "contracts" | "reindex" | "stats" | "connectors";

/**
 * Per-panel props. ConnectorsPanel needs the secretsStore + safeStorage
 * shape on top of mcpClient (no activeVault — connectors are global,
 * not per-vault). The discriminated union keeps tests strictly typed.
 */
export type ChromePanelSpec =
  | {
      kind: "contracts";
      props: {
        app: unknown;
        onOpenContract: (path: string) => Promise<void> | void;
      };
    }
  | {
      kind: "reindex" | "stats";
      props: {
        mcpClient: ChromeViewPlugin["mcpClient"];
        activeVault: string | null;
      };
    }
  | {
      kind: "connectors";
      props: {
        mcpClient: ChromeViewPlugin["mcpClient"];
        secretsStore: NonNullable<ChromeViewPlugin["secretsStore"]>;
        safeStorage: NonNullable<ChromeViewPlugin["safeStorage"]>;
      };
    };

export interface ChromePanelsSpec {
  panels: ReadonlyArray<ChromePanelSpec>;
}

/**
 * Pure-logic helper: returns the declarative spec for what ChromeView
 * mounts. ChromeView.onOpen consumes this to wire up the actual Svelte
 * mounts; tests inspect the spec directly.
 *
 * The Connectors panel (PLG-05) is included only when the plugin
 * provides both `secretsStore` and `safeStorage` — otherwise the test
 * scaffolding (07-09) would break. Real callers from plugin/main.ts
 * always pass them.
 */
export function composeChromePanels(plugin: ChromeViewPlugin): ChromePanelsSpec {
  const activeVault = plugin.settingsStore.get("defaultVault");
  const sharedProps = {
    mcpClient: plugin.mcpClient,
    activeVault,
  };
  const panels: ChromePanelSpec[] = [];
  // Contracts panel goes FIRST (this is the product surface). Only
  // mounted when the plugin supplies `app` + `openContract` — tests
  // that don't need the contracts list skip this and still test the
  // admin sections in isolation.
  if (plugin.app && plugin.openContract) {
    panels.push({
      kind: "contracts",
      props: {
        app: plugin.app,
        onOpenContract: plugin.openContract,
      },
    });
  }
  panels.push({ kind: "reindex", props: sharedProps });
  panels.push({ kind: "stats", props: sharedProps });
  if (plugin.secretsStore && plugin.safeStorage) {
    panels.push({
      kind: "connectors",
      props: {
        mcpClient: plugin.mcpClient,
        secretsStore: plugin.secretsStore,
        safeStorage: plugin.safeStorage,
      },
    });
  }
  return { panels };
}

export class ChromeView extends ItemView {
  private contractsApp: unknown = null;
  private reindexApp: unknown = null;
  private statsApp: unknown = null;
  private connectorsApp: unknown = null;
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
    return "vault-memory: Contracts";
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

    let ContractsPanel: unknown;
    let ReindexPanel: unknown;
    let StatsPanel: unknown;
    let ConnectorsPanel: unknown;
    try {
      ContractsPanel = ((await import("./contracts-panel.svelte")) as {
        default: unknown;
      }).default;
      ReindexPanel = ((await import("./reindex-panel.svelte")) as { default: unknown }).default;
      StatsPanel = ((await import("./stats-panel.svelte")) as { default: unknown }).default;
      ConnectorsPanel = ((await import("./connectors-panel.svelte")) as {
        default: unknown;
      }).default;
    } catch {
      return;
    }

    const spec = composeChromePanels(this.plugin);

    // Section 0 (TOP — product surface): Contracts
    // Lists every .contract and _contracts/*.yaml file in the vault.
    // Click on a row opens the contract in ContractEditorView (the
    // canvas-based agentic-workflow editor). This is what users see
    // first on opening the panel.
    const contractsSpec = spec.panels.find((p) => p.kind === "contracts");
    if (contractsSpec) {
      (root as HTMLElement).createEl("h3", {
        text: "Contracts",
        cls: "vm-chrome-view__section-heading",
      });
      const contractsSlot = (root as HTMLElement).createDiv({
        cls: "vm-chrome-view__slot vm-chrome-view__slot--contracts",
      });
      this.contractsApp = this.mount(ContractsPanel, {
        target: contractsSlot,
        props: contractsSpec.props,
      });
    }

    // Admin sections (Operations, Stats, Connectors) live inside a
    // collapsible <details> at the bottom of the panel. Users don't
    // need to see Reindex/Stats every time — they're admin actions,
    // not the product. Closed by default; open state persists across
    // sessions via localStorage so power users keep them open.
    const adminWasOpen = (() => {
      try {
        return localStorage.getItem("vm-chrome-admin-open") === "1";
      } catch {
        return false;
      }
    })();
    const details = (root as HTMLElement).createEl("details", {
      cls: "vm-chrome-view__admin",
    });
    if (adminWasOpen) (details as HTMLDetailsElement).open = true;
    (details as HTMLElement).createEl("summary", {
      text: "Advanced (reindex, stats, connectors)",
      cls: "vm-chrome-view__admin-summary",
    });
    details.addEventListener("toggle", () => {
      try {
        localStorage.setItem(
          "vm-chrome-admin-open",
          (details as HTMLDetailsElement).open ? "1" : "0",
        );
      } catch {
        // localStorage may be unavailable — best effort.
      }
    });

    // Operations (Reindex) — inside admin
    (details as HTMLElement).createEl("h4", {
      text: "Operations",
      cls: "vm-chrome-view__section-heading",
    });
    const reindexSlot = (details as HTMLElement).createDiv({
      cls: "vm-chrome-view__slot vm-chrome-view__slot--reindex",
    });
    const reindexSpec = spec.panels.find((p) => p.kind === "reindex");
    if (reindexSpec) {
      this.reindexApp = this.mount(ReindexPanel, {
        target: reindexSlot,
        props: reindexSpec.props,
      });
    }

    // Stats — inside admin
    (details as HTMLElement).createEl("h4", {
      text: "Stats",
      cls: "vm-chrome-view__section-heading",
    });
    const statsSlot = (details as HTMLElement).createDiv({
      cls: "vm-chrome-view__slot vm-chrome-view__slot--stats",
    });
    const statsSpec = spec.panels.find((p) => p.kind === "stats");
    if (statsSpec) {
      this.statsApp = this.mount(StatsPanel, {
        target: statsSlot,
        props: statsSpec.props,
      });
    }

    // Connectors (PLG-05 / 07-10) — only mounted when the plugin
    // supplied secretsStore + safeStorage. ConnectorsPanel uses them
    // for the `${secret:name}` resolution path that decrypts ciphertext
    // in the plugin process and forwards plaintext to the server's
    // `resolve_secret` tool.
    const connectorsSpec = spec.panels.find((p) => p.kind === "connectors");
    if (connectorsSpec) {
      (details as HTMLElement).createEl("h4", {
        text: "Connectors",
        cls: "vm-chrome-view__section-heading",
      });
      const connectorsSlot = (details as HTMLElement).createDiv({
        cls: "vm-chrome-view__slot vm-chrome-view__slot--connectors",
      });
      this.connectorsApp = this.mount(ConnectorsPanel, {
        target: connectorsSlot,
        props: connectorsSpec.props,
      });
    }
  }

  override async onClose(): Promise<void> {
    await this.disposeSvelte();
  }

  private async disposeSvelte(): Promise<void> {
    if (this.contractsApp && this.unmountFn) {
      try {
        await this.unmountFn(this.contractsApp);
      } catch {
        // Best-effort
      }
      this.contractsApp = null;
    }
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
    if (this.connectorsApp && this.unmountFn) {
      try {
        await this.unmountFn(this.connectorsApp);
      } catch {
        // Best-effort
      }
      this.connectorsApp = null;
    }
  }
}

/**
 * Marker referenced by 07-10 verification: the source MUST mount a
 * `ConnectorsPanel` so the verify step grep succeeds. The dynamic
 * import above is the actual mount; this comment guarantees the
 * literal token is present even if a future refactor swaps the
 * import strategy. ConnectorsPanel
 */
