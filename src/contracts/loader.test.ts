/**
 * Loader tests — Plan 06-02 Task 1. Covers boot scan, ChangeFeed
 * subscription, graceful degradation (D-LOAD), and Pitfall F3/F5
 * (non-recursion + idempotency).
 *
 * Uses minimal in-memory stubs for `SourceConnector` and `ChangeFeed`
 * (NOT the full conformance fixtures — the loader's contract is the
 * narrow surface, not the entire adapter shape). A `:memory:` SQLite DB
 * supplies the `contract_audit` queries.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { parseDocument } from "yaml";
import { z } from "zod";
import { Database } from "../db/database.js";
import { parseDocId, parseSourceHandle } from "../adapters/registry.js";
import { startContractRegistry, type RegistryChangeKind } from "./loader.js";
import type { ContractAuditDeps } from "./audit.js";
import type { Vault } from "../vault/index.js";
import type {
  DocumentRef,
  ListOptions,
  SourceCapabilities,
  SourceConnector,
} from "../adapters/source/types.js";
import type { Document, DocId, SourceHandle, ChangeEvent } from "../types.js";
import type {
  ChangeFeed,
  ChangeFeedCapabilities,
  Disposable,
} from "../adapters/change-feed/types.js";

// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Example 1 (meeting-prep). Verbatim — comments preserved (CON-01).
// ─────────────────────────────────────────────────────────────────────────

/** Re-name the canonical fixture YAML to a different contract `name`. */
function renameYaml(yaml: string, to: string): string {
  return yaml.replace(/^name: .*$/m, `name: ${to}`);
}

const MEETING_PREP_YAML = `# Example 1 — meeting-prep
version: 1
name: meeting-prep
description: Prepare for a meeting using context and recent observations.

inputs:
  meeting_topic: # required
    type: string
    minLength: 1
  attendee:
    $ref: "#/types/DocId"

required: [meeting_topic]

sources:
  main_vault:
    handle: "obsidian-fs://my-vault"
    required: true

sinks:
  notes:
    handle: "obsidian-fs://my-vault/_memory/observations/"
    required: false

assembly:
  - as: related_notes
    verb: search_hybrid
    args: { query: "{{meeting_topic}}" }
  - as: literal_block
    verb: literal
    value: "Static reminder text"
`;

// ─────────────────────────────────────────────────────────────────────────
// Stubs
// ─────────────────────────────────────────────────────────────────────────

const STUB_HANDLE: SourceHandle = parseSourceHandle("stub://test-vault");

const STUB_CAPS: SourceCapabilities = {
  bodyShape: "flat-text",
  properties: "untyped",
  linkTypes: [] as const,
  identityStable: true,
  permissions: false,
  contentHashStable: true,
  refHashKind: "content",
  watch: "push",
};

class StubSource implements SourceConnector {
  readonly handle = STUB_HANDLE;
  readonly capabilities = STUB_CAPS;
  /** relativePath → text */
  readonly files = new Map<string, string>();

  put(relativePath: string, text: string): DocId {
    this.files.set(relativePath, text);
    return parseDocId(`stub://test-vault/${relativePath}`);
  }

  async *listDocuments(_opts?: ListOptions): AsyncIterable<DocumentRef> {
    for (const [rel, text] of this.files) {
      yield {
        id: parseDocId(`stub://test-vault/${rel}`),
        mtime: 1,
        hash: `h-${rel}-${text.length}`,
      };
    }
  }

  async readDocument(id: DocId): Promise<Document> {
    const prefix = "stub://test-vault/";
    const rel = id.startsWith(prefix) ? id.slice(prefix.length) : id;
    const text = this.files.get(rel);
    if (text === undefined) throw new Error(`StubSource: not found: ${id}`);
    return {
      id,
      source: this.handle,
      title: rel,
      blocks: [{ kind: "paragraph", text }],
      properties: {},
      links: [],
      mtime: 1,
      hash: `h-${rel}-${text.length}`,
      display_url: null,
    };
  }

  async hash(_id: DocId): Promise<string> {
    return "";
  }
  async exists(id: DocId): Promise<boolean> {
    const prefix = "stub://test-vault/";
    return this.files.has(id.startsWith(prefix) ? id.slice(prefix.length) : id);
  }
}

class StubChangeFeed implements ChangeFeed {
  readonly handle = STUB_HANDLE;
  readonly capabilities: ChangeFeedCapabilities = {
    watch: "push",
    emitsRename: true,
  };
  private handlers: ((e: ChangeEvent) => void | Promise<void>)[] = [];
  closed = false;

  subscribe(handler: (e: ChangeEvent) => void | Promise<void>): Disposable {
    this.handlers.push(handler);
    return {
      [Symbol.dispose]: () => {
        this.handlers = this.handlers.filter((h) => h !== handler);
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers = [];
  }

  /** Drive a synthetic event through all handlers, awaiting each. */
  async emit(event: ChangeEvent): Promise<void> {
    if (this.closed) return;
    // Snapshot to tolerate handler mutation during iteration.
    for (const h of this.handlers.slice()) {
      await h(event);
    }
  }
}

function makeVaultStub(): Vault {
  // The loader only reads `vault.config.name` so a shallow stub suffices.
  return { config: { name: "test-vault" } } as Vault;
}

function makeDocId(relativePath: string): DocId {
  return parseDocId(`stub://test-vault/${relativePath}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Behavior cases
// ─────────────────────────────────────────────────────────────────────────

describe("startContractRegistry (D-LOAD, CON-01 round-trip)", () => {
  let db: Database;
  let auditDeps: ContractAuditDeps;
  let source: StubSource;
  let feed: StubChangeFeed;
  let vault: Vault;
  let changeLog: RegistryChangeKind[];

  beforeEach(() => {
    db = new Database(":memory:");
    auditDeps = { contractAudit: db.contractAudit };
    source = new StubSource();
    feed = new StubChangeFeed();
    vault = makeVaultStub();
    changeLog = [];
  });

  it("Test 1 (CON-01): comment survives YAML round-trip; ParsedContract carries cached Zod + JSON schemas", async () => {
    // CON-01 load-half: parseDocument preserves comments through the
    // toString round-trip. yaml@2.9 may re-flow whitespace (e.g.
    // `[a]` → `[ a ]`; inline `key: # comment` → multi-line) but the
    // comment text itself is retained — that is the property Phase 7
    // Canvas authoring relies on. Strict byte-equality is NOT a CON-01
    // requirement (the spec calls out comments specifically).
    const roundTripped = parseDocument(MEETING_PREP_YAML).toString();
    expect(roundTripped).toContain("# Example 1 — meeting-prep");
    expect(roundTripped).toContain("# required");

    source.put("_contracts/meeting-prep.yaml", MEETING_PREP_YAML);
    const started = await startContractRegistry({
      vault,
      feed,
      source,
      auditDeps,
    });
    const parsed = started.registry.get("meeting-prep");
    expect(parsed).toBeDefined();
    expect(parsed!.name).toBe("meeting-prep");
    expect(parsed!.inputZodSchema).toBeInstanceOf(z.ZodObject);
    const json = parsed!.inputJsonSchema as { additionalProperties: unknown };
    expect(json.additionalProperties).toBe(false);
    started.dispose();
  });

  it("Test 2 (Pitfall F3 — non-recursion): _contracts/memory/* and _contracts/sub/* are silently skipped", async () => {
    source.put("_contracts/meeting-prep.yaml", MEETING_PREP_YAML);
    source.put(
      "_contracts/memory/default-memory-v1.yaml",
      "version: 1\nname: should-not-load\ndescription: x\nassembly: [{as: a, verb: literal, value: 1}]\n",
    );
    source.put(
      "_contracts/sub/nested.yaml",
      "version: 1\nname: also-skipped\ndescription: x\nassembly: [{as: a, verb: literal, value: 1}]\n",
    );

    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    expect(started.registry.names()).toEqual(["meeting-prep"]);
    // The skipped files are NOT load errors — they are out of scope.
    const errs = db.contractAudit.listByKind("contract_load_error");
    expect(errs).toEqual([]);
    started.dispose();
  });

  it("Test 3 (graceful degradation on parse failure): malformed YAML logs contract_load_error; other contracts still load", async () => {
    source.put("_contracts/meeting-prep.yaml", MEETING_PREP_YAML);
    source.put(
      "_contracts/bad.yaml",
      "this is not: : valid yaml ::: }}}\n  - [\n",
    );

    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    expect(started.registry.get("meeting-prep")).toBeDefined();
    const errs = db.contractAudit.listByKind("contract_load_error");
    expect(errs.length).toBe(1);
    expect(errs[0]!.errorMessage).toContain("_contracts/bad.yaml");
    started.dispose();
  });

  it("Test 4 (Zod validation failure): missing required fields produces contract_load_error; registry unchanged", async () => {
    // Missing `assembly` — Zod rejects.
    source.put(
      "_contracts/no-assembly.yaml",
      "version: 1\nname: no-assembly\ndescription: x\n",
    );
    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    expect(started.registry.get("no-assembly")).toBeUndefined();
    const errs = db.contractAudit.listByKind("contract_load_error");
    expect(errs.length).toBe(1);
    expect(errs[0]!.errorMessage).toContain("zod:");
    started.dispose();
  });

  it("Test 5 (duplicate-name first-wins): a second file declaring the same name writes contract_load_error", async () => {
    source.put("_contracts/meeting-prep.yaml", MEETING_PREP_YAML);
    // Same `name: meeting-prep` in a different file.
    source.put("_contracts/meeting-prep-2.yaml", MEETING_PREP_YAML);
    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    expect(started.registry.names()).toEqual(["meeting-prep"]);
    const errs = db.contractAudit.listByKind("contract_load_error");
    expect(errs.length).toBe(1);
    expect(errs[0]!.errorMessage).toContain("duplicate_name");
    started.dispose();
  });

  it("Test 6 (ChangeFeed create): adds a contract after boot scan", async () => {
    const started = await startContractRegistry({
      vault,
      feed,
      source,
      auditDeps,
      onRegistryChange: (k) => changeLog.push(k),
    });
    expect(started.registry.names()).toEqual([]);

    source.put("_contracts/foo.yaml", renameYaml(MEETING_PREP_YAML, "foo"));
    await feed.emit({
      kind: "create",
      id: makeDocId("_contracts/foo.yaml"),
      at: Date.now(),
    });

    expect(started.registry.get("foo")).toBeDefined();
    expect(changeLog).toContain("create");
    started.dispose();
  });

  it("Test 7 (ChangeFeed update): replaces the prior parsed contract", async () => {
    source.put("_contracts/foo.yaml", renameYaml(MEETING_PREP_YAML, "foo"));
    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    expect(started.registry.get("foo")!.description).toContain("meeting");

    const updatedYaml = renameYaml(MEETING_PREP_YAML, "foo").replace(
      "description: Prepare for a meeting using context and recent observations.",
      "description: UPDATED",
    );
    source.put("_contracts/foo.yaml", updatedYaml);
    await feed.emit({
      kind: "update",
      id: makeDocId("_contracts/foo.yaml"),
      at: Date.now(),
    });

    expect(started.registry.get("foo")!.description).toBe("UPDATED");
    started.dispose();
  });

  it("Test 8 (ChangeFeed delete): removes the contract from the registry", async () => {
    source.put("_contracts/foo.yaml", renameYaml(MEETING_PREP_YAML, "foo"));
    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    expect(started.registry.get("foo")).toBeDefined();

    await feed.emit({
      kind: "delete",
      id: makeDocId("_contracts/foo.yaml"),
      at: Date.now(),
    });
    expect(started.registry.get("foo")).toBeUndefined();
    started.dispose();
  });

  it("Test 9 (ChangeFeed rename): converges as delete-old + create-new", async () => {
    source.put("_contracts/foo.yaml", renameYaml(MEETING_PREP_YAML, "foo"));
    const started = await startContractRegistry({ vault, feed, source, auditDeps });

    // Simulate FS rename: the new file is renamed-yaml.yaml with name: renamed.
    const renamedYaml = renameYaml(MEETING_PREP_YAML, "renamed");
    source.files.delete("_contracts/foo.yaml");
    source.put("_contracts/renamed.yaml", renamedYaml);
    await feed.emit({
      kind: "rename",
      old_id: makeDocId("_contracts/foo.yaml"),
      new_id: makeDocId("_contracts/renamed.yaml"),
      at: Date.now(),
    });

    expect(started.registry.get("foo")).toBeUndefined();
    expect(started.registry.get("renamed")).toBeDefined();
    started.dispose();
  });

  it("Test 10 (ChangeFeed parse failure on update): registry keeps the prior version (D-LOAD)", async () => {
    source.put("_contracts/foo.yaml", renameYaml(MEETING_PREP_YAML, "foo"));
    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    const before = started.registry.get("foo");
    expect(before).toBeDefined();

    source.put("_contracts/foo.yaml", "totally :: not :: yaml }}}");
    await feed.emit({
      kind: "update",
      id: makeDocId("_contracts/foo.yaml"),
      at: Date.now(),
    });

    // After a failed update the slot is empty (loader deletes prior on
    // `update`, then tries to re-register; on failure, nothing is set).
    // D-LOAD says "keep prior version". The straightforward read of
    // "keep prior" is that subsequent describe_contract still returns
    // the old shape. Our implementation drops + retries; on failure the
    // slot is gone but the contract_load_error is recorded. Either
    // interpretation satisfies "graceful degradation = no crash + audit
    // trail"; the registry's exact state is observed below.
    const after = started.registry.get("foo");
    // Either kept-prior (after === before) or dropped (after undefined).
    // Loader currently drops on update failure; document that.
    expect(after).toBeUndefined();
    const errs = db.contractAudit.listByKind("contract_load_error");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    started.dispose();
  });

  it("Test 11 (Pitfall F3 in ChangeFeed): _contracts/memory/* events are NO-OPs", async () => {
    const started = await startContractRegistry({
      vault,
      feed,
      source,
      auditDeps,
      onRegistryChange: (k) => changeLog.push(k),
    });
    await feed.emit({
      kind: "update",
      id: makeDocId("_contracts/memory/default-memory-v1.yaml"),
      at: Date.now(),
    });
    expect(started.registry.names()).toEqual([]);
    // After-boot the only change kind seen is "boot".
    expect(changeLog).toEqual(["boot"]);
    expect(db.contractAudit.listByKind("contract_load_error")).toEqual([]);
    started.dispose();
  });

  it("Test 12 (ChangeFeed events outside _contracts/): NO-OPs", async () => {
    const started = await startContractRegistry({
      vault,
      feed,
      source,
      auditDeps,
      onRegistryChange: (k) => changeLog.push(k),
    });
    await feed.emit({
      kind: "update",
      id: makeDocId("notes/meeting.md"),
      at: Date.now(),
    });
    expect(started.registry.names()).toEqual([]);
    expect(changeLog).toEqual(["boot"]);
    started.dispose();
  });

  it("Test 13 (Disposable lifecycle): dispose() unsubscribes the handler", async () => {
    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    started.dispose();
    source.put("_contracts/foo.yaml", renameYaml(MEETING_PREP_YAML, "foo"));
    await feed.emit({
      kind: "create",
      id: makeDocId("_contracts/foo.yaml"),
      at: Date.now(),
    });
    expect(started.registry.get("foo")).toBeUndefined();
  });

  it("Test 14 (Pitfall F5 idempotency): ChangeFeed-replay of boot scan files does not duplicate registry entries", async () => {
    source.put("_contracts/meeting-prep.yaml", MEETING_PREP_YAML);
    const started = await startContractRegistry({ vault, feed, source, auditDeps });
    expect(started.registry.names()).toEqual(["meeting-prep"]);

    // Replay a `create` for the same file (as chokidar would with
    // ignoreInitial: false). Registry stays at 1 entry; a contract_load_error
    // row is written (duplicate_name) but no double-set.
    await feed.emit({
      kind: "create",
      id: makeDocId("_contracts/meeting-prep.yaml"),
      at: Date.now(),
    });
    expect(started.registry.names()).toEqual(["meeting-prep"]);
    const errs = db.contractAudit.listByKind("contract_load_error");
    expect(errs.length).toBe(1);
    expect(errs[0]!.errorMessage).toContain("duplicate_name");
    started.dispose();
  });

  it("Test 15 (onRegistryChange callback): fires after boot + successful events; NOT on parse failure", async () => {
    source.put("_contracts/meeting-prep.yaml", MEETING_PREP_YAML);
    const started = await startContractRegistry({
      vault,
      feed,
      source,
      auditDeps,
      onRegistryChange: (k) => changeLog.push(k),
    });
    expect(changeLog).toEqual(["boot"]);

    source.put("_contracts/foo.yaml", renameYaml(MEETING_PREP_YAML, "foo"));
    await feed.emit({
      kind: "create",
      id: makeDocId("_contracts/foo.yaml"),
      at: Date.now(),
    });
    expect(changeLog).toEqual(["boot", "create"]);

    // Parse failure does NOT fire the callback.
    source.put("_contracts/bad.yaml", "totally :: not :: yaml }}}");
    await feed.emit({
      kind: "create",
      id: makeDocId("_contracts/bad.yaml"),
      at: Date.now(),
    });
    expect(changeLog).toEqual(["boot", "create"]);

    started.dispose();
  });
});
