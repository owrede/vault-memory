/**
 * Error formatting helper.
 *
 * Collapses the recurring "instanceof Error ? .message : String()"
 * boilerplate into a single, testable function.
 *
 * # Adapter-seam discipline
 *
 * Pure helper. Zero runtime imports.
 */

/**
 * Render an unknown thrown value as a human-readable string.
 *
 * Byte-identical to the inline ternary it replaces (an Error's `.message`,
 * otherwise `String(value)`).
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
