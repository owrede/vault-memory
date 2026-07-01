/**
 * Issue #14 / P1 — incremental full-vault reindex decision.
 *
 * `indexVault({ mode: "incremental" })` must re-index a note whose BODY
 * changed, even when the note already has chunks. The pre-fix code decided
 * `needsReindex` from `chunkCount === 0` alone, so a changed note with
 * existing chunks kept its NEW `notes.hash`/`content` while retaining STALE
 * chunks / sections / wikilinks / edges.
 *
 * These tests run against the `embeddings: "none"` path (ADR-008) so they
 * need no Ollama: chunks/sections/links are still built, which is exactly
 * the derived layer the bug leaves stale. A stub OllamaClient is used only
 * for the "frontmatter-only change must not re-embed" assertion (P1 test 2),
 * which requires the ollama path to count embed calls.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import { indexVault } from "./indexer.js";

describe("indexVault incremental reindex decision (Issue #14 / P1)", () => {
  let vaultRoot = "";
  let vault: Vault;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vm-incr-"));
    const db = new Database(":memory:", "incr-vault");
    vault = {
      config: { name: "incr", path: vaultRoot, backend: "contextfit" },
      db,
      dbPath: ":memory:",
    };
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  function chunkTexts(notePath: string): string[] {
    const note = vault.db.notes.getByPath(notePath)!;
    return vault.db.chunks.getByNote(note.id).map((c) => c.text);
  }

  it("re-indexes chunks/embeddings when a note's BODY changes", async () => {
    await fs.writeFile(
      path.join(vaultRoot, "a.md"),
      "# Alpha\n\nThe original body talks about apples.\n",
    );
    await indexVault(vault, {
      mode: "full",
      embeddingModel: "contextfit",
      embeddings: "none",
    });
    expect(chunkTexts("a.md").join("\n")).toContain("apples");

    // Change the body on disk, then run an INCREMENTAL index.
    await fs.writeFile(
      path.join(vaultRoot, "a.md"),
      "# Alpha\n\nThe rewritten body talks about oranges instead.\n",
    );
    const res = await indexVault(vault, {
      mode: "incremental",
      embeddingModel: "contextfit",
      embeddings: "none",
    });
    expect(res.status).toBe("completed");
    expect(res.notesUpdated).toBe(1);

    // The derived layer MUST reflect the new body — this is the bug.
    const texts = chunkTexts("a.md").join("\n");
    expect(texts).toContain("oranges");
    expect(texts).not.toContain("apples");
  });

  it("re-indexes wikilinks/edges when a note's BODY changes", async () => {
    await fs.writeFile(path.join(vaultRoot, "beta.md"), "# Beta\n\nbeta\n");
    await fs.writeFile(path.join(vaultRoot, "gamma.md"), "# Gamma\n\ngamma\n");
    await fs.writeFile(path.join(vaultRoot, "a.md"), "# Alpha\n\nLinks to [[Beta]].\n");
    await indexVault(vault, { mode: "full", embeddingModel: "contextfit", embeddings: "none" });

    const aId = vault.db.notes.getByPath("a.md")!.id;
    let fwd = vault.db.wikilinks.getForwardLinks(aId).map((w) => w.targetPath);
    expect(fwd).toContain("Beta");

    // Repoint the link to Gamma.
    await fs.writeFile(path.join(vaultRoot, "a.md"), "# Alpha\n\nLinks to [[Gamma]] now.\n");
    await indexVault(vault, {
      mode: "incremental",
      embeddingModel: "contextfit",
      embeddings: "none",
    });

    fwd = vault.db.wikilinks.getForwardLinks(aId).map((w) => w.targetPath);
    expect(fwd).toContain("Gamma");
    expect(fwd).not.toContain("Beta");
  });

  it("is a no-op for an unchanged note (no re-index)", async () => {
    await fs.writeFile(path.join(vaultRoot, "a.md"), "# Alpha\n\nunchanged body.\n");
    await indexVault(vault, { mode: "full", embeddingModel: "contextfit", embeddings: "none" });

    const res = await indexVault(vault, {
      mode: "incremental",
      embeddingModel: "contextfit",
      embeddings: "none",
    });
    expect(res.status).toBe("completed");
    expect(res.notesUpdated).toBe(0);
    expect(res.notesIndexed).toBe(0);
  });

  it("frontmatter-only change updates metadata WITHOUT re-embedding (ollama path)", async () => {
    // Count CHUNK embed() calls to prove the body-hash short-circuit skips
    // re-embedding. The indexer also issues a 1-text "probe" embed at the
    // start of every ollama run to detect the dimension — that's unrelated
    // to re-embedding note bodies, so we exclude single-text probe calls
    // from the count.
    let chunkEmbedCalls = 0;
    const stub: Partial<OllamaClient> = {
      healthCheck: async () => ({ ok: true, models: ["stub-model"] }),
      modelExists: async () => true,
      embed: async ({ model, texts }: { model: string; texts: string[] }) => {
        const isProbe = texts.length === 1 && texts[0] === "probe";
        if (!isProbe) chunkEmbedCalls++;
        return { dim: 3, vectors: texts.map(() => [0.1, 0.2, 0.3]), model };
      },
    };
    const ollama = stub as OllamaClient;

    await fs.writeFile(
      path.join(vaultRoot, "a.md"),
      "---\nstatus: draft\n---\n# Alpha\n\nbody stays the same.\n",
    );
    await indexVault(vault, { mode: "full", embeddingModel: "stub-model", ollama });
    const callsAfterFull = chunkEmbedCalls;
    expect(callsAfterFull).toBeGreaterThan(0);

    // Frontmatter-only edit: body identical, only `status` flips.
    await fs.writeFile(
      path.join(vaultRoot, "a.md"),
      "---\nstatus: active\n---\n# Alpha\n\nbody stays the same.\n",
    );
    const res = await indexVault(vault, {
      mode: "incremental",
      embeddingModel: "stub-model",
      ollama,
    });
    expect(res.status).toBe("completed");

    // No further CHUNK embed calls — the body-hash short-circuit kept
    // chunks/embeddings (only the dimension probe re-ran).
    expect(chunkEmbedCalls).toBe(callsAfterFull);

    // …but the denormalized status column DID update.
    const aId = vault.db.notes.getByPath("a.md")!.id;
    expect(vault.db.notes.getStatus(aId)).toBe("active");
  });
});
