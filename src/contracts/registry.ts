/**
 * ContractRegistry — Phase 6 / D-A1c, ADR-006 §Decision 1, Invariant C-4.
 *
 * In-memory `Map<name, ParsedContract>` wrapper with first-wins
 * collision policy. A second `set(name, ...)` with the same name does
 * NOT replace the original; it returns a structured failure result so
 * the caller can record `contract_audit kind: 'contract_load_error'`.
 *
 * Caller writes the audit row (`src/contracts/audit.ts` —
 * `recordContractLoadError`); the registry stays free of DB imports.
 *
 * Adapter-seam discipline: zero `fs`/`path.join`/`gray-matter`/`chokidar`
 * imports. Pure in-memory data structure.
 */

import type { ParsedContract } from "./types.js";

export type RegistrySetResult =
  | { ok: true }
  | { ok: false; reason: "duplicate_name" };

export class ContractRegistry {
  private readonly contracts = new Map<string, ParsedContract>();

  get size(): number {
    return this.contracts.size;
  }

  get(name: string): ParsedContract | undefined {
    return this.contracts.get(name);
  }

  /** D-A1c first-wins. Returns `{ok:false, reason:"duplicate_name"}` if `name` is already registered. */
  set(name: string, contract: ParsedContract): RegistrySetResult {
    if (this.contracts.has(name)) {
      return { ok: false, reason: "duplicate_name" };
    }
    this.contracts.set(name, contract);
    return { ok: true };
  }

  delete(name: string): boolean {
    return this.contracts.delete(name);
  }

  entries(): IterableIterator<[string, ParsedContract]> {
    return this.contracts.entries();
  }

  names(): string[] {
    return Array.from(this.contracts.keys());
  }
}
