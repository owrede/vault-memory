/**
 * Public type surface for `MemoryContract`.
 *
 * Kept in its own module so `default-v1.ts`, `loader.ts`, and the
 * `index.ts` barrel can import the same interface without creating a
 * circular dependency through `index.ts`.
 */

import type { ZodType } from "zod";

export interface MemoryContract {
  /** Canonical contract name, e.g. "default-memory-v1". */
  name: string;
  /** Semver-ish version string, e.g. "1.0". */
  version: string;
  /**
   * Zod schema validating `Document.properties` against this contract.
   * Built once at contract-load time and reused per write. Returns the
   * parsed (and possibly defaulted) properties object on success; a
   * `ZodError` on failure (mapped to the project's structured error
   * codes by the validator caller).
   */
  propertiesSchema: ZodType;
  /**
   * Required property keys in canonical (declaration) order. Used for
   * diagnostic-error iteration so callers can report "first missing
   * required key" deterministically.
   */
  requiredKeys: readonly string[];
  /** Naming strategy and optional pattern (see ADR-004 §Naming strategies). */
  naming: {
    strategy: "caller-provided" | "date-slug" | "adapter-assigned";
    pattern?: string;
  };
}
