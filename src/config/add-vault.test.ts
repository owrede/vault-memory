import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { addVault, slugifyVaultName } from "./add-vault.js";

describe("slugifyVaultName", () => {
  it("lowercases and replaces non-alnum with dashes", () => {
    expect(slugifyVaultName("Intelligence Impact")).toBe("intelligence-impact");
    expect(slugifyVaultName("OWR-Notes")).toBe("owr-notes");
    expect(slugifyVaultName("My_Vault!!!")).toBe("my-vault");
  });

  it("collapses repeated dashes and trims edges", () => {
    expect(slugifyVaultName("--A__B--")).toBe("a-b");
  });

  it("prefixes leading digits to satisfy SQLite-friendly name rule", () => {
    expect(slugifyVaultName("2024 Notes")).toBe("v-2024-notes");
  });

  it("returns 'vault' for entirely non-alnum input", () => {
    expect(slugifyVaultName("!!!")).toBe("vault");
  });
});

describe("addVault", () => {
  let scratch: string;
  let vaultDir: string;
  let cfgFile: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "vmem-addvault-"));
    vaultDir = join(scratch, "My Test Vault");
    await mkdir(vaultDir, { recursive: true });
    cfgFile = join(scratch, "config.toml");
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("first add: creates config block + fresh .mcp.json", async () => {
    const result = await addVault({
      path: vaultDir,
      configFile: cfgFile,
    });

    expect(result.name).toBe("my-test-vault");
    expect(result.resolvedPath).toBe(vaultDir);
    expect(result.steps.map((s) => s.kind)).toEqual([
      "config-added",
      "mcp-json-created",
    ]);

    const cfg = await readFile(cfgFile, "utf-8");
    expect(cfg).toContain('[[vaults]]');
    expect(cfg).toContain('name = "my-test-vault"');
    expect(cfg).toContain(`path = "${vaultDir}"`);
    expect(cfg).toContain("write_enabled = false");

    const mcp = JSON.parse(
      await readFile(join(vaultDir, ".mcp.json"), "utf-8"),
    );
    expect(mcp.mcpServers["vault-memory"].command).toBe("vault-memory");
    expect(mcp.mcpServers["vault-memory"].env.VAULT_MEMORY_ACTIVE_VAULT).toBe(
      "my-test-vault",
    );
  });

  it("respects custom name and write_enabled", async () => {
    const result = await addVault({
      path: vaultDir,
      configFile: cfgFile,
      name: "custom-name",
      writeEnabled: true,
    });

    expect(result.name).toBe("custom-name");
    const cfg = await readFile(cfgFile, "utf-8");
    expect(cfg).toContain('name = "custom-name"');
    expect(cfg).toContain("write_enabled = true");
  });

  it("idempotent: re-running with same path is a no-op for config", async () => {
    await addVault({ path: vaultDir, configFile: cfgFile });
    const cfgAfterFirst = await readFile(cfgFile, "utf-8");

    const result2 = await addVault({ path: vaultDir, configFile: cfgFile });
    expect(result2.steps.map((s) => s.kind)).toEqual([
      "config-already-registered",
      "mcp-json-unchanged",
    ]);
    const cfgAfterSecond = await readFile(cfgFile, "utf-8");
    expect(cfgAfterSecond).toBe(cfgAfterFirst);
  });

  it("merges .mcp.json without overwriting other servers", async () => {
    // Pre-write an .mcp.json with a different server.
    const existingMcp = {
      mcpServers: {
        "other-tool": {
          type: "stdio",
          command: "other-tool",
          args: ["run"],
        },
      },
    };
    await writeFile(
      join(vaultDir, ".mcp.json"),
      JSON.stringify(existingMcp, null, 2),
      "utf-8",
    );

    const result = await addVault({ path: vaultDir, configFile: cfgFile });
    expect(result.steps.map((s) => s.kind)).toEqual([
      "config-added",
      "mcp-json-merged",
    ]);

    const mcp = JSON.parse(
      await readFile(join(vaultDir, ".mcp.json"), "utf-8"),
    );
    expect(Object.keys(mcp.mcpServers).sort()).toEqual([
      "other-tool",
      "vault-memory",
    ]);
    expect(mcp.mcpServers["other-tool"].command).toBe("other-tool");
    expect(mcp.mcpServers["vault-memory"].env.VAULT_MEMORY_ACTIVE_VAULT).toBe(
      "my-test-vault",
    );
  });

  it("rejects when a different vault already holds the same name", async () => {
    // Pre-existing config with name=my-test-vault pointing somewhere else.
    const otherDir = join(scratch, "Other Place");
    await mkdir(otherDir, { recursive: true });
    await writeFile(
      cfgFile,
      `[[vaults]]\nname = "my-test-vault"\npath = "${otherDir}"\n`,
      "utf-8",
    );

    await expect(
      addVault({ path: vaultDir, configFile: cfgFile }),
    ).rejects.toThrow(/already registered under name/);
  });

  it("rejects when the path does not exist", async () => {
    await expect(
      addVault({
        path: join(scratch, "does-not-exist"),
        configFile: cfgFile,
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects when the path is a file, not a directory", async () => {
    const filePath = join(scratch, "regular-file.md");
    await writeFile(filePath, "x", "utf-8");
    await expect(
      addVault({ path: filePath, configFile: cfgFile }),
    ).rejects.toThrow(/not a directory/);
  });

  it("rejects malformed custom names", async () => {
    await expect(
      addVault({
        path: vaultDir,
        configFile: cfgFile,
        name: "Bad Name With Spaces",
      }),
    ).rejects.toThrow(/must match/);
  });
});
