/**
 * Phase 5 / D-10 — LLM ladder tests.
 *
 * Strategy: stub the McpServer's `.server.getClientCapabilities()` and
 * `.server.createMessage()` surfaces with `vi.fn()`. We never wire a
 * real MCP transport. The OllamaClient mock uses a `vi.fn()` for
 * `chat()` so we assert the request shape the ladder builds.
 */

import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OllamaClient } from "../ollama/client.js";
import type { BriefConfig } from "../types.js";
import {
  resolveLlmStrategy,
  compileWithLlm,
  BriefLlmUnavailableError,
  BriefLlmSamplingRefusedError,
} from "./llm-ladder.js";

/** Minimal McpServer stub — the ladder only reads `.server.{getClientCapabilities,createMessage}`. */
function makeServer(opts: {
  sampling?: boolean;
  createMessage?: (params: unknown) => Promise<unknown>;
}): McpServer {
  const getClientCapabilities = () => (opts.sampling ? { sampling: {} } : undefined);
  return {
    server: {
      getClientCapabilities,
      createMessage:
        opts.createMessage ??
        (async () => ({
          content: { type: "text", text: "fallback" },
          model: "claude-test",
          role: "assistant",
        })),
    },
  } as unknown as McpServer;
}

function makeOllama(chatImpl: (req: unknown) => Promise<unknown>): OllamaClient {
  return { chat: vi.fn(chatImpl) } as unknown as OllamaClient;
}

describe("resolveLlmStrategy (D-10 capability-first ladder)", () => {
  it("tier 1: returns {kind:'sampling'} when client advertises sampling capability", () => {
    const server = makeServer({ sampling: true });
    const strategy = resolveLlmStrategy(server, undefined, undefined);
    expect(strategy).toEqual({ kind: "sampling" });
  });

  it("tier 2: returns {kind:'ollama', model} when sampling absent but BriefConfig has ollama.model", () => {
    const server = makeServer({ sampling: false });
    const briefConfig: BriefConfig = { ollama: { model: "llama3.2" } };
    const strategy = resolveLlmStrategy(server, briefConfig, undefined);
    expect(strategy).toEqual({ kind: "ollama", model: "llama3.2" });
  });

  it("tier 3: returns {kind:'prepared_text'} when sampling+ollama absent and preparedText is non-empty", () => {
    const server = makeServer({ sampling: false });
    const strategy = resolveLlmStrategy(server, undefined, "caller body");
    expect(strategy).toEqual({ kind: "prepared_text" });
  });

  it("tier 4: returns {kind:'unavailable', attempted:[...]} when no tier resolves", () => {
    const server = makeServer({ sampling: false });
    const strategy = resolveLlmStrategy(server, undefined, undefined);
    expect(strategy).toEqual({
      kind: "unavailable",
      attempted: ["sampling", "ollama", "prepared_text"],
    });
  });

  it("tier 4: rejects empty-string preparedText (treats it as absent)", () => {
    const server = makeServer({ sampling: false });
    const strategy = resolveLlmStrategy(server, undefined, "");
    expect(strategy.kind).toBe("unavailable");
  });

  it("tier 4: rejects empty-string ollama.model (treats it as absent)", () => {
    const server = makeServer({ sampling: false });
    const briefConfig: BriefConfig = { ollama: { model: "" } };
    const strategy = resolveLlmStrategy(server, briefConfig, undefined);
    expect(strategy.kind).toBe("unavailable");
  });
});

describe("compileWithLlm dispatch", () => {
  const prompt = { systemText: "be brief", userText: "summarize X" };

  it("tier 1: calls server.server.createMessage and returns {body,model}", async () => {
    const createMessage = vi.fn(async () => ({
      content: { type: "text", text: "LLM body" },
      model: "claude-test",
      role: "assistant",
    }));
    const server = makeServer({ sampling: true, createMessage });
    const ollama = makeOllama(async () => {
      throw new Error("should not be called");
    });

    const res = await compileWithLlm(
      { kind: "sampling" },
      server,
      ollama,
      prompt,
      2000,
    );
    expect(res).toEqual({ body: "LLM body", model: "claude-test" });
    expect(createMessage).toHaveBeenCalledTimes(1);
    const params = createMessage.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: { type: string; text: string } }>;
      maxTokens: number;
      systemPrompt: string;
    };
    expect(params.maxTokens).toBe(2000);
    expect(params.systemPrompt).toBe("be brief");
    expect(params.messages[0]?.content.text).toBe("summarize X");
  });

  it("tier 1: throws on non-text content type (image/audio)", async () => {
    const createMessage = vi.fn(async () => ({
      content: { type: "image", data: "...", mimeType: "image/png" },
      model: "claude-test",
      role: "assistant",
    }));
    const server = makeServer({ sampling: true, createMessage });
    const ollama = makeOllama(async () => ({}));

    await expect(
      compileWithLlm({ kind: "sampling" }, server, ollama, prompt, 100),
    ).rejects.toThrow(/non-text content/);
  });

  it("tier 1: wraps createMessage throws into BriefLlmSamplingRefusedError", async () => {
    const createMessage = vi.fn(async () => {
      throw new Error("client refused");
    });
    const server = makeServer({ sampling: true, createMessage });
    const ollama = makeOllama(async () => ({}));

    await expect(
      compileWithLlm({ kind: "sampling" }, server, ollama, prompt, 100),
    ).rejects.toBeInstanceOf(BriefLlmSamplingRefusedError);
  });

  it("tier 2: calls ollama.chat with {system, user} messages and num_predict=maxTokens", async () => {
    const chat = vi.fn(async () => ({
      model: "llama3.2",
      message: { role: "assistant" as const, content: "Ollama body" },
    }));
    const server = makeServer({ sampling: false });
    const ollama = { chat } as unknown as OllamaClient;

    const res = await compileWithLlm(
      { kind: "ollama", model: "llama3.2" },
      server,
      ollama,
      prompt,
      512,
    );
    expect(res).toEqual({ body: "Ollama body", model: "llama3.2" });
    expect(chat).toHaveBeenCalledTimes(1);
    const req = chat.mock.calls[0]?.[0] as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      options?: { num_predict?: number };
    };
    expect(req.model).toBe("llama3.2");
    expect(req.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "summarize X" },
    ]);
    expect(req.options?.num_predict).toBe(512);
  });

  it("tier 3: stitches caller preparedText verbatim", async () => {
    const server = makeServer({ sampling: false });
    const ollama = makeOllama(async () => {
      throw new Error("should not be called");
    });

    const res = await compileWithLlm(
      { kind: "prepared_text" },
      server,
      ollama,
      prompt,
      100,
      "verbatim caller text",
    );
    expect(res).toEqual({ body: "verbatim caller text", model: "prepared_text" });
  });

  it("tier 4: throws BriefLlmUnavailableError with attempted array", async () => {
    const server = makeServer({ sampling: false });
    const ollama = makeOllama(async () => ({}));
    const attempted = ["sampling", "ollama", "prepared_text"];

    await expect(
      compileWithLlm({ kind: "unavailable", attempted }, server, ollama, prompt, 100),
    ).rejects.toMatchObject({
      name: "BriefLlmUnavailableError",
      attempted,
    });
  });
});
