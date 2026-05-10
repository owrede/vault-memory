import { createHash } from "node:crypto";

/** SHA-256 hex digest of input string (utf-8). */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
