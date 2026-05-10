export { Database } from "./database.js";
export { INITIAL_SCHEMA, MIGRATIONS } from "./schema.js";
export type { Migration } from "./schema.js";
export type { IndexRunRow, WriteAuditRow } from "./types.js";

export { NotesQueries } from "./queries/notes.js";
export type { UpsertNoteInput } from "./queries/notes.js";

export { ChunksQueries } from "./queries/chunks.js";
export type { ChunkInput } from "./queries/chunks.js";

export { EmbeddingsQueries } from "./queries/embeddings.js";
export type { EmbeddingInput, SemanticHit } from "./queries/embeddings.js";

export { WikilinksQueries } from "./queries/wikilinks.js";
export type {
  WikilinkInput,
  BacklinkRow,
  ForwardLinkRow,
  BrokenLinkRow,
} from "./queries/wikilinks.js";

export { AuditQueries } from "./queries/audit.js";
export type {
  StartRunInput,
  FinishRunStats,
  RecordWriteInput,
  ListWritesFilter,
} from "./queries/audit.js";

export { ModelsQueries } from "./queries/models.js";
export type { UpsertModelInput } from "./queries/models.js";

export { FtsQueries } from "./queries/fts.js";
export type { BM25Hit } from "./queries/fts.js";
