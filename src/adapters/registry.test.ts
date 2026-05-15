/**
 * Unit tests for `src/adapters/registry.ts`.
 *
 * Covers:
 *   - parseDocId positive case (valid `<scheme>://<authority>/<resource>`).
 *   - parseDocId negative cases (each MUST throw).
 *   - formatDocId compositional case.
 *   - parseSourceHandle positive + negative cases.
 *   - AdapterRegistry triad (register / resolve / list) for source,
 *     delivery, and change-feed maps.
 *   - resolveX(unregistered) throws with handle in message.
 */

import { describe, it, expect } from "vitest";
import {
  AdapterRegistry,
  decomposeDocId,
  formatDocId,
  parseDocId,
  parseSourceHandle,
} from "./registry.js";
import type { DocId } from "../types.js";
import type { SourceConnector } from "./source/types.js";
import type { DeliveryAdapter } from "./delivery/types.js";
import type { ChangeFeed } from "./change-feed/types.js";
import type { SourceHandle } from "../types.js";

describe("parseDocId", () => {
  it("accepts a well-formed obsidian-fs DocId", () => {
    const id = parseDocId("obsidian-fs://my-vault/path/to/note.md");
    expect(id).toBe("obsidian-fs://my-vault/path/to/note.md");
  });

  it("accepts notion-api scheme", () => {
    const id = parseDocId("notion-api://workspace-abc/page-123");
    expect(id).toBe("notion-api://workspace-abc/page-123");
  });

  it.each([
    ["not-a-uri", "no scheme"],
    ["obsidian-fs:/missing-slash", "single slash"],
    ["obsidian-fs://", "empty authority and resource"],
    ["obsidian-fs:///no-authority", "empty authority"],
    ["obsidian-fs://authority-only", "no resource"],
    ["obsidian-fs://authority/", "empty resource"],
    ["", "empty string"],
    ["OBSIDIAN-FS://X/y", "uppercase scheme"],
    ["123://x/y", "digit-leading scheme"],
    ["-bad://x/y", "dash-leading scheme"],
    ["://no-scheme/y", "missing scheme"],
  ])("rejects %s (%s)", (input) => {
    expect(() => parseDocId(input)).toThrow(/Invalid DocId/);
  });

  it("includes the input value in the error message", () => {
    expect(() => parseDocId("garbage")).toThrow(/garbage/);
  });
});

describe("formatDocId", () => {
  it("composes and validates a DocId from its parts", () => {
    const id = formatDocId("obsidian-fs", "my-vault", "notes/foo.md");
    expect(id).toBe("obsidian-fs://my-vault/notes/foo.md");
  });

  it("rejects an invalid composition", () => {
    expect(() => formatDocId("OBSIDIAN", "x", "y")).toThrow(/Invalid DocId/);
  });
});

describe("parseSourceHandle", () => {
  it("accepts a bare scheme://authority", () => {
    const h = parseSourceHandle("obsidian-fs://my-vault");
    expect(h).toBe("obsidian-fs://my-vault");
  });

  it.each([
    ["obsidian-fs://my-vault/with-path", "has resource path"],
    ["obsidian-fs://", "empty authority"],
    ["obsidian-fs:/missing-slash", "single slash"],
    ["OBSIDIAN://X", "uppercase scheme"],
    ["", "empty string"],
    ["obsidian-fs://my-vault/", "trailing slash"],
  ])("rejects %s (%s)", (input) => {
    expect(() => parseSourceHandle(input)).toThrow(/Invalid SourceHandle/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AdapterRegistry
// ─────────────────────────────────────────────────────────────────────────────

function makeStubSource(handle: SourceHandle): SourceConnector {
  return {
    handle,
    capabilities: {
      bodyShape: "flat-text",
      properties: "untyped",
      linkTypes: [],
      identityStable: true,
      permissions: false,
      contentHashStable: true,
      refHashKind: "content",
      watch: "none",
    },
    listDocuments: async function* () {
      // no-op
    },
    readDocument: async () => {
      throw new Error("stub");
    },
    hash: async () => "stub-hash",
    exists: async () => false,
  };
}

function makeStubDelivery(handle: SourceHandle): DeliveryAdapter {
  return {
    handle,
    capabilities: {
      atomic: true,
      hashProtected: "none",
      enforcedSchema: false,
      naming: "caller-provided",
    },
    write: async () => ({ ok: false, reason: "permission_denied" }),
    update: async () => ({ ok: false, reason: "not_found" }),
    delete: async () => ({ ok: false, reason: "not_found" }),
  };
}

function makeStubChangeFeed(handle: SourceHandle): ChangeFeed {
  return {
    handle,
    capabilities: { watch: "none", emitsRename: false },
    subscribe: () => ({ [Symbol.dispose]: () => {} }),
    close: async () => {},
  };
}

describe("AdapterRegistry — sources", () => {
  it("registerSource then resolveSource returns the same instance", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://v1");
    const a = makeStubSource(h);
    reg.registerSource(h, a);
    expect(reg.resolveSource(h)).toBe(a);
  });

  it("resolveSource throws on unregistered handle with handle in message", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://unknown");
    expect(() => reg.resolveSource(h)).toThrow(/obsidian-fs:\/\/unknown/);
  });

  it("resolveSource error message lists registered handles", () => {
    const reg = new AdapterRegistry();
    const h1 = parseSourceHandle("obsidian-fs://v1");
    const h2 = parseSourceHandle("obsidian-fs://v2");
    reg.registerSource(h1, makeStubSource(h1));
    reg.registerSource(h2, makeStubSource(h2));
    const unknown = parseSourceHandle("obsidian-fs://nope");
    expect(() => reg.resolveSource(unknown)).toThrow(/v1.*v2|v2.*v1/s);
  });

  it("listSources returns all registered handles", () => {
    const reg = new AdapterRegistry();
    const h1 = parseSourceHandle("obsidian-fs://a");
    const h2 = parseSourceHandle("obsidian-fs://b");
    reg.registerSource(h1, makeStubSource(h1));
    reg.registerSource(h2, makeStubSource(h2));
    expect(reg.listSources().sort()).toEqual([h1, h2].sort());
  });

  it("registerSource overwrites a prior registration under the same handle", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://v1");
    const a = makeStubSource(h);
    const b = makeStubSource(h);
    reg.registerSource(h, a);
    reg.registerSource(h, b);
    expect(reg.resolveSource(h)).toBe(b);
  });
});

describe("AdapterRegistry — deliveries", () => {
  it("registerDelivery / resolveDelivery / listDeliveries round-trip", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://v1");
    const d = makeStubDelivery(h);
    reg.registerDelivery(h, d);
    expect(reg.resolveDelivery(h)).toBe(d);
    expect(reg.listDeliveries()).toEqual([h]);
  });

  it("resolveDelivery throws on unregistered handle", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://unknown");
    expect(() => reg.resolveDelivery(h)).toThrow(/obsidian-fs:\/\/unknown/);
  });
});

describe("AdapterRegistry — change feeds", () => {
  it("registerChangeFeed / resolveChangeFeed / listChangeFeeds round-trip", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://v1");
    const f = makeStubChangeFeed(h);
    reg.registerChangeFeed(h, f);
    expect(reg.resolveChangeFeed(h)).toBe(f);
    expect(reg.listChangeFeeds()).toEqual([h]);
  });

  it("resolveChangeFeed throws on unregistered handle", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://unknown");
    expect(() => reg.resolveChangeFeed(h)).toThrow(/obsidian-fs:\/\/unknown/);
  });
});

describe("decomposeDocId", () => {
  it("round-trips with formatDocId — split returns the original parts", () => {
    const id = formatDocId("obsidian-fs", "atlas", "a/b/c.md");
    expect(decomposeDocId(id)).toEqual({
      scheme: "obsidian-fs",
      authority: "atlas",
      resource: "a/b/c.md",
    });
  });

  it("preserves resource slashes verbatim (multi-segment resource)", () => {
    const id = parseDocId("obsidian-fs://atlas-fixture/_memory/observations/foo.md");
    expect(decomposeDocId(id)).toEqual({
      scheme: "obsidian-fs",
      authority: "atlas-fixture",
      resource: "_memory/observations/foo.md",
    });
  });

  it("captures authority up to the first / only", () => {
    const id = parseDocId("notion-api://workspace-abc/page-123/subpage");
    expect(decomposeDocId(id)).toEqual({
      scheme: "notion-api",
      authority: "workspace-abc",
      resource: "page-123/subpage",
    });
  });

  it("rejects a string cast to DocId that does not match the regex", () => {
    const bogus = "garbage" as unknown as DocId;
    expect(() => decomposeDocId(bogus)).toThrow(/Invalid DocId/);
  });
});

describe("AdapterRegistry — triad independence", () => {
  it("registering a source does not register a delivery or change-feed", () => {
    const reg = new AdapterRegistry();
    const h = parseSourceHandle("obsidian-fs://v1");
    reg.registerSource(h, makeStubSource(h));
    expect(reg.listSources()).toEqual([h]);
    expect(reg.listDeliveries()).toEqual([]);
    expect(reg.listChangeFeeds()).toEqual([]);
    expect(() => reg.resolveDelivery(h)).toThrow();
    expect(() => reg.resolveChangeFeed(h)).toThrow();
  });
});
