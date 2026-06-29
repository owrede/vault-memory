/**
 * ContextFitBackend tests — pure mapping logic + a live search round-trip
 * gated on contextfit being installed (ADR-008).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  sourceToNotePath,
  contextFitKbDir,
  cliConfigForVault,
  indexVaultWithContextFit,
  searchVaultWithContextFit,
} from "./index.js";
import { contextFitProbe } from "./cli.js";
import type { VaultConfig } from "../../../types.js";

const CF_AVAILABLE = await contextFitProbe({ command: "contextfit" });

describe("sourceToNotePath", () => {
  it("maps an absolute source under the vault to a relative POSIX path", () => {
    expect(sourceToNotePath("/vault/sub/note.md", "/vault")).toBe("sub/note.md");
  });
  it("returns null for a source outside the vault root", () => {
    expect(sourceToNotePath("/elsewhere/x.md", "/vault")).toBeNull();
  });
  it("returns null for undefined source", () => {
    expect(sourceToNotePath(undefined, "/vault")).toBeNull();
  });
  it("normalizes backslashes to forward slashes", () => {
    // already-relative input is normalized as-is
    expect(sourceToNotePath("sub\\note.md", "/vault")).toBe("sub/note.md");
  });
});

describe("contextFitKbDir / cliConfigForVault", () => {
  it("kb dir is under ~/.vault-memory/contextfit/<name>", () => {
    expect(contextFitKbDir("myvault")).toBe(
      join(homedir(), ".vault-memory", "contextfit", "myvault"),
    );
  });
  it("cliConfig defaults command to 'contextfit' and honors overrides", () => {
    const base = cliConfigForVault({ name: "v", path: "/p", backend: "contextfit" });
    expect(base.command).toBe("contextfit");
    expect(base.tokenizer).toBeUndefined();

    const custom = cliConfigForVault({
      name: "v",
      path: "/p",
      backend: "contextfit",
      contextfit: { command: "/opt/bin/contextfit", tokenizer: "o200k_base" },
    });
    expect(custom.command).toBe("/opt/bin/contextfit");
    expect(custom.tokenizer).toBe("o200k_base");
  });
});

// ─── Live: index a temp vault with ContextFit and search it ─────────────────
describe.skipIf(!CF_AVAILABLE)("ContextFitBackend live index + search", () => {
  let vaultDir = "";
  let vault: VaultConfig;

  beforeAll(async () => {
    const base = await fs.mkdtemp(join(tmpdir(), "vm-cf-backend-"));
    vaultDir = join(base, "vault");
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.writeFile(
      join(vaultDir, "decisions.md"),
      "# Q2 Decision\n\nWe decided to pivot the robotics team to warehouse automation.\n",
    );
    await fs.writeFile(
      join(vaultDir, "people.md"),
      "# Team\n\nAlice leads the warehouse automation effort.\n",
    );
    vault = { name: `cf-test-${Date.now()}`, path: vaultDir, backend: "contextfit" };
  });

  afterAll(async () => {
    // Clean the per-vault KB this test created under ~/.vault-memory/contextfit/.
    if (vault) await fs.rm(contextFitKbDir(vault.name), { recursive: true, force: true });
  });

  it("indexes then returns SearchHits with vault-relative notePath", async () => {
    const idx = await indexVaultWithContextFit(vault, {});
    expect(idx.status).toBe("completed");

    const hits = await searchVaultWithContextFit(vault, "warehouse automation decision", {
      topK: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0]!;
    // notePath is vault-relative (not absolute), matches a fixture file.
    expect(top.notePath).toMatch(/^(decisions|people)\.md$/);
    expect(top.vault).toBe(vault.name);
    expect(top.chunkText.length).toBeGreaterThan(0);
    expect(top.scoreBreakdown?.contextfit).toBeTypeOf("number");
  }, 90_000);
});
