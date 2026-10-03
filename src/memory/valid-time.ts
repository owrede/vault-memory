export interface Validity {
  valid_from?: string | null;
  valid_to?: string | null;
}
export type ValidityResult =
  { ok: true; validity: Validity } | { ok: false; reason: "invalid_validity"; key: string };
/** ISO timestamps with explicit offset and at most millisecond precision. */
export function timestampMillis(value: string): number | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}
export function parseValidity(properties: Record<string, unknown>): ValidityResult {
  const validity: Validity = {};
  for (const key of ["valid_from", "valid_to"] as const) {
    const value = properties[key];
    if (value === undefined) continue;
    if (value === null) {
      validity[key] = null;
      continue;
    }
    const millis = typeof value === "string" ? timestampMillis(value) : null;
    if (millis === null) return { ok: false, reason: "invalid_validity", key };
    validity[key] = new Date(millis).toISOString();
  }
  if (
    validity.valid_from != null &&
    validity.valid_to != null &&
    Date.parse(validity.valid_from) >= Date.parse(validity.valid_to)
  )
    return { ok: false, reason: "invalid_validity", key: "valid_to" };
  return { ok: true, validity };
}
export function isValidAt(validity: Validity, asOf: string): boolean {
  const millis = timestampMillis(asOf);
  if (millis === null) throw new RangeError("invalid as_of");
  const parsed = parseValidity(validity as Record<string, unknown>);
  if (!parsed.ok) throw new RangeError(`invalid_validity: ${parsed.key}`);
  return (
    (parsed.validity.valid_from == null || Date.parse(parsed.validity.valid_from) <= millis) &&
    (parsed.validity.valid_to == null || millis < Date.parse(parsed.validity.valid_to))
  );
}
