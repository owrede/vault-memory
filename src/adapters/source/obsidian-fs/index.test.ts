/**
 * ObsidianFsSource — co-located unit tests.
 *
 * Read-only against the Atlas fixture vault (evals/fixtures/v2-test-vault/).
 * The fixture is the conformance substrate for the whole Phase 1 — these
 * tests assert behavior on a real, ~75-note vault rather than a synthetic
 * tmp tree.
 */

import { describe, expect, it } from "vitest";
import { ObsidianFsSource } from "./index.js";
import { parseDocId, parseSourceHandle } from "../../registry.js";
import type { VaultConfig, WikilinkRef } from "../../../types.js";

const ATLAS_VAULT: VaultConfig = {
  name: "atlas",
  path: "evals/fixtures/v2-test-vault",
};

describe("ObsidianFsSource — construction + identity", () => {
  it("exposes the expected source handle", () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    expect(source.handle).toBe(parseSourceHandle("obsidian-fs://atlas"));
  });

  it("publishes honest SourceCapabilities", () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    expect(source.capabilities).toMatchObject({
      bodyShape: "flat-text",
      properties: "untyped",
      linkTypes: ["wikilink"],
      identityStable: false,
      permissions: false,
      contentHashStable: true,
      refHashKind: "content",
      watch: "push",
    });
  });
});

describe("ObsidianFsSource.listDocuments", () => {
  it("yields at least 50 DocumentRefs for the Atlas fixture", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const refs = [];
    for await (const ref of source.listDocuments()) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(50);
  });

  it("yields DocumentRefs with id, mtime, hash fields", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    for await (const ref of source.listDocuments()) {
      expect(typeof ref.id).toBe("string");
      expect(ref.id).toMatch(/^obsidian-fs:\/\/atlas\//);
      expect(typeof ref.mtime).toBe("number");
      expect(ref.mtime).toBeGreaterThan(0);
      expect(typeof ref.hash).toBe("string");
      expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);
      break; // one is enough for the schema check
    }
  });

  it("respects opts.excludeGlobs", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const refs = [];
    for await (const ref of source.listDocuments({ excludeGlobs: ["projects/**"] })) {
      refs.push(ref);
    }
    const inProjects = refs.filter((r) => r.id.includes("/projects/"));
    expect(inProjects).toHaveLength(0);
    // and we still have OTHER content
    expect(refs.length).toBeGreaterThan(0);
  });
});

describe("ObsidianFsSource.readDocument", () => {
  it("returns a Document for a known fixture file", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://atlas/people/alice-chen.md");
    const doc = await source.readDocument(id);

    expect(doc.id).toBe(id);
    expect(doc.source).toBe(parseSourceHandle("obsidian-fs://atlas"));
    expect(doc.title).toBeTruthy();
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.kind).toBe("paragraph");
    expect(doc.properties).toBeTypeOf("object");
    expect(doc.links).toEqual([]);
    expect(doc.mtime).toBeGreaterThan(0);
    expect(doc.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.display_url).toMatch(/^obsidian:\/\/open\?vault=atlas&file=/);
  });

  it("surfaces wikilinks as Document.properties.wikilinks (D-05)", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://atlas/people/alice-chen.md");
    const doc = await source.readDocument(id);

    const wikilinks = doc.properties["wikilinks"] as WikilinkRef[] | undefined;
    expect(Array.isArray(wikilinks)).toBe(true);
    expect((wikilinks ?? []).length).toBeGreaterThan(0);
    // alice-chen.md references [[decisions/2026-03-12-pivot-to-warehouse]]
    // and [[projects/atlas-1]] in its body.
    const targets = (wikilinks ?? []).map((w) => w.target);
    expect(targets).toContain("decisions/2026-03-12-pivot-to-warehouse");
    expect(targets).toContain("projects/atlas-1");
  });

  it("rejects a doc_id whose authority does not match the configured vault", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const forged = parseDocId("obsidian-fs://other-vault/people/alice-chen.md");
    await expect(source.readDocument(forged)).rejects.toThrow(/vault/i);
  });
});

describe("ObsidianFsSource.hash", () => {
  it("returns a hex sha256 of the body", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://atlas/people/alice-chen.md");
    const h = await source.hash(id);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://atlas/people/alice-chen.md");
    const h1 = await source.hash(id);
    const h2 = await source.hash(id);
    expect(h1).toBe(h2);
  });
});

describe("ObsidianFsSource.exists", () => {
  it("returns true for an existing file", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://atlas/people/alice-chen.md");
    await expect(source.exists(id)).resolves.toBe(true);
  });

  it("returns false for a missing file (no throw)", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://atlas/does-not-exist.md");
    await expect(source.exists(id)).resolves.toBe(false);
  });

  it("returns false (no throw) for a foreign-vault id", async () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://other-vault/people/alice-chen.md");
    await expect(source.exists(id)).resolves.toBe(false);
  });
});

describe("ObsidianFsSource.formatDisplayUrl", () => {
  it("returns an obsidian:// open-url with vault + file query params", () => {
    const source = new ObsidianFsSource(ATLAS_VAULT);
    const id = parseDocId("obsidian-fs://atlas/people/alice-chen.md");
    const url = source.formatDisplayUrl(id);
    expect(url).toBe("obsidian://open?vault=atlas&file=people%2Falice-chen.md");
  });

  it("percent-encodes special characters in vault name and file path", () => {
    const source = new ObsidianFsSource({ name: "my vault", path: "/tmp" });
    const id = parseDocId("obsidian-fs://my vault/sub/note with space.md");
    const url = source.formatDisplayUrl(id);
    expect(url).toContain("vault=my%20vault");
    expect(url).toContain("file=sub%2Fnote%20with%20space.md");
  });
});
