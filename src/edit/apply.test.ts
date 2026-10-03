import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { applyDocumentPatch } from "./apply.js";
import type { TextPatch } from "./patch.js";
import { indexNote } from "../indexer/single.js";

describe("applyDocumentPatch on canonical files", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  beforeEach(async () => {
    f = await createVaultFixture({ memorySink: true });
  });
  afterEach(async () => {
    await f.cleanup();
  });
  async function seed(properties: Record<string, unknown> = {}, path = "approved.md") {
    const id = f.id(path);
    const result = await f.delivery.write(id, {
      properties,
      blocks: [{ kind: "paragraph", text: "# A\nKeep\n## B\nOld\n## C\nKeep\n" }],
    });
    if (!result.ok) throw new Error("fixture creation failed");
    return id;
  }
  async function snapshot(path = "approved.md") {
    return {
      bytes: await fs.readFile(join(f.root, path), "utf8"),
      row: f.vault.db.notes.getByPath(path),
      audit: f.vault.db.audit.listWrites({}),
      suppression: f.suppression.size(),
    };
  }
  async function edit(id: ReturnType<typeof f.id>, patch: TextPatch, hash?: string) {
    return applyDocumentPatch(
      {
        source: f.source,
        delivery: f.delivery,
        onBeforeWrite: () => f.suppression.add("approved.md"),
      },
      {
        doc_id: id,
        expected_hash: hash ?? (await f.source.readDocument(id)).hash,
        patch,
      },
    );
  }
  it("updates only the selected section, retaining frontmatter bytes and unrelated text", async () => {
    const id = await seed({ owner: "Oliver", tags: ["approved"] });
    const raw =
      "---\n# retain this comment\nowner: 'Oliver'\ntags: ['approved']\n---\n# A\nKeep\n## B\nOld\n## C\nKeep\n";
    await fs.writeFile(join(f.root, "approved.md"), raw);
    const result = await edit(id, { kind: "section", heading_path: ["A", "B"], content: "New\n" });
    expect(result).toMatchObject({ ok: true, doc_id: id });
    expect(await fs.readFile(join(f.root, "approved.md"), "utf8")).toBe(
      raw.replace("Old\n", "New\n"),
    );
    expect(f.vault.db.audit.listWrites({})).toHaveLength(2);
    expect(f.suppression.has("approved.md")).toBe(true);
  });
  it("leaves a same-text edit without audit, file or suppression side effects", async () => {
    const id = await seed();
    const before = await snapshot();
    expect(await edit(id, { kind: "replace", old_text: "Old", new_text: "Old" })).toMatchObject({
      ok: true,
    });
    expect(await snapshot()).toEqual(before);
  });
  it("invalidates stale derived data and permits ordinary reindex after an edit", async () => {
    const id = f.id("approved.md");
    await fs.writeFile(join(f.root, "approved.md"), "# A\nOld\n");
    const options = {
      vault: f.vault,
      absolutePath: join(f.root, "approved.md"),
      embeddingModel: "unused",
      embeddings: "none" as const,
    };
    await indexNote(options);
    const noteId = f.vault.db.notes.getByPath("approved.md")!.id;
    expect(
      f.vault.db.chunks
        .getByNote(noteId)
        .map((c) => c.text)
        .join(" "),
    ).toContain("Old");
    expect(
      await edit(id, { kind: "replace", old_text: "Old", new_text: "UniqueNewContent" }),
    ).toMatchObject({ ok: true });
    expect(
      f.vault.db.chunks
        .getByNote(noteId)
        .map((c) => c.text)
        .join(" "),
    ).not.toContain("Old");
    expect((await indexNote(options)).status).toBe("indexed");
    const chunks = f.vault.db.chunks
      .getByNote(noteId)
      .map((c) => c.text)
      .join(" ");
    expect(chunks).toContain("UniqueNewContent");
    expect(chunks).not.toContain("Old");
    expect(f.vault.db.sections.getByNote(noteId).length).toBeGreaterThan(0);
    expect((await indexNote(options)).status).toBe("unchanged");
  });
  it.each(["changed", "same"])("a locked %s edit never mutates state", async (kind) => {
    const id = await seed({ locked: true });
    const before = await snapshot();
    expect(
      await edit(id, {
        kind: "replace",
        old_text: "Old",
        new_text: kind === "same" ? "Old" : "New",
      }),
    ).toMatchObject({ ok: false, reason: "document_locked" });
    expect(await snapshot()).toEqual(before);
  });
  it.each(["changed", "same"])("a read-only %s edit is rejected", async (kind) => {
    const id = await seed();
    f.vault.config.write_enabled = false;
    const before = await snapshot();
    expect(
      await edit(id, {
        kind: "replace",
        old_text: "Old",
        new_text: kind === "same" ? "Old" : "New",
      }),
    ).toMatchObject({ ok: false, reason: "permission_denied" });
    expect(await snapshot()).toEqual(before);
  });
  it("does not fabricate a current expected hash for a stale caller", async () => {
    const id = await seed();
    const before = await snapshot();
    expect(
      await edit(id, { kind: "replace", old_text: "Old", new_text: "New" }, "stale"),
    ).toMatchObject({ ok: false, reason: "hash_mismatch" });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects a missing target without mutating the document", async () => {
    const id = await seed();
    const before = await snapshot();
    expect(await edit(id, { kind: "replace", old_text: "Missing", new_text: "New" })).toEqual({
      ok: false,
      reason: "target_not_found",
    });
    expect(await snapshot()).toEqual(before);
  });
  it("preserves provenance for a valid sink edit", async () => {
    const properties = {
      source: "agent",
      evidence: ["meeting-1"],
      confidence: "direct",
      observed_at: "2026-01-01T00:00:00Z",
      status: "active",
      type: "observation",
      superseded_by: null,
    };
    const id = await seed(properties, "_memory/approved.md");
    expect(await edit(id, { kind: "replace", old_text: "Old", new_text: "New" })).toMatchObject({
      ok: true,
    });
    expect((await f.source.readDocument(id)).properties).toMatchObject(properties);
  });
  it("refuses a sink with externally invalidated provenance even for a no-op", async () => {
    const properties = {
      source: "agent",
      evidence: ["meeting-1"],
      confidence: "direct",
      observed_at: "2026-01-01T00:00:00Z",
      status: "active",
      type: "observation",
      superseded_by: null,
    };
    const id = await seed(properties, "_memory/approved.md");
    const path = join(f.root, "_memory/approved.md");
    const raw = await fs.readFile(path, "utf8");
    await fs.writeFile(path, raw.replace("confidence: direct\n", ""));
    const before = await snapshot("_memory/approved.md");
    expect(await edit(id, { kind: "replace", old_text: "Old", new_text: "Old" })).toMatchObject({
      ok: false,
      reason: "missing_provenance",
    });
    expect(await snapshot("_memory/approved.md")).toEqual(before);
  });
});
