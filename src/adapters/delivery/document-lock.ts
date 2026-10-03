/** A stored Boolean lock protects a document independently of its OCC token. */
export interface DocumentLockedConflict {
  ok: false;
  reason: "document_locked";
  message: string;
}

export function getDocumentLockConflict(
  properties?: Record<string, unknown> | null,
): DocumentLockedConflict | null {
  return properties?.locked === true
    ? {
        ok: false,
        reason: "document_locked",
        message: "Document is locked. Unlock it in your editor before retrying.",
      }
    : null;
}
