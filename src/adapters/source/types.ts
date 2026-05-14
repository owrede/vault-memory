/**
 * SourceConnector — the read seam (ADR-002 §SourceConnector).
 *
 * A `SourceConnector` lets vault-memory enumerate, read, and hash
 * documents from a backing store (Obsidian filesystem vault today;
 * Notion workspace / Slack workspace / GitHub repo in future phases).
 * The interface is the SOLE entry point through which Layer-0 retrieval
 * obtains content; every read path in the indexer and the v1 read_note
 * tool routes through here (Plan 01-03 wiring).
 *
 * # Invariants (ADR-002)
 *
 *   I-1: No `chokidar` import from a non-change-feed module — sources
 *        never watch; subscription is the ChangeFeed's job.
 *   I-2: No `node:fs` / `node:path` imports outside `src/adapters/**`,
 *        `src/config/`, and `cli.ts`. Implementations of this interface
 *        carry the fs concern; consumers never.
 *   I-3: No raw file-path manipulation outside `src/adapters/**`. The
 *        DocId is the only identity surface that crosses module
 *        boundaries.
 *   I-4: YAML-frontmatter-specific logic (`gray-matter`, custom YAML
 *        parsers) lives inside the obsidian-fs source adapter, never
 *        in core.
 *   I-5: Bare `.md` literals belong inside the obsidian-fs source
 *        adapter.
 *   I-6: DocId canonical serialization — `<scheme>://<authority>/<resource>`,
 *        ASCII-normalized, no trailing slash. ADR-001.
 *   I-7: Capabilities don't lie. Conformance suites (Plan 01-03) assert
 *        every published capability against observed behavior.
 *
 * # Failure semantics
 *
 * - `readDocument(id)` MAY throw on transient I/O failure; callers
 *   handle retries.
 * - `exists(id)` MUST NOT throw on unknown id — it returns `false`.
 * - `hash(id)` semantics depend on `capabilities.refHashKind`:
 *     - `"content"` — returns a stable content hash; equality implies
 *       content equality.
 *     - `"remote-token"` — returns an opaque remote version token;
 *       equality implies "no change since" but NOT necessarily content
 *       equality across adapters.
 *     - `"none"` — `hash` MAY throw or return an empty string; callers
 *       must not rely on the return value.
 *
 * # Phase 1 reference impl
 *
 * `ObsidianFsSource` (Plan 01-03) is the reference implementation.
 * `StubSource` (Plan 01-03) is the in-memory conformance fixture.
 */

import type { DocId, Document, SourceHandle } from "../../types.js";
import type {
  BodyShape,
  EdgeType,
  PropertiesShape,
  RefHashKind,
  WatchKind,
} from "../capabilities.js";

/**
 * Lightweight descriptor returned by `listDocuments` — enough metadata
 * to drive change detection without paying the cost of a full read.
 *
 * The `hash` field semantics are gated by `SourceCapabilities.refHashKind`
 * (see ADR-002 §DocumentRef.hash + Adversarial Finding 7).
 */
export interface DocumentRef {
  /** Opaque, branded DocId. */
  id: DocId;
  /** Last-modified time, epoch milliseconds. */
  mtime: number;
  /** Content / remote-token hash; semantics depend on `refHashKind`. */
  hash: string;
}

/**
 * Options accepted by `listDocuments`. All fields optional; adapters
 * MAY ignore unrecognized fields. ADR-002 §ListOptions.
 */
export interface ListOptions {
  /** Glob patterns to exclude from enumeration. */
  excludeGlobs?: string[];
  /** Only return refs whose `mtime >= since` (epoch ms). */
  since?: number;
  /** Cap on the number of refs yielded. */
  limit?: number;
}

/**
 * Published capability descriptor for a SourceConnector. The conformance
 * suite (Plan 01-03) asserts EVERY field against observed behavior per
 * Invariant I-7. ADR-002 §SourceCapabilities + Adversarial Findings 7/10.
 */
export interface SourceCapabilities {
  /** Block-level shape the adapter produces. */
  bodyShape: BodyShape;
  /** Untyped (frontmatter) vs typed-schema-bound (Notion) properties. */
  properties: PropertiesShape;
  /** Edge categories the adapter MAY emit on Document.links / properties. */
  linkTypes: readonly EdgeType[];
  /** Identity is stable across reads (same content → same DocId). */
  identityStable: boolean;
  /** The source exposes per-document permission metadata. */
  permissions: boolean;
  /** Content hash is stable across reads (no spurious churn). ADR-003 H-1..H-6. */
  contentHashStable: boolean;
  /** Semantic tier for `DocumentRef.hash`. */
  refHashKind: RefHashKind;
  /** Watch semantics — push (live), poll (interval), or none. */
  watch: WatchKind;
}

/**
 * The read seam. Implementations: `ObsidianFsSource` (Plan 01-03,
 * reference); `StubSource` (Plan 01-03, conformance fixture).
 *
 * All methods are async; sync adapters wrap their results in
 * `Promise.resolve(...)`.
 */
export interface SourceConnector {
  /** The adapter handle that names this connector in the registry. */
  readonly handle: SourceHandle;
  /** Published capability descriptor. Honest per Invariant I-7. */
  readonly capabilities: SourceCapabilities;

  /**
   * Enumerate documents in the source. Implementations SHOULD stream
   * (AsyncIterable) so callers can apply backpressure on large vaults.
   */
  listDocuments(opts?: ListOptions): AsyncIterable<DocumentRef>;

  /**
   * Read a single document by id. MAY throw on transient I/O failure;
   * MUST throw with a descriptive message if the id does not exist
   * (use `exists(id)` first to disambiguate).
   */
  readDocument(id: DocId): Promise<Document>;

  /**
   * Return a hash for the document at `id`. Semantics depend on
   * `capabilities.refHashKind` — see file header.
   */
  hash(id: DocId): Promise<string>;

  /**
   * Return `true` iff the document at `id` exists. MUST NOT throw on
   * unknown id — return `false`.
   */
  exists(id: DocId): Promise<boolean>;

  /**
   * Adapter-provided deep-link URL (D-01). Each source knows how to
   * deep-link its own documents — obsidian-fs returns
   * `obsidian://open?vault=…&file=…`; a future notion-api adapter
   * returns `https://notion.so/<id>` or `null` (its choice).
   *
   * Optional method. When absent, callers SHOULD treat the document as
   * having no public deep link.
   */
  formatDisplayUrl?(id: DocId): string | null;
}
