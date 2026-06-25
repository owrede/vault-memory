/**
 * `HandlerDeps` — the closure state captured by the inline `handlers`
 * object literal inside `serve()` (src/server.ts). Extracting the type
 * lets the per-domain handler factories (server/handlers/*.ts) take their
 * dependencies explicitly instead of closing over `serve()` locals.
 *
 * Field types are transcribed verbatim from the corresponding `serve()`
 * declarations — do not widen or invent.
 *
 * # Adapter-seam discipline
 *
 * Type-only module. Every import is `import type`; zero runtime imports,
 * so it trivially stays seam-clean (no node:path / node:fs / chokidar /
 * gray-matter).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultManager } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import type { Reranker } from "../rerank/index.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { SuppressionSet } from "../adapters/change-feed/obsidian-fs/index.js";
import type { MemorySinkRegistry } from "../memory/index.js";
import type { StartedContractRegistry, PeerMcpRegistry } from "../contracts/index.js";
import type { AppConfig } from "../types.js";

/**
 * A single MCP tool handler. Maps validated args to a JSON-serializable
 * result object. Verbatim from the local `type Handler` in `serve()`.
 */
export type Handler = (args: unknown) => Promise<object>;

/**
 * Dependencies captured by the `handlers` literal in `serve()`. Each
 * per-domain factory receives this and closes over `deps.<field>` instead
 * of the bare `serve()`-scope variable.
 */
export interface HandlerDeps {
  manager: VaultManager;
  ollama: OllamaClient;
  defaultModel: string;
  reranker: Reranker | undefined;
  adapterRegistry: AdapterRegistry;
  suppression: SuppressionSet;
  memorySinkRegistry: MemorySinkRegistry;
  server: McpServer;
  contractRegistries: Map<
    string,
    {
      started: StartedContractRegistry;
      registered: Map<string, RegisteredTool>;
    }
  >;
  peerMcpRegistry: PeerMcpRegistry;
  config: AppConfig;
  activeVault: string | undefined;
}
