export { listBacklinks, listForwardLinks, findBrokenLinks } from "./graph.js";
export type {
  BacklinkResult,
  ForwardLinkResult,
  BrokenLinkResult,
  EdgeType,
} from "./graph.js";

// ── Phase 4 / 04-03 / GRA-01: typed-edge BFS retrieval (`expand`) ──
export { expand, isShorterPath } from "./expand.js";
export type {
  ExpandOptions,
  ExpandDirection,
  ExpandDeps,
  ExpansionResult,
  ViaTrace,
  CitationPacketWithVia,
} from "./expand.js";

// ── Phase 4 / 04-05 / GRA-02: Louvain community detection (`cluster`) ──
export { cluster } from "./cluster.js";
export type {
  Cluster,
  ClusterDeps,
  ClusterOptions,
  ClusterResult,
  ClusterSummary,
} from "./cluster.js";
