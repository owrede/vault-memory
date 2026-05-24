/**
 * peer-mcp — Phase 7 / Plan 07-05 / D-PALETTE §Section 5.
 *
 * Fetches the dynamic palette section from the running vault-memory
 * server's MCP Resource `vault-memory://contract-verbs` (registered in
 * `src/server.ts` via `server.registerResource("contract-verbs", …)`,
 * Phase 6 / D-A2b).
 *
 * The resource envelope shape (see `src/contracts/resources.ts
 * §readListContractVerbs`):
 *
 *   {
 *     baseline: readonly string[],       // 11 baseline verbs — IGNORED here
 *     custom: Array<{
 *       verb: "mcp://server/tool",
 *       declared_in: "[contracts.mcp_clients.<server>]",
 *       used_by_contracts: string[],
 *       invocation_count: number,
 *       last_seen: number,
 *     }>
 *   }
 *
 * The plugin's palette renders only the `custom` (peer-MCP) entries in
 * its Section 5. Baseline + `literal` are surfaced via the static
 * `verb-list.ts` source so they remain available even when the MCP
 * resource is unreachable.
 *
 * # Graceful degradation
 *
 *   The peer-MCP section is empty when:
 *     - No `[contracts.mcp_clients.*]` are configured (custom = []),
 *     - The MCP resource is unreachable (CLI not on PATH, server died),
 *     - The envelope is malformed (JSON parse failure, missing `custom`).
 *
 *   In every failure mode the function returns `[]` rather than
 *   throwing — palette UX prefers a quietly-empty section over a noisy
 *   error banner. CLI-not-found is already surfaced globally by the
 *   plugin's onload Notice (see `plugin/main.ts`).
 *
 * # Adapter-seam discipline
 *
 *   Imports nothing concrete; accepts an injectable `ResourceClient`
 *   port. The plugin wires this against `VaultMemoryMcpClient` (which
 *   the watcher plan 07-07 extends with `readResource`); unit tests
 *   stub the port directly.
 */

/** Minimal Resource-reading surface — subset of `VaultMemoryMcpClient`. */
export interface ResourceClient {
  readResource(uri: string): Promise<{
    contents: Array<{ text: string; mimeType?: string }>;
  }>;
}

/** One peer-MCP verb suitable for palette rendering. */
export interface PeerMcpVerb {
  /** Full `mcp://server/tool` verb identifier. */
  verb: string;
  /** Owning server name (parsed from the URI authority component). */
  server: string;
  /** Optional human-readable description (none today; reserved). */
  description?: string;
}

/** Resource URI literal — referenced by the plan acceptance grep. */
const RESOURCE_URI = "vault-memory://contract-verbs";

/**
 * Read the `vault-memory://contract-verbs` MCP resource and return the
 * peer-MCP entries only. Filters out baseline verbs + `literal` since
 * those are surfaced via the static `verb-list.ts` source.
 *
 * Returns `[]` on any failure (missing resource, malformed envelope,
 * thrown error). Never throws.
 */
export async function fetchPeerMcpVerbs(
  client: ResourceClient,
): Promise<PeerMcpVerb[]> {
  let envelope: { contents?: Array<{ text?: string }> };
  try {
    envelope = await client.readResource(RESOURCE_URI);
  } catch {
    return [];
  }

  const firstContent = envelope?.contents?.[0];
  if (!firstContent || typeof firstContent.text !== "string") {
    return [];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(firstContent.text);
  } catch {
    return [];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const custom = (payload as { custom?: unknown }).custom;
  if (!Array.isArray(custom)) {
    return [];
  }

  const out: PeerMcpVerb[] = [];
  for (const entry of custom) {
    if (!entry || typeof entry !== "object") continue;
    const verb = (entry as { verb?: unknown }).verb;
    if (typeof verb !== "string") continue;
    // Defensive filter: never emit baseline / literal even if the server
    // accidentally returned them in `custom`. Peer-MCP verbs are always
    // `mcp://server/tool`.
    if (!verb.startsWith("mcp://")) continue;
    const match = verb.match(/^mcp:\/\/([a-z][a-z0-9_-]*)\//);
    if (!match || !match[1]) continue;
    // The server-side `ListContractVerbsResource` does not surface a
    // `description` today (the resource is derived from audit rows, not
    // from peer-server `tools/list` metadata). We forward-pluck the
    // field opportunistically so when the host server starts including
    // it (future enhancement), the palette tooltip lights up without
    // another plugin change.
    const rawDescription = (entry as { description?: unknown }).description;
    const description = typeof rawDescription === "string" && rawDescription.length > 0
      ? rawDescription
      : undefined;
    const verbObj: PeerMcpVerb = {
      verb,
      server: match[1],
    };
    if (description !== undefined) {
      verbObj.description = description;
    }
    out.push(verbObj);
  }
  return out;
}
