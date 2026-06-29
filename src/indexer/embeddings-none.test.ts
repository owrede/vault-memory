/**
 * indexVault / indexNote with `embeddings: "none"` (ADR-008).
 *
 * ContextFit-backed vaults build the FULL SQLite content layer (notes, chunks,
 * sections, wikilinks, edges) WITHOUT embeddings and WITHOUT any Ollama client.
 * These tests assert that path: a vault indexes with no OllamaClient supplied,
 * the content tables populate, and the embeddings table stays empty. No Ollama,
 * no ContextFit binary needed.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { indexVault } from "./indexer.js";
import { indexNote } from "./single.js";

describe("indexVault embeddings:'none' (ContextFit content layer)", () => {
  let vaultRoot = "";
  let vault: Vault;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vm-embnone-"));
    await fs.writeFile(
      path.join(vaultRoot, "a.md"),
      "# Alpha\n\nAlpha links to [[Beta]] and has a body.\n\n## Sub\n\nsub body.\n",
    );
    await fs.writeFile(path.join(vaultRoot, "beta.md"), "# Beta\n\nBeta content.\n");
    const db = new Database(":memory:", "cf-vault");
    vault = {
      config: { name: "cf", path: vaultRoot, backend: "contextfit" },
      db,
      dbPath: ":memory:",
    };
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it("builds notes/chunks/sections/wikilinks/edges with NO ollama and NO embeddings", async () => {
    const res = await indexVault(vault, {
      mode: "full",
      embeddingModel: "contextfit",
      embeddings: "none",
      // NOTE: no `ollama` supplied — proves the path needs no Ollama at all.
    });
    expect(res.status).toBe("completed");
    expect(res.notesIndexed).toBe(2);

    // Content layer is populated…
    expect(vault.db.notes.listAll().length).toBe(2);
    const a = vault.db.notes.getByPath("a.md")!;
    expect(vault.db.chunks.getByNote(a.id).length).toBeGreaterThan(0);
    expect(vault.db.sections.getByNote(a.id).length).toBeGreaterThan(0);
    expect(vault.db.wikilinks.getForwardLinks(a.id).length).toBeGreaterThan(0);

    // …and NO embedding model was registered (the embeddings path never ran).
    expect(vault.db.models.getActive()).toBeNull();
  });

  it("throws if embeddings:'ollama' is requested without an OllamaClient", async () => {
    await expect(
      indexVault(vault, { mode: "full", embeddingModel: "x", embeddings: "ollama" }),
    ).rejects.toThrow(/requires an OllamaClient/);
  });

  it("indexNote embeddings:'none' updates one note's content layer without ollama", async () => {
    // Seed the vault first.
    await indexVault(vault, { mode: "full", embeddingModel: "contextfit", embeddings: "none" });
    // Edit a note on disk, then single-index it.
    await fs.writeFile(
      path.join(vaultRoot, "a.md"),
      "# Alpha v2\n\nrewritten body about logistics.\n",
    );
    const r = await indexNote({
      vault,
      absolutePath: path.join(vaultRoot, "a.md"),
      embeddingModel: "contextfit",
      embeddings: "none",
    });
    expect(r.status).toBe("indexed");
    const a = vault.db.notes.getByPath("a.md")!;
    expect(a.title).toBe("Alpha v2");
    expect(vault.db.models.getActive()).toBeNull();
  });
});
