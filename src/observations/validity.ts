import {
  parseValidity,
  validityColumns,
  type ValidityColumns,
  type Validity,
} from "../memory/valid-time.js";
import type { ObservationDraft } from "./parse.js";
export type ValidityOrigin = "inherited" | "explicit" | "mixed";
export function observationValidity(
  row: ObservationDraft,
  properties: Record<string, unknown>,
): ValidityColumns & { validity: Validity; validity_origin: ValidityOrigin } {
  const count = Object.keys(row.validity ?? {}).length;
  const origin = count === 0 ? "inherited" : count === 2 ? "explicit" : "mixed";
  const validity = { ...properties, ...row.validity };
  const columns = validityColumns(validity);
  const parsed = parseValidity(validity);
  return {
    ...columns,
    validity_error: row.validity_error ?? columns.validity_error,
    validity: parsed.ok ? parsed.validity : {},
    validity_origin: origin,
  };
}
