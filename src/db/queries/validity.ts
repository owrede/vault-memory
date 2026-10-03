/** notes alias is fixed by query owners; values are bound, never interpolated. */
export const VALID_NOTES_AT_SQL =
  "notes.validity_error IS NULL AND (notes.valid_from_ms IS NULL OR notes.valid_from_ms <= ?) AND (notes.valid_to_ms IS NULL OR notes.valid_to_ms > ?)";
