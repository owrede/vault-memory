/**
 * Shared capability sub-types referenced by both
 * `src/adapters/source/types.ts` and `src/adapters/delivery/types.ts`.
 *
 * Consolidated here to avoid duplication and to give the conformance
 * suites (Plans 01-03..05) a single canonical home to assert against
 * the "capabilities don't lie" invariant (ADR-002 §I-7).
 *
 * ADR-002 §"Capability Descriptors" is the source of truth; this file
 * encodes the union literals so adapter `capabilities` objects compile
 * against a closed enumeration.
 *
 * Pure type module — no runtime exports.
 */

/** Body content shape produced by a SourceConnector. ADR-002 §SourceCapabilities. */
export type BodyShape = "flat-text" | "blocks" | "html-fragments";

/** Property-bag shape — untyped (YAML frontmatter) vs typed-schema-bound (Notion). */
export type PropertiesShape = "untyped" | "typed-schema-bound";

/** Edge category emitted on `Document.links` (Phase 4 surface). ADR-003. */
export type EdgeType = "wikilink" | "embed" | "mention" | "frontmatter-ref" | "hyperlink";

/**
 * Semantic tier for `DocumentRef.hash`. ADR-002 §DocumentRef.hash +
 * Adversarial Finding 7: "content" = stable content hash; "remote-token"
 * = opaque remote etag/version; "none" = no hash available, callers must
 * not rely on `hash` for equality comparison.
 */
export type RefHashKind = "content" | "remote-token" | "none";

/** Watch semantics — push (real-time), poll (interval), or none. */
export type WatchKind = "push" | "poll" | "none";

/**
 * Hash protection tier for `DeliveryAdapter.write`. ADR-002 §DeliveryCapabilities
 * + Adversarial Finding 10. "strong" = OCC enforced (mismatch rejects);
 * "best-effort" = OCC checked when supplied but not authoritative;
 * "none" = no OCC, callers must accept lost-update risk.
 */
export type HashProtected = "strong" | "best-effort" | "none";

/**
 * Naming mode for new documents. ADR-002 §DeliveryCapabilities.
 * "caller-provided" = the DocId is chosen by the caller (obsidian-fs);
 * "adapter-derived" = the adapter derives the id from content/title;
 * "remote-assigned" = the remote system assigns the id post-create
 *  (e.g. Notion returns the new page id).
 */
export type NamingMode = "caller-provided" | "adapter-derived" | "remote-assigned";
