/**
 * Phase 5 / D-10 — Capability-first LLM ladder for `compile_brief`.
 *
 * Resolves which LLM strategy a given `compile_brief` call should use,
 * in priority order:
 *
 *   1. MCP Sampling — `server.server.getClientCapabilities().sampling`
 *      is present (host MCP client supports `sampling/create_message`).
 *   2. Local Ollama — `[brief.ollama] model = "..."` is set in
 *      `config.toml` (the per-server `BriefConfig` block).
 *   3. Caller-supplied `prepared_text` — vault-memory stitches the
 *      caller's verbatim text into the brief body.
 *   4. Structured error — `BriefLlmUnavailableError` carrying the
 *      `attempted` array. The controller (`handleCompileBrief`)
 *      translates this to `{ok: false, reason: "no_llm_strategy_available",
 *      attempted, hint}` so the caller can choose its recovery path
 *      (configure Ollama, switch to a sampling-capable client, or pass
 *      prepared_text).
 *
 * `compileWithLlm` dispatches the resolved strategy and returns
 * `{body, model}`. MCP Sampling result content is a single discriminated
 * union block; we reject anything other than `type === "text"`.
 *
 * # Why server-level (not per-vault) Ollama config
 *
 * Slice 1 (Plan 05-01) added the `[brief]` block onto `AppConfig`, not
 * `VaultConfig`. The brief subsystem is a single LLM ladder shared by
 * all vaults the server hosts; per-vault Ollama config would let one
 * vault's brief compile bypass the server's licensed local LLM endpoint
 * without an obvious audit point. The ladder therefore consumes
 * `briefConfig?: BriefConfig` from `AppConfig`, threaded through the
 * controller's `Deps`.
 *
 * Pure module. No fs / gray-matter / chokidar / path imports.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateMessageResult,
  CreateMessageResultWithTools,
} from "@modelcontextprotocol/sdk/types.js";
import type { BriefConfig } from "../types.js";
import type { OllamaClient } from "../ollama/client.js";

/**
 * Discriminated union returned by `resolveLlmStrategy`. The shape lets
 * `compileWithLlm` switch-dispatch without re-checking capabilities.
 */
export type LlmStrategy =
  | { kind: "sampling" }
  | { kind: "ollama"; model: string }
  | { kind: "prepared_text" }
  | { kind: "unavailable"; attempted: string[] };

/**
 * Structured error emitted when no ladder tier resolves. The controller
 * catches this and translates to the `no_llm_strategy_available` MCP
 * tool error envelope.
 */
export class BriefLlmUnavailableError extends Error {
  public readonly attempted: string[];
  constructor(attempted: string[]) {
    super(`LLM unavailable; attempted: ${attempted.join(", ")}`);
    this.name = "BriefLlmUnavailableError";
    this.attempted = attempted;
  }
}

/**
 * Translated when the MCP Sampling client refuses (throws). The
 * controller maps this to `{ok: false, reason: "sampling_refused"}`.
 * Kept distinct from `BriefLlmUnavailableError` so callers can branch
 * on it (refusal → retry later; unavailable → reconfigure).
 */
export class BriefLlmSamplingRefusedError extends Error {
  public override readonly cause: unknown;
  constructor(cause: unknown) {
    super("MCP Sampling refused");
    this.name = "BriefLlmSamplingRefusedError";
    this.cause = cause;
  }
}

/**
 * Capability-first ladder resolution.
 *
 * `server` is the high-level `McpServer` (we read `.server.getClientCapabilities()`);
 * the test fixtures stand up a minimal stub of the same shape.
 *
 * `briefConfig` is the server-level `[brief]` block from `AppConfig`.
 * Undefined / missing `ollama.model` means tier 2 skips.
 */
export function resolveLlmStrategy(
  server: McpServer,
  briefConfig: BriefConfig | undefined,
  preparedText: string | undefined,
): LlmStrategy {
  const attempted: string[] = [];

  // Tier 1: MCP Sampling capability — populated after the MCP initialize
  // handshake. Server bootstrap ordering guarantees compile_brief calls
  // always run post-handshake, so this read is safe.
  const caps = server.server.getClientCapabilities();
  if (caps?.sampling) {
    return { kind: "sampling" };
  }
  attempted.push("sampling");

  // Tier 2: per-server Ollama config (`[brief.ollama] model = "..."`).
  const ollamaModel = briefConfig?.ollama?.model;
  if (typeof ollamaModel === "string" && ollamaModel.length > 0) {
    return { kind: "ollama", model: ollamaModel };
  }
  attempted.push("ollama");

  // Tier 3: caller-supplied prepared_text.
  if (typeof preparedText === "string" && preparedText.length > 0) {
    return { kind: "prepared_text" };
  }
  attempted.push("prepared_text");

  // Tier 4: structured error — `BriefLlmUnavailableError` at dispatch.
  return { kind: "unavailable", attempted };
}

/**
 * Tier dispatch. Returns the raw LLM body plus a `model` identifier
 * for audit-trail attribution. The body still needs to pass the D-11
 * `BriefBodyValidator` before delivery.write.
 *
 * Tier 1 wraps `server.server.createMessage` throws into
 * `BriefLlmSamplingRefusedError`; tier 2 lets `OllamaClient` errors
 * percolate (the controller wraps in try/catch and returns the
 * underlying error semantics unchanged).
 */
export async function compileWithLlm(
  strategy: LlmStrategy,
  server: McpServer,
  ollama: OllamaClient,
  prompt: { systemText: string; userText: string },
  maxTokens: number,
  preparedText?: string,
): Promise<{ body: string; model: string }> {
  switch (strategy.kind) {
    case "sampling": {
      let result: CreateMessageResult | CreateMessageResultWithTools;
      try {
        result = await server.server.createMessage({
          messages: [
            {
              role: "user",
              content: { type: "text", text: prompt.userText },
            },
          ],
          maxTokens,
          systemPrompt: prompt.systemText,
        });
      } catch (err) {
        throw new BriefLlmSamplingRefusedError(err);
      }
      // `CreateMessageResult.content` is a single discriminated block;
      // the brief compile path only handles text. (The tool-enabled
      // overload returns an array, but we never pass `tools`.)
      const content = (result as CreateMessageResult).content;
      if (content === undefined || Array.isArray(content) || content.type !== "text") {
        const got =
          content === undefined ? "undefined" : Array.isArray(content) ? "array" : content.type;
        throw new Error(
          `MCP Sampling returned non-text content (type=${got}); brief compile expects text.`,
        );
      }
      return { body: content.text, model: result.model };
    }
    case "ollama": {
      const res = await ollama.chat({
        model: strategy.model,
        messages: [
          { role: "system", content: prompt.systemText },
          { role: "user", content: prompt.userText },
        ],
        options: { num_predict: maxTokens },
      });
      return { body: res.message.content, model: strategy.model };
    }
    case "prepared_text": {
      // Caller's text is stitched verbatim. The controller already
      // verified `preparedText` is a non-empty string in
      // `resolveLlmStrategy`; we re-check defensively here so a
      // misuse (calling compileWithLlm with kind:"prepared_text"
      // but no text) surfaces loudly instead of writing an empty body.
      if (typeof preparedText !== "string" || preparedText.length === 0) {
        throw new Error(
          "compileWithLlm(prepared_text) called without a non-empty preparedText string",
        );
      }
      return { body: preparedText, model: "prepared_text" };
    }
    case "unavailable": {
      throw new BriefLlmUnavailableError(strategy.attempted);
    }
  }
}
