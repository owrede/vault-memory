export { writeNote, deleteNote } from "./write.js";
export type {
  WriteResult,
  WriteSuccess,
  WriteConflict,
  WriteNoteInput,
  DeleteNoteInput,
} from "./write.js";
export { atomicWriteFile, safeJoinInsideVault, OutsideVaultError } from "./fs.js";
