import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { refreshEditedDocument } from "./refresh.js";
import * as contextFit from "../adapters/retrieval/contextfit/index.js";
import { catchupVault } from "../indexer/catchup.js";
import { indexVault } from "../indexer/indexer.js";

describe("edited-document refresh", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  beforeEach(async () => {
    f = await createVaultFixture();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.cleanup();
  });
  async function changed() {
    const id = f.id("a.md");
    const initial = await f.delivery.write(id, { blocks: [{ kind: "paragraph", text: "Old" }] });
    if (!initial.ok) throw new Error("seed failed");
    const result = await f.delivery.update(
      id,
      { blocks: [{ kind: "paragraph", text: "New" }] },
      { expectedHash: initial.newHash, skipUnchanged: true },
    );
    expect(result.ok).toBe(true);
    return id;
  }
  it.each(["catchup", "full"])(
    "%s repairs an invalidated row with unchanged canonical hash",
    async (mode) => {
      await changed();
      f.vault.config.backend = "contextfit";
      vi.spyOn(contextFit, "indexVaultWithContextFit").mockResolvedValue({
        status: "completed",
        stats: "",
        durationMs: 0,
      });
      if (mode === "catchup") {
        expect((await catchupVault({ vault: f.vault, embeddingModel: "unused" })).reindexed).toBe(
          1,
        );
      } else {
        expect(
          (await indexVault(f.vault, { embeddingModel: "unused", embeddings: "none" })).status,
        ).toBe("completed");
      }
      const row = f.vault.db.notes.getByPath("a.md")!;
      expect(row.body_hash).not.toBeNull();
      expect(
        f.vault.db.chunks
          .getByNote(row.id)
          .map((c) => c.text)
          .join(" "),
      ).toContain("New");
    },
  );
  it("refreshes the ContextFit KB as well as SQLite", async () => {
    const id = await changed();
    f.vault.config.backend = "contextfit";
    const ingest = vi
      .spyOn(contextFit, "indexVaultWithContextFit")
      .mockResolvedValue({ status: "completed", stats: "", durationMs: 0 });
    await refreshEditedDocument({ manager: f.manager, defaultModel: "unused" }, id);
    expect(ingest).toHaveBeenCalledWith(f.vault.config, {});
    const row = f.vault.db.notes.getByPath("a.md")!;
    expect(
      f.vault.db.chunks
        .getByNote(row.id)
        .map((c) => c.text)
        .join(" "),
    ).toContain("New");
  });
  it("keeps a failed ContextFit refresh repairable", async () => {
    const id = await changed();
    f.vault.config.backend = "contextfit";
    vi.spyOn(contextFit, "indexVaultWithContextFit").mockResolvedValue({
      status: "failed",
      stats: "",
      durationMs: 0,
      error: "CLI unavailable",
    });
    await expect(
      refreshEditedDocument({ manager: f.manager, defaultModel: "unused" }, id),
    ).rejects.toThrow("CLI unavailable");
    expect(f.vault.db.notes.getByPath("a.md")!.body_hash).toBeNull();
  });
});
