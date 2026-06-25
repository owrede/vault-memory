/**
 * Unit tests for `set_mcp_client` MCP tool (PLG-05).
 *
 * Discriminated-union input:
 *   Variant A (add/update): {name, command?, args?, env_secrets?}
 *   Variant B (remove):     {name, remove: true}
 *   Variant C (list):       {list: true}
 *
 * Variant A/B mutate `[contracts.mcp_clients]` in a config.toml file;
 * Variant C reads it (no mutation). All three variants are idempotent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { setMcpClientTool } from "./set-mcp-client.js";

describe("set_mcp_client tool (PLG-05)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vm-mcp-client-"));
    configPath = join(tmpDir, "config.toml");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("declares the expected MCP tool surface", () => {
    expect(setMcpClientTool.name).toBe("set_mcp_client");
    expect(typeof setMcpClientTool.description).toBe("string");
    expect(setMcpClientTool.inputSchema).toBeDefined();
  });

  it("Variant A (add): creates a new [contracts.mcp_clients.<name>] block", async () => {
    await writeFile(configPath, "[[vaults]]\nname = 'atlas'\npath = '/v'\n", "utf-8");

    const result = await setMcpClientTool.handler(
      {
        name: "gh",
        command: "gh-mcp-server",
        args: ["--config", "/p"],
      },
      { configPath },
    );
    expect(result).toEqual({ ok: true, name: "gh", action: "added" });

    const after = parseToml(await readFile(configPath, "utf-8")) as {
      contracts?: { mcp_clients?: Record<string, unknown> };
    };
    expect(after.contracts?.mcp_clients?.gh).toEqual({
      command: "gh-mcp-server",
      args: ["--config", "/p"],
    });
  });

  it("Variant A (update): rewrites an existing entry idempotently", async () => {
    await writeFile(
      configPath,
      ["[contracts.mcp_clients.gh]", "command = 'old-cmd'", "args = ['--old']"].join("\n") + "\n",
      "utf-8",
    );

    const result = await setMcpClientTool.handler(
      { name: "gh", command: "new-cmd", args: ["--new"] },
      { configPath },
    );
    expect(result).toEqual({ ok: true, name: "gh", action: "updated" });

    const after = parseToml(await readFile(configPath, "utf-8")) as {
      contracts?: { mcp_clients?: Record<string, { command: string; args: string[] }> };
    };
    expect(after.contracts?.mcp_clients?.gh?.command).toBe("new-cmd");
    expect(after.contracts?.mcp_clients?.gh?.args).toEqual(["--new"]);
  });

  it("Variant B (remove): deletes the [contracts.mcp_clients.<name>] block; idempotent", async () => {
    await writeFile(
      configPath,
      ["[contracts.mcp_clients.gh]", "command = 'gh-mcp-server'"].join("\n") + "\n",
      "utf-8",
    );

    const first = await setMcpClientTool.handler({ name: "gh", remove: true }, { configPath });
    expect(first).toEqual({ ok: true, name: "gh", action: "removed" });

    const after = parseToml(await readFile(configPath, "utf-8")) as {
      contracts?: { mcp_clients?: Record<string, unknown> };
    };
    expect(after.contracts?.mcp_clients?.gh).toBeUndefined();

    // Idempotent: removing again still returns ok with action='removed'
    const second = await setMcpClientTool.handler({ name: "gh", remove: true }, { configPath });
    expect(second).toEqual({ ok: true, name: "gh", action: "removed" });
  });

  it("Variant C (list): returns inventory of [contracts.mcp_clients] without mutating", async () => {
    await writeFile(
      configPath,
      [
        "[contracts.mcp_clients.gh]",
        "command = 'gh-mcp-server'",
        "args = ['--config', '/p']",
        "",
        "[contracts.mcp_clients.linear]",
        "command = 'linear-mcp'",
      ].join("\n") + "\n",
      "utf-8",
    );
    const original = await readFile(configPath, "utf-8");

    const result = await setMcpClientTool.handler({ list: true }, { configPath });
    expect(result).toMatchObject({
      ok: true,
      clients: expect.arrayContaining([
        expect.objectContaining({
          name: "gh",
          command: "gh-mcp-server",
          args: ["--config", "/p"],
          env_secrets: [],
        }),
        expect.objectContaining({
          name: "linear",
          command: "linear-mcp",
          args: [],
          env_secrets: [],
        }),
      ]),
    });

    // Read-only: file is untouched
    const after = await readFile(configPath, "utf-8");
    expect(after).toBe(original);
  });

  it("Variant C: env_secrets returns key-list ONLY (no values, no ciphertext)", async () => {
    await writeFile(
      configPath,
      [
        "[contracts.mcp_clients.gh]",
        "command = 'gh-mcp-server'",
        "env_secrets = { 'GITHUB_TOKEN' = 'TOKEN_KEY' }",
      ].join("\n") + "\n",
      "utf-8",
    );

    const result = await setMcpClientTool.handler({ list: true }, { configPath });
    if (!("ok" in result) || !result.ok || !("clients" in result)) {
      throw new Error("expected list result");
    }
    const gh = result.clients.find((c) => c.name === "gh");
    expect(gh).toBeDefined();
    // env_secrets is a key-list ONLY (key names, no values)
    expect(gh?.env_secrets).toEqual(["GITHUB_TOKEN"]);
  });

  it("Variant C on missing config returns ok with empty clients", async () => {
    const result = await setMcpClientTool.handler(
      { list: true },
      { configPath: join(tmpDir, "does-not-exist.toml") },
    );
    expect(result).toEqual({ ok: true, clients: [] });
  });

  it("Zod rejects payload with no recognized variant", () => {
    const parsed = setMcpClientTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("Zod rejects Variant A with missing command", () => {
    const parsed = setMcpClientTool.inputSchema.safeParse({ name: "gh" });
    expect(parsed.success).toBe(false);
  });
});
