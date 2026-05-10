export { indexVault, extractAliases, resolveWikilinkTarget } from "./indexer.js";
export type { IndexerOptions, IndexRunResult } from "./indexer.js";
export { indexNote, removeNote } from "./single.js";
export type { IndexNoteOptions, IndexNoteResult } from "./single.js";
export { catchupVault } from "./catchup.js";
export type { CatchupOptions, CatchupResult } from "./catchup.js";
export {
  startShadowIndex,
  listModels,
  switchActiveModel,
} from "./shadow.js";
export type {
  ShadowIndexOptions,
  ShadowIndexResult,
  ModelInventoryEntry,
  SwitchResult,
} from "./shadow.js";
