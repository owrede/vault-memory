import type { ParsedNote } from "../types.js";
import type { Vault } from "../vault/index.js";
import { parseObservations } from "./parse.js";

/** Publish note metadata, statement snapshot and changed sections together. */
export function syncObservationIndex(
  vault: Vault,
  noteId: number,
  parsed: ParsedNote,
  rebuildSections?: () => void,
): void {
  vault.db.transaction(() => {
    vault.db.notes.upsertByPath({
      path: parsed.relativePath,
      content: parsed.content,
      frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
      title: parsed.title,
      hash: parsed.hash,
      bodyHash: parsed.bodyHash,
      mtime: parsed.mtime,
      wordCount: parsed.wordCount,
    });
    vault.db.notes.setStatus(
      noteId,
      typeof parsed.frontmatter?.status === "string" ? parsed.frontmatter.status : null,
    );
    if (rebuildSections !== undefined) {
      vault.db.sections.deleteByNote(noteId);
      rebuildSections();
    }
    vault.db.observations.replaceForNote(noteId, parsed.hash, parseObservations(parsed.content));
  });
}
