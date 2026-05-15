/**
 * StubChangeFeed — EventEmitter-backed ChangeFeed for the conformance
 * suite (plan 01-05 task 03).
 *
 * No filesystem, no chokidar. The stub is the FLOOR — the conformance
 * suite proves the contract; adapter-specific assertions (suppression
 * integration, chokidar config preservation) live in the obsidian-fs
 * adapter's co-located test.
 *
 * Capabilities published HONESTLY per Invariant I-7:
 *   - watch:        "push" — events fire synchronously on `emit()`
 *   - emitsRename:  true   — stub trivially supports rename emission
 *
 * # Test-only API
 *
 * `emit(event)` is NOT part of the ChangeFeed interface. It is the
 * back-door that lets the conformance suite drive synthetic events
 * deterministically. Real adapters (obsidian-fs, future notion-api)
 * never expose it.
 */

import { EventEmitter } from "node:events";
import type { ChangeEvent, SourceHandle } from "../../types.js";
import type { ChangeFeed, ChangeFeedCapabilities, Disposable } from "../change-feed/types.js";
import { parseSourceHandle } from "../registry.js";

export class StubChangeFeed implements ChangeFeed {
  readonly handle: SourceHandle = parseSourceHandle("stub://memory");

  readonly capabilities: ChangeFeedCapabilities = {
    watch: "push",
    emitsRename: true,
  };

  private readonly emitter = new EventEmitter();
  private closed = false;

  subscribe(handler: (e: ChangeEvent) => void | Promise<void>): Disposable {
    if (this.closed) {
      return { [Symbol.dispose]: () => void 0 };
    }
    const listener = (e: ChangeEvent): void => {
      try {
        const result = handler(e);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch(() => {
            // swallow — handler errors must not crash the feed
          });
        }
      } catch {
        // swallow — handler errors must not crash the feed
      }
    };
    this.emitter.on("change", listener);
    return {
      [Symbol.dispose]: () => {
        this.emitter.off("change", listener);
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) return; // idempotent
    this.closed = true;
    this.emitter.removeAllListeners();
  }

  /**
   * Test-only — drives synthetic events through the feed. NOT part of
   * the `ChangeFeed` contract; do not call from production code.
   */
  emit(event: ChangeEvent): void {
    if (this.closed) return;
    this.emitter.emit("change", event);
  }
}
