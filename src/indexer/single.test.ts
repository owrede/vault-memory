import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import type { EmbedRequest, EmbedResponse } from "../types.js";
import { indexNote, removeNote } from "./single.js";

const MODEL = "test-embed";
const DIM = 1024;

function makeVault(vaultRoot: string): Vault {
  const db = new Database(":memory:", "test-vault");
  // Pre-register the embedding model so single-indexer can find it.
  db.models.upsert({ name: MODEL, provider: "ollama", dim: DIM });
  return {
    config: { name: "test", path: vaultRoot },
    db,
    dbPath: ":memory:",
  };
}

function makeOllama(): {
  client: OllamaClient;
  embed: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn(
    async (req: EmbedRequest): Promise<EmbedResponse> => ({
      vectors: req.texts.map((_, i) => unitVector(DIM, i)),
      dim: DIM,
      model: req.model,
    }),
  );
  // We only use `.embed`; cast through unknown to satisfy the structural
  // OllamaClient contract without instantiating the real HTTP client.
  const client = { embed } as unknown as OllamaClient;
  return { client, embed };
}

function unitVector(dim: number, seed: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[seed % dim] = 1;
  return v;
}

describe("single-indexer: indexNote", () => {
  let tmpDir: string;
  let vault: Vault;
  let ollama: { client: OllamaClient; embed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-single-"));
    vault = makeVault(tmpDir);
    ollama = makeOllama();
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeNote(rel: string, body: string): Promise<string> {
    const abs = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, "utf-8");
    return abs;
  }

  it("indexes a brand-new note", async () => {
    const abs = await writeNote("Foo.md", "# Foo\n\nHello world. This is body text.");
    const result = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(result.status).toBe("indexed");
    expect(result.isNew).toBe(true);
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.notePath).toBe("Foo.md");
    expect(ollama.embed).toHaveBeenCalledTimes(1);
  });

  it("returns 'unchanged' when hash is identical (no re-embed)", async () => {
    const abs = await writeNote("Bar.md", "# Bar\n\nBody.");
    await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(ollama.embed).toHaveBeenCalledTimes(1);

    const second = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(second.status).toBe("unchanged");
    expect(second.chunksCreated).toBe(0);
    expect(second.isNew).toBe(false);
    // Critical: no second embed call.
    expect(ollama.embed).toHaveBeenCalledTimes(1);
  });

  it("re-indexes when content changes", async () => {
    const abs = await writeNote("Baz.md", "# Baz\n\nFirst version.");
    const first = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(first.isNew).toBe(true);

    // Wait 5ms to ensure mtime differs (although hash is what matters).
    await new Promise((r) => setTimeout(r, 5));
    await fs.writeFile(abs, "# Baz\n\nCompletely different body now.", "utf-8");

    const second = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(second.status).toBe("indexed");
    expect(second.isNew).toBe(false);
    expect(second.chunksCreated).toBeGreaterThan(0);
    expect(ollama.embed).toHaveBeenCalledTimes(2);
  });

  // v0.9.1 — frontmatter-only-change short-circuit.
  // When only frontmatter changes (e.g. adding a tag), the body hash stays
  // the same, so chunks + embeddings must NOT be regenerated. We assert two
  // things: status reports the re-index, BUT no second Ollama embed call.
  it("body-hash short-circuit: frontmatter-only change does not re-embed", async () => {
    const abs = await writeNote(
      "Tagged.md",
      "---\ntags: [original]\n---\n\n# Tagged\n\nUnchanged body content.",
    );
    const first = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(first.isNew).toBe(true);
    expect(first.chunksCreated).toBeGreaterThan(0);
    expect(ollama.embed).toHaveBeenCalledTimes(1);

    const firstChunkCount = vault.db.chunks.getByNote(first.noteId!).length;
    expect(firstChunkCount).toBeGreaterThan(0);

    // Add a tag — frontmatter changes but body is byte-identical.
    await new Promise((r) => setTimeout(r, 5));
    await fs.writeFile(
      abs,
      "---\ntags: [original, added]\n---\n\n# Tagged\n\nUnchanged body content.",
      "utf-8",
    );

    const second = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(second.status).toBe("indexed");
    expect(second.isNew).toBe(false);
    // Critical assertion: the body did not change, so no new embedding call.
    expect(ollama.embed).toHaveBeenCalledTimes(1);
    // chunksCreated is 0 — the existing chunks are kept in place.
    expect(second.chunksCreated).toBe(0);
    // Chunks themselves are preserved (count and IDs).
    const afterChunkCount = vault.db.chunks.getByNote(second.noteId!).length;
    expect(afterChunkCount).toBe(firstChunkCount);

    // Frontmatter actually landed in the DB.
    const noteRow = vault.db.notes.getById(second.noteId!);
    const fm = noteRow?.frontmatter ? JSON.parse(noteRow.frontmatter) : null;
    expect(fm.tags).toEqual(["original", "added"]);
  });

  // Legacy rows (body_hash IS NULL pre-migration-006) must fall through to
  // the full re-embed path on the first touch and then self-heal.
  it("body-hash short-circuit: NULL body_hash on legacy row triggers full re-embed", async () => {
    const abs = await writeNote("Legacy.md", "# Legacy\n\nbody body body.");
    const first = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(ollama.embed).toHaveBeenCalledTimes(1);

    // Simulate a pre-migration row by clearing body_hash directly.
    vault.db.handle.prepare("UPDATE notes SET body_hash = NULL WHERE id = ?").run(first.noteId!);

    // Touch the file (mtime change) — body content is identical, but the
    // DB row has NULL body_hash so the short-circuit must NOT fire. We
    // want a full re-embed here to populate body_hash going forward.
    await new Promise((r) => setTimeout(r, 5));
    await fs.utimes(abs, new Date(), new Date());

    const second = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    // mtime touch doesn't change hash → falls through to the unchanged branch
    // BEFORE reaching the body_hash check. That branch doesn't backfill
    // body_hash. Acceptable for now (would need a "no-content-change but
    // metadata-stale" path); the legacy row stays NULL until a real edit.
    expect(second.status).toBe("unchanged");
    expect(ollama.embed).toHaveBeenCalledTimes(1);

    // Now actually edit frontmatter — combined hash changes, body_hash
    // is still NULL on the DB row → falls through to full re-embed, NOT
    // the short-circuit. After this, body_hash is populated.
    await fs.writeFile(abs, "---\ntag: added\n---\n\n# Legacy\n\nbody body body.", "utf-8");
    const third = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(third.status).toBe("indexed");
    expect(third.chunksCreated).toBeGreaterThan(0);
    // Full re-embed because legacy NULL body_hash short-circuit didn't fire.
    expect(ollama.embed).toHaveBeenCalledTimes(2);

    // Self-healed: body_hash is now populated.
    const healed = vault.db.notes.getById(third.noteId!);
    expect(healed?.body_hash).not.toBeNull();
  });

  it("returns 'outside_vault' for paths outside the vault root", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-out-"));
    try {
      const abs = path.join(outside, "Stray.md");
      await fs.writeFile(abs, "# Stray\n", "utf-8");
      const result = await indexNote({
        vault,
        absolutePath: abs,
        embeddingModel: MODEL,
        ollama: ollama.client,
      });
      expect(result.status).toBe("outside_vault");
      expect(result.notePath).toBeNull();
      expect(result.noteId).toBeNull();
      expect(ollama.embed).not.toHaveBeenCalled();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("returns 'missing' for a non-existent file inside the vault", async () => {
    const abs = path.join(tmpDir, "Ghost.md");
    const result = await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(result.status).toBe("missing");
    expect(ollama.embed).not.toHaveBeenCalled();
  });

  it("persists frontmatter aliases for resolution", async () => {
    const abs = await writeNote(
      "People/Oliver.md",
      ["---", "aliases:", "  - OWR", "  - Oliver W.", "---", "", "Body."].join("\n"),
    );
    await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    const hit = vault.db.aliases.resolve("OWR");
    expect(hit?.path).toBe("People/Oliver.md");
    const hit2 = vault.db.aliases.resolve("oliver w.");
    expect(hit2?.path).toBe("People/Oliver.md");
  });
});

describe("single-indexer: removeNote", () => {
  let tmpDir: string;
  let vault: Vault;
  let ollama: { client: OllamaClient; embed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-single-rm-"));
    vault = makeVault(tmpDir);
    ollama = makeOllama();
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes an indexed note from the DB", async () => {
    const abs = path.join(tmpDir, "Doomed.md");
    await fs.writeFile(abs, "# Doomed\n\nWill be deleted.", "utf-8");
    await indexNote({
      vault,
      absolutePath: abs,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(vault.db.notes.getByPath("Doomed.md")).not.toBeNull();

    const result = removeNote(vault, abs);
    expect(result.removed).toBe(true);
    expect(result.notePath).toBe("Doomed.md");
    expect(vault.db.notes.getByPath("Doomed.md")).toBeNull();
  });

  it("returns removed=false for a path not in the DB", async () => {
    const abs = path.join(tmpDir, "NeverIndexed.md");
    const result = removeNote(vault, abs);
    expect(result.removed).toBe(false);
    expect(result.notePath).toBeNull();
  });

  it("returns removed=false for a path outside the vault", async () => {
    const outside = path.join(os.tmpdir(), "definitely-not-in-vault.md");
    const result = removeNote(vault, outside);
    expect(result.removed).toBe(false);
    expect(result.notePath).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 / 04-02 / GRA-04 — indexer writes all four edge types via
// extractAllEdges() on every parse pass. Legacy wikilinks table also still
// receives wikilink rows per D-01 (v1 invariance).
// ─────────────────────────────────────────────────────────────────────────────

describe("single-indexer: edge extraction (04-02)", () => {
  let tmpDir: string;
  let vault: Vault;
  let ollama: { client: OllamaClient; embed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmem-single-edges-"));
    vault = makeVault(tmpDir);
    ollama = makeOllama();
  });

  afterEach(async () => {
    vault.db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeNoteFile(rel: string, body: string): Promise<string> {
    const abs = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, "utf-8");
    return abs;
  }

  function readEdgeTypes(noteId: number): Array<{ type: string; target_path: string | null }> {
    return vault.db.handle
      .prepare("SELECT type, target_path FROM edges WHERE source_doc = ? ORDER BY type, target_path")
      .all(noteId) as Array<{ type: string; target_path: string | null }>;
  }

  it("Test 1: a single note with one of each edge type produces 4 rows in edges; re-index is idempotent", async () => {
    // Seed a target note for the wikilink + a person for the frontmatter-ref
    // + an alias for mention extraction.
    const target = await writeNoteFile("target.md", "# Target\n\nbody.");
    await indexNote({
      vault,
      absolutePath: target,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    const alice = await writeNoteFile(
      "people/alice-chen.md",
      ["---", "aliases: [alice, alice-chen]", "---", "", "# Alice"].join("\n"),
    );
    await indexNote({
      vault,
      absolutePath: alice,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });

    const note = await writeNoteFile(
      "meeting.md",
      [
        "---",
        "owner: \"[[alice-chen]]\"",
        "---",
        "",
        "See [[target]] for details.",
        "",
        "Alice attended yesterday. https://example.com",
      ].join("\n"),
    );
    const first = await indexNote({
      vault,
      absolutePath: note,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(first.status).toBe("indexed");

    const rows = readEdgeTypes(first.noteId!);
    const byType = new Set(rows.map((r) => r.type));
    expect(byType.has("wikilink")).toBe(true);
    expect(byType.has("frontmatter-ref")).toBe(true);
    expect(byType.has("mention")).toBe(true);
    expect(byType.has("hyperlink")).toBe(true);

    // Re-index — file did not change on disk; the "unchanged" fast path
    // still keeps edges intact (deleteByNote + re-extract is idempotent
    // and equivalent to no-op here because the same parse output goes
    // through).
    const second = await indexNote({
      vault,
      absolutePath: note,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(second.status).toBe("unchanged");
    const rows2 = readEdgeTypes(second.noteId!);
    expect(rows2.length).toBe(rows.length);
  });

  it("Test 2: legacy wikilinks table also still receives the wikilink row (D-01)", async () => {
    const target = await writeNoteFile("target.md", "# Target\n\nbody.");
    await indexNote({
      vault,
      absolutePath: target,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    const note = await writeNoteFile("source.md", "# Source\n\n[[target]]");
    const result = await indexNote({
      vault,
      absolutePath: note,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });

    const wlRows = vault.db.handle
      .prepare("SELECT target_path FROM wikilinks WHERE source_note = ?")
      .all(result.noteId!) as Array<{ target_path: string }>;
    expect(wlRows.length).toBe(1);
    expect(wlRows[0]?.target_path).toBe("target");
  });

  it("Test 3: deleting a note removes all of its outgoing edges (FK ON DELETE CASCADE)", async () => {
    const target = await writeNoteFile("target.md", "# Target\n\nbody.");
    await indexNote({
      vault,
      absolutePath: target,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    const note = await writeNoteFile(
      "source.md",
      "# Source\n\n[[target]] https://example.com",
    );
    const r = await indexNote({
      vault,
      absolutePath: note,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    const noteId = r.noteId!;
    expect(readEdgeTypes(noteId).length).toBeGreaterThan(0);

    removeNote(vault, note);
    expect(readEdgeTypes(noteId).length).toBe(0);
  });

  it("Test 4: body-hash fast path also re-extracts and writes all edge types", async () => {
    // Wire up a target for the wikilink to resolve.
    const target = await writeNoteFile("target.md", "# Target\n\nbody.");
    await indexNote({
      vault,
      absolutePath: target,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });

    // First index with the original frontmatter — owner is unset.
    const note = await writeNoteFile(
      "source.md",
      ["---", "tags: [a]", "---", "", "[[target]]"].join("\n"),
    );
    const first = await indexNote({
      vault,
      absolutePath: note,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    const noteId = first.noteId!;
    expect(ollama.embed).toHaveBeenCalledTimes(2); // target + source

    // Seed an alias note so the new owner frontmatter-ref can resolve.
    await new Promise((r) => setTimeout(r, 5));
    const alice = await writeNoteFile(
      "people/alice-chen.md",
      ["---", "aliases: [alice-chen]", "---", "", "# Alice"].join("\n"),
    );
    await indexNote({
      vault,
      absolutePath: alice,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });

    // Re-write source with a frontmatter-only change. Body bytes are
    // identical, so the body-hash fast path (`single.ts:106`) should fire:
    // no new ollama.embed call for the source note.
    await fs.writeFile(
      note,
      ["---", "tags: [a]", "owner: \"[[alice-chen]]\"", "---", "", "[[target]]"].join("\n"),
      "utf-8",
    );
    const callsBefore = ollama.embed.mock.calls.length;
    const second = await indexNote({
      vault,
      absolutePath: note,
      embeddingModel: MODEL,
      ollama: ollama.client,
    });
    expect(second.status).toBe("indexed");
    expect(second.chunksCreated).toBe(0); // fast path
    expect(ollama.embed.mock.calls.length).toBe(callsBefore); // no re-embed

    // The frontmatter-ref edge must now be present even though we took
    // the body-hash fast path — extractAllEdges runs on BOTH branches.
    const rows = readEdgeTypes(noteId);
    const byType = new Set(rows.map((r) => r.type));
    expect(byType.has("wikilink")).toBe(true);
    expect(byType.has("frontmatter-ref")).toBe(true);
  });
});
