/**
 * callMcpVerb — Phase 6 / D-A2a peer-MCP extension / Q-TIMEOUT.
 *
 * Parses `mcp://<server>/<tool>` syntax, looks the client up in the
 * `PeerMcpRegistry`, forwards the args, and wraps the call in
 * `Promise.race([call, timeout(step_timeout_seconds * 1000)])` so a
 * hung peer cannot block contract instantiation indefinitely.
 *
 * # Q-TIMEOUT scope (ADR-006 §Decision 11)
 *
 *   ONLY peer-MCP verbs are wrapped here. Baseline verbs route directly
 *   through their handlers in `verbs/index.ts` without the race — they
 *   use their own timeout discipline (SQLite query timeout, Ollama HTTP
 *   timeout). Wrapping baseline verbs adds latency overhead for no
 *   benefit.
 *
 * # Failure envelopes (ADR-006 §Decision 7, sealed for v2.0.0)
 *
 *   - `{ok:false, reason:'verb_not_available', verb}` — regex rejected
 *     the verb shape (defense in depth; Plan 06-01's Zod gate already
 *     rejects malformed verbs at contract load time).
 *   - `{ok:false, reason:'mcp_client_unavailable', verb, client_name}` —
 *     the server name has no registered client OR the boot connect
 *     failed.
 *   - `{ok:false, reason:'assembly_step_failed', step_alias, cause}` —
 *     either a timeout (`cause: 'timeout'`) or the underlying call
 *     threw (`cause: <error message>`).
 *
 * # Adapter-seam discipline
 *
 *   Zero `fs` / `path` / `gray-matter` / `chokidar` imports.
 */

import type { PeerMcpRegistry } from "../mcp-clients.js";

/** Same shape as `verbDispatcher`'s `opts` so callers can pass through. */
export interface VerbDispatchOpts {
  stepAlias: string;
  timeoutSeconds: number;
}

/**
 * `mcp://<server>/<tool>` — both segments must be `[a-z][a-z0-9_-]*`.
 * Mirrors the Zod regex used by the contract loader (Plan 06-01
 * `schema.ts`). Pinned here so defense-in-depth dispatch rejects the
 * same shapes the loader rejects.
 */
const MCP_VERB_RE = /^mcp:\/\/([a-z][a-z0-9_-]*)\/([a-z][a-z0-9_-]*)$/;

export async function callMcpVerb(
  verb: string,
  args: Record<string, unknown>,
  registry: PeerMcpRegistry,
  opts: VerbDispatchOpts,
): Promise<unknown> {
  const match = MCP_VERB_RE.exec(verb);
  if (!match) {
    return { ok: false, reason: "verb_not_available", verb };
  }
  const serverName = match[1]!;
  const toolName = match[2]!;
  const client = registry.get(serverName);
  if (!client || !client.available) {
    return {
      ok: false,
      reason: "mcp_client_unavailable",
      verb,
      client_name: serverName,
    };
  }
  // Q-TIMEOUT: wrap ONLY peer-MCP verbs.
  const timeoutMs = Math.max(1, Math.floor(opts.timeoutSeconds * 1000));
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    return await Promise.race([client.callTool(toolName, args), timeoutPromise]);
  } catch (err) {
    const cause =
      err instanceof Error && err.message === "timeout"
        ? "timeout"
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      ok: false,
      reason: "assembly_step_failed",
      step_alias: opts.stepAlias,
      cause,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
