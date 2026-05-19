/**
 * ReloadNotifier — Phase 7 / Plan 07-07 / CAN-08 / D-WATCH-SERVER-NOTIFY.
 *
 * Subscribes to the server's `vault-memory://contracts/reloaded` MCP
 * Resource notification and, when the notified path corresponds to an
 * open `.contract` editor view, surfaces an "External edit detected —
 * reload editor?" prompt to the user. The reload action re-reads the
 * YAML companion from disk and remounts the editor.
 *
 * # Why this exists (CAN-08 D-WATCH-SERVER-NOTIFY)
 *
 *   - Plan 07-05 wired the plugin to write a `.yaml` companion on every
 *     `.contract` save.
 *   - Plan 07-07 Task 1 closed the echo loop: the plugin SHA-256s the
 *     body, calls `suppress_contract_write`, then writes. The Phase 6
 *     ContractRegistry handler ignores the resulting filesystem event
 *     by hash equality.
 *   - This leaves ONE remaining case: the user edits the `.yaml` in
 *     another editor (or Syncthing pushes a remote edit) while the
 *     `.contract` is open in Obsidian. The hash will NOT match the
 *     plugin's last suppress entry, so the loader re-validates and
 *     fires `onExternalReload` → server emits this notification.
 *
 * # Lifecycle
 *
 *   - `new ReloadNotifier({...})` — constructs but does NOT subscribe.
 *   - `.start()` — subscribes; safe to call multiple times (re-subscribes).
 *   - `.stop()` — unsubscribes.
 *
 * # Path mapping
 *
 *   The server-side notification carries
 *     `_meta.path = "_contracts/<name>.yaml"`.
 *   The plugin's open `.contract` editor views are keyed by paths like
 *     "<name>.contract" (vault-relative, no `_contracts/` prefix).
 *   The notifier translates one to the other.
 *
 * # Adapter-seam discipline
 *
 *   No `fs`, `chokidar`, or path libraries. The notifier consumes a
 *   pre-built `openContractPaths: () => string[]` callback and a
 *   `promptReload: (path: string) => Promise<void>` callback. The
 *   plugin's `main.ts` (or a thin adapter alongside `view.ts`) supplies
 *   the production implementations — this module is pure logic, fully
 *   testable in vitest without spawning Obsidian.
 *
 * # No new file watchers (must_haves §"zero new file watchers")
 *
 *   `grep -rn "chokidar" plugin/` MUST return zero matches after this
 *   plan lands. The notifier observes existing MCP notifications; it
 *   never tails a file directly.
 */

import type { VaultMemoryMcpClient } from "./mcp-client.js";

/** URI carried by the server's `notifications/resources/updated` for CAN-08. */
const CONTRACTS_RELOADED_URI = "vault-memory://contracts/reloaded";

export interface ReloadNotifierOpts {
  /** The MCP client this notifier subscribes through. */
  mcpClient: VaultMemoryMcpClient;
  /**
   * Snapshot of currently open `.contract` editor paths
   * (vault-relative, e.g. `"meeting-prep.contract"`). Called once per
   * incoming notification — caller is responsible for keeping it cheap.
   */
  openContractPaths: () => string[];
  /**
   * Invoked when the notifier has determined that an external edit
   * affected an open `.contract` view. Production wires this to an
   * Obsidian Modal ("External edit detected — reload editor?"); on
   * "Reload", the handler re-fetches the YAML and remounts the editor.
   *
   * The first argument is the contract editor path (e.g.
   * `"meeting-prep.contract"`), NOT the YAML companion path.
   */
  promptReload: (contractPath: string) => Promise<void>;
}

export class ReloadNotifier {
  private readonly mcpClient: VaultMemoryMcpClient;
  private readonly openContractPaths: () => string[];
  private readonly promptReload: (contractPath: string) => Promise<void>;
  private unsubscribe: (() => void) | null = null;

  constructor(opts: ReloadNotifierOpts) {
    this.mcpClient = opts.mcpClient;
    this.openContractPaths = opts.openContractPaths;
    this.promptReload = opts.promptReload;
  }

  /**
   * Subscribe to `notifications/resources/updated` and route matching
   * notifications to the prompt. Safe to call when already started —
   * the prior subscription is replaced.
   */
  start(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.unsubscribe = this.mcpClient.onNotification(
      "notifications/resources/updated",
      (params) => {
        this.handleNotification(params);
      },
    );
  }

  /** Unsubscribe. Idempotent. */
  stop(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleNotification(params: unknown): void {
    if (params === null || typeof params !== "object") return;
    const p = params as Record<string, unknown>;

    // Filter by URI — other resource updates (e.g. stats panel) flow
    // through the same notification method.
    if (p["uri"] !== CONTRACTS_RELOADED_URI) return;

    const meta = p["_meta"];
    if (meta === null || typeof meta !== "object") return;
    const yamlPath = (meta as Record<string, unknown>)["path"];
    if (typeof yamlPath !== "string") return;

    // Translate `_contracts/<name>.yaml` → `<name>.contract`. The
    // editor view registers against the `.contract` path, NOT the
    // YAML companion path.
    const contractPath = yamlToContractPath(yamlPath);
    if (contractPath === null) return;

    // Only prompt when the user actually has this `.contract` open.
    const openPaths = this.openContractPaths();
    if (!openPaths.includes(contractPath)) return;

    // Fire-and-forget; the prompt handles its own errors.
    void this.promptReload(contractPath);
  }
}

/**
 * Map `_contracts/<name>.yaml` → `<name>.contract`. Returns null when
 * the input is not in the expected non-recursive shape (defensive: a
 * malformed notification payload should silently drop, not crash).
 */
export function yamlToContractPath(yamlPath: string): string | null {
  // Phase 6 Pitfall F3 alignment: non-recursive `_contracts/` directory.
  const match = /^_contracts\/([^/]+)\.yaml$/.exec(yamlPath);
  if (match === null) return null;
  return `${match[1]}.contract`;
}
