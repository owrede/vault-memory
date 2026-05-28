/**
 * Error formatting helper.
 *
 * Collapses the recurring `err instanceof Error ? err.message : String(err)`
 * boilerplate into a single, testable function.
 *
 * # Adapter-seam discipline
 *
 * Pure helper. Zero runtime imports.
 */

/**
 * Render an unknown thrown value as a human-readable string.
 *
 * Byte-identical to the inline ternary it replaces:
 * `err instanceof Error ? err.message : String(err)`.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
